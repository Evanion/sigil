//! Integration test: end-to-end v2 → v3 workfile migration (font table).
//!
//! Background:
//!
//! The v2→v3 migration converts `kind.text_style.font_family` (a plain string)
//! into `kind.text_style.font_entry` (a deterministic UUID derived via v5 from
//! the family name) and populates the document's `FontTable` with
//! `SystemReference` entries for each migrated family.
//!
//! This test wires the whole pipeline end-to-end and asserts the §10 contract:
//! (a) `load_workfile` succeeds; the text node has `font_entry` referencing
//!     a `SystemReference` "Roboto" entry in `doc.font_table()`.
//! (b) After the post-load persistence tick the on-disk `manifest.json` has
//!     `schema_version == 3` and `fonts` contains the Roboto entry; the page
//!     file is v3 with `font_entry` (not `font_family`).
//! (c) `.backup-v2/` exists and its contents are byte-for-byte identical to
//!     the original v2 fixture files.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sigil_core::CURRENT_SCHEMA_VERSION;
use sigil_core::migrations::FONT_MIGRATION_NAMESPACE;
use sigil_server::persistence::SAVE_DEBOUNCE_MS;
use sigil_server::state::ServerState;
use sigil_server::workfile::load_workfile;
use tokio::time::sleep;
use uuid::Uuid;

/// Path to the checked-in v2 fixture workfile.
fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/workfiles/v2-fonts.sigil")
}

/// UUID of the page in the fixture (must match the fixture manifest).
const PAGE_UUID_STR: &str = "a1000000-0000-0000-0000-000000000001";
/// UUID of the text node in the fixture.
const NODE_UUID_STR: &str = "b2000000-0000-0000-0000-000000000001";
/// The family name used in the fixture.
const ROBOTO_FAMILY: &str = "Roboto";

/// Copies the fixture workfile to a temp directory so each test run is
/// isolated and the checked-in fixture is not mutated.
async fn copy_fixture_to_temp(fixture: &Path, dest: &Path) {
    let pages_src = fixture.join("pages");
    let pages_dst = dest.join("pages");
    tokio::fs::create_dir_all(&pages_dst)
        .await
        .expect("create temp pages dir");

    // Copy manifest.json
    tokio::fs::copy(fixture.join("manifest.json"), dest.join("manifest.json"))
        .await
        .expect("copy manifest.json");

    // Copy each page file
    let mut entries = tokio::fs::read_dir(&pages_src)
        .await
        .expect("read fixture pages/");
    while let Some(entry) = entries.next_entry().await.expect("read dir entry") {
        let src_path = entry.path();
        if src_path.extension().and_then(|e| e.to_str()) == Some("json") {
            let name = src_path.file_name().expect("file name");
            tokio::fs::copy(&src_path, pages_dst.join(name))
                .await
                .expect("copy page file");
        }
    }
}

