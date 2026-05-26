# Accessibility Rules

These rules apply to all frontend UI work — ARIA semantics, keyboard navigation, screen reader compatibility, and motion sensitivity. They are extracted from CLAUDE.md Section 11 and carry the same enforcement weight.

---

### CSS Animations Must Respect Reduced Motion

Every CSS `transition`, `animation`, or `@keyframes` rule in component stylesheets MUST have a corresponding `@media (prefers-reduced-motion: reduce)` block that disables or shortens the animation. This applies to all frontend CSS files. Omitting this causes vestibular discomfort for users with motion sensitivity (WCAG 2.3.3). When adding a transition or animation, add the media query in the same file, in the same commit.

### Accessibility Behavior Must Be Audited During UI Rewrites

When rewriting or replacing a frontend module (framework migration, component refactor, full-page reimplementation), the implementer MUST produce an explicit a11y audit of the module being replaced before writing new code. The audit must enumerate: (1) all `aria-live` regions and their announcement triggers, (2) all focus management calls (`focus()`, `FocusScope`, trap logic), (3) all keyboard event handlers. Each item from the outgoing code must be either preserved in the new implementation or documented as intentionally removed with rationale. A rewrite that loses accessibility behavior without documentation is incomplete, regardless of visual parity.

### `aria-live` Regions Must Be Scoped to Discrete Status Changes

Never place `aria-live="polite"`, `aria-live="assertive"`, or `role="status"` (which implies `aria-live="polite"`) on a container in any of these situations:

1. **High-frequency updates** — the content changes more often than once per discrete user action (e.g., a zoom percentage that updates on every wheel event, a cursor coordinate display, a slider value during drag). Each update interrupts or queues a screen reader announcement; high-frequency updates flood the queue and make the application unusable for screen reader users.

2. **Transient mount** — the element mounts (or re-mounts) as part of normal UI re-rendering (e.g., a "Mixed" badge that mounts every time a popover opens; a "feature unavailable" message that re-mounts on every selection change). Each mount triggers a fresh announcement, doubling or tripling the user's listening time with no new information.

3. **State labels** — the element represents the *state* of another control, not a *status message* about an event. State belongs on the controlling element via `aria-describedby`, `aria-pressed`, `aria-current`, etc. — never as an `aria-live` region.

Correct uses of `aria-live` / `role="status"`:
- A single, persistent, document-level region whose text changes in response to discrete events (tool change, operation completion, error).
- A toast notification system where each toast announces once.
- A validation message that appears on commit (not on every keystroke).

Patterns:
- For **state labels**: use a non-live element with a stable `id`, and reference it from the controlling input via `aria-describedby`.
- For **transient-mount-but-meaningful announcements** (e.g., "X copied to clipboard"): hoist the announcement to a single, persistent panel-level or app-level `<div role="status" aria-live="polite">` whose text is replaced — not re-mounted — on each event.

For **continuously-updating values** (slider during drag, zoom percentage): omit `aria-live` entirely; provide the value via the input's own `aria-valuetext` if it's a slider/spinbutton, or via the containing toolbar's label otherwise.

Precedent: PR #54 (high-frequency StatusBar), PR #65 (transient-mount "Mixed" badge, re-mount-on-selection disabled-state span).

### Pointer-Only Operations Must Have Keyboard Equivalents

Every operation achievable via pointer gesture (drag-and-drop reorder, drag-and-drop reparent, hover-to-reveal controls, long-press, right-click context menu) MUST have a keyboard-accessible equivalent in the same PR. This is a WCAG 2.1.1 (Keyboard) requirement, not optional polish. Common patterns:
- Drag-and-drop reorder: Alt+Arrow Up/Down to move the focused item.
- Drag-and-drop reparent: Alt+Arrow Left (outdent) / Alt+Arrow Right (indent).
- Hover-to-reveal controls: controls must be reachable via Tab or a disclosed keyboard shortcut.
- Context menu: must open on Shift+F10 or the Menu key.
If a keyboard equivalent cannot ship in the same PR due to technical constraints, file a tracking issue and document the deferral in the PR description — do not merge without acknowledgment.

### 2D Canvas Widgets Must Have Complete ARIA Slider Semantics

Any `<canvas>` element (or its wrapper) used as a 2D interactive control (color picker area, gradient map, rotation dial, hue ring) MUST implement the full WAI-ARIA slider pattern for each axis it exposes: `role="slider"`, `aria-label` naming the controlled value, `aria-valuenow` set to the current numeric value (updated on every change), `aria-valuemin` and `aria-valuemax` reflecting the axis range, and `aria-valuetext` providing a human-readable string. A canvas widget with `role="slider"` but without `aria-valuenow` is non-functional for screen readers — the role declares intent but provides no state. If a 2D widget exposes two axes, expose two complementary ARIA widgets rather than a single slider. Arrow key navigation must move the focus point in the corresponding axis.

### Composite-Widget ARIA Patterns Must Be Complete

