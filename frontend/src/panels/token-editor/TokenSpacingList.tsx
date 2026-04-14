/**
 * TokenSpacingList — renders dimension/number tokens as a list with proportional bars.
 *
 * Each row shows a horizontal bar sized proportionally to the value relative to
 * the largest value in the list, plus the token name and value text.
 */

import { createMemo, Index, splitProps, type Component } from "solid-js";
import type { Token } from "../../types/document";
import { buildValuePreview } from "../TokenRow";
import "./TokenSpacingList.css";

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenSpacingListProps {
  readonly tokenNames: readonly string[];
  readonly tokens: Record<string, Token>;
  readonly selectedToken: string | null;
  readonly onSelect: (name: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract a numeric value from a token for bar width calculation.
 * Handles dimension, number, and font_weight types.
 * Guards against NaN/Infinity per CLAUDE.md floating-point validation.
 */
export function extractNumericValue(token: Token): number {
  switch (token.value.type) {
    case "dimension": {
      const v = token.value.value;
      return Number.isFinite(v) ? Math.abs(v) : 0;
    }
    case "number": {
      const v = token.value.value;
      return Number.isFinite(v) ? Math.abs(v) : 0;
    }
    case "font_weight": {
      const v = token.value.weight;
      return Number.isFinite(v) ? Math.abs(v) : 0;
    }
    default:
      return 0;
  }
}

/**
 * Extract the short name from a dotted token name.
 */
function shortName(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.substring(lastDot + 1) : name;
}

// ── Component ──────────────────────────────────────────────────────────────

export const TokenSpacingList: Component<TokenSpacingListProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["tokenNames", "tokens", "selectedToken", "onSelect"]);

  /** Maximum numeric value across all tokens in the list, for bar scaling. */
  const maxValue = createMemo(() => {
    let max = 0;
    for (const name of props.tokenNames) {
      const token = props.tokens[name];
      if (token) {
        const v = extractNumericValue(token);
        if (v > max) max = v;
      }
    }
    return max;
  });

  return (
    <div class="sigil-token-spacing-list" role="listbox" aria-label="Spacing tokens">
      <Index each={props.tokenNames}>
        {(name) => {
          const token = createMemo(() => props.tokens[name()]);
          const isSelected = createMemo(() => props.selectedToken === name());

          const numericVal = createMemo(() => {
            const t = token();
            return t ? extractNumericValue(t) : 0;
          });

          const barPercent = createMemo(() => {
            const max = maxValue();
            if (max <= 0) return 0;
            const val = numericVal();
            // Guard: both values are finite (extractNumericValue already guards)
            return (val / max) * 100;
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
              class="sigil-token-spacing-list__row"
              classList={{ "sigil-token-spacing-list__row--selected": isSelected() }}
              role="option"
              aria-selected={isSelected()}
              tabindex={0}
              onClick={() => props.onSelect(name())}
              onKeyDown={handleKeyDown}
            >
              <div
                class="sigil-token-spacing-list__bar"
                style={{ width: `${barPercent()}%` }}
              />
              <span class="sigil-token-spacing-list__name">{shortName(name())}</span>
              <span class="sigil-token-spacing-list__value">{valueText()}</span>
            </div>
          );
        }}
      </Index>
    </div>
  );
};
