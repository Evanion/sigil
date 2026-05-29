//! Multi-session registry types for sigil-state.
//!
//! Sessions are keyed by canonical workfile path. Each session owns its own
//! `Document` and broadcast channel. Mutations route through `with_session`,
//! which provides panic isolation via `std::panic::catch_unwind`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use sigil_core::Document;
use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

use crate::{MutationEvent, MutationEventKind, SendDocument, TransactionPayload};

/// Opaque session identifier. Wraps `UUIDv4`. Not persisted; safe to expose
/// to clients (frontend, MCP agents).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub Uuid);

impl SessionId {
    /// Generates a new random `SessionId` backed by `UUIDv4`.
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl std::str::FromStr for SessionId {
    type Err = uuid::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

/// Lifecycle state of a session. Mutations are rejected when state ==
/// [`SessionState::Errored`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    /// Session is healthy and accepts mutations.
    Live,
    /// Session encountered an unrecoverable error (e.g. apply-loop panic) and
    /// rejects further mutations until explicitly recovered or closed.
    Errored,
}

/// Lightweight metadata about a session, safe to serialize across the wire.
///
/// Used by Tauri commands, GraphQL queries, and MCP tools to expose session
/// state to clients without leaking the underlying `DocumentStore`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    /// Opaque session identifier.
    pub id: SessionId,
    /// Canonical absolute path to the `.sigil/` workfile directory.
    pub workfile_path: PathBuf,
    /// Human-readable title (defaults to workfile directory name).
    pub title: String,
    /// ISO-8601 timestamp captured when the session was opened.
    ///
    /// Stored as a string so this module remains free of clock dependencies
    /// (the caller in `sigil-server` is responsible for sourcing the time).
    pub opened_at: String,
    /// Current lifecycle state.
    pub state: SessionState,
}

/// Broadcast event type carried over per-session channels.
///
/// `DocumentEvent` wraps the existing transport-agnostic [`MutationEvent`].
/// `SessionFatal` is emitted by [`Sessions::with_session`] when the session
/// closure panics and the session transitions to [`SessionState::Errored`].
#[derive(Clone, Debug)]
pub enum SessionEvent {
    /// A document mutation occurred. Subscribers translate this into their
    /// transport-specific shape (GraphQL `DocumentEvent`, MCP notification, etc.).
    DocumentEvent(MutationEvent),
    /// The session encountered an unrecoverable panic and is now `Errored`.
    /// Clients receiving this should prompt the user to reload the workfile.
    SessionFatal {
        /// Human-readable reason extracted from the panic payload.
        reason: String,
    },
}

/// One open workfile session. Owned by [`Sessions`] inside an `Arc`.
///
/// Each session has its own document, broadcast channel, and lifecycle state.
/// Mutations are gated through [`Sessions::with_session`] which provides panic
/// isolation: a panic inside the closure marks this session `Errored` without
/// affecting other sessions in the registry.
pub struct DocumentSession {
    /// Opaque session identifier.
    pub id: SessionId,
    /// Canonical absolute path to the `.sigil/` workfile directory.
    pub workfile_path: PathBuf,
    /// Per-session document state. Wrapped in [`SendDocument`] so the
    /// `unsafe Send/Sync` impls are narrowly scoped to the `Document` type.
    pub store: RwLock<SendDocument>,
    /// Per-session broadcast channel. Subscribers receive [`SessionEvent`]s
    /// for mutations originating in this session.
    pub broadcast: broadcast::Sender<SessionEvent>,
    /// Lifecycle state. Held under a `std::sync::Mutex` because state checks
    /// are short and never cross `.await` points.
    pub state: std::sync::Mutex<SessionState>,
    /// Per-session monotonic sequence counter for transaction ordering.
    /// Starts at 1 (0 is reserved as "unconfirmed" on the client). Ordering is
    /// only meaningful within a single session — the frontend orders/dedups
    /// within one session's broadcast stream.
    pub seq_counter: AtomicU64,
}

