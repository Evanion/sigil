# Implementation Plan — Spec 22b: Complete Session-Native Migration; Remove Legacy `AppState`

**Spec:** `docs/superpowers/specs/2026-05-29-22b-session-native-migration-design.md`
**Branch:** `main` (a worktree is created at execution time, not now)
**Date:** 2026-05-29

---

## Goal

Make `session.store` the single source of truth for every document read, write, and broadcast across all transports (GraphQL queries, GraphQL mutations, MCP read tools, MCP write tools), and **delete** the legacy single-document `AppState` entirely.

After this plan:
- `App` no longer has a `legacy: AppState` field, nor `Deref`/`DerefMut` to `AppState`.
- The `AppState` type and its `document`, `event_tx`, `dirty_tx`, `seq_counter`, `signal_dirty`, `publish_transaction`, `next_seq`, `broadcast_internal`, `set_event_tx` are removed.
- Transaction sequencing is per-session (each `DocumentSession` owns its `seq_counter`).
- MCP tool `_impl`s are pure functions over `&mut Document` (writes) / `&Document` (reads).
- The wire format (`MutationEvent`, `TransactionPayload`, `OperationPayload`, `SessionEvent`, `op_type`/`path`/`value`) is **unchanged**. `frontend/src/operations/apply-remote.ts` is **not touched** (§10 Transport Boundary Inventory receipt).

This closes RF-014.

## Architecture

```
MCP write tool                         GraphQL mutation
  resolve session (explicit→default)     resolve session (header→default)
  session.store.write().await            session.store.write().await
  _impl(&mut doc, …)                     apply FieldOperations (snapshot rollback)
  value = read post-mutation doc         value = post-apply state (post_apply_value)
  session.publish(kind,uuid,tx) ─┐       session.publish(kind,uuid,tx) ─┐
                                 ▼                                       ▼
                         session.broadcast (SessionEvent::DocumentEvent, per-session seq)
                                 ├──────────────► persistence task (22a) → atomic write
                                 └──────────────► GraphQL transactionApplied → frontend
```

No legacy store, no mirror, no second broadcast.

## Tech Stack

- Rust edition 2024, clippy pedantic (`-D warnings`).
- `thiserror` (core, mcp), `anyhow` (server, cli).
- `tokio::sync::RwLock` for `session.store` (held across `.await` in handlers but never across disk I/O), `std::sync::atomic::AtomicU64` for per-session seq.
- `async-graphql` resolvers, `rmcp` tool router.

## REQUIRED SUB-SKILL: superpowers:subagent-driven-development

Execute this plan using the `superpowers:subagent-driven-development` skill. Each task below is one subagent dispatch. Each subagent MUST read `CLAUDE.md`, `.claude/rules/rust-defensive.md`, and the Spec 22b design before writing code, and MUST run the per-task verification before committing.

## Checkbox syntax

Each task has a checkbox `- [ ]`. Mark `- [x]` only after the task's verification commands pass and the commit is made.

## ENV NOTE

The dev container is unavailable in this execution environment. Use **plain `cargo`** (NOT `./dev.sh cargo`). All commands run from the repo root with absolute-path awareness.

## §9 Parallel-staging note

Tasks here are **sequential** (each depends on the prior compiling green) — do NOT run them in parallel. If for any reason two are dispatched in the same worktree, each subagent MUST `git add <exact-file-path>` for every file in its batch (never `git add -A` / `git add crates/`) and run `git diff --cached --stat` to confirm only its files are staged before committing.

---

## Hard sequencing dependency discovered

**The legacy `AppState` cannot be deleted until ALL readers are migrated.** Concretely:

1. GraphQL **queries** (`query.rs`: `document`, `pages`, `tokens`, `node`) read `state.app.document.lock()` — the legacy `Deref`-exposed mutex. They have no session resolution today.
2. GraphQL **mutations** (`mutation.rs::apply_operations`) write `session.store` then **mirror** back into `state.app.legacy.document` and **dual-broadcast** on `state.app.legacy.event_tx`, and stamp seq from `state.app.next_seq()`.
3. **All MCP tools** (read + write) operate on the legacy `AppState` via `acquire_document_lock(state)` and `state.publish_transaction` / `state.signal_dirty`, then `run_session_scoped` mirrors legacy→session via `mirror_to_session`.
4. `ServerState::new` and `new_with_document_and_workfile_migrated` construct the legacy `AppState` and call `set_event_tx`. `main.rs::new_in_memory_state` writes the default page into `state.app.document.lock()`. `main.rs` passes `state.app.legacy.clone()` to `start_stdio`.
5. The 6 `event_tx()`-based test subscriptions in `subscription.rs` and the seq/publish tests in `state/src/lib.rs` exercise the legacy channel.

Therefore the **GraphQL→legacy mirror and dual-broadcast MUST stay alive** until both the GraphQL queries (Task 4) AND all MCP tools (Task 3) are session-native. The legacy deletion (Task 8) is the final sweep, performed only after Tasks 1–7 leave zero production readers of `AppState`.

This forced the recommended task order in the spec. No order change was required.

---

## File Structure

| File | Action |
|------|--------|
| `crates/state/src/sessions.rs` | **Modify** — add `seq_counter`, `next_seq`, `publish` to `DocumentSession`; construct `seq_counter` in `open` + `register_in_memory` |
| `crates/state/src/lib.rs` | **Modify** — (Task 8) delete `AppState`, `App.legacy`, `Deref`/`DerefMut`; migrate seq tests to `DocumentSession` |
| `crates/server/src/test_support.rs` | **Create** — `new_state_with_session()` helper |
| `crates/server/src/lib.rs` | **Modify** — `pub mod test_support;` (cfg(test) or always-exported behind cfg); re-export cleanups (Task 8) |
| `crates/mcp/src/server.rs` | **Modify** — `SigilMcpServer` drops `state` field; rewrite `run_session_scoped`; delete `mirror_to_session` + `acquire_document_lock`; read tools take `session_id`; `start_stdio` drops `AppState` |
| `crates/mcp/src/tools/nodes.rs` | **Modify** — every `_impl` → `(&mut Document, …)`; drop broadcast calls; migrate tests |
| `crates/mcp/src/tools/pages.rs` | **Modify** — same; `list_pages_impl(&Document)` |
| `crates/mcp/src/tools/text.rs` | **Modify** — same |
| `crates/mcp/src/tools/tokens.rs` | **Modify** — same; `list_tokens_impl(&Document)` |
| `crates/mcp/src/tools/document.rs` | **Modify** — `get_document_info_impl(&Document)` / `get_document_tree_impl(&Document)` |
| `crates/mcp/src/tools/components.rs` | **Modify** — `list_components_impl(&Document)` |
| `crates/mcp/src/tools/broadcast.rs` | **Modify/Delete** — delete `broadcast_and_persist` / `broadcast_token_and_persist`; keep `single_op_transaction` / `multi_op_transaction` / `MCP_USER_ID` (used by the envelope) |
| `crates/mcp/src/types.rs` | **Modify** — add read-tool input structs with `session_id: Option<String>` |
| `crates/mcp/src/resources.rs` | **Modify** — `read_resource(&Document, uri)` |
| `crates/mcp/src/http.rs` | **Modify** — `mcp_http_service` drops `AppState`; migrate tests |
| `crates/server/src/graphql/query.rs` | **Modify** — each resolver resolves session + `session.store.read().await` |
| `crates/server/src/graphql/mutation.rs` | **Modify** — delete legacy mirror + dual-broadcast + `signal_dirty`; use `session.publish` |
| `crates/server/src/graphql/subscription.rs` | **Modify** — migrate 6 `event_tx()` tests to `session.broadcast` |
| `crates/server/src/state.rs` | **Modify** — `ServerState::new*` build `App` without legacy |
| `crates/server/src/main.rs` | **Modify** — `new_in_memory_state` registers in-memory session; `start_stdio` call drops legacy |
| `crates/server/src/session_header.rs`, `session_persistence.rs` | **Modify if needed** — drop any legacy use surfaced by the compiler (Task 8) |
| `crates/server/tests/api_test.rs`, `integration_set_field_kind_broadcast.rs`, `integration_v1_workfile_migration.rs`, `sessions_integration.rs` | **Modify** — migrate to session store (Task 9) |
| `crates/mcp/tests/integration_set_corners.rs` | **Modify** — migrate to session/`Document` (Task 9) |

