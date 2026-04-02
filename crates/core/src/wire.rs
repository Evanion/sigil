//! Wire format enums for command serialization.
//!
//! `SerializableCommand`: full state for local undo/redo persistence.
//! `BroadcastCommand`: forward-only state for WebSocket sync (omits `old_*` fields).
//!
//! ## Future Work
//!
//! Bidirectional conversion between wire format enums and actual `Command` structs
//! (e.g., `From<&dyn Command> for SerializableCommand`) will be implemented in the
//! server crate where commands are constructed and dispatched. The core crate defines
//! the wire format types; the server owns the conversion logic.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::component::{ComponentDef, OverrideKey, OverrideSource, OverrideValue};
use crate::id::{ComponentId, NodeId, PageId};
use crate::node::{
    BlendMode, Constraints, Effect, Fill, Node, NodeKind, Stroke, StyleValue, Transform,
};
use crate::prototype::Transition;
use crate::token::Token;

/// Full command representation for local undo/redo persistence.
/// Includes both forward and reverse state so the engine can reconstruct
/// undo operations without access to the original document state.
///
/// Note: This format uses `NodeId` (arena-local indices) and is intended for
/// in-session undo/redo only. For cross-session persistence, `NodeId` fields
/// must be converted to UUIDs via `arena.uuid_of()` at the serialization boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SerializableCommand {
    // ── Node commands ────────────────────────────────────────────
    CreateNode {
        node_id: NodeId,
        uuid: Uuid,
        kind: NodeKind,
        name: String,
        page_id: Option<PageId>,
    },
    DeleteNode {
        node_id: NodeId,
        /// Snapshot of the deleted node, required for undo reconstruction.
        /// Captured by the `DeleteNode` command after execution; `None` before
        /// the command has been applied.
        ///
        /// Boxed to avoid inflating the overall enum size (`clippy::large_enum_variant`).
        snapshot: Option<Box<Node>>,
        page_id: Option<PageId>,
        page_root_index: Option<usize>,
        parent_id: Option<NodeId>,
        parent_child_index: Option<usize>,
    },
    RenameNode {
        node_id: NodeId,
        new_name: String,
        old_name: String,
    },
    SetVisible {
        node_id: NodeId,
        new_visible: bool,
        old_visible: bool,
    },
    SetLocked {
        node_id: NodeId,
        new_locked: bool,
        old_locked: bool,
    },
    SetTextContent {
        node_id: NodeId,
        new_content: String,
        old_content: String,
    },

    // ── Style commands ───────────────────────────────────────────
    SetTransform {
        node_id: NodeId,
        new_transform: Transform,
        old_transform: Transform,
    },
    SetFills {
        node_id: NodeId,
        new_fills: Vec<Fill>,
        old_fills: Vec<Fill>,
    },
    SetStrokes {
        node_id: NodeId,
        new_strokes: Vec<Stroke>,
        old_strokes: Vec<Stroke>,
    },
    SetOpacity {
        node_id: NodeId,
        new_opacity: StyleValue<f64>,
        old_opacity: StyleValue<f64>,
    },
    SetBlendMode {
        node_id: NodeId,
        new_blend_mode: BlendMode,
        old_blend_mode: BlendMode,
    },
    SetEffects {
        node_id: NodeId,
        new_effects: Vec<Effect>,
        old_effects: Vec<Effect>,
    },
    SetConstraints {
        node_id: NodeId,
        new_constraints: Constraints,
        old_constraints: Constraints,
    },

    // ── Tree commands ────────────────────────────────────────────
    ReparentNode {
        node_id: NodeId,
        new_parent_id: NodeId,
        new_position: usize,
        old_parent_id: Option<NodeId>,
        old_position: Option<usize>,
    },
    ReorderChildren {
        node_id: NodeId,
        new_position: usize,
        old_position: usize,
    },

    // ── Transition commands ──────────────────────────────────────
    AddTransition {
        transition: Transition,
    },
    RemoveTransition {
        transition_id: Uuid,
        snapshot: Transition,
    },
    UpdateTransition {
        transition_id: Uuid,
        new_transition: Transition,
        old_transition: Transition,
    },

    // ── Token commands ───────────────────────────────────────────
    AddToken {
        token: Token,
    },
    RemoveToken {
        token_name: String,
        snapshot: Token,
    },
    UpdateToken {
        new_token: Token,
        old_token: Token,
    },

    // ── Component commands ───────────────────────────────────────
    AddComponent {
        component: ComponentDef,
    },
    RemoveComponent {
        component_id: ComponentId,
        snapshot: ComponentDef,
    },
    SetOverride {
        node_id: NodeId,
        key: OverrideKey,
        new_value: OverrideValue,
        new_source: OverrideSource,
        old_entry: Option<(OverrideValue, OverrideSource)>,
    },
    RemoveOverride {
        node_id: NodeId,
        key: OverrideKey,
        old_entry: (OverrideValue, OverrideSource),
    },
}

