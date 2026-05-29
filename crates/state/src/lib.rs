#![warn(clippy::all, clippy::pedantic)]

//! Shared application state for Sigil.
//!
//! This crate provides the core `AppState` type that holds the in-memory
//! document and persistence signaling. It is shared between the HTTP server
//! and the MCP server without introducing a dependency cycle.

use std::ops::{Deref, DerefMut};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use sigil_core::Document;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

pub mod sessions;

pub use sessions::{SessionId, Sessions, SessionsError};

/// Capacity of the broadcast channel for mutation events.
///
/// This determines the maximum number of unread events a subscriber can fall
/// behind before messages are dropped (lagged). The value must be large enough
/// to handle bursts of rapid mutations without losing events for active
/// subscribers.
pub const MUTATION_BROADCAST_CAPACITY: usize = 256;

/// A single field-level operation payload for broadcast.
///
/// This is the transport-agnostic representation that flows through
/// the broadcast channel. The server converts it to GraphQL types;
/// the MCP crate can use it directly.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct OperationPayload {
    /// Unique operation ID (UUID string).
    pub id: String,
    /// Target node UUID.
    pub node_uuid: String,
    /// Operation type: `set_field`, `create_node`, `delete_nodes`, `reparent`, `reorder`.
    pub op_type: String,
    /// Field path for `set_field` operations (e.g., "transform", "style.fills", "name").
    /// Empty for structural operations.
    pub path: String,
    /// New value as JSON. Full node data for `create_node`.
    pub value: Option<serde_json::Value>,
}

/// A complete transaction payload for broadcast.
///
/// Groups one or more operations into a single broadcast message.
/// Carries the user ID and server-assigned sequence number.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TransactionPayload {
    /// Unique transaction ID (UUID string).
    pub transaction_id: String,
    /// Session ID of the user who originated this transaction.
    pub user_id: String,
    /// Server-assigned monotonically increasing sequence number.
    /// Set to 0 at construction; assigned by [`AppState::publish_transaction`].
    pub seq: u64,
    /// Ordered list of operations in this transaction.
    pub operations: Vec<OperationPayload>,
}

/// Type-erased mutation event for broadcasting to connected clients.
///
/// This lives in the state crate so that both the server (GraphQL subscriptions)
/// and the MCP crate can publish events without depending on `async_graphql`.
/// The server converts these into its own `DocumentEvent` type for GraphQL.
#[derive(Clone, Debug)]
pub struct MutationEvent {
    /// The kind of mutation that occurred (legacy, kept for backwards compat).
    pub kind: MutationEventKind,
    /// UUID of the affected entity, if applicable (legacy).
    pub uuid: Option<String>,
    /// Additional structured data about the event (JSON-serialized, legacy).
    pub data: Option<serde_json::Value>,
    /// Typed operation payload (new). When present, subscribers should use this
    /// instead of the legacy fields.
    pub transaction: Option<TransactionPayload>,
}

/// Discriminator for mutation events.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MutationEventKind {
    /// A new node was inserted into the document.
    NodeCreated,
    /// An existing node's properties changed.
    NodeUpdated,
    /// A node was removed from the document.
    NodeDeleted,
    /// A new page was created.
    PageCreated,
    /// A page's properties were updated.
    PageUpdated,
    /// A page was deleted.
    PageDeleted,
    /// A new design token was created.
    TokenCreated,
    /// A design token was updated.
    TokenUpdated,
    /// A design token was deleted.
    TokenDeleted,
}

/// Newtype wrapper around `Document` that allows us to assert `Send` and `Sync`
/// without placing blanket unsafe impls on the entire `AppState`.
///
/// The core crate avoids `Send`/`Sync` bounds for WASM compatibility. However,
/// `Document` is a plain data struct (no `Rc`, `RefCell`, or other non-Send types),
/// so it is safe to use across threads when synchronized by a `Mutex`.
pub struct SendDocument(pub Document);

