/**
 * TokenColorGrid — renders color tokens as a responsive card grid with swatches.
 *
 * Each card displays a color swatch at the top and the token short name + value below.
 * Alias tokens show their value in italic. Supports keyboard selection via Enter/Space.
 */

import { createMemo, Index, splitProps, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type { Token } from "../../types/document";
import { colorToCss } from "../token-helpers";
import { buildValuePreview } from "../TokenRow";
import { shortName } from "./token-grouping";
import "./TokenColorGrid.css";

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenColorGridProps {
  readonly tokenNames: readonly string[];
  readonly tokens: Record<string, Token>;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const TokenColorGrid: Component<TokenColorGridProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);
  const [t] = useTransContext();

  return (
    <div class="sigil-token-color-grid" role="listbox" aria-label={t("panels:tokens.typeColor")}>
      <Index each={props.tokenNames}>
        {(name, index) => {
          const token = createMemo(() => props.tokens[name()]);
          const isSelected = createMemo(() => props.selectedToken === name());
          const isAlias = createMemo(() => token()?.value.type === "alias");

          const swatchColor = createMemo(() => {
            const t = token();
            if (!t) return "var(--surface-3)";
            if (t.value.type === "color") {
              return colorToCss(t.value.value);
            }
            return "var(--surface-3)";
          });

          const valueText = createMemo(() => {
            const t = token();
            if (!t) return "";
            return buildValuePreview(t.value);
          });

          function handleKeyDown(e: KeyboardEvent): void {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onSelect(name());
            }
          }

          return (
            <div
              class="sigil-token-color-grid__card"
              classList={{ "sigil-token-color-grid__card--selected": isSelected() }}
              role="option"
              aria-selected={isSelected()}
              tabindex={index === 0 ? 0 : -1}
              onClick={() => props.onSelect(name())}
              onKeyDown={handleKeyDown}
            >
              <div class="sigil-token-color-grid__swatch" style={{ background: swatchColor() }} />
              <div class="sigil-token-color-grid__info">
                <span class="sigil-token-color-grid__name">{shortName(name())}</span>
                <span
                  class="sigil-token-color-grid__value"
                  classList={{ "sigil-token-color-grid__value--alias": isAlias() }}
                >
                  {valueText()}
                </span>
              </div>
            </div>
          );
        }}
      </Index>
    </div>
  );
};
