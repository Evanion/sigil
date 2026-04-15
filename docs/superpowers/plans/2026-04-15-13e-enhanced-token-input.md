# Enhanced Token Input (Spec 13e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `contentEditable` rich input component with expression syntax highlighting, token/function autocomplete, and inline error display — replacing the plain text inputs currently used for token values.

**Architecture:** A single `EnhancedTokenInput` component wraps a `contentEditable` div. On every input event, the expression string is parsed via `parseExpression()` from `expression-eval.ts` and re-rendered as colored `<span>` elements (syntax highlighting). Typing `{` triggers an autocomplete dropdown positioned below the cursor. The component is used in the token detail editor (right pane) for reference and expression value modes, and will later be used in property panel token binding (13c).

**Tech Stack:** Solid.js, CSS, existing expression parser from `expression-eval.ts`, existing Popover component for autocomplete dropdown. No new dependencies.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `frontend/src/components/token-input/EnhancedTokenInput.tsx` | `contentEditable` rich input with syntax highlighting |
| `frontend/src/components/token-input/EnhancedTokenInput.css` | Styles for input, highlighting, error display |
| `frontend/src/components/token-input/expression-highlight.ts` | Parse expression and produce highlighted span data |
| `frontend/src/components/token-input/token-autocomplete.ts` | Filter tokens/functions for autocomplete suggestions |
| `frontend/src/components/token-input/__tests__/expression-highlight.test.ts` | Tests for highlighting logic |
| `frontend/src/components/token-input/__tests__/token-autocomplete.test.ts` | Tests for autocomplete filtering |
| `frontend/src/components/token-input/__tests__/EnhancedTokenInput.test.tsx` | Component integration tests |

### Modified files

| File | Changes |
|------|---------|
| `frontend/src/panels/TokenDetailEditor.tsx` | Replace text input for alias/expression with EnhancedTokenInput |
| `frontend/src/panels/token-editor/TokenDetailPane.tsx` | Pass tokens to TokenDetailEditor for autocomplete |
| `frontend/src/i18n/locales/en/panels.json` | Add i18n keys for expression UI |
| `frontend/src/i18n/locales/es/panels.json` | Spanish translations |
| `frontend/src/i18n/locales/fr/panels.json` | French translations |

---

### Task 1: Expression highlighting utility

**Files:**
- Create: `frontend/src/components/token-input/expression-highlight.ts`
- Create: `frontend/src/components/token-input/__tests__/expression-highlight.test.ts`

Parses an expression string and produces an array of highlighted segments for rendering.

**Public API:**
```typescript
export interface HighlightSegment {
  readonly text: string;
  readonly type: "tokenRef" | "function" | "number" | "operator" | "paren" | "text" | "error";
}

export function highlightExpression(input: string): readonly HighlightSegment[];
```

**Highlighting rules:**
- `{token.name}` → type `"tokenRef"` (includes the braces)
- Function names before `(` → type `"function"`
- Numbers and percentages → type `"number"`
- `+`, `-`, `*`, `/` → type `"operator"`
- `(`, `)`, `,` → type `"paren"`
- Unparseable segments → type `"error"`
- Everything else → type `"text"`

**Implementation:** A simple character-by-character tokenizer (NOT the full expression parser — we need character positions, not an AST). Walk the string, identify token types by context, produce segments.

**Tests:**
- `test_highlight_number` — `"42"` → `[{text: "42", type: "number"}]`
- `test_highlight_token_ref` — `"{spacing.md}"` → `[{text: "{spacing.md}", type: "tokenRef"}]`
- `test_highlight_function` — `"round({a})"` → function + paren + tokenRef + paren
- `test_highlight_expression` — `"{a} + {b} * 2"` → tokenRef + operator + tokenRef + operator + number
- `test_highlight_error` — `"{"` → error segment
- `test_highlight_empty` — `""` → empty array

- [ ] Step 1: Write failing tests
- [ ] Step 2: Implement `highlightExpression`
- [ ] Step 3: Run tests, verify pass
- [ ] Step 4: Commit: `feat(frontend): add expression highlighting utility (spec-13e)`

---

### Task 2: Token autocomplete utility

**Files:**
- Create: `frontend/src/components/token-input/token-autocomplete.ts`
- Create: `frontend/src/components/token-input/__tests__/token-autocomplete.test.ts`

Filters available tokens and built-in functions for autocomplete suggestions.

**Public API:**
```typescript
export interface TokenSuggestion {
  readonly type: "token";
  readonly name: string;
  readonly tokenType: TokenType;
  readonly preview: string; // resolved value preview (e.g. "#0066FF", "16px")
}

export interface FunctionSuggestion {
  readonly type: "function";
  readonly name: string;
  readonly signature: string; // e.g. "lighten(color, amount)"
  readonly description: string;
}

export type AutocompleteSuggestion = TokenSuggestion | FunctionSuggestion;

/** Filter tokens matching a query string. */
export function filterTokenSuggestions(
  tokens: Record<string, Token>,
  query: string,
  tokenType?: TokenType,
  maxResults?: number,
): readonly TokenSuggestion[];

/** Filter built-in functions matching a query prefix. */
export function filterFunctionSuggestions(
  query: string,
  maxResults?: number,
): readonly FunctionSuggestion[];
```

