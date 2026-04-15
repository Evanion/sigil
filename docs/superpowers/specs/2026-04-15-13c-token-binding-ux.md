# Spec 13c — Token Binding UX (ValueInput)

## Overview

Renames `EnhancedTokenInput` to `ValueInput` and extends it to become the universal value input for all style fields. Replaces ColorSwatch, NumberInput, and plain text inputs throughout the property panels. Auto-detects value mode (literal, reference, expression) from what the user types — no mode toggle or diamond icon needed.

**Depends on:** Spec 13a (token store), Spec 13d (expression engine), Spec 13e (EnhancedTokenInput base)

**Design Decision:** No diamond icon or mode toggle. The ValueInput auto-detects the value mode from content, following the Design Decision Criteria principle (Correctness → Robustness → Simplicity → Convention). A single smart input is simpler, more robust, and has fewer states than a mode toggle + diamond icon + separate literal controls.

---

## 1. ValueInput Component

### 1.1 Props

```typescript
interface ValueInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly tokens: Record<string, Token>;
  readonly acceptedTypes: readonly ValueType[];
  readonly fontProvider?: FontProvider;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}

type ValueType = "color" | "number" | "dimension" | "string" | "font_family";
```

### 1.2 Auto-Detect Mode

The ValueInput determines the value mode from the content — no explicit mode toggle:

| Input starts with | Detected as | Border color |
|---|---|---|
| `#` (+ hex chars) | Color literal | default |
| `{` | Token reference | blue tint |
| `0-9` or `-0-9` | Numeric literal | default |
| Letter + `(` | Function expression | purple tint |
| Letter (font context) | Font name literal | default |
| Contains `+`, `-`, `*`, `/` outside `{}` | Expression | purple tint |

The `acceptedTypes` prop controls validation:
- A color field (`acceptedTypes: ["color"]`) rejects numeric literals and shows an error
- A number field (`acceptedTypes: ["number", "dimension"]`) rejects `#hex` values
- Token references and expressions are always accepted — type checking happens at evaluation time

### 1.3 Color Swatch Prefix

When `acceptedTypes` includes `"color"`:
- A small color swatch (28x28px) renders inside the input as a left prefix
- The swatch shows the resolved color (works for literals, token refs, and expressions)
- Clicking the swatch opens the existing ColorPicker popover
- Non-color fields have no prefix

### 1.4 Color Literal Parsing

When the user types `#` in a color-accepting field:
- Parse `#RGB` (3 chars) → expand to `#RRGGBB`
- Parse `#RRGGBB` (6 chars) → standard hex
- Parse `#RRGGBBAA` (8 chars) → hex with alpha
- Invalid hex → show error
- The `#` prefix is part of the stored value

### 1.5 Dimension Parsing

Numeric values with units: `16px`, `1.5rem`, `2em`, `50%`

Supported units for expression engine resolution: `px`, `rem`, `em`, `%` (percentage stored as 0-1 internally).

Other CSS units (`vw`, `vh`, `ch`, `pt`, `cqw`, etc.) are accepted as raw strings for storage but not resolved by the expression engine — they pass through as-is for future CSS export. Mixed-unit expressions (`5ch + 3cqw`) are stored but show "cannot resolve" instead of a numeric preview.

### 1.6 Font Family Autocomplete

When `acceptedTypes` includes `"font_family"`:
- Typing triggers font name autocomplete (not token autocomplete)
- Each suggestion renders its name **in its own font face** for visual preview
- Suggestions show source label: "System", "Workspace", or plugin name
- Generic families (`sans-serif`, `serif`, `monospace`, `system-ui`, etc.) always available
- Comma-aware: after typing `,` the autocomplete restarts for the next font in the fallback stack
- Full stack stored as one string: `Roboto, Helvetica Neue, sans-serif`

**Font Provider interface (pluggable):**
```typescript
interface FontProvider {
  listFonts(): readonly FontInfo[];
}

interface FontInfo {
  readonly name: string;
  readonly source: "system" | "workspace" | "plugin";
}
```

Ships with a `SystemFontProvider` that returns common system fonts. Workspace fonts and plugin font packs are future extensions via the same interface.

### 1.7 Token Reference Behavior

Token references use `{...}` braces (inner-brace convention per Spec 13e):
- `{brand.primary}` — single token reference
- `{spacing.md} * 2` — token in expression
- `lighten({brand.primary}, {opacity.amount})` — tokens in any argument position

