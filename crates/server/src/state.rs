// crates/server/src/state.rs

use std::ops::{Deref, DerefMut};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use agent_designer_core::Document;
use agent_designer_core::wire::BroadcastCommand;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

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
    /// Path to the loaded `.sigil/` workfile directory.
    /// `None` when running in-memory only (e.g. tests).
    pub workfile_path: Option<PathBuf>,
    /// Sender to signal the persistence task that the document has changed.
    /// `None` when persistence is not configured (in-memory mode).
    dirty_tx: Option<mpsc::Sender<()>>,
    /// Handle for the background persistence task, used for graceful shutdown.
    /// Wrapped in `Arc<Mutex<Option<...>>>` so `AppState` can derive `Clone`
    /// while only one caller can take the handle.
    /// `None` when persistence is not configured (in-memory mode).
    persistence_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl AppState {
    /// Creates a new `AppState` with an empty document and no persistence.
    ///
    /// Suitable for tests and in-memory-only operation.
    #[must_use]
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(BROADCAST_CHANNEL_CAPACITY);
        Self {
            document: Arc::new(Mutex::new(SendDocument(Document::new(
                "Untitled".to_string(),
            )))),
            broadcast_tx,
            next_client_id: Arc::new(AtomicU64::new(0)),
            workfile_path: None,
            dirty_tx: None,
            persistence_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Creates a new `AppState` backed by a workfile on disk.
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
        let (broadcast_tx, _) = broadcast::channel(BROADCAST_CHANNEL_CAPACITY);
        Self {
            document,
            broadcast_tx,
            next_client_id: Arc::new(AtomicU64::new(0)),
            workfile_path: Some(workfile_path),
            dirty_tx: Some(dirty_tx),
            persistence_handle: Arc::new(Mutex::new(Some(persistence_handle))),
        }
    }

    /// Creates an `AppState` with a pre-loaded document and workfile persistence.
    ///
    /// Used on startup when loading an existing workfile from disk.
    #[must_use]
    pub fn new_with_document_and_workfile(doc: Document, workfile_path: PathBuf) -> Self {
        let document = Arc::new(Mutex::new(SendDocument(doc)));
        let (dirty_tx, persistence_handle) = crate::persistence::spawn_persistence_task(
            Arc::clone(&document),
            workfile_path.clone(),
        );
        let (broadcast_tx, _) = broadcast::channel(BROADCAST_CHANNEL_CAPACITY);
        Self {
            document,
            broadcast_tx,
            next_client_id: Arc::new(AtomicU64::new(0)),
            workfile_path: Some(workfile_path),
            dirty_tx: Some(dirty_tx),
            persistence_handle: Arc::new(Mutex::new(Some(persistence_handle))),
        }
    }

    /// Signals the persistence task that the document has been modified.
    ///
    /// This is fire-and-forget: if the channel is full, a save is already
    /// pending. No-op if persistence is not configured (in-memory mode).
    pub fn signal_dirty(&self) {
        if let Some(ref tx) = self.dirty_tx {
            // Use try_send to avoid blocking. If the channel is full,
            // a save is already pending so the signal can be dropped.
            if tx.try_send(()).is_err() {
                tracing::trace!("dirty signal dropped — save already pending");
            }
        }
    }

    /// Takes the persistence `JoinHandle` out of this state, if present.
    ///
    /// Used during shutdown to await the persistence task after dropping
    /// the dirty sender. Only the first caller gets the handle; subsequent
    /// calls return `None`.
    #[must_use]
    pub fn take_persistence_handle(&self) -> Option<JoinHandle<()>> {
        self.persistence_handle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
    }

    /// Takes the dirty sender out of this state, if present.
    ///
    /// Dropping the returned sender signals the persistence task to perform
    /// a final save and shut down.
    pub fn take_dirty_tx(&mut self) -> Option<mpsc::Sender<()>> {
        self.dirty_tx.take()
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
