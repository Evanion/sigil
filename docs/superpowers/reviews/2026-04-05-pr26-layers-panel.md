# Review Findings: PR #26 — Layers Panel (Plan 10b)

**Date:** 2026-04-05
**PR:** #26 — feat: layers panel with tree view, DnD, keyboard navigation (Plan 10b)
**Status:** Already merged to main (post-merge review)
**Reviewers:** Architect, Security, Backend, Logic, Compliance, Data Scientist, Frontend, A11y, UX

---

## High

### RF-001 — No optimistic updates for reparent/reorder
- **Source:** Architect, Data Scientist, Frontend, UX
- **Location:** `frontend/src/store/document-store-solid.tsx` — `reparentNode()`, `reorderChildren()`
- **Issue:** Both store methods call `fetchPages()` (full document refetch) on every mutation — even on success. This causes visible DnD lag and an unnecessary full-document round-trip per drag operation. Other mutations (rename, setVisible, setLocked) use optimistic local updates.
- **Fix:** Apply optimistic local state changes (update `parentUuid`, `childrenUuids` in store before mutation). Only `fetchPages()` on error as rollback.
- **Status:** `resolved`

### RF-002 — Delete key reads stale flat list
- **Source:** Logic, Data Scientist, Frontend
- **Location:** `frontend/src/panels/LayersTree.tsx` — Delete/Backspace handler
- **Issue:** After `store.deleteNode()`, the handler immediately reads `flatList()` to find next focus. Since delete is async, the list hasn't updated — focus logic is fragile and will break if optimistic delete is added later.
- **Fix:** Capture the next-focus UUID *before* calling `deleteNode()`.
- **Status:** `resolved`

### RF-003 — `resolveDropPosition` fails for cross-depth drops
- **Source:** Logic
- **Location:** `frontend/src/panels/LayersTree.tsx` — `resolveDropPosition()`
- **Issue:** When `resolveDropParent` walks up ancestors, the target node is not a direct child of the resolved parent, so `indexOf` returns -1 and position defaults to "append at end" instead of the correct visual position.
- **Fix:** When resolved parent differs from target's direct parent, find which of the resolved parent's children is the ancestor of the target, and use that child's index.
- **Status:** `resolved`

### RF-004 — Hardcoded opacity values in CSS
- **Source:** Frontend
- **Location:** `frontend/src/panels/TreeNode.css`
- **Issue:** `.sigil-tree-node--hidden` uses `opacity: 0.5` and `.sigil-tree-node--dragging` uses `opacity: 0.4`. CLAUDE.md §5 requires all opacity values to use CSS custom properties from `theme.css`.
- **Fix:** Add `--opacity-hidden` and `--opacity-dragging` tokens to `theme.css`, reference in CSS.
- **Status:** `resolved`

### RF-005 — Roving tabindex not implemented correctly
- **Source:** A11y
- **Location:** `frontend/src/panels/LayersTree.tsx`, `TreeNode.tsx`
- **Issue:** Tree container has `tabindex={0}` competing with treeitem `tabindex`. After clicking a node, DOM focus moves to the row, breaking keyboard navigation which relies on container focus.
- **Fix:** Implement proper roving tabindex: remove tabindex from container, one treeitem has `tabindex="0"`, call `.focus()` on arrow key navigation.
- **Status:** `resolved`

### RF-006 — DnD reorder/reparent not keyboard-accessible
- **Source:** A11y
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Issue:** No keyboard mechanism to move nodes — only pointer-based DnD. Violates WCAG 2.1.1.
- **Fix:** Add Alt+Arrow Up/Down for reorder, Alt+Arrow Left/Right for reparent.
- **Status:** `resolved`

---

## Major

### RF-007 — Missing `role="group"` for child treeitems
- **Source:** A11y
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Issue:** All treeitems render as flat siblings — screen readers can't perceive tree hierarchy. WAI-ARIA tree pattern requires `role="group"` wrappers.
- **Fix:** Wrap expanded children in `<div role="group">` or use `aria-owns`.
- **Status:** `deferred` — Requires switching from flat-list to recursive rendering architecture. Tracked for a11y follow-up.

### RF-008 — Rename input lacks aria-label and focus indicator
- **Source:** A11y
- **Location:** `frontend/src/panels/TreeNode.tsx`, `TreeNode.css`
- **Issue:** Screen readers hear "edit text" with no context; `outline: none` with no replacement focus ring.
- **Fix:** Add `aria-label={`Rename ${props.node.name}`}` and `:focus-visible` style.
- **Status:** `resolved`

### RF-009 — Toggle buttons invisible to keyboard users
- **Source:** A11y, UX
- **Location:** `frontend/src/panels/TreeNode.css`
- **Issue:** `opacity: 0` by default, only visible on hover. Creates ghost tab stops. Locked/hidden toggles should persist when active.
- **Fix:** Set `tabindex="-1"` on toggles (use keyboard shortcuts L/H), or show at reduced opacity. Keep visible when locked/hidden.
- **Status:** `resolved`

### RF-010 — Entire row is drag source
- **Source:** UX
- **Location:** `frontend/src/panels/TreeNode.tsx`
- **Issue:** Full row is both drag source and drop target — accidental drags on toggle clicks. Figma/Penpot use name area or grip as drag handle.
- **Fix:** Apply `useDraggable` to a dedicated drag handle element, not the full row.
- **Status:** `deferred` — Requires dnd-kit-solid API investigation for split drag handle/drop target. Tracked for UX follow-up.

