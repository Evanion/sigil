//! `SigilMcpServer` — the MCP `ServerHandler` implementation for Sigil.
//!
//! This module wires together the shared `AppState` (from `sigil-state`)
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

use std::sync::{Arc, MutexGuard};

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

use sigil_state::sessions::{SessionEvent, SessionId};
use sigil_state::{AppState, SendDocument, Sessions};

use crate::session_resolver::{SessionResolveError, resolve_session};

/// The MCP server for Sigil.
///
/// Holds shared application state and a `ToolRouter` that dispatches
/// incoming `tools/call` requests to the appropriate handler.
///
/// During the Spec 20 migration (Tasks 9–10), the server carries **both** the
/// legacy single-document [`AppState`] (used by the existing mutation tools)
/// and the multi-session [`Sessions`] registry (used by the new session-
/// discovery tools added in Task 9 and the session-scoped mutation tools
/// added in Task 10). Once Task 10 migrates every mutation tool to route
/// through `sessions.with_session(...)`, the legacy `state` field can be
/// removed.
#[derive(Clone)]
pub struct SigilMcpServer {
    /// Shared in-memory document state, owned by the server process. Used by
    /// the legacy single-document mutation tools while Task 10 is in flight.
    pub state: AppState,
    /// Multi-session registry used by `list_open_sessions` and
    /// `get_active_workfiles` (Task 9). In the running server this points at
    /// the same `Sessions` instance the GraphQL resolvers and WebSocket
    /// subscribers see, so the agent's view of which sessions are open is
    /// identical to the frontend's.
    pub sessions: Arc<Sessions>,
    /// Tool dispatch table, built at construction time via `#[tool_router]`.
    ///
    /// The field appears unused to dead-code analysis because the `#[tool_router]`
    /// macro reads it through a generated method, not via a direct field access.
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl SigilMcpServer {
    /// Creates a new `SigilMcpServer` wrapping the given `AppState` and
    /// [`Sessions`] registry.
    ///
    /// The two arguments are passed independently (rather than as a single
    /// `App`) so existing test sites that construct an isolated `AppState`
    /// can pair it with a fresh empty `Sessions` registry without depending
    /// on the higher-level `App` wrapper. The server crate passes
    /// `state.app.legacy.clone()` and `state.app.sessions.clone()` from a
    /// single source of truth.
    #[must_use]
    pub fn new(state: AppState, sessions: Arc<Sessions>) -> Self {
        Self {
            state,
            sessions,
            tool_router: Self::tool_router(),
        }
    }

    /// Run a synchronous mutation `_impl` closure against the legacy
    /// [`AppState`], then mirror the resulting state and events onto the
    /// resolved session.
    ///
    /// This is the standard tool-handler envelope for every Spec 20
    /// mutation tool:
    ///
    /// 1. Resolve `explicit_session_id` via the three-rule resolver
    ///    ([`crate::session_resolver::resolve_session`]).
    /// 2. Look up the session from the registry. The id was just resolved
    ///    successfully, but the session could have been closed between the
    ///    resolution and the lookup (TOCTOU); treat that race as
    ///    [`SessionResolveError::NotFound`].
    /// 3. Subscribe to `state.event_tx` before invoking the mutation, so
    ///    every `MutationEvent` the impl publishes is captured.
    /// 4. Run the `_impl` closure (synchronous; the impl uses
    ///    [`acquire_document_lock`] internally).
    /// 5. On success: mirror the post-mutation legacy document into
    ///    `session.store` and forward the captured events to
    ///    `session.broadcast` (see [`mirror_to_session`]).
    /// 6. On failure: return the mapped `rmcp::ErrorData` without mirroring.
    ///
    /// Read-only tools do **not** use this helper — they read directly from
    /// the legacy `state` and pay no broadcast cost.
    ///
    /// # Errors
    ///
    /// Returns `Err(rmcp::ErrorData)` when (a) the session resolver fails,
    /// (b) the session is not found, or (c) the mutation impl returns an
    /// error.
    async fn run_session_scoped<T, F>(
        &self,
        explicit_session_id: Option<&str>,
        impl_fn: F,
    ) -> Result<Json<T>, rmcp::ErrorData>
    where
        F: FnOnce(&AppState) -> Result<T, crate::error::McpToolError>,
    {
        // 1. Resolve session id (or return a structured error).
        let session_id = resolve_session_or_error(&self.sessions, explicit_session_id)?;

        // 2. Look up the session. The resolver returned an id that was
        //    registered at the time, but a concurrent close() could have
        //    removed it — treat that as NotFound.
        let session = self.sessions.get(session_id).ok_or_else(|| {
            SessionResolveError::NotFound {
                id: session_id.to_string(),
                open_sessions: vec![],
            }
            .to_rmcp_error()
        })?;

        // 3. Subscribe BEFORE invoking the impl so every MutationEvent the
        //    impl publishes lands in `event_rx`. If event_tx is not
        //    configured (in-memory mode without a broadcaster), skip the
        //    forwarding step.
        let event_rx = self
            .state
            .event_tx()
            .map(tokio::sync::broadcast::Sender::subscribe);

        // 4. Run the impl. The impl owns its document lock and releases it
        //    before returning, so the mirror step below does not nest locks.
        let result = impl_fn(&self.state).map_err(|e| e.to_mcp_error())?;

        // 5. Mirror legacy → session: forward events + clone document.
        if let Some(rx) = event_rx {
            mirror_to_session(&self.state, &session, rx).await;
        } else {
            // No event_tx — still need to mirror the document so per-session
            // reads see the post-mutation state. Reuse mirror_to_session
            // with an empty receiver by short-circuiting the forward loop.
            // Create a dummy channel and drop the sender immediately so the
            // receiver returns `Closed` on the first try_recv.
            let (dummy_tx, dummy_rx) = tokio::sync::broadcast::channel(1);
            drop(dummy_tx);
            mirror_to_session(&self.state, &session, dummy_rx).await;
        }

        Ok(Json(result))
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

/// Resolve `params.session_id` to a [`SessionId`] using the three-rule order
/// implemented by [`resolve_session`]. Returns the resolved id on success or
/// a structured `rmcp::ErrorData` (carrying `code` + `open_sessions`) on
/// failure.
///
/// This is the entry point every Spec 20 mutation tool uses to gate access
/// to a specific session before calling the legacy `_impl` and mirroring the
/// result.
///
/// # Errors
///
/// Returns `Err(rmcp::ErrorData)` when the resolver returns any of the four
/// [`SessionResolveError`] variants. The error data carries the structured
/// recovery payload from [`SessionResolveError::to_mcp_error_payload`].
pub fn resolve_session_or_error(
    sessions: &Arc<Sessions>,
    explicit: Option<&str>,
) -> Result<SessionId, rmcp::ErrorData> {
    resolve_session(sessions, explicit).map_err(|e| e.to_rmcp_error())
}

/// Mirror the legacy [`AppState`] document into the resolved session's store
/// and broadcast a synthetic `DocumentEvent` on the session's broadcast
/// channel.
///
/// **Transitional bridge.** During Spec 20 Task 10 the legacy `AppState`
/// remains the source of truth that the existing `_impl` mutation functions
/// mutate in place. To keep the per-session document and the per-session
/// subscribers consistent with what the legacy store sees, this helper:
///
/// 1. Clones the post-mutation legacy document into `session.store` via
///    [`tokio::sync::RwLock::write`]. The session's document is therefore
///    always a snapshot of the legacy document immediately after each
///    mutation.
/// 2. Forwards every `MutationEvent` accumulated on `legacy.event_tx` during
///    the mutation into the session's `broadcast` channel as a
///    `SessionEvent::DocumentEvent`. Frontend WebSocket subscribers (per
///    Task 7) listen to the per-session channel; without this forwarding,
///    MCP-originated mutations would be invisible to the desktop UI.
///
/// The mirror is one-way (legacy → session) and is removed once every
/// mutation tool is refactored to mutate `session.store` directly. Until
/// that refactor lands, every Spec 20 mutation tool MUST call this helper
/// after its `_impl` returns.
///
/// `pre_subscribe_rx` is a broadcast receiver that the caller subscribed to
/// BEFORE invoking the `_impl`. The receiver captures any `MutationEvent`s
/// produced by the mutation; this function drains it into the session
/// channel.
pub async fn mirror_to_session(
    state: &AppState,
    session: &Arc<sigil_state::sessions::DocumentSession>,
    mut pre_subscribe_rx: tokio::sync::broadcast::Receiver<sigil_state::MutationEvent>,
) {
    // 1. Drain the legacy event receiver and forward each event onto the
    //    session's per-session broadcast channel. Use try_recv in a loop —
    //    by the time we arrive here, all events have already been published
    //    synchronously inside the impl, so they're sitting in the buffer.
    use tokio::sync::broadcast::error::TryRecvError;
    loop {
        match pre_subscribe_rx.try_recv() {
            Ok(event) => {
                // No subscribers on the per-session channel is not an error.
                let _ = session.broadcast.send(SessionEvent::DocumentEvent(event));
            }
            // Empty / Closed both mean "no more events for us" — exit the
            // drain loop. Merging the two arms is clippy::match_same_arms;
            // the receiver is dropped on function exit either way.
            Err(TryRecvError::Empty | TryRecvError::Closed) => break,
            Err(TryRecvError::Lagged(skipped)) => {
                tracing::warn!(
                    skipped,
                    "session broadcast mirror dropped legacy events due to backpressure"
                );
            }
        }
    }

    // 2. Mirror the legacy document into the session's store so per-session
    //    document reads (frontend, persistence, future direct-session paths)
    //    see the post-mutation state.
    //
    //    Acquire the locks in a strict order: legacy mutex first (short,
    //    sync, fully scoped), session.store write lock second (async). The
    //    impl already released the legacy mutex before returning, so this
    //    second acquisition is not nested with any caller-held lock.
    let snapshot = {
        let guard = match state.document.lock() {
            Ok(g) => g,
            Err(poison) => {
                tracing::error!("legacy document mutex poisoned during session mirror, recovering");
                poison.into_inner()
            }
        };
        guard.0.clone()
    };
    let mut session_doc = session.store.write().await;
    session_doc.0 = snapshot;
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
        description = "Create a new page in the document. Accepts an optional `session_id` \
                        argument when multiple sessions are open; call `list_open_sessions` to \
                        discover available session ids."
    )]
    async fn create_page(
        &self,
        Parameters(input): Parameters<crate::types::CreatePageInput>,
    ) -> Result<Json<crate::types::PageInfo>, rmcp::ErrorData> {
        let name = input.name.clone();
        self.run_session_scoped(input.session_id.as_deref(), |state| {
            crate::tools::pages::create_page_impl(state, &name)
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
        self.run_session_scoped(input.session_id.as_deref(), |state| {
            crate::tools::pages::delete_page_impl(state, &page_id)
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
        self.run_session_scoped(input.session_id.as_deref(), |state| {
            crate::tools::pages::rename_page_impl(state, &page_id, &new_name)
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
        self.run_session_scoped(input.session_id.as_deref(), |state| {
            crate::tools::pages::reorder_page_impl(state, &page_id, new_position)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::create_node_impl(
                state,
                &kind,
                &name,
                page_id.as_deref(),
                parent_uuid.as_deref(),
                transform.as_ref(),
            )
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::delete_nodes_impl(state, &node_uuids)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::rename_node_impl(state, &uuid, &new_name)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_transform_impl(state, &uuid, &transform)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_visible_impl(state, &uuid, visible)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::reparent_node_impl(state, &uuid, &new_parent_uuid, position)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::reorder_children_impl(state, &uuid, new_position)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_locked_impl(state, &uuid, locked)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_opacity_impl(state, &uuid, opacity)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_blend_mode_impl(state, &uuid, &blend_mode)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_fills_impl(state, &uuid, &fills)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_strokes_impl(state, &uuid, &strokes)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_effects_impl(state, &uuid, &effects)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::nodes::set_corners_impl(state, &uuid, &corners)
        })
        .await
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::tokens::create_token_impl(state, &input_for_impl)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::tokens::update_token_impl(state, &input_for_impl)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::tokens::rename_token_impl(state, &old_name, &new_name)
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
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::tokens::delete_token_impl(state, &name)
        })
        .await
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
        description = "Set the text content of a text node. Accepts an optional `session_id` \
                        when multiple sessions are open."
    )]
    async fn set_text_content(
        &self,
        Parameters(input): Parameters<crate::types::SetTextContentInput>,
    ) -> Result<Json<crate::types::NodeInfo>, rmcp::ErrorData> {
        let uuid = input.uuid.clone();
        let content = input.content.clone();
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::text::set_text_content_impl(state, &uuid, &content)
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
        // `PartialTextStyle` is not `Clone`; build a fresh borrowed reference
        // by moving `input.style` into the closure. The closure captures
        // input.style by move, so the impl reads it by reference within the
        // closure scope.
        let style = input.style;
        self.run_session_scoped(input.session_id.as_deref(), move |state| {
            crate::tools::text::set_text_style_impl(state, &uuid, &style)
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
/// transport setup. The caller provides the shared `AppState` (for the
/// legacy mutation tools) and the [`Sessions`] registry (for the
/// session-discovery tools added in Task 9).
///
/// Returns a `JoinHandle` that resolves when the MCP server exits (either
/// because the stdio transport closed or an error occurred).
#[must_use]
pub fn start_stdio(state: AppState, sessions: Arc<Sessions>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let server = SigilMcpServer::new(state, sessions);
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
        let sessions = Arc::new(Sessions::new(64));
        let server = SigilMcpServer::new(state, sessions);
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