/// Forward-only command representation for WebSocket broadcast.
/// Omits all `old_*` and `snapshot` fields to avoid leaking historical
/// document state to other clients and to reduce message size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BroadcastCommand {
    // ── Node commands ────────────────────────────────────────────
    CreateNode {
        uuid: Uuid,
        kind: NodeKind,
        name: String,
        page_id: Option<PageId>,
    },
    /// A node was created with an initial transform (atomic compound operation).
    /// Clients receiving this should create the node AND apply the transform.
    NodeCreatedWithTransform {
        uuid: Uuid,
        kind: NodeKind,
        name: String,
        page_id: Option<PageId>,
        transform: Transform,
    },
    DeleteNode {
        node_id: NodeId,
    },
    RenameNode {
        node_id: NodeId,
        new_name: String,
    },
    SetVisible {
        node_id: NodeId,
        new_visible: bool,
    },
    SetLocked {
        node_id: NodeId,
        new_locked: bool,
    },
    SetTextContent {
        node_id: NodeId,
        new_content: String,
    },

    // ── Style commands ───────────────────────────────────────────
    SetTransform {
        node_id: NodeId,
        new_transform: Transform,
    },
    SetFills {
        node_id: NodeId,
        new_fills: Vec<Fill>,
    },
    SetStrokes {
        node_id: NodeId,
        new_strokes: Vec<Stroke>,
    },
    SetOpacity {
        node_id: NodeId,
        new_opacity: StyleValue<f64>,
    },
    SetBlendMode {
        node_id: NodeId,
        new_blend_mode: BlendMode,
    },
    SetEffects {
        node_id: NodeId,
        new_effects: Vec<Effect>,
    },
    SetConstraints {
        node_id: NodeId,
        new_constraints: Constraints,
    },

    // ── Tree commands ────────────────────────────────────────────
    ReparentNode {
        node_id: NodeId,
        new_parent_id: NodeId,
        new_position: usize,
    },
    ReorderChildren {
        node_id: NodeId,
        new_position: usize,
    },

    // ── Transition commands ──────────────────────────────────────
    AddTransition {
        transition: Transition,
    },
    RemoveTransition {
        transition_id: Uuid,
    },
    UpdateTransition {
        transition_id: Uuid,
        new_transition: Transition,
    },

    // ── Token commands ───────────────────────────────────────────
    AddToken {
        token: Token,
    },
    RemoveToken {
        token_name: String,
    },
    UpdateToken {
        new_token: Token,
    },

    // ── Component commands ───────────────────────────────────────
    AddComponent {
        component: ComponentDef,
    },
    RemoveComponent {
        component_id: ComponentId,
    },
    SetOverride {
        node_id: NodeId,
        key: OverrideKey,
        new_value: OverrideValue,
        new_source: OverrideSource,
    },
    RemoveOverride {
        node_id: NodeId,
        key: OverrideKey,
    },
}

