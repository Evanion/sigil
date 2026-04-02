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

use agent_designer_core::commands::node_commands::{
    CreateNode, DeleteNode, RenameNode, SetLocked, SetVisible,
};
use agent_designer_core::commands::style_commands::SetTransform;
use agent_designer_core::node::Transform;
use agent_designer_core::{NodeId, NodeKind, PageId};

use crate::state::AppState;

use super::types::{
    CreateNodeResult, DocumentEvent, DocumentEventType, NodeGql, UndoRedoResult, node_to_gql,
};

pub struct MutationRoot;

/// Acquires the document lock, recovering from mutex poisoning.
fn acquire_document_lock(
    state: &AppState,
) -> std::sync::MutexGuard<'_, crate::state::SendDocument> {
    match state.document.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::error!("document mutex poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

/// Publishes a [`DocumentEvent`] to the GraphQL subscription broadcast channel.
///
/// If no subscription clients are listening the send will fail silently -- this
/// is expected and logged at `debug` level.
pub fn publish_event(state: &AppState, event: DocumentEvent) {
    if state.graphql_tx.send(event).is_err() {
        tracing::debug!("no GraphQL subscription listeners");
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
        let state = ctx.data::<AppState>()?;

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

        state.signal_dirty();
        publish_event(
            state,
            DocumentEvent {
                event_type: DocumentEventType::NodeCreated,
                uuid: Some(node_uuid.to_string()),
                data: None,
                sender_id: None,
            },
        );

        Ok(CreateNodeResult {
            uuid: node_uuid.to_string(),
            node: node_gql,
        })
    }

    /// Delete a node by UUID.
    async fn delete_node(&self, ctx: &Context<'_>, uuid: String) -> Result<bool> {
        let state = ctx.data::<AppState>()?;
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

        state.signal_dirty();
        publish_event(
            state,
            DocumentEvent {
                event_type: DocumentEventType::NodeDeleted,
                uuid: Some(parsed_uuid.to_string()),
                data: None,
                sender_id: None,
            },
        );

        Ok(true)
    }

    /// Rename a node by UUID.
    async fn rename_node(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        new_name: String,
    ) -> Result<NodeGql> {
        let state = ctx.data::<AppState>()?;
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

        state.signal_dirty();
        publish_event(
            state,
            DocumentEvent {
                event_type: DocumentEventType::NodeUpdated,
                uuid: Some(parsed_uuid.to_string()),
                data: Some(async_graphql::Json(serde_json::json!({"field": "name"}))),
                sender_id: None,
            },
        );

        Ok(node_gql)
    }

    /// Set the transform of a node by UUID.
    async fn set_transform(
        &self,
        ctx: &Context<'_>,
        uuid: String,
        transform: Json<serde_json::Value>,
    ) -> Result<NodeGql> {
        let state = ctx.data::<AppState>()?;
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

        state.signal_dirty();
        publish_event(
            state,
            DocumentEvent {
                event_type: DocumentEventType::NodeUpdated,
                uuid: Some(parsed_uuid.to_string()),
                data: Some(async_graphql::Json(
                    serde_json::json!({"field": "transform"}),
                )),
                sender_id: None,
            },
        );

        Ok(node_gql)
    }

    /// Set the visibility of a node by UUID.
    async fn set_visible(&self, ctx: &Context<'_>, uuid: String, visible: bool) -> Result<NodeGql> {
        let state = ctx.data::<AppState>()?;
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

        state.signal_dirty();
        publish_event(
            state,
            DocumentEvent {
                event_type: DocumentEventType::NodeUpdated,
                uuid: Some(parsed_uuid.to_string()),
                data: Some(async_graphql::Json(serde_json::json!({"field": "visible"}))),
                sender_id: None,
            },
        );

        Ok(node_gql)
    }

    /// Set the locked state of a node by UUID.
    async fn set_locked(&self, ctx: &Context<'_>, uuid: String, locked: bool) -> Result<NodeGql> {
        let state = ctx.data::<AppState>()?;
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

        state.signal_dirty();
        publish_event(
            state,
            DocumentEvent {
                event_type: DocumentEventType::NodeUpdated,
                uuid: Some(parsed_uuid.to_string()),
                data: Some(async_graphql::Json(serde_json::json!({"field": "locked"}))),
                sender_id: None,
            },
        );

        Ok(node_gql)
    }

    /// Undo the last command.
    async fn undo(&self, ctx: &Context<'_>) -> Result<UndoRedoResult> {
        let state = ctx.data::<AppState>()?;

        let (can_undo, can_redo) = {
            let mut doc_guard = acquire_document_lock(state);
            doc_guard.undo().map_err(|e| {
                tracing::warn!("undo failed: {e}");
                async_graphql::Error::new("undo failed")
            })?;
            (doc_guard.can_undo(), doc_guard.can_redo())
        };

        state.signal_dirty();
        publish_event(
            state,
            DocumentEvent {
                event_type: DocumentEventType::UndoRedo,
                uuid: None,
                data: Some(async_graphql::Json(
                    serde_json::json!({"can_undo": can_undo, "can_redo": can_redo}),
                )),
                sender_id: None,
            },
        );

        Ok(UndoRedoResult { can_undo, can_redo })
    }

    /// Redo the last undone command.
    async fn redo(&self, ctx: &Context<'_>) -> Result<UndoRedoResult> {
        let state = ctx.data::<AppState>()?;

        let (can_undo, can_redo) = {
            let mut doc_guard = acquire_document_lock(state);
            doc_guard.redo().map_err(|e| {
                tracing::warn!("redo failed: {e}");
                async_graphql::Error::new("redo failed")
            })?;
            (doc_guard.can_undo(), doc_guard.can_redo())
        };

        state.signal_dirty();
        publish_event(
            state,
            DocumentEvent {
                event_type: DocumentEventType::UndoRedo,
                uuid: None,
                data: Some(async_graphql::Json(
                    serde_json::json!({"can_undo": can_undo, "can_redo": can_redo}),
                )),
                sender_id: None,
            },
        );

        Ok(UndoRedoResult { can_undo, can_redo })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{EmptySubscription, Schema};

    /// Builds a test schema with the given `AppState`.
    fn test_schema(
        state: AppState,
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
        let state = AppState::new();

        // Add a page so we can test page placement
        {
            let mut doc = state.document.lock().unwrap();
            let page_uuid = uuid::Uuid::new_v4();
            let page = agent_designer_core::document::Page::new(
                PageId::new(page_uuid),
                "Home".to_string(),
            );
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
        let state = AppState::new();
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
        let state = AppState::new();
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
        let state = AppState::new();
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
        let state = AppState::new();
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
        let state = AppState::new();
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
        let state = AppState::new();
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
        let state = AppState::new();
        let schema = test_schema(state);

        let res = schema
            .execute(r#"mutation { deleteNode(uuid: "not-a-uuid") }"#)
            .await;
        assert!(!res.errors.is_empty());
    }

    #[tokio::test]
    async fn test_undo_on_empty_history_returns_error() {
        let state = AppState::new();
        let schema = test_schema(state);

        let res = schema
            .execute(r#"mutation { undo { canUndo canRedo } }"#)
            .await;
        assert!(!res.errors.is_empty());
    }

    #[tokio::test]
    async fn test_create_node_with_transform_applies_transform() {
        let state = AppState::new();
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
}
