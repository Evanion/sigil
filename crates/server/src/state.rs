// crates/server/src/state.rs

//! Server-specific application state.
//!
//! Re-exports the core `AppState` and `SendDocument` from the `state` crate
//! and provides convenience constructors that wire up persistence and the
//! mutation event broadcast channel.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use sigil_core::Document;

use crate::session_persistence::SessionPersistence;

// Re-export the core state types so existing code can use `crate::state::AppState`.
pub use sigil_state::{
    App, AppState, MUTATION_BROADCAST_CAPACITY, MutationEvent, MutationEventKind, SendDocument,
    SessionId, Sessions, SessionsError,
};

/// Server-level state that wraps the shared [`App`].
///
/// `ServerState` is the value passed through Axum's state extractor and into
/// GraphQL schema `Data`. As of Spec 22b the [`Sessions`] registry is the
/// single source of truth for every document read, write, and broadcast
/// across all transports (GraphQL queries/mutations, MCP tools). A session is
/// resolved via the `X-Sigil-Session` header or the `default_session_id`
/// anchor, then `session.store` is read/written directly.
///
/// `App` (from `sigil-state`) still carries a legacy single-document
/// `AppState` field, but no handler reads or writes it; it is retained only
/// until a later task removes it entirely.
#[derive(Clone)]
pub struct ServerState {
    /// High-level application state: the [`Sessions`] registry (and a retained
    /// but unused legacy `AppState`). Shared with MCP via `state.app.clone()`.
    pub app: App,
    /// Per-session persistence manager (Spec 22a). Owns one debounced save task
    /// per disk-backed session. Shared (`Arc`) so clones for Axum/MCP observe
    /// the same task set; graceful shutdown drains it via `shutdown_all`.
    pub persistence: Arc<SessionPersistence>,
}

impl ServerState {
    /// Creates a new `ServerState` with an empty document, no persistence,
    /// and a default in-memory session registered in the [`Sessions`]
    /// registry.
    ///
    /// Suitable for tests and in-memory-only operation. The default session
    /// id is set so GraphQL resolvers can resolve a session without an
    /// `X-Sigil-Session` header.
    #[must_use]
    pub fn new() -> Self {
        let legacy = AppState::new();
        let app = App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY);

        // Register an in-memory default session seeded with a fresh empty
        // document. The session store is the single source of truth for all
        // reads, writes, and broadcasts (Spec 22b). The legacy `AppState`
        // still exists (deleted in a later task) but no handler reads or
        // writes it.
        let id = app
            .sessions
            .register_in_memory(Document::new("Untitled".to_string()));
        app.set_default_session_id(Some(id));

        Self {
            app,
            persistence: Arc::new(SessionPersistence::new()),
        }
    }

    /// Creates a `ServerState` holding a pre-loaded document for `workfile_path`.
    ///
    /// Spec 22a: this no longer spawns a persistence task. The legacy `AppState`
    /// holds the document for the still-present mirror (removed in 22c), but
    /// persistence is owned per-session by [`SessionPersistence`]. The caller is
    /// responsible for registering the session in `app.sessions` AND registering
    /// it with `persistence` (passing the migration flag) — see
    /// `main.rs::load_workfile_into_state`.
    ///
    /// `_migrated_from` is accepted for call-site compatibility but is now
    /// threaded by the caller into `SessionPersistence::register`; it is not used
    /// here.
    #[must_use]
    pub fn new_with_document_and_workfile_migrated(
        doc: Document,
        workfile_path: PathBuf,
        _migrated_from: Option<u32>,
    ) -> Self {
        // The session store is the read + persistence source (Spec 22a/22b).
        // The disk-backed session is registered by the caller
        // (`load_workfile_into_state`) via `open_session_with`; the legacy
        // `AppState` no longer mirrors the document and is not read by any
        // handler. It is retained only until a later task deletes it.
        let document = Arc::new(Mutex::new(SendDocument(doc)));
        let legacy = AppState::new_with_document(document, workfile_path);
        Self {
            app: App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY),
            persistence: Arc::new(SessionPersistence::new()),
        }
    }
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_state_new_creates_empty_document() {
        let state = ServerState::new();
        let id = state
            .app
            .default_session_id()
            .expect("default session id should be set");
        let session = state
            .app
            .sessions
            .get(id)
            .expect("default session must be present");
        let guard = session.store.read().await;
        let doc = &guard.0;
        assert_eq!(doc.metadata.name, "Untitled");
        assert_eq!(doc.pages.len(), 0);
        assert_eq!(doc.arena.len(), 0);
    }

    #[tokio::test]
    async fn test_server_state_exposes_empty_persistence_manager() {
        let state = ServerState::new();
        // A fresh in-memory state has no disk-backed sessions, so no persistence
        // tasks are registered.
        assert_eq!(state.persistence.len(), 0);
    }

    #[test]
    fn test_server_state_registers_default_in_memory_session() {
        // Spec 20: `ServerState::new()` now registers an in-memory default
        // session so GraphQL mutations can resolve a session id without an
        // explicit workfile or `X-Sigil-Session` header.
        let state = ServerState::new();
        assert_eq!(state.app.sessions.len(), 1);
        let id = state
            .app
            .default_session_id()
            .expect("default session id should be set");
        assert!(state.app.sessions.get(id).is_some());
    }
}
