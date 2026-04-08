// crates/core/src/commands/token_commands.rs

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::token::Token;

/// Adds a token to the document's token context.
#[derive(Debug)]
pub struct AddToken {
    /// The token to add.
    pub token: Token,
}

impl FieldOperation for AddToken {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if doc.token_context.get(self.token.name()).is_some() {
            return Err(CoreError::ValidationError(format!(
                "token '{}' already exists",
                self.token.name()
            )));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.token_context.insert(self.token.clone())?;
        Ok(())
    }
}

/// Removes a token from the document's token context.
#[derive(Debug)]
pub struct RemoveToken {
    /// The name of the token to remove.
    pub token_name: String,
}

impl FieldOperation for RemoveToken {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if doc.token_context.get(&self.token_name).is_none() {
            return Err(CoreError::TokenNotFound(self.token_name.clone()));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.token_context
            .remove(&self.token_name)
            .ok_or_else(|| CoreError::TokenNotFound(self.token_name.clone()))?;
        Ok(())
    }
}

/// Replaces a token with a new version (same name, different value/type/description).
#[derive(Debug)]
pub struct UpdateToken {
    /// The new token (must have the same name as the existing one).
    pub new_token: Token,
    /// The name of the existing token being updated.
    pub token_name: String,
}

impl FieldOperation for UpdateToken {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if self.new_token.name() != self.token_name {
            return Err(CoreError::ValidationError(format!(
                "UpdateToken: name mismatch — new='{}', expected='{}'",
                self.new_token.name(),
                self.token_name
            )));
        }
        if doc.token_context.get(&self.token_name).is_none() {
            return Err(CoreError::TokenNotFound(self.token_name.clone()));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        if doc.token_context.get(&self.token_name).is_none() {
            return Err(CoreError::TokenNotFound(self.token_name.clone()));
        }
        // Token::new already validated the new token at construction time.
        // Re-insert replaces the existing entry.
        doc.token_context.insert(self.new_token.clone())?;
        Ok(())
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
    fn test_add_token_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let op = AddToken {
            token: make_color_token("color.primary"),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(doc.token_context.get("color.primary").is_some());
    }

    #[test]
    fn test_add_token_validate_rejects_duplicate() {
        let mut doc = Document::new("Test".to_string());
        let token = make_color_token("color.primary");
        doc.token_context.insert(token).expect("insert");

        let op = AddToken {
            token: make_color_token("color.primary"),
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_remove_token_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let token = make_color_token("color.primary");
        doc.token_context.insert(token).expect("insert");

        let op = RemoveToken {
            token_name: "color.primary".to_string(),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(doc.token_context.is_empty());
    }

    #[test]
    fn test_remove_nonexistent_token() {
        let doc = Document::new("Test".to_string());
        let op = RemoveToken {
            token_name: "nonexistent".to_string(),
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_update_token_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let old = make_color_token("color.primary");
        doc.token_context.insert(old).expect("insert");

        let new = Token::new(
            TokenId::new(make_uuid(1)),
            "color.primary".to_string(),
            TokenValue::Number { value: 42.0 },
            TokenType::Number,
            Some("Updated".to_string()),
        )
        .expect("valid");

        let op = UpdateToken {
            new_token: new,
            token_name: "color.primary".to_string(),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        let resolved = doc.token_context.get("color.primary").expect("get");
        assert!(matches!(resolved.value(), TokenValue::Number { .. }));
    }

    #[test]
    fn test_update_token_nonexistent_returns_token_not_found() {
        let doc = Document::new("Test".to_string());
        let new = Token::new(
            TokenId::new(make_uuid(1)),
            "color.primary".to_string(),
            TokenValue::Number { value: 42.0 },
            TokenType::Number,
            None,
        )
        .expect("valid");

        let op = UpdateToken {
            new_token: new,
            token_name: "color.primary".to_string(),
        };
        let result = op.validate(&doc);
        assert!(matches!(result, Err(CoreError::TokenNotFound(_))));
    }

    #[test]
    fn test_update_token_name_mismatch() {
        let mut doc = Document::new("Test".to_string());
        let old = make_color_token("color.primary");
        doc.token_context.insert(old).expect("insert");

        let new = make_color_token("color.secondary");
        let op = UpdateToken {
            new_token: new,
            token_name: "color.primary".to_string(),
        };
        assert!(op.validate(&doc).is_err());
    }
}
