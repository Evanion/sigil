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

use async_graphql::{Context, ID, Object, Result};

use sigil_core::FieldOperation;
use sigil_core::PageId;
use sigil_core::commands::node_commands::{
    CreateNode, DeleteNodes, RenameNode, SetLocked, SetTextContent, SetVisible,
};
use sigil_core::commands::page_commands::{CreatePage, DeletePage, RenamePage, ReorderPage};
use sigil_core::commands::style_commands::validate_transform;
use sigil_core::commands::style_commands::{
    SetBlendMode, SetCorners, SetEffects, SetFills, SetOpacity, SetStrokes, SetTransform,
};
use sigil_core::commands::text_style_commands::{SetTextStyleField, TextStyleField};
use sigil_core::commands::token_commands::{AddToken, RemoveToken, RenameToken, UpdateToken};
use sigil_core::commands::tree_commands::{ReorderChildren, ReparentNode};
use sigil_core::id::TokenId;
use sigil_core::node::{
    BlendMode, Color, Effect, Fill, FontStyle, NodeKind, Stroke, StyleValue, TextAlign,
    TextDecoration, TextShadow, Transform,
};
use sigil_core::tokens::{Token, TokenValue};
use sigil_core::validate::{
    MAX_BATCH_SIZE, MAX_EFFECTS_PER_STYLE, MAX_FIELD_VALUE_SIZE, MAX_FILLS_PER_STYLE,
    MAX_STROKES_PER_STYLE, MAX_USER_ID_LEN, validate_floats_in_value,
};
use sigil_state::sessions::{DocumentSession, SessionEvent, SessionState};
use sigil_state::{MutationEvent, MutationEventKind, OperationPayload, TransactionPayload};

use crate::session_header::RequestSession;
use crate::state::{ServerState, SessionId};

