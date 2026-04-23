/**
 * StyleValue formatting and parsing utilities for the ValueInput component.
 *
 * Bridges between the canonical `StyleValue<T>` type (literal, token_ref, or
 * expression) and the raw string representation shown in the input field.
 *
 * All numeric parsing is guarded with Number.isFinite() per CLAUDE.md
 * Floating-Point Validation rules.
 */

import type { Color, StyleValue, StyleValueTokenRef } from "../../types/document";
import { parseHexColor } from "./color-parse";
import { hasOperatorOutsideBraces, hasFunctionCall } from "./char-helpers";

// ── Token reference extraction ─────────────────────────────────────────

/**
 * Matches a valid token name: starts with a letter, followed by letters,
 * digits, dots, hyphens, or underscores. Mirrors the validation pattern
 * used in `token-detail-helpers.ts` so `parseColorInput("{foo}")` and
 * `parseTokenValueChange("{foo}", …)` agree on what counts as a
 * well-formed reference.
 */
const TOKEN_NAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]*$/;

/**
 * Extract the token name from a `{name}` string.
 *
 * Returns null when the input:
 * - Does not start with `{` and end with `}`
 * - Has an empty or whitespace-only inner segment (RF-029: previously
 *   returned `""`, which produced invalid `{ type: "token_ref", name: "" }`)
 * - Contains a nested `{` or `}`
 * - Fails the `TOKEN_NAME_RE` pattern (e.g. starts with a digit, contains spaces)
 */
function extractTokenRefName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  // Only a single complete token ref: must start with { and end with }
  // and must not contain another { or } inside.
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return null;
  if (inner.includes("{") || inner.includes("}")) return null;
  if (!TOKEN_NAME_RE.test(inner)) return null;
  return inner;
}

// ── containsExpression ────────────────────────────────────────────────

/**
 * Returns true if the raw string represents an expression rather than a
 * simple literal or single token reference.
 *
 * An expression is any string that:
 * - Contains arithmetic operators (+, -, *, /) outside of `{...}` braces
 *   (a leading `-` before a digit at position 0 is NOT an operator)
 * - Contains a function call (identifier immediately followed by `(`)
 * - Contains more than one `{...}` token reference
 *
 * This helper is exported so callers can quickly check without running the
 * full detection pipeline.
 */
export function containsExpression(raw: string): boolean {
  if (raw.length === 0) {
    return false;
  }

  // Count token references
  let refCount = 0;
  let pos = 0;
  while (pos < raw.length) {
    if (raw[pos] === "{") {
      const close = raw.indexOf("}", pos + 1);
      if (close !== -1) {
        refCount++;
        pos = close + 1;
        continue;
      }
    }
    pos++;
  }

  if (refCount > 1) {
    return true;
  }

  // Delegate operator and function-call detection to shared helpers
  // to avoid duplicating the scanning logic across modules.
  return hasOperatorOutsideBraces(raw) || hasFunctionCall(raw);
}

// ── formatStyleValue ──────────────────────────────────────────────────

/**
 * Format a `StyleValue<T>` as a display string.
 *
 * - `literal` → applies the provided `formatter` to the literal value
 * - `token_ref` → returns `{name}` (formatter is not called)
 * - `expression` → returns the raw expression string (formatter is not called)
 *
 * @param sv - The style value to format.
 * @param formatter - Called only for `literal` variants. Must not produce
 *   NaN or infinity when operating on numeric values.
 */
export function formatStyleValue<T>(sv: StyleValue<T>, formatter: (v: T) => string): string {
  switch (sv.type) {
    case "literal":
      return formatter(sv.value);
    case "token_ref":
      return `{${sv.name}}`;
    case "expression":
      return sv.expr;
  }
}

// ── parseColorInput ───────────────────────────────────────────────────

/**
 * Parse a raw string input as a color-typed `StyleValue<Color>` (including the expression variant).
 *
 * Recognized patterns:
 * - `#RGB`, `#RRGGBB`, `#RRGGBBAA` → `{ type: "literal", value: ColorSrgb }`
 * - `{name}` (single token ref, no operators outside braces) → `{ type: "token_ref", name }`
 * - Expressions (multi-ref, operators, function calls) → `{ type: "expression", expr }`
 * - Anything else → `null`
 *
 * Returns `null` for empty strings and unrecognized inputs (no silent coercion).
 */
