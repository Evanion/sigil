# Governance Proposal: Native Popover/Dialog Convention + Kobalte Rule Updates

**Date:** 2026-04-14
**Trigger:** Spec 13b architectural decision — replaced Kobalte Popover and Dialog with native HTML equivalents
**Type:** Convention update (CLAUDE.md Section 5, FE agent prompt, frontend-defensive rules)
**Status:** PROPOSED — awaiting human review

---

## Pattern Identified

During Spec 13b, the team discovered that Kobalte's modal Dialog implementation sets `body.style.pointerEvents = "none"` to create a modal overlay. Any portaled content (like a Popover opened inside a Dialog) that is not registered in Kobalte's internal `DismissableLayer` stack becomes unclickable. Solid's `<Portal>` breaks the Kobalte context chain, so portaled Popovers cannot register themselves as nested layers.

Multiple workarounds were attempted (`preventDismissOnInteract`, custom `onPointerDownOutside` handlers) before the root cause was identified as architectural: Kobalte's layer management is JavaScript-based and requires all participating components to share the same context tree.

The fix was to replace both Popover and Dialog with native HTML equivalents that use the browser's built-in top-layer mechanism, which does not suffer from context chain or pointer-events conflicts.

This is a systemic pattern, not a one-off. Any future feature that nests an overlay inside a modal (e.g., a color picker popover inside a settings dialog, a dropdown inside a confirmation dialog) will hit the same conflict if Kobalte's Popover or Dialog is reintroduced.

---

## Current State of Kobalte Usage

Kobalte is NOT being removed from the project. It remains the correct choice for 13 component categories that do not involve overlay stacking:

- Button, IconButton, ToggleButton
- NumberField, TextField
- Select, DropdownMenu, ContextMenu, Menubar
- Tooltip, Toast
- Switch (Toggle), Separator (Divider)

Only Popover and Dialog have been replaced with native implementations. The existing Kobalte trigger rule in CLAUDE.md Section 5 remains relevant for these 13 component types.

---

## Proposed Changes

### 1. CLAUDE.md Section 5 (TypeScript) — ADD new rule

Add after the existing Kobalte trigger rule (line 192):

```
- Use native HTML `popover` attribute and `<dialog>` element instead of Kobalte (or any library)
  Popover and Dialog components. Kobalte's Dialog sets `body.style.pointerEvents = "none"` for
  modal overlay, which breaks any portaled content not registered in its internal DismissableLayer
  stack. Solid's `<Portal>` breaks the Kobalte context chain, making nested overlays (popover
  inside dialog) unclickable. The native implementations avoid this:
  - Popover: `popover="auto"` for light dismiss, `popover="manual"` for programmatic control.
    Use CSS Anchor Positioning (`anchor-name`, `position-anchor`, `position-area`,
    `position-try-fallbacks`) for viewport-aware placement — do not introduce JS-based
    positioning libraries (Floating UI, Popper, etc.).
  - Dialog: `<dialog>` with `showModal()` for browser-native focus trap, Escape handling,
    `::backdrop`, and top-layer rendering.
  - Both use the browser's top-layer mechanism, which handles stacking correctly without
    JavaScript layer management.
  The project's native implementations are at `frontend/src/components/popover/Popover.tsx` and
  `frontend/src/components/dialog/Dialog.tsx`. Use these — do not create alternatives.
```

**Rationale:** Prevents reintroduction of the exact pattern that caused the Spec 13b regression. The rule explains WHY (pointer-events conflict, portal context chain break) so implementers understand the constraint rather than treating it as arbitrary preference.

### 2. CLAUDE.md Section 5 (TypeScript) — MODIFY existing Kobalte trigger rule

Current text (line 192):
```
- Never override Kobalte trigger or interactive primitives with non-interactive elements
  (`as="span"`, `as="div"`, `as="p"`). Kobalte renders triggers as `<button>` by default,
  which provides keyboard focus, Enter/Space activation, and ARIA semantics. Overriding with
  a non-interactive element removes all of these. If you need custom styling, use CSS on the
  default element or use `as="button"` explicitly.
```

