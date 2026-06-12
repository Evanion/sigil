//! Workfile schema migrations. Each public `migrate_to_vN` function
//! takes a `serde_json::Value` representing a `SerializedPage` at
//! version N-1 and returns it transformed to version N.
//!
//! # Migration cost (RF-039)
//!
//! Each `migrate_to_vN` function performs a single linear pass over the
//! parsed page's `nodes` array. Per-node work is O(1): inspect `kind`,
//! optionally read or write one or two fields, no nested recursion or per-node
//! allocation beyond the mutated fields. Total migration cost is therefore
//! O(n) in the number of nodes, bounded by the deserialization envelope
//! `MAX_FILE_SIZE` enforced in `serialize.rs`. There is no separate
//! per-migration size check because the page has already been parsed by
//! `deserialize_page_with_version` under that limit.

use std::collections::BTreeMap;

use serde_json::{Value, json};
use uuid::Uuid;

use crate::font::DEFAULT_FONT_ENTRY_ID;

/// Stable UUID namespace for v5 derivation of `FontEntryId`s during migration.
///
/// When migrating a v2 page (which carries `kind.text_style.font_family` as a
/// plain string) to v3 (which uses `kind.text_style.font_entry` as a UUID), we
/// derive the UUID deterministically from the family name using `Uuid::new_v5`
/// with this namespace. This guarantees:
///
/// - The same family name always produces the same `FontEntryId`.
/// - Two text nodes in different pages using the same family get the same UUID,
///   so the server can deduplicate when assembling the document font table.
/// - The UUID is distinct from `DEFAULT_FONT_ENTRY_ID` (which is a bespoke
///   sentinel, not a v5 derivation).
///
/// The value `0x5157_1700_CAFE_5AF0_DF04_7200_0000_0001` is an arbitrary
/// fixed constant chosen to avoid collisions with the `from_u128(1..=99)`
/// values used in unit tests throughout the codebase and with
/// `DEFAULT_FONT_ENTRY_ID`. No code should branch on this namespace's version
/// nibble.
pub const FONT_MIGRATION_NAMESPACE: Uuid =
    Uuid::from_u128(0x5157_1700_CAFE_5AF0_DF04_7200_0000_0001);

/// Errors that can occur while migrating a workfile from one schema version to another.
///
/// Migrations are best-effort coercions of well-formed older workfiles into the
/// current schema. When the legacy data is type-confused or otherwise malformed
/// in a way that cannot be defaulted safely, the migration returns one of these
/// errors rather than silently coercing to a default value (per CLAUDE.md
/// "No Silent Clamping of Invalid Input").
#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    /// A v1 rectangle's `corner_radii` field was present but malformed:
    /// not an array of four finite numbers.
    #[error(
        "rectangle node {node_id}: legacy `corner_radii` is malformed (expected array of 4 finite numbers), got {raw_value}"
    )]
    InvalidLegacyCornerRadii { node_id: String, raw_value: String },

    /// A v2 text node's `kind.text_style.font_family` field was present but
    /// was not a JSON string. A non-string `font_family` cannot be safely
    /// migrated to a UUID — the migration refuses rather than silently dropping
    /// or coercing the value (per CLAUDE.md §11 "Handlers Must Surface
    /// Validation Failures").
    #[error(
        "text node {node_id}: legacy `font_family` is malformed (expected a JSON string), got {raw_value}"
    )]
    MalformedFontFamily { node_id: String, raw_value: String },
}

