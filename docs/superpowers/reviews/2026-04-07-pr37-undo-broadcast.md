# Review Findings: PR #37 — Operation Broadcast Subscription (Plan 15b)

**Date:** 2026-04-07
**Reviewers:** 8 agents
**Total findings:** 11 (2 Critical, 5 High, 3 Medium, 1 Low)

## Critical

### RF-001 — Undo/redo not migrated to publish_transaction
- **Source:** Compliance, Logic
- **Issue:** undo/redo handlers emit legacy `transaction: None`. Remote clients force fetchPages. Self-echo broken (userId empty).
- **Fix:** Since Phase 15d removes server undo entirely, mark as deferred with comment. For now, the legacy fallback (fetchPages) handles undo/redo events from remote clients. The self-echo issue only matters in multi-user — currently single-user.
- **Status:** `open`

### RF-002 — MCP undo/redo same issue
- **Source:** Compliance
- **Fix:** Same deferral — Phase 15d removes MCP undo/redo tools entirely.
- **Status:** `open`

## High

### RF-003 — ungroup_nodes reparent payload missing parentUuid
- **Source:** Logic
- **File:** `crates/server/src/graphql/mutation.rs` ungroup_nodes handler
- **Fix:** Include `parentUuid` and `position` in reparent operation value.
- **Status:** `open`

### RF-004 — create_node serializes arena NodeId structs
- **Source:** Logic, DataSci
- **File:** `crates/server/src/graphql/mutation.rs` create_node handler
- **Fix:** Use node_to_gql serialization (UUID-based) instead of serde_json::to_value(node).
- **Status:** `open`

### RF-005 — unwrap_or(Value::Null) in batchSetTransform
- **Source:** Compliance, DataSci
- **Fix:** Change to map_err and propagate error, or skip the operation.
- **Status:** `open`

### RF-006 — TransactionPayload deep-cloned per subscriber
- **Source:** DataSci
- **Fix:** Wrap in Arc<TransactionPayload> in MutationEvent. Defer as optimization — not blocking.
- **Status:** `open`

### RF-007 — applyCreateNode bare-casts unvalidated JSON
- **Source:** DataSci
- **Fix:** Add shape validation before casting. Defer — will be addressed when create_node payload is fixed (RF-004).
- **Status:** `open`

## Medium

### RF-008 — Empty-ops fetchPages immediate (not debounced)
- **Fix:** Add a debounce or check if fetchPages is already in-flight before calling.
- **Status:** `open`

### RF-009 — Legacy DOCUMENT_CHANGED_SUBSCRIPTION not removed
- **Fix:** Defer to Phase 15d — explicit removal planned. Document in PR description.
- **Status:** `open`

### RF-010 — SeqCst unnecessarily strong
- **Fix:** Change to Ordering::AcqRel. Simple one-line fix.
- **Status:** `open`

## Low

### RF-011 — set_corner_radii broadcasts path "kind"
- **Fix:** Document the convention. Defer path refinement to future.
- **Status:** `open`
