# Spec 22b — Complete Session-Native Migration; Remove Legacy `AppState`

**Status:** Design
**Date:** 2026-05-29
**Parent:** RF-014 (PR #74 review finding). Decomposed into 22a (per-session persistence, shipped in PR #75) and this spec. The originally-planned 22c (legacy teardown) is **merged into this spec** — the project is pre-release and keeps no legacy/transitional code (see decision log below).

---

## 1. Goal

Make `session.store` the **single source of truth** for every document read, write, and broadcast across all transports, and **delete** the legacy single-document store entirely.

After this spec:
- `App` no longer has a `legacy: AppState` field, nor `Deref`/`DerefMut` to `AppState`.
- The `AppState` type and its global `document`, `event_tx`, `dirty_tx`, `seq_counter`, `signal_dirty`, `publish_transaction`, `next_seq` are removed.
- GraphQL queries, GraphQL mutations, and all MCP tools resolve a session and operate on that session's `store` / `broadcast`.
- Transaction sequencing is **per-session** (each `DocumentSession` owns its `seq_counter`).

This finishes RF-014.

## 2. Background / current state (post-22a `main`)

- **Persistence** is already per-session (22a): the persistence task is driven by `session.broadcast`. `signal_dirty` is a no-op.
- **Frontend live updates** already ride `session.broadcast` via the GraphQL `transactionApplied` subscription (`crates/server/src/graphql/subscription.rs` → `session.broadcast.subscribe()`; the WS handler extracts `sessionId` from `connection_params`). **Deleting the legacy broadcast does not desync clients** (verified).
- **GraphQL mutations** already write `session.store.write()`, then mirror the post-apply doc back to `state.app.legacy.document` and dual-broadcast on `legacy.event_tx` — both purely to keep un-migrated readers consistent.
- **GraphQL queries** still read the **legacy** doc (`state.app.document.lock()`) at ~7 sites in `mutation.rs` (query resolvers live there).
- **MCP tools** (read + write) operate on the legacy `AppState` and mirror legacy→session afterward (`run_session_scoped` + `mirror_to_session`).
- **`seq_counter`, `publish_transaction`, `next_seq`, `signal_dirty`** live on the legacy `AppState`.
- **`default_session_id`** is the header-less / single-session resolution anchor introduced in Spec 20. It is **not** legacy and is retained.

## 3. Decision log

- **3.1 — Collapse 22c into 22b.** The project is pre-release with no external consumers. Per the standing "no legacy cruft" directive, the migration removes all legacy code in the same pass rather than staging deprecation. The 22b/22c split existed only to bound diff size; the legacy teardown is included here.
- **3.2 — Per-session transaction seq.** The global `seq_counter` becomes a per-`DocumentSession` counter. Each session is an independent document; per-session sequencing removes the last shared global and is the correct ordering domain (the frontend orders/dedups within a single session's stream).
- **3.3 — `default_session_id` retained.** It is the Spec 20 header-less/single-session resolution anchor (set when a workfile or in-memory session is opened), not part of the legacy single-document store. Header-less MCP (the common agent path) depends on it.
- **3.4 — `_impl` functions become store-agnostic.** MCP tool `_impl`s change from `(state: &AppState, …)` to `(doc: &mut Document, …)` (writes) or `(doc: &Document, …)` (reads). This makes them pure and unit-testable, and removes their dependence on any store wrapper.

## 4. Architecture

### 4.1 `sigil-state`
- **`App`** → `{ sessions: Arc<Sessions>, default_session_id: Arc<RwLock<Option<SessionId>>> }`. Remove `legacy` and the `Deref`/`DerefMut` impls.
- **`DocumentSession`** gains:
  - `seq_counter: AtomicU64`
  - `fn next_seq(&self) -> u64`
  - `fn publish(&self, kind: MutationEventKind, uuid: Option<String>, transaction: TransactionPayload)` — stamps `transaction.seq = self.next_seq()` and sends `SessionEvent::DocumentEvent(MutationEvent { … })` on `self.broadcast`.
- **Delete** `AppState` (the struct and all its methods) once references reach zero.

### 4.2 `sigil-server` GraphQL
- **Unified resolver** `resolve_session(ctx, state) -> Result<Arc<DocumentSession>>`: `RequestSession` header → `default_session_id` → typed `SESSION_REQUIRED` error. Used by queries, mutations, and subscriptions.
- **Queries** (`query_pages`, `query_node`, `query_tokens`, `query_document_name`, page/node info): resolve session, `session.store.read().await`, read.
- **Mutations**: remove the legacy mirror block and the legacy `event_tx` dual-broadcast and `signal_dirty()`. After applying to `session.store`, call `session.publish(...)` (session-scoped seq).
- **Subscriptions**: already session-native; migrate the 6 legacy-`event_tx` test subscriptions to `session.broadcast`.

### 4.3 `sigil-mcp`
- `SigilMcpServer { sessions: Arc<Sessions>, default_session_id: … }` (no `state: AppState`). `start_stdio(sessions, default_session_id)` — drop `app.legacy.clone()`.
- **`run_session_scoped`** (single write envelope): resolve session via the same contract as GraphQL — explicit `session_id` param → `default_session_id` (the registered single/default session) → typed error → `session.store.write().await` → `_impl(&mut doc, …)` → build broadcast `value` from **post-mutation** doc state → `session.publish(...)`. Delete `mirror_to_session` and the legacy event subscription.
- **Read tools**: resolve session → `session.store.read().await`. Add `session_id: Option<String>` to read inputs that lack it (`get_document_info`, `get_document_tree`, `list_pages`, `list_tokens`, `list_components`).
- **`_impl` refactor**: `(doc: &mut Document, …)` / `(doc: &Document, …)`. `broadcast_and_persist` is replaced by the envelope's `session.publish`.

### 4.4 Startup (`crates/server/src/main.rs`, `state.rs`)
- `new_in_memory_state`: register an in-memory **session** (with a default "Page 1") via `Sessions::register_in_memory`, set `default_session_id`. Remove legacy doc/default-page construction.
- `ServerState::new` / `new_with_document*`: construct `App` without `legacy`. A workfile load opens a disk-backed session (already the 22a path) and sets `default_session_id`.

### 4.5 Tests
- Add `crates/server/src/test_support.rs` (and an MCP equivalent) exposing `new_state_with_session() -> (ServerState, Arc<DocumentSession>)` — a `ServerState` with one in-memory session, returning the session handle.
- Migrate every `ServerState::new()` / `AppState::new()` + `.document.lock()` test (~30) to read/write `session.store` via the helper. MCP `_impl` tests construct a bare `Document` and call the pure `_impl` directly.

## 5. Data flow (after)

```
MCP write tool                         GraphQL mutation
  resolve session                        resolve session (header→default)
  session.store.write()                  session.store.write()
  _impl(&mut doc)                        apply FieldOperations
  value = read post-state                value = post-apply state
  session.publish(kind,uuid,tx) ─┐       session.publish(kind,uuid,tx) ─┐
                                 ▼                                       ▼
                         session.broadcast (SessionEvent::DocumentEvent)
                                 ├──────────────► persistence task (22a) → atomic write
                                 └──────────────► GraphQL transactionApplied → frontend
```

No legacy store, no mirror, no second broadcast.

## 6. Error handling
- Session resolution failure → typed error (`SESSION_REQUIRED` / MCP `SessionResolveError`), surfaced to the caller; never a silent no-op.
- MCP `_impl` validation failures → `McpToolError` (existing), surfaced to the agent with the invalid value + acceptable range.
- A panic inside a session mutation is contained by `Sessions::with_session` (catch_unwind → session marked `Errored`), unchanged.

## 7. Testing
- **TDD**: each migrated `_impl` keeps/adds a unit test on a bare `Document` (validate→apply cycle).
- **Integration**: GraphQL query + mutation round-trip against a session; MCP write → broadcast → persistence; MCP read reflects a prior write — all via the session, asserting `session.store` state and a single `session.broadcast` event (no legacy event).
- **Receipt (CLAUDE.md §11 completion claim)**: PR description quotes `rg 'AppState|\.legacy|event_tx|signal_dirty' crates/` returning only the deletion-confirming absence (zero in non-test production code), proving the migration is complete.
- Full `cargo test --workspace`, `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` green.

---

## WASM Compatibility
No `crates/core/` types, traits, or dependencies are added or changed. MCP `_impl`s move to operate on `sigil_core::Document` (already WASM-compatible) instead of a server-side store wrapper. No new external dependencies. **No WASM risk.**

## Input Validation
This spec introduces **no new data types or user-facing parameters** beyond adding the existing-shaped `session_id: Option<String>` to a few MCP read inputs. `session_id` is parsed as a `SessionId` (UUID) and validated by the existing `resolve_session` path (unknown/invalid id → typed error). All document-field validation is unchanged (still in `validate.rs`, enforced by the same `FieldOperation`s / `_impl`s). **No new validation limits required.**

## PDR Traceability
- **Implements:** RF-014 (single source of truth across transports; remove legacy mirror + dual-broadcast). Completes the multi-session architecture (Spec 20) by removing the single-document transitional store.
- **Defers:** none. This spec closes RF-014.

## Consistency Guarantees
- **Atomic per mutation:** each mutation holds `session.store.write()` for the full validate→apply sequence; the broadcast `value` is read from post-apply state under (or immediately after) the same lock. No lock is held across an `.await` to disk (persistence is a separate task, 22a).
- **Invariant:** a broadcast is emitted **iff** the mutation applied successfully; the persistence task is driven by that same broadcast (22a), so "broadcast ⇒ persisted" holds.
- **Partial failure:** multi-op transactions (e.g., `set_text_style`) roll back applied ops on a later failure within the single write-lock scope (existing `FieldOperation` rollback discipline / §rust-defensive "Multi-Item Mutations Must Roll Back").
- **Seq monotonicity:** per-session `AtomicU64`, `fetch_add` — strictly increasing within a session; ordering is only meaningful within a session (matches the frontend's per-session stream).

## Recursion Safety
No new recursive functions or data structures. Document traversal used by reads is the existing core-crate code with its existing depth guards. **N/A.**

## Transport Boundary Inventory (shared wire-format types)
This is a **migration**, not a wire-format change. The on-the-wire types (`MutationEvent`, `TransactionPayload`, `OperationPayload`, `SessionEvent`) and the `op_type`/`path`/`value` broadcast contract are **unchanged**. For each affected handler:

| Site | Change | Wire impact |
|------|--------|-------------|
| MCP write tools (`crates/mcp/src/tools/*`) | source mutation from `session.store`; publish on `session.broadcast` | none — same `op_type`/`path`/`value`, sourced from post-apply state |
| MCP read tools | read `session.store` | none |
| GraphQL mutations (`graphql/mutation.rs`) | drop legacy mirror + dual-broadcast | none — single broadcast was already the canonical one |
| GraphQL queries (`graphql/mutation.rs`) | read `session.store` | none — query response shape unchanged |
| GraphQL subscription (`graphql/subscription.rs`) | already `session.broadcast` | none |
| `frontend/src/operations/apply-remote.ts` | **no change** | consumes the same `SessionEvent::DocumentEvent` payload |

**Receipt for "no wire change":** (1) `apply-remote.ts` is untouched (diff shows zero changes); (2) the existing broadcast-shape integration tests (`integration_set_field_kind_broadcast.rs` and MCP broadcast tests) pass unchanged after migration; (3) `rg` receipt that legacy symbols are gone (above). Per CLAUDE.md §10, the wire format is unchanged so no new parity fixture is required — the existing broadcast tests are the end-to-end assertion.

## Out of scope
- No new MCP tools, no canvas tools (no Tool Lifecycle section needed).
- No frontend changes (the subscription path is already session-native).
- `src-tauri/` is unaffected (its `AppState` is a distinct Tauri type; it talks to the server over HTTP/GraphQL).