// SAFETY: `Document` is a plain data struct without `Rc`, `RefCell`, or other
// non-Send types. The core crate omits `Send` bounds solely for WASM compat.
// The server is the only consumer that needs thread-safety.
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
/// Holds the in-memory document, persistence signaling, and an optional
/// broadcast channel for mutation events. The broadcast channel allows both
/// the server (GraphQL subscriptions) and MCP tools to notify connected
/// clients of document changes without depending on `async_graphql`.
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
    /// Optional broadcast sender for mutation events.
    ///
    /// When set, `broadcast_internal` sends events to all subscribers (e.g. GraphQL
    /// subscription streams). `None` when broadcasting is not configured
    /// (e.g. in MCP-only or test scenarios without a server).
    event_tx: Option<broadcast::Sender<MutationEvent>>,
    /// Monotonically increasing sequence counter for operation ordering.
    /// Each transaction broadcast increments this counter.
    /// Starts at 1 (0 is reserved as "unconfirmed" on the client).
    seq_counter: Arc<AtomicU64>,
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
            event_tx: None,
            seq_counter: Arc::new(AtomicU64::new(1)),
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
            event_tx: None,
            seq_counter: Arc::new(AtomicU64::new(1)),
        }
    }

    /// Creates an `AppState` holding a pre-loaded document at `workfile_path`
    /// **without** a persistence task.
    ///
    /// Used by the server when per-session persistence (Spec 22a) owns writing
    /// the document to disk. The legacy `AppState` still mirrors the document
    /// (removed in 22c), but it is no longer a persistence source, so it carries
    /// no `dirty_tx` and no task handle. `signal_dirty()` is a no-op on instances
    /// built this way.
    #[must_use]
    pub fn new_with_document(document: Arc<Mutex<SendDocument>>, workfile_path: PathBuf) -> Self {
        Self {
            document,
            workfile_path: Some(workfile_path),
            dirty_tx: None,
            persistence_handle: Arc::new(Mutex::new(None)),
            event_tx: None,
            seq_counter: Arc::new(AtomicU64::new(1)),
        }
    }

    /// Sets the broadcast sender for mutation events.
    ///
    /// Called by the server crate after constructing the broadcast channel.
    /// This allows MCP tools (which only have access to `AppState`) to publish
    /// events that reach GraphQL subscribers.
    pub fn set_event_tx(&mut self, tx: broadcast::Sender<MutationEvent>) {
        self.event_tx = Some(tx);
    }

    /// Returns a reference to the event broadcast sender, if configured.
    ///
    /// Used by the server crate to subscribe to mutation events (e.g. for
    /// GraphQL subscriptions).
    #[must_use]
    pub fn event_tx(&self) -> Option<&broadcast::Sender<MutationEvent>> {
        self.event_tx.as_ref()
    }

    /// Internal implementation method that broadcasts a mutation event to all subscribers.
    ///
    /// This is used by `publish_transaction`. External callers should use
    /// `publish_transaction` instead.
    ///
    /// If no broadcast channel is configured (in-memory-only mode) or no
    /// subscribers are listening, this is a no-op. Similar fire-and-forget
    /// semantics to `signal_dirty`.
    fn broadcast_internal(&self, event: MutationEvent) {
        if let Some(ref tx) = self.event_tx
            && tx.send(event).is_err()
        {
            tracing::debug!("no mutation event listeners");
        }
    }

    /// Returns the next sequence number, incrementing the counter atomically.
    ///
    /// Sequence numbers start at 1 (0 is reserved as "unconfirmed" on the client).
    #[must_use]
    pub fn next_seq(&self) -> u64 {
        self.seq_counter.fetch_add(1, Ordering::AcqRel)
    }

    /// Publishes a transaction as a mutation event with the operation payload.
    ///
    /// Assigns the next sequence number, wraps the transaction in a `MutationEvent`
    /// with the appropriate legacy kind, and broadcasts to all subscribers.
    pub fn publish_transaction(
        &self,
        kind: MutationEventKind,
        uuid: Option<String>,
        mut transaction: TransactionPayload,
    ) {
        transaction.seq = self.next_seq();
        self.broadcast_internal(MutationEvent {
            kind,
            uuid,
            data: None,
            transaction: Some(transaction),
        });
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

/// High-level application wrapper that owns the [`Sessions`] registry and the
/// legacy single-document [`AppState`].
///
/// This is the new entry point for sigil-server and sigil-mcp. Existing
/// callsites continue to reach the legacy single-document store via
/// [`App::legacy`] (or the `Deref` impl that exposes the same fields), while
/// new code can route mutations through [`App::sessions`] —
/// `App::sessions.with_session(session_id, ...)` — for per-workfile isolation
/// and panic safety (see `sessions::Sessions::with_session`).
///
/// During the Spec-20 migration the two halves coexist:
///
/// - The legacy [`AppState`] holds the authoritative document for the
///   single-session deployment. Existing GraphQL resolvers and MCP tools
///   continue to mutate it directly while their handlers are migrated in
///   later sub-tasks (Tasks 5–10) to route through `Sessions`.
/// - The [`Sessions`] registry tracks open workfile paths and per-session
///   broadcast channels. The CLI startup path (Task 4) registers the
///   `--workfile` directory as the **default session** via
///   [`App::open_session_with`], which stores the resulting [`SessionId`] in
///   [`App::default_session_id`]. Future tasks plumb that id through GraphQL
///   extensions and MCP context.
///
/// The wrapper does **not** synchronize the document between the legacy store
/// and per-session stores — that unification happens when handlers are
/// migrated. Until then the legacy `AppState.document` is the source of
/// truth and the session's `store` is unused.
#[derive(Clone)]
pub struct App {
    /// Legacy single-document state. Existing GraphQL/MCP callsites reach the
    /// document via `app.document.lock()` (or through helpers like
    /// `acquire_document_lock`). New code should prefer routing through
    /// [`App::sessions`] instead.
    pub legacy: AppState,
    /// Multi-session registry. Even in single-document mode the
    /// `--workfile` path is registered here so per-session broadcast channels
    /// and panic isolation are available to migrated handlers.
    pub sessions: Arc<Sessions>,
    /// The default [`SessionId`] for the single-document deployment mode.
    ///
    /// `Some` after [`App::open_session_with`] has registered a workfile.
    /// Resolvers that have not yet been migrated to receive `session_id`
    /// from a transport header/extension can read this value as a
    /// fallback. Future tasks (5–10) replace fallback reads with explicit
    /// per-request session ids.
    ///
    /// Held under `std::sync::RwLock` because reads are frequent and writes
    /// happen only at startup / session lifecycle transitions.
    pub default_session_id: Arc<RwLock<Option<SessionId>>>,
}

impl App {
    /// Constructs an `App` with an empty legacy [`AppState`] and an empty
    /// [`Sessions`] registry. The default session id is unset.
    ///
    /// `broadcast_capacity` is the buffer size for each session's per-session
    /// broadcast channel (see [`Sessions::new`]). The legacy event broadcast
    /// channel on [`AppState`] is configured separately via
    /// [`AppState::set_event_tx`].
    #[must_use]
    pub fn new(broadcast_capacity: usize) -> Self {
        Self {
            legacy: AppState::new(),
            sessions: Arc::new(Sessions::new(broadcast_capacity)),
            default_session_id: Arc::new(RwLock::new(None)),
        }
    }

    /// Wraps a pre-built [`AppState`] in a new `App`. Used by the server
    /// crate when constructing a workfile-backed deployment whose
    /// persistence task already wires up `dirty_tx`/`persistence_handle`.
    #[must_use]
    pub fn from_legacy(legacy: AppState, broadcast_capacity: usize) -> Self {
        Self {
            legacy,
            sessions: Arc::new(Sessions::new(broadcast_capacity)),
            default_session_id: Arc::new(RwLock::new(None)),
        }
    }

    /// Opens a session for `path` via the embedded [`Sessions`] registry and
    /// records its id in [`App::default_session_id`].
    ///
    /// The `loader` closure performs the actual document load — sigil-state
    /// has no workfile I/O of its own. The server crate plugs in a
    /// synchronous bridge to its async `load_workfile` (see
    /// `sigil_server::workfile::load_workfile_sync`).
    ///
    /// Idempotent for the same canonical path: if a session already exists
    /// for `path`, returns its existing [`SessionId`] and updates the default
    /// session id to point at it.
    ///
    /// # Errors
    ///
    /// Propagates [`SessionsError`] from [`Sessions::open`].
    pub fn open_session_with<F, E>(
        &self,
        path: &Path,
        loader: F,
    ) -> Result<SessionId, SessionsError>
    where
        F: FnOnce(&Path) -> Result<Document, E>,
        E: std::fmt::Display,
    {
        let id = self.sessions.open(path, loader)?;
        let mut guard = self
            .default_session_id
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard = Some(id);
        Ok(id)
    }

    /// Returns the default [`SessionId`], if one has been registered.
    ///
    /// Resolvers / tools that have not yet been migrated to receive
    /// `session_id` from a transport-level extension fall back to this id.
    #[must_use]
    pub fn default_session_id(&self) -> Option<SessionId> {
        let guard = self
            .default_session_id
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard
    }

    /// Sets the default session id explicitly. Used by tests and by callers
    /// that construct a `Sessions` entry outside [`App::open_session_with`].
    pub fn set_default_session_id(&self, id: Option<SessionId>) {
        let mut guard = self
            .default_session_id
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard = id;
    }

    /// Close every synthetic in-memory session (those whose canonical path is
    /// the `memory://` scheme used by [`Sessions::register_in_memory`]).
    ///
    /// RF-007: at server startup we register a synthetic session so that
    /// header-less requests have something to route to. Once a real workfile
    /// session is opened, the synthetic one becomes a confusing extra entry
    /// (it would make [`crate::Sessions::list`] return both, and break the
    /// "exactly one session" defaulting rule in MCP's `session_resolver`).
    /// This closes any synthetic sessions and returns how many were closed.
    #[must_use = "callers typically log the count or assert it in tests"]
    pub fn close_synthetic_sessions(&self) -> usize {
        let synthetic: Vec<SessionId> = self
            .sessions
            .list()
            .into_iter()
            .filter(|s| {
                s.workfile_path
                    .to_str()
                    .is_some_and(|p| p.starts_with("memory://"))
            })
            .map(|s| s.id)
            .collect();
        let count = synthetic.len();
        for id in synthetic {
            let _ = self.sessions.close(id);
        }
        count
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new(MUTATION_BROADCAST_CAPACITY)
    }
}

impl Deref for App {
    type Target = AppState;
    fn deref(&self) -> &AppState {
        &self.legacy
    }
}

impl DerefMut for App {
    fn deref_mut(&mut self) -> &mut AppState {
        &mut self.legacy
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
    fn test_new_with_document_holds_doc_and_path_without_persistence() {
        use std::path::PathBuf;
        let doc = Document::new("Loaded".to_string());
        let path = PathBuf::from("/tmp/example.sigil");
        let state =
            AppState::new_with_document(Arc::new(Mutex::new(SendDocument(doc))), path.clone());
        assert_eq!(state.workfile_path.as_deref(), Some(path.as_path()));
        assert_eq!(state.document.lock().unwrap().metadata.name, "Loaded");
        // No persistence task is configured: signal_dirty is a silent no-op.
        state.signal_dirty();
    }

    #[test]
    fn test_signal_dirty_without_persistence_is_noop() {
        let state = AppState::new();
        // Should not panic — no persistence configured
        state.signal_dirty();
    }

    #[test]
    fn test_broadcast_internal_without_channel_is_noop() {
        let state = AppState::new();
        // Should not panic — no event channel configured
        state.broadcast_internal(MutationEvent {
            kind: MutationEventKind::NodeCreated,
            uuid: Some("test".to_string()),
            data: None,
            transaction: None,
        });
    }

    #[test]
    fn test_broadcast_internal_delivers_to_subscriber() {
        let mut state = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        let mut rx = tx.subscribe();
        state.set_event_tx(tx);

        state.broadcast_internal(MutationEvent {
            kind: MutationEventKind::NodeCreated,
            uuid: Some("abc-123".to_string()),
            data: None,
            transaction: None,
        });

        let received = rx.try_recv().expect("should receive event");
        assert_eq!(received.kind, MutationEventKind::NodeCreated);
        assert_eq!(received.uuid.as_deref(), Some("abc-123"));
    }

    #[test]
    fn test_mutation_broadcast_capacity_enforced() {
        // Verify the constant has the expected value. Enforcement occurs at
        // channel construction in `ServerState` (and in tests above).
        assert_eq!(MUTATION_BROADCAST_CAPACITY, 256);
    }

    #[test]
    fn test_event_tx_returns_sender_when_configured() {
        let mut state = AppState::new();
        assert!(
            state.event_tx().is_none(),
            "event_tx should be None before configuration"
        );

        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        state.set_event_tx(tx);
        assert!(
            state.event_tx().is_some(),
            "event_tx should be Some after configuration"
        );
    }

    #[test]
    fn test_next_seq_starts_at_one() {
        let state = AppState::new();
        assert_eq!(state.next_seq(), 1, "first sequence number should be 1");
    }

    #[test]
    fn test_next_seq_monotonically_increases() {
        let state = AppState::new();
        let values: Vec<u64> = (0..10).map(|_| state.next_seq()).collect();
        let expected: Vec<u64> = (1..=10).collect();
        assert_eq!(values, expected, "sequence numbers should be 1..=10");
    }

    #[test]
    fn test_publish_transaction_assigns_seq() {
        let mut state = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        let mut rx = tx.subscribe();
        state.set_event_tx(tx);

        state.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some("node-abc".to_string()),
            TransactionPayload {
                transaction_id: "tx-1".to_string(),
                user_id: "user-1".to_string(),
                seq: 0,
                operations: vec![OperationPayload {
                    id: "op-1".to_string(),
                    node_uuid: "node-abc".to_string(),
                    op_type: "set_field".to_string(),
                    path: "transform".to_string(),
                    value: Some(serde_json::json!({"x": 10})),
                }],
            },
        );

        let received = rx.try_recv().expect("should receive event");
        let tx_payload = received.transaction.expect("event should have transaction");
        assert!(
            tx_payload.seq > 0,
            "seq should be assigned a positive value"
        );
        assert_eq!(tx_payload.seq, 1, "first transaction should get seq 1");
    }

    #[test]
    fn test_publish_transaction_preserves_legacy_kind() {
        let mut state = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        let mut rx = tx.subscribe();
        state.set_event_tx(tx);

        state.publish_transaction(
            MutationEventKind::NodeCreated,
            Some("node-xyz".to_string()),
            TransactionPayload {
                transaction_id: "tx-2".to_string(),
                user_id: "user-2".to_string(),
                seq: 0,
                operations: vec![],
            },
        );

        let received = rx.try_recv().expect("should receive event");
        assert_eq!(
            received.kind,
            MutationEventKind::NodeCreated,
            "legacy kind should be preserved"
        );
        assert_eq!(received.uuid.as_deref(), Some("node-xyz"));
        assert!(
            received.transaction.is_some(),
            "transaction should be present"
        );
    }

    #[test]
    fn test_mutation_event_without_transaction_is_backwards_compatible() {
        let mut state = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        let mut rx = tx.subscribe();
        state.set_event_tx(tx);

        // Legacy broadcast_internal without transaction
        state.broadcast_internal(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: None,
            data: Some(serde_json::json!({"action": "update"})),
            transaction: None,
        });

        let received = rx.try_recv().expect("should receive event");
        assert_eq!(received.kind, MutationEventKind::NodeUpdated);
        assert!(
            received.transaction.is_none(),
            "transaction should be None for legacy events"
        );
        assert!(received.data.is_some(), "legacy data should be preserved");
    }
}

