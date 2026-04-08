// crates/server/src/graphql/mutation.rs

//! GraphQL mutations for document operations.
//!
//! All document mutations flow through the single `applyOperations` endpoint,
//! which accepts a batch of typed operations via async-graphql's `@oneOf`
//! discriminated union. The handler:
//!
//! 1. Parses and validates each operation input (no lock needed)
//! 2. Acquires the document lock
//! 3. Resolves UUIDs to arena-local `NodeId`s
//! 4. Validates + applies operations sequentially (supports dependent ops)
//! 5. Drops the lock
//! 6. Signals dirty for persistence and broadcasts the transaction

use async_graphql::{Context, Object, Result};

use agent_designer_core::FieldOperation;
use agent_designer_core::PageId;
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
use agent_designer_state::{MutationEventKind, OperationPayload, TransactionPayload};

use crate::state::ServerState;

use super::types::{
    ApplyOperationsResult, CreateNodeInput, DeleteNodeInput, OperationInput, ReorderInput,
    ReparentInput, SetFieldInput,
};

pub struct MutationRoot;

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
    /// Generic operation endpoint — the single mutation for all document changes.
    ///
    /// Accepts a batch of typed operations via `@oneOf` discriminated union.
    /// Operations are applied sequentially (supporting dependent ops like
    /// create-then-reparent). Broadcasts the transaction to other clients.
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

    /// Helper: creates a frame node directly via the state and returns its UUID string.
    ///
    /// Uses the core engine directly rather than going through GraphQL,
    /// to avoid escaping complexity in test setup.
    fn create_test_frame_direct(state: &ServerState, name: &str) -> String {
        use agent_designer_core::commands::node_commands::CreateNode;
        use agent_designer_core::node::NodeKind;

        let node_uuid = uuid::Uuid::new_v4();
        let cmd = CreateNode {
            uuid: node_uuid,
            kind: NodeKind::Frame { layout: None },
            name: name.to_string(),
            page_id: None,
            initial_transform: None,
        };

        let mut doc = state.app.document.lock().unwrap();
        cmd.validate(&doc).expect("create node validate");
        cmd.apply(&mut doc).expect("create node apply");
        node_uuid.to_string()
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_renames_node() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "TestNode");

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
    async fn test_apply_operations_multiple_ops() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid_a = create_test_frame_direct(&state, "A");
        let uuid_b = create_test_frame_direct(&state, "B");

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
        let schema = test_schema(state.clone());

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
        let schema = test_schema(state.clone());

        let parent_uuid = create_test_frame_direct(&state, "Parent");

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
        let schema = test_schema(state.clone());

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
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "Node");

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
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "Node");

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
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "Node");

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
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "ToDelete");

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

        let node_res = schema
            .execute(format!(r#"{{ node(uuid: "{uuid}") {{ name }} }}"#).as_str())
            .await;
        assert!(node_res.data.into_json().unwrap()["node"].is_null());
    }

    #[tokio::test]
    async fn test_apply_operations_unknown_path_rejected() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "Node");

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
