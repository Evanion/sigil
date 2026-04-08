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

/// A forward-only mutation on a Document.
///
/// Field operations validate their inputs and apply the change.
/// Undo is handled by the frontend's operation model, not by commands.
/// No `Send + Sync` bounds — WASM targets don't support them.
pub trait FieldOperation: std::fmt::Debug {
    /// Validate that this operation can be applied to the current document state.
    ///
    /// # Errors
    ///
    /// Returns `CoreError` if the operation cannot be applied (e.g., referenced
    /// node does not exist, invalid field values).
    fn validate(&self, doc: &Document) -> Result<(), CoreError>;

    /// Apply this operation to the document.
    ///
    /// # Errors
    ///
    /// Returns `CoreError` if the operation cannot be applied to the current
    /// document state.
    fn apply(&self, doc: &mut Document) -> Result<(), CoreError>;
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
}
