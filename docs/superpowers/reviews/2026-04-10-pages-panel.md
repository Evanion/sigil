# Review Findings — Pages Panel (Spec 10c)

**Branch:** feature/pages-panel
**Date:** 2026-04-10
**Reviewers:** Inline preliminary + full combined agent review (Architect/Security/BE/Logic/Compliance/Data/FE/A11y/UX)

---

## Critical

### RF-010 — create_page broadcast silently drops on all remote clients
- **Source:** Full review (Logic/Broadcast)
- **Location:** `crates/server/src/graphql/mutation.rs:824-830`, `crates/mcp/src/tools/pages.rs:61-68`, `frontend/src/operations/apply-remote.ts:499-533`
- **Issue:** The broadcast value payload for `create_page` is `{ "name": name }` which is missing the page UUID. The frontend `applyCreatePage` looks for `raw["id"] ?? raw["pageId"] ?? raw["pageUuid"]` — finds none, logs a warning, and silently discards the page. No remote client ever sees new pages created by other users. Affects both GraphQL and MCP broadcast paths.
- **Fix:** Add the page UUID to the value payload: `{ "id": page_uuid.to_string(), "name": name }` in both `parse_create_page` (mutation.rs) and `create_page_impl` (pages.rs).
- **Status:** open

---

## High

### RF-001 — Thumbnail renders same root nodes for every page
- **Source:** Inline (Logic)
- **Location:** `frontend/src/panels/PagesPanel.tsx:43-49`
- **Issue:** `renderThumbnails()` collects root nodes by checking `parentUuid === null` across ALL nodes, not filtered per page. Every page thumbnail shows identical content.
- **Fix:** Filter root nodes per page using the page's node membership.
- **Status:** open

### RF-002 — No DnD reorder implementation
- **Source:** Inline (FE/UX)
- **Location:** `frontend/src/panels/PagesPanel.tsx`, `frontend/src/panels/PageListItem.tsx:127-129`
- **Issue:** Only keyboard reorder (Alt+Arrow) is implemented. No dnd-kit-solid hooks, no drag handling, no drop indicator. The drag handle icon is decorative only.
- **Fix:** Wire dnd-kit-solid useDraggable/useDroppable and useDragDropMonitor.
- **Status:** open

### RF-011 — Page mutations have no undo/redo support
- **Source:** Full review (Compliance)
- **Location:** `frontend/src/store/document-store-solid.tsx:1300-1550`
- **Issue:** CLAUDE.md §1: "Every user-facing operation must support undo/redo." Page mutations bypass the HistoryManager entirely. No page operation types exist in the operations type system.
- **Fix:** Add page op types to HistoryManager. This is an architectural cross-cutting concern.
- **Status:** open — recommend deferring with tracking issue

### RF-012 — MAX_PAGES_PER_DOCUMENT has no enforcement test
- **Source:** Full review (Compliance)
- **Location:** `crates/core/src/validate.rs:62`, `crates/core/src/document.rs:109-118`
- **Issue:** CLAUDE.md §11 requires `test_max_pages_per_document_enforced`. Does not exist.
- **Fix:** Add the test.
- **Status:** open

### RF-013 — DeletePage allows deleting the last page (server-side)
- **Source:** Full review (Security)
- **Location:** `crates/core/src/commands/page_commands.rs:41-56`
- **Issue:** `DeletePage::validate` only checks page exists, not that at least 1 page remains. Frontend guard is bypassable via GraphQL/MCP. No `MIN_PAGES_PER_DOCUMENT` constant.
- **Fix:** Add `MIN_PAGES_PER_DOCUMENT = 1` to validate.rs, enforce in `DeletePage::validate`.
- **Status:** open

### RF-014 — Rename input uses hardcoded maxLength={256}
- **Source:** Full review (Compliance)
- **Location:** `frontend/src/panels/PageListItem.tsx:152`
- **Issue:** CLAUDE.md §11: numeric input controls must use named constants. `maxLength={256}` is a hardcoded literal.
- **Fix:** Export `MAX_PAGE_NAME_LENGTH` from store constants, import and use it.
- **Status:** open

---

## Medium

### RF-003 — Thumbnail not reactively updated when canvas changes
- **Source:** Inline (FE)
- **Location:** `frontend/src/panels/PageListItem.tsx:41-54`
- **Issue:** `updateThumbnail()` called in `onMount` and ref callback, but not re-run when `props.thumbnailCanvas` changes.
- **Fix:** Add `createEffect` watching `props.thumbnailCanvas`.
- **Status:** open

### RF-004 — MCP page broadcast op_type values don't match frontend (pre-existing)
- **Source:** Inline (Logic)
- **Location:** `crates/mcp/src/tools/pages.rs:55-70,95-110`
- **Issue:** MCP create/delete/rename page tools broadcast wrong op_types. Pre-existing, not introduced in this PR.
- **Fix:** Update to `"create_page"`, `"delete_page"`, `"rename_page"`.
- **Status:** open

### RF-005 — No tests for PagesPanel component
- **Source:** Inline (FE)
- **Location:** Missing file
- **Fix:** Add PagesPanel.test.tsx.
- **Status:** open

### RF-006 — focusPage rAF not cleaned up
- **Source:** Inline (Compliance)
- **Location:** `frontend/src/panels/PagesPanel.tsx:241-248`
- **Fix:** Store and cancel rAF handle in onCleanup.
- **Status:** open

### RF-007 — F2 rename dispatches synthetic dblclick
- **Source:** Inline (FE)
- **Location:** `frontend/src/panels/PagesPanel.tsx:209-213`
- **Fix:** Expose startRename callback instead.
- **Status:** open

### RF-015 — MCP create_page_impl missing page UUID in value
- **Source:** Full review (Broadcast)
- **Location:** `crates/mcp/src/tools/pages.rs:61-68`
- **Fix:** Add `"id": page_uuid.to_string()` to broadcast value. Covered by RF-010 fix.
- **Status:** open

### RF-016 — ReorderPage error message range notation
- **Source:** Full review (Consistency)
- **Location:** `crates/core/src/commands/page_commands.rs:71-75`
- **Fix:** Change `(0..{len})` to `(0..={len-1})` with empty guard.
- **Status:** open

### RF-017 — isFocused fallback uses positional pages[0]
- **Source:** Full review (Frontend)
- **Location:** `frontend/src/panels/PagesPanel.tsx:280`
- **Fix:** Initialize focusedPageId to first page's ID on mount.
- **Status:** open

### RF-018 — Spec-required undo/redo integration test missing
- **Source:** Full review (Compliance)
- **Issue:** `test_reorder_page_execute_undo_redo_cycle` referenced in spec doesn't exist.
- **Fix:** Deferred with RF-011 (page undo/redo).
- **Status:** deferred (blocked on RF-011)

---

## Minor

### RF-008 — GraphQL broadcast payloads pre-built before lock
- **Status:** deferred (existing pattern)

### RF-009 — No prefers-reduced-motion needed for thumbnail debounce
- **Status:** not-applicable

### RF-019 — applyReorderPage accepts undocumented position key
- **Source:** Full review (Interface)
- **Location:** `frontend/src/operations/apply-remote.ts:613`
- **Fix:** Remove dead `position` key acceptance.
- **Status:** open

### RF-020 — Page auto-numbering produces duplicate names
- **Source:** Full review (UX)
- **Location:** `frontend/src/panels/PagesPanel.tsx:94-96`
- **Fix:** Use monotonic counter or max-number extraction.
- **Status:** open
