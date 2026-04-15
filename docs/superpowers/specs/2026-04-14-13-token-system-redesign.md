# Spec 13 (Revised) — Token System: Expressions, Composites, and Management UI

## Overview

Redesigns the token management experience from a developer-oriented table/dialog into a styleguide-inspired three-pane editor. Adds an expression engine for computed token values, composite token types (typography, shadow, border), token sets for theming, and an enhanced rich input component with syntax highlighting and autocomplete.

**Depends on:** Spec 01 (core types — TokenContext, StyleValue, Token), Spec 09 (properties panel), Spec 13a (token store + resolution + canvas rendering — already implemented)

**Decomposition:**
- **Spec 13b (revised)** — Token management UI (three-pane styleguide layout, token sets, group hierarchy)
- **Spec 13d** — Expression engine (parser, evaluator, function library, composite token types)
- **Spec 13e** — Enhanced token input (contentEditable rich input, syntax highlighting, autocomplete)
- **Spec 13c** — Token binding UX (diamond icon, picker popover, field binding — uses enhanced input from 13e)

**Dependency order:** 13b → 13d → 13e → 13c

13b ships first with the new UI using literal and simple reference values (already working from 13a). 13d adds the expression engine to the core crate. 13e builds the rich input component. 13c wires token binding into property panel fields.

---

## 1. Token Data Model

### 1.1 Scalar Tokens

A scalar token holds a single typed value. Types: `color`, `number`, `string`, `boolean`.

The value is stored in one of three modes:
- **Literal** — a direct value (`#0066FF`, `16`, `"Inter"`, `true`)
- **Reference** — an alias to another token (`{brand.primary}`)
- **Expression** — a computed value (`{spacing.md} * 2`, `lighten({brand.primary}, 20%)`)

Token references always use `{...}` braces, regardless of context. In a standalone reference, the entire value is `{brand.primary}`. In an expression, each token reference is individually braced: `{spacing.md} * 2`, `lighten({brand.primary}, 20%)`. This convention was chosen over wrapping the entire expression in outer braces because inner braces provide an unambiguous, context-free signal for the parser and syntax highlighter — `{...}` always means "token reference" with no lookahead or context needed. The parser determines the value mode: a single `{token.name}` with no surrounding operators is a reference (alias); anything with operators or functions is an expression.

### 1.2 Composite Tokens

A composite token bundles multiple sub-fields into a single named entity. Each sub-field is itself a scalar value (literal, reference, or expression).

**Typography:**
| Sub-field | Type | Example |
|-----------|------|---------|
| family | string | `"Inter"` or `{font.family.primary}` |
| weight | number | `700` or `{font.weight.bold}` |
| size | number | `24` or `{font.size.base * 1.5}` |
| lineHeight | number | `1.4` or `{line.height.tight}` |
| letterSpacing | number | `0` or `{letter.spacing.wide}` |
| style | string | `"normal"` or `"italic"` |

**Shadow:**
| Sub-field | Type | Example |
|-----------|------|---------|
| offsetX | number | `0` or `{shadow.offset.sm}` |
| offsetY | number | `4` or `{shadow.offset.md}` |
| blur | number | `8` or `{shadow.blur.md}` |
| spread | number | `0` |
| color | color | `{brand.primary}` or `{alpha(brand.primary, 0.2)}` |

**Border:**
| Sub-field | Type | Example |
|-----------|------|---------|
| width | number | `1` or `{border.width.thin}` |
| style | string | `"solid"` or `"dashed"` |
| color | color | `{brand.primary}` or `#333333` |

### 1.3 Token Organization

**Token sets** — Named collections that stack for theming. Resolution walks the stack top-down; the first set containing a token name wins.
- **Global** — base tokens, always at the bottom of the stack. Contains primitives and defaults.
- **Theme sets** (Light, Dark) — override semantic tokens. Same names, different values. e.g. `surface.bg` = `#FFFFFF` in Light, `#1A1A1A` in Dark.
- **Brand sets** (Brand A, Brand B) — override brand primitives. e.g. `brand.primary` = `#0066FF` in Brand A, `#FF6600` in Brand B.

