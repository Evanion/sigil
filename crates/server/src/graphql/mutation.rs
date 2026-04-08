// crates/server/src/graphql/mutation.rs

//! GraphQL mutations for document operations.
//!
//! Each mutation follows this pattern:
//! 1. Get `AppState` from context
//! 2. Acquire document lock (`std::sync::Mutex` -- never hold across await)
//! 3. Parse UUID string to `uuid::Uuid`
//! 4. Resolve UUID to `NodeId` via `arena.id_by_uuid()`
//! 5. Construct the appropriate `FieldOperation` struct from core
//! 6. Call `op.validate(&doc)?; op.apply(&mut doc)?;`
//! 7. Build the GraphQL response INSIDE the lock scope (RF-005)
//! 8. Drop the lock
//! 9. Signal dirty for persistence
//! 10. Publish event and return result

use async_graphql::{Context, Json, Object, Result};

use agent_designer_core::FieldOperation;
use agent_designer_core::commands::node_commands::{
    CreateNode, DeleteNode, RenameNode, SetLocked, SetVisible,
};
use agent_designer_core::commands::style_commands::validate_transform;
use agent_designer_core::commands::style_commands::{
    SetBlendMode, SetCornerRadii, SetEffects, SetFills, SetOpacity, SetStrokes, SetTransform,
};
use agent_designer_core::commands::tree_commands::{ReorderChildren, ReparentNode};
use agent_designer_core::node::{BlendMode, Effect, Fill, NodeKind, Stroke, StyleValue, Transform};
use agent_designer_core::validate::{MAX_BATCH_SIZE, validate_floats_in_value};
use agent_designer_core::{NodeId, PageId};
use agent_designer_state::{MutationEventKind, OperationPayload, TransactionPayload};

use crate::state::ServerState;

use super::types::{
    ApplyOperationsResult, CreateNodeInput, CreateNodeResult, DeleteNodeInput, NodeGql,
    OperationInput, ReorderInput, ReparentInput, SetFieldInput, node_to_gql,
};

pub struct MutationRoot;

/// Creates a single-operation transaction payload for a field set mutation.
fn field_set_transaction(
    user_id: Option<String>,
    node_uuid: &str,
    path: &str,
    value: serde_json::Value,
) -> TransactionPayload {
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: user_id.unwrap_or_else(|| "anonymous".to_string()),
        seq: 0,
        operations: vec![OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: node_uuid.to_string(),
            op_type: "set_field".to_string(),
            path: path.to_string(),
            value: Some(value),
        }],
    }
}

/// Creates a transaction payload with multiple operations.
fn multi_op_transaction(
    user_id: Option<String>,
    operations: Vec<OperationPayload>,
) -> TransactionPayload {
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: user_id.unwrap_or_else(|| "anonymous".to_string()),
        seq: 0,
        operations,
    }
}

/// Builds reparent operation payloads for children after an ungroup.
///
/// Reads each child's new parent UUID and sibling position from the document
/// so the broadcast carries the data that `applyReparent` expects.
fn build_ungroup_reparent_ops(
    doc: &agent_designer_core::Document,
    child_uuid_strs: &[String],
) -> async_graphql::Result<Vec<OperationPayload>> {
    let mut ops = Vec::with_capacity(child_uuid_strs.len());
    for child_uuid_str in child_uuid_strs {
        let child_uuid: uuid::Uuid = child_uuid_str
            .parse()
            .map_err(|_| async_graphql::Error::new("child uuid parse failed"))?;
        let child_id = doc
            .arena
            .id_by_uuid(&child_uuid)
            .ok_or_else(|| async_graphql::Error::new("child not found after ungroup"))?;
        let child_node = doc
            .arena
            .get(child_id)
            .map_err(|_| async_graphql::Error::new("child lookup failed"))?;

        let (parent_uuid_str, position) = match child_node.parent {
            Some(pid) => {
                let pu = doc
                    .arena
                    .uuid_of(pid)
                    .map_err(|_| async_graphql::Error::new("parent uuid lookup failed"))?;
                let parent_node = doc
                    .arena
                    .get(pid)
                    .map_err(|_| async_graphql::Error::new("parent lookup failed"))?;
                let pos = parent_node
                    .children
                    .iter()
                    .position(|&c| c == child_id)
                    .unwrap_or(0);
                (pu.to_string(), pos)
            }
            None => (String::new(), 0),
        };

        ops.push(OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: child_uuid_str.clone(),
            op_type: "reparent".to_string(),
            path: String::new(),
            value: Some(serde_json::json!({
                "parentUuid": parent_uuid_str,
                "position": position,
            })),
        });
    }
    Ok(ops)
}

