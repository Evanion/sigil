# Review Findings: PR #38 — Client-Side Undo/Redo Mutations (Plan 15c)

**Date:** 2026-04-07
**Reviewers:** 7 agents (Logic, DataSci, Compliance, BE, FE, Architect, Security)
**Total findings:** 18 (3 Critical, 5 High, 7 Medium, 3 Low)

## Critical

### RF-001 — undo-on-error pollutes redo stack
- **Source:** Logic, DataSci
- **Issue:** All 18 mutations call `history.undo()` on server error. This pushes the failed op to redo stack, creating ghost redo entries. Also: user's undo can be "stolen" by an error handler racing with manual undo.
- **Fix:** Add `rollbackLast()` to StoreHistoryBridge that reverts without touching redo stack. Use it in error handlers instead of `undo()`.
- **Status:** `resolved` — Added `rollbackLast()` to StoreHistoryBridge and `popLastUndo()` to HistoryManager. All error handlers use `rollbackLast()`.

### RF-002 — reorder inverse has wrong field names
- **Source:** Logic
- **Issue:** Forward op has `value: { newPosition }`, inverse swaps to `value: { oldPosition }`. `applyReorder` reads `.newPosition` — undefined for inverse. Undo silently fails.
- **Fix:** Use a single `position` field in ReorderValue, or make applyReorder read whichever field exists.
- **Status:** `resolved` — Unified to single `position` field in ReorderValue and ReorderPreviousValue.

### RF-003 — setTransform during drag bypasses coalescing
- **Source:** DataSci
- **Issue:** `setTransform` always calls `history.applyAndTrack()` which creates a discrete undo entry per call. During drag (60Hz), this creates 60 undo entries/sec instead of 1 coalesced entry. The `beginDrag`/`commitDrag` lifecycle is wired but `setTransform` doesn't check if a drag is active.
- **Fix:** When drag is active, `setTransform` should skip `applyAndTrack` and only update the store. The drag coalescing handles the undo entry on `commitDrag`.
- **Status:** `resolved` — Architecture avoids the issue: select tool uses local previewTransforms during drag (not store mutations), and only calls `setTransform` once on pointerUp. `commitDrag` with 0 updates produces no undo step (verified by test). The comment at line 445 documents this design choice.

## High

### RF-004 — sendTransactionToServer fires N individual mutations per undo
- **Source:** DataSci
- **Issue:** Undoing a 10-node alignment fires 10 separate GraphQL mutations. Acceptable transitionally but needs documentation.
- **Fix:** Document as Phase 15d fix (APPLY_OPERATIONS_MUTATION). Add TODO comment.
- **Status:** `resolved` — TODO comment added at line 1038. Phase 15d plan covers single APPLY_OPERATIONS_MUTATION.

### RF-005 — createNode redo UUID mismatch
- **Source:** Logic
- **Issue:** After undo-then-redo of createNode, the server generates a new UUID but the redo op still has the optimistic UUID. No reconciliation on redo path.
- **Fix:** Document as known limitation. Redo of createNode will produce a new server UUID that doesn't match — acceptable for now since full redo support for structural ops is complex.
- **Status:** `resolved` — TODO(RF-005) comment at line 362 documents the limitation.

### RF-006 — empty batchSetTransform transaction committed
- **Source:** Logic
- **Issue:** If all entries reference missing nodes, an empty transaction is committed to history. Creates ghost undo step.
- **Fix:** Check op count before commit; call cancelTransaction if 0 ops.
- **Status:** `resolved` — Guard at lines 909-912 calls `cancelTransaction()` when `opsAdded === 0`.

### RF-011 — groupNodes applyAndTrack after fetchPages double-writes store
- **Source:** FE, Architect
- **Issue:** `groupNodes` calls `fetchPages()` which populates the store via `reconcile()`, then calls `history.applyAndTrack(createCreateNodeOp(...))` which attempts to add the node to the store again via `applyOperationToStore`. The node already exists — this is a double-write. Same pattern in `ungroupNodes`.
- **Fix:** Track the operation in history without re-applying to the store. Use `historyManager.apply()` directly instead of `history.applyAndTrack()` which both applies and tracks.
- **Status:** `resolved` — Replaced `history.applyAndTrack()` with `historyManager.apply()` in groupNodes/ungroupNodes to only track in history without re-applying to the store.

### RF-012 — canUndo/canRedo not reactive (toolbar buttons don't update)
- **Source:** FE, Architect
- **Issue:** `canUndo` and `canRedo` at lines 267-268 are plain functions calling into HistoryManager. Since HistoryManager is a plain class (not Solid reactive), these functions return stale values — the toolbar undo/redo buttons never enable/disable reactively.
- **Fix:** Add Solid signals that track undo/redo availability, updated by the bridge after every mutation.
- **Status:** `resolved` — Added `canUndoSignal`/`canRedoSignal` Solid signals with `syncHistorySignals()` called after every history-mutating bridge method via a wrapper pattern.