export function parseColorInput(raw: string): StyleValue<Color> | null {
  if (raw.length === 0) {
    return null;
  }

  // Hex color literal
  if (raw.startsWith("#") || /^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(raw)) {
    const color = parseHexColor(raw);
    if (color !== null) {
      return { type: "literal", value: color };
    }
    // Starts with '#' but invalid — fall through to expression/ref check
    // (to allow things like "#" as a partial input returning null)
    return null;
  }

  // Expression detection (must come before single token ref)
  if (containsExpression(raw)) {
    return { type: "expression", expr: raw };
  }

  // Single token reference
  const tokenName = extractTokenRefName(raw);
  if (tokenName !== null) {
    return { type: "token_ref", name: tokenName } satisfies StyleValueTokenRef;
  }

  return null;
}

// ── parseNumberInput ──────────────────────────────────────────────────

/**
 * Matches a pure numeric literal — digits only, optionally signed, optionally
 * decimal. Anchored at both ends so trailing characters (unit suffixes, stray
 * tokens) force the string out of the literal branch. RF-014: without the end
 * anchor, `"16px"` silently parsed to `16` and the unit was lost.
 */
const PURE_NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * Matches a numeric literal followed by a CSS-like unit suffix (one or more
 * ASCII letters, or `%`). Used to recognize inputs like `16px`, `1.5rem`,
 * `50%` — these are emitted as expression variants so the evaluator can
 * handle unit semantics, rather than silently discarding the suffix.
 */
const NUMBER_WITH_UNIT_RE = /^(-?(?:\d+\.?\d*|\.\d+))([a-zA-Z]+|%)$/;

/**
 * Parse a raw string input as a number-typed `StyleValue<number>` (including
 * the expression variant).
 *
 * Recognized patterns:
 * - Pure numeric literal (`16`, `-8`, `3.14`) → `{ type: "literal", value }`
 * - Numeric + recognized unit suffix (`16px`, `1.5rem`, `50%`) →
 *   `{ type: "expression", expr }` — the expression evaluator is responsible
 *   for interpreting the unit at render time. RF-014: we do NOT silently
 *   strip the suffix and return a bare literal — that lost user intent.
 * - `{name}` (single token ref, no operators outside braces) →
 *   `{ type: "token_ref", name }`
 * - Multi-ref / operator / function-call expressions → `{ type: "expression", expr }`
 * - Infinity, NaN, empty string, or unrecognized garbage → `null`
 *
 * Returns `null` for unrecognized inputs (no silent coercion).
 */
export function parseNumberInput(raw: string): StyleValue<number> | null {
  if (raw.length === 0) {
    return null;
  }

  // Reject special float keywords before expression detection.
  // "Infinity", "-Infinity", "NaN" are not valid numeric literals here.
  const trimmed = raw.trim();
  if (
    trimmed === "Infinity" ||
    trimmed === "-Infinity" ||
    trimmed === "+Infinity" ||
    trimmed === "NaN"
  ) {
    return null;
  }

  // Pure numeric literal — no trailing content at all.
  if (PURE_NUMBER_RE.test(raw)) {
    const value = parseFloat(raw);
    if (Number.isFinite(value)) {
      return { type: "literal", value };
    }
    return null;
  }

  // Numeric + unit suffix (e.g. "16px", "50%"). Represent as expression so
  // the evaluator can handle the unit. RF-014: previously the regex was
  // start-anchored only, so `parseFloat("16px")` returned 16 and the suffix
  // was silently dropped.
  if (NUMBER_WITH_UNIT_RE.test(raw)) {
    return { type: "expression", expr: raw };
  }

  // Expression detection (after numeric check to avoid misclassifying
  // negative number-like strings as expressions).
  if (containsExpression(raw)) {
    return { type: "expression", expr: raw };
  }

  // Single token reference
  const tokenName = extractTokenRefName(raw);
  if (tokenName !== null) {
    return { type: "token_ref", name: tokenName } satisfies StyleValueTokenRef;
  }

  return null;
}
