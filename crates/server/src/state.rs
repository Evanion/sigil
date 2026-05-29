// crates/server/src/state.rs

//! Server-specific application state.
//!
//! Re-exports the core `AppState` and `SendDocument` from the `state` crate
//! and provides convenience constructors that wire up persistence and the
//! mutation event broadcast channel.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use sigil_core::Document;
use tokio::sync::broadcast;

use crate::session_persistence::SessionPersistence;

// Re-export the core state types so existing code can use `crate::state::AppState`.
pub use sigil_state::{
    App, AppState, MUTATION_BROADCAST_CAPACITY, MutationEvent, MutationEventKind, SendDocument,
    SessionId, Sessions, SessionsError,
};

/// Server-level state that wraps the shared [`App`].
///
/// `ServerState` is the value passed through Axum's state extractor and into
/// GraphQL schema `Data`. `App` (from `sigil-state`) owns:
///
/// - the legacy single-document [`AppState`] (the current source of truth
///   for mutations), reachable via `state.app.legacy.*` or through the
///   `Deref` impl on `App` as `state.app.*` (which is what existing
///   resolvers/tools use unchanged), and
/// - the [`Sessions`] registry (multi-session), reachable via
///   `state.app.sessions.*`. The CLI startup path opens the `--workfile`
///   directory as the **default session** so multi-session-aware code
///   (Tasks 5–10) can look up the session by id without forcing the
///   single-document deployment to break.
///
/// Until Tasks 5–10 land, the legacy `AppState.document` is the authoritative
/// store and the per-session `store` field on `DocumentSession` is unused.
/// This duplication is intentional and scoped: it lets us wire the
/// [`Sessions`] registry into the application boundary now without forcing
/// a 75-callsite mechanical refactor in a single commit.
#[derive(Clone)]
pub struct ServerState {
    /// High-level application state: legacy single-document `AppState` plus
    /// [`Sessions`] registry. Shared with MCP via `state.app.clone()`.
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
        let mut legacy = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        legacy.set_event_tx(tx);
        let app = App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY);

        // Register an in-memory default session so mutations in tests /
        // in-memory mode have a resolvable session id. The session's
        // initial document is a clone of the legacy document so the two
        // start consistent (the mutation handlers mirror legacy after each
        // apply to maintain that consistency).
        let default_doc = {
            let guard = app
                .legacy
                .document
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.0.clone()
        };
        let id = app.sessions.register_in_memory(default_doc);
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
        let document = Arc::new(Mutex::new(SendDocument(doc)));
        let mut legacy = AppState::new_with_document(document, workfile_path);
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        legacy.set_event_tx(tx);
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

    #[test]
    fn test_server_state_new_creates_empty_document() {
        let state = ServerState::new();
        let doc = state.app.document.lock().unwrap();
        assert_eq!(doc.metadata.name, "Untitled");
        assert_eq!(doc.pages.len(), 0);
        assert_eq!(doc.arena.len(), 0);
    }

    #[test]
    fn test_signal_dirty_without_persistence_is_noop() {
        let state = ServerState::new();
        // Should not panic — no persistence configured
        state.app.signal_dirty();
    }

    #[test]
    fn test_server_state_has_event_tx_configured() {
        let state = ServerState::new();
        assert!(
            state.app.event_tx().is_some(),
            "ServerState should configure the event broadcast channel"
        );
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
