/**
 * TokenDetailPane -- right pane of the three-pane token editor.
 *
 * Displays the selected token's visual preview, delegates value editing
 * to TokenDetailEditor, shows dependency information (depends on / referenced by),
 * and provides duplicate and delete actions.
 */

import { createMemo, For, Show, splitProps, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type { Token, TokenValue } from "../../types/document";
import { validateCssIdentifier } from "../../validation/css-identifiers";
import { TOKEN_TYPE_I18N_KEYS } from "../token-helpers";
import { TokenDetailEditor } from "../TokenDetailEditor";
import { colorToCss } from "./TokenColorGrid";
import { shadowToCss } from "./TokenPreviewCard";
import { extractNumericValue } from "./TokenSpacingList";

// ── Constants ──────────────────────────────────────────────────────────────

/** Height of the color preview swatch in px. */
const COLOR_PREVIEW_HEIGHT = 64;

/** Maximum height for the spacing bar preview container. */
const SPACING_PREVIEW_HEIGHT = 48;

/** Maximum font size for typography preview. */
const MAX_TYPO_PREVIEW_SIZE = 48;

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenDetailPaneProps {
  readonly token: Token;
  readonly tokens: Record<string, Token>;
  readonly onUpdate: (name: string, value: TokenValue, description?: string) => void;
  readonly onDelete: (name: string) => void;
  readonly onDuplicate: (name: string) => void;
  readonly onNavigate: (name: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

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

  // ── Derived data ─────────────────────────────────────────────────────

  /** List of token names this token depends on (alias references). */
  const dependsOn = createMemo((): readonly string[] => {
    if (props.token.value.type === "alias") {
      return [props.token.value.name];
    }
    return [];
  });

  /** List of token names that reference this token via alias. */
  const referencedBy = createMemo((): readonly string[] => {
    const thisName = props.token.name;
    const result: string[] = [];
    for (const name of Object.keys(props.tokens)) {
      const tok = props.tokens[name];
      if (tok && tok.value.type === "alias" && tok.value.name === thisName) {
        result.push(name);
      }
    }
    return result.sort();
  });

  // ── Preview rendering ────────────────────────────────────────────────

  function renderPreview(): ReturnType<Component> {
    const value = props.token.value;

    switch (value.type) {
      case "color":
        return (
          <div
            class="sigil-token-detail-pane__preview sigil-token-detail-pane__preview--color"
            style={{
              background: colorToCss(value.value),
              height: `${COLOR_PREVIEW_HEIGHT}px`,
            }}
          />
        );

      case "dimension":
      case "number": {
        const numVal = extractNumericValue(props.token);
        // Scale to a percentage-based bar (cap at 100%)
        const barWidth = Math.min(numVal, 100);
        return (
          <div
            class="sigil-token-detail-pane__preview sigil-token-detail-pane__preview--spacing"
            style={{ height: `${SPACING_PREVIEW_HEIGHT}px` }}
          >
            <div
              class="sigil-token-detail-pane__spacing-bar"
              style={{ width: `${Number.isFinite(barWidth) ? barWidth : 0}%` }}
            />
          </div>
        );
      }

      case "typography": {
        const v = value.value;
        const fontSize = Number.isFinite(v.font_size)
          ? Math.min(v.font_size, MAX_TYPO_PREVIEW_SIZE)
          : 16;
        const fontWeight = Number.isFinite(v.font_weight) ? v.font_weight : 400;
        const fontFamily = validateCssIdentifier(v.font_family)
          ? v.font_family
          : "sans-serif";
        return (
          <div class="sigil-token-detail-pane__preview sigil-token-detail-pane__preview--typo">
            <span
              style={{
                "font-family": `${fontFamily}, sans-serif`,
                "font-size": `${fontSize}px`,
                "font-weight": String(fontWeight),
              }}
            >
              Aa
            </span>
          </div>
        );
      }

      case "shadow": {
        const css = shadowToCss(props.token);
        if (!css) return null;
        return (
          <div class="sigil-token-detail-pane__preview sigil-token-detail-pane__preview--shadow">
            <div
              class="sigil-token-detail-pane__shadow-box"
              style={{ "box-shadow": css }}
            />
          </div>
        );
      }

      default:
        // No visual preview for gradient, font_family, font_weight,
        // duration, cubic_bezier, alias, etc.
        return null;
    }
  }

  // ── Reference link handler ───────────────────────────────────────────

  function handleRefClick(name: string): void {
    props.onNavigate(name);
  }

  function handleRefKeyDown(e: KeyboardEvent, name: string): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onNavigate(name);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div
      class="sigil-token-detail-pane"
      role="complementary"
      aria-label={props.token.name}
    >
      {/* Header */}
      <div class="sigil-token-detail-pane__header">
        <h3 class="sigil-token-detail-pane__name">{props.token.name}</h3>
        <span class="sigil-token-detail-pane__type-badge">
          {t(TOKEN_TYPE_I18N_KEYS[props.token.token_type])}
        </span>
      </div>

      {/* Visual preview */}
      {renderPreview()}

      {/* Value editor */}
      <TokenDetailEditor
        token={props.token}
        onUpdate={props.onUpdate}
      />

      {/* Depends on section */}
      <Show when={dependsOn().length > 0}>
        <div class="sigil-token-detail-pane__refs">
          <span class="sigil-token-detail-pane__refs-label">
            {t("panels:tokens.dependsOn")}
          </span>
          <For each={dependsOn()}>
            {(refName) => (
              <span
                class="sigil-token-detail-pane__ref-link"
                role="link"
                tabindex={0}
                onClick={() => handleRefClick(refName)}
                onKeyDown={(e) => handleRefKeyDown(e, refName)}
              >
                {refName}
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* Referenced by section */}
      <Show when={referencedBy().length > 0}>
        <div class="sigil-token-detail-pane__refs">
          <span class="sigil-token-detail-pane__refs-label">
            {t("panels:tokens.referencedBy")}
          </span>
          <For each={referencedBy()}>
            {(refName) => (
              <span
                class="sigil-token-detail-pane__ref-link"
                role="link"
                tabindex={0}
                onClick={() => handleRefClick(refName)}
                onKeyDown={(e) => handleRefKeyDown(e, refName)}
              >
                {refName}
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* Action buttons */}
      <div class="sigil-token-detail-pane__actions">
        <button
          class="sigil-token-detail-pane__action-button"
          type="button"
          onClick={() => props.onDuplicate(props.token.name)}
        >
          {t("panels:tokens.duplicate")}
        </button>
        <button
          class="sigil-token-detail-pane__action-button sigil-token-detail-pane__action-button--danger"
          type="button"
          onClick={() => props.onDelete(props.token.name)}
        >
          {t("panels:tokens.deleteButton")}
        </button>
      </div>
    </div>
  );
};