---

## Task 1 — Per-session transaction seq + `publish` on `DocumentSession`

**Files:** `crates/state/src/sessions.rs`

Additive. `DocumentSession` gains a `seq_counter: AtomicU64` (start at 1; 0 reserved as "unconfirmed" on the client, matching the legacy `AppState::new`), a `next_seq()`, and a `publish()` that stamps `transaction.seq` and sends a `SessionEvent::DocumentEvent`.

### 1a. Failing test first

Append to the `registry_tests` module in `crates/state/src/sessions.rs`:

```rust
    #[test]
    fn test_session_next_seq_starts_at_one_and_increases() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "seq");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");
        let session = sessions.get(id).expect("session");
        assert_eq!(session.next_seq(), 1);
        assert_eq!(session.next_seq(), 2);
        assert_eq!(session.next_seq(), 3);
    }

    #[test]
    fn test_session_publish_stamps_seq_and_delivers_to_subscriber() {
        use crate::{MutationEventKind, OperationPayload, TransactionPayload};
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "publish");
        let sessions = Sessions::new(64);
        let id = sessions.open(&path, stub_loader).expect("open");
        let session = sessions.get(id).expect("session");
        let mut rx = session.broadcast.subscribe();

        session.publish(
            MutationEventKind::NodeUpdated,
            Some("node-abc".to_string()),
            TransactionPayload {
                transaction_id: "tx-1".to_string(),
                user_id: "user-1".to_string(),
                seq: 0,
                operations: vec![OperationPayload {
                    id: "op-1".to_string(),
                    node_uuid: "node-abc".to_string(),
                    op_type: "set_field".to_string(),
                    path: "transform".to_string(),
                    value: Some(serde_json::json!({"x": 10})),
                }],
            },
        );

        match rx.try_recv().expect("event delivered") {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.kind, MutationEventKind::NodeUpdated);
                assert_eq!(me.uuid.as_deref(), Some("node-abc"));
                let tx = me.transaction.expect("transaction present");
                assert_eq!(tx.seq, 1, "first publish gets seq 1");
            }
            other => panic!("expected DocumentEvent, got {other:?}"),
        }

        // Second publish gets the next seq.
        session.publish(
            MutationEventKind::NodeUpdated,
            None,
            TransactionPayload {
                transaction_id: "tx-2".to_string(),
                user_id: "user-1".to_string(),
                seq: 0,
                operations: vec![],
            },
        );
        match rx.try_recv().expect("second event") {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.transaction.expect("tx").seq, 2);
            }
            other => panic!("expected DocumentEvent, got {other:?}"),
        }
    }
```

Run (expect compile failure — `next_seq`/`publish` do not exist):

```
cargo test -p sigil-state test_session_next_seq_starts_at_one_and_increases test_session_publish_stamps_seq_and_delivers_to_subscriber
```

### 1b. Implement

In `crates/state/src/sessions.rs`:

1. Add the import at the top (after the existing `use` block):

```rust
use std::sync::atomic::{AtomicU64, Ordering};
```

2. Add the field + `MutationEvent`/`MutationEventKind`/`TransactionPayload` to the existing `use crate::{...}` import:

```rust
use crate::{MutationEvent, MutationEventKind, SendDocument, TransactionPayload};
```

3. Add the field to `DocumentSession` (after `state`):

```rust
    /// Per-session monotonic sequence counter for transaction ordering.
    /// Starts at 1 (0 is reserved as "unconfirmed" on the client). Ordering is
    /// only meaningful within a single session — the frontend orders/dedups
    /// within one session's broadcast stream.
    pub seq_counter: AtomicU64,
```

4. Add methods to `impl DocumentSession` (alongside `info`):

```rust
    /// Returns the next sequence number, incrementing the counter atomically.
    /// Sequence numbers start at 1 (0 is reserved as "unconfirmed" on the client).
    #[must_use]
    pub fn next_seq(&self) -> u64 {
        self.seq_counter.fetch_add(1, Ordering::AcqRel)
    }

    /// Stamp `transaction.seq` with the next per-session sequence number, wrap
    /// it in a [`MutationEvent`], and broadcast it on this session's channel as
    /// a [`SessionEvent::DocumentEvent`].
    ///
    /// Fire-and-forget: no subscribers is not an error.
    pub fn publish(
        &self,
        kind: MutationEventKind,
        uuid: Option<String>,
        mut transaction: TransactionPayload,
    ) {
        transaction.seq = self.next_seq();
        let event = MutationEvent {
            kind,
            uuid,
            data: None,
            transaction: Some(transaction),
        };
        let _ = self.broadcast.send(SessionEvent::DocumentEvent(event));
    }
```

5. In **both** construction sites, initialize the counter. In `Sessions::open` (the `Arc::new(DocumentSession { … })` literal) and in `register_in_memory`, add:

```rust
            seq_counter: AtomicU64::new(1),
```

(Place it after `state: std::sync::Mutex::new(SessionState::Live),` in each literal.)

### 1c. Verify + commit

```
cargo test -p sigil-state
cargo clippy -p sigil-state -- -D warnings
cargo fmt --check
```

Commit (stage only `crates/state/src/sessions.rs`):

```
git add crates/state/src/sessions.rs
git commit -m "feat(state): add per-session transaction seq + publish to DocumentSession (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] Task 1 complete

---

## Task 2 — Shared `test_support` helper in the server crate

**Files:** `crates/server/src/test_support.rs` (new), `crates/server/src/lib.rs`

Additive. Provides a single constructor returning a `ServerState` with one in-memory session plus the session handle, so the ~30 migrated tests in Task 9 read/write `session.store` instead of the legacy mutex.

### 2a. Create the helper

`crates/server/src/test_support.rs`:

```rust
//! Test-only constructors shared across server unit/integration tests.
//!
//! Spec 22b: with the legacy `AppState` removed, tests can no longer reach a
//! document via `state.app.document.lock()`. This helper returns a
//! `ServerState` with exactly one in-memory session registered (and set as the
//! default), plus the `Arc<DocumentSession>` handle so tests can read or write
//! the session store directly.

use std::sync::Arc;

use sigil_core::Document;
use sigil_state::sessions::DocumentSession;

use crate::state::ServerState;

/// Build a `ServerState` with one in-memory default session and return both
/// the state and the session handle.
///
/// The session's initial document is empty (`Document::new("Untitled")`),
/// matching the historical `ServerState::new()` behaviour.
#[must_use]
pub fn new_state_with_session() -> (ServerState, Arc<DocumentSession>) {
    let state = ServerState::new();
    let id = state
        .app
        .default_session_id()
        .expect("ServerState::new registers a default in-memory session");
    let session = state
        .app
        .sessions
        .get(id)
        .expect("default session must be present");
    (state, session)
}
```

In `crates/server/src/lib.rs`, expose it (search for the existing `pub mod` declarations and add):

```rust
#[cfg(test)]
pub mod test_support;