Proposed updated text:
```
- Never override Kobalte trigger or interactive primitives with non-interactive elements
  (`as="span"`, `as="div"`, `as="p"`). Kobalte renders triggers as `<button>` by default,
  which provides keyboard focus, Enter/Space activation, and ARIA semantics. Overriding with
  a non-interactive element removes all of these. If you need custom styling, use CSS on the
  default element or use `as="button"` explicitly. Note: this rule applies to the Kobalte
  components still in use (Button, Select, DropdownMenu, ContextMenu, Menubar, NumberField,
  TextField, Toggle, Toast, Tooltip, Separator). Popover and Dialog do not use Kobalte — see
  the native popover/dialog rule above.
```

**Rationale:** The existing rule is still valid for 13 Kobalte component types. Adding a scoping note prevents confusion — without it, someone reading the Kobalte rule might assume Kobalte Popover and Dialog are still in use and try to apply the `as=` guidance to the native implementations (which do not have an `as` prop).

### 3. CLAUDE.md Section 11 (Floating-Point Validation) — MODIFY Kobalte reference

Current text (line 338) includes:
```
...e.g., Kobalte NumberInput `onChange`...
```

No change needed. This reference is still accurate — Kobalte NumberField is still in use for numeric inputs.

### 4. FE Agent Prompt (`.claude/agents/fe.md`) — MODIFY two sections

**4a. Tech Stack table (line 17):**

Current:
```
| Headless components | Kobalte (`@kobalte/core`) — accessible primitives |
```

Proposed:
```
| Headless components | Kobalte (`@kobalte/core`) — accessible primitives (NOT for Popover/Dialog — use native HTML) |
```

**4b. Solid.js Conventions (line 69):**

Current:
```
- Wrap Kobalte primitives for all interactive components (Button, Tooltip, Popover, Select, etc.)
```

Proposed:
```
- Wrap Kobalte primitives for interactive components (Button, Tooltip, Select, DropdownMenu, etc.) — except Popover and Dialog, which use native HTML implementations (see CLAUDE.md Section 5)
```

**4c. Accessibility Baseline (line 112):**

Current:
```
- Kobalte primitives provide WAI-ARIA compliance — use them for all interactive components
```

Proposed:
```
- Kobalte primitives provide WAI-ARIA compliance — use them for interactive components except Popover and Dialog (which use native HTML with equivalent a11y)
```

**Rationale:** The FE agent prompt currently directs implementers to "wrap Kobalte primitives for all interactive components" including Popover. Without this update, the agent prompt contradicts the CLAUDE.md rule, and an implementation agent following the FE prompt would reintroduce Kobalte Popover.

### 5. No changes to `.claude/rules/frontend-defensive.md` or `.claude/rules/a11y-rules.md`

These files do not reference Kobalte Popover or Dialog. No updates needed.

### 6. No CI rule proposed

This convention is best enforced by agent prompt + CLAUDE.md rule rather than a linter. A lint rule banning `@kobalte/core/popover` and `@kobalte/core/dialog` imports could be added to ESLint, but the surface area is small (two components) and the CLAUDE.md rule with rationale is sufficient. If a second violation occurs, escalate to a lint rule.

---

## Changes NOT Proposed (with rationale)

### Removing Kobalte entirely
Kobalte remains the correct choice for 13 component types. A blanket "no Kobalte" rule would be wrong — the issue is specific to overlay stacking, not to Kobalte's component model in general.

### Requiring native HTML for all future overlay components
CSS Anchor Positioning and `popover` are well-supported in modern browsers, but the project should evaluate on a case-by-case basis. The rule is scoped to Popover and Dialog because those are the components where the conflict was proven. If a future overlay component (e.g., a custom dropdown with nested popovers) hits the same issue, the rule can be extended.

### Adding a browser support matrix for CSS Anchor Positioning
CSS Anchor Positioning is a Baseline 2025 feature. The project targets modern evergreen browsers. If browser support becomes a concern, the Popover component can add a JS fallback for positioning, but the `popover` attribute itself is supported in all target browsers.

---

## Changelog Entry (for PR description)

| Rule | Action | Why |
|---|---|---|
| CLAUDE.md Section 5: Native HTML popover/dialog | ADD | Kobalte Dialog's `body.style.pointerEvents = "none"` breaks portaled content inside modals. Native `popover` + `<dialog>` use browser top-layer without conflicts. |
| CLAUDE.md Section 5: Kobalte trigger rule | MODIFY | Add scoping note — rule applies to the 13 Kobalte components still in use, not Popover/Dialog. |
| `.claude/agents/fe.md`: Tech stack, conventions, a11y | MODIFY (3 sites) | FE agent prompt listed Popover in Kobalte scope, contradicting the new CLAUDE.md rule. |
