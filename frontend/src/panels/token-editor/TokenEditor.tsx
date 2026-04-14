/**
 * TokenEditor -- three-pane token editor dialog.
 *
 * Left pane: TokenNavigationPane (category filters, search, create)
 * Middle pane: TokenStyleguideView (grouped, type-specific renderers)
 * Right pane: TokenDetailPane (selected token preview + editor + actions)
 *
 * Replaces the legacy TokenEditorWindow with a richer visual layout.
 */

import {
  createSignal,
  createMemo,
  createEffect,
  Show,
  splitProps,
  type Component,
} from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { Dialog } from "../../components/dialog/Dialog";
import { useDocument } from "../../store/document-context";
import { useAnnounce } from "../../shell/AnnounceProvider";
import type { Token, TokenType, TokenValue } from "../../types/document";
import {
  defaultTokenValue,
  validateTokenName,
} from "../token-helpers";
import { TokenNavigationPane } from "./TokenNavigationPane";
import { TokenStyleguideView } from "./TokenStyleguideView";
import { TokenDetailPane } from "./TokenDetailPane";
import "./TokenEditor.css";

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenEditorProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Token name to select initially when the editor opens. */
  readonly initialSelection?: string | null;
}

// ── Component ──────────────────────────────────────────────────────────────

export const TokenEditor: Component<TokenEditorProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["isOpen", "onClose", "initialSelection"]);
  const store = useDocument();
  const announce = useAnnounce();
  const [t] = useTransContext();

  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedCategory, setSelectedCategory] = createSignal<TokenType | "">("");
  const [selectedTokenName, setSelectedTokenName] = createSignal<string | null>(
    props.initialSelection ?? null,
  );

  // Sync initialSelection when dialog opens
  createEffect(() => {
    if (props.isOpen && props.initialSelection) {
      setSelectedTokenName(props.initialSelection);
    }
  });

  // ── Derived ──────────────────────────────────────────────────────────

  const selectedToken = createMemo((): Token | null => {
    const name = selectedTokenName();
    if (!name) return null;
    return store.state.tokens[name] ?? null;
  });

  // ── Handlers ─────────────────────────────────────────────────────────

  function handleUpdateToken(name: string, value: TokenValue, description?: string): void {
    store.updateToken(name, value, description);
  }

  function handleDeleteToken(name: string): void {
    store.deleteToken(name);
    announce(t("panels:tokens.tokenDeleted", { name }));
    setSelectedTokenName(null);
  }

  function handleDuplicateToken(name: string): void {
    const original = store.state.tokens[name];
    if (!original) return;

    // Find a unique name with -copy suffix
    let copyName = `${name}-copy`;
    let attempt = 1;
    while (store.state.tokens[copyName] !== undefined) {
      attempt += 1;
      copyName = `${name}-copy${attempt}`;
    }

    // Validate generated name before creating
    const nameError = validateTokenName(copyName);
    if (nameError !== null) {
      announce(nameError);
      return;
    }

    store.createToken(copyName, original.token_type, original.value, original.description ?? undefined);
    announce(t("panels:tokens.tokenCreated", { name: copyName }));
    setSelectedTokenName(copyName);
  }

  function handleCreateToken(): void {
    const category = selectedCategory();
    const tokenType: TokenType = category === "" ? "color" : category;

    // Generate a name based on category
    const baseName = `new.${tokenType}`;
    let name = baseName;
    let attempt = 1;
    while (store.state.tokens[name] !== undefined) {
      attempt += 1;
      name = `${baseName}${attempt}`;
    }

    const nameError = validateTokenName(name);
    if (nameError !== null) {
      announce(nameError);
      return;
    }

    const value = defaultTokenValue(tokenType);
    store.createToken(name, tokenType, value);
    announce(t("panels:tokens.tokenCreated", { name }));
    setSelectedTokenName(name);
  }

  function handleNavigateToToken(name: string): void {
    const token = store.state.tokens[name];
    if (!token) return;

    // Switch to the token's category so it's visible
    setSelectedCategory(token.token_type);
    setSelectedTokenName(name);
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={t("panels:tokens.editorTitle")}
      class="sigil-token-editor"
    >
      <div class="sigil-token-editor__layout">
        {/* Left pane: navigation */}
        <TokenNavigationPane
          tokens={store.state.tokens}
          selectedCategory={selectedCategory()}
          onCategoryChange={setSelectedCategory}
          searchQuery={searchQuery()}
          onSearchChange={setSearchQuery}
          onCreateToken={handleCreateToken}
        />

        {/* Middle pane: styleguide */}
        <TokenStyleguideView
          tokens={store.state.tokens}
          selectedCategory={selectedCategory()}
          searchQuery={searchQuery()}
          selectedToken={selectedTokenName()}
          onSelect={setSelectedTokenName}
        />

        {/* Right pane: detail editor or placeholder */}
        <div class="sigil-token-editor__detail">
          <Show
            when={selectedToken()}
            fallback={
              <div class="sigil-token-editor__no-selection">
                {t("panels:tokens.noSelection")}
              </div>
            }
          >
            {(tok) => (
              <TokenDetailPane
                token={tok()}
                tokens={store.state.tokens}
                onUpdate={handleUpdateToken}
                onDelete={handleDeleteToken}
                onDuplicate={handleDuplicateToken}
                onNavigate={handleNavigateToToken}
              />
            )}
          </Show>
        </div>
      </div>
    </Dialog>
  );
};
