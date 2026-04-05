//! Node operation tools — create, delete, rename, `set_transform`, `set_visible`, `set_locked`.
//!
//! All mutations follow the pattern:
//!   lock → resolve UUID → capture old state → construct command →
//!   `doc.execute(Box::new(cmd))` → build response → drop lock → `signal_dirty`

use agent_designer_core::{
    NodeId, NodeKind, Transform,
    commands::node_commands::{CreateNode, DeleteNode, RenameNode, SetLocked, SetVisible},
    commands::style_commands::SetTransform,
    commands::tree_commands::{ReorderChildren, ReparentNode},
};
use agent_designer_state::{AppState, MutationEvent, MutationEventKind};
use uuid::Uuid;

use crate::error::McpToolError;
use crate::server::acquire_document_lock;
use crate::tools::document::node_kind_to_string;
use crate::types::{CreateNodeResult, MutationResult, NodeInfo, TransformInfo, TransformInput};

// ── NodeKind parsing ─────────────────────────────────────────────────────────

/// Converts a string to the corresponding `NodeKind` variant.
///
/// # Errors
///
/// Returns `McpToolError::InvalidInput` if the string does not match a known kind.
pub fn parse_node_kind(kind: &str) -> Result<NodeKind, McpToolError> {
    match kind {
        "frame" => Ok(NodeKind::Frame { layout: None }),
        "rectangle" => Ok(NodeKind::Rectangle {
            corner_radii: [0.0; 4],
        }),
        "ellipse" => Ok(NodeKind::Ellipse {
            arc_start: 0.0,
            arc_end: 360.0,
        }),
        "text" => Ok(NodeKind::Text {
            content: String::new(),
            text_style: agent_designer_core::TextStyle::default(),
        }),
        "group" => Ok(NodeKind::Group),
        // RF-012: Image nodes require an asset_ref which cannot be provided at
        // creation time through MCP (no asset pipeline yet). Disallow until the
        // asset upload flow is implemented.
        "image" => Err(McpToolError::InvalidInput(
            "image nodes cannot be created via MCP — they require an asset_ref. \
             Use kind 'frame' and attach the image once the asset pipeline is available."
                .to_string(),
        )),
        other => Err(McpToolError::InvalidInput(format!(
            "unknown node kind '{other}': expected one of frame, rectangle, ellipse, text, group, image"
        ))),
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Validates a `TransformInput` for NaN/infinity and negative dimensions.
///
/// Per CLAUDE.md §11 "Floating-Point Validation", all `f64` fields from
/// external input must be checked before reaching the core engine.
fn validate_transform_input(t: &TransformInput) -> Result<(), McpToolError> {
    let fields = [
        t.x, t.y, t.width, t.height, t.rotation, t.scale_x, t.scale_y,
    ];
    for f in fields {
        if !f.is_finite() {
            return Err(McpToolError::InvalidInput(
                "transform fields must be finite (no NaN or infinity)".to_string(),
            ));
        }
    }
    if t.width < 0.0 || t.height < 0.0 {
        return Err(McpToolError::InvalidInput(format!(
            "transform dimensions must be non-negative, got width={}, height={}",
            t.width, t.height
        )));
    }
    Ok(())
}

/// Converts a `TransformInput` to a core `Transform`.
fn transform_input_to_core(t: &TransformInput) -> Transform {
    Transform {
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        scale_x: t.scale_x,
        scale_y: t.scale_y,
    }
}

/// Builds a `NodeInfo` from the locked document for a given node.
///
/// # Errors
///
/// Returns `McpToolError::NodeNotFound` if the `node_id` is not in the arena.
pub fn build_node_info(
    doc: &agent_designer_core::Document,
    node_id: NodeId,
    uuid: Uuid,
) -> Result<NodeInfo, McpToolError> {
    let node = doc
        .arena
        .get(node_id)
        .map_err(|_| McpToolError::NodeNotFound(uuid.to_string()))?;

    let children_uuids: Vec<String> = node
        .children
        .iter()
        .filter_map(|&cid| doc.arena.uuid_of(cid).ok().map(|u| u.to_string()))
        .collect();

    Ok(NodeInfo {
        uuid: uuid.to_string(),
        name: node.name.clone(),
        kind: node_kind_to_string(&node.kind).to_string(),
        visible: node.visible,
        locked: node.locked,
        children: children_uuids,
        transform: TransformInfo {
            x: node.transform.x,
            y: node.transform.y,
            width: node.transform.width,
            height: node.transform.height,
            rotation: node.transform.rotation,
            scale_x: node.transform.scale_x,
            scale_y: node.transform.scale_y,
        },
    })
}

// ── Tool implementations ─────────────────────────────────────────────────────

/// Creates a new node of the given kind and name, optionally placed on a page
/// and/or reparented under a parent node.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` for an unknown kind or invalid transform values.
/// - `McpToolError::InvalidUuid` if `page_id` or `parent_uuid` are not valid UUIDs.
/// - `McpToolError::PageNotFound` if the given `page_id` does not exist.
/// - `McpToolError::NodeNotFound` if the given `parent_uuid` does not exist.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn create_node_impl(
    state: &AppState,
    kind_str: &str,
    name: &str,
    page_id_str: Option<&str>,
    parent_uuid_str: Option<&str>,
    transform: Option<&TransformInput>,
) -> Result<CreateNodeResult, McpToolError> {
    let kind = parse_node_kind(kind_str)?;
    let node_uuid = Uuid::new_v4();

    // Validate transform before entering the lock.
    if let Some(t) = transform {
        validate_transform_input(t)?;
    }

    // Parse optional page_id.
    let page_id = page_id_str
        .map(|s| {
            s.parse::<Uuid>()
                .map(agent_designer_core::PageId::new)
                .map_err(|_| McpToolError::InvalidUuid(s.to_string()))
        })
        .transpose()?;

    // Parse optional parent_uuid.
    let parent_uuid = parent_uuid_str
        .map(|s| {
            s.parse::<Uuid>()
                .map_err(|_| McpToolError::InvalidUuid(s.to_string()))
        })
        .transpose()?;

    let initial_transform = transform.map(transform_input_to_core);

    let (node_id, node_info) = {
        let mut doc = acquire_document_lock(state);

        // Verify page exists if provided.
        if let Some(pid) = page_id {
            doc.page(pid)
                .map_err(|_| McpToolError::PageNotFound(page_id_str.unwrap_or("").to_string()))?;
        }

        // Resolve parent uuid to NodeId if provided.
        let parent_node_id = parent_uuid
            .map(|u| {
                doc.arena
                    .id_by_uuid(&u)
                    .ok_or_else(|| McpToolError::NodeNotFound(u.to_string()))
            })
            .transpose()?;

        let cmd = CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: node_uuid,
            kind,
            name: name.to_string(),
            page_id,
            initial_transform,
        };
        doc.execute(Box::new(cmd))?;

        // Resolve the actual NodeId from the UUID.
        let actual_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(node_uuid.to_string()))?;

        // If a parent was requested, reparent the node.
        // RF-007/RF-008: If reparent fails, undo the CreateNode to maintain
        // atomicity. Without CompoundCommand support, create+reparent is two
        // separate commands; undo requires two steps when a parent is specified.
        if let Some(parent_id) = parent_node_id {
            let new_position = doc.arena.get(parent_id)?.children.len();
            let old_parent_id = doc.arena.get(actual_id)?.parent;
            let old_position = old_parent_id.and_then(|pid| {
                doc.arena
                    .get(pid)
                    .ok()
                    .and_then(|p| p.children.iter().position(|&c| c == actual_id))
            });

            let reparent_cmd = ReparentNode {
                node_id: actual_id,
                new_parent_id: parent_id,
                new_position,
                old_parent_id,
                old_position,
            };
            if let Err(reparent_err) = doc.execute(Box::new(reparent_cmd)) {
                // Restore state before propagating error (CLAUDE.md section 11).
                // Undo the CreateNode that was already committed.
                if let Err(undo_err) = doc.undo() {
                    tracing::error!("failed to undo CreateNode after reparent failure: {undo_err}");
                    // Return a compound-style error that surfaces both failures.
                    return Err(McpToolError::InvalidInput(format!(
                        "reparent failed ({reparent_err}) and rollback also failed ({undo_err})"
                    )));
                }
                return Err(McpToolError::CoreError(reparent_err));
            }
        }

        let info = build_node_info(&doc, actual_id, node_uuid)?;
        (actual_id, info)
    };

    let _ = node_id; // node_id is not used after lock drop; uuid is returned
    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeCreated,
        uuid: Some(node_uuid.to_string()),
        data: None,
    });

    Ok(CreateNodeResult {
        uuid: node_uuid.to_string(),
        node: node_info,
    })
}

