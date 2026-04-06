# Review Findings: PR #34 — Resize Handles + Smart Guide Snapping (Plan 11a-b)

**Date:** 2026-04-06
**Reviewers:** Architect, Security, BE, Logic, Compliance, Data Science, FE, A11y, UX (9 agents)
**Total findings:** 30 (1 Critical, 5 High, 14 Medium, 10 Low/Minor)

---

## Critical

### RF-001 — Snap guides never passed to renderer
- **Source:** All 9 agents
- **File:** `frontend/src/shell/Canvas.tsx`
- **Issue:** `snapGuides()` read into `_guides` then voided. `renderCanvas` never receives guides. Guide lines completely non-functional.
- **Fix:** Pass `snapGuides()` as 8th arg to `renderCanvas`. Remove `void _guides`.
- **Status:** `open`

---

## High

### RF-002 — Snap during resize breaks anchor invariant
- **Source:** Logic, FE, BE, UX
- **File:** `frontend/src/tools/select-tool.ts`
- **Issue:** Snap shifts entire bounding box x/y without adjusting width/height. Fixed anchor edge drifts by snap delta.
- **Fix:** During resize, restrict snap source points to only the moving edge(s) based on handle type.
- **Status:** `open`

### RF-003 — pointerUp doesn't clear snapGuides signal
- **Source:** FE, Architect, Security, A11y
- **File:** `frontend/src/shell/Canvas.tsx`
- **Fix:** Add `setSnapGuides([])` in `handlePointerUp`.
- **Status:** `open`

### RF-004 — Missing Number.isFinite guards
- **Source:** Compliance, Security, BE, Architect
- **Files:** `handle-hit-test.ts` (zoom divisor), `resize-math.ts` (dragDelta + original transform), `snap-engine.ts` (source transform)
- **Fix:** Add guards at function entry. Zero/NaN zoom → default to 1. Degenerate inputs → return original unchanged.
- **Status:** `open`

### RF-005 — Zero-height node causes Infinity in aspect ratio
- **Source:** Architect, Security
- **File:** `frontend/src/canvas/resize-math.ts`
- **Fix:** Guard `original.height > 0` before aspect ratio division. Skip Shift lock if degenerate.
- **Status:** `open`

### RF-006 — Constants lack canonical enforcement test names
- **Source:** Security
- **Files:** `resize-math.test.ts`, `snap-engine.test.ts`, `handle-hit-test.test.ts`
- **Fix:** Add `test_min_size_enforced`, `test_snap_threshold_px_enforced`, `test_handle_hit_zone_px_enforced` tests.
- **Status:** `open`

---

## Medium

### RF-007 — Alt+clamp breaks center-preservation invariant
- **Source:** UX, Security
- **Fix:** When Alt + MIN_SIZE clamp, recenter: `newX = originalCenterX - MIN_SIZE / 2`.
- **Status:** `open`

### RF-008 — Snap applies all 3 source edges during resize
- **Source:** UX
- **Fix:** Restrict snap source points to dragged edge(s) based on handle type. (Covered by RF-002 fix)
- **Status:** `open` (merged with RF-002)

### RF-009 — Unthrottled hitTestHandle on every pointermove in idle
- **Source:** DataSci, Architect, Security
- **Fix:** Add position-change threshold or rAF gate. Restore RF-010 TODO if not throttling now.
- **Status:** `open`

### RF-010 — Stale hoverHandle after deselect/pointerUp
- **Source:** Logic, FE, BE
- **Fix:** Clear `hoverHandle = null` in onPointerUp and empty-canvas click path.
- **Status:** `open`

### RF-011 — getSnapGuides called unconditionally regardless of active tool
- **Source:** FE
- **Fix:** Gate behind `activeTool === "select"` check.
- **Status:** `open`

### RF-012 — Unsafe type cast on state discriminated union
- **Source:** Architect, BE
- **Fix:** Use `if (state.kind === "moving" || state.kind === "resizing")` instead of cast.
- **Status:** `open`

### RF-013 — MIN_SIZE clamping missing UX exception comment
- **Source:** BE, Architect
- **Fix:** Add CLAUDE.md §11 exception comment.
- **Status:** `open`

### RF-014 — Locked node can enter resizing state
- **Source:** Architect
- **Fix:** Check `selectedNode.locked !== true` before entering resize.
- **Status:** `open`

### RF-015 — Hover cursor not updated on pointermove in Canvas.tsx
- **Source:** UX
- **Fix:** Call `setCursor(toolManager.getCursor())` in `handlePointerMove`.
- **Status:** `open`

### RF-016 — No keyboard equivalent for resize (a11y)
- **Source:** A11y
- **Fix:** File tracking issue. Document deferral in PR description. Properties panel inputs serve as interim equivalent.
- **Status:** `open`

### RF-017 — No screen reader announcements for resize mode
- **Source:** A11y
- **Fix:** Add discrete announcements at state transitions (resize start, commit, cancel). Defer to a11y follow-up.
- **Status:** `open`

### RF-018 — No focus-visible style on canvas element
- **Source:** A11y
- **Fix:** Add `:focus-visible` outline to canvas in CSS.
- **Status:** `open`

### RF-019 — No reduced-motion guard for guide lines
- **Source:** A11y
- **Fix:** Add preemptive `@media (prefers-reduced-motion)` block to Canvas.css. Consider suppressing guide rendering under reduced motion.
- **Status:** `open`

### RF-020 — Canvas ARIA state doesn't reflect selected node
- **Source:** A11y
- **Fix:** Make canvas `aria-label` dynamic with selected node name. Defer full slider semantics.
- **Status:** `open`

---

## Low/Minor

### RF-021 — Per-call array allocation in hitTestHandle
- **Source:** DataSci, Architect
- **Fix:** Inline 8 explicit checks instead of array construction. Defer as optimization.
- **Status:** `open`

### RF-022 — snap() allocates fresh guides array per pointermove
- **Source:** DataSci
- **Fix:** Pre-allocate or use struct with xGuidePos/yGuidePos. Defer as optimization.
- **Status:** `open`

### RF-023 — customThreshold dead parameter
- **Source:** FE, Architect
- **Fix:** Remove unused parameter (YAGNI).
- **Status:** `open`

### RF-024 — Dead code in findNearest binary search
- **Source:** BE
- **Fix:** Remove unreachable `lo >= sorted.length` branch or add comment.
- **Status:** `open`

### RF-025 — Guide lines lack endpoint ticks
- **Source:** UX
- **Fix:** Defer to polish pass. Full-viewport lines are functional for MVP.
- **Status:** `open`

### RF-026 — No pointer cursor on hoverable nodes
- **Source:** UX
- **Fix:** Defer — existing select behavior is functional.
- **Status:** `open`

### RF-027 — Stale snap targets undocumented
- **Source:** Architect
- **Fix:** Add comment documenting targets reflect drag-start state.
- **Status:** `open`

### RF-028 — Aspect lock tiebreak undocumented
- **Source:** UX
- **Fix:** Add JSDoc comment.
- **Status:** `open`

### RF-029 — role="log" should be role="status" (pre-existing)
- **Source:** A11y
- **Fix:** Change in App.tsx. Pre-existing, defer.
- **Status:** `open`

### RF-030 — onPointerUp signature mismatch
- **Source:** Security, BE
- **Fix:** Accept `_event: ToolEvent` parameter for interface consistency.
- **Status:** `open`