/// Migrates a `SerializedPage` JSON blob from schema v1 to v2.
///
/// v1 → v2 changes:
/// - Rectangle: `corner_radii: [r0, r1, r2, r3]` → `corners: [{type:"round", radii:{x,y}}; 4]`
/// - Frame: gains `corners` field defaulted to `[{type:"round", radii:{x:0, y:0}}; 4]`
/// - Image: gains `corners` field defaulted to `[{type:"round", radii:{x:0, y:0}}; 4]`
/// - Other kinds unchanged.
///
/// Missing `corner_radii` on a v1 rectangle defaults to `[0,0,0,0]` (the legacy
/// rectangle shipped with this default before the field was added). A
/// present-but-malformed `corner_radii` (non-array, non-numeric element, wrong
/// arity, NaN, infinity) returns [`MigrationError::InvalidLegacyCornerRadii`].
///
/// Idempotent on already-v2 input (already-migrated node kinds are skipped).
///
/// # Errors
///
/// Returns [`MigrationError::InvalidLegacyCornerRadii`] if any v1 rectangle
/// has a present-but-malformed `corner_radii` field.
pub fn migrate_to_v2(mut page: Value) -> Result<Value, MigrationError> {
    page["schema_version"] = json!(2);

    let Some(nodes) = page.get_mut("nodes").and_then(Value::as_array_mut) else {
        return Ok(page);
    };

    for node in nodes.iter_mut() {
        let node_id = node
            .get("id")
            .and_then(Value::as_str)
            .map_or_else(|| "<unknown>".to_string(), String::from);
        let Some(kind) = node.get_mut("kind") else {
            continue;
        };
        let kind_type = kind.get("type").and_then(Value::as_str).map(String::from);
        // RF-041: this match dispatches on a free-form `serde_json::Value` string
        // (the legacy on-disk `kind.type` discriminator), not the typed `NodeKind`
        // enum, so exhaustiveness cannot be compiler-enforced. The set of v1
        // kind-type strings is closed and known: "rectangle", "frame", "image",
        // "ellipse", "path", "text", "group", "component_instance". The wildcard
        // arm intentionally covers the kinds that did NOT gain a `corners` field
        // in v1->v2 (ellipse, path, text, group, component_instance) and any
        // future or unknown kind strings, which are passed through unchanged for
        // forward compatibility. When introducing v2->v3 or later migrations,
        // re-enumerate the v1 kind strings explicitly if the new migration
        // touches additional kinds.
        match kind_type.as_deref() {
            Some("rectangle") => migrate_rectangle_kind(kind, &node_id)?,
            Some("frame" | "image") => migrate_frame_or_image_kind(kind),
            // ellipse, path, text, group, component_instance, or unknown.
            _ => {}
        }
    }

    Ok(page)
}

/// Migrates a `SerializedPage` JSON blob from schema v2 to v3.
///
/// v2 → v3 changes:
/// - Text nodes: `kind.text_style.font_family: "<family>"` is removed and
///   replaced with `kind.text_style.font_entry: "<uuid>"`, where the UUID is
///   derived deterministically from the family name using
///   `Uuid::new_v5(&FONT_MIGRATION_NAMESPACE, family.as_bytes())`.
/// - Text nodes with no `font_family` field have `font_entry` set to
///   `DEFAULT_FONT_ENTRY_ID` (the bundled Inter entry).
/// - Non-text nodes are passed through unchanged.
///
/// The `fonts` map accumulates the `(uuid → family)` pairs discovered during
/// the walk. The server uses this map to populate the document's `FontTable`
/// with `SystemReference` entries for all migrated families.
///
/// # Kind-string dispatch note (mirrors RF-041 comment in `migrate_to_v2`)
///
/// This match dispatches on a free-form `serde_json::Value` string (the
/// on-disk `kind.type` discriminator), not the typed `NodeKind` enum, so
/// exhaustiveness cannot be compiler-enforced. The only kind that carries
/// `text_style.font_family` in v2 is `"text"`. The set of v2 kind-type strings
/// is: "rectangle", "frame", "image", "ellipse", "path", "text", "group",
/// `"component_instance"`. All non-text kinds are passed through unchanged.
///
/// # Idempotence
///
/// A text node that already has `font_entry` and no `font_family` is left
/// untouched. This makes the function safe to call on already-v3 input.
///
/// # Errors
///
/// Returns [`MigrationError::MalformedFontFamily`] if any text node has a
/// `font_family` field that is present but is not a JSON string (e.g., a
/// number or object). An absent `font_family` is not an error; it defaults
/// to `DEFAULT_FONT_ENTRY_ID`.
pub fn migrate_to_v3(
    mut page: Value,
    fonts: &mut BTreeMap<Uuid, String>,
) -> Result<Value, MigrationError> {
    page["schema_version"] = json!(3);

    let Some(nodes) = page.get_mut("nodes").and_then(Value::as_array_mut) else {
        return Ok(page);
    };

    for node in nodes.iter_mut() {
        let node_id = node
            .get("id")
            .and_then(Value::as_str)
            .map_or_else(|| "<unknown>".to_string(), String::from);
        let Some(kind) = node.get_mut("kind") else {
            continue;
        };
        let kind_type = kind.get("type").and_then(Value::as_str).map(String::from);
        // Only "text" nodes carry `text_style.font_family` in v2. All other
        // kind strings (rectangle, frame, image, ellipse, path, group,
        // component_instance) are passed through unchanged.
        if kind_type.as_deref() != Some("text") {
            continue;
        }
        migrate_text_kind(kind, &node_id, fonts)?;
    }

    Ok(page)
}

