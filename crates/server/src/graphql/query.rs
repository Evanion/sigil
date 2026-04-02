use async_graphql::{Context, Object, Result};

use crate::state::AppState;

use super::types::{DocumentInfoGql, NodeGql, PageGql};

pub struct QueryRoot;

#[Object]
#[allow(clippy::unused_async)]
impl QueryRoot {
    /// Get document metadata.
    async fn document(&self, ctx: &Context<'_>) -> Result<DocumentInfoGql> {
        let state = ctx.data::<AppState>()?;
        let doc = state.document.lock().map_err(|_| "document lock error")?;
        Ok(DocumentInfoGql {
            name: doc.metadata.name.clone(),
            page_count: doc.pages.len(),
            node_count: doc.arena.len(),
            can_undo: doc.can_undo(),
            can_redo: doc.can_redo(),
        })
    }

    /// Get full document state — all pages with their nodes.
    async fn pages(&self, ctx: &Context<'_>) -> Result<Vec<PageGql>> {
        let state = ctx.data::<AppState>()?;
        let doc = state.document.lock().map_err(|_| "document lock error")?;

        let mut result = Vec::new();
        for page in &doc.pages {
            let serialized = agent_designer_core::serialize::page_to_serialized(
                page,
                &doc.arena,
                &doc.transitions,
            )
            .map_err(|e| {
                tracing::error!("serialization error: {e}");
                async_graphql::Error::new("serialization failed")
            })?;

            let nodes = serialized
                .nodes
                .iter()
                .map(|sn| NodeGql {
                    uuid: sn.id.to_string(),
                    name: sn.name.clone(),
                    kind: async_graphql::Json(sn.kind.clone()),
                    parent: sn.parent.map(|u| u.to_string()),
                    children: sn.children.iter().map(ToString::to_string).collect(),
                    transform: async_graphql::Json(sn.transform.clone()),
                    style: async_graphql::Json(sn.style.clone()),
                    visible: sn.visible,
                    locked: sn.locked,
                })
                .collect();

            result.push(PageGql {
                id: serialized.id.to_string(),
                name: serialized.name.clone(),
                nodes,
            });
        }
        Ok(result)
    }

    /// Get a single node by UUID.
    async fn node(&self, ctx: &Context<'_>, uuid: String) -> Result<Option<NodeGql>> {
        let state = ctx.data::<AppState>()?;
        let doc = state.document.lock().map_err(|_| "document lock error")?;

        let parsed_uuid: uuid::Uuid = uuid.parse().map_err(|_| "invalid UUID")?;
        let Some(node_id) = doc.arena.id_by_uuid(&parsed_uuid) else {
            return Ok(None);
        };
        let node = doc.arena.get(node_id).map_err(|_| "node lookup failed")?;

        // Resolve parent UUID
        let parent_uuid = match node.parent {
            Some(pid) => Some(
                doc.arena
                    .uuid_of(pid)
                    .map_err(|_| "parent uuid lookup failed")?,
            ),
            None => None,
        };

        // Resolve children UUIDs
        let children_uuids: Vec<String> = node
            .children
            .iter()
            .filter_map(|cid| doc.arena.uuid_of(*cid).ok())
            .map(|u| u.to_string())
            .collect();

        let kind_json = serde_json::to_value(&node.kind).unwrap_or_default();
        let transform_json = serde_json::to_value(node.transform).unwrap_or_default();
        let style_json = serde_json::to_value(&node.style).unwrap_or_default();

        Ok(Some(NodeGql {
            uuid: parsed_uuid.to_string(),
            name: node.name.clone(),
            kind: async_graphql::Json(kind_json),
            parent: parent_uuid.map(|u| u.to_string()),
            children: children_uuids,
            transform: async_graphql::Json(transform_json),
            style: async_graphql::Json(style_json),
            visible: node.visible,
            locked: node.locked,
        }))
    }
}
