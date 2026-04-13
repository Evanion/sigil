# Spec 13 — Token References in Fields

## Overview

Adds design token management UI and token binding to style fields. Users can create, organize, and edit design tokens in a dedicated panel and management window, then bind them to any `StyleValue` field via a diamond icon or right-click menu. Bound fields display resolved values with a visual indicator. Canvas rendering resolves token references to concrete values.

**Depends on:** Spec 01 (core types — TokenContext, StyleValue, Token), Spec 09 (properties panel — fill/stroke/effect editors)

This spec is decomposed into three sub-plans:
- **Plan 13a** — Token store + resolution + canvas rendering (frontend infrastructure)
- **Plan 13b** — Token management UI (panel tab + dedicated window)
- **Plan 13c** — Token binding UX (diamond icon, picker popover, field binding, detach)

---

## 1. Architecture

### 1.1 Three Layers

**Token Store (13a)** — Reactive Solid.js store exposing all document tokens. Loaded from GraphQL alongside pages/nodes. Provides `resolveToken(name): TokenValue | null` that walks alias chains (max depth 16, matching core). Updates reactively when tokens are created/modified/deleted via subscription.

**Token Management (13b)** — Two views:
- **Panel tab** — "Tokens" tab in the left panel alongside Layers and Pages. Grouped list by type (Colors, Spacing, Typography, etc.). Quick add/edit/delete inline. Everyday browsing view.
- **Dedicated window** — Full-width modal/overlay opened via menu or Cmd+Shift+T. Table layout with Name, Type, Value, Description columns. Supports bulk operations, import, expression editing, search/filter. Power-user token management.

**Token Binding (13c)** — Two affordances for binding tokens to style fields:
- **Diamond icon** — small icon next to every tokenizable field. Unfilled (◇) when literal, filled (◆) when bound. Click opens token picker.
- **Right-click menu** — "Bind token..." context menu on any tokenizable field. Fallback for small fields.

### 1.2 Data Flow

```
Token created/edited (panel/window/MCP)
  → store.createToken / updateToken / deleteToken
  → GraphQL applyOperations (AddToken/UpdateToken/RemoveToken)
  → broadcast to other clients
  → token store updated reactively

Field bound to token
  → store.setFills / setTextStyle / etc. (existing mutations)
  → StyleValue changes from Literal to TokenRef { name }
  → canvas renderer resolves TokenRef → concrete value via token store
  → property panel shows resolved value + filled diamond
```

---

## 2. Token Store (Plan 13a)

### 2.1 Frontend Token State

Extend `DocumentState`:
```typescript
interface DocumentState {
  // ... existing ...
  tokens: Record<string, Token>;
}

interface Token {
  readonly name: string;
  readonly type: TokenType;
  readonly value: TokenValue;
  readonly description?: string;
}

type TokenType = "color" | "dimension" | "font_family" | "font_weight" |
  "duration" | "cubic_bezier" | "number" | "shadow" | "gradient" | "typography";
```

### 2.2 Token Resolution

```typescript
function resolveToken(
  tokens: Record<string, Token>,
  name: string,
  maxDepth = 16,
): TokenValue | null {
  let current = name;
  for (let i = 0; i < maxDepth; i++) {
    const token = tokens[current];
    if (!token) return null;
    if (token.value.type === "alias") {
      current = token.value.name;
      continue;
    }
    return token.value;
  }
  return null; // cycle or too deep
}
```

### 2.3 Canvas Resolution

The canvas renderer currently falls back to black/zero for `TokenRef`. With the token store:

```typescript
function resolveStyleValue<T>(
  sv: StyleValue<T>,
  tokens: Record<string, Token>,
  extractor: (value: TokenValue) => T | null,
  fallback: T,
): T {
  if (sv.type === "literal") return sv.value;
  const resolved = resolveToken(tokens, sv.name);
  if (!resolved) return fallback;
  return extractor(resolved) ?? fallback;
}
```

Applied at every `StyleValue` usage point in the renderer: fill colors, stroke colors, text colors, opacities, gradient stop colors, text shadow colors.

### 2.4 GraphQL Token Loading

Tokens are loaded alongside pages in the initial `Pages` query:

```graphql
query Pages {
  pages { ... }
  tokens {
    name
    type
    value
    description
  }
}
```

Or as a separate `Tokens` query if the server doesn't bundle them.

### 2.5 Store Methods

```typescript
interface TokenStoreAPI {
  createToken(name: string, type: TokenType, value: TokenValue, description?: string): void;
  updateToken(name: string, value: TokenValue, description?: string): void;
  deleteToken(name: string): void;
  resolveToken(name: string): TokenValue | null;
}
```

These delegate to the existing core `AddToken`, `UpdateToken`, `RemoveToken` FieldOperations via GraphQL `applyOperations`.

### 2.6 Subscription Handling

Token mutations from other clients arrive via the existing subscription. Add handlers in `apply-remote.ts`:
- `"create_token"` → add to `state.tokens`
- `"update_token"` → update in `state.tokens`
- `"delete_token"` → remove from `state.tokens`

---