/// Migrates a single `"text"` node's `kind` object from v2 to v3.
///
/// Removes `text_style.font_family` and inserts `text_style.font_entry`.
fn migrate_text_kind(
    kind: &mut Value,
    node_id: &str,
    fonts: &mut BTreeMap<Uuid, String>,
) -> Result<(), MigrationError> {
    // If `font_entry` is already present and `font_family` is absent, this
    // node was already migrated — leave it untouched.
    if let Some(text_style) = kind.get("text_style")
        && text_style.get("font_entry").is_some()
        && text_style.get("font_family").is_none()
    {
        return Ok(());
    }

    let Some(text_style) = kind.get_mut("text_style").and_then(Value::as_object_mut) else {
        // No text_style at all — nothing to migrate.
        return Ok(());
    };

    let font_entry_uuid = match text_style.remove("font_family") {
        // `font_family` absent: default to the bundled Inter entry.
        None => DEFAULT_FONT_ENTRY_ID,

        // `font_family` is a JSON string: derive a deterministic UUID from it.
        Some(Value::String(family)) => {
            let uuid = Uuid::new_v5(&FONT_MIGRATION_NAMESPACE, family.as_bytes());
            fonts.insert(uuid, family);
            uuid
        }

        // `font_family` is present but not a string: malformed — refuse.
        Some(other) => {
            return Err(MigrationError::MalformedFontFamily {
                node_id: node_id.to_string(),
                raw_value: other.to_string(),
            });
        }
    };

    // Insert `font_entry` as a UUID string (matches `FontEntryId`'s serde
    // representation, which serializes via the standard `uuid::Uuid` impl as
    // a hyphenated lowercase UUID string).
    text_style.insert("font_entry".into(), json!(font_entry_uuid.to_string()));

    Ok(())
}

