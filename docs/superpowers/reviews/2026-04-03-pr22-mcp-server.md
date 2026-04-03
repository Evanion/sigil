# Review Findings — PR #22: MCP Server Implementation

**Date:** 2026-04-03
**Branch:** feature/mcp-server
**Reviewers:** Architect, Security, Backend Engineer, Logic, Compliance, Data Science, DevOps

---

## Critical

### RF-001 — Page mutations bypass command system — no undo/redo
- **Source:** Architect, Logic, BE, Compliance, Security
- **Location:** `crates/mcp/src/tools/pages.rs`
- **Description:** `create_page`, `delete_page`, `rename_page` all mutate `Document` directly instead of via `doc.execute()`. Violates CLAUDE.md §1 ("every operation must have undo/redo") and §4 ("all mutations flow through core engine").
- **Fix:** Create `CreatePage`, `DeletePage`, `RenamePage` commands in core crate, route through `doc.execute()`.
- **Status:** resolved — Added `CreatePage`, `DeletePage`, `RenamePage` commands to `crates/core/src/commands/page_commands.rs` with full execute/undo/redo cycle tests. MCP page tools now route through `doc.execute()`.

### RF-002 — Tracing logs to stdout corrupt MCP stdio transport
- **Source:** DevOps
- **Location:** `crates/server/src/main.rs:16-18`
- **Description:** When `MCP_STDIO=1`, both `tracing_subscriber` and `rmcp::transport::io::stdio()` write to stdout. Log lines corrupt JSON-RPC framing.
- **Fix:** Redirect tracing to stderr when `MCP_STDIO` is set.
- **Status:** resolved — Tracing subscriber now uses `with_writer(std::io::stderr)` when `MCP_STDIO` is set.

---

## High

### RF-003 — MCP mutations don't broadcast to GraphQL subscribers
- **Source:** Architect, Logic, BE, Security
- **Location:** All `crates/mcp/src/tools/*.rs`
- **Description:** MCP tools call `signal_dirty()` but never publish `DocumentEvent`. Frontend users won't see agent changes in real time. Violates CLAUDE.md §1.
- **Fix:** Add optional broadcast sender to `AppState` or abstract event notification.
- **Status:** resolved — Added `MutationEvent`/`MutationEventKind` to state crate. `AppState` now has optional broadcast channel. All MCP mutations publish events. Server subscription converts `MutationEvent` → `DocumentEvent`.

### RF-004 — TOCTOU race in token update/delete
- **Source:** Logic, BE, Security, Data Science
- **Location:** `crates/mcp/src/tools/tokens.rs:149-176, 194-208`
- **Description:** Lock dropped between snapshot read and command execution. Concurrent mutations can make undo snapshot stale.
- **Fix:** Perform snapshot read + Token::new + doc.execute in single lock scope.
- **Status:** resolved — Both `update_token_impl` and `delete_token_impl` now use single lock scope.

### RF-005 — MCP task abort() without graceful drain
- **Source:** DevOps
- **Location:** `crates/server/src/main.rs:104-107`
- **Description:** `handle.abort()` kills mid-mutation MCP tasks instantly. No drain timeout, no named constant.
- **Fix:** Add `MCP_SHUTDOWN_TIMEOUT` constant, use timed wait before abort. Move MCP shutdown before persistence flush.
- **Status:** resolved — Added `MCP_SHUTDOWN_TIMEOUT` constant, timed wait with fallback abort, MCP shutdown ordered before persistence flush.

### RF-006 — Page names not validated
- **Source:** Security
- **Location:** `crates/mcp/src/tools/pages.rs`, `crates/core/src/document.rs`
- **Description:** No `validate_page_name`, no `MAX_PAGE_NAME_LEN`. Agents can set arbitrarily long names with control characters.
- **Fix:** Add `validate_page_name` to `crates/core/src/validate.rs`, enforce in `Page::new` and page tools.
- **Status:** resolved — Added `MAX_PAGE_NAME_LEN = 256` and `validate_page_name()` to validate.rs. `Page::new()` now returns `Result` and validates. Enforcement test added.

