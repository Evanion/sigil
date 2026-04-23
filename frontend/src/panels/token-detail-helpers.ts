/**
 * Helpers for TokenDetailEditor ValueInput integration (Spec 13c).
 *
 * Bridges between the `TokenValue` discriminated union and the raw string
 * representation used by `ValueInput`. Extracted per CLAUDE.md rule
 * "Business Logic Must Not Live in Inline JSX Handlers."
 *
 * All numeric conversions guard against NaN and infinity per CLAUDE.md
 * Floating-Point Validation rules.
 */

import type { TokenValue, TokenType, Color, DimensionUnit } from "../types/document";
import type { ValueType } from "../components/value-input/value-detect";
import { parseHexColor, colorToHex } from "../components/value-input/color-parse";
import { validateCssIdentifier } from "../validation/css-identifiers";

// ── Dimension unit table ───────────────────────────────────────────────

/** Map from unit suffix string to DimensionUnit discriminant. */
const DIMENSION_UNIT_SUFFIXES: ReadonlyMap<string, DimensionUnit> = new Map([
  ["px", "px"],
  ["rem", "rem"],
  ["em", "em"],
  ["%", "percent"],
  ["percent", "percent"],
]);

// ── acceptedTypesForToken ──────────────────────────────────────────────────

/**
 * Return the allowed ValueTypes for a given token type.
 *
 * Maps each token type to the ValueTypes that may be accepted by ValueInput
 * when editing that token. All token types accept "alias" and "expression"
 * at runtime (handled by parseTokenValueChange), so this function returns
 * only the literal type options.
 */
export function acceptedTypesForToken(tokenType: TokenType): readonly ValueType[] {
  switch (tokenType) {
    case "color":
      return ["color"];
    case "dimension":
      return ["number", "dimension"];
    case "number":
      return ["number"];
    case "font_family":
      return ["font_family", "string"];
    case "font_weight":
      return ["number"];
    case "duration":
      return ["number"];
    case "cubic_bezier":
      return ["string"];
    case "shadow":
      return ["string"];
    case "gradient":
      return ["string"];
    case "typography":
      return ["string"];
    default:
      return ["string"];
  }
}

/**
 * Extract the numeric part and unit from a dimension string like "16px" or "1.5rem".
 *
 * Returns `null` for empty input or strings with no recognizable numeric portion.
 * Returns `{ value, unit }` where `unit` defaults to "px" if no unit suffix is
 * present. Does not return NaN or infinity for `value` — guards with
 * Number.isFinite().
 */
export function parseDimensionString(
  raw: string,
): { readonly value: number; readonly unit: DimensionUnit } | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Match optional leading sign, digits/decimal, then optional unit suffix
  const match = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|percent)?$/i);
  if (!match) return null;

  const numStr = match[1];
  const suffix = (match[2] ?? "px").toLowerCase();

  if (!numStr) return null;

  const value = parseFloat(numStr);
  if (!Number.isFinite(value)) return null;

  const unit = DIMENSION_UNIT_SUFFIXES.get(suffix) ?? "px";
  return { value, unit };
}

// ── tokenValueToString ─────────────────────────────────────────────────

/**
 * Convert a `TokenValue` to a display string for ValueInput.
 *
 * - `color` → hex string (e.g. "#ff0000ff")
 * - `dimension` → value + unit suffix (e.g. "16px", "1.5rem", "50%")
 * - `number` → numeric string (e.g. "42")
 * - `font_family` → comma-joined family list (e.g. "Inter, sans-serif")
 * - `alias` → `{name}` reference string
 * - `expression` → raw expression string
 * - All other types → empty string (composite types are handled by their own editors)
 *
 * All numeric values are guarded with Number.isFinite(); non-finite values
 * produce an empty string rather than "NaN" or "Infinity".
 */
export function tokenValueToString(value: TokenValue): string {
  switch (value.type) {
    case "color":
      return colorToHex(value.value);

    case "dimension": {
      if (!Number.isFinite(value.value)) return "";
      const suffix = value.unit === "percent" ? "%" : value.unit;
      return `${value.value}${suffix}`;
    }

    case "number":
      return Number.isFinite(value.value) ? String(value.value) : "";

    case "font_family":
      return value.families.join(", ");

    case "alias":
      return `{${value.name}}`;

    case "expression":
      return value.expr;

    // Composite types and others are not representable as a flat string here.
    case "font_weight":
    case "duration":
    case "cubic_bezier":
    case "shadow":
    case "gradient":
    case "typography":
      return "";
  }
}

