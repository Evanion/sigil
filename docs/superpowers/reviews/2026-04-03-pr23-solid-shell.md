# Review Findings — PR #23: Solid Shell Migration

**Date:** 2026-04-03
**Branch:** feature/solid-shell
**Reviewers:** Frontend Engineer, Accessibility, Logic, Compliance, Security, Architect, Data Science

---

## Critical

### RF-001 — Screen reader announcements dropped
- **Source:** A11y
- **Location:** `Toolbar.tsx`, `Canvas.tsx`
- **Description:** Old shell had `announce()` for tool changes and selection changes via aria-live region. New shell has none.
- **Fix:** Add visually-hidden live region to App.tsx, expose `announce()` via context, fire on tool change and selection change.
- **Status:** open

## High

### RF-002 — Subscription never unsubscribed / WebSocket never disposed
- **Source:** Logic, FE, Security
- **Location:** `document-store-solid.tsx:230`
- **Description:** No cleanup mechanism. Memory/connection leak on HMR or unmount.
- **Fix:** Add `destroy()` to store API, call in `onCleanup`. Capture subscription handle and wsClient.
- **Status:** open

### RF-003 — Mutations don't revert optimistic state on error
- **Source:** Logic, FE, Security, Architect, Data Science, Compliance
- **Location:** `document-store-solid.tsx:313-369`
- **Description:** setTransform/renameNode/deleteNode/setVisible/setLocked only log — no rollback.
- **Fix:** Capture previous value before optimistic update, restore on error.
- **Status:** open

### RF-004 — Self-echo suppression absent
- **Source:** Logic, FE, Security
- **Location:** `document-store-solid.tsx:230-237`
- **Description:** Subscription handler ignores senderId, causing redundant full re-fetch on every local mutation.
- **Fix:** Generate client session ID, compare against senderId, skip re-fetch for self-events.
- **Status:** open

### RF-005 — Optimistic UUID remap fails when fetch arrives first
- **Source:** Logic
- **Location:** `document-store-solid.tsx:292-306`
- **Description:** If subscription-triggered fetch replaces nodes before .then() runs, selectedNodeId gets stuck.
- **Fix:** Always remap selectedNodeId even when optimistic node is already gone from store.
- **Status:** open

## Major

### RF-006 — role="main" on canvas element
- **Source:** A11y
- **Location:** `Canvas.tsx:351`
- **Fix:** Move role="main" to container div in App.tsx.
- **Status:** open

### RF-007 — Toolbar arrow keys activate tool immediately
- **Source:** A11y
- **Location:** `Toolbar.tsx:77-93`
- **Fix:** Arrow keys move focus only; Enter/Space activates.
- **Status:** open

### RF-008 — aria-live on entire status bar floods announcements
- **Source:** A11y
- **Location:** `StatusBar.tsx:11`
- **Fix:** Remove aria-live from status bar. Use dedicated live region from RF-001.
- **Status:** open

### RF-009 — Connection indicator aria-label on non-role div
- **Source:** A11y
- **Location:** `StatusBar.tsx:13-21`
- **Fix:** Add aria-hidden="true" to indicator div, remove aria-label.
- **Status:** open

### RF-010 — DocumentStore interface too wide
- **Source:** Architect, FE
- **Location:** `document-store-types.ts`
- **Fix:** Extract minimal ToolStore interface with only 4 methods tools actually use.
- **Status:** open

### RF-011 — Tooltip animation missing prefers-reduced-motion
- **Source:** A11y
- **Location:** `Tooltip.css:12`
- **Fix:** Add @media (prefers-reduced-motion: reduce) block.
- **Status:** open

### RF-012 — Button/IconButton transitions missing prefers-reduced-motion
- **Source:** A11y, Architect
- **Location:** `Button.css:12`, `IconButton.css:13`
- **Fix:** Add @media (prefers-reduced-motion: reduce) blocks.
- **Status:** open

