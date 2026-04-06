# Plan 11a-c: Multi-Select + Align + Group UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire multi-select interactions (marquee selection, Shift+click toggle, multi-move, multi-resize), an alignment/distribute panel, and group/ungroup keyboard shortcuts into the canvas editor — completing the Spec 11a viewport interactions feature.

**Architecture:** Pure math modules for compound bounds, proportional resize, alignment, and intersection testing. Select tool state machine gains a `marquee-selecting` state. Renderer extended for marquee rect + compound bounding box. AlignPanel component with icon buttons. Keyboard shortcuts via tinykeys. All backend primitives (selectedNodeIds, batchSetTransform, groupNodes, ungroupNodes) already exist from Plan 11a-a.

**Tech Stack:** TypeScript, Solid.js 1.9, Vitest, HTML5 Canvas 2D, lucide-solid icons, tinykeys

**Depends on:** Plan 11a-a (store multi-select + batch commands), Plan 11a-b (resize + snap)

---

## Task 1: Multi-Select Math Module

**Files:**
- Create: `frontend/src/canvas/multi-select.ts`
- Create: `frontend/src/canvas/__tests__/multi-select.test.ts`
- Modify: `frontend/src/canvas/hit-test.ts` (export computeAABB)

Pure functions:
1. `computeCompoundBounds(transforms: Transform[]): Transform` — union bounding box
2. `computeRelativePositions(transforms: Transform[], bounds: Transform): RelativePosition[]` — 0-1 fractions within bounds
3. `applyProportionalResize(originals: Transform[], positions: RelativePosition[], newBounds: Transform): Transform[]` — scale transforms within new bounds
4. `rectIntersectsAABB(rect, aabb): boolean` — marquee intersection test

Export `computeAABB` from `hit-test.ts`.

Tests: compound bounds (1 node, 2 nodes, empty), relative positions, round-trip resize, rect intersection (hit, miss, contained, negative-size rect). All guard Number.isFinite on inputs.

---

## Task 2: Extend ToolStore Interface for Multi-Select

**Files:**
- Modify: `frontend/src/store/document-store-types.ts`
- Modify: `frontend/src/shell/Canvas.tsx`

Add to ToolStore:
```typescript
getSelectedNodeIds(): string[];
setSelectedNodeIds(ids: string[]): void;
batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void;
```

Wire in Canvas.tsx store adapter. Add `metaKey: boolean` to ToolEvent in tool-manager.ts. Update Canvas.tsx makeToolEvent to pass `e.metaKey`.

---

## Task 3: Select Tool — Multi-Select Interactions

**Files:**
- Modify: `frontend/src/tools/select-tool.ts`
- Modify: `frontend/src/tools/__tests__/select-tool.test.ts`

State machine gains `marquee-selecting` state.

**onPointerDown:**
- Shift/Meta+click node: toggle in/out of selectedNodeIds
- Click node (no modifier): replace selection, enter moving
- Click empty (no modifier): clear selection, enter marquee-selecting
- Shift+click empty: keep selection, enter marquee-selecting (additive)

**Multi-move:** When 2+ selected, capture all original transforms. Apply same delta to each on move. Commit via batchSetTransform on pointerup.

**Multi-resize:** When 2+ selected, compute compound bounds + relative positions. Resize compound bounds, apply proportional resize to get individual transforms. Commit via batchSetTransform.

**Marquee:** Draw selection rect during drag. On pointerup, select all nodes with intersecting AABBs. Shift+marquee = additive.

New exports: `getMarqueeRect()`, `getPreviewTransforms()` (array).

PreviewTransform changes from single to array.

Tests: Shift+click toggle, click-to-replace, marquee select, Shift+marquee additive, multi-move commits batchSetTransform, Escape cancels marquee.

---

## Task 4: Renderer — Marquee + Multi-Select Bounds

**Files:**
- Modify: `frontend/src/canvas/renderer.ts`
- Modify: `frontend/src/canvas/__tests__/renderer.test.ts`
- Modify: `frontend/src/shell/Canvas.tsx`

Renderer signature changes:
- `selectedUuid` → `selectedUuids: string[]`
- `previewTransform` → `previewTransforms: PreviewTransform[]`
- New param: `marqueeRect`

New functions:
- `drawMarqueeRect(ctx, rect, zoom)` — dashed blue rect with semi-transparent fill
- `drawCompoundBounds(ctx, transforms, zoom)` — compound bbox with handles when 2+ selected

Canvas.tsx: thread marqueeRect signal, previewTransforms array, selectedNodeIds to renderer. Dynamic `aria-label` reflecting selection count.

---

## Task 5: AlignPanel Component

**Files:**
- Create: `frontend/src/canvas/align-math.ts`
- Create: `frontend/src/canvas/__tests__/align-math.test.ts`
- Create: `frontend/src/panels/AlignPanel.tsx`
- Create: `frontend/src/panels/AlignPanel.css`
- Modify: `frontend/src/panels/DesignPanel.tsx`

**align-math.ts** — pure functions:
- `alignLeft`, `alignCenter`, `alignRight`, `alignTop`, `alignMiddle`, `alignBottom`
- `distributeHorizontal`, `distributeVertical`
Each takes `{uuid, transform}[]`, returns `{uuid, transform}[]` with updated positions.

**AlignPanel.tsx:** 6 align + 2 distribute icon buttons. Show when 2+ selected (align) / 3+ selected (distribute). Each calls `store.batchSetTransform`. Uses lucide-solid icons. `role="toolbar"` with `aria-label="Alignment"`.

**DesignPanel.tsx:** Add AlignPanel in Layout tab.

Tests: Each alignment function tested with 3 nodes. Distribute tested with equal gaps.

---

## Task 6: Keyboard Shortcuts + Misc

**Files:**
- Modify: `frontend/src/shell/Canvas.tsx`
- Modify: `frontend/src/panels/LayersTree.tsx` (multi-select highlighting)

Keyboard shortcuts via tinykeys:
| Shortcut | Action |
|----------|--------|
| Ctrl+G | Group selected (2+ nodes) |
| Ctrl+Shift+G | Ungroup selected groups |
| Ctrl+A | Select all visible unlocked nodes |
| Delete/Backspace | Delete selected nodes |
| Escape | Clear selection + cancel operations |
| Ctrl+Shift+L/C/R/T/M/B | Alignment shortcuts |

Extract `executeAlign(store, alignFn)` helper shared between AlignPanel buttons and shortcuts.

LayersTree: Update selected CSS class to check `selectedNodeIds().includes(nodeUuid)`.

All shortcuts announce via `announce()`. Gated by `!isTyping()`.

---

## Task Sequencing

Tasks 1 + 2 can run in parallel. Task 3 depends on both. Task 4 depends on 3. Task 5 depends on 1 + 2. Task 6 depends on 3-5.
