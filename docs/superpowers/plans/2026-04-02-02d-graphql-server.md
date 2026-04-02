# GraphQL Server — Implementation Plan (02d)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GraphQL API to the server using `async-graphql`, with queries for reading document state, mutations for executing commands, and subscriptions for real-time updates — running alongside the existing REST+WebSocket endpoints during migration.

**Architecture:** `async-graphql` provides the schema (Query, Mutation, Subscription). It integrates with Axum via `async-graphql-axum`. HTTP POST at `/graphql` handles queries and mutations. WebSocket at `/graphql/ws` handles subscriptions via the `graphql-ws` protocol. The shared `Document` (wrapped in `SendDocument` + `Arc<Mutex>`) is injected into the schema via `.data()`. Mutations resolve UUIDs to NodeIds internally, capture old state for undo, execute through `Document::execute`, and publish to a broadcast channel that feeds subscriptions. A GraphiQL IDE is served at `/graphql` GET for development.

**Tech Stack:** async-graphql 7.2, async-graphql-axum 7.2, tokio broadcast channel, Axum 0.8

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. Server uses `anyhow`. All mutations through `Document::execute`. Sanitize error messages (no internal details to clients). Unsafe Send/Sync only on SendDocument newtype.

---

## File Structure

```
crates/server/
├── Cargo.toml           # MODIFY: add async-graphql, async-graphql-axum
├── src/
│   ├── graphql/
│   │   ├── mod.rs       # NEW: module root, schema builder
│   │   ├── query.rs     # NEW: QueryRoot — document, pages, nodes
│   │   ├── mutation.rs  # NEW: MutationRoot — createNode, setTransform, undo, redo, etc.
│   │   ├── subscription.rs # NEW: SubscriptionRoot — documentChanged
│   │   └── types.rs     # NEW: GraphQL output types (DocumentInfo, Node, Page, etc.)
│   ├── lib.rs           # MODIFY: add graphql module, wire routes
│   └── main.rs          # UNCHANGED
```

The existing REST+WebSocket code stays in place during migration. The GraphQL endpoint is added alongside it. Old code is removed in Plan 02e after the frontend switches over.

---

## Task 1: Add async-graphql dependencies and basic schema

**Files:**
- Modify: `crates/server/Cargo.toml`
- Create: `crates/server/src/graphql/mod.rs`
- Create: `crates/server/src/graphql/types.rs`
- Create: `crates/server/src/graphql/query.rs`
- Modify: `crates/server/src/lib.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Add dependencies to `Cargo.toml`:

Add to workspace `Cargo.toml`:
```toml
async-graphql = "7.2"
async-graphql-axum = "7.2"
async-stream = "0.3"
```

Add to server `Cargo.toml`:
```toml
async-graphql = { workspace = true }
async-graphql-axum = { workspace = true }
async-stream = { workspace = true }
```

- [ ] 3. Create `crates/server/src/graphql/types.rs` — GraphQL output types that wrap core types:

```rust
use async_graphql::SimpleObject;

/// GraphQL representation of document metadata.
#[derive(SimpleObject)]
pub struct DocumentInfoGql {
    pub name: String,
    pub page_count: usize,
    pub node_count: usize,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// GraphQL representation of a serialized node.
#[derive(SimpleObject)]
pub struct NodeGql {
    pub uuid: String,
    pub name: String,
    pub kind: async_graphql::Json<serde_json::Value>,
    pub parent: Option<String>,
    pub children: Vec<String>,
    pub transform: async_graphql::Json<serde_json::Value>,
    pub style: async_graphql::Json<serde_json::Value>,
    pub visible: bool,
    pub locked: bool,
}

/// GraphQL representation of a page with its nodes.
#[derive(SimpleObject)]
pub struct PageGql {
    pub id: String,
    pub name: String,
    pub nodes: Vec<NodeGql>,
}

/// Result of an undo/redo operation.
#[derive(SimpleObject)]
pub struct UndoRedoResult {
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Result of node creation.
#[derive(SimpleObject)]
pub struct CreateNodeResult {
    pub uuid: String,
    pub node: NodeGql,
}
```

- [ ] 4. Create `crates/server/src/graphql/query.rs` — read-only queries:

```rust
use async_graphql::{Context, Object, Result};
use crate::state::AppState;
use super::types::{DocumentInfoGql, PageGql, NodeGql};

pub struct QueryRoot;

#[Object]
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
                page, &doc.arena, &doc.transitions
            ).map_err(|e| format!("serialization error: {e}"))?;

