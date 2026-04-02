// crates/core/src/serialize.rs

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::Node;
use crate::prototype::{Transition, TransitionAnimation, TransitionTrigger};
use crate::validate::CURRENT_SCHEMA_VERSION;

/// A serializable representation of a page (file format).
///
/// Uses UUIDs exclusively for node identity. Arena indices are not stable
/// across sessions and are NOT included in the file format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SerializedPage {
    pub schema_version: u32,
    pub id: Uuid,
    pub name: String,
    pub nodes: Vec<SerializedNode>,
    pub transitions: Vec<SerializedTransition>,
}

/// A serializable representation of a prototype transition (file format).
///
/// Uses UUIDs for node and page references instead of `NodeId`/`PageId`,
/// which are arena indices and not stable across sessions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SerializedTransition {
    pub id: Uuid,
    pub source_node: Uuid,
    pub target_page: Uuid,
    pub target_node: Option<Uuid>,
    pub trigger: TransitionTrigger,
    pub animation: TransitionAnimation,
}

/// A serializable representation of a node (file format).
///
/// Parent and children use UUIDs, not `NodeId`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SerializedNode {
    pub id: Uuid,
    pub kind: serde_json::Value,
    pub name: String,
    pub parent: Option<Uuid>,
    pub children: Vec<Uuid>,
    pub transform: serde_json::Value,
    pub style: serde_json::Value,
    pub constraints: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub grid_placement: Option<serde_json::Value>,
    pub visible: bool,
    pub locked: bool,
}

/// Serializes a page to pretty-printed JSON with sorted keys.
///
/// # Errors
/// Returns `CoreError::SerializationError` if serialization fails.
pub fn serialize_page(page: &SerializedPage) -> Result<String, CoreError> {
    // serde_json's to_string_pretty doesn't sort keys by default.
    // We serialize to a Value first, then output with sorted keys.
    let value = serde_json::to_value(page)
        .map_err(|e| CoreError::SerializationError(format!("failed to serialize page: {e}")))?;
    let sorted = sort_json_keys(&value);
    serde_json::to_string_pretty(&sorted)
        .map_err(|e| CoreError::SerializationError(format!("failed to write JSON: {e}")))
}

/// Deserializes a page from JSON, validating the schema version.
///
/// # Errors
/// - `CoreError::UnsupportedSchemaVersion` if the file version is too new.
/// - `CoreError::SerializationError` if the JSON is malformed.
pub fn deserialize_page(json: &str) -> Result<SerializedPage, CoreError> {
    if json.len() > crate::validate::MAX_FILE_SIZE {
        return Err(CoreError::InputTooLarge(format!(
            "file size {} bytes exceeds maximum of {} bytes",
            json.len(),
            crate::validate::MAX_FILE_SIZE
        )));
    }

    // NOTE: serde_json enforces a default recursion limit of 128, matching MAX_JSON_NESTING_DEPTH.
    // If serde_json changes this default, we must add explicit depth checking.

    // Check schema version first (partial parse)
    let raw: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| CoreError::SerializationError(format!("invalid JSON: {e}")))?;

    let version = raw
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            CoreError::SerializationError("missing or invalid 'schema_version' field".to_string())
        })?;
    let version = u32::try_from(version).unwrap_or(u32::MAX);
    if version > CURRENT_SCHEMA_VERSION {
        return Err(CoreError::UnsupportedSchemaVersion(
            version,
            CURRENT_SCHEMA_VERSION,
        ));
    }

    let page: SerializedPage = serde_json::from_value(raw)
        .map_err(|e| CoreError::SerializationError(format!("failed to deserialize page: {e}")))?;

    // Validate collection sizes
    validate_deserialized_page(&page)?;

    // Validate transition timing values
    for transition in &page.transitions {
        validate_serialized_transition(transition)?;
    }

    Ok(page)
}

/// Converts arena nodes into serialized nodes, resolving `NodeId`s to UUIDs.
///
/// # Errors
/// Returns `CoreError::NodeNotFound` if a node or its parent/child references are invalid.
pub fn nodes_to_serialized(
    nodes: &[&Node],
    arena: &crate::arena::Arena,
) -> Result<Vec<SerializedNode>, CoreError> {
    let mut result = Vec::with_capacity(nodes.len());

    for node in nodes {
        let parent_uuid = match node.parent {
            Some(pid) => Some(arena.uuid_of(pid)?),
            None => None,
        };

        let children_uuids: Result<Vec<Uuid>, CoreError> = node
            .children
            .iter()
            .map(|cid| arena.uuid_of(*cid))
            .collect();
        let children_uuids = children_uuids?;

        let kind_value = serde_json::to_value(&node.kind).map_err(|e| {
            CoreError::SerializationError(format!("failed to serialize node kind: {e}"))
        })?;
        let transform_value = serde_json::to_value(node.transform).map_err(|e| {
            CoreError::SerializationError(format!("failed to serialize transform: {e}"))
        })?;
        let style_value = serde_json::to_value(&node.style).map_err(|e| {
            CoreError::SerializationError(format!("failed to serialize style: {e}"))
        })?;
        let constraints_value = serde_json::to_value(node.constraints).map_err(|e| {
            CoreError::SerializationError(format!("failed to serialize constraints: {e}"))
        })?;
        let grid_placement_value = node
            .grid_placement
            .as_ref()
            .map(|gp| {
                serde_json::to_value(gp).map_err(|e| {
                    CoreError::SerializationError(format!(
                        "failed to serialize grid_placement: {e}"
                    ))
                })
            })
            .transpose()?;

        result.push(SerializedNode {
            id: node.uuid,
            kind: kind_value,
            name: node.name.clone(),
            parent: parent_uuid,
            children: children_uuids,
            transform: transform_value,
            style: style_value,
            constraints: constraints_value,
            grid_placement: grid_placement_value,
            visible: node.visible,
            locked: node.locked,
        });
    }

    Ok(result)
}