## Medium

### RF-013 — Canvas createEffect misses resize/DPR changes
- **Source:** Logic, FE
- **Location:** `Canvas.tsx:306-328`
- **Fix:** Create signal for canvas dimensions, set in ResizeObserver callback.
- **Status:** open

### RF-014 — parseNode casts without runtime validation
- **Source:** FE, Security
- **Location:** `document-store-solid.tsx:97-114`
- **Fix:** Add parseTransform with Number.isFinite checks, validate required fields.
- **Status:** open

### RF-015 — Missing .catch() on all mutation promise chains
- **Source:** Compliance, Security
- **Location:** `document-store-solid.tsx` (all mutations)
- **Fix:** Add .catch() to every .toPromise().then() chain.
- **Status:** open

### RF-016 — JSON.parse(JSON.stringify()) not in try-catch
- **Source:** FE, Security
- **Location:** `document-store-solid.tsx:272,275,319`
- **Fix:** Replace with structuredClone().
- **Status:** open

### RF-017 — Undo/redo uses debounced fetch
- **Source:** Data Science
- **Location:** `document-store-solid.tsx:372-406`
- **Fix:** Call fetchPages() directly (no debounce) after undo/redo.
- **Status:** open

### RF-018 — Toolbar grid placement relies on DOM order
- **Source:** A11y, Architect
- **Location:** `App.tsx:15`, `App.css:15`
- **Fix:** Wrap Toolbar in div with app-shell__toolbar class.
- **Status:** open

### RF-019 — client field leaks urql transport type
- **Source:** Architect
- **Location:** `document-store-solid.tsx:79`
- **Fix:** Remove client from DocumentStoreAPI.
- **Status:** open

### RF-020 — getAllNodes() creates new Map on every call
- **Source:** Data Science
- **Location:** `Canvas.tsx:40-46`
- **Fix:** Memoize via createMemo, or update tool interface to accept Record.
- **Status:** open

### RF-021 — No store unit tests
- **Source:** FE
- **Location:** `document-store-solid.tsx`
- **Fix:** Add tests for optimistic updates, UUID remap, parsePagesResponse.
- **Status:** open

## Minor/Low

### RF-022 — Panel wrapper divs missing tabindex
- **Source:** Compliance
- **Location:** `App.tsx:16,24`
- **Fix:** Add tabindex={0} to complementary role divs.
- **Status:** open

### RF-023 — Toolbar arrow focus uses fragile DOM child index
- **Source:** A11y
- **Location:** `Toolbar.tsx:83-84`
- **Fix:** Use refs array instead of children[next+1].
- **Status:** open

### RF-024 — isPanning can get stuck
- **Source:** Logic
- **Location:** `Canvas.tsx:158-218`
- **Fix:** Add lostpointercapture listener.
- **Status:** open

### RF-025 — connected signal never resets on WS drop
- **Source:** Architect
- **Location:** `document-store-solid.tsx:235`
- **Fix:** Use graphql-ws on('closed') callback.
- **Status:** open

### RF-026 — Canvas missing role="application"
- **Source:** A11y
- **Location:** `Canvas.tsx:351`
- **Fix:** Add role="application" to canvas element.
- **Status:** open

### RF-027 — UUID keys from server not format-validated
- **Source:** Security
- **Location:** `document-store-solid.tsx:137`
- **Fix:** Validate UUID format before using as map key.
- **Status:** open

### RF-028 — Node names not length-bounded at parse boundary
- **Source:** Security
- **Location:** `document-store-solid.tsx:103`
- **Fix:** Clamp to MAX_NAME_LENGTH at parse boundary.
- **Status:** open

### RF-029 — JSON.parse(JSON.stringify()) anti-pattern
- **Source:** Data Science
- **Location:** `document-store-solid.tsx`
- **Fix:** Use structuredClone(). (Same as RF-016)
- **Status:** open