use super::session::{GqlSessionInfo, derive_title};
use super::types::{
    AddTokenInput, ApplyOperationsResult, CreateNodeInput, CreatePageInput, DeleteNodesInput,
    DeletePageInput, OperationInput, RemoveTokenInput, RenamePageInput, RenameTokenInput,
    ReorderInput, ReorderPageInput, ReparentInput, SetFieldInput, UpdateTokenInput,
    parse_token_type,
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

/// Resolves the [`SessionId`] for the current GraphQL request.
///
/// Reads the [`RequestSession`] populated by [`crate::session_header::middleware`]
/// from the async-graphql request context. Falls back to
/// [`crate::state::App::default_session_id`] when the request has no header,
/// preserving compatibility with single-document deployments that have not yet
/// adopted the multi-session client.
///
/// Returns `SESSION_REQUIRED` when neither a header nor a default session id
/// is available — this indicates the server was started without a workfile and
/// the client did not open a session explicitly (Task 6 adds `openSession`).
fn resolve_session(ctx: &Context<'_>, state: &ServerState) -> Result<SessionId> {
    // `RequestSession` is only present for HTTP requests routed through the
    // middleware. WebSocket-originated mutations (none today) and tests that
    // bypass the router both fall through to `Ok(RequestSession(None))`.
    let header_session = ctx.data::<RequestSession>().map(|rs| rs.0).unwrap_or(None);

    if let Some(id) = header_session {
        return Ok(id);
    }
    state.app.default_session_id().ok_or_else(|| {
        async_graphql::Error::new(
            "SESSION_REQUIRED: provide X-Sigil-Session header or open a workfile session",
        )
    })
}

/// Loads a session by id, returning a typed error if it is missing or in
/// the `Errored` state.
fn require_live_session(
    state: &ServerState,
    session_id: SessionId,
) -> Result<std::sync::Arc<DocumentSession>> {
    let session = state
        .app
        .sessions
        .get(session_id)
        .ok_or_else(|| async_graphql::Error::new(format!("SESSION_NOT_FOUND: {session_id}")))?;

    let st = match session.state.lock() {
        Ok(g) => *g,
        Err(p) => *p.into_inner(),
    };
    if st == SessionState::Errored {
        return Err(async_graphql::Error::new(format!(
            "SESSION_ERRORED: {session_id}"
        )));
    }
    Ok(session)
}

// ── applyOperations helpers ──────────────────────────────────────────

/// A parsed operation ready for UUID resolution, validation, and application.
///
/// The `builder` closure captures the parsed input data and constructs the
/// appropriate `FieldOperation` struct after UUID-to-NodeId resolution
/// (which requires the document lock).
///
/// Most operations build their broadcast payload eagerly from the input
/// JSON (see `broadcast`). For operations whose canonical wire-format
/// differs from the user input — currently only `SetField` on `path = "kind"`,
/// where the user may submit the shorthand corners form — `post_apply_value`
/// is set to a closure that produces the canonical post-apply value from
/// the document AFTER `apply()` has succeeded. The caller in
/// `apply_operations` invokes this closure under the same lock acquisition
/// and replaces `broadcast.value` with its result before publishing.
///
/// Per `.claude/rules/rust-defensive.md` "Side-Effect Artifacts Must Be
/// Constructed After Precondition Verification", this defers the
/// kind-path payload construction until after validation+apply have been
/// confirmed. This addresses RF-001 (frontend dispatcher rejected raw
/// shorthand) and partially addresses RF-004 (other paths still build
/// their broadcast value eagerly because their input shape already
/// matches what `frontend/src/operations/apply-remote.ts` expects).
struct ParsedOp {
    /// Builds the `FieldOperation` after UUID→NodeId resolution inside the lock.
    ///
    /// Both this closure and the produced `FieldOperation` are required to be
    /// `Send` because `apply_operations` holds a `Vec<ParsedOp>` across the
    /// `session.store.write().await` point — async-graphql's resolver
    /// futures must be `Send`. All concrete `FieldOperation` impls in
    /// `sigil-core` are `Send` (they contain only ids, primitives, and
    /// owned data), so this bound is satisfied at every construction site
    /// below.
    #[allow(clippy::type_complexity)]
    builder:
        Box<dyn FnOnce(&sigil_core::Document) -> Result<Box<dyn FieldOperation + Send>> + Send>,
    /// The broadcast payload for this operation. For paths whose input shape
    /// already matches the frontend dispatcher's expected `value` shape, this
    /// is built eagerly from the input JSON. For paths that need a canonical
    /// post-apply representation (e.g. `kind` with shorthand corners),
    /// `broadcast.value` is overwritten with the result of `post_apply_value`
    /// after `apply()` succeeds.
    broadcast: OperationPayload,
    /// Optional builder that produces the canonical broadcast `value` from
    /// the post-apply document. Required when the user-input shape differs
    /// from the frontend dispatcher's expected wire format.
    #[allow(clippy::type_complexity)]
    post_apply_value:
        Option<Box<dyn FnOnce(&sigil_core::Document) -> Result<serde_json::Value> + Send>>,
}

/// Parses all operation inputs into `ParsedOp` structs.
///
/// This does not require the document lock — it validates input formats and
/// deserializes JSON values, but defers UUID→NodeId resolution to the lock scope.
fn parse_operation_input(input: &OperationInput) -> Result<ParsedOp> {
    match input {
        OperationInput::SetField(sf) => parse_set_field(sf),
        OperationInput::CreateNode(cn) => parse_create_node(cn),
        OperationInput::DeleteNodes(dn) => parse_delete_nodes(dn),
        OperationInput::Reparent(rp) => parse_reparent(rp),
        OperationInput::Reorder(ro) => parse_reorder(ro),
        OperationInput::CreatePage(cp) => parse_create_page(cp),
        OperationInput::DeletePage(dp) => parse_delete_page(dp),
        OperationInput::RenamePage(rp) => parse_rename_page(rp),
        OperationInput::ReorderPage(ro) => parse_reorder_page(ro),
        OperationInput::AddToken(at) => parse_add_token(at),
        OperationInput::UpdateToken(ut) => parse_update_token(ut),
        OperationInput::RemoveToken(rt) => parse_remove_token(rt),
        OperationInput::RenameToken(rt) => parse_rename_token(rt),
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    Ok(Box::new(RenameNode { node_id, new_name })
                        as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    Ok(Box::new(SetFills { node_id, new_fills }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
            })
        }
        "kind" => {
            // Value must be: { "type": "<kind>", "corners": <corners-input> }
            // where <corners-input> is accepted by parse_corners_input (object or array).
            let kind_type = value
                .get("type")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| async_graphql::Error::new("kind value must include 'type' field"))?;
            match kind_type {
                "rectangle" | "frame" | "image" => {
                    let corners_value = value.get("corners").ok_or_else(|| {
                        async_graphql::Error::new(format!(
                            "{kind_type} kind value must include 'corners' field"
                        ))
                    })?;
                    let new_corners = sigil_core::corners_input::parse_corners_input(corners_value)
                        .map_err(|e| async_graphql::Error::new(format!("{e}")))?;
                    // RF-001 / RF-004: the broadcast `value` for `path = "kind"`
                    // must be the canonical post-apply `NodeKind` JSON (mirroring
                    // `set_corners_impl` in `crates/mcp/src/tools/nodes.rs`).
                    // The user may submit shorthand corners input
                    // (`{shape:"round", radius:N}`), but `apply-remote.ts` case
                    // `"kind"` requires the canonical 4-element corners array.
                    // We defer broadcast value construction until after `apply()`
                    // succeeds and read it from the post-apply node.
                    Ok(ParsedOp {
                        builder: Box::new(move |doc| {
                            let node_id = doc
                                .arena
                                .id_by_uuid(&parsed_uuid)
                                .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                            Ok(Box::new(SetCorners {
                                node_id,
                                new_corners,
                            })
                                as Box<dyn FieldOperation + Send>)
                        }),
                        broadcast,
                        post_apply_value: Some(Box::new(move |doc| {
                            let node_id = doc.arena.id_by_uuid(&parsed_uuid).ok_or_else(|| {
                                async_graphql::Error::new("node not found after apply")
                            })?;
                            let node = doc.arena.get(node_id).map_err(|e| {
                                async_graphql::Error::new(format!(
                                    "failed to read post-apply node: {e}"
                                ))
                            })?;
                            serde_json::to_value(&node.kind).map_err(|e| {
                                async_graphql::Error::new(format!(
                                    "failed to serialise post-apply kind: {e}"
                                ))
                            })
                        })),
                    })
                }
                // Explicitly enumerate the non-corner-bearing variants so that
                // adding a new variant in core forces a compile error here once
                // a corresponding string is added (RF-014). The wildcard arm
                // remains as a guard against malformed (unknown) `type` values
                // — it is unreachable for known v2 kinds.
                "ellipse" | "path" | "text" | "group" | "component_instance" => {
                    Err(async_graphql::Error::new(format!(
                        "kind type '{kind_type}' does not carry corners; \
                         SetField on path 'kind' is only supported for \
                         rectangle, frame, and image"
                    )))
                }
                other => Err(async_graphql::Error::new(format!(
                    "kind type '{other}' is not a known node kind"
                ))),
            }
        }
        "kind.content" => {
            if let Some(s) = value.as_str()
                && s.len() > sigil_core::validate::MAX_TEXT_CONTENT_LEN
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
            })
        }
        "kind.text_style.font_family" => {
            let font_family: String = serde_json::from_value(value)
                .map_err(|e| async_graphql::Error::new(format!("invalid font_family: {e}")))?;
            if font_family.is_empty() {
                return Err(async_graphql::Error::new("font_family must not be empty"));
            }
            if font_family.len() > sigil_core::validate::MAX_FONT_FAMILY_LEN {
                return Err(async_graphql::Error::new(format!(
                    "font_family exceeds max length of {}",
                    sigil_core::validate::MAX_FONT_FAMILY_LEN
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
                    }) as Box<dyn FieldOperation + Send>)
                }),
                broadcast,
                post_apply_value: None,
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
            }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
    })
}