            let nodes = serialized.nodes.iter().map(|sn| NodeGql {
                uuid: sn.id.to_string(),
                name: sn.name.clone(),
                kind: async_graphql::Json(sn.kind.clone()),
                parent: sn.parent.map(|u| u.to_string()),
                children: sn.children.iter().map(|u| u.to_string()).collect(),
                transform: async_graphql::Json(sn.transform.clone()),
                style: async_graphql::Json(sn.style.clone()),
                visible: sn.visible,
                locked: sn.locked,
            }).collect();

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
        let node = doc.arena.get(node_id).map_err(|_| "node not found")?;
        let node_uuid = doc.arena.uuid_of(node_id).map_err(|_| "uuid lookup failed")?;

        Ok(Some(NodeGql {
            uuid: node_uuid.to_string(),
            name: node.name.clone(),
            kind: async_graphql::Json(serde_json::to_value(&node.kind).unwrap_or_default()),
            parent: None, // Would need parent UUID lookup
            children: vec![], // Would need children UUID lookup
            transform: async_graphql::Json(serde_json::to_value(&node.transform).unwrap_or_default()),
            style: async_graphql::Json(serde_json::to_value(&node.style).unwrap_or_default()),
            visible: node.visible,
            locked: node.locked,
        }))
    }
}
```

- [ ] 5. Create `crates/server/src/graphql/mod.rs`:

```rust
pub mod mutation;
pub mod query;
pub mod subscription;
pub mod types;

use async_graphql::Schema;
use crate::state::AppState;

pub type SigilSchema = Schema<query::QueryRoot, mutation::MutationRoot, subscription::SubscriptionRoot>;

/// Builds the GraphQL schema with shared state.
pub fn build_schema(state: AppState) -> SigilSchema {
    Schema::build(
        query::QueryRoot,
        mutation::MutationRoot,
        subscription::SubscriptionRoot,
    )
    .data(state)
    .finish()
}
```

Create placeholder mutation.rs and subscription.rs (empty structs implementing the traits):

```rust
// mutation.rs
use async_graphql::Object;
pub struct MutationRoot;

#[Object]
impl MutationRoot {
    /// Placeholder — mutations added in Task 2.
    async fn version(&self) -> &str { "0.1.0" }
}

// subscription.rs
use async_graphql::Subscription;
use futures_util::Stream;
pub struct SubscriptionRoot;

#[Subscription]
impl SubscriptionRoot {
    /// Placeholder — subscriptions added in Task 3.
    async fn ping(&self) -> impl Stream<Item = String> {
        async_stream::stream! {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                yield "pong".to_string();
            }
        }
    }
}
```

- [ ] 6. Wire into `lib.rs` — add the GraphQL routes alongside existing routes:

Add to `build_app`:
```rust
use async_graphql::http::GraphiQLSource;
use async_graphql_axum::{GraphQL, GraphQLSubscription};

// Build GraphQL schema
let schema = crate::graphql::build_schema(state.clone());

// Add GraphQL routes
let app = Router::new()
    // Existing routes...
    .route("/graphql", get(graphiql).post_service(GraphQL::new(schema.clone())))
    .route_service("/graphql/ws", GraphQLSubscription::new(schema))
    // ... rest of existing routes
```

Add the GraphiQL handler:
```rust
async fn graphiql() -> impl axum::response::IntoResponse {
    axum::response::Html(
        GraphiQLSource::build()
            .endpoint("/graphql")
            .subscription_endpoint("/graphql/ws")
            .finish()
    )
}
```

- [ ] 7. Add `pub mod graphql;` to `lib.rs`.

- [ ] 8. Run tests and verify:

```bash
cargo test -p agent-designer-server
cargo clippy -p agent-designer-server -- -D warnings
cargo fmt -p agent-designer-server
```

Also manually verify: start the server and open `http://localhost:4680/graphql` — the GraphiQL IDE should load. Run a query:
```graphql
{ document { name pageCount nodeCount canUndo canRedo } }
```

- [ ] 9. Commit: `feat(server): add async-graphql with QueryRoot — document, pages, node queries (spec-02)`

---