/// Acquires the document lock, recovering from mutex poisoning.
fn acquire_document_lock(
    state: &ServerState,
) -> std::sync::MutexGuard<'_, crate::state::SendDocument> {
    match state.app.document.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::error!("document mutex poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

// ── applyOperations helpers ──────────────────────────────────────────

/// A parsed operation ready for UUID resolution, validation, and application.
///
/// The `builder` closure captures the parsed input data and constructs the
/// appropriate `FieldOperation` struct after UUID-to-NodeId resolution
/// (which requires the document lock).
struct ParsedOp {
    /// Builds the `FieldOperation` after UUID→NodeId resolution inside the lock.
    #[allow(clippy::type_complexity)]
    builder: Box<dyn FnOnce(&agent_designer_core::Document) -> Result<Box<dyn FieldOperation>>>,
    /// The broadcast payload for this operation (built eagerly from input data).
    broadcast: OperationPayload,
}

/// Parses all operation inputs into `ParsedOp` structs.
///
/// This does not require the document lock — it validates input formats and
/// deserializes JSON values, but defers UUID→NodeId resolution to the lock scope.
fn parse_operation_input(input: &OperationInput) -> Result<ParsedOp> {
    match input {
        OperationInput::SetField(sf) => parse_set_field(sf),
        OperationInput::CreateNode(cn) => parse_create_node(cn),
        OperationInput::DeleteNode(dn) => parse_delete_node(dn),
        OperationInput::Reparent(rp) => parse_reparent(rp),
        OperationInput::Reorder(ro) => parse_reorder(ro),
    }
}

/// Parses a `SetField` input, dispatching on the field path.
#[allow(clippy::too_many_lines)]
fn parse_set_field(sf: &SetFieldInput) -> Result<ParsedOp> {
    let node_uuid_str = sf.node_uuid.clone();
    let _parsed_uuid: uuid::Uuid = node_uuid_str
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;

    let value: serde_json::Value = serde_json::from_str(&sf.value)
        .map_err(|e| async_graphql::Error::new(format!("invalid JSON value: {e}")))?;

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: sf.node_uuid.clone(),
        op_type: "set_field".to_string(),
        path: sf.path.clone(),
        value: Some(value.clone()),
    };

    let path = sf.path.clone();
    let uuid_str = sf.node_uuid.clone();

    match path.as_str() {
        "transform" => {
            let new_transform: Transform = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid transform: {e}")))?;
            validate_transform(&new_transform)
                .map_err(|e| async_graphql::Error::new(format!("invalid transform values: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTransform {
                        node_id,
                        new_transform,
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "name" => {
            let new_name: String = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid name: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(RenameNode { node_id, new_name }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "visible" => {
            let new_visible: bool = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid visible value: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetVisible {
                        node_id,
                        new_visible,
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "locked" => {
            let new_locked: bool = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid locked value: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetLocked {
                        node_id,
                        new_locked,
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "style.fills" => {
            validate_floats_in_value(&value).map_err(|e| {
                async_graphql::Error::new(format!("fills contain invalid floats: {e}"))
            })?;
            let new_fills: Vec<Fill> = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid fills: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetFills { node_id, new_fills }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "style.strokes" => {
            validate_floats_in_value(&value).map_err(|e| {
                async_graphql::Error::new(format!("strokes contain invalid floats: {e}"))
            })?;
            let new_strokes: Vec<Stroke> = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid strokes: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetStrokes {
                        node_id,
                        new_strokes,
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "style.effects" => {
            validate_floats_in_value(&value).map_err(|e| {
                async_graphql::Error::new(format!("effects contain invalid floats: {e}"))
            })?;
            let new_effects: Vec<Effect> = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid effects: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetEffects {
                        node_id,
                        new_effects,
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "style.opacity" => {
            let new_opacity: StyleValue<f64> = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid opacity: {e}")))?;
            // Validate opacity domain if it's a literal value
            if let StyleValue::Literal { value: v } = &new_opacity {
                if !v.is_finite() {
                    return Err(async_graphql::Error::new("opacity must be finite"));
                }
                if !(0.0..=1.0).contains(v) {
                    return Err(async_graphql::Error::new("opacity must be in [0.0, 1.0]"));
                }
            }
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetOpacity {
                        node_id,
                        new_opacity,
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "style.blend_mode" => {
            let new_blend_mode: BlendMode = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid blend mode: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetBlendMode {
                        node_id,
                        new_blend_mode,
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind" => {
            // Extract corner_radii from the kind JSON for SetCornerRadii
            let corner_radii: Vec<f64> = value
                .get("corner_radii")
                .ok_or_else(|| async_graphql::Error::new("kind value must contain corner_radii"))?
                .as_array()
                .ok_or_else(|| async_graphql::Error::new("corner_radii must be an array"))?
                .iter()
                .map(|v| {
                    v.as_f64().ok_or_else(|| {
                        async_graphql::Error::new("corner_radii elements must be numbers")
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            if corner_radii.len() != 4 {
                return Err(async_graphql::Error::new(
                    "corner_radii must have exactly 4 elements",
                ));
            }
            for (i, &r) in corner_radii.iter().enumerate() {
                if !r.is_finite() {
                    return Err(async_graphql::Error::new(format!(
                        "corner_radii[{i}] must be finite"
                    )));
                }
                if r < 0.0 {
                    return Err(async_graphql::Error::new(format!(
                        "corner_radii[{i}] must be non-negative"
                    )));
                }
            }
            let new_radii: [f64; 4] = [
                corner_radii[0],
                corner_radii[1],
                corner_radii[2],
                corner_radii[3],
            ];
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let uuid: uuid::Uuid = uuid_str
                        .parse()
                        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
                    let node_id = doc
                        .arena
                        .id_by_uuid(&uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetCornerRadii { node_id, new_radii }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        _ => Err(async_graphql::Error::new(format!(
            "unknown field path: {}",
            sf.path
        ))),
    }
}

/// Parses a `CreateNode` input.
fn parse_create_node(cn: &CreateNodeInput) -> Result<ParsedOp> {
    let node_uuid: uuid::Uuid = cn
        .node_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;

    let kind: NodeKind = serde_json::from_str(&cn.kind)
        .map_err(|e| async_graphql::Error::new(format!("invalid node kind: {e}")))?;

    let initial_transform: Option<Transform> = match cn.transform.as_ref() {
        Some(t) => {
            let parsed: Transform = serde_json::from_str(t)
                .map_err(|e| async_graphql::Error::new(format!("invalid transform: {e}")))?;
            validate_transform(&parsed)
                .map_err(|e| async_graphql::Error::new(format!("invalid transform values: {e}")))?;
            Some(parsed)
        }
        None => None,
    };

    let page_id: Option<PageId> = match cn.page_id.as_ref() {
        Some(id_str) => {
            let parsed: uuid::Uuid = id_str
                .parse()
                .map_err(|_| async_graphql::Error::new("invalid page UUID"))?;
            Some(PageId::new(parsed))
        }
        None => None,
    };

    let name = cn.name.clone();
    let node_uuid_str = cn.node_uuid.clone();

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: node_uuid_str.clone(),
        op_type: "create_node".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "kind": cn.kind,
            "name": cn.name,
        })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| {
            Ok(Box::new(CreateNode {
                uuid: node_uuid,
                kind,
                name,
                page_id,
                initial_transform,
            }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses a `DeleteNode` input.
fn parse_delete_node(dn: &DeleteNodeInput) -> Result<ParsedOp> {
    let _parsed_uuid: uuid::Uuid = dn
        .node_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;

    let node_uuid_str = dn.node_uuid.clone();

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: node_uuid_str.clone(),
        op_type: "delete_node".to_string(),
        path: String::new(),
        value: None,
    };

    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            let uuid: uuid::Uuid = node_uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
            let node_id = doc
                .arena
                .id_by_uuid(&uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            // Find page ID for the node (needed by DeleteNode)
            let page_id: Option<PageId> = doc.pages.iter().find_map(|page| {
                if page.root_nodes.contains(&node_id) {
                    Some(page.id)
                } else {
                    None
                }
            });

            Ok(Box::new(DeleteNode { node_id, page_id }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses a `Reparent` input.
fn parse_reparent(rp: &ReparentInput) -> Result<ParsedOp> {
    let _parsed_uuid: uuid::Uuid = rp
        .node_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;
    let _parent_uuid: uuid::Uuid = rp
        .new_parent_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid parent UUID"))?;

    if rp.position < 0 {
        return Err(async_graphql::Error::new("position must be non-negative"));
    }
    #[allow(clippy::cast_sign_loss)]
    let position_usize = rp.position as usize;

    let node_uuid_str = rp.node_uuid.clone();
    let parent_uuid_str = rp.new_parent_uuid.clone();
    let position = rp.position;

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: node_uuid_str.clone(),
        op_type: "reparent".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "parentUuid": parent_uuid_str,
            "position": position,
        })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            let uuid: uuid::Uuid = node_uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
            let parent_uuid: uuid::Uuid = parent_uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new("invalid parent UUID"))?;
            let node_id = doc
                .arena
                .id_by_uuid(&uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;
            let parent_id = doc
                .arena
                .id_by_uuid(&parent_uuid)
                .ok_or_else(|| async_graphql::Error::new("parent not found"))?;
            Ok(Box::new(ReparentNode {
                node_id,
                new_parent_id: parent_id,
                new_position: position_usize,
            }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses a `Reorder` input.
fn parse_reorder(ro: &ReorderInput) -> Result<ParsedOp> {
    let _parsed_uuid: uuid::Uuid = ro
        .node_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;

    if ro.new_position < 0 {
        return Err(async_graphql::Error::new(
            "new_position must be non-negative",
        ));
    }
    #[allow(clippy::cast_sign_loss)]
    let new_position_usize = ro.new_position as usize;

    let node_uuid_str = ro.node_uuid.clone();
    let new_position = ro.new_position;

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: node_uuid_str.clone(),
        op_type: "reorder".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "newPosition": new_position,
        })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            let uuid: uuid::Uuid = node_uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
            let node_id = doc
                .arena
                .id_by_uuid(&uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;
            Ok(Box::new(ReorderChildren {
                node_id,
                new_position: new_position_usize,
            }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

#[Object]
#[allow(clippy::unused_async)]
impl MutationRoot {
    /// Create a new node in the document.
    ///
    /// Generates a UUID, creates the node with the given kind and name,
    /// optionally places it on a page, and applies an initial transform.
    async fn create_node(
        &self,
        ctx: &Context<'_>,
        kind: Json<serde_json::Value>,
        name: String,
        page_id: Option<String>,
        transform: Option<Json<serde_json::Value>>,
        user_id: Option<String>,
    ) -> Result<CreateNodeResult> {
        let state = ctx.data::<ServerState>()?;

        // Deserialize kind from JSON
        let node_kind: NodeKind = serde_json::from_value(kind.0).map_err(|e| {
            tracing::warn!("invalid node kind in createNode: {e}");
            async_graphql::Error::new("invalid node kind")
        })?;

        // Deserialize optional transform
        let initial_transform: Option<Transform> = match transform {
            Some(Json(t)) => {
                let parsed: Transform = serde_json::from_value(t).map_err(|e| {
                    tracing::warn!("invalid transform in createNode: {e}");
                    async_graphql::Error::new("invalid transform")
                })?;
                Some(parsed)
            }
            None => None,
        };

        // Parse optional page ID
        let page_id_typed: Option<PageId> = match page_id {
            Some(ref id_str) => {
                let parsed: uuid::Uuid = id_str
                    .parse()
                    .map_err(|_| async_graphql::Error::new("invalid page UUID"))?;
                Some(PageId::new(parsed))
            }
            None => None,
        };

        let node_uuid = uuid::Uuid::new_v4();

        let cmd = CreateNode {
            uuid: node_uuid,
            kind: node_kind,
            name: name.clone(),
            page_id: page_id_typed,
            initial_transform,
        };

        // RF-005: build the response inside the lock scope to avoid TOCTOU
        let (node_gql, node_json) = {
            let mut doc_guard = acquire_document_lock(state);
            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("createNode validation failed: {e}");
                async_graphql::Error::new("node creation failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("createNode failed: {e}");
                async_graphql::Error::new("node creation failed")
            })?;

            let node_id = doc_guard
                .arena
                .id_by_uuid(&node_uuid)
                .ok_or_else(|| async_graphql::Error::new("node created but UUID not found"))?;

            let gql = node_to_gql(&doc_guard, node_id, node_uuid)?;

            // RF-004: Serialize the GraphQL representation (which uses UUIDs)
            // instead of the raw arena Node (which contains arena-local NodeId
            // structs that are meaningless outside a running session).
            let json = serde_json::to_value(&gql)
                .map_err(|e| async_graphql::Error::new(format!("serialization failed: {e}")))?;
            (gql, json)
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeCreated,
            Some(node_uuid.to_string()),
            multi_op_transaction(
                user_id,
                vec![OperationPayload {
                    id: uuid::Uuid::new_v4().to_string(),
                    node_uuid: node_uuid.to_string(),
                    op_type: "create_node".to_string(),
                    path: String::new(),
                    value: Some(node_json),
                }],
            ),
        );

        Ok(CreateNodeResult {
            uuid: node_uuid.to_string(),
            node: node_gql,
        })
    }

    /// Delete a node by UUID.
    async fn delete_node(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        user_id: Option<String>,
    ) -> Result<bool> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        {
            let mut doc_guard = acquire_document_lock(state);

            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            // Find page ID for the node (needed by DeleteNode)
            let found_page_id: Option<PageId> = doc_guard.pages.iter().find_map(|page| {
                if page.root_nodes.contains(&node_id) {
                    Some(page.id)
                } else {
                    None
                }
            });

            let cmd = DeleteNode {
                node_id,
                page_id: found_page_id,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("deleteNode validation failed: {e}");
                async_graphql::Error::new("node deletion failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("deleteNode failed: {e}");
                async_graphql::Error::new("node deletion failed")
            })?;
        }

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeDeleted,
            Some(parsed_uuid.to_string()),
            multi_op_transaction(
                user_id,
                vec![OperationPayload {
                    id: uuid::Uuid::new_v4().to_string(),
                    node_uuid: parsed_uuid.to_string(),
                    op_type: "delete_node".to_string(),
                    path: String::new(),
                    value: None,
                }],
            ),
        );

        Ok(true)
    }

    /// Rename a node by UUID.
    async fn rename_node(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        new_name: String,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // Clone new_name before it is moved into the command
        let broadcast_name = new_name.clone();

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = RenameNode { node_id, new_name };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("renameNode validation failed: {e}");
                async_graphql::Error::new("rename failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("renameNode failed: {e}");
                async_graphql::Error::new("rename failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(
                user_id,
                &parsed_uuid.to_string(),
                "name",
                serde_json::Value::String(broadcast_name),
            ),
        );

        Ok(node_gql)
    }

    /// Set the transform of a node by UUID.
    async fn set_transform(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        transform: Json<serde_json::Value>,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        let new_transform: Transform = serde_json::from_value(transform.0).map_err(|e| {
            tracing::warn!("invalid transform in setTransform: {e}");
            async_graphql::Error::new("invalid transform")
        })?;

        // Serialize transform for broadcast before it's consumed
        let transform_json = serde_json::to_value(new_transform)
            .map_err(|e| async_graphql::Error::new(format!("serialization failed: {e}")))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetTransform {
                node_id,
                new_transform,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setTransform validation failed: {e}");
                async_graphql::Error::new("set transform failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setTransform failed: {e}");
                async_graphql::Error::new("set transform failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(
                user_id,
                &parsed_uuid.to_string(),
                "transform",
                transform_json,
            ),
        );

        Ok(node_gql)
    }

    /// Set the visibility of a node by UUID.
    async fn set_visible(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        visible: bool,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetVisible {
                node_id,
                new_visible: visible,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setVisible validation failed: {e}");
                async_graphql::Error::new("set visible failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setVisible failed: {e}");
                async_graphql::Error::new("set visible failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(
                user_id,
                &parsed_uuid.to_string(),
                "visible",
                serde_json::Value::Bool(visible),
            ),
        );

        Ok(node_gql)
    }

    /// Set the locked state of a node by UUID.
    async fn set_locked(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        locked: bool,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetLocked {
                node_id,
                new_locked: locked,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setLocked validation failed: {e}");
                async_graphql::Error::new("set locked failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setLocked failed: {e}");
                async_graphql::Error::new("set locked failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(
                user_id,
                &parsed_uuid.to_string(),
                "locked",
                serde_json::Value::Bool(locked),
            ),
        );

        Ok(node_gql)
    }

    /// Move a node to a new parent at a specific position.
    ///
    /// Note: GraphQL `Int` is signed (i32), but position must be non-negative.
    /// The resolver validates this before acquiring the lock. Positions beyond
    /// the parent's children count are clamped by the core engine (append semantics).
    async fn reparent_node(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        new_parent_uuid: String,
        position: i32,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // RF-013: reject negative positions before lock acquisition.
        if position < 0 {
            return Err(async_graphql::Error::new("position must be non-negative"));
        }
        #[allow(clippy::cast_sign_loss)] // validated non-negative above
        let position_usize = position as usize;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
        let parent_uuid: uuid::Uuid = new_parent_uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid parent UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;
            let parent_id = doc_guard
                .arena
                .id_by_uuid(&parent_uuid)
                .ok_or_else(|| async_graphql::Error::new("parent not found"))?;

            // RF-014: positions beyond children count are clamped by the core engine.
            let cmd = ReparentNode {
                node_id,
                new_parent_id: parent_id,
                new_position: position_usize,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("reparentNode validation failed: {e}");
                async_graphql::Error::new("reparent failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("reparentNode failed: {e}");
                async_graphql::Error::new("reparent failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            multi_op_transaction(
                user_id,
                vec![OperationPayload {
                    id: uuid::Uuid::new_v4().to_string(),
                    node_uuid: parsed_uuid.to_string(),
                    op_type: "reparent".to_string(),
                    path: String::new(),
                    value: Some(serde_json::json!({
                        "parentUuid": new_parent_uuid,
                        "position": position,
                    })),
                }],
            ),
        );

        Ok(node_gql)
    }

    /// Reorder a node within its parent's children list.
    ///
    /// Note: GraphQL `Int` is signed (i32), but position must be non-negative.
    /// The resolver validates this before acquiring the lock. Positions beyond
    /// the children count are clamped by the core engine.
    async fn reorder_children(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        new_position: i32,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // RF-013: reject negative positions before lock acquisition.
        if new_position < 0 {
            return Err(async_graphql::Error::new("position must be non-negative"));
        }
        #[allow(clippy::cast_sign_loss)] // validated non-negative above
        let new_position_usize = new_position as usize;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            // RF-014: positions beyond children count are clamped by the core engine.
            let cmd = ReorderChildren {
                node_id,
                new_position: new_position_usize,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("reorderChildren validation failed: {e}");
                async_graphql::Error::new("reorder failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("reorderChildren failed: {e}");
                async_graphql::Error::new("reorder failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            multi_op_transaction(
                user_id,
                vec![OperationPayload {
                    id: uuid::Uuid::new_v4().to_string(),
                    node_uuid: parsed_uuid.to_string(),
                    op_type: "reorder".to_string(),
                    path: String::new(),
                    value: Some(serde_json::json!({
                        "newPosition": new_position,
                    })),
                }],
            ),
        );

        Ok(node_gql)
    }

    /// Set the opacity of a node by UUID.
    ///
    /// Opacity must be a finite f64 in the range [0.0, 1.0].
    async fn set_opacity(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        opacity: f64,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Validate input BEFORE lock acquisition (CLAUDE.md: floating-point validation)
        if !opacity.is_finite() {
            return Err(async_graphql::Error::new(
                "opacity must be finite (no NaN or infinity)",
            ));
        }
        if !(0.0..=1.0).contains(&opacity) {
            return Err(async_graphql::Error::new("opacity must be in [0.0, 1.0]"));
        }

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetOpacity {
                node_id,
                new_opacity: StyleValue::Literal { value: opacity },
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setOpacity validation failed: {e}");
                async_graphql::Error::new("set opacity failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setOpacity failed: {e}");
                async_graphql::Error::new("set opacity failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        let opacity_json = serde_json::to_value(&StyleValue::Literal { value: opacity })
            .map_err(|e| async_graphql::Error::new(format!("serialization failed: {e}")))?;

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(
                user_id,
                &parsed_uuid.to_string(),
                "style.opacity",
                opacity_json,
            ),
        );

        Ok(node_gql)
    }

    /// Set the blend mode of a node by UUID.
    ///
    /// The blend mode string must be a valid `snake_case` variant name (e.g. "normal", "multiply").
    async fn set_blend_mode(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        blend_mode: String,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Parse blend mode string before lock acquisition
        let new_blend_mode: BlendMode =
            serde_json::from_value(serde_json::Value::String(blend_mode.clone())).map_err(|e| {
                tracing::warn!("invalid blend mode in setBlendMode: {e}");
                async_graphql::Error::new("invalid blend mode")
            })?;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetBlendMode {
                node_id,
                new_blend_mode,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setBlendMode validation failed: {e}");
                async_graphql::Error::new("set blend mode failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setBlendMode failed: {e}");
                async_graphql::Error::new("set blend mode failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(
                user_id,
                &parsed_uuid.to_string(),
                "style.blend_mode",
                serde_json::Value::String(blend_mode),
            ),
        );

        Ok(node_gql)
    }

    /// Set the fills array of a node by UUID.
    ///
    /// Accepts fills as a JSON value (array of Fill objects).
    async fn set_fills(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        fills: Json<serde_json::Value>,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Clone for broadcast before deserialization consumes the value
        let fills_json = fills.0.clone();

        // RF-016: Validate floats before deserialization (match MCP tool behavior)
        validate_floats_in_value(&fills_json).map_err(|e| {
            tracing::warn!("fills contain invalid floats: {e}");
            async_graphql::Error::new("fills contain invalid floats")
        })?;

        // Deserialize fills before lock acquisition
        let new_fills: Vec<Fill> = serde_json::from_value(fills.0).map_err(|e| {
            tracing::warn!("invalid fills in setFills: {e}");
            async_graphql::Error::new("invalid fills")
        })?;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetFills { node_id, new_fills };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setFills validation failed: {e}");
                async_graphql::Error::new("set fills failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setFills failed: {e}");
                async_graphql::Error::new("set fills failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(user_id, &parsed_uuid.to_string(), "style.fills", fills_json),
        );

        Ok(node_gql)
    }

    /// Set the strokes array of a node by UUID.
    ///
    /// Accepts strokes as a JSON value (array of Stroke objects).
    async fn set_strokes(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        strokes: Json<serde_json::Value>,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Clone for broadcast before deserialization consumes the value
        let strokes_json = strokes.0.clone();

        // RF-016: Validate floats before deserialization (match MCP tool behavior)
        validate_floats_in_value(&strokes_json).map_err(|e| {
            tracing::warn!("strokes contain invalid floats: {e}");
            async_graphql::Error::new("strokes contain invalid floats")
        })?;

        // Deserialize strokes before lock acquisition
        let new_strokes: Vec<Stroke> = serde_json::from_value(strokes.0).map_err(|e| {
            tracing::warn!("invalid strokes in setStrokes: {e}");
            async_graphql::Error::new("invalid strokes")
        })?;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetStrokes {
                node_id,
                new_strokes,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setStrokes validation failed: {e}");
                async_graphql::Error::new("set strokes failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setStrokes failed: {e}");
                async_graphql::Error::new("set strokes failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(
                user_id,
                &parsed_uuid.to_string(),
                "style.strokes",
                strokes_json,
            ),
        );

        Ok(node_gql)
    }

    /// Set the effects array of a node by UUID.
    ///
    /// Accepts effects as a JSON value (array of Effect objects).
    async fn set_effects(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        effects: Json<serde_json::Value>,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Clone for broadcast before deserialization consumes the value
        let effects_json = effects.0.clone();

        // RF-016: Validate floats before deserialization (match MCP tool behavior)
        validate_floats_in_value(&effects_json).map_err(|e| {
            tracing::warn!("effects contain invalid floats: {e}");
            async_graphql::Error::new("effects contain invalid floats")
        })?;

        // Deserialize effects before lock acquisition
        let new_effects: Vec<Effect> = serde_json::from_value(effects.0).map_err(|e| {
            tracing::warn!("invalid effects in setEffects: {e}");
            async_graphql::Error::new("invalid effects")
        })?;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetEffects {
                node_id,
                new_effects,
            };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setEffects validation failed: {e}");
                async_graphql::Error::new("set effects failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setEffects failed: {e}");
                async_graphql::Error::new("set effects failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(
                user_id,
                &parsed_uuid.to_string(),
                "style.effects",
                effects_json,
            ),
        );

        Ok(node_gql)
    }

    /// Set the corner radii of a rectangle node by UUID.
    ///
    /// Requires exactly 4 values (top-left, top-right, bottom-right, bottom-left).
    /// All values must be finite and non-negative. The target node must be a Rectangle.
    async fn set_corner_radii(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        radii: Vec<f64>,
        user_id: Option<String>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Validate input BEFORE lock acquisition
        if radii.len() != 4 {
            return Err(async_graphql::Error::new(
                "corner radii must have exactly 4 elements",
            ));
        }
        for (i, &r) in radii.iter().enumerate() {
            if !r.is_finite() {
                return Err(async_graphql::Error::new(format!(
                    "corner_radii[{i}] must be finite (no NaN or infinity)"
                )));
            }
            if r < 0.0 {
                return Err(async_graphql::Error::new(format!(
                    "corner_radii[{i}] must be non-negative"
                )));
            }
        }
        let new_radii: [f64; 4] = [radii[0], radii[1], radii[2], radii[3]];

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let (node_gql, kind_json) = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let cmd = SetCornerRadii { node_id, new_radii };

            cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("setCornerRadii validation failed: {e}");
                async_graphql::Error::new("set corner radii failed")
            })?;
            cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("setCornerRadii failed: {e}");
                async_graphql::Error::new("set corner radii failed")
            })?;

            let node_gql = node_to_gql(&doc_guard, node_id, parsed_uuid)?;

            // Serialize updated kind for broadcast while still holding lock
            let updated_node = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?;
            let kind_json = serde_json::to_value(&updated_node.kind)
                .map_err(|e| async_graphql::Error::new(format!("serialization failed: {e}")))?;

            (node_gql, kind_json)
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some(parsed_uuid.to_string()),
            field_set_transaction(user_id, &parsed_uuid.to_string(), "kind", kind_json),
        );

        Ok(node_gql)
    }

    /// Atomically set transforms for multiple nodes.
    ///
    /// Used by multi-select move, align, and distribute operations.
    /// All transforms are validated before any are applied.
    #[allow(clippy::too_many_lines)]
    async fn batch_set_transform(
        &self,
        ctx: &Context<'_>,
        entries: Vec<Json<serde_json::Value>>,
        user_id: Option<String>,
    ) -> Result<Vec<NodeGql>> {
        let state = ctx.data::<ServerState>()?;

        // RF-009: Early MAX_BATCH_SIZE check before parsing loop
        if entries.len() > MAX_BATCH_SIZE {
            return Err(async_graphql::Error::new(format!(
                "batch size {} exceeds maximum of {MAX_BATCH_SIZE}",
                entries.len()
            )));
        }

        // Parse entries: each is { "uuid": "...", "transform": { ... } }
        let mut parsed_entries: Vec<(uuid::Uuid, Transform)> = Vec::with_capacity(entries.len());
        for entry_json in &entries {
            let obj = entry_json.0.as_object().ok_or_else(|| {
                async_graphql::Error::new(
                    "each entry must be a JSON object with uuid and transform",
                )
            })?;
            let uuid_str = obj
                .get("uuid")
                .and_then(|v| v.as_str())
                .ok_or_else(|| async_graphql::Error::new("entry missing uuid field"))?;
            let parsed_uuid: uuid::Uuid = uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
            let transform_val = obj
                .get("transform")
                .ok_or_else(|| async_graphql::Error::new("entry missing transform field"))?;
            let new_transform: Transform =
                serde_json::from_value(transform_val.clone()).map_err(|e| {
                    tracing::warn!("invalid transform in batchSetTransform: {e}");
                    async_graphql::Error::new("invalid transform in batch entry")
                })?;
            // RF-011: Validate transform immediately after deserialization
            validate_transform(&new_transform).map_err(|e| {
                tracing::warn!("invalid transform values in batchSetTransform: {e}");
                async_graphql::Error::new("invalid transform values in batch entry")
            })?;
            parsed_entries.push((parsed_uuid, new_transform));
        }

        let result_nodes = {
            let mut doc_guard = acquire_document_lock(state);

            // Validate all transforms before applying any (all-or-nothing semantics)
            // RF-023: Store (NodeId, uuid) pairs to avoid re-resolving in the response loop.
            let mut resolved: Vec<(NodeId, uuid::Uuid, Transform)> =
                Vec::with_capacity(parsed_entries.len());
            for (uuid, new_transform) in &parsed_entries {
                let node_id = doc_guard
                    .arena
                    .id_by_uuid(uuid)
                    .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))?;
                let cmd = SetTransform {
                    node_id,
                    new_transform: *new_transform,
                };
                cmd.validate(&doc_guard).map_err(|e| {
                    tracing::warn!("batchSetTransform validation failed for {uuid}: {e}");
                    async_graphql::Error::new("batch set transform validation failed")
                })?;
                resolved.push((node_id, *uuid, *new_transform));
            }

            // RF-006: Record original transforms before applying, for rollback on partial failure.
            let mut originals: Vec<(NodeId, Transform)> = Vec::with_capacity(resolved.len());
            for &(node_id, _, ref new_transform) in &resolved {
                let old_transform = doc_guard
                    .arena
                    .get(node_id)
                    .map_err(|e| {
                        tracing::warn!("batchSetTransform snapshot failed: {e}");
                        async_graphql::Error::new("batch set transform failed")
                    })?
                    .transform;
                originals.push((node_id, old_transform));

                let cmd = SetTransform {
                    node_id,
                    new_transform: *new_transform,
                };
                if let Err(e) = cmd.apply(&mut doc_guard) {
                    tracing::warn!("batchSetTransform apply failed at node {node_id:?}: {e}");
                    // Rollback all previously applied transforms (in reverse order)
                    for &(rid, ref rt) in originals.iter().rev().skip(1) {
                        if let Ok(node) = doc_guard.arena.get_mut(rid) {
                            node.transform = *rt;
                        }
                    }
                    return Err(async_graphql::Error::new("batch set transform failed"));
                }
            }

            // Build response inside lock scope (RF-005)
            // RF-023: Reuse already-resolved (NodeId, uuid) pairs instead of re-resolving.
            let mut nodes = Vec::with_capacity(resolved.len());
            for &(node_id, uuid, _) in &resolved {
                nodes.push(node_to_gql(&doc_guard, node_id, uuid)?);
            }
            nodes
        };

        // RF-005: Build per-node operation payloads, propagating serialization
        // errors instead of silently replacing with null.
        let operations: Vec<OperationPayload> = parsed_entries
            .iter()
            .map(|(node_uuid, transform)| {
                let transform_json = serde_json::to_value(transform).map_err(|e| {
                    tracing::warn!("batch transform serialization failed: {e}");
                    async_graphql::Error::new("serialization failed")
                })?;
                Ok(OperationPayload {
                    id: uuid::Uuid::new_v4().to_string(),
                    node_uuid: node_uuid.to_string(),
                    op_type: "set_field".to_string(),
                    path: "transform".to_string(),
                    value: Some(transform_json),
                })
            })
            .collect::<Result<Vec<_>>>()?;

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            None,
            multi_op_transaction(user_id, operations),
        );

        Ok(result_nodes)
    }

    /// Group multiple nodes under a new Group node.
    ///
    /// Computes a union bounding box for the children, creates the group with
    /// that bounding box as its transform, adjusts children to group-relative
    /// coordinates, removes children from page `root_nodes`, and reparents them.
    ///
    /// Returns the UUID of the created group node.
    #[allow(clippy::too_many_lines)]
    async fn group_nodes(
        &self,
        ctx: &Context<'_>,
        uuids: Vec<String>,
        name: String,
        user_id: Option<String>,
    ) -> Result<String> {
        use agent_designer_core::validate::MIN_GROUP_MEMBERS;

        let state = ctx.data::<ServerState>()?;

        // RF-008: Validate minimum group members before any work.
        if uuids.len() < MIN_GROUP_MEMBERS {
            return Err(async_graphql::Error::new(format!(
                "grouping requires at least {MIN_GROUP_MEMBERS} nodes, got {}",
                uuids.len()
            )));
        }

        let mut parsed_uuids: Vec<uuid::Uuid> = Vec::with_capacity(uuids.len());
        for uuid_str in &uuids {
            let parsed: uuid::Uuid = uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
            parsed_uuids.push(parsed);
        }

        let group_uuid = uuid::Uuid::new_v4();

        {
            let mut doc_guard = acquire_document_lock(state);

            // Resolve all child UUIDs to NodeIds
            let node_ids: Vec<NodeId> = parsed_uuids
                .iter()
                .map(|uuid| {
                    doc_guard
                        .arena
                        .id_by_uuid(uuid)
                        .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))
                })
                .collect::<Result<Vec<_>>>()?;

            // Verify all nodes share the same parent
            let first_parent = doc_guard
                .arena
                .get(node_ids[0])
                .map_err(|_| async_graphql::Error::new("child lookup failed"))?
                .parent;
            for &nid in &node_ids[1..] {
                let parent = doc_guard
                    .arena
                    .get(nid)
                    .map_err(|_| async_graphql::Error::new("child lookup failed"))?
                    .parent;
                if parent != first_parent {
                    return Err(async_graphql::Error::new(
                        "all nodes in a group must share the same parent",
                    ));
                }
            }

            // RF-001: Compute union bounding box across all children.
            let mut min_x = f64::INFINITY;
            let mut min_y = f64::INFINITY;
            let mut max_x = f64::NEG_INFINITY;
            let mut max_y = f64::NEG_INFINITY;
            for &nid in &node_ids {
                let t = doc_guard
                    .arena
                    .get(nid)
                    .map_err(|_| async_graphql::Error::new("child lookup failed"))?
                    .transform;
                min_x = min_x.min(t.x);
                min_y = min_y.min(t.y);
                max_x = max_x.max(t.x + t.width);
                max_y = max_y.max(t.y + t.height);
            }
            let group_transform = Transform {
                x: min_x,
                y: min_y,
                width: max_x - min_x,
                height: max_y - min_y,
                ..Transform::default()
            };

            // Determine which page these nodes are on (for root node management)
            let page_id = doc_guard.pages.iter().find_map(|page| {
                if page.root_nodes.contains(&node_ids[0]) {
                    Some(page.id)
                } else {
                    None
                }
            });

            // Create the group node with the bounding box transform
            let create_cmd = CreateNode {
                uuid: group_uuid,
                kind: NodeKind::Group,
                name,
                page_id,
                initial_transform: Some(group_transform),
            };
            create_cmd.validate(&doc_guard).map_err(|e| {
                tracing::warn!("groupNodes create validation failed: {e}");
                async_graphql::Error::new("group nodes failed")
            })?;
            create_cmd.apply(&mut doc_guard).map_err(|e| {
                tracing::warn!("groupNodes create failed: {e}");
                async_graphql::Error::new("group nodes failed")
            })?;

            // Resolve the group's actual NodeId
            let group_node_id = doc_guard
                .arena
                .id_by_uuid(&group_uuid)
                .ok_or_else(|| async_graphql::Error::new("group node not found after creation"))?;

            // If the children had a parent, reparent the group under that parent
            // at the topmost child index (earliest position among the grouped children).
            if let Some(parent_id) = first_parent {
                let parent_children = &doc_guard
                    .arena
                    .get(parent_id)
                    .map_err(|_| async_graphql::Error::new("parent lookup failed"))?
                    .children
                    .clone();
                let topmost_index = node_ids
                    .iter()
                    .filter_map(|nid| parent_children.iter().position(|c| c == nid))
                    .min()
                    .unwrap_or(0);

                let reparent_group = ReparentNode {
                    node_id: group_node_id,
                    new_parent_id: parent_id,
                    new_position: topmost_index,
                };
                reparent_group.validate(&doc_guard).map_err(|e| {
                    tracing::warn!("groupNodes reparent group failed: {e}");
                    async_graphql::Error::new("group nodes failed")
                })?;
                reparent_group.apply(&mut doc_guard).map_err(|e| {
                    tracing::warn!("groupNodes reparent group failed: {e}");
                    async_graphql::Error::new("group nodes failed")
                })?;
            }

            // RF-001, RF-002, RF-007: Reparent each child under the group,
            // adjusting transforms and removing from page roots. Track progress
            // for rollback on partial failure.
            let mut reparented: Vec<(NodeId, Transform)> = Vec::with_capacity(node_ids.len());
            for (i, &child_id) in node_ids.iter().enumerate() {
                // Record original transform for rollback
                let original_transform = doc_guard
                    .arena
                    .get(child_id)
                    .map_err(|_| async_graphql::Error::new("child lookup failed"))?
                    .transform;

                // Adjust child transform to group-relative coordinates
                let adjusted = Transform {
                    x: original_transform.x - group_transform.x,
                    y: original_transform.y - group_transform.y,
                    ..original_transform
                };
                let set_cmd = SetTransform {
                    node_id: child_id,
                    new_transform: adjusted,
                };
                if let Err(e) = set_cmd.apply(&mut doc_guard) {
                    tracing::warn!("groupNodes transform adjust failed: {e}");
                    // Rollback previously adjusted transforms
                    for &(rid, ref rt) in reparented.iter().rev() {
                        if let Ok(node) = doc_guard.arena.get_mut(rid) {
                            node.transform = *rt;
                        }
                    }
                    return Err(async_graphql::Error::new("group nodes failed"));
                }

                // RF-002: Remove child from page root_nodes if present
                if let Some(pid) = page_id
                    && let Ok(page) = doc_guard.page_mut(pid)
                {
                    page.root_nodes.retain(|nid| *nid != child_id);
                }

                // Reparent child under the group
                let reparent_cmd = ReparentNode {
                    node_id: child_id,
                    new_parent_id: group_node_id,
                    new_position: i,
                };
                if let Err(e) = reparent_cmd.apply(&mut doc_guard) {
                    tracing::warn!("groupNodes reparent child failed: {e}");
                    // Restore this child's transform (it was adjusted but not reparented)
                    if let Ok(node) = doc_guard.arena.get_mut(child_id) {
                        node.transform = original_transform;
                    }
                    // Rollback previously completed children
                    for &(rid, ref rt) in reparented.iter().rev() {
                        if let Ok(node) = doc_guard.arena.get_mut(rid) {
                            node.transform = *rt;
                        }
                    }
                    return Err(async_graphql::Error::new("group nodes failed"));
                }

                reparented.push((child_id, original_transform));
            }
        }

        // Build operations: create_node for the group + reparent for each child
        let mut operations = vec![OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: group_uuid.to_string(),
            op_type: "create_node".to_string(),
            path: String::new(),
            value: Some(serde_json::json!({"operation": "group", "childUuids": uuids})),
        }];
        for child_uuid in &parsed_uuids {
            operations.push(OperationPayload {
                id: uuid::Uuid::new_v4().to_string(),
                node_uuid: child_uuid.to_string(),
                op_type: "reparent".to_string(),
                path: String::new(),
                value: Some(serde_json::json!({"parentUuid": group_uuid.to_string()})),
            });
        }

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeCreated,
            Some(group_uuid.to_string()),
            multi_op_transaction(user_id, operations),
        );

        Ok(group_uuid.to_string())
    }

    /// Ungroup one or more group nodes, reparenting their children.
    ///
    /// For each group: adjusts child transforms back to absolute coordinates,
    /// reparents children to the group's parent (or makes them page roots),
    /// then deletes the group node.
    ///
    /// Returns the UUIDs of the ungrouped children.
    #[allow(clippy::too_many_lines)]
    async fn ungroup_nodes(
        &self,
        ctx: &Context<'_>,
        uuids: Vec<String>,
        user_id: Option<String>,
    ) -> Result<Vec<String>> {
        let state = ctx.data::<ServerState>()?;

        let mut parsed_uuids: Vec<uuid::Uuid> = Vec::with_capacity(uuids.len());
        for uuid_str in &uuids {
            let parsed: uuid::Uuid = uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
            parsed_uuids.push(parsed);
        }

        let (child_uuids, operations): (Vec<String>, Vec<OperationPayload>) = {
            let mut doc_guard = acquire_document_lock(state);

            let group_ids: Vec<NodeId> = parsed_uuids
                .iter()
                .map(|uuid| {
                    doc_guard
                        .arena
                        .id_by_uuid(uuid)
                        .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))
                })
                .collect::<Result<Vec<_>>>()?;

            // Verify all targets are groups
            for &gid in &group_ids {
                let node = doc_guard
                    .arena
                    .get(gid)
                    .map_err(|_| async_graphql::Error::new("group lookup failed"))?;
                if !matches!(node.kind, NodeKind::Group) {
                    return Err(async_graphql::Error::new(
                        "ungroup target is not a Group node",
                    ));
                }
            }

            let mut all_child_uuids = Vec::new();

            for &gid in &group_ids {
                let group = doc_guard
                    .arena
                    .get(gid)
                    .map_err(|_| async_graphql::Error::new("group lookup failed"))?;
                let group_parent = group.parent;
                let group_transform = group.transform;
                let children: Vec<NodeId> = group.children.clone();

                // Find the group's index in its parent's children list (for insertion position)
                let group_index_in_parent = if let Some(pid) = group_parent {
                    let parent_node = doc_guard
                        .arena
                        .get(pid)
                        .map_err(|_| async_graphql::Error::new("parent lookup failed"))?;
                    parent_node
                        .children
                        .iter()
                        .position(|&c| c == gid)
                        .unwrap_or(0)
                } else {
                    0
                };

                // Find which page the group is on
                let page_id = doc_guard.pages.iter().find_map(|page| {
                    if page.root_nodes.contains(&gid) {
                        Some(page.id)
                    } else {
                        None
                    }
                });

                // Collect child UUIDs for response
                for &cid in &children {
                    let child_uuid = doc_guard
                        .arena
                        .uuid_of(cid)
                        .map_err(|_| async_graphql::Error::new("child uuid lookup failed"))?;
                    all_child_uuids.push(child_uuid.to_string());
                }

                // RF-004, RF-003, RF-007: Process each child — adjust transform
                // and reparent. Track completed operations for rollback.
                let mut completed: Vec<(NodeId, Transform)> = Vec::with_capacity(children.len());
                for (i, &cid) in children.iter().enumerate() {
                    let original_transform = doc_guard
                        .arena
                        .get(cid)
                        .map_err(|_| async_graphql::Error::new("child lookup failed"))?
                        .transform;

                    // RF-004: Adjust child transform back to absolute coordinates
                    let absolute_transform = Transform {
                        x: original_transform.x + group_transform.x,
                        y: original_transform.y + group_transform.y,
                        ..original_transform
                    };
                    let set_cmd = SetTransform {
                        node_id: cid,
                        new_transform: absolute_transform,
                    };
                    if let Err(e) = set_cmd.apply(&mut doc_guard) {
                        tracing::warn!("ungroupNodes transform adjust failed: {e}");
                        // Rollback previously adjusted transforms
                        for &(rid, ref rt) in completed.iter().rev() {
                            if let Ok(node) = doc_guard.arena.get_mut(rid) {
                                node.transform = *rt;
                            }
                        }
                        return Err(async_graphql::Error::new("ungroup nodes failed"));
                    }

                    if let Some(parent_id) = group_parent {
                        // Reparent child under the group's parent
                        let reparent_cmd = ReparentNode {
                            node_id: cid,
                            new_parent_id: parent_id,
                            new_position: group_index_in_parent + i,
                        };
                        if let Err(e) = reparent_cmd.apply(&mut doc_guard) {
                            tracing::warn!("ungroupNodes reparent failed: {e}");
                            // Restore this child's transform
                            if let Ok(node) = doc_guard.arena.get_mut(cid) {
                                node.transform = original_transform;
                            }
                            // Rollback previously completed children
                            for &(rid, ref rt) in completed.iter().rev() {
                                if let Ok(node) = doc_guard.arena.get_mut(rid) {
                                    node.transform = *rt;
                                }
                            }
                            return Err(async_graphql::Error::new("ungroup nodes failed"));
                        }
                    } else {
                        // RF-003: Group is a page root — detach child from group
                        // and add it to page root_nodes.
                        agent_designer_core::tree::remove_child(&mut doc_guard.arena, cid)
                            .map_err(|e| {
                                tracing::warn!("ungroupNodes remove_child failed: {e}");
                                async_graphql::Error::new("ungroup nodes failed")
                            })?;
                        if let Some(pid) = page_id {
                            doc_guard.add_root_node_to_page(pid, cid).map_err(|e| {
                                tracing::warn!("ungroupNodes add_root failed: {e}");
                                async_graphql::Error::new("ungroup nodes failed")
                            })?;
                        }
                    }

                    completed.push((cid, original_transform));
                }

                // Delete the group node
                let delete_cmd = DeleteNode {
                    node_id: gid,
                    page_id,
                };
                delete_cmd.validate(&doc_guard).map_err(|e| {
                    tracing::warn!("ungroupNodes delete failed: {e}");
                    async_graphql::Error::new("ungroup nodes failed")
                })?;
                delete_cmd.apply(&mut doc_guard).map_err(|e| {
                    tracing::warn!("ungroupNodes delete failed: {e}");
                    async_graphql::Error::new("ungroup nodes failed")
                })?;
            }

            // Build reparent operation payloads for broadcast
            let mut ops = build_ungroup_reparent_ops(&doc_guard, &all_child_uuids)?;
            for group_uuid in &parsed_uuids {
                ops.push(OperationPayload {
                    id: uuid::Uuid::new_v4().to_string(),
                    node_uuid: group_uuid.to_string(),
                    op_type: "delete_node".to_string(),
                    path: String::new(),
                    value: None,
                });
            }

            (all_child_uuids, ops)
        };

        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeDeleted,
            None,
            multi_op_transaction(user_id, operations),
        );

        Ok(child_uuids)
    }

    /// Generic operation endpoint — replaces all individual mutations.
    ///
    /// Accepts a batch of typed operations via `@oneOf` discriminated union.
    /// Validates all operations first, then applies atomically.
    /// Broadcasts the transaction to other clients.
    #[allow(clippy::too_many_lines)]
    async fn apply_operations(
        &self,
        ctx: &Context<'_>,
        operations: Vec<OperationInput>,
        user_id: String,
    ) -> Result<ApplyOperationsResult> {
        let state = ctx.data::<ServerState>()?;

        if operations.is_empty() {
            return Err(async_graphql::Error::new(
                "operations list must not be empty",
            ));
        }
        if operations.len() > MAX_BATCH_SIZE {
            return Err(async_graphql::Error::new(format!(
                "too many operations: {} (max {MAX_BATCH_SIZE})",
                operations.len()
            )));
        }

        // First pass: parse all inputs (no lock needed).
        // This validates JSON formats, deserializes typed values, and checks
        // domain constraints (float ranges, path validity, etc.).
        let mut parsed: Vec<ParsedOp> = Vec::with_capacity(operations.len());
        for op_input in &operations {
            parsed.push(parse_operation_input(op_input)?);
        }

        // Collect broadcast payloads before consuming parsed ops
        let broadcast_ops: Vec<OperationPayload> =
            parsed.iter().map(|p| p.broadcast.clone()).collect();

        // Second pass: build, validate, and apply sequentially under lock.
        // UUID→NodeId resolution happens inside the lock scope.
        // Operations are applied sequentially because later operations may
        // depend on earlier ones (e.g., create node then reparent it).
        // The batch is still atomic: if any operation fails, no partial
        // state escapes the lock scope (the guard is dropped without
        // broadcasting or signaling dirty).
        {
            let mut doc_guard = acquire_document_lock(state);

            for p in parsed {
                let op = (p.builder)(&doc_guard)?;
                op.validate(&doc_guard)
                    .map_err(|e| async_graphql::Error::new(format!("validation failed: {e}")))?;
                op.apply(&mut doc_guard)
                    .map_err(|e| async_graphql::Error::new(format!("apply failed: {e}")))?;
            }
        }

        // Signal dirty + broadcast
        state.app.signal_dirty();
        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            None,
            multi_op_transaction(Some(user_id), broadcast_ops),
        );

        let seq = state.app.next_seq();
        Ok(ApplyOperationsResult {
            seq: seq.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{EmptySubscription, Schema};

    /// Builds a test schema with the given `ServerState`.
    fn test_schema(
        state: ServerState,
    ) -> Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription> {
        Schema::build(
            super::super::query::QueryRoot,
            MutationRoot,
            EmptySubscription,
        )
        .data(state)
        .finish()
    }

    #[tokio::test]
    async fn test_create_node_mutation_returns_uuid_and_node() {
        let state = ServerState::new();

        // Add a page so we can test page placement
        {
            let mut doc = state.app.document.lock().unwrap();
            let page_uuid = uuid::Uuid::new_v4();
            let page = agent_designer_core::document::Page::new(
                PageId::new(page_uuid),
                "Home".to_string(),
            )
            .unwrap();
            doc.add_page(page).unwrap();
        }

        let schema = test_schema(state);

        let query = r#"
            mutation {
                createNode(
                    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] }
                    name: "Test Rect"
                ) {
                    uuid
                    node {
                        name
                        visible
                        locked
                    }
                }
            }
        "#;

        let res = schema.execute(query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let data = res.data.into_json().unwrap();
        let create_result = &data["createNode"];
        assert!(!create_result["uuid"].as_str().unwrap().is_empty());
        assert_eq!(create_result["node"]["name"], "Test Rect");
        assert_eq!(create_result["node"]["visible"], true);
        assert_eq!(create_result["node"]["locked"], false);
    }

    #[tokio::test]
    async fn test_delete_node_mutation_removes_node() {
        let state = ServerState::new();
        let schema = test_schema(state);

        // Create a node first
        let create_res = schema
            .execute(
                r#"mutation { createNode(kind: { type: "group" }, name: "To Delete") { uuid } }"#,
            )
            .await;
        assert!(
            create_res.errors.is_empty(),
            "errors: {:?}",
            create_res.errors
        );

        let created_uuid = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        // Delete it
        let delete_query = format!(r#"mutation {{ deleteNode(uuid: "{created_uuid}") }}"#);
        let delete_res = schema.execute(&*delete_query).await;
        assert!(
            delete_res.errors.is_empty(),
            "errors: {:?}",
            delete_res.errors
        );

        let deleted = delete_res.data.into_json().unwrap()["deleteNode"]
            .as_bool()
            .unwrap();
        assert!(deleted);

        // Verify the node is gone
        let node_query = format!(r#"{{ node(uuid: "{created_uuid}") {{ name }} }}"#);
        let node_res = schema.execute(&*node_query).await;
        assert!(node_res.errors.is_empty());
        assert!(node_res.data.into_json().unwrap()["node"].is_null());
    }

    #[tokio::test]
    async fn test_rename_node_mutation_updates_name() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let create_res = schema
            .execute(
                r#"mutation { createNode(kind: { type: "group" }, name: "Original") { uuid } }"#,
            )
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        let rename_query = format!(
            r#"mutation {{ renameNode(uuid: "{uuid_str}", newName: "Renamed") {{ name }} }}"#,
        );
        let rename_res = schema.execute(&*rename_query).await;
        assert!(
            rename_res.errors.is_empty(),
            "errors: {:?}",
            rename_res.errors
        );

        let new_name = rename_res.data.into_json().unwrap()["renameNode"]["name"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(new_name, "Renamed");
    }

    #[tokio::test]
    async fn test_set_visible_mutation_toggles_visibility() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let create_res = schema
            .execute(r#"mutation { createNode(kind: { type: "group" }, name: "V") { uuid } }"#)
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        let hide_query = format!(
            r#"mutation {{ setVisible(uuid: "{uuid_str}", visible: false) {{ visible }} }}"#,
        );
        let hide_res = schema.execute(&*hide_query).await;
        assert!(hide_res.errors.is_empty(), "errors: {:?}", hide_res.errors);

        let visible = hide_res.data.into_json().unwrap()["setVisible"]["visible"]
            .as_bool()
            .unwrap();
        assert!(!visible);
    }

    #[tokio::test]
    async fn test_set_locked_mutation_toggles_lock() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let create_res = schema
            .execute(r#"mutation { createNode(kind: { type: "group" }, name: "L") { uuid } }"#)
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        let lock_query =
            format!(r#"mutation {{ setLocked(uuid: "{uuid_str}", locked: true) {{ locked }} }}"#,);
        let lock_res = schema.execute(&*lock_query).await;
        assert!(lock_res.errors.is_empty(), "errors: {:?}", lock_res.errors);

        let locked = lock_res.data.into_json().unwrap()["setLocked"]["locked"]
            .as_bool()
            .unwrap();
        assert!(locked);
    }

    #[tokio::test]
    async fn test_set_transform_mutation_updates_position() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let create_res = schema
            .execute(r#"mutation { createNode(kind: { type: "group" }, name: "T") { uuid } }"#)
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        let transform_query = format!(
            r#"mutation {{
                setTransform(
                    uuid: "{uuid_str}"
                    transform: {{ x: 100, y: 200, width: 50, height: 60, rotation: 0, scale_x: 1, scale_y: 1 }}
                ) {{
                    transform
                }}
            }}"#,
        );
        let transform_res = schema.execute(&*transform_query).await;
        assert!(
            transform_res.errors.is_empty(),
            "errors: {:?}",
            transform_res.errors
        );

        let t = &transform_res.data.into_json().unwrap()["setTransform"]["transform"];
        assert_eq!(t["x"], 100.0);
        assert_eq!(t["y"], 200.0);
    }

    #[tokio::test]
    async fn test_delete_node_with_invalid_uuid_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let res = schema
            .execute(r#"mutation { deleteNode(uuid: "not-a-uuid") }"#)
            .await;
        assert!(!res.errors.is_empty());
    }

    #[tokio::test]
    async fn test_create_node_with_transform_applies_transform() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let query = r#"
            mutation {
                createNode(
                    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] }
                    name: "Positioned"
                    transform: { x: 42, y: 84, width: 100, height: 200, rotation: 0, scale_x: 1, scale_y: 1 }
                ) {
                    node {
                        transform
                    }
                }
            }
        "#;

        let res = schema.execute(query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let t = &res.data.into_json().unwrap()["createNode"]["node"]["transform"];
        assert_eq!(t["x"], 42.0);
        assert_eq!(t["y"], 84.0);
        assert_eq!(t["width"], 100.0);
        assert_eq!(t["height"], 200.0);
    }

    /// Helper: creates a frame node via GraphQL and returns its UUID string.
    async fn create_frame(
        schema: &Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription>,
        name: &str,
    ) -> String {
        let query = format!(
            r#"mutation {{ createNode(kind: {{ type: "frame" }}, name: "{name}") {{ uuid }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            res.errors.is_empty(),
            "create_frame errors: {:?}",
            res.errors
        );
        res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// Helper: reparents `child_uuid` under `parent_uuid` at `position` and
    /// returns the parent UUID from the GraphQL response.
    async fn reparent(
        schema: &Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription>,
        child_uuid: &str,
        parent_uuid: &str,
        position: i32,
    ) -> serde_json::Value {
        let query = format!(
            r#"mutation {{ reparentNode(uuid: "{child_uuid}", newParentUuid: "{parent_uuid}", position: {position}) {{ uuid parent children }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "reparent errors: {:?}", res.errors);
        res.data.into_json().unwrap()["reparentNode"].clone()
    }

    #[tokio::test]
    async fn test_reparent_node_mutation_moves_node_to_new_parent() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let parent_uuid = create_frame(&schema, "Parent").await;
        let child_uuid = create_frame(&schema, "Child").await;

        let result = reparent(&schema, &child_uuid, &parent_uuid, 0).await;
        assert_eq!(result["parent"].as_str().unwrap(), parent_uuid);

        // Verify parent now lists child
        let parent_query = format!(r#"{{ node(uuid: "{parent_uuid}") {{ children }} }}"#,);
        let parent_res = schema.execute(&*parent_query).await;
        assert!(parent_res.errors.is_empty());
        let children = &parent_res.data.into_json().unwrap()["node"]["children"];
        assert!(
            children
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c.as_str().unwrap() == child_uuid)
        );
    }

    #[tokio::test]
    async fn test_reparent_node_with_invalid_uuid_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let parent_uuid = create_frame(&schema, "Parent").await;

        let query = format!(
            r#"mutation {{ reparentNode(uuid: "not-valid", newParentUuid: "{parent_uuid}", position: 0) {{ uuid }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(!res.errors.is_empty());
    }

    #[tokio::test]
    async fn test_reorder_children_mutation_changes_position() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let parent_uuid = create_frame(&schema, "Parent").await;
        let child_a = create_frame(&schema, "A").await;
        let child_b = create_frame(&schema, "B").await;
        let child_c = create_frame(&schema, "C").await;

        // Reparent all children under parent
        reparent(&schema, &child_a, &parent_uuid, 0).await;
        reparent(&schema, &child_b, &parent_uuid, 1).await;
        reparent(&schema, &child_c, &parent_uuid, 2).await;

        // Move A from position 0 to position 2
        let reorder_query = format!(
            r#"mutation {{ reorderChildren(uuid: "{child_a}", newPosition: 2) {{ uuid }} }}"#,
        );
        let reorder_res = schema.execute(&*reorder_query).await;
        assert!(
            reorder_res.errors.is_empty(),
            "errors: {:?}",
            reorder_res.errors
        );

        // Verify new order: B, C, A
        let parent_query = format!(r#"{{ node(uuid: "{parent_uuid}") {{ children }} }}"#,);
        let parent_res = schema.execute(&*parent_query).await;
        assert!(parent_res.errors.is_empty());
        let children: Vec<String> = parent_res.data.into_json().unwrap()["node"]["children"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert_eq!(children, vec![child_b, child_c, child_a]);
    }

    #[tokio::test]
    async fn test_reorder_children_on_root_node_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let root_uuid = create_frame(&schema, "Root").await;

        let query = format!(
            r#"mutation {{ reorderChildren(uuid: "{root_uuid}", newPosition: 0) {{ uuid }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "root node has no parent, should fail"
        );
    }

    // ── Style mutation tests ──────────────────────────────────────────

    /// Helper: creates a rectangle node via GraphQL and returns its UUID string.
    async fn create_rect(
        schema: &Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription>,
        name: &str,
    ) -> String {
        let query = format!(
            r#"mutation {{ createNode(kind: {{ type: "rectangle", corner_radii: [0, 0, 0, 0] }}, name: "{name}") {{ uuid }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            res.errors.is_empty(),
            "create_rect errors: {:?}",
            res.errors
        );
        res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn test_set_opacity_mutation_updates_opacity() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query =
            format!(r#"mutation {{ setOpacity(uuid: "{uuid_str}", opacity: 0.5) {{ style }} }}"#,);
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setOpacity"]["style"];
        let opacity = &style["opacity"];
        // StyleValue serializes with #[serde(tag = "type")]: {"type":"literal","value":0.5}
        assert_eq!(opacity["type"], "literal");
        assert_eq!(opacity["value"], 0.5);
    }

    #[tokio::test]
    async fn test_set_opacity_rejects_out_of_range() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        // GraphQL passes NaN as a float literal — but async_graphql rejects NaN
        // at the parser level. Test via a non-finite value that we can represent:
        // use a value out of range instead.
        let query =
            format!(r#"mutation {{ setOpacity(uuid: "{uuid_str}", opacity: 1.5) {{ style }} }}"#,);
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "opacity 1.5 should be rejected (out of range)"
        );
    }

    #[tokio::test]
    async fn test_set_blend_mode_mutation_updates_blend_mode() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setBlendMode(uuid: "{uuid_str}", blendMode: "multiply") {{ style }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setBlendMode"]["style"];
        assert_eq!(style["blend_mode"], "multiply");
    }

    #[tokio::test]
    async fn test_set_blend_mode_rejects_invalid_mode() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setBlendMode(uuid: "{uuid_str}", blendMode: "not_a_mode") {{ style }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "invalid blend mode should be rejected"
        );
    }

    #[tokio::test]
    async fn test_set_corner_radii_mutation_updates_radii() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setCornerRadii(uuid: "{uuid_str}", radii: [4.0, 8.0, 4.0, 8.0]) {{ kind }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let kind = &res.data.into_json().unwrap()["setCornerRadii"]["kind"];
        let radii = kind["corner_radii"].as_array().unwrap();
        assert_eq!(radii[0], 4.0);
        assert_eq!(radii[1], 8.0);
        assert_eq!(radii[2], 4.0);
        assert_eq!(radii[3], 8.0);
    }

    #[tokio::test]
    async fn test_set_corner_radii_on_non_rectangle_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let frame_uuid = create_frame(&schema, "Frame").await;

        let query = format!(
            r#"mutation {{ setCornerRadii(uuid: "{frame_uuid}", radii: [4.0, 4.0, 4.0, 4.0]) {{ kind }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "setCornerRadii on a frame should return an error"
        );
    }

    #[tokio::test]
    async fn test_set_corner_radii_rejects_wrong_count() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setCornerRadii(uuid: "{uuid_str}", radii: [4.0, 4.0]) {{ kind }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "radii with 2 elements should be rejected"
        );
    }

    #[tokio::test]
    async fn test_set_corner_radii_rejects_negative_values() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setCornerRadii(uuid: "{uuid_str}", radii: [4.0, -1.0, 4.0, 4.0]) {{ kind }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(!res.errors.is_empty(), "negative radii should be rejected");
    }

    #[tokio::test]
    async fn test_set_fills_mutation_updates_fills() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        // Solid red fill: Fill::Solid { color: StyleValue::Literal { value: Color::Srgb } }
        // Wire format: [{"type":"solid","color":{"type":"literal","value":{"space":"srgb",...}}}]
        let query = format!(
            r#"mutation {{
                setFills(
                    uuid: "{uuid_str}"
                    fills: [{{type: "solid", color: {{type: "literal", value: {{space: "srgb", r: 1.0, g: 0.0, b: 0.0, a: 1.0}}}}}}]
                ) {{
                    style
                }}
            }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setFills"]["style"];
        let fills = style["fills"].as_array().expect("fills must be an array");
        assert_eq!(fills.len(), 1);
        assert_eq!(fills[0]["type"], "solid");
        assert_eq!(fills[0]["color"]["type"], "literal");
        assert_eq!(fills[0]["color"]["value"]["space"], "srgb");
        assert_eq!(fills[0]["color"]["value"]["r"], 1.0);
    }

    #[tokio::test]
    async fn test_set_strokes_mutation_updates_strokes() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        // A single blue stroke with width 2.
        // Stroke wire format: { color, width, alignment, cap, join }
        // alignment/cap/join use rename_all = "snake_case"
        let query = format!(
            r#"mutation {{
                setStrokes(
                    uuid: "{uuid_str}"
                    strokes: [{{
                        color: {{type: "literal", value: {{space: "srgb", r: 0.0, g: 0.0, b: 1.0, a: 1.0}}}},
                        width: {{type: "literal", value: 2.0}},
                        alignment: "outside",
                        cap: "round",
                        join: "bevel"
                    }}]
                ) {{
                    style
                }}
            }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setStrokes"]["style"];
        let strokes = style["strokes"]
            .as_array()
            .expect("strokes must be an array");
        assert_eq!(strokes.len(), 1);
        assert_eq!(strokes[0]["alignment"], "outside");
        assert_eq!(strokes[0]["cap"], "round");
        assert_eq!(strokes[0]["join"], "bevel");
        assert_eq!(strokes[0]["width"]["value"], 2.0);
        assert_eq!(strokes[0]["color"]["value"]["space"], "srgb");
        assert_eq!(strokes[0]["color"]["value"]["b"], 1.0);
    }

    #[tokio::test]
    async fn test_set_effects_mutation_updates_effects() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        // A single layer_blur effect.
        // Effect::LayerBlur { radius: StyleValue<f64> }
        // Wire format (tag = "type", rename_all = "snake_case"):
        // {"type":"layer_blur","radius":{"type":"literal","value":4.0}}
        let query = format!(
            r#"mutation {{
                setEffects(
                    uuid: "{uuid_str}"
                    effects: [{{type: "layer_blur", radius: {{type: "literal", value: 4.0}}}}]
                ) {{
                    style
                }}
            }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setEffects"]["style"];
        let effects = style["effects"]
            .as_array()
            .expect("effects must be an array");
        assert_eq!(effects.len(), 1);
        assert_eq!(effects[0]["type"], "layer_blur");
        assert_eq!(effects[0]["radius"]["type"], "literal");
        assert_eq!(effects[0]["radius"]["value"], 4.0);
    }

    // ── applyOperations tests ────────────────────────────────────────

    /// Helper: creates a node via the old `createNode` mutation and returns its UUID.
    async fn create_node_for_apply_ops(
        schema: &Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription>,
        kind_str: &str,
        name: &str,
    ) -> String {
        let query =
            format!(r#"mutation {{ createNode(kind: {kind_str}, name: "{name}") {{ uuid }} }}"#,);
        let res = schema.execute(&*query).await;
        assert!(
            res.errors.is_empty(),
            "create_node_for_apply_ops errors: {:?}",
            res.errors
        );
        res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_renames_node() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid = create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "TestNode").await;

        // Use applyOperations to rename it
        let rename_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "name", value: "\"NewName\"" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&rename_query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        // Verify the rename happened
        let query_res = schema
            .execute(format!(r#"{{ node(uuid: "{uuid}") {{ name }} }}"#).as_str())
            .await;
        assert!(query_res.errors.is_empty());
        let name = query_res.data.into_json().unwrap()["node"]["name"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(name, "NewName");
    }

    #[tokio::test]
    async fn test_apply_operations_multiple_ops_atomic() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_a = create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "A").await;
        let uuid_b = create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "B").await;

        // Rename both in one batch
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [
                        {{ setField: {{ nodeUuid: "{uuid_a}", path: "name", value: "\"RenamedA\"" }} }},
                        {{ setField: {{ nodeUuid: "{uuid_b}", path: "name", value: "\"RenamedB\"" }} }}
                    ],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        // Verify both renames happened
        let name_a = schema
            .execute(format!(r#"{{ node(uuid: "{uuid_a}") {{ name }} }}"#).as_str())
            .await
            .data
            .into_json()
            .unwrap()["node"]["name"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(name_a, "RenamedA");

        let name_b = schema
            .execute(format!(r#"{{ node(uuid: "{uuid_b}") {{ name }} }}"#).as_str())
            .await
            .data
            .into_json()
            .unwrap()["node"]["name"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(name_b, "RenamedB");
    }

    #[tokio::test]
    async fn test_apply_operations_invalid_uuid_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        // An operation targeting a nonexistent node should return an error
        let bad_uuid = uuid::Uuid::new_v4().to_string();
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [
                        {{ setField: {{ nodeUuid: "{bad_uuid}", path: "name", value: "\"Bad\"" }} }}
                    ],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "operation with nonexistent UUID should be rejected"
        );
    }

    #[tokio::test]
    async fn test_apply_operations_create_and_reparent() {
        let state = ServerState::new();
        let schema = test_schema(state);

        // Create a parent via old mutation
        let parent_uuid =
            create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "Parent").await;

        // Create a child + reparent it in one applyOperations call
        let child_uuid = uuid::Uuid::new_v4().to_string();
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [
                        {{ createNode: {{ nodeUuid: "{child_uuid}", kind: "{{\"type\": \"frame\"}}", name: "Child" }} }},
                        {{ reparent: {{ nodeUuid: "{child_uuid}", newParentUuid: "{parent_uuid}", position: 0 }} }}
                    ],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        // Verify parent lists child
        let parent_res = schema
            .execute(format!(r#"{{ node(uuid: "{parent_uuid}") {{ children }} }}"#).as_str())
            .await;
        assert!(parent_res.errors.is_empty());
        let children = &parent_res.data.into_json().unwrap()["node"]["children"];
        assert!(
            children
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c.as_str().unwrap() == child_uuid),
            "parent should contain the child"
        );
    }

    #[tokio::test]
    async fn test_apply_operations_empty_rejected() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let query = r#"mutation {
            applyOperations(operations: [], userId: "test-user") {
                seq
            }
        }"#;
        let res = schema.execute(query).await;
        assert!(
            !res.errors.is_empty(),
            "empty operations list should be rejected"
        );
    }

    #[tokio::test]
    async fn test_apply_operations_batch_size_limit_enforced() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid = create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "Node").await;

        // Build MAX_BATCH_SIZE + 1 operations
        let ops: Vec<String> = (0..=MAX_BATCH_SIZE)
            .map(|i| {
                format!(
                    r#"{{ setField: {{ nodeUuid: "{uuid}", path: "name", value: "\"Name{i}\"" }} }}"#
                )
            })
            .collect();
        let ops_str = ops.join(", ");

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{ops_str}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "exceeding MAX_BATCH_SIZE should be rejected"
        );
    }

    #[tokio::test]
    async fn test_apply_operations_set_transform() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid = create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "Node").await;

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "transform", value: "{{\"x\":100,\"y\":200,\"width\":50,\"height\":60,\"rotation\":0,\"scale_x\":1,\"scale_y\":1}}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let node_res = schema
            .execute(format!(r#"{{ node(uuid: "{uuid}") {{ transform }} }}"#).as_str())
            .await;
        let t = &node_res.data.into_json().unwrap()["node"]["transform"];
        assert_eq!(t["x"], 100.0);
        assert_eq!(t["y"], 200.0);
    }

    #[tokio::test]
    async fn test_apply_operations_set_visible() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid = create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "Node").await;

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "visible", value: "false" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let node_res = schema
            .execute(format!(r#"{{ node(uuid: "{uuid}") {{ visible }} }}"#).as_str())
            .await;
        let visible = node_res.data.into_json().unwrap()["node"]["visible"]
            .as_bool()
            .unwrap();
        assert!(!visible);
    }

    #[tokio::test]
    async fn test_apply_operations_delete_node() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid = create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "ToDelete").await;

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ deleteNode: {{ nodeUuid: "{uuid}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        // Verify node is gone
        let node_res = schema
            .execute(format!(r#"{{ node(uuid: "{uuid}") {{ name }} }}"#).as_str())
            .await;
        assert!(node_res.data.into_json().unwrap()["node"].is_null());
    }

    #[tokio::test]
    async fn test_apply_operations_unknown_path_rejected() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid = create_node_for_apply_ops(&schema, r#"{ type: "frame" }"#, "Node").await;

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "nonexistent.path", value: "42" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(!res.errors.is_empty(), "unknown path should be rejected");
    }
}