The user controls the stack order via drag-and-drop in the left navigation pane. Typical stack: `Brand A → Light → Global`.

**Groups** — Dot-separated namespace hierarchy within a set. `brand.primary` lives in group `brand`. Groups are implicit from token names, not separate entities that need CRUD. The UI renders them as collapsible section headers.

**Hierarchy levels** — Groups are categorized by their depth in the naming convention:
- **Primitive** — base values (e.g. `brand.primary`, `spacing.md`)
- **Semantic** — purpose-driven aliases/expressions (e.g. `action.primary` → `{brand.primary}`, `content.gap` → `{spacing.md}`)
- **Component** — component-specific tokens (e.g. `button.bg.default` → `{action.primary}`, `card.padding` → `{content.padding}`)

The hierarchy level is a user-assignable property on each token, defaulting to "primitive". When creating a token, the user can set it to `primitive`, `semantic`, or `component`. The UI displays level headers as section dividers in the styleguide view (e.g. "Primitive / Brand", "Semantic", "Component / Button"). This is stored as a field on the token, not inferred from the name — because the same naming pattern could be either semantic or component depending on intent.

### 1.4 Token Resolution

Resolution walks the alias/expression chain with cycle detection and a max depth of `MAX_TOKEN_RESOLUTION_DEPTH = 16` (existing constant from 13a).

For simple references, the existing `resolveToken()` is sufficient. For expressions, resolution becomes: parse expression → evaluate AST → for each token reference in the AST, recursively resolve → apply operators/functions → return final value.

Cycle detection tracks all visited token names across the resolution chain. If a name is visited twice, resolution returns a `CycleError`.

---

## 2. Expression Engine (Spec 13d)

### 2.1 Syntax

```
expression     = term (('+' | '-') term)*
term           = factor (('*' | '/') factor)*
factor         = '-' factor | atom
atom           = number | percentage | function_call | token_ref | '(' expression ')'
number         = DIGIT+ ('.' DIGIT+)?
percentage     = number '%'
function_call  = IDENT '(' (expression (',' expression)*)? ')'
token_ref      = TOKEN_PATH
TOKEN_PATH     = IDENT ('.' IDENT)*
```

Token references always use `{...}` braces as delimiters: `{spacing.md}`, `{brand.primary}`. Within an expression, each token reference is individually braced: `{spacing.md} * 2`, `lighten({brand.primary}, 20%)`. The braces provide an unambiguous, context-free signal — the parser does not need lookahead to distinguish token references from function names or other identifiers.

A value that is just `{spacing.md}` (a single token reference with no surrounding operators) is parsed as a `TokenRef` node — functionally identical to the existing alias/reference behavior. Any value containing operators or function calls outside the braces is parsed as an expression.

### 2.2 AST Types (Core Crate)

```rust
pub enum TokenExpression {
    Literal(ExprLiteral),
    TokenRef(String),          // dot-separated token path
    BinaryOp {
        left: Box<TokenExpression>,
        op: BinaryOperator,
        right: Box<TokenExpression>,
    },
    UnaryNeg(Box<TokenExpression>),
    FunctionCall {
        name: String,
        args: Vec<TokenExpression>,
    },
}

pub enum ExprLiteral {
    Number(f64),
    Percentage(f64),           // 20% stored as 0.2
    Color(Color),              // resolved color value (not used in parsing, only evaluation)
    Str(String),
}

pub enum BinaryOperator {
    Add,
    Sub,
    Mul,
    Div,
}
```

### 2.3 Function Registry

Functions are registered by name with arity and type constraints. The evaluator looks up the function name in the registry, validates argument count and types, and calls the implementation.

