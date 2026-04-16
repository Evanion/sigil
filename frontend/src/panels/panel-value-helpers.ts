/**
 * Shared helpers for panel ValueInput integration (Spec 13c).
 *
 * Bridges between a panel's `StyleValue<T>` domain model and the raw string
 * representation used by `ValueInput`.
 *
 * These helpers are extracted per CLAUDE.md "Business Logic Must Not Live in
 * Inline JSX Handlers" — any panel that wires a ValueInput for a color, number
 * or dimension field must use these helpers rather than re-implementing the
 * conversion inline.
 *
 * All numeric conversions guard against NaN and infinity per CLAUDE.md
 * Floating-Point Validation.
 */

import type { Color, StyleValue } from "../types/document";
import {
  formatStyleValue,
  parseColorInput,
  parseNumberInput,
} from "../components/value-input/style-value-format";
import { colorToHex } from "../components/value-input/color-parse";

// ── Number formatting ─────────────────────────────────────────────────

/**
 * Format a numeric value as a display string, stripping trailing zeros while
 * preserving finite-ness. Returns an empty string for NaN or infinity so the
 * input does not show "NaN" to the user.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value);
}

// ── Color formatting ──────────────────────────────────────────────────

/** Format a Color as a hex string, or empty string if non-sRGB/non-finite. */
export function formatColor(color: Color): string {
  return colorToHex(color);
}

// ── StyleValue<number> formatting ─────────────────────────────────────

/**
 * Convert a `StyleValue<number>` to a display string for ValueInput.
 * - literal → numeric string (e.g., "16")
 * - token_ref → `{name}`
 * - expression → raw expression string
 */
export function formatNumberStyleValue(sv: StyleValue<number>): string {
  return formatStyleValue(sv, formatNumber);
}

/**
 * Convert a `StyleValue<Color>` to a display string for ValueInput.
 * - literal → hex string (e.g., "#ff0000")
 * - token_ref → `{name}`
 * - expression → raw expression string
 */
export function formatColorStyleValue(sv: StyleValue<Color>): string {
  return formatStyleValue(sv, formatColor);
}

// ── Parsers re-exported for panel call-sites ──────────────────────────

export { parseColorInput, parseNumberInput };

// ── Opacity-specific helpers (0-1 store, 0-100 display) ───────────────

/**
 * Convert a stored opacity `StyleValue<number>` (0..=1 for literals) to a
 * display string in 0..=100 (percent). Token refs and expressions pass through
 * unchanged — they represent arbitrary values that are only evaluated at render
 * time.
 */
export function formatOpacityStyleValue(sv: StyleValue<number>): string {
  if (sv.type === "literal") {
    const pct = sv.value * 100;
    if (!Number.isFinite(pct)) return "";
    return formatNumber(Math.round(pct));
  }
  return formatStyleValue(sv, formatNumber);
}

/**
 * Parse a display string from an opacity ValueInput back into the canonical
 * 0..=1 storage representation. Literal numbers are divided by 100; token
 * references and expressions pass through unchanged. Returns `null` for
 * unparseable input or literal values outside the 0..=100 range.
 */
export function parseOpacityInput(raw: string): StyleValue<number> | null {
  const parsed = parseNumberInput(raw);
  if (parsed === null) return null;
  if (parsed.type === "literal") {
    const pct = parsed.value;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
    return { type: "literal", value: pct / 100 };
  }
  return parsed;
}
