//! Token operation tools — list, create, update, delete.
//!
//! All mutations follow the pattern:
//!   lock → construct operation →
//!   `op.validate(&doc)?; op.apply(&mut doc)?;` → build response → drop lock → `signal_dirty`
//!
//! The `TokenValue` for create/update is passed in as a raw `serde_json::Value`
//! and deserialized into `TokenValue` inside the tool. Validation is performed
//! by `Token::new` (which calls `validate_token_name` and `validate_token_value`).

use agent_designer_core::{
    FieldOperation, Token, TokenId, TokenType, TokenValue,
    commands::token_commands::{AddToken, RemoveToken, UpdateToken},
};
use agent_designer_state::{AppState, MutationEvent, MutationEventKind};

use crate::error::McpToolError;
use crate::server::acquire_document_lock;
use crate::types::{CreateTokenInput, MutationResult, TokenInfo, UpdateTokenInput};

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Converts a `Token` to a `TokenInfo` for MCP output.
///
/// # Errors
///
/// Returns `McpToolError::SerializationError` if the token value cannot be
/// serialized to JSON.
fn token_to_info(token: &Token) -> Result<TokenInfo, McpToolError> {
    Ok(TokenInfo {
        name: token.name().to_string(),
        token_type: token_type_to_string(token.token_type()),
        value: serde_json::to_value(token.value())?,
        description: token.description().map(str::to_string),
    })
}

/// Serializes a `TokenType` to its lowercase string representation.
fn token_type_to_string(tt: TokenType) -> String {
    match tt {
        TokenType::Color => "color",
        TokenType::Dimension => "dimension",
        TokenType::FontFamily => "font_family",
        TokenType::FontWeight => "font_weight",
        TokenType::Duration => "duration",
        TokenType::CubicBezier => "cubic_bezier",
        TokenType::Number => "number",
        TokenType::Shadow => "shadow",
        TokenType::Gradient => "gradient",
        TokenType::Typography => "typography",
    }
    .to_string()
}

/// Parses a string into a `TokenType`.
///
/// # Errors
///
/// Returns `McpToolError::InvalidInput` if the string does not match a known type.
pub fn parse_token_type(s: &str) -> Result<TokenType, McpToolError> {
    match s {
        "color" => Ok(TokenType::Color),
        "dimension" => Ok(TokenType::Dimension),
        "font_family" => Ok(TokenType::FontFamily),
        "font_weight" => Ok(TokenType::FontWeight),
        "duration" => Ok(TokenType::Duration),
        "cubic_bezier" => Ok(TokenType::CubicBezier),
        "number" => Ok(TokenType::Number),
        "shadow" => Ok(TokenType::Shadow),
        "gradient" => Ok(TokenType::Gradient),
        "typography" => Ok(TokenType::Typography),
        other => Err(McpToolError::InvalidInput(format!(
            "unknown token type '{other}': expected one of color, dimension, font_family, \
             font_weight, duration, cubic_bezier, number, shadow, gradient, typography"
        ))),
    }
}

// ── Tool implementations ─────────────────────────────────────────────────────

/// Lists all tokens in the document's token context.
///
/// # Errors
///
/// Returns `McpToolError::SerializationError` if any token value cannot be
/// serialized to JSON.
pub fn list_tokens_impl(state: &AppState) -> Result<Vec<TokenInfo>, McpToolError> {
    let doc = acquire_document_lock(state);
    // Collect into a Vec and sort by name for stable, deterministic output.
    let mut tokens: Vec<TokenInfo> = doc
        .token_context
        .iter()
        .map(|(_, token)| token_to_info(token))
        .collect::<Result<Vec<_>, _>>()?;
    tokens.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(tokens)
}

/// Creates a new design token.
///
/// Parses the token type string and deserializes the value JSON, then
/// constructs the `Token` (which runs all validation), and executes
/// `AddToken` via `validate` then `apply`.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` for an unknown token type.
/// - `McpToolError::SerializationError` if the value JSON cannot be deserialized
///   into the corresponding `TokenValue` variant.
/// - `McpToolError::CoreError` if `Token::new` validation fails or the token
///   context is at capacity.
pub fn create_token_impl(
    state: &AppState,
    input: &CreateTokenInput,
) -> Result<TokenInfo, McpToolError> {
    let token_type = parse_token_type(&input.token_type)?;
    let token_value: TokenValue = serde_json::from_value(input.value.clone())?;
    let token_id = TokenId::new(uuid::Uuid::new_v4());
    let token = Token::new(
        token_id,
        input.name.clone(),
        token_value,
        token_type,
        input.description.clone(),
    )?;

    let info = token_to_info(&token)?;

    {
        let mut doc = acquire_document_lock(state);
        let cmd = AddToken { token };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::TokenCreated,
        uuid: None,
        data: Some(serde_json::json!({"name": input.name})),
        transaction: None,
    });
    Ok(info)
}

