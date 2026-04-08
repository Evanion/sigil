//! Node operation tools — create, delete, rename, `set_transform`, `set_visible`, `set_locked`.
//!
//! All mutations follow the pattern:
//!   lock → resolve UUID → construct operation →
//!   `op.validate(&doc)?; op.apply(&mut doc)?;` → build response → drop lock → `signal_dirty`

use agent_designer_core::{
    BlendMode, Effect, FieldOperation, Fill, MAX_EFFECTS_PER_STYLE, MAX_FILLS_PER_STYLE,
    MAX_STROKES_PER_STYLE, NodeId, NodeKind, Stroke, StyleValue, Transform,
    commands::node_commands::{CreateNode, DeleteNode, RenameNode, SetLocked, SetVisible},
    commands::style_commands::{
        SetBlendMode, SetCornerRadii, SetEffects, SetFills, SetOpacity, SetStrokes, SetTransform,
    },
    commands::tree_commands::{ReorderChildren, ReparentNode},
    validate_floats_in_value,
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
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        // Resolve the actual NodeId from the UUID.
        let actual_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(node_uuid.to_string()))?;

        // If a parent was requested, reparent the node.
        // RF-007/RF-008: If reparent fails, delete the created node to maintain
        // atomicity. Without undo, we must manually clean up.
        if let Some(parent_id) = parent_node_id {
            let new_position = doc.arena.get(parent_id)?.children.len();

            let reparent_cmd = ReparentNode {
                node_id: actual_id,
                new_parent_id: parent_id,
                new_position,
            };
            if let Err(reparent_err) = reparent_cmd
                .validate(&doc)
                .and_then(|()| reparent_cmd.apply(&mut doc))
            {
                // Restore state before propagating error (CLAUDE.md section 11).
                // Delete the node we just created to roll back.
                let rollback = DeleteNode {
                    node_id: actual_id,
                    page_id,
                };
                if let Err(rollback_err) = rollback
                    .validate(&doc)
                    .and_then(|()| rollback.apply(&mut doc))
                {
                    tracing::error!(
                        "failed to delete CreateNode after reparent failure: {rollback_err}"
                    );
                    return Err(McpToolError::InvalidInput(format!(
                        "reparent failed ({reparent_err}) and rollback also failed ({rollback_err})"
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
        transaction: None,
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

        // Find if this node is a page root.
        let page_id = doc.pages.iter().find_map(|page| {
            if page.root_nodes.contains(&node_id) {
                Some(page.id)
            } else {
                None
            }
        });

        let cmd = DeleteNode { node_id, page_id };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeDeleted,
        uuid: Some(node_uuid.to_string()),
        data: None,
        transaction: None,
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

        let cmd = RenameNode {
            node_id,
            new_name: new_name.to_string(),
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "name"})),
        transaction: None,
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

        let cmd = SetTransform {
            node_id,
            new_transform,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "transform"})),
        transaction: None,
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

        let cmd = SetVisible {
            node_id,
            new_visible: visible,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "visible"})),
        transaction: None,
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

        let cmd = SetLocked {
            node_id,
            new_locked: locked,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "locked"})),
        transaction: None,
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
    position: u32,
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

        // Positions beyond children count are clamped by the core engine (append semantics).
        let cmd = ReparentNode {
            node_id,
            new_parent_id: parent_id,
            new_position: position as usize,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "parent"})),
        transaction: None,
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
    new_position: u32,
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

        // Positions beyond children count are clamped by the core engine.
        let cmd = ReorderChildren {
            node_id,
            new_position: new_position as usize,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "order"})),
        transaction: None,
    });
    Ok(node_info)
}

// ── Style tool implementations ────────────────────────────────────────────────

/// Sets a node's opacity.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` if opacity is NaN, infinity, or outside [0.0, 1.0].
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_opacity_impl(
    state: &AppState,
    uuid_str: &str,
    opacity: f64,
) -> Result<MutationResult, McpToolError> {
    if !opacity.is_finite() {
        return Err(McpToolError::InvalidInput(
            "opacity must be finite (no NaN or infinity)".to_string(),
        ));
    }
    if !(0.0..=1.0).contains(&opacity) {
        return Err(McpToolError::InvalidInput(format!(
            "opacity must be in [0.0, 1.0], got {opacity}"
        )));
    }

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: opacity },
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "opacity"})),
        transaction: None,
    });

    Ok(MutationResult {
        success: true,
        message: format!("Opacity set to {opacity} on node {uuid_str}"),
    })
}