/// RF-029 (v2→v3): end-to-end pipeline test.
///
/// Loads a v2 workfile with a text node carrying `font_family: "Roboto"`,
/// constructs a ServerState, registers session + persistence (which arms the
/// migrated save), waits for the debounced flush, and asserts:
/// - `LoadedWorkfile.migrated_from == Some(2)`.
/// - The loaded document's text node has a `font_entry` referencing a
///   `SystemReference` "Roboto" entry in `doc.font_table()`.
/// - The on-disk `manifest.json` has `schema_version == 3` and the `fonts`
///   array contains the Roboto entry.
/// - The on-disk page file has `schema_version == 3` and `font_entry` (not
///   `font_family`) in its text node's `text_style`.
/// - `.backup-v2/manifest.json` and `.backup-v2/pages/<uuid>.json` exist
///   and are byte-for-byte identical to the original v2 fixture files.
#[tokio::test]
async fn test_v2_font_workfile_full_migration_pipeline() {
    assert_eq!(
        CURRENT_SCHEMA_VERSION, 3,
        "this test pins the migration target at v3; revisit if the schema bumps"
    );

    let dir = tempfile::tempdir().expect("create temp dir");
    let workfile_path: PathBuf = dir.path().join("v2-fonts.sigil");

    // (1) Copy the checked-in v2 fixture to a temp dir so the fixture is not
    //     mutated and the test is isolated.
    copy_fixture_to_temp(&fixture_path(), &workfile_path).await;

    // (2) Load it through the public server entrypoint.
    let loaded = load_workfile(&workfile_path)
        .await
        .expect("load v2-fonts workfile");

    // (a) migrated_from must be Some(2) — the page was at schema v2.
    assert_eq!(
        loaded.migrated_from,
        Some(2),
        "v2 workfile with font_family must produce migrated_from = Some(2)"
    );

    // (a) The loaded document's font table must contain a SystemReference entry
    //     for "Roboto", keyed by the deterministic v5 UUID.
    let roboto_uuid = Uuid::new_v5(&FONT_MIGRATION_NAMESPACE, ROBOTO_FAMILY.as_bytes());
    {
        let doc = &loaded.document;
        let entry = doc
            .font_table()
            .get(roboto_uuid)
            .expect("font table must contain a Roboto entry after migration");
        assert_eq!(
            entry.family(),
            ROBOTO_FAMILY,
            "entry family must be 'Roboto'"
        );
        assert_eq!(
            entry.source(),
            &sigil_core::FontSource::SystemReference,
            "migrated entry must be SystemReference"
        );
    }

    // (3) Register session + persistence, wait for the forced migrated save.
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

    // Wait for debounce + margin.
    sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 300)).await;

    // (b) Assert the live manifest is now v3 and contains the Roboto font entry.
    let live_manifest_str = tokio::fs::read_to_string(workfile_path.join("manifest.json"))
        .await
        .expect("read live manifest after migration");
    let live_manifest: serde_json::Value =
        serde_json::from_str(&live_manifest_str).expect("parse live manifest");
    assert_eq!(
        live_manifest["schema_version"], 3,
        "live manifest must be v3 after migration, got: {live_manifest_str}"
    );
    // The `fonts` array in the manifest must contain the Roboto entry.
    let fonts_arr = live_manifest["fonts"]
        .as_array()
        .expect("live manifest must have fonts array");
    let roboto_entry = fonts_arr
        .iter()
        .find(|e| e["family"].as_str() == Some(ROBOTO_FAMILY))
        .expect("live manifest fonts must include Roboto after migration");
    assert_eq!(
        roboto_entry["id"]
            .as_str()
            .expect("font entry must have id"),
        roboto_uuid.to_string(),
        "Roboto font entry id must match deterministic v5 UUID"
    );

    // (b) Assert the live page is now v3 with `font_entry` (not `font_family`).
    let page_uuid = Uuid::parse_str(PAGE_UUID_STR).expect("parse page UUID");
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
        live_page["schema_version"], 3,
        "live page must be v3 after migration, got: {live_page_str}"
    );
    // The text node's `text_style` must have `font_entry`, not `font_family`.
    let node_uuid = Uuid::parse_str(NODE_UUID_STR).expect("parse node UUID");
    let text_node = live_page["nodes"]
        .as_array()
        .expect("nodes array")
        .iter()
        .find(|n| n["id"].as_str() == Some(&node_uuid.to_string()))
        .expect("text node must be in live page");
    let ts = &text_node["kind"]["text_style"];
    assert!(
        ts.get("font_family").is_none(),
        "font_family must be removed after v2→v3 migration, got: {ts}"
    );
    assert_eq!(
        ts["font_entry"]
            .as_str()
            .expect("font_entry must be present"),
        roboto_uuid.to_string(),
        "text node font_entry must be the deterministic Roboto UUID"
    );

    // (c) Assert .backup-v2/ exists and files are byte-for-byte equal to the
    //     original fixture (CLAUDE.md §4 Schema Migration Persistence Contract).
    let backup_root = workfile_path.join(".backup-v2");
    assert!(
        tokio::fs::metadata(&backup_root).await.is_ok(),
        ".backup-v2/ directory must be created when migrating from v2"
    );

    // Read the original fixture bytes (before the temp copy was mutated).
    let orig_manifest = tokio::fs::read_to_string(fixture_path().join("manifest.json"))
        .await
        .expect("read original fixture manifest");
    let backup_manifest = tokio::fs::read_to_string(backup_root.join("manifest.json"))
        .await
        .expect("read backup-v2 manifest");
    assert_eq!(
        backup_manifest, orig_manifest,
        "backup-v2/manifest.json must be byte-for-byte identical to the original v2 fixture"
    );

    let orig_page = tokio::fs::read_to_string(
        fixture_path()
            .join("pages")
            .join(format!("{page_uuid}.json")),
    )
    .await
    .expect("read original fixture page");
    let backup_page =
        tokio::fs::read_to_string(backup_root.join("pages").join(format!("{page_uuid}.json")))
            .await
            .expect("read backup-v2 page");
    assert_eq!(
        backup_page, orig_page,
        "backup-v2/pages/<uuid>.json must be byte-for-byte identical to the original v2 fixture"
    );
}