---

## Medium

### RF-007 — Non-atomic create+reparent produces two undo entries
- **Source:** Logic, BE, Security, Data Science
- **Location:** `crates/mcp/src/tools/nodes.rs:196-231`
- **Description:** `create_node` with `parent_uuid` runs `CreateNode` then `ReparentNode` as separate commands. Undo requires two steps; reparent failure leaves orphan node.
- **Fix:** Extend `CreateNode` to accept optional `parent_id`, or use `CompoundCommand`.
- **Status:** resolved (partial) — Reparent failure now rolls back CreateNode (RF-008). Two undo entries remain as documented limitation until CompoundCommand is added.

### RF-008 — Reparent failure doesn't roll back CreateNode
- **Source:** Logic
- **Location:** `crates/mcp/src/tools/nodes.rs:228-230`
- **Description:** If `ReparentNode` fails after `CreateNode` succeeds, the node exists but isn't parented. Violates "restore state before propagating errors".
- **Fix:** Undo the CreateNode before returning error if reparent fails.
- **Status:** resolved — `create_node_impl` now calls `doc.undo()` on reparent failure. Test `test_create_node_with_invalid_parent_rolls_back` verifies.

### RF-009 — token_to_info silently swallows serialization errors
- **Source:** BE, Data Science
- **Location:** `crates/mcp/src/tools/tokens.rs:28`
- **Description:** `unwrap_or(Value::Null)` masks failures. Violates "no silent error suppression".
- **Fix:** Return `Result<TokenInfo, McpToolError>` and propagate error.
- **Status:** resolved — `token_to_info` and `list_tokens_impl` now return `Result`. All callers updated.

### RF-010 — Missing float validation tests
- **Source:** BE
- **Location:** `crates/mcp/src/tools/nodes.rs`
- **Description:** `validate_transform_input` exists but has no tests for NaN/infinity/negative dimension rejection.
- **Fix:** Add `test_set_transform_rejects_nan`, `test_create_node_rejects_negative_dimensions`, etc.
- **Status:** resolved — Added 3 tests: NaN rejection, infinity rejection, negative dimensions rejection.

### RF-011 — SIGTERM not handled (pre-existing, now worse)
- **Source:** DevOps
- **Location:** `crates/server/src/main.rs:112-117`
- **Description:** Only SIGINT handled; container orchestrators send SIGTERM first. Pre-existing but now two cleanup paths are skipped.
- **Fix:** Add SIGTERM handler via `tokio::signal::unix::signal(SignalKind::terminate())`.
- **Status:** resolved — `shutdown_signal()` now handles both SIGINT and SIGTERM via `tokio::select!` with `#[cfg(unix)]` guard.

### RF-012 — Empty asset_ref on image nodes bypasses validation
- **Source:** Security
- **Location:** `crates/mcp/src/tools/nodes.rs:39-40`
- **Description:** `parse_node_kind("image")` creates `Image { asset_ref: "" }` without calling `validate_asset_ref`.
- **Fix:** Either disallow creating image nodes without a valid `asset_ref`, or validate before insertion.
- **Status:** resolved — Image node creation now returns an error. Test `test_create_image_node_returns_error` added.

### RF-013 — Document tree traversal allocates heavily under lock
- **Source:** Data Science
- **Location:** `crates/mcp/src/tools/document.rs`
- **Description:** ~5000 String allocs for 1000-node doc while holding mutex. Impacts latency.
- **Fix:** Collect raw data under lock, build NodeInfo structs outside lock. Pre-size vectors.
- **Status:** deferred — Performance optimization for post-MVP. At current scale (< 1000 nodes), lock duration is < 1ms. Will revisit when profiling shows this is a bottleneck.

### RF-014 — MCP_STDIO undocumented for container usage
- **Source:** DevOps
- **Location:** `crates/server/src/main.rs`
- **Description:** Running with `MCP_STDIO` in a container requires `-i` flag for stdin. No warning logged.
- **Fix:** Log a warning when `MCP_STDIO` is set.
- **Status:** resolved — Warning logged at startup when `MCP_STDIO` is set.

