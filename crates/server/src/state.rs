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
}

impl ServerState {
    /// Creates a new `ServerState` with an empty document, no persistence,
    /// and an empty [`Sessions`] registry.
    ///
    /// Suitable for tests and in-memory-only operation.
    #[must_use]
    pub fn new() -> Self {
        let mut legacy = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        legacy.set_event_tx(tx);
        Self {
            app: App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY),
        }
    }

    /// Creates a `ServerState` backed by a workfile on disk.
    ///
    /// Spawns a background persistence task that debounces dirty signals and
    /// writes the document to `workfile_path` after a quiet period.
    #[must_use]
    pub fn new_with_workfile(workfile_path: PathBuf) -> Self {
        let document = Arc::new(Mutex::new(SendDocument(Document::new(
            "Untitled".to_string(),
        ))));
        let (dirty_tx, persistence_handle) = crate::persistence::spawn_persistence_task(
            Arc::clone(&document),
            workfile_path.clone(),
        );
        let mut legacy =
            AppState::new_with_persistence(document, workfile_path, dirty_tx, persistence_handle);
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        legacy.set_event_tx(tx);
        Self {
            app: App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY),
        }
    }

    /// Creates a `ServerState` with a pre-loaded document and workfile persistence.
    ///
    /// Used on startup when loading an existing workfile from disk.
    #[must_use]
    pub fn new_with_document_and_workfile(doc: Document, workfile_path: PathBuf) -> Self {
        Self::new_with_document_and_workfile_migrated(doc, workfile_path, None)
    }

    /// Creates a `ServerState` with a pre-loaded document, workfile persistence,
    /// and a migration flag.
    ///
    /// When `migrated_from` is `Some(v)`, the next save will populate
    /// [`workfile::PreparedSave::migrated_from`] so the writer can apply
    /// migration-specific behavior on the first save after load (RF-009).
    #[must_use]
    pub fn new_with_document_and_workfile_migrated(
        doc: Document,
        workfile_path: PathBuf,
        migrated_from: Option<u32>,
    ) -> Self {
        let document = Arc::new(Mutex::new(SendDocument(doc)));
        let migration_flag = Arc::new(Mutex::new(migrated_from));
        let (dirty_tx, persistence_handle) =
            crate::persistence::spawn_persistence_task_with_migration_flag(
                Arc::clone(&document),
                workfile_path.clone(),
                Arc::clone(&migration_flag),
            );
        let mut legacy =
            AppState::new_with_persistence(document, workfile_path, dirty_tx, persistence_handle);
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        legacy.set_event_tx(tx);
        Self {
            app: App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY),
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

    #[test]
    fn test_server_state_exposes_empty_sessions_registry() {
        let state = ServerState::new();
        assert!(state.app.sessions.is_empty());
        assert!(state.app.default_session_id().is_none());
    }
}
