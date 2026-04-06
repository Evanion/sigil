# Review Findings: PR #35 — Multi-Select + Align + Group UI (Plan 11a-c)

**Date:** 2026-04-06
**Reviewers:** 9 agents (Architect, Security, BE, Logic, Compliance, DataSci, FE, A11y, UX)
**Total findings:** 32 (2 Critical, 8 High, 12 Medium, 10 Minor/Low)

## Critical

### RF-001 — metaKey cross-platform bug
- **File:** `select-tool.ts`, `tool-manager.ts`
- **Issue:** `event.metaKey` is Windows/Super key on Win/Linux, not Ctrl. Only Shift+click works cross-platform for multi-select toggle.
- **Fix:** Use `event.shiftKey || event.ctrlKey || event.metaKey` or restrict to `event.shiftKey` only (Figma primary).
- **Status:** `open`

### RF-002 — Zero-transform fallback corrupts state
- **File:** `select-tool.ts` (multi-move onPointerMove)
- **Issue:** Missing original transform falls back to `{0,0,0,0}` which gets committed.
- **Fix:** Skip the node in preview + exclude from batch commit.
- **Status:** `open`

## High

### RF-003 — Rotated nodes corrupted by proportional resize
- **File:** `multi-select.ts`
- **Issue:** `computeRelativePositions` uses AABB dimensions, `applyProportionalResize` writes back as intrinsic width/height.
- **Fix:** Use intrinsic transform fields (x,y,width,height) for relative positions, not AABB.
- **Status:** `open`

### RF-004 — TreeNode O(n²) on Ctrl+A
- **File:** `TreeNode.tsx`
- **Issue:** `.includes()` on full selectedNodeIds array per TreeNode per reactive update.
- **Fix:** Expose `selectedNodeIdsSet` as a `createMemo(() => new Set(...))` in store context.
- **Status:** `open`

### RF-005 — Renderer O(n×k) per frame
- **File:** `renderer.ts`
- **Issue:** `getEffectiveTransform` linear scans previewTransforms for every node.
- **Fix:** Build `Map<string, Transform>` once before render loop.
- **Status:** `open`

### RF-006 — Set allocated per frame in renderer
- **File:** `renderer.ts`
- **Fix:** Accept `ReadonlySet<string>` from caller, memoized in Canvas.tsx.
- **Status:** `open`

### RF-007 — Multi-delete breaks undo atomicity
- **File:** `Canvas.tsx`
- **Issue:** Loop of individual deleteNode calls = N undo steps, no rollback.
- **Fix:** Document as deferred. Add batchDeleteNodes in follow-up. For now, add comment + announce warning.
- **Status:** `open`

### RF-008 — Resize handles inaccessible with 1 locked + 1 unlocked selected
- **File:** `select-tool.ts`
- **Fix:** Derive `isMultiSelect` from filtered (visible+unlocked) count, not raw count.
- **Status:** `open`

### RF-009 — Unsafe newTransforms[i] in multi-resize
- **File:** `select-tool.ts`
- **Fix:** Guard index or zip arrays with explicit length check.
- **Status:** `open`

### RF-010 — computeCompoundBounds double-computed per frame
- **File:** `renderer.ts`, `select-tool.ts`
- **Fix:** Pass compound bounds from tool to renderer, don't recompute.
- **Status:** `open`

## Medium

### RF-011 — Shift+click then drag enters marquee
- **Fix:** After Shift+click toggle adds a node, if drag threshold exceeded, transition to multi-move.
- **Status:** `open`

### RF-012 — executeAlign duplicated
- **Fix:** Extract to shared `align-helpers.ts`.
- **Status:** `open`

### RF-013 — Dual selection API not deprecated
- **Fix:** Mark `getSelectedNodeId`/`select` as @deprecated in ToolStore.
- **Status:** `open`

### RF-014 — Double mutation on selection change
- **Fix:** Remove redundant `store.select()` calls. Use only `setSelectedNodeIds`.
- **Status:** `open`

### RF-015 — Multi-resize does not snap
- **Fix:** Apply snapEdges to compound bounds in multi-resize path.
- **Status:** `open`

### RF-016 — Marquee drawn with unnormalized negative dimensions
- **Fix:** Normalize rect before ctx.fillRect/strokeRect.
- **Status:** `open`