impl DocumentSession {
    /// Build a [`SessionInfo`] snapshot for this session.
    ///
    /// The caller supplies `title` and `opened_at` because sigil-state has no
    /// clock or filename-derivation dependency — both belong to the server.
    #[must_use]
    pub fn info(&self, title: String, opened_at: String) -> SessionInfo {
        let state = match self.state.lock() {
            Ok(guard) => *guard,
            Err(poison) => *poison.into_inner(),
        };
        SessionInfo {
            id: self.id,
            workfile_path: self.workfile_path.clone(),
            title,
            opened_at,
            state,
        }
    }

    /// Returns the next sequence number, incrementing the counter atomically.
    /// Sequence numbers start at 1 (0 is reserved as "unconfirmed" on the client).
    #[must_use]
    pub fn next_seq(&self) -> u64 {
        self.seq_counter.fetch_add(1, Ordering::AcqRel)
    }

    /// Stamp `transaction.seq` with the next per-session sequence number, wrap
    /// it in a [`MutationEvent`], and broadcast it on this session's channel as
    /// a [`SessionEvent::DocumentEvent`].
    ///
    /// Fire-and-forget: no subscribers is not an error.
    pub fn publish(
        &self,
        kind: MutationEventKind,
        uuid: Option<String>,
        mut transaction: TransactionPayload,
    ) {
        transaction.seq = self.next_seq();
        let event = MutationEvent {
            kind,
            uuid,
            data: None,
            transaction: Some(transaction),
        };
        let _ = self.broadcast.send(SessionEvent::DocumentEvent(event));
    }
}

/// Maximum number of sessions a single server can hold concurrently.
///
/// RF-006: prevents an abusive caller (runaway agent, hostile MCP script)
/// from looping `openSession` calls until OOM. 256 is well above any
/// realistic per-user desktop workload (Spec 21's planned multi-workfile
/// UI tops out at single-digit windows) and well below the ulimit on file
/// descriptors most operating systems impose. Tune if dogfooding shows the
/// ceiling is wrong; right now there is no real workload pressing the limit.
pub const MAX_SESSIONS: usize = 256;

/// Registry of open document sessions.
///
/// Sessions are deduplicated by canonical workfile path: opening the same
/// `.sigil/` directory twice returns the same `SessionId`. Mutations are
/// gated through [`Sessions::with_session`] for panic isolation.
pub struct Sessions {
    /// Primary index: id → session.
    by_id: std::sync::RwLock<HashMap<SessionId, Arc<DocumentSession>>>,
    /// Secondary index: canonical path → id (for dedup on open).
    by_path: std::sync::RwLock<HashMap<PathBuf, SessionId>>,
    /// Capacity for each per-session broadcast channel.
    broadcast_capacity: usize,
}

impl Sessions {
    /// Construct an empty registry. `broadcast_capacity` is the buffer size
    /// for each session's broadcast channel.
    #[must_use]
    pub fn new(broadcast_capacity: usize) -> Self {
        Self {
            by_id: std::sync::RwLock::new(HashMap::new()),
            by_path: std::sync::RwLock::new(HashMap::new()),
            broadcast_capacity,
        }
    }