/// Sets a node's blend mode.
///
/// Parses the string to a `BlendMode` via serde deserialization.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` if the blend mode string is not recognized.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_blend_mode_impl(
    state: &AppState,
    uuid_str: &str,
    blend_mode_str: &str,
) -> Result<MutationResult, McpToolError> {
    let new_blend_mode: BlendMode = serde_json::from_value(serde_json::Value::String(
        blend_mode_str.to_string(),
    ))
    .map_err(|_| {
        McpToolError::InvalidInput(format!(
            "unknown blend mode '{blend_mode_str}': expected one of normal, multiply, screen, \
             overlay, darken, lighten, color_dodge, color_burn, hard_light, soft_light, \
             difference, exclusion, hue, saturation, color, luminosity"
        ))
    })?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetBlendMode {
            node_id,
            new_blend_mode,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "blend_mode"})),
        transaction: None,
    });

    Ok(MutationResult {
        success: true,
        message: format!("Blend mode set to '{blend_mode_str}' on node {uuid_str}"),
    })
}

/// Sets a node's fills.
///
/// Deserializes the `serde_json::Value` to `Vec<Fill>` before executing.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` if the fills JSON is invalid.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_fills_impl(
    state: &AppState,
    uuid_str: &str,
    fills_value: &serde_json::Value,
) -> Result<MutationResult, McpToolError> {
    validate_floats_in_value(fills_value)
        .map_err(|e| McpToolError::InvalidInput(format!("fills contain invalid floats: {e}")))?;

    let arr = fills_value
        .as_array()
        .ok_or_else(|| McpToolError::InvalidInput("fills must be a JSON array".to_string()))?;
    if arr.len() > MAX_FILLS_PER_STYLE {
        return Err(McpToolError::InvalidInput(format!(
            "fills array length {} exceeds maximum of {MAX_FILLS_PER_STYLE}",
            arr.len()
        )));
    }

    let new_fills: Vec<Fill> = serde_json::from_value(fills_value.clone())
        .map_err(|e| McpToolError::InvalidInput(format!("invalid fills JSON: {e}")))?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetFills { node_id, new_fills };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "fills"})),
        transaction: None,
    });

    Ok(MutationResult {
        success: true,
        message: format!("Fills updated on node {uuid_str}"),
    })
}

/// Sets a node's strokes.
///
/// Deserializes the `serde_json::Value` to `Vec<Stroke>` before executing.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` if the strokes JSON is invalid.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_strokes_impl(
    state: &AppState,
    uuid_str: &str,
    strokes_value: &serde_json::Value,
) -> Result<MutationResult, McpToolError> {
    validate_floats_in_value(strokes_value)
        .map_err(|e| McpToolError::InvalidInput(format!("strokes contain invalid floats: {e}")))?;

    let arr = strokes_value
        .as_array()
        .ok_or_else(|| McpToolError::InvalidInput("strokes must be a JSON array".to_string()))?;
    if arr.len() > MAX_STROKES_PER_STYLE {
        return Err(McpToolError::InvalidInput(format!(
            "strokes array length {} exceeds maximum of {MAX_STROKES_PER_STYLE}",
            arr.len()
        )));
    }

    let new_strokes: Vec<Stroke> = serde_json::from_value(strokes_value.clone())
        .map_err(|e| McpToolError::InvalidInput(format!("invalid strokes JSON: {e}")))?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetStrokes {
            node_id,
            new_strokes,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "strokes"})),
        transaction: None,
    });

    Ok(MutationResult {
        success: true,
        message: format!("Strokes updated on node {uuid_str}"),
    })
}

