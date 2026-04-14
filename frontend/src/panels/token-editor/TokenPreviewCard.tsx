/**
 * TokenPreviewCardList — generic list renderer for shadow, gradient, font_family,
 * font_weight, duration, cubic_bezier, and other token types.
 *
 * Shadow tokens get a visual box-shadow preview. Other types show name + value text.
 */

import { createMemo, Index, Show, splitProps, type Component } from "solid-js";
import type { Token, Color } from "../../types/document";
import { buildValuePreview } from "../TokenRow";
import { colorToCss } from "./TokenColorGrid";
import "./TokenPreviewCard.css";

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenPreviewCardListProps {
  readonly tokenNames: readonly string[];
  readonly tokens: Record<string, Token>;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a CSS box-shadow string from a shadow token value.
 * Returns null if the token is not a shadow type.
 * Guards all numeric values with Number.isFinite() per CLAUDE.md.
 */
export function shadowToCss(token: Token): string | null {
  if (token.value.type !== "shadow") return null;

  const { offset, blur, spread, color } = token.value.value;

  const x = Number.isFinite(offset.x) ? offset.x : 0;
  const y = Number.isFinite(offset.y) ? offset.y : 0;
  const b = Number.isFinite(blur) ? blur : 0;
  const s = Number.isFinite(spread) ? spread : 0;
  const c = colorToCss(color as Color);

  return `${x}px ${y}px ${b}px ${s}px ${c}`;
}

/**
 * Extract the short name from a dotted token name.
 */
function shortName(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.substring(lastDot + 1) : name;
}

// ── Component ──────────────────────────────────────────────────────────────

export const TokenPreviewCardList: Component<TokenPreviewCardListProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);

  return (
    <div class="sigil-token-preview-list" role="listbox" aria-label="Token list">
      <Index each={props.tokenNames}>
        {(name) => {
          const token = createMemo(() => props.tokens[name()]);
          const isSelected = createMemo(() => props.selectedToken === name());

          const shadowCss = createMemo(() => {
            const t = token();
            if (!t) return null;
            return shadowToCss(t);
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
              class="sigil-token-preview-list__card"
              classList={{ "sigil-token-preview-list__card--selected": isSelected() }}
              role="option"
              aria-selected={isSelected()}
              tabindex={0}
              onClick={() => props.onSelect(name())}
              onKeyDown={handleKeyDown}
            >
              <Show when={shadowCss()}>
                {(css) => (
                  <div class="sigil-token-preview-list__shadow-box">
                    <div
                      class="sigil-token-preview-list__shadow-inner"
                      style={{ "box-shadow": css() }}
                    />
                  </div>
                )}
              </Show>
              <div class="sigil-token-preview-list__info">
                <span class="sigil-token-preview-list__name">{shortName(name())}</span>
                <span class="sigil-token-preview-list__value">{valueText()}</span>
              </div>
            </div>
          );
        }}
      </Index>
    </div>
  );
};