    /// Open a session for the given workfile path.
    ///
    /// The caller supplies `loader`, a closure that reads the document from
    /// disk. This keeps sigil-state free of document persistence I/O — the
    /// server crate plugs in [`sigil_server::workfile::load_workfile`] (or
    /// equivalent) at the call site.
    ///
    /// `canonicalize` is invoked here even though the crate ban applies to
    /// document persistence; canonicalization is path resolution, not
    /// persistence, and is required to make path-keyed dedup correct in the
    /// presence of relative paths, symlinks, and `..` components.
    ///
    /// If a session already exists for the canonical path, returns its
    /// existing [`SessionId`] without invoking the loader (idempotent open).
    ///
    /// # Errors
    ///
    /// - [`SessionsError::PathError`] if `canonicalize` fails (e.g. path does
    ///   not exist).
    /// - [`SessionsError::InvalidWorkfilePath`] if the path is not a directory
    ///   or does not end in `.sigil`.
    /// - [`SessionsError::LoadFailed`] if `loader` returns an error.
    pub fn open<F, E>(&self, path: &Path, loader: F) -> Result<SessionId, SessionsError>
    where
        F: FnOnce(&Path) -> Result<Document, E>,
        E: std::fmt::Display,
    {
        // Path resolution (NOT document persistence — sigil-state's I/O ban
        // is about workfile loading/saving, which the caller-supplied loader
        // owns).
        let canonical = std::fs::canonicalize(path).map_err(|e| {
            SessionsError::PathError(format!("canonicalize {}: {e}", path.display()))
        })?;

        if !canonical.is_dir() {
            return Err(SessionsError::InvalidWorkfilePath(
                "workfile must be a directory".into(),
            ));
        }
        if canonical.extension().and_then(|s| s.to_str()) != Some("sigil") {
            return Err(SessionsError::InvalidWorkfilePath(
                "workfile path must end in .sigil".into(),
            ));
        }

        // Fast path dedup BEFORE the (potentially expensive) load. The
        // authoritative re-check happens below under the write lock.
        {
            let by_path = self
                .by_path
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(existing) = by_path.get(&canonical) {
                return Ok(*existing);
            }
        }

        // Invoke the caller-supplied loader. Errors map to LoadFailed.
        let document = loader(&canonical)
            .map_err(|e| SessionsError::LoadFailed(format!("load {}: {e}", canonical.display())))?;

        // Insertion: hold both write locks for the registry transition. This
        // closes the TOCTOU window between the fast-path dedup above and the
        // insertion — a concurrent opener may have raced us during the load,
        // so we re-check `by_path` under the write lock and drop our freshly
        // loaded document if the race lost.
        let mut by_id = self
            .by_id
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut by_path = self
            .by_path
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        if let Some(existing) = by_path.get(&canonical) {
            return Ok(*existing);
        }

        // RF-006: enforce MAX_SESSIONS before inserting. Bound prevents OOM
        // from a runaway openSession loop.
        if by_id.len() >= MAX_SESSIONS {
            return Err(SessionsError::TooManySessions {
                open: by_id.len(),
                max: MAX_SESSIONS,
            });
        }

        let id = SessionId::new();
        let (tx, _rx) = broadcast::channel(self.broadcast_capacity);
        let session = Arc::new(DocumentSession {
            id,
            workfile_path: canonical.clone(),
            store: RwLock::new(SendDocument(document)),
            broadcast: tx,
            state: std::sync::Mutex::new(SessionState::Live),
            seq_counter: AtomicU64::new(1),
        });

        by_id.insert(id, session);
        by_path.insert(canonical, id);
        Ok(id)
    }

    /// Register an in-memory session that is NOT backed by a workfile on disk.
    ///
    /// Used by tests and by single-document deployments started without a
    /// `--workfile` argument. The session is keyed by a synthetic
    /// `memory://<uuid>` path so it cannot collide with disk-backed sessions
    /// opened via [`Sessions::open`].
    ///
    /// Unlike [`Sessions::open`], this does not perform any I/O — there is no
    /// filesystem path to canonicalize and no loader to run. The caller
    /// supplies the initial document directly.
    ///
    /// Returns the new [`SessionId`]. The session starts in
    /// [`SessionState::Live`].
    ///
    /// # `MAX_SESSIONS` exemption (RF-004)
    ///
    /// This method intentionally does NOT enforce the [`MAX_SESSIONS`] cap, and
    /// is infallible by design. It is the controlled single startup/synthetic-
    /// session path: the server registers exactly one in-memory default session
    /// at boot, and tests register a small fixed number. There is no untrusted
    /// or unbounded caller. The cap is enforced at the public multi-session
    /// entry point, [`Sessions::open`], which IS fallible and rejects with
    /// [`SessionsError::TooManySessions`] once `by_id.len() >= MAX_SESSIONS`.
    ///
    /// Any future caller that registers in-memory sessions in bulk (or in
    /// response to external input) MUST route through the fallible
    /// [`Sessions::open`] instead, so the cap is enforced at that insertion
    /// point.
    #[must_use]
    pub fn register_in_memory(&self, document: Document) -> SessionId {
        let id = SessionId::new();
        // Synthetic path: `memory://<session-id>`. Cannot match any
        // disk-backed path because `memory:` is not a valid filesystem
        // component on the platforms we target.
        let synthetic_path = PathBuf::from(format!("memory://{id}"));
        let (tx, _rx) = broadcast::channel(self.broadcast_capacity);
        let session = Arc::new(DocumentSession {
            id,
            workfile_path: synthetic_path.clone(),
            store: RwLock::new(SendDocument(document)),
            broadcast: tx,
            state: std::sync::Mutex::new(SessionState::Live),
            seq_counter: AtomicU64::new(1),
        });

        let mut by_id = self
            .by_id
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut by_path = self
            .by_path
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        by_id.insert(id, session);
        by_path.insert(synthetic_path, id);
        id
    }