### RF-011 — Emoji icons instead of SVG
- **Source:** UX
- **Location:** `frontend/src/panels/TreeNode.tsx`
- **Issue:** Lock, visibility, kind icons use emoji/Unicode — platform-inconsistent rendering, poor scaling. Plan acknowledges these are temporary.
- **Fix:** Replace with `lucide-solid` icons.
- **Status:** `deferred` — Acknowledged as temporary in the plan. Will be addressed in icon system pass.

### RF-012 — Cycle detection incomplete for before/after drops
- **Source:** Logic, Frontend
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Issue:** `onDragOver` only checks cycles for `position === "inside"`, but before/after can resolve to reparent. Drop indicator shows as valid for illegal positions.
- **Fix:** Check cycle after resolving the actual parent UUID.
- **Status:** `resolved`

---

## Medium

### RF-013 — Negative position silently clamped to 0
- **Source:** Backend
- **Location:** `crates/mcp/src/tools/nodes.rs`, `crates/server/src/graphql/mutation.rs`
- **Issue:** `position.max(0)` hides bugs in callers; should reject with a typed error.
- **Fix:** Return error for negative positions instead of silent clamp.
- **Status:** `resolved`

### RF-014 — No upper-bound validation on position
- **Source:** Backend, Security
- **Location:** Same as RF-013
- **Issue:** `i32::MAX` is accepted and passed to core. Should validate `position <= children.len()`.
- **Fix:** Validate position against actual children count at the boundary.
- **Status:** `resolved`

### RF-015 — No visible user error notification on mutation failure
- **Source:** Security
- **Location:** `frontend/src/store/document-store-solid.tsx`
- **Issue:** `console.error` + silent `fetchPages()` refresh — user sees DnD revert with no explanation.
- **Fix:** Use `announce()` for error feedback until toast system ships.
- **Status:** `resolved`

### RF-016 — Unsafe native event access for cursor position
- **Source:** Frontend
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Issue:** `(event as unknown as { nativeEvent?: PointerEvent }).nativeEvent` — fragile cast that silently degrades drop zone accuracy.
- **Fix:** Investigate dnd-kit-solid's typed API for pointer coords; add fallback warning.
- **Status:** `resolved`

### RF-017 — `hasAutoExpanded` is a plain `let`, not a signal
- **Source:** Frontend
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Issue:** Works for single-mount but fragile if component remounts.
- **Fix:** Convert to `createSignal`.
- **Status:** `resolved`

### RF-018 — `onStartRename` prop defined but never wired
- **Source:** Frontend
- **Location:** `frontend/src/panels/TreeNode.tsx`
- **Issue:** Dead code — F2 uses synthetic `dblclick` dispatch instead.
- **Fix:** Remove unused prop or wire it up.
- **Status:** `resolved`

---

## Minor/Low

### RF-019 — `.ok()` suppresses arena error on old parent lookup
- **Source:** Backend
- **Location:** `crates/mcp/src/tools/nodes.rs`, `crates/server/src/graphql/mutation.rs`
- **Status:** `resolved`

### RF-020 — MCP position fields use `i32`, prefer `u32`
- **Source:** Architect
- **Location:** `crates/mcp/src/types.rs`
- **Status:** `resolved`

### RF-021 — Arrow key navigation wraps around
- **Source:** UX
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Status:** `resolved`

### RF-022 — Backspace as delete trigger risks accidental deletion
- **Source:** UX
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Status:** `resolved`

### RF-023 — Root-level drop shows indicator but fails silently
- **Source:** UX
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Status:** `deferred` — Requires API support for root-level reparenting

### RF-024 — Node kind not conveyed to screen readers
- **Source:** A11y
- **Location:** `frontend/src/panels/TreeNode.tsx`
- **Status:** `deferred` — Will be addressed with icon system (RF-011)

### RF-025 — LayersTree test has no-op assertion
- **Source:** Frontend
- **Location:** `frontend/src/panels/__tests__/LayersTree.test.tsx`
- **Status:** `deferred` — Test works due to auto-expand; assertion is technically correct but weak

### RF-026 — Rename input lacks maxLength
- **Source:** Frontend
- **Location:** `frontend/src/panels/TreeNode.tsx`
- **Status:** `resolved`

### RF-027 — Build uuid-to-index map for O(1) drag lookups
- **Source:** Data Scientist
- **Location:** `frontend/src/panels/LayersTree.tsx`
- **Status:** `deferred` — Performance optimization; acceptable at 1000-node target

### RF-028 — Focus and selection diverge on click
- **Source:** UX
- **Location:** `frontend/src/panels/TreeNode.tsx`, `LayersTree.tsx`
- **Status:** `resolved` — Added `onFocusNode` callback wired to `setFocusedUuid` on click

---

## Info (no action required)

| ID | Description |
|----|-------------|
| RF-029 | `parseNode` silently drops invalid children UUIDs (defensive, correct) |
| RF-030 | Core test follows correct execute/undo/redo naming convention |
| RF-031 | Single-lock-scope pattern correctly used in all handlers |
| RF-032 | `Number.isFinite()` guards on position fields — correct |
| RF-033 | `isAncestor` and `resolveDropParent` depth guards correctly bounded |