// Integration tests (in `tests/`) compile against the crate as an external
// dependency, so the helper must be reachable without `#[cfg(test)]`. Expose a
// second always-on path used by integration tests.
#[cfg(not(test))]
pub mod test_support;
```

> Note for the implementer: if `crates/server` is a binary-only target without a `lib.rs` exporting `pub mod`, confirm during execution. The repo already has `crates/server/tests/*` integration tests that import `sigil_server::…`, so a `lib.rs` exists. Use a single unconditional `pub mod test_support;` if the `cfg` split causes a duplicate-module error — the goal is reachability from both `#[cfg(test)]` unit tests and `tests/` integration tests.

### 2b. Verify + commit

```
cargo build -p sigil-server
cargo clippy -p sigil-server -- -D warnings
cargo fmt --check
```

```
git add crates/server/src/test_support.rs crates/server/src/lib.rs
git commit -m "test(server): add new_state_with_session helper (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] Task 2 complete

---

## Task 3 — MCP `_impl` refactor + session-native envelope

**Files:** `crates/mcp/src/server.rs`, `crates/mcp/src/tools/{nodes,pages,text,tokens,document,components}.rs`, `crates/mcp/src/tools/broadcast.rs`, `crates/mcp/src/types.rs`, `crates/mcp/src/resources.rs`, `crates/mcp/src/http.rs`

This is the largest task. It does three things atomically (they cannot be split without an intermediate non-compiling state):

1. Change every `_impl` from `(state: &AppState, …)` to `(doc: &mut Document, …)` (writes) or `(doc: &Document, …)` (reads), and **delete the in-`_impl` broadcast/persist calls** (the envelope publishes now).
2. Rewrite `run_session_scoped` to resolve the session, take `session.store.write().await`, call the `_impl(&mut doc, …)`, build the broadcast `value` from **post-mutation** doc state, then `session.publish(...)`. Delete `mirror_to_session` and `acquire_document_lock`.
3. Migrate read tools to `session.store.read().await` and add `session_id: Option<String>` to the read inputs that lack it.

### Complete write-tool exemplar: `set_text_content`

The current `set_text_content_impl` returns `NodeInfo` AND broadcasts internally. The envelope must broadcast, so `_impl` returns enough for both the response and the broadcast `value`. Pattern: `_impl` returns the response payload and the envelope's caller closure also produces an `OperationPayload` (or a value + op_type + path). To keep the envelope generic, the closure returns `(T, MutationEventKind, Option<String> /*uuid*/, TransactionPayload)` — the response plus a fully-built transaction whose seq is 0 (the envelope's `publish` stamps it).

New `set_text_content_impl` in `crates/mcp/src/tools/text.rs`:

```rust
/// Sets the text content of a text node. Pure mutation over `&mut Document`.
///
/// # Errors
/// - `McpToolError::InvalidInput` if content fails validation.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` if the node is not a text node or validation fails.
pub fn set_text_content_impl(
    doc: &mut sigil_core::Document,
    uuid_str: &str,
    content: &str,
) -> Result<NodeInfo, McpToolError> {
    validate_text_content(content).map_err(|e| McpToolError::InvalidInput(e.to_string()))?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

    let cmd = SetTextContent {
        node_id,
        new_content: content.to_string(),
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    build_node_info(doc, node_id, node_uuid)
}
```

`build_node_info` in `nodes.rs` already takes `&Document` — unchanged.

The `#[tool]` handler in `server.rs` for `set_text_content`:

```rust
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
```

### Complete rewritten envelope: `run_session_scoped`

Replace `run_session_scoped` in `crates/mcp/src/server.rs`. New signature: the closure receives `&mut Document`, returns `(T, MutationEventKind, Option<String>, TransactionPayload)`. The envelope holds the write lock for the closure, reads the result, then publishes (which stamps per-session seq and broadcasts). Persistence is driven by `session.broadcast` (22a) — no `signal_dirty` needed.

```rust
    /// Session-scoped mutation envelope: resolve the session, take the
    /// session store write lock, run the pure `_impl` closure, and publish the
    /// resulting transaction on the session's broadcast channel (which the 22a
    /// persistence task and the GraphQL `transactionApplied` subscription both
    /// consume).
    ///
    /// The closure returns the tool's response value plus a fully-built
    /// `TransactionPayload` (with `seq = 0`); `session.publish` stamps the
    /// per-session seq before broadcasting. The broadcast `value` MUST be
    /// sourced from post-mutation document state inside the closure.
    ///
    /// # Errors
    /// Returns `Err(rmcp::ErrorData)` when (a) session resolution fails, (b) the
    /// session was closed between resolution and lookup (TOCTOU → NotFound), or
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

        let (result, kind, uuid, transaction) = {
            let mut guard = session.store.write().await;
            impl_fn(&mut guard.0).map_err(|e| e.to_mcp_error())?
        };

        session.publish(kind, uuid, transaction);

        Ok(Json(result))
    }
```

**Deletions in `server.rs`:**
- Delete `mirror_to_session` entirely.
- Delete `acquire_document_lock` entirely.
- Delete the `use sigil_state::{AppState, SendDocument, Sessions};` → change to `use sigil_state::Sessions;`. Add `use sigil_core::Document;` if needed by the envelope type annotations (they use fully-qualified `sigil_core::Document`, so no new import strictly required; keep imports minimal to satisfy clippy).
- Remove the `state: AppState` field from `SigilMcpServer`. Constructor becomes `pub fn new(sessions: Arc<Sessions>) -> Self`.
- `read_resource` in the `ServerHandler` impl: change `crate::resources::read_resource(&self.state, &request.uri)` to read from a resolved session. Resources have no session arg; resolve via `resolve_session(&self.sessions, None)` (default/single-session rule) then `session.store.read()`. Because `read_resource` is currently sync and the handler returns a future, build it inside the async future:

```rust
    fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ReadResourceResult, rmcp::ErrorData>>
    + rmcp::service::MaybeSendFuture
    + '_ {
        let sessions = self.sessions.clone();
        async move {
            let session_id = crate::server::resolve_session_or_error(&sessions, None)?;
            let session = sessions.get(session_id).ok_or_else(|| {
                crate::session_resolver::SessionResolveError::NotFound {
                    id: session_id.to_string(),
                    open_sessions: vec![],
                }
                .to_rmcp_error()
            })?;
            let guard = session.store.read().await;
            crate::resources::read_resource(&guard.0, &request.uri).map(ReadResourceResult::new)
        }
    }
```

- `start_stdio`: drop the `AppState` param.

```rust
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
            Err(e) => tracing::error!("MCP server failed to start: {e}"),
        }
    })
}
```

- Update the `tests` module in `server.rs`: `SigilMcpServer::new(state, sessions)` → `SigilMcpServer::new(sessions)` (drop `state`).

### Complete read-tool exemplar: `get_document_info`

The read tool currently takes no input. Add a new input struct in `crates/mcp/src/types.rs` and migrate the `_impl` to `&Document`.

New input struct in `types.rs` (place near the other read result types):

```rust
/// Input for read tools that target a session: `get_document_info`,
/// `get_document_tree`, `list_pages`, `list_tokens`, `list_components`.
#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
pub struct SessionScopedInput {
    /// Optional session id. When omitted and exactly one session is open it is
    /// used; when multiple are open the call errors with the open-sessions list.
    #[serde(default)]
    pub session_id: Option<String>,
}
```

> The five read tools share one input shape, so a single `SessionScopedInput` covers all of them.

New `get_document_info_impl` in `crates/mcp/src/tools/document.rs`:

```rust
#[must_use]
pub fn get_document_info_impl(doc: &sigil_core::Document) -> DocumentInfo {
    DocumentInfo {
        name: doc.metadata.name.clone(),
        page_count: doc.pages.len(),
        node_count: doc.arena.len(),
    }
}
```

(`get_document_tree_impl` similarly takes `&sigil_core::Document` and drops the `acquire_document_lock` line — the body otherwise unchanged, operating on the passed `doc`.)

The `#[tool]` read handler in `server.rs`. Read tools need a session resolve + `store.read()`; add a small private async read helper to avoid repetition:

```rust
    /// Resolve the session and run a read closure against the session store.
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
```

`get_document_info` handler (now async + takes input):

```rust
    async fn get_document_info(
        &self,
        Parameters(input): Parameters<crate::types::SessionScopedInput>,
    ) -> Result<Json<crate::types::DocumentInfo>, rmcp::ErrorData> {
        self.run_session_read(input.session_id.as_deref(), |doc| {
            Ok(crate::tools::document::get_document_info_impl(doc))
        })
        .await
    }
```

(`list_tokens_impl` returns `Result<Vec<TokenInfo>, McpToolError>`; for it the closure forwards the `?` directly. `list_components_impl` and `list_pages_impl` return plain `Vec<_>`; wrap in `Ok(...)`.)

### `broadcast.rs` changes

Delete `broadcast_and_persist` and `broadcast_token_and_persist` (and their `#[cfg(test)]` tests `test_broadcast_and_persist_signals_dirty_and_publishes` / `test_broadcast_token_and_persist_signals_dirty_and_publishes`, which reference `AppState::set_event_tx`). **Keep** `single_op_transaction`, `multi_op_transaction`, `MCP_USER_ID`, and their two passing tests (`test_single_op_transaction_creates_valid_payload`, `test_multi_op_transaction_creates_valid_payload`) — the envelope uses these constructors. Remove the now-unused `use sigil_state::{AppState, MutationEventKind, …}` items, keeping only `OperationPayload, TransactionPayload`.

### `resources.rs` change

`read_resource(state: &AppState, uri: &str)` → `read_resource(doc: &sigil_core::Document, uri: &str)`. The body currently calls `acquire_document_lock(state)` internally (or reads `state.document`); replace with direct reads on `doc`. Migrate its 5 `#[cfg(test)]` tests to build a `Document` and call `read_resource(&doc, uri)`.

### `http.rs` change

`mcp_http_service(state: AppState, sessions: Arc<Sessions>)` → `mcp_http_service(sessions: Arc<Sessions>)`; the factory closure `move || Ok(SigilMcpServer::new(state.clone(), sessions.clone()))` → `move || Ok(SigilMcpServer::new(sessions.clone()))`. Migrate the http tests (they construct `AppState::new()` + register sessions) to register sessions directly via `Sessions::register_in_memory` and drop the `AppState`.

### The complete write-tool checklist (apply the identical transformation to each)

Each tool's `_impl` becomes `(&mut Document, …)`, drops its `super::broadcast::broadcast_*` call, and returns its existing payload. Each `#[tool]` handler in `server.rs` wraps the `_impl` in a closure that builds the matching `single_op_transaction`/`multi_op_transaction` from the **same `op_type`/`path`/`value`** the old broadcast used (copy them verbatim from the current `broadcast_and_persist` arguments — see each file's current call), then returns `(payload, kind, uuid, tx)`.

