/**
 * StyleValue formatting and parsing utilities for the ValueInput component.
 *
 * Bridges between the canonical `StyleValue<T>` type (literal or token_ref)
 * and the raw string representation shown in the input field.
 *
 * Also defines `StyleValueExpression` (the future "expression" variant that
 * will be added to StyleValue in Task 2). It is defined here first so that
 * Task 2 can move it to document.ts without touching this file's logic.
 *
 * All numeric parsing is guarded with Number.isFinite() per CLAUDE.md
 * Floating-Point Validation rules.
 */

import type { Color, StyleValue, StyleValueTokenRef } from "../../types/document";
import { parseHexColor } from "./color-parse";
import { hasOperatorOutsideBraces, hasFunctionCall } from "./char-helpers";

// ── Expression variant (future StyleValue member) ─────────────────────

/**
 * An expression that produces a value at runtime by combining token
 * references and/or arithmetic operations.
 *
 * This variant will move to `types/document.ts` in Task 2 as part of
 * extending `StyleValue<T>`.
 */
export interface StyleValueExpression {
  readonly type: "expression";
  readonly expr: string;
}

/**
 * Extended `StyleValue<T>` that includes the future `expression` variant.
 * Consumers that need to handle expressions should use this type instead
 * of the base `StyleValue<T>` until Task 2 promotes it to document.ts.
 */
export type ExtendedStyleValue<T> = StyleValue<T> | StyleValueExpression;

// ── Token reference extraction ─────────────────────────────────────────

/**
 * Extract the token name from a `{name}` string.
 * Returns null if the string does not match the `{...}` pattern exactly.
 */
function extractTokenRefName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  // Only a single complete token ref: must start with { and end with }
  // and must not contain another { inside
  const inner = trimmed.slice(1, -1);
  if (inner.includes("{")) {
    return null;
  }
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
 * Format an `ExtendedStyleValue<T>` as a display string.
 *
 * - `literal` → applies the provided `formatter` to the literal value
 * - `token_ref` → returns `{name}` (formatter is not called)
 * - `expression` → returns the raw expression string (formatter is not called)
 *
 * @param sv - The style value to format.
 * @param formatter - Called only for `literal` variants. Must not produce
 *   NaN or infinity when operating on numeric values.
 */
export function formatStyleValue<T>(
  sv: ExtendedStyleValue<T>,
  formatter: (v: T) => string,
): string {
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
 * Parse a raw string input as a color-typed `ExtendedStyleValue<Color>`.
 *
 * Recognized patterns:
 * - `#RGB`, `#RRGGBB`, `#RRGGBBAA` → `{ type: "literal", value: ColorSrgb }`
 * - `{name}` (single token ref, no operators outside braces) → `{ type: "token_ref", name }`
 * - Expressions (multi-ref, operators, function calls) → `{ type: "expression", expr }`
 * - Anything else → `null`
 *
 * Returns `null` for empty strings and unrecognized inputs (no silent coercion).
 */
export function parseColorInput(raw: string): ExtendedStyleValue<Color> | null {
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
 * Parse a raw string input as a number-typed `ExtendedStyleValue<number>`.
 *
 * Recognized patterns:
 * - Numeric strings (integer or decimal, optionally negative, optionally
 *   with a unit suffix like `px`, `%`, `em`) → `{ type: "literal", value: number }`
 *   NOTE: Only the numeric portion is parsed; unit suffixes are stripped.
 * - `{name}` (single token ref, no operators outside braces) → `{ type: "token_ref", name }`
 * - Expressions → `{ type: "expression", expr }`
 * - Infinity, NaN, empty string → `null`
 *
 * Returns `null` for unrecognized inputs (no silent coercion).
 */
export function parseNumberInput(raw: string): ExtendedStyleValue<number> | null {
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

  // Numeric literal: attempt first — this ensures strings starting with digits
  // or a leading '-' followed by digits are handled before expression detection.
  // `parseFloat` stops at the first non-numeric character (e.g., "16px" → 16).
  // We require that the string actually starts with a numeric pattern.
  const numericPattern = /^-?(\d+\.?\d*|\.\d+)/;
  if (numericPattern.test(raw)) {
    const value = parseFloat(raw);
    // Guard NaN and infinity — these are not valid numeric literals
    if (Number.isFinite(value)) {
      return { type: "literal", value };
    }
    return null;
  }

  // Expression detection (after numeric check to avoid misclassifying negative
  // number-like strings as expressions)
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
