/**
 * Token autocomplete utility for the enhanced token input.
 *
 * Provides filtered suggestions for tokens and built-in functions
 * based on a user query string. Used by the autocomplete dropdown
 * in the token input component.
 */

import type { Token, TokenType } from "../../types/document";
import { buildValuePreview } from "../../panels/TokenRow";
// RF-016: Import the canonical function name list from the evaluator so that
// BUILTIN_FUNCTIONS stays in sync with FUNCTION_REGISTRY. The coupling test in
// __tests__/token-autocomplete.test.ts verifies parity at test time.
import { FUNCTION_REGISTRY_NAMES } from "../../store/expression-eval";
import type { FontProvider } from "./font-provider";
import { GENERIC_FAMILIES } from "./font-provider";

// ── Suggestion types ───────────────────────────────────────────────────

export interface TokenSuggestion {
  readonly type: "token";
  readonly name: string;
  readonly tokenType: TokenType;
  readonly preview: string;
}

export interface FunctionSuggestion {
  readonly type: "function";
  readonly name: string;
  readonly signature: string;
  readonly description: string;
}

export interface FontSuggestion {
  readonly type: "font";
  readonly name: string;
  readonly source: "generic" | "system" | "workspace" | "plugin";
}

export type AutocompleteSuggestion = TokenSuggestion | FunctionSuggestion | FontSuggestion;

// ── Constants ──────────────────────────────────────────────────────────

/** Max suggestions shown in dropdown. */
export const MAX_AUTOCOMPLETE_RESULTS = 12;

// Re-export so callers that only need the name list don't import expression-eval.
export { FUNCTION_REGISTRY_NAMES };

// ── Built-in functions ─────────────────────────────────────────────────
// Mirrors the FUNCTION_REGISTRY in store/expression-eval.ts.
// Grouped by category for readability.
// COUPLING: The `name` fields here must stay in sync with FUNCTION_REGISTRY in
// expression-eval.ts. The coupling is verified by the test
// "BUILTIN_FUNCTIONS names should match FUNCTION_REGISTRY_NAMES" in
// __tests__/token-autocomplete.test.ts.
// RF-024: Pre-sorted at module initialisation — filterFunctionSuggestions iterates
// the sorted array directly without a per-call spread+sort.
const BUILTIN_FUNCTIONS: readonly FunctionSuggestion[] = ((): readonly FunctionSuggestion[] => {
  const unsorted: FunctionSuggestion[] = [
    // Math (7)
    {
      type: "function",
      name: "round",
      signature: "round(n)",
      description: "Round to nearest integer",
    },
    {
      type: "function",
      name: "ceil",
      signature: "ceil(n)",
      description: "Round up to nearest integer",
    },
    {
      type: "function",
      name: "floor",
      signature: "floor(n)",
      description: "Round down to nearest integer",
    },
    { type: "function", name: "abs", signature: "abs(n)", description: "Absolute value" },
    {
      type: "function",
      name: "min",
      signature: "min(a, b)",
      description: "Return the smaller value",
    },
    {
      type: "function",
      name: "max",
      signature: "max(a, b)",
      description: "Return the larger value",
    },
    {
      type: "function",
      name: "clamp",
      signature: "clamp(min, val, max)",
      description: "Clamp value to range",
    },

    // Size (3)
    { type: "function", name: "rem", signature: "rem(n)", description: "Convert to rem units" },
    { type: "function", name: "em", signature: "em(n)", description: "Convert to em units" },
    { type: "function", name: "px", signature: "px(n)", description: "Convert to pixel units" },

    // Color manipulation (9)
    {
      type: "function",
      name: "lighten",
      signature: "lighten(color, amount)",
      description: "Lighten a color",
    },
    {
      type: "function",
      name: "darken",
      signature: "darken(color, amount)",
      description: "Darken a color",
    },
    {
      type: "function",
      name: "saturate",
      signature: "saturate(color, amount)",
      description: "Increase color saturation",
    },
    {
      type: "function",
      name: "desaturate",
      signature: "desaturate(color, amount)",
      description: "Decrease color saturation",
    },
    {
      type: "function",
      name: "alpha",
      signature: "alpha(color, amount)",
      description: "Set color alpha",
    },
    {
      type: "function",
      name: "mix",
      signature: "mix(color1, color2, weight)",
      description: "Mix two colors",
    },
    {
      type: "function",
      name: "contrast",
      signature: "contrast(color)",
      description: "Get contrast color (black or white)",
    },
    {
      type: "function",
      name: "complement",
      signature: "complement(color)",
      description: "Get complementary color",
    },
    {
      type: "function",
      name: "hue",
      signature: "hue(color, degrees)",
      description: "Set color hue",
    },

    // Channel setters (6)
    {
      type: "function",
      name: "setRed",
      signature: "setRed(color, value)",
      description: "Set red channel",
    },
    {
      type: "function",
      name: "setGreen",
      signature: "setGreen(color, value)",
      description: "Set green channel",
    },
    {
      type: "function",
      name: "setBlue",
      signature: "setBlue(color, value)",
      description: "Set blue channel",
    },
    {
      type: "function",
      name: "setHue",
      signature: "setHue(color, degrees)",
      description: "Set hue in HSL",
    },
    {
      type: "function",
      name: "setSaturation",
      signature: "setSaturation(color, value)",
      description: "Set saturation in HSL",
    },
    {
      type: "function",
      name: "setLightness",
      signature: "setLightness(color, value)",
      description: "Set lightness in HSL",
    },

    // Channel adjusters (6)
    {
      type: "function",
      name: "adjustRed",
      signature: "adjustRed(color, delta)",
      description: "Adjust red channel",
    },
    {
      type: "function",
      name: "adjustGreen",
      signature: "adjustGreen(color, delta)",
      description: "Adjust green channel",
    },
    {
      type: "function",
      name: "adjustBlue",
      signature: "adjustBlue(color, delta)",
      description: "Adjust blue channel",
    },
    {
      type: "function",
      name: "adjustHue",
      signature: "adjustHue(color, delta)",
      description: "Adjust hue by offset",
    },
    {
      type: "function",
      name: "adjustSaturation",
      signature: "adjustSaturation(color, delta)",
      description: "Adjust saturation",
    },
    {
      type: "function",
      name: "adjustLightness",
      signature: "adjustLightness(color, delta)",
      description: "Adjust lightness",
    },

    // Channel extractors (6)
    { type: "function", name: "red", signature: "red(color)", description: "Extract red channel" },
    {
      type: "function",
      name: "green",
      signature: "green(color)",
      description: "Extract green channel",
    },
    {
      type: "function",
      name: "blue",
      signature: "blue(color)",
      description: "Extract blue channel",
    },
    {
      type: "function",
      name: "hueOf",
      signature: "hueOf(color)",
      description: "Extract hue from color",
    },
    {
      type: "function",
      name: "saturationOf",
      signature: "saturationOf(color)",
      description: "Extract saturation from color",
    },
    {
      type: "function",
      name: "lightnessOf",
      signature: "lightnessOf(color)",
      description: "Extract lightness from color",
    },

    // Blend (1)
    {
      type: "function",
      name: "blend",
      signature: "blend(base, overlay, mode)",
      description: "Blend two colors with blend mode",
    },
  ];
  // Sort once at module init — filterFunctionSuggestions iterates in-order (RF-024).
  return unsorted.sort((a, b) => a.name.localeCompare(b.name));
})();

