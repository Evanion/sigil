// crates/core/src/command.rs

use serde::{Deserialize, Serialize};

use crate::document::Document;
use crate::error::CoreError;
use crate::id::{ComponentId, TokenId};

/// Side effects that the server must execute after a command completes.
/// Core has no I/O, so these are returned to the caller for execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SideEffect {
    MoveTokenToWorkfile {
        token_id: TokenId,
        target_workfile: String,
    },
    MoveComponentToWorkfile {
        component_id: ComponentId,
        target_workfile: String,
    },
}

/// A reversible mutation on a Document.
///
/// Commands capture everything needed to apply and reverse the operation.
/// No `Send + Sync` bounds — WASM targets don't support them.
pub trait Command: std::fmt::Debug {
    /// Apply this command to the document, returning any side effects.
    ///
    /// # Errors
    ///
    /// Returns `CoreError` if the command cannot be applied to the current
    /// document state (e.g., referenced node does not exist).
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError>;

    /// Reverse this command, restoring the document to its prior state.
    ///
    /// # Errors
    ///
    /// Returns `CoreError` if the undo cannot be performed (e.g., the
    /// document state does not match what the command expects).
    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError>;

    /// A human-readable description of this command (for UI display).
    fn description(&self) -> &str;
}

/// A command that applies multiple sub-commands as one atomic unit.
///
/// If any sub-command fails during `apply`, all previously applied
/// sub-commands are undone in reverse order (rollback).
#[derive(Debug)]
pub struct CompoundCommand {
    commands: Vec<Box<dyn Command>>,
    description: String,
}

impl CompoundCommand {
    /// Creates a new compound command.
    #[must_use]
    pub fn new(commands: Vec<Box<dyn Command>>, description: String) -> Self {
        Self {
            commands,
            description,
        }
    }
}

impl Command for CompoundCommand {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let mut all_effects = Vec::new();
        for (i, cmd) in self.commands.iter().enumerate() {
            match cmd.apply(doc) {
                Ok(effects) => all_effects.extend(effects),
                Err(e) => {
                    // Rollback: undo commands 0..i in reverse order
                    for cmd_to_undo in self.commands[..i].iter().rev() {
                        // Best-effort rollback — if undo itself fails, we're in a bad state.
                        // The spec says "the original error is returned with rollback context."
                        let _ = cmd_to_undo.undo(doc);
                    }
                    return Err(e);
                }
            }
        }
        Ok(all_effects)
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let mut all_effects = Vec::new();
        for cmd in self.commands.iter().rev() {
            let effects = cmd.undo(doc)?;
            all_effects.extend(effects);
        }
        Ok(all_effects)
    }

    fn description(&self) -> &str {
        &self.description
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_side_effect_serde_round_trip() {
        let effect = SideEffect::MoveTokenToWorkfile {
            token_id: TokenId::new(uuid::Uuid::nil()),
            target_workfile: "tokens/colors.sigil".to_string(),
        };
        let json = serde_json::to_string(&effect).expect("serialize");
        let deserialized: SideEffect = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(effect, deserialized);
    }

    #[test]
    fn test_side_effect_component_variant() {
        let effect = SideEffect::MoveComponentToWorkfile {
            component_id: ComponentId::new(uuid::Uuid::nil()),
            target_workfile: "components/buttons.sigil".to_string(),
        };
        let json = serde_json::to_string(&effect).expect("serialize");
        let deserialized: SideEffect = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(effect, deserialized);
    }

    // TODO: uncomment after Task 5 (RenameNode)
    // #[test]
    // fn test_compound_command_applies_all_subcommands() {
    //     use crate::node::{Node, NodeKind};
    //     use crate::id::NodeId;
    //
    //     let mut doc = Document::new("Test".to_string());
    //     let node = Node::new(
    //         NodeId::new(0, 0),
    //         uuid::Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    //         NodeKind::Frame { layout: None },
    //         "Frame".to_string(),
    //     )
    //     .expect("create node");
    //     let node_id = doc.arena.insert(node).expect("insert");
    //
    //     // Two rename commands in sequence
    //     let cmd1 = super::super::commands::node_commands::RenameNode {
    //         node_id,
    //         new_name: "Step 1".to_string(),
    //         old_name: "Frame".to_string(),
    //     };
    //     let cmd2 = super::super::commands::node_commands::RenameNode {
    //         node_id,
    //         new_name: "Step 2".to_string(),
    //         old_name: "Step 1".to_string(),
    //     };
    //
    //     let compound = CompoundCommand::new(
    //         vec![Box::new(cmd1), Box::new(cmd2)],
    //         "Rename twice".to_string(),
    //     );
    //
    //     compound.apply(&mut doc).expect("apply compound");
    //     assert_eq!(doc.arena.get(node_id).unwrap().name, "Step 2");
    //
    //     compound.undo(&mut doc).expect("undo compound");
    //     assert_eq!(doc.arena.get(node_id).unwrap().name, "Frame");
    // }

    #[test]
    fn test_compound_command_description() {
        let compound = CompoundCommand::new(vec![], "Test compound".to_string());
        assert_eq!(compound.description(), "Test compound");
    }

    #[test]
    fn test_compound_command_empty_is_noop() {
        let mut doc = Document::new("Test".to_string());
        let compound = CompoundCommand::new(vec![], "Empty".to_string());
        let effects = compound.apply(&mut doc).expect("apply empty");
        assert!(effects.is_empty());
        let effects = compound.undo(&mut doc).expect("undo empty");
        assert!(effects.is_empty());
    }
}