/// Creates a `SerializedPage` from a document page.
///
/// Collects all nodes belonging to the page (root nodes and their descendants).
///
/// # Errors
/// Returns errors if node references are invalid.
pub fn page_to_serialized(
    page: &crate::document::Page,
    arena: &crate::arena::Arena,
    transitions: &[Transition],
) -> Result<SerializedPage, CoreError> {
    let mut all_nodes = Vec::new();

    for root_id in &page.root_nodes {
        collect_subtree(arena, *root_id, &mut all_nodes)?;
    }

    // Collect all node UUIDs in this page for transition filtering
    let mut page_node_uuids = std::collections::HashSet::new();
    for node in &all_nodes {
        page_node_uuids.insert(arena.uuid_of(node.id)?);
    }

    // Filter transitions whose source_node belongs to this page and convert to serialized form
    let mut page_transitions = Vec::new();
    for t in transitions {
        let source_uuid = match arena.uuid_of(t.source_node) {
            Ok(uuid) if page_node_uuids.contains(&uuid) => uuid,
            _ => continue,
        };

        let target_node_uuid = match t.target_node {
            Some(nid) => Some(arena.uuid_of(nid)?),
            None => None,
        };

        page_transitions.push(SerializedTransition {
            id: t.id,
            source_node: source_uuid,
            target_page: t.target_page.uuid(),
            target_node: target_node_uuid,
            trigger: t.trigger.clone(),
            animation: t.animation.clone(),
        });
    }

    let node_refs: Vec<&Node> = all_nodes.iter().collect();
    let serialized_nodes = nodes_to_serialized(&node_refs, arena)?;

    Ok(SerializedPage {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: page.id.uuid(),
        name: page.name.clone(),
        nodes: serialized_nodes,
        transitions: page_transitions,
    })
}

/// Sorts all JSON object keys for deterministic output.
///
/// Uses an iterative approach with an explicit stack to prevent stack overflow
/// on deeply nested structures.
fn sort_json_keys(value: &serde_json::Value) -> serde_json::Value {
    enum Work {
        /// A value that needs to be sorted (input).
        Process(serde_json::Value),
        /// Marker: assemble an object from sorted keys (keys stored inline).
        AssembleObject(Vec<String>),
        /// Marker: assemble an array with N elements.
        AssembleArray(usize),
    }

    let mut work_stack: Vec<Work> = vec![Work::Process(value.clone())];
    let mut result_stack: Vec<serde_json::Value> = Vec::new();

    while let Some(item) = work_stack.pop() {
        match item {
            Work::Process(v) => match v {
                serde_json::Value::Object(map) => {
                    let mut keys: Vec<String> = map.keys().cloned().collect();
                    keys.sort();
                    // Push assembly marker with sorted keys
                    let sorted_keys = keys.clone();
                    work_stack.push(Work::AssembleObject(sorted_keys));
                    // Push children in reverse sorted order so first key is processed first
                    // and lands at the bottom of the result_stack segment
                    for key in keys.into_iter().rev() {
                        if let Some(child) = map.get(&key) {
                            work_stack.push(Work::Process(child.clone()));
                        }
                    }
                }
                serde_json::Value::Array(arr) => {
                    let len = arr.len();
                    work_stack.push(Work::AssembleArray(len));
                    // Push in reverse order so first element is processed first
                    for child in arr.into_iter().rev() {
                        work_stack.push(Work::Process(child));
                    }
                }
                other => result_stack.push(other),
            },
            Work::AssembleObject(keys) => {
                let len = keys.len();
                let start = result_stack.len() - len;
                let values: Vec<serde_json::Value> = result_stack.drain(start..).collect();
                let mut map = serde_json::Map::with_capacity(len);
                for (key, val) in keys.into_iter().zip(values) {
                    map.insert(key, val);
                }
                result_stack.push(serde_json::Value::Object(map));
            }
            Work::AssembleArray(len) => {
                let start = result_stack.len() - len;
                let elements: Vec<serde_json::Value> = result_stack.drain(start..).collect();
                result_stack.push(serde_json::Value::Array(elements));
            }
        }
    }

    result_stack.pop().unwrap_or(serde_json::Value::Null)
}

