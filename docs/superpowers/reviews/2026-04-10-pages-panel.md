# Review Findings — Pages Panel (Spec 10c)

**Branch:** feature/pages-panel
**Date:** 2026-04-10
**Reviewers:** Inline review (subagent rate limits prevented 9-agent dispatch)
**Status:** Preliminary — full 9-agent review pending rate limit reset

---

## High

### RF-001 — Thumbnail renders same root nodes for every page
- **Source:** Inline (Logic)
- **Location:** `frontend/src/panels/PagesPanel.tsx:43-49`
- **Issue:** `renderThumbnails()` collects root nodes by checking `parentUuid === null` across ALL nodes in the store, not filtered per page. Every page thumbnail shows the same content — all root nodes from all pages.
- **Fix:** Filter root nodes per page using the page's `root_nodes` array or by matching nodes to their page via the store's page→node relationship.
- **Status:** open

### RF-002 — No DnD reorder implementation
- **Source:** Inline (FE/UX)
- **Location:** `frontend/src/panels/PagesPanel.tsx`, `frontend/src/panels/PageListItem.tsx:127-129`
- **Issue:** The plan and spec specified DnD reorder via dnd-kit-solid, but only keyboard reorder (Alt+Arrow) is implemented. No `useDraggable`/`useDroppable` hooks, no drag event handling, no drop indicator line. The drag handle GripVertical icon is `aria-hidden` and purely decorative — it does nothing.
- **Fix:** Wire dnd-kit-solid `useDraggable` on each PageListItem and `useDroppable` on the list container. Add `useDragDropMonitor` for drag-over position calculation and drop handling. Show drop indicator line between pages during drag.
- **Status:** open

---

## Medium

### RF-003 — Thumbnail not reactively updated when canvas changes
- **Source:** Inline (FE)
- **Location:** `frontend/src/panels/PageListItem.tsx:41-54`
- **Issue:** `updateThumbnail()` is called in `onMount` and in the ref callback, but when `props.thumbnailCanvas` changes (new render from debounced effect), the DOM child is not updated. Solid doesn't re-run `onMount`. Needs a `createEffect` watching `() => props.thumbnailCanvas`.
- **Fix:** Add `createEffect(() => { updateThumbnail(); })` that tracks `props.thumbnailCanvas` reactively.
- **Status:** open

### RF-004 — MCP page broadcast op_type values don't match frontend dispatcher (pre-existing)
- **Source:** Inline (Logic)
- **Location:** `crates/mcp/src/tools/pages.rs:55-70,95-110`
- **Issue:** MCP `create_page_impl` broadcasts `op_type: "create"`, but `apply-remote.ts` expects `"create_page"`. Same for `delete_page_impl` (`"delete"` vs `"delete_page"`) and `rename_page_impl` (`"set_field"` vs `"rename_page"`). Only `reorder_page` (added in this PR) matches. Pre-existing from legacy MCP page tools, not fixed during PR #47 broadcast migration.
- **Fix:** Update `create_page_impl`, `delete_page_impl`, `rename_page_impl` broadcast calls to use `"create_page"`, `"delete_page"`, `"rename_page"` op_types.
- **Status:** open

### RF-005 — No tests for PagesPanel component
- **Source:** Inline (FE)
- **Location:** Missing file: `frontend/src/panels/__tests__/PagesPanel.test.tsx`
- **Issue:** Task 9 (tests) was not implemented. No component tests for page list rendering, keyboard navigation, rename flow, delete guard, or thumbnail display.
- **Fix:** Add PagesPanel tests covering: renders page list, active page highlighted, keyboard nav, rename flow, delete guard (can't delete last), Alt+Arrow reorder.
- **Status:** open

### RF-006 — focusPage uses requestAnimationFrame without cleanup
- **Source:** Inline (Compliance)
- **Location:** `frontend/src/panels/PagesPanel.tsx:241-248`
- **Issue:** `requestAnimationFrame` handle not stored or cancelled on teardown per CLAUDE.md §11 "Module-Level Timers Must Be Cleared".
- **Fix:** Store the rAF handle and cancel it in the `onCleanup` callback.
- **Status:** open

### RF-007 — F2 rename dispatches synthetic dblclick event
- **Source:** Inline (FE)
- **Location:** `frontend/src/panels/PagesPanel.tsx:209-213`
- **Issue:** F2 key handler dispatches a synthetic `MouseEvent("dblclick")` to trigger rename. This is fragile — if PageListItem's double-click handler changes, F2 breaks silently. Better to expose a `startRename` callback prop or use a custom event.
- **Fix:** Add a `triggerRename?: boolean` prop or expose a ref-based `startRename()` method instead of synthetic events.
- **Status:** open

---

## Minor

### RF-008 — GraphQL broadcast payloads pre-built before lock
- **Source:** Inline (Data)
- **Location:** `crates/server/src/graphql/mutation.rs:987-988`
- **Issue:** `broadcast_ops` cloned from `parsed` before the lock scope. This is the established pattern in `applyOperations` and was flagged in PR #47 review (RF-010) but accepted as the existing architecture.
- **Status:** deferred (existing pattern, not introduced in this PR)

### RF-009 — No prefers-reduced-motion check needed for thumbnail debounce
- **Source:** Inline
- **Issue:** Informational — the debounce delay is a timer, not a CSS animation. No action needed.
- **Status:** not-applicable
