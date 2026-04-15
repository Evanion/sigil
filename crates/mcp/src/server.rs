//! `SigilMcpServer` — the MCP `ServerHandler` implementation for Sigil.
//!
//! This module wires together the shared `AppState` (from `agent-designer-state`)
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
    model::{
        Implementation, ListResourcesResult, PaginatedRequestParams, ReadResourceRequestParams,
        ReadResourceResult, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    service::RoleServer,
    tool, tool_router,
};

use agent_designer_state::{AppState, SendDocument};

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
    /// Returns a compact summary of the document: name, page count, node count.
    #[tool(
        name = "get_document_info",
        description = "Get document summary: name, page count, node count"
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

    /// Moves a page to a new position in the page list (zero-based index).
    #[tool(
        name = "reorder_page",
        description = "Move a page to a new position in the page list (zero-based index)"
    )]
    fn reorder_page(
        &self,
        Parameters(input): Parameters<crate::types::ReorderPageInput>,
    ) -> Result<Json<crate::types::PageInfo>, rmcp::ErrorData> {
        crate::tools::pages::reorder_page_impl(&self.state, &input.page_id, input.new_position)
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

    /// Moves a node to a new parent at a specific position.
    #[tool(
        name = "reparent_node",
        description = "Move a node to a new parent at a specific child position. \
                        Used for drag-and-drop reparenting in the layers tree."
    )]
    fn reparent_node(
        &self,
        Parameters(input): Parameters<crate::types::ReparentNodeInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        crate::tools::nodes::reparent_node_impl(
            &self.state,
            &input.uuid,
            &input.new_parent_uuid,
            input.position,
        )
        .map(Json)
        .map_err(|e| e.to_mcp_error())
    }

    /// Reorders a node within its parent's children list.
    #[tool(
        name = "reorder_children",
        description = "Move a node to a new position within its current parent's children list. \
                        Used for drag-and-drop reordering in the layers tree."
    )]
    fn reorder_children(
        &self,
        Parameters(input): Parameters<crate::types::ReorderChildrenInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        crate::tools::nodes::reorder_children_impl(&self.state, &input.uuid, input.new_position)
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

    /// Sets a node's opacity (0.0 = fully transparent, 1.0 = fully opaque).
    #[tool(
        name = "set_opacity",
        description = "Set a node's opacity. Value must be in [0.0, 1.0]."
    )]
    fn set_opacity(
        &self,
        Parameters(input): Parameters<crate::types::SetOpacityInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::nodes::set_opacity_impl(&self.state, &input.uuid, input.opacity)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets a node's blend mode.
    #[tool(
        name = "set_blend_mode",
        description = "Set a node's blend mode (e.g. normal, multiply, screen, overlay, darken, \
                        lighten, color_dodge, color_burn, hard_light, soft_light, difference, \
                        exclusion, hue, saturation, color, luminosity)"
    )]
    fn set_blend_mode(
        &self,
        Parameters(input): Parameters<crate::types::SetBlendModeInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::nodes::set_blend_mode_impl(&self.state, &input.uuid, &input.blend_mode)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets a node's fills array.
    #[tool(
        name = "set_fills",
        description = "Replace a node's fills. Pass an array of fill objects as JSON."
    )]
    fn set_fills(
        &self,
        Parameters(input): Parameters<crate::types::SetFillsInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::nodes::set_fills_impl(&self.state, &input.uuid, &input.fills)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets a node's strokes array.
    #[tool(
        name = "set_strokes",
        description = "Replace a node's strokes. Pass an array of stroke objects as JSON."
    )]
    fn set_strokes(
        &self,
        Parameters(input): Parameters<crate::types::SetStrokesInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::nodes::set_strokes_impl(&self.state, &input.uuid, &input.strokes)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets a node's effects array.
    #[tool(
        name = "set_effects",
        description = "Replace a node's effects. Pass an array of effect objects as JSON."
    )]
    fn set_effects(
        &self,
        Parameters(input): Parameters<crate::types::SetEffectsInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::nodes::set_effects_impl(&self.state, &input.uuid, &input.effects)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets a rectangle node's corner radii.
    #[tool(
        name = "set_corner_radii",
        description = "Set corner radii on a rectangle node. Pass exactly 4 values: \
                        [top-left, top-right, bottom-right, bottom-left]. Each must be >= 0."
    )]
    fn set_corner_radii(
        &self,
        Parameters(input): Parameters<crate::types::SetCornerRadiiInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::nodes::set_corner_radii_impl(&self.state, &input.uuid, &input.radii)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Lists all design tokens in the document.
    #[tool(
        name = "list_tokens",
        description = "List all design tokens in the document, sorted by name"
    )]
    fn list_tokens(&self) -> Result<Json<crate::types::TokenListResult>, rmcp::ErrorData> {
        let tokens =
            crate::tools::tokens::list_tokens_impl(&self.state).map_err(|e| e.to_mcp_error())?;
        Ok(Json(crate::types::TokenListResult { tokens }))
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

    /// Atomically renames a design token from `old_name` to `new_name`.
    #[tool(
        name = "rename_token",
        description = "Atomically rename a design token. Preserves the token's ID, value, type, \
                        and description. Fails if old_name does not exist or new_name is already taken."
    )]
    fn rename_token(
        &self,
        Parameters(input): Parameters<crate::types::RenameTokenInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::tokens::rename_token_impl(&self.state, &input.old_name, &input.new_name)
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

    /// Sets the text content of a text node.
    #[tool(
        name = "set_text_content",
        description = "Set the text content of a text node"
    )]
    fn set_text_content(
        &self,
        Parameters(input): Parameters<crate::types::SetTextContentInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        crate::tools::text::set_text_content_impl(&self.state, &input.uuid, &input.content)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }

    /// Sets text style properties on a text node. Pass only the fields you want
    /// to change; omitted fields are left unchanged.
    #[tool(
        name = "set_text_style",
        description = "Set text style properties. Pass only fields to change. Fields: font_family, \
                        font_size, font_weight, font_style (normal|italic), line_height, \
                        letter_spacing, text_align (left|center|right|justify), text_decoration \
                        (none|underline|strikethrough), text_color, text_shadow (null to remove)."
    )]
    fn set_text_style(
        &self,
        Parameters(input): Parameters<crate::types::SetTextStyleInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        crate::tools::text::set_text_style_impl(&self.state, &input.uuid, &input.style)
            .map(Json)
            .map_err(|e| e.to_mcp_error())
    }
}

