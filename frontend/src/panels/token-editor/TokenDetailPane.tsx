/**
 * TokenDetailPane -- right pane of the three-pane token editor.
 *
 * Displays the selected token's visual preview, delegates value editing
 * to TokenDetailEditor, shows dependency information (depends on / referenced by),
 * and provides duplicate and delete actions.
 */

import { createMemo, createSignal, For, Show, splitProps, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type { Token, TokenValue } from "../../types/document";
import { validateCssIdentifier } from "../../validation/css-identifiers";
import { TOKEN_TYPE_I18N_KEYS, validateTokenName, sanitizeTokenName } from "../token-helpers";
import { TokenDetailEditor } from "../TokenDetailEditor";
import { MAX_TOKEN_NAME_LENGTH } from "../../store/document-store-solid";
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
  readonly onRename: (oldName: string, newName: string) => void;
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
    "onRename",
    "onDelete",
    "onDuplicate",
    "onNavigate",
  ]);

  const [t] = useTransContext();
  const [isRenaming, setIsRenaming] = createSignal(false);
  const [renameError, setRenameError] = createSignal<string | null>(null);
  let renameInputRef: HTMLInputElement | undefined;

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

  // ── Input sanitization ──────────────────────────────────────────────

  /** Sanitize token name as the user types. */
  function handleRenameInput(e: InputEvent): void {
    const input = e.currentTarget as HTMLInputElement;
    const pos = input.selectionStart ?? 0;
    const sanitized = sanitizeTokenName(input.value);
    if (sanitized !== input.value) {
      input.value = sanitized;
      const newPos = Math.min(pos, sanitized.length);
      input.setSelectionRange(newPos, newPos);
    }
    setRenameError(null);
  }

  // ── Rename ─────────────────────────────────────────────────────────

  function startRename(): void {
    setIsRenaming(true);
    setRenameError(null);
    requestAnimationFrame(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  }

  function commitRename(): void {
    const newName = renameInputRef?.value.trim() ?? "";
    if (!newName || newName === props.token.name) {
      setIsRenaming(false);
      setRenameError(null);
      return;
    }

    const nameError = validateTokenName(newName);
    if (nameError !== null) {
      setRenameError(nameError);
      return;
    }

    if (props.tokens[newName] !== undefined) {
      setRenameError(`Token "${newName}" already exists`);
      return;
    }

    props.onRename(props.token.name, newName);
    setIsRenaming(false);
    setRenameError(null);
  }

  function handleRenameKeyDown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsRenaming(false);
      setRenameError(null);
    }
  }

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
      {/* Header with editable name */}
      <div class="sigil-token-detail-pane__header">
        <Show
          when={!isRenaming()}
          fallback={
            <div class="sigil-token-detail-pane__rename-form">
              <input
                ref={(el) => { renameInputRef = el; }}
                class="sigil-token-detail-pane__rename-input"
                type="text"
                value={props.token.name}
                maxLength={MAX_TOKEN_NAME_LENGTH}
                aria-label={t("panels:tokens.name")}
                aria-invalid={renameError() !== null}
                aria-describedby={renameError() !== null ? "sigil-detail-rename-error" : undefined}
                onInput={handleRenameInput}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
              />
              <Show when={renameError()}>
                {(err) => (
                  <span
                    id="sigil-detail-rename-error"
                    class="sigil-token-detail-pane__rename-error"
                    role="alert"
                  >
                    {err()}
                  </span>
                )}
              </Show>
            </div>
          }
        >
          <h3
            class="sigil-token-detail-pane__name"
            tabindex={0}
            role="button"
            onClick={startRename}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                startRename();
              }
            }}
            title="Click to rename"
          >
            {props.token.name}
          </h3>
        </Show>
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
