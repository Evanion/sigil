# Token Management UI Implementation Plan (13b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the token management UI — a "Tokens" panel tab in the left panel for browsing/inline editing, and a dedicated full-width token editor window for bulk management.

**Architecture:** The Tokens panel follows the PagesPanel pattern (left panel tab, grouped list, CRUD inline). The dedicated window is a modal overlay with a sortable table, search/filter, and a detail editor form. Both views use the existing token store methods (createToken, updateToken, deleteToken from 13a). Token type classification determines which value editor appears (color picker for colors, number input for dimensions, etc.).

**Tech Stack:** TypeScript/Solid.js, Kobalte (popover, dialog), Vitest

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `frontend/src/panels/TokensPanel.tsx` | Left panel "Tokens" tab — grouped list |
| `frontend/src/panels/TokensPanel.css` | Token panel styles |
| `frontend/src/panels/TokenRow.tsx` | Single token row (icon, name, value preview, actions) |
| `frontend/src/panels/TokenRow.css` | Token row styles |
| `frontend/src/panels/TokenEditorWindow.tsx` | Full-width modal token editor |
| `frontend/src/panels/TokenEditorWindow.css` | Editor window styles |
| `frontend/src/panels/TokenDetailEditor.tsx` | Token detail form (name, type, value, description) |
| `frontend/src/panels/TokenDetailEditor.css` | Detail editor styles |
| `frontend/src/panels/__tests__/TokensPanel.test.tsx` | Panel tests |
| `frontend/src/panels/__tests__/TokenEditorWindow.test.tsx` | Editor window tests |

### Major modifications
| File | Changes |
|------|---------|
| `frontend/src/panels/register-panels.ts` | Register "Tokens" tab |
| `frontend/src/i18n/locales/en/panels.json` | Token management strings |
| `frontend/src/i18n/locales/es/panels.json` | Spanish token strings |
| `frontend/src/i18n/locales/fr/panels.json` | French token strings |

---

## Task 1: TokenRow component

**Files:**
- Create: `frontend/src/panels/TokenRow.tsx`
- Create: `frontend/src/panels/TokenRow.css`

- [ ] **Step 1: Implement TokenRow**

A single token row showing: type icon, name, resolved value preview, actions.

```typescript
interface TokenRowProps {
  readonly token: Token;
  readonly isSelected: boolean;
  readonly onSelect: (name: string) => void;
  readonly onRename: (name: string, newName: string) => void;
  readonly onDelete: (name: string) => void;
  readonly onEdit: (name: string) => void;
  readonly isFocused: boolean;
  readonly tabIndex: number;
  readonly requestRename?: boolean;
  readonly onRenameStarted?: () => void;
}
```

Type icon mapping:
- Color → small color swatch (filled square)
- Dimension/Number → "↔" or ruler icon
- Font Family → "Aa" text
- Typography → "Aa" styled text
- Shadow → shadow icon
- Gradient → small gradient swatch
- Other → generic dot

