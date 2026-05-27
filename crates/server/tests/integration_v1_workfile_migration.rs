//! Integration test: end-to-end v1 → v2 workfile migration.
//!
//! Background (RF-029):
//!
//! The migration pipeline has multiple cooperating pieces:
//!
//! 1. `load_workfile` reads the on-disk workfile and migrates v1 page JSON
//!    to v2 in memory, returning `LoadedWorkfile { migrated_from: Some(1) }`
//!    when any page was migrated.
//! 2. `ServerState::new_with_document_and_workfile_migrated` stores the
//!    migration flag in the persistence task's shared state.
//! 3. `main.rs` calls `signal_dirty()` after load when `migrated_from` is set,
//!    triggering the persistence task to write the migrated v2 form back to
//!    disk on its next debounce flush.
//! 4. On that first migrated save, `write_prepared_save` copies the original
//!    v1 manifest + pages to `.backup-v1/` before overwriting them with v2.
//!
//! Each step is exercised in isolation by unit tests in `workfile.rs` and
//! `persistence.rs`. This integration test wires the whole pipeline together
//! and asserts the end-to-end behavior:
//! - Lay down a v1 workfile on disk.
//! - Construct a `ServerState` via the same path `main.rs` uses.
//! - Signal dirty (mirroring `main.rs` line 67).
//! - Wait for the persistence task to debounce + flush.
//! - Assert that the on-disk workfile is now v2 AND `.backup-v1/` contains
//!   the original v1 contents.

use std::path::PathBuf;
use std::time::Duration;

use sigil_server::state::ServerState;
use sigil_server::workfile::load_workfile;
use tokio::time::sleep;

/// Lays down a synthetic v1 workfile (manifest + one page) at `workfile_path`.
async fn write_v1_workfile_fixture(workfile_path: &std::path::Path, page_uuid: uuid::Uuid) {
    let pages_dir = workfile_path.join("pages");
    tokio::fs::create_dir_all(&pages_dir)
        .await
        .expect("create dirs");

    // v1 manifest (schema_version = 1).
    let manifest = serde_json::json!({
        "schema_version": 1,
        "name": "Legacy Doc",
        "page_order": [page_uuid.to_string()]
    });
    tokio::fs::write(
        workfile_path.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
    )
    .await
    .expect("write manifest");

    // v1 page (schema_version = 1, no `corners` field, no nodes).
    let page_json = serde_json::json!({
        "schema_version": 1,
        "id": page_uuid.to_string(),
        "name": "Legacy Page",
        "nodes": [],
        "transitions": []
    });
    tokio::fs::write(
        pages_dir.join(format!("{page_uuid}.json")),
        page_json.to_string(),
    )
    .await
    .expect("write page");
}