/// Deletes a node identified by UUID.
///
/// Captures a full snapshot of the node (for undo) then executes `DeleteNode`.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn delete_node_impl(state: &AppState, uuid_str: &str) -> Result<MutationResult, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        // Capture snapshot for undo.
        let snapshot = doc
            .arena
            .get(node_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .clone();

        let parent_id = snapshot.parent;
        let parent_child_index = parent_id.and_then(|pid| {
            doc.arena
                .get(pid)
                .ok()
                .and_then(|p| p.children.iter().position(|&c| c == node_id))
        });

        // Find if this node is a page root and where.
        let (page_id, page_root_index) = doc
            .pages
            .iter()
            .find_map(|page| {
                page.root_nodes
                    .iter()
                    .position(|&n| n == node_id)
                    .map(|idx| (Some(page.id), Some(idx)))
            })
            .unwrap_or((None, None));

        let cmd = DeleteNode {
            node_id,
            snapshot: Some(snapshot),
            page_id,
            page_root_index,
            parent_id,
            parent_child_index,
        };
        doc.execute(Box::new(cmd))?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeDeleted,
        uuid: Some(node_uuid.to_string()),
        data: None,
    });

    Ok(MutationResult {
        success: true,
        message: format!("Node {uuid_str} deleted"),
    })
}

