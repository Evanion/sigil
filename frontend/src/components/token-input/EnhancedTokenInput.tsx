/**
 * EnhancedTokenInput — contentEditable expression editor with syntax highlighting
 * and autocomplete for token references and built-in functions.
 *
 * Uses a contentEditable div (single-line, monospace) that re-renders colored
 * <span> elements on every input, preserving cursor position across re-renders.
 *
 * Note: spec §4.1 defines `mode` and `onModeChange` props. These are omitted
 * because the component auto-detects mode from content (bare {name} = reference,
 * operators/functions = expression). Mode switching is handled by the parent
 * (TokenDetailEditor) which shows different editors per mode. (RF-025)
 *
 * CLAUDE.md rules applied:
 * - stopPropagation on all keyDown events (overlay-mode keyboard rule)
 * - No `any` types
 * - Number.isFinite() on numeric eval results
 * - aria-label, role="combobox", keyboard navigable
 * - onCleanup not called inside event handlers
 * - @media (prefers-reduced-motion: reduce) in CSS
 */

import {
  createSignal,
  createEffect,
  createMemo,
  createUniqueId,
  onMount,
  Show,
  Index,
  type Component,
} from "solid-js";
import type { Token, TokenType } from "../../types/document";
import { highlightExpression, type HighlightSegment } from "./expression-highlight";
import {
  parseExpression,
  evaluateExpression,
  isEvalError,
  MAX_EXPRESSION_LENGTH,
} from "../../store/expression-eval";
import {
  filterTokenSuggestions,
  filterFunctionSuggestions,
  MAX_AUTOCOMPLETE_RESULTS,
  type AutocompleteSuggestion,
  type TokenSuggestion,
  type FunctionSuggestion,
} from "./token-autocomplete";
import {
  getCursorOffset,
  setCursorOffset,
  formatEvalError,
  formatEvalValue,
  insertPlainTextAtCursor,
} from "./input-helpers";
import "./EnhancedTokenInput.css";

// ── Props ──────────────────────────────────────────────────────────────

export interface EnhancedTokenInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly tokens: Record<string, Token>;
  readonly tokenType?: TokenType;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}

// ── CSS class map for highlight segments ───────────────────────────────

const SEGMENT_CLASS_MAP: Record<HighlightSegment["type"], string> = {
  tokenRef: "sigil-token-input__token-ref",
  function: "sigil-token-input__function",
  number: "sigil-token-input__number",
  operator: "sigil-token-input__operator",
  paren: "sigil-token-input__paren",
  text: "",
  error: "sigil-token-input__error-segment",
};

/** Default placeholder text when none is provided via props. (RF-013) */
const DEFAULT_PLACEHOLDER = "Type { for tokens, or an expression";

// ── Autocomplete context extraction ────────────────────────────────────

interface AutocompleteContext {
  readonly mode: "token" | "function";
  readonly query: string;
  /** Character index where the trigger starts (e.g., position of `{`). */
  readonly triggerStart: number;
}

/**
 * Determine if autocomplete should activate based on the text and cursor position.
 * Returns null if autocomplete should not be open.
 *
 * Token mode: triggered by `{` — extracts query from `{` to cursor.
 * Function mode: triggered by typing an identifier prefix not inside `{}`.
 */
function getAutocompleteContext(text: string, cursorPos: number): AutocompleteContext | null {
  // Look backwards from cursor for an unclosed `{`
  let braceDepth = 0;
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (text[i] === "}") {
      braceDepth++;
    } else if (text[i] === "{") {
      if (braceDepth > 0) {
        braceDepth--;
      } else {
        // Found unclosed `{` — we are inside a token reference
        const query = text.slice(i + 1, cursorPos);
        return { mode: "token", query, triggerStart: i };
      }
    }
  }

  // Not inside braces — check for function name prefix
  // Walk backwards from cursor to find the start of the current identifier
  let identStart = cursorPos;
  while (identStart > 0) {
    const ch = text[identStart - 1];
    if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_"
    ) {
      identStart--;
    } else {
      break;
    }
  }

  if (identStart < cursorPos) {
    const query = text.slice(identStart, cursorPos);
    // Only trigger function autocomplete if we have at least 1 character
    if (query.length >= 1) {
      return { mode: "function", query, triggerStart: identStart };
    }
  }

  return null;
}