/// RF-029: end-to-end pipeline test.
///
/// Loads a v1 workfile, constructs a ServerState the same way `main.rs` does,
/// signals dirty, waits for the debounced flush, and asserts:
/// - `LoadedWorkfile.migrated_from == Some(1)`.
/// - The on-disk manifest is now v2 (schema_version = 2).
/// - The on-disk page is now v2 (schema_version = 2).
/// - `.backup-v1/manifest.json` and `.backup-v1/pages/<uuid>.json` exist
///   and contain the original v1 contents.
#[tokio::test]
async fn test_v1_workfile_full_migration_pipeline() {
    use sigil_core::CURRENT_SCHEMA_VERSION;
    assert_eq!(
        CURRENT_SCHEMA_VERSION, 2,
        "this test pins the migration target at v2; revisit if the schema bumps"
    );

    let dir = tempfile::tempdir().expect("create temp dir");
    let workfile_path: PathBuf = dir.path().join("legacy.sigil");
    let page_uuid = uuid::Uuid::new_v4();

    // (1) Lay down a v1 workfile on disk.
    write_v1_workfile_fixture(&workfile_path, page_uuid).await;

    // (2) Load it through the public server entrypoint — same call as `main.rs`.
    let loaded = load_workfile(&workfile_path)
        .await
        .expect("load v1 workfile");
    assert_eq!(
        loaded.migrated_from,
        Some(1),
        "v1 page must produce migrated_from = Some(1) on load"
    );

    // (3) Construct a ServerState via the migration-aware entry point.
    let migrated_from = loaded.migrated_from;
    let state = ServerState::new_with_document_and_workfile_migrated(
        loaded.document,
        workfile_path.clone(),
        migrated_from,
    );

    // (4) Mirror `main.rs` line 67: signal dirty so the migrated form is
    //     flushed to disk.
    assert!(migrated_from.is_some());
    state.app.signal_dirty();

    // (5) Wait for the debounce window to elapse + a margin for the write.
    //     SAVE_DEBOUNCE_MS = 500ms.
    sleep(Duration::from_millis(500 + 300)).await;

    // (6) Assert the live manifest is now v2.
    let live_manifest_str = tokio::fs::read_to_string(workfile_path.join("manifest.json"))
        .await
        .expect("read live manifest after migration");
    let live_manifest: serde_json::Value =
        serde_json::from_str(&live_manifest_str).expect("parse live manifest");
    assert_eq!(
        live_manifest["schema_version"], 2,
        "live manifest must be v2 after migrated save, got: {live_manifest_str}"
    );

    // (7) Assert the live page is now v2.
    let live_page_str = tokio::fs::read_to_string(
        workfile_path
            .join("pages")
            .join(format!("{page_uuid}.json")),
    )
    .await
    .expect("read live page after migration");
    let live_page: serde_json::Value =
        serde_json::from_str(&live_page_str).expect("parse live page");
    assert_eq!(
        live_page["schema_version"], 2,
        "live page must be v2 after migrated save, got: {live_page_str}"
    );

    // (8) Assert .backup-v1/ exists with original v1 contents.
    let backup_root = workfile_path.join(".backup-v1");
    assert!(
        tokio::fs::metadata(&backup_root).await.is_ok(),
        ".backup-v1/ directory must be created on first migrated save"
    );

    let backup_manifest_str = tokio::fs::read_to_string(backup_root.join("manifest.json"))
        .await
        .expect("read backup manifest");
    let backup_manifest: serde_json::Value =
        serde_json::from_str(&backup_manifest_str).expect("parse backup manifest");
    assert_eq!(
        backup_manifest["schema_version"], 1,
        "backup manifest must preserve original v1 schema_version"
    );
    assert_eq!(
        backup_manifest["name"], "Legacy Doc",
        "backup manifest must preserve original document name"
    );

    let backup_page_path = backup_root.join("pages").join(format!("{page_uuid}.json"));
    let backup_page_str = tokio::fs::read_to_string(&backup_page_path)
        .await
        .expect("read backup page");
    let backup_page: serde_json::Value =
        serde_json::from_str(&backup_page_str).expect("parse backup page");
    assert_eq!(
        backup_page["schema_version"], 1,
        "backup page must preserve original v1 schema_version"
    );
}

/// RF-029: a v2-only workfile must NOT trigger migration behavior — no
/// `migrated_from` flag, no signal_dirty, no `.backup-v1/` directory created.
#[tokio::test]
async fn test_v2_workfile_does_not_trigger_migration() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let workfile_path: PathBuf = dir.path().join("current.sigil");
    let page_uuid = uuid::Uuid::new_v4();

    let pages_dir = workfile_path.join("pages");
    tokio::fs::create_dir_all(&pages_dir)
        .await
        .expect("create dirs");

    // v2 manifest.
    let manifest = serde_json::json!({
        "schema_version": 2,
        "name": "Current",
        "page_order": [page_uuid.to_string()]
    });
    tokio::fs::write(
        workfile_path.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).expect("serialize"),
    )
    .await
    .expect("write manifest");

    // v2 page.
    let page_json = serde_json::json!({
        "schema_version": 2,
        "id": page_uuid.to_string(),
        "name": "Page",
        "nodes": [],
        "transitions": []
    });
    tokio::fs::write(
        pages_dir.join(format!("{page_uuid}.json")),
        page_json.to_string(),
    )
    .await
    .expect("write page");

    let loaded = load_workfile(&workfile_path)
        .await
        .expect("load v2 workfile");
    assert_eq!(
        loaded.migrated_from, None,
        "v2 workfile must not signal migration"
    );

    // Construct ServerState; do NOT signal dirty.
    let _state = ServerState::new_with_document_and_workfile_migrated(
        loaded.document,
        workfile_path.clone(),
        loaded.migrated_from,
    );

    // Wait past the debounce window; no save should have occurred.
    sleep(Duration::from_millis(500 + 200)).await;

    let backup_root = workfile_path.join(".backup-v1");
    assert!(
        tokio::fs::metadata(&backup_root).await.is_err(),
        ".backup-v1/ must not exist for a v2-only workfile"
    );
}
