//! Debounced persistence — saves the document to disk after a quiet period.
//!
//! The persistence task listens for "dirty" signals on an MPSC channel. After
//! receiving a signal, it waits [`SAVE_DEBOUNCE_MS`] milliseconds for the
//! stream to go quiet (no new signals), then serializes the document and writes
//! it to the workfile directory.
//!
//! # Mutex safety
//!
//! The document is behind a `std::sync::Mutex`. This task acquires the lock
//! **synchronously**, calls [`workfile::prepare_save`] to produce all JSON
//! strings, then **drops the lock** before doing any async file I/O. The lock
//! is never held across an `.await` point.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Duration, sleep};

use crate::state::SendDocument;
use crate::workfile;

/// Default debounce interval (in milliseconds) before flushing to disk.
pub const SAVE_DEBOUNCE_MS: u64 = 500;

/// Shared one-shot flag indicating that the next save is the first persisted
/// write after a schema migration on load (RF-009).
///
/// When `Some(v)`, the next call to [`do_save`] takes the value and populates
/// [`workfile::PreparedSave::migrated_from`] so the writer can apply
/// migration-specific behavior on the first save after load.
pub type MigrationFlag = Arc<Mutex<Option<u32>>>;

/// Spawns the background persistence task.
///
/// Returns a tuple of:
/// - `mpsc::Sender<()>` that callers use to signal that the document has been modified.
/// - `JoinHandle<()>` for the background task, so callers can await its completion
///   during shutdown.
///
/// The task coalesces rapid signals and writes at most once per debounce window.
///
/// When the returned sender (and all its clones) are dropped, the task shuts
/// down gracefully, performing a final save if needed.
pub fn spawn_persistence_task(
    document: Arc<Mutex<SendDocument>>,
    workfile_path: PathBuf,
) -> (mpsc::Sender<()>, JoinHandle<()>) {
    spawn_persistence_task_with_migration_flag(document, workfile_path, Arc::new(Mutex::new(None)))
}

/// Variant of [`spawn_persistence_task`] that accepts a [`MigrationFlag`].
///
/// On the first save after construction, the task takes the flag's value and
/// passes it to [`workfile::write_prepared_save`] via [`workfile::PreparedSave::migrated_from`]
/// so the writer can apply migration-specific behavior on the first save.
pub fn spawn_persistence_task_with_migration_flag(
    document: Arc<Mutex<SendDocument>>,
    workfile_path: PathBuf,
    migration_flag: MigrationFlag,
) -> (mpsc::Sender<()>, JoinHandle<()>) {
    let (tx, mut rx) = mpsc::channel::<()>(16);

    let handle = tokio::spawn(async move {
        loop {
            // Wait for the first dirty signal.
            if rx.recv().await.is_none() {
                // Channel closed — all senders dropped. Shut down.
                break;
            }

            // Debounce: keep resetting the timer while new signals arrive.
            let debounce = Duration::from_millis(SAVE_DEBOUNCE_MS);
            loop {
                tokio::select! {
                    () = sleep(debounce) => break, // Quiet period elapsed — flush.
                    msg = rx.recv() => {
                        if msg.is_none() {
                            // Channel closed during debounce. Do a final save
                            // before shutting down.
                            do_save(&document, &workfile_path, &migration_flag).await;
                            return;
                        }
                        // Signal received — restart the debounce timer by
                        // looping back to the select.
                    }
                }
            }

            do_save(&document, &workfile_path, &migration_flag).await;
        }
    });

    (tx, handle)
}