    /// Close a session and remove from both indexes atomically.
    ///
    /// # Errors
    ///
    /// Returns [`SessionsError::SessionNotFound`] if `id` is not registered.
    pub fn close(&self, id: SessionId) -> Result<(), SessionsError> {
        let mut by_id = self
            .by_id
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut by_path = self
            .by_path
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        let session = by_id
            .remove(&id)
            .ok_or(SessionsError::SessionNotFound(id))?;
        by_path.remove(&session.workfile_path);
        Ok(())
    }

    /// List all open sessions.
    #[must_use]
    pub fn list(&self) -> Vec<Arc<DocumentSession>> {
        self.by_id
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .cloned()
            .collect()
    }

    /// Look up a session by id.
    #[must_use]
    pub fn get(&self, id: SessionId) -> Option<Arc<DocumentSession>> {
        self.by_id
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&id)
            .cloned()
    }

    /// Look up a session by canonical path. The caller is responsible for
    /// canonicalizing the input — this method does not perform I/O.
    #[must_use]
    pub fn get_by_path(&self, path: &Path) -> Option<Arc<DocumentSession>> {
        let by_path = self
            .by_path
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        by_path.get(path).and_then(|id| {
            self.by_id
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(id)
                .cloned()
        })
    }

    /// Number of sessions currently open.
    #[must_use]
    pub fn len(&self) -> usize {
        self.by_id
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
    }

    /// Whether the registry contains zero sessions.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Execute a closure with access to the named session.
    ///
    /// Returns `None` if the session does not exist.
    ///
    /// Returns `Some(Ok(value))` on normal completion.
    ///
    /// Returns `Some(Err(reason))` if the closure panicked OR the session was
    /// already in [`SessionState::Errored`]. When a panic is caught, the
    /// session transitions to `Errored` and a [`SessionEvent::SessionFatal`]
    /// is broadcast.
    ///
    /// # Panic isolation
    ///
    /// The closure is wrapped in [`std::panic::catch_unwind`] with
    /// [`std::panic::AssertUnwindSafe`]. The `AssertUnwindSafe` assertion is
    /// sound here because:
    /// 1. The only shared state is the `Arc<DocumentSession>`. After a panic
    ///    we immediately transition the session's state to `Errored` inside
    ///    this function, so any partially-mutated state is gated behind the
    ///    `Errored` rejection on subsequent calls.
    /// 2. The closure receives `&DocumentSession`, not `&mut`, so any interior
    ///    mutability is the caller's responsibility to make exception-safe.
    pub fn with_session<R>(
        &self,
        id: SessionId,
        f: impl FnOnce(&DocumentSession) -> R + std::panic::UnwindSafe,
    ) -> Option<Result<R, String>> {
        let session = self.get(id)?;

        // Scope the guard so it drops before catch_unwind runs.
        {
            let state = session
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if *state == SessionState::Errored {
                return Some(Err("session is in Errored state".into()));
            }
        }

        let session_arc = Arc::clone(&session);
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || f(&session_arc)));

        match result {
            Ok(value) => Some(Ok(value)),
            Err(panic_payload) => {
                let reason = panic_to_string(&*panic_payload);
                tracing::error!(session = %id, reason = %reason, "session panicked");

                {
                    let mut state = session
                        .state
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    *state = SessionState::Errored;
                }

                // Fire-and-forget broadcast: no subscribers is not an error.
                let _ = session.broadcast.send(SessionEvent::SessionFatal {
                    reason: reason.clone(),
                });

                Some(Err(format!("panic: {reason}")))
            }
        }
    }
}

