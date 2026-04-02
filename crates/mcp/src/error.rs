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
    #[must_use]
    pub fn to_mcp_error(&self) -> rmcp::ErrorData {
        let code = match self {
            Self::InvalidUuid(_) | Self::InvalidInput(_) => ErrorCode::INVALID_PARAMS,
            Self::NodeNotFound(_) | Self::PageNotFound(_) | Self::TokenNotFound(_) => {
                ErrorCode::INVALID_PARAMS
            }
            Self::CoreError(_) | Self::SerializationError(_) => ErrorCode::INTERNAL_ERROR,
        };
        rmcp::ErrorData::new(code, self.to_string(), None)
    }
}
