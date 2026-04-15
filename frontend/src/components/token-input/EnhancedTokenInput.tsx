/**
 * EnhancedTokenInput — contentEditable expression editor with syntax highlighting
 * and autocomplete for token references and built-in functions.
 *
 * Uses a contentEditable div (single-line, monospace) that re-renders colored
 * <span> elements on every input, preserving cursor position across re-renders.
 *
 * CLAUDE.md rules applied:
 * - stopPropagation on all keyDown events (overlay-mode keyboard rule)
 * - No `any` types
 * - Number.isFinite() on numeric eval results
 * - aria-label, role="textbox", keyboard navigable
 * - onCleanup not called inside event handlers
 * - @media (prefers-reduced-motion: reduce) in CSS
 */

import {
  createSignal,
  createEffect,
  createMemo,
  onMount,
  Show,
  Index,
  splitProps,
  type Component,
} from "solid-js";
import type { Token, TokenType } from "../../types/document";
import { highlightExpression, type HighlightSegment } from "./expression-highlight";
import {
  parseExpression,
  evaluateExpression,
  isEvalError,
  type EvalValue,
  type EvalError,
} from "../../store/expression-eval";
import {
  filterTokenSuggestions,
  filterFunctionSuggestions,
  MAX_AUTOCOMPLETE_RESULTS,
  type AutocompleteSuggestion,
  type TokenSuggestion,
  type FunctionSuggestion,
} from "./token-autocomplete";
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

// ── Cursor position helpers ────────────────────────────────────────────

/**
 * Get the cursor offset (character count) within a contentEditable element.
 * Returns the offset from the start of the element's text content.
 */
function getCursorOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

/**
 * Set the cursor to a specific character offset within a contentEditable element.
 * Walks through text nodes to find the correct position.
 */
function setCursorOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let node: Text | null = null;
  while (walker.nextNode()) {
    node = walker.currentNode as Text;
    if (currentOffset + node.length >= offset) {
      const range = document.createRange();
      range.setStart(node, offset - currentOffset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    currentOffset += node.length;
  }
  // If offset exceeds content length, place cursor at end
  if (node) {
    const range = document.createRange();
    range.setStart(node, node.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ── Error formatting ───────────────────────────────────────────────────

function formatEvalError(err: EvalError): string {
  switch (err.type) {
    case "parse":
      return `Parse error: ${err.message}`;
    case "unknownFunction":
      return `Unknown function: ${err.name}`;
    case "arityError":
      return `${err.name}() expects ${String(err.expected)} args, got ${String(err.got)}`;
    case "typeError":
      return `Type error: expected ${err.expected}, got ${err.got}`;
    case "referenceNotFound":
      return `Unknown token: ${err.name}`;
    case "depthExceeded":
      return "Expression too deeply nested";
    case "divisionByZero":
      return "Division by zero";
    case "domainError":
      return `Domain error: ${err.message}`;
  }
}

function formatEvalValue(val: EvalValue): string {
  switch (val.type) {
    case "number": {
      if (!Number.isFinite(val.value)) return "—";
      return String(val.value);
    }
    case "color": {
      const c = val.value;
      switch (c.space) {
        case "srgb":
        case "display_p3":
          return `rgba(${String(c.r)}, ${String(c.g)}, ${String(c.b)}, ${String(c.a)})`;
        case "oklch":
          return `oklch(${String(c.l)} ${String(c.c)} ${String(c.h)} / ${String(c.a)})`;
        case "oklab":
          return `oklab(${String(c.l)} ${String(c.a)} ${String(c.b)} / ${String(c.alpha)})`;
      }
      break;
    }
    case "string":
      return val.value;
  }
}

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

const EnhancedTokenInput: Component<EnhancedTokenInputProps> = (props) => {
  const [local] = splitProps(props, [
    "value",
    "onChange",
    "tokens",
    "tokenType",
    "placeholder",
    "disabled",
    "aria-label",
  ]);

  // eslint-disable-next-line no-unassigned-vars
  let inputRef: HTMLDivElement | undefined;
  const statusId = `sigil-token-input-status-${Math.random().toString(36).slice(2, 8)}`;
  const listboxId = `sigil-token-input-listbox-${Math.random().toString(36).slice(2, 8)}`;

  // ── Internal state ─────────────────────────────────────────────────

  const [confirmedValue, setConfirmedValue] = createSignal(local.value);
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
      return filterTokenSuggestions(local.tokens, q, local.tokenType, MAX_AUTOCOMPLETE_RESULTS);
    }
    return filterFunctionSuggestions(q, MAX_AUTOCOMPLETE_RESULTS);
  });

  /** Parse + evaluate the current text for status display. */
  const evalResult = createMemo<{ error: string | null; resolved: string | null }>(() => {
    const text = confirmedValue();
    if (text.trim().length === 0) return { error: null, resolved: null };

    const parsed = parseExpression(text);
    if (isEvalError(parsed)) {
      return { error: formatEvalError(parsed), resolved: null };
    }

    const result = evaluateExpression(parsed, local.tokens);
    if (isEvalError(result)) {
      return { error: formatEvalError(result), resolved: null };
    }

    return { error: null, resolved: formatEvalValue(result) };
  });

  // ── Rendering helpers ──────────────────────────────────────────────

  /**
   * Re-render the contentEditable content with syntax-highlighted spans.
   * Preserves cursor position across the DOM rewrite.
   */
  function renderHighlighted(text: string, preserveCursor: boolean): void {
    if (!inputRef) return;

    const cursorOffset = preserveCursor ? getCursorOffset(inputRef) : 0;

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

  function updateAutocomplete(): void {
    if (!inputRef) return;
    const text = getInputText();
    const cursor = getCursorOffset(inputRef);
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
      // Replace from `{` through current query with `{name}`
      replaceStart = ctx.triggerStart;
      replaceEnd = ctx.triggerStart + 1 + ctx.query.length; // `{` + query
      insertText = `{${suggestion.name}}`;
    } else {
      // Replace the function prefix with the function name + `(`
      replaceStart = ctx.triggerStart;
      replaceEnd = ctx.triggerStart + ctx.query.length;
      insertText = `${suggestion.name}(`;
    }

    const newText = text.slice(0, replaceStart) + insertText + text.slice(replaceEnd);
    const newCursor = replaceStart + insertText.length;

    renderHighlighted(newText, false);
    setCursorOffset(inputRef, newCursor);
    closeAutocomplete();
  }

  // ── Event handlers ─────────────────────────────────────────────────

  function handleInput(): void {
    const text = getInputText();
    renderHighlighted(text, true);
    updateAutocomplete();
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
    } else {
      // Not in autocomplete mode
      switch (e.key) {
        case "Enter": {
          e.preventDefault();
          const text = getInputText();
          setConfirmedValue(text);
          local.onChange(text);
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
    closeAutocomplete();
  }

  function handlePaste(e: ClipboardEvent): void {
    // Paste as plain text only
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    // Remove newlines for single-line behavior
    const singleLine = text.replace(/[\r\n]/g, " ");
    document.execCommand("insertText", false, singleLine);
  }

  function handleAutocompleteItemClick(suggestion: AutocompleteSuggestion): void {
    insertSuggestion(suggestion);
    inputRef?.focus();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  onMount(() => {
    if (inputRef) {
      renderHighlighted(local.value, false);
    }
  });

  // Sync external value changes
  createEffect(() => {
    const externalValue = local.value;
    setConfirmedValue(externalValue);
    // Only re-render if the input is not focused (avoid clobbering user edits)
    if (!isFocused()) {
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
      <div
        ref={inputRef}
        class="sigil-token-input"
        classList={{ "sigil-token-input--disabled": local.disabled === true }}
        role="textbox"
        contentEditable={local.disabled !== true}
        aria-label={local["aria-label"] ?? "Token expression"}
        aria-describedby={statusId}
        aria-autocomplete={autocompleteOpen() ? "list" : undefined}
        aria-expanded={autocompleteOpen() ? true : undefined}
        aria-activedescendant={
          autocompleteOpen() && suggestions().length > 0
            ? `sigil-ac-option-${String(highlightedIndex())}`
            : undefined
        }
        aria-controls={autocompleteOpen() ? listboxId : undefined}
        data-placeholder={local.placeholder}
        tabIndex={local.disabled ? -1 : 0}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPaste={handlePaste}
      />

      {/* Autocomplete dropdown */}
      <Show when={autocompleteOpen() && suggestions().length > 0}>
        <div
          id={listboxId}
          class="sigil-token-input__autocomplete"
          role="listbox"
          aria-label="Suggestions"
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
      </Show>

      {/* Status area */}
      <div id={statusId} class="sigil-token-input__status" aria-live="polite">
        <Show when={evalResult().error !== null}>
          <span class="sigil-token-input__error-msg">{evalResult().error}</span>
        </Show>
        <Show when={evalResult().error === null && evalResult().resolved !== null}>
          <span class="sigil-token-input__resolved">= {evalResult().resolved}</span>
        </Show>
      </div>
    </div>
  );
};

export default EnhancedTokenInput;