/// Parses a `DeleteNodes` input (Spec 19). Resolves each UUID to a `NodeId`
/// and looks up the page-root membership for each node, then produces a
/// single core [`DeleteNodes`] op that applies atomically across N targets.
fn parse_delete_nodes(dn: &DeleteNodesInput) -> Result<ParsedOp> {
    // RF-005: Reject empty/oversize batches BEFORE allocating the
    // parsed-UUIDs vec. This prevents memory amplification from a giant
    // request body that would otherwise allocate proportional to the input
    // size before validate() fires. Core's `DeleteNodes::validate` also
    // enforces these bounds (single source of truth) but the wire layer
    // must short-circuit first to bound allocation.
    if dn.node_uuids.is_empty() {
        return Err(async_graphql::Error::new("delete_nodes: empty batch"));
    }
    if dn.node_uuids.len() > sigil_core::validate::MAX_NODES_PER_DELETE_BATCH {
        return Err(async_graphql::Error::new(format!(
            "delete_nodes: batch of {} exceeds MAX_NODES_PER_DELETE_BATCH ({})",
            dn.node_uuids.len(),
            sigil_core::validate::MAX_NODES_PER_DELETE_BATCH,
        )));
    }

    // Pre-parse every UUID outside the builder closure to fail-fast on
    // invalid input before any document lock is acquired (RF-030 pattern).
    let parsed_uuids: Vec<uuid::Uuid> = dn
        .node_uuids
        .iter()
        .map(|s| {
            s.parse::<uuid::Uuid>()
                .map_err(|_| async_graphql::Error::new(format!("invalid node UUID: {s}")))
        })
        .collect::<Result<Vec<_>>>()?;

    // RF-020/036: Build broadcast value with canonicalized UUID strings
    // (lowercase hyphenated form from `Uuid::to_string()`) regardless of
    // the input style. We forward all originally-requested UUIDs (not the
    // dedup-retained set produced by core's `apply`) because the frontend
    // `applyDeleteNodes` walks the local subtree from each broadcast root
    // and is tolerant of "uuid already deleted" — descendants that core's
    // dedup dropped are removed by the local walk anyway. The full
    // post-mutation canonicalization is documented as a known limitation
    // of this transport: the `ParsedOp` broadcast is built pre-apply, and
    // the frontend's tolerant apply path makes the dedup-retained-list
    // refinement low-value.
    let canonicalized_uuids: Vec<String> = parsed_uuids.iter().map(uuid::Uuid::to_string).collect();
    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        // Batch op: no single targeted UUID. The full list is in `value`.
        node_uuid: String::new(),
        op_type: "delete_nodes".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({ "node_uuids": canonicalized_uuids })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            // RF-022: Pre-build a NodeId -> PageId map once, then look up
            // each target in O(1). Previous code did O(P * R) per target,
            // for a total O(N * P * R) batch cost.
            let mut node_to_page: std::collections::HashMap<sigil_core::id::NodeId, PageId> =
                std::collections::HashMap::new();
            for page in &doc.pages {
                for nid in &page.root_nodes {
                    node_to_page.insert(*nid, page.id);
                }
            }

            let mut targets: Vec<(sigil_core::id::NodeId, Option<PageId>)> =
                Vec::with_capacity(parsed_uuids.len());
            for uuid in &parsed_uuids {
                let node_id = doc
                    .arena
                    .id_by_uuid(uuid)
                    .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))?;
                let page_id = node_to_page.get(&node_id).copied();
                targets.push((node_id, page_id));
            }
            Ok(Box::new(DeleteNodes { targets }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
            }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
            }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
            Ok(Box::new(CreatePage { page_id, name }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
            Ok(Box::new(DeletePage { page_id }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
            Ok(Box::new(RenamePage { page_id, new_name }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
            }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
    let token_type_val = serde_json::to_value(token.token_type())
        .map_err(|e| async_graphql::Error::new(format!("failed to serialize token type: {e}")))?;
    let token_value_val = serde_json::to_value(token.value())
        .map_err(|e| async_graphql::Error::new(format!("failed to serialize token value: {e}")))?;
    let description_val = serde_json::to_value(token.description())
        .map_err(|e| async_graphql::Error::new(format!("failed to serialize description: {e}")))?;
    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: token_uuid.to_string(),
        op_type: "create_token".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "id": token_uuid.to_string(),
            "name": &token_name,
            "token_type": token_type_val,
            "value": token_value_val,
            "description": description_val,
        })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| {
            Ok(Box::new(AddToken { token }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
    let token_value_val = serde_json::to_value(&token_value)
        .map_err(|e| async_graphql::Error::new(format!("failed to serialize token value: {e}")))?;
    let description_val = serde_json::to_value(&description)
        .map_err(|e| async_graphql::Error::new(format!("failed to serialize description: {e}")))?;

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: String::new(),
        op_type: "update_token".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "name": &token_name,
            "value": token_value_val,
            "description": description_val,
        })),
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
            }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
            }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
    })
}

