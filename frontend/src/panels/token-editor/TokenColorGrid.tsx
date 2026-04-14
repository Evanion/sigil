/**
 * TokenColorGrid — renders color tokens as a responsive card grid with swatches.
 *
 * Each card displays a color swatch at the top and the token short name + value below.
 * Alias tokens show their value in italic. Supports keyboard selection via Enter/Space.
 */

import { createMemo, Index, splitProps, type Component } from "solid-js";
import type { Token, Color } from "../../types/document";
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

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a sRGB Color to an rgba() CSS string.
 * Guards all channels with Number.isFinite() per CLAUDE.md floating-point validation.
 */
export function colorToCss(color: Color): string {
  if (color.space !== "srgb") {
    // Non-sRGB colors fallback to gray
    return "rgba(128, 128, 128, 1)";
  }
  const r = Number.isFinite(color.r) ? Math.round(Math.max(0, Math.min(1, color.r)) * 255) : 0;
  const g = Number.isFinite(color.g) ? Math.round(Math.max(0, Math.min(1, color.g)) * 255) : 0;
  const b = Number.isFinite(color.b) ? Math.round(Math.max(0, Math.min(1, color.b)) * 255) : 0;
  const a = Number.isFinite(color.a) ? Math.max(0, Math.min(1, color.a)) : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ── Component ──────────────────────────────────────────────────────────────

export const TokenColorGrid: Component<TokenColorGridProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);

  return (
    <div class="sigil-token-color-grid" role="listbox" aria-label="Color tokens">
      <Index each={props.tokenNames}>
        {(name) => {
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
              tabindex={0}
              onClick={() => props.onSelect(name())}
              onKeyDown={handleKeyDown}
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
