//! `SigilMcpServer` — the MCP `ServerHandler` implementation for Sigil.
//!
//! This module wires together the multi-session [`Sessions`] registry (from
//! `sigil-state`) and the rmcp `ToolRouter` so that MCP clients can discover and
//! call Sigil's tools and resources.
//!
//! ## Usage
//!
//! ```rust,ignore
//! let sessions = Arc::new(Sessions::new(64));
//! let server = SigilMcpServer::new(sessions);
//! // Pass `server` to `rmcp::serve_server(…)`.
//! ```
//!
//! Spec 22b: every tool is session-native. Write `_impl`s are pure functions
//! over `&mut Document`; the [`SigilMcpServer::run_session_scoped`] envelope
//! resolves the session, takes the session store write lock, runs the `_impl`,
//! builds the broadcast `value` from post-mutation state, and publishes the
//! transaction on the session's broadcast channel (which the 22a persistence
//! task and the GraphQL `transactionApplied` subscription both consume). Read
//! tools route through [`SigilMcpServer::run_session_read`] over the session
//! store read lock.

use std::sync::Arc;

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
    tool, tool_handler, tool_router,
};

use sigil_state::Sessions;
use sigil_state::sessions::SessionId;

use crate::session_resolver::{SessionResolveError, resolve_session};

