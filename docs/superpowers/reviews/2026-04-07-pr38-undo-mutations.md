# Review Findings: PR #38 — Client-Side Undo/Redo Mutations (Plan 15c)

**Date:** 2026-04-07
**Reviewers:** 7 agents
**Total findings:** 10 (3 Critical, 3 High, 4 Medium)

## Critical

### RF-001 — undo-on-error pollutes redo stack
- **Source:** Logic, DataSci
- **Issue:** All 18 mutations call `history.undo()` on server error. This pushes the failed op to redo stack, creating ghost redo entries. Also: user's undo can be "stolen" by an error handler racing with manual undo.
- **Fix:** Add `rollbackLast()` to StoreHistoryBridge that reverts without touching redo stack. Use it in error handlers instead of `undo()`.
- **Status:** `open`

### RF-002 — reorder inverse has wrong field names
- **Source:** Logic
- **Issue:** Forward op has `value: { newPosition }`, inverse swaps to `value: { oldPosition }`. `applyReorder` reads `.newPosition` — undefined for inverse. Undo silently fails.
- **Fix:** Use a single `position` field in ReorderValue, or make applyReorder read whichever field exists.
- **Status:** `open`

### RF-003 — setTransform during drag bypasses coalescing
- **Source:** DataSci
- **Issue:** `setTransform` always calls `history.applyAndTrack()` which creates a discrete undo entry per call. During drag (60Hz), this creates 60 undo entries/sec instead of 1 coalesced entry. The `beginDrag`/`commitDrag` lifecycle is wired but `setTransform` doesn't check if a drag is active.
- **Fix:** When drag is active, `setTransform` should skip `applyAndTrack` and only update the store. The drag coalescing handles the undo entry on `commitDrag`.
- **Status:** `open`

## High

### RF-004 — sendTransactionToServer fires N individual mutations per undo
- **Source:** DataSci
- **Issue:** Undoing a 10-node alignment fires 10 separate GraphQL mutations. Acceptable transitionally but needs documentation.
- **Fix:** Document as Phase 15d fix (APPLY_OPERATIONS_MUTATION). Add TODO comment.
- **Status:** `open`

### RF-005 — createNode redo UUID mismatch
- **Source:** Logic
- **Issue:** After undo-then-redo of createNode, the server generates a new UUID but the redo op still has the optimistic UUID. No reconciliation on redo path.
- **Fix:** Document as known limitation. Redo of createNode will produce a new server UUID that doesn't match — acceptable for now since full redo support for structural ops is complex.
- **Status:** `open`

### RF-006 — empty batchSetTransform transaction committed
- **Source:** Logic
- **Issue:** If all entries reference missing nodes, an empty transaction is committed to history. Creates ghost undo step.
- **Fix:** Check op count before commit; call cancelTransaction if 0 ops.
- **Status:** `open`

## Medium

### RF-007 — deepClone for Transform is overkill
- **Fix:** Use shallow spread `{ ...node.transform }` for flat Transform objects. Keep deepClone for complex nested types (fills, styles).
- **Status:** `open`

### RF-008 — style.* uses produce() + spread instead of direct Solid path
- **Fix:** Use `setState("nodes", uuid, "style", styleProp, value)` direct path form.
- **Status:** `open`

### RF-009 — ungroupNodes undo broken (fetchPages clears group before tracking)
- **Source:** Logic
- **Fix:** Document as known limitation. Group/ungroup undo requires full optimistic updates which are deferred.
- **Status:** `open`

### RF-010 — extra deepClone in sendSetFieldToServer
- **Fix:** Remove — values in Operation are already plain data (cloned at capture time).
- **Status:** `open`
