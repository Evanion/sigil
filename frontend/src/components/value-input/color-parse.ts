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

  if (stripped.length === 3) {
    // #RGB → #RRGGBB
    const expanded = expandHexDigit(stripped[0]!);
    const expandedG = expandHexDigit(stripped[1]!);
    const expandedB = expandHexDigit(stripped[2]!);
    rHigh = expanded[0]!;
    rLow = expanded[1]!;
    gHigh = expandedG[0]!;
    gLow = expandedG[1]!;
    bHigh = expandedB[0]!;
    bLow = expandedB[1]!;
    aHigh = "f";
    aLow = "f";
  } else if (stripped.length === 6) {
    rHigh = stripped[0]!;
    rLow = stripped[1]!;
    gHigh = stripped[2]!;
    gLow = stripped[3]!;
    bHigh = stripped[4]!;
    bLow = stripped[5]!;
    aHigh = "f";
    aLow = "f";
  } else if (stripped.length === 8) {
    rHigh = stripped[0]!;
    rLow = stripped[1]!;
    gHigh = stripped[2]!;
    gLow = stripped[3]!;
    bHigh = stripped[4]!;
    bLow = stripped[5]!;
    aHigh = stripped[6]!;
    aLow = stripped[7]!;
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
 * Convert a `Color` value to a 6-character lowercase hex string (`#rrggbb`).
 *
 * Only `ColorSrgb` (space = "srgb") is supported. For other color spaces,
 * returns an empty string rather than silently producing incorrect values.
 *
 * Alpha is omitted from the output (only RGB channels are encoded). Use
 * the 8-character format (#RRGGBBAA) if alpha is required — that is not
 * the default for most UX contexts (color swatches, hex inputs).
 *
 * No silent clamping: returns empty string if any channel (r, g, b) is
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

  // Reject non-finite or out-of-range channels — no silent clamping.
  if (
    !Number.isFinite(color.r) ||
    !Number.isFinite(color.g) ||
    !Number.isFinite(color.b) ||
    color.r < 0 ||
    color.r > 1 ||
    color.g < 0 ||
    color.g > 1 ||
    color.b < 0 ||
    color.b > 1
  ) {
    return "";
  }

  const rByte = Math.round(color.r * 255);
  const gByte = Math.round(color.g * 255);
  const bByte = Math.round(color.b * 255);

  const toHex = (byte: number): string => byte.toString(16).padStart(2, "0");

  return `#${toHex(rByte)}${toHex(gByte)}${toHex(bByte)}`;
}