When implementing a UI affordance that maps to a documented WAI-ARIA design pattern (Disclosure, Combobox, Tabs, Tree, Toolbar, Menu), the implementation MUST satisfy every required attribute named in the WAI-ARIA Authoring Practices for that pattern. Partial implementations (the trigger has `aria-expanded` but no `aria-controls`; a custom tab has `role="tab"` but no `aria-selected`) are non-functional for screen readers — the role declares intent but the missing state attribute leaves the user unable to navigate.

For the patterns most common in this codebase:

- **Disclosure** (any expand/collapse toggle): trigger MUST have `aria-expanded` AND `aria-controls={fieldsId}`, and the controlled region MUST have a matching `id`. Generate the id with `createUniqueId()`.
- **Slider** (numeric input represented as a draggable handle or a canvas region): `role="slider"`, `aria-label`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext`. (Already covered by the 2D Canvas Widgets rule; restated here for completeness.)
- **Label association**: A visible text node ("TL", "Top-left", "Shape", "Smoothing") that visually labels an input MUST be programmatically associated with that input via one of these patterns — never both, never neither:
  1. **`for`/`id` association** (preferred when the label is a `<label>` element): give the input an `id` and the label a matching `for` attribute. Do not also set `aria-label` on the input — the visible text is the accessible name. Generate ids with `createUniqueId()`.
  2. **`aria-labelledby` association** (preferred when the label is not a `<label>` element, e.g., a `<span>` or icon): give the visible text an `id` and the input an `aria-labelledby` pointing at it. Do not also set `aria-label` on the input.
  3. **`aria-label` only** (preferred when the visible "label" is decorative or abbreviated): mark the visible text `aria-hidden="true"`, give the input an `aria-label` containing the full spoken name.

  A `<label>` sibling with no `for`, plus an `aria-label` on the input, announces only the `aria-label` — the visible text becomes orphan body text, and screen-reader users get inconsistent information from sighted users. A `<label>` with `for` AND an `aria-label` on the input is a duplicate announcement.

  **`aria-label` on non-interactive elements is invalid.** `aria-label` only applies to interactive elements (those with implicit roles like `button`, `link`, `textbox` or explicit `role=` interactive roles). Setting `aria-label` on a plain `<div>` or `<span>` with no role has no effect in screen readers and is dead markup. If a wrapper div needs identification for tests, use `data-testid`, not `aria-label`.

  Precedent: PR #65 (5 labels unassociated, `aria-label` on non-interactive div).
- **Abbreviated labels**: any visible abbreviation (2-3 letter acronym, single-glyph icon) used to label an input MUST have a full-spoken accessible name. Either add a full-text `aria-label` to the input (preferred when the abbreviation is purely visual), or wire `aria-labelledby` to a `<span class="sr-only">` containing the full text adjacent to the abbreviation.

When introducing a new affordance, name the WAI-ARIA pattern in the PR description and link to the relevant Authoring Practices section. Reviewers MUST verify every required attribute named there is present.

### `aria-hidden` Must Not Wrap Focusable Descendants

An element with `aria-hidden="true"` must not contain any focusable descendant (buttons, links, inputs, `<canvas tabindex>`, anything with `tabindex >= 0`, or any element with an interactive ARIA role). This is the documented ARIA 1.2 §5.2.7.6 anti-pattern: the focusable descendant remains in keyboard tab order but is hidden from the accessibility tree, producing an "invisible interactive element" — Tab lands on it, but screen readers receive nothing.

The fix is never to add `aria-hidden` to an ancestor of a focusable element. Instead:
- If the goal is "render but hide from assistive tech AND keyboard", apply `inert` to the ancestor (or set `tabindex="-1"` on every focusable descendant AND `aria-hidden` on each descendant individually).
- If the goal is "hide a layout-only wrapper that contains a real button", remove `aria-hidden` from the wrapper and apply it (with `tabindex="-1"`) to the specific element being hidden.
- If a Kobalte or library primitive forces an internal trigger button to exist, extend the wrapper to either suppress the internal trigger or accept an external `anchorRef`. Do not wrap with `aria-hidden` as a workaround.

**CI enforcement candidate:** A grep step is being held one PR cycle for manual enforcement before automation. When introduced, it flags `aria-hidden="true"` or `aria-hidden={true}` on a JSX element that contains a `<button`, `<a`, `<input`, `<select`, `<textarea`, or `Popover`/`Dialog`/`Select`/`Slider` Kobalte primitive within the same JSX subtree. False positives addressed by either restructuring the tree or marking with a `// a11y-ignore-aria-hidden: <rationale>` line comment.

Precedent: PR #29 (canvas wrapped in aria-hidden), PR #65 (Popover wrapper trigger wrapped in aria-hidden host).

### Popovers and Overlays Must Restore Focus to Their Activating Element

When a popover, dialog, menu, or any other transient overlay closes (by Escape, outside click, programmatic close, or selection commit), focus MUST return to the element that activated it. WCAG 2.4.3 (Focus Order) and 3.2.1 (On Focus) require predictable focus flow; an overlay that dumps focus to `<body>` strands keyboard and screen-reader users mid-task.