// ── Filtering functions ────────────────────────────────────────────────

/**
 * Filter tokens matching a query. Case-insensitive substring match on name.
 *
 * @param tokens - Map of token names to Token objects.
 * @param query - Query string to match against token names.
 * @param tokenType - Optional filter to only show tokens of a specific type.
 * @param maxResults - Maximum number of results (defaults to MAX_AUTOCOMPLETE_RESULTS).
 */
export function filterTokenSuggestions(
  tokens: Record<string, Token>,
  query: string,
  tokenType?: TokenType,
  maxResults?: number,
): readonly TokenSuggestion[] {
  const limit = maxResults ?? MAX_AUTOCOMPLETE_RESULTS;
  const lowerQuery = query.toLowerCase();

  // RF-012: Filter on the full entry set first (no sort), then sort only the
  // matched subset. This avoids sorting the entire token map on every keystroke.
  const filtered: TokenSuggestion[] = [];

  for (const [name, token] of Object.entries(tokens)) {
    // Filter by token type if specified
    if (tokenType !== undefined && token.token_type !== tokenType) {
      continue;
    }

    // Case-insensitive substring match on name
    if (lowerQuery.length > 0 && !name.toLowerCase().includes(lowerQuery)) {
      continue;
    }

    filtered.push({
      type: "token",
      name,
      tokenType: token.token_type,
      preview: buildValuePreview(token.value),
    });
  }

  // Sort only the matched (smaller) set, then slice to limit.
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return filtered.slice(0, limit);
}

/**
 * Minimum number of characters required before function suggestions are shown.
 * RF-021: Using 2 (not 1) prevents the autocomplete from firing on every
 * single character typed, which would show the full 38-item list immediately.
 */
export const MIN_FUNCTION_QUERY_LENGTH = 2;