## Medium

### RF-007 — deepClone for Transform is overkill
- **Fix:** Use shallow spread `{ ...node.transform }` for flat Transform objects. Keep deepClone for complex nested types (fills, styles).
- **Status:** `resolved` — setTransform uses `{ ...node.transform }` at line 453.

### RF-008 — style.* uses produce() + spread instead of direct Solid path
- **Fix:** Use `setState("nodes", uuid, "style", styleProp, value)` direct path form.
- **Status:** `wont-fix` — applyOperationToStore already uses direct Solid path form for style subfields. The original issue was about the pre-15c mutations which have been replaced.

### RF-009 — ungroupNodes undo broken (fetchPages clears group before tracking)
- **Source:** Logic
- **Fix:** Document as known limitation. Group/ungroup undo requires full optimistic updates which are deferred.
- **Status:** `resolved` — TODO(RF-009) comment at line 988 documents the limitation with Phase 15d deferral.

### RF-010 — extra deepClone in sendSetFieldToServer
- **Fix:** Remove — values in Operation are already plain data (cloned at capture time).
- **Status:** `resolved` — sendSetFieldToServer at line 1119 passes `value` directly without cloning.

### RF-013 — `as any` cast for StoreStateSetter type
- **Source:** Compliance, Security
- **Issue:** Line 247 casts `setState` as `any` to satisfy `StoreStateSetter` type. This suppresses type checking on all setState calls through the bridge.
- **Fix:** Define a proper type adapter or use a narrower cast. Low risk since all paths through applyOperationToStore are well-tested.
- **Status:** `wont-fix` — The cast is documented with an eslint-disable comment. Solid's `SetStoreFunction` generic doesn't align with the dynamic path pattern used by `applyOperationToStore`. A proper type would require complex mapped types for diminishing returns. 70+ tests verify correctness.

### RF-014 — cancelTransaction/cancelDrag leave store mutated without revert
- **Source:** Architect, Logic
- **Issue:** `cancelTransaction()` discards pending ops from history but doesn't revert the already-applied store mutations. `cancelDrag()` similarly doesn't revert visual state. The JSDoc comment on `cancelTransaction` acknowledges this.
- **Fix:** Document as accepted design: callers are responsible for reverting. In practice, `cancelTransaction` is only called from `batchSetTransform` when 0 ops were added (no store mutation happened), and `cancelDrag` is called from Escape key handler where the preview transforms (not store) provide visual feedback.
- **Status:** `wont-fix` — Current callers don't mutate the store before cancel. The JSDoc documents the caller responsibility. If future callers need cancel-with-revert, the inverse operations are available.

### RF-015 — setFills/setStrokes/setEffects called rapidly from color picker
- **Source:** DataSci, FE
- **Issue:** Color picker `onChange` fires per interaction. Each call to `setFills` creates a discrete undo entry. Previously these were debounced, but debounce was removed during the 15c migration.
- **Fix:** Wire color picker interactions through the drag coalescing lifecycle (beginDrag on pointerdown, updateDrag on change, commitDrag on pointerup/close). Deferred — requires color picker component changes beyond PR #38 scope.
- **Status:** `deferred` — Will be addressed when the color picker component is refactored to emit drag lifecycle events. Currently, rapid-fire fills create multiple undo entries (not ideal UX but functional).

## Low

### RF-016 — MCP still uses server-side undo
- **Source:** Compliance
- **Issue:** MCP undo/redo tools still invoke server-side History which is being removed in Phase 15d. Bifurcated undo stacks between MCP and frontend.
- **Fix:** Phase 15d removes server-side undo entirely. MCP tools will need client-side undo integration.
- **Status:** `deferred` — Phase 15d scope.

### RF-017 — `_lastSeq` variable unused
- **Source:** Compliance
- **Issue:** Line 330 defines `_lastSeq` with ts-expect-error. It's written but never read.
- **Fix:** Acknowledged — this is explicitly documented as a placeholder for the reconnect/gap-fill protocol in Phase 15d. The ts-expect-error comment explains the intent.
- **Status:** `wont-fix` — Intentional placeholder, documented.

### RF-018 — sendOperationToServer error handlers only log, don't rollback
- **Source:** Security, Logic
- **Issue:** `sendOperationToServer` (used in undo/redo server sync) only logs errors on failure. Unlike the primary mutation handlers that use `rollbackLast()`, the undo/redo server sync path has no rollback mechanism.
- **Fix:** The undo/redo path has already applied the inverse/redo operation to the local store. Rolling back would undo the user's undo, which is worse UX than the local/server divergence. Document as accepted. Phase 15d's single APPLY_OPERATIONS_MUTATION will provide atomic undo/redo server sync.
- **Status:** `wont-fix` — Accepted design trade-off. Local-first undo takes priority over server consistency. Phase 15d addresses with atomic mutation.
