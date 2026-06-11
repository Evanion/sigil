use async_graphql::{Context, ID, Object, Result};

use crate::state::ServerState;

use super::session::{GqlSessionInfo, derive_title};
use super::types::{DocumentInfoGql, NodeGql, PageGql, TokenGql, node_to_gql};

pub struct QueryRoot;

#[Object]
impl QueryRoot {
    /// Get document metadata.
    async fn document(&self, ctx: &Context<'_>) -> Result<DocumentInfoGql> {
        let state = ctx.data::<ServerState>()?;
        let session_id = crate::graphql::mutation::resolve_session(ctx, state)?;
        let session = crate::graphql::mutation::require_live_session(state, session_id)?;
        let guard = session.store.read().await;
        let doc = &guard.0;
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

        let session_id = crate::graphql::mutation::resolve_session(ctx, state)?;
        let session = crate::graphql::mutation::require_live_session(state, session_id)?;

        // Collect serialized page data under the session read lock, then drop
        // it. No `.await` is taken while the guard is held (RF-010 / lock
        // discipline).
        let pages_data = {
            let guard = session.store.read().await;
            let doc = &guard.0;
            doc.pages
                .iter()
                .map(|page| {
                    sigil_core::serialize::page_to_serialized(page, &doc.arena, &doc.transitions)
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

    /// Get all design tokens in the document.
    async fn tokens(&self, ctx: &Context<'_>) -> Result<Vec<TokenGql>> {
        let state = ctx.data::<ServerState>()?;
        let session_id = crate::graphql::mutation::resolve_session(ctx, state)?;
        let session = crate::graphql::mutation::require_live_session(state, session_id)?;
        let guard = session.store.read().await;
        let doc = &guard.0;
        // Collect under the lock, converting each token to a GraphQL representation.
        let tokens: Vec<TokenGql> = doc
            .token_context
            .iter()
            .map(|(_name, token)| TokenGql::from_core(token))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(tokens)
    }

    /// Get all font entries in the document font table.
    ///
    /// Returns every `FontEntry` (including the bundled default) as a JSON
    /// scalar array.  The frontend parses each element with the `FontEntry`
    /// TypeScript type.  Using a JSON scalar keeps the resolver simple and
    /// consistent with the `add_font` broadcast value shape (spec-fonts-1
    /// Task 15a).
    async fn fonts(
        &self,
        ctx: &Context<'_>,
    ) -> Result<async_graphql::Json<Vec<serde_json::Value>>> {
        let state = ctx.data::<ServerState>()?;
        let session_id = crate::graphql::mutation::resolve_session(ctx, state)?;
        let session = crate::graphql::mutation::require_live_session(state, session_id)?;
        let guard = session.store.read().await;
        let doc = &guard.0;
        // Collect all font entries (including the bundled default) under the lock.
        // Each entry is serialized to serde_json::Value so the caller receives
        // the same JSON shape as the `add_font` broadcast.
        let entries: Vec<serde_json::Value> = doc
            .font_table()
            .iter()
            .map(|entry| {
                serde_json::to_value(entry).map_err(|e| {
                    tracing::error!("fonts query: failed to serialize FontEntry: {e}");
                    async_graphql::Error::new("failed to serialize font entry")
                })
            })
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(async_graphql::Json(entries))
    }

    /// Get a single node by UUID.
    ///
    /// RF-012: delegates to the shared `node_to_gql` function in types.rs.
    async fn node(&self, ctx: &Context<'_>, uuid: String) -> Result<Option<NodeGql>> {
        let state = ctx.data::<ServerState>()?;
        let session_id = crate::graphql::mutation::resolve_session(ctx, state)?;
        let session = crate::graphql::mutation::require_live_session(state, session_id)?;
        let guard = session.store.read().await;
        let doc = &guard.0;

        let parsed_uuid: uuid::Uuid = uuid.parse().map_err(|_| "invalid UUID")?;
        let Some(node_id) = doc.arena.id_by_uuid(&parsed_uuid) else {
            return Ok(None);
        };

        Ok(Some(node_to_gql(doc, node_id, parsed_uuid)?))
    }

    /// List every currently-open document session.
    ///
    /// Spec 20 §2.2: callable WITHOUT the `X-Sigil-Session` request header.
    /// Clients use this query to discover sessions before sending mutations
    /// that require the header.
    ///
    /// The list is materialized under the registry's read lock; the
    /// per-session state is then read individually outside the registry
    /// lock to avoid a cross-lock hold. State reads recover from mutex
    /// poisoning by treating the recovered value as authoritative.
    // `sessions` reads the registry (not a session store), so it has no
    // `.await`; async-graphql still requires the resolver to be `async`.
    #[allow(clippy::unused_async)]
    async fn sessions(&self, ctx: &Context<'_>) -> Result<Vec<GqlSessionInfo>> {
        let state = ctx.data::<ServerState>()?;
        let sessions = state.app.sessions.list();
        let infos: Vec<GqlSessionInfo> = sessions
            .iter()
            .map(|s| {
                let state_now = match s.state.lock() {
                    Ok(g) => *g,
                    Err(poison) => *poison.into_inner(),
                };
                GqlSessionInfo {
                    id: ID(s.id.to_string()),
                    workfile_path: s.workfile_path.to_string_lossy().into_owned(),
                    title: derive_title(&s.workfile_path),
                    // Task 17 plumbs the real timestamp through
                    // DocumentSession; until then the field is stable
                    // (empty string) per the GraphQL contract.
                    opened_at: String::new(),
                    state: state_now.into(),
                }
            })
            .collect();
        Ok(infos)
    }
}

#[cfg(test)]
mod tests {
    use crate::graphql::build_schema;
    use crate::test_support::new_state_with_session;

    #[tokio::test]
    async fn test_query_document_reads_session_store() {
        let (state, session) = new_state_with_session();
        {
            let mut guard = session.store.write().await;
            let page = sigil_core::Page::new(
                sigil_core::PageId::new(uuid::Uuid::new_v4()),
                "Page 1".to_string(),
            )
            .expect("create page");
            guard.0.add_page(page).expect("add page");
        }
        let schema = build_schema(state);
        let resp = schema
            .execute("{ document { name pageCount nodeCount } }")
            .await;
        assert!(resp.errors.is_empty(), "errors: {:?}", resp.errors);
        let data = resp.data.into_json().expect("data json");
        assert_eq!(data["document"]["pageCount"], 1);
    }

    /// Verify that the `fonts` query returns at least the bundled default entry
    /// and that a manually-added entry is included in the response with the
    /// correct `id` and `family` fields.
    #[tokio::test]
    async fn test_fonts_query_returns_font_entries() {
        let (state, session) = new_state_with_session();

        // Add a custom font entry to the session's document store.
        let custom_id = uuid::Uuid::new_v4();
        {
            let mut guard = session.store.write().await;
            let metrics = sigil_core::FontMetrics::new(
                1000, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0u8; 10], false,
            )
            .expect("create test FontMetrics");
            let entry = sigil_core::FontEntry::new(
                custom_id,
                "Test Family".to_string(),
                "TestFamily-Regular".to_string(),
                sigil_core::FontSource::SystemReference,
                metrics,
                0,
                sigil_core::EmbedDecision::ReferenceSystem,
                false,
                vec![],
            )
            .expect("create test FontEntry");
            guard.0.font_table_mut().add(entry).expect("add font entry");
        }

        let schema = build_schema(state);
        let resp = schema.execute("{ fonts }").await;
        assert!(resp.errors.is_empty(), "errors: {:?}", resp.errors);

        let data = resp.data.into_json().expect("data json");
        let fonts = data["fonts"].as_array().expect("fonts is array");

        // The document starts with the bundled default entry (Inter), plus the
        // custom one we added — so there must be at least two entries.
        assert!(
            fonts.len() >= 2,
            "expected at least 2 font entries, got {}",
            fonts.len()
        );

        // Verify the custom entry is present with the correct id and family.
        let found = fonts
            .iter()
            .any(|f| f["id"] == custom_id.to_string() && f["family"] == "Test Family");
        assert!(
            found,
            "custom font entry not found in response; got: {fonts:?}"
        );
    }
}