**Number functions:**
| Function | Signature | Description |
|----------|-----------|-------------|
| `round(n)` | number → number | Round to nearest integer |
| `ceil(n)` | number → number | Round up |
| `floor(n)` | number → number | Round down |
| `abs(n)` | number → number | Absolute value |
| `min(a, b)` | number, number → number | Minimum of two values |
| `max(a, b)` | number, number → number | Maximum of two values |
| `clamp(val, min, max)` | number, number, number → number | Clamp value to range |

**Size conversion functions:**
| Function | Signature | Description |
|----------|-----------|-------------|
| `rem(px)` | number → number | Convert px to rem (base configurable, default 16) |
| `em(px)` | number → number | Convert px to em (base configurable, default 16) |
| `px(rem_or_em)` | number → number | Convert rem/em to px |

**Color functions:**
| Function | Signature | Description |
|----------|-----------|-------------|
| `lighten(color, amount)` | color, number → color | Increase lightness (amount 0-1 or percentage) |
| `darken(color, amount)` | color, number → color | Decrease lightness |
| `saturate(color, amount)` | color, number → color | Increase saturation |
| `desaturate(color, amount)` | color, number → color | Decrease saturation |
| `alpha(color, amount)` | color, number → color | Set alpha channel (0-1) |
| `mix(c1, c2, weight)` | color, color, number → color | Blend two colors (weight 0-1, default 0.5) |
| `contrast(color)` | color → color | Return black or white for best contrast |
| `complement(color)` | color → color | 180° hue rotation |
| `hue(color, degrees)` | color, number → color | Set hue to absolute degrees (0-360) |

**Color channel setters** (return color):
| Function | Signature | Description |
|----------|-----------|-------------|
| `setRed(color, value)` | color, number → color | Set red channel (0-255) |
| `setGreen(color, value)` | color, number → color | Set green channel (0-255) |
| `setBlue(color, value)` | color, number → color | Set blue channel (0-255) |
| `setHue(color, degrees)` | color, number → color | Set HSL hue (0-360) |
| `setSaturation(color, pct)` | color, number → color | Set HSL saturation (0-100) |
| `setLightness(color, pct)` | color, number → color | Set HSL lightness (0-100) |

**Color channel adjusters** (relative shift, return color):
| Function | Signature | Description |
|----------|-----------|-------------|
| `adjustRed(color, delta)` | color, number → color | Shift red channel by delta |
| `adjustGreen(color, delta)` | color, number → color | Shift green channel by delta |
| `adjustBlue(color, delta)` | color, number → color | Shift blue channel by delta |
| `adjustHue(color, delta)` | color, number → color | Shift hue by delta degrees |
| `adjustSaturation(color, delta)` | color, number → color | Shift saturation by delta |
| `adjustLightness(color, delta)` | color, number → color | Shift lightness by delta |

**Color channel extractors** (return number):
| Function | Signature | Description |
|----------|-----------|-------------|
| `red(color)` | color → number | Extract red channel (0-255) |
| `green(color)` | color → number | Extract green channel (0-255) |
| `blue(color)` | color → number | Extract blue channel (0-255) |
| `hueOf(color)` | color → number | Extract HSL hue (0-360) |
| `saturationOf(color)` | color → number | Extract HSL saturation (0-100) |
| `lightnessOf(color)` | color → number | Extract HSL lightness (0-100) |

**Blend mode functions** (return color):
| Function | Signature | Description |
|----------|-----------|-------------|
| `blend(c1, c2, mode)` | color, color, string → color | Photoshop-style blend |

Supported blend modes: `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`.

Blend modes have no CSS color-value equivalent — on export, the engine resolves the blend to a concrete hex value. The token stores the expression; the export resolves it.

### 2.4 Evaluator

The evaluator walks the AST, resolving token references through the existing resolution chain. It operates in the frontend token store for live preview, and will eventually run in the core crate for export.

