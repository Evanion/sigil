// crates/server/src/state.rs

use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use agent_designer_core::Document;
use agent_designer_core::wire::BroadcastCommand;
use tokio::sync::broadcast;

/// Maximum WebSocket message size in bytes (1 MiB).
pub const MAX_WS_MESSAGE_SIZE: usize = 1_048_576;

/// Capacity of the broadcast channel for WebSocket command fan-out.
pub const BROADCAST_CHANNEL_CAPACITY: usize = 256;

/// Payload carried inside a [`BroadcastEnvelope`].
#[derive(Clone, Debug)]
pub enum BroadcastPayload {
    /// A design command that other clients should apply.
    Command(Box<BroadcastCommand>),
    /// The document state changed (e.g. via undo/redo) and other clients
    /// should re-fetch or update their undo/redo UI state.
    DocumentChanged { can_undo: bool, can_redo: bool },
}

/// Wraps a [`BroadcastPayload`] with the sender's client ID so that
/// receiving clients can skip messages they originated.
#[derive(Clone, Debug)]
pub struct BroadcastEnvelope {
    /// The client that produced this broadcast.
    pub sender_id: u64,
    /// The broadcast payload.
    pub payload: BroadcastPayload,
}

/// Newtype wrapper around `Document` that allows us to assert `Send` and `Sync`
/// without placing blanket unsafe impls on the entire `AppState`.
///
/// `Document` contains `Box<dyn Command>` which lacks `Send` bounds for WASM
/// compatibility. However, all concrete `Command` implementations in the core
/// crate are plain data structs (no `Rc`, `RefCell`, or other non-Send types).
pub struct SendDocument(pub Document);

// SAFETY: All concrete `Command` implementations stored inside the `Document`
// history are plain data structs without `Rc`, `RefCell`, or other non-Send types.
// The `Box<dyn Command>` trait object only lacks `Send` bounds to keep the core
// crate WASM-compatible. The server is the only consumer that needs thread-safety.
unsafe impl Send for SendDocument {}

// SAFETY: Access to the inner `Document` is always synchronized via `Mutex`.
// This impl is safe because no unsynchronized access to `Document` is possible.
unsafe impl Sync for SendDocument {}

impl Deref for SendDocument {
    type Target = Document;
    fn deref(&self) -> &Document {
        &self.0
    }
}

impl DerefMut for SendDocument {
    fn deref_mut(&mut self) -> &mut Document {
        &mut self.0
    }
}

/// Shared application state.
///
/// Wrapped in `Arc` and passed to all route handlers via Axum's state extractor.
///
/// # Concurrency note
///
/// The `document` field uses a single `std::sync::Mutex`, which serializes all
/// access. Under high contention (many concurrent WebSocket clients issuing
/// commands) this becomes a throughput bottleneck. The planned mitigation is
/// per-document sharding: each open document gets its own `Arc<Mutex<Document>>`
/// looked up by document ID, so independent documents never contend. For a
/// single document with many writers, an actor/channel model can replace the
/// mutex entirely in a future iteration.
#[derive(Clone)]
pub struct AppState {
    /// The in-memory design document. Protected by a `Mutex`.
    ///
    /// Wrapped in `SendDocument` to narrow the `unsafe Send/Sync` impls to just
    /// the `Document` type rather than the entire `AppState`.
    /// We use `std::sync::Mutex` rather than `tokio::sync::RwLock` because
    /// the `Mutex` is never held across `.await` points.
    pub document: Arc<Mutex<SendDocument>>,
    /// Broadcast channel for sending envelopes (command + sender ID) to all
    /// connected WebSocket clients.
    pub broadcast_tx: broadcast::Sender<BroadcastEnvelope>,
    /// Monotonically increasing client ID counter.
    next_client_id: Arc<AtomicU64>,
}

impl AppState {
    /// Creates a new `AppState` with an empty document.
    #[must_use]
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(BROADCAST_CHANNEL_CAPACITY);
        Self {
            document: Arc::new(Mutex::new(SendDocument(Document::new(
                "Untitled".to_string(),
            )))),
            broadcast_tx,
            next_client_id: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Allocates a unique client ID for a new WebSocket connection.
    #[must_use]
    pub fn next_client_id(&self) -> u64 {
        self.next_client_id.fetch_add(1, Ordering::Relaxed)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
