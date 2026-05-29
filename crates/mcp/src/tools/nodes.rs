//! Node operation tools — create, delete, rename, `set_transform`, `set_visible`, `set_locked`.
//!
//! Write `_impl`s are pure functions over `&mut Document`; the session-scoped
//! envelope in `crate::server` holds the session store write lock, runs the
//! `_impl`, builds the broadcast `value` from post-mutation state, and publishes
//! on the session's broadcast channel.

use sigil_core::{
    BlendMode, Effect, FieldOperation, Fill, MAX_EFFECTS_PER_STYLE, MAX_FILLS_PER_STYLE,
    MAX_STROKES_PER_STYLE, NodeId, NodeKind, Stroke, StyleValue, Transform,
    commands::node_commands::{CreateNode, DeleteNodes, RenameNode, SetLocked, SetVisible},
    commands::style_commands::{
        SetBlendMode, SetCorners, SetEffects, SetFills, SetOpacity, SetStrokes, SetTransform,
    },
    commands::tree_commands::{ReorderChildren, ReparentNode},
    validate_floats_in_value,
};
use uuid::Uuid;

use crate::error::McpToolError;
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
        "frame" => Ok(NodeKind::Frame {
            layout: None,
            corners: sigil_core::node::default_corners(),
        }),
        "rectangle" => Ok(NodeKind::Rectangle {
            corners: sigil_core::node::default_corners(),
        }),
        "ellipse" => Ok(NodeKind::Ellipse {
            arc_start: 0.0,
            arc_end: 360.0,
        }),
        "text" => Ok(NodeKind::Text {
            content: String::new(),
            text_style: sigil_core::TextStyle::default(),
            sizing: sigil_core::TextSizing::AutoWidth,
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
    doc: &sigil_core::Document,
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
    doc: &mut sigil_core::Document,
    kind_str: &str,
    name: &str,
    page_id_str: Option<&str>,
    parent_uuid_str: Option<&str>,
    transform: Option<&TransformInput>,
) -> Result<CreateNodeResult, McpToolError> {
    let kind = parse_node_kind(kind_str)?;
    let node_uuid = Uuid::new_v4();

    // Validate transform before mutating.
    if let Some(t) = transform {
        validate_transform_input(t)?;
    }

    // Parse optional page_id.
    let page_id = page_id_str
        .map(|s| {
            s.parse::<Uuid>()
                .map(sigil_core::PageId::new)
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
        uuid: node_uuid,
        kind,
        name: name.to_string(),
        page_id,
        initial_transform,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

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
            .validate(doc)
            .and_then(|()| reparent_cmd.apply(doc))
        {
            // Restore state before propagating error (CLAUDE.md section 11).
            // Delete the node we just created to roll back. Uses the
            // plural `DeleteNodes` with a one-element batch — the only
            // delete path in the core crate after Spec 19 Task 16.
            let rollback = DeleteNodes {
                targets: vec![(actual_id, page_id)],
            };
            if let Err(rollback_err) = rollback.validate(doc).and_then(|()| rollback.apply(doc)) {
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

    let node_info = build_node_info(doc, actual_id, node_uuid)?;

    Ok(CreateNodeResult {
        uuid: node_uuid.to_string(),
        node: node_info,
    })
}

/// Atomically deletes N nodes by UUID (Spec 19).
///
/// Resolves each UUID to a `NodeId`, looks up its page-root membership,
/// then executes `DeleteNodes`. Broadcasts a single `delete_nodes` event
/// containing the full UUID list.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if any UUID in the input is malformed.
/// - `McpToolError::NodeNotFound` if any UUID does not resolve.
/// - `McpToolError::CoreError` on engine-level failures (validate or apply).
pub fn delete_nodes_impl(
    doc: &mut sigil_core::Document,
    uuid_strs: &[String],
) -> Result<(MutationResult, Vec<String>), McpToolError> {
    // RF-005: Reject empty/oversize batches BEFORE allocating the
    // parsed-UUIDs vec. Prevents memory amplification from giant tool
    // inputs that would otherwise allocate proportional to the input
    // size before validate() fires. Core's `DeleteNodes::validate` also
    // enforces these bounds (single source of truth) but the wire layer
    // must short-circuit first to bound allocation.
    if uuid_strs.is_empty() {
        return Err(McpToolError::InvalidInput(
            "delete_nodes: empty batch".to_string(),
        ));
    }
    if uuid_strs.len() > sigil_core::validate::MAX_NODES_PER_DELETE_BATCH {
        return Err(McpToolError::InvalidInput(format!(
            "delete_nodes: batch of {} exceeds MAX_NODES_PER_DELETE_BATCH ({})",
            uuid_strs.len(),
            sigil_core::validate::MAX_NODES_PER_DELETE_BATCH,
        )));
    }

    // Pre-parse UUIDs. Fail-fast on invalid input.
    let parsed: Vec<Uuid> = uuid_strs
        .iter()
        .map(|s| {
            s.parse::<Uuid>()
                .map_err(|_| McpToolError::InvalidUuid(s.clone()))
        })
        .collect::<Result<Vec<_>, _>>()?;

    // RF-022: Pre-build a NodeId -> PageId map once, then look up
    // each target in O(1). Previous code did O(P * R) per target.
    let mut node_to_page: std::collections::HashMap<
        sigil_core::id::NodeId,
        sigil_core::id::PageId,
    > = std::collections::HashMap::new();
    for page in &doc.pages {
        for nid in &page.root_nodes {
            node_to_page.insert(*nid, page.id);
        }
    }

    let mut targets: Vec<(sigil_core::id::NodeId, Option<sigil_core::id::PageId>)> =
        Vec::with_capacity(parsed.len());
    for (idx, uuid) in parsed.iter().enumerate() {
        let node_id = doc
            .arena
            .id_by_uuid(uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_strs[idx].clone()))?;
        let page_id = node_to_page.get(&node_id).copied();
        targets.push((node_id, page_id));
    }

    let cmd = DeleteNodes { targets };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    // RF-020/036: Build broadcast value with canonicalized UUID strings
    // (lowercase hyphenated form from `Uuid::to_string()`) regardless of
    // the input style. We forward all originally-requested UUIDs (not the
    // dedup-retained set produced by core's `apply`) because the frontend
    // `applyDeleteNodes` walks the local subtree from each broadcast root
    // and is tolerant of "uuid already deleted" — descendants that core's
    // dedup dropped are removed by the local walk anyway. Returned to the
    // envelope's closure so the broadcast value carries them.
    let canonicalized_uuids: Vec<String> = parsed.iter().map(Uuid::to_string).collect();

    Ok((
        MutationResult {
            success: true,
            message: format!("Deleted {} node(s)", uuid_strs.len()),
        },
        canonicalized_uuids,
    ))
}

/// Renames a node identified by UUID.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures (e.g. name too long).
pub fn rename_node_impl(
    doc: &mut sigil_core::Document,
    uuid_str: &str,
    new_name: &str,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = RenameNode {
        node_id,
        new_name: new_name.to_string(),
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    build_node_info(doc, node_id, node_uuid)
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
    doc: &mut sigil_core::Document,
    uuid_str: &str,
    transform: &TransformInput,
) -> Result<NodeInfo, McpToolError> {
    validate_transform_input(transform)?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let new_transform = transform_input_to_core(transform);

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetTransform {
        node_id,
        new_transform,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    build_node_info(doc, node_id, node_uuid)
}

/// Sets a node's visibility.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_visible_impl(
    doc: &mut sigil_core::Document,
    uuid_str: &str,
    visible: bool,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetVisible {
        node_id,
        new_visible: visible,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    build_node_info(doc, node_id, node_uuid)
}

/// Sets a node's locked state.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn set_locked_impl(
    doc: &mut sigil_core::Document,
    uuid_str: &str,
    locked: bool,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetLocked {
        node_id,
        new_locked: locked,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    build_node_info(doc, node_id, node_uuid)
}

/// Moves a node to a new parent at a specific position.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` or `new_parent_uuid_str` are not valid UUIDs.
/// - `McpToolError::NodeNotFound` if either node does not exist.
/// - `McpToolError::CoreError` on engine-level failures (e.g. cycle detection).
pub fn reparent_node_impl(
    doc: &mut sigil_core::Document,
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
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    build_node_info(doc, node_id, node_uuid)
}

/// Reorders a node within its parent's children list.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if the node does not exist.
/// - `McpToolError::CoreError` on engine-level failures (e.g. node has no parent).
pub fn reorder_children_impl(
    doc: &mut sigil_core::Document,
    uuid_str: &str,
    new_position: u32,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    // Positions beyond children count are clamped by the core engine.
    let cmd = ReorderChildren {
        node_id,
        new_position: new_position as usize,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    build_node_info(doc, node_id, node_uuid)
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
    doc: &mut sigil_core::Document,
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

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetOpacity {
        node_id,
        new_opacity: StyleValue::Literal { value: opacity },
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

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
    doc: &mut sigil_core::Document,
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

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetBlendMode {
        node_id,
        new_blend_mode,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

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
    doc: &mut sigil_core::Document,
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

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetFills { node_id, new_fills };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

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
    doc: &mut sigil_core::Document,
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

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetStrokes {
        node_id,
        new_strokes,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

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
    doc: &mut sigil_core::Document,
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

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetEffects {
        node_id,
        new_effects,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    Ok(MutationResult {
        success: true,
        message: format!("Effects updated on node {uuid_str}"),
    })
}

/// Sets a node's corner shapes.
///
/// The `corners_value` JSON is parsed via `corners_input::parse_corners_input` which expands
/// the three accepted input shapes (uniform object shorthand, shape-level superellipse,
/// per-corner array) into `[Corner; 4]`. The per-corner array form rejects
/// `Corner::Superellipse` variants — superellipse must arrive through the shape-level shorthand.
///
/// Returns the `MutationResult` plus the canonical post-mutation `NodeKind` JSON
/// so the envelope can source the broadcast `value` from post-mutation state
/// (CLAUDE.md "Broadcast value must be sourced from post-mutation document
/// state"). The envelope broadcasts it with `op_type = "set_field"` and
/// `path = "kind"`.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` if the shorthand is malformed, any numeric is non-finite or
///   negative, smoothing is out of `[0.0, 1.0]`, or a per-corner array contains a superellipse.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures (e.g. node is not a corner-bearing kind).
pub fn set_corners_impl(
    doc: &mut sigil_core::Document,
    uuid_str: &str,
    corners_value: &serde_json::Value,
) -> Result<(MutationResult, serde_json::Value), McpToolError> {
    let new_corners = sigil_core::corners_input::parse_corners_input(corners_value)
        .map_err(|e| McpToolError::InvalidInput(e.to_string()))?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetCorners {
        node_id,
        new_corners,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    // Read the canonical post-mutation kind back from the document so the
    // broadcast value reflects the applied state, not the raw shorthand input.
    let node = doc.arena.get(node_id)?;
    let kind_json = serde_json::to_value(&node.kind)?;

    Ok((
        MutationResult {
            success: true,
            message: format!("Corners set on node {uuid_str}"),
        },
        kind_json,
    ))
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use sigil_core::Document;

    use super::*;
    use crate::tools::pages::create_page_impl;

    fn make_doc_with_page() -> (Document, String) {
        let mut doc = Document::new("Untitled".to_string());
        let page = create_page_impl(&mut doc, "Page 1").expect("create page");
        (doc, page.id)
    }

    #[test]
    fn test_create_node_returns_uuid_and_info() {
        let (mut doc, page_id) = make_doc_with_page();
        let result = create_node_impl(&mut doc, "frame", "My Frame", Some(&page_id), None, None);
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
        let (mut doc, page_id) = make_doc_with_page();
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
            &mut doc,
            "rectangle",
            "Rect",
            Some(&page_id),
            None,
            Some(&transform),
        );
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let created = result.unwrap();
        // Exact bit equality: literals pass through serde without lossy ops.
        assert_eq!(created.node.transform.x.to_bits(), 10.0_f64.to_bits());
        assert_eq!(created.node.transform.y.to_bits(), 20.0_f64.to_bits());
        assert_eq!(created.node.transform.width.to_bits(), 100.0_f64.to_bits());
        assert_eq!(created.node.transform.height.to_bits(), 50.0_f64.to_bits());
    }

    #[test]
    fn test_rename_node_updates_name() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Old Name", Some(&page_id), None, None).unwrap();

        let result = rename_node_impl(&mut doc, &created.uuid, "New Name");
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let info = result.unwrap();
        assert_eq!(info.name, "New Name");
        assert_eq!(info.uuid, created.uuid);
    }

    #[test]
    fn test_set_visible_toggles_visibility() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        // Default is visible=true; hide it.
        let result = set_visible_impl(&mut doc, &created.uuid, false);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        assert!(!result.unwrap().visible);

        // Show it again.
        let result2 = set_visible_impl(&mut doc, &created.uuid, true);
        assert!(result2.is_ok());
        assert!(result2.unwrap().visible);
    }

    #[test]
    fn test_set_locked_toggles_lock() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        // Default is locked=false; lock it.
        let result = set_locked_impl(&mut doc, &created.uuid, true);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        assert!(result.unwrap().locked);

        // Unlock it.
        let result2 = set_locked_impl(&mut doc, &created.uuid, false);
        assert!(result2.is_ok());
        assert!(!result2.unwrap().locked);
    }

    #[test]
    fn test_invalid_node_kind_returns_error() {
        let (mut doc, page_id) = make_doc_with_page();
        let result = create_node_impl(&mut doc, "banana", "Bad Node", Some(&page_id), None, None);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    // ── RF-010: Float validation tests ────────────────────────────────

    #[test]
    fn test_set_transform_rejects_nan() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let transform = TransformInput {
            x: f64::NAN,
            y: 0.0,
            width: 100.0,
            height: 50.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        };
        let result = set_transform_impl(&mut doc, &created.uuid, &transform);
        assert!(result.is_err(), "NaN should be rejected");
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("finite")),
            "error should mention finiteness"
        );
    }

    #[test]
    fn test_set_transform_rejects_infinity() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let transform = TransformInput {
            x: 0.0,
            y: f64::INFINITY,
            width: 100.0,
            height: 50.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        };
        let result = set_transform_impl(&mut doc, &created.uuid, &transform);
        assert!(result.is_err(), "infinity should be rejected");
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("finite")),
            "error should mention finiteness"
        );
    }

    #[test]
    fn test_create_node_rejects_negative_dimensions() {
        let (mut doc, page_id) = make_doc_with_page();
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
            &mut doc,
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
        let (mut doc, page_id) = make_doc_with_page();
        let result = create_node_impl(&mut doc, "image", "My Image", Some(&page_id), None, None);
        assert!(result.is_err(), "image node creation should be rejected");
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(msg) if msg.contains("asset_ref")),
            "error should mention asset_ref requirement"
        );
    }

    // ── RF-007/RF-008: Atomic create+reparent rollback ────────────────

    #[test]
    fn test_create_node_with_invalid_parent_rolls_back() {
        let (mut doc, page_id) = make_doc_with_page();
        let fake_parent = Uuid::new_v4().to_string();

        // Attempt to create a node with a nonexistent parent. The parent UUID
        // is resolved before CreateNode executes, so this should fail without
        // leaving a dangling node.
        let result = create_node_impl(
            &mut doc,
            "frame",
            "Orphan",
            Some(&page_id),
            Some(&fake_parent),
            None,
        );
        assert!(result.is_err());

        // Verify no nodes were left in the document.
        let page = doc
            .page(
                page_id
                    .parse::<Uuid>()
                    .map(sigil_core::PageId::new)
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
        let (mut doc, page_id) = make_doc_with_page();
        let parent =
            create_node_impl(&mut doc, "frame", "Parent", Some(&page_id), None, None).unwrap();
        let child =
            create_node_impl(&mut doc, "frame", "Child", Some(&page_id), None, None).unwrap();

        let result = reparent_node_impl(&mut doc, &child.uuid, &parent.uuid, 0);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let info = result.unwrap();
        assert_eq!(info.uuid, child.uuid);

        // Verify parent now has child.
        let parent_id = doc
            .arena
            .id_by_uuid(&parent.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let parent_info = build_node_info(&doc, parent_id, parent.uuid.parse().unwrap()).unwrap();
        assert!(parent_info.children.contains(&child.uuid));
    }

    #[test]
    fn test_reparent_node_with_invalid_uuid_returns_error() {
        let mut doc = Document::new("Untitled".to_string());
        let result = reparent_node_impl(&mut doc, "bad-uuid", "also-bad", 0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidUuid(_)));
    }

    // ── reorder_children_impl ─────────────────────────────────────────

    #[test]
    fn test_reorder_children_changes_position() {
        let (mut doc, page_id) = make_doc_with_page();
        let parent =
            create_node_impl(&mut doc, "frame", "Parent", Some(&page_id), None, None).unwrap();
        let child_a = create_node_impl(&mut doc, "frame", "A", Some(&page_id), None, None).unwrap();
        let child_b = create_node_impl(&mut doc, "frame", "B", Some(&page_id), None, None).unwrap();
        let child_c = create_node_impl(&mut doc, "frame", "C", Some(&page_id), None, None).unwrap();

        // Reparent children under parent
        reparent_node_impl(&mut doc, &child_a.uuid, &parent.uuid, 0).unwrap();
        reparent_node_impl(&mut doc, &child_b.uuid, &parent.uuid, 1).unwrap();
        reparent_node_impl(&mut doc, &child_c.uuid, &parent.uuid, 2).unwrap();

        // Move A from position 0 to position 2
        let result = reorder_children_impl(&mut doc, &child_a.uuid, 2);
        assert!(result.is_ok(), "expected ok, got: {result:?}");

        // Verify new order: B, C, A
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
        let (mut doc, page_id) = make_doc_with_page();
        let root = create_node_impl(&mut doc, "frame", "Root", Some(&page_id), None, None).unwrap();

        let result = reorder_children_impl(&mut doc, &root.uuid, 0);
        assert!(result.is_err(), "root node has no parent, should fail");
    }

    // ── set_opacity_impl ──────────────────────────────────────────────

    #[test]
    fn test_set_opacity_impl_updates_opacity() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_opacity_impl(&mut doc, &created.uuid, 0.5);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let mutation = result.unwrap();
        assert!(mutation.success);
        assert!(mutation.message.contains("0.5"));

        // Verify the opacity was actually applied.
        let node_id = doc
            .arena
            .id_by_uuid(&created.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let node = doc.arena.get(node_id).unwrap();
        assert_eq!(
            node.style.opacity,
            sigil_core::StyleValue::Literal { value: 0.5 }
        );
    }

    #[test]
    fn test_set_opacity_impl_rejects_nan() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_opacity_impl(&mut doc, &created.uuid, f64::NAN);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_set_opacity_impl_rejects_out_of_range() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_opacity_impl(&mut doc, &created.uuid, 1.5);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));

        let result2 = set_opacity_impl(&mut doc, &created.uuid, -0.1);
        assert!(result2.is_err());
        assert!(matches!(
            result2.unwrap_err(),
            McpToolError::InvalidInput(_)
        ));
    }

    // ── set_blend_mode_impl ───────────────────────────────────────────

    #[test]
    fn test_set_blend_mode_impl_updates_blend_mode() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_blend_mode_impl(&mut doc, &created.uuid, "multiply");
        assert!(result.is_ok(), "expected ok, got: {result:?}");

        let node_id = doc
            .arena
            .id_by_uuid(&created.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let node = doc.arena.get(node_id).unwrap();
        assert_eq!(node.style.blend_mode, sigil_core::BlendMode::Multiply);
    }

    #[test]
    fn test_set_blend_mode_impl_rejects_invalid() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let result = set_blend_mode_impl(&mut doc, &created.uuid, "banana");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    // ── set_fills_impl ────────────────────────────────────────────────

    #[test]
    fn test_set_fills_impl_rejects_invalid_json() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let bad_json = serde_json::json!("not an array");
        let result = set_fills_impl(&mut doc, &created.uuid, &bad_json);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_set_fills_impl_updates_fills() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let fills_json = serde_json::json!([
            {
                "type": "solid",
                "color": {
                    "type": "literal",
                    "value": { "space": "srgb", "r": 1.0, "g": 0.0, "b": 0.0, "a": 1.0 }
                }
            }
        ]);
        let result = set_fills_impl(&mut doc, &created.uuid, &fills_json);
        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    // ── set_strokes_impl ──────────────────────────────────────────────

    #[test]
    fn test_set_strokes_impl_rejects_invalid_json() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let bad_json = serde_json::json!(42);
        let result = set_strokes_impl(&mut doc, &created.uuid, &bad_json);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_set_strokes_impl_updates_strokes() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

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
        let result = set_strokes_impl(&mut doc, &created.uuid, &strokes_json);
        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    // ── set_effects_impl ──────────────────────────────────────────────

    #[test]
    fn test_set_effects_impl_rejects_invalid_json() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

        let bad_json = serde_json::json!({"not": "an array"});
        let result = set_effects_impl(&mut doc, &created.uuid, &bad_json);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidInput(_)));
    }

    #[test]
    fn test_set_effects_impl_updates_effects() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "frame", "Frame", Some(&page_id), None, None).unwrap();

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
        let result = set_effects_impl(&mut doc, &created.uuid, &effects_json);
        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    // ── set_corners_impl ──────────────────────────────────────────────

    #[test]
    fn test_set_corners_uniform_shorthand() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "rectangle", "Rect", Some(&page_id), None, None).unwrap();

        // Uniform shorthand: object form with shape + radius
        let corners_json = serde_json::json!({ "shape": "round", "radius": 12.0 });
        let result = set_corners_impl(&mut doc, &created.uuid, &corners_json);
        assert!(result.is_ok(), "expected ok, got: {result:?}");
        let (mutation, _kind_json) = result.unwrap();
        assert!(mutation.success);

        let node_id = doc
            .arena
            .id_by_uuid(&created.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let node = doc.arena.get(node_id).unwrap();
        let sigil_core::NodeKind::Rectangle { corners } = &node.kind else {
            panic!("expected rectangle");
        };
        for corner in corners {
            let sigil_core::Corner::Round { radii } = corner else {
                panic!("expected round corner, got {corner:?}");
            };
            // Exact bit equality: literals pass through serde without lossy ops.
            assert_eq!(radii.x().to_bits(), 12.0_f64.to_bits());
            assert_eq!(radii.y().to_bits(), 12.0_f64.to_bits());
        }
    }

    #[test]
    fn test_set_corners_superellipse_shorthand() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "rectangle", "Rect", Some(&page_id), None, None).unwrap();

        let corners_json = serde_json::json!({
            "shape": "superellipse",
            "radius": 20.0,
            "smoothing": 0.6
        });
        let result = set_corners_impl(&mut doc, &created.uuid, &corners_json);
        assert!(result.is_ok(), "expected ok, got: {result:?}");

        let node_id = doc
            .arena
            .id_by_uuid(&created.uuid.parse::<Uuid>().unwrap())
            .unwrap();
        let node = doc.arena.get(node_id).unwrap();
        let sigil_core::NodeKind::Rectangle { corners } = &node.kind else {
            panic!("expected rectangle");
        };
        for corner in corners {
            let sigil_core::Corner::Superellipse { radii, smoothing } = corner else {
                panic!("expected superellipse, got {corner:?}");
            };
            // Exact bit equality: literals pass through serde without lossy ops.
            assert_eq!(radii.x().to_bits(), 20.0_f64.to_bits());
            assert_eq!(radii.y().to_bits(), 20.0_f64.to_bits());
            assert_eq!(smoothing.to_bits(), 0.6_f64.to_bits());
        }
    }

    #[test]
    fn test_set_corners_per_corner_array_rejects_superellipse() {
        let (mut doc, page_id) = make_doc_with_page();
        let created =
            create_node_impl(&mut doc, "rectangle", "Rect", Some(&page_id), None, None).unwrap();

        let corners_json = serde_json::json!([
            { "shape": "superellipse", "radii": { "x": 8.0, "y": 8.0 }, "smoothing": 0.5 },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } }
        ]);
        let err = set_corners_impl(&mut doc, &created.uuid, &corners_json).unwrap_err();
        match err {
            McpToolError::InvalidInput(msg) => {
                assert!(
                    msg.contains("superellipse"),
                    "expected superellipse rejection message, got: {msg}"
                );
            }
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn test_set_corners_invalid_uuid() {
        let mut doc = Document::new("Untitled".to_string());
        let corners_json = serde_json::json!({ "shape": "round", "radius": 4.0 });
        let err = set_corners_impl(&mut doc, "not-a-uuid", &corners_json).unwrap_err();
        assert!(matches!(err, McpToolError::InvalidUuid(_)));
    }

    #[test]
    fn test_set_corners_node_not_found() {
        let mut doc = Document::new("Untitled".to_string());
        let missing = Uuid::new_v4().to_string();
        let corners_json = serde_json::json!({ "shape": "round", "radius": 4.0 });
        let err = set_corners_impl(&mut doc, &missing, &corners_json).unwrap_err();
        assert!(matches!(err, McpToolError::NodeNotFound(_)));
    }

    #[test]
    fn test_delete_nodes_removes_multiple() {
        let (mut doc, page_id) = make_doc_with_page();
        let first =
            create_node_impl(&mut doc, "frame", "First", Some(&page_id), None, None).unwrap();
        let second =
            create_node_impl(&mut doc, "rectangle", "Second", Some(&page_id), None, None).unwrap();

        let uuids = vec![first.uuid.clone(), second.uuid.clone()];
        let result = delete_nodes_impl(&mut doc, &uuids);
        assert!(
            result.is_ok(),
            "expected delete_nodes to succeed: {result:?}"
        );
        let (mutation, broadcast_uuids) = result.unwrap();
        assert!(mutation.success);
        assert_eq!(broadcast_uuids.len(), 2);

        // Re-deletion now fails because both are gone.
        let again = delete_nodes_impl(&mut doc, &uuids);
        assert!(again.is_err(), "expected re-delete to error");
        assert!(matches!(again.unwrap_err(), McpToolError::NodeNotFound(_)));
    }

    #[test]
    fn test_delete_nodes_rejects_invalid_uuid() {
        let mut doc = Document::new("Untitled".to_string());
        let result = delete_nodes_impl(&mut doc, &["not-a-uuid".to_string()]);
        assert!(matches!(result, Err(McpToolError::InvalidUuid(_))));
    }
}
