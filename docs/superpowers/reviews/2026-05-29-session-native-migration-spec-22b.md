# Review Findings — Session-Native Migration (Spec 22b)

**Branch:** `feature/session-native-migration-spec-22b`
**Date:** 2026-05-29
**Reviewers:** Architect, Security, Backend Engineer (quality), Logic, Compliance, Data Scientist, DevOps
**Diff:** 23 files, ~1,835 insertions / ~2,331 deletions (all Rust; no frontend)

Completes RF-014: `session.store` is the single source of truth; legacy `AppState` (struct, `App.legacy`, `Deref`/`DerefMut`, `event_tx`, global `seq_counter`, `signal_dirty`, `publish_transaction`, GraphQL/MCP legacy mirrors) deleted. Receipts verified empty by Compliance + controller.

---

## Findings

### RF-001 — Wasted full-Document clone + dead-param constructor
- **Severity:** High · **Source:** DataSci DP-01, Architect A1, BE Q1/Q2 · **Status:** resolved (`d98c848`) — replaced the 3-ignored-arg constructor with `ServerState::new_empty()`; `load_workfile_into_state` now moves `loaded.document` into `open_session_with` (zero clones).
- `crates/server/src/state.rs` `new_with_document_and_workfile_migrated(_doc, _workfile_path, _migrated_from)` ignores all three params; `crates/server/src/main.rs:~203` `load_workfile_into_state` deep-clones `loaded.document` (up to 1000 nodes) only to feed that constructor, which discards it — the clone goes to `open_session_with`. One full Document deep-copy per workfile load, for nothing, plus a misleading interface (over-wide signature carried from the old impl — §11 "trim to actually-used subset").
- **Fix:** Drop the dead params (no-arg/`new_empty`-style constructor); move `loaded.document` directly into the `open_session_with` loader closure instead of cloning.

### RF-002 — Seq + broadcast emitted after the store write lock releases
- **Severity:** High (disputed → treat as hardening) · **Source:** DataSci DP-02; Logic (pre-existing, no client-visible effect) · **Status:** resolved (`48d667b`, `e201e66`) — seq stamp + broadcast now run inside the `session.store.write()` guard in both GraphQL `apply_operations` and MCP `run_session_scoped`; no `.await` under the lock.
- `crates/server/src/graphql/mutation.rs`: the write guard drops (~:1429) before `session.next_seq()` (~:1441) and `broadcast.send()` (~:1452). Concurrent mutations on one session serialize their *applies* under the lock but can interleave seq-stamp/broadcast order. MCP `run_session_scoped` has the same shape (`publish` after the guard block). Logic reviewer (high confidence): structurally identical to the pre-migration legacy path (global counter also stamped after unlock), and `apply-remote.ts` applies in WebSocket arrival order (not seq order), so **no client-visible divergence today**.
- **Fix:** Stamp `next_seq()` and `send` the broadcast while still holding the write lock (both GraphQL `apply_operations` and the MCP envelope) so apply/seq/broadcast are atomic per session (also satisfies §rust-defensive "Side-Effect Artifacts Constructed After Precondition Verification").

### RF-003 — GraphQL header-less resolution asymmetric with MCP
- **Severity:** Medium · **Source:** Security S-1 · **Status:** resolved (`48d667b`) — header-less requests now return `SESSION_REQUIRED` when `sessions.len() > 1`; single-session fallback preserved. Tests added.
- `crates/server/src/graphql/mutation.rs:81-95` `resolve_session`: with no `X-Sigil-Session` header, falls back to `default_session_id` regardless of how many sessions are open; MCP (`session_resolver.rs`) returns `Ambiguous` when >1 session and no explicit id. A header-less GraphQL client with multiple sessions open silently writes to the last-opened session. Data-integrity/routing hazard (not a confidentiality breach under the single-user local model), violates §11 "Validation Must Be Symmetric Across All Transports".
- **Fix:** When no header AND `sessions.len() > 1`, return a typed `SESSION_REQUIRED` error; reserve the `default_session_id` fallback for the single-session case.

