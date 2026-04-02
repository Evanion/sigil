// crates/server/src/state.rs

use std::sync::{Arc, Mutex};

use agent_designer_core::Document;
use agent_designer_core::wire::BroadcastCommand;
use tokio::sync::broadcast;

/// Shared application state.
///
/// Wrapped in `Arc` and passed to all route handlers via Axum's state extractor.
#[derive(Clone)]
pub struct AppState {
    /// The in-memory design document. Protected by a `Mutex`.
    ///
    /// We use `std::sync::Mutex` rather than `tokio::sync::RwLock` because `Document`
    /// contains `Box<dyn Command>` (without `Send` bounds) for WASM compatibility.
    /// All concrete `Command` implementations are plain data structs and are safe to
    /// share across threads. The `Mutex` is never held across `.await` points, so
    /// blocking is not a concern.
    pub document: Arc<Mutex<Document>>,
    /// Broadcast channel for sending commands to all connected WebSocket clients.
    pub broadcast_tx: broadcast::Sender<BroadcastCommand>,
}

// SAFETY: `Document` contains `Box<dyn Command>` which lacks `Send` bounds for WASM
// compatibility. However, all concrete `Command` implementations in the core crate are
// plain data structs (no `Rc`, `RefCell`, or other non-Send types). The server is the
// only consumer that needs thread-safety, and it wraps `Document` in a `Mutex` that is
// never held across `.await` points.
unsafe impl Send for AppState {}
// SAFETY: Access to the `Document` is synchronized via `Mutex`. The `broadcast::Sender`
// is already `Sync`. This impl is safe because all shared access goes through the lock.
unsafe impl Sync for AppState {}

impl AppState {
    /// Creates a new `AppState` with an empty document.
    #[must_use]
    #[allow(clippy::arc_with_non_send_sync)]
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(256);
        Self {
            document: Arc::new(Mutex::new(Document::new("Untitled".to_string()))),
            broadcast_tx,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