/// Validates a deserialized page against collection size limits.
fn validate_deserialized_page(page: &SerializedPage) -> Result<(), CoreError> {
    use crate::validate::{
        MAX_CHILDREN_PER_NODE, MAX_EFFECTS_PER_STYLE, MAX_FILLS_PER_STYLE, MAX_FONT_FAMILY_LEN,
        MAX_GRADIENT_STOPS, MAX_GRID_TRACKS, MAX_SEGMENTS_PER_SUBPATH, MAX_STROKES_PER_STYLE,
        MAX_SUBPATHS_PER_PATH, MAX_TEXT_CONTENT_LEN, MAX_TRANSITIONS_PER_DOCUMENT,
        validate_asset_ref, validate_collection_size, validate_floats_in_value, validate_node_name,
    };

    // Validate page name
    validate_node_name(&page.name)?;

    // Validate transition count
    validate_collection_size(
        "transitions",
        page.transitions.len(),
        MAX_TRANSITIONS_PER_DOCUMENT,
    )?;

    for node in &page.nodes {
        validate_node_name(&node.name)?;
        validate_collection_size("children", node.children.len(), MAX_CHILDREN_PER_NODE)?;

        // Validate style collection sizes
        if let Some(fills) = node.style.get("fills").and_then(|v| v.as_array()) {
            validate_collection_size("fills", fills.len(), MAX_FILLS_PER_STYLE)?;
        }
        if let Some(strokes) = node.style.get("strokes").and_then(|v| v.as_array()) {
            validate_collection_size("strokes", strokes.len(), MAX_STROKES_PER_STYLE)?;
        }
        if let Some(effects) = node.style.get("effects").and_then(|v| v.as_array()) {
            validate_collection_size("effects", effects.len(), MAX_EFFECTS_PER_STYLE)?;
        }

        // Validate gradient stops counts in fills
        validate_gradient_stops_in_value(&node.style, MAX_GRADIENT_STOPS)?;

        // Validate font_family length in text_style
        if let Some(font_family) = node
            .kind
            .get("text_style")
            .and_then(|ts| ts.get("font_family"))
            .and_then(|v| v.as_str())
            && font_family.len() > MAX_FONT_FAMILY_LEN
        {
            return Err(CoreError::ValidationError(format!(
                "font_family exceeds max length of {MAX_FONT_FAMILY_LEN} (got {})",
                font_family.len()
            )));
        }

        // Validate text content length
        if let Some(content) = node.kind.get("content").and_then(|v| v.as_str())
            && content.len() > MAX_TEXT_CONTENT_LEN
        {
            return Err(CoreError::InputTooLarge(format!(
                "text content exceeds max length of {MAX_TEXT_CONTENT_LEN} (got {})",
                content.len()
            )));
        }

        // Validate asset_ref for Image nodes
        if let Some(asset_ref) = node.kind.get("asset_ref").and_then(|v| v.as_str()) {
            validate_asset_ref(asset_ref)?;
        }

        // Validate token ref names in style values
        validate_token_refs_in_value(&node.style)?;
        validate_token_refs_in_value(&node.kind)?;

        // RF-003: Validate all float values are finite (no NaN/Infinity)
        validate_floats_in_value(&node.transform)?;
        validate_floats_in_value(&node.style)?;
        validate_floats_in_value(&node.kind)?;

        // Validate path subpaths and segments counts
        if node.kind.get("type").and_then(|v| v.as_str()) == Some("path")
            && let Some(path_data) = node.kind.get("path_data")
        {
            validate_path_data_limits(path_data, MAX_SUBPATHS_PER_PATH, MAX_SEGMENTS_PER_SUBPATH)?;
        }

        // Validate grid track counts and values for frame nodes with grid layout
        if node.kind.get("type").and_then(|v| v.as_str()) == Some("frame")
            && let Some(layout) = node.kind.get("layout")
            && layout.get("mode").and_then(|v| v.as_str()) == Some("grid")
        {
            validate_grid_layout_limits(layout, MAX_GRID_TRACKS)?;
        }
    }

    Ok(())
}

/// Validates a serialized transition's timing values.
///
/// This mirrors `prototype::validate_transition` but operates on the serialized
/// (UUID-based) representation.
fn validate_serialized_transition(transition: &SerializedTransition) -> Result<(), CoreError> {
    if let TransitionTrigger::AfterDelay { seconds } = &transition.trigger {
        crate::prototype::validate_duration(*seconds)?;
    }

    match &transition.animation {
        TransitionAnimation::Instant => {}
        TransitionAnimation::Dissolve { duration }
        | TransitionAnimation::SlideIn { duration, .. }
        | TransitionAnimation::SlideOut { duration, .. }
        | TransitionAnimation::Push { duration, .. } => {
            crate::prototype::validate_duration(*duration)?;
        }
    }

    Ok(())
}

/// Walks a `serde_json::Value` looking for `{"type":"token_ref","name":"..."}` objects
/// and validates each token name.
fn validate_token_refs_in_value(value: &serde_json::Value) -> Result<(), CoreError> {
    use crate::validate::validate_token_name;

    let mut stack = vec![value];

    while let Some(v) = stack.pop() {
        match v {
            serde_json::Value::Object(map) => {
                // Check if this is a token_ref object
                if let Some(serde_json::Value::String(t)) = map.get("type")
                    && t == "token_ref"
                    && let Some(serde_json::Value::String(name)) = map.get("name")
                {
                    validate_token_name(name)?;
                }
                // Continue walking children
                for child in map.values() {
                    stack.push(child);
                }
            }
            serde_json::Value::Array(arr) => {
                for child in arr {
                    stack.push(child);
                }
            }
            _ => {}
        }
    }

    Ok(())
}

/// Walks a `serde_json::Value` looking for gradient `stops` arrays and validates
/// their length against the given maximum.
fn validate_gradient_stops_in_value(
    value: &serde_json::Value,
    max_stops: usize,
) -> Result<(), CoreError> {
    use crate::validate::validate_collection_size;

    let mut stack = vec![value];

    while let Some(v) = stack.pop() {
        match v {
            serde_json::Value::Object(map) => {
                // Check if this object has a "stops" array (gradient definition)
                if let Some(serde_json::Value::Array(stops)) = map.get("stops") {
                    validate_collection_size("gradient stops", stops.len(), max_stops)?;
                }
                for child in map.values() {
                    stack.push(child);
                }
            }
            serde_json::Value::Array(arr) => {
                for child in arr {
                    stack.push(child);
                }
            }
            _ => {}
        }
    }

    Ok(())
}

