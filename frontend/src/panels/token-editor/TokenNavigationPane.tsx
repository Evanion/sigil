/**
 * TokenNavigationPane — left sidebar of the three-pane token styleguide editor.
 *
 * Displays a search field, token set selector (placeholder for Spec 13d),
 * category filter buttons with counts, and a "New Token" button.
 */

import { createMemo, Index, splitProps, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type { Token, TokenType } from "../../types/document";
import { TOKEN_TYPES, TOKEN_TYPE_I18N_KEYS } from "../token-helpers";
import { countTokensByType } from "./token-grouping";
import "./TokenNavigationPane.css";

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenNavigationPaneProps {
  readonly tokens: Record<string, Token>;
  readonly selectedCategory: TokenType | "";
  readonly onCategoryChange: (category: TokenType | "") => void;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly onCreateToken: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

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

  const counts = createMemo(() => countTokensByType(props.tokens));

  const totalCount = createMemo(() => {
    let sum = 0;
    for (const c of counts().values()) {
      sum += c;
    }
    return sum;
  });

  return (
    <nav class="sigil-token-nav" role="navigation" aria-label={t("panels:tokens.search")}>
      {/* Search input */}
      <input
        class="sigil-token-nav__search"
        type="search"
        placeholder={t("panels:tokens.search")}
        aria-label={t("panels:tokens.search")}
        value={props.searchQuery}
        onInput={(e) => props.onSearchChange(e.currentTarget.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />

      {/* Token Sets section (placeholder for Spec 13d) */}
      <div class="sigil-token-nav__section">
        <span class="sigil-token-nav__section-label">{t("panels:tokens.tokenSets")}</span>
        <button
          class="sigil-token-nav__set-item sigil-token-nav__set-item--active"
          type="button"
          aria-current="true"
        >
          {t("panels:tokens.globalSet")}
        </button>
      </div>

      <hr class="sigil-token-nav__divider" />

      {/* Category filter buttons */}
      <div class="sigil-token-nav__section">
        {/* All Categories */}
        <button
          class="sigil-token-nav__category"
          classList={{ "sigil-token-nav__category--active": props.selectedCategory === "" }}
          type="button"
          onClick={() => props.onCategoryChange("")}
        >
          <span class="sigil-token-nav__category-label">{t("panels:tokens.categoryAll")}</span>
          <span class="sigil-token-nav__category-count">{totalCount()}</span>
        </button>

        {/* Per-type categories */}
        <Index each={TOKEN_TYPES}>
          {(tokenType) => {
            const count = createMemo(() => counts().get(tokenType()) ?? 0);
            const isEmpty = createMemo(() => count() === 0);

            return (
              <button
                class="sigil-token-nav__category"
                classList={{
                  "sigil-token-nav__category--active": props.selectedCategory === tokenType(),
                  "sigil-token-nav__category--empty": isEmpty(),
                }}
                type="button"
                disabled={isEmpty()}
                onClick={() => props.onCategoryChange(tokenType())}
              >
                <span class="sigil-token-nav__category-label">
                  {t(TOKEN_TYPE_I18N_KEYS[tokenType()])}
                </span>
                <span class="sigil-token-nav__category-count">{count()}</span>
              </button>
            );
          }}
        </Index>
      </div>

      <hr class="sigil-token-nav__divider" />

      {/* New Token button */}
      <button
        class="sigil-token-nav__create-button"
        type="button"
        onClick={() => props.onCreateToken()}
      >
        + {t("panels:tokens.newToken")}
      </button>
    </nav>
  );
};
