/**
 * Hex color parsing and formatting for the ValueInput component.
 *
 * Handles CSS hex color strings (#RGB, #RRGGBB, #RRGGBBAA) and converts
 * them to/from the canonical `Color` type from document.ts.
 *
 * All channel values are normalized to [0, 1] as floating-point numbers.
 * Every numeric conversion is guarded with Number.isFinite() per CLAUDE.md
 * Floating-Point Validation rules.
 */

import type { Color, ColorSrgb } from "../../types/document";
import { isHexChar } from "./char-helpers";

/**
 * Parse a two-character hex string (e.g., "ff") into a [0, 1] float.
 * Returns null if either character is not a valid hex digit or if the
 * result is NaN or non-finite.
 */
function hexPairToFloat(high: string, low: string): number | null {
  if (!isHexChar(high) || !isHexChar(low)) {
    return null;
  }
  const value = parseInt(`${high}${low}`, 16);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value / 255;
}

/**
 * Expand a single hex digit into a hex pair (e.g., "f" → "ff").
 * This implements CSS shorthand expansion: each digit is doubled.
 */
function expandHexDigit(ch: string): string {
  return `${ch}${ch}`;
}

// ── parseHexColor ─────────────────────────────────────────────────────

/**
 * Parse a CSS hex color string into a `ColorSrgb` value.
 *
 * Supported formats:
 * - `#RGB`        → expanded to #RRGGBB, alpha = 1
 * - `#RRGGBB`     → alpha = 1
 * - `#RRGGBBAA`   → alpha from AA byte
 * - All formats also accepted without the leading `#`
 *
 * Returns `null` if the input is not a valid hex color string, or if any
 * channel value is NaN or non-finite after parsing.
 *
 * No silent clamping: invalid inputs return null rather than being coerced.
 */
export function parseHexColor(hex: string): ColorSrgb | null {
  if (hex.length === 0) {
    return null;
  }

  // Strip optional leading '#'
  const stripped = hex.startsWith("#") ? hex.slice(1) : hex;

  if (stripped.length === 0) {
    return null;
  }

  // Validate that all characters are hex digits
  for (const ch of stripped) {
    if (!isHexChar(ch)) {
      return null;
    }
  }

  let rHigh: string;
  let rLow: string;
  let gHigh: string;
  let gLow: string;
  let bHigh: string;
  let bLow: string;
  let aHigh: string;
  let aLow: string;

  // Split into individual characters. We have already validated that every
  // character is a hex digit (loop above), so an undefined entry here would
  // indicate a length mismatch that the branch conditions below prevent.
  // Using [...stripped] gives a proper string[] with no undefined entries for
  // any index within the array bounds.
  const chars = [...stripped];

  if (stripped.length === 3) {
    // #RGB → #RRGGBB
    // chars[0..2] are defined because stripped.length === 3.
    const expanded = expandHexDigit(chars[0] ?? "");
    const expandedG = expandHexDigit(chars[1] ?? "");
    const expandedB = expandHexDigit(chars[2] ?? "");
    rHigh = expanded[0] ?? "";
    rLow = expanded[1] ?? "";
    gHigh = expandedG[0] ?? "";
    gLow = expandedG[1] ?? "";
    bHigh = expandedB[0] ?? "";
    bLow = expandedB[1] ?? "";
    aHigh = "f";
    aLow = "f";
  } else if (stripped.length === 6) {
    // chars[0..5] are defined because stripped.length === 6.
    rHigh = chars[0] ?? "";
    rLow = chars[1] ?? "";
    gHigh = chars[2] ?? "";
    gLow = chars[3] ?? "";
    bHigh = chars[4] ?? "";
    bLow = chars[5] ?? "";
    aHigh = "f";
    aLow = "f";
  } else if (stripped.length === 8) {
    // chars[0..7] are defined because stripped.length === 8.
    rHigh = chars[0] ?? "";
    rLow = chars[1] ?? "";
    gHigh = chars[2] ?? "";
    gLow = chars[3] ?? "";
    bHigh = chars[4] ?? "";
    bLow = chars[5] ?? "";
    aHigh = chars[6] ?? "";
    aLow = chars[7] ?? "";
  } else {
    // Invalid length (2, 4, 5, 7, 9+)
    return null;
  }

  const r = hexPairToFloat(rHigh, rLow);
  const g = hexPairToFloat(gHigh, gLow);
  const b = hexPairToFloat(bHigh, bLow);
  const a = hexPairToFloat(aHigh, aLow);

  if (r === null || g === null || b === null || a === null) {
    return null;
  }

  // Final NaN/infinity guard (defense in depth)
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
    return null;
  }

  return { space: "srgb", r, g, b, a };
}

// ── colorToHex ────────────────────────────────────────────────────────

/**
 * Convert a `Color` value to a lowercase hex string.
 *
 * Only `ColorSrgb` (space = "srgb") is supported. For other color spaces,
 * returns an empty string rather than silently producing incorrect values.
 *
 * The alpha channel is preserved:
 * - `a >= 1` → 6-character `#rrggbb`
 * - `a < 1`  → 8-character `#rrggbbaa`
 *
 * Preserving alpha on round-trip is required so that in-place alpha edits
 * (ColorPicker alpha slider) survive the format/parse cycle. Dropping the
 * alpha channel when a < 1 silently discarded user input (RF-006).
 *
 * No silent clamping: returns empty string if any channel (r, g, b, a) is
 * non-finite or outside [0, 1]. Per CLAUDE.md "No Silent Clamping of
 * Invalid Input" — callers that pass out-of-range values must be fixed,
 * not silently corrected here.
 */
export function colorToHex(color: Color): string {
  if (color.space !== "srgb") {
    // Non-sRGB spaces require gamut mapping that is out of scope for this
    // utility. Return empty string — callers must handle this case.
    return "";
  }

  const { r, g, b, a } = color;

  // Reject non-finite or out-of-range channels — no silent clamping.
  if (!Number.isFinite(r) || r < 0 || r > 1) return "";
  if (!Number.isFinite(g) || g < 0 || g > 1) return "";
  if (!Number.isFinite(b) || b < 0 || b > 1) return "";
  if (!Number.isFinite(a) || a < 0 || a > 1) return "";

  const toHex = (byte: number): string => byte.toString(16).padStart(2, "0");

  const rr = toHex(Math.round(r * 255));
  const gg = toHex(Math.round(g * 255));
  const bb = toHex(Math.round(b * 255));

  // Full alpha → #rrggbb (shortest faithful representation).
  if (a >= 1) {
    return `#${rr}${gg}${bb}`;
  }

  // Partial alpha → #rrggbbaa so the alpha channel round-trips.
  const aa = toHex(Math.round(a * 255));
  return `#${rr}${gg}${bb}${aa}`;
}
