# Review Findings — Token References (Spec 13a+13b, PR #54)

**Branch:** feature/token-references
**Date:** 2026-04-13

## Critical

### F-01 — Token name format validation missing on frontend
- **Fix:** Add validateTokenName regex matching core's validate_token_name, visible error on failure
- **Status:** open

### F-02 — Non-atomic rename (two independent mutations)
- **Fix:** Single batch applyOperations with [addToken, removeToken], single snapshot rollback
- **Status:** open

### F-03 — Token mutations not wired to HistoryManager
- **Fix:** Add token operation types, wire createToken/updateToken/deleteToken through interceptor
- **Status:** open

## High

### F-04 — Broadcast payloads incomplete (missing token_type, value)
- **Fix:** Include all fields in server broadcast value payloads
- **Status:** open

### F-05 — Rollback missing visible error notification
- **Fix:** Call announce() with error message on server failure
- **Status:** open

### F-06 — listbox+option ARIA broken by group divs
- **Fix:** Switch to role="tree"/role="treeitem" for hierarchical groups, or use role="group"
- **Status:** open

### F-07 — Grid table missing cell role assignments
- **Fix:** Remove role="grid", use native table semantics
- **Status:** open

### F-08 — Token value not shape-validated at deserialization
- **Fix:** Add isValidTokenValue type guard
- **Status:** open

## Medium

### F-09 — Depth test missing positive boundary case
- **Status:** open

### F-10 — Rename commit not announced
- **Status:** open

### F-11 — Group toggle missing aria-controls
- **Status:** open

### F-12 — Description textarea needs coalescing (deferred to F-03)
- **Status:** deferred

### F-13 — initialSelection not reactive across open/close
- **Status:** open

### F-14 — tokenType not validated against allowlist
- **Status:** open

## Low

### F-15 — Delete button label string manipulation
- **Status:** open

### F-16 — Value column shows raw discriminant
- **Status:** open

### F-17 — Form label lacks edit context
- **Status:** open

### F-18 — For on groups should be Index
- **Status:** open