/// Sets a node's effects.
///
/// Deserializes the `serde_json::Value` to `Vec<Effect>` before executing.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` if the effects JSON is invalid.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_effects_impl(
    state: &AppState,
    uuid_str: &str,
    effects_value: &serde_json::Value,
) -> Result<MutationResult, McpToolError> {
    validate_floats_in_value(effects_value)
        .map_err(|e| McpToolError::InvalidInput(format!("effects contain invalid floats: {e}")))?;

    let arr = effects_value
        .as_array()
        .ok_or_else(|| McpToolError::InvalidInput("effects must be a JSON array".to_string()))?;
    if arr.len() > MAX_EFFECTS_PER_STYLE {
        return Err(McpToolError::InvalidInput(format!(
            "effects array length {} exceeds maximum of {MAX_EFFECTS_PER_STYLE}",
            arr.len()
        )));
    }

    let new_effects: Vec<Effect> = serde_json::from_value(effects_value.clone())
        .map_err(|e| McpToolError::InvalidInput(format!("invalid effects JSON: {e}")))?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetEffects {
            node_id,
            new_effects,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "effects"})),
        transaction: None,
    });

    Ok(MutationResult {
        success: true,
        message: format!("Effects updated on node {uuid_str}"),
    })
}

/// Sets a rectangle node's corner radii.
///
/// Validates that exactly 4 elements are provided, all finite and non-negative.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` if radii count is not 4, or any value is NaN/infinity/negative.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures (e.g. node is not a rectangle).
pub fn set_corner_radii_impl(
    state: &AppState,
    uuid_str: &str,
    radii: &[f64],
) -> Result<MutationResult, McpToolError> {
    if radii.len() != 4 {
        return Err(McpToolError::InvalidInput(format!(
            "corner radii must have exactly 4 elements, got {}",
            radii.len()
        )));
    }
    for (i, &r) in radii.iter().enumerate() {
        if !r.is_finite() {
            return Err(McpToolError::InvalidInput(format!(
                "radii[{i}] must be finite (no NaN or infinity), got {r}"
            )));
        }
        if r < 0.0 {
            return Err(McpToolError::InvalidInput(format!(
                "radii[{i}] must be non-negative, got {r}"
            )));
        }
    }
    let new_radii: [f64; 4] = [radii[0], radii[1], radii[2], radii[3]];

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetCornerRadii { node_id, new_radii };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "corner_radii"})),
        transaction: None,
    });

    Ok(MutationResult {
        success: true,
        message: format!("Corner radii set on node {uuid_str}"),
    })
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

    // ── set_opacity_impl ──────────────────────────────────────────────

    #[test]
    fn test_set_opacity_impl_updates_opacity() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_opacity_impl(&state, &created.uuid, 0.5);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let mutation = result.unwrap();
        assert!(mutation.success);
        assert!(mutation.message.contains("0.5"));

        // Verify the opacity was actually applied.
        let doc = crate::server::acquire_document_lock(&state);
        let node_id = doc
            .arena
            .id_by_uuid(&created.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let node = doc.arena.get(node_id).unwrap();
        assert_eq!(
            node.style.opacity,
            agent_designer_core::StyleValue::Literal { value: 0.5 }
        );
    }

    #[test]
    fn test_set_opacity_impl_rejects_nan() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_opacity_impl(&state, &created.uuid, f64::NAN);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_set_opacity_impl_rejects_out_of_range() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_opacity_impl(&state, &created.uuid, 1.5);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));

        let result2 = set_opacity_impl(&state, &created.uuid, -0.1);
        assert!(result2.is_err());
        assert!(matches!(
            result2.unwrap_err(),
            McpToolError::InvalidInput(_)
        ));
    }

    // ── set_blend_mode_impl ───────────────────────────────────────────

    #[test]
    fn test_set_blend_mode_impl_updates_blend_mode() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_blend_mode_impl(&state, &created.uuid, "multiply");
        assert!(result.is_ok(), "expected ok, got: {result:?}");

        let doc = crate::server::acquire_document_lock(&state);
        let node_id = doc
            .arena
            .id_by_uuid(&created.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let node = doc.arena.get(node_id).unwrap();
        assert_eq!(
            node.style.blend_mode,
            agent_designer_core::BlendMode::Multiply
        );
    }

    #[test]
    fn test_set_blend_mode_impl_rejects_invalid() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_blend_mode_impl(&state, &created.uuid, "banana");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    // ── set_corner_radii_impl ─────────────────────────────────────────

    #[test]
    fn test_set_corner_radii_impl_on_rectangle() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "rectangle", "Rect", Some(&page_id), None, None).unwrap();

        let result = set_corner_radii_impl(&state, &created.uuid, &[4.0, 8.0, 4.0, 8.0]);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        assert!(result.unwrap().success);

        // Verify radii were applied.
        let doc = crate::server::acquire_document_lock(&state);
        let node_id = doc
            .arena
            .id_by_uuid(&created.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let node = doc.arena.get(node_id).unwrap();
        match &node.kind {
            agent_designer_core::NodeKind::Rectangle { corner_radii } => {
                assert_eq!(*corner_radii, [4.0, 8.0, 4.0, 8.0]);
            }
            _ => panic!("expected rectangle"),
        }
    }

    #[test]
    fn test_set_corner_radii_impl_rejects_non_rectangle() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_corner_radii_impl(&state, &created.uuid, &[4.0, 4.0, 4.0, 4.0]);
        assert!(result.is_err());
        // Rectangle check now comes from core's validate() via From<CoreError>
        let err = result.unwrap_err();
        assert!(
            matches!(
                &err,
                McpToolError::CoreError(agent_designer_core::CoreError::ValidationError(msg))
                    if msg.contains("Rectangle") || msg.contains("rectangle")
            ),
            "error should mention rectangle requirement, got: {err}"
        );
    }

    #[test]
    fn test_set_corner_radii_impl_rejects_wrong_count() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "rectangle", "Rect", Some(&page_id), None, None).unwrap();

        let result = set_corner_radii_impl(&state, &created.uuid, &[4.0, 4.0]);
        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("4 elements")),
            "error should mention 4 elements"
        );
    }

    #[test]
    fn test_set_corner_radii_impl_rejects_negative() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "rectangle", "Rect", Some(&page_id), None, None).unwrap();

        let result = set_corner_radii_impl(&state, &created.uuid, &[4.0, -1.0, 4.0, 4.0]);
        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("non-negative")),
            "error should mention non-negative"
        );
    }

    #[test]
    fn test_set_corner_radii_impl_rejects_nan() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "rectangle", "Rect", Some(&page_id), None, None).unwrap();

        let result = set_corner_radii_impl(&state, &created.uuid, &[f64::NAN, 0.0, 0.0, 0.0]);
        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("finite")),
            "error should mention finiteness"
        );
    }

    // ── set_fills_impl ────────────────────────────────────────────────

    #[test]
    fn test_set_fills_impl_rejects_invalid_json() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let bad_json = serde_json::json!("not an array");
        let result = set_fills_impl(&state, &created.uuid, &bad_json);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_set_fills_impl_updates_fills() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let fills_json = serde_json::json!([
            {
                "type": "solid",
                "color": {
                    "type": "literal",
                    "value": { "space": "srgb", "r": 1.0, "g": 0.0, "b": 0.0, "a": 1.0 }
                }
            }
        ]);
        let result = set_fills_impl(&state, &created.uuid, &fills_json);
        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    // ── set_strokes_impl ──────────────────────────────────────────────

    #[test]
    fn test_set_strokes_impl_rejects_invalid_json() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let bad_json = serde_json::json!(42);
        let result = set_strokes_impl(&state, &created.uuid, &bad_json);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_set_strokes_impl_updates_strokes() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let strokes_json = serde_json::json!([
            {
                "color": {
                    "type": "literal",
                    "value": { "space": "srgb", "r": 0.0, "g": 0.0, "b": 0.0, "a": 1.0 }
                },
                "width": { "type": "literal", "value": 2.0 },
                "alignment": "center",
                "cap": "butt",
                "join": "miter"
            }
        ]);
        let result = set_strokes_impl(&state, &created.uuid, &strokes_json);
        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    // ── set_effects_impl ──────────────────────────────────────────────

    #[test]
    fn test_set_effects_impl_rejects_invalid_json() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let bad_json = serde_json::json!({"not": "an array"});
        let result = set_effects_impl(&state, &created.uuid, &bad_json);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_set_effects_impl_updates_effects() {
        let (state, page_id) = make_state_with_page();
        let created =
            create_node_impl(&state, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let effects_json = serde_json::json!([
            {
                "type": "drop_shadow",
                "color": {
                    "type": "literal",
                    "value": { "space": "srgb", "r": 0.0, "g": 0.0, "b": 0.0, "a": 0.5 }
                },
                "offset": { "x": 4.0, "y": 4.0 },
                "blur": { "type": "literal", "value": 8.0 },
                "spread": { "type": "literal", "value": 0.0 }
            }
        ]);
        let result = set_effects_impl(&state, &created.uuid, &effects_json);
        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }
}
