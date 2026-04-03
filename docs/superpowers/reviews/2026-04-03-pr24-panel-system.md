# Review Findings — PR #24: Panel System

**Date:** 2026-04-03
**Branch:** feature/panel-system
**Reviewers:** Frontend Engineer, Accessibility, Logic, Security, Architect, Compliance

---

## Critical

### RF-001 — tabpanel missing aria-labelledby; tab buttons have no id
- **Source:** A11y, FE
- **Location:** `TabRegion.tsx:65,80`
- **Fix:** Add id to each tab button, aria-labelledby on tabpanel.
- **Status:** open

## High

### RF-002 — registerDefaultPanels called inside component body with no duplicate guard
- **Source:** Logic, FE, Architect
- **Location:** `App.tsx:14`, `registry.ts:30`
- **Fix:** Add duplicate-ID guard in registerPanel, or move registration to module scope.
- **Status:** open

### RF-003 — activeTab initialized from non-reactive snapshot
- **Source:** Logic, Architect
- **Location:** `TabRegion.tsx:22`
- **Fix:** Derive activeTab reactively from defaultTab.
- **Status:** open

### RF-004 — Unvalidated dynamic field name in transform mutation
- **Source:** Security
- **Location:** `SchemaPanel.tsx:43-49`
- **Fix:** Add whitelist of valid transform field names.
- **Status:** open

## Major

### RF-005 — handleFieldChange not extensible — hardcoded if/else chain
- **Source:** Architect
- **Location:** `SchemaPanel.tsx:42-57`
- **Fix:** Replace with MUTATION_MAP pattern from spec.
- **Status:** open

### RF-006 — Corner radius fields silently do nothing
- **Source:** FE, Architect
- **Location:** `SchemaPanel.tsx`, `design-schema.ts`
- **Fix:** Add kind.* handler or remove corner radius from schema until implemented.
- **Status:** open

### RF-007 — SectionDef missing list scaffold for fills/strokes
- **Source:** Architect
- **Location:** `schema/types.ts`
- **Fix:** Add type, key, itemSchema fields to SectionDef. Add color/list to FieldType.
- **Status:** open

### RF-008 — Section header double-click bug
- **Source:** A11y, FE, Architect
- **Location:** `SchemaSection.tsx:36-45`
- **Fix:** Remove onClick from div, put toggle on button only.
- **Status:** open

### RF-009 — tablist has no aria-label
- **Source:** A11y
- **Location:** `TabRegion.tsx:65`
- **Fix:** Add aria-label identifying left vs right region.
- **Status:** open

### RF-010 — No announcement on tab change
- **Source:** A11y
- **Location:** `TabRegion.tsx:43-54`
- **Fix:** Call announce() via useAnnounce on tab switch.
- **Status:** open

### RF-011 — Empty state div missing role="status"
- **Source:** A11y
- **Location:** `SchemaPanel.tsx:62-65`
- **Fix:** Add role="status" to empty state div.
- **Status:** open

### RF-012 — tabindex={0} on non-interactive wrapper divs
- **Source:** A11y
- **Location:** `App.tsx:32,39`
- **Fix:** Remove tabindex={0} from wrapper divs.
- **Status:** open

### RF-013 — Toggle aria-label reaches container, not input
- **Source:** A11y
- **Location:** `FieldRenderer.tsx:64-69`
- **Fix:** Pass aria-label to Switch.Input, not Switch root.
- **Status:** open

## Medium/Minor

### RF-014 — No Home/End key support in tabs
- **Source:** A11y
- **Location:** `TabRegion.tsx`
- **Fix:** Add Home/End handlers.
- **Status:** open

### RF-015 — corners/token-ref field types declared but unimplemented
- **Source:** FE
- **Location:** `FieldRenderer.tsx`
- **Fix:** Remove from FieldType or add placeholder Match branches.
- **Status:** open

### RF-016 — No tests for FieldRenderer, SchemaSection, registry
- **Source:** FE
- **Location:** `panels/`
- **Fix:** Add tests for field rendering, value resolution, collapse toggle.
- **Status:** open

### RF-017 — Field labels are span, not label
- **Source:** A11y
- **Location:** `SchemaSection.tsx`
- **Fix:** Defensive note; aria-label on inputs currently handles this.
- **Status:** open

### RF-018 — resolveValue missing array bounds check
- **Source:** Security
- **Location:** `SchemaSection.tsx:19-29`
- **Fix:** Add explicit array index validation.
- **Status:** open

### RF-019 — PlaceholderPanel missing role="status"
- **Source:** A11y
- **Location:** `PlaceholderPanel.tsx`
- **Fix:** Add role="status" to wrapper div.
- **Status:** open
