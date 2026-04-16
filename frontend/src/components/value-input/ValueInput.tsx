/**
 * ValueInput — contentEditable expression editor with syntax highlighting
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
 * - Native HTML popover for color picker overlay (not Kobalte)
 */

import {
  createSignal,
  createEffect,
  createMemo,
  createUniqueId,
  onMount,
  onCleanup,
  Show,
  Index,
  type Component,
} from "solid-js";
import type { Token, TokenType, Color, ColorSrgb } from "../../types/document";
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
  filterFontSuggestions,
  isGenericFamily,
  MAX_AUTOCOMPLETE_RESULTS,
  type AutocompleteSuggestion,
  type TokenSuggestion,
  type FunctionSuggestion,
  type FontSuggestion,
} from "./token-autocomplete";
import {
  getCursorOffset,
  setCursorOffset,
  formatEvalError,
  formatEvalValue,
  insertPlainTextAtCursor,
} from "./input-helpers";
import { detectValueMode, type ValueType, type DetectedMode } from "./value-detect";
import { parseHexColor, colorToHex } from "./color-parse";
import type { FontProvider } from "./font-provider";
import { validateCssIdentifier } from "../../validation/css-identifiers";
import { getAutocompleteContext } from "./autocomplete-context";
import type { AutocompleteContext } from "./autocomplete-context";
import { ColorPicker } from "../color-picker/ColorPicker";
import "./ValueInput.css";

// ── Props ──────────────────────────────────────────────────────────────

export interface ValueInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /**
   * Called on discrete commit events (blur, Enter, popover close) — use for
   * history-tracked mutations.  `onChange` fires on every intermediate change
   * (including color-picker drag ticks) for visual preview only.
   */
  readonly onCommit?: (value: string) => void;
  readonly tokens: Record<string, Token>;
  /** @deprecated Use `acceptedTypes` instead. Retained for backward compatibility. */
  readonly tokenType?: TokenType;
  /** The value types this field accepts. When omitted, falls back to tokenType mapping. */
  readonly acceptedTypes?: readonly ValueType[];
  /** Font provider for font_family autocomplete (future Task 4). */
  readonly fontProvider?: FontProvider;
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

// ── Type mapping helpers ────────────────────────────────────────────────

/**
 * Map acceptedTypes to the TokenType used for autocomplete filtering.
 * Returns undefined (no filter) if "string" is accepted or no mapping is possible.
 */
export function resolveTokenTypeFilter(
  acceptedTypes: readonly ValueType[] | undefined,
  legacyTokenType: TokenType | undefined,
): TokenType | undefined {
  // Prefer acceptedTypes over legacy tokenType
  if (acceptedTypes !== undefined && acceptedTypes.length > 0) {
    // "string" accepts all token types
    if (acceptedTypes.includes("string")) return undefined;

    // Map the first matching value type to a token type
    for (const vt of acceptedTypes) {
      switch (vt) {
        case "color":
          return "color";
        case "number":
          return "number";
        case "dimension":
          return "dimension";
        case "font_family":
          return "font_family";
        // "string" handled above
      }
    }
    return undefined;
  }

  // Fall back to legacy tokenType prop
  return legacyTokenType;
}

/**
 * Resolve a color from the current input value.
 * Returns a ColorSrgb if the value is a hex literal or a single token ref
 * that resolves to a color token. Returns null otherwise.
 */
export function resolveSwatchColor(value: string, tokens: Record<string, Token>): ColorSrgb | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Hex literal: parse directly
  if (trimmed.startsWith("#")) {
    return parseHexColor(trimmed);
  }

  // Single token reference: {name} — resolve from tokens
  const tokenRefMatch = /^\{([^{}]+)\}$/.exec(trimmed);
  if (tokenRefMatch !== null && tokenRefMatch[1] !== undefined) {
    const tokenName = tokenRefMatch[1];
    const token = tokens[tokenName];
    if (token !== undefined && token.value.type === "color") {
      const c = token.value.value;
      if (c.space === "srgb") {
        return c;
      }
    }
  }

  return null;
}

