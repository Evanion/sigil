# Review Findings: PR #36 — Operation Types + HistoryManager + IndexedDB (Plan 15a)

**Date:** 2026-04-07
**Reviewers:** 7 agents (Architect, Security, BE, Logic, Compliance, DataSci, FE)
**Total findings:** 16 (1 Critical, 6 High, 7 Medium, 2 Low)

## Critical

### RF-001 — Array.shift() O(n) eviction
- **Source:** DataSci
- **File:** `history-manager.ts` pushUndo
- **Fix:** Change `while` to `if` (only 1 eviction per push). Document O(n) cost as acceptable for n=500.
- **Status:** `open`

## High

### RF-002 — create_node inverse loses nodeUuid
- **Source:** Logic
- **File:** `operation-helpers.ts` createInverse
- **Fix:** When inverting create_node→delete_node, extract UUID from `op.value.uuid`.
- **Status:** `open`

### RF-003 — IndexedDB data loaded without shape validation
- **Source:** Logic, Compliance, BE, DataSci
- **File:** `history-store.ts` loadStack
- **Fix:** Add runtime shape validation. On failure, return empty stacks + console.warn.
- **Status:** `open`

### RF-004 — Empty commitTransaction doesn't clear redo
- **Source:** Logic
- **File:** `history-manager.ts` commitTransaction
- **Fix:** Move `this.redoStack = []` outside the length guard.
- **Status:** `open`

### RF-005 — saveStack resolves before IDB transaction commits
- **Source:** Logic, BE
- **File:** `history-store.ts` saveStack/clearStack
- **Fix:** Resolve on `tx.oncomplete`, reject on `tx.onerror`/`tx.onabort`.
- **Status:** `open`

### RF-006 — No MAX_OPERATIONS_PER_TRANSACTION cap
- **Source:** DataSci
- **Fix:** Add MAX_OPERATIONS_PER_TRANSACTION = 1000 constant. Enforce in addOperation/apply.
- **Status:** `open`

### RF-007 — Full-stack serialization every persistAsync
- **Source:** DataSci
- **Fix:** Add 500ms trailing debounce to persistAsync. Clean timer in dispose().
- **Status:** `open`

## Medium

### RF-008 — Constant test naming
- **Fix:** Add `test_max_history_size_enforced` aliased test.
- **Status:** `open`

### RF-009 — persistAsync no recovery
- **Fix:** Document as known limitation. Defer visible notification until toast system.
- **Status:** `open`

### RF-010 — undo/redo pop without restore-on-error
- **Fix:** Wrap createInverseTransaction in try-catch, push back on error.
- **Status:** `open`

### RF-011 — Mutable seq on readonly interface
- **Fix:** Add comment: `// INTENTIONAL: mutable for server-assigned sequence number`.
- **Status:** `open`

### RF-012 — cancelTransaction silent no-op
- **Fix:** Add guard that throws if no active transaction.
- **Status:** `open`

### RF-013 — MAX_HISTORY_SIZE in types.ts
- **Fix:** Defer — move to limits.ts in future refactor. Not blocking.
- **Status:** `open`

### RF-014 — makeKey collision risk
- **Fix:** Use IDB compound key `[documentId, userId]` instead of string join.
- **Status:** `open`

## Low

### RF-015 — persistAsync no debounce + no dispose cleanup
- **Fix:** Covered by RF-007.
- **Status:** `open`

### RF-016 — Empty transaction policy undocumented
- **Fix:** Add JSDoc note.
- **Status:** `open`