/// Updates an existing token with new type, value, and/or description.
///
/// Looks up the existing token by name (returns `TokenNotFound` if absent),
/// constructs a new `Token` with the same name, then executes `UpdateToken`.
///
/// # Errors
///
/// - `McpToolError::TokenNotFound` if no token with `input.name` exists.
/// - `McpToolError::InvalidInput` for an unknown token type.
/// - `McpToolError::SerializationError` if the value JSON cannot be deserialized.
/// - `McpToolError::CoreError` if `Token::new` validation fails.
pub fn update_token_impl(
    state: &AppState,
    input: &UpdateTokenInput,
) -> Result<TokenInfo, McpToolError> {
    let token_type = parse_token_type(&input.token_type)?;
    let token_value: TokenValue = serde_json::from_value(input.value.clone())?;

    // RF-004: Single lock scope — construct and execute atomically
    // to prevent TOCTOU races where the token could be modified or deleted
    // between the read and the execute call.
    let info = {
        let mut doc = acquire_document_lock(state);
        let existing = doc
            .token_context
            .get(&input.name)
            .ok_or_else(|| McpToolError::TokenNotFound(input.name.clone()))?;

        let new_token = Token::new(
            existing.id(),
            input.name.clone(),
            token_value,
            token_type,
            input.description.clone(),
        )?;

        let info = token_to_info(&new_token)?;

        let cmd = UpdateToken {
            new_token,
            token_name: input.name.clone(),
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        info
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::TokenUpdated,
        uuid: None,
        data: Some(serde_json::json!({"name": input.name})),
        transaction: None,
    });
    Ok(info)
}

/// Deletes a token by name.
///
/// Looks up the token by name, then executes `RemoveToken`.
///
/// # Errors
///
/// - `McpToolError::TokenNotFound` if no token with `token_name` exists.
/// - `McpToolError::CoreError` on engine-level failures.
pub fn delete_token_impl(
    state: &AppState,
    token_name: &str,
) -> Result<MutationResult, McpToolError> {
    {
        let mut doc = acquire_document_lock(state);
        let cmd = RemoveToken {
            token_name: token_name.to_string(),
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::TokenDeleted,
        uuid: None,
        data: Some(serde_json::json!({"name": token_name})),
        transaction: None,
    });
    Ok(MutationResult {
        success: true,
        message: format!("Token '{token_name}' deleted"),
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use agent_designer_state::AppState;

    use super::*;

    /// Builds a minimal `CreateTokenInput` for a number token.
    fn make_number_input(name: &str, value: f64) -> CreateTokenInput {
        CreateTokenInput {
            name: name.to_string(),
            token_type: "number".to_string(),
            value: serde_json::json!({ "type": "number", "value": value }),
            description: None,
        }
    }

    #[test]
    fn test_list_tokens_empty() {
        let state = AppState::new();
        let tokens = list_tokens_impl(&state).expect("list tokens");
        assert!(tokens.is_empty(), "expected no tokens in fresh document");
    }

    #[test]
    fn test_create_and_list_tokens() {
        let state = AppState::new();
        let input = make_number_input("spacing.md", 16.0);
        let created = create_token_impl(&state, &input).expect("create token");
        assert_eq!(created.name, "spacing.md");
        assert_eq!(created.token_type, "number");

        let tokens = list_tokens_impl(&state).expect("list tokens");
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].name, "spacing.md");
    }

    #[test]
    fn test_update_token() {
        let state = AppState::new();
        let input = make_number_input("spacing.md", 16.0);
        create_token_impl(&state, &input).expect("create token");

        let update = UpdateTokenInput {
            name: "spacing.md".to_string(),
            token_type: "number".to_string(),
            value: serde_json::json!({ "type": "number", "value": 24.0 }),
            description: Some("Updated spacing".to_string()),
        };
        let updated = update_token_impl(&state, &update).expect("update token");
        assert_eq!(updated.name, "spacing.md");
        assert_eq!(updated.description, Some("Updated spacing".to_string()));

        // Verify value changed in the live document.
        let tokens = list_tokens_impl(&state).expect("list tokens");
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].description, Some("Updated spacing".to_string()));
    }

    #[test]
    fn test_delete_token() {
        let state = AppState::new();
        create_token_impl(&state, &make_number_input("spacing.sm", 8.0)).expect("create token");

        let result = delete_token_impl(&state, "spacing.sm").expect("delete token");
        assert!(result.success);
        assert!(list_tokens_impl(&state).expect("list tokens").is_empty());
    }

    #[test]
    fn test_delete_nonexistent_token_returns_error() {
        let state = AppState::new();
        let result = delete_token_impl(&state, "does.not.exist");
        assert!(result.is_err());
        // Token not found error comes from core's validate() via From<CoreError>
        let err = result.unwrap_err();
        assert!(
            matches!(
                err,
                McpToolError::CoreError(agent_designer_core::CoreError::TokenNotFound(_))
            ),
            "expected CoreError(TokenNotFound), got: {err}"
        );
    }

    #[test]
    fn test_invalid_token_type_returns_error() {
        let state = AppState::new();
        let input = CreateTokenInput {
            name: "my.token".to_string(),
            token_type: "not_a_real_type".to_string(),
            value: serde_json::json!(42),
            description: None,
        };
        let result = create_token_impl(&state, &input);
        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), McpToolError::InvalidInput(_)),
            "expected InvalidInput"
        );
    }
}