/// Extract a printable string from a `catch_unwind` panic payload.
fn panic_to_string(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else if let Some(s) = payload.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else {
        "unknown panic payload".into()
    }
}

/// Errors returned by [`Sessions`] operations.
#[derive(Debug, thiserror::Error)]
pub enum SessionsError {
    /// No session with the given id is registered.
    #[error("session not found: {0}")]
    SessionNotFound(SessionId),
    /// The workfile path failed validation (wrong extension, not a directory).
    #[error("invalid workfile path: {0}")]
    InvalidWorkfilePath(String),
    /// The workfile path could not be resolved (e.g. canonicalize failed).
    #[error("workfile path error: {0}")]
    PathError(String),
    /// The caller-supplied loader returned an error.
    #[error("load failed: {0}")]
    LoadFailed(String),
    /// The session is marked `Errored` and rejects further mutations.
    #[error("session has been marked errored")]
    SessionErrored,
    /// Opening this session would exceed [`MAX_SESSIONS`].
    #[error("too many sessions open ({open} of max {max}); close one before opening another")]
    TooManySessions { open: usize, max: usize },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_id_new_is_unique() {
        let a = SessionId::new();
        let b = SessionId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn test_session_id_roundtrip_display_parse() {
        let id = SessionId::new();
        let s = id.to_string();
        let back: SessionId = s.parse().expect("display output must round-trip");
        assert_eq!(id, back);
    }

    #[test]
    fn test_session_id_parse_rejects_garbage() {
        let result: Result<SessionId, _> = "not-a-uuid".parse();
        assert!(result.is_err());
    }

    #[test]
    fn test_session_state_serialization() {
        let live = serde_json::to_string(&SessionState::Live).expect("serialize Live");
        let errored = serde_json::to_string(&SessionState::Errored).expect("serialize Errored");
        assert_eq!(live, "\"Live\"");
        assert_eq!(errored, "\"Errored\"");
    }
}

#[cfg(test)]
mod registry_tests {
    use super::*;
    use tempfile::TempDir;

    /// In-memory loader used by tests. The real loader lives in `sigil-server`
    /// (`workfile::load_workfile`) and is injected at the call site there.
    ///
    /// The `Result` wrapper is required by the [`Sessions::open`] loader
    /// signature; `Infallible` documents that this stub never fails.
    #[allow(clippy::unnecessary_wraps)]
    fn stub_loader(_path: &Path) -> Result<Document, std::convert::Infallible> {
        Ok(Document::new("test".to_string()))
    }

    /// Create a minimal `.sigil/` directory for tests. The stub loader does
    /// not require any files inside, so an empty directory is sufficient.
    fn make_workfile(tmp: &TempDir, name: &str) -> PathBuf {
        let path = tmp.path().join(format!("{name}.sigil"));
        std::fs::create_dir(&path).expect("create .sigil dir");
        path
    }

