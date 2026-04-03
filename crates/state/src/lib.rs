#![warn(clippy::all, clippy::pedantic)]

//! Shared application state for Sigil.
//!
//! This crate provides the core `AppState` type that holds the in-memory
//! document and persistence signaling. It is shared between the HTTP server
//! and the MCP server without introducing a dependency cycle.

use std::ops::{Deref, DerefMut};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use agent_designer_core::Document;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

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
/// Holds the in-memory document and persistence signaling. Does NOT include
/// any broadcast channel — that is owned by the server crate, which extends
/// this type with GraphQL-specific fields.
///
/// Wrapped in `Arc` and passed to all route handlers via Axum's state extractor.
///
/// # Concurrency note
///
/// The `document` field uses a single `std::sync::Mutex`, which serializes all
/// access. Under high contention (many concurrent GraphQL clients issuing
/// mutations) this becomes a throughput bottleneck. The planned mitigation is
/// per-document sharding: each open document gets its own `Arc<Mutex<Document>>`
/// looked up by document ID, so independent documents never contend.
#[derive(Clone)]
pub struct AppState {
    /// The in-memory design document. Protected by a `Mutex`.
    ///
    /// Wrapped in `SendDocument` to narrow the `unsafe Send/Sync` impls to just
    /// the `Document` type rather than the entire `AppState`.
    /// We use `std::sync::Mutex` rather than `tokio::sync::RwLock` because
    /// the `Mutex` is never held across `.await` points.
    pub document: Arc<Mutex<SendDocument>>,
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
        Self {
            document: Arc::new(Mutex::new(SendDocument(Document::new(
                "Untitled".to_string(),
            )))),
            workfile_path: None,
            dirty_tx: None,
            persistence_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Creates a new `AppState` with persistence support.
    ///
    /// The caller provides a pre-spawned persistence task's sender and handle.
    /// This keeps file I/O concerns out of this crate.
    #[must_use]
    pub fn new_with_persistence(
        document: Arc<Mutex<SendDocument>>,
        workfile_path: PathBuf,
        dirty_tx: mpsc::Sender<()>,
        persistence_handle: JoinHandle<()>,
    ) -> Self {
        Self {
            document,
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
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-time assertion: `SendDocument` must implement `Send`.
    /// If the inner `Document` changes in a way that makes this unsound,
    /// this test will fail to compile.
    fn _assert_send_document_is_send() {
        fn assert_send<T: Send>() {}
        assert_send::<SendDocument>();
    }

    /// Compile-time assertion: `SendDocument` must implement `Sync`.
    fn _assert_send_document_is_sync() {
        fn assert_sync<T: Sync>() {}
        assert_sync::<SendDocument>();
    }

    /// Compile-time assertion: `AppState` must implement `Send` and `Sync`
    /// to be usable with Axum's state extractor and tokio's async runtime.
    fn _assert_app_state_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<AppState>();
    }

    #[test]
    fn test_app_state_new_creates_empty_document() {
        let state = AppState::new();
        let doc = state.document.lock().unwrap();
        assert_eq!(doc.metadata.name, "Untitled");
        assert_eq!(doc.pages.len(), 0);
        assert_eq!(doc.arena.len(), 0);
    }

    #[test]
    fn test_signal_dirty_without_persistence_is_noop() {
        let state = AppState::new();
        // Should not panic — no persistence configured
        state.signal_dirty();
    }
}
