// crates/core/src/wire.rs
//
// Wire format enums for command serialization.
// SerializableCommand: full state for local undo/redo persistence.
// BroadcastCommand: forward-only state for WebSocket sync (omits old_* fields).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::component::{ComponentDef, OverrideKey, OverrideSource, OverrideValue};
use crate::id::{ComponentId, NodeId, PageId};
use crate::node::{BlendMode, Constraints, Effect, Fill, NodeKind, Stroke, StyleValue, Transform};
use crate::prototype::Transition;
use crate::token::Token;

/// Full command representation for local undo/redo persistence.
/// Includes both forward and reverse state so the engine can reconstruct
/// undo operations without access to the original document state.
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
    use crate::id::{NodeId, TokenId};
    use crate::node::NodeKind;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    #[test]
    fn test_serializable_command_serde_round_trip() {
        let cmd = SerializableCommand::RenameNode {
            node_id: NodeId::new(0, 0),
            new_name: "New Name".to_string(),
            old_name: "Old Name".to_string(),
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: SerializableCommand = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_broadcast_command_serde_round_trip() {
        let cmd = BroadcastCommand::RenameNode {
            node_id: NodeId::new(0, 0),
            new_name: "New Name".to_string(),
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: BroadcastCommand = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_serializable_to_broadcast_conversion() {
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

    #[test]
    fn test_broadcast_omits_old_state() {
        let serializable = SerializableCommand::RenameNode {
            node_id: NodeId::new(0, 0),
            new_name: "New".to_string(),
            old_name: "Old".to_string(),
        };
        let broadcast_json =
            serde_json::to_string(&BroadcastCommand::from(&serializable)).expect("serialize");
        assert!(!broadcast_json.contains("old_name"));
        assert!(!broadcast_json.contains("Old"));
    }

    #[test]
    fn test_serializable_create_node_round_trip() {
        let cmd = SerializableCommand::CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: make_uuid(1),
            kind: NodeKind::Frame { layout: None },
            name: "Frame".to_string(),
            page_id: Some(PageId::new(make_uuid(10))),
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: SerializableCommand = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_serializable_add_transition_round_trip() {
        use crate::prototype::{TransitionAnimation, TransitionTrigger};

        let cmd = SerializableCommand::AddTransition {
            transition: Transition {
                id: make_uuid(1),
                source_node: NodeId::new(0, 0),
                target_page: PageId::new(make_uuid(10)),
                target_node: None,
                trigger: TransitionTrigger::OnClick,
                animation: TransitionAnimation::Dissolve { duration: 0.3 },
            },
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: SerializableCommand = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_broadcast_set_override_round_trip() {
        use crate::component::{OverrideKey, PropertyPath};

        let cmd = BroadcastCommand::SetOverride {
            node_id: NodeId::new(0, 0),
            key: OverrideKey::new(make_uuid(5), PropertyPath::Visible),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: BroadcastCommand = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_all_serializable_variants_to_broadcast() {
        // Verify the From conversion compiles for a representative sample
        let commands: Vec<SerializableCommand> = vec![
            SerializableCommand::SetVisible {
                node_id: NodeId::new(0, 0),
                new_visible: true,
                old_visible: false,
            },
            SerializableCommand::AddToken {
                token: Token::new(
                    TokenId::new(make_uuid(1)),
                    "color.primary".to_string(),
                    crate::token::TokenValue::Number { value: 42.0 },
                    crate::token::TokenType::Number,
                    None,
                )
                .expect("valid"),
            },
        ];

        for cmd in &commands {
            let _broadcast: BroadcastCommand = cmd.into();
        }
    }
}
