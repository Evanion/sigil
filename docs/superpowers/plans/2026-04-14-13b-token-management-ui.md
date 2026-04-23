# Token Management UI (Spec 13b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the basic token editor dialog with a three-pane styleguide-inspired token management UI featuring category navigation, type-specific visual previews, and a side-panel detail editor.

**Architecture:** A full-screen `<dialog>` with three panes: left navigation (search + category filter), middle styleguide view (type-specific token renderers dispatched by category), and right detail editor (adapted from existing TokenDetailEditor). The existing TokensPanel quick-access tab remains unchanged. All token CRUD uses existing store API — no backend changes needed.

**Tech Stack:** Solid.js, CSS (no new dependencies), existing Dialog/Popover/ColorPicker/NumberInput components, existing token store API, i18next for localization.

**Scope note:** Token sets (theming) are deferred to Spec 13d — they require core crate changes. This plan covers the UI layout, type-specific renderers, and wiring. The left pane's "Token Sets" section shows a placeholder "Global" label until 13d ships.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `frontend/src/panels/token-editor/TokenEditor.tsx` | Three-pane dialog shell (left, middle, right) |
| `frontend/src/panels/token-editor/TokenEditor.css` | Layout + styling for all three panes |
| `frontend/src/panels/token-editor/TokenNavigationPane.tsx` | Left pane: search, category filter, create button |
| `frontend/src/panels/token-editor/TokenStyleguideView.tsx` | Middle pane: dispatches to type-specific renderer |
| `frontend/src/panels/token-editor/TokenDetailPane.tsx` | Right pane: selected token detail editor |
| `frontend/src/panels/token-editor/TokenColorGrid.tsx` | Color token card grid |
| `frontend/src/panels/token-editor/TokenSpacingList.tsx` | Spacing/dimension token bar visualization |
| `frontend/src/panels/token-editor/TokenTypographyList.tsx` | Typography token live preview |
| `frontend/src/panels/token-editor/TokenPreviewCard.tsx` | Generic preview for shadow/border/other types |
| `frontend/src/panels/token-editor/token-grouping.ts` | Utility: group tokens by dot-name hierarchy |
| `frontend/src/panels/token-editor/__tests__/token-grouping.test.ts` | Tests for grouping utility |
| `frontend/src/panels/token-editor/__tests__/TokenEditor.test.tsx` | Integration test for the three-pane editor |

### Modified files

| File | Changes |
|------|---------|
| `frontend/src/panels/token-editor-context.tsx` | Update to use new editor component |
| `frontend/src/panels/TokensPanel.tsx` | Keep as-is (already links to editor via context) |
| `frontend/src/i18n/locales/en/panels.json` | Add new i18n keys for styleguide editor |
| `frontend/src/i18n/locales/es/panels.json` | Add corresponding Spanish keys |
| `frontend/src/i18n/locales/fr/panels.json` | Add corresponding French keys |
| `frontend/src/shell/App.tsx` | Swap TokenEditorWindow for TokenEditor import |

### Superseded files (delete after wiring)

| File | Reason |
|------|--------|
| `frontend/src/panels/TokenEditorWindow.tsx` | Replaced by TokenEditor |
| `frontend/src/panels/TokenEditorWindow.css` | Replaced by TokenEditor.css |

---

### Task 1: Token grouping utility + i18n keys

**Files:**
- Create: `frontend/src/panels/token-editor/token-grouping.ts`
- Create: `frontend/src/panels/token-editor/__tests__/token-grouping.test.ts`
- Modify: `frontend/src/i18n/locales/en/panels.json`
- Modify: `frontend/src/i18n/locales/es/panels.json`
- Modify: `frontend/src/i18n/locales/fr/panels.json`

- [ ] **Step 1: Write the failing test for groupTokensByHierarchy**

```typescript
// frontend/src/panels/token-editor/__tests__/token-grouping.test.ts
import { describe, it, expect } from "vitest";
import { groupTokensByHierarchy } from "../token-grouping";
import type { Token } from "../../../types/document";

function makeToken(name: string, type: string = "color"): Token {
  return {
    name,
    token_type: type as Token["token_type"],
    value: { type: "color", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
  };
}

describe("groupTokensByHierarchy", () => {
  it("groups tokens by their dot-separated prefix", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary"),
      "brand.error": makeToken("brand.error"),
      "action.primary": makeToken("action.primary"),
      "button.bg.default": makeToken("button.bg.default"),
    };
    const groups = groupTokensByHierarchy(tokens, "color");
    expect(groups.length).toBeGreaterThanOrEqual(3);
    // First group should be "brand" with 2 tokens
    const brand = groups.find((g) => g.label === "brand");
    expect(brand).toBeDefined();
    expect(brand!.tokenNames).toEqual(["brand.error", "brand.primary"]);
  });

  it("filters by token type", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary", "color"),
      "spacing.md": makeToken("spacing.md", "dimension"),
    };
    const groups = groupTokensByHierarchy(tokens, "color");
    const allNames = groups.flatMap((g) => g.tokenNames);
    expect(allNames).toContain("brand.primary");
    expect(allNames).not.toContain("spacing.md");
  });

  it("handles tokens with no dot separator", () => {
    const tokens: Record<string, Token> = {
      primary: makeToken("primary"),
    };
    const groups = groupTokensByHierarchy(tokens, "color");
    expect(groups.length).toBe(1);
    expect(groups[0].label).toBe("ungrouped");
    expect(groups[0].tokenNames).toEqual(["primary"]);
  });

  it("handles search filter", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary"),
      "brand.error": makeToken("brand.error"),
      "neutral.100": makeToken("neutral.100"),
    };
    const groups = groupTokensByHierarchy(tokens, "color", "prim");
    const allNames = groups.flatMap((g) => g.tokenNames);
    expect(allNames).toContain("brand.primary");
    expect(allNames).not.toContain("brand.error");
    expect(allNames).not.toContain("neutral.100");
  });

  it("returns empty array when no tokens match", () => {
    const groups = groupTokensByHierarchy({}, "color");
    expect(groups).toEqual([]);
  });

  it("sorts groups alphabetically and token names within groups", () => {
    const tokens: Record<string, Token> = {
      "z.beta": makeToken("z.beta"),
      "a.alpha": makeToken("a.alpha"),
      "z.alpha": makeToken("z.alpha"),
      "a.beta": makeToken("a.beta"),
    };
    const groups = groupTokensByHierarchy(tokens, "color");
    expect(groups[0].label).toBe("a");
    expect(groups[1].label).toBe("z");
    expect(groups[0].tokenNames).toEqual(["a.alpha", "a.beta"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev.sh pnpm --prefix frontend test -- --run src/panels/token-editor/__tests__/token-grouping.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement groupTokensByHierarchy**

```typescript
// frontend/src/panels/token-editor/token-grouping.ts
/**
 * Groups tokens by their dot-separated prefix for the styleguide view.
 *
 * Given tokens like "brand.primary", "brand.error", "action.primary",
 * produces groups: [{label: "action", tokenNames: [...]}, {label: "brand", tokenNames: [...]}]
 *
 * Tokens without a dot separator go into the "ungrouped" group.
 */
import type { Token, TokenType } from "../../types/document";

export interface TokenGroup {
  /** The first segment of the dot-separated name, or "ungrouped". */
  readonly label: string;
  /** Sorted array of full token names in this group. */
  readonly tokenNames: readonly string[];
}

/**
 * Group tokens by dot-separated prefix, filtered by type and optional search query.
 * Groups and names within groups are sorted alphabetically.
 */
