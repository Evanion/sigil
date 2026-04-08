use async_graphql::{Context, Object, Result};

use crate::state::ServerState;

use super::types::{DocumentInfoGql, NodeGql, PageGql, node_to_gql};

pub struct QueryRoot;

#[Object]
#[allow(clippy::unused_async)]
impl QueryRoot {
    /// Get document metadata.
    async fn document(&self, ctx: &Context<'_>) -> Result<DocumentInfoGql> {
        let state = ctx.data::<ServerState>()?;
        let doc = state
            .app
            .document
            .lock()
            .map_err(|_| "document lock error")?;
        Ok(DocumentInfoGql {
            name: doc.metadata.name.clone(),
            page_count: doc.pages.len(),
            node_count: doc.arena.len(),
        })
    }

    /// Get full document state -- all pages with their nodes.
    ///
    /// RF-010: clone serialized data under the lock, drop the lock, then build
    /// the GraphQL response types outside the lock scope.
    async fn pages(&self, ctx: &Context<'_>) -> Result<Vec<PageGql>> {
        let state = ctx.data::<ServerState>()?;

        // Collect serialized page data under the lock, then drop it.
        let pages_data = {
            let doc = state
                .app
                .document
                .lock()
                .map_err(|_| "document lock error")?;
            doc.pages
                .iter()
                .map(|page| {
                    agent_designer_core::serialize::page_to_serialized(
                        page,
                        &doc.arena,
                        &doc.transitions,
                    )
                })
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|e| {
                    tracing::error!("serialization error: {e}");
                    async_graphql::Error::new("serialization failed")
                })?
        }; // lock dropped

        // Build PageGql from serialized data outside the lock
        let result = pages_data
            .into_iter()
            .map(|serialized| {
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

                PageGql {
                    id: serialized.id.to_string(),
                    name: serialized.name.clone(),
                    nodes,
                }
            })
            .collect();

        Ok(result)
    }

    /// Get a single node by UUID.
    ///
    /// RF-012: delegates to the shared `node_to_gql` function in types.rs.
    async fn node(&self, ctx: &Context<'_>, uuid: String) -> Result<Option<NodeGql>> {
        let state = ctx.data::<ServerState>()?;
        let doc = state
            .app
            .document
            .lock()
            .map_err(|_| "document lock error")?;

        let parsed_uuid: uuid::Uuid = uuid.parse().map_err(|_| "invalid UUID")?;
        let Some(node_id) = doc.arena.id_by_uuid(&parsed_uuid) else {
            return Ok(None);
        };

        Ok(Some(node_to_gql(&doc, node_id, parsed_uuid)?))
    }
}
