/**
 * Value mode auto-detection for the ValueInput component.
 *
 * Inspects the raw string content of an input field and classifies it
 * as one of several detected modes (literal-color, literal-number,
 * literal-font, reference, expression, or unknown).
 *
 * This is a pure function with no side effects — safe to call on every
 * keystroke without debouncing.
 */

import {
  isHexChar,
  isDigit,
  isIdentStart,
  hasOperatorOutsideBraces,
  hasFunctionCall,
  countTokenRefs,
} from "./char-helpers";

// ── Types ──────────────────────────────────────────────────────────────

/** The style value types that a field may accept. */
export type ValueType = "color" | "number" | "dimension" | "string" | "font_family";

/** The detected mode of a raw input string. */
export type DetectedMode =
  | "literal-color"
  | "literal-number"
  | "literal-font"
  | "reference"
  | "expression"
  | "unknown";

// ── Scanning helpers ───────────────────────────────────────────────────

/**
 * Returns true if `input` is a valid CSS hex color:
 * #RGB, #RRGGBB, or #RRGGBBAA (all hex digits after the #).
 * The leading # is optional (some callers strip it first).
 */
function isHexColorString(input: string): boolean {
  const stripped = input.startsWith("#") ? input.slice(1) : input;
  if (stripped.length !== 3 && stripped.length !== 6 && stripped.length !== 8) {
    return false;
  }
  return [...stripped].every(isHexChar);
}

// ── detectValueMode ────────────────────────────────────────────────────

/**
 * Auto-detect the mode of a raw input string given the value types the
 * current field accepts.
 *
 * Detection rules (applied in priority order):
 * 1. `#` + hex chars → literal-color (only if "color" is accepted)
 * 2. Multiple `{...}` OR operators outside braces OR function call → expression
 * 3. Single `{...}` with no operators outside braces → reference
 * 4. Starts with digit or `-digit` → literal-number
 *    (only if "number" or "dimension" is accepted)
 * 5. Starts with a letter and "font_family" is accepted → literal-font
 * 6. Everything else → unknown
 *
 * @param input - The raw string from the input field (may be empty).
 * @param acceptedTypes - The value types the field accepts.
 */
export function detectValueMode(input: string, acceptedTypes: readonly ValueType[]): DetectedMode {
  if (input.length === 0 || input.trim().length === 0) {
    return "unknown";
  }

  // Rule 1: Color literal
  if (input.startsWith("#")) {
    if (isHexColorString(input)) {
      return "literal-color";
    }
    // Starts with '#' but invalid hex — unknown
    return "unknown";
  }

  // Rules 2–3: Token reference or expression
  // Check for any brace content first
  if (input.includes("{")) {
    const refCount = countTokenRefs(input);
    const hasOp = hasOperatorOutsideBraces(input);
    const hasFunc = hasFunctionCall(input);
    const hasMultipleRefs = refCount > 1;

    if (hasOp || hasFunc || hasMultipleRefs) {
      return "expression";
    }

    if (refCount === 1) {
      // Single token reference with no operators outside braces
      return "reference";
    }

    // Brace present but no valid token ref found (e.g., unclosed brace, empty braces)
    return "unknown";
  }

  // Check for function calls even without braces (e.g., "calc(16)", "rem(16)")
  if (hasFunctionCall(input)) {
    return "expression";
  }

  // Rule 4: Numeric literal
  const firstChar = input[0]!;
  const secondChar = input.length > 1 ? input[1] : undefined;

  if (isDigit(firstChar)) {
    const acceptsNumber = acceptedTypes.includes("number") || acceptedTypes.includes("dimension");
    if (acceptsNumber) {
      return "literal-number";
    }
  }

  if (firstChar === "-" && secondChar !== undefined && isDigit(secondChar)) {
    const acceptsNumber = acceptedTypes.includes("number") || acceptedTypes.includes("dimension");
    if (acceptsNumber) {
      return "literal-number";
    }
  }

  // Rule 5: Font name literal
  if (isIdentStart(firstChar) && acceptedTypes.includes("font_family")) {
    return "literal-font";
  }

  return "unknown";
}
