# Governance Review: Enhanced Token Input (Spec 13e)

**Date:** 2026-04-15
**Reviewer:** Governance Agent
**Input:** `docs/superpowers/reviews/2026-04-15-enhanced-token-input-review.md` (30 findings, 29 resolved, 1 deferred)

---

## Pattern Analysis

### Pattern 1: ARIA Combobox Misuse on Custom Rich Inputs (SYSTEMIC -- NEW RULE PROPOSED)

**Findings:** RF-001 (Critical), RF-009 (Major)

**What happened:** The EnhancedTokenInput used `role="textbox"` on a contentEditable element that has an associated autocomplete listbox. The `aria-autocomplete`, `aria-expanded`, and `aria-controls` attributes are only valid on elements with `role="combobox"` (or native `<input>` with associated datalist). Using them on `role="textbox"` means screen readers ignore the autocomplete relationship entirely -- the user does not know suggestions are available. Additionally, `aria-autocomplete` was conditionally set based on whether suggestions were visible, when it should be a static attribute declaring the control's capability.

**Why this is systemic:** This project is building a design tool editor with multiple custom input components that combine text editing with suggestion/completion behavior: token expression inputs, search-with-filter bars, CSS property value inputs, asset search, and potentially formula inputs. Every one of these will face the same ARIA role selection question. The WAI-ARIA combobox pattern is non-obvious -- developers naturally reach for `role="textbox"` when building something that looks like a text input, not realizing that the combobox role is required for the autocomplete relationship to be communicated to assistive technology.

**Proposed rule (`.claude/rules/a11y-rules.md`):**

> ### Text Inputs with Suggestions Must Use the Combobox Pattern
>
> Any custom text input component that displays a dynamic suggestion list, autocomplete dropdown, or filterable option menu MUST use `role="combobox"` (not `role="textbox"` or `role="searchbox"`). The combobox role is the only WAI-ARIA role that establishes the semantic relationship between a text input and its associated listbox. Without it, `aria-autocomplete`, `aria-expanded`, `aria-controls`, and `aria-activedescendant` are either invalid or ignored by assistive technology -- the user has no indication that suggestions exist or how to navigate them. Additionally, `aria-autocomplete` must be set as a static attribute (always present, value does not change based on whether suggestions are currently visible) -- it declares the control's capability, not its momentary state. `aria-expanded` is the attribute that communicates whether the listbox is currently shown. Reference: WAI-ARIA Authoring Practices Guide, Combobox Pattern.

**Agent prompt update (A11y):** Add to Responsibilities:

> - Custom text inputs with suggestions/autocomplete -- verify the component uses `role="combobox"` (not `role="textbox"`), with `aria-autocomplete` as a static attribute. `role="textbox"` with autocomplete ARIA attributes is a Critical finding (WCAG 4.1.2 Name, Role, Value).

---

### Pattern 2: Constant Enforcement Gaps at Component Boundaries (SYSTEMIC -- EXISTING RULE SUFFICIENT, AGENT UPDATE PROPOSED)

**Findings:** RF-002 (High), RF-003 (High)

**What happened:** `MAX_EXPRESSION_LENGTH` was defined and enforced in the expression parser, but neither the syntax highlighter nor the paste handler in the EnhancedTokenInput component checked the length before processing. The constant existed but enforcement was incomplete at the component boundary -- the component accepted arbitrarily long input and passed it to the parser, which rejected it. This means the user typed or pasted content, saw it in the input, and only learned it was too long when evaluation failed.

**Why this is systemic:** The existing "Constants Must Be Enforced" rule already says "Add the enforcement check at every relevant boundary (constructor, deserialization, insertion)." The problem is that frontend component inputs are a boundary that implementers miss. The parser enforces the limit, but the component that feeds the parser does not pre-validate. This is the same gap that "Validation Must Be Symmetric Across All Transports" addresses for API boundaries, but component-level inputs are not transports -- they are UI boundaries.

