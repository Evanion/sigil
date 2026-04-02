# Review: Component Library (PR #20, Plans 07b+07c)

**Date:** 2026-04-03
**Reviewers:** Architect, Security, FE, A11y, UX, Logic, Compliance, Data Science (8 agents)
**Branch:** `feature/component-inputs`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | A11y | Popover trigger renders as `<span>` — non-focusable, keyboard-inaccessible (WCAG 2.1.1). | resolved — removed `as="span"`, Kobalte renders default button |
| RF-002 | A11y | DropdownMenu trigger renders as `<div>` — non-focusable, keyboard-inaccessible (WCAG 2.1.1). | resolved — removed `as="div"`, added button reset styles |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | FE, Arch | Hardcoded `#ffffff` in ToggleButton.css, Toggle.css. Also `rgba(0,0,0,0.5)` in Dialog.css overlay. | resolved — added `--text-on-accent` and `--overlay-bg` tokens, replaced all hardcoded values |
| RF-004 | FE, Arch | Missing `splitProps` in 5 overlay components (Popover, ContextMenu, DropdownMenu, Dialog, Menubar). | resolved — all 5 refactored to use splitProps + others spread |

### Major

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-005 | A11y | ContextMenu trigger `as="div"` — no keyboard activation path (WCAG 2.1.1). | resolved — removed `as="div"`, added proper trigger styles |
| RF-006 | Security, Logic | NumberInput passes NaN to consumer when input cleared — violates floating-point validation rule. | resolved — added `Number.isFinite()` guard + test |
| RF-007 | A11y | TextInput `aria-label` lands on root div, not the `<input>` element (WCAG 4.1.2). | resolved — aria-label forwarded to TextField.Input when no visible label |
| RF-008 | A11y | NumberInput increment/decrement buttons and input lack `:focus-visible` styles (WCAG 2.4.7). | resolved — added focus-visible rules for buttons and input |
| RF-009 | A11y | Toast missing `aria-live` / live region role for screen reader announcements (WCAG 4.1.3). | resolved — added `aria-label="Notifications"` to Toast.Region |
| RF-010 | A11y | Select `aria-label` split across root and trigger — unclear flow (WCAG 4.1.2). | resolved — aria-label in splitProps, forwarded only to trigger when no label |
| RF-011 | Arch | z-index values hardcoded across 8 CSS files — should be tokenized in theme.css. | resolved — added z-index scale tokens, updated all 9 CSS files |
| RF-012 | Arch, FE, A11y | Missing `prefers-reduced-motion` in 6 components with transitions/animations. | resolved — added media queries to all 6 component CSS files |
| RF-013 | FE | Select `state.selectedOption().label` throws when no option selected — missing null-safe access. | resolved — added optional chaining + fallback to placeholder |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-014 | Logic | Toast `showToast` has no default variant — unstyled base class only. | resolved — defaults to "info" |
| RF-015 | FE | Weak test coverage for ContextMenu, DropdownMenu, Menubar — tests only verify trigger renders. | deferred — jsdom portal limitations, adequate for MVP |
| RF-016 | FE | Toast tests don't verify toast actually renders in DOM. | deferred — jsdom portal limitations, adequate for MVP |
| RF-017 | Arch | Popover uses hardcoded `box-shadow` instead of `var(--shadow-3)`. | resolved — replaced with var(--shadow-3) |
| RF-018 | Security | Toast variant class built from string interpolation — add runtime allowlist. | resolved — added VALID_VARIANTS Set check |
| RF-019 | Arch | Menu item types duplicated across ContextMenu, DropdownMenu, Menubar. | deferred — extract shared MenuItemData in Plan 07d |
| RF-020 | FE | `console.log` in story files — should use Storybook `action()`. | resolved — replaced with fn() from storybook/test |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-021 | UX | NumberInput lacks scrub-on-drag on label — key design tool interaction. | deferred — Plan 07d or dedicated interaction plan |
| RF-022 | UX, Arch | No menu separator support in ContextMenu, DropdownMenu, Menubar. | deferred — Plan 07d with shared MenuItemData |
| RF-023 | UX | Dialog missing footer slot for action buttons. | deferred — add when building actual dialogs |
| RF-024 | UX | Toast lacks configurable duration per variant. | deferred — add when integrating toast into app shell |
| RF-025 | Arch | NumberInput aria-label handling inconsistent with other components. | resolved — removed from splitProps, flows through others |
| RF-026 | A11y | Menu item highlight contrast — surface-4 on surface-3 ~1.07:1, needs 3:1. | deferred — requires theme color adjustment |
| RF-027 | UX | NumberInput stepper buttons always visible — Figma hides on hover. | deferred — CSS-only change, do when building property panel |
| RF-028 | Arch | No barrel export `components/index.ts`. | deferred — follow-up PR |