## 3. Token Management UI (Plan 13b)

### 3.1 Panel Tab — "Tokens"

New tab in the left panel (alongside Layers, Pages). Register in `register-panels.ts`.

**Layout:**
```
LAYERS | PAGES | TOKENS
─────────────────────────
COLORS                  ▾
  ■ brand/primary  #0066FF
  ■ brand/error    #FF4444
  ■ brand/success  #00CC66

SPACING                 ▾
  ↔ spacing/xs     4px
  ↔ spacing/sm     8px
  ↔ spacing/base   16px
  ↔ spacing/lg     {base}×2

TYPOGRAPHY              ▾
  Aa type/heading  Inter 24/700
  Aa type/body     Inter 16/400

        [+ Add token]
        [Open full editor]
```

**Features:**
- Grouped by token type (collapsible sections)
- Type icon per token (color swatch, dimension arrow, typography "Aa")
- Resolved value displayed inline
- Alias/expression values shown in italic
- Click token → select (show details/edit inline)
- Double-click → inline rename
- Delete via context menu or Delete key
- "+ Add token" button → opens create dialog (name, type, value)
- "Open full editor" link → opens the dedicated window

### 3.2 Dedicated Window

Full-width modal/overlay for power-user token management.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ Design Tokens                    [+ New] [Import]   │
│                                                     │
│ 🔍 Search tokens...          Filter: [All types ▾]  │
│                                                     │
│ ┌───┬────────────────┬───────┬──────────┬─────────┐ │
│ │   │ Name           │ Type  │ Value    │ Desc    │ │
│ ├───┼────────────────┼───────┼──────────┼─────────┤ │
│ │ ■ │ brand/primary  │ Color │ #0066FF  │ Main... │ │
│ │ ■ │ brand/error    │ Color │ #FF4444  │ Error.. │ │
│ │ ↔ │ spacing/base   │ Size  │ 16px     │ Base... │ │
│ │ ↔ │ spacing/lg     │ Size  │ {base}×2 │ Large.. │ │
│ │Aa │ type/heading   │ Type  │ Inter... │ Head... │ │
│ └───┴────────────────┴───────┴──────────┴─────────┘ │
│                                                     │
│ ── Selected Token ──────────────────────────────     │
│ Name: [brand/primary          ]                     │
│ Type: [Color ▾]                                     │
│ Value: [🎨 #0066FF    ] or Expression: [         ]  │
│ Description: [Main brand color               ]      │
│                                [Save] [Delete]      │
└─────────────────────────────────────────────────────┘
```

**Features:**
- Sortable table by name, type
- Search/filter by name or type
- Click row → select, shows detail editor below
- Detail editor: name input, type dropdown, value editor (contextual — color picker for colors, number input for dimensions), expression field, description textarea
- "+ New" button → adds empty row in detail editor
- "Import" button → paste JSON (W3C Design Tokens format) — future, stub for now
- Keyboard: Arrow Up/Down navigate, Enter opens detail, Delete removes
- Accessible: `role="grid"` with proper ARIA

### 3.3 Token Type Categories

Map CSS value classes to token types:

| Token Type | CSS Equivalent | Value Editor |
|-----------|---------------|-------------|
| Color | `<color>` | Color picker (existing) |
| Dimension | `<length>`, `<percentage>` | Number + unit dropdown (px, rem, em, %) |
| Number | `<number>` | Number input |
| Font Family | `<family-name>` | Text input (comma-separated list) |
| Font Weight | `<font-weight>` | Number input (100-900) or select |
| Duration | `<time>` | Number + unit (s, ms) |
| Cubic Bezier | `<easing-function>` | 4 number inputs (control points) |
| Shadow | `<shadow>` | Composite (color + offset + blur + spread) |
| Gradient | `<gradient>` | Gradient editor (existing) |
| Typography | composite | Font family + size + weight + line-height + letter-spacing |

### 3.4 Token Naming Convention

Hierarchical names with `/` separator: `category/subcategory/name`.

Examples:
- `color/brand/primary`
- `color/neutral/100`
- `spacing/xs`
- `type/heading/h1`

Validated by existing `validate_token_name()` in core.

---

## 4. Token Binding UX (Plan 13c)

### 4.1 Diamond Binding Icon

Every `StyleValue` field in the properties panel gets a diamond icon:
- **Unfilled (◇)** — field has a literal value, no token bound
- **Filled (◆)** — field is bound to a token
- **Color:** accent blue when bound, muted gray when unbound

Click unfilled diamond → opens token picker popover filtered to compatible types.
Click filled diamond → opens popover showing token name + "Detach" button.

### 4.2 Right-Click Binding

Right-click on any tokenizable field → context menu with:
- "Bind token..." → opens token picker
- "Detach token" (only when bound) → converts to literal with current resolved value

### 4.3 Token Picker Popover

A searchable, filtered list of compatible tokens:

```
┌──────────────────────────┐
│ 🔍 Search tokens...      │
│                          │
│ brand/primary     ■      │
│ brand/error       ■      │
│ brand/success     ■      │
│ neutral/100       ■      │
│ neutral/200       ■      │
│                          │
│ [Create new token...]    │
└──────────────────────────┘
```

**Filtering:** Only shows tokens whose type is compatible with the field:
- Color fields → Color tokens
- Dimension fields → Dimension + Number tokens
- Opacity → Number tokens (0-1 range)
- Font family → Font Family tokens
- Font weight → Font Weight + Number tokens

**Selection:** Click a token → binds it. The field's `StyleValue` changes from `Literal { value }` to `TokenRef { name }`.

### 4.4 Bound Field Display

When a field is bound to a token:
1. The field shows the **resolved value** (not the token name) — so designers see the actual color/size/weight
2. The diamond icon is **filled and accent-colored**
3. Below the field (or on hover), the **token name** is shown: `↳ brand/primary`
4. The field has a **left accent border** (subtle blue) to distinguish it from literal values
5. Editing the literal value **detaches** the token (converts back to Literal)

### 4.5 Detach

Clicking the filled diamond shows a popover:
```
┌─────────────────────────┐
│ brand/primary            │
│ Resolved: #0066FF        │
│                          │
│ [Change token] [Detach]  │
└─────────────────────────┘
```

"Detach" converts `TokenRef { name }` to `Literal { value: resolvedValue }`.
"Change token" opens the token picker to rebind.

---

## 5. Input Validation

- **Token name:** Validated by existing `validate_token_name()` — alphanumeric + `/._-`, max length
- **Token value:** Validated by existing `validate_token_value()` per type
- **Alias cycle detection:** Max depth 16 (existing `MAX_ALIAS_CHAIN_DEPTH`)
- **Token count:** Max `MAX_TOKENS_PER_CONTEXT` (existing)
- **All frontend token resolution:** guarded with null checks, falls back to defaults

---

## 6. Consistency Guarantees

- **Token CRUD atomicity:** Each token operation (add/update/delete) is a single `FieldOperation` applied atomically
- **Binding atomicity:** Binding a token changes the `StyleValue` via the existing `setFills`/`setTextStyle`/etc. — same atomicity as literal edits
- **Cascading updates:** When a token's value changes, all fields bound to it update reactively (the store triggers re-renders). No explicit "propagate" needed.
- **Detach preserves value:** Detaching snapshots the current resolved value into a Literal, so the field doesn't change visually

---

## 7. WASM Compatibility

No core crate changes needed. Token types, resolution, and commands already exist. This spec is frontend-only infrastructure + UI.

---

## 8. Recursion Safety

Token alias resolution uses the existing `resolveToken` with `MAX_ALIAS_CHAIN_DEPTH = 16`. No new recursive algorithms.

---

## 9. PDR Traceability

**Implements:**
- PDR §3.5 "Design tokens" — token binding to style fields, token management UI
- PDR §4.3 "Token management" — create, edit, delete, organize tokens

**Defers:**
- Token export (CSS/Tailwind) — moved to M4 as plugins
- Token import (W3C Design Tokens format) — stub button in UI, full import in follow-up
- Token expressions beyond aliases — future enhancement (the UI shows the expression field, but parsing/evaluation is a separate spec)

---

## 10. File Structure

### New files (Plan 13a)
| File | Responsibility |
|------|---------------|
| `frontend/src/store/token-store.ts` | Token resolution + store helpers |

### New files (Plan 13b)
| File | Responsibility |
|------|---------------|
| `frontend/src/panels/TokensPanel.tsx` | Left panel "Tokens" tab |
| `frontend/src/panels/TokensPanel.css` | Token panel styles |
| `frontend/src/panels/TokenRow.tsx` | Single token row in the panel |
| `frontend/src/panels/TokenEditorWindow.tsx` | Dedicated full-width token editor |
| `frontend/src/panels/TokenEditorWindow.css` | Editor window styles |
| `frontend/src/panels/TokenDetailEditor.tsx` | Token detail form (name, type, value, description) |

### New files (Plan 13c)
| File | Responsibility |
|------|---------------|
| `frontend/src/components/token-binding/TokenBindingIcon.tsx` | Diamond icon component |
| `frontend/src/components/token-binding/TokenPickerPopover.tsx` | Searchable token picker |
| `frontend/src/components/token-binding/TokenPickerPopover.css` | Picker styles |

### Major modifications
| File | Changes |
|------|---------|
| `frontend/src/store/document-store-solid.tsx` | Add token store methods, load tokens from GraphQL |
| `frontend/src/store/document-store-types.ts` | Add TokenStoreAPI |
| `frontend/src/canvas/renderer.ts` | Resolve TokenRef via token store |
| `frontend/src/panels/register-panels.ts` | Register Tokens tab |
| `frontend/src/panels/FillRow.tsx` | Add diamond binding icon |
| `frontend/src/panels/TypographySection.tsx` | Add diamond binding icons |
| `frontend/src/operations/apply-remote.ts` | Add token create/update/delete handlers |
| `frontend/src/graphql/queries.ts` | Add tokens to Pages query |
| `frontend/src/i18n/locales/*/panels.json` | Token management + binding strings |