#[cfg(test)]
mod app_wrapper_tests {
    use super::*;
    use std::convert::Infallible;
    use std::path::Path;
    use tempfile::TempDir;

    /// Stub loader for sessions tests. Mirrors `sessions::registry_tests`.
    #[allow(clippy::unnecessary_wraps)]
    fn stub_loader(_path: &Path) -> Result<Document, Infallible> {
        Ok(Document::new("app-test".to_string()))
    }

    fn make_workfile(tmp: &TempDir, name: &str) -> std::path::PathBuf {
        let path = tmp.path().join(format!("{name}.sigil"));
        std::fs::create_dir(&path).expect("create .sigil dir");
        path
    }

    /// Compile-time assertion: `App` must implement `Send` and `Sync` so it
    /// can be wrapped in Axum's state extractor and shared across MCP tasks.
    fn _assert_app_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<App>();
    }

    #[test]
    fn test_app_new_constructs_empty_sessions_registry() {
        let app = App::new(MUTATION_BROADCAST_CAPACITY);
        assert!(app.sessions.is_empty(), "no sessions before open");
        assert!(
            app.default_session_id().is_none(),
            "no default session before open"
        );
    }

    #[test]
    fn test_app_deref_exposes_legacy_appstate() {
        let app = App::new(MUTATION_BROADCAST_CAPACITY);
        // Reach AppState methods through Deref.
        let doc = app.document.lock().expect("document lock");
        assert_eq!(doc.metadata.name, "Untitled");
    }

    #[test]
    fn test_open_session_with_records_default_session_id() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "default");
        let app = App::new(MUTATION_BROADCAST_CAPACITY);

        let id = app
            .open_session_with(&path, stub_loader)
            .expect("open session");

        assert_eq!(app.default_session_id(), Some(id));
        assert_eq!(app.sessions.len(), 1);
        assert!(app.sessions.get(id).is_some());
    }

    #[test]
    fn test_open_session_with_is_idempotent_for_same_path() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "idemp");
        let app = App::new(MUTATION_BROADCAST_CAPACITY);

        let a = app.open_session_with(&path, stub_loader).expect("open a");
        let b = app.open_session_with(&path, stub_loader).expect("open b");
        assert_eq!(a, b, "reopening same path returns same SessionId");
        assert_eq!(app.sessions.len(), 1, "no duplicate session");
        assert_eq!(app.default_session_id(), Some(b));
    }

    #[test]
    fn test_open_session_with_surfaces_loader_failure() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "fails");
        let app = App::new(MUTATION_BROADCAST_CAPACITY);

        let result = app.open_session_with(&path, |_: &Path| -> Result<Document, String> {
            Err("synthetic loader failure".into())
        });
        assert!(matches!(result, Err(SessionsError::LoadFailed(_))));
        assert!(
            app.default_session_id().is_none(),
            "failed open must not set default session id"
        );
    }

    #[test]
    fn test_set_default_session_id_overrides_value() {
        let app = App::new(MUTATION_BROADCAST_CAPACITY);
        let id = SessionId::new();
        app.set_default_session_id(Some(id));
        assert_eq!(app.default_session_id(), Some(id));
        app.set_default_session_id(None);
        assert!(app.default_session_id().is_none());
    }

    #[test]
    fn test_app_from_legacy_preserves_existing_appstate() {
        let mut legacy = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        legacy.set_event_tx(tx);

        let app = App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY);
        assert!(
            app.legacy.event_tx().is_some(),
            "legacy event_tx must survive wrapping"
        );
        assert!(app.sessions.is_empty(), "fresh sessions registry");
    }
}