**24 write tools** (the broadcast `op_type`/`path`/`value` to reuse is taken from each `_impl`'s current `broadcast_and_persist` call):

`nodes.rs`:
1. `create_node` → `create_node_impl` — `NodeCreated`, op `create_node`, path `""`, value `{uuid, kind, name}` (already includes `uuid`/`id`; **keep the `"uuid"` key AND add `"id"` per the §"Entity-creation broadcasts must include `id`" rule — verify the current value carries the id; current code uses `"uuid"`. Add an `"id"` field equal to the uuid so the frontend handler finds it**).
2. `delete_nodes` → `delete_nodes_impl` — `NodeDeleted`, op `delete_nodes`, path `""`, value `{node_uuids: [...]}` (uuid `None`; use `single_op_transaction("", "delete_nodes", "", value)`).
3. `rename_node` → `rename_node_impl` — `NodeUpdated`, op `set_field`, path `name`, value `<new_name>`.
4. `set_transform` → `set_transform_impl` — `NodeUpdated`, op `set_field`, path `transform`, value `serde_json::to_value(new_transform)`.
5. `set_visible` → `set_visible_impl` — `NodeUpdated`, op `set_field`, path `visible`, value `<bool>`.
6. `set_locked` → `set_locked_impl` — `NodeUpdated`, op `set_field`, path `locked`, value `<bool>`.
7. `reparent_node` → `reparent_node_impl` — `NodeUpdated`, op `reparent`, path `""`, value `{parentUuid, position}`.
8. `reorder_children` → `reorder_children_impl` — `NodeUpdated`, op `reorder`, path `""`, value `{newPosition}`.
9. `set_opacity` → `set_opacity_impl` — `NodeUpdated`, op `set_field`, path `style.opacity`, value `{type:"literal", value}`.
10. `set_blend_mode` → `set_blend_mode_impl` — `NodeUpdated`, op `set_field`, path `style.blend_mode`, value `<str>`.
11. `set_fills` → `set_fills_impl` — `NodeUpdated`, op `set_field`, path `style.fills`, value `<fills array>`.
12. `set_strokes` → `set_strokes_impl` — `NodeUpdated`, op `set_field`, path `style.strokes`, value `<strokes array>`.
13. `set_effects` → `set_effects_impl` — `NodeUpdated`, op `set_field`, path `style.effects`, value `<effects array>`.
14. `set_corners` → `set_corners_impl` — `NodeUpdated`, op `set_field`, path `kind`, value = **post-apply** `serde_json::to_value(&node.kind)` (already read post-apply inside the old `_impl`; the new `_impl` must return this `kind_json` so the closure can use it as the broadcast value).

`pages.rs`:
15. `create_page` → `create_page_impl(doc, name)` — `PageCreated`, op `create_page`, path `page`, value `{id, name}` (`id` present — satisfies entity-creation rule).
16. `delete_page` → `delete_page_impl` — `PageDeleted`, op `delete_page`, path `page`, value `None`.
17. `rename_page` → `rename_page_impl` — `PageUpdated`, op `rename_page`, path `name`, value `{name}`.
18. `reorder_page` → `reorder_page_impl` — `PageUpdated`, op `reorder_page`, path `position`, value `{newPosition}`.

`tokens.rs` (use `single_op_transaction("", op, token_name, value)` — token events have empty node_uuid and `uuid = None`):
19. `create_token` → `create_token_impl(doc, &input)` — `TokenCreated`, op `create`, path `<name>`, value `{name}`.
20. `update_token` → `update_token_impl(doc, &input)` — `TokenUpdated`, op `update`, path `<name>`, value `{name}`.
21. `rename_token` → `rename_token_impl` — `TokenUpdated`, op `rename_token`, path `<old_name>`, value `{old_name, new_name}`.
22. `delete_token` → `delete_token_impl` — `TokenDeleted`, op `delete`, path `<name>`, value `{name}`.

`text.rs`:
23. `set_text_content` → `set_text_content_impl` (exemplar above).
24. `set_text_style` → `set_text_style_impl` — `NodeUpdated`, **multi-op** transaction: `set_text_style_impl` must return `(MutationResult, Vec<OperationPayload>)` so the closure can pass the per-field ops into `multi_op_transaction`. The old `_impl` already builds `broadcast_ops: Vec<OperationPayload>` inside the lock; return it instead of publishing. Preserve the single-pass snapshot capture + rollback discipline (per §rust-defensive "Multi-Item Mutations Must Roll Back" — the existing `capture_old_field` single-pass-before-apply logic is retained verbatim).

> For `create_node`, `set_corners`, and `set_text_style` the broadcast value is **post-mutation** (created node identity; canonical `kind`; per-field ops). The `_impl` reads it under the same write lock and returns it. This satisfies the §"Broadcast `value` must be sourced from post-mutation document state" rule — the envelope never forwards raw input for these.

### MCP read-tool checklist (apply identical `&Document` transform + `SessionScopedInput`)

The **6 read tools** (`get_document_info` exemplar above):
1. `get_document_info` → `get_document_info_impl(&Document)` (exemplar).
2. `get_document_tree` → `get_document_tree_impl(&Document)`.
3. `list_pages` → `list_pages_impl(&Document) -> Vec<PageInfo>`.
4. `list_tokens` → `list_tokens_impl(&Document) -> Result<Vec<TokenInfo>, McpToolError>`.
5. `list_components` → `list_components_impl(&Document) -> Vec<ComponentInfo>`.
6. `list_open_sessions` / `get_active_workfiles` — **unchanged** (operate on `self.sessions`, not a document; no `session_id`).

Each of the 5 read tools' `#[tool]` handler gains `Parameters(input): Parameters<crate::types::SessionScopedInput>` and routes through `run_session_read(input.session_id.as_deref(), …)`.

### Migrating the `_impl` unit tests

Each tool file's `#[cfg(test)] mod tests` currently builds `AppState::new()` + calls `create_page_impl(&state, …)`. Migrate the helpers to build a bare `Document` and call the pure `_impl`s. Exemplar for `nodes.rs`:

```rust
    fn make_doc_with_page() -> (sigil_core::Document, String) {
        let mut doc = sigil_core::Document::new("Untitled".to_string());
        let page = create_page_impl(&mut doc, "Page 1").expect("create page");
        (doc, page.id)
    }
```

Then e.g. `create_node_impl(&mut doc, "frame", "My Frame", Some(&page_id), None, None)`. The "verify document state" reads that previously did `acquire_document_lock(&state)` now use `&doc` directly. Apply the same mechanical change to the test modules in `nodes.rs`, `pages.rs`, `text.rs`, `tokens.rs`, `document.rs`, `components.rs`, `broadcast.rs` (drop the two deleted-helper tests), `resources.rs`, and the `server.rs` tests module.

### Envelope/integration tests for Task 3

Add a session-level integration test in `crates/mcp/src/server.rs` `tests` module (or a new `crates/mcp/tests/` file) proving the write→broadcast path against a session. Failing test first:

```rust
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
                Ok((
                    page,
                    sigil_state::MutationEventKind::PageCreated,
                    None,
                    tx,
                ))
            })
            .await;
        assert!(result.is_ok(), "tool should succeed: {result:?}");

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
```

(Add `use sigil_state::sessions::SessionEvent;` to the test imports.)

### Verify + commit (Task 3)

```
cargo test -p sigil-mcp
cargo clippy -p sigil-mcp -- -D warnings
cargo fmt --check
```

Stage every file touched in this task explicitly:

```
git add crates/mcp/src/server.rs crates/mcp/src/tools/nodes.rs crates/mcp/src/tools/pages.rs \
        crates/mcp/src/tools/text.rs crates/mcp/src/tools/tokens.rs crates/mcp/src/tools/document.rs \
        crates/mcp/src/tools/components.rs crates/mcp/src/tools/broadcast.rs crates/mcp/src/types.rs \
        crates/mcp/src/resources.rs crates/mcp/src/http.rs
git commit -m "refactor(mcp): session-native tool impls + envelope, drop legacy AppState use (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Commit type note: this changes the `_impl` signatures (function-signature change) and adds `SessionScopedInput` (new type). Per CLAUDE.md §6 it is therefore **`refactor` is NOT appropriate** if a reviewer reads strictly — but the user-visible behavior is preserved and the wire format is unchanged. Use `refactor(mcp):` only if the diff is behavior-preserving; otherwise prefer `feat(mcp): make MCP tools session-native (spec-22b)`. The implementer chooses the accurate type after seeing the final diff; the safer default here is **`feat`** because `SessionScopedInput` is a new type and read tools gain a `session_id` parameter.

- [ ] Task 3 complete

---

## Task 4 — GraphQL queries → `session.store`

**Files:** `crates/server/src/graphql/query.rs`

Each query resolver resolves a session (header→default) and reads `session.store.read().await`. Reuse the resolution contract: `query.rs` does not yet have a `resolve_session`. Add a thin resolver matching `mutation.rs::resolve_session` semantics (header → default → `SESSION_REQUIRED`) so queries and mutations share behavior. To avoid duplicating `resolve_session` + `require_live_session`, make those two functions in `mutation.rs` `pub(crate)` and import them into `query.rs`.

### 4a. Failing test first

`query.rs` has no test module today. Add one that exercises the migrated `document` resolver via the schema against a session. Because `QueryRoot` resolvers need a `ServerState` in `ctx`, drive them through the schema. Failing test:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::graphql::build_schema; // confirm the schema builder path during execution
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
            .unwrap();
            guard.0.add_page(page).unwrap();
        }
        let schema = build_schema(state);
        let resp = schema
            .execute("{ document { name pageCount nodeCount } }")
            .await;
        assert!(resp.errors.is_empty(), "errors: {:?}", resp.errors);
        let data = resp.data.into_json().unwrap();
        assert_eq!(data["document"]["pageCount"], 1);
    }
}
```

Run (expect failure — resolver still reads legacy `state.app.document`, which after Task 8 is gone; before Task 8 the legacy doc is empty so `pageCount` is 0 ≠ 1):

```
cargo test -p sigil-server --lib graphql::query::tests::test_query_document_reads_session_store
```

> Confirm `build_schema`'s real name/path during execution (`rg 'fn build_schema|Schema::build' crates/server/src/graphql/`). Use the actual constructor.

### 4b. Implement

In `mutation.rs`, change `fn resolve_session` and `fn require_live_session` to `pub(crate) fn …` (signatures otherwise unchanged).

In `query.rs`, import and use them. Migrated `document` resolver (complete):

```rust
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
```

Add the imports at the top of `query.rs`:

```rust
use crate::state::ServerState;
```

(already present). The `resolve_session`/`require_live_session` are reached via the fully-qualified path above, so no extra `use` is required.

### Checklist for the remaining query resolvers

Apply the identical pattern (resolve session → `session.store.read().await` → read `&guard.0`):

- `pages` — replace the `let doc = state.app.document.lock()…` block (lines ~37–52) with the session read; the `page_to_serialized` collection and the outside-the-lock `PageGql` build are unchanged (just source `doc` from `&guard.0`; note the `read()` guard is held across the serialize loop, which is fine — no `.await` inside).
- `tokens` — replace `state.app.document.lock()` with the session read.
- `node` — replace `state.app.document.lock()` with the session read; UUID parse + `node_to_gql` unchanged.
- `sessions` — **unchanged** (operates on `state.app.sessions`, no document read).

### 4c. Verify + commit

```
cargo test -p sigil-server --lib graphql
cargo clippy -p sigil-server -- -D warnings
cargo fmt --check
```

```
git add crates/server/src/graphql/query.rs crates/server/src/graphql/mutation.rs
git commit -m "feat(server): GraphQL queries read session store (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] Task 4 complete

---

## Task 5 — GraphQL mutations → session-only (drop legacy mirror + dual-broadcast)

**Files:** `crates/server/src/graphql/mutation.rs`

Now that queries (Task 4) and MCP tools (Task 3) are session-native, the mutation's legacy mirror, legacy dual-broadcast, `signal_dirty()`, and `next_seq()` can go. Use `session.publish(...)` for per-session seq.

### 5a. Failing test first

There is an existing test `test_apply_operations_broadcasts_to_session_channel` (line ~3217) that subscribes to `session.broadcast` and asserts a `DocumentEvent`. Add a stricter test that the seq is **per-session** (starts at 1 for a fresh session, since the global counter is gone):

```rust
    #[tokio::test]
    async fn test_apply_operations_uses_per_session_seq() {
        use crate::test_support::new_state_with_session;
        let (state, session) = new_state_with_session();
        // Seed a page so create_node has somewhere to land — via the session store.
        let page_id = {
            let mut g = session.store.write().await;
            let pid = sigil_core::PageId::new(uuid::Uuid::new_v4());
            g.0.add_page(sigil_core::Page::new(pid, "P".to_string()).unwrap()).unwrap();
            pid.uuid().to_string()
        };
        let schema = crate::graphql::build_schema(state);
        let mutation = format!(
            r#"mutation {{ applyOperations(userId:"u", operations:[{{createPage:{{id:"{}", name:"X"}}}}]) {{ seq }} }}"#,
            uuid::Uuid::new_v4()
        );
        let _ = page_id; // page seeding optional for create_page
        let resp = schema.execute(&mutation).await;
        assert!(resp.errors.is_empty(), "errors: {:?}", resp.errors);
        let seq = resp.data.into_json().unwrap()["applyOperations"]["seq"]
            .as_str().unwrap().to_string();
        assert_eq!(seq, "1", "first mutation on a fresh session gets per-session seq 1");
    }
```

> Confirm the exact GraphQL input field names for `createPage` during execution (`rg 'CreatePageInput' crates/server/src/graphql/types.rs`). Adjust the mutation string to the real schema.

Run (expect failure — current code uses the global `state.app.next_seq()` which after `ServerState::new` starts at 1 but increments across the whole app, so the assertion may pass coincidentally; the real signal is the compile change once the legacy path is removed). The primary safety net is the unchanged `test_apply_operations_broadcasts_to_session_channel`.

```
cargo test -p sigil-server --lib graphql::mutation::tests::test_apply_operations_uses_per_session_seq
```

### 5b. Implement

In `apply_operations`, replace the block from the mirror through the legacy broadcast (current lines ~1430–1488):

Delete the legacy-mirror inner block:

```rust
            // ── DELETE THIS BLOCK ──
            {
                let mut legacy = match state.app.legacy.document.lock() { … };
                legacy.0 = doc_guard.0.clone();
            }
```

Replace the post-loop "Signal dirty + broadcast" section (from `state.app.signal_dirty();` through the legacy `if let Some(tx) = state.app.legacy.event_tx() { … }`) with:

```rust
        // Broadcast on the per-session channel. The 22a persistence task and
        // the GraphQL `transactionApplied` subscription both consume this
        // event. Seq is stamped per-session by `publish`.
        let transaction = multi_op_transaction(Some(user_id), broadcast_ops);
        let seq_after = session.next_seq();
        // We need the seq in both the response and the event; stamp it
        // explicitly rather than via `publish` so the response can return it.
        let mut transaction = transaction;
        transaction.seq = seq_after;

        let mutation_event = MutationEvent {
            kind: event_kind,
            uuid: None,
            data: None,
            transaction: Some(transaction.clone()),
        };
        let _ = session
            .broadcast
            .send(SessionEvent::DocumentEvent(mutation_event));

        Ok(ApplyOperationsResult {
            seq: transaction.seq.to_string(),
        })
```

> Rationale for `next_seq` + manual stamp instead of `publish`: `apply_operations` must return the assigned `seq` in `ApplyOperationsResult`, and `session.publish` consumes the transaction. Stamping via `session.next_seq()` keeps the per-session ordering domain and lets the resolver return the value. (`publish` is used by MCP, which does not return a seq.)

Remove now-unused imports surfaced by the compiler (e.g. `TransactionPayload` may remain via `multi_op_transaction`; `MutationEventKind` stays). Do NOT remove `state.app.sessions` usage.

### 5c. Verify + commit

```
cargo test -p sigil-server --lib graphql::mutation
cargo clippy -p sigil-server -- -D warnings
cargo fmt --check
```

```
git add crates/server/src/graphql/mutation.rs
git commit -m "refactor(server): GraphQL mutations broadcast on session channel only (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] Task 5 complete

---

## Task 6 — Startup + `ServerState` constructors (build `App` without legacy)

**Files:** `crates/server/src/state.rs`, `crates/server/src/main.rs`

`App` will lose its `legacy` field in Task 8, so `ServerState::new*` must stop constructing it. This task changes the constructors to build the session-backed `App` and changes `main.rs` to register the in-memory default page on the **session**, not the legacy doc, and to call `start_stdio(sessions)` without the legacy arg. **`App::new`/`App::from_legacy` still exist until Task 8** — so this task must compile while `App.legacy` is still present. Strategy: keep `App::from_legacy` working but have `ServerState::new` stop relying on the legacy document for the session's initial doc (it already clones `Document::new` independently).

> **PLAN CORRECTION — read before implementing Task 6 (and verify in Task 2):** `ServerState::new` ALREADY registers a default in-memory session and sets `default_session_id` (this is why the Task 2 helper's `default_session_id().expect(...)` works, and why the kept test `test_server_state_registers_default_in_memory_session` exists). Therefore:
> - **Task 2's helper requires no change to `new()`** to function — confirm with `rg -n 'register_in_memory|set_default_session_id' crates/server/src/state.rs` at the start of Task 2; if `new()` does NOT already register a default session, add the registration to `new()` as part of Task 2 (not Task 6) so the helper's `.expect(...)` holds.
> - **Task 6 must NOT add a second `register_in_memory`/`set_default_session_id`** in `ServerState::new` (that would double-register and `set_default_session_id` would point at the second, orphaning the first). The 6a snippet below shows the registration ONLY for the case where `new()` did not already have it; if `new()` already registers (the expected state), 6a's job is reduced to **removing the `set_event_tx` call and the legacy-document clone/read** — leave the existing single registration intact.
> - `new_in_memory_state` (6c) seeds the default page on the **already-registered** default session — it never registers a new one.

### 6a. `ServerState::new`

Replace the body so the session is seeded from a fresh `Document` directly (no read of the legacy mutex):

```rust
    #[must_use]
    pub fn new() -> Self {
        let legacy = AppState::new();
        let app = App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY);

        // Register an in-memory default session seeded with a fresh empty
        // document. (Until Task 8 removes `AppState`, the legacy store still
        // exists but is no longer read by any handler.)
        let id = app
            .sessions
            .register_in_memory(Document::new("Untitled".to_string()));
        app.set_default_session_id(Some(id));

        Self {
            app,
            persistence: Arc::new(SessionPersistence::new()),
        }
    }
```

This removes the `set_event_tx` call and the legacy-document clone. (After Task 8 the `AppState::new()`/`from_legacy` lines are deleted; this task only stops *reading* the legacy doc.)

### 6b. `new_with_document_and_workfile_migrated`

The disk-backed session is registered by `main.rs::load_workfile_into_state` via `open_session_with`. `ServerState` only needs to hold the `App` + persistence. Replace the body to stop mirroring into legacy and stop `set_event_tx`:

```rust
    #[must_use]
    pub fn new_with_document_and_workfile_migrated(
        doc: Document,
        workfile_path: PathBuf,
        _migrated_from: Option<u32>,
    ) -> Self {
        // The session store is the persistence + read source (22a/22b). The
        // legacy `AppState` no longer mirrors the document.
        let document = Arc::new(Mutex::new(SendDocument(doc)));
        let legacy = AppState::new_with_document(document, workfile_path);
        Self {
            app: App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY),
            persistence: Arc::new(SessionPersistence::new()),
        }
    }
```

> `load_workfile_into_state` already clones `loaded.document` into `doc_for_session` and registers it via `open_session_with`, so the session store gets the loaded doc independently of the legacy `AppState`. No change required to `load_workfile_into_state` other than the `start_stdio` call site below.

### 6c. `main.rs::new_in_memory_state`

Seed the default page on the **session store**, not the legacy doc. The session is already registered by `ServerState::new` (see the correction note below — do NOT register a second session here).

`new_in_memory_state` is called from inside `#[tokio::main]` (call site ~line 108), so it MUST be `async` and seed via `.write().await` — `blocking_write()` panics inside a runtime context. Use the async form:

```rust
async fn new_in_memory_state() -> ServerState {
    tracing::info!("no WORKFILE configured — running in-memory mode");
    let state = ServerState::new();
    let id = state.app.default_session_id().expect("default session");
    if let Some(session) = state.app.sessions.get(id) {
        let mut guard = session.store.write().await;
        let page_id = sigil_core::PageId::new(uuid::Uuid::new_v4());
        let page =
            sigil_core::Page::new(page_id, "Page 1".to_string()).expect("create default page");
        guard.0.add_page(page).expect("add default page");
    }
    state
}
```

Call site (line ~108): `new_in_memory_state()` → `new_in_memory_state().await`.

### 6d. `main.rs::start_stdio` call site

Lines ~124–127:

```rust
        Some(sigil_mcp::server::start_stdio(state.app.sessions.clone()))
```

(drop the `state.app.legacy.clone()` argument).

### 6e. Update `state.rs` tests

The `tests` module in `state.rs` reads `state.app.document.lock()` and `state.app.event_tx()`. Migrate:
- `test_server_state_new_creates_empty_document` → read the default session store: resolve `default_session_id`, `sessions.get`, `store.blocking_read()` (or make the test `#[tokio::test]` and `.read().await`). Assert `name == "Untitled"`, `pages == 0`, `arena == 0`.
- `test_signal_dirty_without_persistence_is_noop` → delete (the method is gone after Task 8; the persistence-noop behavior is covered by `test_server_state_exposes_empty_persistence_manager`).
- `test_server_state_has_event_tx_configured` → delete (event_tx is gone after Task 8).
- `test_server_state_registers_default_in_memory_session` → keep, unchanged.
- `test_server_state_exposes_empty_persistence_manager` → keep.

> The `event_tx`/`signal_dirty` deletions here anticipate Task 8. They are removed in this task because keeping them would break once Task 8 lands and they add no value now (the channel is no longer read). This is acceptable because Task 6 still compiles (the methods exist until Task 8) — but to keep this task green, **only delete tests, do not delete the methods yet**.

### 6f. Verify + commit

```
cargo build -p sigil-server
cargo test -p sigil-server --lib state
cargo clippy -p sigil-server -- -D warnings
cargo fmt --check
```

```
git add crates/server/src/state.rs crates/server/src/main.rs
git commit -m "refactor(server): seed in-memory session store at startup, drop legacy doc reads (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] Task 6 complete

---

## Task 7 — Subscription test migration (legacy `event_tx` → `session.broadcast`)

**Files:** `crates/server/src/graphql/subscription.rs`

The 6 test cases in the `tests` module use `state.app.event_tx()` / `state.app.publish_transaction(...)`. Retarget them to a session's `broadcast` channel + `session.publish`. The production resolvers (`document_changed`, `transaction_applied`) already subscribe to `session.broadcast` — no production change.

### 7a. Migrate each test

The 6 affected tests (each calls `state.app.event_tx()` or `state.app.publish_transaction`):

1. `test_broadcast_delivers_to_subscriber`
2. `test_broadcast_without_listeners_does_not_panic`
3. `test_multiple_subscribers_each_receive_event`
4. `test_subscriber_receives_events_in_order`
5. `test_transaction_applied_yields_full_payload`
6. `test_transaction_applied_legacy_fallback`
7. `test_transaction_applied_preserves_order`
8. `test_document_changed_still_works_alongside_transaction_applied`

(`test_session_channel_delivers_document_event` and `test_sessions_have_independent_broadcast_channels` are already session-native — keep unchanged. `test_document_event_clone_preserves_fields`, `test_from_mutation_event_converts_all_kinds`, `test_broadcast_capacity_matches_constant` do not touch `event_tx` — keep unchanged.)

Migration recipe per test: replace

```rust
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx = event_tx.subscribe();
        // … event_tx.send(MutationEvent { … }) …
```

with

```rust
        use crate::test_support::new_state_with_session;
        use sigil_state::sessions::SessionEvent;
        let (_state, session) = new_state_with_session();
        let mut rx = session.broadcast.subscribe();
        // session.broadcast.send(SessionEvent::DocumentEvent(MutationEvent { … }))
        // and on recv, match SessionEvent::DocumentEvent(me) => DocumentEvent::from_mutation_event(me)
```

For the `publish_transaction` cases (5, 7, 8) replace `state.app.publish_transaction(kind, uuid, tx)` with `session.publish(kind, uuid, tx)` and consume `SessionEvent::DocumentEvent` from `rx.recv().await`. For `test_transaction_applied_legacy_fallback` (6), the "legacy event without transaction" is still a valid `MutationEvent` with `transaction: None` — send it via `session.broadcast.send(SessionEvent::DocumentEvent(MutationEvent { …, transaction: None }))`; the `from_mutation_event` fallback path is unchanged, so the test still asserts empty `transaction_id` / seq "0".

### 7b. Verify + commit

```
cargo test -p sigil-server --lib graphql::subscription
cargo clippy -p sigil-server -- -D warnings
cargo fmt --check
```

```
git add crates/server/src/graphql/subscription.rs
git commit -m "test(server): retarget subscription tests to session broadcast (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] Task 7 complete

---

## Task 8 — Delete legacy `AppState` (the big sweep)

**Files:** `crates/state/src/lib.rs`, `crates/server/src/state.rs`, `crates/server/src/main.rs`, `crates/mcp/src/server.rs` (residual), and any file the compiler flags (`session_header.rs`, `session_persistence.rs`, `lib.rs` re-exports).

At this point Tasks 3–7 have removed every production reader of `AppState`. Now delete it.

### 8a. `crates/state/src/lib.rs`

Delete:
- The `AppState` struct (lines ~153–184), `impl AppState` (all methods: `new`, `new_with_document`, `set_event_tx`, `event_tx`, `broadcast_internal`, `next_seq`, `publish_transaction`, `signal_dirty`), `impl Default for AppState`.
- The `App.legacy` field; `App::new` and `App::from_legacy` must change (see below).
- `impl Deref for App` and `impl DerefMut for App`.
- The `seq_counter` import usage (`AtomicU64`/`Ordering`) if now unused in this file.
- The `dirty_tx`/`event_tx`/`mpsc`/`broadcast::Sender<MutationEvent>` fields are gone with `AppState`; remove `use tokio::sync::{broadcast, mpsc};` if unused (the `MutationEvent` type itself stays — used by `SessionEvent`).
- Migrate the `tests` module: delete every test that constructs `AppState` (`test_app_state_new_creates_empty_document`, `test_new_with_document_holds_doc_and_path_without_persistence`, `test_signal_dirty_without_persistence_is_noop`, `test_broadcast_internal_*`, `test_event_tx_*`, `test_next_seq_*`, `test_publish_transaction_*`, `test_mutation_event_without_transaction_is_backwards_compatible`). The seq/publish behavior is now covered on `DocumentSession` (Task 1). Keep `test_mutation_broadcast_capacity_enforced` (constant test) and the `SendDocument` Send/Sync compile assertions. Delete `_assert_app_state_is_send_sync`.
- `app_wrapper_tests`: delete `test_app_deref_exposes_legacy_appstate` and `test_app_from_legacy_preserves_existing_appstate`. Update `test_app_new_constructs_empty_sessions_registry` and the `open_session_with` tests to the new `App::new(capacity)` signature (no legacy).

New `App`:

```rust
#[derive(Clone)]
pub struct App {
    /// Multi-session registry — the single source of truth for all document
    /// state across transports.
    pub sessions: Arc<Sessions>,
    /// The default [`SessionId`] for header-less / single-session resolution.
    pub default_session_id: Arc<RwLock<Option<SessionId>>>,
}

impl App {
    #[must_use]
    pub fn new(broadcast_capacity: usize) -> Self {
        Self {
            sessions: Arc::new(Sessions::new(broadcast_capacity)),
            default_session_id: Arc::new(RwLock::new(None)),
        }
    }
    // open_session_with, default_session_id, set_default_session_id,
    // close_synthetic_sessions — unchanged.
}
```

Delete `App::from_legacy`.

### 8b. `crates/server/src/state.rs`

- Remove `AppState`, `MutationEvent` from the `pub use sigil_state::{…}` re-export if now unused by downstream (keep `App`, `MUTATION_BROADCAST_CAPACITY`, `MutationEventKind`, `SendDocument`, `SessionId`, `Sessions`, `SessionsError`). `MutationEvent` is still used by `mutation.rs`/`subscription.rs`, so keep it re-exported.
- `ServerState::new`: build `App::new(MUTATION_BROADCAST_CAPACITY)` (no legacy), then register the in-memory session + default id as in Task 6 but without `AppState`:

```rust
    #[must_use]
    pub fn new() -> Self {
        let app = App::new(MUTATION_BROADCAST_CAPACITY);
        let id = app
            .sessions
            .register_in_memory(Document::new("Untitled".to_string()));
        app.set_default_session_id(Some(id));
        Self {
            app,
            persistence: Arc::new(SessionPersistence::new()),
        }
    }
```

- `new_with_document_and_workfile_migrated`: drop the `AppState`/`SendDocument`/`Mutex` construction entirely. It no longer needs to hold the document — the disk session is registered by `load_workfile_into_state`. Reduce to:

```rust
    #[must_use]
    pub fn new_with_document_and_workfile_migrated(
        _doc: Document,
        _workfile_path: PathBuf,
        _migrated_from: Option<u32>,
    ) -> Self {
        Self {
            app: App::new(MUTATION_BROADCAST_CAPACITY),
            persistence: Arc::new(SessionPersistence::new()),
        }
    }
```

> **Caution:** `load_workfile_into_state` currently passes `loaded.document` here AND clones it into `doc_for_session`. After this change, `new_with_document_and_workfile_migrated` ignores the doc, and the session is created solely by `open_session_with(workfile_path, |_| Ok(doc_for_session))`. Verify `load_workfile_into_state` still moves `loaded.document` into `doc_for_session` before calling the constructor (it does — `doc_for_session = loaded.document.clone()` then `loaded.document` is moved into the constructor which now ignores it). To avoid an unnecessary clone, change `load_workfile_into_state` to move `loaded.document` directly into `doc_for_session` and pass a throwaway/`Document::new` to the constructor, OR simplify the constructor to take no document. **Preferred:** delete `new_with_document_and_workfile_migrated`'s document param usage and have `load_workfile_into_state` call `ServerState::new_empty_for_workfile()` (a small constructor returning `App::new` + persistence) then `open_session_with`. Pick the cleaner shape during execution; the invariant to preserve is: the session store holds the loaded document and persistence is registered for it.

- Migrate/delete `state.rs` tests per Task 6e (those referencing `event_tx`/`signal_dirty`/`document.lock` are now hard errors — delete or rewrite to read the session store).

### 8c. `crates/server/src/main.rs`

- Remove the now-stale comments mentioning the legacy `AppState`. The `start_stdio(state.app.sessions.clone())` call and async `new_in_memory_state` from Task 6 already drop legacy. Confirm no remaining `state.app.document` / `state.app.legacy` references.

### 8d. `crates/mcp/src/server.rs` and the compiler sweep

- The `SigilMcpServer` doc comment still references the legacy `AppState`; update the prose. Confirm no `AppState`/`SendDocument`/`mirror_to_session`/`acquire_document_lock` symbols remain (Task 3 removed them).
- Run `cargo build --workspace` and fix every remaining compile error (likely in `session_header.rs`, `session_persistence.rs`, `lib.rs` re-exports, and any test helper still naming `AppState`).

### 8e. Verify + commit

```
cargo build --workspace
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --check
```

Stage the swept files explicitly:

```
git add crates/state/src/lib.rs crates/server/src/state.rs crates/server/src/main.rs \
        crates/mcp/src/server.rs
# plus any additional files the compiler forced — add each by explicit path
git commit -m "refactor(state): delete legacy AppState, App.legacy, Deref, dual-broadcast (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] Task 8 complete

---

## Task 9 — Test migration sweep (remaining test constructors)

**Files:** `crates/server/tests/api_test.rs`, `crates/server/tests/integration_set_field_kind_broadcast.rs`, `crates/server/tests/integration_v1_workfile_migration.rs`, `crates/server/tests/sessions_integration.rs`, `crates/mcp/tests/integration_set_corners.rs`, `crates/server/src/session_header.rs`, `crates/server/src/session_persistence.rs` (only if they contain test code reading the legacy doc)

Any remaining `AppState::new()` / `ServerState::new()` + `.document.lock()` / `event_tx()` / `legacy` in test code must move to the session store. Use `crate::test_support::new_state_with_session()` (server) or build a `Document` + `Sessions::register_in_memory` (mcp) and read/write `session.store`.

### Per-file checklist (each file's failing-then-green is its own micro-cycle)

For each file: run `cargo test -p <crate> --test <name>` to see the compile errors, migrate every `state.app.document.lock()` to a `session.store.read()/write().await`, every `AppState::new()`/`SigilMcpServer::new(state, sessions)` to the new constructors, and every `event_tx()`/`legacy` to the session channel; then re-run green.

1. `crates/server/tests/api_test.rs` — migrate document-state assertions to the default session store.
2. `crates/server/tests/integration_set_field_kind_broadcast.rs` — this is the §10 broadcast-shape receipt test; it must pass **unchanged in assertion** (only its state construction migrates). Verify it still asserts the same `op_type`/`path`/`value` shape.
3. `crates/server/tests/integration_v1_workfile_migration.rs` — migrate any legacy-doc read to the session store; the migration smoke-test (load → persist → `.backup-v1/`) is driven by `load_workfile_into_state` + persistence, unchanged.
4. `crates/server/tests/sessions_integration.rs` — likely already session-native; fix any `legacy`/`event_tx` use.
5. `crates/mcp/tests/integration_set_corners.rs` — migrate to a `Document` + session; call the pure `set_corners_impl(&mut doc, …)` or drive through `SigilMcpServer::new(sessions)`.

### Verify + commit

```
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
```

Stage each migrated test file by explicit path:

```
git add crates/server/tests/api_test.rs crates/server/tests/integration_set_field_kind_broadcast.rs \
        crates/server/tests/integration_v1_workfile_migration.rs crates/server/tests/sessions_integration.rs \
        crates/mcp/tests/integration_set_corners.rs
# plus session_header.rs / session_persistence.rs if their test modules changed
git commit -m "test: migrate remaining tests to session store (spec-22b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] Task 9 complete

---

## Task 10 — Receipts + final gate

**Files:** none (verification only)

### 10a. §11 completion receipt — legacy symbols gone from production code

Run the exact command and confirm zero matches in non-test production code:

```
rg 'AppState|\.legacy\b|event_tx|signal_dirty|publish_transaction|mirror_to_session|acquire_document_lock' crates/ --type rust -g '!**/tests/**'
```

Expected: **only** matches inside `#[cfg(test)]` modules are acceptable if any test still legitimately references a kept symbol; there should be **zero** matches of `AppState`, `.legacy`, `event_tx`, `signal_dirty`, `publish_transaction`, `mirror_to_session`, `acquire_document_lock` in production code. Quote the empty (or test-only) result in the PR description.

Also confirm the struct is gone:

```
rg 'struct AppState|impl AppState|App::from_legacy' crates/ --type rust
```

Expected: **empty**.

### 10b. §10 Transport Boundary Inventory receipt — wire format unchanged

Confirm the frontend dispatcher is untouched:

```
git diff --stat main -- frontend/src/operations/apply-remote.ts
```

Expected: **no output** (zero changes to `apply-remote.ts`). The wire types (`MutationEvent`, `TransactionPayload`, `OperationPayload`, `SessionEvent`) and the `op_type`/`path`/`value` contract are unchanged; the existing broadcast-shape tests (`integration_set_field_kind_broadcast.rs` + the MCP envelope test from Task 3) are the end-to-end assertions. Per spec §"Receipt for no wire change", no new parity fixture is required.

### 10c. Full gate

```
cargo build --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
cargo check --target wasm32-unknown-unknown -p sigil-core
```

> `sigil-core` is untouched by this plan, but run the WASM check to confirm no transitive regression (spec §WASM Compatibility: "No WASM risk").

### 10d. Commit (if any fmt-only fixups were needed)

If 10c produced fmt changes, commit them; otherwise no commit. Then the branch is ready for `/review`.

- [ ] Task 10 complete

---

## Notes for the executing agent

- **Lock discipline:** `session.store` is a `tokio::sync::RwLock` — holding the write guard across the `impl_fn` closure in `run_session_scoped` is correct (single read-modify-write under one lock, per §rust-defensive "Hold Locks for the Full Read-Modify-Write Sequence"). Never hold it across disk I/O — persistence is a separate task (22a).
- **Rollback:** `set_text_style_impl` retains the single-pass snapshot-before-apply + reverse-order rollback (§rust-defensive "Multi-Item Mutations Must Roll Back"). Do not regress it during the `&mut Document` migration.
- **Entity-creation `id`:** `create_node` and `create_page` broadcasts MUST carry the entity's stable UUID under `"id"` (CLAUDE.md §4 "Entity-creation broadcasts"). Verify the broadcast `value` includes `"id"` for both.
- **No `unwrap`/`expect` in `crates/core`:** this plan touches no core code, but the MCP `_impl`s still must return `Result` (they do).
- **Conventional commits:** reference `spec-22b` in each message. Use `feat` for type-introducing tasks (1, 3 if `SessionScopedInput`/signature changes count, 4), `refactor` for behavior-preserving (5, 6, 8), `test` for test-only (2, 7, 9).