/**
 * Determine type validation message when the detected mode doesn't match
 * acceptedTypes. Returns null if the value is valid for the field.
 */
export function getTypeValidationMessage(
  mode: DetectedMode,
  acceptedTypes: readonly ValueType[],
): string | null {
  // Token references and expressions are always accepted — type check at eval time
  if (mode === "reference" || mode === "expression" || mode === "unknown") {
    return null;
  }

  if (mode === "literal-color" && !acceptedTypes.includes("color")) {
    return "Color values not accepted in this field";
  }

  if (
    mode === "literal-number" &&
    !acceptedTypes.includes("number") &&
    !acceptedTypes.includes("dimension")
  ) {
    return "Number values not accepted in this field";
  }

  if (mode === "literal-font" && !acceptedTypes.includes("font_family")) {
    return "Font values not accepted in this field";
  }

  return null;
}

// ── Component ──────────────────────────────────────────────────────────

// RF-022: props are accessed directly — splitProps is unnecessary here because
// all props are consumed by this component (no pass-through to a child element).
const ValueInput: Component<ValueInputProps> = (props) => {
  // eslint-disable-next-line no-unassigned-vars
  let inputRef: HTMLDivElement | undefined;
  // eslint-disable-next-line no-unassigned-vars
  let popoverRef: HTMLDivElement | undefined;

  // RF-027: use Solid's createUniqueId instead of Math.random()
  const uniqueId = createUniqueId();
  const statusId = `sigil-token-input-status-${uniqueId}`;
  const listboxId = `sigil-token-input-listbox-${uniqueId}`;
  const srAnnouncementId = `sigil-token-input-sr-${uniqueId}`;
  const popoverId = `sigil-token-input-popover-${uniqueId}`;

  // ── Internal state ─────────────────────────────────────────────────

  const [confirmedValue, setConfirmedValue] = createSignal(props.value);
  const [liveText, setLiveText] = createSignal(props.value);
  const [isFocused, setIsFocused] = createSignal(false);
  const [colorPickerOpen, setColorPickerOpen] = createSignal(false);

  // SR-only committed status — updated only on discrete events (blur, Enter,
  // popover close) so the aria-live region does not fire on every keystroke.
  const [committedStatus, setCommittedStatus] = createSignal("");

  // Autocomplete state
  const [autocompleteOpen, setAutocompleteOpen] = createSignal(false);
  const [autocompleteQuery, setAutocompleteQuery] = createSignal("");
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [autocompleteMode, setAutocompleteMode] = createSignal<"token" | "function" | "font">(
    "token",
  );
  const [autocompleteContext, setAutocompleteContext] = createSignal<AutocompleteContext | null>(
    null,
  );

  // ── Derived values ─────────────────────────────────────────────────

  /** Effective acceptedTypes — derived from props or legacy tokenType. */
  const effectiveAcceptedTypes = createMemo<readonly ValueType[]>(() => {
    if (props.acceptedTypes !== undefined && props.acceptedTypes.length > 0) {
      return props.acceptedTypes;
    }
    // Derive from legacy tokenType if provided
    if (props.tokenType !== undefined) {
      switch (props.tokenType) {
        case "color":
          return ["color"] as const;
        case "number":
          return ["number"] as const;
        case "dimension":
          return ["dimension"] as const;
        case "font_family":
          return ["font_family"] as const;
        default:
          return ["string"] as const;
      }
    }
    return ["string"] as const;
  });

  /** Whether this field accepts colors (controls swatch visibility). */
  const acceptsColor = createMemo<boolean>(() => effectiveAcceptedTypes().includes("color"));

  /** Whether this field accepts font_family values (controls font autocomplete). */
  const isFontField = createMemo<boolean>(() => effectiveAcceptedTypes().includes("font_family"));

  /** Resolve the token type filter for autocomplete. */
  const tokenTypeFilter = createMemo<TokenType | undefined>(() =>
    resolveTokenTypeFilter(props.acceptedTypes, props.tokenType),
  );

  /** Detect the current value mode for border coloring and validation. */
  const detectedMode = createMemo<DetectedMode>(() =>
    detectValueMode(liveText(), effectiveAcceptedTypes()),
  );

  /** CSS class for the detected mode — controls border coloring. */
  const modeClass = createMemo<string>(() => {
    const mode = detectedMode();
    switch (mode) {
      case "reference":
        return "sigil-token-input--mode-reference";
      case "expression":
        return "sigil-token-input--mode-expression";
      default:
        return "";
    }
  });

  /** Resolve the swatch color from the current value. */
  const swatchColor = createMemo<ColorSrgb | null>(() => {
    if (!acceptsColor()) return null;
    return resolveSwatchColor(liveText(), props.tokens);
  });

  /** CSS background-color string for the swatch. */
  const swatchBgStyle = createMemo<string>(() => {
    const color = swatchColor();
    if (color === null) return "transparent";
    // Guard all channels with Number.isFinite before CSS interpolation
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = color.a;
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
      return "transparent";
    }
    return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(a)})`;
  });

  /** Compute autocomplete suggestions. */
  const suggestions = createMemo<readonly AutocompleteSuggestion[]>(() => {
    if (!autocompleteOpen()) return [];
    const q = autocompleteQuery();
    const mode = autocompleteMode();
    if (mode === "token") {
      return filterTokenSuggestions(props.tokens, q, tokenTypeFilter(), MAX_AUTOCOMPLETE_RESULTS);
    }
    if (mode === "font") {
      const provider = props.fontProvider;
      if (provider === undefined) return [];
      return filterFontSuggestions(provider, q, MAX_AUTOCOMPLETE_RESULTS);
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

  /** Type validation message — shown when literal mode doesn't match accepted types. */
  const typeValidationMsg = createMemo<string | null>(() =>
    getTypeValidationMessage(detectedMode(), effectiveAcceptedTypes()),
  );

  /**
   * Build a status string from the current eval/validation state and push it
   * to the SR announcement signal.  Called only on discrete commit events.
   */
  function announceStatus(): void {
    const typeMsg = typeValidationMsg();
    if (typeMsg !== null) {
      setCommittedStatus(typeMsg);
      return;
    }
    const ev = evalResult();
    if (ev.error !== null) {
      setCommittedStatus(ev.error);
      return;
    }
    if (ev.resolved !== null) {
      setCommittedStatus(`Resolved: ${ev.resolved}`);
      return;
    }
    setCommittedStatus("");
  }

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
    const ctx = getAutocompleteContext(text, cursor, isFontField());

    if (ctx) {
      // For font mode, only activate if a fontProvider is available.
      if (ctx.mode === "font" && props.fontProvider === undefined) {
        closeAutocomplete();
        return;
      }
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
    let newCursor: number;

    if (suggestion.type === "token") {
      // Replace from `{` through query and closing `}` with `{name}`
      replaceStart = ctx.triggerStart;
      // Check if there's a closing `}` after the query (from auto-pairing)
      const afterQuery = ctx.triggerStart + 1 + ctx.query.length;
      const hasClosingBrace = text[afterQuery] === "}";
      replaceEnd = hasClosingBrace ? afterQuery + 1 : afterQuery;
      insertText = `{${suggestion.name}}`;
      newCursor = replaceStart + insertText.length; // cursor after closing `}`
    } else if (suggestion.type === "font") {
      // Replace only the current font segment (after the last comma).
      // For non-generic fonts, append ", " to encourage adding fallbacks.
      // Use frozen context (triggerStart + query.length) for consistency with
      // token and function branches — avoids a live DOM read that could race
      // with cursor movement between context capture and insertion. (Fix I1)
      replaceStart = ctx.triggerStart;
      replaceEnd = ctx.triggerStart + ctx.query.length;
      const generic = isGenericFamily(suggestion.name);
      insertText = generic ? suggestion.name : `${suggestion.name}, `;
      newCursor = replaceStart + insertText.length;
    } else {
      // Replace the function prefix with the function name + `()`
      replaceStart = ctx.triggerStart;
      replaceEnd = ctx.triggerStart + ctx.query.length;
      insertText = `${suggestion.name}()`;
      newCursor = replaceStart + insertText.length - 1; // between `(` and `)`
    }

    const newText = text.slice(0, replaceStart) + insertText + text.slice(replaceEnd);

    renderHighlighted(newText, false);
    setCursorOffset(inputRef, newCursor);
    closeAutocomplete();

    // RF-006: commit the value after inserting a suggestion
    setLiveText(newText);
    setConfirmedValue(newText);
    props.onChange(newText);
    props.onCommit?.(newText);
    announceStatus();
  }

  // ── Color picker helpers ────────────────────────────────────────────

  function handleSwatchClick(): void {
    if (popoverRef) {
      popoverRef.togglePopover();
      setColorPickerOpen((prev) => !prev);
    }
  }

  function handleColorPickerChange(color: Color): void {
    if (color.space !== "srgb") return;
    const hex = colorToHex(color);
    if (hex === "") return;
    // During drag: preview only — no confirmed value update, no onCommit.
    // The commit happens when the popover closes (handlePopoverToggle).
    setLiveText(hex);
    renderHighlighted(hex, false);
    props.onChange(hex);
  }

  /** Called when a sub-component drag ends inside the picker. */
  function handleColorPickerCommit(): void {
    // Flush the current live text as the confirmed value and notify parent.
    const hex = liveText();
    setConfirmedValue(hex);
    props.onCommit?.(hex);
    announceStatus();
  }

  // Close color picker when popover is dismissed (light dismiss)
  function handlePopoverToggle(e: Event): void {
    const toggleEvent = e as ToggleEvent;
    if (toggleEvent.newState === "closed") {
      setColorPickerOpen(false);
      // Treat popover close as a commit point for the color value.
      const hex = liveText();
      if (hex !== confirmedValue()) {
        setConfirmedValue(hex);
        props.onCommit?.(hex);
        announceStatus();
      }
    }
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
          props.onCommit?.(text);
          announceStatus();
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
      props.onCommit?.(currentText);
    }

    // Announce status to SR on blur (discrete event)
    announceStatus();

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

    // Register popover toggle event listener for light-dismiss tracking
    if (popoverRef) {
      popoverRef.addEventListener("toggle", handlePopoverToggle);
    }
  });

  // Cleanup popover toggle listener (registered synchronously during setup)
  onCleanup(() => {
    if (popoverRef) {
      popoverRef.removeEventListener("toggle", handlePopoverToggle);
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
    const asFont = (): FontSuggestion | false =>
      scProps.item().type === "font" ? (scProps.item() as FontSuggestion) : false;

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
        <Show when={asFont()} keyed>
          {(font) => (
            <>
              {/* Render font name in its own face for preview.
                  CSS-Rendered String: validateCssIdentifier is called at output use
                  per CLAUDE.md "CSS-Rendered String Fields Must Reject CSS-Significant
                  Characters" — defense in depth even if the provider already validates. */}
              <span
                class="sigil-token-input__ac-name sigil-token-input__ac-font-preview"
                style={
                  validateCssIdentifier(font.name)
                    ? { "font-family": font.name }
                    : { "font-family": "sans-serif" }
                }
              >
                {font.name}
              </span>
              <span class="sigil-token-input__ac-desc sigil-token-input__ac-font-source">
                {font.source === "generic"
                  ? "Generic"
                  : font.source === "system"
                    ? "System"
                    : font.source === "workspace"
                      ? "Workspace"
                      : "Plugin"}
              </span>
            </>
          )}
        </Show>
      </>
    );
  }

  // ── Color for ColorPicker ──────────────────────────────────────────

  /** The color to pass to ColorPicker — defaults to black when no color is resolved. */
  const pickerColor = createMemo<Color>(() => {
    const c = swatchColor();
    if (c !== null) return c;
    return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
  });

  // ── Render ─────────────────────────────────────────────────────────

  // CSS Anchor Positioning: each instance gets a unique anchor name so
  // multiple ValueInputs on the same page don't conflict.
  const swatchAnchorName = `--sigil-swatch-anchor-${uniqueId}`;

  return (
    <div class="sigil-token-input__wrapper">
      <div
        class="sigil-token-input__input-row"
        classList={{
          "sigil-token-input__input-row--has-swatch": acceptsColor(),
        }}
      >
        {/* Color swatch prefix — only when field accepts colors */}
        <Show when={acceptsColor()}>
          <button
            type="button"
            class="sigil-token-input__swatch-btn"
            style={{
              "background-color": swatchBgStyle(),
              // CSS Anchor Positioning: give this button a unique anchor name
              // so the popover can position itself relative to it.
              "anchor-name": swatchAnchorName,
            }}
            aria-label="Color preview, click to edit"
            aria-haspopup="dialog"
            aria-expanded={colorPickerOpen()}
            aria-controls={popoverId}
            tabIndex={0}
            onClick={handleSwatchClick}
            onMouseDown={(e) => {
              // Prevent blur on the input when clicking the swatch
              e.preventDefault();
            }}
          />
          {/* Color picker popover — native HTML popover with CSS Anchor Positioning.
              position-anchor ties the popover to the swatch button anchor above.
              position-area: bottom span-right places it below and aligned to the right.
              position-try-fallbacks: flip-block flips to above if viewport clips it.
              The margin-top fallback in CSS handles browsers without anchor positioning. */}
          <div
            ref={popoverRef}
            id={popoverId}
            popover="auto"
            class="sigil-token-input__color-popover"
            style={{
              "position-anchor": swatchAnchorName,
              "position-area": "bottom span-right",
              "position-try-fallbacks": "flip-block",
            }}
          >
            {/* Mount the ColorPicker only when the popover is open to avoid
                running its ResizeObserver / rAF loops while the control is
                idle — this also keeps Vitest+jsdom environments happy since
                the picker's canvas strips require ResizeObserver. */}
            <Show when={colorPickerOpen()}>
              <ColorPicker
                color={pickerColor()}
                onColorChange={handleColorPickerChange}
                onColorCommit={handleColorPickerCommit}
              />
            </Show>
          </div>
        </Show>

        {/* RF-001: role="combobox" with aria-haspopup and always-present aria-expanded */}
        <div
          ref={inputRef}
          class="sigil-token-input"
          classList={{
            "sigil-token-input--disabled": props.disabled === true,
            [modeClass()]: modeClass() !== "",
          }}
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
      </div>

      {/* RF-010: SR announcement for autocomplete suggestion count + committed status.
          Updated only on discrete events (blur, Enter, popover close, suggestion insert)
          so aria-live does not flood the screen reader on every keystroke. */}
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
            : committedStatus()}
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

      {/* Status area — type validation, errors, and resolved values.
          No aria-live here: visual updates happen on every keystroke which would
          flood screen readers.  SR announcements go through srAnnouncementId above,
          updated only on discrete commit events. */}
      <div id={statusId} class="sigil-token-input__status">
        <Show when={typeValidationMsg() !== null}>
          <span class="sigil-token-input__info-msg">{typeValidationMsg()}</span>
        </Show>
        <Show when={typeValidationMsg() === null && evalResult().error !== null}>
          <span
            class={isFocused() ? "sigil-token-input__info-msg" : "sigil-token-input__error-msg"}
          >
            {evalResult().error}
          </span>
        </Show>
        <Show
          when={
            typeValidationMsg() === null &&
            evalResult().error === null &&
            evalResult().resolved !== null
          }
        >
          <span class="sigil-token-input__resolved">= {evalResult().resolved}</span>
        </Show>
      </div>
    </div>
  );
};

export default ValueInput;