/// Parses a `RenameToken` input.
#[allow(clippy::unnecessary_wraps)]
fn parse_rename_token(input: &RenameTokenInput) -> Result<ParsedOp> {
    let old_name = input.old_name.clone();
    let new_name = input.new_name.clone();

    // Build broadcast payload eagerly (CLAUDE.md: broadcast payload shape contract).
    // The token's stable UUID is resolved inside the builder closure after lock acquisition,
    // so we construct the broadcast here with old_name/new_name and patch the id in the builder.
    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: String::new(),
        op_type: "rename_token".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({
            "old_name": &old_name,
            "new_name": &new_name,
        })),
    };

    Ok(ParsedOp {
        builder: Box::new(move |_doc| {
            Ok(Box::new(RenameToken { old_name, new_name }) as Box<dyn FieldOperation + Send>)
        }),
        broadcast,
        post_apply_value: None,
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
            OperationInput::DeleteNodes(_) => MutationEventKind::NodeDeleted,
            OperationInput::SetField(_)
            | OperationInput::Reparent(_)
            | OperationInput::Reorder(_) => MutationEventKind::NodeUpdated,
            OperationInput::CreatePage(_) => MutationEventKind::PageCreated,
            OperationInput::DeletePage(_) => MutationEventKind::PageDeleted,
            OperationInput::RenamePage(_) | OperationInput::ReorderPage(_) => {
                MutationEventKind::PageUpdated
            }
            OperationInput::AddToken(_) => MutationEventKind::TokenCreated,
            OperationInput::UpdateToken(_) | OperationInput::RenameToken(_) => {
                MutationEventKind::TokenUpdated
            }
            OperationInput::RemoveToken(_) => MutationEventKind::TokenDeleted,
        };

        // Resolve the target session BEFORE parsing or locking. Reads
        // X-Sigil-Session via the middleware-populated `RequestSession`,
        // falling back to the registry's default session id for clients
        // that have not yet adopted multi-session.
        let session_id = resolve_session(ctx, state)?;
        let session = require_live_session(state, session_id)?;

        // First pass: parse all inputs (no lock needed).
        // This validates JSON formats, deserializes typed values, and checks
        // domain constraints (float ranges, path validity, etc.).
        let mut parsed: Vec<ParsedOp> = Vec::with_capacity(operations.len());
        for op_input in &operations {
            parsed.push(parse_operation_input(op_input)?);
        }

        // Second pass: build, validate, and apply sequentially under lock.
        // UUID→NodeId resolution happens inside the lock scope.
        // Operations are applied sequentially because later operations may
        // depend on earlier ones (e.g., create node then reparent it).
        //
        // RF-001: The batch is atomic — if any operation fails, the document
        // is restored to its pre-batch state via snapshot rollback.
        //
        // RF-001 / RF-004: broadcast payloads for paths whose canonical
        // wire-format differs from the user input (currently `path = "kind"`
        // with shorthand corners) are produced from the post-apply document
        // via `post_apply_value`. All broadcast payloads are collected AFTER
        // their corresponding apply has succeeded, so a failed batch never
        // emits a partial broadcast.
        //
        // Spec 20: Mutations route through the per-session document store
        // (`session.store`) rather than the legacy `AppState.document`. We
        // mirror the post-apply state back to the legacy store after the
        // batch succeeds so that (a) the persistence task still reads the
        // authoritative document, and (b) MCP tools that have not yet been
        // migrated continue to see consistent state. The legacy mirror is
        // dropped entirely once MCP migrates (Tasks 8–10).
        let broadcast_ops: Vec<OperationPayload> = {
            let mut doc_guard = session.store.write().await;

            // Snapshot the document state for rollback on partial failure
            let snapshot = doc_guard.0.clone();

            let mut collected: Vec<OperationPayload> = Vec::with_capacity(parsed.len());

            for p in parsed {
                let ParsedOp {
                    builder,
                    mut broadcast,
                    post_apply_value,
                } = p;

                let build_result = builder(&doc_guard);
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

                // After apply succeeds, overwrite broadcast.value with the
                // canonical post-apply representation if one was registered.
                if let Some(post_apply_value) = post_apply_value {
                    match post_apply_value(&doc_guard) {
                        Ok(canonical) => broadcast.value = Some(canonical),
                        Err(e) => {
                            doc_guard.0 = snapshot;
                            return Err(e);
                        }
                    }
                }

                collected.push(broadcast);
            }

            // Mirror the post-apply session document to the legacy store so
            // persistence (which reads `state.app.legacy.document`) and any
            // un-migrated MCP tools observe the same state. This is a
            // transitional bridge — Tasks 8–10 remove the legacy store and
            // this mirror with it.
            //
            // We hold both locks in a strict order (session.store write
            // already acquired above; legacy mutex acquired here) to avoid
            // any future TOCTOU between the apply and the mirror.
            {
                let mut legacy = match state.app.legacy.document.lock() {
                    Ok(g) => g,
                    Err(p) => {
                        tracing::error!("legacy document mutex poisoned during mirror, recovering");
                        p.into_inner()
                    }
                };
                legacy.0 = doc_guard.0.clone();
            }

            collected
        };

        // Signal dirty + broadcast.
        //
        // The transaction payload is assigned a sequence number from the
        // (legacy) per-app counter and broadcast on TWO channels:
        //
        // 1. `session.broadcast` — the per-session channel that
        //    `subscription.rs` migrates to in this task. New subscribers
        //    receive `SessionEvent::DocumentEvent(...)` here.
        // 2. `state.app.legacy.event_tx` via `publish_transaction` — kept
        //    for any subscribers / tests still on the legacy channel during
        //    the Spec 20 migration window. Dropped together with the legacy
        //    store in Tasks 8–10.
        state.app.signal_dirty();

        let mut transaction = multi_op_transaction(Some(user_id), broadcast_ops);
        transaction.seq = state.app.next_seq();

        let mutation_event = MutationEvent {
            kind: event_kind,
            uuid: None,
            data: None,
            transaction: Some(transaction.clone()),
        };

        // Per-session broadcast: fire-and-forget. No subscribers is not an
        // error.
        let _ = session
            .broadcast
            .send(SessionEvent::DocumentEvent(mutation_event.clone()));

        // Legacy broadcast: also fire-and-forget. `publish_transaction`
        // would re-assign seq, so we use the lower-level `event_tx` path
        // directly to preserve the seq we already assigned above.
        if let Some(tx) = state.app.legacy.event_tx() {
            let _ = tx.send(mutation_event);
        }

        let seq = transaction.seq;
        Ok(ApplyOperationsResult {
            seq: seq.to_string(),
        })
    }

    /// Open a session for the given workfile path.
    ///
    /// Spec 20 §2.2: callable WITHOUT the `X-Sigil-Session` header. This
    /// mutation is how clients bootstrap a session before issuing
    /// header-gated mutations.
    ///
    /// Idempotent: opening the same canonical path twice returns the same
    /// [`sigil_state::SessionId`]. Errors map to typed GraphQL errors:
    ///
    /// - `INVALID_WORKFILE_PATH` — path is not a `.sigil/` directory or
    ///   could not be canonicalized.
    /// - `LOAD_FAILED` — manifest/page deserialization or schema-version
    ///   check failed inside [`crate::workfile::load_workfile`].
    ///
    /// Note: the `path` argument is validated by [`sigil_state::Sessions::open`]
    /// — it MUST resolve to an existing directory whose extension is
    /// `.sigil`. This mirrors the Rust-side check; the frontend MUST NOT
    /// rely on optimistic-path conventions and must call this mutation.
    async fn open_session(&self, ctx: &Context<'_>, path: String) -> Result<GqlSessionInfo> {
        let state = ctx.data::<ServerState>()?;
        let path_buf = std::path::PathBuf::from(&path);

        // Bridge the async `load_workfile` to the synchronous loader closure
        // `Sessions::open` expects (Task 3 deliverable). The closure runs on
        // a tokio worker thread and uses `block_in_place` internally; the
        // server uses the multi-thread runtime so this is sound.
        let loader =
            |p: &std::path::Path| -> std::result::Result<sigil_core::Document, anyhow::Error> {
                crate::workfile::load_workfile_sync(p)
            };

        let id = state.app.sessions.open(&path_buf, loader).map_err(|e| {
            // Map registry errors to typed GraphQL error codes so clients can
            // distinguish "bad path" from "load failed" without parsing
            // strings. Mirrors the error taxonomy in spec 20 §A — Validation
            // & Errors.
            use sigil_state::SessionsError as E;
            let code = match &e {
                E::InvalidWorkfilePath(_) | E::PathError(_) => "INVALID_WORKFILE_PATH",
                E::LoadFailed(_) => "LOAD_FAILED",
                E::SessionNotFound(_) | E::SessionErrored => "INTERNAL",
            };
            error_with_code(&format!("openSession: {e}"), code)
        })?;

        let session = state.app.sessions.get(id).ok_or_else(|| {
            // Theoretically unreachable — `open` either inserts or returns
            // an existing id, and the registry is single-process. Surfacing
            // as an error rather than panicking keeps the GraphQL contract
            // honest.
            error_with_code(
                "openSession: registry returned an id with no matching session",
                "INTERNAL",
            )
        })?;

        let state_now = match session.state.lock() {
            Ok(g) => *g,
            Err(poison) => *poison.into_inner(),
        };

        Ok(GqlSessionInfo {
            id: ID(session.id.to_string()),
            workfile_path: session.workfile_path.to_string_lossy().into_owned(),
            title: derive_title(&session.workfile_path),
            // Task 17 will populate this with a real ISO-8601 timestamp.
            opened_at: String::new(),
            state: state_now.into(),
        })
    }

    /// Close an open session.
    ///
    /// Spec 20 §2.2: callable WITHOUT the `X-Sigil-Session` header. The
    /// Tauri shell calls this when the last window mapped to a session
    /// closes; standalone clients (web demo) may also use it to release
    /// session state.
    ///
    /// Returns `true` on success. Returns a typed `SESSION_NOT_FOUND`
    /// error if `id` does not match an open session — close is not
    /// idempotent. Clients that may close concurrently must treat
    /// `SESSION_NOT_FOUND` as a success outcome at the application layer.
    async fn close_session(&self, ctx: &Context<'_>, id: ID) -> Result<bool> {
        let state = ctx.data::<ServerState>()?;
        let session_id: SessionId = id.0.parse().map_err(|e| {
            error_with_code(
                &format!("closeSession: invalid session id: {e}"),
                "INVALID_SESSION_ID",
            )
        })?;
        state.app.sessions.close(session_id).map_err(|e| {
            let code = match &e {
                sigil_state::SessionsError::SessionNotFound(_) => "SESSION_NOT_FOUND",
                _ => "INTERNAL",
            };
            error_with_code(&format!("closeSession: {e}"), code)
        })?;
        Ok(true)
    }
}

