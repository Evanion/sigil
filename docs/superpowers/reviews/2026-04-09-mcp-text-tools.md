# Review Findings — MCP Broadcast Parity + Text Tools (Spec 03b)

**Branch:** feature/mcp-text-tools
**Date:** 2026-04-09
**Reviewers:** Architect, Security, Backend, Logic, Compliance, Data, Frontend, A11y, UX (9 agents)

---

## Critical

### RF-001 — MCP broadcast format mismatches frontend dispatcher
- **Source:** Logic
- **Location:** `crates/mcp/src/tools/nodes.rs`, `crates/mcp/src/tools/text.rs`, `frontend/src/operations/apply-remote.ts`
- **Issue:** All MCP broadcast op_type/path/value formats don't match what the frontend's `applyRemoteOperation` expects. `create_node` sends `"create"` but FE expects `"create_node"`. `delete_node` sends `"delete"` but FE expects `"delete_node"`. `reparent` sends bare string but FE expects `{parentUuid, position}`. `reorder` sends bare number but FE expects `{position}`. Text paths `kind.content`/`kind.text_style.*` have no handler in `applyFieldSet`. Every MCP mutation is invisible to other connected clients.
- **Fix:** Read `apply-remote.ts` and align all MCP broadcast op_type/path/value formats to match the expected shapes. Add `kind.content` and `kind.text_style.*` handlers to `applyFieldSet`.
- **Status:** open

---

## High

### RF-002 — TextStyle derive Deserialize bypasses validation (pre-existing)
- **Source:** Security, BE
- **Location:** `crates/core/src/node.rs:181`
- **Issue:** TextStyle has `#[derive(Deserialize)]` with public fields. Workfile load bypasses validate_text_style.
- **Fix:** Remove derive, implement custom Deserialize routing through validate_text_style. Make fields pub(crate).
- **Status:** open

### RF-003 — TextShadowRaw doesn't reject duplicate keys
- **Source:** Compliance, BE
- **Location:** `crates/core/src/node.rs:361-371`
- **Fix:** Replace derive Deserialize on TextShadowRaw with MapAccess visitor that rejects duplicates.
- **Status:** open

### RF-004 — CSS denylist duplicated between validate.rs and text_style_commands.rs
- **Source:** Security
- **Location:** `crates/core/src/commands/text_style_commands.rs:122`
- **Fix:** Use `FONT_FAMILY_FORBIDDEN_CHARS` constant instead of inline array.
- **Status:** open

### RF-005 — Rollback can orphan applied fields if capture_old_field fails
- **Source:** BE
- **Location:** `crates/mcp/src/tools/text.rs:419-449`
- **Fix:** Capture all old fields in one pass before the apply loop starts.
- **Status:** open

### RF-006 — font_family not validated at frontend boundary
- **Source:** FE
- **Location:** `frontend/src/canvas/text-measure.ts:145`
- **Fix:** Add CSS char validation helper, call in buildFontString and handleFontFamilyChange.
- **Status:** open

### RF-007 — setTextStyle loses type safety via Record<string, unknown>
- **Source:** FE
- **Location:** `frontend/src/store/document-store-solid.tsx:924-934`
- **Fix:** Use typed spread pattern: `{ ...cloned, [patch.field]: patch.value } as TextStyle`.
- **Status:** open

### RF-008 — Zero tests for shadow rendering and UI controls
- **Source:** FE
- **Location:** `renderer.test.ts`, `TypographySection.test.tsx`
- **Fix:** Add shadow rendering tests and shadow UI control tests.
- **Status:** open

### RF-009 — Document-level keydown handler doesn't stopPropagation
- **Source:** FE
- **Location:** `frontend/src/panels/TypographySection.tsx:381-387`
- **Fix:** Add e.stopPropagation() after e.preventDefault() for each shortcut. Add defaultPrevented guard.
- **Status:** open

---

## Medium

### RF-010 — Broadcast payloads pre-built before lock/node verification
- **Source:** Data, BE
- **Location:** `crates/mcp/src/tools/text.rs:387-397`
- **Fix:** Move broadcast_ops construction inside lock scope after successful apply.
- **Status:** open

### RF-011 — unwrap_or_default silently drops serialization errors
- **Source:** BE
- **Location:** `crates/mcp/src/tools/nodes.rs:422`
- **Fix:** Replace with match that logs error on failure.
- **Status:** open

### RF-012 — TokenRef names not validated
- **Source:** Security
- **Location:** `crates/mcp/src/tools/text.rs:39,116`
- **Fix:** Call validate_token_name in TokenRef arm of convert functions.
- **Status:** open

### RF-013 — Rollback errors mapped to InvalidInput
- **Source:** Security
- **Location:** `crates/mcp/src/tools/text.rs:443`
- **Fix:** Add McpToolError::RollbackFailed variant.
- **Status:** open