**Evaluation rules:**
- `Literal` → return the literal value
- `TokenRef` → resolve via `resolveToken()`, return the resolved value
- `BinaryOp` → evaluate left and right, apply operator. Both operands must be numbers; type mismatch returns `TypeError`.
- `FunctionCall` → look up function in registry, validate arity and argument types, call implementation
- Arithmetic on colors is not supported — use color functions instead. `{brand.primary + 10}` is a `TypeError`.

**Error types:**
- `ParseError` — malformed expression syntax
- `UnknownFunction` — function name not in registry
- `ArityError` — wrong number of arguments
- `TypeError` — operand type mismatch (e.g. color + number)
- `CycleError` — circular reference detected
- `DepthError` — resolution chain exceeded `MAX_TOKEN_RESOLUTION_DEPTH`
- `ReferenceError` — referenced token does not exist
- `DomainError` — value out of valid range for function (e.g. negative value for `lighten`)

Errors produce typed error values, not panics. The UI displays errors inline below the expression field.

### 2.5 Composite Token Types (Core Crate)

```rust
pub enum CompositeTokenValue {
    Typography(TypographyToken),
    Shadow(ShadowToken),
    Border(BorderToken),
}

pub struct TypographyToken {
    pub family: TokenExpression,
    pub weight: TokenExpression,
    pub size: TokenExpression,
    pub line_height: TokenExpression,
    pub letter_spacing: TokenExpression,
    pub style: TokenExpression,
}

pub struct ShadowToken {
    pub offset_x: TokenExpression,
    pub offset_y: TokenExpression,
    pub blur: TokenExpression,
    pub spread: TokenExpression,
    pub color: TokenExpression,
}

pub struct BorderToken {
    pub width: TokenExpression,
    pub style: TokenExpression,
    pub color: TokenExpression,
}
```

Each sub-field is a `TokenExpression`, allowing it to be a literal, reference, or computed expression independently.

**Sub-field extraction:** Individual sub-fields of a composite token can be referenced using dot notation: `{type.heading.h1.size}` extracts the `size` sub-field from the typography composite token `type.heading.h1`. The evaluator recognizes this pattern: resolve `type.heading.h1` to a composite, then extract the named sub-field.

---

## 3. Token Management UI (Spec 13b Revised)

### 3.1 Layout — Three-Pane Styleguide

The token editor is a **full-screen dialog** (replacing the current small dialog) with three panes:

**Left pane — Navigation (170px fixed)**
- Search field at top — filters tokens across the current set by name
- Token set switcher — list of sets (Global, Light, Dark, Brand A, Brand B), click to select active set, drag to reorder stack
- Divider
- Category filter — list of token types (Colors, Spacing, Typography, Shadows, Radii, Borders) with token counts. Click to filter the middle pane.
- Divider
- "+ New Token" button

**Middle pane — Styleguide view (flexible width)**
- Header showing category name, set name, and token count
- Tokens grouped by hierarchy level with section headers: `Primitive / Brand`, `Semantic`, `Component / Button`
- Type-specific rendering per category (see 3.2)
- Clicking a token selects it — highlight border, details shown in right pane
- Reference tokens show the alias in italic below the name (e.g. `→ brand.primary`)
- Expression tokens show an `f(x)` badge next to the name

**Right pane — Detail editor (240px fixed)**
- Token name (editable)
- Type badge + hierarchy level label
- Large visual preview (type-specific: color swatch, spacing bar, type sample, shadow/border box)
- Value editor with mode toggle (see 3.3)
- Name field
- Description textarea
- "Depends on" list — tokens this one references (clickable, navigates)
- "Referenced by" list — tokens that reference this one (clickable, navigates)
- Duplicate / Delete action buttons

### 3.2 Type-Specific Rendering (Middle Pane)

**Colors** — Card grid (`grid-template-columns: repeat(auto-fill, minmax(100px, 1fr))`). Each card: color swatch (top), token name, resolved value or alias reference. Selected card gets accent border.

