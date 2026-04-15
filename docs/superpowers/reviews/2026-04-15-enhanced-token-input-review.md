# Enhanced Token Input Review Findings (Spec 13e)

**Date:** 2026-04-15
**Reviewers:** Architect, Security, Logic, Frontend, A11y, UX, Compliance, Data Scientist
**Branch:** feature/enhanced-token-input

## Critical

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-001 | A11y, UX, Arch | `role="textbox"` → `role="combobox"` for autocomplete pattern | `EnhancedTokenInput.tsx` | open |

## High

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-002 | Security | No input length enforcement in highlighter | `EnhancedTokenInput.tsx` | open |
| RF-003 | Security | Paste handler no length limit | `EnhancedTokenInput.tsx` | open |
| RF-004 | FE, Arch | `formatEvalValue` color channels not Number.isFinite guarded | `EnhancedTokenInput.tsx` | open |
| RF-005 | FE, Arch | `formatEvalValue` can return undefined | `EnhancedTokenInput.tsx` | open |
| RF-006 | FE, Arch, Logic | `insertSuggestion` doesn't update confirmedValue | `EnhancedTokenInput.tsx` | open |
| RF-007 | Logic | Escape revert target overwritten during edit by external prop | `EnhancedTokenInput.tsx` | open |

## Major

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-008 | Arch, Logic | handleBlur doesn't commit — edits lost on click-away | `EnhancedTokenInput.tsx` | open |
| RF-009 | A11y | aria-autocomplete conditionally set | `EnhancedTokenInput.tsx` | open |
| RF-010 | A11y | No SR announcement on autocomplete open/close | `EnhancedTokenInput.tsx` | open |
| RF-011 | Data | Double cursor computation + full DOM rebuild per keystroke | `EnhancedTokenInput.tsx` | open |
| RF-012 | Data | filterTokenSuggestions sorts O(n log n) per keystroke | `token-autocomplete.ts` | open |
| RF-013 | UX | No visual hint that { triggers autocomplete | `EnhancedTokenInput.tsx` | open |
| RF-014 | UX | Function/number highlight colors indistinguishable | `EnhancedTokenInput.css` | open |
| RF-015 | UX | Color preview raw 0-1 floats, no swatch | `EnhancedTokenInput.tsx` | open |
| RF-016 | Arch | Duplicated function registry | `token-autocomplete.ts` | open |
| RF-017 | A11y | Missing aria-disabled | `EnhancedTokenInput.tsx` | open |
| RF-018 | A11y | Label/input association broken | `TokenDetailEditor.tsx` | open |

## Medium

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-019 | Logic | handleExpressionChange silently discards empty | `TokenDetailEditor.tsx` | open |
| RF-020 | FE | Deprecated document.execCommand | `EnhancedTokenInput.tsx` | open |
| RF-021 | UX | Function autocomplete too aggressive (1 char) | `token-autocomplete.ts` | open |
| RF-022 | FE | Unnecessary splitProps | `EnhancedTokenInput.tsx` | open |
| RF-023 | FE | CSS hardcoded rgba fallback | `EnhancedTokenInput.css` | open |
| RF-024 | Data | BUILTIN_FUNCTIONS re-sorted every call | `token-autocomplete.ts` | open |
| RF-025 | Arch | mode/onModeChange props omitted from spec | `EnhancedTokenInput.tsx` | open |

## Minor/Low

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-026 | Arch | 612-line component — extract helpers | `EnhancedTokenInput.tsx` | open |
| RF-027 | Data | Math.random ID — use createUniqueId | `EnhancedTokenInput.tsx` | open |
| RF-028 | A11y | aria-controls references conditionally rendered element | `EnhancedTokenInput.tsx` | open |
| RF-029 | UX | Disabled blocks text selection | `EnhancedTokenInput.css` | open |
| RF-030 | UX | No function category grouping | `token-autocomplete.ts` | deferred-followup |