### RF-017 — Keyboard equivalents not documented in PR
- **Fix:** Add deferral note to PR description.
- **Status:** `open`

### RF-018 — applyProportionalResize no length guard
- **Fix:** Validate originals.length === positions.length at entry.
- **Status:** `open`

### RF-019 — Math.min/max spread on large arrays
- **Fix:** Replace with reduce loops.
- **Status:** `open`

### RF-020 — AlignPanel batchSetTransform no error handling
- **Fix:** Add try-catch or .then/.catch (defer visible notification until toast system).
- **Status:** `open`

### RF-021 — Ungroup silent no-op
- **Fix:** Announce "No groups selected" when groupUuids is empty.
- **Status:** `open`

### RF-022 — Per-frame assertFiniteTransform in hot path
- **Fix:** Move validation to drag-start only, not per-frame.
- **Status:** `open`

## Minor/Low

### RF-023 — AlignPanel inside tab
- **Fix:** Defer — consider moving above tab strip in follow-up.
- **Status:** `open`

### RF-024 — Align buttons no shortcut hints
- **Fix:** Add shortcut to title: "Align left (Ctrl+Shift+L)".
- **Status:** `open`

### RF-025 — Select All "0 nodes" announce
- **Fix:** Guard: if 0, announce "Nothing to select".
- **Status:** `open`

### RF-026 — Group doesn't select new group
- **Fix:** groupNodes already updates selection via store method.
- **Status:** `open`

### RF-027 — Selectability filter duplicated
- **Fix:** Extract getSelectableNodeIds helper. Defer.
- **Status:** `open`

### RF-028 — Marquee modifier at pointer-down not pointer-up
- **Fix:** Re-read modifier from event at pointerUp.
- **Status:** `open`

### RF-029 — isToggleModifier conflates Shift and Meta for marquee
- **Fix:** Separate concerns — only Shift for additive marquee.
- **Status:** `open`

### RF-030 — Distribute jumps in/out
- **Fix:** Show disabled instead of hidden when < 3 selected.
- **Status:** `open`

### RF-031 — Inconsistent error contracts
- **Fix:** Document conventions. Defer standardization.
- **Status:** `open`

### RF-032 — draggedUuid meaningless in multi-resize
- **Fix:** Add comment clarifying it's cursor-only.
- **Status:** `open`

## Additional Findings (from Security, FE, A11y agents)

### RF-033 — Alignment shortcuts conflict with browser shortcuts (HIGH)
- **Source:** A11y
- **File:** `Canvas.tsx`
- **Issue:** Ctrl+Shift+T reopens closed browser tabs. Ctrl+Shift+C opens DevTools element picker. Ctrl+Shift+B toggles bookmarks. These are consumed by the app's alignment shortcuts.
- **Fix:** Remove conflicting alignment shortcuts. Use a single shortcut to open alignment popover, or use different key combos.
- **Status:** `open`

### RF-034 — No max selection limit (HIGH)
- **Source:** Security
- **Issue:** Ctrl+A on 1000-node doc produces unbounded selectedNodeIds. Downstream computations (compound bounds, batchSetTransform) scale linearly.
- **Fix:** Define MAX_SELECTION_SIZE constant. For now, document as known limitation rather than silently clamping.
- **Status:** `open`

### RF-035 — AlignPanel missing roving tabindex (MAJOR)
- **Source:** A11y
- **Fix:** Implement roving tabindex on role="toolbar" per WAI-ARIA APG.
- **Status:** `open`

### RF-036 — Screen reader double-announcement on selection change (CRITICAL)
- **Source:** A11y
- **Issue:** Legacy createEffect on selectedNodeId fires "Selection cleared" while multi-select fires simultaneously.
- **Fix:** Consolidate to single effect reading selectedNodeIds.
- **Status:** `open`

### RF-037 — Missing AlignPanel.stories.tsx (MEDIUM)
- **Source:** FE
- **Fix:** Create stories file per CLAUDE.md §5.
- **Status:** `open`

### RF-038 — batchSetTransform no NaN guard at store level (HIGH)
- **Source:** Security
- **Fix:** Add Number.isFinite validation at entry point.
- **Status:** `open`

### RF-039 — assertFiniteTransform throws uncaught in render effect (HIGH)
- **Source:** Security, FE
- **Fix:** Wrap renderCanvas in try-catch, or change to graceful return.
- **Status:** `open`