Value preview:
- Color → hex string (#0066FF)
- Dimension → value + unit (16px)
- Number → raw value
- Font Family → first family name
- Typography → font + size/weight summary
- Alias → italic `{aliased-name}`

Row supports:
- Click → select
- Double-click → open detail editor
- F2 → inline rename (via requestRename prop)
- Delete key → delete (via parent keyboard handler)
- `role="option"` with `aria-selected`

- [ ] **Step 2: Add styles with CSS custom properties**

- [ ] **Step 3: Commit**

```
feat(frontend): add TokenRow component (Spec 13b, Task 1)
```

---

## Task 2: TokensPanel — left panel tab

**Files:**
- Create: `frontend/src/panels/TokensPanel.tsx`
- Create: `frontend/src/panels/TokensPanel.css`
- Modify: `frontend/src/panels/register-panels.ts`

- [ ] **Step 1: Register the Tokens tab**

In `register-panels.ts`:
```typescript
registerPanel({
  id: "tokens",
  label: "panels:tabs.tokens",
  region: "left",
  order: 2,  // after layers (0), pages (1)
  component: TokensPanel,
});
```

- [ ] **Step 2: Implement TokensPanel**

Follow PagesPanel structure:

```typescript
export const TokensPanel: Component = () => {
  const store = useDocument();
  const [t] = useTransContext();
  const [selectedTokenName, setSelectedTokenName] = createSignal<string | null>(null);
  const [renameRequestName, setRenameRequestName] = createSignal<string | null>(null);

  // Group tokens by type
  const tokensByType = createMemo(() => {
    const groups: Record<string, Token[]> = {};
    for (const token of Object.values(store.state.tokens)) {
      const type = token.token_type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(token);
    }
    // Sort groups by type name, tokens within groups by name
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, tokens]) => ({
        type,
        tokens: tokens.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  });

  // ... CRUD handlers delegating to store methods
  // ... keyboard navigation (Arrow, F2, Delete, Enter)

  return (
    <div class="sigil-tokens-panel" role="region" aria-label={t("panels:tokens.title")}>
      <div class="sigil-tokens-panel__header">
        <h3>{t("panels:tokens.title")}</h3>
        <button aria-label={t("panels:tokens.addToken")} onClick={handleAddToken}>
          <Plus size={16} />
        </button>
      </div>
      <div role="listbox" aria-label={t("panels:tokens.tokenList")} onKeyDown={handleKeyDown}>
        <For each={tokensByType()}>
          {(group) => (
            <>
              <div class="sigil-tokens-panel__group-header">{tokenTypeLabel(group.type)}</div>
              <Index each={group.tokens}>
                {(token) => <TokenRow token={token()} ... />}
              </Index>
            </>
          )}
        </For>
        <Show when={Object.keys(store.state.tokens).length === 0}>
          <div class="sigil-tokens-panel__empty">{t("panels:tokens.noTokens")}</div>
        </Show>
      </div>
      <button class="sigil-tokens-panel__editor-link" onClick={openEditorWindow}>
        {t("panels:tokens.openEditor")}
      </button>
    </div>
  );
};
```

- [ ] **Step 3: Add "+" button that opens a create token dialog**

When clicking "+", open a small popover or inline form asking for: name, type (dropdown). Create token with a default value for the selected type (e.g., black for Color, 16 for Dimension).

- [ ] **Step 4: Add keyboard navigation**

Arrow Up/Down, F2 rename, Delete, Enter to open detail editor.

- [ ] **Step 5: Add styles**

- [ ] **Step 6: Commit**

```
feat(frontend): add TokensPanel with grouped list (Spec 13b, Task 2)
```

---

## Task 3: TokenDetailEditor — value editing form

**Files:**
- Create: `frontend/src/panels/TokenDetailEditor.tsx`
- Create: `frontend/src/panels/TokenDetailEditor.css`

- [ ] **Step 1: Implement TokenDetailEditor**

A form component for editing a token's properties:

```typescript
interface TokenDetailEditorProps {
  token: Token;
  onUpdate: (name: string, value: TokenValue, description?: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}
```

Layout:
- Name (read-only text — rename happens inline in the list)
- Type badge (read-only — type is set at creation)
- Value editor (contextual based on type):
  - Color → ColorSwatch that opens ColorPicker
  - Dimension → NumberInput + unit dropdown (px, rem, em, %)
  - Number → NumberInput
  - Font Family → text input (comma-separated)
  - Font Weight → NumberInput (100-900) or select
  - Duration → NumberInput + unit (s, ms)
  - Shadow → composite (color + offsetX + offsetY + blur + spread)
  - Gradient → GradientEditorPopover trigger
  - Typography → composite (family, size, weight, line-height, letter-spacing)
  - Alias → text input for referenced token name
- Description → textarea (max 256 chars)
- Delete button
- Save button (or auto-save on blur)

- [ ] **Step 2: Implement type-specific value editors**

Use existing components where possible:
- `ColorSwatch` + `ColorPicker` for color tokens
- `NumberInput` for numeric tokens
- `GradientEditorPopover` for gradient tokens

For composite types (Shadow, Typography), render multiple inputs in a grouped layout.

- [ ] **Step 3: Add styles**

- [ ] **Step 4: Commit**

```
feat(frontend): add TokenDetailEditor with type-specific value editors (Spec 13b, Task 3)
```

---

## Task 4: TokenEditorWindow — dedicated full-width editor

**Files:**
- Create: `frontend/src/panels/TokenEditorWindow.tsx`
- Create: `frontend/src/panels/TokenEditorWindow.css`

- [ ] **Step 1: Implement TokenEditorWindow**

A modal overlay (or full-width panel) with:
- Header: title + "New" button + "Import" button (stub)
- Search input for filtering by name
- Type filter dropdown
- Sortable table: Name, Type, Value, Description
- Selected row expands to show TokenDetailEditor below the table
- Keyboard: Escape closes, Arrow navigate, Enter selects

```typescript
interface TokenEditorWindowProps {
  isOpen: boolean;
  onClose: () => void;
}
```

Use Kobalte `Dialog` for the modal overlay:
```tsx
<Dialog open={props.isOpen} onOpenChange={(open) => { if (!open) props.onClose(); }}>
  <Dialog.Portal>
    <Dialog.Overlay class="sigil-token-editor-overlay" />
    <Dialog.Content class="sigil-token-editor-window">
      {/* header, search, table, detail editor */}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog>
```

- [ ] **Step 2: Add table with sorting**

Clickable column headers for Name and Type sort. Token rows rendered with `<Index>`.

- [ ] **Step 3: Add search/filter**

Text input filters tokens by name (case-insensitive substring match). Type dropdown filters by token_type.

- [ ] **Step 4: Wire detail editor below table**

When a row is selected, TokenDetailEditor appears below the table showing the selected token's details.

- [ ] **Step 5: Add "New" button**

Opens a create form (similar to the panel's "+" but with more space for all fields).

- [ ] **Step 6: Add styles and accessibility**

Modal: `role="dialog"`, `aria-label`, focus trap. Table: `role="grid"`, sortable headers.

- [ ] **Step 7: Commit**

```
feat(frontend): add TokenEditorWindow with search, sort, and detail editing (Spec 13b, Task 4)
```

---

## Task 5: Wire editor window into the app + i18n

**Files:**
- Modify: `frontend/src/panels/TokensPanel.tsx`
- Modify: `frontend/src/App.tsx` (or shell)
- Modify: `frontend/src/i18n/locales/en/panels.json`
- Modify: `frontend/src/i18n/locales/es/panels.json`
- Modify: `frontend/src/i18n/locales/fr/panels.json`

- [ ] **Step 1: Add editor window open/close signal**

The "Open full editor" button in TokensPanel and Cmd+Shift+T keyboard shortcut toggle the editor window.

- [ ] **Step 2: Add all i18n strings**

```json
"tokens": {
  "title": "Tokens",
  "addToken": "Add token",
  "tokenList": "Token list",
  "noTokens": "No tokens yet",
  "openEditor": "Open full editor",
  "editorTitle": "Design Tokens",
  "search": "Search tokens...",
  "filterAll": "All types",
  "newToken": "New token",
  "import": "Import",
  "name": "Name",
  "type": "Type",
  "value": "Value",
  "description": "Description",
  "save": "Save",
  "typeColor": "Color",
  "typeDimension": "Dimension",
  "typeNumber": "Number",
  "typeFontFamily": "Font Family",
  "typeFontWeight": "Font Weight",
  "typeDuration": "Duration",
  "typeCubicBezier": "Cubic Bezier",
  "typeShadow": "Shadow",
  "typeGradient": "Gradient",
  "typeTypography": "Typography",
  "deleteConfirm": "Delete {{name}}?",
  "tokenCreated": "Token {{name}} created",
  "tokenUpdated": "Token {{name}} updated",
  "tokenDeleted": "Token {{name}} deleted"
}
```

Add corresponding Spanish and French translations.

- [ ] **Step 3: Commit**

```
feat(frontend): wire token editor window and add i18n strings (Spec 13b, Task 5)
```

---

## Task 6: Tests

**Files:**
- Create: `frontend/src/panels/__tests__/TokensPanel.test.tsx`
- Create: `frontend/src/panels/__tests__/TokenEditorWindow.test.tsx`

- [ ] **Step 1: TokensPanel tests**

- Renders token list grouped by type
- Shows "No tokens" when empty
- "+" button calls createToken
- Selected token has aria-selected
- Keyboard: F2 triggers rename, Delete calls deleteToken
- ArrowDown/Up navigates between tokens

- [ ] **Step 2: TokenEditorWindow tests**

- Opens as modal dialog
- Search filters tokens by name
- Type filter shows only matching tokens
- Selecting a row shows detail editor
- "New" button opens create form

- [ ] **Step 3: Run full tests and commit**

```
test(frontend): add TokensPanel and TokenEditorWindow tests (Spec 13b, Task 6)
```

---

## Task 7: Integration verification

- [ ] **Step 1: Run full test suites**
- [ ] **Step 2: Browser test**

- Open app → click "Tokens" tab → see empty state
- Click "+" → create a Color token "brand/primary" with #0066FF
- Token appears in the grouped list under "Color"
- Click "Open full editor" → modal opens with table view
- Search for "brand" → filters to show only matching tokens
- Select the token → detail editor shows color picker
- Change color → token updates
- Close modal → token persists
- Create a Dimension token "spacing/base" with 16px
- Verify it appears under "Dimension" group

---

## Dependency Graph

```
Task 1 (TokenRow) → Task 2 (TokensPanel)
Task 3 (TokenDetailEditor) → Task 4 (TokenEditorWindow)
Task 2 + Task 4 → Task 5 (wiring + i18n)
Task 5 → Task 6 (tests)
All → Task 7 (verification)
```

Tasks 1+3 are independent starting points.