### RF-014 — Shadow toggle missing aria-expanded/aria-controls
- **Source:** A11y
- **Location:** `frontend/src/panels/TypographySection.tsx:541-547`
- **Fix:** Add aria-expanded={shadowEnabled()} and aria-controls="shadow-controls".
- **Status:** open

### RF-015 — ColorSwatch popover trigger no focus-visible
- **Source:** A11y
- **Location:** `frontend/src/components/popover/Popover.css`
- **Fix:** Add .sigil-popover-trigger:focus-visible rule.
- **Status:** open

### RF-016 — Decorative label spans not aria-hidden
- **Source:** A11y
- **Location:** `frontend/src/panels/TypographySection.tsx:529,540`
- **Fix:** Add aria-hidden="true" to decorative label spans.
- **Status:** open

### RF-017 — MAX_FONT_SIZE mismatches NumberInput max
- **Source:** FE
- **Location:** `frontend/src/panels/TypographySection.tsx:55,425`
- **Fix:** Pass MAX_FONT_SIZE as the max prop.
- **Status:** open

### RF-018 — Shadow offsets accept unbounded values
- **Source:** FE
- **Location:** `frontend/src/panels/TypographySection.tsx:307-325`
- **Fix:** Define MAX_SHADOW_OFFSET, enforce in handlers and NumberInput.
- **Status:** open

### RF-019 — Shadow toggle inconsistent with fills/effects pattern
- **Source:** UX
- **Location:** `frontend/src/panels/TypographySection.tsx:541-548`
- **Fix:** Replace "On/Off" text with eye icon toggle or checkbox.
- **Status:** open

### RF-020 — Shadow controls lack visible labels
- **Source:** UX
- **Location:** `frontend/src/panels/TypographySection.tsx:552-577`
- **Fix:** Add prefix labels "X", "Y", "Blur" matching EffectCard pattern.
- **Status:** open

### RF-021 — No visual separator between color and shadow
- **Source:** UX
- **Location:** `frontend/src/panels/TypographySection.css`
- **Fix:** Add border-top or hr between sections.
- **Status:** open

### RF-022 — Default shadow alpha=1.0 inconsistent with effects
- **Source:** UX
- **Location:** `frontend/src/panels/TypographySection.tsx:61-66`
- **Fix:** Change default shadow color alpha to 0.3.
- **Status:** open

### RF-023 — publish_event should be renamed
- **Source:** Architect
- **Location:** `crates/state/src/lib.rs:247`
- **Fix:** Rename to broadcast_internal, update docstring.
- **Status:** open

### RF-024 — Empty node_uuid for token operations
- **Source:** Architect
- **Location:** `crates/mcp/src/tools/broadcast.rs:97`
- **Fix:** Document the sentinel or use Option<String>.
- **Status:** open

### RF-025 — Double serialization of StyleValueInput
- **Source:** Data
- **Fix:** Construct broadcast JSON directly instead of round-tripping through serde.
- **Status:** deferred (optimization, not correctness)

### RF-026 — Stringly-typed op_type/path
- **Source:** Data
- **Fix:** Define typed enums for op_type/path.
- **Status:** deferred (architectural improvement, separate PR)

### RF-027 — Missing integration tests for MCP text tools
- **Source:** BE
- **Location:** `crates/mcp/src/tools/text.rs`
- **Fix:** Add integration tests through AppState.
- **Status:** open

---

## Minor/Low

### RF-028 — Shadow color fallback opacity mismatch
- **Source:** FE
- **Location:** `frontend/src/canvas/renderer.ts:165`
- **Fix:** Change fallback to rgba(0,0,0,1) to match DEFAULT_TEXT_SHADOW.
- **Status:** open

### RF-029 — .map() used for radiogroup
- **Source:** FE
- **Location:** `frontend/src/panels/TypographySection.tsx:488`
- **Fix:** Use <For> or <Index>.
- **Status:** open

### RF-030 — Typography title is span not h3
- **Source:** A11y
- **Location:** `frontend/src/panels/TypographySection.tsx:395`
- **Fix:** Change to <h3>.
- **Status:** open

### RF-031 — keydown handler doesn't check defaultPrevented
- **Source:** Architect
- **Fix:** Add guard at top of handler.
- **Status:** open (covered by RF-009 fix)

### RF-032 — MutationEvent clone deep-copies full Vec
- **Source:** Data
- **Fix:** Use Arc<TransactionPayload>.
- **Status:** deferred (optimization, separate PR)

### RF-033 — set_text_content_impl validates length inside lock
- **Source:** Security
- **Fix:** Add pre-lock length check.
- **Status:** open
