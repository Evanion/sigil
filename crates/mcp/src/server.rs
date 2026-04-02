//! `SigilMcpServer` — the MCP `ServerHandler` implementation for Sigil.
//!
//! This module wires together the shared `AppState` (from `agent-designer-server`)
//! and the rmcp `ToolRouter` so that MCP clients can discover and call Sigil's
//! tools and resources.
//!
//! ## Usage
//!
//! ```rust,ignore
//! let state = AppState::new();
//! let server = SigilMcpServer::new(state);
//! // Pass `server` to `rmcp::serve_server(…)`.
//! ```

use std::sync::MutexGuard;

use rmcp::{
    ServerHandler,
    handler::server::router::tool::ToolRouter,
    model::{Implementation, ServerCapabilities, ServerInfo},
    tool_router,
};

use agent_designer_server::state::{AppState, SendDocument};

/// The MCP server for Sigil.
///
/// Holds shared application state and a `ToolRouter` that dispatches
/// incoming `tools/call` requests to the appropriate handler.
#[derive(Clone)]
pub struct SigilMcpServer {
    /// Shared in-memory document state, owned by the server process.
    pub state: AppState,
    /// Tool dispatch table, built at construction time via `#[tool_router]`.
    ///
    /// The field appears unused to dead-code analysis because the `#[tool_router]`
    /// macro reads it through a generated method, not via a direct field access.
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl SigilMcpServer {
    /// Creates a new `SigilMcpServer` wrapping the given `AppState`.
    #[must_use]
    pub fn new(state: AppState) -> Self {
        Self {
            state,
            tool_router: Self::tool_router(),
        }
    }

    /// Acquires the document mutex, recovering from poisoning.
    ///
    /// Mirrors the same helper in `crates/server/src/graphql/mutation.rs`.
    /// The lock must **never** be held across an `.await` point.
    pub fn acquire_document_lock(&self) -> MutexGuard<'_, SendDocument> {
        match self.state.document.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                tracing::error!("document mutex poisoned in MCP handler, recovering");
                poisoned.into_inner()
            }
        }
    }
}

// Empty tool router for now — tools are added in later tasks.
#[tool_router]
impl SigilMcpServer {}

impl ServerHandler for SigilMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("sigil", env!("CARGO_PKG_VERSION")))
        .with_instructions(
            "Sigil is an AI-native design tool. \
             Use the available tools to read and modify design documents, \
             manage pages and nodes, define design tokens, and undo/redo changes.",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_get_info_returns_sigil_info() {
        let state = AppState::new();
        let server = SigilMcpServer::new(state);
        let info = server.get_info();

        assert_eq!(info.server_info.name, "sigil");
        assert!(
            info.capabilities.tools.is_some(),
            "tools capability must be enabled"
        );
        assert!(
            info.capabilities.resources.is_some(),
            "resources capability must be enabled"
        );
        assert!(
            info.instructions.is_some(),
            "instructions must be present for agents"
        );
    }
}