// ── Token reference / expression detection ─────────────────────────────

/**
 * If `raw` is a bare token reference `{name}`, return `name`; otherwise null.
 * Validates that `name` matches the token name pattern.
 */
function extractTokenRefName(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^\{([a-zA-Z][a-zA-Z0-9._-]*)\}$/);
  return match ? (match[1] ?? null) : null;
}

/** Returns true if the string contains expression operators or function calls. */
function looksLikeExpression(raw: string): boolean {
  // Remove all {…} token references before operator scanning
  const noRefs = raw.replace(/\{[^}]*\}/g, "");

  // Detect arithmetic operators:
  // - '+' anywhere
  // - '*' or '/' anywhere
  // - '-' only when NOT at position 0 and NOT immediately after a digit-start
  //   (e.g., "-10" is a negative literal, "sans-serif" has a word-boundary hyphen,
  //    but "10 - 5" is subtraction).
  //   We detect subtraction as: '-' preceded by a digit or closing paren/bracket/brace.
  if (/[+*/]/.test(noRefs)) return true;
  if (/(?<=[\d)}\]])\s*-/.test(noRefs)) return true;

  // Contains a function call pattern: word( (but not a {ref})
  if (/\b[a-zA-Z_]\w*\s*\(/.test(raw)) return true;

  // Contains multiple {…} refs
  const refMatches = raw.match(/\{[^}]*\}/g);
  if (refMatches && refMatches.length > 1) return true;

  return false;
}

// ── parseTokenValueChange ──────────────────────────────────────────────

/**
 * Parse a raw ValueInput string into a `TokenValue` for the given `tokenType`.
 *
 * Returns the new `TokenValue` on success, or `null` if the string is
 * empty or cannot be parsed (caller should show an error and leave the value
 * unchanged — no silent coercion per CLAUDE.md).
 *
 * Handles cross-cutting cases first (alias/expression), then delegates to
 * type-specific parsing.
 *
 * @param raw       - The string from ValueInput.onChange / onCommit
 * @param tokenType - The token_type of the token being edited
 */
export function parseTokenValueChange(raw: string, tokenType: TokenType): TokenValue | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Bare token reference → alias
  const refName = extractTokenRefName(trimmed);
  if (refName !== null) {
    return { type: "alias", name: refName };
  }

  // Expression (multiple refs, operators, function calls) → expression
  if (looksLikeExpression(trimmed)) {
    return { type: "expression", expr: trimmed };
  }

  // Type-specific literal parsing
  switch (tokenType) {
    case "color": {
      const color = parseHexColor(trimmed) as Color | null;
      if (color === null) return null;
      return { type: "color", value: color };
    }

    case "dimension": {
      const parsed = parseDimensionString(trimmed);
      if (parsed === null) return null;
      return { type: "dimension", value: parsed.value, unit: parsed.unit };
    }

    case "number": {
      // RF-014: reject inputs with trailing non-numeric characters (e.g.,
      // "16px", "1.5rem", "42 units"). `parseFloat("16px")` silently returns
      // 16, which dropped the unit suffix without informing the user.
      // Require a pure numeric literal here — expressions with units are
      // already captured by the `looksLikeExpression` check above.
      if (!/^-?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
      const v = parseFloat(trimmed);
      if (!Number.isFinite(v)) return null;
      return { type: "number", value: v };
    }

    case "font_family": {
      const families = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (families.length === 0) return null;
      // RF-031: reject any family name containing CSS-significant characters
      // (quotes, semicolons, braces, backslash, C0 controls). Mirrors
      // `FONT_FAMILY_FORBIDDEN_CHARS` in crates/core/src/validate.rs so a
      // value accepted here round-trips through the Rust backend. Without
      // this gate, `parseTokenValueChange("Inter'; drop", "font_family")`
      // produced a TokenValue the server would reject silently later.
      for (const fam of families) {
        if (!validateCssIdentifier(fam)) return null;
      }
      return { type: "font_family", families };
    }

    // font_weight, duration, cubic_bezier, shadow, gradient, typography
    // are not edited via ValueInput — return null so callers know to ignore.
    default:
      return null;
  }
}
