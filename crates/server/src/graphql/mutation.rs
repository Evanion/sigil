// crates/server/src/graphql/mutation.rs

//! GraphQL mutations for document operations.
//!
//! Each mutation follows this pattern:
//! 1. Get `AppState` from context
//! 2. Acquire document lock (`std::sync::Mutex` -- never hold across await)
//! 3. Parse UUID string to `uuid::Uuid`
//! 4. Resolve UUID to `NodeId` via `arena.id_by_uuid()`
//! 5. Read old state for undo
//! 6. Construct the appropriate `Command` struct from core
//! 7. Call `doc_guard.execute(Box::new(cmd))`
//! 8. Build the GraphQL response INSIDE the lock scope (RF-005)
//! 9. Drop the lock
//! 10. Signal dirty for persistence
//! 11. Publish event and return result

use async_graphql::{Context, Json, Object, Result};

use agent_designer_core::commands::batch_commands::BatchSetTransform;
use agent_designer_core::commands::group_commands::{GroupNodes, UngroupNodes};
use agent_designer_core::commands::node_commands::{
    CreateNode, DeleteNode, RenameNode, SetLocked, SetVisible,
};
use agent_designer_core::commands::style_commands::validate_transform;
use agent_designer_core::commands::style_commands::{
    SetBlendMode, SetCornerRadii, SetEffects, SetFills, SetOpacity, SetStrokes, SetTransform,
};
use agent_designer_core::commands::tree_commands::{ReorderChildren, ReparentNode};
use agent_designer_core::node::{BlendMode, Effect, Fill, NodeKind, Stroke, StyleValue, Transform};
use agent_designer_core::validate::MAX_BATCH_SIZE;
use agent_designer_core::{NodeId, PageId};
use agent_designer_state::{MutationEvent, MutationEventKind};

use crate::state::ServerState;

use super::types::{CreateNodeResult, NodeGql, UndoRedoResult, node_to_gql};

pub struct MutationRoot;

