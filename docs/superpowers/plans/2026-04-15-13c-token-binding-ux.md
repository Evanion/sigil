# Token Binding UX (Spec 13c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename EnhancedTokenInput to ValueInput, extend it with auto-detect mode, color swatch prefix, font autocomplete, and hex/dimension parsing, then replace all property panel controls (ColorSwatch, NumberInput) with ValueInput for universal token binding.

**Architecture:** The existing `EnhancedTokenInput` moves to `components/value-input/ValueInput.tsx` with new capabilities: auto-detect mode from content (no mode toggle), color swatch prefix for color fields, font autocomplete via pluggable `FontProvider`, hex color parsing, and dimension unit awareness. Panel components (FillRow, StrokeRow, TypographySection, EffectCard, AppearancePanel) replace their specialized controls with ValueInput. A new `StyleValue` variant `expression` is added for expressions in style fields. Helper functions `formatStyleValue()` and `parseValueInput()` bridge between `StyleValue<T>` and the string format ValueInput uses.

**Tech Stack:** Solid.js, CSS, existing expression parser/evaluator, existing ColorPicker popover. No new dependencies.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `frontend/src/components/value-input/ValueInput.tsx` | Universal value input (renamed from EnhancedTokenInput) |
| `frontend/src/components/value-input/ValueInput.css` | Styles (including swatch prefix) |
| `frontend/src/components/value-input/ValueInput.stories.tsx` | Storybook stories for all modes |
| `frontend/src/components/value-input/value-detect.ts` | Auto-detect mode from input content |
| `frontend/src/components/value-input/color-parse.ts` | Hex color parsing (#RGB, #RRGGBB, #RRGGBBAA) |
| `frontend/src/components/value-input/font-provider.ts` | FontProvider interface + SystemFontProvider |
| `frontend/src/components/value-input/style-value-format.ts` | formatStyleValue / parseValueInput helpers |
| `frontend/src/components/value-input/__tests__/value-detect.test.ts` | Mode detection tests |
| `frontend/src/components/value-input/__tests__/color-parse.test.ts` | Hex parsing tests |
| `frontend/src/components/value-input/__tests__/font-provider.test.ts` | Font provider tests |
| `frontend/src/components/value-input/__tests__/style-value-format.test.ts` | Format/parse helper tests |

### Moved files (from token-input/ to value-input/)

| From | To |
|------|---|
| `components/token-input/expression-highlight.ts` | `components/value-input/expression-highlight.ts` |
| `components/token-input/token-autocomplete.ts` | `components/value-input/token-autocomplete.ts` |
| `components/token-input/input-helpers.ts` | `components/value-input/input-helpers.ts` |
| `components/token-input/__tests__/*` | `components/value-input/__tests__/*` |

### Modified files

| File | Changes |
|------|---------|
| `frontend/src/types/document.ts` | Add `StyleValueExpression` variant to `StyleValue<T>` |
| `frontend/src/panels/FillRow.tsx` | Replace ColorSwatch with ValueInput for solid fill color |
| `frontend/src/panels/StrokeRow.tsx` | Replace ColorSwatch + NumberInput with ValueInput |
| `frontend/src/panels/TypographySection.tsx` | Replace font family input, font size, line height, letter spacing, text color with ValueInput |
| `frontend/src/panels/EffectCard.tsx` | Replace color + number inputs with ValueInput |
| `frontend/src/panels/AppearancePanel.tsx` | Replace opacity NumberInput with ValueInput |
| `frontend/src/panels/TokenDetailEditor.tsx` | Use ValueInput for all value types |
| `frontend/src/canvas/renderer.ts` | Handle `expression` StyleValue variant in rendering |
| `frontend/src/store/document-store-solid.tsx` | Accept expression StyleValue in mutations |
| `frontend/src/operations/apply-remote.ts` | Handle expression StyleValue in remote ops |

### Deleted files

| File | Reason |
|------|--------|
| `frontend/src/components/token-input/EnhancedTokenInput.tsx` | Moved to value-input/ValueInput.tsx |
| `frontend/src/components/token-input/EnhancedTokenInput.css` | Moved |
| `frontend/src/components/token-input/EnhancedTokenInput.stories.tsx` | Replaced |

---

### Task 1: Utility modules (value-detect, color-parse, font-provider, style-value-format)

**Files:**
- Create: `frontend/src/components/value-input/value-detect.ts`
- Create: `frontend/src/components/value-input/color-parse.ts`
- Create: `frontend/src/components/value-input/font-provider.ts`
- Create: `frontend/src/components/value-input/style-value-format.ts`
- Create: `frontend/src/components/value-input/__tests__/value-detect.test.ts`
- Create: `frontend/src/components/value-input/__tests__/color-parse.test.ts`
- Create: `frontend/src/components/value-input/__tests__/font-provider.test.ts`
- Create: `frontend/src/components/value-input/__tests__/style-value-format.test.ts`

**value-detect.ts** — Auto-detect mode from input content:
```typescript
export type DetectedMode = "literal-color" | "literal-number" | "literal-font" | "reference" | "expression" | "unknown";

export function detectValueMode(input: string, acceptedTypes: readonly ValueType[]): DetectedMode;
```
Rules: `#` → color, `{` without operators → reference, `{` with operators → expression, digits → number, letters in font context → font.

**color-parse.ts** — Parse hex colors:
```typescript
export function parseHexColor(hex: string): Color | null;
export function colorToHex(color: Color): string;
```
Handle `#RGB`, `#RRGGBB`, `#RRGGBBAA`. Return null for invalid. Guard NaN.

**font-provider.ts** — Font provider interface:
```typescript
export interface FontInfo { readonly name: string; readonly source: "system" | "workspace" | "plugin"; }
export interface FontProvider { listFonts(): readonly FontInfo[]; }
export class SystemFontProvider implements FontProvider { ... }
export const GENERIC_FAMILIES: readonly FontInfo[];
```
SystemFontProvider returns ~40 common system fonts + generic families.

**style-value-format.ts** — Bridge between StyleValue<T> and string:
```typescript
export function formatStyleValue<T>(sv: StyleValue<T>, formatter: (v: T) => string): string;
export function parseColorInput(raw: string): StyleValue<Color> | null;
export function parseNumberInput(raw: string): StyleValue<number> | null;
```
`formatStyleValue`: literal → formatted string, token_ref → `{name}`, expression → raw expr string.
`parseColorInput`: `#hex` → literal, `{name}` → token_ref, expression → expression variant.
`parseNumberInput`: digits → literal, `{name}` → token_ref, expression → expression variant.

**Tests:** Each utility with happy path, edge cases, invalid input.

- [ ] Step 1: Write tests for all 4 utilities
- [ ] Step 2: Implement value-detect
- [ ] Step 3: Implement color-parse
- [ ] Step 4: Implement font-provider
- [ ] Step 5: Implement style-value-format
- [ ] Step 6: Run tests, verify pass
- [ ] Step 7: Commit: `feat(frontend): add value-detect, color-parse, font-provider, style-value-format utilities (spec-13c)`

---

### Task 2: Add expression variant to StyleValue + move token-input → value-input

**Files:**
- Modify: `frontend/src/types/document.ts` — add `StyleValueExpression`
- Move: `frontend/src/components/token-input/*` → `frontend/src/components/value-input/*`
- Modify: all files importing from `token-input/`

Add to `StyleValue<T>`:
```typescript
export interface StyleValueExpression {
  readonly type: "expression";
  readonly expr: string;
}

export type StyleValue<T> = StyleValueLiteral<T> | StyleValueTokenRef | StyleValueExpression;
```

Move the `token-input/` directory to `value-input/`. Update all import paths. Rename `EnhancedTokenInput` to `ValueInput` in the component file and all consumers. This is a pure rename/move — no behavioral changes.

Update `canvas/renderer.ts` to handle the `expression` variant in `resolveStyleValueColor/Number` — evaluate the expression string using `resolveExpression()` from `expression-eval.ts`.

- [ ] Step 1: Add StyleValueExpression to types/document.ts
- [ ] Step 2: Move token-input/ directory to value-input/
- [ ] Step 3: Rename EnhancedTokenInput → ValueInput in all files
- [ ] Step 4: Update all import paths (search for `token-input/`)
- [ ] Step 5: Update renderer to handle expression StyleValue
- [ ] Step 6: Run all tests — must pass unchanged
- [ ] Step 7: Commit: `refactor(frontend): rename EnhancedTokenInput → ValueInput, add expression StyleValue variant (spec-13c)`

---

### Task 3: Extend ValueInput with acceptedTypes, color swatch prefix, hex parsing

**Files:**
- Modify: `frontend/src/components/value-input/ValueInput.tsx`
- Modify: `frontend/src/components/value-input/ValueInput.css`

**New props:**
```typescript
readonly acceptedTypes: readonly ValueType[];
readonly fontProvider?: FontProvider;
```

**Color swatch prefix:** When `acceptedTypes` includes `"color"` and the resolved value is a color, render a 28x28px swatch div inside the input as a left prefix. Clicking the swatch opens the existing ColorPicker popover (import from `../color-picker/ColorPicker`). The swatch shows the resolved color for literals, token refs, and expressions.

**Auto-detect integration:** Use `detectValueMode()` from `value-detect.ts` to determine border color:
- Default border → literal
- Blue tint → token reference
- Purple tint → expression

**Hex input:** When user types `#` in a color-accepting field, parse as hex via `parseHexColor()`. Show the resolved color in the swatch prefix.

**Type validation:** If the resolved expression produces a value incompatible with `acceptedTypes`, show an info/error message (using the focus-aware severity from 13e).

- [ ] Step 1: Add acceptedTypes and fontProvider props
- [ ] Step 2: Add color swatch prefix rendering with conditional Show
- [ ] Step 3: Wire swatch click to open ColorPicker popover
- [ ] Step 4: Add auto-detect border coloring
- [ ] Step 5: Add hex literal parsing for color fields
- [ ] Step 6: Add type validation against acceptedTypes
- [ ] Step 7: Update CSS (swatch prefix, border colors)
- [ ] Step 8: Run lint + build
- [ ] Step 9: Commit: `feat(frontend): extend ValueInput with color swatch, hex parsing, type awareness (spec-13c)`

---

### Task 4: Add font autocomplete to ValueInput

**Files:**
- Modify: `frontend/src/components/value-input/ValueInput.tsx`
- Modify: `frontend/src/components/value-input/token-autocomplete.ts`

When `acceptedTypes` includes `"font_family"` and `fontProvider` is provided:

**Font autocomplete trigger:** In literal mode (no `{` prefix), typing triggers font name suggestions instead of function suggestions. Each suggestion renders its name **in its own font face** using inline `style={{ "font-family": fontName }}`.

**Comma-aware:** After a `,`, autocomplete restarts for the next font in the fallback stack. Extract query from after the last comma: `"Roboto, Hel|"` → query = `"Hel"`.

**Generic families:** Always available as suggestions with source label "Generic".

**Autocomplete source priority:** When `{` is typed → token autocomplete (existing). When typing letters without `{` in a font field → font autocomplete. When typing letters without `{` in a non-font field → function autocomplete (existing, 2+ char threshold).

- [ ] Step 1: Add font suggestion type to autocomplete
- [ ] Step 2: Implement comma-aware query extraction
- [ ] Step 3: Add font suggestions with font-face preview rendering
- [ ] Step 4: Add generic family suggestions
- [ ] Step 5: Wire autocomplete source priority based on acceptedTypes
- [ ] Step 6: Run lint
- [ ] Step 7: Commit: `feat(frontend): add font autocomplete with fallback stack support (spec-13c)`

---

### Task 5: Replace property panel controls with ValueInput

**Files:**
- Modify: `frontend/src/panels/FillRow.tsx`
- Modify: `frontend/src/panels/StrokeRow.tsx`
- Modify: `frontend/src/panels/TypographySection.tsx`
- Modify: `frontend/src/panels/EffectCard.tsx`
- Modify: `frontend/src/panels/AppearancePanel.tsx`

Replace each tokenizable field's control with ValueInput. Each panel needs:
1. Access to `store.state.tokens` for autocomplete
2. A `SystemFontProvider` instance for font fields
3. Conversion helpers (`formatStyleValue`, `parseColorInput`, `parseNumberInput`)

**FillRow (1 field):** Replace ColorSwatch with `ValueInput(acceptedTypes: ["color"])` for solid fill color. Gradient fills keep existing gradient editor.

**StrokeRow (2 fields):** Color → `ValueInput(["color"])`, Width → `ValueInput(["number", "dimension"])`.

**TypographySection (5 fields):** Font family → `ValueInput(["font_family", "string"], fontProvider)`, Font size → `ValueInput(["number", "dimension"])`, Line height → `ValueInput(["number"])`, Letter spacing → `ValueInput(["number", "dimension"])`, Text color → `ValueInput(["color"])`.

**EffectCard (5 fields):** Shadow color → `ValueInput(["color"])`, X/Y/Blur/Spread → `ValueInput(["number"])`.

**AppearancePanel (1 field):** Opacity → `ValueInput(["number"])`.

**Handler pattern for each field:**
```typescript
function handleColorChange(raw: string): void {
  const parsed = parseColorInput(raw);
  if (!parsed) return;
  // Update the style via existing store mutation
}
```

Each panel must pass tokens from the document store context.

- [ ] Step 1: Add token store access to each panel (via useDocument)
- [ ] Step 2: Replace FillRow color with ValueInput
- [ ] Step 3: Replace StrokeRow color + width
- [ ] Step 4: Replace TypographySection fields (5 fields)
- [ ] Step 5: Replace EffectCard fields (5 fields)
- [ ] Step 6: Replace AppearancePanel opacity
- [ ] Step 7: Run lint + build
- [ ] Step 8: Commit: `feat(frontend): replace property panel controls with ValueInput (spec-13c)`

---

### Task 6: Update TokenDetailEditor to use ValueInput for all types

**Files:**
- Modify: `frontend/src/panels/TokenDetailEditor.tsx`

Replace ALL value editors (color picker, number inputs, text inputs, alias editor, expression editor) with ValueInput. The token detail editor becomes a single ValueInput per token, configured with the right `acceptedTypes` based on `token.token_type`.

Mapping:
```typescript
function acceptedTypesForToken(tokenType: TokenType): ValueType[] {
  switch (tokenType) {
    case "color": return ["color"];
    case "dimension": return ["number", "dimension"];
    case "number": return ["number"];
    case "font_family": return ["font_family", "string"];
    case "font_weight": return ["number"];
    case "duration": return ["number"];
    case "cubic_bezier": return ["string"]; // special case
    case "shadow": return ["string"]; // composite, deferred
    case "gradient": return ["string"]; // composite, deferred
    case "typography": return ["string"]; // composite, deferred
    default: return ["string"];
  }
}
```

For simple types (color, number, dimension, font_family, font_weight, duration), the ValueInput replaces the type-specific editor entirely. For composite types (shadow, gradient, typography), keep the existing editors — ValueInput doesn't handle composites yet.

- [ ] Step 1: Add acceptedTypesForToken mapping
- [ ] Step 2: Replace simple type editors with ValueInput
- [ ] Step 3: Keep composite type editors (shadow, gradient, typography)
- [ ] Step 4: Remove unused render functions
- [ ] Step 5: Run lint + build
- [ ] Step 6: Commit: `feat(frontend): use ValueInput for simple token types in detail editor (spec-13c)`

---

### Task 7: Storybook stories + browser verification

**Files:**
- Create: `frontend/src/components/value-input/ValueInput.stories.tsx`

Stories covering all field types:
- **ColorLiteral** — `#0066FF` with swatch prefix
- **ColorTokenRef** — `{brand.primary}` with resolved swatch
- **ColorExpression** — `darken({brand.primary}, 20%)` with resolved swatch
- **NumberLiteral** — `16`
- **NumberTokenRef** — `{spacing.md}`
- **NumberExpression** — `{spacing.md} * 2`
- **FontFamily** — `Inter, sans-serif` with font autocomplete
- **FontTokenRef** — `{font.family.primary}`
- **Disabled** — disabled state
- **Interactive** — full interactive demo with mock tokens

Browser verification:
1. Open app, select a rectangle node
2. Go to Appearance tab → fill color field shows ValueInput with swatch
3. Type `{` → autocomplete shows color tokens
4. Select a token → `{brand.primary}` shown, swatch shows resolved color
5. Clear and type `#FF0000` → swatch updates to red
6. Go to stroke width → ValueInput for numbers
7. Type `{spacing.md}` → resolved value shown
8. Go to typography → font family shows font autocomplete
9. Type `Inter, ` → autocomplete reopens for fallback font
10. Verify all existing tests pass

- [ ] Step 1: Create ValueInput stories
- [ ] Step 2: Run all tests
- [ ] Step 3: Run lint + build + format
- [ ] Step 4: Browser verification
- [ ] Step 5: Commit: `feat(frontend): add ValueInput stories and verify integration (spec-13c)`

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| §1.1 Props (acceptedTypes, fontProvider) | Task 3 |
| §1.2 Auto-detect mode | Task 1 (value-detect), Task 3 (wiring) |
| §1.3 Color swatch prefix | Task 3 |
| §1.4 Color literal parsing | Task 1 (color-parse), Task 3 (wiring) |
| §1.5 Dimension parsing | Task 1 (style-value-format) |
| §1.6 Font family autocomplete | Task 4 |
| §1.7 Token reference behavior | Already implemented in 13e |
| §1.8 Detach behavior | Natural — typing literal replaces token ref |
| §2.1-2.5 Panel integration | Task 5 |
| §2.6 Value conversion | Task 1 (style-value-format) |
| §2.7 Token editor | Task 6 |
| §3 Font provider | Task 1 (font-provider) |
| §7 File structure | Task 2 (rename/move) |

### Deferred
- Composite token editing (shadow, gradient, typography as ValueInput) — keep existing editors
- Mixed-unit expressions — stored but not resolved
- Plugin font packs — FontProvider interface ready, implementation deferred to M4