    #[test]
    fn test_open_returns_session_id() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "foo");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open succeeds");
        assert!(sessions.get(id).is_some());
        assert_eq!(sessions.len(), 1);
        assert!(!sessions.is_empty());
    }

    #[test]
    fn test_open_deduplicates_by_canonical_path() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "bar");
        let sessions = Sessions::new(64);
        let a = sessions.open(&path, stub_loader).expect("first open");
        let b = sessions.open(&path, stub_loader).expect("second open");
        assert_eq!(a, b, "opening same path twice should return same SessionId");
        assert_eq!(sessions.len(), 1);
    }

    #[test]
    fn test_close_removes_from_indexes() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "baz");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");
        sessions.close(id).expect("close");
        assert!(sessions.get(id).is_none());
        let canonical = std::fs::canonicalize(&path).expect("canonicalize");
        assert!(sessions.get_by_path(&canonical).is_none());
        assert_eq!(sessions.len(), 0);
        assert!(sessions.is_empty());
    }

    #[test]
    fn test_close_rejects_unknown_id() {
        let sessions = Sessions::new(64);
        let result = sessions.close(SessionId::new());
        assert!(matches!(result, Err(SessionsError::SessionNotFound(_))));
    }

    #[test]
    fn test_open_rejects_non_sigil_extension() {
        let tmp = TempDir::new().expect("tempdir");
        let bad = tmp.path().join("foo.txt");
        std::fs::create_dir(&bad).expect("create dir");
        let sessions = Sessions::new(64);
        let result = sessions.open(&bad, stub_loader);
        assert!(matches!(result, Err(SessionsError::InvalidWorkfilePath(_))));
    }

    #[test]
    fn test_open_rejects_non_directory() {
        let tmp = TempDir::new().expect("tempdir");
        let bad = tmp.path().join("foo.sigil");
        std::fs::write(&bad, b"not a dir").expect("write file");
        let sessions = Sessions::new(64);
        let result = sessions.open(&bad, stub_loader);
        assert!(matches!(result, Err(SessionsError::InvalidWorkfilePath(_))));
    }

    #[test]
    fn test_open_rejects_nonexistent_path() {
        let sessions = Sessions::new(64);
        let result = sessions.open(Path::new("/nonexistent/path.sigil"), stub_loader);
        assert!(matches!(result, Err(SessionsError::PathError(_))));
    }

    #[test]
    fn test_open_surfaces_loader_failure() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "fails");
        let sessions = Sessions::new(64);
        let result = sessions.open(&path, |_: &Path| -> Result<Document, String> {
            Err("synthetic loader failure".into())
        });
        assert!(matches!(result, Err(SessionsError::LoadFailed(_))));
        assert_eq!(sessions.len(), 0, "failed load must not register a session");
    }

    #[test]
    fn test_max_sessions_enforced() {
        // RF-006: Sessions::open rejects after MAX_SESSIONS are already
        // registered. Uses register_in_memory to pre-fill the registry to
        // the cap (cheap), then attempts to open a real .sigil/ via
        // Sessions::open and asserts TooManySessions.
        let tmp = TempDir::new().expect("tempdir");
        let extra = make_workfile(&tmp, "extra");
        let sessions = Sessions::new(64);
        for i in 0..MAX_SESSIONS {
            let _ = sessions.register_in_memory(Document::new(format!("fill-{i}")));
        }
        assert_eq!(sessions.len(), MAX_SESSIONS);

        let result = sessions.open(&extra, stub_loader);
        assert!(
            matches!(
                result,
                Err(SessionsError::TooManySessions { open, max })
                    if open == MAX_SESSIONS && max == MAX_SESSIONS
            ),
            "expected TooManySessions, got {result:?}",
        );
        assert_eq!(
            sessions.len(),
            MAX_SESSIONS,
            "rejected open must not change the count",
        );
    }

    #[test]
    fn test_list_returns_all_open_sessions() {
        let tmp = TempDir::new().expect("tempdir");
        let a = make_workfile(&tmp, "a");
        let b = make_workfile(&tmp, "b");
        let sessions = Sessions::new(64);
        sessions.open(&a, stub_loader).expect("open a");
        sessions.open(&b, stub_loader).expect("open b");
        let list = sessions.list();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_with_session_returns_none_for_unknown_id() {
        let sessions = Sessions::new(64);
        let result = sessions.with_session(SessionId::new(), |_| 42);
        assert!(result.is_none());
    }

    #[test]
    fn test_with_session_returns_value_on_success() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "ok");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");
        let result = sessions.with_session(id, |_| 42);
        assert_eq!(result, Some(Ok(42)));
    }

    #[test]
    fn test_with_session_panic_marks_errored() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "panic");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");

        let result: Option<Result<(), String>> = sessions.with_session(id, |_| {
            panic!("intentional panic");
        });
        assert!(matches!(result, Some(Err(_))));

        let session = sessions.get(id).expect("session still registered");
        let state = *session.state.lock().expect("state");
        assert_eq!(state, SessionState::Errored);

        // Subsequent calls must reject because the session is Errored.
        let next: Option<Result<i32, String>> = sessions.with_session(id, |_| 42);
        assert!(matches!(next, Some(Err(_))));
    }

    #[test]
    fn test_with_session_panic_broadcasts_session_fatal() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "fatal");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");

        let session = sessions.get(id).expect("session");
        let mut rx = session.broadcast.subscribe();
        drop(session);

        let _: Option<Result<(), String>> = sessions.with_session(id, |_| panic!("boom"));

        match rx.try_recv() {
            Ok(SessionEvent::SessionFatal { reason }) => {
                assert!(reason.contains("boom"), "reason was: {reason}");
            }
            other => panic!("expected SessionFatal, got {other:?}"),
        }
    }

    #[test]
    fn test_with_session_panic_does_not_affect_other_sessions() {
        let tmp = TempDir::new().expect("tempdir");
        let path_a = make_workfile(&tmp, "a");
        let path_b = make_workfile(&tmp, "b");
        let sessions = Sessions::new(64);
        let a = sessions.open(&path_a, stub_loader).expect("open a");
        let b = sessions.open(&path_b, stub_loader).expect("open b");

        let _: Option<Result<(), String>> = sessions.with_session(a, |_| panic!("only a panics"));

        let session_b = sessions.get(b).expect("b");
        assert_eq!(
            *session_b.state.lock().expect("state"),
            SessionState::Live,
            "other session must remain Live"
        );

        let result = sessions.with_session(b, |_| 42);
        assert_eq!(result, Some(Ok(42)));
    }

    #[test]
    fn test_session_next_seq_starts_at_one_and_increases() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "seq");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");
        let session = sessions.get(id).expect("session");
        assert_eq!(session.next_seq(), 1);
        assert_eq!(session.next_seq(), 2);
        assert_eq!(session.next_seq(), 3);
    }

    #[test]
    fn test_session_publish_stamps_seq_and_delivers_to_subscriber() {
        use crate::{MutationEventKind, OperationPayload, TransactionPayload};
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "publish");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");
        let session = sessions.get(id).expect("session");
        let mut rx = session.broadcast.subscribe();

        session.publish(
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

        match rx.try_recv().expect("event delivered") {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.kind, MutationEventKind::NodeUpdated);
                assert_eq!(me.uuid.as_deref(), Some("node-abc"));
                let tx = me.transaction.expect("transaction present");
                assert_eq!(tx.seq, 1, "first publish gets seq 1");
            }
            other => panic!("expected DocumentEvent, got {other:?}"),
        }

        // Second publish gets the next seq.
        session.publish(
            MutationEventKind::NodeUpdated,
            None,
            TransactionPayload {
                transaction_id: "tx-2".to_string(),
                user_id: "user-1".to_string(),
                seq: 0,
                operations: vec![],
            },
        );
        match rx.try_recv().expect("second event") {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.transaction.expect("tx").seq, 2);
            }
            other => panic!("expected DocumentEvent, got {other:?}"),
        }
    }

    #[test]
    fn test_document_session_info_snapshot() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "info");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");
        let session = sessions.get(id).expect("session");
        let info = session.info("My Title".into(), "2026-05-27T12:00:00Z".into());
        assert_eq!(info.id, id);
        assert_eq!(info.title, "My Title");
        assert_eq!(info.opened_at, "2026-05-27T12:00:00Z");
        assert_eq!(info.state, SessionState::Live);
    }
}