/// The MCP server for Sigil.
///
/// Holds the multi-session [`Sessions`] registry and a `ToolRouter` that
/// dispatches incoming `tools/call` requests to the appropriate handler. Every
/// document read, write, and broadcast flows through a resolved session's
/// store and broadcast channel — there is no legacy single-document store.
#[derive(Clone)]
pub struct SigilMcpServer {
    /// Multi-session registry. In the running server this points at the same
    /// `Sessions` instance the GraphQL resolvers and WebSocket subscribers see,
    /// so the agent's view of which sessions are open — and the document state
    /// it reads and mutates — is identical to the frontend's.
    pub sessions: Arc<Sessions>,
    /// Tool dispatch table, built at construction time via `#[tool_router]`.
    ///
    /// The field appears unused to dead-code analysis because the `#[tool_router]`
    /// macro reads it through a generated method, not via a direct field access.
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl SigilMcpServer {
    /// Creates a new `SigilMcpServer` wrapping the given [`Sessions`] registry.
    #[must_use]
    pub fn new(sessions: Arc<Sessions>) -> Self {
        Self {
            sessions,
            tool_router: Self::tool_router(),
        }
    }

    /// Session-scoped mutation envelope: resolve the session, take the session
    /// store write lock, run the pure `_impl` closure, and publish the resulting
    /// transaction on the session's broadcast channel (which the 22a persistence
    /// task and the GraphQL `transactionApplied` subscription both consume).
    ///
    /// The closure returns the tool's response value plus a fully-built
    /// [`sigil_state::TransactionPayload`] (with `seq = 0`); `session.publish`
    /// stamps the per-session seq before broadcasting. The broadcast `value`
    /// MUST be sourced from post-mutation document state inside the closure.
    ///
    /// # Errors
    /// Returns `Err(rmcp::ErrorData)` when (a) session resolution fails, (b) the
    /// session was closed between resolution and lookup (TOCTOU → `NotFound`), or
    /// (c) the mutation closure returns a `McpToolError`.
    async fn run_session_scoped<T, F>(
        &self,
        explicit_session_id: Option<&str>,
        impl_fn: F,
    ) -> Result<Json<T>, rmcp::ErrorData>
    where
        F: FnOnce(
            &mut sigil_core::Document,
        ) -> Result<
            (
                T,
                sigil_state::MutationEventKind,
                Option<String>,
                sigil_state::TransactionPayload,
            ),
            crate::error::McpToolError,
        >,
    {
        let session_id = resolve_session_or_error(&self.sessions, explicit_session_id)?;
        let session = self.sessions.get(session_id).ok_or_else(|| {
            SessionResolveError::NotFound {
                id: session_id.to_string(),
                open_sessions: vec![],
            }
            .to_rmcp_error()
        })?;

        // RF-002: stamp the per-session seq and broadcast the transaction
        // WHILE STILL HOLDING the store write lock, so apply/seq/broadcast are
        // atomic per session. `session.publish` is synchronous (no `.await`),
        // so holding the write lock across it does not block the runtime.
        let result = {
            let mut guard = session.store.write().await;
            let (result, kind, uuid, transaction) =
                impl_fn(&mut guard.0).map_err(|e| e.to_mcp_error())?;
            session.publish(kind, uuid, transaction);
            result
        };

        Ok(Json(result))
    }

    /// Resolve the session and run a read closure against the session store.
    ///
    /// # Errors
    /// Returns `Err(rmcp::ErrorData)` when session resolution fails, the session
    /// was closed between resolution and lookup, or the read closure errors.
    async fn run_session_read<T, F>(
        &self,
        explicit_session_id: Option<&str>,
        read_fn: F,
    ) -> Result<Json<T>, rmcp::ErrorData>
    where
        F: FnOnce(&sigil_core::Document) -> Result<T, crate::error::McpToolError>,
    {
        let session_id = resolve_session_or_error(&self.sessions, explicit_session_id)?;
        let session = self.sessions.get(session_id).ok_or_else(|| {
            SessionResolveError::NotFound {
                id: session_id.to_string(),
                open_sessions: vec![],
            }
            .to_rmcp_error()
        })?;
        let guard = session.store.read().await;
        let value = read_fn(&guard.0).map_err(|e| e.to_mcp_error())?;
        Ok(Json(value))
    }
}

/// Resolve `params.session_id` to a [`SessionId`] using the three-rule order
/// implemented by [`resolve_session`]. Returns the resolved id on success or
/// a structured `rmcp::ErrorData` (carrying `code` + `open_sessions`) on
/// failure.
///
/// This is the entry point every session-scoped tool uses to gate access to a
/// specific session before reading or mutating its store.
///
/// # Errors
///
/// Returns `Err(rmcp::ErrorData)` when the resolver returns any of the
/// [`SessionResolveError`] variants. The error data carries the structured
/// recovery payload from [`SessionResolveError::to_mcp_error_payload`].
pub fn resolve_session_or_error(
    sessions: &Arc<Sessions>,
    explicit: Option<&str>,
) -> Result<SessionId, rmcp::ErrorData> {
    resolve_session(sessions, explicit).map_err(|e| e.to_rmcp_error())
}

#[tool_router]
impl SigilMcpServer {
    /// Returns a compact summary of the document: name, page count, node count.
    #[tool(
        name = "get_document_info",
        description = "Get document summary: name, page count, node count. Accepts an optional \
                        `session_id` when multiple sessions are open."
    )]
    async fn get_document_info(
        &self,
        Parameters(input): Parameters<crate::types::SessionScopedInput>,
    ) -> Result<Json<crate::types::DocumentInfo>, rmcp::ErrorData> {
        self.run_session_read(input.session_id.as_deref(), |doc| {
            Ok(crate::tools::document::get_document_info_impl(doc))
        })
        .await
    }

    /// Returns the full document tree: all pages with their node hierarchies in
    /// a flattened, depth-first list. Use the `children` field to reconstruct the
    /// hierarchy.
    #[tool(
        name = "get_document_tree",
        description = "Get the full document tree: all pages with their node hierarchies. Accepts \
                        an optional `session_id` when multiple sessions are open."
    )]
    async fn get_document_tree(
        &self,
        Parameters(input): Parameters<crate::types::SessionScopedInput>,
    ) -> Result<Json<crate::types::DocumentTree>, rmcp::ErrorData> {
        self.run_session_read(input.session_id.as_deref(), |doc| {
            Ok(crate::tools::document::get_document_tree_impl(doc))
        })
        .await
    }

    /// Lists all pages in the document with their root node UUIDs.
    #[tool(
        name = "list_pages",
        description = "List all pages in the document with their root node UUIDs. Accepts an \
                        optional `session_id` when multiple sessions are open."
    )]
    async fn list_pages(
        &self,
        Parameters(input): Parameters<crate::types::SessionScopedInput>,
    ) -> Result<Json<crate::types::PageListResult>, rmcp::ErrorData> {
        self.run_session_read(input.session_id.as_deref(), |doc| {
            Ok(crate::types::PageListResult {
                pages: crate::tools::pages::list_pages_impl(doc),
            })
        })
        .await
    }

    /// Creates a new page in the document.
    #[tool(
        name = "create_page",
        description = "Create a new page in the document. Accepts an optional `session_id` \
                        argument when multiple sessions are open; call `list_open_sessions` to \
                        discover available session ids."
    )]
    async fn create_page(
        &self,
        Parameters(input): Parameters<crate::types::CreatePageInput>,
    ) -> Result<Json<crate::types::PageInfo>, rmcp::ErrorData> {
        let name = input.name.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let page = crate::tools::pages::create_page_impl(doc, &name)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &page.id,
                "create_page",
                "page",
                Some(serde_json::json!({"id": page.id, "name": page.name})),
            );
            Ok((page, sigil_state::MutationEventKind::PageCreated, None, tx))
        })
        .await
    }

    /// Deletes a page by UUID.
    #[tool(
        name = "delete_page",
        description = "Delete a page by UUID. Accepts an optional `session_id` when multiple \
                        sessions are open."
    )]
    async fn delete_page(
        &self,
        Parameters(input): Parameters<crate::types::DeletePageInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let page_id = input.page_id.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let result = crate::tools::pages::delete_page_impl(doc, &page_id)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &page_id,
                "delete_page",
                "page",
                None,
            );
            Ok((
                result,
                sigil_state::MutationEventKind::PageDeleted,
                Some(page_id.clone()),
                tx,
            ))
        })
        .await
    }

    /// Renames a page identified by UUID.
    #[tool(
        name = "rename_page",
        description = "Rename a page. Accepts an optional `session_id` when multiple sessions \
                        are open."
    )]
    async fn rename_page(
        &self,
        Parameters(input): Parameters<crate::types::RenamePageInput>,
    ) -> Result<Json<crate::types::PageInfo>, rmcp::ErrorData> {
        let page_id = input.page_id.clone();
        let new_name = input.new_name.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let page = crate::tools::pages::rename_page_impl(doc, &page_id, &new_name)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &page_id,
                "rename_page",
                "name",
                Some(serde_json::json!({"name": new_name})),
            );
            Ok((
                page,
                sigil_state::MutationEventKind::PageUpdated,
                Some(page_id.clone()),
                tx,
            ))
        })
        .await
    }

    /// Moves a page to a new position in the page list (zero-based index).
    #[tool(
        name = "reorder_page",
        description = "Move a page to a new position in the page list (zero-based index). \
                        Accepts an optional `session_id` when multiple sessions are open."
    )]
    async fn reorder_page(
        &self,
        Parameters(input): Parameters<crate::types::ReorderPageInput>,
    ) -> Result<Json<crate::types::PageInfo>, rmcp::ErrorData> {
        let page_id = input.page_id.clone();
        let new_position = input.new_position;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let page = crate::tools::pages::reorder_page_impl(doc, &page_id, new_position)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &page_id,
                "reorder_page",
                "position",
                Some(serde_json::json!({ "newPosition": new_position })),
            );
            Ok((
                page,
                sigil_state::MutationEventKind::PageUpdated,
                Some(page_id.clone()),
                tx,
            ))
        })
        .await
    }

    /// Creates a new node on the specified page, optionally under a parent node.
    #[tool(
        name = "create_node",
        description = "Create a new node (frame, rectangle, ellipse, text, group, image). \
                        Optionally place it on a page and/or under a parent node. Accepts an \
                        optional `session_id` when multiple sessions are open."
    )]
    async fn create_node(
        &self,
        Parameters(input): Parameters<crate::types::CreateNodeInput>,
    ) -> Result<Json<crate::types::CreateNodeResult>, rmcp::ErrorData> {
        let kind = input.kind.clone();
        let name = input.name.clone();
        let page_id = input.page_id.clone();
        let parent_uuid = input.parent_uuid.clone();
        let transform = input.transform;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let created = crate::tools::nodes::create_node_impl(
                doc,
                &kind,
                &name,
                page_id.as_deref(),
                parent_uuid.as_deref(),
                transform.as_ref(),
            )?;
            // Entity-creation broadcasts MUST carry the entity UUID under `id`
            // (CLAUDE.md §4). The frontend `applyCreateNode` reads `uuid`; we
            // include both so the `id` rule is satisfied without breaking the
            // existing `uuid` consumer.
            let created_uuid = created.uuid.clone();
            let tx = crate::tools::broadcast::single_op_transaction(
                &created_uuid,
                "create_node",
                "",
                Some(serde_json::json!({
                    "id": created_uuid,
                    "uuid": created_uuid,
                    "kind": kind,
                    "name": name,
                })),
            );
            Ok((
                created,
                sigil_state::MutationEventKind::NodeCreated,
                Some(created_uuid),
                tx,
            ))
        })
        .await
    }

    /// Atomically deletes N nodes by UUID (Spec 19). Produces one undo entry.
    #[tool(
        name = "delete_nodes",
        description = "Atomically delete N nodes by UUID. Produces one undo entry. Accepts an \
                        optional `session_id` when multiple sessions are open."
    )]
    async fn delete_nodes(
        &self,
        Parameters(input): Parameters<crate::types::DeleteNodesInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let node_uuids = input.node_uuids.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let (result, canonical_uuids) =
                crate::tools::nodes::delete_nodes_impl(doc, &node_uuids)?;
            // Batch op: node_uuid empty, uuids in the value payload, matching
            // the GraphQL contract (mutation.rs::parse_delete_nodes).
            let tx = crate::tools::broadcast::single_op_transaction(
                "",
                "delete_nodes",
                "",
                Some(serde_json::json!({ "node_uuids": canonical_uuids })),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::NodeDeleted,
                None,
                tx,
            ))
        })
        .await
    }

    /// Renames a node identified by UUID.
    #[tool(
        name = "rename_node",
        description = "Rename a node. Accepts an optional `session_id` when multiple sessions \
                        are open."
    )]
    async fn rename_node(
        &self,
        Parameters(input): Parameters<crate::types::RenameNodeInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let new_name = input.new_name.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let info = crate::tools::nodes::rename_node_impl(doc, &uuid, &new_name)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "name",
                Some(serde_json::json!(new_name)),
            );
            Ok((
                info,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's transform (position, size, rotation, scale).
    #[tool(
        name = "set_transform",
        description = "Set a node's transform: position (x, y), size (width, height), rotation, \
                        scale. Accepts an optional `session_id` when multiple sessions are open."
    )]
    async fn set_transform(
        &self,
        Parameters(input): Parameters<crate::types::SetTransformInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let transform = input.transform;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let info = crate::tools::nodes::set_transform_impl(doc, &uuid, &transform)?;
            // Source the broadcast value from the canonical post-mutation
            // transform on the node info (build_node_info reads the doc).
            let transform_value = serde_json::to_value(&info.transform)
                .map_err(crate::error::McpToolError::SerializationError)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "transform",
                Some(transform_value),
            );
            Ok((
                info,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's visibility.
    #[tool(
        name = "set_visible",
        description = "Show or hide a node. Accepts an optional `session_id` when multiple \
                        sessions are open."
    )]
    async fn set_visible(
        &self,
        Parameters(input): Parameters<crate::types::SetVisibleInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let visible = input.visible;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let info = crate::tools::nodes::set_visible_impl(doc, &uuid, visible)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "visible",
                Some(serde_json::json!(visible)),
            );
            Ok((
                info,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Moves a node to a new parent at a specific position.
    #[tool(
        name = "reparent_node",
        description = "Move a node to a new parent at a specific child position. \
                        Used for drag-and-drop reparenting in the layers tree. Accepts an \
                        optional `session_id` when multiple sessions are open."
    )]
    async fn reparent_node(
        &self,
        Parameters(input): Parameters<crate::types::ReparentNodeInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let new_parent_uuid = input.new_parent_uuid.clone();
        let position = input.position;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let info =
                crate::tools::nodes::reparent_node_impl(doc, &uuid, &new_parent_uuid, position)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "reparent",
                "",
                Some(serde_json::json!({
                    "parentUuid": new_parent_uuid,
                    "position": position,
                })),
            );
            Ok((
                info,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Reorders a node within its parent's children list.
    #[tool(
        name = "reorder_children",
        description = "Move a node to a new position within its current parent's children list. \
                        Used for drag-and-drop reordering in the layers tree. Accepts an \
                        optional `session_id` when multiple sessions are open."
    )]
    async fn reorder_children(
        &self,
        Parameters(input): Parameters<crate::types::ReorderChildrenInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let new_position = input.new_position;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let info = crate::tools::nodes::reorder_children_impl(doc, &uuid, new_position)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "reorder",
                "",
                Some(serde_json::json!({ "newPosition": new_position })),
            );
            Ok((
                info,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's locked state.
    #[tool(
        name = "set_locked",
        description = "Lock or unlock a node. Accepts an optional `session_id` when multiple \
                        sessions are open."
    )]
    async fn set_locked(
        &self,
        Parameters(input): Parameters<crate::types::SetLockedInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let locked = input.locked;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let info = crate::tools::nodes::set_locked_impl(doc, &uuid, locked)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "locked",
                Some(serde_json::json!(locked)),
            );
            Ok((
                info,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's opacity (0.0 = fully transparent, 1.0 = fully opaque).
    #[tool(
        name = "set_opacity",
        description = "Set a node's opacity. Value must be in [0.0, 1.0]. Accepts an optional \
                        `session_id` when multiple sessions are open."
    )]
    async fn set_opacity(
        &self,
        Parameters(input): Parameters<crate::types::SetOpacityInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let opacity = input.opacity;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let result = crate::tools::nodes::set_opacity_impl(doc, &uuid, opacity)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "style.opacity",
                Some(serde_json::json!({"type": "literal", "value": opacity})),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's blend mode.
    #[tool(
        name = "set_blend_mode",
        description = "Set a node's blend mode (e.g. normal, multiply, screen, overlay, darken, \
                        lighten, color_dodge, color_burn, hard_light, soft_light, difference, \
                        exclusion, hue, saturation, color, luminosity). Accepts an optional \
                        `session_id` when multiple sessions are open."
    )]
    async fn set_blend_mode(
        &self,
        Parameters(input): Parameters<crate::types::SetBlendModeInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let blend_mode = input.blend_mode.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let result = crate::tools::nodes::set_blend_mode_impl(doc, &uuid, &blend_mode)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "style.blend_mode",
                Some(serde_json::json!(blend_mode)),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's fills array.
    #[tool(
        name = "set_fills",
        description = "Replace a node's fills. Pass an array of fill objects as JSON. Accepts \
                        an optional `session_id` when multiple sessions are open."
    )]
    async fn set_fills(
        &self,
        Parameters(input): Parameters<crate::types::SetFillsInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let fills = input.fills.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let result = crate::tools::nodes::set_fills_impl(doc, &uuid, &fills)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "style.fills",
                Some(fills.clone()),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's strokes array.
    #[tool(
        name = "set_strokes",
        description = "Replace a node's strokes. Pass an array of stroke objects as JSON. \
                        Accepts an optional `session_id` when multiple sessions are open."
    )]
    async fn set_strokes(
        &self,
        Parameters(input): Parameters<crate::types::SetStrokesInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let strokes = input.strokes.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let result = crate::tools::nodes::set_strokes_impl(doc, &uuid, &strokes)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "style.strokes",
                Some(strokes.clone()),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's effects array.
    #[tool(
        name = "set_effects",
        description = "Replace a node's effects. Pass an array of effect objects as JSON. \
                        Accepts an optional `session_id` when multiple sessions are open."
    )]
    async fn set_effects(
        &self,
        Parameters(input): Parameters<crate::types::SetEffectsInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let effects = input.effects.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let result = crate::tools::nodes::set_effects_impl(doc, &uuid, &effects)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "style.effects",
                Some(effects.clone()),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets a node's corner shapes (rectangle, frame, or image).
    #[tool(
        name = "set_corners",
        description = "Set corner shapes on a rectangle, frame, or image node. \
                        The 'corners' field accepts three forms: \
                        (1) a uniform object { shape: 'round'|'bevel'|'notch'|'scoop', radius: n }; \
                        (2) a shape-level superellipse object \
                        { shape: 'superellipse', radius: n, smoothing: 0.0..1.0 }; \
                        (3) an array of exactly 4 corner objects in order \
                        [top-left, top-right, bottom-right, bottom-left], each \
                        { shape: 'round'|'bevel'|'notch'|'scoop', radii: { x: n, y: n } }. \
                        The per-corner array does NOT accept 'superellipse' — use form 2. \
                        Accepts an optional `session_id` when multiple sessions are open."
    )]
    async fn set_corners(
        &self,
        Parameters(input): Parameters<crate::types::SetCornersInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let corners = input.corners.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            // `set_corners_impl` returns the canonical post-mutation `NodeKind`
            // JSON so the broadcast value is sourced from post-mutation state.
            let (result, kind_json) = crate::tools::nodes::set_corners_impl(doc, &uuid, &corners)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "kind",
                Some(kind_json),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Lists all design tokens in the document.
    #[tool(
        name = "list_tokens",
        description = "List all design tokens in the document, sorted by name. Accepts an \
                        optional `session_id` when multiple sessions are open."
    )]
    async fn list_tokens(
        &self,
        Parameters(input): Parameters<crate::types::SessionScopedInput>,
    ) -> Result<Json<crate::types::TokenListResult>, rmcp::ErrorData> {
        self.run_session_read(input.session_id.as_deref(), |doc| {
            let tokens = crate::tools::tokens::list_tokens_impl(doc)?;
            Ok(crate::types::TokenListResult { tokens })
        })
        .await
    }

    /// Creates a new design token.
    #[tool(
        name = "create_token",
        description = "Create a new design token. token_type must be one of: color, dimension, \
                        font_family, font_weight, duration, cubic_bezier, number, shadow, \
                        gradient, typography. The value JSON must match the token_type structure. \
                        Accepts an optional `session_id` when multiple sessions are open."
    )]
    async fn create_token(
        &self,
        Parameters(input): Parameters<crate::types::CreateTokenInput>,
    ) -> Result<Json<crate::types::TokenInfo>, rmcp::ErrorData> {
        // `tokens::create_token_impl` takes `&CreateTokenInput`, which carries
        // `session_id`. Clone the input into the closure; the impl ignores
        // the `session_id` field — it is consumed by the resolver above.
        let input_for_impl = crate::types::CreateTokenInput {
            name: input.name.clone(),
            token_type: input.token_type.clone(),
            value: input.value.clone(),
            description: input.description.clone(),
            session_id: None,
        };
        let token_name = input.name.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let info = crate::tools::tokens::create_token_impl(doc, &input_for_impl)?;
            // Token events have empty node_uuid and uuid = None; path is the
            // token name.
            let tx = crate::tools::broadcast::single_op_transaction(
                "",
                "create",
                &token_name,
                Some(serde_json::json!({"name": token_name})),
            );
            Ok((info, sigil_state::MutationEventKind::TokenCreated, None, tx))
        })
        .await
    }

    /// Updates an existing design token's type, value, and/or description.
    #[tool(
        name = "update_token",
        description = "Update an existing design token (identified by name) with a new type, \
                        value, or description. Accepts an optional `session_id` when multiple \
                        sessions are open."
    )]
    async fn update_token(
        &self,
        Parameters(input): Parameters<crate::types::UpdateTokenInput>,
    ) -> Result<Json<crate::types::TokenInfo>, rmcp::ErrorData> {
        let input_for_impl = crate::types::UpdateTokenInput {
            name: input.name.clone(),
            token_type: input.token_type.clone(),
            value: input.value.clone(),
            description: input.description.clone(),
            session_id: None,
        };
        let token_name = input.name.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let info = crate::tools::tokens::update_token_impl(doc, &input_for_impl)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                "",
                "update",
                &token_name,
                Some(serde_json::json!({"name": token_name})),
            );
            Ok((info, sigil_state::MutationEventKind::TokenUpdated, None, tx))
        })
        .await
    }

    /// Atomically renames a design token from `old_name` to `new_name`.
    #[tool(
        name = "rename_token",
        description = "Atomically rename a design token. Preserves the token's ID, value, type, \
                        and description. Fails if old_name does not exist or new_name is already \
                        taken. Accepts an optional `session_id` when multiple sessions are open."
    )]
    async fn rename_token(
        &self,
        Parameters(input): Parameters<crate::types::RenameTokenInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let old_name = input.old_name.clone();
        let new_name = input.new_name.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let result = crate::tools::tokens::rename_token_impl(doc, &old_name, &new_name)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                "",
                "rename_token",
                &old_name,
                Some(serde_json::json!({
                    "old_name": old_name,
                    "new_name": new_name,
                })),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::TokenUpdated,
                None,
                tx,
            ))
        })
        .await
    }

    /// Deletes a design token by name.
    #[tool(
        name = "delete_token",
        description = "Delete a design token by name. Accepts an optional `session_id` when \
                        multiple sessions are open."
    )]
    async fn delete_token(
        &self,
        Parameters(input): Parameters<crate::types::DeleteTokenInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let name = input.name.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let result = crate::tools::tokens::delete_token_impl(doc, &name)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                "",
                "delete",
                &name,
                Some(serde_json::json!({"name": name})),
            );
            Ok((
                result,
                sigil_state::MutationEventKind::TokenDeleted,
                None,
                tx,
            ))
        })
        .await
    }

    /// Lists all component definitions in the document.
    #[tool(
        name = "list_components",
        description = "List all component definitions in the document, sorted by name. Accepts \
                        an optional `session_id` when multiple sessions are open."
    )]
    async fn list_components(
        &self,
        Parameters(input): Parameters<crate::types::SessionScopedInput>,
    ) -> Result<Json<crate::types::ComponentListResult>, rmcp::ErrorData> {
        self.run_session_read(input.session_id.as_deref(), |doc| {
            Ok(crate::types::ComponentListResult {
                components: crate::tools::components::list_components_impl(doc),
            })
        })
        .await
    }

    /// Sets the text content of a text node.
    #[tool(
        name = "set_text_content",
        description = "Set the text content of a text node. Accepts an optional `session_id` \
                        when multiple sessions are open."
    )]
    async fn set_text_content(
        &self,
        Parameters(input): Parameters<crate::types::SetTextContentInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let content = input.content.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            let node_info = crate::tools::text::set_text_content_impl(doc, &uuid, &content)?;
            let tx = crate::tools::broadcast::single_op_transaction(
                &uuid,
                "set_field",
                "kind.content",
                Some(serde_json::json!(content)),
            );
            Ok((
                node_info,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Sets text style properties on a text node. Pass only the fields you want
    /// to change; omitted fields are left unchanged.
    #[tool(
        name = "set_text_style",
        description = "Set text style properties. Pass only fields to change. Fields: font_family, \
                        font_size, font_weight, font_style (normal|italic), line_height, \
                        letter_spacing, text_align (left|center|right|justify), text_decoration \
                        (none|underline|strikethrough), text_color, text_shadow (null to remove). \
                        Accepts an optional `session_id` when multiple sessions are open."
    )]
    async fn set_text_style(
        &self,
        Parameters(input): Parameters<crate::types::SetTextStyleInput>,
    ) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        // `PartialTextStyle` is not `Clone`; move `input.style` into the closure.
        let style = input.style;
        self.run_session_scoped(input.session_id.as_deref(), move |doc| {
            // `set_text_style_impl` returns the per-field ops (built from
            // post-apply state under the write lock) for a single multi-op
            // transaction, preserving the rollback discipline internally.
            let (result, broadcast_ops) =
                crate::tools::text::set_text_style_impl(doc, &uuid, &style)?;
            let tx = crate::tools::broadcast::multi_op_transaction(broadcast_ops);
            Ok((
                result,
                sigil_state::MutationEventKind::NodeUpdated,
                Some(uuid.clone()),
                tx,
            ))
        })
        .await
    }

    /// Lists every workfile session currently open in the running Sigil
    /// server. Returns each session's id, workfile path, display title, and
    /// lifecycle state.
    ///
    /// This is a **read-only, session-discovery** tool — it takes no
    /// `session_id` argument. Call it FIRST when you connect to a Sigil
    /// server with multiple workfiles open: the returned `id` is what you
    /// pass as the `session_id` argument on subsequent mutation tools.
    #[tool(
        name = "list_open_sessions",
        description = "List all currently open Sigil sessions. Each session corresponds to one \
                        open .sigil workfile in the running Sigil server. Returns id, \
                        workfile_path, title, and lifecycle state. Use the returned `id` as the \
                        `session_id` argument on subsequent mutation tools."
    )]
    fn list_open_sessions(&self) -> Json<crate::types::SessionListResult> {
        Json(crate::tools::sessions::list_open_sessions_impl(
            &self.sessions,
        ))
    }

    /// Alias for `list_open_sessions`. Returns the same shape.
    ///
    /// Some agent prompts find the name `get_active_workfiles` more
    /// discoverable when looking up which documents are available to edit.
    /// Both tools are kept in the catalogue to maximize the chance that the
    /// agent finds one of them on its first scan of the tool list.
    #[tool(
        name = "get_active_workfiles",
        description = "Alias for list_open_sessions: lists currently-open .sigil workfiles. \
                        Returns the same shape as list_open_sessions: id, workfile_path, title, \
                        and lifecycle state per session."
    )]
    fn get_active_workfiles(&self) -> Json<crate::types::SessionListResult> {
        Json(crate::tools::sessions::list_open_sessions_impl(
            &self.sessions,
        ))
    }
}