The function list is the same 41 functions from the expression engine. Store them as a static array with name + signature + description.

**Tests:**
- `test_filter_tokens_by_prefix` — `"brand"` matches `"brand.primary"`, `"brand.error"`
- `test_filter_tokens_by_type` — tokenType="color" excludes dimension tokens
- `test_filter_tokens_empty_query` — returns all tokens (up to maxResults)
- `test_filter_functions_by_prefix` — `"lig"` matches `"lighten"`
- `test_filter_functions_empty` — returns all functions
- `test_max_results` — respects limit

- [ ] Step 1: Write failing tests
- [ ] Step 2: Implement filtering functions
- [ ] Step 3: Run tests, verify pass
- [ ] Step 4: Commit: `feat(frontend): add token autocomplete utility (spec-13e)`

---

### Task 3: EnhancedTokenInput component

**Files:**
- Create: `frontend/src/components/token-input/EnhancedTokenInput.tsx`
- Create: `frontend/src/components/token-input/EnhancedTokenInput.css`

The core component — a `contentEditable` div with syntax highlighting and inline error display.

**Props:**
```typescript
export interface EnhancedTokenInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly tokens: Record<string, Token>;
  readonly tokenType?: TokenType;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}
```

**Component structure:**
- `contentEditable` div with `role="textbox"`, single-line (Enter confirms, newlines blocked)
- On every `input` event: extract text content, call `highlightExpression()`, re-render as colored spans
- Below the input: error display area (parse errors from `parseExpression()`, eval errors from `evaluateExpression()`)
- Resolution trail showing intermediate evaluation steps (e.g. `{spacing.md} = 16 → 16 × 2 = 32`)
- `onKeyDown`: Enter confirms (`onChange`), Escape reverts, `stopPropagation()` for overlay mode
- Track last confirmed value via signal — Escape reverts to it

**Syntax highlighting rendering:**
Use `highlightExpression()` segments to build inner HTML. Map segment types to CSS classes:
- `.token-input__token-ref` — blue text
- `.token-input__function` — amber text
- `.token-input__number` — gold text
- `.token-input__operator` — default text
- `.token-input__paren` — muted gray
- `.token-input__error` — red with dashed underline

**Critical: cursor position preservation.** After re-rendering highlighted spans, the cursor position shifts. Save cursor offset before re-render, restore after. Use `window.getSelection()` and `Range` API.

**ARIA:**
- `role="textbox"` with `aria-label`
- `aria-invalid` when parse error
- `aria-describedby` pointing to error message element

**CSS:**
- Monospace font
- Single-line (no wrapping, overflow hidden)
- Focus ring on `:focus-visible`
- Error text in red below input
- `@media (prefers-reduced-motion: reduce)` for any transitions

- [ ] Step 1: Create component with contentEditable div, basic text input/output
- [ ] Step 2: Add syntax highlighting (parse + render colored spans)
- [ ] Step 3: Add cursor position preservation after re-render
- [ ] Step 4: Add error display (parse errors below input)
- [ ] Step 5: Add resolution trail (eval result preview)
- [ ] Step 6: Add keyboard handling (Enter/Escape/stopPropagation)
- [ ] Step 7: Create CSS file with all highlighting styles
- [ ] Step 8: Run lint
- [ ] Step 9: Commit: `feat(frontend): add EnhancedTokenInput component with syntax highlighting (spec-13e)`

---

### Task 4: Autocomplete dropdown

**Files:**
- Modify: `frontend/src/components/token-input/EnhancedTokenInput.tsx`
- Modify: `frontend/src/components/token-input/EnhancedTokenInput.css`

Add autocomplete dropdown that appears when the user types `{` or a function name prefix.

**Trigger logic:**
- When user types `{`, open autocomplete with token suggestions
- Extract the query text after `{` (e.g. `{brand.` → query = `"brand."`)
- Filter suggestions using `filterTokenSuggestions()` and `filterFunctionSuggestions()`
- Position dropdown below the cursor using the caret's bounding rect

**Dropdown rendering:**
- Absolutely positioned div below the input (not a Popover — simpler positioning needed for inline cursor tracking)
- `role="listbox"` with `role="option"` items
- Each token suggestion shows: name (left), resolved value preview (right), optional color swatch
- Each function suggestion shows: name + signature (left), description (right)
- Highlighted item tracked via signal, keyboard navigable

**Keyboard:**
- ArrowUp/ArrowDown — navigate suggestions
- Enter/Tab — insert selected suggestion (complete the token ref or function name)
- Escape — close dropdown
- Continue typing — filter suggestions

**Insertion:** When a suggestion is selected:
- Token: insert `{token.name}` at cursor position (or complete the partial `{token.na...`)
- Function: insert `funcName(` at cursor position