/// Validates path data collection limits from a `serde_json::Value`.
///
/// Checks that the number of subpaths does not exceed `max_subpaths` and
/// each subpath's segment count does not exceed `max_segments`.
fn validate_path_data_limits(
    path_data: &serde_json::Value,
    max_subpaths: usize,
    max_segments: usize,
) -> Result<(), CoreError> {
    use crate::validate::validate_collection_size;

    if let Some(subpaths) = path_data.get("subpaths").and_then(|v| v.as_array()) {
        validate_collection_size("subpaths", subpaths.len(), max_subpaths)?;

        for (i, subpath) in subpaths.iter().enumerate() {
            if let Some(segments) = subpath.get("segments").and_then(|v| v.as_array()) {
                validate_collection_size(
                    &format!("subpath[{i}].segments"),
                    segments.len(),
                    max_segments,
                )?;
            }
        }
    }

    Ok(())
}

/// Validates grid layout track counts and individual track values from a `serde_json::Value`.
///
/// Checks that column and row track arrays do not exceed `max_tracks` and
/// that each track value passes `validate_grid_track`.
fn validate_grid_layout_limits(
    layout: &serde_json::Value,
    max_tracks: usize,
) -> Result<(), CoreError> {
    use crate::node::GridTrack;
    use crate::validate::{validate_collection_size, validate_grid_track};

    for field_name in &["columns", "rows"] {
        if let Some(tracks_arr) = layout.get(*field_name).and_then(|v| v.as_array()) {
            validate_collection_size(field_name, tracks_arr.len(), max_tracks)?;

            for (i, track_val) in tracks_arr.iter().enumerate() {
                let track: GridTrack = serde_json::from_value(track_val.clone()).map_err(|e| {
                    CoreError::SerializationError(format!(
                        "invalid grid track at {field_name}[{i}]: {e}"
                    ))
                })?;
                validate_grid_track(&track)?;
            }
        }
    }

    Ok(())
}