Autocomplete triggers on `{` and filters by `acceptedTypes`:
- Color fields show only color tokens
- Number/dimension fields show number + dimension tokens
- Font fields show font_family tokens
- Expression mode shows all tokens (type checking at evaluation time)

### 1.8 Detach Behavior

No explicit detach button. Detaching happens naturally:
- User clears the field and types a literal value → token binding replaced by literal
- User selects all and types `#FF0000` → was `{brand.primary}`, now a literal color
- This is intuitive: editing the value means you own it

---

## 2. Property Panel Integration

Every `StyleValue<T>` field gets a ValueInput. The current specialized controls (ColorSwatch, NumberInput) are replaced.

### 2.1 Fill Row

```
[drag handle] [ValueInput(color, swatch prefix)] [fill type select] [remove]
```

- Fill type select (Solid/Linear/Radial/Conic) stays — it's structural, not tokenizable
- For gradient fills, the ValueInput is not shown (gradient editor handles colors per stop)

### 2.2 Stroke Row

```
[drag handle] [ValueInput(color, swatch prefix)] [ValueInput(number/dimension)] [alignment select] [remove]
```

Two ValueInputs: one for color, one for width.

### 2.3 Typography Section

| Field | ValueInput config |
|---|---|
| Font family | `acceptedTypes: ["font_family", "string"], fontProvider: systemFontProvider` |
| Font size | `acceptedTypes: ["number", "dimension"]` |
| Font weight | Stays as Select dropdown (enum, not free value) |
| Line height | `acceptedTypes: ["number"]` |
| Letter spacing | `acceptedTypes: ["number", "dimension"]` |
| Text color | `acceptedTypes: ["color"]` with swatch prefix |

### 2.4 Effects (Shadow)

| Field | ValueInput config |
|---|---|
| Color | `acceptedTypes: ["color"]` with swatch prefix |
| X offset | `acceptedTypes: ["number"]` |
| Y offset | `acceptedTypes: ["number"]` |
| Blur | `acceptedTypes: ["number"]` |
| Spread | `acceptedTypes: ["number"]` |

### 2.5 Opacity

`acceptedTypes: ["number"]` — value displayed as 0-100, stored as 0-1 internally.

### 2.6 Value Conversion

When the ValueInput commits a value, the panel handler converts to `StyleValue<T>`:

```typescript
function parseValueInput(raw: string, acceptedTypes: ValueType[]): StyleValue<T> {
  // Token reference: {name} with no operators
  const bareRef = raw.match(/^\{([a-zA-Z][a-zA-Z0-9._-]*)\}$/);
  if (bareRef) return { type: "token_ref", name: bareRef[1] };

  // Expression: contains operators, functions, or multiple token refs
  // Requires adding an "expression" variant to StyleValue<T>:
  //   StyleValue<T> = Literal { value: T } | TokenRef { name: string } | Expression { expr: string }
  // The expression variant stores the raw expression string. The renderer resolves it
  // via the expression evaluator at render time, same as token refs.
  if (containsExpression(raw)) return { type: "expression", expr: raw };

  // Literal: parse based on accepted type
  if (acceptedTypes.includes("color") && raw.startsWith("#")) {
    return { type: "literal", value: parseHexColor(raw) };
  }
  if (acceptedTypes.includes("number") || acceptedTypes.includes("dimension")) {
    return { type: "literal", value: parseFloat(raw) };
  }
  // String/font_family
  return { type: "literal", value: raw };
}
```

### 2.7 Token Editor Detail Pane

The token detail editor also uses ValueInput for all token value types. No separate alias/expression editors. The ValueInput auto-detects whether the user is entering a literal, reference, or expression.

---

## 3. Font Provider

### 3.1 System Font Provider

```typescript
const SYSTEM_FONTS: readonly FontInfo[] = [
  { name: "system-ui", source: "system" },
  { name: "Arial", source: "system" },
  { name: "Helvetica", source: "system" },
  { name: "Georgia", source: "system" },
  { name: "Times New Roman", source: "system" },
  { name: "Courier New", source: "system" },
  { name: "Verdana", source: "system" },
  { name: "Trebuchet MS", source: "system" },
  // ... ~30-50 common system fonts
];

const GENERIC_FAMILIES: readonly FontInfo[] = [
  { name: "serif", source: "system" },
  { name: "sans-serif", source: "system" },
  { name: "monospace", source: "system" },
  { name: "cursive", source: "system" },
  { name: "fantasy", source: "system" },
  { name: "system-ui", source: "system" },
  { name: "ui-serif", source: "system" },
  { name: "ui-sans-serif", source: "system" },
  { name: "ui-monospace", source: "system" },
  { name: "ui-rounded", source: "system" },
];
```

