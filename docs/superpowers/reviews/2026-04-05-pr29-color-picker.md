# Review Findings: PR #29 — Color Picker (Plan 09b)

**Date:** 2026-04-05
**PR:** #29 — feat: color picker component — 4 color spaces, gradient editor (Plan 09b)
**Reviewers:** Architect, Security, Frontend, A11y, Compliance, Logic, UX, Data Scientist

---

## Critical

### RF-001 — ColorSpaceSwitcher lacks roving tabindex
- **Source:** A11y
- **Issue:** `role="radio"` buttons all receive Tab focus. WAI-ARIA radio pattern requires roving tabindex + Arrow key navigation.
- **Fix:** Implement roving tabindex or use Kobalte RadioGroup.
- **Status:** `resolved`

## High

### RF-002 — aria-live region updates at 60Hz during drag
- **Source:** Security, FE, A11y, Compliance, UX, Logic, Data Sci
- **Issue:** Violates CLAUDE.md §11. Floods screen reader queue during pointer drag.
- **Fix:** Gate behind committedColor signal set only on pointerup/blur/Enter.
- **Status:** `resolved`

### RF-003 — isOutOfSrgbGamut false for some out-of-gamut colors
- **Source:** Security
- **Issue:** Math.pow on negative linear values → NaN → check returns false.
- **Fix:** Guard Math.pow for negative inputs in unclamped helpers.
- **Status:** `resolved`

### RF-004 — Area gradient anchor mismatches selection math
- **Source:** Logic
- **Issue:** Background renders L=0.65 at top-right but selection produces L=1.0 (y=1).
- **Fix:** Align gradient rendering with selection math.
- **Status:** `resolved`

### RF-005 — Unvalidated stop.position in CSS gradient string
- **Source:** Security
- **Issue:** NaN/Infinity produces malformed CSS. Duplicated colorAlpha accessor.
- **Fix:** Validate position; use colorAlpha() helper.
- **Status:** `resolved`

## Major

### RF-006 — Triple srgbToOklch per frame during drag
- **Source:** Architect, Data Sci
- **Fix:** Merge into single createMemo.
- **Status:** `resolved`

### RF-007 — GradientEditor index-based stop selection
- **Source:** Architect
- **Fix:** Add stable id field; select by ID not index.
- **Status:** `deferred` — requires coordinated Rust+TS type change to GradientStop

### RF-008 — ColorValueFields positional index dispatch
- **Source:** Architect, FE
- **Fix:** Add id discriminant to FieldDef.
- **Status:** `resolved`

### RF-009 — role="dialog" missing aria-modal
- **Source:** A11y
- **Fix:** Add aria-modal="true" or remove nested dialog role.
- **Status:** `resolved`

### RF-010 — No keyboard equivalent for adding gradient stop
- **Source:** A11y
- **Fix:** Add Enter/Insert on focused bar.
- **Status:** `resolved`

### RF-011 — Selected stop indicated by color alone
- **Source:** A11y
- **Fix:** Add size/shadow change + aria-current.
- **Status:** `resolved`

### RF-012 — Single-letter aria-labels ambiguous
- **Source:** A11y
- **Fix:** Expand to descriptive labels.
- **Status:** `resolved`

### RF-013 — 9px label font size risks contrast failure
- **Source:** A11y
- **Fix:** Raise to 11px minimum.
- **Status:** `resolved`

### RF-014 — No range validation on ColorValueFields
- **Source:** Security
- **Fix:** Validate against field min/max before onChange.
- **Status:** `resolved`

### RF-015 — No MAX_STOPS limit on gradient stops
- **Source:** Security
- **Fix:** Add MAX_STOPS constant + enforcement.
- **Status:** `resolved`

### RF-016 — ColorSpaceSwitcher at bottom, far from fields
- **Source:** UX
- **Fix:** Move directly above ColorValueFields.
- **Status:** `resolved`

### RF-017 — Gradient type toggle not exclusive
- **Source:** UX
- **Fix:** Use radiogroup pattern.
- **Status:** `resolved`

## Medium

### RF-018 — Hex input accepts arbitrary Unicode
- **Source:** Security
- **Fix:** Strip non-hex chars in handleInput.
- **Status:** `resolved`

### RF-019 — Sync effect unintended reactive loop via state.hue
- **Source:** FE
- **Fix:** Use untrack(() => state.hue).
- **Status:** `resolved`

### RF-020 — Hardcoded white border in CSS
- **Source:** FE
- **Fix:** Add theme token.
- **Status:** `resolved`

### RF-021 — No GradientEditor Storybook story
- **Source:** FE
- **Fix:** Add story.
- **Status:** `resolved`

### RF-022 — No Vitest tests for UI components
- **Source:** FE
- **Fix:** Add HexInput, ColorSpaceSwitcher, GradientEditor tests.
- **Status:** `deferred` — canvas-based components require jsdom+canvas mocking; tracked for follow-up

### RF-023 — No invalid-input error feedback on HexInput
- **Source:** UX
- **Fix:** Add brief error state.
- **Status:** `resolved`

### RF-024 — Checkerboard redrawn on every color change
- **Source:** Data Sci
- **Fix:** Split into static layer + gradient overlay.
- **Status:** `resolved`

## Minor/Low

### RF-025 — Duplicate aria-label on aria-hidden canvas
- **Status:** `resolved`

### RF-026 — Duplicated OkLab matrix in unclamped helpers
- **Status:** `resolved`

### RF-027 — role="slider" on 2D widget missing aria-valuenow
- **Status:** `resolved`

### RF-028 — No live preview during hex typing
- **Status:** `deferred` — UX polish for follow-up

### RF-029 — P3 displayed as sRGB with no note
- **Status:** `deferred` — acknowledged in spec

### RF-030 — No tooltips on OkLCH/OkLab labels
- **Status:** `resolved`

### RF-031 — Strip cursor pointer vs area crosshair
- **Status:** `resolved`

### RF-032 — No visual affordance for drag-off-to-remove
- **Status:** `deferred` — UX polish for follow-up

### RF-033 — Props sync doesn't guard incoming NaN
- **Status:** `resolved`

## Info

### RF-034 — renderAreaBackground memo identity change is intentional
- **Status:** `noted` — add comment

### RF-035 — Placeholder prefers-reduced-motion blocks need guard comments
- **Status:** `noted` — add comments