/// Build an `async_graphql::Error` with an `extensions.code` field set.
///
/// Spec 20 §A specifies a closed taxonomy of error codes for session
/// operations (`INVALID_WORKFILE_PATH`, `LOAD_FAILED`, `SESSION_NOT_FOUND`,
/// `INVALID_SESSION_ID`). Centralizing the extension-building keeps every
/// resolver consistent.
fn error_with_code(message: &str, code: &str) -> async_graphql::Error {
    let mut err = async_graphql::Error::new(message.to_string());
    let mut ext = async_graphql::ErrorExtensionValues::default();
    ext.set("code", code);
    err.extensions = Some(ext);
    err
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{EmptySubscription, Schema};

    /// Builds a test schema with the given `ServerState`.
    fn test_schema(
        state: ServerState,
    ) -> Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription> {
        // Inject `RequestSession(None)` so resolvers fall back to the
        // registry's default session id. The default is registered by
        // `ServerState::new()` via the in-memory session.
        Schema::build(
            super::super::query::QueryRoot,
            MutationRoot,
            EmptySubscription,
        )
        .data(state)
        .data(RequestSession(None))
        .finish()
    }

    /// Applies a closure to the document held in BOTH the session store
    /// (mutated by GraphQL `apply_operations`) and the legacy
    /// `AppState.document` (read by tests for verification and by
    /// persistence). Keeps the two stores consistent for tests that
    /// pre-seed data outside the GraphQL apply path.
    fn apply_to_session_and_legacy<F, R>(state: &ServerState, f: F) -> R
    where
        F: FnOnce(&mut sigil_core::Document) -> R,
    {
        let session_id = state.app.default_session_id().expect("default session id");
        let session = state
            .app
            .sessions
            .get(session_id)
            .expect("default session registered");

        // Use blocking_write because tests run inside `tokio::test` but
        // these helpers are sync. `RwLock::blocking_write` only works on
        // a multi-threaded runtime — `#[tokio::test]` uses the
        // single-threaded runtime by default, so we instead use a
        // try-loop guarded by a never-contended invariant: tests do not
        // run concurrent mutations on the same store. A single-attempt
        // `try_write` is sufficient.
        let mut session_doc = session
            .store
            .try_write()
            .expect("test session lock uncontended");
        let result = f(&mut session_doc.0);

        // Mirror to legacy.document so reads via `state.app.document.lock()`
        // see the same state.
        let mut legacy_doc = state.app.document.lock().expect("legacy lock");
        legacy_doc.0 = session_doc.0.clone();

        result
    }

    /// Helper: creates a frame node directly via the state and returns its UUID string.
    ///
    /// Uses the core engine directly rather than going through GraphQL,
    /// to avoid escaping complexity in test setup.
    fn create_test_frame_direct(state: &ServerState, name: &str) -> String {
        use sigil_core::commands::node_commands::CreateNode;
        use sigil_core::node::NodeKind;

        let node_uuid = uuid::Uuid::new_v4();
        let cmd = CreateNode {
            uuid: node_uuid,
            kind: NodeKind::Frame {
                layout: None,
                corners: sigil_core::node::default_corners(),
            },
            name: name.to_string(),
            page_id: None,
            initial_transform: None,
        };

        apply_to_session_and_legacy(state, |doc| {
            cmd.validate(doc).expect("create node validate");
            cmd.apply(doc).expect("create node apply");
        });
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
        // NodeKind::Frame now requires corners — serialize the full kind JSON and escape
        // it for embedding as a GraphQL string argument (all double-quotes become \").
        let frame_kind = serde_json::json!({
            "type": "frame",
            "layout": null,
            "corners": [
                {"type": "round", "radii": {"x": 0, "y": 0}},
                {"type": "round", "radii": {"x": 0, "y": 0}},
                {"type": "round", "radii": {"x": 0, "y": 0}},
                {"type": "round", "radii": {"x": 0, "y": 0}}
            ]
        });
        let frame_kind_escaped = frame_kind.to_string().replace('"', "\\\"");
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [
                        {{ createNode: {{ nodeUuid: "{child_uuid}", kind: "{frame_kind_escaped}", name: "Child" }} }},
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
    async fn test_apply_operations_delete_nodes_batch() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // Create two sibling page-root frames.
        let uuid_a = create_test_frame_direct(&state, "ToDeleteA");
        let uuid_b = create_test_frame_direct(&state, "ToDeleteB");

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ deleteNodes: {{ nodeUuids: ["{uuid_a}", "{uuid_b}"] }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            res.errors.is_empty(),
            "delete_nodes failed: {:?}",
            res.errors
        );

        // Both nodes should be gone.
        for uuid in [&uuid_a, &uuid_b] {
            let node_res = schema
                .execute(format!(r#"{{ node(uuid: "{uuid}") {{ name }} }}"#).as_str())
                .await;
            assert!(
                node_res.data.into_json().unwrap()["node"].is_null(),
                "node {uuid} should be deleted"
            );
        }
    }

    #[tokio::test]
    async fn test_apply_operations_delete_nodes_missing_uuid_rejects_batch() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // One real node + one non-existent UUID — the entire batch must fail.
        let uuid_a = create_test_frame_direct(&state, "Real");
        let bogus = uuid::Uuid::new_v4();

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ deleteNodes: {{ nodeUuids: ["{uuid_a}", "{bogus}"] }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "batch with missing UUID should be rejected"
        );

        // The real node must still exist — the batch is atomic.
        let node_res = schema
            .execute(format!(r#"{{ node(uuid: "{uuid_a}") {{ name }} }}"#).as_str())
            .await;
        assert!(
            !node_res.data.into_json().unwrap()["node"].is_null(),
            "atomic batch must not have deleted the real node"
        );
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
        use sigil_core::commands::node_commands::CreateNode;
        use sigil_core::node::{NodeKind, TextSizing, TextStyle};

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

        apply_to_session_and_legacy(state, |doc| {
            cmd.validate(doc).expect("create text node validate");
            cmd.apply(doc).expect("create text node apply");
        });
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
            sigil_core::node::NodeKind::Text { content, .. } => {
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
            sigil_core::node::NodeKind::Text { text_style, .. } => {
                assert_eq!(
                    text_style.font_size,
                    sigil_core::node::StyleValue::Literal { value: 24.0 },
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
            sigil_core::node::NodeKind::Text { text_style, .. } => {
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
            sigil_core::node::NodeKind::Text { text_style, .. } => {
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
        use sigil_core::commands::token_commands::AddToken as CoreAddToken;
        use sigil_core::id::TokenId;
        use sigil_core::node::Color;
        use sigil_core::tokens::{Token, TokenType, TokenValue};

        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // Seed a color token directly.
        apply_to_session_and_legacy(&state, |doc| {
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
            op.validate(doc).expect("validate");
            op.apply(doc).expect("apply");
        });

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
        use sigil_core::commands::token_commands::AddToken as CoreAddToken;
        use sigil_core::id::TokenId;
        use sigil_core::node::Color;
        use sigil_core::tokens::{Token, TokenType, TokenValue};

        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // Seed a token.
        apply_to_session_and_legacy(&state, |doc| {
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
            op.validate(doc).expect("validate");
            op.apply(doc).expect("apply");
        });

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
        use sigil_core::commands::token_commands::AddToken as CoreAddToken;
        use sigil_core::id::TokenId;
        use sigil_core::node::Color;
        use sigil_core::tokens::{Token, TokenType, TokenValue};

        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // Seed a token first.
        apply_to_session_and_legacy(&state, |doc| {
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
            op.validate(doc).expect("validate");
            op.apply(doc).expect("apply");
        });

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

    #[tokio::test]
    async fn test_apply_operations_set_opacity_accepts_expression_variant() {
        // Spec 13c Phase A: StyleValue::Expression round-trips through GraphQL
        // for every StyleValue-typed field. Covers style.opacity here; other
        // fields share the same parse path via the auto-derived Deserialize.
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "TestNode");

        // JSON-encoded StyleValue::Expression. The GraphQL value is a string
        // containing JSON — inner braces and quotes are escaped appropriately.
        let expr_json = r#"{\"type\":\"expression\",\"expr\":\"{spacing.md} * 2\"}"#;
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{
                        setField: {{
                            nodeUuid: "{uuid}",
                            path: "style.opacity",
                            value: "{expr_json}"
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
            "setField with StyleValue::Expression should succeed, got errors: {:?}",
            res.errors
        );
    }

    #[tokio::test]
    async fn test_apply_operations_set_opacity_rejects_malformed_expression() {
        // Expression variants must still fail parse validation at the field
        // operation boundary — the expression engine rejects syntax errors.
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "TestNode");

        let expr_json = r#"{\"type\":\"expression\",\"expr\":\"1 + + 2\"}"#;
        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{
                        setField: {{
                            nodeUuid: "{uuid}",
                            path: "style.opacity",
                            value: "{expr_json}"
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
            "setField with malformed StyleValue::Expression should be rejected"
        );
    }

    // ── Corner shape tests ────────────────────────────────────────────

    #[tokio::test]
    async fn test_set_field_kind_accepts_new_corners_shape() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        // Create a frame node (SetCorners supports Frame, Rectangle, Image).
        let uuid = create_test_frame_direct(&state, "FrameForCorners");

        // Per-corner array form: four different corner shapes.
        // parse_corners_input uses "shape" and "radii" keys.
        let corners_json = serde_json::json!([
            { "shape": "round",  "radii": { "x": 4.0,  "y": 4.0  } },
            { "shape": "bevel",  "radii": { "x": 8.0,  "y": 8.0  } },
            { "shape": "notch",  "radii": { "x": 12.0, "y": 12.0 } },
            { "shape": "scoop",  "radii": { "x": 16.0, "y": 16.0 } }
        ]);
        let kind_value = serde_json::json!({
            "type": "frame",
            "corners": corners_json
        });
        let kind_value_str = kind_value.to_string();

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind", value: {kind_value_str:?} }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        // Verify corners were updated in the document.
        let doc = state.app.document.lock().unwrap();
        let node_uuid: uuid::Uuid = uuid.parse().unwrap();
        let node_id = doc.arena.id_by_uuid(&node_uuid).expect("node exists");
        let node = doc.arena.get(node_id).expect("get node");
        match &node.kind {
            sigil_core::node::NodeKind::Frame { corners, .. } => {
                assert!(
                    matches!(corners[0], sigil_core::node::Corner::Round { .. }),
                    "corners[0] should be Round"
                );
                assert!(
                    matches!(corners[1], sigil_core::node::Corner::Bevel { .. }),
                    "corners[1] should be Bevel"
                );
                assert!(
                    matches!(corners[2], sigil_core::node::Corner::Notch { .. }),
                    "corners[2] should be Notch"
                );
                assert!(
                    matches!(corners[3], sigil_core::node::Corner::Scoop { .. }),
                    "corners[3] should be Scoop"
                );
            }
            _ => panic!("expected Frame node"),
        }
    }

    #[tokio::test]
    async fn test_set_field_kind_rejects_superellipse_in_per_corner_array() {
        let state = ServerState::new();
        let schema = test_schema(state.clone());

        let uuid = create_test_frame_direct(&state, "FrameForBadCorners");

        // Per-corner array with superellipse — parse_corners_input rejects this.
        // Superellipse must use the shape-level (object) form, not per-corner.
        let bad_corners_json = serde_json::json!([
            { "shape": "superellipse", "radii": { "x": 8.0, "y": 8.0 }, "smoothing": 0.5 },
            { "shape": "round",        "radii": { "x": 8.0, "y": 8.0 } },
            { "shape": "round",        "radii": { "x": 8.0, "y": 8.0 } },
            { "shape": "round",        "radii": { "x": 8.0, "y": 8.0 } }
        ]);
        let kind_value = serde_json::json!({
            "type": "frame",
            "corners": bad_corners_json
        });
        let kind_value_str = kind_value.to_string();

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "kind", value: {kind_value_str:?} }} }}],
                    userId: "test-user"
                ) {{
                    seq
                }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            !res.errors.is_empty(),
            "superellipse in per-corner array form should be rejected"
        );
        // Error message should mention superellipse or shape-level form.
        let err_msg = res.errors[0].message.to_lowercase();
        assert!(
            err_msg.contains("superellipse") || err_msg.contains("shape-level"),
            "error message should mention superellipse or shape-level, got: {}",
            res.errors[0].message
        );
    }

    // ── Session resolution tests (Spec 20, Task 5) ────────────────────

    /// `apply_operations` MUST return `SESSION_NOT_FOUND` when the
    /// `X-Sigil-Session` header points at a session that is not registered
    /// in the [`Sessions`] registry.
    #[tokio::test]
    async fn test_apply_operations_rejects_unknown_session_id() {
        let state = ServerState::new();
        let unknown_id = SessionId::new();
        // Inject an explicit RequestSession pointing at an id that doesn't
        // exist in the registry, overriding the default-session fallback.
        let schema = Schema::build(
            super::super::query::QueryRoot,
            MutationRoot,
            EmptySubscription,
        )
        .data(state.clone())
        .data(RequestSession(Some(unknown_id)))
        .finish();

        // Use a setField that would fail validation anyway, but the session
        // check happens BEFORE any validation, so we expect SESSION_NOT_FOUND
        // not "node not found".
        let query = r#"mutation {
                applyOperations(
                    operations: [{ setField: { nodeUuid: "00000000-0000-0000-0000-000000000000", path: "name", value: "\"x\"" } }],
                    userId: "test"
                ) { seq }
            }"#;
        let res = schema.execute(query).await;
        assert_eq!(res.errors.len(), 1, "expected exactly one error");
        assert!(
            res.errors[0].message.starts_with("SESSION_NOT_FOUND"),
            "expected SESSION_NOT_FOUND, got: {}",
            res.errors[0].message
        );
    }

    /// `apply_operations` MUST return `SESSION_REQUIRED` when neither a
    /// header nor a default session id is available — this is the error
    /// surfaced to a client that hits a server started without `--workfile`
    /// and has not opened a session via Task 6's `openSession` mutation.
    #[tokio::test]
    async fn test_apply_operations_rejects_when_no_session_resolvable() {
        let state = ServerState::new();
        // Clear the default session id so resolve_session has no fallback.
        state.app.set_default_session_id(None);

        let schema = Schema::build(
            super::super::query::QueryRoot,
            MutationRoot,
            EmptySubscription,
        )
        .data(state)
        .data(RequestSession(None))
        .finish();

        let query = r#"mutation {
            applyOperations(
                operations: [{ setField: { nodeUuid: "00000000-0000-0000-0000-000000000000", path: "name", value: "\"x\"" } }],
                userId: "test"
            ) { seq }
        }"#;
        let res = schema.execute(query).await;
        assert_eq!(res.errors.len(), 1, "expected exactly one error");
        assert!(
            res.errors[0].message.starts_with("SESSION_REQUIRED"),
            "expected SESSION_REQUIRED, got: {}",
            res.errors[0].message
        );
    }

    /// `apply_operations` uses the explicit `X-Sigil-Session` header when
    /// present even if a default session id is also configured.
    #[tokio::test]
    async fn test_apply_operations_prefers_header_session_over_default() {
        let state = ServerState::new();
        let _default = state.app.default_session_id().expect("default present");

        // Register a second in-memory session and target it via header.
        let second_doc = sigil_core::Document::new("Second".to_string());
        let second_id = state.app.sessions.register_in_memory(second_doc);

        // Seed a frame in the SECOND session's store so the rename
        // succeeds — confirming the resolver actually used the header id.
        let frame_uuid = uuid::Uuid::new_v4();
        {
            let session = state.app.sessions.get(second_id).expect("second");
            let mut sd = session.store.try_write().expect("uncontested");
            let cmd = sigil_core::commands::node_commands::CreateNode {
                uuid: frame_uuid,
                kind: sigil_core::node::NodeKind::Frame {
                    layout: None,
                    corners: sigil_core::node::default_corners(),
                },
                name: "second-frame".to_string(),
                page_id: None,
                initial_transform: None,
            };
            cmd.validate(&sd.0).expect("validate");
            cmd.apply(&mut sd.0).expect("apply");
        }

        let schema = Schema::build(
            super::super::query::QueryRoot,
            MutationRoot,
            EmptySubscription,
        )
        .data(state.clone())
        .data(RequestSession(Some(second_id)))
        .finish();

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{frame_uuid}", path: "name", value: "\"renamed\"" }} }}],
                    userId: "test"
                ) {{ seq }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(
            res.errors.is_empty(),
            "header-targeted session should succeed, errors: {:?}",
            res.errors
        );
    }

    /// `apply_operations` broadcasts the post-apply event on the per-session
    /// channel — confirming Spec 20's per-session subscription contract.
    #[tokio::test]
    async fn test_apply_operations_broadcasts_to_session_channel() {
        let state = ServerState::new();
        let session_id = state.app.default_session_id().expect("default");
        let session = state.app.sessions.get(session_id).expect("session");
        let mut rx = session.broadcast.subscribe();

        let uuid = create_test_frame_direct(&state, "BroadcastTarget");
        let schema = test_schema(state);

        let query = format!(
            r#"mutation {{
                applyOperations(
                    operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "name", value: "\"NewName\"" }} }}],
                    userId: "test"
                ) {{ seq }}
            }}"#
        );
        let res = schema.execute(&query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let event = rx.try_recv().expect("session channel must receive event");
        match event {
            sigil_state::sessions::SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.kind, MutationEventKind::NodeUpdated);
                let tx = me.transaction.expect("transaction present");
                assert_eq!(tx.operations.len(), 1);
                assert_eq!(tx.operations[0].path, "name");
            }
            sigil_state::sessions::SessionEvent::SessionFatal { reason } => {
                panic!("expected DocumentEvent, got SessionFatal: {reason}");
            }
        }
    }
}