**Spacing** — Vertical list. Each row: proportional bar visualization (width represents value), token name, resolved value. Bar widths are relative to the largest value in the set.

**Typography** — Live text preview. Each row renders a sample text string ("The quick brown fox") in the token's actual font family, weight, size. Shows token name and sub-field summary below.

**Shadows** — Preview boxes. Each card shows a small rectangle with the shadow applied. Token name and value summary below.

**Borders** — Preview boxes. Each card shows a small rectangle with the border applied. Token name and value summary below.

**Radii** — Preview boxes. Each card shows a small rectangle with the border-radius applied at all four corners. Token name and value below.

### 3.3 Value Editor (Right Pane)

Three value modes, toggled by buttons: `123` (literal) / `{}` (reference) / `f(x)` (expression).

**Literal mode:**
- Type-specific inline controls
- Color: inline color picker
- Number: number input with unit
- String: text input
- Boolean: toggle

**Reference mode:**
- Enhanced token input (from 13e) showing the referenced token as a styled pill
- Autocomplete on `{` keystroke — filtered to compatible types

**Expression mode:**
- Enhanced token input (from 13e) with full syntax highlighting
- Token references shown as colored spans
- Function names in amber, numbers in gold, operators in default
- Resolution trail below the input showing intermediate steps
- Error messages inline in red

**Composite tokens** — When a composite token (typography, shadow, border) is selected, the right pane shows all sub-fields. Each sub-field has its own mode toggle and value editor. A live preview at the top renders the composite result (text sample for typography, box with shadow, box with border).

### 3.4 Token Sets UI

- Left pane shows sets as a reorderable list
- Active stack order is visual (top = highest priority)
- Selecting a set filters the middle pane to tokens defined in that set
- Tokens that override a parent set show an override indicator
- "Compare themes" view: side-by-side rendering of two sets showing the same token names with different resolved values
- Set operations: create (with optional "extends" for inheritance), rename, delete, duplicate, reorder

### 3.5 Panel Tab

The left panel "Tokens" tab (alongside Layers, Pages) remains as a quick-access view. It shows a flat grouped list of tokens with type icons, resolved values, and alias indicators. Clicking "Open full editor" opens the three-pane dialog. The panel tab provides everyday browsing; the full editor provides power-user management.

---

## 4. Enhanced Token Input (Spec 13e)

### 4.1 Component Design

A `contentEditable` div-based rich input component used everywhere token values are entered.

**Props:**
```typescript
interface EnhancedTokenInputProps {
  value: string;                    // Raw expression string (e.g. "{spacing.md * 2}")
  onChange: (value: string) => void;
  mode: "literal" | "reference" | "expression";
  tokenType?: TokenType;            // For filtering autocomplete suggestions
  tokens: Record<string, Token>;    // Available tokens for autocomplete
  onModeChange?: (mode: ValueMode) => void;
  placeholder?: string;
  disabled?: boolean;
}
```

### 4.2 Rendering

The component re-parses and re-renders on every input event. Since expressions are short (typically under 100 characters), this is cheap.

**Syntax highlighting:**
- Token references `{token.name}` — rendered as colored spans (blue text, optional mini swatch for colors)
- Function names — amber
- Numbers and percentages — gold
- Operators (`+`, `-`, `*`, `/`) — default text color
- Parentheses — muted gray
- Invalid/unknown tokens — red with dashed underline

### 4.3 Autocomplete

Triggered by typing `{` in any mode. The dropdown shows:
- Matching tokens filtered as the user types, with the matching portion bolded
- Visual preview per token (color swatch, spacing bar, etc.)
- Full token name on the left, resolved value on the right
- Type-filtered: in a color context, only color tokens appear; in expression mode, all types
- Navigate with arrow keys, select with Enter/Tab, dismiss with Escape
- Positioned from cursor offset within the contentEditable div

