/**
 * TokenEditorWindow — a modal dialog for managing all design tokens.
 *
 * Uses Kobalte Dialog for proper focus trap, Escape handling, and ARIA semantics.
 * Features:
 * - Search by name (case-insensitive substring)
 * - Filter by token type
 * - Table of all tokens
 * - Click a row to select and show TokenDetailEditor
 * - Create new tokens
 */

import {
  createSignal,
  createMemo,
  createEffect,
  Show,
  Index,
  For,
  type Component,
  splitProps,
} from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { Dialog } from "../components/dialog/Dialog";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "../shell/AnnounceProvider";
import { TokenDetailEditor } from "./TokenDetailEditor";
import { TOKEN_TYPES, TOKEN_TYPE_I18N_KEYS, defaultTokenValue } from "./token-helpers";
import { buildValuePreview } from "./TokenRow";
import type { Token, TokenType, TokenValue } from "../types/document";
import "./TokenEditorWindow.css";

// ── Props ───────────────────────────────────────────────────────────────

export interface TokenEditorWindowProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Token name to select initially when the editor opens. */
  readonly initialSelection?: string | null;
}

// ── Component ───────────────────────────────────────────────────────────

export const TokenEditorWindow: Component<TokenEditorWindowProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["isOpen", "onClose", "initialSelection"]);
  const store = useDocument();
  const announce = useAnnounce();
  const [t] = useTransContext();

  const [searchQuery, setSearchQuery] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal<TokenType | "">("");
  const [selectedTokenName, setSelectedTokenName] = createSignal<string | null>(
    props.initialSelection ?? null,
  );

  // F-13: Sync initialSelection → selectedTokenName when isOpen changes
  createEffect(() => {
    if (props.isOpen && props.initialSelection) {
      setSelectedTokenName(props.initialSelection);
    }
  });

  // ── Derived: filtered token list ─────────────────────────────────────

  const filteredTokenNames = createMemo(() => {
    const tokens = store.state.tokens;
    const query = searchQuery().toLowerCase();
    const filter = typeFilter();

    const result: string[] = [];
    for (const name of Object.keys(tokens)) {
      const token = tokens[name];
      if (!token) continue;

      // Type filter
      if (filter !== "" && token.token_type !== filter) continue;

      // Search filter
      if (query.length > 0 && !name.toLowerCase().includes(query)) continue;

      result.push(name);
    }

    return result.sort();
  });

  const selectedToken = createMemo((): Token | null => {
    const name = selectedTokenName();
    if (!name) return null;
    return store.state.tokens[name] ?? null;
  });

  // ── Handlers ────────────────────────────────────────────────────────

  function handleNewToken(): void {
    const existing = Object.keys(store.state.tokens);
    let index = existing.length + 1;
    let name = `token-${index}`;
    // Ensure unique name
    while (store.state.tokens[name] !== undefined) {
      index++;
      name = `token-${index}`;
    }

    const tokenType: TokenType = "color";
    const value = defaultTokenValue(tokenType);
    store.createToken(name, tokenType, value);
    announce(t("panels:tokens.tokenCreated", { name }));
    setSelectedTokenName(name);
  }

  function handleUpdateToken(name: string, value: TokenValue, description?: string): void {
    store.updateToken(name, value, description);
  }

  function handleDeleteToken(name: string): void {
    store.deleteToken(name);
    announce(t("panels:tokens.tokenDeleted", { name }));
    setSelectedTokenName(null);
  }

  function handleSelectRow(name: string): void {
    setSelectedTokenName(name);
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      props.onClose();
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={handleOpenChange}
      title={t("panels:tokens.editorTitle")}
      class="sigil-token-editor-window"
    >
      <div class="sigil-token-editor-window__toolbar">
        <input
          class="sigil-token-editor-window__search"
          type="text"
          placeholder={t("panels:tokens.search")}
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={t("panels:tokens.search")}
        />
        <select
          class="sigil-token-editor-window__type-filter"
          value={typeFilter()}
          onChange={(e) => setTypeFilter(e.currentTarget.value as TokenType | "")}
          aria-label={t("panels:tokens.filterAll")}
        >
          <option value="">{t("panels:tokens.filterAll")}</option>
          <For each={TOKEN_TYPES}>
            {(type) => <option value={type}>{t(TOKEN_TYPE_I18N_KEYS[type])}</option>}
          </For>
        </select>
        <button class="sigil-token-editor-window__new-button" onClick={handleNewToken}>
          {t("panels:tokens.newToken")}
        </button>
        <button class="sigil-token-editor-window__import-button" disabled>
          {t("panels:tokens.import")}
        </button>
      </div>

      <div class="sigil-token-editor-window__content">
        <div class="sigil-token-editor-window__table-container">
          {/* F-07: Use native table semantics instead of role="grid" */}
          <table class="sigil-token-editor-window__table" aria-label={t("panels:tokens.tokenList")}>
            <thead>
              <tr>
                <th>{t("panels:tokens.name")}</th>
                <th>{t("panels:tokens.type")}</th>
                <th>{t("panels:tokens.value")}</th>
                <th>{t("panels:tokens.description")}</th>
              </tr>
            </thead>
            <tbody>
              <Index each={filteredTokenNames()}>
                {(name) => {
                  const token = () => store.state.tokens[name()];
                  return (
                    <Show when={token()}>
                      {(tok) => (
                        <tr
                          class="sigil-token-editor-window__row"
                          classList={{
                            "sigil-token-editor-window__row--selected":
                              selectedTokenName() === name(),
                          }}
                          onClick={() => handleSelectRow(name())}
                          tabindex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectRow(name());
                            }
                          }}
                          aria-selected={selectedTokenName() === name()}
                        >
                          <td class="sigil-token-editor-window__cell-name">{tok().name}</td>
                          <td class="sigil-token-editor-window__cell-type">
                            {t(TOKEN_TYPE_I18N_KEYS[tok().token_type])}
                          </td>
                          {/* F-16: Use buildValuePreview instead of raw discriminant */}
                          <td class="sigil-token-editor-window__cell-value">
                            {buildValuePreview(tok().value)}
                          </td>
                          <td class="sigil-token-editor-window__cell-desc">
                            {tok().description ?? ""}
                          </td>
                        </tr>
                      )}
                    </Show>
                  );
                }}
              </Index>
            </tbody>
          </table>
          <Show when={filteredTokenNames().length === 0}>
            <div class="sigil-token-editor-window__empty" role="status">
              {t("panels:tokens.noTokens")}
            </div>
          </Show>
        </div>

        <Show when={selectedToken()}>
          {(tok) => (
            <div class="sigil-token-editor-window__detail-panel">
              <TokenDetailEditor
                token={tok()}
                onUpdate={handleUpdateToken}
                onDelete={handleDeleteToken}
              />
            </div>
          )}
        </Show>
      </div>
    </Dialog>
  );
};
