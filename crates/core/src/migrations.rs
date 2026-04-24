//! Workfile schema migrations. Each public `migrate_to_vN` function
//! takes a `serde_json::Value` representing a `SerializedPage` at
//! version N-1 and returns it transformed to version N.

use serde_json::{Value, json};

/// Migrates a `SerializedPage` JSON blob from schema v1 to v2.
///
/// v1 → v2 changes:
/// - Rectangle: `corner_radii: [r0, r1, r2, r3]` → `corners: [{type:"round", radii:{x,y}}; 4]`
/// - Frame: gains `corners` field defaulted to `[{type:"round", radii:{x:0, y:0}}; 4]`
/// - Image: gains `corners` field defaulted to `[{type:"round", radii:{x:0, y:0}}; 4]`
/// - Other kinds unchanged.
///
/// Idempotent on already-v2 input (already-migrated node kinds are skipped).
pub fn migrate_to_v2(mut page: Value) -> Value {
    page["schema_version"] = json!(2);

    let Some(nodes) = page.get_mut("nodes").and_then(Value::as_array_mut) else {
        return page;
    };

    for node in nodes.iter_mut() {
        let Some(kind) = node.get_mut("kind") else {
            continue;
        };
        let kind_type = kind.get("type").and_then(Value::as_str).map(String::from);
        match kind_type.as_deref() {
            Some("rectangle") => migrate_rectangle_kind(kind),
            Some("frame" | "image") => migrate_frame_or_image_kind(kind),
            _ => {} // leave other kinds unchanged
        }
    }

    page
}

fn migrate_rectangle_kind(kind: &mut Value) {
    if kind.get("corners").is_some() {
        return; // already migrated
    }
    let legacy = kind
        .as_object_mut()
        .and_then(|o| o.remove("corner_radii"))
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    let radii: [f64; 4] = [
        legacy.first().and_then(Value::as_f64).unwrap_or(0.0),
        legacy.get(1).and_then(Value::as_f64).unwrap_or(0.0),
        legacy.get(2).and_then(Value::as_f64).unwrap_or(0.0),
        legacy.get(3).and_then(Value::as_f64).unwrap_or(0.0),
    ];

    let corners: Vec<Value> = radii
        .iter()
        .map(|&r| json!({ "type": "round", "radii": { "x": r, "y": r } }))
        .collect();

    if let Some(obj) = kind.as_object_mut() {
        obj.insert("corners".into(), Value::Array(corners));
    }
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
        let migrated = migrate_to_v2(legacy_rectangle_page());
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
        let migrated = migrate_to_v2(page);
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
        let migrated = migrate_to_v2(page);
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
        let migrated = migrate_to_v2(page);
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
        let migrated = migrate_to_v2(v2_page.clone());
        assert_eq!(migrated, v2_page);
    }
}