/// Acquires the document lock, recovering from mutex poisoning.
fn acquire_document_lock(
    state: &ServerState,
) -> std::sync::MutexGuard<'_, crate::state::SendDocument> {
    match state.app.document.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::error!("document mutex poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

#[Object]
#[allow(clippy::unused_async)]
impl MutationRoot {
    /// Create a new node in the document.
    ///
    /// Generates a UUID, creates the node with the given kind and name,
    /// optionally places it on a page, and applies an initial transform.
    async fn create_node(
        &self,
        ctx: &Context<'_>,
        kind: Json<serde_json::Value>,
        name: String,
        page_id: Option<String>,
        transform: Option<Json<serde_json::Value>>,
    ) -> Result<CreateNodeResult> {
        let state = ctx.data::<ServerState>()?;

        // Deserialize kind from JSON
        let node_kind: NodeKind = serde_json::from_value(kind.0).map_err(|e| {
            tracing::warn!("invalid node kind in createNode: {e}");
            async_graphql::Error::new("invalid node kind")
        })?;

        // Deserialize optional transform
        let initial_transform: Option<Transform> = match transform {
            Some(Json(t)) => {
                let parsed: Transform = serde_json::from_value(t).map_err(|e| {
                    tracing::warn!("invalid transform in createNode: {e}");
                    async_graphql::Error::new("invalid transform")
                })?;
                Some(parsed)
            }
            None => None,
        };

        // Parse optional page ID
        let page_id_typed: Option<PageId> = match page_id {
            Some(ref id_str) => {
                let parsed: uuid::Uuid = id_str
                    .parse()
                    .map_err(|_| async_graphql::Error::new("invalid page UUID"))?;
                Some(PageId::new(parsed))
            }
            None => None,
        };

        let node_uuid = uuid::Uuid::new_v4();

        let cmd = CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: node_uuid,
            kind: node_kind,
            name: name.clone(),
            page_id: page_id_typed,
            initial_transform,
        };

        // RF-005: build the response inside the lock scope to avoid TOCTOU
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("createNode failed: {e}");
                async_graphql::Error::new("node creation failed")
            })?;

            let node_id = doc_guard
                .arena
                .id_by_uuid(&node_uuid)
                .ok_or_else(|| async_graphql::Error::new("node created but UUID not found"))?;

            node_to_gql(&doc_guard, node_id, node_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeCreated,
            uuid: Some(node_uuid.to_string()),
            data: None,
            transaction: None,
        });

        Ok(CreateNodeResult {
            uuid: node_uuid.to_string(),
            node: node_gql,
        })
    }

    /// Delete a node by UUID.
    async fn delete_node(&self, ctx: &Context<'_>, uuid: String) -> Result<bool> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        {
            let mut doc_guard = acquire_document_lock(state);

            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            // Capture snapshot for undo
            let node = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?;
            let snapshot = node.clone();
            let parent_id = node.parent;

            // Find parent_child_index
            let parent_child_index = parent_id.and_then(|pid| {
                doc_guard
                    .arena
                    .get(pid)
                    .ok()
                    .and_then(|parent| parent.children.iter().position(|&id| id == node_id))
            });

            // Find page and root index
            let mut found_page_id: Option<PageId> = None;
            let mut found_page_root_index: Option<usize> = None;
            for page in &doc_guard.pages {
                if let Some(idx) = page.root_nodes.iter().position(|&nid| nid == node_id) {
                    found_page_id = Some(page.id);
                    found_page_root_index = Some(idx);
                    break;
                }
            }

            let cmd = DeleteNode {
                node_id,
                snapshot: Some(snapshot),
                page_id: found_page_id,
                page_root_index: found_page_root_index,
                parent_id,
                parent_child_index,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("deleteNode failed: {e}");
                async_graphql::Error::new("node deletion failed")
            })?;
        }

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeDeleted,
            uuid: Some(parsed_uuid.to_string()),
            data: None,
            transaction: None,
        });

        Ok(true)
    }

    /// Rename a node by UUID.
    async fn rename_node(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        new_name: String,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_name = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .name
                .clone();

            let cmd = RenameNode {
                node_id,
                new_name,
                old_name,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("renameNode failed: {e}");
                async_graphql::Error::new("rename failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "name"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the transform of a node by UUID.
    async fn set_transform(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        transform: Json<serde_json::Value>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        let new_transform: Transform = serde_json::from_value(transform.0).map_err(|e| {
            tracing::warn!("invalid transform in setTransform: {e}");
            async_graphql::Error::new("invalid transform")
        })?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_transform = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .transform;

            let cmd = SetTransform {
                node_id,
                new_transform,
                old_transform,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setTransform failed: {e}");
                async_graphql::Error::new("set transform failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "transform"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the visibility of a node by UUID.
    async fn set_visible(&self, ctx: &Context<'_>, uuid: String, visible: bool) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_visible = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .visible;

            let cmd = SetVisible {
                node_id,
                new_visible: visible,
                old_visible,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setVisible failed: {e}");
                async_graphql::Error::new("set visible failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "visible"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the locked state of a node by UUID.
    async fn set_locked(&self, ctx: &Context<'_>, uuid: String, locked: bool) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;
        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_locked = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .locked;

            let cmd = SetLocked {
                node_id,
                new_locked: locked,
                old_locked,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setLocked failed: {e}");
                async_graphql::Error::new("set locked failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "locked"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Move a node to a new parent at a specific position.
    ///
    /// Note: GraphQL `Int` is signed (i32), but position must be non-negative.
    /// The resolver validates this before acquiring the lock. Positions beyond
    /// the parent's children count are clamped by the core engine (append semantics).
    async fn reparent_node(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        new_parent_uuid: String,
        position: i32,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // RF-013: reject negative positions before lock acquisition.
        if position < 0 {
            return Err(async_graphql::Error::new("position must be non-negative"));
        }
        #[allow(clippy::cast_sign_loss)] // validated non-negative above
        let position_usize = position as usize;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;
        let parent_uuid: uuid::Uuid = new_parent_uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid parent UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;
            let parent_id = doc_guard
                .arena
                .id_by_uuid(&parent_uuid)
                .ok_or_else(|| async_graphql::Error::new("parent not found"))?;

            let old_parent_id = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .parent;
            // RF-019: propagate error instead of silently suppressing with .ok()
            let old_position = match old_parent_id {
                Some(pid) => {
                    let parent_node = doc_guard
                        .arena
                        .get(pid)
                        .map_err(|_| async_graphql::Error::new("old parent node not found"))?;
                    parent_node.children.iter().position(|&c| c == node_id)
                }
                None => None,
            };

            // RF-014: positions beyond children count are clamped by the core engine.
            let cmd = ReparentNode {
                node_id,
                new_parent_id: parent_id,
                new_position: position_usize,
                old_parent_id,
                old_position,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("reparentNode failed: {e}");
                async_graphql::Error::new("reparent failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "parent"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Reorder a node within its parent's children list.
    ///
    /// Note: GraphQL `Int` is signed (i32), but position must be non-negative.
    /// The resolver validates this before acquiring the lock. Positions beyond
    /// the children count are clamped by the core engine.
    async fn reorder_children(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        new_position: i32,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // RF-013: reject negative positions before lock acquisition.
        if new_position < 0 {
            return Err(async_graphql::Error::new("position must be non-negative"));
        }
        #[allow(clippy::cast_sign_loss)] // validated non-negative above
        let new_position_usize = new_position as usize;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            // Find the node's current parent and position within it
            let parent_id = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .parent
                .ok_or_else(|| async_graphql::Error::new("node has no parent"))?;

            let old_position = doc_guard
                .arena
                .get(parent_id)
                .map_err(|_| async_graphql::Error::new("parent lookup failed"))?
                .children
                .iter()
                .position(|&c| c == node_id)
                .ok_or_else(|| async_graphql::Error::new("node not found in parent's children"))?;

            // RF-014: positions beyond children count are clamped by the core engine.
            let cmd = ReorderChildren {
                node_id,
                new_position: new_position_usize,
                old_position,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("reorderChildren failed: {e}");
                async_graphql::Error::new("reorder failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "order"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the opacity of a node by UUID.
    ///
    /// Opacity must be a finite f64 in the range [0.0, 1.0].
    async fn set_opacity(&self, ctx: &Context<'_>, uuid: String, opacity: f64) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Validate input BEFORE lock acquisition (CLAUDE.md: floating-point validation)
        if !opacity.is_finite() {
            return Err(async_graphql::Error::new(
                "opacity must be finite (no NaN or infinity)",
            ));
        }
        if !(0.0..=1.0).contains(&opacity) {
            return Err(async_graphql::Error::new("opacity must be in [0.0, 1.0]"));
        }

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_opacity = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .style
                .opacity
                .clone();

            let cmd = SetOpacity {
                node_id,
                new_opacity: StyleValue::Literal { value: opacity },
                old_opacity,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setOpacity failed: {e}");
                async_graphql::Error::new("set opacity failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "opacity"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the blend mode of a node by UUID.
    ///
    /// The blend mode string must be a valid `snake_case` variant name (e.g. "normal", "multiply").
    async fn set_blend_mode(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        blend_mode: String,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Parse blend mode string before lock acquisition
        let new_blend_mode: BlendMode =
            serde_json::from_value(serde_json::Value::String(blend_mode)).map_err(|e| {
                tracing::warn!("invalid blend mode in setBlendMode: {e}");
                async_graphql::Error::new("invalid blend mode")
            })?;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_blend_mode = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .style
                .blend_mode;

            let cmd = SetBlendMode {
                node_id,
                new_blend_mode,
                old_blend_mode,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setBlendMode failed: {e}");
                async_graphql::Error::new("set blend mode failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "blend_mode"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the fills array of a node by UUID.
    ///
    /// Accepts fills as a JSON value (array of Fill objects).
    async fn set_fills(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        fills: Json<serde_json::Value>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Deserialize fills before lock acquisition
        let new_fills: Vec<Fill> = serde_json::from_value(fills.0).map_err(|e| {
            tracing::warn!("invalid fills in setFills: {e}");
            async_graphql::Error::new("invalid fills")
        })?;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_fills = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .style
                .fills
                .clone();

            let cmd = SetFills {
                node_id,
                new_fills,
                old_fills,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setFills failed: {e}");
                async_graphql::Error::new("set fills failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "fills"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the strokes array of a node by UUID.
    ///
    /// Accepts strokes as a JSON value (array of Stroke objects).
    async fn set_strokes(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        strokes: Json<serde_json::Value>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Deserialize strokes before lock acquisition
        let new_strokes: Vec<Stroke> = serde_json::from_value(strokes.0).map_err(|e| {
            tracing::warn!("invalid strokes in setStrokes: {e}");
            async_graphql::Error::new("invalid strokes")
        })?;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_strokes = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .style
                .strokes
                .clone();

            let cmd = SetStrokes {
                node_id,
                new_strokes,
                old_strokes,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setStrokes failed: {e}");
                async_graphql::Error::new("set strokes failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "strokes"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the effects array of a node by UUID.
    ///
    /// Accepts effects as a JSON value (array of Effect objects).
    async fn set_effects(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        effects: Json<serde_json::Value>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Deserialize effects before lock acquisition
        let new_effects: Vec<Effect> = serde_json::from_value(effects.0).map_err(|e| {
            tracing::warn!("invalid effects in setEffects: {e}");
            async_graphql::Error::new("invalid effects")
        })?;

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let old_effects = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .style
                .effects
                .clone();

            let cmd = SetEffects {
                node_id,
                new_effects,
                old_effects,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setEffects failed: {e}");
                async_graphql::Error::new("set effects failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "effects"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Set the corner radii of a rectangle node by UUID.
    ///
    /// Requires exactly 4 values (top-left, top-right, bottom-right, bottom-left).
    /// All values must be finite and non-negative. The target node must be a Rectangle.
    async fn set_corner_radii(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        radii: Vec<f64>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<ServerState>()?;

        // Validate input BEFORE lock acquisition
        if radii.len() != 4 {
            return Err(async_graphql::Error::new(
                "corner radii must have exactly 4 elements",
            ));
        }
        for (i, &r) in radii.iter().enumerate() {
            if !r.is_finite() {
                return Err(async_graphql::Error::new(format!(
                    "corner_radii[{i}] must be finite (no NaN or infinity)"
                )));
            }
            if r < 0.0 {
                return Err(async_graphql::Error::new(format!(
                    "corner_radii[{i}] must be non-negative"
                )));
            }
        }
        let new_radii: [f64; 4] = [radii[0], radii[1], radii[2], radii[3]];

        let parsed_uuid: uuid::Uuid = uuid
            .parse()
            .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

        // RF-005: execute and build response in a single lock scope
        let node_gql = {
            let mut doc_guard = acquire_document_lock(state);
            let node_id = doc_guard
                .arena
                .id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;

            let node = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?;

            let old_radii = match &node.kind {
                NodeKind::Rectangle { corner_radii } => *corner_radii,
                _ => {
                    return Err(async_graphql::Error::new(
                        "setCornerRadii requires a Rectangle node",
                    ));
                }
            };

            let cmd = SetCornerRadii {
                node_id,
                new_radii,
                old_radii,
            };

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("setCornerRadii failed: {e}");
                async_graphql::Error::new("set corner radii failed")
            })?;

            node_to_gql(&doc_guard, node_id, parsed_uuid)?
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some(parsed_uuid.to_string()),
            data: Some(serde_json::json!({"field": "corner_radii"})),
            transaction: None,
        });

        Ok(node_gql)
    }

    /// Atomically set transforms for multiple nodes.
    ///
    /// Used by multi-select move, align, and distribute operations.
    /// All transforms are validated before any are applied.
    async fn batch_set_transform(
        &self,
        ctx: &Context<'_>,
        entries: Vec<Json<serde_json::Value>>,
    ) -> Result<Vec<NodeGql>> {
        let state = ctx.data::<ServerState>()?;

        // RF-009: Early MAX_BATCH_SIZE check before parsing loop
        if entries.len() > MAX_BATCH_SIZE {
            return Err(async_graphql::Error::new(format!(
                "batch size {} exceeds maximum of {MAX_BATCH_SIZE}",
                entries.len()
            )));
        }

        // Parse entries: each is { "uuid": "...", "transform": { ... } }
        let mut parsed_entries: Vec<(uuid::Uuid, Transform)> = Vec::with_capacity(entries.len());
        for entry_json in &entries {
            let obj = entry_json.0.as_object().ok_or_else(|| {
                async_graphql::Error::new(
                    "each entry must be a JSON object with uuid and transform",
                )
            })?;
            let uuid_str = obj
                .get("uuid")
                .and_then(|v| v.as_str())
                .ok_or_else(|| async_graphql::Error::new("entry missing uuid field"))?;
            let parsed_uuid: uuid::Uuid = uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
            let transform_val = obj
                .get("transform")
                .ok_or_else(|| async_graphql::Error::new("entry missing transform field"))?;
            let new_transform: Transform =
                serde_json::from_value(transform_val.clone()).map_err(|e| {
                    tracing::warn!("invalid transform in batchSetTransform: {e}");
                    async_graphql::Error::new("invalid transform in batch entry")
                })?;
            // RF-011: Validate transform immediately after deserialization
            validate_transform(&new_transform).map_err(|e| {
                tracing::warn!("invalid transform values in batchSetTransform: {e}");
                async_graphql::Error::new("invalid transform values in batch entry")
            })?;
            parsed_entries.push((parsed_uuid, new_transform));
        }

        let result_nodes = {
            let mut doc_guard = acquire_document_lock(state);

            // Resolve UUIDs to NodeIds and capture old transforms
            let mut cmd_entries = Vec::with_capacity(parsed_entries.len());
            let mut old_transforms = Vec::with_capacity(parsed_entries.len());

            for (uuid, new_transform) in &parsed_entries {
                let node_id = doc_guard
                    .arena
                    .id_by_uuid(uuid)
                    .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))?;
                let old_transform = doc_guard
                    .arena
                    .get(node_id)
                    .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                    .transform;
                cmd_entries.push((node_id, *new_transform));
                old_transforms.push((node_id, old_transform));
            }

            // RF-006: Use validating constructor
            let cmd = BatchSetTransform::new(cmd_entries, old_transforms).map_err(|e| {
                tracing::warn!("batchSetTransform validation failed: {e}");
                async_graphql::Error::new("batch set transform validation failed")
            })?;

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("batchSetTransform failed: {e}");
                async_graphql::Error::new("batch set transform failed")
            })?;

            // Build response inside lock scope (RF-005)
            let mut nodes = Vec::with_capacity(parsed_entries.len());
            for (uuid, _) in &parsed_entries {
                let node_id = doc_guard.arena.id_by_uuid(uuid).ok_or_else(|| {
                    async_graphql::Error::new("node disappeared after batch transform")
                })?;
                nodes.push(node_to_gql(&doc_guard, node_id, *uuid)?);
            }
            nodes
        };

        // RF-019: Include affected UUIDs in the batch broadcast event
        let affected_uuids: Vec<String> = parsed_entries
            .iter()
            .map(|(uuid, _)| uuid.to_string())
            .collect();

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: None,
            data: Some(serde_json::json!({
                "field": "transform",
                "batch": true,
                "affected_uuids": affected_uuids,
            })),
            transaction: None,
        });

        Ok(result_nodes)
    }

    /// Group multiple nodes under a new Group node.
    ///
    /// Returns the UUID of the created group node.
    async fn group_nodes(
        &self,
        ctx: &Context<'_>,
        uuids: Vec<String>,
        name: String,
    ) -> Result<String> {
        let state = ctx.data::<ServerState>()?;

        let mut parsed_uuids: Vec<uuid::Uuid> = Vec::with_capacity(uuids.len());
        for uuid_str in &uuids {
            let parsed: uuid::Uuid = uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
            parsed_uuids.push(parsed);
        }

        let group_uuid = uuid::Uuid::new_v4();

        {
            let mut doc_guard = acquire_document_lock(state);

            let node_ids: Vec<NodeId> = parsed_uuids
                .iter()
                .map(|uuid| {
                    doc_guard
                        .arena
                        .id_by_uuid(uuid)
                        .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))
                })
                .collect::<Result<Vec<_>>>()?;

            let cmd = GroupNodes::new(node_ids, name, group_uuid).map_err(|e| {
                tracing::warn!("groupNodes validation failed: {e}");
                async_graphql::Error::new("group nodes failed")
            })?;

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("groupNodes failed: {e}");
                async_graphql::Error::new("group nodes failed")
            })?;
        }

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeCreated,
            uuid: Some(group_uuid.to_string()),
            data: Some(serde_json::json!({"operation": "group"})),
            transaction: None,
        });

        Ok(group_uuid.to_string())
    }

    /// Ungroup one or more group nodes, reparenting their children.
    ///
    /// Returns the UUIDs of the ungrouped children.
    async fn ungroup_nodes(&self, ctx: &Context<'_>, uuids: Vec<String>) -> Result<Vec<String>> {
        let state = ctx.data::<ServerState>()?;

        let mut parsed_uuids: Vec<uuid::Uuid> = Vec::with_capacity(uuids.len());
        for uuid_str in &uuids {
            let parsed: uuid::Uuid = uuid_str
                .parse()
                .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
            parsed_uuids.push(parsed);
        }

        let child_uuids: Vec<String> = {
            let mut doc_guard = acquire_document_lock(state);

            let group_ids: Vec<NodeId> = parsed_uuids
                .iter()
                .map(|uuid| {
                    doc_guard
                        .arena
                        .id_by_uuid(uuid)
                        .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))
                })
                .collect::<Result<Vec<_>>>()?;

            // Collect child UUIDs before ungroup (for response)
            let mut all_child_uuids = Vec::new();
            for &gid in &group_ids {
                let group = doc_guard
                    .arena
                    .get(gid)
                    .map_err(|_| async_graphql::Error::new("group lookup failed"))?;
                for &cid in &group.children {
                    let child_uuid = doc_guard
                        .arena
                        .uuid_of(cid)
                        .map_err(|_| async_graphql::Error::new("child uuid lookup failed"))?;
                    all_child_uuids.push(child_uuid.to_string());
                }
            }

            // RF-003/RF-006: Use validating constructor. Snapshots are now
            // captured automatically inside apply() via interior mutability.
            let cmd = UngroupNodes::new(group_ids, parsed_uuids.clone()).map_err(|e| {
                tracing::warn!("ungroupNodes validation failed: {e}");
                async_graphql::Error::new("ungroup nodes validation failed")
            })?;

            doc_guard.execute(Box::new(cmd)).map_err(|e| {
                tracing::warn!("ungroupNodes failed: {e}");
                async_graphql::Error::new("ungroup nodes failed")
            })?;

            all_child_uuids
        };

        state.app.signal_dirty();
        for uuid_str in &uuids {
            state.app.publish_event(MutationEvent {
                kind: MutationEventKind::NodeDeleted,
                uuid: Some(uuid_str.clone()),
                data: Some(serde_json::json!({"operation": "ungroup"})),
                transaction: None,
            });
        }

        Ok(child_uuids)
    }

    /// Undo the last command.
    async fn undo(&self, ctx: &Context<'_>) -> Result<UndoRedoResult> {
        let state = ctx.data::<ServerState>()?;

        let (can_undo, can_redo) = {
            let mut doc_guard = acquire_document_lock(state);
            doc_guard.undo().map_err(|e| {
                tracing::warn!("undo failed: {e}");
                async_graphql::Error::new("undo failed")
            })?;
            (doc_guard.can_undo(), doc_guard.can_redo())
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::UndoRedo,
            uuid: None,
            data: Some(serde_json::json!({"can_undo": can_undo, "can_redo": can_redo})),
            transaction: None,
        });

        Ok(UndoRedoResult { can_undo, can_redo })
    }

    /// Redo the last undone command.
    async fn redo(&self, ctx: &Context<'_>) -> Result<UndoRedoResult> {
        let state = ctx.data::<ServerState>()?;

        let (can_undo, can_redo) = {
            let mut doc_guard = acquire_document_lock(state);
            doc_guard.redo().map_err(|e| {
                tracing::warn!("redo failed: {e}");
                async_graphql::Error::new("redo failed")
            })?;
            (doc_guard.can_undo(), doc_guard.can_redo())
        };

        state.app.signal_dirty();
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::UndoRedo,
            uuid: None,
            data: Some(serde_json::json!({"can_undo": can_undo, "can_redo": can_redo})),
            transaction: None,
        });

        Ok(UndoRedoResult { can_undo, can_redo })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{EmptySubscription, Schema};

    /// Builds a test schema with the given `ServerState`.
    fn test_schema(
        state: ServerState,
    ) -> Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription> {
        Schema::build(
            super::super::query::QueryRoot,
            MutationRoot,
            EmptySubscription,
        )
        .data(state)
        .finish()
    }

    #[tokio::test]
    async fn test_create_node_mutation_returns_uuid_and_node() {
        let state = ServerState::new();

        // Add a page so we can test page placement
        {
            let mut doc = state.app.document.lock().unwrap();
            let page_uuid = uuid::Uuid::new_v4();
            let page = agent_designer_core::document::Page::new(
                PageId::new(page_uuid),
                "Home".to_string(),
            )
            .unwrap();
            doc.add_page(page).unwrap();
        }

        let schema = test_schema(state);

        let query = r#"
            mutation {
                createNode(
                    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] }
                    name: "Test Rect"
                ) {
                    uuid
                    node {
                        name
                        visible
                        locked
                    }
                }
            }
        "#;

        let res = schema.execute(query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let data = res.data.into_json().unwrap();
        let create_result = &data["createNode"];
        assert!(!create_result["uuid"].as_str().unwrap().is_empty());
        assert_eq!(create_result["node"]["name"], "Test Rect");
        assert_eq!(create_result["node"]["visible"], true);
        assert_eq!(create_result["node"]["locked"], false);
    }

    #[tokio::test]
    async fn test_delete_node_mutation_removes_node() {
        let state = ServerState::new();
        let schema = test_schema(state);

        // Create a node first
        let create_res = schema
            .execute(
                r#"mutation { createNode(kind: { type: "group" }, name: "To Delete") { uuid } }"#,
            )
            .await;
        assert!(
            create_res.errors.is_empty(),
            "errors: {:?}",
            create_res.errors
        );

        let created_uuid = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        // Delete it
        let delete_query = format!(r#"mutation {{ deleteNode(uuid: "{created_uuid}") }}"#);
        let delete_res = schema.execute(&*delete_query).await;
        assert!(
            delete_res.errors.is_empty(),
            "errors: {:?}",
            delete_res.errors
        );

        let deleted = delete_res.data.into_json().unwrap()["deleteNode"]
            .as_bool()
            .unwrap();
        assert!(deleted);

        // Verify the node is gone
        let node_query = format!(r#"{{ node(uuid: "{created_uuid}") {{ name }} }}"#);
        let node_res = schema.execute(&*node_query).await;
        assert!(node_res.errors.is_empty());
        assert!(node_res.data.into_json().unwrap()["node"].is_null());
    }

    #[tokio::test]
    async fn test_rename_node_mutation_updates_name() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let create_res = schema
            .execute(
                r#"mutation { createNode(kind: { type: "group" }, name: "Original") { uuid } }"#,
            )
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        let rename_query = format!(
            r#"mutation {{ renameNode(uuid: "{uuid_str}", newName: "Renamed") {{ name }} }}"#,
        );
        let rename_res = schema.execute(&*rename_query).await;
        assert!(
            rename_res.errors.is_empty(),
            "errors: {:?}",
            rename_res.errors
        );

        let new_name = rename_res.data.into_json().unwrap()["renameNode"]["name"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(new_name, "Renamed");
    }

    #[tokio::test]
    async fn test_set_visible_mutation_toggles_visibility() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let create_res = schema
            .execute(r#"mutation { createNode(kind: { type: "group" }, name: "V") { uuid } }"#)
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        let hide_query = format!(
            r#"mutation {{ setVisible(uuid: "{uuid_str}", visible: false) {{ visible }} }}"#,
        );
        let hide_res = schema.execute(&*hide_query).await;
        assert!(hide_res.errors.is_empty(), "errors: {:?}", hide_res.errors);

        let visible = hide_res.data.into_json().unwrap()["setVisible"]["visible"]
            .as_bool()
            .unwrap();
        assert!(!visible);
    }

    #[tokio::test]
    async fn test_set_locked_mutation_toggles_lock() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let create_res = schema
            .execute(r#"mutation { createNode(kind: { type: "group" }, name: "L") { uuid } }"#)
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        let lock_query =
            format!(r#"mutation {{ setLocked(uuid: "{uuid_str}", locked: true) {{ locked }} }}"#,);
        let lock_res = schema.execute(&*lock_query).await;
        assert!(lock_res.errors.is_empty(), "errors: {:?}", lock_res.errors);

        let locked = lock_res.data.into_json().unwrap()["setLocked"]["locked"]
            .as_bool()
            .unwrap();
        assert!(locked);
    }

    #[tokio::test]
    async fn test_set_transform_mutation_updates_position() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let create_res = schema
            .execute(r#"mutation { createNode(kind: { type: "group" }, name: "T") { uuid } }"#)
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        let transform_query = format!(
            r#"mutation {{
                setTransform(
                    uuid: "{uuid_str}"
                    transform: {{ x: 100, y: 200, width: 50, height: 60, rotation: 0, scale_x: 1, scale_y: 1 }}
                ) {{
                    transform
                }}
            }}"#,
        );
        let transform_res = schema.execute(&*transform_query).await;
        assert!(
            transform_res.errors.is_empty(),
            "errors: {:?}",
            transform_res.errors
        );

        let t = &transform_res.data.into_json().unwrap()["setTransform"]["transform"];
        assert_eq!(t["x"], 100.0);
        assert_eq!(t["y"], 200.0);
    }

    #[tokio::test]
    async fn test_undo_redo_mutations_round_trip() {
        let state = ServerState::new();
        let schema = test_schema(state);

        // Create a node (pushes to undo stack)
        let create_res = schema
            .execute(
                r#"mutation { createNode(kind: { type: "group" }, name: "Undo Me") { uuid } }"#,
            )
            .await;
        assert!(create_res.errors.is_empty());

        let uuid_str = create_res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string();

        // Undo
        let undo_res = schema
            .execute(r#"mutation { undo { canUndo canRedo } }"#)
            .await;
        assert!(undo_res.errors.is_empty(), "errors: {:?}", undo_res.errors);

        let undo_data = undo_res.data.into_json().unwrap();
        assert!(undo_data["undo"]["canRedo"].as_bool().unwrap());

        // Verify node is gone after undo
        let node_query = format!(r#"{{ node(uuid: "{uuid_str}") {{ name }} }}"#);
        let node_res = schema.execute(&*node_query).await;
        assert!(node_res.errors.is_empty());
        assert!(node_res.data.into_json().unwrap()["node"].is_null());

        // Redo
        let redo_res = schema
            .execute(r#"mutation { redo { canUndo canRedo } }"#)
            .await;
        assert!(redo_res.errors.is_empty(), "errors: {:?}", redo_res.errors);

        let redo_data = redo_res.data.into_json().unwrap();
        assert!(redo_data["redo"]["canUndo"].as_bool().unwrap());

        // Verify node is back after redo
        let node_res2 = schema.execute(&*node_query).await;
        assert!(node_res2.errors.is_empty());
        assert_eq!(
            node_res2.data.into_json().unwrap()["node"]["name"],
            "Undo Me"
        );
    }

    #[tokio::test]
    async fn test_delete_node_with_invalid_uuid_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let res = schema
            .execute(r#"mutation { deleteNode(uuid: "not-a-uuid") }"#)
            .await;
        assert!(!res.errors.is_empty());
    }

    #[tokio::test]
    async fn test_undo_on_empty_history_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let res = schema
            .execute(r#"mutation { undo { canUndo canRedo } }"#)
            .await;
        assert!(!res.errors.is_empty());
    }

    #[tokio::test]
    async fn test_create_node_with_transform_applies_transform() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let query = r#"
            mutation {
                createNode(
                    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] }
                    name: "Positioned"
                    transform: { x: 42, y: 84, width: 100, height: 200, rotation: 0, scale_x: 1, scale_y: 1 }
                ) {
                    node {
                        transform
                    }
                }
            }
        "#;

        let res = schema.execute(query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let t = &res.data.into_json().unwrap()["createNode"]["node"]["transform"];
        assert_eq!(t["x"], 42.0);
        assert_eq!(t["y"], 84.0);
        assert_eq!(t["width"], 100.0);
        assert_eq!(t["height"], 200.0);
    }

    /// Helper: creates a frame node via GraphQL and returns its UUID string.
    async fn create_frame(
        schema: &Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription>,
        name: &str,
    ) -> String {
        let query = format!(
            r#"mutation {{ createNode(kind: {{ type: "frame" }}, name: "{name}") {{ uuid }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            res.errors.is_empty(),
            "create_frame errors: {:?}",
            res.errors
        );
        res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// Helper: reparents `child_uuid` under `parent_uuid` at `position` and
    /// returns the parent UUID from the GraphQL response.
    async fn reparent(
        schema: &Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription>,
        child_uuid: &str,
        parent_uuid: &str,
        position: i32,
    ) -> serde_json::Value {
        let query = format!(
            r#"mutation {{ reparentNode(uuid: "{child_uuid}", newParentUuid: "{parent_uuid}", position: {position}) {{ uuid parent children }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "reparent errors: {:?}", res.errors);
        res.data.into_json().unwrap()["reparentNode"].clone()
    }

    #[tokio::test]
    async fn test_reparent_node_mutation_moves_node_to_new_parent() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let parent_uuid = create_frame(&schema, "Parent").await;
        let child_uuid = create_frame(&schema, "Child").await;

        let result = reparent(&schema, &child_uuid, &parent_uuid, 0).await;
        assert_eq!(result["parent"].as_str().unwrap(), parent_uuid);

        // Verify parent now lists child
        let parent_query = format!(r#"{{ node(uuid: "{parent_uuid}") {{ children }} }}"#,);
        let parent_res = schema.execute(&*parent_query).await;
        assert!(parent_res.errors.is_empty());
        let children = &parent_res.data.into_json().unwrap()["node"]["children"];
        assert!(
            children
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c.as_str().unwrap() == child_uuid)
        );
    }

    #[tokio::test]
    async fn test_reparent_node_with_invalid_uuid_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let parent_uuid = create_frame(&schema, "Parent").await;

        let query = format!(
            r#"mutation {{ reparentNode(uuid: "not-valid", newParentUuid: "{parent_uuid}", position: 0) {{ uuid }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(!res.errors.is_empty());
    }

    #[tokio::test]
    async fn test_reorder_children_mutation_changes_position() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let parent_uuid = create_frame(&schema, "Parent").await;
        let child_a = create_frame(&schema, "A").await;
        let child_b = create_frame(&schema, "B").await;
        let child_c = create_frame(&schema, "C").await;

        // Reparent all children under parent
        reparent(&schema, &child_a, &parent_uuid, 0).await;
        reparent(&schema, &child_b, &parent_uuid, 1).await;
        reparent(&schema, &child_c, &parent_uuid, 2).await;

        // Move A from position 0 to position 2
        let reorder_query = format!(
            r#"mutation {{ reorderChildren(uuid: "{child_a}", newPosition: 2) {{ uuid }} }}"#,
        );
        let reorder_res = schema.execute(&*reorder_query).await;
        assert!(
            reorder_res.errors.is_empty(),
            "errors: {:?}",
            reorder_res.errors
        );

        // Verify new order: B, C, A
        let parent_query = format!(r#"{{ node(uuid: "{parent_uuid}") {{ children }} }}"#,);
        let parent_res = schema.execute(&*parent_query).await;
        assert!(parent_res.errors.is_empty());
        let children: Vec<String> = parent_res.data.into_json().unwrap()["node"]["children"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert_eq!(children, vec![child_b, child_c, child_a]);
    }

    #[tokio::test]
    async fn test_reorder_children_on_root_node_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let root_uuid = create_frame(&schema, "Root").await;

        let query = format!(
            r#"mutation {{ reorderChildren(uuid: "{root_uuid}", newPosition: 0) {{ uuid }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "root node has no parent, should fail"
        );
    }

    // ── Style mutation tests ──────────────────────────────────────────

    /// Helper: creates a rectangle node via GraphQL and returns its UUID string.
    async fn create_rect(
        schema: &Schema<super::super::query::QueryRoot, MutationRoot, EmptySubscription>,
        name: &str,
    ) -> String {
        let query = format!(
            r#"mutation {{ createNode(kind: {{ type: "rectangle", corner_radii: [0, 0, 0, 0] }}, name: "{name}") {{ uuid }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            res.errors.is_empty(),
            "create_rect errors: {:?}",
            res.errors
        );
        res.data.into_json().unwrap()["createNode"]["uuid"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn test_set_opacity_mutation_updates_opacity() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query =
            format!(r#"mutation {{ setOpacity(uuid: "{uuid_str}", opacity: 0.5) {{ style }} }}"#,);
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setOpacity"]["style"];
        let opacity = &style["opacity"];
        // StyleValue serializes with #[serde(tag = "type")]: {"type":"literal","value":0.5}
        assert_eq!(opacity["type"], "literal");
        assert_eq!(opacity["value"], 0.5);
    }

    #[tokio::test]
    async fn test_set_opacity_rejects_out_of_range() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        // GraphQL passes NaN as a float literal — but async_graphql rejects NaN
        // at the parser level. Test via a non-finite value that we can represent:
        // use a value out of range instead.
        let query =
            format!(r#"mutation {{ setOpacity(uuid: "{uuid_str}", opacity: 1.5) {{ style }} }}"#,);
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "opacity 1.5 should be rejected (out of range)"
        );
    }

    #[tokio::test]
    async fn test_set_blend_mode_mutation_updates_blend_mode() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setBlendMode(uuid: "{uuid_str}", blendMode: "multiply") {{ style }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setBlendMode"]["style"];
        assert_eq!(style["blend_mode"], "multiply");
    }

    #[tokio::test]
    async fn test_set_blend_mode_rejects_invalid_mode() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setBlendMode(uuid: "{uuid_str}", blendMode: "not_a_mode") {{ style }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "invalid blend mode should be rejected"
        );
    }

    #[tokio::test]
    async fn test_set_corner_radii_mutation_updates_radii() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setCornerRadii(uuid: "{uuid_str}", radii: [4.0, 8.0, 4.0, 8.0]) {{ kind }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let kind = &res.data.into_json().unwrap()["setCornerRadii"]["kind"];
        let radii = kind["corner_radii"].as_array().unwrap();
        assert_eq!(radii[0], 4.0);
        assert_eq!(radii[1], 8.0);
        assert_eq!(radii[2], 4.0);
        assert_eq!(radii[3], 8.0);
    }

    #[tokio::test]
    async fn test_set_corner_radii_on_non_rectangle_returns_error() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let frame_uuid = create_frame(&schema, "Frame").await;

        let query = format!(
            r#"mutation {{ setCornerRadii(uuid: "{frame_uuid}", radii: [4.0, 4.0, 4.0, 4.0]) {{ kind }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "setCornerRadii on a frame should return an error"
        );
    }

    #[tokio::test]
    async fn test_set_corner_radii_rejects_wrong_count() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setCornerRadii(uuid: "{uuid_str}", radii: [4.0, 4.0]) {{ kind }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(
            !res.errors.is_empty(),
            "radii with 2 elements should be rejected"
        );
    }

    #[tokio::test]
    async fn test_set_corner_radii_rejects_negative_values() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        let query = format!(
            r#"mutation {{ setCornerRadii(uuid: "{uuid_str}", radii: [4.0, -1.0, 4.0, 4.0]) {{ kind }} }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(!res.errors.is_empty(), "negative radii should be rejected");
    }

    #[tokio::test]
    async fn test_set_fills_mutation_updates_fills() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        // Solid red fill: Fill::Solid { color: StyleValue::Literal { value: Color::Srgb } }
        // Wire format: [{"type":"solid","color":{"type":"literal","value":{"space":"srgb",...}}}]
        let query = format!(
            r#"mutation {{
                setFills(
                    uuid: "{uuid_str}"
                    fills: [{{type: "solid", color: {{type: "literal", value: {{space: "srgb", r: 1.0, g: 0.0, b: 0.0, a: 1.0}}}}}}]
                ) {{
                    style
                }}
            }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setFills"]["style"];
        let fills = style["fills"].as_array().expect("fills must be an array");
        assert_eq!(fills.len(), 1);
        assert_eq!(fills[0]["type"], "solid");
        assert_eq!(fills[0]["color"]["type"], "literal");
        assert_eq!(fills[0]["color"]["value"]["space"], "srgb");
        assert_eq!(fills[0]["color"]["value"]["r"], 1.0);
    }

    #[tokio::test]
    async fn test_set_strokes_mutation_updates_strokes() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        // A single blue stroke with width 2.
        // Stroke wire format: { color, width, alignment, cap, join }
        // alignment/cap/join use rename_all = "snake_case"
        let query = format!(
            r#"mutation {{
                setStrokes(
                    uuid: "{uuid_str}"
                    strokes: [{{
                        color: {{type: "literal", value: {{space: "srgb", r: 0.0, g: 0.0, b: 1.0, a: 1.0}}}},
                        width: {{type: "literal", value: 2.0}},
                        alignment: "outside",
                        cap: "round",
                        join: "bevel"
                    }}]
                ) {{
                    style
                }}
            }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setStrokes"]["style"];
        let strokes = style["strokes"]
            .as_array()
            .expect("strokes must be an array");
        assert_eq!(strokes.len(), 1);
        assert_eq!(strokes[0]["alignment"], "outside");
        assert_eq!(strokes[0]["cap"], "round");
        assert_eq!(strokes[0]["join"], "bevel");
        assert_eq!(strokes[0]["width"]["value"], 2.0);
        assert_eq!(strokes[0]["color"]["value"]["space"], "srgb");
        assert_eq!(strokes[0]["color"]["value"]["b"], 1.0);
    }

    #[tokio::test]
    async fn test_set_effects_mutation_updates_effects() {
        let state = ServerState::new();
        let schema = test_schema(state);

        let uuid_str = create_rect(&schema, "Rect").await;

        // A single layer_blur effect.
        // Effect::LayerBlur { radius: StyleValue<f64> }
        // Wire format (tag = "type", rename_all = "snake_case"):
        // {"type":"layer_blur","radius":{"type":"literal","value":4.0}}
        let query = format!(
            r#"mutation {{
                setEffects(
                    uuid: "{uuid_str}"
                    effects: [{{type: "layer_blur", radius: {{type: "literal", value: 4.0}}}}]
                ) {{
                    style
                }}
            }}"#,
        );
        let res = schema.execute(&*query).await;
        assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

        let style = &res.data.into_json().unwrap()["setEffects"]["style"];
        let effects = style["effects"]
            .as_array()
            .expect("effects must be an array");
        assert_eq!(effects.len(), 1);
        assert_eq!(effects[0]["type"], "layer_blur");
        assert_eq!(effects[0]["radius"]["type"], "literal");
        assert_eq!(effects[0]["radius"]["value"], 4.0);
    }
}
