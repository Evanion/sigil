# PR #54 Review Findings — Token References + Management UI

**Date:** 2026-04-14
**Reviewers:** Architect, Security, Backend, Logic, Compliance, Data Scientist, Frontend, A11y, UX
**Branch:** feature/token-references

## Critical

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-001 | BE | MCP broadcast `op_type` values don't match frontend dispatcher — MCP mutations invisible | `crates/mcp/src/tools/tokens.rs` | deferred-separate-pr |

## High

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-002 | BE, Arch | MCP `create_token` broadcast missing required fields | `crates/mcp/src/tools/tokens.rs` | deferred-separate-pr |
| RF-003 | BE | MCP `update_token` broadcast missing fields | `crates/mcp/src/tools/tokens.rs` | deferred-separate-pr |
| RF-004 | Security | Token name regex allows `/` but Rust rejects it — asymmetric validation | `token-helpers.ts:35` | resolved — removed `/` from regex and sanitizer |
| RF-005 | FE | Popover CSS `position: fixed` should be `position: absolute` for CSS Anchor Positioning | `Popover.css` | resolved — changed to `position: absolute` |
| RF-006 | FE | GradientEditorPopover missing `modal` prop — drag may close popover | `GradientEditorPopover.tsx` | resolved — added `modal` prop |
| RF-007 | Logic | `updateToken` sends `null` description when caller omits it — client/server divergence | `document-store-solid.tsx` | resolved — uses `newDescription` instead of `description ?? null` |

## Major

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-008 | Arch, UX, Sec | Non-atomic rename — needs core crate RenameToken operation | `TokenEditor.tsx` | deferred-13d |
| RF-009 | FE, Logic | Server error rollback doesn't remove undo history entry | `document-store-solid.tsx` | deferred-followup |
| RF-010 | Data | Full-snapshot rollback O(N) + lost-update race — use surgical rollback | `document-store-solid.tsx` | resolved — surgical single-token rollback |
| RF-011 | UX | "All Categories" uses generic renderer — loses type-specific previews | `TokenStyleguideView.tsx` | resolved — dispatches per-group renderer based on token type |
| RF-012 | UX | Auto-create with no name input — poor creation UX | `TokenEditor.tsx` | deferred-followup |
| RF-013 | Compliance | Vite proxy port changed 4680→4681 | `vite.config.ts` | resolved — reverted to 4680 |
| RF-014 | A11y | Missing roving tabindex on listbox renderers | All renderers | resolved — first item tabindex=0, rest -1 |

## Medium

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-015 | BE | Asymmetric update semantics GraphQL vs MCP | GraphQL vs MCP | deferred-separate-pr |
| RF-016 | BE, Arch | Broadcast constructed before precondition verification | `mutation.rs` | deferred-separate-pr |
| RF-017 | Security, Data | Shallow `isValidTokenValue` — doesn't check sub-fields | `token-helpers.ts` | deferred-followup |
| RF-018 | UX | Disabled categories block creation flow | `TokenNavigationPane.tsx` | resolved — categories always clickable, empty ones styled with reduced opacity |
| RF-019 | UX | No delete confirmation when token has references | `TokenDetailPane.tsx` | deferred-followup |
| RF-020 | A11y | Group headers are div not heading | `TokenStyleguideView.tsx` | resolved — changed to `<h4>` |
| RF-021 | A11y | `<span role="link">` should be `<button>` | `TokenDetailPane.tsx` | resolved — changed to `<button type="button">` |
| RF-022 | A11y | Hardcoded English aria-labels not using i18n | Renderers | resolved — all use `t()` with i18n keys |
| RF-023 | FE | `font_family` input not CSS-validated at input boundary | `TokenDetailEditor.tsx` | deferred-followup |
| RF-024 | Arch | Duplicate `colorToCss` across files | Multiple | resolved — extracted to `token-helpers.ts` |
| RF-025 | BE | Dead code: `validate_token_type_matches_value` | `types.rs` | deferred-separate-pr |
| RF-026 | BE | Duplicated `token_type_to_str`/`parse_token_type` | `types.rs`, `tokens.rs` | deferred-separate-pr |
| RF-027 | Security | `MAX_TOKENS_PER_CONTEXT` not exported, no enforcement test | `document-store-solid.tsx` | deferred-followup |
| RF-028 | A11y | Token name h3 has role=button — lost from heading nav | `TokenDetailPane.tsx` | deferred-followup |
| RF-029 | A11y | Modal popover lacks focus trap | `Popover.tsx` | deferred-followup |

## Minor/Low

| ID | Source | Description | Status |
|---|---|---|---|
| RF-030 | FE | `splitProps` unnecessary when all props local | wont-fix — established codebase pattern |
| RF-031 | FE | `<Index>` for static CATEGORY_TYPES | resolved — changed to `<For>` |
| RF-032 | Arch | Duplicate `position: fixed` in Popover.css | resolved — fixed with RF-005 |
| RF-033 | Arch | `nodeUuid` used for token name — semantic mismatch | deferred-followup |
| RF-034 | UX | "Open full editor" not pinned to bottom | deferred-followup |
| RF-035 | A11y | Home/End key missing in listbox | deferred-followup |
| RF-036 | Data | `resolveToken` allocates Set per call in hot path | wont-fix — negligible cost at current scale |

## Resolution Summary

- **Resolved in this PR:** 14 findings (RF-004, RF-005, RF-006, RF-007, RF-010, RF-011, RF-013, RF-014, RF-018, RF-020, RF-021, RF-022, RF-024, RF-031, RF-032)
- **Deferred to separate MCP PR:** 7 findings (RF-001, RF-002, RF-003, RF-015, RF-016, RF-025, RF-026)
- **Deferred to follow-up:** 10 findings (RF-008, RF-009, RF-012, RF-017, RF-019, RF-023, RF-027, RF-028, RF-029, RF-033, RF-034, RF-035)
- **Won't fix:** 2 findings (RF-030, RF-036)

## Deferred Rationale

- **RF-001/002/003/015/016/025/026**: Pre-existing MCP broadcast issues from 13a — separate PR for MCP parity fixes
- **RF-008**: Atomic rename needs core crate `RenameToken` FieldOperation — planned for 13d
- **RF-009**: Undo rollback needs interceptor API (`rollbackLast`) — follow-up PR
- **RF-012**: Create flow UX redesign — follow-up after user feedback
- **RF-019**: Delete confirmation — follow-up UX enhancement
- **RF-030**: `splitProps` is the established pattern in this codebase — consistency over optimization
