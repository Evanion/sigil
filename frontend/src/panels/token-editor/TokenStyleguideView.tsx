/**
 * TokenStyleguideView -- middle pane of the three-pane token editor.
 *
 * Groups tokens by hierarchy (dot-separated prefix) and dispatches to
 * type-specific renderers: color grid, spacing bars, typography previews,
 * or generic preview cards.
 */

import { createMemo, For, Show, splitProps, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type { Token, TokenType } from "../../types/document";
import { TOKEN_TYPE_I18N_KEYS } from "../token-helpers";
import { groupTokensByHierarchy } from "./token-grouping";
import { TokenColorGrid } from "./TokenColorGrid";
import { TokenSpacingList } from "./TokenSpacingList";
import { TokenTypographyList } from "./TokenTypographyList";
import { TokenPreviewCardList } from "./TokenPreviewCard";

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenStyleguideViewProps {
  readonly tokens: Record<string, Token>;
  readonly selectedCategory: TokenType | "";
  readonly searchQuery: string;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

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

  const totalTokenCount = createMemo(() => {
    let count = 0;
    for (const group of groups()) {
      count += group.tokenNames.length;
    }
    return count;
  });

  const categoryTitle = createMemo(() => {
    const cat = props.selectedCategory;
    if (cat === "") return t("panels:tokens.categoryAll");
    return t(TOKEN_TYPE_I18N_KEYS[cat]);
  });

  /**
   * Render the appropriate type-specific list for the current category.
   * When "all categories" is selected (or an unrecognized category),
   * fall back to the generic preview card list.
   */
  function renderTokenList(tokenNames: readonly string[]): ReturnType<Component> {
    const cat = props.selectedCategory;

    switch (cat) {
      case "color":
        return (
          <TokenColorGrid
            tokenNames={tokenNames}
            tokens={props.tokens}
            selectedToken={props.selectedToken}
            onSelect={props.onSelect}
          />
        );

      case "dimension":
      case "number":
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
    <div
      class="sigil-token-styleguide"
      role="region"
      aria-label={t("panels:tokens.styleguide")}
    >
      {/* Header */}
      <div class="sigil-token-styleguide__header">
        <h3 class="sigil-token-styleguide__title">{categoryTitle()}</h3>
        <span class="sigil-token-styleguide__subtitle">
          {t("panels:tokens.tokenCount", { count: totalTokenCount() })}
        </span>
      </div>

      {/* Content */}
      <div class="sigil-token-styleguide__content">
        <Show
          when={groups().length > 0}
          fallback={
            <div class="sigil-token-styleguide__empty" role="status">
              {t("panels:tokens.noTokens")}
            </div>
          }
        >
          {/* Groups are read-only (derived from token data), so <For> is correct here */}
          <For each={groups()}>
            {(group) => (
              <div class="sigil-token-styleguide__group">
                <div class="sigil-token-styleguide__group-header">
                  {group.label === "ungrouped"
                    ? t("panels:tokens.globalSet")
                    : group.label}
                </div>
                {renderTokenList(group.tokenNames)}
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};