/// Collects a node and all its descendants into the output vec (depth-first pre-order).
///
/// Uses an iterative approach with an explicit stack to prevent stack overflow
/// on deeply nested trees.
fn collect_subtree(
    arena: &crate::arena::Arena,
    root_id: NodeId,
    output: &mut Vec<Node>,
) -> Result<(), CoreError> {
    let mut stack = vec![root_id];

    while let Some(current_id) = stack.pop() {
        let node = arena.get(current_id)?;
        output.push(node.clone());

        // Push children in reverse so they come out in order
        for child_id in node.children.iter().rev() {
            stack.push(*child_id);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arena::Arena;
    use crate::document::Page;
    use crate::id::PageId;
    use crate::node::{Node, NodeKind};

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn insert_frame(arena: &mut Arena, uuid: Uuid, name: &str) -> NodeId {
        let node = Node::new(
            NodeId::new(0, 0),
            uuid,
            NodeKind::Frame { layout: None },
            name.to_string(),
        )
        .expect("create test node");
        arena.insert(node).expect("insert")
    }

    // ── serialize_page / deserialize_page round-trip ───────────────────

    #[test]
    fn test_serialize_deserialize_empty_page() {
        let page = SerializedPage {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: make_uuid(1),
            name: "Empty Page".to_string(),
            nodes: Vec::new(),
            transitions: Vec::new(),
        };

        let json = serialize_page(&page).expect("serialize");
        let deserialized = deserialize_page(&json).expect("deserialize");
        assert_eq!(page, deserialized);
    }

    #[test]
    fn test_serialize_produces_pretty_json() {
        let page = SerializedPage {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: make_uuid(1),
            name: "Test".to_string(),
            nodes: Vec::new(),
            transitions: Vec::new(),
        };

        let json = serialize_page(&page).expect("serialize");
        assert!(json.contains('\n'), "expected pretty-printed JSON");
    }

    #[test]
    fn test_serialize_produces_sorted_keys() {
        let page = SerializedPage {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: make_uuid(1),
            name: "Test".to_string(),
            nodes: Vec::new(),
            transitions: Vec::new(),
        };

        let json = serialize_page(&page).expect("serialize");
        // "id" should come before "name", "name" before "nodes", etc.
        let id_pos = json.find("\"id\"").expect("id field");
        let name_pos = json.find("\"name\"").expect("name field");
        let nodes_pos = json.find("\"nodes\"").expect("nodes field");
        let schema_pos = json
            .find("\"schema_version\"")
            .expect("schema_version field");

        assert!(id_pos < name_pos, "id should come before name");
        assert!(name_pos < nodes_pos, "name should come before nodes");
        assert!(
            nodes_pos < schema_pos,
            "nodes should come before schema_version"
        );
    }

    #[test]
    fn test_deserialize_rejects_future_schema_version() {
        let json = r#"{"schema_version": 999, "id": "00000000-0000-0000-0000-000000000001", "name": "Future", "nodes": [], "transitions": []}"#;
        let result = deserialize_page(json);
        assert!(matches!(
            result,
            Err(CoreError::UnsupportedSchemaVersion(999, _))
        ));
    }

    #[test]
    fn test_deserialize_accepts_current_schema_version() {
        let json = format!(
            r#"{{"schema_version": {}, "id": "00000000-0000-0000-0000-000000000001", "name": "Current", "nodes": [], "transitions": []}}"#,
            CURRENT_SCHEMA_VERSION
        );
        let result = deserialize_page(&json);
        assert!(result.is_ok());
    }

    #[test]
    fn test_deserialize_invalid_json() {
        let result = deserialize_page("not json at all");
        assert!(matches!(result, Err(CoreError::SerializationError(_))));
    }

    #[test]
    fn test_deserialize_rejects_invalid_node_name() {
        let json = r#"{
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": {"type": "group"},
                "name": "bad\u0000name",
                "parent": null,
                "children": [],
                "transform": {"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1},
                "style": {"fills":[],"strokes":[],"opacity":1.0,"blend_mode":"normal","effects":[]},
                "constraints": {"horizontal":"start","vertical":"start"},
                "visible": true,
                "locked": false
            }],
            "transitions": []
        }"#;
        let result = deserialize_page(json);
        assert!(matches!(result, Err(CoreError::ValidationError(_))));
    }

    // ── page_to_serialized ────────────────────────────────────────────

    #[test]
    fn test_page_to_serialized_empty_page() {
        let arena = Arena::new(100);
        let page = Page::new(PageId::new(make_uuid(1)), "Empty".to_string());

        let serialized = page_to_serialized(&page, &arena, &[]).expect("serialize");
        assert_eq!(serialized.name, "Empty");
        assert!(serialized.nodes.is_empty());
        assert_eq!(serialized.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_page_to_serialized_with_nodes() {
        let mut arena = Arena::new(100);
        let root_uuid = make_uuid(10);
        let child_uuid = make_uuid(11);

        let root_id = insert_frame(&mut arena, root_uuid, "Root");
        let child_id = insert_frame(&mut arena, child_uuid, "Child");

        // Set up tree
        crate::tree::add_child(&mut arena, root_id, child_id).expect("add_child");

        let page_id = PageId::new(make_uuid(1));
        let mut page = Page::new(page_id, "Home".to_string());
        page.root_nodes.push(root_id);

        let serialized = page_to_serialized(&page, &arena, &[]).expect("serialize");
        assert_eq!(serialized.nodes.len(), 2);
        assert_eq!(serialized.nodes[0].id, root_uuid);
        assert_eq!(serialized.nodes[1].id, child_uuid);
        assert!(serialized.nodes[0].parent.is_none());
        assert_eq!(serialized.nodes[1].parent, Some(root_uuid));
        assert_eq!(serialized.nodes[0].children, vec![child_uuid]);
    }

    // ── Full round-trip: document -> serialized -> JSON -> deserialized ──

    #[test]
    fn test_full_round_trip_with_nodes() {
        let mut arena = Arena::new(100);
        let root_uuid = make_uuid(10);
        let child_uuid = make_uuid(11);

        let root_id = insert_frame(&mut arena, root_uuid, "Root Frame");
        let child_id = {
            let node = Node::new(
                NodeId::new(0, 0),
                child_uuid,
                NodeKind::Rectangle {
                    corner_radii: [8.0, 8.0, 8.0, 8.0],
                },
                "Rounded Rect".to_string(),
            )
            .expect("create test node");
            arena.insert(node).expect("insert")
        };

        crate::tree::add_child(&mut arena, root_id, child_id).expect("add_child");

        let page_id = PageId::new(make_uuid(1));
        let mut page = Page::new(page_id, "Home".to_string());
        page.root_nodes.push(root_id);

        // Serialize
        let serialized = page_to_serialized(&page, &arena, &[]).expect("page_to_serialized");
        let json = serialize_page(&serialized).expect("serialize_page");

        // Deserialize
        let deserialized = deserialize_page(&json).expect("deserialize_page");

        // Verify round-trip
        assert_eq!(serialized.schema_version, deserialized.schema_version);
        assert_eq!(serialized.id, deserialized.id);
        assert_eq!(serialized.name, deserialized.name);
        assert_eq!(serialized.nodes.len(), deserialized.nodes.len());

        for (orig, deser) in serialized.nodes.iter().zip(deserialized.nodes.iter()) {
            assert_eq!(orig.id, deser.id);
            assert_eq!(orig.name, deser.name);
            assert_eq!(orig.parent, deser.parent);
            assert_eq!(orig.children, deser.children);
            assert_eq!(orig.visible, deser.visible);
            assert_eq!(orig.locked, deser.locked);
        }
    }

    // ── sort_json_keys ─────────────────────────────────────────────────

    #[test]
    fn test_sort_json_keys_simple_object() {
        let input: serde_json::Value =
            serde_json::from_str(r#"{"z": 1, "a": 2, "m": 3}"#).expect("parse");
        let sorted = sort_json_keys(&input);
        let output = serde_json::to_string(&sorted).expect("serialize");
        assert_eq!(output, r#"{"a":2,"m":3,"z":1}"#);
    }

    #[test]
    fn test_sort_json_keys_nested() {
        let input: serde_json::Value =
            serde_json::from_str(r#"{"b": {"z": 1, "a": 2}, "a": 3}"#).expect("parse");
        let sorted = sort_json_keys(&input);
        let output = serde_json::to_string(&sorted).expect("serialize");
        assert_eq!(output, r#"{"a":3,"b":{"a":2,"z":1}}"#);
    }

    #[test]
    fn test_sort_json_keys_array() {
        let input: serde_json::Value =
            serde_json::from_str(r#"[{"b": 1, "a": 2}]"#).expect("parse");
        let sorted = sort_json_keys(&input);
        let output = serde_json::to_string(&sorted).expect("serialize");
        assert_eq!(output, r#"[{"a":2,"b":1}]"#);
    }

    #[test]
    fn test_sort_json_keys_primitive() {
        let input = serde_json::Value::Number(serde_json::Number::from(42));
        let sorted = sort_json_keys(&input);
        assert_eq!(sorted, input);
    }

    // ── nodes_to_serialized ────────────────────────────────────────────

    #[test]
    fn test_nodes_to_serialized_single_root() {
        let mut arena = Arena::new(100);
        let uuid = make_uuid(1);
        let id = insert_frame(&mut arena, uuid, "Frame");

        let node = arena.get(id).expect("get");
        let serialized = nodes_to_serialized(&[node], &arena).expect("serialize");

        assert_eq!(serialized.len(), 1);
        assert_eq!(serialized[0].id, uuid);
        assert_eq!(serialized[0].name, "Frame");
        assert!(serialized[0].parent.is_none());
        assert!(serialized[0].children.is_empty());
    }

    #[test]
    fn test_nodes_to_serialized_with_parent_child() {
        let mut arena = Arena::new(100);
        let parent_uuid = make_uuid(1);
        let child_uuid = make_uuid(2);

        let parent_id = insert_frame(&mut arena, parent_uuid, "Parent");
        let child_id = insert_frame(&mut arena, child_uuid, "Child");

        crate::tree::add_child(&mut arena, parent_id, child_id).expect("add_child");

        let parent_node = arena.get(parent_id).expect("get");
        let child_node = arena.get(child_id).expect("get");
        let serialized =
            nodes_to_serialized(&[parent_node, child_node], &arena).expect("serialize");

        assert_eq!(serialized[0].children, vec![child_uuid]);
        assert_eq!(serialized[1].parent, Some(parent_uuid));
    }

    // ── Transitions round-trip ────────────────────────────────────────

    #[test]
    fn test_serialized_page_with_transitions_round_trip() {
        use crate::prototype::{
            SlideDirection, Transition, TransitionAnimation, TransitionTrigger,
        };

        let mut arena = Arena::new(100);
        let root_uuid = make_uuid(10);
        let target_node_uuid = make_uuid(11);
        let root_id = insert_frame(&mut arena, root_uuid, "Root");
        let target_node_id = insert_frame(&mut arena, target_node_uuid, "Target");

        // Add target_node as child so it belongs to the page subtree
        crate::tree::add_child(&mut arena, root_id, target_node_id).expect("add_child");

        let page_id = PageId::new(make_uuid(1));
        let mut page = Page::new(page_id, "Home".to_string());
        page.root_nodes.push(root_id);

        let transitions = vec![
            Transition {
                id: make_uuid(50),
                source_node: root_id,
                target_page: PageId::new(make_uuid(2)),
                target_node: None,
                trigger: TransitionTrigger::OnClick,
                animation: TransitionAnimation::Dissolve { duration: 0.3 },
            },
            Transition {
                id: make_uuid(51),
                source_node: root_id,
                target_page: PageId::new(make_uuid(3)),
                target_node: Some(target_node_id),
                trigger: TransitionTrigger::AfterDelay { seconds: 2.0 },
                animation: TransitionAnimation::SlideIn {
                    direction: SlideDirection::Right,
                    duration: 0.5,
                },
            },
        ];

        let serialized =
            page_to_serialized(&page, &arena, &transitions).expect("page_to_serialized");
        assert_eq!(serialized.transitions.len(), 2);

        // Verify UUIDs are used instead of NodeIds
        assert_eq!(serialized.transitions[0].source_node, root_uuid);
        assert_eq!(serialized.transitions[0].target_page, make_uuid(2));
        assert_eq!(serialized.transitions[0].target_node, None);
        assert_eq!(serialized.transitions[1].source_node, root_uuid);
        assert_eq!(
            serialized.transitions[1].target_node,
            Some(target_node_uuid)
        );

        let json = serialize_page(&serialized).expect("serialize_page");
        let deserialized = deserialize_page(&json).expect("deserialize_page");

        assert_eq!(serialized.transitions.len(), deserialized.transitions.len());
        for (orig, deser) in serialized
            .transitions
            .iter()
            .zip(deserialized.transitions.iter())
        {
            assert_eq!(orig.id, deser.id);
            assert_eq!(orig.source_node, deser.source_node);
            assert_eq!(orig.trigger, deser.trigger);
            assert_eq!(orig.animation, deser.animation);
            assert_eq!(orig.target_page, deser.target_page);
            assert_eq!(orig.target_node, deser.target_node);
        }
    }

    #[test]
    fn test_page_to_serialized_filters_transitions_by_page() {
        use crate::prototype::{Transition, TransitionAnimation, TransitionTrigger};

        let mut arena = Arena::new(100);
        let node_a_uuid = make_uuid(10);
        let node_b_uuid = make_uuid(20);
        let node_a_id = insert_frame(&mut arena, node_a_uuid, "NodeA");
        let _node_b_id = insert_frame(&mut arena, node_b_uuid, "NodeB");

        // Page only contains node_a
        let page_id = PageId::new(make_uuid(1));
        let mut page = Page::new(page_id, "PageA".to_string());
        page.root_nodes.push(node_a_id);

        let transitions = vec![
            Transition {
                id: make_uuid(50),
                source_node: node_a_id,
                target_page: PageId::new(make_uuid(2)),
                target_node: None,
                trigger: TransitionTrigger::OnClick,
                animation: TransitionAnimation::Instant,
            },
            // This transition references node_b which is NOT in the page
            Transition {
                id: make_uuid(51),
                source_node: _node_b_id,
                target_page: PageId::new(make_uuid(2)),
                target_node: None,
                trigger: TransitionTrigger::OnHover,
                animation: TransitionAnimation::Instant,
            },
        ];

        let serialized =
            page_to_serialized(&page, &arena, &transitions).expect("page_to_serialized");
        // Only the transition for node_a should be included
        assert_eq!(serialized.transitions.len(), 1);
        assert_eq!(serialized.transitions[0].id, make_uuid(50));
    }

    #[test]
    fn test_deserialize_rejects_invalid_transition_duration() {
        // Construct JSON with an invalid transition duration (negative)
        let json = format!(
            r#"{{
                "schema_version": {},
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Page",
                "nodes": [],
                "transitions": [{{
                    "id": "00000000-0000-0000-0000-000000000050",
                    "source_node": "00000000-0000-0000-0000-00000000000a",
                    "target_page": "00000000-0000-0000-0000-000000000002",
                    "target_node": null,
                    "trigger": {{"type": "on_click"}},
                    "animation": {{"type": "dissolve", "duration": -1.0}}
                }}]
            }}"#,
            CURRENT_SCHEMA_VERSION
        );
        let result = deserialize_page(&json);
        assert!(result.is_err(), "should reject negative duration");
    }

    #[test]
    fn test_serialized_transition_uses_uuids_not_node_ids() {
        // Verify that the file format contains UUIDs, not arena indices
        let page = SerializedPage {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: make_uuid(1),
            name: "Page".to_string(),
            nodes: Vec::new(),
            transitions: vec![SerializedTransition {
                id: make_uuid(50),
                source_node: make_uuid(10),
                target_page: make_uuid(2),
                target_node: Some(make_uuid(11)),
                trigger: TransitionTrigger::OnClick,
                animation: TransitionAnimation::Instant,
            }],
        };

        let json = serialize_page(&page).expect("serialize");
        // JSON must NOT contain "index" or "generation" (NodeId fields)
        assert!(
            !json.contains("\"index\""),
            "transitions must not contain NodeId index"
        );
        assert!(
            !json.contains("\"generation\""),
            "transitions must not contain NodeId generation"
        );
        // JSON must contain UUIDs
        assert!(json.contains("0a000000-0000-0000-0000-000000000000"));

        let deserialized = deserialize_page(&json).expect("deserialize");
        assert_eq!(deserialized.transitions[0].source_node, make_uuid(10));
        assert_eq!(deserialized.transitions[0].target_page, make_uuid(2));
        assert_eq!(deserialized.transitions[0].target_node, Some(make_uuid(11)));
    }

    // ── RF-002: Transition count limit ──────────────────────────────────

    #[test]
    fn test_deserialize_rejects_too_many_transitions() {
        use crate::validate::MAX_TRANSITIONS_PER_DOCUMENT;

        let transitions_json: Vec<String> = (0..MAX_TRANSITIONS_PER_DOCUMENT + 1)
            .map(|i| {
                format!(
                    r#"{{"id": "{}", "source_node": "{}", "target_page": "{}", "target_node": null, "trigger": {{"type": "on_click"}}, "animation": {{"type": "instant"}}}}"#,
                    Uuid::from_u128(i as u128),
                    Uuid::nil(),
                    Uuid::nil()
                )
            })
            .collect();

        let json = format!(
            r#"{{"schema_version": {}, "id": "{}", "name": "Page", "nodes": [], "transitions": [{}]}}"#,
            CURRENT_SCHEMA_VERSION,
            Uuid::nil(),
            transitions_json.join(",")
        );
        let result = deserialize_page(&json);
        assert!(
            matches!(result, Err(CoreError::ValidationError(ref msg)) if msg.contains("transitions")),
            "expected transitions limit error, got: {result:?}"
        );
    }

    // ── RF-002: Path subpath/segment limits ─────────────────────────────

    #[test]
    fn test_deserialize_rejects_too_many_subpaths() {
        use crate::validate::MAX_SUBPATHS_PER_PATH;

        // Build a path node with too many subpaths
        let subpaths_json: Vec<String> = (0..MAX_SUBPATHS_PER_PATH + 1)
            .map(|_| r#"{"segments": [], "closed": false}"#.to_string())
            .collect();

        let json = format!(
            r#"{{
                "schema_version": {},
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Page",
                "nodes": [{{
                    "id": "00000000-0000-0000-0000-000000000002",
                    "kind": {{"type": "path", "path_data": {{"subpaths": [{}], "fill_rule": "even_odd"}}}},
                    "name": "BigPath",
                    "parent": null,
                    "children": [],
                    "transform": {{"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1}},
                    "style": {{"fills":[],"strokes":[],"opacity":1.0,"blend_mode":"normal","effects":[]}},
                    "constraints": {{"horizontal":"start","vertical":"start"}},
                    "visible": true,
                    "locked": false
                }}],
                "transitions": []
            }}"#,
            CURRENT_SCHEMA_VERSION,
            subpaths_json.join(",")
        );
        let result = deserialize_page(&json);
        assert!(
            matches!(result, Err(CoreError::ValidationError(ref msg)) if msg.contains("subpaths")),
            "expected subpaths limit error, got: {result:?}"
        );
    }

    #[test]
    fn test_deserialize_rejects_too_many_segments_in_subpath() {
        use crate::validate::MAX_SEGMENTS_PER_SUBPATH;

        // Build a single subpath with too many segments
        let segments_json: Vec<String> = (0..MAX_SEGMENTS_PER_SUBPATH + 1)
            .map(|_| {
                r#"{"type":"line","end_point":{"x":0,"y":0},"corner_mode":"none","corner_radius":0}"#.to_string()
            })
            .collect();

        let json = format!(
            r#"{{
                "schema_version": {},
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Page",
                "nodes": [{{
                    "id": "00000000-0000-0000-0000-000000000002",
                    "kind": {{"type": "path", "path_data": {{"subpaths": [{{"segments": [{}], "closed": false}}], "fill_rule": "even_odd"}}}},
                    "name": "HugePath",
                    "parent": null,
                    "children": [],
                    "transform": {{"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1}},
                    "style": {{"fills":[],"strokes":[],"opacity":1.0,"blend_mode":"normal","effects":[]}},
                    "constraints": {{"horizontal":"start","vertical":"start"}},
                    "visible": true,
                    "locked": false
                }}],
                "transitions": []
            }}"#,
            CURRENT_SCHEMA_VERSION,
            segments_json.join(",")
        );
        let result = deserialize_page(&json);
        assert!(
            matches!(result, Err(CoreError::ValidationError(ref msg)) if msg.contains("segments")),
            "expected segments limit error, got: {result:?}"
        );
    }

    // ── RF-004: Grid track limits ───────────────────────────────────────

    #[test]
    fn test_deserialize_rejects_too_many_grid_columns() {
        use crate::validate::MAX_GRID_TRACKS;

        let tracks_json: Vec<String> = (0..MAX_GRID_TRACKS + 1)
            .map(|_| r#"{"type": "fixed", "size": 100.0}"#.to_string())
            .collect();

        let json = format!(
            r#"{{
                "schema_version": {},
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Page",
                "nodes": [{{
                    "id": "00000000-0000-0000-0000-000000000002",
                    "kind": {{"type": "frame", "layout": {{"mode": "grid", "columns": [{}], "rows": [], "column_gap": 0, "row_gap": 0, "padding": {{"top": 0, "right": 0, "bottom": 0, "left": 0}}, "align_items": "start", "justify_items": "start"}}}},
                    "name": "GridFrame",
                    "parent": null,
                    "children": [],
                    "transform": {{"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1}},
                    "style": {{"fills":[],"strokes":[],"opacity":1.0,"blend_mode":"normal","effects":[]}},
                    "constraints": {{"horizontal":"start","vertical":"start"}},
                    "visible": true,
                    "locked": false
                }}],
                "transitions": []
            }}"#,
            CURRENT_SCHEMA_VERSION,
            tracks_json.join(",")
        );
        let result = deserialize_page(&json);
        assert!(
            matches!(result, Err(CoreError::ValidationError(ref msg)) if msg.contains("columns")),
            "expected columns limit error, got: {result:?}"
        );
    }

    #[test]
    fn test_deserialize_rejects_too_many_grid_rows() {
        use crate::validate::MAX_GRID_TRACKS;

        let tracks_json: Vec<String> = (0..MAX_GRID_TRACKS + 1)
            .map(|_| r#"{"type": "auto"}"#.to_string())
            .collect();

        let json = format!(
            r#"{{
                "schema_version": {},
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Page",
                "nodes": [{{
                    "id": "00000000-0000-0000-0000-000000000002",
                    "kind": {{"type": "frame", "layout": {{"mode": "grid", "columns": [], "rows": [{}], "column_gap": 0, "row_gap": 0, "padding": {{"top": 0, "right": 0, "bottom": 0, "left": 0}}, "align_items": "start", "justify_items": "start"}}}},
                    "name": "GridFrame",
                    "parent": null,
                    "children": [],
                    "transform": {{"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1}},
                    "style": {{"fills":[],"strokes":[],"opacity":1.0,"blend_mode":"normal","effects":[]}},
                    "constraints": {{"horizontal":"start","vertical":"start"}},
                    "visible": true,
                    "locked": false
                }}],
                "transitions": []
            }}"#,
            CURRENT_SCHEMA_VERSION,
            tracks_json.join(",")
        );
        let result = deserialize_page(&json);
        assert!(
            matches!(result, Err(CoreError::ValidationError(ref msg)) if msg.contains("rows")),
            "expected rows limit error, got: {result:?}"
        );
    }

    #[test]
    fn test_deserialize_rejects_invalid_grid_track_value() {
        let json = format!(
            r#"{{
                "schema_version": {},
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Page",
                "nodes": [{{
                    "id": "00000000-0000-0000-0000-000000000002",
                    "kind": {{"type": "frame", "layout": {{"mode": "grid", "columns": [{{"type": "fixed", "size": -10.0}}], "rows": [], "column_gap": 0, "row_gap": 0, "padding": {{"top": 0, "right": 0, "bottom": 0, "left": 0}}, "align_items": "start", "justify_items": "start"}}}},
                    "name": "BadGrid",
                    "parent": null,
                    "children": [],
                    "transform": {{"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1}},
                    "style": {{"fills":[],"strokes":[],"opacity":1.0,"blend_mode":"normal","effects":[]}},
                    "constraints": {{"horizontal":"start","vertical":"start"}},
                    "visible": true,
                    "locked": false
                }}],
                "transitions": []
            }}"#,
            CURRENT_SCHEMA_VERSION,
        );
        let result = deserialize_page(&json);
        assert!(
            result.is_err(),
            "expected grid track validation error for negative size"
        );
    }

    #[test]
    fn test_deserialize_accepts_valid_grid_layout() {
        let json = format!(
            r#"{{
                "schema_version": {},
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Page",
                "nodes": [{{
                    "id": "00000000-0000-0000-0000-000000000002",
                    "kind": {{"type": "frame", "layout": {{"mode": "grid", "columns": [{{"type": "fixed", "size": 100.0}}, {{"type": "fractional", "fraction": 1.0}}, {{"type": "auto"}}], "rows": [{{"type": "min_max", "min": 50.0, "max": 200.0}}], "column_gap": 10, "row_gap": 10, "padding": {{"top": 0, "right": 0, "bottom": 0, "left": 0}}, "align_items": "start", "justify_items": "start"}}}},
                    "name": "GoodGrid",
                    "parent": null,
                    "children": [],
                    "transform": {{"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1}},
                    "style": {{"fills":[],"strokes":[],"opacity":1.0,"blend_mode":"normal","effects":[]}},
                    "constraints": {{"horizontal":"start","vertical":"start"}},
                    "visible": true,
                    "locked": false
                }}],
                "transitions": []
            }}"#,
            CURRENT_SCHEMA_VERSION,
        );
        let result = deserialize_page(&json);
        assert!(
            result.is_ok(),
            "valid grid layout should be accepted: {result:?}"
        );
    }
}