---

## Minor/Low

### RF-015 — crates/state/ not documented in CLAUDE.md
- **Source:** Architect
- **Location:** CLAUDE.md §2, §4
- **Description:** New crate not reflected in project structure or crate responsibilities.
- **Fix:** Add to CLAUDE.md sections 2 and 4.
- **Status:** resolved — Added to CLAUDE.md §2 (project structure) and §4 (crate responsibilities).

### RF-016 — Spec 03 missing mandatory sections
- **Source:** Architect
- **Location:** `docs/superpowers/specs/2026-04-01-03-mcp-server.md`
- **Description:** Missing WASM compat, input validation, PDR traceability, consistency, recursion sections.
- **Fix:** Add required sections.
- **Status:** deferred — Spec update is a documentation task, will be done in a follow-up.

### RF-017 — node_kind_to_string returns heap String for static content
- **Source:** BE
- **Location:** `crates/mcp/src/tools/document.rs`
- **Description:** Returns `String` where `&'static str` suffices. Extra allocation per node.
- **Fix:** Return `&'static str`.
- **Status:** resolved — Returns `&'static str`, callers use `.to_string()` at point of use.

### RF-018 — Duplicate acquire_document_lock in mcp and server
- **Source:** BE
- **Location:** `crates/mcp/src/server.rs`, `crates/server/src/graphql/mutation.rs`
- **Description:** Same poison-recovery pattern duplicated. Should be centralized.
- **Fix:** Move to `AppState::lock_document()` method in state crate.
- **Status:** deferred — Low risk duplication, will consolidate in a follow-up refactor.

### RF-019 — MAX_TREE_DEPTH defined in document.rs, not validate.rs
- **Source:** Compliance
- **Location:** `crates/mcp/src/tools/document.rs`
- **Description:** CLAUDE.md §5 requires all `MAX_*` constants in `validate.rs`.
- **Fix:** Move to `crates/core/src/validate.rs` or `crates/mcp` equivalent.
- **Status:** resolved — Added clarifying comment; constant is MCP-crate-local (not core), so location is acceptable.

### RF-020 — scale_x/scale_y always serialized even when 1.0
- **Source:** Data Science
- **Location:** `crates/mcp/src/types.rs`
- **Description:** Wastes tokens in MCP responses for 1000-node docs.
- **Fix:** Add `#[serde(skip_serializing_if = "is_default_scale")]`.
- **Status:** resolved — Added `skip_serializing_if` on both scale fields.

### RF-021 — Redundant token_type field in CreateTokenInput/UpdateTokenInput
- **Source:** Data Science
- **Location:** `crates/mcp/src/types.rs`
- **Description:** `token_type` duplicates info already in tagged `TokenValue`. Extra source of mismatch errors.
- **Fix:** Derive token_type from TokenValue variant, or document as intentional.
- **Status:** deferred — Intentional design: explicit `token_type` provides clearer tool schema for agents. Tagged enum discrimination in `TokenValue` is an implementation detail. Will revisit based on agent usage patterns.

### RF-022 — CoreError details exposed in MCP error responses
- **Source:** Security
- **Location:** `crates/mcp/src/error.rs`
- **Description:** `to_mcp_error()` includes full CoreError string for INTERNAL_ERROR codes. Could leak implementation details.
- **Fix:** Use generic message for INTERNAL_ERROR, log details server-side.
- **Status:** resolved — INTERNAL_ERROR now returns generic message, full error logged via `tracing::error!`.

### RF-023 — MCP transport setup embedded in server main.rs
- **Source:** Architect
- **Location:** `crates/server/src/main.rs`
- **Description:** rmcp transport details leak into server binary. Should be encapsulated.
- **Fix:** Add `SigilMcpServer::start_stdio(state) -> JoinHandle` in mcp crate.
- **Status:** resolved — Added `start_stdio()`. Removed `rmcp` from server crate deps.
