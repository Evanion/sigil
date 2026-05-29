//! Per-session debounced persistence (Spec 22a).
//!
//! Each disk-backed [`DocumentSession`] gets one [`persist_loop`] task that
//! subscribes to the session's `broadcast` channel — the broadcast doubles as
//! the dirty signal: every mutation that broadcasts is automatically persisted,
//! and it is structurally impossible to broadcast without persisting. The
//! [`SessionPersistence`] manager owns the task lifecycle and is kept in
//! lockstep with the `Sessions` registry (a manager entry exists iff a
//! disk-backed session exists).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use sigil_state::SessionId;
use sigil_state::sessions::{DocumentSession, SessionEvent};
use tokio::sync::broadcast;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::{Duration, Instant};

use crate::persistence::{MigrationFlag, SAVE_DEBOUNCE_MS, write_prepared_with_migration_flag};
use crate::workfile;

/// `memory://` scheme prefix used by `Sessions::register_in_memory`. Sessions
/// with this prefix have no disk path and are skipped by the manager.
const MEMORY_SCHEME: &str = "memory://";

/// Handle to a running per-session persistence task.
struct PersistenceHandle {
    /// Firing this triggers a final flush and orderly task exit.
    shutdown: oneshot::Sender<()>,
    /// Joined during `close`/`shutdown_all` to confirm the final flush ran.
    join: JoinHandle<()>,
}

/// Owns the per-session persistence tasks. One entry per disk-backed session.
#[derive(Default)]
pub struct SessionPersistence {
    handles: Mutex<HashMap<SessionId, PersistenceHandle>>,
}