**Assessment:** The existing rule is broad enough to cover this case ("every relevant boundary"). Adding a separate rule would be redundant. However, the FE agent prompt does not call out "validate constants at the component input boundary before passing to processing functions" as an explicit check. An agent prompt update is warranted.

**Agent prompt update (FE):** Add to Standards section:

> ### Constant Enforcement at Component Boundaries
> When a component accepts user input (text, paste, drag) that will be processed by a function with validation constants (MAX_LENGTH, MAX_DEPTH, etc.), the component MUST enforce those constants at the input boundary before passing data to the processing function. Do not rely on the processing function to reject invalid input after the user has already seen it in the UI -- this creates a confusing experience where content appears accepted and then silently fails. For text inputs: validate on every input event and on paste. For drag targets: validate on drop.

---

### Pattern 3: ContentEditable Value Commit Lifecycle (ONE-OFF -- MONITOR)

**Findings:** RF-006 (High), RF-007 (High), RF-008 (Major)

**What happened:** Three separate bugs around when the EnhancedTokenInput committed its "confirmed value" -- the value that Escape reverts to, that blur commits, and that programmatic suggestions update:
1. `insertSuggestion()` updated the DOM text but did not update the `confirmedValue` signal or fire `onChange`.
2. `handleBlur()` did not commit the current text as the new confirmed value before firing `onBlur`.
3. External prop changes (`props.value`) overwrote the escape-revert target without the user confirming.

All three stem from unclear ownership of the "confirmed value" -- the signal that represents what the user has intentionally accepted, as distinct from what is currently in the input mid-edit.

**Why this is likely one-off:** This is specific to the contentEditable rich-input pattern, which is unusual in this codebase. Most inputs use Kobalte NumberField or native `<input>`, which handle the confirm/revert lifecycle natively. The EnhancedTokenInput is the first (and likely only) contentEditable component. If a second contentEditable component appears, this should be promoted to a rule.

**Assessment: Monitor, do not add a rule yet.** The fixes are in place. If a second contentEditable component is introduced (e.g., a CSS value editor, a formula bar), revisit and consider a rule like "ContentEditable components must define an explicit 'confirmed value' state machine with transitions for: user commit (Enter/blur), programmatic insertion (autocomplete selection), external prop sync, and user cancel (Escape)."

---

### Pattern 4: Duplicate Function Registries (ONE-OFF -- ALREADY COVERED)

**Finding:** RF-016 (Major)

**What happened:** The autocomplete utility maintained a separate hardcoded list of available functions, duplicating the metadata already present in the expression evaluator. Fixed by exporting metadata from the evaluator.

**Assessment:** This is covered by the existing rules: Rust's "Define all validation artifacts in validate.rs" and TypeScript's "Business Logic Must Not Live in Inline JSX Handlers" (which prohibits duplication across components). The FE agent already has guidance about extracting shared logic. One-off miss during implementation. No rule change needed.

---

### Pattern 5: Deprecated DOM APIs (ONE-OFF)

**Finding:** RF-020 (Medium)

**What happened:** Used `document.execCommand('insertText')` for cursor-preserving text insertion in contentEditable, which is deprecated.

**Assessment:** One-off, specific to the contentEditable pattern. The fix used direct DOM manipulation (Range/Selection API). No rule needed -- deprecated API usage is standard linting territory, and ESLint can catch this if configured.

---

### Pattern 6: Performance -- Redundant Computation per Keystroke (ONE-OFF)

**Finding:** RF-011 (Major)

**What happened:** Cursor offset was computed twice per keystroke -- once in the input handler and once in the highlight render. Fixed by caching.

**Assessment:** One-off optimization. The existing performance requirements ("design for performance from the start") cover this adequately. No rule needed.

---

## Deferred Findings

### RF-030: Function Category Grouping in Autocomplete