Function autocomplete: typing a known function prefix (e.g. `lig`) shows function suggestions with parameter hints (e.g. `lighten(color, amount)`).

### 4.4 Keyboard Behavior

- Enter — confirms the value (calls `onChange`)
- Escape — reverts to the last confirmed value
- Tab — if autocomplete is open, selects the highlighted suggestion; otherwise, moves focus
- No newlines — single-line input only
- Standard text editing: Cmd+A, Cmd+C, Cmd+V, arrow keys, Shift+arrow for selection

### 4.5 Accessibility

- `role="textbox"` with `aria-label` describing the field purpose
- `aria-autocomplete="list"` when autocomplete is active
- `aria-activedescendant` pointing to the highlighted autocomplete item
- Autocomplete dropdown has `role="listbox"` with `role="option"` items
- Screen reader announcement on autocomplete open/close and selection

---

## 5. Token Binding UX (Spec 13c — Updated)

### 5.1 Diamond Binding Icon

Every `StyleValue` field in the properties panel gets a diamond icon:
- **Unfilled (◇)** — field has a literal value, no token bound
- **Filled (◆)** — field is bound to a token
- **Color:** accent blue when bound, muted gray when unbound

Click unfilled diamond → opens token picker popover filtered to compatible types.
Click filled diamond → opens popover showing token name + "Detach" / "Change" buttons.

### 5.2 Token Picker Popover

A searchable list of compatible tokens using the enhanced token input from 13e:
- Search field with autocomplete
- Tokens filtered by compatible type
- Visual previews per token
- Click to bind
- "Create new token..." option at bottom

### 5.3 Bound Field Display

When a field is bound to a token:
1. The field shows the **resolved value** (actual color/size/weight)
2. The diamond icon is **filled and accent-colored**
3. Below the field: the **token name** shown as `↳ brand.primary`
4. The field has a **left accent border** (subtle blue)
5. Editing the literal value **detaches** the token (converts to Literal with current resolved value)

### 5.4 Detach

Detach converts `TokenRef { name }` to `Literal { value: resolvedValue }`. Available via:
- Clicking filled diamond → popover with "Detach" button
- Right-click context menu → "Detach token"
- Directly editing the field value

### 5.5 Expression in Property Fields

Property fields that accept token binding also support expressions via the enhanced token input. A designer can type `{spacing.md * 2}` directly into a property field's token binding. The mode toggle and value display adapt accordingly.

---

## 6. Input Validation

### 6.1 Existing Validations (from 13a)

- Token name: `validate_token_name()` — alphanumeric + `./_-`, max length `MAX_TOKEN_NAME_LENGTH`
- Alias cycle detection: `MAX_TOKEN_RESOLUTION_DEPTH = 16`
- Token count: `MAX_TOKENS_PER_CONTEXT`

### 6.2 New Validations (13d)

- **Expression string length:** `MAX_TOKEN_EXPRESSION_LENGTH = 1024` — reject expressions longer than this at the API boundary
- **AST depth:** `MAX_EXPRESSION_AST_DEPTH = 32` — recursive descent parser enforces max nesting of parentheses/function calls
- **Function argument count:** `MAX_FUNCTION_ARGS = 8` — reject function calls with more arguments than this
- **Numeric values in expressions:** All numeric literals validated with `f64::is_finite()` — reject NaN and infinity
- **Color channel values:** Clamped to valid ranges in function implementations (0-255 for RGB, 0-360 for hue, 0-100 for saturation/lightness, 0-1 for alpha). Note: clamping is acceptable here because these are function outputs, not user inputs — the user provides intent (e.g. "lighten by 50%") and the function ensures the result stays in valid color space.
- **Blend mode string:** Validated against the supported set — unknown mode returns `UnknownBlendMode` error
- **Token set name:** Same validation as token name. Max sets per document: `MAX_TOKEN_SETS = 32`
- **Token set stack depth:** `MAX_TOKEN_SET_STACK_DEPTH = 16` — max number of sets in the resolution stack
- **Composite sub-field names:** Validated against the known sub-fields for each composite type — unknown sub-field returns `UnknownSubField` error

