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

impl SideEffect {
    /// Validates all fields in the side effect.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if any field is invalid.
    pub fn validate(&self) -> Result<(), CoreError> {
        match self {
            Self::MoveTokenToWorkfile {
                target_workfile, ..
            }
            | Self::MoveComponentToWorkfile {
                target_workfile, ..
            } => {
                crate::validate::validate_asset_ref(target_workfile)?;
            }
        }
        Ok(())
    }
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

/// Maximum number of sub-commands in a compound command.
pub const MAX_COMPOUND_COMMANDS: usize = 10_000;

/// Maximum length of a compound command description.
const MAX_COMPOUND_DESCRIPTION_LEN: usize = 1024;

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
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the number of sub-commands
    /// exceeds `MAX_COMPOUND_COMMANDS`.
    pub fn new(commands: Vec<Box<dyn Command>>, description: String) -> Result<Self, CoreError> {
        if commands.len() > MAX_COMPOUND_COMMANDS {
            return Err(CoreError::ValidationError(format!(
                "compound command has {} sub-commands (max {MAX_COMPOUND_COMMANDS})",
                commands.len()
            )));
        }
        let description = if description.len() > MAX_COMPOUND_DESCRIPTION_LEN {
            description[..MAX_COMPOUND_DESCRIPTION_LEN].to_string()
        } else {
            description
        };
        Ok(Self {
            commands,
            description,
        })
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
                    let mut rollback_errors = Vec::new();
                    for cmd_to_undo in self.commands[..i].iter().rev() {
                        if let Err(re) = cmd_to_undo.undo(doc) {
                            rollback_errors.push(re);
                        }
                    }
                    if rollback_errors.is_empty() {
                        return Err(e);
                    }
                    return Err(CoreError::RollbackFailed {
                        original: Box::new(e),
                        rollback_errors,
                    });
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

    #[test]
    fn test_compound_command_applies_all_subcommands() {
        use crate::id::NodeId;
        use crate::node::{Node, NodeKind};

        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            uuid::Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        // Two rename commands in sequence
        let cmd1 = crate::commands::node_commands::RenameNode {
            node_id,
            new_name: "Step 1".to_string(),
            old_name: "Frame".to_string(),
        };
        let cmd2 = crate::commands::node_commands::RenameNode {
            node_id,
            new_name: "Step 2".to_string(),
            old_name: "Step 1".to_string(),
        };

        let compound = CompoundCommand::new(
            vec![Box::new(cmd1), Box::new(cmd2)],
            "Rename twice".to_string(),
        )
        .expect("create compound");

        compound.apply(&mut doc).expect("apply compound");
        assert_eq!(doc.arena.get(node_id).expect("get node").name, "Step 2");

        compound.undo(&mut doc).expect("undo compound");
        assert_eq!(doc.arena.get(node_id).expect("get node").name, "Frame");
    }

    #[test]
    fn test_compound_command_description() {
        let compound =
            CompoundCommand::new(vec![], "Test compound".to_string()).expect("create compound");
        assert_eq!(compound.description(), "Test compound");
    }

    #[test]
    fn test_side_effect_validates_path() {
        let valid = SideEffect::MoveTokenToWorkfile {
            token_id: TokenId::new(uuid::Uuid::nil()),
            target_workfile: "tokens/colors.sigil".to_string(),
        };
        assert!(valid.validate().is_ok());

        let invalid_absolute = SideEffect::MoveTokenToWorkfile {
            token_id: TokenId::new(uuid::Uuid::nil()),
            target_workfile: "/etc/passwd".to_string(),
        };
        assert!(invalid_absolute.validate().is_err());

        let invalid_traversal = SideEffect::MoveComponentToWorkfile {
            component_id: ComponentId::new(uuid::Uuid::nil()),
            target_workfile: "../../../secret".to_string(),
        };
        assert!(invalid_traversal.validate().is_err());

        let invalid_empty = SideEffect::MoveTokenToWorkfile {
            token_id: TokenId::new(uuid::Uuid::nil()),
            target_workfile: String::new(),
        };
        assert!(invalid_empty.validate().is_err());
    }

    #[test]
    fn test_compound_command_rollback_on_partial_failure() {
        use crate::id::NodeId;
        use crate::node::{Node, NodeKind};

        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            uuid::Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            NodeKind::Frame { layout: None },
            "Original".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        // cmd1 succeeds, cmd2 targets a nonexistent node and fails
        let cmd1 = crate::commands::node_commands::RenameNode {
            node_id,
            new_name: "Renamed".to_string(),
            old_name: "Original".to_string(),
        };
        let bad_id = NodeId::new(99, 0);
        let cmd2 = crate::commands::node_commands::RenameNode {
            node_id: bad_id,
            new_name: "Bad".to_string(),
            old_name: "Whatever".to_string(),
        };

        let compound = CompoundCommand::new(
            vec![Box::new(cmd1), Box::new(cmd2)],
            "Should rollback".to_string(),
        )
        .expect("create compound");

        let result = compound.apply(&mut doc);
        assert!(result.is_err());
        // Verify rollback: name should be back to "Original"
        assert_eq!(doc.arena.get(node_id).expect("get node").name, "Original");
    }

    #[test]
    fn test_compound_command_empty_is_noop() {
        let mut doc = Document::new("Test".to_string());
        let compound = CompoundCommand::new(vec![], "Empty".to_string()).expect("create compound");
        let effects = compound.apply(&mut doc).expect("apply empty");
        assert!(effects.is_empty());
        let effects = compound.undo(&mut doc).expect("undo empty");
        assert!(effects.is_empty());
    }
}