**ARIA:**
- `aria-autocomplete="list"` on the input when dropdown is open
- `aria-activedescendant` pointing to highlighted option
- `aria-expanded` on the input

- [ ] Step 1: Add autocomplete state (open, query, highlighted index, suggestions)
- [ ] Step 2: Detect `{` keystroke to open dropdown
- [ ] Step 3: Render dropdown with filtered suggestions
- [ ] Step 4: Add keyboard navigation (arrows, enter, escape)
- [ ] Step 5: Implement suggestion insertion (complete token ref / function)
- [ ] Step 6: Add ARIA attributes
- [ ] Step 7: Style the dropdown
- [ ] Step 8: Run lint
- [ ] Step 9: Commit: `feat(frontend): add autocomplete dropdown to EnhancedTokenInput (spec-13e)`

---

### Task 5: Wire into TokenDetailEditor

**Files:**
- Modify: `frontend/src/panels/TokenDetailEditor.tsx`
- Modify: `frontend/src/panels/token-editor/TokenDetailPane.tsx`
- Modify: `frontend/src/i18n/locales/en/panels.json`
- Modify: `frontend/src/i18n/locales/es/panels.json`
- Modify: `frontend/src/i18n/locales/fr/panels.json`

Replace the plain text input for alias and expression token values with the EnhancedTokenInput.

**Changes to TokenDetailEditor:**
- Add `tokens` prop (needed for autocomplete)
- In the `alias` case: replace `<input>` with `<EnhancedTokenInput>`, value = alias name wrapped in `{}`
- In the `expression` case: replace `<input>` with `<EnhancedTokenInput>`, value = expression string
- When EnhancedTokenInput confirms a value:
  - If it's a bare token ref `{token.name}` → store as `TokenValue.alias`
  - If it contains operators/functions → store as `TokenValue.expression`
  - If it's a plain literal → keep current literal type

**Changes to TokenDetailPane:**
- Pass `store.state.tokens` to `TokenDetailEditor` via a new `tokens` prop

**i18n keys to add:**
```json
"expressionError": "Expression error",
"expressionResolved": "Resolved: {{value}}",
"autocompleteHint": "Type { for tokens, or start typing a function name"
```

- [ ] Step 1: Add `tokens` prop to TokenDetailEditor
- [ ] Step 2: Pass tokens from TokenDetailPane
- [ ] Step 3: Replace alias input with EnhancedTokenInput
- [ ] Step 4: Replace expression input with EnhancedTokenInput
- [ ] Step 5: Handle value conversion (alias vs expression vs literal)
- [ ] Step 6: Add i18n keys
- [ ] Step 7: Run lint + build
- [ ] Step 8: Commit: `feat(frontend): wire EnhancedTokenInput into token detail editor (spec-13e)`

---

### Task 6: Tests + browser verification

**Files:**
- Create: `frontend/src/components/token-input/__tests__/EnhancedTokenInput.test.tsx`

**Tests:**
- Component renders with initial value
- Syntax highlighting produces correct spans
- Enter key confirms value via onChange
- Escape key reverts to last confirmed value
- Autocomplete opens on `{` keystroke
- Autocomplete filters as user types
- Suggestion selection inserts token reference
- Error display shows parse errors
- Keyboard stopPropagation prevents document shortcuts
- ARIA attributes are correct

**Browser verification checklist:**
1. Open token editor, select a color token
2. Switch to expression mode (or edit an alias token)
3. Type `{` — autocomplete appears with token suggestions
4. Type `spacing` — filtered to spacing tokens
5. Select a suggestion — inserts `{spacing.md}`
6. Add ` * 2` — syntax highlighted (operator + number in different colors)
7. Press Enter — value saved, resolution trail shows `32`
8. Type invalid expression `{+}` — error displayed below
9. Press Escape — reverts to last good value
10. Verify no console errors

- [ ] Step 1: Write component tests
- [ ] Step 2: Run all frontend tests
- [ ] Step 3: Run lint + build
- [ ] Step 4: Browser verification
- [ ] Step 5: Commit: `test(frontend): add EnhancedTokenInput tests (spec-13e)`

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| §4.1 Component Design (props) | Task 3 |
| §4.2 Rendering (syntax highlighting) | Tasks 1, 3 |
| §4.3 Autocomplete | Tasks 2, 4 |
| §4.4 Keyboard Behavior | Tasks 3, 4 |
| §4.5 Accessibility | Tasks 3, 4 |

### Notes
- The spec mentions a "mode toggle" (`123` / `{}` / `f(x)`) but that's a UI element in the TokenDetailEditor that already exists as a concept. The EnhancedTokenInput itself doesn't need mode awareness — it always renders as a rich text field. The mode determines which input widget is shown (color picker for literal color, number input for literal number, EnhancedTokenInput for reference/expression).
- Function autocomplete with parameter hints (§4.3) is included in Task 2's `FunctionSuggestion.signature`.