### 6.3 Frontend Validations (13e)

- Enhanced token input validates on every keystroke (parse the expression, show errors inline)
- Autocomplete filters ensure only valid token names can be inserted via autocomplete
- Mode toggle validates that the current value is compatible with the target mode before switching

---

## 7. Consistency Guarantees

- **Token CRUD atomicity:** Each token operation (add/update/delete) is a single `FieldOperation` applied atomically
- **Token set CRUD atomicity:** Each set operation is a single `FieldOperation`
- **Expression evaluation:** Pure function — same inputs always produce same outputs. No side effects.
- **Cascading updates:** When a token's value changes, all dependent tokens re-evaluate reactively. The Solid.js store triggers re-renders for any component reading a resolved token value.
- **Detach preserves value:** Detaching snapshots the current resolved value into a Literal — the field doesn't change visually
- **Set reorder atomicity:** Reordering the set stack is a single operation. All tokens re-resolve based on the new stack order.
- **Undo/redo:** All token operations (CRUD, set operations, binding, detaching) are wired to the HistoryManager. Expression edits create a single undo entry per confirmed value change (Enter key), not per keystroke.

---

## 8. WASM Compatibility

### 8.1 New Dependencies

The expression parser and evaluator are pure computation — no I/O, no system calls, no external dependencies. The recursive descent parser is hand-written, not generated. Color manipulation functions use standard math operations (`f64` arithmetic, trigonometry for HSL conversion). All safe for `wasm32-unknown-unknown`.

### 8.2 Trait Bounds

No `Send`, `Sync`, or `'static` bounds on expression types. The AST is a plain enum tree. The evaluator takes `&TokenContext` by reference.

### 8.3 Randomness / System Calls

None. Expression evaluation is deterministic.

---

## 9. Recursion Safety

| Function | Max Depth | Constant | Error on Exceed |
|----------|-----------|----------|-----------------|
| Expression parser (nested parens/calls) | 32 | `MAX_EXPRESSION_AST_DEPTH` | `ParseError::MaxDepthExceeded` |
| Token resolution (alias chains + expressions) | 16 | `MAX_TOKEN_RESOLUTION_DEPTH` | `EvalError::DepthError` |
| Expression evaluator (nested function calls) | 32 | `MAX_EXPRESSION_AST_DEPTH` | `EvalError::DepthError` |

The parser uses recursive descent. An iterative alternative (Pratt parser) was considered but recursive descent is simpler for this grammar size and the depth limit prevents stack overflow. The evaluator recurses on AST nodes; depth is bounded by the parser's depth limit.

---

## 10. PDR Traceability

**Implements:**
- PDR §3.5 "Design tokens" — token management, binding to style fields, token references, expressions
- PDR §4.3 "Token management" — create, edit, delete, organize tokens, token sets for theming
- PDR "Design System Tool" (M2) — composite tokens, expression-based token derivation

**Defers:**
- Token export (CSS/Tailwind) — moved to M4 as plugins per ADR-002
- Token import (W3C Design Tokens format) — stub button in UI, full import in follow-up spec
- Conditional expressions (`if`, `switch`) — can be added to function registry later without grammar changes
- Modular scale generation (`modularScale`) — can be added as a function later
- String concatenation for composite shorthand — deferred, composite tokens handle this use case

---

## 11. File Structure

### New Files (Spec 13b Revised)