impl SessionPersistence {
    #[must_use]
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
        }
    }

    /// Spawns a persistence task for `session`. No-op for `memory://` sessions
    /// and idempotent if the session is already registered.
    ///
    /// `migrated_from` seeds the task's migration flag: when `Some(v)`, the
    /// first save is forced (even with no mutation) and backs up the legacy
    /// artifacts to `.backup-v(N-1)/`.
    pub fn register(&self, session: Arc<DocumentSession>, migrated_from: Option<u32>) {
        if session
            .workfile_path
            .to_str()
            .is_some_and(|p| p.starts_with(MEMORY_SCHEME))
        {
            return;
        }
        let id = session.id;
        let mut map = self.handles.lock().unwrap_or_else(PoisonError::into_inner);
        if map.contains_key(&id) {
            return;
        }
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let migration_flag: MigrationFlag = Arc::new(Mutex::new(migrated_from));
        let force_initial_save = migrated_from.is_some();
        // Subscribe to the broadcast SYNCHRONOUSLY, before spawning the task.
        // `broadcast::Sender::send` only reaches receivers that have already
        // subscribed; deferring the subscribe into the spawned task opens a
        // window where a mutation broadcast immediately after `register()`
        // would be lost — violating the §3.1 invariant ("it is structurally
        // impossible to broadcast without persisting"). Subscribing here
        // guarantees the receiver exists before `register()` returns.
        let rx = session.broadcast.subscribe();
        let join = tokio::spawn(persist_loop(
            session,
            rx,
            shutdown_rx,
            migration_flag,
            force_initial_save,
        ));
        map.insert(
            id,
            PersistenceHandle {
                shutdown: shutdown_tx,
                join,
            },
        );
    }

    /// Number of registered (disk-backed) sessions.
    #[must_use]
    pub fn len(&self) -> usize {
        self.handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    /// Whether a persistence task exists for `id`.
    #[must_use]
    pub fn is_registered(&self, id: SessionId) -> bool {
        self.handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains_key(&id)
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Flush + join the task for `id`, then forget it. Idempotent: a second
    /// call (or a call for an unknown id) is a no-op.
    ///
    /// MUST be called BEFORE `Sessions::close(id)` so the session `Arc` (and
    /// thus the store) is still alive for the final flush.
    pub async fn close(&self, id: SessionId) {
        let handle = self
            .handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        if let Some(h) = handle {
            // Err means the task already exited; the final flush already ran.
            let _ = h.shutdown.send(());
            if let Err(e) = h.join.await {
                tracing::error!("persistence task for session {id} panicked on close: {e}");
            }
        }
    }

    /// Drain every task within one bounded total timeout (graceful shutdown).
    /// Fires all shutdowns first so tasks flush in parallel.
    pub async fn shutdown_all(&self, timeout: Duration) {
        let handles: Vec<PersistenceHandle> = {
            let mut map = self.handles.lock().unwrap_or_else(PoisonError::into_inner);
            map.drain().map(|(_, h)| h).collect()
        };
        let mut joins = Vec::with_capacity(handles.len());
        for h in handles {
            let _ = h.shutdown.send(());
            joins.push(h.join);
        }
        let drained = tokio::time::timeout(timeout, async {
            for j in joins {
                if let Err(e) = j.await {
                    tracing::error!("persistence task panicked during shutdown: {e}");
                }
            }
        })
        .await;
        if drained.is_err() {
            tracing::warn!("persistence drain exceeded {timeout:?} — abandoning remaining tasks");
        }
    }
}

/// The per-session persistence task body.
///
/// Subscribes to the session broadcast, debounces dirty signals, and saves.
/// Holds a strong `Arc<DocumentSession>`, so the broadcast `Sender` never drops
/// underneath the receiver — `RecvError::Closed` is therefore unreachable in
/// practice (Spec 22a §3.1); the `oneshot` is the sole shutdown trigger. The
/// `Closed` arm is kept only for match exhaustiveness + belt-and-suspenders.
async fn persist_loop(
    session: Arc<DocumentSession>,
    mut rx: broadcast::Receiver<SessionEvent>,
    mut shutdown_rx: oneshot::Receiver<()>,
    migration_flag: MigrationFlag,
    force_initial_save: bool,
) {
    let debounce = Duration::from_millis(SAVE_DEBOUNCE_MS);

    // None = idle (no save pending). Some(deadline) = save armed for that instant.
    // A migrated session arms immediately so the migration is force-persisted
    // even without a mutation (mirrors the old post-load signal_dirty()).
    let mut deadline: Option<Instant> = if force_initial_save {
        Some(Instant::now() + debounce)
    } else {
        None
    };
    // Becomes false after SessionFatal: stop arming new saves (a final flush on
    // close/shutdown may still run).
    let mut arming = true;

    loop {
        // Recreating sleep_until with the SAME absolute deadline each iteration
        // does NOT reset the timer (it is an absolute instant). When idle, a
        // pending future never resolves.
        let debounce_tick = async {
            match deadline {
                Some(d) => tokio::time::sleep_until(d).await,
                None => std::future::pending::<()>().await,
            }
        };

        tokio::select! {
            _ = &mut shutdown_rx => {
                do_save_session(&session, &migration_flag).await;
                break;
            }
            ev = rx.recv() => match ev {
                Ok(SessionEvent::DocumentEvent(_)) | Err(RecvError::Lagged(_)) => {
                    if arming {
                        deadline = Some(Instant::now() + debounce);
                    }
                }
                Ok(SessionEvent::SessionFatal { .. }) => {
                    arming = false;
                }
                Err(RecvError::Closed) => {
                    // Unreachable while the task holds the session Arc (§3.1).
                    do_save_session(&session, &migration_flag).await;
                    break;
                }
            },
            () = debounce_tick, if deadline.is_some() => {
                do_save_session(&session, &migration_flag).await;
                deadline = None;
            }
        }
    }
}

/// One save: read the session store (async), serialize while holding the read
/// lock, drop the lock, then write atomically (no lock across `.await`).
async fn do_save_session(session: &Arc<DocumentSession>, migration_flag: &MigrationFlag) {
    let prepared = {
        let guard = session.store.read().await;
        match workfile::prepare_save(&guard.0) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("failed to serialize session {} for save: {e}", session.id);
                return;
            }
        }
        // read guard dropped here — released before any await below.
    };
    write_prepared_with_migration_flag(prepared, &session.workfile_path, migration_flag).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    use sigil_core::Document;
    use sigil_state::sessions::Sessions;
    use tokio::time::sleep;

    /// Lays down an empty `.sigil/` dir and opens a disk-backed session in `sessions`.
    async fn open_disk_session(
        sessions: &Sessions,
        dir: &std::path::Path,
        name: &str,
    ) -> Arc<sigil_state::sessions::DocumentSession> {
        let workfile_path = dir.join(format!("{name}.sigil"));
        tokio::fs::create_dir_all(&workfile_path).await.unwrap();
        let id = sessions
            .open(&workfile_path, |_p| {
                Ok::<_, std::convert::Infallible>(Document::new(name.to_string()))
            })
            .expect("open session");
        sessions.get(id).expect("session registered")
    }

    /// A minimal `MutationEvent` for tests. `MutationEvent` does not derive
    /// `Default` (it has no sensible default for `kind`), so we construct it
    /// explicitly with the cheapest discriminant.
    fn test_mutation_event() -> sigil_state::MutationEvent {
        sigil_state::MutationEvent {
            kind: sigil_state::MutationEventKind::NodeUpdated,
            uuid: None,
            data: None,
            transaction: None,
        }
    }

    /// A mutation broadcast on the session arms a debounced save that lands on disk.
    #[tokio::test]
    async fn test_broadcast_triggers_debounced_save() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let session = open_disk_session(&sessions, dir.path(), "doc").await;
        let workfile_path = session.workfile_path.clone();

        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&session), None);

        // Fire a document event the way apply_operations does.
        let _ = session
            .broadcast
            .send(sigil_state::sessions::SessionEvent::DocumentEvent(
                test_mutation_event(),
            ));

        sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 300)).await;

        assert!(
            workfile_path.join("manifest.json").exists(),
            "manifest.json should be written after a broadcast + debounce"
        );
    }

    /// register() is a no-op for `memory://` sessions and idempotent for repeats.
    #[tokio::test]
    async fn test_register_skips_memory_and_is_idempotent() {
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let mem_id = sessions.register_in_memory(Document::new("mem".to_string()));
        let mem_session = sessions.get(mem_id).unwrap();

        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&mem_session), None);
        assert_eq!(
            manager.len(),
            0,
            "memory:// sessions must not be registered"
        );

        let dir = tempfile::tempdir().unwrap();
        let disk = {
            let workfile_path = dir.path().join("d.sigil");
            tokio::fs::create_dir_all(&workfile_path).await.unwrap();
            let id = sessions
                .open(&workfile_path, |_p| {
                    Ok::<_, std::convert::Infallible>(Document::new("d".to_string()))
                })
                .unwrap();
            sessions.get(id).unwrap()
        };
        manager.register(Arc::clone(&disk), None);
        manager.register(Arc::clone(&disk), None); // duplicate
        assert_eq!(
            manager.len(),
            1,
            "duplicate register must not spawn a second task"
        );
    }

    /// close() fires a final flush and joins the task before returning.
    #[tokio::test]
    async fn test_close_flushes_before_returning() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let session = open_disk_session(&sessions, dir.path(), "flush").await;
        let workfile_path = session.workfile_path.clone();

        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&session), None);

        // No broadcast fired; close still flushes last-good state immediately.
        manager.close(session.id).await;

        assert!(
            workfile_path.join("manifest.json").exists(),
            "close() must flush before returning, without waiting for a debounce"
        );
        assert_eq!(manager.len(), 0, "handle removed after close");
    }

    /// A migrated session force-persists on first save and creates .backup-v1/.
    #[tokio::test]
    async fn test_migrated_session_force_persists_and_backs_up() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let session = open_disk_session(&sessions, dir.path(), "mig").await;
        let workfile_path = session.workfile_path.clone();
        // A v1 manifest must exist for the backup to capture something.
        tokio::fs::write(
            workfile_path.join("manifest.json"),
            r#"{"schema_version": 1, "name": "Original", "page_order": []}"#,
        )
        .await
        .unwrap();

        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&session), Some(1)); // migrated_from = Some(1)

        // No broadcast: the migration flag must trigger the first save on its own.
        sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 300)).await;

        assert!(
            tokio::fs::metadata(workfile_path.join(".backup-v1"))
                .await
                .is_ok(),
            "migrated session must force-persist and create .backup-v1/"
        );
    }

    /// Closing twice (or after the task exited) does not panic or double-write.
    #[tokio::test]
    async fn test_double_close_is_safe() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let session = open_disk_session(&sessions, dir.path(), "twice").await;
        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&session), None);
        manager.close(session.id).await;
        manager.close(session.id).await; // second close: map yields None
    }
}
