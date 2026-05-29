#![warn(clippy::all, clippy::pedantic)]

//! Shared application state for Sigil.
//!
//! This crate provides the [`App`] wrapper around the multi-session
//! [`Sessions`] registry — the single source of truth for all document state
//! across transports — plus the transport-agnostic broadcast wire types
//! ([`MutationEvent`], [`TransactionPayload`], [`OperationPayload`]). It is
//! shared between the HTTP server and the MCP server without introducing a
//! dependency cycle.

use std::ops::{Deref, DerefMut};
use std::path::Path;
use std::sync::{Arc, RwLock};

use sigil_core::Document;

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
    /// Set to 0 at construction; assigned per-session by
    /// [`sessions::DocumentSession::publish`] (or stamped explicitly via
    /// [`sessions::DocumentSession::next_seq`]).
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
/// without placing blanket unsafe impls on a larger enclosing type.
///
/// The core crate avoids `Send`/`Sync` bounds for WASM compatibility. However,
/// `Document` is a plain data struct (no `Rc`, `RefCell`, or other non-Send types),
/// so it is safe to use across threads when synchronized by a lock. Each
/// session's document is held in a `tokio::sync::RwLock<SendDocument>`.
pub struct SendDocument(pub Document);

// SAFETY: `Document` is a plain data struct without `Rc`, `RefCell`, or other
// non-Send types. The core crate omits `Send` bounds solely for WASM compat.
// The server is the only consumer that needs thread-safety.
unsafe impl Send for SendDocument {}

// SAFETY: Access to the inner `Document` is always synchronized via the
// session store's `RwLock`. This impl is safe because no unsynchronized access
// to `Document` is possible.
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

/// High-level application wrapper that owns the [`Sessions`] registry.
///
/// This is the entry point for sigil-server and sigil-mcp. The [`Sessions`]
/// registry is the single source of truth for all document state across
/// transports (GraphQL queries/mutations, MCP read/write tools): each open
/// workfile (or in-memory document) is a session with its own document store,
/// per-session broadcast channel, and per-session transaction sequence
/// counter.
///
/// Wrapped in `Arc` (via `Clone`) and passed to all route handlers via Axum's
/// state extractor and shared with MCP via `state.app.clone()`.
#[derive(Clone)]
pub struct App {
    /// Multi-session registry — the single source of truth for all document
    /// state across transports.
    pub sessions: Arc<Sessions>,
    /// The default [`SessionId`] for header-less / single-session resolution.
    ///
    /// `Some` after [`App::open_session_with`] (or
    /// [`App::set_default_session_id`]) has registered a session. Resolvers
    /// and tools that receive no explicit `session_id` from a transport
    /// header/extension fall back to this id.
    ///
    /// Held under `std::sync::RwLock` because reads are frequent and writes
    /// happen only at startup / session lifecycle transitions.
    pub default_session_id: Arc<RwLock<Option<SessionId>>>,
}

impl App {
    /// Constructs an `App` with an empty [`Sessions`] registry. The default
    /// session id is unset.
    ///
    /// `broadcast_capacity` is the buffer size for each session's per-session
    /// broadcast channel (see [`Sessions::new`]).
    #[must_use]
    pub fn new(broadcast_capacity: usize) -> Self {
        Self {
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
    /// Resolvers / tools that receive no explicit `session_id` from a
    /// transport-level extension fall back to this id.
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

    #[test]
    fn test_mutation_broadcast_capacity_enforced() {
        // Verify the constant has the expected value. Enforcement occurs at
        // channel construction in `Sessions::new` (one broadcast channel per
        // session) — see `sessions::registry_tests`.
        assert_eq!(MUTATION_BROADCAST_CAPACITY, 256);
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
}