/// Spawns the MCP server on stdio in a background task.
///
/// This is a convenience function for `main.rs` that encapsulates all MCP
/// transport setup. The caller provides the [`Sessions`] registry shared with
/// the rest of the server process.
///
/// Returns a `JoinHandle` that resolves when the MCP server exits (either
/// because the stdio transport closed or an error occurred).
#[must_use]
pub fn start_stdio(sessions: Arc<Sessions>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let server = SigilMcpServer::new(sessions);
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

// The `#[tool_handler]` macro wires the `tool_router` built by `#[tool_router]`
// above into the `ServerHandler::list_tools` and `ServerHandler::call_tool`
// methods. Without it, both the stdio and Streamable HTTP transports respond
// to `tools/list` with an empty array and to `tools/call` with
// "method not found" — the default `ServerHandler` impls in rmcp do nothing.
// Discovered while wiring the Streamable HTTP transport (Spec 20 / Task 8);
// also fixes the pre-existing same defect on stdio.
#[tool_handler]
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
        let sessions = self.sessions.clone();
        async move {
            // RF-005: the rmcp `ReadResource` request (`ReadResourceRequestParams`)
            // carries only a `uri` — there is no tool-argument slot to thread a
            // `session_id` through, unlike the session-scoped read/mutate tools
            // which accept `SessionScopedInput`. Resource reads therefore use
            // the default / single-session rule (`None` → the same contract a
            // mutation tool applies when `session_id` is omitted), then read the
            // resolved session's store. Multi-session resource addressing is
            // deferred until the protocol exposes a way to scope a resource read.
            let session_id = resolve_session_or_error(&sessions, None)?;
            let session = sessions.get(session_id).ok_or_else(|| {
                SessionResolveError::NotFound {
                    id: session_id.to_string(),
                    open_sessions: vec![],
                }
                .to_rmcp_error()
            })?;
            let guard = session.store.read().await;
            crate::resources::read_resource(&guard.0, &request.uri).map(ReadResourceResult::new)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sigil_state::sessions::SessionEvent;

    #[test]
    fn test_server_get_info_returns_sigil_info() {
        let sessions = Arc::new(Sessions::new(64));
        let server = SigilMcpServer::new(sessions);
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

    /// Envelope/integration test: a write tool routed through
    /// `run_session_scoped` mutates the resolved session's store AND publishes
    /// exactly one `DocumentEvent` on that session's broadcast channel, with the
    /// per-session seq stamped (starts at 1) and the canonical `op_type`.
    #[tokio::test]
    async fn test_create_page_publishes_on_session_broadcast() {
        let sessions = Arc::new(Sessions::new(64));
        let id = sessions.register_in_memory(sigil_core::Document::new("Untitled".to_string()));
        let server = SigilMcpServer::new(sessions.clone());

        let session = sessions.get(id).expect("session");
        let mut rx = session.broadcast.subscribe();

        let input = crate::types::CreatePageInput {
            name: "Home".to_string(),
            session_id: Some(id.to_string()),
        };
        let result = server
            .run_session_scoped(input.session_id.as_deref(), move |doc| {
                let page = crate::tools::pages::create_page_impl(doc, &input.name)?;
                let tx = crate::tools::broadcast::single_op_transaction(
                    &page.id,
                    "create_page",
                    "page",
                    Some(serde_json::json!({"id": page.id, "name": page.name})),
                );
                Ok((page, sigil_state::MutationEventKind::PageCreated, None, tx))
            })
            .await;
        assert!(
            result.is_ok(),
            "tool should succeed (err: {:?})",
            result.err().map(|e| e.message)
        );

        match rx.try_recv().expect("broadcast event") {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.kind, sigil_state::MutationEventKind::PageCreated);
                let tx = me.transaction.expect("tx");
                assert_eq!(tx.seq, 1);
                assert_eq!(tx.operations[0].op_type, "create_page");
            }
            other => panic!("expected DocumentEvent, got {other:?}"),
        }

        // Session store reflects the write.
        let guard = session.store.read().await;
        assert_eq!(guard.0.pages.len(), 1);
    }
}
