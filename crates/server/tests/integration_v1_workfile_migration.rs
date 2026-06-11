//! Integration test: end-to-end v1 → v2 workfile migration.
//!
//! Background (RF-029):
//!
//! The migration pipeline has multiple cooperating pieces:
//!
//! 1. `load_workfile` reads the on-disk workfile and migrates v1 page JSON
//!    to v2 in memory, returning `LoadedWorkfile { migrated_from: Some(1) }`
//!    when any page was migrated.
//! 2. `ServerState::new_empty` builds an empty state; the loaded document is
//!    moved into the session store via `App::open_session_with` (no clone).
//! 3. Spec 22a: the session is registered via `App::open_session_with`, and
//!    its persistence task is registered via `SessionPersistence::register`
//!    with the `migrated_from` flag. Registration with `migrated_from =
//!    Some(_)` arms the first forced save automatically — no `signal_dirty()`
//!    is needed. The persistence task writes the migrated v2 form back to disk
//!    on its next debounce flush.
//! 4. On that first migrated save, `write_prepared_save` copies the original
//!    v1 manifest + pages to `.backup-v1/` before overwriting them with v2.
//!
//! Each step is exercised in isolation by unit tests in `workfile.rs` and
//! `session_persistence.rs`. This integration test wires the whole pipeline
//! together and asserts the end-to-end behavior:
//! - Lay down a v1 workfile on disk.
//! - Construct a `ServerState` via the same path the startup/resolver path uses.
//! - Register the session + persistence (which arms the migrated save).
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
/// Loads a v1 workfile, constructs a ServerState, registers the session +
/// per-session persistence (which arms the migrated save), waits for the
/// debounced flush, and asserts:
/// - `LoadedWorkfile.migrated_from == Some(1)`.
/// - The on-disk manifest is now v3 (schema_version = 3).
/// - The on-disk page is now v3 (schema_version = 3).
/// - `.backup-v1/manifest.json` and `.backup-v1/pages/<uuid>.json` exist
///   and are byte-for-byte identical to the original v1 files written to disk
///   (raw-string equality, not JSON field comparison — a reserialized backup
///   with different key order or whitespace must FAIL this assertion).
#[tokio::test]
async fn test_v1_workfile_full_migration_pipeline() {
    use sigil_core::CURRENT_SCHEMA_VERSION;
    use sigil_server::persistence::SAVE_DEBOUNCE_MS;
    assert_eq!(
        CURRENT_SCHEMA_VERSION, 3,
        "this test pins the migration target at v3; revisit if the schema bumps"
    );

    let dir = tempfile::tempdir().expect("create temp dir");
    let workfile_path: PathBuf = dir.path().join("legacy.sigil");
    let page_uuid = uuid::Uuid::new_v4();

    // (1) Lay down a v1 workfile on disk.
    write_v1_workfile_fixture(&workfile_path, page_uuid).await;

    // (2) Capture the exact bytes written to disk BEFORE migration so we can
    //     compare against the backup later (CLAUDE.md §4 byte-for-byte contract).
    let original_manifest_str = tokio::fs::read_to_string(workfile_path.join("manifest.json"))
        .await
        .expect("read original manifest before migration");
    let original_page_str = tokio::fs::read_to_string(
        workfile_path
            .join("pages")
            .join(format!("{page_uuid}.json")),
    )
    .await
    .expect("read original page before migration");

    // (3) Load it through the public server entrypoint — same call as `main.rs`.
    let loaded = load_workfile(&workfile_path)
        .await
        .expect("load v1 workfile");
    assert_eq!(
        loaded.migrated_from,
        Some(1),
        "v1 page must produce migrated_from = Some(1) on load"
    );

    // (4) Construct an empty ServerState and move the loaded document into the
    //     session store via `open_session_with` (RF-001: no full-Document clone).
    let migrated_from = loaded.migrated_from;
    let document = loaded.document;
    let state = ServerState::new_empty();

    // (5) Spec 22a: register the session + its persistence task with the
    //     migration flag. Registration with `migrated_from = Some(1)` arms the
    //     first save automatically — no signal_dirty() needed.
    let session_id = state
        .app
        .open_session_with(&workfile_path, move |_p| {
            Ok::<_, std::convert::Infallible>(document)
        })
        .expect("register session");
    let session = state.app.sessions.get(session_id).expect("session present");
    state.persistence.register(session, migrated_from);

    // (6) Wait for the debounce window to elapse + a margin for the write.
    sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 300)).await;

    // (7) Assert the live manifest is now v3 (current schema).
    let live_manifest_str = tokio::fs::read_to_string(workfile_path.join("manifest.json"))
        .await
        .expect("read live manifest after migration");
    let live_manifest: serde_json::Value =
        serde_json::from_str(&live_manifest_str).expect("parse live manifest");
    assert_eq!(
        live_manifest["schema_version"], CURRENT_SCHEMA_VERSION,
        "live manifest must be v{CURRENT_SCHEMA_VERSION} after migrated save, got: {live_manifest_str}"
    );

    // (8) Assert the live page is now v3 (current schema).
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
        live_page["schema_version"], CURRENT_SCHEMA_VERSION,
        "live page must be v{CURRENT_SCHEMA_VERSION} after migrated save, got: {live_page_str}"
    );

    // (9) Assert .backup-v1/ exists with original v1 contents byte-for-byte
    //     (CLAUDE.md §4 Schema Migration Persistence Contract: assert content
    //     equality via read + assert_eq!, not mere file presence or JSON field
    //     comparison — a reserialized backup would pass field checks but fail here).
    let backup_root = workfile_path.join(".backup-v1");
    assert!(
        tokio::fs::metadata(&backup_root).await.is_ok(),
        ".backup-v1/ directory must be created on first migrated save"
    );

    let backup_manifest_str = tokio::fs::read_to_string(backup_root.join("manifest.json"))
        .await
        .expect("read backup manifest");
    assert_eq!(
        backup_manifest_str, original_manifest_str,
        "backup-v1/manifest.json must be byte-for-byte identical to the original v1 file \
         (reserialized content with different key order or whitespace must FAIL)"
    );

    let backup_page_str =
        tokio::fs::read_to_string(backup_root.join("pages").join(format!("{page_uuid}.json")))
            .await
            .expect("read backup page");
    assert_eq!(
        backup_page_str, original_page_str,
        "backup-v1/pages/<uuid>.json must be byte-for-byte identical to the original v1 file \
         (reserialized content with different key order or whitespace must FAIL)"
    );
}