/// Renames a node identified by UUID.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures (e.g. name too long).
pub fn rename_node_impl(
    state: &AppState,
    uuid_str: &str,
    new_name: &str,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_info = {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let old_name = doc
            .arena
            .get(node_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .name
            .clone();

        let cmd = RenameNode {
            node_id,
            new_name: new_name.to_string(),
            old_name,
        };
        doc.execute(Box::new(cmd))?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "name"})),
    });
    Ok(node_info)
}

/// Sets a node's transform.
///
/// Validates all float fields (NaN/infinity/negative dimensions) before
/// reaching the core engine.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::InvalidInput` if any transform field is NaN/infinity or dimension is negative.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_transform_impl(
    state: &AppState,
    uuid_str: &str,
    transform: &TransformInput,
) -> Result<NodeInfo, McpToolError> {
    validate_transform_input(transform)?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let new_transform = transform_input_to_core(transform);

    let node_info = {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let old_transform = doc
            .arena
            .get(node_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .transform;

        let cmd = SetTransform {
            node_id,
            new_transform,
            old_transform,
        };
        doc.execute(Box::new(cmd))?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "transform"})),
    });
    Ok(node_info)
}

/// Sets a node's visibility.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_visible_impl(
    state: &AppState,
    uuid_str: &str,
    visible: bool,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_info = {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let old_visible = doc
            .arena
            .get(node_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .visible;

        let cmd = SetVisible {
            node_id,
            new_visible: visible,
            old_visible,
        };
        doc.execute(Box::new(cmd))?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "visible"})),
    });
    Ok(node_info)
}