fn migrate_rectangle_kind(kind: &mut Value, node_id: &str) -> Result<(), MigrationError> {
    if kind.get("corners").is_some() {
        return Ok(()); // already migrated
    }

    // Remove the legacy field. Missing entirely is OK and defaults to zeros
    // (legacy rectangles shipped without explicit corner_radii before the field
    // was added).
    let legacy = kind.as_object_mut().and_then(|o| o.remove("corner_radii"));

    let radii: [f64; 4] = match legacy {
        None | Some(Value::Null) => [0.0; 4],
        Some(Value::Array(arr)) => {
            // Must be exactly 4 elements, each a finite number.
            if arr.len() != 4 {
                return Err(MigrationError::InvalidLegacyCornerRadii {
                    node_id: node_id.to_string(),
                    raw_value: Value::Array(arr).to_string(),
                });
            }
            let mut out = [0.0_f64; 4];
            for (i, slot) in out.iter_mut().enumerate() {
                let n =
                    arr[i]
                        .as_f64()
                        .ok_or_else(|| MigrationError::InvalidLegacyCornerRadii {
                            node_id: node_id.to_string(),
                            raw_value: Value::Array(arr.clone()).to_string(),
                        })?;
                if !n.is_finite() {
                    return Err(MigrationError::InvalidLegacyCornerRadii {
                        node_id: node_id.to_string(),
                        raw_value: Value::Array(arr.clone()).to_string(),
                    });
                }
                *slot = n;
            }
            out
        }
        Some(other) => {
            return Err(MigrationError::InvalidLegacyCornerRadii {
                node_id: node_id.to_string(),
                raw_value: other.to_string(),
            });
        }
    };

    let corners: Vec<Value> = radii
        .iter()
        .map(|&r| json!({ "type": "round", "radii": { "x": r, "y": r } }))
        .collect();

    if let Some(obj) = kind.as_object_mut() {
        obj.insert("corners".into(), Value::Array(corners));
    }
    Ok(())
}