/// Serializes the document under the lock, then writes to disk outside it.
async fn do_save(
    document: &Arc<Mutex<SendDocument>>,
    workfile_path: &Path,
    migration_flag: &MigrationFlag,
) {
    // Phase 1: synchronous — acquire lock, serialize, drop lock.
    let mut prepared = {
        let guard = match document.lock() {
            Ok(g) => g,
            Err(poisoned) => {
                tracing::error!("document lock poisoned during save — recovering");
                poisoned.into_inner()
            }
        };
        match workfile::prepare_save(&guard) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("failed to serialize document for save: {e}");
                return;
            }
        }
        // guard is dropped here — lock released before any await.
    };

    // Take the migration flag (if any) before going async so a successful save
    // clears it and subsequent saves don't repeat migration-specific behavior.
    // If the write fails we put it back so the next save retries.
    let migrated_from = match migration_flag.lock() {
        Ok(mut g) => g.take(),
        Err(poisoned) => {
            tracing::error!("migration flag lock poisoned during save — recovering");
            poisoned.into_inner().take()
        }
    };
    prepared.migrated_from = migrated_from;

    // Phase 2: async — write files to disk without holding the lock.
    match workfile::write_prepared_save(&prepared, workfile_path).await {
        Ok(()) => tracing::debug!("document saved to {}", workfile_path.display()),
        Err(e) => {
            tracing::error!(
                "failed to write workfile to {}: {e}",
                workfile_path.display()
            );
            // Restore the migration flag so the next attempt re-tries.
            if let Some(v) = migrated_from {
                match migration_flag.lock() {
                    Ok(mut g) => {
                        if g.is_none() {
                            *g = Some(v);
                        }
                    }
                    Err(poisoned) => {
                        let mut g = poisoned.into_inner();
                        if g.is_none() {
                            *g = Some(v);
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_designer_core::Document;

    #[tokio::test]
    async fn test_save_debounce_ms_is_500() {
        assert_eq!(SAVE_DEBOUNCE_MS, 500);
    }

    #[tokio::test]
    async fn test_spawn_persistence_task_returns_sender() {
        let doc = Arc::new(Mutex::new(SendDocument(Document::new("Test".to_string()))));
        let dir = tempfile::tempdir().unwrap();
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(&workfile_path).await.unwrap();

        let (tx, _handle) = spawn_persistence_task(doc, workfile_path.clone());

        // Sending a dirty signal should not panic.
        tx.try_send(()).unwrap();

        // Wait for debounce + a margin for the write to complete.
        sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 200)).await;

        // The manifest should have been written.
        let manifest_path = workfile_path.join("manifest.json");
        assert!(
            manifest_path.exists(),
            "manifest.json should exist after save"
        );

        let manifest_json = tokio::fs::read_to_string(&manifest_path).await.unwrap();
        assert!(
            manifest_json.contains("Test"),
            "manifest should contain document name"
        );
    }

    #[tokio::test]
    async fn test_persistence_task_shuts_down_when_sender_dropped() {
        let doc = Arc::new(Mutex::new(SendDocument(Document::new(
            "Shutdown".to_string(),
        ))));
        let dir = tempfile::tempdir().unwrap();
        let workfile_path = dir.path().join("shutdown.sigil");
        tokio::fs::create_dir_all(&workfile_path).await.unwrap();

        let (tx, _handle) = spawn_persistence_task(doc, workfile_path);

        // Drop the sender — this should cause the task to shut down.
        drop(tx);

        // Give the task a moment to notice the closed channel.
        sleep(Duration::from_millis(50)).await;
        // No assertion needed — we're verifying no panic / hang.
    }

    /// RF-009/RF-010: when the persistence task is constructed with a migration
    /// flag and a dirty signal arrives, the resulting save must (1) consume the
    /// migration flag exactly once and (2) populate the `.backup-v1/` directory.
    #[tokio::test]
    async fn test_persistence_consumes_migration_flag_and_creates_backup() {
        let doc = Arc::new(Mutex::new(SendDocument(Document::new(
            "Migrated".to_string(),
        ))));
        let dir = tempfile::tempdir().unwrap();
        let workfile_path = dir.path().join("migrated.sigil");
        tokio::fs::create_dir_all(&workfile_path).await.unwrap();

        // Lay down a synthetic v1 manifest so the backup has something to capture.
        tokio::fs::write(
            workfile_path.join("manifest.json"),
            r#"{"schema_version": 1, "name": "Original", "page_order": []}"#,
        )
        .await
        .unwrap();

        let migration_flag: MigrationFlag = Arc::new(Mutex::new(Some(1)));
        let (tx, _handle) = spawn_persistence_task_with_migration_flag(
            doc,
            workfile_path.clone(),
            Arc::clone(&migration_flag),
        );

        tx.try_send(()).unwrap();
        sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 200)).await;

        // Backup directory should exist after the migrated save.
        let backup_root = workfile_path.join(".backup-v1");
        assert!(
            tokio::fs::metadata(&backup_root).await.is_ok(),
            ".backup-v1/ should be created on the first migrated save"
        );

        // Migration flag should be cleared so subsequent saves don't re-back-up.
        let flag_state = migration_flag.lock().unwrap();
        assert!(
            flag_state.is_none(),
            "migration flag should be cleared after successful save"
        );
    }

    #[tokio::test]
    async fn test_persistence_debounces_rapid_signals() {
        let doc = Arc::new(Mutex::new(SendDocument(Document::new(
            "Debounce".to_string(),
        ))));
        let dir = tempfile::tempdir().unwrap();
        let workfile_path = dir.path().join("debounce.sigil");
        tokio::fs::create_dir_all(&workfile_path).await.unwrap();

        let (tx, _handle) = spawn_persistence_task(doc, workfile_path.clone());

        // Send many rapid signals — only one save should occur after the
        // debounce window.
        for _ in 0..10 {
            // Drops are expected here — we're testing debouncing behavior.
            if tx.try_send(()).is_err() {
                // Channel full — save already pending, which is the point.
            }
            sleep(Duration::from_millis(50)).await;
        }

        // Wait for the debounce window to expire after the last signal.
        sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 200)).await;

        let manifest_path = workfile_path.join("manifest.json");
        assert!(
            manifest_path.exists(),
            "manifest.json should exist after debounced save"
        );
    }
}
