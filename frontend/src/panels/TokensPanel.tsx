/**
 * TokensPanel — left panel tab listing all design tokens grouped by type.
 *
 * Provides:
 * - Collapsible groups by token type
 * - Inline rename (F2 / double-click via TokenRow)
 * - Keyboard navigation (ArrowUp/Down, Delete, Enter)
 * - "+" button to create new tokens via a popover form
 * - "Open full editor" link at the bottom
 * - ARIA: role="region" wrapping, role="listbox" for token list
 *
 * A11y audit: This is a new component — no prior code to audit.
 */

import { createSignal, createMemo, onCleanup, Index, Show, For, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { Plus } from "lucide-solid";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "../shell/AnnounceProvider";
import { MAX_TOKEN_NAME_LENGTH } from "../store/document-store-solid";
import { TokenRow } from "./TokenRow";
import {
  TOKEN_TYPES,
  TOKEN_TYPE_I18N_KEYS,
  defaultTokenValue,
  groupTokensByType,
  validateTokenName,
  sanitizeTokenName,
} from "./token-helpers";
import { Popover } from "../components/popover/Popover";
import { useTokenEditor } from "./token-editor-context";
import type { TokenType } from "../types/document";
import "./TokensPanel.css";

export const TokensPanel: Component = () => {
  const store = useDocument();
  const announce = useAnnounce();
  const [t] = useTransContext();
  const tokenEditor = useTokenEditor();

  const [selectedToken, setSelectedToken] = createSignal<string | null>(null);
  const [focusedToken, setFocusedToken] = createSignal<string | null>(null);
  const [renameRequestName, setRenameRequestName] = createSignal<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<TokenType>>(new Set());

  // Create-token popover state
  const [createPopoverOpen, setCreatePopoverOpen] = createSignal(false);
  const [newTokenName, setNewTokenName] = createSignal("");
  const [newTokenType, setNewTokenType] = createSignal<TokenType>("color");
  const [createError, setCreateError] = createSignal<string | null>(null);

  let listRef: HTMLDivElement | undefined;
  let focusRafHandle: number | undefined;

  onCleanup(() => {
    if (focusRafHandle !== undefined) {
      cancelAnimationFrame(focusRafHandle);
      focusRafHandle = undefined;
    }
  });

  // ── Grouped tokens ────────────────────────────────────────────────

  const groups = createMemo(() => groupTokensByType(store.state.tokens));

  /** Flat list of all visible token names in display order. */
  const flatTokenNames = createMemo(() => {
    const result: string[] = [];
    const collapsed = collapsedGroups();
    for (const [type, names] of groups()) {
      if (!collapsed.has(type)) {
        result.push(...names);
      }
    }
    return result;
  });

  // ── Group toggle ──────────────────────────────────────────────────

  function toggleGroup(type: TokenType): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  // ── Token mutations ───────────────────────────────────────────────

  function handleCreateToken(): void {
    const name = newTokenName().trim();
    if (!name) {
      setCreateError("Token name must not be empty");
      announce("Token name must not be empty");
      return;
    }

    // F-01: Validate token name against core's rules
    const nameError = validateTokenName(name);
    if (nameError !== null) {
      setCreateError(nameError);
      announce(nameError);
      return;
    }

    // Check for duplicate name
    if (store.state.tokens[name] !== undefined) {
      const dupError = `Token "${name}" already exists`;
      setCreateError(dupError);
      announce(dupError);
      return;
    }

    const tokenType = newTokenType();
    const value = defaultTokenValue(tokenType);
    store.createToken(name, tokenType, value);
    announce(t("panels:tokens.tokenCreated", { name }));
    setNewTokenName("");
    setCreateError(null);
    setCreatePopoverOpen(false);
  }

  function handleSelectToken(name: string): void {
    setSelectedToken(name);
    setFocusedToken(name);
  }

  function handleRenameToken(oldName: string, newName: string): void {
    // F-01: Validate new name against core's rules
    const nameError = validateTokenName(newName);
    if (nameError !== null) {
      announce(nameError);
      return;
    }

    if (!store.state.tokens[oldName]) return;

    // Check for duplicate name (not the same token)
    if (oldName !== newName && store.state.tokens[newName] !== undefined) {
      announce(`Token "${newName}" already exists`);
      return;
    }

    // Atomic rename via single store operation
    store.renameToken(oldName, newName);

    // F-10: Announce rename commit
    announce(t("panels:tokens.tokenUpdated", { name: newName }));
    setSelectedToken(newName);
    setFocusedToken(newName);
  }

  function handleDeleteToken(name: string): void {
    store.deleteToken(name);
    announce(t("panels:tokens.tokenDeleted", { name }));

    // Move focus to next/prev token
    const names = flatTokenNames();
    const idx = names.indexOf(name);
    if (idx !== -1 && names.length > 1) {
      const nextIdx = idx < names.length - 1 ? idx + 1 : idx - 1;
      const nextName = names[nextIdx];
      if (nextName) {
        setSelectedToken(nextName);
        setFocusedToken(nextName);
      }
    } else {
      setSelectedToken(null);
      setFocusedToken(null);
    }
  }

  function handleEditToken(name: string): void {
    setSelectedToken(name);
    tokenEditor.open();
  }

  // ── Keyboard navigation ───────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent): void {
    const names = flatTokenNames();
    if (names.length === 0) return;

    const currentFocused = focusedToken();
    const currentIndex = currentFocused ? names.indexOf(currentFocused) : -1;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        if (currentIndex >= names.length - 1) break;
        const nextIdx = currentIndex + 1;
        const nextName = names[nextIdx];
        if (nextName) {
          setFocusedToken(nextName);
          focusTokenRow(nextName);
        }
        break;
      }

      case "ArrowUp": {
        e.preventDefault();
        if (currentIndex <= 0) break;
        const prevIdx = currentIndex - 1;
        const prevName = names[prevIdx];
        if (prevName) {
          setFocusedToken(prevName);
          focusTokenRow(prevName);
        }
        break;
      }

      case "Enter": {
        e.preventDefault();
        if (currentFocused) {
          handleSelectToken(currentFocused);
        }
        break;
      }

      case "F2": {
        e.preventDefault();
        if (currentFocused) {
          setRenameRequestName(currentFocused);
        }
        break;
      }

      case "Delete": {
        e.preventDefault();
        if (currentFocused) {
          handleDeleteToken(currentFocused);
        }
        break;
      }

      default:
        break;
    }
  }

  function getTabIndex(tokenName: string): number {
    const focused = focusedToken();
    if (focused) return focused === tokenName ? 0 : -1;
    const names = flatTokenNames();
    return names[0] === tokenName ? 0 : -1;
  }

  function focusTokenRow(name: string): void {
    if (focusRafHandle !== undefined) {
      cancelAnimationFrame(focusRafHandle);
    }
    focusRafHandle = requestAnimationFrame(() => {
      focusRafHandle = undefined;
      const el = listRef?.querySelector(`[data-token-name="${CSS.escape(name)}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "nearest" });
        el.focus();
      }
    });
  }

  // ── Create-token popover form ─────────────────────────────────────

  function handleCreateFormKeyDown(e: KeyboardEvent): void {
    // Stop propagation so document shortcuts don't fire during form input
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateToken();
    }
  }

  const hasTokens = createMemo(() => Object.keys(store.state.tokens).length > 0);

  return (
    <div class="sigil-tokens-panel" role="region" aria-label={t("panels:tokens.title")}>
      <div class="sigil-tokens-panel__header">
        <h3 class="sigil-tokens-panel__title">{t("panels:tokens.title")}</h3>
        <Popover
          placement="bottom"
          triggerAriaLabel={t("panels:tokens.addToken")}
          trigger={<Plus size={16} />}
          open={createPopoverOpen()}
          onOpenChange={setCreatePopoverOpen}
        >
          <div class="sigil-tokens-panel__create-form" onKeyDown={handleCreateFormKeyDown}>
            <label class="sigil-tokens-panel__create-label">
              {t("panels:tokens.name")}
              <input
                class="sigil-tokens-panel__create-input"
                type="text"
                value={newTokenName()}
                maxLength={MAX_TOKEN_NAME_LENGTH}
                placeholder={t("panels:tokens.name")}
                onInput={(e) => {
                  const input = e.currentTarget;
                  const pos = input.selectionStart ?? 0;
                  const sanitized = sanitizeTokenName(input.value);
                  if (sanitized !== input.value) {
                    input.value = sanitized;
                    const newPos = Math.min(pos, sanitized.length);
                    input.setSelectionRange(newPos, newPos);
                  }
                  setNewTokenName(sanitized);
                  setCreateError(null);
                }}
                aria-invalid={createError() !== null}
                aria-describedby={createError() !== null ? "sigil-create-token-error" : undefined}
              />
              <Show when={createError()}>
                {(err) => (
                  <span
                    id="sigil-create-token-error"
                    class="sigil-tokens-panel__create-error"
                    role="alert"
                  >
                    {err()}
                  </span>
                )}
              </Show>
            </label>
            <label class="sigil-tokens-panel__create-label">
              {t("panels:tokens.type")}
              <select
                class="sigil-tokens-panel__create-select"
                value={newTokenType()}
                onChange={(e) => setNewTokenType(e.currentTarget.value as TokenType)}
              >
                <For each={TOKEN_TYPES}>
                  {(type) => <option value={type}>{t(TOKEN_TYPE_I18N_KEYS[type])}</option>}
                </For>
              </select>
            </label>
            <button
              class="sigil-tokens-panel__create-button"
              onClick={handleCreateToken}
              disabled={newTokenName().trim().length === 0}
            >
              {t("panels:tokens.create")}
            </button>
          </div>
        </Popover>
      </div>

      <div
        ref={(el) => {
          listRef = el;
        }}
        class="sigil-tokens-panel__list"
        role="listbox"
        aria-label={t("panels:tokens.tokenList")}
        onKeyDown={handleKeyDown}
      >
        <Show
          when={hasTokens()}
          fallback={
            <div class="sigil-tokens-panel__empty" role="status">
              {t("panels:tokens.noTokens")}
            </div>
          }
        >
          {/* F-18: Use <Index> for groups since they support add/remove/reorder */}
          <Index each={groups()}>
            {(group) => {
              const type = () => group()[0];
              const names = () => group()[1];
              const isCollapsed = () => collapsedGroups().has(type());
              const groupContentId = () => `sigil-tokens-group-${type()}`;
              const groupLabelId = () => `sigil-tokens-group-label-${type()}`;
              return (
                /* F-06: Use role="group" with aria-labelledby on group containers */
                <div
                  class="sigil-tokens-panel__group"
                  role="group"
                  aria-labelledby={groupLabelId()}
                >
                  <button
                    class="sigil-tokens-panel__group-header"
                    onClick={() => toggleGroup(type())}
                    aria-expanded={!isCollapsed()}
                    /* F-11: aria-controls references the group content container */
                    aria-controls={groupContentId()}
                  >
                    <span class="sigil-tokens-panel__group-chevron" aria-hidden="true">
                      {isCollapsed() ? "\u25B6" : "\u25BC"}
                    </span>
                    <span id={groupLabelId()} class="sigil-tokens-panel__group-label">
                      {t(TOKEN_TYPE_I18N_KEYS[type()])}
                    </span>
                    <span class="sigil-tokens-panel__group-count">{names().length}</span>
                  </button>
                  <Show when={!isCollapsed()}>
                    <div id={groupContentId()}>
                      <Index each={names()}>
                        {(name) => {
                          const token = () => store.state.tokens[name()];
                          return (
                            <Show when={token()}>
                              {(tok) => (
                                <TokenRow
                                  token={tok()}
                                  isSelected={selectedToken() === name()}
                                  onSelect={handleSelectToken}
                                  onRename={handleRenameToken}
                                  onDelete={handleDeleteToken}
                                  onEdit={handleEditToken}
                                  isFocused={focusedToken() === name()}
                                  tabIndex={getTabIndex(name())}
                                  requestRename={renameRequestName() === name()}
                                  onRenameStarted={() => setRenameRequestName(null)}
                                />
                              )}
                            </Show>
                          );
                        }}
                      </Index>
                    </div>
                  </Show>
                </div>
              );
            }}
          </Index>
        </Show>
      </div>

      <div class="sigil-tokens-panel__footer">
        <button class="sigil-tokens-panel__open-editor" onClick={() => tokenEditor.open()}>
          {t("panels:tokens.openEditor")}
        </button>
      </div>
    </div>
  );
};
