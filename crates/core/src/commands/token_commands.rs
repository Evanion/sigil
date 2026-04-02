// crates/core/src/commands/token_commands.rs
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.
#![allow(clippy::unnecessary_literal_bound)]

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::token::Token;

/// Adds a token to the document's token context.
#[derive(Debug)]
pub struct AddToken {
    /// The token to add.
    pub token: Token,
}

impl Command for AddToken {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.insert(self.token.clone())?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.remove(self.token.name()).ok_or_else(|| {
            CoreError::ValidationError(format!(
                "cannot undo AddToken: token '{}' not found",
                self.token.name()
            ))
        })?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Add token"
    }
}

/// Removes a token from the document's token context.
#[derive(Debug)]
pub struct RemoveToken {
    /// The name of the token to remove.
    pub token_name: String,
    /// Snapshot of the removed token for undo.
    pub snapshot: Token,
}

impl Command for RemoveToken {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context
            .remove(&self.token_name)
            .ok_or_else(|| CoreError::TokenNotFound(self.token_name.clone()))?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.insert(self.snapshot.clone())?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Remove token"
    }
}

/// Replaces a token with a new version (same name, different value/type/description).
#[derive(Debug)]
pub struct UpdateToken {
    /// The new token (must have the same name as the old one).
    pub new_token: Token,
    /// The old token for undo.
    pub old_token: Token,
}

impl Command for UpdateToken {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.new_token.name() != self.old_token.name() {
            return Err(CoreError::ValidationError(format!(
                "UpdateToken: name mismatch — new='{}', old='{}'",
                self.new_token.name(),
                self.old_token.name()
            )));
        }
        if doc.token_context.get(self.old_token.name()).is_none() {
            return Err(CoreError::TokenNotFound(self.old_token.name().to_string()));
        }
        // Token::new already validated the new token at construction time.
        // Re-insert replaces the existing entry.
        doc.token_context.insert(self.new_token.clone())?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.insert(self.old_token.clone())?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Update token"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::TokenId;
    use crate::node::Color;
    use crate::token::{TokenType, TokenValue};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn make_color_token(name: &str) -> Token {
        Token::new(
            TokenId::new(make_uuid(1)),
            name.to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid token")
    }

    #[test]
    fn test_add_token_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let cmd = AddToken {
            token: make_color_token("color.primary"),
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(doc.token_context.get("color.primary").is_some());

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.token_context.get("color.primary").is_none());
    }

    #[test]
    fn test_remove_token_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let token = make_color_token("color.primary");
        doc.token_context.insert(token.clone()).expect("insert");

        let cmd = RemoveToken {
            token_name: "color.primary".to_string(),
            snapshot: token,
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(doc.token_context.is_empty());

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.token_context.get("color.primary").is_some());
    }

    #[test]
    fn test_remove_nonexistent_token() {
        let mut doc = Document::new("Test".to_string());
        let cmd = RemoveToken {
            token_name: "nonexistent".to_string(),
            snapshot: make_color_token("nonexistent"),
        };
        assert!(cmd.apply(&mut doc).is_err());
    }

    #[test]
    fn test_update_token_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let old = make_color_token("color.primary");
        doc.token_context.insert(old.clone()).expect("insert");

        let new = Token::new(
            TokenId::new(make_uuid(1)),
            "color.primary".to_string(),
            TokenValue::Number { value: 42.0 },
            TokenType::Number,
            Some("Updated".to_string()),
        )
        .expect("valid");

        let cmd = UpdateToken {
            new_token: new,
            old_token: old,
        };
        cmd.apply(&mut doc).expect("apply");
        let resolved = doc.token_context.get("color.primary").expect("get");
        assert!(matches!(resolved.value(), TokenValue::Number { .. }));

        cmd.undo(&mut doc).expect("undo");
        let resolved = doc.token_context.get("color.primary").expect("get");
        assert!(matches!(resolved.value(), TokenValue::Color { .. }));
    }

    #[test]
    fn test_update_token_nonexistent_returns_token_not_found() {
        let mut doc = Document::new("Test".to_string());
        let old = make_color_token("color.primary");
        let new = Token::new(
            TokenId::new(make_uuid(1)),
            "color.primary".to_string(),
            TokenValue::Number { value: 42.0 },
            TokenType::Number,
            None,
        )
        .expect("valid");

        let cmd = UpdateToken {
            new_token: new,
            old_token: old,
        };
        let result = cmd.apply(&mut doc);
        assert!(matches!(result, Err(CoreError::TokenNotFound(_))));
    }

    #[test]
    fn test_update_token_name_mismatch() {
        let mut doc = Document::new("Test".to_string());
        let old = make_color_token("color.primary");
        doc.token_context.insert(old.clone()).expect("insert");

        let new = make_color_token("color.secondary");
        let cmd = UpdateToken {
            new_token: new,
            old_token: old,
        };
        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── Integration: execute / undo / redo ────────────────────────────

    #[test]
    fn test_add_token_execute_undo_redo_round_trip() {
        let mut doc = Document::new("Test".to_string());
        let cmd = AddToken {
            token: make_color_token("color.primary"),
        };
        doc.execute(Box::new(cmd)).expect("execute");
        assert!(doc.token_context.get("color.primary").is_some());

        doc.undo().expect("undo");
        assert!(doc.token_context.get("color.primary").is_none());

        doc.redo().expect("redo");
        assert!(doc.token_context.get("color.primary").is_some());
    }
}