export function groupTokensByHierarchy(
  tokens: Record<string, Token>,
  typeFilter: TokenType | "",
  searchQuery: string = "",
): readonly TokenGroup[] {
  const groups = new Map<string, string[]>();
  const query = searchQuery.toLowerCase();

  for (const name of Object.keys(tokens)) {
    const token = tokens[name];
    if (!token) continue;

    // Type filter
    if (typeFilter !== "" && token.token_type !== typeFilter) continue;

    // Search filter
    if (query.length > 0 && !name.toLowerCase().includes(query)) continue;

    // Group by first dot segment
    const dotIndex = name.indexOf(".");
    const groupLabel = dotIndex > 0 ? name.substring(0, dotIndex) : "ungrouped";

    let group = groups.get(groupLabel);
    if (!group) {
      group = [];
      groups.set(groupLabel, group);
    }
    group.push(name);
  }

  // Sort groups alphabetically, names within groups alphabetically
  const sortedLabels = [...groups.keys()].sort((a, b) => {
    // "ungrouped" always last
    if (a === "ungrouped") return 1;
    if (b === "ungrouped") return -1;
    return a.localeCompare(b);
  });

  return sortedLabels.map((label) => ({
    label,
    tokenNames: groups.get(label)!.sort(),
  }));
}

/**
 * Count tokens per type category. Returns a Map<TokenType, number>.
 */