// ── Component ──────────────────────────────────────────────────────────

// RF-022: props are accessed directly — splitProps is unnecessary here because
// all props are consumed by this component (no pass-through to a child element).
const EnhancedTokenInput: Component<EnhancedTokenInputProps> = (props) => {
  // eslint-disable-next-line no-unassigned-vars
  let inputRef: HTMLDivElement | undefined;

  // RF-027: use Solid's createUniqueId instead of Math.random()
  const uniqueId = createUniqueId();
  const statusId = `sigil-token-input-status-${uniqueId}`;
  const listboxId = `sigil-token-input-listbox-${uniqueId}`;
  const srAnnouncementId = `sigil-token-input-sr-${uniqueId}`;

  // ── Internal state ─────────────────────────────────────────────────

  const [confirmedValue, setConfirmedValue] = createSignal(props.value);
  const [liveText, setLiveText] = createSignal(props.value);
  const [isFocused, setIsFocused] = createSignal(false);

  // Autocomplete state
  const [autocompleteOpen, setAutocompleteOpen] = createSignal(false);
  const [autocompleteQuery, setAutocompleteQuery] = createSignal("");
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [autocompleteMode, setAutocompleteMode] = createSignal<"token" | "function">("token");
  const [autocompleteContext, setAutocompleteContext] = createSignal<AutocompleteContext | null>(
    null,
  );

  // ── Derived values ─────────────────────────────────────────────────

  /** Compute autocomplete suggestions. */
  const suggestions = createMemo<readonly AutocompleteSuggestion[]>(() => {
    if (!autocompleteOpen()) return [];
    const q = autocompleteQuery();
    if (autocompleteMode() === "token") {
      return filterTokenSuggestions(props.tokens, q, props.tokenType, MAX_AUTOCOMPLETE_RESULTS);
    }
    return filterFunctionSuggestions(q, MAX_AUTOCOMPLETE_RESULTS);
  });

  /** Parse + evaluate the live text for real-time error/resolved display. */
  const evalResult = createMemo<{ error: string | null; resolved: string | null }>(() => {
    const text = liveText();
    if (text.trim().length === 0) return { error: null, resolved: null };

    const parsed = parseExpression(text);
    if (isEvalError(parsed)) {
      return { error: formatEvalError(parsed), resolved: null };
    }

    const result = evaluateExpression(parsed, props.tokens);
    if (isEvalError(result)) {
      return { error: formatEvalError(result), resolved: null };
    }

    return { error: null, resolved: formatEvalValue(result) };
  });

  // ── Rendering helpers ──────────────────────────────────────────────

  /**
   * Re-render the contentEditable content with syntax-highlighted spans.
   * Preserves cursor position across the DOM rewrite.
   *
   * RF-011: accepts an optional pre-computed cursorOffset to avoid
   * double computation when the caller already measured it.
   */
  function renderHighlighted(
    text: string,
    preserveCursor: boolean,
    cachedCursorOffset?: number,
  ): void {
    if (!inputRef) return;

    const cursorOffset = preserveCursor ? (cachedCursorOffset ?? getCursorOffset(inputRef)) : 0;

    const segments = highlightExpression(text);

    // Clear and rebuild DOM
    inputRef.textContent = "";

    for (const seg of segments) {
      const className = SEGMENT_CLASS_MAP[seg.type];
      if (className) {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = seg.text;
        inputRef.appendChild(span);
      } else {
        // Plain text node for unclassified segments
        inputRef.appendChild(document.createTextNode(seg.text));
      }
    }

    // If text is empty, ensure the div is truly empty (for placeholder CSS)
    if (text.length === 0) {
      inputRef.textContent = "";
    }

    if (preserveCursor) {
      setCursorOffset(inputRef, cursorOffset);
    }
  }

  /** Get plain text from the contentEditable. */
  function getInputText(): string {
    return inputRef?.textContent ?? "";
  }

  // ── Autocomplete helpers ───────────────────────────────────────────

  /** RF-011: accepts pre-computed cursor offset to avoid recalculation. */
  function updateAutocomplete(cachedCursor?: number): void {
    if (!inputRef) return;
    const text = getInputText();
    const cursor = cachedCursor ?? getCursorOffset(inputRef);
    const ctx = getAutocompleteContext(text, cursor);

    if (ctx) {
      setAutocompleteContext(ctx);
      setAutocompleteMode(ctx.mode);
      setAutocompleteQuery(ctx.query);
      setAutocompleteOpen(true);
      setHighlightedIndex(0);
    } else {
      closeAutocomplete();
    }
  }

  function closeAutocomplete(): void {
    setAutocompleteOpen(false);
    setAutocompleteQuery("");
    setAutocompleteContext(null);
    setHighlightedIndex(0);
  }

  function insertSuggestion(suggestion: AutocompleteSuggestion): void {
    if (!inputRef) return;
    const ctx = autocompleteContext();
    if (!ctx) return;

    const text = getInputText();

    let insertText: string;
    let replaceStart: number;
    let replaceEnd: number;

    if (suggestion.type === "token") {
      // Replace from `{` through query and closing `}` with `{name}`
      replaceStart = ctx.triggerStart;
      // Check if there's a closing `}` after the query (from auto-pairing)
      const afterQuery = ctx.triggerStart + 1 + ctx.query.length;
      const hasClosingBrace = text[afterQuery] === "}";
      replaceEnd = hasClosingBrace ? afterQuery + 1 : afterQuery;
      insertText = `{${suggestion.name}}`;
    } else {
      // Replace the function prefix with the function name + `()`
      replaceStart = ctx.triggerStart;
      replaceEnd = ctx.triggerStart + ctx.query.length;
      insertText = `${suggestion.name}()`;
    }

    const newText = text.slice(0, replaceStart) + insertText + text.slice(replaceEnd);
    // For tokens: cursor after closing `}` (ready to type operator)
    // For functions: cursor between `()` (ready to type first argument)
    const newCursor =
      suggestion.type === "token"
        ? replaceStart + insertText.length
        : replaceStart + insertText.length - 1; // before the closing `)`

    renderHighlighted(newText, false);
    setCursorOffset(inputRef, newCursor);
    closeAutocomplete();

    // RF-006: commit the value after inserting a suggestion
    setLiveText(newText);
    setConfirmedValue(newText);
    props.onChange(newText);
  }

  // ── Event handlers ─────────────────────────────────────────────────

  function handleInput(): void {
    const text = getInputText();

    // RF-002: enforce MAX_EXPRESSION_LENGTH — don't re-highlight oversized input
    if (text.length > MAX_EXPRESSION_LENGTH) {
      // Restore to the confirmed value to reject the input
      const current = confirmedValue();
      renderHighlighted(current, false);
      return;
    }

    // Update live text for real-time error/resolved display
    setLiveText(text);

    // RF-011: compute cursor offset ONCE and pass to both functions
    const cursor = inputRef ? getCursorOffset(inputRef) : 0;
    renderHighlighted(text, true, cursor);
    updateAutocomplete(cursor);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    // stopPropagation on ALL key events to prevent document shortcuts
    // (CLAUDE.md: Overlay-mode keyboard handlers must use stopPropagation)
    e.stopPropagation();

    // Autocomplete navigation
    if (autocompleteOpen()) {
      const count = suggestions().length;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev + 1) % Math.max(count, 1));
          return;
        }
        case "ArrowUp": {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev - 1 + Math.max(count, 1)) % Math.max(count, 1));
          return;
        }
        case "Tab": {
          e.preventDefault();
          const items = suggestions();
          const idx = highlightedIndex();
          if (items.length > 0 && idx < items.length) {
            insertSuggestion(items[idx]);
          }
          return;
        }
        case "Enter": {
          e.preventDefault();
          const items = suggestions();
          const idx = highlightedIndex();
          if (items.length > 0 && idx < items.length) {
            insertSuggestion(items[idx]);
          }
          return;
        }
        case "Escape": {
          e.preventDefault();
          closeAutocomplete();
          return;
        }
      }
      // For other keys, fall through to normal handling
    }

    // ── Auto-pairing for { and ( ──────────────────────────────────────
    // Typing `{` inserts `{}` with cursor between them, then opens autocomplete.
    // Typing `(` inserts `()` with cursor between them.
    if (e.key === "{" && !autocompleteOpen()) {
      e.preventDefault();
      if (!inputRef) return;
      const text = getInputText();
      const cursor = getCursorOffset(inputRef);
      const newText = text.slice(0, cursor) + "{}" + text.slice(cursor);
      renderHighlighted(newText, false);
      setCursorOffset(inputRef, cursor + 1); // cursor between { and }
      updateAutocomplete(cursor + 1);
      return;
    }

    if (e.key === "(") {
      e.preventDefault();
      if (!inputRef) return;
      const text = getInputText();
      const cursor = getCursorOffset(inputRef);
      const newText = text.slice(0, cursor) + "()" + text.slice(cursor);
      renderHighlighted(newText, false);
      setCursorOffset(inputRef, cursor + 1); // cursor between ( and )
      return;
    }

    if (!autocompleteOpen()) {
      // Not in autocomplete mode
      switch (e.key) {
        case "Enter": {
          e.preventDefault();
          const text = getInputText();
          setConfirmedValue(text);
          props.onChange(text);
          return;
        }
        case "Escape": {
          e.preventDefault();
          // Revert to last confirmed value
          const revertTo = confirmedValue();
          renderHighlighted(revertTo, false);
          return;
        }
      }
    }
  }

  function handleFocus(): void {
    setIsFocused(true);
  }

  function handleBlur(): void {
    setIsFocused(false);

    // RF-008: commit uncommitted changes on blur
    const currentText = getInputText();
    if (currentText !== confirmedValue()) {
      setConfirmedValue(currentText);
      props.onChange(currentText);
    }

    closeAutocomplete();
  }

  function handlePaste(e: ClipboardEvent): void {
    // Paste as plain text only
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    // Remove newlines for single-line behavior
    let singleLine = text.replace(/[\r\n]/g, " ");

    // RF-003: enforce MAX_EXPRESSION_LENGTH on paste
    const currentText = getInputText();
    const remaining = MAX_EXPRESSION_LENGTH - currentText.length;
    if (remaining <= 0) return;
    if (singleLine.length > remaining) {
      singleLine = singleLine.slice(0, remaining);
    }

    // RF-020: use DOM manipulation instead of deprecated execCommand
    insertPlainTextAtCursor(singleLine);
  }

  function handleAutocompleteItemClick(suggestion: AutocompleteSuggestion): void {
    insertSuggestion(suggestion);
    inputRef?.focus();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  onMount(() => {
    if (inputRef) {
      renderHighlighted(props.value, false);
    }
  });

  // Sync external value changes
  // RF-007: only update confirmedValue when input is not focused,
  // so Escape reverts to the value at focus-time, not the latest external value
  createEffect(() => {
    const externalValue = props.value;
    if (!isFocused()) {
      setLiveText(externalValue);
      setConfirmedValue(externalValue);
      renderHighlighted(externalValue, false);
    }
  });

  // ── Suggestion content renderer ──────────────────────────────────

  /** Helper to extract suggestion display fields reactively. */
  function SuggestionContent(scProps: { readonly item: () => AutocompleteSuggestion }) {
    const asToken = (): TokenSuggestion | false =>
      scProps.item().type === "token" ? (scProps.item() as TokenSuggestion) : false;
    const asFn = (): FunctionSuggestion | false =>
      scProps.item().type === "function" ? (scProps.item() as FunctionSuggestion) : false;

    return (
      <>
        <Show when={asToken()} keyed>
          {(tok) => (
            <>
              <span class="sigil-token-input__ac-name">{tok.name}</span>
              <span class="sigil-token-input__ac-preview">{tok.preview}</span>
            </>
          )}
        </Show>
        <Show when={asFn()} keyed>
          {(fn) => (
            <>
              <span class="sigil-token-input__ac-name">{fn.signature}</span>
              <span class="sigil-token-input__ac-desc">{fn.description}</span>
            </>
          )}
        </Show>
      </>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div class="sigil-token-input__wrapper">
      {/* RF-001: role="combobox" with aria-haspopup and always-present aria-expanded */}
      <div
        ref={inputRef}
        class="sigil-token-input"
        classList={{ "sigil-token-input--disabled": props.disabled === true }}
        role="combobox"
        contentEditable={props.disabled !== true}
        aria-label={props["aria-label"] ?? "Token expression"}
        aria-describedby={statusId}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-expanded={autocompleteOpen()}
        aria-disabled={props.disabled === true || undefined}
        aria-activedescendant={
          autocompleteOpen() && suggestions().length > 0
            ? `sigil-ac-option-${String(highlightedIndex())}`
            : undefined
        }
        aria-controls={listboxId}
        data-placeholder={props.placeholder ?? DEFAULT_PLACEHOLDER}
        tabIndex={props.disabled ? -1 : 0}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPaste={handlePaste}
      />

      {/* RF-010: SR announcement for autocomplete suggestion count */}
      <span
        id={srAnnouncementId}
        class="sigil-token-input__sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {autocompleteOpen() && suggestions().length > 0
          ? `${String(suggestions().length)} suggestions available`
          : autocompleteOpen()
            ? "No suggestions"
            : ""}
      </span>

      {/* RF-028: always render listbox in DOM so aria-controls references a valid element */}
      <div
        id={listboxId}
        class="sigil-token-input__autocomplete"
        role="listbox"
        aria-label="Suggestions"
        style={{
          display: autocompleteOpen() && suggestions().length > 0 ? "block" : "none",
        }}
      >
        <Index each={suggestions()}>
          {(suggestion, index) => {
            const item = (): AutocompleteSuggestion => suggestion();
            return (
              <div
                id={`sigil-ac-option-${String(index)}`}
                class="sigil-token-input__ac-item"
                classList={{
                  "sigil-token-input__ac-item--highlighted": highlightedIndex() === index,
                }}
                role="option"
                aria-selected={highlightedIndex() === index}
                onMouseDown={(e) => {
                  // Prevent blur on input before we handle the click
                  e.preventDefault();
                }}
                onClick={() => handleAutocompleteItemClick(item())}
              >
                <SuggestionContent item={item} />
              </div>
            );
          }}
        </Index>
      </div>

      {/* Status area — errors show as info (muted) while focused, red after blur/commit */}
      <div id={statusId} class="sigil-token-input__status" aria-live="polite">
        <Show when={evalResult().error !== null}>
          <span
            class={isFocused() ? "sigil-token-input__info-msg" : "sigil-token-input__error-msg"}
          >
            {evalResult().error}
          </span>
        </Show>
        <Show when={evalResult().error === null && evalResult().resolved !== null}>
          <span class="sigil-token-input__resolved">= {evalResult().resolved}</span>
        </Show>
      </div>
    </div>
  );
};

export default EnhancedTokenInput;
