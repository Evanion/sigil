# Accessibility Rules

These rules apply to all frontend UI work — ARIA semantics, keyboard navigation, screen reader compatibility, and motion sensitivity. They are extracted from CLAUDE.md Section 11 and carry the same enforcement weight.

---

### CSS Animations Must Respect Reduced Motion

Every CSS `transition`, `animation`, or `@keyframes` rule in component stylesheets MUST have a corresponding `@media (prefers-reduced-motion: reduce)` block that disables or shortens the animation. This applies to all frontend CSS files. Omitting this causes vestibular discomfort for users with motion sensitivity (WCAG 2.3.3). When adding a transition or animation, add the media query in the same file, in the same commit.

### Accessibility Behavior Must Be Audited During UI Rewrites

When rewriting or replacing a frontend module (framework migration, component refactor, full-page reimplementation), the implementer MUST produce an explicit a11y audit of the module being replaced before writing new code. The audit must enumerate: (1) all `aria-live` regions and their announcement triggers, (2) all focus management calls (`focus()`, `FocusScope`, trap logic), (3) all keyboard event handlers. Each item from the outgoing code must be either preserved in the new implementation or documented as intentionally removed with rationale. A rewrite that loses accessibility behavior without documentation is incomplete, regardless of visual parity.

### `aria-live` Regions Must Be Scoped to Discrete Status Changes

Never place `aria-live="polite"` or `aria-live="assertive"` on a container whose content updates more frequently than once per user action (e.g., a zoom percentage that updates on every wheel event, a cursor coordinate display). Each update to an `aria-live` region interrupts or queues a screen reader announcement — high-frequency updates flood the announcement queue and make the application unusable for screen reader users. Pattern: use a dedicated, visually-hidden `<span role="status">` element and update it only on discrete events (tool change, selection change, operation completion). For continuously-updating values, omit `aria-live` and provide the value in context only (e.g., as a label on the containing toolbar region).

### Pointer-Only Operations Must Have Keyboard Equivalents

Every operation achievable via pointer gesture (drag-and-drop reorder, drag-and-drop reparent, hover-to-reveal controls, long-press, right-click context menu) MUST have a keyboard-accessible equivalent in the same PR. This is a WCAG 2.1.1 (Keyboard) requirement, not optional polish. Common patterns:
- Drag-and-drop reorder: Alt+Arrow Up/Down to move the focused item.
- Drag-and-drop reparent: Alt+Arrow Left (outdent) / Alt+Arrow Right (indent).
- Hover-to-reveal controls: controls must be reachable via Tab or a disclosed keyboard shortcut.
- Context menu: must open on Shift+F10 or the Menu key.
If a keyboard equivalent cannot ship in the same PR due to technical constraints, file a tracking issue and document the deferral in the PR description — do not merge without acknowledgment.

### 2D Canvas Widgets Must Have Complete ARIA Slider Semantics

Any `<canvas>` element (or its wrapper) used as a 2D interactive control (color picker area, gradient map, rotation dial, hue ring) MUST implement the full WAI-ARIA slider pattern for each axis it exposes: `role="slider"`, `aria-label` naming the controlled value, `aria-valuenow` set to the current numeric value (updated on every change), `aria-valuemin` and `aria-valuemax` reflecting the axis range, and `aria-valuetext` providing a human-readable string. A canvas widget with `role="slider"` but without `aria-valuenow` is non-functional for screen readers — the role declares intent but provides no state. If a 2D widget exposes two axes, expose two complementary ARIA widgets rather than a single slider. Arrow key navigation must move the focus point in the corresponding axis.

### Text Inputs with Suggestions Must Use the Combobox Pattern

Any custom text input component that displays a dynamic suggestion list, autocomplete dropdown, or filterable option menu MUST use `role="combobox"` (not `role="textbox"` or `role="searchbox"`). The combobox role is the only WAI-ARIA role that establishes the semantic relationship between a text input and its associated listbox. Without it, `aria-autocomplete`, `aria-expanded`, `aria-controls`, and `aria-activedescendant` are either invalid or ignored by assistive technology — the user has no indication that suggestions exist or how to navigate them. Additionally, `aria-autocomplete` must be set as a static attribute (always present, value does not change based on whether suggestions are currently visible) — it declares the control's capability, not its momentary state. `aria-expanded` is the attribute that communicates whether the listbox is currently shown. Reference: WAI-ARIA Authoring Practices Guide, Combobox Pattern.