/// Converts a `SerializableCommand` to a `BroadcastCommand` by stripping undo state.
impl From<&SerializableCommand> for BroadcastCommand {
    #[allow(clippy::too_many_lines)]
    fn from(cmd: &SerializableCommand) -> Self {
        match cmd {
            SerializableCommand::CreateNode {
                uuid,
                kind,
                name,
                page_id,
                ..
            } => BroadcastCommand::CreateNode {
                uuid: *uuid,
                kind: kind.clone(),
                name: name.clone(),
                page_id: *page_id,
            },
            SerializableCommand::DeleteNode { node_id, .. } => {
                BroadcastCommand::DeleteNode { node_id: *node_id }
            }
            SerializableCommand::RenameNode {
                node_id, new_name, ..
            } => BroadcastCommand::RenameNode {
                node_id: *node_id,
                new_name: new_name.clone(),
            },
            SerializableCommand::SetVisible {
                node_id,
                new_visible,
                ..
            } => BroadcastCommand::SetVisible {
                node_id: *node_id,
                new_visible: *new_visible,
            },
            SerializableCommand::SetLocked {
                node_id,
                new_locked,
                ..
            } => BroadcastCommand::SetLocked {
                node_id: *node_id,
                new_locked: *new_locked,
            },
            SerializableCommand::SetTextContent {
                node_id,
                new_content,
                ..
            } => BroadcastCommand::SetTextContent {
                node_id: *node_id,
                new_content: new_content.clone(),
            },
            SerializableCommand::SetTransform {
                node_id,
                new_transform,
                ..
            } => BroadcastCommand::SetTransform {
                node_id: *node_id,
                new_transform: *new_transform,
            },
            SerializableCommand::SetFills {
                node_id, new_fills, ..
            } => BroadcastCommand::SetFills {
                node_id: *node_id,
                new_fills: new_fills.clone(),
            },
            SerializableCommand::SetStrokes {
                node_id,
                new_strokes,
                ..
            } => BroadcastCommand::SetStrokes {
                node_id: *node_id,
                new_strokes: new_strokes.clone(),
            },
            SerializableCommand::SetOpacity {
                node_id,
                new_opacity,
                ..
            } => BroadcastCommand::SetOpacity {
                node_id: *node_id,
                new_opacity: new_opacity.clone(),
            },
            SerializableCommand::SetBlendMode {
                node_id,
                new_blend_mode,
                ..
            } => BroadcastCommand::SetBlendMode {
                node_id: *node_id,
                new_blend_mode: *new_blend_mode,
            },
            SerializableCommand::SetEffects {
                node_id,
                new_effects,
                ..
            } => BroadcastCommand::SetEffects {
                node_id: *node_id,
                new_effects: new_effects.clone(),
            },
            SerializableCommand::SetConstraints {
                node_id,
                new_constraints,
                ..
            } => BroadcastCommand::SetConstraints {
                node_id: *node_id,
                new_constraints: *new_constraints,
            },
            SerializableCommand::ReparentNode {
                node_id,
                new_parent_id,
                new_position,
                ..
            } => BroadcastCommand::ReparentNode {
                node_id: *node_id,
                new_parent_id: *new_parent_id,
                new_position: *new_position,
            },
            SerializableCommand::ReorderChildren {
                node_id,
                new_position,
                ..
            } => BroadcastCommand::ReorderChildren {
                node_id: *node_id,
                new_position: *new_position,
            },
            SerializableCommand::AddTransition { transition } => BroadcastCommand::AddTransition {
                transition: transition.clone(),
            },
            SerializableCommand::RemoveTransition { transition_id, .. } => {
                BroadcastCommand::RemoveTransition {
                    transition_id: *transition_id,
                }
            }
            SerializableCommand::UpdateTransition {
                transition_id,
                new_transition,
                ..
            } => BroadcastCommand::UpdateTransition {
                transition_id: *transition_id,
                new_transition: new_transition.clone(),
            },
            SerializableCommand::AddToken { token } => BroadcastCommand::AddToken {
                token: token.clone(),
            },
            SerializableCommand::RemoveToken { token_name, .. } => BroadcastCommand::RemoveToken {
                token_name: token_name.clone(),
            },
            SerializableCommand::UpdateToken { new_token, .. } => BroadcastCommand::UpdateToken {
                new_token: new_token.clone(),
            },
            SerializableCommand::AddComponent { component } => BroadcastCommand::AddComponent {
                component: component.clone(),
            },
            SerializableCommand::RemoveComponent { component_id, .. } => {
                BroadcastCommand::RemoveComponent {
                    component_id: *component_id,
                }
            }
            SerializableCommand::SetOverride {
                node_id,
                key,
                new_value,
                new_source,
                ..
            } => BroadcastCommand::SetOverride {
                node_id: *node_id,
                key: key.clone(),
                new_value: new_value.clone(),
                new_source: *new_source,
            },
            SerializableCommand::RemoveOverride { node_id, key, .. } => {
                BroadcastCommand::RemoveOverride {
                    node_id: *node_id,
                    key: key.clone(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::{
        ComponentDef, OverrideKey, OverrideSource, OverrideValue, PropertyPath,
    };
    use crate::id::{ComponentId, NodeId, TokenId};
    use crate::node::{
        BlendMode, Color, Constraints, Effect, Fill, Node, NodeKind, PinConstraint, Point, Stroke,
        StrokeAlignment, StrokeCap, StrokeJoin, StyleValue, Transform,
    };
    use crate::prototype::{TransitionAnimation, TransitionTrigger};
    use crate::token::{Token, TokenType, TokenValue};

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn make_node() -> Node {
        Node::new(
            NodeId::new(5, 1),
            make_uuid(42),
            NodeKind::Rectangle {
                corner_radii: [0.0, 0.0, 0.0, 0.0],
            },
            "TestRect".to_string(),
        )
        .expect("valid node")
    }

    fn make_token() -> Token {
        Token::new(
            TokenId::new(make_uuid(1)),
            "color.primary".to_string(),
            TokenValue::Number { value: 42.0 },
            TokenType::Number,
            None,
        )
        .expect("valid token")
    }

    fn make_transition() -> Transition {
        Transition {
            id: make_uuid(1),
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(make_uuid(10)),
            target_node: None,
            trigger: TransitionTrigger::OnClick,
            animation: TransitionAnimation::Dissolve { duration: 0.3 },
        }
    }

    fn make_component() -> ComponentDef {
        ComponentDef::new(
            ComponentId::new(make_uuid(20)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid component")
    }

    /// Builds every `SerializableCommand` variant for exhaustive testing.
    fn all_serializable_variants() -> Vec<SerializableCommand> {
        vec![
            SerializableCommand::CreateNode {
                node_id: NodeId::new(0, 0),
                uuid: make_uuid(1),
                kind: NodeKind::Frame { layout: None },
                name: "Frame".to_string(),
                page_id: Some(PageId::new(make_uuid(10))),
            },
            SerializableCommand::DeleteNode {
                node_id: NodeId::new(1, 0),
                snapshot: Some(Box::new(make_node())),
                page_id: Some(PageId::new(make_uuid(10))),
                page_root_index: Some(0),
                parent_id: Some(NodeId::new(0, 0)),
                parent_child_index: Some(2),
            },
            SerializableCommand::DeleteNode {
                node_id: NodeId::new(2, 0),
                snapshot: None,
                page_id: None,
                page_root_index: None,
                parent_id: None,
                parent_child_index: None,
            },
            SerializableCommand::RenameNode {
                node_id: NodeId::new(0, 0),
                new_name: "New Name".to_string(),
                old_name: "Old Name".to_string(),
            },
            SerializableCommand::SetVisible {
                node_id: NodeId::new(0, 0),
                new_visible: false,
                old_visible: true,
            },
            SerializableCommand::SetLocked {
                node_id: NodeId::new(0, 0),
                new_locked: true,
                old_locked: false,
            },
            SerializableCommand::SetTextContent {
                node_id: NodeId::new(0, 0),
                new_content: "hello".to_string(),
                old_content: "world".to_string(),
            },
            SerializableCommand::SetTransform {
                node_id: NodeId::new(0, 0),
                new_transform: Transform {
                    x: 10.0,
                    y: 20.0,
                    width: 100.0,
                    height: 50.0,
                    rotation: 45.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                },
                old_transform: Transform::default(),
            },
            SerializableCommand::SetFills {
                node_id: NodeId::new(0, 0),
                new_fills: vec![Fill::Solid {
                    color: StyleValue::Literal {
                        value: Color::Srgb {
                            r: 1.0,
                            g: 0.0,
                            b: 0.0,
                            a: 1.0,
                        },
                    },
                }],
                old_fills: vec![],
            },
            SerializableCommand::SetStrokes {
                node_id: NodeId::new(0, 0),
                new_strokes: vec![Stroke {
                    color: StyleValue::Literal {
                        value: Color::Srgb {
                            r: 0.0,
                            g: 0.0,
                            b: 0.0,
                            a: 1.0,
                        },
                    },
                    width: StyleValue::Literal { value: 1.0 },
                    alignment: StrokeAlignment::Center,
                    cap: StrokeCap::Butt,
                    join: StrokeJoin::Miter,
                }],
                old_strokes: vec![],
            },
            SerializableCommand::SetOpacity {
                node_id: NodeId::new(0, 0),
                new_opacity: StyleValue::Literal { value: 0.5 },
                old_opacity: StyleValue::Literal { value: 1.0 },
            },
            SerializableCommand::SetBlendMode {
                node_id: NodeId::new(0, 0),
                new_blend_mode: BlendMode::Multiply,
                old_blend_mode: BlendMode::Normal,
            },
            SerializableCommand::SetEffects {
                node_id: NodeId::new(0, 0),
                new_effects: vec![Effect::DropShadow {
                    color: StyleValue::Literal {
                        value: Color::Srgb {
                            r: 0.0,
                            g: 0.0,
                            b: 0.0,
                            a: 0.5,
                        },
                    },
                    offset: Point { x: 2.0, y: 2.0 },
                    blur: StyleValue::Literal { value: 4.0 },
                    spread: StyleValue::Literal { value: 0.0 },
                }],
                old_effects: vec![],
            },
            SerializableCommand::SetConstraints {
                node_id: NodeId::new(0, 0),
                new_constraints: Constraints {
                    horizontal: PinConstraint::Center,
                    vertical: PinConstraint::Scale,
                },
                old_constraints: Constraints::default(),
            },
            SerializableCommand::ReparentNode {
                node_id: NodeId::new(1, 0),
                new_parent_id: NodeId::new(2, 0),
                new_position: 0,
                old_parent_id: Some(NodeId::new(0, 0)),
                old_position: Some(1),
            },
            SerializableCommand::ReorderChildren {
                node_id: NodeId::new(1, 0),
                new_position: 3,
                old_position: 0,
            },
            SerializableCommand::AddTransition {
                transition: make_transition(),
            },
            SerializableCommand::RemoveTransition {
                transition_id: make_uuid(1),
                snapshot: make_transition(),
            },
            SerializableCommand::UpdateTransition {
                transition_id: make_uuid(1),
                new_transition: make_transition(),
                old_transition: make_transition(),
            },
            SerializableCommand::AddToken {
                token: make_token(),
            },
            SerializableCommand::RemoveToken {
                token_name: "color.primary".to_string(),
                snapshot: make_token(),
            },
            SerializableCommand::UpdateToken {
                new_token: make_token(),
                old_token: make_token(),
            },
            SerializableCommand::AddComponent {
                component: make_component(),
            },
            SerializableCommand::RemoveComponent {
                component_id: ComponentId::new(make_uuid(20)),
                snapshot: make_component(),
            },
            SerializableCommand::SetOverride {
                node_id: NodeId::new(0, 0),
                key: OverrideKey::new(make_uuid(5), PropertyPath::Visible),
                new_value: OverrideValue::Bool { value: false },
                new_source: OverrideSource::User,
                old_entry: Some((OverrideValue::Bool { value: true }, OverrideSource::User)),
            },
            SerializableCommand::RemoveOverride {
                node_id: NodeId::new(0, 0),
                key: OverrideKey::new(make_uuid(5), PropertyPath::Visible),
                old_entry: (OverrideValue::Bool { value: true }, OverrideSource::User),
            },
        ]
    }

    #[test]
    fn test_every_serializable_variant_round_trips_through_json() {
        for (i, cmd) in all_serializable_variants().into_iter().enumerate() {
            let json = serde_json::to_string(&cmd)
                .unwrap_or_else(|e| panic!("serialize variant {i} failed: {e}"));
            let deserialized: SerializableCommand = serde_json::from_str(&json)
                .unwrap_or_else(|e| panic!("deserialize variant {i} failed: {e}\njson: {json}"));
            assert_eq!(cmd, deserialized, "round-trip mismatch for variant {i}");
        }
    }

    #[test]
    fn test_every_serializable_variant_converts_to_broadcast() {
        for (i, cmd) in all_serializable_variants().iter().enumerate() {
            // Must not panic — this exercises the From impl for every variant.
            let broadcast: BroadcastCommand = cmd.into();

            // Round-trip the broadcast through JSON to confirm it serializes cleanly.
            let json = serde_json::to_string(&broadcast)
                .unwrap_or_else(|e| panic!("broadcast serialize variant {i} failed: {e}"));
            let deserialized: BroadcastCommand = serde_json::from_str(&json).unwrap_or_else(|e| {
                panic!("broadcast deserialize variant {i} failed: {e}\njson: {json}")
            });
            assert_eq!(
                broadcast, deserialized,
                "broadcast round-trip mismatch for variant {i}"
            );
        }
    }

    #[test]
    fn test_broadcast_omits_old_state_and_snapshots() {
        for cmd in &all_serializable_variants() {
            let broadcast = BroadcastCommand::from(cmd);
            let json = serde_json::to_string(&broadcast).expect("serialize broadcast");
            assert!(
                !json.contains("old_name"),
                "broadcast leaked old_name: {json}"
            );
            assert!(
                !json.contains("old_visible"),
                "broadcast leaked old_visible: {json}"
            );
            assert!(
                !json.contains("old_locked"),
                "broadcast leaked old_locked: {json}"
            );
            assert!(
                !json.contains("old_content"),
                "broadcast leaked old_content: {json}"
            );
            assert!(
                !json.contains("old_transform"),
                "broadcast leaked old_transform: {json}"
            );
            assert!(
                !json.contains("old_fills"),
                "broadcast leaked old_fills: {json}"
            );
            assert!(
                !json.contains("old_strokes"),
                "broadcast leaked old_strokes: {json}"
            );
            assert!(
                !json.contains("old_opacity"),
                "broadcast leaked old_opacity: {json}"
            );
            assert!(
                !json.contains("old_blend_mode"),
                "broadcast leaked old_blend_mode: {json}"
            );
            assert!(
                !json.contains("old_effects"),
                "broadcast leaked old_effects: {json}"
            );
            assert!(
                !json.contains("old_constraints"),
                "broadcast leaked old_constraints: {json}"
            );
            assert!(
                !json.contains("old_position"),
                "broadcast leaked old_position: {json}"
            );
            assert!(
                !json.contains("old_entry"),
                "broadcast leaked old_entry: {json}"
            );
            assert!(
                !json.contains("\"snapshot\""),
                "broadcast leaked snapshot: {json}"
            );
        }
    }

    #[test]
    fn test_delete_node_with_snapshot_round_trips() {
        let node = make_node();
        let cmd = SerializableCommand::DeleteNode {
            node_id: NodeId::new(1, 0),
            snapshot: Some(Box::new(node)),
            page_id: None,
            page_root_index: None,
            parent_id: Some(NodeId::new(0, 0)),
            parent_child_index: Some(0),
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: SerializableCommand = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_delete_node_without_snapshot_round_trips() {
        let cmd = SerializableCommand::DeleteNode {
            node_id: NodeId::new(1, 0),
            snapshot: None,
            page_id: None,
            page_root_index: None,
            parent_id: None,
            parent_child_index: None,
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: SerializableCommand = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_serializable_to_broadcast_conversion_strips_undo_fields() {
        let serializable = SerializableCommand::SetVisible {
            node_id: NodeId::new(1, 0),
            new_visible: false,
            old_visible: true,
        };
        let broadcast: BroadcastCommand = (&serializable).into();
        assert_eq!(
            broadcast,
            BroadcastCommand::SetVisible {
                node_id: NodeId::new(1, 0),
                new_visible: false,
            }
        );
    }
}
