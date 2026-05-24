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
   * Return the appropriate renderer component for a given token type.
   * Used both when a specific category is selected and when "All Categories"
   * dispatches each group to its type-specific renderer.
   */
  function rendererForType(tokenType: TokenType | ""): Component<{
    tokenNames: readonly string[];
    tokens: Record<string, Token>;
    selectedToken: string | null;
    onSelect: (name: string) => void;
  }> {
    switch (tokenType) {
      case "color":
        return TokenColorGrid;
      case "dimension":
      case "number":
        return TokenSpacingList;
      case "typography":
        return TokenTypographyList;
      default:
        return TokenPreviewCardList;
    }
  }

  /**
   * Render the appropriate type-specific list for the current category.
   * When "All Categories" is selected, each group is dispatched to the
   * renderer matching the token type of its first token.
   */
  function renderTokenList(
    tokenNames: readonly string[],
    groupTokenType?: TokenType,
  ): ReturnType<Component> {
    const cat = props.selectedCategory;

    // When showing all categories, use the group's detected token type
    const effectiveType = cat === "" ? (groupTokenType ?? "") : cat;
    const Renderer = rendererForType(effectiveType);

    return (
      <Renderer
        tokenNames={tokenNames}
        tokens={props.tokens}
        selectedToken={props.selectedToken}
        onSelect={props.onSelect}
      />
    );
  }

  return (
    <div class="sigil-token-styleguide" role="region" aria-label={t("panels:tokens.styleguide")}>
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
            {(group) => {
              // Detect the token type from the first token in the group
              // for dispatching to type-specific renderers in "All Categories" mode
              const groupTokenType = createMemo((): TokenType | undefined => {
                const firstName = group.tokenNames[0];
                if (!firstName) return undefined;
                return props.tokens[firstName]?.token_type;
              });

              return (
                <div class="sigil-token-styleguide__group">
                  <h4 class="sigil-token-styleguide__group-header">
                    {group.label === "ungrouped" ? t("panels:tokens.globalSet") : group.label}
                  </h4>
                  {renderTokenList(group.tokenNames, groupTokenType())}
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
};
