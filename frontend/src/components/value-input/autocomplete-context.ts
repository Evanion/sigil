/**
 * Autocomplete context extraction for ValueInput.
 *
 * Extracted from ValueInput.tsx so that it can be independently tested
 * without importing any Solid.js component code.
 */

import { extractFontQuery } from "./token-autocomplete";

// ── Types ───────────────────────────────────────────────────────────────

export interface AutocompleteContext {
  readonly mode: "token" | "function" | "font";
  readonly query: string;
  /** Character index where the trigger starts (e.g., position of `{`). */
  readonly triggerStart: number;
}

// ── Context extraction ──────────────────────────────────────────────────

/**
 * Determine if autocomplete should activate based on the text and cursor position.
 * Returns null if autocomplete should not be open.
 *
 * Token mode: triggered by `{` — extracts query from `{` to cursor.
 * Font mode: triggered by typing letters in a font_family field (no `{` prefix).
 * Function mode: triggered by typing an identifier prefix not inside `{}` in
 *   non-font fields (2+ character threshold).
 *
 * @param text - The full text content of the input.
 * @param cursorPos - The cursor position (character offset from start).
 * @param isFontField - Whether the field accepts font_family values.
 */
export function getAutocompleteContext(
  text: string,
  cursorPos: number,
  isFontField?: boolean,
): AutocompleteContext | null {
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

  // Not inside braces — check field type
  const textToCursor = text.slice(0, cursorPos);

  if (isFontField === true) {
    // Font mode: extract query from after the last comma (comma-aware)
    const query = extractFontQuery(textToCursor);
    // Trigger on any non-empty query (including single characters)
    if (query.length >= 1) {
      // triggerStart points to the start of the current font segment
      const lastComma = textToCursor.lastIndexOf(",");
      const segmentStart = lastComma === -1 ? 0 : lastComma + 1;
      // Advance past leading whitespace
      let triggerStart = segmentStart;
      while (triggerStart < cursorPos && text[triggerStart] === " ") {
        triggerStart++;
      }
      return { mode: "font", query, triggerStart };
    }
    return null;
  }

  // Not a font field — check for function name prefix.
  // Walk backwards from cursor to find the start of the current identifier.
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
