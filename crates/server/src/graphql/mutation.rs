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
    CreateNode, DeleteNode, RenameNode, SetLocked, SetTextContent, SetVisible,
};
use agent_designer_core::commands::page_commands::{
    CreatePage, DeletePage, RenamePage, ReorderPage,
};
use agent_designer_core::commands::style_commands::validate_transform;
use agent_designer_core::commands::style_commands::{
    SetBlendMode, SetCornerRadii, SetEffects, SetFills, SetOpacity, SetStrokes, SetTransform,
};
use agent_designer_core::commands::text_style_commands::{SetTextStyleField, TextStyleField};
use agent_designer_core::commands::token_commands::{AddToken, RemoveToken, UpdateToken};
use agent_designer_core::commands::tree_commands::{ReorderChildren, ReparentNode};
use agent_designer_core::id::TokenId;
use agent_designer_core::node::{
    BlendMode, Color, Effect, Fill, FontStyle, NodeKind, Stroke, StyleValue, TextAlign,
    TextDecoration, TextShadow, Transform,
};
use agent_designer_core::token::{Token, TokenValue};
use agent_designer_core::validate::{
    MAX_BATCH_SIZE, MAX_EFFECTS_PER_STYLE, MAX_FIELD_VALUE_SIZE, MAX_FILLS_PER_STYLE,
    MAX_STROKES_PER_STYLE, MAX_USER_ID_LEN, validate_floats_in_value,
};
use agent_designer_state::{MutationEventKind, OperationPayload, TransactionPayload};

use crate::state::ServerState;

use super::types::{
    AddTokenInput, ApplyOperationsResult, CreateNodeInput, CreatePageInput, DeleteNodeInput,
    DeletePageInput, OperationInput, RemoveTokenInput, RenamePageInput, ReorderInput,
    ReorderPageInput, ReparentInput, SetFieldInput, UpdateTokenInput, parse_token_type,
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
        OperationInput::CreatePage(cp) => parse_create_page(cp),
        OperationInput::DeletePage(dp) => parse_delete_page(dp),
        OperationInput::RenamePage(rp) => parse_rename_page(rp),
        OperationInput::ReorderPage(ro) => parse_reorder_page(ro),
        OperationInput::AddToken(at) => parse_add_token(at),
        OperationInput::UpdateToken(ut) => parse_update_token(ut),
        OperationInput::RemoveToken(rt) => parse_remove_token(rt),
    }
}