export function countTokensByType(
  tokens: Record<string, Token>,
): Map<TokenType, number> {
  const counts = new Map<TokenType, number>();
  for (const name of Object.keys(tokens)) {
    const token = tokens[name];
    if (!token) continue;
    counts.set(token.token_type, (counts.get(token.token_type) ?? 0) + 1);
  }
  return counts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev.sh pnpm --prefix frontend test -- --run src/panels/token-editor/__tests__/token-grouping.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Add i18n keys for the styleguide editor**

Add the following keys to the `tokens` object in `frontend/src/i18n/locales/en/panels.json`:

```json
"styleguide": "Styleguide",
"categoryAll": "All Categories",
"categoryColors": "Colors",
"categorySpacing": "Spacing",
"categoryTypography": "Typography",
"categoryShadows": "Shadows",
"categoryOther": "Other",
"tokenSets": "Token Sets",
"globalSet": "Global",
"resolvedValue": "Resolved value",
"dependsOn": "Depends on",
"referencedBy": "Referenced by",
"duplicate": "Duplicate",
"noSelection": "Select a token to edit",
"tokenCount": "{{count}} tokens",
"ungrouped": "Ungrouped",
"import": "Import"
```

Add equivalent keys to `es/panels.json` and `fr/panels.json` with translated values.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/token-editor/token-grouping.ts \
       frontend/src/panels/token-editor/__tests__/token-grouping.test.ts \
       frontend/src/i18n/locales/en/panels.json \
       frontend/src/i18n/locales/es/panels.json \
       frontend/src/i18n/locales/fr/panels.json
git commit -m "feat(frontend): add token grouping utility and i18n keys for styleguide editor (spec-13b)"
```

---

### Task 2: TokenNavigationPane (left pane)

**Files:**
- Create: `frontend/src/panels/token-editor/TokenNavigationPane.tsx`

**Context:** This is the left sidebar of the three-pane editor. It shows a search field, a category list (Colors, Spacing, Typography, etc.) with token counts, and a "New Token" button. Clicking a category updates the middle pane.

- [ ] **Step 1: Create TokenNavigationPane component**

```typescript
// frontend/src/panels/token-editor/TokenNavigationPane.tsx
/**
 * Left navigation pane for the token styleguide editor.
 *
 * Shows:
 * - Search field to filter tokens by name
 * - Category list (token types) with token counts
 * - "+ New Token" button
 *
 * The "Token Sets" section shows a static "Global" label
 * until Spec 13d adds token set support.
 */
import { createMemo, Index, type Component, splitProps } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { TOKEN_TYPES, TOKEN_TYPE_I18N_KEYS } from "../token-helpers";
import { countTokensByType } from "./token-grouping";
import type { Token, TokenType } from "../../types/document";

export interface TokenNavigationPaneProps {
  readonly tokens: Record<string, Token>;
  readonly selectedCategory: TokenType | "";
  readonly onCategoryChange: (category: TokenType | "") => void;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly onCreateToken: () => void;
}

/** Categories shown in the navigation — a subset of TOKEN_TYPES grouped for UX. */
const CATEGORY_TYPES: readonly TokenType[] = [
  "color",
  "dimension",
  "typography",
  "shadow",
  "number",
  "font_family",
  "font_weight",
  "gradient",
  "duration",
  "cubic_bezier",
];

export const TokenNavigationPane: Component<TokenNavigationPaneProps> = (rawProps) => {
  const [props] = splitProps(rawProps, [
    "tokens",
    "selectedCategory",
    "onCategoryChange",
    "searchQuery",
    "onSearchChange",
    "onCreateToken",
  ]);
  const [t] = useTransContext();

  const typeCounts = createMemo(() => countTokensByType(props.tokens));
  const totalCount = createMemo(() => {
    let sum = 0;
    for (const count of typeCounts().values()) {
      sum += count;
    }
    return sum;
  });

  return (
    <nav
      class="sigil-token-nav"
      role="navigation"
      aria-label={t("panels:tokens.title")}
    >
      {/* Search */}
      <input
        class="sigil-token-nav__search"
        type="text"
        placeholder={t("panels:tokens.search")}
        value={props.searchQuery}
        onInput={(e) => props.onSearchChange(e.currentTarget.value)}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={t("panels:tokens.search")}
      />

      {/* Token Sets — static "Global" until 13d */}
      <div class="sigil-token-nav__section">
        <div class="sigil-token-nav__section-label">
          {t("panels:tokens.tokenSets")}
        </div>
        <div
          class="sigil-token-nav__set-item sigil-token-nav__set-item--active"
          aria-current="true"
        >
          {t("panels:tokens.globalSet")}
        </div>
      </div>

      <div class="sigil-token-nav__divider" />

      {/* Category filter */}
      <div class="sigil-token-nav__section">
        <button
          class="sigil-token-nav__category"
          classList={{ "sigil-token-nav__category--active": props.selectedCategory === "" }}
          onClick={() => props.onCategoryChange("")}
        >
          <span class="sigil-token-nav__category-label">
            {t("panels:tokens.categoryAll")}
          </span>
          <span class="sigil-token-nav__category-count">{totalCount()}</span>
        </button>
        <Index each={CATEGORY_TYPES}>
          {(type) => {
            const count = () => typeCounts().get(type()) ?? 0;
            return (
              <button
                class="sigil-token-nav__category"
                classList={{
                  "sigil-token-nav__category--active": props.selectedCategory === type(),
                  "sigil-token-nav__category--empty": count() === 0,
                }}
                onClick={() => props.onCategoryChange(type())}
                disabled={count() === 0}
              >
                <span class="sigil-token-nav__category-label">
                  {t(TOKEN_TYPE_I18N_KEYS[type()])}
                </span>
                <span class="sigil-token-nav__category-count">{count()}</span>
              </button>
            );
          }}
        </Index>
      </div>

      <div class="sigil-token-nav__divider" />

      {/* Create button */}
      <button
        class="sigil-token-nav__create-button"
        onClick={props.onCreateToken}
      >
        {t("panels:tokens.newToken")}
      </button>
    </nav>
  );
};
```

- [ ] **Step 2: Run lint to verify no errors**

Run: `./dev.sh pnpm --prefix frontend lint`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/token-editor/TokenNavigationPane.tsx
git commit -m "feat(frontend): add TokenNavigationPane for styleguide editor left pane (spec-13b)"
```

---

### Task 3: TokenColorGrid + TokenSpacingList (type renderers)

**Files:**
- Create: `frontend/src/panels/token-editor/TokenColorGrid.tsx`
- Create: `frontend/src/panels/token-editor/TokenSpacingList.tsx`

**Context:** These render tokens of specific types in the middle pane. Colors show as a responsive card grid with swatches. Spacing/dimension tokens show as horizontal bars with proportional widths.

- [ ] **Step 1: Create TokenColorGrid component**

```typescript
// frontend/src/panels/token-editor/TokenColorGrid.tsx
/**
 * Renders color tokens as a responsive card grid with swatches.
 *
 * Each card shows: color swatch (top), token name, resolved hex value.
 * Alias tokens show the reference name in italic.
 * Clicking a card selects it.
 */
import { Index, Show, type Component, splitProps, createMemo } from "solid-js";
import { buildValuePreview } from "../TokenRow";
import type { Token, Color } from "../../types/document";

export interface TokenColorGridProps {
  readonly tokenNames: readonly string[];
  readonly tokens: Record<string, Token>;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

/** Convert sRGB Color to CSS color string. Guards NaN per CLAUDE.md. */
function colorToCss(color: Color): string {
  if (color.space !== "srgb") return "var(--text-3)";
  const r = Number.isFinite(color.r) ? Math.round(color.r * 255) : 0;
  const g = Number.isFinite(color.g) ? Math.round(color.g * 255) : 0;
  const b = Number.isFinite(color.b) ? Math.round(color.b * 255) : 0;
  const a = Number.isFinite(color.a) ? color.a : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Extract the short name (after last dot) for display in cards. */
function shortName(fullName: string): string {
  const lastDot = fullName.lastIndexOf(".");
  return lastDot >= 0 ? fullName.substring(lastDot + 1) : fullName;
}

export const TokenColorGrid: Component<TokenColorGridProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);

  return (
    <div class="sigil-token-color-grid" role="listbox" aria-label="Color tokens">
      <Index each={props.tokenNames}>
        {(name) => {
          const token = createMemo(() => props.tokens[name()]);
          const isAlias = () => token()?.value.type === "alias";
          const swatchColor = (): string => {
            const tok = token();
            if (!tok) return "var(--text-3)";
            if (tok.value.type === "color") return colorToCss(tok.value.value);
            return "var(--text-3)";
          };

          return (
            <Show when={token()}>
              <div
                class="sigil-token-color-grid__card"
                classList={{
                  "sigil-token-color-grid__card--selected": props.selectedToken === name(),
                }}
                role="option"
                aria-selected={props.selectedToken === name()}
                tabindex={0}
                onClick={() => props.onSelect(name())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onSelect(name());
                  }
                }}
              >
                <div
                  class="sigil-token-color-grid__swatch"
                  style={{ background: swatchColor() }}
                />
                <div class="sigil-token-color-grid__info">
                  <span class="sigil-token-color-grid__name">{shortName(name())}</span>
                  <span
                    class="sigil-token-color-grid__value"
                    classList={{ "sigil-token-color-grid__value--alias": isAlias() }}
                  >
                    {buildValuePreview(token()!.value)}
                  </span>
                </div>
              </div>
            </Show>
          );
        }}
      </Index>
    </div>
  );
};
```

- [ ] **Step 2: Create TokenSpacingList component**

```typescript
// frontend/src/panels/token-editor/TokenSpacingList.tsx
/**
 * Renders dimension/number tokens as a vertical list with proportional bars.
 *
 * Each row shows: a horizontal bar (width proportional to value relative to max),
 * token name, and resolved value.
 */
import { Index, Show, type Component, splitProps, createMemo } from "solid-js";
import { buildValuePreview } from "../TokenRow";
import type { Token } from "../../types/document";

export interface TokenSpacingListProps {
  readonly tokenNames: readonly string[];
  readonly tokens: Record<string, Token>;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

/** Extract the numeric value from a token for bar width calculation. */
function extractNumericValue(token: Token): number {
  const val = token.value;
  if (val.type === "dimension") {
    return Number.isFinite(val.value) ? Math.abs(val.value) : 0;
  }
  if (val.type === "number") {
    return Number.isFinite(val.value) ? Math.abs(val.value) : 0;
  }
  if (val.type === "font_weight") {
    return Number.isFinite(val.weight) ? val.weight : 0;
  }
  return 0;
}

export const TokenSpacingList: Component<TokenSpacingListProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);

  /** Maximum numeric value across all tokens, for proportional bar widths. */
  const maxValue = createMemo(() => {
    let max = 0;
    for (const name of props.tokenNames) {
      const token = props.tokens[name];
      if (!token) continue;
      const v = extractNumericValue(token);
      if (v > max) max = v;
    }
    return max || 1; // Avoid division by zero
  });

  return (
    <div class="sigil-token-spacing-list" role="listbox" aria-label="Spacing tokens">
      <Index each={props.tokenNames}>
        {(name) => {
          const token = createMemo(() => props.tokens[name()]);
          const numVal = () => {
            const tok = token();
            return tok ? extractNumericValue(tok) : 0;
          };
          const barWidth = () => {
            const max = maxValue();
            const val = numVal();
            // Cap at 100%, use percentage for proportional display
            return `${Math.min(100, (val / max) * 100)}%`;
          };

          return (
            <Show when={token()}>
              <div
                class="sigil-token-spacing-list__row"
                classList={{
                  "sigil-token-spacing-list__row--selected": props.selectedToken === name(),
                }}
                role="option"
                aria-selected={props.selectedToken === name()}
                tabindex={0}
                onClick={() => props.onSelect(name())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onSelect(name());
                  }
                }}
              >
                <div
                  class="sigil-token-spacing-list__bar"
                  style={{ width: barWidth() }}
                />
                <span class="sigil-token-spacing-list__name">{name()}</span>
                <span class="sigil-token-spacing-list__value">
                  {buildValuePreview(token()!.value)}
                </span>
              </div>
            </Show>
          );
        }}
      </Index>
    </div>
  );
};
```

- [ ] **Step 3: Run lint**

Run: `./dev.sh pnpm --prefix frontend lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/token-editor/TokenColorGrid.tsx \
       frontend/src/panels/token-editor/TokenSpacingList.tsx
git commit -m "feat(frontend): add TokenColorGrid and TokenSpacingList renderers (spec-13b)"
```

---

### Task 4: TokenTypographyList + TokenPreviewCard

**Files:**
- Create: `frontend/src/panels/token-editor/TokenTypographyList.tsx`
- Create: `frontend/src/panels/token-editor/TokenPreviewCard.tsx`

**Context:** Typography tokens render live text samples in the actual font. Other types (shadow, gradient, cubic_bezier, duration, font_family, font_weight) use a generic preview card with text summary.

- [ ] **Step 1: Create TokenTypographyList**

```typescript
// frontend/src/panels/token-editor/TokenTypographyList.tsx
/**
 * Renders typography tokens with live text previews.
 *
 * Each row renders a sample text string in the token's actual
 * font-family, font-weight, and font-size. Shows token name
 * and sub-field summary below.
 */
import { Index, Show, type Component, splitProps, createMemo } from "solid-js";
import type { Token } from "../../types/document";

export interface TokenTypographyListProps {
  readonly tokenNames: readonly string[];
  readonly tokens: Record<string, Token>;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog";

/** Maximum font size for preview — prevent absurdly large renders. */
const MAX_PREVIEW_FONT_SIZE = 48;

export const TokenTypographyList: Component<TokenTypographyListProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);

  return (
    <div class="sigil-token-typo-list" role="listbox" aria-label="Typography tokens">
      <Index each={props.tokenNames}>
        {(name) => {
          const token = createMemo(() => props.tokens[name()]);
          const typoValue = () => {
            const tok = token();
            if (!tok || tok.value.type !== "typography") return null;
            return tok.value.value;
          };

          return (
            <Show when={token()}>
              <div
                class="sigil-token-typo-list__row"
                classList={{
                  "sigil-token-typo-list__row--selected": props.selectedToken === name(),
                }}
                role="option"
                aria-selected={props.selectedToken === name()}
                tabindex={0}
                onClick={() => props.onSelect(name())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onSelect(name());
                  }
                }}
              >
                <Show when={typoValue()} fallback={
                  <div class="sigil-token-typo-list__preview">
                    <span class="sigil-token-typo-list__sample">{SAMPLE_TEXT}</span>
                  </div>
                }>
                  {(typo) => {
                    const fontSize = () => {
                      const s = typo().font_size;
                      return Number.isFinite(s) ? Math.min(s, MAX_PREVIEW_FONT_SIZE) : 16;
                    };
                    const fontWeight = () => {
                      const w = typo().font_weight;
                      return Number.isFinite(w) ? w : 400;
                    };
                    const lineHeight = () => {
                      const lh = typo().line_height;
                      return Number.isFinite(lh) ? lh : 1.5;
                    };

                    return (
                      <div class="sigil-token-typo-list__preview">
                        <span
                          class="sigil-token-typo-list__sample"
                          style={{
                            "font-family": typo().font_family || "sans-serif",
                            "font-size": `${fontSize()}px`,
                            "font-weight": String(fontWeight()),
                            "line-height": String(lineHeight()),
                          }}
                        >
                          {SAMPLE_TEXT}
                        </span>
                      </div>
                    );
                  }}
                </Show>
                <div class="sigil-token-typo-list__info">
                  <span class="sigil-token-typo-list__name">{name()}</span>
                  <Show when={typoValue()}>
                    {(typo) => (
                      <span class="sigil-token-typo-list__summary">
                        {typo().font_family} {typo().font_size}/{typo().font_weight}
                      </span>
                    )}
                  </Show>
                </div>
              </div>
            </Show>
          );
        }}
      </Index>
    </div>
  );
};
```

- [ ] **Step 2: Create TokenPreviewCard for other token types**

```typescript
// frontend/src/panels/token-editor/TokenPreviewCard.tsx
/**
 * Generic token preview card for types without a specialized renderer.
 *
 * Used for: shadow, gradient, font_family, font_weight, duration,
 * cubic_bezier, and any future types. Shows a visual preview where
 * possible (shadow box, gradient swatch) and a text summary.
 */
import { Index, Show, type Component, splitProps, createMemo } from "solid-js";
import { buildValuePreview } from "../TokenRow";
import type { Token, Color } from "../../types/document";

export interface TokenPreviewCardListProps {
  readonly tokenNames: readonly string[];
  readonly tokens: Record<string, Token>;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

/** Build inline CSS for shadow preview box. */
function shadowToCss(token: Token): string | null {
  if (token.value.type !== "shadow") return null;
  const { offset, blur, spread, color } = token.value.value;
  const x = Number.isFinite(offset.x) ? offset.x : 0;
  const y = Number.isFinite(offset.y) ? offset.y : 0;
  const b = Number.isFinite(blur) ? blur : 0;
  const s = Number.isFinite(spread) ? spread : 0;
  const r = Number.isFinite(color.r) ? Math.round(color.r * 255) : 0;
  const g = Number.isFinite(color.g) ? Math.round(color.g * 255) : 0;
  const bl = Number.isFinite(color.b) ? Math.round(color.b * 255) : 0;
  const a = Number.isFinite(color.a) ? color.a : 1;
  return `${x}px ${y}px ${b}px ${s}px rgba(${r},${g},${bl},${a})`;
}

export const TokenPreviewCardList: Component<TokenPreviewCardListProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);

  return (
    <div class="sigil-token-preview-list" role="listbox" aria-label="Token list">
      <Index each={props.tokenNames}>
        {(name) => {
          const token = createMemo(() => props.tokens[name()]);
          const shadowCss = () => {
            const tok = token();
            return tok ? shadowToCss(tok) : null;
          };

          return (
            <Show when={token()}>
              <div
                class="sigil-token-preview-list__card"
                classList={{
                  "sigil-token-preview-list__card--selected": props.selectedToken === name(),
                }}
                role="option"
                aria-selected={props.selectedToken === name()}
                tabindex={0}
                onClick={() => props.onSelect(name())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onSelect(name());
                  }
                }}
              >
                {/* Visual preview for shadow tokens */}
                <Show when={shadowCss()}>
                  {(shadow) => (
                    <div class="sigil-token-preview-list__shadow-box">
                      <div
                        class="sigil-token-preview-list__shadow-inner"
                        style={{ "box-shadow": shadow() }}
                      />
                    </div>
                  )}
                </Show>
                <div class="sigil-token-preview-list__info">
                  <span class="sigil-token-preview-list__name">{name()}</span>
                  <span class="sigil-token-preview-list__value">
                    {buildValuePreview(token()!.value)}
                  </span>
                </div>
              </div>
            </Show>
          );
        }}
      </Index>
    </div>
  );
};
```

- [ ] **Step 3: Run lint**

Run: `./dev.sh pnpm --prefix frontend lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/token-editor/TokenTypographyList.tsx \
       frontend/src/panels/token-editor/TokenPreviewCard.tsx
git commit -m "feat(frontend): add TokenTypographyList and TokenPreviewCard renderers (spec-13b)"
```

---

### Task 5: TokenStyleguideView (middle pane dispatcher)

**Files:**
- Create: `frontend/src/panels/token-editor/TokenStyleguideView.tsx`

**Context:** The middle pane dispatches to type-specific renderers based on the selected category. It groups tokens by dot-name hierarchy and renders section headers.

- [ ] **Step 1: Create TokenStyleguideView**

```typescript
// frontend/src/panels/token-editor/TokenStyleguideView.tsx
/**
 * Middle pane of the token styleguide editor.
 *
 * Dispatches to type-specific renderers (TokenColorGrid, TokenSpacingList, etc.)
 * based on the selected category. Groups tokens by dot-name hierarchy with
 * section headers.
 */
import { createMemo, Show, Index, type Component, splitProps } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { TOKEN_TYPE_I18N_KEYS } from "../token-helpers";
import { groupTokensByHierarchy } from "./token-grouping";
import { TokenColorGrid } from "./TokenColorGrid";
import { TokenSpacingList } from "./TokenSpacingList";
import { TokenTypographyList } from "./TokenTypographyList";
import { TokenPreviewCardList } from "./TokenPreviewCard";
import type { Token, TokenType } from "../../types/document";

export interface TokenStyleguideViewProps {
  readonly tokens: Record<string, Token>;
  readonly selectedCategory: TokenType | "";
  readonly searchQuery: string;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

/** Token types that use the color grid renderer. */
const COLOR_TYPES: ReadonlySet<TokenType> = new Set(["color"]);

/** Token types that use the spacing/bar renderer. */
const SPACING_TYPES: ReadonlySet<TokenType> = new Set(["dimension", "number"]);

/** Token types that use the typography preview renderer. */
const TYPO_TYPES: ReadonlySet<TokenType> = new Set(["typography"]);

function rendererForType(type: TokenType | ""): "color" | "spacing" | "typography" | "generic" {
  if (type === "") return "generic";
  if (COLOR_TYPES.has(type)) return "color";
  if (SPACING_TYPES.has(type)) return "spacing";
  if (TYPO_TYPES.has(type)) return "typography";
  return "generic";
}

export const TokenStyleguideView: Component<TokenStyleguideViewProps> = (rawProps) => {
  const [props] = splitProps(rawProps, [
    "tokens",
    "selectedCategory",
    "searchQuery",
    "selectedToken",
    "onSelect",
  ]);
  const [t] = useTransContext();

  const groups = createMemo(() =>
    groupTokensByHierarchy(props.tokens, props.selectedCategory, props.searchQuery),
  );

  const totalCount = createMemo(() =>
    groups().reduce((sum, g) => sum + g.tokenNames.length, 0),
  );

  const categoryLabel = createMemo(() => {
    if (props.selectedCategory === "") return t("panels:tokens.categoryAll");
    return t(TOKEN_TYPE_I18N_KEYS[props.selectedCategory]);
  });

  const renderer = createMemo(() => rendererForType(props.selectedCategory));

  function renderTokenList(tokenNames: readonly string[]) {
    const r = renderer();
    switch (r) {
      case "color":
        return (
          <TokenColorGrid
            tokenNames={tokenNames}
            tokens={props.tokens}
            selectedToken={props.selectedToken}
            onSelect={props.onSelect}
          />
        );
      case "spacing":
        return (
          <TokenSpacingList
            tokenNames={tokenNames}
            tokens={props.tokens}
            selectedToken={props.selectedToken}
            onSelect={props.onSelect}
          />
        );
      case "typography":
        return (
          <TokenTypographyList
            tokenNames={tokenNames}
            tokens={props.tokens}
            selectedToken={props.selectedToken}
            onSelect={props.onSelect}
          />
        );
      case "generic":
      default:
        return (
          <TokenPreviewCardList
            tokenNames={tokenNames}
            tokens={props.tokens}
            selectedToken={props.selectedToken}
            onSelect={props.onSelect}
          />
        );
    }
  }

  return (
    <div class="sigil-token-styleguide" role="region" aria-label={t("panels:tokens.styleguide")}>
      {/* Header */}
      <div class="sigil-token-styleguide__header">
        <div>
          <h2 class="sigil-token-styleguide__title">{categoryLabel()}</h2>
          <p class="sigil-token-styleguide__subtitle">
            {t("panels:tokens.globalSet")} · {t("panels:tokens.tokenCount", { count: totalCount() })}
          </p>
        </div>
      </div>

      {/* Grouped token lists */}
      <div class="sigil-token-styleguide__content">
        <Show
          when={totalCount() > 0}
          fallback={
            <div class="sigil-token-styleguide__empty" role="status">
              {t("panels:tokens.noTokens")}
            </div>
          }
        >
          <Index each={groups()}>
            {(group) => (
              <div class="sigil-token-styleguide__group">
                <div class="sigil-token-styleguide__group-header">
                  {group().label}
                </div>
                {renderTokenList(group().tokenNames)}
              </div>
            )}
          </Index>
        </Show>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Run lint**

Run: `./dev.sh pnpm --prefix frontend lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/token-editor/TokenStyleguideView.tsx
git commit -m "feat(frontend): add TokenStyleguideView middle pane dispatcher (spec-13b)"
```

---

### Task 6: TokenDetailPane (right pane)

**Files:**
- Create: `frontend/src/panels/token-editor/TokenDetailPane.tsx`

**Context:** Adapts the existing TokenDetailEditor for the right pane. Adds: large visual preview at top, "depends on" and "referenced by" lists, duplicate button. Reuses TokenDetailEditor for the value editing form.

- [ ] **Step 1: Create TokenDetailPane**

```typescript
// frontend/src/panels/token-editor/TokenDetailPane.tsx
/**
 * Right detail pane for the token styleguide editor.
 *
 * Shows:
 * - Token name and type badge
 * - Large visual preview (color swatch, spacing bar, type sample)
 * - Value editor (delegates to TokenDetailEditor)
 * - "Depends on" list (tokens this one references)
 * - "Referenced by" list (tokens that reference this one)
 * - Duplicate / Delete actions
 */
import { createMemo, Show, For, type Component, splitProps } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { TOKEN_TYPE_I18N_KEYS } from "../token-helpers";
import { TokenDetailEditor } from "../TokenDetailEditor";
import type { Token, TokenValue, Color } from "../../types/document";

export interface TokenDetailPaneProps {
  readonly token: Token;
  readonly tokens: Record<string, Token>;
  readonly onUpdate: (name: string, value: TokenValue, description?: string) => void;
  readonly onDelete: (name: string) => void;
  readonly onDuplicate: (name: string) => void;
  /** Navigate to another token by name. */
  readonly onNavigate: (name: string) => void;
}

/** Convert sRGB Color to CSS. */
function colorToCss(color: Color): string {
  if (color.space !== "srgb") return "var(--text-3)";
  const r = Number.isFinite(color.r) ? Math.round(color.r * 255) : 0;
  const g = Number.isFinite(color.g) ? Math.round(color.g * 255) : 0;
  const b = Number.isFinite(color.b) ? Math.round(color.b * 255) : 0;
  const a = Number.isFinite(color.a) ? color.a : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const TokenDetailPane: Component<TokenDetailPaneProps> = (rawProps) => {
  const [props] = splitProps(rawProps, [
    "token",
    "tokens",
    "onUpdate",
    "onDelete",
    "onDuplicate",
    "onNavigate",
  ]);
  const [t] = useTransContext();

  /** Find tokens that this token depends on (alias references). */
  const dependsOn = createMemo((): string[] => {
    const value = props.token.value;
    if (value.type === "alias") {
      return [value.name];
    }
    return [];
  });

  /** Find tokens that reference this token (reverse lookup). */
  const referencedBy = createMemo((): string[] => {
    const result: string[] = [];
    const myName = props.token.name;
    for (const [name, tok] of Object.entries(props.tokens)) {
      if (!tok || name === myName) continue;
      if (tok.value.type === "alias" && tok.value.name === myName) {
        result.push(name);
      }
    }
    return result.sort();
  });

  /** Render a large preview for the token type. */
  function renderPreview() {
    const value = props.token.value;
    switch (value.type) {
      case "color":
        return (
          <div
            class="sigil-token-detail-pane__preview sigil-token-detail-pane__preview--color"
            style={{ background: colorToCss(value.value) }}
          />
        );
      case "dimension":
      case "number": {
        const numVal = value.type === "dimension" ? value.value : value.value;
        const safeVal = Number.isFinite(numVal) ? numVal : 0;
        const barWidth = `${Math.min(100, Math.max(4, safeVal))}%`;
        return (
          <div class="sigil-token-detail-pane__preview sigil-token-detail-pane__preview--spacing">
            <div
              class="sigil-token-detail-pane__spacing-bar"
              style={{ width: barWidth }}
            />
          </div>
        );
      }
      case "typography": {
        const typo = value.value;
        const size = Number.isFinite(typo.font_size) ? Math.min(typo.font_size, 48) : 16;
        const weight = Number.isFinite(typo.font_weight) ? typo.font_weight : 400;
        return (
          <div class="sigil-token-detail-pane__preview sigil-token-detail-pane__preview--typo">
            <span
              style={{
                "font-family": typo.font_family || "sans-serif",
                "font-size": `${size}px`,
                "font-weight": String(weight),
              }}
            >
              Aa
            </span>
          </div>
        );
      }
      case "shadow": {
        const { offset, blur, spread, color } = value.value;
        const x = Number.isFinite(offset.x) ? offset.x : 0;
        const y = Number.isFinite(offset.y) ? offset.y : 0;
        const b = Number.isFinite(blur) ? blur : 0;
        const s = Number.isFinite(spread) ? spread : 0;
        const r = Number.isFinite(color.r) ? Math.round(color.r * 255) : 0;
        const g = Number.isFinite(color.g) ? Math.round(color.g * 255) : 0;
        const bl = Number.isFinite(color.b) ? Math.round(color.b * 255) : 0;
        const a = Number.isFinite(color.a) ? color.a : 1;
        return (
          <div class="sigil-token-detail-pane__preview sigil-token-detail-pane__preview--shadow">
            <div
              class="sigil-token-detail-pane__shadow-box"
              style={{ "box-shadow": `${x}px ${y}px ${b}px ${s}px rgba(${r},${g},${bl},${a})` }}
            />
          </div>
        );
      }
      default:
        return null;
    }
  }

  return (
    <div class="sigil-token-detail-pane" role="complementary" aria-label={t("panels:tokens.editTokenForm", { name: props.token.name })}>
      {/* Header */}
      <div class="sigil-token-detail-pane__header">
        <h3 class="sigil-token-detail-pane__name">{props.token.name}</h3>
        <span class="sigil-token-detail-pane__type-badge">
          {t(TOKEN_TYPE_I18N_KEYS[props.token.token_type])}
        </span>
      </div>

      {/* Preview */}
      {renderPreview()}

      {/* Value editor */}
      <TokenDetailEditor
        token={props.token}
        onUpdate={props.onUpdate}
      />

      {/* Dependencies */}
      <Show when={dependsOn().length > 0}>
        <div class="sigil-token-detail-pane__refs">
          <span class="sigil-token-detail-pane__refs-label">
            {t("panels:tokens.dependsOn")}
          </span>
          <For each={dependsOn()}>
            {(refName) => (
              <button
                class="sigil-token-detail-pane__ref-link"
                onClick={() => props.onNavigate(refName)}
              >
                {refName}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Referenced by */}
      <Show when={referencedBy().length > 0}>
        <div class="sigil-token-detail-pane__refs">
          <span class="sigil-token-detail-pane__refs-label">
            {t("panels:tokens.referencedBy")}
          </span>
          <For each={referencedBy()}>
            {(refName) => (
              <button
                class="sigil-token-detail-pane__ref-link"
                onClick={() => props.onNavigate(refName)}
              >
                {refName}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Actions */}
      <div class="sigil-token-detail-pane__actions">
        <button
          class="sigil-token-detail-pane__action-button"
          onClick={() => props.onDuplicate(props.token.name)}
        >
          {t("panels:tokens.duplicate")}
        </button>
        <button
          class="sigil-token-detail-pane__action-button sigil-token-detail-pane__action-button--danger"
          onClick={() => props.onDelete(props.token.name)}
        >
          {t("panels:tokens.deleteButton")}
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Run lint**

Run: `./dev.sh pnpm --prefix frontend lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/token-editor/TokenDetailPane.tsx
git commit -m "feat(frontend): add TokenDetailPane right pane editor (spec-13b)"
```

---

### Task 7: TokenEditor (three-pane layout + CSS + wiring)

**Files:**
- Create: `frontend/src/panels/token-editor/TokenEditor.tsx`
- Create: `frontend/src/panels/token-editor/TokenEditor.css`
- Modify: `frontend/src/shell/App.tsx` — swap TokenEditorWindow for TokenEditor
- Modify: `frontend/src/panels/token-editor-context.tsx` — no changes needed if props match
- Delete: `frontend/src/panels/TokenEditorWindow.tsx`
- Delete: `frontend/src/panels/TokenEditorWindow.css`

**Context:** The main shell component. A full-screen `<dialog>` containing the three panes. Manages shared state: search query, selected category, selected token. Handles token CRUD via the store.

- [ ] **Step 1: Create TokenEditor component**

```typescript
// frontend/src/panels/token-editor/TokenEditor.tsx
/**
 * TokenEditor — three-pane token management dialog.
 *
 * Layout: [Navigation | Styleguide View | Detail Editor]
 *
 * Uses native <dialog> via the Dialog component for focus trap and Escape handling.
 * Manages shared state: search query, category filter, selected token.
 * All token CRUD delegates to the existing document store API.
 */
import {
  createSignal,
  createMemo,
  createEffect,
  Show,
  type Component,
  splitProps,
} from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { Dialog } from "../../components/dialog/Dialog";
import { useDocument } from "../../store/document-context";
import { useAnnounce } from "../../shell/AnnounceProvider";
import { MAX_TOKEN_NAME_LENGTH } from "../../store/document-store-solid";
import {
  TOKEN_TYPES,
  TOKEN_TYPE_I18N_KEYS,
  defaultTokenValue,
  validateTokenName,
} from "../token-helpers";
import { TokenNavigationPane } from "./TokenNavigationPane";
import { TokenStyleguideView } from "./TokenStyleguideView";
import { TokenDetailPane } from "./TokenDetailPane";
import type { TokenType, TokenValue } from "../../types/document";
import "./TokenEditor.css";

export interface TokenEditorProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly initialSelection?: string | null;
}

export const TokenEditor: Component<TokenEditorProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["isOpen", "onClose", "initialSelection"]);
  const store = useDocument();
  const announce = useAnnounce();
  const [t] = useTransContext();

  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedCategory, setSelectedCategory] = createSignal<TokenType | "">("");
  const [selectedTokenName, setSelectedTokenName] = createSignal<string | null>(
    props.initialSelection ?? null,
  );

  // Sync initialSelection when dialog opens
  createEffect(() => {
    if (props.isOpen && props.initialSelection) {
      setSelectedTokenName(props.initialSelection);
    }
  });

  const selectedToken = createMemo(() => {
    const name = selectedTokenName();
    if (!name) return null;
    return store.state.tokens[name] ?? null;
  });

  // ── Token mutations ─────────────────────────────────────────────

  function handleUpdateToken(name: string, value: TokenValue, description?: string): void {
    store.updateToken(name, value, description);
  }

  function handleDeleteToken(name: string): void {
    store.deleteToken(name);
    announce(t("panels:tokens.tokenDeleted", { name }));
    setSelectedTokenName(null);
  }

  function handleDuplicateToken(name: string): void {
    const token = store.state.tokens[name];
    if (!token) return;

    // Find a unique name by appending -copy, -copy-2, etc.
    let newName = `${name}-copy`;
    let counter = 2;
    while (store.state.tokens[newName] !== undefined) {
      newName = `${name}-copy-${counter}`;
      counter++;
    }

    store.createToken(newName, token.token_type, token.value, token.description ?? undefined);
    announce(t("panels:tokens.tokenCreated", { name: newName }));
    setSelectedTokenName(newName);
  }

  function handleCreateToken(): void {
    // Create with defaults based on the currently selected category
    const tokenType: TokenType = selectedCategory() || "color";
    const value = defaultTokenValue(tokenType);

    // Generate a unique name
    let baseName = `new.${tokenType}`;
    let name = baseName;
    let counter = 2;
    while (store.state.tokens[name] !== undefined) {
      name = `${baseName}.${counter}`;
      counter++;
    }

    store.createToken(name, tokenType, value);
    announce(t("panels:tokens.tokenCreated", { name }));
    setSelectedTokenName(name);
  }

  function handleNavigateToToken(name: string): void {
    // If the token exists, select it and switch category to match
    const token = store.state.tokens[name];
    if (!token) return;
    setSelectedCategory(token.token_type);
    setSelectedTokenName(name);
  }

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t("panels:tokens.editorTitle")}
      class="sigil-token-editor"
    >
      <div class="sigil-token-editor__layout">
        {/* Left: Navigation */}
        <TokenNavigationPane
          tokens={store.state.tokens}
          selectedCategory={selectedCategory()}
          onCategoryChange={setSelectedCategory}
          searchQuery={searchQuery()}
          onSearchChange={setSearchQuery}
          onCreateToken={handleCreateToken}
        />

        {/* Middle: Styleguide */}
        <TokenStyleguideView
          tokens={store.state.tokens}
          selectedCategory={selectedCategory()}
          searchQuery={searchQuery()}
          selectedToken={selectedTokenName()}
          onSelect={setSelectedTokenName}
        />

        {/* Right: Detail */}
        <div class="sigil-token-editor__detail">
          <Show
            when={selectedToken()}
            fallback={
              <div class="sigil-token-editor__no-selection">
                {t("panels:tokens.noSelection")}
              </div>
            }
          >
            {(token) => (
              <TokenDetailPane
                token={token()}
                tokens={store.state.tokens}
                onUpdate={handleUpdateToken}
                onDelete={handleDeleteToken}
                onDuplicate={handleDuplicateToken}
                onNavigate={handleNavigateToToken}
              />
            )}
          </Show>
        </div>
      </div>
    </Dialog>
  );
};
```

- [ ] **Step 2: Create TokenEditor.css**

```css
/* frontend/src/panels/token-editor/TokenEditor.css */

/* ── Dialog override — full-screen layout ─────────────────────── */

.sigil-token-editor {
  width: 90vw;
  max-width: 1200px;
  height: 80vh;
  max-height: 800px;
  padding: 0;
}

.sigil-token-editor__layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* ── Left: Navigation pane ────────────────────────────────────── */

.sigil-token-nav {
  width: 170px;
  flex-shrink: 0;
  background: var(--surface-2);
  border-right: 1px solid var(--border-1);
  padding: var(--size-2);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}

.sigil-token-nav__search {
  width: 100%;
  background: var(--surface-3);
  border: 1px solid var(--border-2);
  color: var(--text-1);
  padding: var(--size-1) var(--size-2);
  border-radius: var(--radius-1);
  font-size: var(--font-size-0);
  box-sizing: border-box;
}

.sigil-token-nav__search::placeholder {
  color: var(--text-3);
}

.sigil-token-nav__section {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sigil-token-nav__section-label {
  color: var(--text-3);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: var(--size-1) var(--size-2);
}

.sigil-token-nav__set-item {
  padding: var(--size-1) var(--size-2);
  font-size: var(--font-size-0);
  color: var(--text-2);
  border-radius: var(--radius-1);
}

.sigil-token-nav__set-item--active {
  background: var(--brand-bg);
  color: var(--brand);
}

.sigil-token-nav__divider {
  border-top: 1px solid var(--border-1);
  margin: var(--size-1) 0;
}

.sigil-token-nav__category {
  display: flex;
  align-items: center;
  width: 100%;
  padding: var(--size-1) var(--size-2);
  background: none;
  border: none;
  color: var(--text-2);
  font-size: var(--font-size-0);
  cursor: pointer;
  border-radius: var(--radius-1);
  text-align: left;
}

.sigil-token-nav__category:hover:not(:disabled) {
  background: var(--surface-3);
}

.sigil-token-nav__category--active {
  background: var(--brand-bg);
  color: var(--brand);
}

.sigil-token-nav__category--empty {
  opacity: 0.4;
}

.sigil-token-nav__category-label {
  flex: 1;
}

.sigil-token-nav__category-count {
  color: var(--text-3);
  font-size: 9px;
}

.sigil-token-nav__create-button {
  width: 100%;
  background: var(--brand);
  color: var(--brand-text);
  border: none;
  padding: var(--size-1);
  border-radius: var(--radius-1);
  font-size: var(--font-size-0);
  cursor: pointer;
  margin-top: auto;
}

.sigil-token-nav__create-button:hover {
  opacity: 0.9;
}

/* ── Middle: Styleguide view ──────────────────────────────────── */

.sigil-token-styleguide {
  flex: 1;
  border-right: 1px solid var(--border-1);
  overflow-y: auto;
  padding: var(--size-3);
  min-width: 0;
}

.sigil-token-styleguide__header {
  margin-bottom: var(--size-3);
}

.sigil-token-styleguide__title {
  margin: 0;
  color: var(--text-1);
  font-size: var(--font-size-3);
  font-weight: 600;
}

.sigil-token-styleguide__subtitle {
  margin: 2px 0 0;
  color: var(--text-3);
  font-size: var(--font-size-0);
}

.sigil-token-styleguide__content {
  display: flex;
  flex-direction: column;
  gap: var(--size-3);
}

.sigil-token-styleguide__group-header {
  color: var(--text-2);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding-bottom: var(--size-1);
  border-bottom: 1px solid var(--border-1);
  margin-bottom: var(--size-2);
}

.sigil-token-styleguide__empty {
  color: var(--text-3);
  text-align: center;
  padding: var(--size-6);
}

/* ── Color grid ───────────────────────────────────────────────── */

.sigil-token-color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: var(--size-2);
}

.sigil-token-color-grid__card {
  background: var(--surface-3);
  border-radius: var(--radius-2);
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.1s;
}

.sigil-token-color-grid__card:hover {
  border-color: var(--border-2);
}

.sigil-token-color-grid__card--selected {
  border-color: var(--brand);
}

.sigil-token-color-grid__card:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.sigil-token-color-grid__swatch {
  height: 48px;
}

.sigil-token-color-grid__info {
  padding: var(--size-1) var(--size-2);
}

.sigil-token-color-grid__name {
  display: block;
  color: var(--text-1);
  font-size: var(--font-size-0);
}

.sigil-token-color-grid__value {
  display: block;
  color: var(--text-3);
  font-size: 9px;
}

.sigil-token-color-grid__value--alias {
  color: var(--brand);
  font-style: italic;
}

/* ── Spacing list ─────────────────────────────────────────────── */

.sigil-token-spacing-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}

.sigil-token-spacing-list__row {
  display: flex;
  align-items: center;
  gap: var(--size-2);
  background: var(--surface-3);
  border-radius: var(--radius-2);
  padding: var(--size-2);
  cursor: pointer;
  border: 2px solid transparent;
}

.sigil-token-spacing-list__row:hover {
  border-color: var(--border-2);
}

.sigil-token-spacing-list__row--selected {
  border-color: var(--brand);
}

.sigil-token-spacing-list__row:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.sigil-token-spacing-list__bar {
  height: 16px;
  background: var(--brand);
  border-radius: 2px;
  min-width: 4px;
  flex-shrink: 0;
}

.sigil-token-spacing-list__name {
  flex: 1;
  color: var(--text-1);
  font-size: var(--font-size-0);
}

.sigil-token-spacing-list__value {
  color: var(--text-3);
  font-size: var(--font-size-0);
  font-family: var(--font-mono);
}

/* ── Typography list ──────────────────────────────────────────── */

.sigil-token-typo-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.sigil-token-typo-list__row {
  background: var(--surface-3);
  border-radius: var(--radius-2);
  padding: var(--size-2);
  cursor: pointer;
  border: 2px solid transparent;
  overflow: hidden;
}

.sigil-token-typo-list__row:hover {
  border-color: var(--border-2);
}

.sigil-token-typo-list__row--selected {
  border-color: var(--brand);
}

.sigil-token-typo-list__row:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.sigil-token-typo-list__preview {
  max-height: 60px;
  overflow: hidden;
  margin-bottom: var(--size-1);
}

.sigil-token-typo-list__sample {
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.sigil-token-typo-list__info {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.sigil-token-typo-list__name {
  color: var(--text-1);
  font-size: var(--font-size-0);
}

.sigil-token-typo-list__summary {
  color: var(--text-3);
  font-size: 9px;
}

/* ── Generic preview cards ────────────────────────────────────── */

.sigil-token-preview-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}

.sigil-token-preview-list__card {
  display: flex;
  align-items: center;
  gap: var(--size-2);
  background: var(--surface-3);
  border-radius: var(--radius-2);
  padding: var(--size-2);
  cursor: pointer;
  border: 2px solid transparent;
}

.sigil-token-preview-list__card:hover {
  border-color: var(--border-2);
}

.sigil-token-preview-list__card--selected {
  border-color: var(--brand);
}

.sigil-token-preview-list__card:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.sigil-token-preview-list__shadow-box {
  width: 48px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sigil-token-preview-list__shadow-inner {
  width: 32px;
  height: 24px;
  background: var(--surface-1);
  border-radius: var(--radius-1);
}

.sigil-token-preview-list__info {
  flex: 1;
  min-width: 0;
}

.sigil-token-preview-list__name {
  display: block;
  color: var(--text-1);
  font-size: var(--font-size-0);
}

.sigil-token-preview-list__value {
  display: block;
  color: var(--text-3);
  font-size: 9px;
}

/* ── Right: Detail pane ───────────────────────────────────────── */

.sigil-token-editor__detail {
  width: 240px;
  flex-shrink: 0;
  background: var(--surface-2);
  overflow-y: auto;
  padding: var(--size-3);
}

.sigil-token-editor__no-selection {
  color: var(--text-3);
  font-size: var(--font-size-1);
  text-align: center;
  padding-top: var(--size-6);
}

.sigil-token-detail-pane__header {
  margin-bottom: var(--size-2);
}

.sigil-token-detail-pane__name {
  margin: 0;
  color: var(--text-1);
  font-size: var(--font-size-2);
  font-weight: 600;
  word-break: break-all;
}

.sigil-token-detail-pane__type-badge {
  display: inline-block;
  background: var(--surface-3);
  color: var(--text-2);
  padding: 1px var(--size-2);
  border-radius: var(--radius-1);
  font-size: 9px;
  margin-top: var(--size-1);
}

.sigil-token-detail-pane__preview {
  border-radius: var(--radius-2);
  margin-bottom: var(--size-3);
  border: 1px solid var(--border-1);
  overflow: hidden;
}

.sigil-token-detail-pane__preview--color {
  height: 64px;
}

.sigil-token-detail-pane__preview--spacing {
  height: 32px;
  display: flex;
  align-items: center;
  padding: var(--size-1);
  background: var(--surface-3);
}

.sigil-token-detail-pane__spacing-bar {
  height: 100%;
  background: var(--brand);
  border-radius: 2px;
  min-width: 4px;
}

.sigil-token-detail-pane__preview--typo {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  background: var(--surface-3);
  color: var(--text-1);
}

.sigil-token-detail-pane__preview--shadow {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-3);
}

.sigil-token-detail-pane__shadow-box {
  width: 48px;
  height: 36px;
  background: var(--surface-1);
  border-radius: var(--radius-1);
}

.sigil-token-detail-pane__refs {
  margin-bottom: var(--size-3);
}

.sigil-token-detail-pane__refs-label {
  display: block;
  color: var(--text-3);
  font-size: 9px;
  margin-bottom: var(--size-1);
}

.sigil-token-detail-pane__ref-link {
  display: block;
  background: none;
  border: none;
  color: var(--brand);
  font-size: var(--font-size-0);
  cursor: pointer;
  padding: 2px 0;
  text-align: left;
}

.sigil-token-detail-pane__ref-link:hover {
  text-decoration: underline;
}

.sigil-token-detail-pane__actions {
  display: flex;
  gap: var(--size-1);
  margin-top: var(--size-3);
}

.sigil-token-detail-pane__action-button {
  flex: 1;
  background: var(--surface-3);
  color: var(--text-2);
  border: 1px solid var(--border-2);
  padding: var(--size-1);
  border-radius: var(--radius-1);
  font-size: 9px;
  cursor: pointer;
}

.sigil-token-detail-pane__action-button:hover {
  background: var(--surface-4, var(--surface-3));
}

.sigil-token-detail-pane__action-button--danger {
  color: var(--error);
}

/* ── Reduced motion ───────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .sigil-token-color-grid__card,
  .sigil-token-spacing-list__row,
  .sigil-token-typo-list__row,
  .sigil-token-preview-list__card {
    transition: none;
  }
}
```

- [ ] **Step 3: Wire TokenEditor into App.tsx**

Read `frontend/src/shell/App.tsx` to find where `TokenEditorWindow` is imported and rendered. Replace:
- Change the import from `../panels/TokenEditorWindow` to `../panels/token-editor/TokenEditor`
- Change the component name from `TokenEditorWindow` to `TokenEditor`
- Props are the same: `isOpen`, `onClose`, `initialSelection`

- [ ] **Step 4: Behavioral inventory of TokenEditorWindow before deletion**

Before deleting `TokenEditorWindow.tsx`, enumerate its behaviors:
1. Search filter by name (case-insensitive substring) → **Preserved** in TokenEditor via TokenNavigationPane + TokenStyleguideView
2. Type filter dropdown → **Preserved** as category navigation in left pane
3. Table display of all tokens → **Replaced** by styleguide card/list views (improvement)
4. Click row to select → **Preserved** in all type-specific renderers
5. Detail editor below table → **Moved** to right pane (improvement)
6. Inline create form → **Replaced** by create button that auto-generates a token (improvement)
7. Dialog open/close → **Preserved** using same Dialog component
8. initialSelection sync → **Preserved** via createEffect

All behaviors preserved or improved. Delete `TokenEditorWindow.tsx` and `TokenEditorWindow.css`.

- [ ] **Step 5: Delete superseded files**

```bash
git rm frontend/src/panels/TokenEditorWindow.tsx \
       frontend/src/panels/TokenEditorWindow.css
```

- [ ] **Step 6: Run lint and build**

Run: `./dev.sh pnpm --prefix frontend lint && ./dev.sh pnpm --prefix frontend build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/panels/token-editor/TokenEditor.tsx \
       frontend/src/panels/token-editor/TokenEditor.css \
       frontend/src/shell/App.tsx
git commit -m "feat(frontend): add three-pane TokenEditor, replace TokenEditorWindow (spec-13b)"
```

---

### Task 8: Integration tests + browser verification

**Files:**
- Create: `frontend/src/panels/token-editor/__tests__/TokenEditor.test.tsx`

**Context:** Write integration tests that verify the three-pane layout renders correctly and interactions work (category selection, token selection, CRUD).

- [ ] **Step 1: Write integration tests**

```typescript
// frontend/src/panels/token-editor/__tests__/TokenEditor.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { I18nProvider } from "../../test-helpers/I18nProvider";
import { createMockDocumentStore } from "../../test-helpers/mock-store";
import { TokenEditor } from "../TokenEditor";

// Note: The actual test setup requires:
// 1. A mock document store provider wrapping the component
// 2. An I18n provider wrapping the component
// 3. Tokens pre-populated in the mock store
// The implementer should follow the patterns in PagesPanel.test.tsx
// for setting up the test harness.

describe("TokenEditor", () => {
  it("renders the three-pane layout when open", () => {
    // Render TokenEditor with isOpen=true
    // Assert: navigation pane with search input is visible
    // Assert: styleguide view is visible
    // Assert: "Select a token to edit" placeholder in right pane
  });

  it("filters tokens by category when clicking a category", () => {
    // Pre-populate store with color and dimension tokens
    // Click the "Color" category in left pane
    // Assert: only color tokens visible in middle pane
    // Assert: dimension tokens not visible
  });

  it("selects a token and shows detail editor", () => {
    // Pre-populate store with a color token "brand.primary"
    // Click the token card in the middle pane
    // Assert: right pane shows token name "brand.primary"
    // Assert: right pane shows type badge "Color"
    // Assert: right pane shows color preview swatch
  });

  it("search filters tokens by name", () => {
    // Pre-populate with "brand.primary" and "brand.error"
    // Type "prim" in the search field
    // Assert: only "brand.primary" visible
  });

  it("does not render when isOpen is false", () => {
    // Render with isOpen=false
    // Assert: dialog is not visible
  });

  it("calls onClose when dialog is closed", () => {
    // Render with isOpen=true and onClose spy
    // Press Escape
    // Assert: onClose was called
  });
});
```

The implementer should fill in the test implementations following the patterns established in `frontend/src/panels/__tests__/PagesPanel.test.tsx` — specifically the mock store setup, I18n provider wrapping, and event simulation patterns.

- [ ] **Step 2: Run all frontend tests**

Run: `./dev.sh pnpm --prefix frontend test -- --run`
Expected: All tests PASS (including existing tests — no regressions)

- [ ] **Step 3: Browser verification**

Run: `./dev.sh pnpm --prefix frontend dev`

Manual verification checklist:
1. Open the token editor via the "Open full editor" link in the Tokens panel
2. Verify three-pane layout renders: left navigation, middle content, right detail
3. Create several tokens of different types (color, dimension, typography)
4. Verify color tokens render as a card grid with swatches
5. Verify dimension tokens render as a bar list
6. Click a token — verify detail editor appears in right pane with preview
7. Search for a token by name — verify filtering works
8. Switch categories — verify middle pane updates
9. Delete a token — verify it disappears
10. Duplicate a token — verify the copy appears
11. Click a token reference in "Referenced by" — verify navigation works
12. Press Escape — verify dialog closes
13. Verify keyboard navigation: Tab through categories, Enter to select
14. Verify no console errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/token-editor/__tests__/TokenEditor.test.tsx
git commit -m "test(frontend): add TokenEditor integration tests (spec-13b)"
```

---

## Self-Review

### Spec coverage check

| Spec section | Task |
|-------------|------|
| §3.1 Three-pane layout | Task 7 (TokenEditor) |
| §3.1 Left pane — search, category filter | Task 2 (TokenNavigationPane) |
| §3.1 Middle pane — type-specific rendering | Tasks 3-5 (renderers + dispatcher) |
| §3.1 Right pane — detail editor | Task 6 (TokenDetailPane) |
| §3.2 Color card grid | Task 3 (TokenColorGrid) |
| §3.2 Spacing bar visualization | Task 3 (TokenSpacingList) |
| §3.2 Typography live preview | Task 4 (TokenTypographyList) |
| §3.2 Shadow/other preview | Task 4 (TokenPreviewCard) |
| §3.3 Value editor (literal mode) | Task 6 (reuses TokenDetailEditor) |
| §3.4 Token sets UI | Deferred to 13d (noted in scope) |
| §3.5 Panel tab | Unchanged (existing TokensPanel) |
| Group hierarchy rendering | Task 1 (groupTokensByHierarchy) |
| i18n keys | Task 1 |

### Deferred to later specs
- §3.3 Reference/expression modes — requires 13d/13e
- §3.4 Token sets — requires core crate changes in 13d
- "Compare themes" view — requires token sets
