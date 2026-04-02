// crates/server/src/dispatch.rs

//! Converts wire-format [`SerializableCommand`] variants into executable
//! [`Command`] trait objects that the document engine can apply.

use agent_designer_core::{
    Command,
    commands::{
        component_commands::{AddComponent, RemoveComponent, RemoveOverride, SetOverride},
        node_commands::{
            CreateNode, DeleteNode, RenameNode, SetLocked, SetTextContent, SetVisible,
        },
        style_commands::{
            SetBlendMode, SetConstraints, SetEffects, SetFills, SetOpacity, SetStrokes,
            SetTransform,
        },
        token_commands::{AddToken, RemoveToken, UpdateToken},
        transition_commands::{AddTransition, RemoveTransition, UpdateTransition},
        tree_commands::{ReorderChildren, ReparentNode},
    },
    wire::SerializableCommand,
};

/// Converts a wire-format command into an executable `Command` trait object.
///
/// Each [`SerializableCommand`] variant maps 1:1 to a concrete command struct
/// from `agent_designer_core::commands`. The server calls this function after
/// deserializing a client message, then passes the result to
/// `Document::execute`.
///
/// # Errors
///
/// Returns an error if the command cannot be converted. Currently all variants
/// are infallible, but the signature returns `Result` for forward-compatibility
/// with variants that may require server-side enrichment (e.g., UUID generation).
#[allow(clippy::too_many_lines, clippy::unnecessary_wraps)]
pub fn dispatch(cmd: SerializableCommand) -> anyhow::Result<Box<dyn Command>> {
    let command: Box<dyn Command> = match cmd {
        // ── Node commands ────────────────────────────────────────────
        SerializableCommand::CreateNode {
            node_id,
            uuid,
            kind,
            name,
            page_id,
        } => Box::new(CreateNode {
            node_id,
            uuid,
            kind,
            name,
            page_id,
            initial_transform: None,
        }),

        SerializableCommand::DeleteNode {
            node_id,
            snapshot,
            page_id,
            page_root_index,
            parent_id,
            parent_child_index,
        } => Box::new(DeleteNode {
            node_id,
            // Wire format boxes the snapshot to avoid inflating enum size;
            // the command struct stores it unboxed.
            snapshot: snapshot.map(|boxed| *boxed),
            page_id,
            page_root_index,
            parent_id,
            parent_child_index,
        }),

        SerializableCommand::RenameNode {
            node_id,
            new_name,
            old_name,
        } => Box::new(RenameNode {
            node_id,
            new_name,
            old_name,
        }),

        SerializableCommand::SetVisible {
            node_id,
            new_visible,
            old_visible,
        } => Box::new(SetVisible {
            node_id,
            new_visible,
            old_visible,
        }),

        SerializableCommand::SetLocked {
            node_id,
            new_locked,
            old_locked,
        } => Box::new(SetLocked {
            node_id,
            new_locked,
            old_locked,
        }),

        SerializableCommand::SetTextContent {
            node_id,
            new_content,
            old_content,
        } => Box::new(SetTextContent {
            node_id,
            new_content,
            old_content,
        }),

        // ── Style commands ───────────────────────────────────────────
        SerializableCommand::SetTransform {
            node_id,
            new_transform,
            old_transform,
        } => Box::new(SetTransform {
            node_id,
            new_transform,
            old_transform,
        }),

        SerializableCommand::SetFills {
            node_id,
            new_fills,
            old_fills,
        } => Box::new(SetFills {
            node_id,
            new_fills,
            old_fills,
        }),

        SerializableCommand::SetStrokes {
            node_id,
            new_strokes,
            old_strokes,
        } => Box::new(SetStrokes {
            node_id,
            new_strokes,
            old_strokes,
        }),

        SerializableCommand::SetOpacity {
            node_id,
            new_opacity,
            old_opacity,
        } => Box::new(SetOpacity {
            node_id,
            new_opacity,
            old_opacity,
        }),

        SerializableCommand::SetBlendMode {
            node_id,
            new_blend_mode,
            old_blend_mode,
        } => Box::new(SetBlendMode {
            node_id,
            new_blend_mode,
            old_blend_mode,
        }),

        SerializableCommand::SetEffects {
            node_id,
            new_effects,
            old_effects,
        } => Box::new(SetEffects {
            node_id,
            new_effects,
            old_effects,
        }),

        SerializableCommand::SetConstraints {
            node_id,
            new_constraints,
            old_constraints,
        } => Box::new(SetConstraints {
            node_id,
            new_constraints,
            old_constraints,
        }),

        // ── Tree commands ────────────────────────────────────────────
        SerializableCommand::ReparentNode {
            node_id,
            new_parent_id,
            new_position,
            old_parent_id,
            old_position,
        } => Box::new(ReparentNode {
            node_id,
            new_parent_id,
            new_position,
            old_parent_id,
            old_position,
        }),

        SerializableCommand::ReorderChildren {
            node_id,
            new_position,
            old_position,
        } => Box::new(ReorderChildren {
            node_id,
            new_position,
            old_position,
        }),

        // ── Transition commands ──────────────────────────────────────
        SerializableCommand::AddTransition { transition } => Box::new(AddTransition { transition }),

        SerializableCommand::RemoveTransition {
            transition_id,
            snapshot,
        } => Box::new(RemoveTransition {
            transition_id,
            snapshot,
        }),

        SerializableCommand::UpdateTransition {
            transition_id,
            new_transition,
            old_transition,
        } => Box::new(UpdateTransition {
            transition_id,
            new_transition,
            old_transition,
        }),

        // ── Token commands ───────────────────────────────────────────
        SerializableCommand::AddToken { token } => Box::new(AddToken { token }),

        SerializableCommand::RemoveToken {
            token_name,
            snapshot,
        } => Box::new(RemoveToken {
            token_name,
            snapshot,
        }),

        SerializableCommand::UpdateToken {
            new_token,
            old_token,
        } => Box::new(UpdateToken {
            new_token,
            old_token,
        }),

        // ── Component commands ───────────────────────────────────────
        SerializableCommand::AddComponent { component } => Box::new(AddComponent { component }),

        SerializableCommand::RemoveComponent {
            component_id,
            snapshot,
        } => Box::new(RemoveComponent {
            component_id,
            snapshot,
        }),

        SerializableCommand::SetOverride {
            node_id,
            key,
            new_value,
            new_source,
            old_entry,
        } => Box::new(SetOverride {
            node_id,
            key,
            new_value,
            new_source,
            old_entry,
        }),

        SerializableCommand::RemoveOverride {
            node_id,
            key,
            old_entry,
        } => Box::new(RemoveOverride {
            node_id,
            key,
            old_entry,
        }),
    };
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_designer_core::{NodeId, NodeKind, SerializableCommand};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    #[test]
    fn test_dispatch_create_node_returns_command() {
        let cmd = SerializableCommand::CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: make_uuid(1),
            kind: NodeKind::Frame { layout: None },
            name: "Frame".to_string(),
            page_id: None,
        };
        let result = dispatch(cmd);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().description(), "Create node");
    }

    #[test]
    fn test_dispatch_set_visible_returns_command() {
        let cmd = SerializableCommand::SetVisible {
            node_id: NodeId::new(0, 0),
            new_visible: false,
            old_visible: true,
        };
        let result = dispatch(cmd);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().description(), "Set visibility");
    }

    #[test]
    fn test_dispatch_delete_node_unboxes_snapshot() {
        use agent_designer_core::Node;

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(42),
            NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            "Rect".to_string(),
        )
        .expect("valid node");

        let cmd = SerializableCommand::DeleteNode {
            node_id: NodeId::new(0, 0),
            snapshot: Some(Box::new(node)),
            page_id: None,
            page_root_index: None,
            parent_id: None,
            parent_child_index: None,
        };
        let result = dispatch(cmd);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().description(), "Delete node");
    }

    /// Compile-time assertion that all concrete command types are `Send`.
    /// This validates the safety of the `SendDocument` unsafe impl.
    #[test]
    fn test_all_concrete_command_types_are_send() {
        fn assert_send<T: Send>() {}

        assert_send::<CreateNode>();
        assert_send::<DeleteNode>();
        assert_send::<RenameNode>();
        assert_send::<SetVisible>();
        assert_send::<SetLocked>();
        assert_send::<SetTextContent>();
        assert_send::<SetTransform>();
        assert_send::<SetFills>();
        assert_send::<SetStrokes>();
        assert_send::<SetOpacity>();
        assert_send::<SetBlendMode>();
        assert_send::<SetEffects>();
        assert_send::<SetConstraints>();
        assert_send::<ReparentNode>();
        assert_send::<ReorderChildren>();
        assert_send::<AddTransition>();
        assert_send::<RemoveTransition>();
        assert_send::<UpdateTransition>();
        assert_send::<AddToken>();
        assert_send::<RemoveToken>();
        assert_send::<UpdateToken>();
        assert_send::<AddComponent>();
        assert_send::<RemoveComponent>();
        assert_send::<SetOverride>();
        assert_send::<RemoveOverride>();
    }

    /// Compile-time assertion that `SendDocument` is `Send + Sync`.
    #[test]
    fn test_send_document_is_send_and_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<crate::state::SendDocument>();
    }
}