## Task 2: Add GraphQL mutations

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs`
- Modify: `crates/server/src/graphql/types.rs`

- [ ] 1. Read `CLAUDE.md` in full. All mutations through Document::execute. Sanitize errors.

- [ ] 2. Implement mutations in `mutation.rs`. Each mutation:
   - Accepts UUID-based node addressing (resolves to NodeId via `arena.id_by_uuid`)
   - Reads old state before mutating (for undo)
   - Constructs the appropriate Command struct
   - Calls `doc_guard.execute(Box::new(cmd))`
   - Publishes to a broadcast channel for subscriptions (Task 3 will consume this)
   - Returns the affected data
   - Signals dirty for persistence

Key mutations to implement:
- `createNode(kind: Json, name: String, pageId: Option<ID>, transform: Json) -> CreateNodeResult`
- `deleteNode(uuid: ID) -> bool`
- `renameNode(uuid: ID, newName: String) -> NodeGql`
- `setTransform(uuid: ID, transform: Json) -> NodeGql`
- `setVisible(uuid: ID, visible: bool) -> NodeGql`
- `setLocked(uuid: ID, locked: bool) -> NodeGql`
- `undo -> UndoRedoResult`
- `redo -> UndoRedoResult`

The pattern for each mutation:
```rust
async fn rename_node(&self, ctx: &Context<'_>, uuid: String, new_name: String) -> Result<NodeGql> {
    let state = ctx.data::<AppState>()?;
    let mut doc = state.document.lock().map_err(|_| "document lock error")?;

    let parsed_uuid: uuid::Uuid = uuid.parse()?;
    let node_id = doc.arena.id_by_uuid(&parsed_uuid)
        .ok_or("node not found")?;

    // Capture old state
    let old_name = doc.arena.get(node_id)?.name.clone();

    // Build and execute command
    let cmd = RenameNode { node_id, new_name: new_name.clone(), old_name };
    doc.execute(Box::new(cmd))?;

    // Signal persistence
    drop(doc);
    state.signal_dirty();

    // Return updated node
    // (re-acquire lock to read the result)
    // ...
}
```

- [ ] 3. Add integration tests for mutations.

- [ ] 4. Commit: `feat(server): add GraphQL mutations — createNode, setTransform, undo, redo, etc. (spec-02)`

---

## Task 3: Add GraphQL subscriptions

**Files:**
- Modify: `crates/server/src/graphql/subscription.rs`
- Modify: `crates/server/src/state.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Add a GraphQL-specific broadcast channel to `AppState`. This replaces the old `BroadcastEnvelope` channel for the GraphQL path. The subscription publishes `DocumentEvent` values:

```rust
pub enum DocumentEvent {
    NodeCreated { uuid: String, name: String, kind: String },
    NodeUpdated { uuid: String, field: String },
    NodeDeleted { uuid: String },
    UndoRedo { can_undo: bool, can_redo: bool },
}
```

- [ ] 3. Implement subscriptions in `subscription.rs`:

```rust
#[Subscription]
impl SubscriptionRoot {
    async fn document_changed(&self, ctx: &Context<'_>) -> impl Stream<Item = DocumentEvent> {
        let state = ctx.data_unchecked::<AppState>();
        let mut rx = state.graphql_broadcast_tx.subscribe();

        async_stream::stream! {
            while let Ok(event) = rx.recv().await {
                yield event;
            }
        }
    }
}
```

- [ ] 4. In mutations, after each successful execute, publish to the broadcast channel.

- [ ] 5. Add integration tests: connect via WebSocket, subscribe, mutate, verify subscription event received.

- [ ] 6. Commit: `feat(server): add GraphQL subscriptions for real-time document changes (spec-02)`

---

## Task 4: Add integration tests for the full GraphQL pipeline

**Files:**
- Modify: `crates/server/tests/api_test.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Add tests:
   - Query `document` returns correct info
   - Query `pages` returns pages with nodes
   - Mutation `createNode` creates a node and returns it
   - Mutation `undo` / `redo` works
   - GraphiQL endpoint returns HTML
   - Subscription receives events after mutation (requires WebSocket client connecting to `/graphql/ws`)

- [ ] 3. Commit: `test(server): add GraphQL integration tests (spec-02)`

---

## Task 5: Full verification

- [ ] 1. `cargo test --workspace`
- [ ] 2. `cargo clippy --workspace -- -D warnings`
- [ ] 3. `cargo fmt --check`
- [ ] 4. Manual: open `http://localhost:4680/graphql`, run queries, mutations, verify GraphiQL works
- [ ] 5. Frontend still works (existing REST+WebSocket endpoints unchanged)

---

## Deferred Items

### Plan 02e: Frontend GraphQL Migration
- Add urql + graphql-ws to frontend
- Replace DocumentStore backend from fetch+WebSocket to urql queries/mutations/subscriptions
- Remove old REST endpoints and raw WebSocket protocol from server
- Remove dispatch.rs, ClientMessage/ServerMessage types