/// Spawns the MCP server on stdio in a background task.
///
/// This is a convenience function for `main.rs` that encapsulates all MCP
/// transport setup. The caller only needs to provide the shared `AppState`.
///
/// Returns a `JoinHandle` that resolves when the MCP server exits (either
/// because the stdio transport closed or an error occurred).
#[must_use]
pub fn start_stdio(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let server = SigilMcpServer::new(state);
        let (stdin, stdout) = rmcp::transport::io::stdio();
        match rmcp::serve_server(server, (stdin, stdout)).await {
            Ok(running) => {
                if let Err(e) = running.waiting().await {
                    tracing::error!("MCP server error: {e}");
                }
            }
            Err(e) => {
                tracing::error!("MCP server failed to start: {e}");
            }
        }
    })
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
             manage pages and nodes, and define design tokens.",
        )
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListResourcesResult, rmcp::ErrorData>>
    + rmcp::service::MaybeSendFuture
    + '_ {
        std::future::ready(Ok(ListResourcesResult::with_all_items(
            crate::resources::list_resources(),
        )))
    }

    fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ReadResourceResult, rmcp::ErrorData>>
    + rmcp::service::MaybeSendFuture
    + '_ {
        std::future::ready(
            crate::resources::read_resource(&self.state, &request.uri).map(ReadResourceResult::new),
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