/// Parses a `SetField` input, dispatching on the field path.
#[allow(clippy::too_many_lines)]
fn parse_set_field(sf: &SetFieldInput) -> Result<ParsedOp> {
    // RF-016: reject oversized JSON values before parsing
    if sf.value.len() > MAX_FIELD_VALUE_SIZE {
        return Err(async_graphql::Error::new(format!(
            "field value exceeds maximum size of {MAX_FIELD_VALUE_SIZE} bytes (got {})",
            sf.value.len()
        )));
    }

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
    // RF-030: parse UUID once outside the builder closure
    let parsed_uuid: uuid::Uuid = sf
        .node_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;

    match path.as_str() {
        "transform" => {
            let new_transform: Transform = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid transform: {e}")))?;
            validate_transform(&new_transform)
                .map_err(|e| async_graphql::Error::new(format!("invalid transform values: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
            // RF-022: validate array size
            if new_fills.len() > MAX_FILLS_PER_STYLE {
                return Err(async_graphql::Error::new(format!(
                    "fills exceed maximum of {MAX_FILLS_PER_STYLE} (got {})",
                    new_fills.len()
                )));
            }
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
            // RF-022: validate array size
            if new_strokes.len() > MAX_STROKES_PER_STYLE {
                return Err(async_graphql::Error::new(format!(
                    "strokes exceed maximum of {MAX_STROKES_PER_STYLE} (got {})",
                    new_strokes.len()
                )));
            }
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
            // RF-022: validate array size
            if new_effects.len() > MAX_EFFECTS_PER_STYLE {
                return Err(async_graphql::Error::new(format!(
                    "effects exceed maximum of {MAX_EFFECTS_PER_STYLE} (got {})",
                    new_effects.len()
                )));
            }
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
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
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetCornerRadii { node_id, new_radii }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.content" => {
            if let Some(s) = value.as_str()
                && s.len() > agent_designer_core::validate::MAX_TEXT_CONTENT_LEN
            {
                return Err(async_graphql::Error::new(
                    "text content exceeds maximum length",
                ));
            }
            let new_content: String = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid content: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextContent {
                        node_id,
                        new_content,
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.font_family" => {
            let font_family: String = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid font_family: {e}")))?;
            if font_family.is_empty() {
                return Err(async_graphql::Error::new("font_family must not be empty"));
            }
            if font_family.len() > agent_designer_core::validate::MAX_FONT_FAMILY_LEN {
                return Err(async_graphql::Error::new(format!(
                    "font_family exceeds max length of {}",
                    agent_designer_core::validate::MAX_FONT_FAMILY_LEN
                )));
            }
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::FontFamily(font_family),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.font_size" => {
            validate_floats_in_value(&value).map_err(|e| {
                async_graphql::Error::new(format!("font_size contains invalid floats: {e}"))
            })?;
            let font_size: StyleValue<f64> = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid font_size: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::FontSize(font_size),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.font_weight" => {
            let font_weight: u16 = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid font_weight: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::FontWeight(font_weight),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.font_style" => {
            let font_style: FontStyle = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid font_style: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::FontStyle(font_style),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.line_height" => {
            validate_floats_in_value(&value).map_err(|e| {
                async_graphql::Error::new(format!("line_height contains invalid floats: {e}"))
            })?;
            let line_height: StyleValue<f64> = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid line_height: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::LineHeight(line_height),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.letter_spacing" => {
            validate_floats_in_value(&value).map_err(|e| {
                async_graphql::Error::new(format!("letter_spacing contains invalid floats: {e}"))
            })?;
            let letter_spacing: StyleValue<f64> = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid letter_spacing: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::LetterSpacing(letter_spacing),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.text_align" => {
            let text_align: TextAlign = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid text_align: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::TextAlign(text_align),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.text_decoration" => {
            let text_decoration: TextDecoration = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid text_decoration: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::TextDecoration(text_decoration),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.text_color" => {
            validate_floats_in_value(&value).map_err(|e| {
                async_graphql::Error::new(format!("text_color contains invalid floats: {e}"))
            })?;
            let text_color: StyleValue<Color> = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid text_color: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::TextColor(text_color),
                    }) as Box<dyn FieldOperation>)
                }),
                broadcast,
            })
        }
        "kind.text_style.text_shadow" => {
            // null JSON removes the shadow; an object sets it.
            if !value.is_null() {
                validate_floats_in_value(&value).map_err(|e| {
                    async_graphql::Error::new(format!("text_shadow contains invalid floats: {e}"))
                })?;
            }
            let opt_shadow: Option<TextShadow> =
                if value.is_null() {
                    None
                } else {
                    // TextShadow's custom Deserialize routes through TextShadow::new(),
                    // so validation happens inside the deserialization step.
                    Some(serde_json::from_value(value).map_err(|e| {
                        async_graphql::Error::new(format!("invalid text_shadow: {e}"))
                    })?)
                };
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc
                        .arena
                        .id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetTextStyleField {
                        node_id,
                        field: TextStyleField::TextShadow(opt_shadow),
                    }) as Box<dyn FieldOperation>)
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

    // RF-016: reject oversized kind JSON before parsing
    if cn.kind.len() > MAX_FIELD_VALUE_SIZE {
        return Err(async_graphql::Error::new(format!(
            "node kind value exceeds maximum size of {MAX_FIELD_VALUE_SIZE} bytes (got {})",
            cn.kind.len()
        )));
    }

    let kind: NodeKind = serde_json::from_str(&cn.kind)
        .map_err(|e| async_graphql::Error::new(format!("invalid node kind: {e}")))?;

    let initial_transform: Option<Transform> = match cn.transform.as_ref() {
        Some(t) => {
            // RF-016: reject oversized transform JSON before parsing
            if t.len() > MAX_FIELD_VALUE_SIZE {
                return Err(async_graphql::Error::new(format!(
                    "transform value exceeds maximum size of {MAX_FIELD_VALUE_SIZE} bytes (got {})",
                    t.len()
                )));
            }
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
    // RF-030: parse UUID once outside the builder closure
    let parsed_uuid: uuid::Uuid = dn
        .node_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: dn.node_uuid.clone(),
        op_type: "delete_node".to_string(),
        path: String::new(),
        value: None,
    };

    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            let node_id = doc
                .arena
                .id_by_uuid(&parsed_uuid)
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
    // RF-030: parse UUIDs once outside the builder closure
    let parsed_uuid: uuid::Uuid = rp
        .node_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;
    let parsed_parent_uuid: uuid::Uuid = rp
        .new_parent_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid parent UUID"))?;

    if rp.position < 0 {
        return Err(async_graphql::Error::new("position must be non-negative"));
    }
    #[allow(clippy::cast_sign_loss)]
    let position_usize = rp.position as usize;

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: rp.node_uuid.clone(),
        op_type: "reparent".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "parentUuid": rp.new_parent_uuid,
            "position": rp.position,
        })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            let node_id = doc
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;
            let parent_id = doc
                .arena
                .id_by_uuid(&parsed_parent_uuid)
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
    // RF-030: parse UUID once outside the builder closure
    let parsed_uuid: uuid::Uuid = ro
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

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: ro.node_uuid.clone(),
        op_type: "reorder".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "newPosition": ro.new_position,
        })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            let node_id = doc
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;
            Ok(Box::new(ReorderChildren {
                node_id,
                new_position: new_position_usize,
            }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses a `CreatePage` input.
fn parse_create_page(input: &CreatePageInput) -> Result<ParsedOp> {
    // RF-030: parse UUID once outside the builder closure
    let page_uuid: uuid::Uuid = input
        .page_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid page UUID"))?;
    let page_id = PageId::new(page_uuid);
    let name = input.name.clone();

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: page_uuid.to_string(),
        op_type: "create_page".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({ "id": page_uuid.to_string(), "name": &name })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| {
            Ok(Box::new(CreatePage { page_id, name }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses a `DeletePage` input.
fn parse_delete_page(input: &DeletePageInput) -> Result<ParsedOp> {
    // RF-030: parse UUID once outside the builder closure
    let page_uuid: uuid::Uuid = input
        .page_id
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid page UUID"))?;
    let page_id = PageId::new(page_uuid);

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: page_uuid.to_string(),
        op_type: "delete_page".to_string(),
        path: String::new(),
        value: None,
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| {
            Ok(Box::new(DeletePage { page_id }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses a `RenamePage` input.
fn parse_rename_page(input: &RenamePageInput) -> Result<ParsedOp> {
    // RF-030: parse UUID once outside the builder closure
    let page_uuid: uuid::Uuid = input
        .page_id
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid page UUID"))?;
    let page_id = PageId::new(page_uuid);
    let new_name = input.new_name.clone();

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: page_uuid.to_string(),
        op_type: "rename_page".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({ "name": &new_name })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| {
            Ok(Box::new(RenamePage { page_id, new_name }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses a `ReorderPage` input.
fn parse_reorder_page(input: &ReorderPageInput) -> Result<ParsedOp> {
    // RF-030: parse UUID once outside the builder closure
    let page_uuid: uuid::Uuid = input
        .page_id
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid page UUID"))?;
    let page_id = PageId::new(page_uuid);

    if input.new_position < 0 {
        return Err(async_graphql::Error::new(
            "new_position must be non-negative",
        ));
    }
    #[allow(clippy::cast_sign_loss)]
    let new_position = input.new_position as usize;

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: page_uuid.to_string(),
        op_type: "reorder_page".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({ "newPosition": input.new_position })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| {
            Ok(Box::new(ReorderPage {
                page_id,
                new_position,
            }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses an `AddToken` input.
fn parse_add_token(input: &AddTokenInput) -> Result<ParsedOp> {
    // Parse the stable token UUID from the client.
    let token_uuid: uuid::Uuid = input
        .token_uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid token UUID"))?;

    // Parse token type string.
    let token_type = parse_token_type(&input.token_type).map_err(async_graphql::Error::new)?;

    // Deserialize token value JSON.
    if input.value.len() > MAX_FIELD_VALUE_SIZE {
        return Err(async_graphql::Error::new(format!(
            "token value exceeds maximum size of {MAX_FIELD_VALUE_SIZE} bytes (got {})",
            input.value.len()
        )));
    }
    let token_value: TokenValue = serde_json::from_str(&input.value)
        .map_err(|e| async_graphql::Error::new(format!("invalid token value JSON: {e}")))?;

    // Construct a Token via its validating constructor (validates name, value, type match).
    let token = Token::new(
        TokenId::new(token_uuid),
        input.name.clone(),
        token_value,
        token_type,
        input.description.clone(),
    )
    .map_err(|e| async_graphql::Error::new(format!("invalid token: {e}")))?;

    let token_name = token.name().to_string();
    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: token_uuid.to_string(),
        op_type: "create_token".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "id": token_uuid.to_string(),
            "name": &token_name,
        })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| Ok(Box::new(AddToken { token }) as Box<dyn FieldOperation>)),
        broadcast,
    })
}

/// Parses an `UpdateToken` input.
fn parse_update_token(input: &UpdateTokenInput) -> Result<ParsedOp> {
    // Deserialize token value JSON.
    if input.value.len() > MAX_FIELD_VALUE_SIZE {
        return Err(async_graphql::Error::new(format!(
            "token value exceeds maximum size of {MAX_FIELD_VALUE_SIZE} bytes (got {})",
            input.value.len()
        )));
    }
    let token_value: TokenValue = serde_json::from_str(&input.value)
        .map_err(|e| async_graphql::Error::new(format!("invalid token value JSON: {e}")))?;

    let token_name = input.name.clone();
    let description = input.description.clone();

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: String::new(),
        op_type: "update_token".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({ "name": &token_name })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            // Look up the existing token to get its UUID (stable identity).
            let existing = doc.token_context.get(&token_name).ok_or_else(|| {
                async_graphql::Error::new(format!("token '{token_name}' not found"))
            })?;
            let token_id = existing.id();

            // Derive the token type from the existing token (type cannot change on update).
            let existing_type = existing.token_type();

            // Construct the replacement Token via its validating constructor.
            let new_token = Token::new(
                token_id,
                token_name.clone(),
                token_value,
                existing_type,
                description,
            )
            .map_err(|e| async_graphql::Error::new(format!("invalid token update: {e}")))?;

            Ok(Box::new(UpdateToken {
                new_token,
                token_name,
            }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}

/// Parses a `RemoveToken` input.
#[allow(clippy::unnecessary_wraps)]
fn parse_remove_token(input: &RemoveTokenInput) -> Result<ParsedOp> {
    let token_name = input.name.clone();

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: String::new(),
        op_type: "delete_token".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({ "name": &token_name })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| {
            Ok(Box::new(RemoveToken {
                token_name: token_name.clone(),
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

        // RF-015: validate user_id length
        if user_id.len() > MAX_USER_ID_LEN {
            return Err(async_graphql::Error::new(format!(
                "user_id exceeds maximum length of {MAX_USER_ID_LEN} (got {})",
                user_id.len()
            )));
        }

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

        // RF-007: derive broadcast event kind from the first operation
        let event_kind = match &operations[0] {
            OperationInput::CreateNode(_) => MutationEventKind::NodeCreated,
            OperationInput::DeleteNode(_) => MutationEventKind::NodeDeleted,
            OperationInput::SetField(_)
            | OperationInput::Reparent(_)
            | OperationInput::Reorder(_) => MutationEventKind::NodeUpdated,
            OperationInput::CreatePage(_) => MutationEventKind::PageCreated,
            OperationInput::DeletePage(_) => MutationEventKind::PageDeleted,
            OperationInput::RenamePage(_) | OperationInput::ReorderPage(_) => {
                MutationEventKind::PageUpdated
            }
            OperationInput::AddToken(_) => MutationEventKind::TokenCreated,
            OperationInput::UpdateToken(_) => MutationEventKind::TokenUpdated,
            OperationInput::RemoveToken(_) => MutationEventKind::TokenDeleted,
        };

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
        //
        // RF-001: The batch is atomic — if any operation fails, the document
        // is restored to its pre-batch state via snapshot rollback.
        {
            let mut doc_guard = acquire_document_lock(state);

            // Snapshot the document state for rollback on partial failure
            let snapshot = doc_guard.0.clone();

            for p in parsed {
                let build_result = (p.builder)(&doc_guard);
                let op = match build_result {
                    Ok(op) => op,
                    Err(e) => {
                        doc_guard.0 = snapshot;
                        return Err(e);
                    }
                };
                if let Err(e) = op
                    .validate(&doc_guard)
                    .map_err(|e| async_graphql::Error::new(format!("validation failed: {e}")))
                {
                    doc_guard.0 = snapshot;
                    return Err(e);
                }
                if let Err(e) = op
                    .apply(&mut doc_guard)
                    .map_err(|e| async_graphql::Error::new(format!("apply failed: {e}")))
                {
                    doc_guard.0 = snapshot;
                    return Err(e);
                }
            }
        }

        // Signal dirty + broadcast
        state.app.signal_dirty();
        state.app.publish_transaction(
            event_kind,
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

    /// Helper: creates a Text node directly via the state and returns its UUID string.
    fn create_test_text_direct(state: &ServerState, content: &str) -> String {
        use agent_designer_core::commands::node_commands::CreateNode;
        use agent_designer_core::node::{NodeKind, TextSizing, TextStyle};

        let node_uuid = uuid::Uuid::new_v4();
        let cmd = CreateNode {
            uuid: node_uuid,
            kind: NodeKind::Text {
                content: content.to_string(),
                text_style: TextStyle::default(),
                sizing: TextSizing::AutoWidth,
            },
            name: "Text Node".to_string(),
            page_id: None,
            initial_transform: None,
        };

        let mut doc = state.app.document.lock().unwrap();
        cmd.validate(&doc).expect("create text node validate");
        cmd.apply(&mut doc).expect("create text node apply");
        node_uuid.to_string()
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_kind_content_updates_text() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_text_direct(&state, "Hello");

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind.content", value: "\"World\"" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        // Verify content was updated in the document
        let doc = state.app.document.lock().unwrap();
        let node_uuid: uuid::Uuid = uuid.parse().unwrap();
        let node_id = doc.arena.id_by_uuid(&node_uuid).expect("node exists");
        let node = doc.arena.get(node_id).expect("get node");
        match &node.kind {
            agent_designer_core::node::NodeKind::Text { content, .. } => {
                assert_eq!(content, "World", "text content should be updated");
            }
            _ => panic!("expected Text node"),
        }
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_kind_content_rejects_non_text_node() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "Frame");

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind.content", value: "\"Hello\"" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "kind.content on a non-text node should be rejected"
        );
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_font_size_updates_text_style() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_text_direct(&state, "Hello");

        // font_size as a StyleValue::Literal — serialised as {"type":"literal","value":24.0}
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind.text_style.font_size", value: "{{\"type\":\"literal\",\"value\":24.0}}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        // Verify font_size was updated
        let doc = state.app.document.lock().unwrap();
        let node_uuid: uuid::Uuid = uuid.parse().unwrap();
        let node_id = doc.arena.id_by_uuid(&node_uuid).expect("node exists");
        let node = doc.arena.get(node_id).expect("get node");
        match &node.kind {
            agent_designer_core::node::NodeKind::Text { text_style, .. } => {
                assert_eq!(
                    text_style.font_size,
                    agent_designer_core::node::StyleValue::Literal { value: 24.0 },
                    "font_size should be updated to 24.0"
                );
            }
            _ => panic!("expected Text node"),
        }
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_font_size_rejects_invalid_value() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_text_direct(&state, "Hello");

        // font_size of 0.0 is below MIN_FONT_SIZE (0.1) — must be rejected by core validate()
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind.text_style.font_size", value: "{{\"type\":\"literal\",\"value\":0.0}}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "font_size of 0.0 (below MIN_FONT_SIZE) should be rejected"
        );
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_text_shadow_sets_shadow_on_text_node() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_text_direct(&state, "Hello");

        // Shadow JSON: offset_x=2, offset_y=4, blur_radius=8, color=opaque black literal
        let shadow_json = r#"{\"offset_x\":2.0,\"offset_y\":4.0,\"blur_radius\":8.0,\"color\":{\"type\":\"literal\",\"value\":{\"space\":\"srgb\",\"r\":0.0,\"g\":0.0,\"b\":0.0,\"a\":1.0}}}"#;
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind.text_style.text_shadow", value: "{shadow_json}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        // Verify the shadow was applied to the document.
        let doc = state.app.document.lock().unwrap();
        let node_uuid: uuid::Uuid = uuid.parse().unwrap();
        let node_id = doc.arena.id_by_uuid(&node_uuid).expect("node exists");
        let node = doc.arena.get(node_id).expect("get node");
        match &node.kind {
            agent_designer_core::node::NodeKind::Text { text_style, .. } => {
                let shadow = text_style
                    .text_shadow
                    .as_ref()
                    .expect("text_shadow should be Some after applying");
                assert_eq!(shadow.offset_x(), 2.0);
                assert_eq!(shadow.offset_y(), 4.0);
                assert_eq!(shadow.blur_radius(), 8.0);
            }
            _ => panic!("expected Text node"),
        }
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_text_shadow_null_removes_shadow() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_text_direct(&state, "Hello");

        // First, set a shadow.
        let shadow_json = r#"{\"offset_x\":1.0,\"offset_y\":2.0,\"blur_radius\":3.0,\"color\":{\"type\":\"literal\",\"value\":{\"space\":\"srgb\",\"r\":0.0,\"g\":0.0,\"b\":0.0,\"a\":1.0}}}"#;
        let set_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind.text_style.text_shadow", value: "{shadow_json}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let set_res = schema.execute(&set_query).await;
        assert!(
            set_res.errors.is_empty(),
            "set shadow errors: {:?}",
            set_res.errors
        );

        // Now remove the shadow by passing null.
        let remove_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind.text_style.text_shadow", value: "null" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let remove_res = schema.execute(&remove_query).await;
        assert!(
            remove_res.errors.is_empty(),
            "remove shadow errors: {:?}",
            remove_res.errors
        );

        // Verify shadow is gone.
        let doc = state.app.document.lock().unwrap();
        let node_uuid: uuid::Uuid = uuid.parse().unwrap();
        let node_id = doc.arena.id_by_uuid(&node_uuid).expect("node exists");
        let node = doc.arena.get(node_id).expect("get node");
        match &node.kind {
            agent_designer_core::node::NodeKind::Text { text_style, .. } => {
                assert!(
                    text_style.text_shadow.is_none(),
                    "text_shadow should be None after null operation"
                );
            }
            _ => panic!("expected Text node"),
        }
    }

    #[tokio::test]
    async fn test_apply_operations_set_field_text_shadow_rejects_negative_blur() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_text_direct(&state, "Hello");

        // blur_radius of -1.0 must be rejected by TextShadow::new() inside deserialization.
        let bad_shadow_json = r#"{\"offset_x\":0.0,\"offset_y\":0.0,\"blur_radius\":-1.0,\"color\":{\"type\":\"literal\",\"value\":{\"space\":\"srgb\",\"r\":0.0,\"g\":0.0,\"b\":0.0,\"a\":1.0}}}"#;
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind.text_style.text_shadow", value: "{bad_shadow_json}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "negative blur_radius in text_shadow should be rejected"
        );
    }

    // ── Page operation tests ──────────────────────────────────────────

    #[tokio::test]
    async fn test_apply_operations_create_page_adds_page_to_document() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let page_uuid = uuid::Uuid::new_v4().to_string();
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ createPage: {{ pageUuid: "{page_uuid}", name: "Landing" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let doc = state.app.document.lock().unwrap();
        assert_eq!(doc.pages.len(), 1, "document should have one page");
        assert_eq!(doc.pages[0].name, "Landing");
        assert_eq!(doc.pages[0].id.uuid().to_string(), page_uuid);
    }

    #[tokio::test]
    async fn test_apply_operations_create_page_rejects_empty_name() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let page_uuid = uuid::Uuid::new_v4().to_string();
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ createPage: {{ pageUuid: "{page_uuid}", name: "" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(!res.errors.is_empty(), "empty page name should be rejected");
    }

    #[tokio::test]
    async fn test_apply_operations_rename_page_updates_name() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let page_uuid = uuid::Uuid::new_v4().to_string();
        // Create the page first
        let create_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ createPage: {{ pageUuid: "{page_uuid}", name: "Old Name" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let create_res = schema.execute(&create_query).await;
        assert!(
            create_res.errors.is_empty(),
            "errors: {:?}",
            create_res.errors
        );

        // Rename the page
        let rename_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ renamePage: {{ pageId: "{page_uuid}", newName: "New Name" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let rename_res = schema.execute(&rename_query).await;
        assert!(
            rename_res.errors.is_empty(),
            "errors: {:?}",
            rename_res.errors
        );

        let doc = state.app.document.lock().unwrap();
        assert_eq!(doc.pages[0].name, "New Name");
    }

    #[tokio::test]
    async fn test_apply_operations_reorder_page_moves_page_to_new_position() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let page_a_uuid = uuid::Uuid::new_v4().to_string();
        let page_b_uuid = uuid::Uuid::new_v4().to_string();
        let page_c_uuid = uuid::Uuid::new_v4().to_string();

        // Create three pages
        for (uuid, name) in [
            (&page_a_uuid, "Page A"),
            (&page_b_uuid, "Page B"),
            (&page_c_uuid, "Page C"),
        ] {
            let q = format!(
                r#"mutation {{
                    applyOperations(
                        operations: [{{ createPage: {{ pageUuid: "{uuid}", name: "{name}" }} }}],
                        userId: "test-user"
                    ) {{
                        seq
                    }}
                }}"#
            );
            let r = schema.execute(&q).await;
            assert!(r.errors.is_empty(), "create page errors: {:?}", r.errors);
        }

        // Move Page C (index 2) to position 0
        let reorder_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ reorderPage: {{ pageId: "{page_c_uuid}", newPosition: 0 }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let reorder_res = schema.execute(&reorder_query).await;
        assert!(
            reorder_res.errors.is_empty(),
            "errors: {:?}",
            reorder_res.errors
        );

        let doc = state.app.document.lock().unwrap();
        assert_eq!(doc.pages[0].id.uuid().to_string(), page_c_uuid);
        assert_eq!(doc.pages[1].id.uuid().to_string(), page_a_uuid);
        assert_eq!(doc.pages[2].id.uuid().to_string(), page_b_uuid);
    }

    #[tokio::test]
    async fn test_apply_operations_delete_page_removes_page_from_document() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let page_uuid = uuid::Uuid::new_v4().to_string();
        let keeper_uuid = uuid::Uuid::new_v4().to_string();

        // Create two pages so we can delete one (last-page guard).
        let create_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [
                        {{ createPage: {{ pageUuid: "{keeper_uuid}", name: "Keeper" }} }},
                        {{ createPage: {{ pageUuid: "{page_uuid}", name: "To Delete" }} }}
                    ],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let create_res = schema.execute(&create_query).await;
        assert!(
            create_res.errors.is_empty(),
            "errors: {:?}",
            create_res.errors
        );
        assert_eq!(state.app.document.lock().unwrap().pages.len(), 2);

        // Delete the page
        let delete_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ deletePage: {{ pageId: "{page_uuid}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let delete_res = schema.execute(&delete_query).await;
        assert!(
            delete_res.errors.is_empty(),
            "errors: {:?}",
            delete_res.errors
        );

        let doc = state.app.document.lock().unwrap();
        assert_eq!(
            doc.pages.len(),
            1,
            "document should have one page after delete"
        );
        assert_eq!(doc.pages[0].name, "Keeper");
    }

    #[tokio::test]
    async fn test_apply_operations_delete_page_rejects_nonexistent_page() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let bad_uuid = uuid::Uuid::new_v4().to_string();
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ deletePage: {{ pageId: "{bad_uuid}" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "deleting nonexistent page should fail"
        );
    }

    #[tokio::test]
    async fn test_apply_operations_reorder_page_rejects_out_of_range_position() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let page_uuid = uuid::Uuid::new_v4().to_string();
        // Create one page
        let create_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ createPage: {{ pageUuid: "{page_uuid}", name: "Solo" }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        schema.execute(&create_query).await;

        // Position 5 is out of range for a 1-page document (valid: 0..0)
        let reorder_query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ reorderPage: {{ pageId: "{page_uuid}", newPosition: 5 }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&reorder_query).await;
        assert!(
            !res.errors.is_empty(),
            "out-of-range position should be rejected"
        );
    }

    #[tokio::test]
    async fn test_apply_operations_create_page_rejects_invalid_uuid() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let query = r#"mutation {
            applyOperations(
                operations: [{ createPage: { pageUuid: "not-a-uuid", name: "Page" } }],
                userId: "test-user"
            ) {
                seq
            }
        }"#;
        let res = schema.execute(query).await;
        assert!(
            !res.errors.is_empty(),
            "invalid page UUID should be rejected"
        );
    }

    // ── Token mutation tests ─────────────────────────────────────────────

    #[tokio::test]
    async fn test_add_token_via_apply_operations() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let token_uuid = uuid::Uuid::new_v4().to_string();
        let value_json = r#"{\"type\":\"number\",\"value\":42.0}"#;

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{
                        addToken: {{
                            tokenUuid: "{token_uuid}",
                            name: "spacing.md",
                            tokenType: "number",
                            value: "{value_json}"
                        }}
                    }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "add token errors: {:?}", res.errors);

        // Verify the token exists in the document.
        let doc = state.app.document.lock().unwrap();
        assert!(
            doc.token_context.get("spacing.md").is_some(),
            "token 'spacing.md' should exist after addToken"
        );
    }

    #[tokio::test]
    async fn test_update_token_via_apply_operations() {
        use agent_designer_core::commands::token_commands::AddToken as CoreAddToken;
        use agent_designer_core::id::TokenId;
        use agent_designer_core::node::Color;
        use agent_designer_core::token::{Token, TokenType, TokenValue};

        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // Seed a color token directly.
        {
            let mut doc = state.app.document.lock().unwrap();
            let token = Token::new(
                TokenId::new(uuid::Uuid::new_v4()),
                "color.brand".to_string(),
                TokenValue::Color {
                    value: Color::default(),
                },
                TokenType::Color,
                None,
            )
            .expect("valid token");
            let op = CoreAddToken { token };
            op.validate(&doc).expect("validate");
            op.apply(&mut doc).expect("apply");
        }

        // Update it to a new value (Color uses serde tag = "space", rename_all = "snake_case").
        let new_value_json = r#"{\"type\":\"color\",\"value\":{\"space\":\"srgb\",\"r\":1.0,\"g\":0.0,\"b\":0.0,\"a\":1.0}}"#;
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{
                        updateToken: {{
                            name: "color.brand",
                            value: "{new_value_json}"
                        }}
                    }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            res.errors.is_empty(),
            "update token errors: {:?}",
            res.errors
        );
    }

    #[tokio::test]
    async fn test_remove_token_via_apply_operations() {
        use agent_designer_core::commands::token_commands::AddToken as CoreAddToken;
        use agent_designer_core::id::TokenId;
        use agent_designer_core::node::Color;
        use agent_designer_core::token::{Token, TokenType, TokenValue};

        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // Seed a token.
        {
            let mut doc = state.app.document.lock().unwrap();
            let token = Token::new(
                TokenId::new(uuid::Uuid::new_v4()),
                "color.accent".to_string(),
                TokenValue::Color {
                    value: Color::default(),
                },
                TokenType::Color,
                None,
            )
            .expect("valid token");
            let op = CoreAddToken { token };
            op.validate(&doc).expect("validate");
            op.apply(&mut doc).expect("apply");
        }

        let query = r#"mutation {
            applyOperations(
                operations: [{ removeToken: { name: "color.accent" } }],
                userId: "test-user"
            ) {
                seq
            }
        }"#;
        let res = schema.execute(query).await;
        assert!(
            res.errors.is_empty(),
            "remove token errors: {:?}",
            res.errors
        );

        let doc = state.app.document.lock().unwrap();
        assert!(
            doc.token_context.get("color.accent").is_none(),
            "token 'color.accent' should be gone after removeToken"
        );
    }

    #[tokio::test]
    async fn test_add_token_duplicate_name_rejected() {
        use agent_designer_core::commands::token_commands::AddToken as CoreAddToken;
        use agent_designer_core::id::TokenId;
        use agent_designer_core::node::Color;
        use agent_designer_core::token::{Token, TokenType, TokenValue};

        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // Seed a token first.
        {
            let mut doc = state.app.document.lock().unwrap();
            let token = Token::new(
                TokenId::new(uuid::Uuid::new_v4()),
                "color.primary".to_string(),
                TokenValue::Color {
                    value: Color::default(),
                },
                TokenType::Color,
                None,
            )
            .expect("valid token");
            let op = CoreAddToken { token };
            op.validate(&doc).expect("validate");
            op.apply(&mut doc).expect("apply");
        }

        // Attempt to add again with same name — should fail.
        let token_uuid = uuid::Uuid::new_v4().to_string();
        // Color uses serde tag = "space", rename_all = "snake_case".
        let value_json = r#"{\"type\":\"color\",\"value\":{\"space\":\"srgb\",\"r\":0.0,\"g\":0.0,\"b\":0.0,\"a\":1.0}}"#;
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{
                        addToken: {{
                            tokenUuid: "{token_uuid}",
                            name: "color.primary",
                            tokenType: "color",
                            value: "{value_json}"
                        }}
                    }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "duplicate token name should be rejected"
        );
    }

    #[tokio::test]
    async fn test_remove_nonexistent_token_rejected() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let query = r#"mutation {
            applyOperations(
                operations: [{ removeToken: { name: "does.not.exist" } }],
                userId: "test-user"
            ) {
                seq
            }
        }"#;
        let res = schema.execute(query).await;
        assert!(
            !res.errors.is_empty(),
            "removing nonexistent token should be rejected"
        );
    }

    #[tokio::test]
    async fn test_add_token_invalid_type_string_rejected() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let token_uuid = uuid::Uuid::new_v4().to_string();
        let value_json = r#"{\"type\":\"number\",\"value\":1.0}"#;
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{
                        addToken: {{
                            tokenUuid: "{token_uuid}",
                            name: "spacing.sm",
                            tokenType: "not_a_real_type",
                            value: "{value_json}"
                        }}
                    }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "unknown token type should be rejected"
        );
    }
}