/// RF-029: a v2-only workfile DOES trigger migration (v2→v3) — `migrated_from`
/// is `Some(2)`, the persistence task writes v3 files, and `.backup-v2/`
/// is created with the original v2 contents byte-for-byte. `.backup-v1/` must
/// NOT be created (the original was v2, not v1).
#[tokio::test]
async fn test_v2_workfile_triggers_v3_migration() {
    use sigil_core::CURRENT_SCHEMA_VERSION;
    use sigil_server::persistence::SAVE_DEBOUNCE_MS;

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
    let manifest_str = serde_json::to_string_pretty(&manifest).expect("serialize");
    tokio::fs::write(workfile_path.join("manifest.json"), &manifest_str)
        .await
        .expect("write manifest");

    // v2 page (no text nodes — no font migration needed, but still v2→v3 bump).
    let page_json = serde_json::json!({
        "schema_version": 2,
        "id": page_uuid.to_string(),
        "name": "Page",
        "nodes": [],
        "transitions": []
    });
    let page_str = page_json.to_string();
    tokio::fs::write(pages_dir.join(format!("{page_uuid}.json")), &page_str)
        .await
        .expect("write page");

    // Capture exact on-disk bytes BEFORE migration for byte-for-byte backup
    // comparison (CLAUDE.md §4 byte-for-byte contract).
    let original_manifest_str = tokio::fs::read_to_string(workfile_path.join("manifest.json"))
        .await
        .expect("read original manifest before migration");
    let original_page_str = tokio::fs::read_to_string(
        workfile_path
            .join("pages")
            .join(format!("{page_uuid}.json")),
    )
    .await
    .expect("read original page before migration");

    let loaded = load_workfile(&workfile_path)
        .await
        .expect("load v2 workfile");
    assert_eq!(
        loaded.migrated_from,
        Some(2),
        "v2 workfile must signal migrated_from = Some(2) (v2->v3 migration)"
    );

    // Construct an empty ServerState, register session + persistence with
    // migrated_from = Some(2) — this arms a first forced save.
    let migrated_from = loaded.migrated_from;
    let document = loaded.document;
    let state = ServerState::new_empty();
    let session_id = state
        .app
        .open_session_with(&workfile_path, move |_p| {
            Ok::<_, std::convert::Infallible>(document)
        })
        .expect("register session");
    let session = state.app.sessions.get(session_id).expect("session present");
    state.persistence.register(session, migrated_from);

    // Wait for the debounce window to elapse + a margin for the write.
    sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 300)).await;

    // Assert the live manifest is now v3.
    let live_manifest_str = tokio::fs::read_to_string(workfile_path.join("manifest.json"))
        .await
        .expect("read live manifest after migration");
    let live_manifest: serde_json::Value =
        serde_json::from_str(&live_manifest_str).expect("parse live manifest");
    assert_eq!(
        live_manifest["schema_version"], CURRENT_SCHEMA_VERSION,
        "live manifest must be v{CURRENT_SCHEMA_VERSION} after v2->v3 migration, got: {live_manifest_str}"
    );

    // Assert .backup-v2/ exists and files are byte-for-byte equal to the
    // original v2 files (CLAUDE.md §4 byte-for-byte contract: assert_eq! on
    // raw strings, not JSON field comparison — a reserialized backup must FAIL).
    let backup_v2 = workfile_path.join(".backup-v2");
    assert!(
        tokio::fs::metadata(&backup_v2).await.is_ok(),
        ".backup-v2/ directory must be created when migrating from v2"
    );

    let backup_manifest_str = tokio::fs::read_to_string(backup_v2.join("manifest.json"))
        .await
        .expect("read backup-v2 manifest");
    assert_eq!(
        backup_manifest_str, original_manifest_str,
        "backup-v2/manifest.json must be byte-for-byte identical to the original v2 file \
         (reserialized content with different key order or whitespace must FAIL)"
    );

    let backup_page_str =
        tokio::fs::read_to_string(backup_v2.join("pages").join(format!("{page_uuid}.json")))
            .await
            .expect("read backup-v2 page");
    assert_eq!(
        backup_page_str, original_page_str,
        "backup-v2/pages/<uuid>.json must be byte-for-byte identical to the original v2 file \
         (reserialized content with different key order or whitespace must FAIL)"
    );

    // Assert .backup-v1/ was NOT created (the original was v2, not v1).
    let backup_v1 = workfile_path.join(".backup-v1");
    assert!(
        tokio::fs::metadata(&backup_v1).await.is_err(),
        ".backup-v1/ must not exist when migrating from v2"
    );
}