### RF-004 — `MAX_SESSIONS` not enforced on `register_in_memory`
- **Severity:** Medium · **Source:** DataSci DP-05, BE Q3 · **Status:** resolved (`1fe1b2c`) — documented the exemption rationale on `register_in_memory` (controlled infallible startup path; public `open` enforces the cap; future bulk callers must use `open`).
- `crates/state/src/sessions.rs` `register_in_memory` inserts unconditionally; `open` enforces `by_id.len() >= MAX_SESSIONS`. Constant-enforcement-at-every-insertion gap (§11). Unreachable abuse today (startup synthetic session + tests only; `register_in_memory` is infallible by design).
- **Fix:** Document in the method doc why the in-memory path is exempt (controlled single startup session; the public multi-session `open` enforces the cap) and note any future bulk caller must use the fallible `open`. (Enforcing requires making it fallible — out of proportion for the current single use.)

### RF-005 — MCP `read_resource` cannot target a session
- **Severity:** Minor · **Source:** Architect A2 · **Status:** resolved (`e201e66`) — added a comment documenting the rmcp `ReadResource` transport limitation; multi-session resource addressing deferred.
- `crates/mcp/src/server.rs:~1145` resolves with hardcoded `None` (default/single-session only); read *tools* gained `session_id` but resource reads did not. rmcp `ReadResource` has no tool-argument slot.
- **Fix:** Add an explanatory comment (transport limitation); defer multi-session resource addressing.

### RF-006 — Dead serde attribute
- **Severity:** Nit · **Source:** BE Q7 · **Status:** resolved (`1fe1b2c`) — removed the dead `skip_serializing_if`.
- `crates/mcp/src/types.rs` `SessionScopedInput` has `#[serde(skip_serializing_if = "Option::is_none")]` but derives only `Deserialize`.
- **Fix:** Remove the attribute.

### RF-007 — `test_support` linked into release binary
- **Severity:** Low · **Source:** DevOps D-01 · **Status:** accepted (documented) — acceptable for pre-release; revisit with a `test-support` cargo feature if it ships.
- `crates/server/src/test_support.rs` is `pub` (not `#[cfg(test)]`), with `#![allow(dead_code)]`, so it compiles into the release binary. Deliberate (integration `tests/` can't reach `#[cfg(test)]` items).
- **Fix:** Accept (documented) for pre-release, or gate behind a `test-support` cargo feature enabled only for the test build.

### RF-008 — Rollback maps to generic error variant (pre-existing)
- **Severity:** Low (pre-existing) · **Source:** BE Q5 · **Status:** deferred — pre-existing; follow-up to add a typed `RollbackFailed` variant.
- `crates/mcp/src/tools/nodes.rs:~247` maps a compound rollback error to `McpToolError::InvalidInput` rather than a typed `RollbackFailed`. Diagnostic strings preserved. Predates 22b.
- **Fix:** Defer (add `RollbackFailed` variant in a follow-up).

### RF-009 — Transitional `MutationEvent` fields / `document_changed` subscription
- **Severity:** Info · **Source:** BE Q6 · **Status:** deferred — future cleanup once `transaction_applied` is the sole consumer.
- `MutationEvent` retains legacy `kind`/`uuid`/`data` (always `data: None`); `document_changed` subscription marked deprecated. Acknowledged transitional surface.
- **Fix:** Defer to a future cleanup once `transaction_applied` is the sole consumer.

### RF-010 — Pre-existing `clippy --all-targets` failures (out of scope)
- **Severity:** Info · **Source:** Compliance C22b-01, BE, DataSci · **Status:** wont-fix (out of scope)
- ~52 lints in `crates/core/src/validate.rs` test targets + 8 in `crates/server/src/workfile.rs`/`mutation.rs` test targets fail `cargo clippy --workspace --all-targets`. All in files untouched by 22b and **also red on `main`**. The CI gate (`cargo clippy --workspace -- -D warnings`, no `--all-targets`) is green.
- **Fix:** Out of scope — a separate, correctly-scoped cleanup PR; must NOT be folded into the 22b squash (would mis-scope the migration).

### RF-011 — Startup `expect()`s
- **Severity:** Low · **Source:** BE Q4 · **Status:** accepted — bootstrap-only panics acceptable.
- `crates/server/src/main.rs` `new_in_memory_state` uses `expect()` on default-session/page creation. Bootstrap-only.
- **Fix:** Optional — could return `anyhow::Result<ServerState>`. Acceptable bootstrap panics.
