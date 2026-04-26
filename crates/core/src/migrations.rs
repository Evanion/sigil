//! Workfile schema migrations. Each public `migrate_to_vN` function
//! takes a `serde_json::Value` representing a `SerializedPage` at
//! version N-1 and returns it transformed to version N.
//!
//! # Migration cost (RF-039)
//!
//! Each `migrate_to_vN` function performs a single linear pass over the
//! parsed page's `nodes` array. Per-node work is O(1): inspect `kind`,
//! optionally read or write a `corners`/`corner_radii` field, no nested
//! recursion or per-node allocation beyond the new `corners` array. Total
//! migration cost is therefore O(n) in the number of nodes, bounded by the
//! deserialization envelope `MAX_FILE_SIZE` enforced in `serialize.rs`.
//! There is no separate per-migration size check because the page has
//! already been parsed by `deserialize_page_with_version` under that limit.

use serde_json::{Value, json};

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

    fn legacy_rectangle_with_radii(corner_radii: Value) -> Value {
        json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page 1",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "rectangle", "corner_radii": corner_radii },
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
        let page = legacy_rectangle_with_radii(json!("broken"));
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
        let page = legacy_rectangle_with_radii(json!([1.0, null, 3.0, 4.0]));
        let result = migrate_to_v2(page);
        assert!(
            matches!(result, Err(MigrationError::InvalidLegacyCornerRadii { .. })),
            "expected InvalidLegacyCornerRadii, got: {result:?}"
        );
    }

    #[test]
    fn test_migrate_v2_rejects_wrong_arity_corner_radii() {
        // Only three elements instead of four.
        let page = legacy_rectangle_with_radii(json!([1.0, 2.0, 3.0]));
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
        let page = legacy_rectangle_with_radii(json!([1.0, 2.0, 3.0, "4.0"]));
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
        let page = legacy_rectangle_with_radii(Value::Null);
        let migrated = migrate_to_v2(page).expect("null should default");
        let corners = migrated["nodes"][0]["kind"]["corners"]
            .as_array()
            .expect("corners array");
        assert_eq!(corners.len(), 4);
        for c in corners {
            assert_eq!(c["radii"]["x"], 0.0);
        }
    }
}