fn migrate_frame_or_image_kind(kind: &mut Value) {
    if kind.get("corners").is_some() {
        return; // already migrated
    }
    let default_corner = json!({ "type": "round", "radii": { "x": 0.0, "y": 0.0 } });
    let corners = vec![default_corner; 4];
    if let Some(obj) = kind.as_object_mut() {
        obj.insert("corners".into(), Value::Array(corners));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_rectangle_page() -> Value {
        json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page 1",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
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
        })
    }

    #[test]
    fn test_migrate_v1_to_v2_converts_rectangle_corner_radii_to_corners() {
        let migrated = migrate_to_v2(legacy_rectangle_page()).expect("migrate v1");
        assert_eq!(migrated["schema_version"], 2);
        let kind = &migrated["nodes"][0]["kind"];
        assert!(
            kind.get("corner_radii").is_none(),
            "legacy field must be removed"
        );
        let corners = kind.get("corners").expect("corners field present");
        let arr = corners.as_array().expect("corners is array");
        assert_eq!(arr.len(), 4);
        assert_eq!(arr[0]["type"], "round");
        assert_eq!(arr[0]["radii"]["x"], 4.0);
        assert_eq!(arr[0]["radii"]["y"], 4.0);
        assert_eq!(arr[1]["radii"]["x"], 8.0);
        assert_eq!(arr[2]["radii"]["x"], 12.0);
        assert_eq!(arr[3]["radii"]["x"], 16.0);
    }

    #[test]
    fn test_migrate_v1_to_v2_defaults_frame_corners() {
        let page = json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "P",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "frame", "layout": null },
                "name": "F",
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
        let migrated = migrate_to_v2(page).expect("migrate v1 frame");
        let kind = &migrated["nodes"][0]["kind"];
        let corners = kind["corners"].as_array().expect("corners default");
        assert_eq!(corners.len(), 4);
        for c in corners {
            assert_eq!(c["type"], "round");
            assert_eq!(c["radii"]["x"], 0.0);
            assert_eq!(c["radii"]["y"], 0.0);
        }
    }

    #[test]
    fn test_migrate_v1_to_v2_defaults_image_corners() {
        let page = json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "P",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "image", "asset_ref": "a1" },
                "name": "I",
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
        let migrated = migrate_to_v2(page).expect("migrate v1 image");
        assert_eq!(
            migrated["nodes"][0]["kind"]["corners"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
    }

    #[test]
    fn test_migrate_v1_to_v2_leaves_non_rect_kinds_unchanged() {
        let page = json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "P",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "text", "content": "hi" },
                "name": "T",
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
        let migrated = migrate_to_v2(page).expect("migrate v1 text");
        let kind = &migrated["nodes"][0]["kind"];
        assert!(
            kind.get("corners").is_none(),
            "text kind must not gain corners"
        );
        assert_eq!(kind["type"], "text");
    }

    #[test]
    fn test_migrate_v1_to_v2_is_idempotent_on_already_new_schema() {
        let v2_page = json!({
            "schema_version": 2,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "P",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": {
                    "type": "rectangle",
                    "corners": [
                        { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                        { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                        { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                        { "type": "round", "radii": { "x": 0.0, "y": 0.0 } }
                    ]
                },
                "name": "R",
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
        let migrated = migrate_to_v2(v2_page.clone()).expect("idempotent on v2");
        assert_eq!(migrated, v2_page);
    }

    // ── RF-005: malformed legacy corner_radii must error, not silently coerce ──

    fn legacy_rectangle_with_radii(corner_radii: &Value) -> Value {
        json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page 1",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "rectangle", "corner_radii": corner_radii.clone() },
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
        })
    }

    #[test]
    fn test_migrate_v2_rejects_string_corner_radii() {
        let page = legacy_rectangle_with_radii(&json!("broken"));
        let result = migrate_to_v2(page);
        match result {
            Err(MigrationError::InvalidLegacyCornerRadii { node_id, raw_value }) => {
                assert_eq!(node_id, "00000000-0000-0000-0000-000000000002");
                assert!(
                    raw_value.contains("broken"),
                    "raw_value should include offending JSON, got: {raw_value}"
                );
            }
            other => panic!("expected InvalidLegacyCornerRadii, got: {other:?}"),
        }
    }

    #[test]
    fn test_migrate_v2_rejects_null_in_corner_radii() {
        // A non-numeric element inside the array (one slot is null).
        let page = legacy_rectangle_with_radii(&json!([1.0, null, 3.0, 4.0]));
        let result = migrate_to_v2(page);
        assert!(
            matches!(result, Err(MigrationError::InvalidLegacyCornerRadii { .. })),
            "expected InvalidLegacyCornerRadii, got: {result:?}"
        );
    }

    #[test]
    fn test_migrate_v2_rejects_wrong_arity_corner_radii() {
        // Only three elements instead of four.
        let page = legacy_rectangle_with_radii(&json!([1.0, 2.0, 3.0]));
        let result = migrate_to_v2(page);
        assert!(
            matches!(result, Err(MigrationError::InvalidLegacyCornerRadii { .. })),
            "expected InvalidLegacyCornerRadii for 3-element array, got: {result:?}"
        );
    }

    #[test]
    fn test_migrate_v2_rejects_non_finite_corner_radii() {
        // serde_json represents NaN as Null when serialized, so we test
        // explicitly via the array path: any Number that fails as_f64 finiteness.
        // serde_json's Number type rejects NaN/inf at parse time, but we still
        // guard against it for defense-in-depth via the finiteness check.
        // Use a stringified number instead — should be rejected.
        let page = legacy_rectangle_with_radii(&json!([1.0, 2.0, 3.0, "4.0"]));
        let result = migrate_to_v2(page);
        assert!(
            matches!(result, Err(MigrationError::InvalidLegacyCornerRadii { .. })),
            "expected InvalidLegacyCornerRadii for string element, got: {result:?}"
        );
    }

    #[test]
    fn test_migrate_v2_accepts_missing_corner_radii_as_zeros() {
        // A v1 rectangle with no `corner_radii` field at all is acceptable —
        // earlier rectangles shipped without explicit radii and should default
        // to zeros (not error).
        let page = json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page 1",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "rectangle" },
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
        let migrated = migrate_to_v2(page).expect("missing field should default");
        let corners = migrated["nodes"][0]["kind"]["corners"]
            .as_array()
            .expect("corners array");
        assert_eq!(corners.len(), 4);
        for c in corners {
            assert_eq!(c["radii"]["x"], 0.0);
            assert_eq!(c["radii"]["y"], 0.0);
        }
    }

    #[test]
    fn test_migrate_v2_accepts_explicit_null_corner_radii_as_zeros() {
        // Explicit null is treated like absence — defaults to zeros, no error.
        // (Legacy producers occasionally serialize Option<None> as null.)
        let page = legacy_rectangle_with_radii(&Value::Null);
        let migrated = migrate_to_v2(page).expect("null should default");
        let corners = migrated["nodes"][0]["kind"]["corners"]
            .as_array()
            .expect("corners array");
        assert_eq!(corners.len(), 4);
        for c in corners {
            assert_eq!(c["radii"]["x"], 0.0);
        }
    }

    // ── migrate_to_v3 tests ───────────────────────────────────────────────

    /// Builds a minimal v2 page containing the given text nodes (as JSON `kind` objects).
    fn v2_page_with_text_nodes(text_nodes: &[(&str, Value)]) -> Value {
        let nodes: Vec<Value> = text_nodes
            .iter()
            .map(|(id, kind)| {
                json!({
                    "id": id,
                    "kind": kind,
                    "name": "Text",
                    "parent": null,
                    "children": [],
                    "transform": {},
                    "style": {},
                    "constraints": {},
                    "visible": true,
                    "locked": false
                })
            })
            .collect();
        json!({
            "schema_version": 2,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page",
            "nodes": nodes,
            "transitions": []
        })
    }

    #[test]
    fn test_migrate_v2_to_v3_converts_font_family_to_font_entry() {
        let page = v2_page_with_text_nodes(&[
            (
                "00000000-0000-0000-0000-000000000002",
                json!({
                    "type": "text",
                    "content": "Hello",
                    "text_style": { "font_family": "Roboto" }
                }),
            ),
            (
                "00000000-0000-0000-0000-000000000003",
                json!({
                    "type": "text",
                    "content": "World",
                    "text_style": { "font_family": "Roboto" }
                }),
            ),
            (
                "00000000-0000-0000-0000-000000000004",
                json!({
                    "type": "text",
                    "content": "Other",
                    "text_style": { "font_family": "Open Sans" }
                }),
            ),
        ]);

        let mut fonts = BTreeMap::new();
        let migrated = migrate_to_v3(page, &mut fonts).expect("migrate v2->v3");

        // Schema version bumped
        assert_eq!(migrated["schema_version"], 3);

        // `font_family` removed from all text nodes; `font_entry` inserted.
        for node in migrated["nodes"].as_array().expect("nodes array") {
            let ts = &node["kind"]["text_style"];
            assert!(
                ts.get("font_family").is_none(),
                "font_family must be removed"
            );
            let entry = ts["font_entry"].as_str().expect("font_entry string");
            assert!(
                !entry.is_empty(),
                "font_entry must be non-empty UUID string"
            );
        }

        // Both Roboto nodes must get the SAME font_entry UUID.
        let entry_0 = migrated["nodes"][0]["kind"]["text_style"]["font_entry"]
            .as_str()
            .unwrap();
        let entry_1 = migrated["nodes"][1]["kind"]["text_style"]["font_entry"]
            .as_str()
            .unwrap();
        let entry_2 = migrated["nodes"][2]["kind"]["text_style"]["font_entry"]
            .as_str()
            .unwrap();
        assert_eq!(entry_0, entry_1, "duplicate family must produce same UUID");
        assert_ne!(
            entry_0, entry_2,
            "different families must produce different UUIDs"
        );

        // fonts map must contain exactly 2 entries (Roboto + Open Sans).
        assert_eq!(fonts.len(), 2, "expected 2 distinct families");
        let uuid_roboto: Uuid = entry_0.parse().expect("valid UUID");
        assert_eq!(fonts[&uuid_roboto], "Roboto");
        let uuid_open_sans: Uuid = entry_2.parse().expect("valid UUID");
        assert_eq!(fonts[&uuid_open_sans], "Open Sans");
    }

    #[test]
    fn test_migrate_v2_to_v3_absent_font_family_defaults_to_inter() {
        // A text node with no `font_family` in its `text_style` should get
        // `font_entry = DEFAULT_FONT_ENTRY_ID` (the bundled Inter entry).
        let page = v2_page_with_text_nodes(&[(
            "00000000-0000-0000-0000-000000000002",
            json!({
                "type": "text",
                "content": "Hello",
                "text_style": {}
            }),
        )]);

        let mut fonts = BTreeMap::new();
        let migrated = migrate_to_v3(page, &mut fonts).expect("migrate");

        let entry = migrated["nodes"][0]["kind"]["text_style"]["font_entry"]
            .as_str()
            .expect("font_entry");
        let entry_uuid: Uuid = entry.parse().expect("valid UUID");
        assert_eq!(
            entry_uuid, DEFAULT_FONT_ENTRY_ID,
            "absent font_family must produce DEFAULT_FONT_ENTRY_ID"
        );
        // Absent font_family → no entry added to the fonts map.
        assert!(
            fonts.is_empty(),
            "no families should be in the map when defaulting to Inter"
        );
    }

    #[test]
    fn test_migrate_v2_to_v3_rejects_non_string_font_family() {
        // A text node with `font_family: 42` (a number) must produce
        // `MigrationError::MalformedFontFamily`, not silently coerce.
        let page = v2_page_with_text_nodes(&[(
            "00000000-0000-0000-0000-000000000002",
            json!({
                "type": "text",
                "content": "Bad",
                "text_style": { "font_family": 42 }
            }),
        )]);

        let mut fonts = BTreeMap::new();
        let result = migrate_to_v3(page, &mut fonts);
        match result {
            Err(MigrationError::MalformedFontFamily { node_id, raw_value }) => {
                assert_eq!(node_id, "00000000-0000-0000-0000-000000000002");
                assert!(
                    raw_value.contains("42"),
                    "raw_value should include offending JSON, got: {raw_value}"
                );
            }
            other => panic!("expected MalformedFontFamily, got: {other:?}"),
        }
    }

    #[test]
    fn test_migrate_v2_to_v3_is_idempotent_on_already_migrated_text_node() {
        // A text node that already has `font_entry` and no `font_family` is
        // left untouched (idempotent on v3 input).
        let existing_uuid = "11111111-1111-1111-1111-111111111111";
        let page = v2_page_with_text_nodes(&[(
            "00000000-0000-0000-0000-000000000002",
            json!({
                "type": "text",
                "content": "Already migrated",
                "text_style": { "font_entry": existing_uuid }
            }),
        )]);

        let mut fonts = BTreeMap::new();
        let migrated = migrate_to_v3(page, &mut fonts).expect("idempotent");

        let entry = migrated["nodes"][0]["kind"]["text_style"]["font_entry"]
            .as_str()
            .expect("font_entry preserved");
        assert_eq!(entry, existing_uuid, "pre-existing font_entry must survive");
        assert!(
            fonts.is_empty(),
            "already-migrated node must not add to fonts map"
        );
    }

    #[test]
    fn test_migrate_v2_to_v3_skips_non_text_nodes() {
        // Non-text nodes must be passed through unchanged.
        let page = json!({
            "schema_version": 2,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": {
                    "type": "rectangle",
                    "corners": [
                        { "type": "round", "radii": { "x": 4.0, "y": 4.0 } },
                        { "type": "round", "radii": { "x": 4.0, "y": 4.0 } },
                        { "type": "round", "radii": { "x": 4.0, "y": 4.0 } },
                        { "type": "round", "radii": { "x": 4.0, "y": 4.0 } }
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

        let mut fonts = BTreeMap::new();
        let migrated = migrate_to_v3(page, &mut fonts).expect("migrate");
        // Rectangle kind should be unchanged (no font_entry injected).
        assert!(
            migrated["nodes"][0]["kind"].get("text_style").is_none(),
            "rectangle must not gain text_style"
        );
        assert!(fonts.is_empty(), "no families from rectangle node");
    }
}
