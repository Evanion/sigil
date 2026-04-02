# Review: Component Library (PR #20, Plans 07b+07c)

**Date:** 2026-04-03
**Reviewers:** Architect, Security, FE, A11y, UX, Logic, Compliance, Data Science (8 agents)
**Branch:** `feature/component-inputs`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | A11y | Popover trigger renders as `<span>` — non-focusable, keyboard-inaccessible (WCAG 2.1.1). | open |
| RF-002 | A11y | DropdownMenu trigger renders as `<div>` — non-focusable, keyboard-inaccessible (WCAG 2.1.1). | open |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | FE, Arch | Hardcoded `#ffffff` in ToggleButton.css, Toggle.css. Also `rgba(0,0,0,0.5)` in Dialog.css overlay. | open |
| RF-004 | FE, Arch | Missing `splitProps` in 5 overlay components (Popover, ContextMenu, DropdownMenu, Dialog, Menubar). | open |

### Major

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-005 | A11y | ContextMenu trigger `as="div"` — no keyboard activation path (WCAG 2.1.1). | open |
| RF-006 | Security, Logic | NumberInput passes NaN to consumer when input cleared — violates floating-point validation rule. | open |
| RF-007 | A11y | TextInput `aria-label` lands on root div, not the `<input>` element (WCAG 4.1.2). | open |
| RF-008 | A11y | NumberInput increment/decrement buttons and input lack `:focus-visible` styles (WCAG 2.4.7). | open |
| RF-009 | A11y | Toast missing `aria-live` / live region role for screen reader announcements (WCAG 4.1.3). | open |
| RF-010 | A11y | Select `aria-label` split across root and trigger — unclear flow (WCAG 4.1.2). | open |
| RF-011 | Arch | z-index values hardcoded across 8 CSS files — should be tokenized in theme.css. | open |
| RF-012 | Arch, FE, A11y | Missing `prefers-reduced-motion` in 6 components with transitions/animations. | open |
| RF-013 | FE | Select `state.selectedOption().label` throws when no option selected — missing null-safe access. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-014 | Logic | Toast `showToast` has no default variant — unstyled base class only. | open |
| RF-015 | FE | Weak test coverage for ContextMenu, DropdownMenu, Menubar — tests only verify trigger renders. | open |
| RF-016 | FE | Toast tests don't verify toast actually renders in DOM. | open |
| RF-017 | Arch | Popover uses hardcoded `box-shadow` instead of `var(--shadow-3)`. | open |
| RF-018 | Security | Toast variant class built from string interpolation — add runtime allowlist. | open |
| RF-019 | Arch | Menu item types duplicated across ContextMenu, DropdownMenu, Menubar. | open |
| RF-020 | FE | `console.log` in story files — should use Storybook `action()`. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-021 | UX | NumberInput lacks scrub-on-drag on label — key design tool interaction. | open |
| RF-022 | UX, Arch | No menu separator support in ContextMenu, DropdownMenu, Menubar. | open |
| RF-023 | UX | Dialog missing footer slot for action buttons. | open |
| RF-024 | UX | Toast lacks configurable duration per variant. | open |
| RF-025 | Arch | NumberInput aria-label handling inconsistent with other components. | open |
| RF-026 | A11y | Menu item highlight contrast — surface-4 on surface-3 ~1.07:1, needs 3:1. | open |
| RF-027 | UX | NumberInput stepper buttons always visible — Figma hides on hover. | open |
| RF-028 | Arch | No barrel export `components/index.ts`. | open |
