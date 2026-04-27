//! Integration tests for `sigil_cli::migrate::run`.
//!
//! These exercise the migrate subcommand as a library, matching the contract
//! enforced by the binary. Each test lays down a tempdir-backed `.sigil/`
//! tree, invokes `run`, and inspects on-disk state plus the returned
//! `MigrateOutcome`.

use std::fs;
use std::path::Path;

use serde_json::{Value, json};

#[path = "../src/migrate.rs"]
mod migrate;

fn write_manifest(workfile: &Path, schema_version: u32, page_uuid: &str) {
    let manifest = json!({
        "schema_version": schema_version,
        "name": "Doc",
        "page_order": [page_uuid],
    });
    fs::write(
        workfile.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
}

fn write_v1_rectangle_page(workfile: &Path, page_uuid: &str) {
    let pages = workfile.join("pages");
    fs::create_dir_all(&pages).unwrap();
    let page = json!({
        "schema_version": 1,
        "id": page_uuid,
        "name": "Page 1",
        "nodes": [{
            "id": "00000000-0000-0000-0000-000000000099",
            "kind": { "type": "rectangle", "corner_radii": [4.0, 8.0, 12.0, 16.0] },
            "name": "Rect",
            "parent": null,
            "children": [],
            "transform": {},
            "style": {},
            "constraints": {},
            "visible": true,
            "locked": false
        }],
        "transitions": []
    });
    fs::write(
        pages.join(format!("{page_uuid}.json")),
        serde_json::to_string_pretty(&page).unwrap(),
    )
    .unwrap();
}

fn write_v2_rectangle_page(workfile: &Path, page_uuid: &str) {
    let pages = workfile.join("pages");
    fs::create_dir_all(&pages).unwrap();
    let page = json!({
        "schema_version": 2,
        "id": page_uuid,
        "name": "Page 1",
        "nodes": [{
            "id": "00000000-0000-0000-0000-000000000099",
            "kind": {
                "type": "rectangle",
                "corners": [
                    { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                    { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                    { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                    { "type": "round", "radii": { "x": 0.0, "y": 0.0 } }
                ]
            },
            "name": "Rect",
            "parent": null,
            "children": [],
            "transform": {},
            "style": {},
            "constraints": {},
            "visible": true,
            "locked": false
        }],
        "transitions": []
    });
    fs::write(
        pages.join(format!("{page_uuid}.json")),
        serde_json::to_string_pretty(&page).unwrap(),
    )
    .unwrap();
}

fn write_malformed_v1_page(workfile: &Path, page_uuid: &str) {
    let pages = workfile.join("pages");
    fs::create_dir_all(&pages).unwrap();
    // String corner_radii — rejected by migrate_to_v2.
    let page = json!({
        "schema_version": 1,
        "id": page_uuid,
        "name": "Page",
        "nodes": [{
            "id": "00000000-0000-0000-0000-000000000099",
            "kind": { "type": "rectangle", "corner_radii": "not-an-array" },
            "name": "Bad",
            "parent": null,
            "children": [],
            "transform": {},
            "style": {},
            "constraints": {},
            "visible": true,
            "locked": false
        }],
        "transitions": []
    });
    fs::write(
        pages.join(format!("{page_uuid}.json")),
        serde_json::to_string_pretty(&page).unwrap(),
    )
    .unwrap();
}

#[test]
fn test_migrate_run_happy_path_writes_v2_and_creates_backup() {
    let tmp = tempfile::tempdir().unwrap();
    let workfile = tmp.path().join("doc.sigil");
    fs::create_dir_all(&workfile).unwrap();
    let page_uuid = "00000000-0000-0000-0000-000000000001";
    write_manifest(&workfile, 1, page_uuid);
    write_v1_rectangle_page(&workfile, page_uuid);

    let mut buf = Vec::new();
    let outcome = migrate::run(&workfile, false, &mut buf).expect("migrate succeeds");
    assert!(!outcome.had_failures(), "no failures expected");
    assert_eq!(outcome.migrated, 1);
    assert!(!outcome.already_current);

    // Manifest now reports current schema version.
    let manifest_text = fs::read_to_string(workfile.join("manifest.json")).unwrap();
    let manifest: Value = serde_json::from_str(&manifest_text).unwrap();
    assert_eq!(
        manifest["schema_version"].as_u64().unwrap(),
        u64::from(agent_designer_core::CURRENT_SCHEMA_VERSION)
    );

    // Page now has `corners`, no `corner_radii`.
    let page_text =
        fs::read_to_string(workfile.join("pages").join(format!("{page_uuid}.json"))).unwrap();
    let page: Value = serde_json::from_str(&page_text).unwrap();
    let kind = &page["nodes"][0]["kind"];
    assert!(kind.get("corner_radii").is_none(), "legacy field removed");
    let corners = kind["corners"].as_array().expect("corners array");
    assert_eq!(corners.len(), 4);
    assert_eq!(corners[0]["radii"]["x"].as_f64().unwrap(), 4.0);

    // Backup directory contains the v1 originals.
    let backup_root = workfile.join(".backup-v1");
    assert!(backup_root.is_dir(), "backup dir must exist");
    let backup_manifest =
        fs::read_to_string(backup_root.join("manifest.json")).expect("backup manifest");
    let backup_manifest_value: Value = serde_json::from_str(&backup_manifest).unwrap();
    assert_eq!(backup_manifest_value["schema_version"].as_u64().unwrap(), 1);
    let backup_page =
        fs::read_to_string(backup_root.join("pages").join(format!("{page_uuid}.json"))).unwrap();
    let backup_page_value: Value = serde_json::from_str(&backup_page).unwrap();
    assert_eq!(
        backup_page_value["nodes"][0]["kind"]["corner_radii"]
            .as_array()
            .map(Vec::len),
        Some(4),
        "backup must preserve legacy field"
    );
}

#[test]
fn test_migrate_run_already_v2_is_noop() {
    let tmp = tempfile::tempdir().unwrap();
    let workfile = tmp.path().join("doc.sigil");
    fs::create_dir_all(&workfile).unwrap();
    let page_uuid = "00000000-0000-0000-0000-000000000002";
    write_manifest(
        &workfile,
        agent_designer_core::CURRENT_SCHEMA_VERSION,
        page_uuid,
    );
    write_v2_rectangle_page(&workfile, page_uuid);

    let mut buf = Vec::new();
    let outcome = migrate::run(&workfile, false, &mut buf).expect("noop succeeds");
    assert!(outcome.already_current);
    assert_eq!(outcome.migrated, 0);
    assert_eq!(outcome.failed, 0);

    let stdout = String::from_utf8(buf).unwrap();
    assert!(
        stdout.contains("Already at v"),
        "stdout should announce noop, got: {stdout}"
    );

    assert!(
        !workfile.join(".backup-v1").exists(),
        "no backup should be created for already-current workfile"
    );
}

#[test]
fn test_migrate_run_check_mode_does_not_write() {
    let tmp = tempfile::tempdir().unwrap();
    let workfile = tmp.path().join("doc.sigil");
    fs::create_dir_all(&workfile).unwrap();
    let page_uuid = "00000000-0000-0000-0000-000000000003";
    write_manifest(&workfile, 1, page_uuid);
    write_v1_rectangle_page(&workfile, page_uuid);

    let original_manifest = fs::read_to_string(workfile.join("manifest.json")).unwrap();
    let original_page =
        fs::read_to_string(workfile.join("pages").join(format!("{page_uuid}.json"))).unwrap();

    let mut buf = Vec::new();
    let outcome = migrate::run(&workfile, true, &mut buf).expect("check succeeds");
    assert!(!outcome.had_failures());

    // Files unchanged.
    assert_eq!(
        fs::read_to_string(workfile.join("manifest.json")).unwrap(),
        original_manifest,
        "manifest must be untouched in check mode"
    );
    assert_eq!(
        fs::read_to_string(workfile.join("pages").join(format!("{page_uuid}.json"))).unwrap(),
        original_page,
        "page must be untouched in check mode"
    );
    assert!(
        !workfile.join(".backup-v1").exists(),
        "no backup should be created in check mode"
    );
}

#[test]
fn test_migrate_run_malformed_page_reports_failure_and_leaves_manifest() {
    let tmp = tempfile::tempdir().unwrap();
    let workfile = tmp.path().join("doc.sigil");
    fs::create_dir_all(&workfile).unwrap();
    let page_uuid = "00000000-0000-0000-0000-000000000004";
    write_manifest(&workfile, 1, page_uuid);
    write_malformed_v1_page(&workfile, page_uuid);

    let mut buf = Vec::new();
    let outcome = migrate::run(&workfile, false, &mut buf).expect("run returns Ok with failure");
    assert!(outcome.had_failures(), "must report failure");
    assert_eq!(outcome.failed, 1);
    assert_eq!(outcome.migrated, 0);

    // Manifest schema_version unchanged.
    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(workfile.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["schema_version"].as_u64().unwrap(), 1);

    // No backup directory should exist when nothing was rewritten.
    assert!(
        !workfile.join(".backup-v1").exists(),
        "backup must not be created when migration aborts"
    );
}