/**
 * Filter built-in functions matching a query prefix.
 * Case-insensitive prefix match on function name.
 *
 * Requires at least MIN_FUNCTION_QUERY_LENGTH characters unless maxResults is
 * explicitly provided (used by tests that need the full list).
 *
 * @param query - Query string to match against function names.
 * @param maxResults - Maximum number of results (defaults to MAX_AUTOCOMPLETE_RESULTS).
 */
export function filterFunctionSuggestions(
  query: string,
  maxResults?: number,
): readonly FunctionSuggestion[] {
  const limit = maxResults ?? MAX_AUTOCOMPLETE_RESULTS;
  const lowerQuery = query.toLowerCase();

  // RF-021: Require at least MIN_FUNCTION_QUERY_LENGTH chars to avoid showing
  // the full function list on the first character typed.
  if (lowerQuery.length > 0 && lowerQuery.length < MIN_FUNCTION_QUERY_LENGTH) {
    return [];
  }

  const filtered: FunctionSuggestion[] = [];

  // RF-024: BUILTIN_FUNCTIONS is pre-sorted at module init — iterate directly
  // without spread+sort on every call.
  for (const fn of BUILTIN_FUNCTIONS) {
    if (filtered.length >= limit) break;

    // Case-insensitive prefix match on name
    if (lowerQuery.length > 0 && !fn.name.toLowerCase().startsWith(lowerQuery)) {
      continue;
    }

    filtered.push(fn);
  }

  return filtered;
}

// ── Font suggestion helpers ────────────────────────────────────────────

/** Pre-computed set of generic family names for O(1) lookup. */
const GENERIC_FAMILY_NAMES: ReadonlySet<string> = new Set(
  GENERIC_FAMILIES.map((f) => f.name.toLowerCase()),
);

/**
 * Returns true if the given font name is a CSS generic family
 * (e.g. "serif", "sans-serif"). Generic families do not get a trailing
 * comma appended when inserted because they are typically used as
 * final fallbacks in a font stack.
 */
export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILY_NAMES.has(name.toLowerCase());
}

/**
 * Extract the font query from the text after the last comma.
 * Used to support comma-separated font fallback stacks.
 *
 * Examples:
 *   "Roboto, Hel"  → "Hel"   (query is text after last comma, trimmed)
 *   "Inter"        → "Inter" (no comma — query is the whole text)
 *   "Arial, "      → ""      (nothing typed after comma)
 *
 * @param text - The full input text up to the cursor position.
 * @returns The query string for the current font segment.
 */
export function extractFontQuery(text: string): string {
  const lastComma = text.lastIndexOf(",");
  if (lastComma === -1) {
    return text.trim();
  }
  return text.slice(lastComma + 1).trim();
}

/**
 * Filter font suggestions matching a query.
 * Case-insensitive substring match on font name.
 * Generic families are ALWAYS appended after the matching provider fonts,
 * regardless of whether they match the query — they are always available as
 * fallback suggestions. Duplicates (a generic that also matched from the
 * provider list) are excluded from the appended set.
 * Results are sorted alphabetically within each group (provider matches first,
 * then generics), then the combined list is sliced to the limit.
 *
 * @param provider - FontProvider to enumerate available fonts.
 * @param query - Query string to match against font names.
 * @param maxResults - Maximum number of results (defaults to MAX_AUTOCOMPLETE_RESULTS).
 */
export function filterFontSuggestions(
  provider: FontProvider,
  query: string,
  maxResults?: number,
): readonly FontSuggestion[] {
  const limit = maxResults ?? MAX_AUTOCOMPLETE_RESULTS;
  const lowerQuery = query.toLowerCase();

  // Collect ALL matching provider fonts first, then sort, then slice.
  // RF-004: Do NOT break early — the early break would cap results before
  // sorting, so the alphabetically-first N matches might not all be returned.
  const matched: FontSuggestion[] = [];

  for (const font of provider.listFonts()) {
    // Case-insensitive substring match on font name
    if (lowerQuery.length > 0 && !font.name.toLowerCase().includes(lowerQuery)) {
      continue;
    }

    matched.push({
      type: "font",
      name: font.name,
      source: font.source,
    });
  }

  // Sort alphabetically within the matched set.
  matched.sort((a, b) => a.name.localeCompare(b.name));

  // Build a set of names already in the matched list for dedup.
  const matchedNames = new Set(matched.map((f) => f.name.toLowerCase()));

  // Always append generic families not already present in the matched set.
  const generics: FontSuggestion[] = GENERIC_FAMILIES.filter(
    (g) => !matchedNames.has(g.name.toLowerCase()),
  ).map((g) => ({ type: "font" as const, name: g.name, source: g.source }));
  generics.sort((a, b) => a.name.localeCompare(b.name));

  return [...matched, ...generics].slice(0, limit);
}
