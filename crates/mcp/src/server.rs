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

    /// Creates a new node on the specified page, optionally under a parent node.
    #[tool(
        name = "create_node",
        description = "Create a new node (frame, rectangle, ellipse, text, group, image). \
                        Optionally place it on a page and/or under a parent node."
    )]
    fn create_node(
        &self,
        Parameters(input): Parameters<crate::types::CreateNodeInput>,
    ) -> Result<Json<crate::types::CreateNodeResult>, rmcp::ErrorData> {
        crate::tools::nodes::create_node_impl(
            &self.state,
            &input.kind,
            &input.name,
            input.page_id.as_deref(),
            input.parent_uuid.as_deref(),
            input.transform.as_ref(),
        )
        .map(Json)
        .map_err(|e| e.to_mcp_error())
    }

    /// Deletes a node by UUID.
    #[tool(name = "delete_node", description = "Delete a node by UUID")]
    fn delete_node(
        &self,
        Parameters(input): Parameters<crate::types::DeleteNodeInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::nodes::delete_node_impl(&self.state, &input.uuid)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Renames a node identified by UUID.
    #[tool(name = "rename_node", description = "Rename a node")]
    fn rename_node(
        &self,
        Parameters(input): Parameters<crate::types::RenameNodeInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        crate::tools::nodes::rename_node_impl(&self.state, &input.uuid, &input.new_name)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets a node's transform (position, size, rotation, scale).
    #[tool(
        name = "set_transform",
        description = "Set a node's transform: position (x, y), size (width, height), rotation, scale"
    )]
    fn set_transform(
        &self,
        Parameters(input): Parameters<crate::types::SetTransformInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        crate::tools::nodes::set_transform_impl(&self.state, &input.uuid, &input.transform)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets a node's visibility.
    #[tool(name = "set_visible", description = "Show or hide a node")]
    fn set_visible(
        &self,
        Parameters(input): Parameters<crate::types::SetVisibleInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        crate::tools::nodes::set_visible_impl(&self.state, &input.uuid, input.visible)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets a node's locked state.
    #[tool(name = "set_locked", description = "Lock or unlock a node")]
    fn set_locked(
        &self,
        Parameters(input): Parameters<crate::types::SetLockedInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        crate::tools::nodes::set_locked_impl(&self.state, &input.uuid, input.locked)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Lists all design tokens in the document.
    #[tool(
        name = "list_tokens",
        description = "List all design tokens in the document, sorted by name"
    )]
    fn list_tokens(&self) -> Json<crate::types::TokenListResult> {
        Json(crate::types::TokenListResult {
            tokens: crate::tools::tokens::list_tokens_impl(&self.state),
        })
    }

    /// Creates a new design token.
    #[tool(
        name = "create_token",
        description = "Create a new design token. token_type must be one of: color, dimension, \
                        font_family, font_weight, duration, cubic_bezier, number, shadow, \
                        gradient, typography. The value JSON must match the token_type structure."
    )]
    fn create_token(
        &self,
        Parameters(input): Parameters<crate::types::CreateTokenInput>,
    ) -> Result<Json<crate::types::TokenInfo>, rmcp::ErrorData> {
        crate::tools::tokens::create_token_impl(&self.state, &input)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Updates an existing design token's type, value, and/or description.
    #[tool(
        name = "update_token",
        description = "Update an existing design token (identified by name) with a new type, \
                        value, or description"
    )]
    fn update_token(
        &self,
        Parameters(input): Parameters<crate::types::UpdateTokenInput>,
    ) -> Result<Json<crate::types::TokenInfo>, rmcp::ErrorData> {
        crate::tools::tokens::update_token_impl(&self.state, &input)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Deletes a design token by name.
    #[tool(name = "delete_token", description = "Delete a design token by name")]
    fn delete_token(
        &self,
        Parameters(input): Parameters<crate::types::DeleteTokenInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::tokens::delete_token_impl(&self.state, &input.name)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Lists all component definitions in the document.
    #[tool(
        name = "list_components",
        description = "List all component definitions in the document, sorted by name"
    )]
    fn list_components(&self) -> Json<crate::types::ComponentListResult> {
        Json(crate::types::ComponentListResult {
            components: crate::tools::components::list_components_impl(&self.state),
        })
    }

    /// Undoes the most recent document command.
    #[tool(
        name = "undo",
        description = "Undo the most recent document mutation. Returns updated undo/redo availability."
    )]
    fn undo(&self) -> Result<Json<crate::types::UndoRedoResult>, rmcp::ErrorData> {
        crate::tools::history::undo_impl(&self.state)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Redoes the most recently undone document command.
    #[tool(
        name = "redo",
        description = "Redo the most recently undone document mutation. Returns updated undo/redo availability."
    )]
    fn redo(&self) -> Result<Json<crate::types::UndoRedoResult>, rmcp::ErrorData> {
        crate::tools::history::redo_impl(&self.state)
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