**Severity:** Minor (UX enhancement)
**Description:** Group autocomplete suggestions by function category (math, color, size, etc.) for better discoverability.
**Assessment:** This is a UX enhancement, not a correctness or safety issue. Should be tracked in the project backlog but does not need governance tracking.

---

## Existing Rules Audit

### Rules Validated by This Review

The following existing rules were directly exercised by findings in this review and confirmed to be correctly specified:

- **"Constants Must Be Enforced"** (caught RF-002, RF-003 -- the rule text was sufficient, enforcement was missed at a component boundary)
- **"Floating-Point Validation"** (caught RF-004 -- NaN guards on color channel formatting)
- **"Overlay-Mode Keyboard Handlers Must Use stopPropagation"** (relevant to the EnhancedTokenInput's keyboard handling; no finding because it was implemented correctly)
- **"Business Logic Must Not Live in Inline JSX Handlers"** (caught RF-016 indirectly -- duplicate function registry is a form of logic duplication)

### Rules That Should Have Prevented Findings

- **"Constants Must Be Enforced"** should have prevented RF-002/RF-003. The rule says "at every relevant boundary" but the implementer did not treat the component's input handler as a boundary. The agent prompt update (Pattern 2 above) addresses the detection gap.

### No Rules to Remove

All existing rules remain relevant and correctly scoped. No rules have become obsolete.

---

## Agent Prompt Updates

### A11y Agent (`a11y.md`)

Add to Responsibilities section:

> - Custom text inputs with suggestions/autocomplete -- verify the component uses `role="combobox"` (not `role="textbox"`), with `aria-autocomplete` as a static attribute. `role="textbox"` with autocomplete ARIA attributes is a Critical finding (WCAG 4.1.2 Name, Role, Value).

### FE Agent (`fe.md`)

Add to Standards section:

> ### Constant Enforcement at Component Boundaries
> When a component accepts user input (text, paste, drag) that will be processed by a function with validation constants (MAX_LENGTH, MAX_DEPTH, etc.), the component MUST enforce those constants at the input boundary before passing data to the processing function. Do not rely on the processing function to reject invalid input after the user has already seen it in the UI -- this creates a confusing experience where content appears accepted and then silently fails. For text inputs: validate on every input event and on paste. For drag targets: validate on drop.

---

## CI Check Proposals

None. The proposed rule (combobox pattern) is not mechanically enforceable via CI -- it requires semantic understanding of the component's purpose. The constant enforcement gap is also not CI-automatable beyond what ESLint already checks.

---

## Summary of Proposed Changes

| Change | Target | Rationale | Priority |
|---|---|---|---|
| New rule: "Text Inputs with Suggestions Must Use the Combobox Pattern" | `.claude/rules/a11y-rules.md` | 2 findings (1 Critical, 1 Major) from ARIA combobox misuse | High |
| New A11y agent check: combobox pattern verification | `.claude/agents/a11y.md` | A11y agent should catch wrong roles on autocomplete inputs | High |
| New FE agent guidance: constant enforcement at component boundaries | `.claude/agents/fe.md` | FE agent should catch missing constant checks at input boundaries | Medium |

## Decision Record

- **Pattern 1 (ARIA combobox):** New rule proposed. Two findings in one PR, and the project roadmap includes multiple components that will face the same pattern (search bars, CSS value inputs). This is systemic enough to warrant a rule now.
- **Pattern 2 (constant enforcement gaps):** Existing rule is sufficient. Agent prompt update proposed to improve detection.
- **Pattern 3 (contentEditable value commit lifecycle):** Monitor. One-off pattern specific to the only contentEditable component. Will revisit if a second instance appears.
- **Pattern 4 (duplicate registries):** Existing rules cover this. No action.
- **Pattern 5 (deprecated DOM APIs):** One-off. No action.
- **Pattern 6 (redundant computation):** One-off. No action.
- **No rules removed:** All existing rules remain relevant.