| File | Responsibility |
|------|---------------|
| `frontend/src/panels/TokenEditor.tsx` | Three-pane token editor dialog (replaces TokenEditorWindow) |
| `frontend/src/panels/TokenEditor.css` | Token editor styles |
| `frontend/src/panels/TokenNavigationPane.tsx` | Left pane: set switcher, category filter, search |
| `frontend/src/panels/TokenStyleguideView.tsx` | Middle pane: type-specific token card/list rendering |
| `frontend/src/panels/TokenDetailPane.tsx` | Right pane: selected token detail editor |
| `frontend/src/panels/TokenColorGrid.tsx` | Color token card grid rendering |
| `frontend/src/panels/TokenSpacingList.tsx` | Spacing token list with bar visualization |
| `frontend/src/panels/TokenTypographyList.tsx` | Typography token live preview list |
| `frontend/src/panels/TokenPreviewCard.tsx` | Generic preview card for shadow/border/radius tokens |
| `frontend/src/panels/TokenSetManager.tsx` | Token set CRUD and stack reordering |
| `frontend/src/panels/TokenThemeCompare.tsx` | Side-by-side theme comparison view |

### New Files (Spec 13d)

| File | Responsibility |
|------|---------------|
| `crates/core/src/tokens/expression.rs` | TokenExpression AST types |
| `crates/core/src/tokens/parser.rs` | Recursive descent expression parser |
| `crates/core/src/tokens/evaluator.rs` | Expression evaluator with token resolution |
| `crates/core/src/tokens/functions.rs` | Built-in function registry and implementations |
| `crates/core/src/tokens/functions/math.rs` | Number functions (round, ceil, floor, min, max, clamp, abs) |
| `crates/core/src/tokens/functions/size.rs` | Size conversion functions (rem, em, px) |
| `crates/core/src/tokens/functions/color.rs` | Color manipulation functions |
| `crates/core/src/tokens/functions/blend.rs` | Blend mode implementations |
| `crates/core/src/tokens/composite.rs` | Composite token types (Typography, Shadow, Border) |
| `frontend/src/store/expression-eval.ts` | Frontend expression evaluator (mirrors core, for live preview) |

### New Files (Spec 13e)

| File | Responsibility |
|------|---------------|
| `frontend/src/components/token-input/EnhancedTokenInput.tsx` | contentEditable rich input component |
| `frontend/src/components/token-input/EnhancedTokenInput.css` | Styles: syntax highlighting, autocomplete dropdown |
| `frontend/src/components/token-input/expression-highlight.ts` | Parse + render expression as highlighted spans |
| `frontend/src/components/token-input/token-autocomplete.ts` | Autocomplete logic: filtering, positioning, keyboard navigation |
| `frontend/src/components/token-input/__tests__/EnhancedTokenInput.test.tsx` | Component tests |

### New Files (Spec 13c)

| File | Responsibility |
|------|---------------|
| `frontend/src/components/token-binding/TokenBindingIcon.tsx` | Diamond icon component |
| `frontend/src/components/token-binding/TokenPickerPopover.tsx` | Searchable token picker |
| `frontend/src/components/token-binding/TokenPickerPopover.css` | Picker styles |

### Major Modifications

| File | Changes |
|------|---------|
| `crates/core/src/tokens/mod.rs` | Add expression, composite types to token module |
| `crates/core/src/tokens/validate.rs` | New validation constants for expressions |
| `crates/core/src/document.rs` | Token set support in document model |
| `crates/server/src/graphql/mutation.rs` | Expression and composite token mutation support |
| `crates/server/src/graphql/query.rs` | Expression and composite token query support |
| `frontend/src/store/document-store-solid.tsx` | Token set methods, expression-aware token CRUD |
| `frontend/src/store/token-store.ts` | Expression evaluation integration |
| `frontend/src/canvas/renderer.ts` | Expression-aware token resolution |
| `frontend/src/operations/apply-remote.ts` | Token set broadcast handlers |
| `frontend/src/panels/TokensPanel.tsx` | Link to new full editor, updated token display |
| `frontend/src/panels/FillRow.tsx` | Diamond binding icon (13c) |
| `frontend/src/panels/TypographySection.tsx` | Diamond binding icons (13c) |
