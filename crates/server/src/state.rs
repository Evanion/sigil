// crates/server/src/state.rs

//! Server-specific application state.
//!
//! Re-exports the core `AppState` and `SendDocument` from the `state` crate
//! and provides convenience constructors that wire up persistence and the
//! GraphQL broadcast channel.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use agent_designer_core::Document;
use tokio::sync::broadcast;

// Re-export the core state types so existing code can use `crate::state::AppState`.
pub use agent_designer_state::{AppState, SendDocument};

use crate::graphql::types::DocumentEvent;

/// Capacity of the broadcast channel for GraphQL subscription events.
pub const GRAPHQL_BROADCAST_CAPACITY: usize = 256;

/// Server-level state that pairs the shared `AppState` with a GraphQL
/// broadcast channel.
///
/// This is what gets stored in Axum's state extractor and passed to
/// GraphQL schema data. The MCP crate only needs `AppState` (no broadcast).
#[derive(Clone)]
pub struct ServerState {
    /// Core application state (document + persistence), shared with MCP.
    pub app: AppState,
    /// Broadcast channel for GraphQL subscription events.
    ///
    /// Mutations publish [`DocumentEvent`] values here; the `documentChanged`
    /// subscription stream reads from a receiver obtained via `.subscribe()`.
    pub graphql_tx: broadcast::Sender<DocumentEvent>,
}

impl ServerState {
    /// Creates a new `ServerState` with an empty document and no persistence.
    ///
    /// Suitable for tests and in-memory-only operation.
    #[must_use]
    pub fn new() -> Self {
        let (graphql_tx, _) = broadcast::channel(GRAPHQL_BROADCAST_CAPACITY);
        Self {
            app: AppState::new(),
            graphql_tx,
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
        let (graphql_tx, _) = broadcast::channel(GRAPHQL_BROADCAST_CAPACITY);
        Self {
            app: AppState::new_with_persistence(
                document,
                workfile_path,
                dirty_tx,
                persistence_handle,
            ),
            graphql_tx,
        }
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
        let (graphql_tx, _) = broadcast::channel(GRAPHQL_BROADCAST_CAPACITY);
        Self {
            app: AppState::new_with_persistence(
                document,
                workfile_path,
                dirty_tx,
                persistence_handle,
            ),
            graphql_tx,
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
    fn test_graphql_broadcast_capacity_enforced() {
        // Verify the constant has the expected value. Enforcement occurs at
        // `ServerState` construction where the channel is created with this
        // capacity.
        assert_eq!(GRAPHQL_BROADCAST_CAPACITY, 256);
    }

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
}