/// Sets a node's locked state.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_locked_impl(
    state: &AppState,
    uuid_str: &str,
    locked: bool,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_info = {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let old_locked = doc
            .arena
            .get(node_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .locked;

        let cmd = SetLocked {
            node_id,
            new_locked: locked,
            old_locked,
        };
        doc.execute(Box::new(cmd))?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "locked"})),
    });
    Ok(node_info)
}

/// Moves a node to a new parent at a specific position.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` or `new_parent_uuid_str` are not valid UUIDs.
/// - `McpToolError::NodeNotFound` if either node does not exist.
/// - `McpToolError::CoreError` on engine-level failures (e.g. cycle detection).
pub fn reparent_node_impl(
    state: &AppState,
    uuid_str: &str,
    new_parent_uuid_str: &str,
    position: i32,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;
    let parent_uuid: Uuid = new_parent_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(new_parent_uuid_str.to_string()))?;

    let node_info = {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;
        let parent_id = doc
            .arena
            .id_by_uuid(&parent_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(new_parent_uuid_str.to_string()))?;

        let old_parent_id = doc
            .arena
            .get(node_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .parent;
        let old_position = old_parent_id.and_then(|pid| {
            doc.arena
                .get(pid)
                .ok()
                .and_then(|p| p.children.iter().position(|&c| c == node_id))
        });

        let cmd = ReparentNode {
            node_id,
            new_parent_id: parent_id,
            new_position: usize::try_from(position.max(0)).unwrap_or(0),
            old_parent_id,
            old_position,
        };
        doc.execute(Box::new(cmd))?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "parent"})),
    });
    Ok(node_info)
}

