/**
 * TokenTypographyList — renders typography tokens with live text previews.
 *
 * Each row shows a preview of "The quick brown fox..." rendered in the token's
 * actual font-family/weight/size, plus token name and a field summary.
 */

import { createMemo, Index, splitProps, Show, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type { Token } from "../../types/document";
import { validateCssIdentifier } from "../../validation/css-identifiers";
import { shortName } from "./token-grouping";
import "./TokenTypographyList.css";

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum font size for preview rendering. Larger values are capped here. */
const MAX_PREVIEW_FONT_SIZE = 48;

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog";

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenTypographyListProps {
  readonly tokenNames: readonly string[];
  readonly tokens: Record<string, Token>;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const TokenTypographyList: Component<TokenTypographyListProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);
  const [t] = useTransContext();

  return (
    <div
      class="sigil-token-typo-list"
      role="listbox"
      aria-label={t("panels:tokens.typeTypography")}
    >
      <Index each={props.tokenNames}>
        {(name, index) => {
          const token = createMemo(() => props.tokens[name()]);
          const isSelected = createMemo(() => props.selectedToken === name());

          const typoValue = createMemo(() => {
            const t = token();
            if (!t || t.value.type !== "typography") return null;
            return t.value.value;
          });

          const previewStyle = createMemo(() => {
            const v = typoValue();
            if (!v) return {};

            // Guard all numeric values per CLAUDE.md floating-point validation
            const fontSize = Number.isFinite(v.font_size)
              ? Math.min(v.font_size, MAX_PREVIEW_FONT_SIZE)
              : 16;
            const fontWeight = Number.isFinite(v.font_weight) ? v.font_weight : 400;

            // Validate font-family before CSS interpolation (CLAUDE.md: CSS-rendered string fields)
            const fontFamily = validateCssIdentifier(v.font_family) ? v.font_family : "sans-serif";

            return {
              "font-family": `${fontFamily}, sans-serif`,
              "font-size": `${fontSize}px`,
              "font-weight": String(fontWeight),
            };
          });

          const summary = createMemo(() => {
            const v = typoValue();
            if (!v) return "";
            const size = Number.isFinite(v.font_size) ? v.font_size : 0;
            const weight = Number.isFinite(v.font_weight) ? v.font_weight : 0;
            return `${v.font_family} ${size}/${weight}`;
          });

          function handleKeyDown(e: KeyboardEvent): void {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onSelect(name());
            }
          }

          return (
            <div
              class="sigil-token-typo-list__row"
              classList={{ "sigil-token-typo-list__row--selected": isSelected() }}
              role="option"
              aria-selected={isSelected()}
              tabindex={index === 0 ? 0 : -1}
              onClick={() => props.onSelect(name())}
              onKeyDown={handleKeyDown}
            >
              <Show when={typoValue()}>
                <div class="sigil-token-typo-list__preview">
                  <span class="sigil-token-typo-list__sample" style={previewStyle()}>
                    {SAMPLE_TEXT}
                  </span>
                </div>
              </Show>
              <div class="sigil-token-typo-list__info">
                <span class="sigil-token-typo-list__name">{shortName(name())}</span>
                <span class="sigil-token-typo-list__summary">{summary()}</span>
              </div>
            </div>
          );
        }}
      </Index>
    </div>
  );
};
