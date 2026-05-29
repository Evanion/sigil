//! Persistence helpers shared by the per-session persistence tasks.
//!
//! Per-session persistence (Spec 22a) lives in [`crate::session_persistence`];
//! this module holds the debounce constant, the migration-flag type, and the
//! reusable migration-flag-aware write (the second, async phase of a save).
//!
//! # Two-phase save
//!
//! A save is split into a synchronous prepare (serialize the document while a
//! lock is held) and an asynchronous write (atomic temp+rename, no lock held).
//! The caller performs phase one against whatever lock guards its document;
//! this module owns phase two.

use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::workfile::{self, PreparedSave};

/// Default debounce interval (in milliseconds) before flushing to disk.
pub const SAVE_DEBOUNCE_MS: u64 = 500;

/// Shared one-shot flag indicating that the next save is the first persisted
/// write after a schema migration on load.
///
/// When `Some(v)`, [`write_prepared_with_migration_flag`] takes the value and
/// populates [`workfile::PreparedSave::migrated_from`] so the writer backs up
/// the legacy artifacts before overwriting them. The flag is restored on write
/// failure so the next attempt retries the backup.
pub type MigrationFlag = Arc<Mutex<Option<u32>>>;

/// Phase two of a save: takes the migration flag, writes `prepared` atomically,
/// and restores the flag on failure.
///
/// `prepared` is produced by [`workfile::prepare_save`] under the document lock
/// (phase one) and passed here after the lock is dropped — this function never
/// touches a document lock and is safe to `.await`.
pub async fn write_prepared_with_migration_flag(
    mut prepared: PreparedSave,
    workfile_path: &Path,
    migration_flag: &MigrationFlag,
) {
    let migrated_from = match migration_flag.lock() {
        Ok(mut g) => g.take(),
        Err(poisoned) => {
            tracing::error!("migration flag lock poisoned during save — recovering");
            poisoned.into_inner().take()
        }
    };
    prepared.migrated_from = migrated_from;

    match workfile::write_prepared_save(&prepared, workfile_path).await {
        Ok(()) => tracing::debug!("document saved to {}", workfile_path.display()),
        Err(e) => {
            tracing::error!(
                "failed to write workfile to {}: {e}",
                workfile_path.display()
            );
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
    use sigil_core::Document;

    #[tokio::test]
    async fn test_save_debounce_ms_is_500() {
        assert_eq!(SAVE_DEBOUNCE_MS, 500);
    }

    /// The extracted helper consumes the migration flag exactly once on a
    /// successful write and creates `.backup-v1/`.
    #[tokio::test]
    async fn test_write_prepared_with_migration_flag_consumes_flag_and_backs_up() {
        let dir = tempfile::tempdir().unwrap();
        let workfile_path = dir.path().join("migrated.sigil");
        tokio::fs::create_dir_all(&workfile_path).await.unwrap();
        tokio::fs::write(
            workfile_path.join("manifest.json"),
            r#"{"schema_version": 1, "name": "Original", "page_order": []}"#,
        )
        .await
        .unwrap();

        let prepared = workfile::prepare_save(&Document::new("Migrated".to_string())).unwrap();
        let flag: MigrationFlag = Arc::new(Mutex::new(Some(1)));

        write_prepared_with_migration_flag(prepared, &workfile_path, &flag).await;

        assert!(
            tokio::fs::metadata(workfile_path.join(".backup-v1"))
                .await
                .is_ok(),
            ".backup-v1/ should be created on the first migrated save"
        );
        assert!(
            flag.lock().unwrap().is_none(),
            "migration flag should be cleared after successful save"
        );
    }
}
