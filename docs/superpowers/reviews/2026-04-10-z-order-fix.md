# Review Findings — Canvas Z-Order Fix (PR #50)

**Branch:** fix/z-order
**Date:** 2026-04-10

---

## High

### RF-001 — Depth guard silently drops nodes without diagnostic
- **Location:** `frontend/src/shell/Canvas.tsx` `buildRenderOrder` depth guard
- **Fix:** Add `console.warn` when MAX_RENDER_DEPTH fires
- **Status:** open

### RF-002 — No tests for buildRenderOrder or MAX_RENDER_DEPTH enforcement
- **Location:** Missing test file
- **Fix:** Extract to `canvas/render-order.ts`, add tests for DFS order, root detection, empty store, depth guard, cycles
- **Status:** open

---

## Medium

### RF-003 — Sibling z-order direction verified correct
- **Issue:** children[0] renders first (behind), children[last] renders last (front). Server preserves Vec order. Correct.
- **Status:** resolved (verified)

### RF-004 — buildRenderOrder called every frame, should be createMemo
- **Location:** `Canvas.tsx` render effect
- **Fix:** Extract to createMemo that only recomputes on node graph changes
- **Status:** open

### RF-005 — handleDblClick topmost-hit uses arbitrary key order (pre-existing)
- **Location:** `Canvas.tsx:499-511`
- **Fix:** Use render order in reverse for hit testing
- **Status:** open

---

## Low

### RF-006 — buildRenderOrder belongs in canvas/render-order.ts
- **Fix:** Move to utility module (required for RF-002 testing)
- **Status:** open

### RF-007 — No reactive wiring test
- **Status:** deferred (straightforward wiring)