/// Reorders a node within its parent's children list.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if the node does not exist.
/// - `McpToolError::CoreError` on engine-level failures (e.g. node has no parent).
pub fn reorder_children_impl(
    state: &AppState,
    uuid_str: &str,
    new_position: i32,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_info = {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let parent_id = doc
            .arena
            .get(node_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .parent
            .ok_or_else(|| {
                McpToolError::InvalidInput("node has no parent — cannot reorder".to_string())
            })?;

        let old_position = doc
            .arena
            .get(parent_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .children
            .iter()
            .position(|&c| c == node_id)
            .ok_or_else(|| {
                McpToolError::InvalidInput("node not found in parent's children list".to_string())
            })?;

        let cmd = ReorderChildren {
            node_id,
            new_position: usize::try_from(new_position.max(0)).unwrap_or(0),
            old_position,
        };
        doc.execute(Box::new(cmd))?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "order"})),
    });
    Ok(node_info)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use agent_designer_state::AppState;

    use super::*;
    use crate::tools::pages::create_page_impl;

    fn make_state_with_page() -> (AppState, String) {
        let state = AppState::new();
        let page = create_page_impl(&state, "Page 1").expect("create page");
        (state, page.id)
    }

    #[test]
    fn test_create_node_returns_uuid_and_info() {
        let (state, page_id) = make_state_with_page();
        let result = create_node_impl(&state, "frame", "My Frame", Some(&page_id), None, None);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let created = result.unwrap();
        assert!(!created.uuid.is_empty());
        assert_eq!(created.node.name, "My Frame");
        assert_eq!(created.node.kind, "frame");
        assert!(created.node.visible);
        assert!(!created.node.locked);

        // Verify UUID parses as valid.
        assert!(created.uuid.parse::<Uuid>().is_ok());
    }

    #[test]
    fn test_create_node_with_transform() {
        let (state, page_id) = make_state_with_page();
        let transform = TransformInput {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 50.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        };
        let result = create_node_impl(
            &state,
            "rectangle",
            "Rect",
            Some(&page_id),
            None,
            Some(&transform),
        );
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let created = result.unwrap();
        assert_eq!(created.node.transform.x, 10.0);
        assert_eq!(created.node.transform.y, 20.0);
        assert_eq!(created.node.transform.width, 100.0);
        assert_eq!(created.node.transform.height, 50.0);
    }

    #[test]
    fn test_delete_node_removes_it() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Doomed", Some(&page_id), None, None).unwrap();

        let result = delete_node_impl(&state, &created.uuid);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        assert!(result.unwrap().success);

        // Verify node is gone — deleting again should fail.
        let result2 = delete_node_impl(&state, &created.uuid);
        assert!(result2.is_err());
        assert!(matches!(
            result2.unwrap_err(),
            McpToolError::NodeNotFound(_)
        ));
    }

    #[test]
    fn test_rename_node_updates_name() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Old Name", Some(&page_id), None, None).unwrap();

        let result = rename_node_impl(&state, &created.uuid, "New Name");
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let info = result.unwrap();
        assert_eq!(info.name, "New Name");
        assert_eq!(info.uuid, created.uuid);
    }

    #[test]
    fn test_set_visible_toggles_visibility() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        // Default is visible=true; hide it.
        let result = set_visible_impl(&state, &created.uuid, false);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        assert!(!result.unwrap().visible);

        // Show it again.
        let result2 = set_visible_impl(&state, &created.uuid, true);
        assert!(result2.is_ok());
        assert!(result2.unwrap().visible);
    }

    #[test]
    fn test_set_locked_toggles_lock() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        // Default is locked=false; lock it.
        let result = set_locked_impl(&state, &created.uuid, true);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        assert!(result.unwrap().locked);

        // Unlock it.
        let result2 = set_locked_impl(&state, &created.uuid, false);
        assert!(result2.is_ok());
        assert!(!result2.unwrap().locked);
    }

    #[test]
    fn test_invalid_node_kind_returns_error() {
        let (state, page_id) = make_state_with_page();
        let result = create_node_impl(&state, "banana", "Bad Node", Some(&page_id), None, None);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_delete_nonexistent_node_returns_error() {
        let state = AppState::new();
        let fake_uuid = Uuid::new_v4().to_string();
        let result = delete_node_impl(&state, &fake_uuid);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::NodeNotFound(_)));
    }

    // ── RF-010: Float validation tests ────────────────────────────────

    #[test]
    fn test_set_transform_rejects_nan() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let transform = TransformInput {
            x: f64::NAN,
            y: 0.0,
            width: 100.0,
            height: 50.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        };
        let result = set_transform_impl(&state, &created.uuid, &transform);
        assert!(result.is_err(), "NaN should be rejected");
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("finite")),
            "error should mention finiteness"
        );
    }

    #[test]
    fn test_set_transform_rejects_infinity() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let transform = TransformInput {
            x: 0.0,
            y: f64::INFINITY,
            width: 100.0,
            height: 50.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        };
        let result = set_transform_impl(&state, &created.uuid, &transform);
        assert!(result.is_err(), "infinity should be rejected");
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("finite")),
            "error should mention finiteness"
        );
    }

    #[test]
    fn test_create_node_rejects_negative_dimensions() {
        let (state, page_id) = make_state_with_page();
        let transform = TransformInput {
            x: 0.0,
            y: 0.0,
            width: -10.0,
            height: 50.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        };
        let result = create_node_impl(
            &state,
            "frame",
            "Frame",
            Some(&page_id),
            None,
            Some(&transform),
        );
        assert!(result.is_err(), "negative width should be rejected");
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("non-negative")),
            "error should mention non-negative"
        );
    }

    // ── RF-012: Image node creation disallowed via MCP ────────────────

    #[test]
    fn test_create_image_node_returns_error() {
        let (state, page_id) = make_state_with_page();
        let result = create_node_impl(&state, "image", "My Image", Some(&page_id), None, None);
        assert!(result.is_err(), "image node creation should be rejected");
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("asset_ref")),
            "error should mention asset_ref requirement"
        );
    }

    // ── RF-007/RF-008: Atomic create+reparent rollback ────────────────

    #[test]
    fn test_create_node_with_invalid_parent_rolls_back() {
        let (state, page_id) = make_state_with_page();
        let fake_parent = Uuid::new_v4().to_string();

        // Attempt to create a node with a nonexistent parent. The parent UUID
        // is resolved before CreateNode executes, so this should fail without
        // leaving a dangling node.
        let result = create_node_impl(
            &state,
            "frame",
            "Orphan",
            Some(&page_id),
            Some(&fake_parent),
            None,
        );
        assert!(result.is_err());

        // Verify no nodes were left in the document.
        let doc = crate::server::acquire_document_lock(&state);
        let page = doc
            .page(
                page_id
                    .parse::<Uuid>()
                    .map(agent_designer_core::PageId::new)
                    .unwrap(),
            )
            .unwrap();
        assert!(
            page.root_nodes.is_empty(),
            "no nodes should remain after failed create+reparent"
        );
    }

    // ── reparent_node_impl ────────────────────────────────────────────

    #[test]
    fn test_reparent_node_moves_node_to_new_parent() {
        let (state, page_id) = make_state_with_page();
        let parent =
            create_node_impl(&state, "frame", "Parent", Some(&page_id), None, None).unwrap();
        let child = create_node_impl(&state, "frame", "Child", Some(&page_id), None, None).unwrap();

        let result = reparent_node_impl(&state, &child.uuid, &parent.uuid, 0);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let info = result.unwrap();
        assert_eq!(info.uuid, child.uuid);

        // Verify parent now has child — single lock acquisition to avoid deadlock
        let doc = crate::server::acquire_document_lock(&state);
        let parent_id = doc
            .arena
            .id_by_uuid(&parent.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let parent_info = build_node_info(&doc, parent_id, parent.uuid.parse().unwrap()).unwrap();
        assert!(parent_info.children.contains(&child.uuid));
    }

    #[test]
    fn test_reparent_node_with_invalid_uuid_returns_error() {
        let state = AppState::new();
        let result = reparent_node_impl(&state, "bad-uuid", "also-bad", 0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidUuid(_)));
    }

    // ── reorder_children_impl ─────────────────────────────────────────

    #[test]
    fn test_reorder_children_changes_position() {
        let (state, page_id) = make_state_with_page();
        let parent =
            create_node_impl(&state, "frame", "Parent", Some(&page_id), None, None).unwrap();
        let child_a = create_node_impl(&state, "frame", "A", Some(&page_id), None, None).unwrap();
        let child_b = create_node_impl(&state, "frame", "B", Some(&page_id), None, None).unwrap();
        let child_c = create_node_impl(&state, "frame", "C", Some(&page_id), None, None).unwrap();

        // Reparent children under parent
        reparent_node_impl(&state, &child_a.uuid, &parent.uuid, 0).unwrap();
        reparent_node_impl(&state, &child_b.uuid, &parent.uuid, 1).unwrap();
        reparent_node_impl(&state, &child_c.uuid, &parent.uuid, 2).unwrap();

        // Move A from position 0 to position 2
        let result = reorder_children_impl(&state, &child_a.uuid, 2);
        assert!(result.is_ok(), "expected ok, got: {result:?}");

        // Verify new order: B, C, A
        let doc = crate::server::acquire_document_lock(&state);
        let parent_id = doc
            .arena
            .id_by_uuid(&parent.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let children_uuids: Vec<String> = doc
            .arena
            .get(parent_id)
            .unwrap()
            .children
            .iter()
            .map(|&cid| doc.arena.uuid_of(cid).unwrap().to_string())
            .collect();
        assert_eq!(
            children_uuids,
            vec![child_b.uuid, child_c.uuid, child_a.uuid]
        );
    }

    #[test]
    fn test_reorder_children_on_root_node_returns_error() {
        let (state, page_id) = make_state_with_page();
        let root = create_node_impl(&state, "frame", "Root", Some(&page_id), None, None).unwrap();

        let result = reorder_children_impl(&state, &root.uuid, 0);
        assert!(result.is_err(), "root node has no parent, should fail");
    }
}
