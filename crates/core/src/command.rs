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
}
