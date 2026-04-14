# Deferred Findings Tracker

This file tracks review findings that were deferred from their originating PR. Each group identifies the PR or spec where the finding should be resolved. When a finding is resolved, update its status and add the resolving PR number.

---

## MCP Broadcast Parity PR

These findings are pre-existing issues from the Spec 13a implementation, discovered during PR #54 review. They should be resolved in a dedicated MCP parity fix PR.

| ID | Severity | Description | File |
|---|---|---|---|
| RF-001 | Critical | MCP broadcast `op_type` values don't match frontend dispatcher -- MCP token mutations invisible to connected clients | `crates/mcp/src/tools/tokens.rs` |
| RF-002 | High | MCP `create_token` broadcast missing required fields (`id` and full value shape) | `crates/mcp/src/tools/tokens.rs` |
| RF-003 | High | MCP `update_token` broadcast missing fields | `crates/mcp/src/tools/tokens.rs` |
| RF-015 | Medium | Asymmetric update semantics between GraphQL and MCP (GraphQL uses partial update, MCP uses full replace) | GraphQL vs MCP |
| RF-016 | Medium | Broadcast payload constructed before precondition verification (lock acquisition, entity existence) | `crates/server/src/graphql/mutation.rs` |
| RF-025 | Medium | Dead code: `validate_token_type_matches_value` function unused | `crates/mcp/src/tools/types.rs` |
| RF-026 | Medium | Duplicated `token_type_to_str`/`parse_token_type` between `types.rs` and `tokens.rs` | `crates/mcp/src/tools/types.rs`, `crates/mcp/src/tools/tokens.rs` |

**Acceptance criteria for the MCP parity PR:**
- All `op_type` strings in MCP token tools match `applyRemoteOperation` dispatcher strings exactly
- All broadcast payloads include required fields per the MCP Broadcast Payload Shape Contract (CLAUDE.md S4)
- GraphQL and MCP update semantics are aligned (both partial or both full-replace, with documented rationale)
- Broadcast payloads constructed after lock acquisition and precondition checks
- Dead code removed, duplicated conversion functions consolidated

---

## Spec 13d -- Atomic Token Rename

| ID | Severity | Description | File |
|---|---|---|---|
| RF-008 | Major | Token rename is implemented as create+delete (two independent mutations). If one fails, state is inconsistent. Needs a dedicated `RenameToken` FieldOperation in the core crate. | `frontend/src/panels/TokenEditor.tsx` |

**Acceptance criteria:**
- `RenameToken` FieldOperation in `crates/core/` with `validate` -> `apply` cycle
- `validate` checks: old name exists, new name passes validation, new name not already taken
- GraphQL mutation and MCP tool both use the atomic operation
- Frontend store calls the atomic mutation instead of create+delete
- Undo captures old name and restores it atomically

---

## Follow-Up PRs

These findings are not blocked by a specific spec and can be picked up independently.

### Frontend Store / Undo

| ID | Severity | Description | File | Notes |
|---|---|---|---|---|
| RF-009 | Major | Server error rollback does not remove the undo history entry created during optimistic update -- produces ghost undo steps | `document-store-solid.tsx` | Needs `rollbackLast()` or equivalent API on HistoryManager |

### Frontend Validation

| ID | Severity | Description | File | Notes |
|---|---|---|---|---|
| RF-017 | Medium | `isValidTokenValue` only checks top-level structure, does not validate sub-fields (e.g., color channel ranges, font-weight bounds) | `token-helpers.ts` | Should match Rust-side `TokenValue` validation depth |
| RF-023 | Medium | `font_family` input in token detail editor not CSS-validated at input boundary | `TokenDetailEditor.tsx` | Existing rule: "CSS-Rendered String Fields Must Reject CSS-Significant Characters" |
| RF-027 | Medium | `MAX_TOKENS_PER_CONTEXT` constant not exported, no enforcement test | `document-store-solid.tsx` | Existing rule: "Constant Enforcement Tests" |

### Frontend UX

| ID | Severity | Description | File | Notes |
|---|---|---|---|---|
| RF-012 | Major | Auto-create token with no name input -- poor creation UX | `TokenEditor.tsx` | Redesign after user feedback |
| RF-019 | Medium | No delete confirmation when token has active references | `TokenDetailPane.tsx` | Should warn user about reference breakage |
| RF-033 | Minor | `nodeUuid` field used for token name -- semantic mismatch in GraphQL schema | Multiple | Consider renaming to `tokenName` or `entityId` |
| RF-034 | Minor | "Open full editor" link not pinned to bottom of detail pane | `TokenDetailPane.tsx` | CSS layout fix |

### Accessibility

| ID | Severity | Description | File | Notes |
|---|---|---|---|---|
| RF-028 | Medium | Token name `<h3>` has `role="button"` -- removed from heading navigation tree | `TokenDetailPane.tsx` | Use `<button>` inside `<h3>` instead of overriding the heading role |
| RF-029 | Medium | Modal popover lacks focus trap -- Tab can escape to background | `Popover.tsx` | Native popover `popover="manual"` does not auto-trap focus; needs manual trap |
| RF-035 | Minor | Home/End keyboard shortcuts missing in token listbox | Multiple renderers | WCAG listbox pattern requires Home/End support |
