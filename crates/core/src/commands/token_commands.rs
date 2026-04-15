// crates/core/src/commands/token_commands.rs

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::tokens::Token;
use crate::validate::validate_token_name;

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

/// Atomically renames a token in the document's token context.
///
/// Removes the token under the old name and re-inserts it under the new name,
/// preserving the token's ID, value, type, and description.
#[derive(Debug)]
pub struct RenameToken {
    /// The current name of the token to rename.
    pub old_name: String,
    /// The desired new name for the token.
    pub new_name: String,
}

impl FieldOperation for RenameToken {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        // 1. old_name must exist in token_context
        if doc.token_context.get(&self.old_name).is_none() {
            return Err(CoreError::TokenNotFound(self.old_name.clone()));
        }
        // 2. new_name must be valid
        validate_token_name(&self.new_name)?;
        // 3. new_name must not already exist (unless same as old_name — no-op rename)
        if self.old_name != self.new_name && doc.token_context.get(&self.new_name).is_some() {
            return Err(CoreError::ValidationError(format!(
                "token '{}' already exists",
                self.new_name
            )));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        // No-op if names are the same
        if self.old_name == self.new_name {
            return Ok(());
        }
        // Remove by old name
        let token = doc
            .token_context
            .remove(&self.old_name)
            .ok_or_else(|| CoreError::TokenNotFound(self.old_name.clone()))?;
        // Create new Token with same id but new name
        let renamed = Token::new(
            token.id(),
            self.new_name.clone(),
            token.value().clone(),
            token.token_type(),
            token.description().map(String::from),
        );
        // If Token::new fails, restore the original token before propagating the error
        // (CLAUDE.md: Restore State Before Propagating Errors)
        match renamed {
            Ok(new_token) => {
                // Insert may fail if context is at capacity (though we just removed one, so it shouldn't)
                if let Err(insert_err) = doc.token_context.insert(new_token) {
                    // Restore original token
                    let restore_result = doc.token_context.insert(token);
                    if let Err(restore_err) = restore_result {
                        return Err(CoreError::ValidationError(format!(
                            "rename failed during insert ({insert_err}) and rollback also failed ({restore_err})"
                        )));
                    }
                    return Err(insert_err);
                }
                Ok(())
            }
            Err(e) => {
                // Restore original token
                let restore_result = doc.token_context.insert(token);
                if let Err(restore_err) = restore_result {
                    return Err(CoreError::ValidationError(format!(
                        "rename failed ({e}) and rollback also failed ({restore_err})"
                    )));
                }
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::TokenId;
    use crate::node::Color;
    use crate::tokens::{TokenType, TokenValue};
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

    // ── RenameToken tests ─────────────────────────────────────────────

    #[test]
    fn test_rename_token_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let token = Token::new(
            TokenId::new(make_uuid(1)),
            "color.primary".to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            Some("Primary color".to_string()),
        )
        .expect("valid token");
        doc.token_context.insert(token).expect("insert");

        let op = RenameToken {
            old_name: "color.primary".to_string(),
            new_name: "color.brand".to_string(),
        };
        op.validate(&doc).expect("validate should pass");
        op.apply(&mut doc).expect("apply should succeed");

        // Old name no longer exists
        assert!(doc.token_context.get("color.primary").is_none());
        // New name exists
        let renamed = doc.token_context.get("color.brand").expect("renamed token");
        assert_eq!(renamed.name(), "color.brand");
        // Value, type, description preserved
        assert!(matches!(renamed.value(), TokenValue::Color { .. }));
        assert_eq!(renamed.token_type(), TokenType::Color);
        assert_eq!(renamed.description(), Some("Primary color"));
    }

    #[test]
    fn test_rename_token_preserves_id() {
        let mut doc = Document::new("Test".to_string());
        let original_id = TokenId::new(make_uuid(42));
        let token = Token::new(
            original_id,
            "spacing.sm".to_string(),
            TokenValue::Number { value: 8.0 },
            TokenType::Number,
            None,
        )
        .expect("valid token");
        doc.token_context.insert(token).expect("insert");

        let op = RenameToken {
            old_name: "spacing.sm".to_string(),
            new_name: "spacing.small".to_string(),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let renamed = doc
            .token_context
            .get("spacing.small")
            .expect("renamed token");
        assert_eq!(renamed.id(), original_id);
    }

    #[test]
    fn test_rename_token_validate_rejects_missing() {
        let doc = Document::new("Test".to_string());
        let op = RenameToken {
            old_name: "nonexistent".to_string(),
            new_name: "new.name".to_string(),
        };
        let result = op.validate(&doc);
        assert!(
            matches!(result, Err(CoreError::TokenNotFound(_))),
            "expected TokenNotFound, got: {result:?}"
        );
    }

    #[test]
    fn test_rename_token_validate_rejects_duplicate() {
        let mut doc = Document::new("Test".to_string());
        let token_a = Token::new(
            TokenId::new(make_uuid(1)),
            "color.primary".to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid");
        let token_b = Token::new(
            TokenId::new(make_uuid(2)),
            "color.secondary".to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid");
        doc.token_context.insert(token_a).expect("insert");
        doc.token_context.insert(token_b).expect("insert");

        let op = RenameToken {
            old_name: "color.primary".to_string(),
            new_name: "color.secondary".to_string(),
        };
        let result = op.validate(&doc);
        assert!(
            matches!(result, Err(CoreError::ValidationError(_))),
            "expected ValidationError for duplicate, got: {result:?}"
        );
    }

    #[test]
    fn test_rename_token_same_name_is_noop() {
        let mut doc = Document::new("Test".to_string());
        let token = make_color_token("color.primary");
        doc.token_context.insert(token).expect("insert");

        let op = RenameToken {
            old_name: "color.primary".to_string(),
            new_name: "color.primary".to_string(),
        };
        op.validate(&doc)
            .expect("validate should pass for same name");
        op.apply(&mut doc).expect("apply should succeed as no-op");

        assert!(doc.token_context.get("color.primary").is_some());
    }

    #[test]
    fn test_rename_token_validate_rejects_invalid_new_name() {
        let mut doc = Document::new("Test".to_string());
        let token = make_color_token("color.primary");
        doc.token_context.insert(token).expect("insert");

        let op = RenameToken {
            old_name: "color.primary".to_string(),
            new_name: String::new(), // empty name is invalid
        };
        let result = op.validate(&doc);
        assert!(result.is_err(), "expected error for invalid name");
    }
}
