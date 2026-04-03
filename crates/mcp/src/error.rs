//! MCP-specific error types.
//!
//! Uses `thiserror` (library crate convention per CLAUDE.md).

use rmcp::model::ErrorCode;

/// Errors that can occur during MCP tool execution.
#[derive(Debug, thiserror::Error)]
pub enum McpToolError {
    #[error("invalid UUID: {0}")]
    InvalidUuid(String),

    #[error("node not found: {0}")]
    NodeNotFound(String),

    #[error("page not found: {0}")]
    PageNotFound(String),

    #[error("token not found: {0}")]
    TokenNotFound(String),

    #[error("core engine error: {0}")]
    CoreError(#[from] agent_designer_core::CoreError),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
}

impl McpToolError {
    /// Convert to an `rmcp::ErrorData` for returning from tool handlers.
    ///
    /// For `INTERNAL_ERROR` codes, returns a generic message to avoid leaking
    /// implementation details. The full error is logged server-side.
    #[must_use]
    pub fn to_mcp_error(&self) -> rmcp::ErrorData {
        let (code, message) = match self {
            Self::InvalidUuid(_)
            | Self::InvalidInput(_)
            | Self::NodeNotFound(_)
            | Self::PageNotFound(_)
            | Self::TokenNotFound(_) => (ErrorCode::INVALID_PARAMS, self.to_string()),
            Self::CoreError(_) | Self::SerializationError(_) => {
                tracing::error!("MCP internal error: {self}");
                (
                    ErrorCode::INTERNAL_ERROR,
                    "internal error occurred".to_string(),
                )
            }
        };
        rmcp::ErrorData::new(code, message, None)
    }
}
