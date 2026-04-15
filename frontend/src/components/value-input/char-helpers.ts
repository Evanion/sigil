/**
 * Shared character classification helpers for the ValueInput module.
 *
 * These helpers are intentionally minimal, pure, and side-effect-free.
 * They are used by value-detect.ts, color-parse.ts, and style-value-format.ts
 * to avoid duplicating character classification logic across modules.
 * Inline copies of these predicates diverge silently — do not copy them.
 */

// ── Character classification ───────────────────────────────────────────

/** Returns true if `ch` is a valid hexadecimal digit [0-9a-fA-F]. */
export function isHexChar(ch: string): boolean {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

/** Returns true if `ch` is a decimal digit [0-9]. */
export function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** Returns true if `ch` is a valid CSS identifier start character [a-zA-Z_]. */
export function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

/** Returns true if `ch` is a valid CSS identifier character [a-zA-Z0-9_]. */
export function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

/** Returns true if `ch` is an arithmetic operator (+, -, *, /). */
export function isOperator(ch: string): boolean {
  return ch === "+" || ch === "-" || ch === "*" || ch === "/";
}

// ── Scanning helpers ───────────────────────────────────────────────────

/**
 * Returns true if there is an arithmetic operator (+, -, *, /) appearing
 * OUTSIDE of any `{...}` brace pair.
 *
 * Note: a leading `-` before the first digit is part of a negative number
 * literal and should NOT count as an operator. We handle this by requiring
 * that there be content before the `-` for it to be treated as an operator.
 */
export function hasOperatorOutsideBraces(input: string): boolean {
  let inBraces = false;
  let pos = 0;
  while (pos < input.length) {
    const ch = input[pos];
    if (ch === "{") {
      inBraces = true;
      pos++;
      continue;
    }
    if (ch === "}") {
      inBraces = false;
      pos++;
      continue;
    }
    if (!inBraces && isOperator(ch)) {
      // Allow a leading '-' only if it appears at position 0 AND is immediately
      // followed by a digit — that makes it a negative number prefix, not an
      // operator. If the next character is not a digit (e.g., '-{a}'), treat
      // the '-' as an operator.
      if (ch === "-" && pos === 0) {
        const next = input[1];
        if (next !== undefined && isDigit(next)) {
          // Negative number prefix — not an operator
          pos++;
          continue;
        }
      }
      return true;
    }
    pos++;
  }
  return false;
}

/**
 * Returns true if there is an identifier immediately followed by `(`
 * anywhere in the string (a function call).
 */
export function hasFunctionCall(input: string): boolean {
  let pos = 0;
  while (pos < input.length) {
    if (isIdentStart(input[pos]!)) {
      while (pos < input.length && isIdentChar(input[pos]!)) {
        pos++;
      }
      // If the identifier is followed by '(', it's a function call
      if (pos < input.length && input[pos] === "(") {
        return true;
      }
      continue;
    }
    pos++;
  }
  return false;
}

/**
 * Counts the number of complete `{...}` token references in the string.
 * Unclosed braces are not counted.
 */
export function countTokenRefs(input: string): number {
  let count = 0;
  let pos = 0;
  while (pos < input.length) {
    if (input[pos] === "{") {
      const close = input.indexOf("}", pos + 1);
      if (close !== -1) {
        count++;
        pos = close + 1;
      } else {
        pos++;
      }
    } else {
      pos++;
    }
  }
  return count;
}