### 3.2 Future Extensions

- **Workspace fonts:** Fonts loaded via `@font-face` in the project. Detected from the document's font context.
- **Plugin font packs:** Plugins register font lists via the plugin API (M4). The `FontProvider` interface is ready for this.

---

## 4. Input Validation

- **Expression length:** `MAX_EXPRESSION_LENGTH = 1024` enforced on input and paste (already implemented in 13e)
- **Color hex:** Validate `#` followed by 3, 6, or 8 hex characters
- **Number:** Validate finite numeric value via `Number.isFinite()`
- **Font family:** Validate against CSS character denylist (no quotes, semicolons, braces)
- **Autocomplete results:** `MAX_AUTOCOMPLETE_RESULTS = 12` (already enforced)
- **Font stack:** No max length for comma-separated list (CSS has no limit)

---

## 5. Consistency Guarantees

- **Optimistic updates:** All value changes applied to local store immediately, sent to server, rolled back on error (existing pattern)
- **Undo/redo:** Value changes tracked via existing HistoryManager. Single undo entry per committed value (Enter/blur commits)
- **Canvas rendering:** Existing `resolveStyleValueColor/Number` functions resolve token refs for rendering — no changes needed
- **Broadcast:** Value changes broadcast via existing mutation infrastructure — no new op types needed

---

## 6. Accessibility

- `role="combobox"` with `aria-autocomplete="list"` (from 13e)
- `aria-expanded` for autocomplete dropdown
- `aria-activedescendant` for keyboard navigation
- Autocomplete suggestions have `role="listbox"` / `role="option"`
- Screen reader announcement when suggestions appear/change
- Color swatch prefix has `aria-label="Color preview, click to edit"`
- Keyboard: Enter commits, Escape reverts, Tab accepts suggestion, arrows navigate

---

## 7. File Structure

### New files

| File | Responsibility |
|------|---------------|
| `frontend/src/components/value-input/ValueInput.tsx` | Universal value input component |
| `frontend/src/components/value-input/ValueInput.css` | Styles |
| `frontend/src/components/value-input/ValueInput.stories.tsx` | Storybook stories |
| `frontend/src/components/value-input/value-detect.ts` | Auto-detect mode from content |
| `frontend/src/components/value-input/font-provider.ts` | FontProvider interface + SystemFontProvider |
| `frontend/src/components/value-input/color-parse.ts` | Hex color parsing |
| `frontend/src/components/value-input/__tests__/value-detect.test.ts` | Mode detection tests |
| `frontend/src/components/value-input/__tests__/color-parse.test.ts` | Hex parsing tests |
| `frontend/src/components/value-input/__tests__/font-provider.test.ts` | Font provider tests |

### Modified files

| File | Changes |
|------|---------|
| `frontend/src/panels/FillRow.tsx` | Replace ColorSwatch with ValueInput |
| `frontend/src/panels/StrokeRow.tsx` | Replace ColorSwatch + NumberInput with ValueInput |
| `frontend/src/panels/TypographySection.tsx` | Replace all inputs with ValueInput |
| `frontend/src/panels/EffectCard.tsx` | Replace inputs with ValueInput |
| `frontend/src/panels/AppearancePanel.tsx` | Opacity → ValueInput |
| `frontend/src/panels/TokenDetailEditor.tsx` | Use ValueInput for all value types |

### Superseded files (move/rename)

| File | Action |
|------|--------|
| `frontend/src/components/token-input/*` | Move to `value-input/`, rename EnhancedTokenInput → ValueInput |

---

## 8. PDR Traceability

**Implements:**
- PDR §3.5 "Design tokens" — token binding to style fields
- PDR §4.3 "Token management" — bind tokens via property panels
- Spec 13c requirements — token binding UX (reimagined without diamond icon)

**Defers:**
- Mixed-unit expressions (`5ch + 3cqw`) — CSS export (M4)
- CSS units beyond px/rem/em/% — accepted as strings, not resolved
- Composite token editing — separate follow-up
- Plugin font packs — M4 plugin system