Two patterns satisfy this:

1. **Library-managed (preferred):** The project's `Popover` and `Dialog` wrappers handle focus restoration automatically when their own trigger button activated the overlay. No consumer code needed.

2. **Controlled mode (consumer-owned):** When a consumer uses controlled mode (e.g., `Popover`'s `anchorRef` prop, or `open={signal()}` with a custom trigger), the consumer MUST:
   - Capture the activating element on the activation event: `const [lastTrigger, setLastTrigger] = createSignal<HTMLElement | null>(null)`.
   - In the close handler (or in an effect on `open` becoming false), call `lastTrigger()?.focus()` before clearing the trigger signal.
   - The capture MUST happen at the user-event source (pointer/keyboard event handler), not in a derived effect — by the time the effect fires, `document.activeElement` may have changed.

Every controlled-mode usage must have a test that asserts focus restoration after close: open the overlay programmatically, close it (e.g., dispatch Escape on the overlay), assert `document.activeElement === <activating element>`.

Precedent: PR #57 (RF-019 — no focus return after popover dismiss), PR #65 (RF-002 — discarded activating button ref). The Popover wrapper's `anchorRef` API added in PR #65 makes controlled-mode the path of least resistance for non-trivial anchoring — without this rule, future consumers will repeat the same regression.

### Reveal-on-Hover/Focus Affordances Must Have a Resting Visual State

Any UI affordance whose primary visual reveal trigger is `:hover` or `:focus-within` on an ancestor MUST also have a discoverable resting visual — a faint outline, dot, or low-opacity glyph — visible without pointer hover or keyboard focus.

Two failure modes this rule prevents:
1. **Keyboard discoverability:** A user navigating by Tab cannot pre-locate the affordance before landing on it. A control that is `opacity: 0` at rest is invisible until tabbed onto, which violates WCAG 2.4.7 (Focus Visible) in spirit even if `:focus-visible` styles eventually reveal it.
2. **Disabled-state collapse:** When an affordance is `opacity: 0` at rest AND its disabled style is also `opacity: 0`, an `[aria-disabled="true"]` element is completely invisible even when focused — the user lands on an invisible button that does nothing.

Required pattern:
- Rest state: at least `opacity: 0.3` (or equivalent contrast >= 3:1 against background) for the affordance's outline/border.
- Hover/focus state: full opacity / accent color.
- `[aria-disabled="true"]` state: visibly disabled (dimmed, struck-through, or with a lock glyph) — NOT `opacity: 0`. Alternatively, set `tabindex="-1"` to remove disabled affordances from tab order entirely.

When the design calls for "controls only appear on hover," combine the hover reveal with a resting "scaffold" that hints at their location (e.g., a faint frame around the parent that lights up on hover, with the controls inside it). Pure invisibility at rest is not acceptable.

Precedent: PR #65 (RF-003 — hotspots invisible at rest + while disabled). Common across Figma-style editor UIs and likely to recur in future panel work.

### Text Inputs with Suggestions Must Use the Combobox Pattern

Any custom text input component that displays a dynamic suggestion list, autocomplete dropdown, or filterable option menu MUST use `role="combobox"` (not `role="textbox"` or `role="searchbox"`). The combobox role is the only WAI-ARIA role that establishes the semantic relationship between a text input and its associated listbox. Without it, `aria-autocomplete`, `aria-expanded`, `aria-controls`, and `aria-activedescendant` are either invalid or ignored by assistive technology — the user has no indication that suggestions exist or how to navigate them. Additionally, `aria-autocomplete` must be set as a static attribute (always present, value does not change based on whether suggestions are currently visible) — it declares the control's capability, not its momentary state. `aria-expanded` is the attribute that communicates whether the listbox is currently shown. Reference: WAI-ARIA Authoring Practices Guide, Combobox Pattern.

### Numeric Text Inputs Must Expose Numeric State

When a text input (including a combobox-pattern input like ValueInput) is used for a numeric field with a constrained domain (opacity 0-1, rotation 0-360, stroke width ≥ 0, font size 1-10000, line height > 0), the input MUST expose ARIA numeric state: `aria-valuemin`, `aria-valuemax`, and `aria-valuenow` updated on every change. It MUST also support arrow-key increment (ArrowUp/ArrowDown to step by 1 and Shift+ArrowUp/Down to step by 10, matching the HTML `<input type="number">` keyboard contract).

A numeric-domain text input that omits these attributes is a regression from `<input type="number">` or `role="spinbutton"` — screen reader users lose both the announced bounds and the ability to step. The `role` may remain `combobox` when token autocomplete is also offered; the numeric state attributes compose with the combobox semantics.

This obligation is scoped to components whose current value is unambiguously numeric. When the same input accepts either a literal number, a token reference, or an expression (ValueInput), expose `aria-valuemin`/`max`/`now` only while the detected mode is `"literal-number"` or `"literal-dimension"`; omit them while typing a token or expression.
