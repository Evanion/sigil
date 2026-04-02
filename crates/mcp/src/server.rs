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
    handler::server::wrapper::{Json, Parameters},
    model::{Implementation, ServerCapabilities, ServerInfo},
    tool, tool_router,
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
}

/// Acquires the document lock from an `AppState`, recovering from mutex poisoning.
///
/// This is a free function (not a method) so tool implementation modules can
/// call it without needing a reference to the full `SigilMcpServer`.
/// The lock must **never** be held across an `.await` point.
pub fn acquire_document_lock(state: &AppState) -> MutexGuard<'_, SendDocument> {
    match state.document.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::error!("document mutex poisoned in MCP handler, recovering");
            poisoned.into_inner()
        }
    }
}

#[tool_router]
impl SigilMcpServer {
    /// Returns a compact summary of the document: name, page count, node count,
    /// and undo/redo availability.
    #[tool(
        name = "get_document_info",
        description = "Get document summary: name, page count, node count, undo/redo availability"
    )]
    fn get_document_info(&self) -> Json<crate::types::DocumentInfo> {
        Json(crate::tools::document::get_document_info_impl(&self.state))
    }

    /// Returns the full document tree: all pages with their node hierarchies in
    /// a flattened, depth-first list. Use the `children` field to reconstruct the
    /// hierarchy.
    #[tool(
        name = "get_document_tree",
        description = "Get the full document tree: all pages with their node hierarchies"
    )]
    fn get_document_tree(&self) -> Json<crate::types::DocumentTree> {
        Json(crate::tools::document::get_document_tree_impl(&self.state))
    }

    /// Lists all pages in the document with their root node UUIDs.
    #[tool(
        name = "list_pages",
        description = "List all pages in the document with their root node UUIDs"
    )]
    fn list_pages(&self) -> Json<crate::types::PageListResult> {
        Json(crate::types::PageListResult {
            pages: crate::tools::pages::list_pages_impl(&self.state),
        })
    }

    /// Creates a new page in the document.
    #[tool(
        name = "create_page",
        description = "Create a new page in the document"
    )]
    fn create_page(
        &self,
        Parameters(input): Parameters<crate::types::CreatePageInput>,
    ) -> Result<Json<crate::types::PageInfo>, rmcp::ErrorData> {
        crate::tools::pages::create_page_impl(&self.state, &input.name)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Deletes a page by UUID.
    #[tool(name = "delete_page", description = "Delete a page by UUID")]
    fn delete_page(
        &self,
        Parameters(input): Parameters<crate::types::DeletePageInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::pages::delete_page_impl(&self.state, &input.page_id)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Renames a page identified by UUID.
    #[tool(name = "rename_page", description = "Rename a page")]
    fn rename_page(
        &self,
        Parameters(input): Parameters<crate::types::RenamePageInput>,
    ) -> Result<Json<crate::types::PageInfo>, rmcp::ErrorData> {
        crate::tools::pages::rename_page_impl(&self.state, &input.page_id, &input.new_name)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }
}

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
