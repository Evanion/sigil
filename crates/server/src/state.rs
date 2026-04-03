// crates/server/src/state.rs

//! Server-specific application state.
//!
//! Re-exports the core `AppState` and `SendDocument` from the `state` crate
//! and provides convenience constructors that wire up persistence and the
//! mutation event broadcast channel.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use agent_designer_core::Document;
use tokio::sync::broadcast;

// Re-export the core state types so existing code can use `crate::state::AppState`.
pub use agent_designer_state::{
    AppState, MUTATION_BROADCAST_CAPACITY, MutationEvent, MutationEventKind, SendDocument,
};

/// Server-level state that wraps the shared `AppState`.
///
/// This is what gets stored in Axum's state extractor and passed to
/// GraphQL schema data. The MCP crate only needs `AppState` (no server-specific
/// fields). The mutation event broadcast channel lives inside `AppState` so
/// that both MCP tools and GraphQL mutations can publish events through the
/// same path.
#[derive(Clone)]
pub struct ServerState {
    /// Core application state (document + persistence + event broadcast),
    /// shared with MCP.
    pub app: AppState,
}

impl ServerState {
    /// Creates a new `ServerState` with an empty document and no persistence.
    ///
    /// Suitable for tests and in-memory-only operation.
    #[must_use]
    pub fn new() -> Self {
        let mut app = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        app.set_event_tx(tx);
        Self { app }
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
        let mut app =
            AppState::new_with_persistence(document, workfile_path, dirty_tx, persistence_handle);
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        app.set_event_tx(tx);
        Self { app }
    }

    /// Creates a `ServerState` with a pre-loaded document and workfile persistence.
    ///
    /// Used on startup when loading an existing workfile from disk.
    #[must_use]
    pub fn new_with_document_and_workfile(doc: Document, workfile_path: PathBuf) -> Self {
        let document = Arc::new(Mutex::new(SendDocument(doc)));
        let (dirty_tx, persistence_handle) = crate::persistence::spawn_persistence_task(
            Arc::clone(&document),
            workfile_path.clone(),
        );
        let mut app =
            AppState::new_with_persistence(document, workfile_path, dirty_tx, persistence_handle);
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        app.set_event_tx(tx);
        Self { app }
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
}
