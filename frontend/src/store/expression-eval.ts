/**
 * Expression parser, evaluator, and built-in functions for design token expressions.
 *
 * Mirrors the Rust expression engine in `crates/core/src/expression/`.
 * Used for live preview in the browser until the core crate compiles to WASM.
 *
 * All numeric outputs are guarded with Number.isFinite() per CLAUDE.md section 11
 * Floating-Point Validation rules.
 */

import type { Token, Color, ColorSrgb } from "../types/document";
import { resolveToken } from "./token-store";

// ── Validation constants ──────────────────────────────────────────────
// Must match Rust constants in crates/core/src/expression/validate.rs

/** Maximum length of an expression string before parsing. */
export const MAX_EXPRESSION_LENGTH = 1024;

/** Maximum AST nesting depth during parsing. */
export const MAX_AST_DEPTH = 32;

/** Maximum number of arguments a function call can accept. */
export const MAX_FUNCTION_ARGS = 8;

/** Maximum depth for evaluating nested token references / expressions. */
export const MAX_EVAL_DEPTH = 32;

// ── AST types ─────────────────────────────────────────────────────────

export type BinaryOperator = "add" | "sub" | "mul" | "div";

export type ExprLiteral =
  | { type: "number"; value: number }
  | { type: "percentage"; value: number } // 20% stored as 0.2
  | { type: "string"; value: string };

export type TokenExpression =
  | { type: "literal"; value: ExprLiteral }
  | { type: "tokenRef"; name: string }
  | { type: "binaryOp"; left: TokenExpression; op: BinaryOperator; right: TokenExpression }
  | { type: "unaryNeg"; inner: TokenExpression }
  | { type: "functionCall"; name: string; args: TokenExpression[] };

// ── Evaluation types ──────────────────────────────────────────────────

export type EvalValue =
  | { type: "number"; value: number }
  | { type: "color"; value: Color }
  | { type: "string"; value: string };

export type EvalError =
  | { type: "parse"; message: string }
  | { type: "unknownFunction"; name: string }
  | { type: "arityError"; name: string; expected: number; got: number }
  | { type: "typeError"; expected: string; got: string }
  | { type: "referenceNotFound"; name: string }
  | { type: "depthExceeded" }
  | { type: "divisionByZero" }
  | { type: "domainError"; message: string };

// ── Type guards ───────────────────────────────────────────────────────

export function isEvalError(v: EvalValue | EvalError): v is EvalError {
  return (
    v.type === "parse" ||
    v.type === "unknownFunction" ||
    v.type === "arityError" ||
    v.type === "typeError" ||
    v.type === "referenceNotFound" ||
    v.type === "depthExceeded" ||
    v.type === "divisionByZero" ||
    v.type === "domainError"
  );
}

// ── Parser ────────────────────────────────────────────────────────────

/**
 * Internal parser state. Tracks position and depth through the input string.
 */
interface ParserState {
  readonly input: string;
  pos: number;
  depth: number;
}

function makeParseError(msg: string): EvalError {
  return { type: "parse", message: msg };
}

function skipWhitespace(state: ParserState): void {
  while (state.pos < state.input.length && /\s/.test(state.input[state.pos])) {
    state.pos++;
  }
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isTokenRefChar(ch: string): boolean {
  return isIdentChar(ch) || ch === "." || ch === "-";
}

/**
 * Parse a number literal (integer or decimal).
 * If followed by '%', it becomes a percentage (value divided by 100).
 */
function parseNumber(state: ParserState): TokenExpression | EvalError {
  const start = state.pos;
  while (state.pos < state.input.length && isDigit(state.input[state.pos])) {
    state.pos++;
  }
  if (state.pos < state.input.length && state.input[state.pos] === ".") {
    state.pos++;
    if (state.pos >= state.input.length || !isDigit(state.input[state.pos])) {
      return makeParseError(`Expected digit after decimal point at position ${state.pos}`);
    }
    while (state.pos < state.input.length && isDigit(state.input[state.pos])) {
      state.pos++;
    }
  }

  const numStr = state.input.slice(start, state.pos);
  const value = Number(numStr);

  // Guard: reject NaN/Infinity from parsed numbers
  if (!Number.isFinite(value)) {
    return makeParseError(`Invalid number literal: ${numStr}`);
  }

  skipWhitespace(state);

  // Check for percentage suffix
  if (state.pos < state.input.length && state.input[state.pos] === "%") {
    state.pos++;
    const percentValue = value / 100;
    // Guard: division result
    if (!Number.isFinite(percentValue)) {
      return makeParseError(`Invalid percentage value: ${numStr}%`);
    }
    return { type: "literal", value: { type: "percentage", value: percentValue } };
  }

  return { type: "literal", value: { type: "number", value } };
}

/**
 * Parse a string literal enclosed in single quotes.
 * Supports \\, \', \n, \t escape sequences.
 */
function parseStringLiteral(state: ParserState): TokenExpression | EvalError {
  // Skip opening quote
  state.pos++;
  let result = "";
  while (state.pos < state.input.length) {
    const ch = state.input[state.pos];
    if (ch === "'") {
      state.pos++;
      return { type: "literal", value: { type: "string", value: result } };
    }
    if (ch === "\\") {
      state.pos++;
      if (state.pos >= state.input.length) {
        return makeParseError("Unexpected end of input in string escape");
      }
      const escaped = state.input[state.pos];
      switch (escaped) {
        case "\\":
          result += "\\";
          break;
        case "'":
          result += "'";
          break;
        case "n":
          result += "\n";
          break;
        case "t":
          result += "\t";
          break;
        default:
          return makeParseError(`Unknown escape sequence: \\${escaped}`);
      }
    } else {
      result += ch;
    }
    state.pos++;
  }
  return makeParseError("Unterminated string literal");
}

/**
 * Parse a token reference: either `{name}` (braced) or a bare identifier
 * containing dots/dashes (e.g., `spacing.md`).
 */
function parseTokenRef(state: ParserState): TokenExpression | EvalError {
  if (state.input[state.pos] === "{") {
    state.pos++; // skip '{'
    const start = state.pos;
    while (state.pos < state.input.length && state.input[state.pos] !== "}") {
      state.pos++;
    }
    if (state.pos >= state.input.length) {
      return makeParseError("Unterminated token reference — expected '}'");
    }
    const name = state.input.slice(start, state.pos).trim();
    state.pos++; // skip '}'
    if (name.length === 0) {
      return makeParseError("Empty token reference");
    }
    return { type: "tokenRef", name };
  }

  // Bare token ref: identifier chars + dots + dashes
  const start = state.pos;
  while (state.pos < state.input.length && isTokenRefChar(state.input[state.pos])) {
    state.pos++;
  }
  const name = state.input.slice(start, state.pos);
  if (name.length === 0) {
    return makeParseError(`Unexpected character at position ${state.pos}`);
  }
  return { type: "tokenRef", name };
}

/**
 * Parse an identifier (for function names).
 */
function parseIdentifier(state: ParserState): string {
  const start = state.pos;
  while (state.pos < state.input.length && isIdentChar(state.input[state.pos])) {
    state.pos++;
  }
  return state.input.slice(start, state.pos);
}

/**
 * Parse an atom: number, string, function call, token ref, or parenthesized expression.
 *
 * Grammar:
 *   atom = number | percentage | string | function_call | token_ref | '(' expression ')'
 */
function parseAtom(state: ParserState): TokenExpression | EvalError {
  skipWhitespace(state);

  if (state.pos >= state.input.length) {
    return makeParseError("Unexpected end of expression");
  }

  const ch = state.input[state.pos];

  // Parenthesized expression
  if (ch === "(") {
    state.pos++;
    state.depth++;
    if (state.depth >= MAX_AST_DEPTH) {
      return { type: "depthExceeded" } as EvalError;
    }
    const expr = parseExpression_internal(state);
    if (isEvalError(expr as EvalValue | EvalError)) {
      return expr;
    }
    skipWhitespace(state);
    if (state.pos >= state.input.length || state.input[state.pos] !== ")") {
      return makeParseError("Expected ')' after expression");
    }
    state.pos++;
    state.depth--;
    return expr;
  }

  // Number literal
  if (isDigit(ch)) {
    return parseNumber(state);
  }

  // String literal
  if (ch === "'") {
    return parseStringLiteral(state);
  }

  // Token reference with braces
  if (ch === "{") {
    return parseTokenRef(state);
  }

  // Identifier — could be a function call or a bare token reference
  if (isIdentStart(ch)) {
    const savedPos = state.pos;
    const ident = parseIdentifier(state);
    skipWhitespace(state);

    // If followed by '(', it's a function call
    if (state.pos < state.input.length && state.input[state.pos] === "(") {
      state.pos++;
      state.depth++;
      if (state.depth >= MAX_AST_DEPTH) {
        return { type: "depthExceeded" } as EvalError;
      }

      const args: TokenExpression[] = [];
      skipWhitespace(state);

      // Parse arguments
      if (state.pos < state.input.length && state.input[state.pos] !== ")") {
        const firstArg = parseExpression_internal(state);
        if (isEvalError(firstArg as EvalValue | EvalError)) {
          return firstArg;
        }
        args.push(firstArg);

        while (state.pos < state.input.length && state.input[state.pos] === ",") {
          state.pos++; // skip ','
          if (args.length >= MAX_FUNCTION_ARGS) {
            return makeParseError(
              `Too many function arguments (max ${MAX_FUNCTION_ARGS})`,
            );
          }
          const arg = parseExpression_internal(state);
          if (isEvalError(arg as EvalValue | EvalError)) {
            return arg;
          }
          args.push(arg);
          skipWhitespace(state);
        }
      }

      skipWhitespace(state);
      if (state.pos >= state.input.length || state.input[state.pos] !== ")") {
        return makeParseError(`Expected ')' after function arguments for '${ident}'`);
      }
      state.pos++;
      state.depth--;

      return { type: "functionCall", name: ident, args };
    }

    // Not a function call — treat as bare token ref
    // Bare token refs can contain dots and dashes, so re-parse from saved position
    state.pos = savedPos;
    return parseTokenRef(state);
  }

  return makeParseError(`Unexpected character '${ch}' at position ${state.pos}`);
}

/**
 * Parse a factor: handles unary negation.
 *
 * Grammar:
 *   factor = '-' factor | atom
 */
function parseFactor(state: ParserState): TokenExpression | EvalError {
  skipWhitespace(state);

  if (state.pos < state.input.length && state.input[state.pos] === "-") {
    state.pos++;
    state.depth++;
    if (state.depth >= MAX_AST_DEPTH) {
      return { type: "depthExceeded" } as EvalError;
    }
    const inner = parseFactor(state);
    state.depth--;
    if (isEvalError(inner as EvalValue | EvalError)) {
      return inner;
    }
    return { type: "unaryNeg", inner };
  }

  return parseAtom(state);
}

/**
 * Parse a term: handles multiplication and division.
 *
 * Grammar:
 *   term = factor (('*' | '/') factor)*
 */
function parseTerm(state: ParserState): TokenExpression | EvalError {
  let left = parseFactor(state);
  if (isEvalError(left as EvalValue | EvalError)) {
    return left;
  }

  skipWhitespace(state);

  while (state.pos < state.input.length) {
    const ch = state.input[state.pos];
    let op: BinaryOperator;
    if (ch === "*") {
      op = "mul";
    } else if (ch === "/") {
      op = "div";
    } else {
      break;
    }

    state.pos++;
    const right = parseFactor(state);
    if (isEvalError(right as EvalValue | EvalError)) {
      return right;
    }
    left = { type: "binaryOp", left, op, right };
    skipWhitespace(state);
  }

  return left;
}

/**
 * Parse a full expression: handles addition and subtraction.
 *
 * Grammar:
 *   expression = term (('+' | '-') term)*
 */
function parseExpression_internal(state: ParserState): TokenExpression | EvalError {
  let left = parseTerm(state);
  if (isEvalError(left as EvalValue | EvalError)) {
    return left;
  }

  skipWhitespace(state);

  while (state.pos < state.input.length) {
    const ch = state.input[state.pos];
    let op: BinaryOperator;
    if (ch === "+") {
      op = "add";
    } else if (ch === "-") {
      op = "sub";
    } else {
      break;
    }

    state.pos++;
    const right = parseTerm(state);
    if (isEvalError(right as EvalValue | EvalError)) {
      return right;
    }
    left = { type: "binaryOp", left, op, right };
    skipWhitespace(state);
  }

  return left;
}

/**
 * Parse an expression string into an AST.
 *
 * Enforces MAX_EXPRESSION_LENGTH at the boundary.
 * Returns an EvalError on parse failure.
 */
export function parseExpression(input: string): TokenExpression | EvalError {
  if (input.length > MAX_EXPRESSION_LENGTH) {
    return makeParseError(
      `Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters`,
    );
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return makeParseError("Empty expression");
  }

  const state: ParserState = { input: trimmed, pos: 0, depth: 0 };
  const result = parseExpression_internal(state);

  if (isEvalError(result as EvalValue | EvalError)) {
    return result;
  }

  skipWhitespace(state);
  if (state.pos < state.input.length) {
    return makeParseError(
      `Unexpected character '${state.input[state.pos]}' at position ${state.pos}`,
    );
  }

  return result;
}

// ── Color conversion helpers ──────────────────────────────────────────

/**
 * Ensure a color is in sRGB space, converting if needed.
 * Currently only sRGB is fully supported for manipulation; other spaces
 * are passed through with a best-effort conversion.
 */
function toSrgb(color: Color): ColorSrgb {
  if (color.space === "srgb") {
    return color;
  }
  // For non-sRGB colors, we treat the r/g/b or equivalent as approximate sRGB.
  // Full color space conversion is deferred to WASM core.
  if (color.space === "display_p3") {
    return { space: "srgb", r: color.r, g: color.g, b: color.b, a: color.a };
  }
  if (color.space === "oklch") {
    // Approximate oklch -> sRGB: use placeholder identity for now
    // Full conversion requires matrix math deferred to core WASM
    return { space: "srgb", r: color.l, g: color.c, b: color.h / 360, a: color.a };
  }
  if (color.space === "oklab") {
    return { space: "srgb", r: color.l, g: color.a, b: color.b, a: color.alpha };
  }
  // Exhaustive check — should never reach here
  return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Convert sRGB color to HSL.
 * Returns [h (0-360), s (0-1), l (0-1)].
 */
function srgbToHsl(c: ColorSrgb): [number, number, number] {
  const r = c.r;
  const g = c.g;
  const b = c.b;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return [h * 360, s, l];
}

/**
 * Convert HSL to sRGB color.
 * h: 0-360, s: 0-1, l: 0-1, a: 0-1.
 */
function hslToSrgb(h: number, s: number, l: number, a: number): ColorSrgb {
  // Normalize h to 0-360
  const hNorm = ((h % 360) + 360) % 360;
  const hFrac = hNorm / 360;

  if (s === 0) {
    return { space: "srgb", r: l, g: l, b: l, a };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const hueToRgb = (t: number): number => {
    let tNorm = t;
    if (tNorm < 0) tNorm += 1;
    if (tNorm > 1) tNorm -= 1;
    if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm;
    if (tNorm < 1 / 2) return q;
    if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6;
    return p;
  };

  const r = hueToRgb(hFrac + 1 / 3);
  const g = hueToRgb(hFrac);
  const b = hueToRgb(hFrac - 1 / 3);

  return { space: "srgb", r, g, b, a };
}

/**
 * Clamp a number to [0, 1] range.
 * This is used for color channel values where clamping IS the intended behavior
 * (color channels are defined as 0-1, values outside this range are nonsensical).
 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ── Evaluator ─────────────────────────────────────────────────────────

/**
 * Extract a number from an EvalValue, returning a TypeError if not numeric.
 */
function requireNumber(v: EvalValue): number | EvalError {
  if (v.type !== "number") {
    return { type: "typeError", expected: "number", got: v.type };
  }
  return v.value;
}

/**
 * Extract a color from an EvalValue, returning a TypeError if not a color.
 */
function requireColor(v: EvalValue): Color | EvalError {
  if (v.type !== "color") {
    return { type: "typeError", expected: "color", got: v.type };
  }
  return v.value;
}

/**
 * Convert a TokenValue to an EvalValue.
 */
function tokenValueToEvalValue(tv: Exclude<import("../types/document").TokenValue, { type: "alias" } | { type: "expression" }>): EvalValue {
  switch (tv.type) {
    case "color":
      return { type: "color", value: tv.value };
    case "dimension":
      return { type: "number", value: tv.value };
    case "number":
      return { type: "number", value: tv.value };
    case "font_weight":
      return { type: "number", value: tv.weight };
    case "duration":
      return { type: "number", value: tv.seconds };
    case "font_family":
      return { type: "string", value: tv.families.join(", ") };
    case "shadow":
    case "gradient":
    case "typography":
    case "cubic_bezier":
      // Complex types — return a string representation for now
      return { type: "string", value: `[${tv.type}]` };
  }
}

// ── Built-in functions ────────────────────────────────────────────────

/** Registry of built-in expression functions. */
interface FnDef {
  readonly arity: number | [number, number]; // exact or [min, max]
  readonly call: (args: EvalValue[]) => EvalValue | EvalError;
}

/**
 * Validate arity for a function call.
 */
function checkArity(name: string, args: EvalValue[], expected: number | [number, number]): EvalError | null {
  if (typeof expected === "number") {
    if (args.length !== expected) {
      return { type: "arityError", name, expected, got: args.length };
    }
  } else {
    const [min, max] = expected;
    if (args.length < min || args.length > max) {
      return { type: "arityError", name, expected: min, got: args.length };
    }
  }
  return null;
}

// Math functions

function fnRound(args: EvalValue[]): EvalValue | EvalError {
  const n = requireNumber(args[0]);
  if (typeof n !== "number") return n;
  const result = Math.round(n);
  if (!Number.isFinite(result)) return { type: "domainError", message: "round produced non-finite result" };
  return { type: "number", value: result };
}

function fnCeil(args: EvalValue[]): EvalValue | EvalError {
  const n = requireNumber(args[0]);
  if (typeof n !== "number") return n;
  const result = Math.ceil(n);
  if (!Number.isFinite(result)) return { type: "domainError", message: "ceil produced non-finite result" };
  return { type: "number", value: result };
}

function fnFloor(args: EvalValue[]): EvalValue | EvalError {
  const n = requireNumber(args[0]);
  if (typeof n !== "number") return n;
  const result = Math.floor(n);
  if (!Number.isFinite(result)) return { type: "domainError", message: "floor produced non-finite result" };
  return { type: "number", value: result };
}

function fnAbs(args: EvalValue[]): EvalValue | EvalError {
  const n = requireNumber(args[0]);
  if (typeof n !== "number") return n;
  const result = Math.abs(n);
  if (!Number.isFinite(result)) return { type: "domainError", message: "abs produced non-finite result" };
  return { type: "number", value: result };
}

function fnMin(args: EvalValue[]): EvalValue | EvalError {
  const a = requireNumber(args[0]);
  if (typeof a !== "number") return a;
  const b = requireNumber(args[1]);
  if (typeof b !== "number") return b;
  return { type: "number", value: Math.min(a, b) };
}

function fnMax(args: EvalValue[]): EvalValue | EvalError {
  const a = requireNumber(args[0]);
  if (typeof a !== "number") return a;
  const b = requireNumber(args[1]);
  if (typeof b !== "number") return b;
  return { type: "number", value: Math.max(a, b) };
}

function fnClamp(args: EvalValue[]): EvalValue | EvalError {
  const val = requireNumber(args[0]);
  if (typeof val !== "number") return val;
  const lo = requireNumber(args[1]);
  if (typeof lo !== "number") return lo;
  const hi = requireNumber(args[2]);
  if (typeof hi !== "number") return hi;
  return { type: "number", value: Math.min(Math.max(val, lo), hi) };
}

// Size functions (base 16)

const SIZE_BASE = 16;

function fnRem(args: EvalValue[]): EvalValue | EvalError {
  const n = requireNumber(args[0]);
  if (typeof n !== "number") return n;
  const result = n * SIZE_BASE;
  if (!Number.isFinite(result)) return { type: "domainError", message: "rem produced non-finite result" };
  return { type: "number", value: result };
}

function fnEm(args: EvalValue[]): EvalValue | EvalError {
  const n = requireNumber(args[0]);
  if (typeof n !== "number") return n;
  const result = n * SIZE_BASE;
  if (!Number.isFinite(result)) return { type: "domainError", message: "em produced non-finite result" };
  return { type: "number", value: result };
}

function fnPx(args: EvalValue[]): EvalValue | EvalError {
  const n = requireNumber(args[0]);
  if (typeof n !== "number") return n;
  // px is already in pixels — identity function
  return { type: "number", value: n };
}

// Color manipulation functions

function fnLighten(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const amount = requireNumber(args[1]);
  if (typeof amount !== "number") return amount;

  const srgb = toSrgb(color as Color);
  const [h, s, l] = srgbToHsl(srgb);
  const newL = clamp01(l + amount);
  const result = hslToSrgb(h, s, newL, srgb.a);
  return { type: "color", value: result };
}

function fnDarken(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const amount = requireNumber(args[1]);
  if (typeof amount !== "number") return amount;

  const srgb = toSrgb(color as Color);
  const [h, s, l] = srgbToHsl(srgb);
  const newL = clamp01(l - amount);
  const result = hslToSrgb(h, s, newL, srgb.a);
  return { type: "color", value: result };
}

function fnSaturate(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const amount = requireNumber(args[1]);
  if (typeof amount !== "number") return amount;

  const srgb = toSrgb(color as Color);
  const [h, s, l] = srgbToHsl(srgb);
  const newS = clamp01(s + amount);
  const result = hslToSrgb(h, newS, l, srgb.a);
  return { type: "color", value: result };
}

function fnDesaturate(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const amount = requireNumber(args[1]);
  if (typeof amount !== "number") return amount;

  const srgb = toSrgb(color as Color);
  const [h, s, l] = srgbToHsl(srgb);
  const newS = clamp01(s - amount);
  const result = hslToSrgb(h, newS, l, srgb.a);
  return { type: "color", value: result };
}

function fnAlpha(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const alpha = requireNumber(args[1]);
  if (typeof alpha !== "number") return alpha;

  const srgb = toSrgb(color as Color);
  const result: ColorSrgb = { space: "srgb", r: srgb.r, g: srgb.g, b: srgb.b, a: clamp01(alpha) };
  return { type: "color", value: result };
}

function fnMix(args: EvalValue[]): EvalValue | EvalError {
  const c1 = requireColor(args[0]);
  if ("type" in c1 && (c1 as EvalError).type === "typeError") return c1 as EvalError;
  const c2 = requireColor(args[1]);
  if ("type" in c2 && (c2 as EvalError).type === "typeError") return c2 as EvalError;
  const ratio = requireNumber(args[2]);
  if (typeof ratio !== "number") return ratio;

  const s1 = toSrgb(c1 as Color);
  const s2 = toSrgb(c2 as Color);
  const t = clamp01(ratio);

  const result: ColorSrgb = {
    space: "srgb",
    r: clamp01(s1.r * (1 - t) + s2.r * t),
    g: clamp01(s1.g * (1 - t) + s2.g * t),
    b: clamp01(s1.b * (1 - t) + s2.b * t),
    a: clamp01(s1.a * (1 - t) + s2.a * t),
  };
  return { type: "color", value: result };
}

/**
 * Compute relative luminance (WCAG 2.x definition).
 * sRGB channel values are linearized then weighted.
 */
function relativeLuminance(c: ColorSrgb): number {
  const linearize = (v: number): number => {
    // Guard: domain is [0,1] for sRGB channels
    const clamped = clamp01(v);
    return clamped <= 0.03928 ? clamped / 12.92 : Math.pow((clamped + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(c.r) + 0.7152 * linearize(c.g) + 0.0722 * linearize(c.b);
}

function fnContrast(args: EvalValue[]): EvalValue | EvalError {
  const c1 = requireColor(args[0]);
  if ("type" in c1 && (c1 as EvalError).type === "typeError") return c1 as EvalError;
  const c2 = requireColor(args[1]);
  if ("type" in c2 && (c2 as EvalError).type === "typeError") return c2 as EvalError;

  const s1 = toSrgb(c1 as Color);
  const s2 = toSrgb(c2 as Color);
  const l1 = relativeLuminance(s1);
  const l2 = relativeLuminance(s2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  if (!Number.isFinite(ratio)) {
    return { type: "domainError", message: "contrast ratio produced non-finite result" };
  }
  return { type: "number", value: ratio };
}

function fnComplement(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;

  const srgb = toSrgb(color as Color);
  const [h, s, l] = srgbToHsl(srgb);
  const result = hslToSrgb((h + 180) % 360, s, l, srgb.a);
  return { type: "color", value: result };
}

function fnHue(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const hue = requireNumber(args[1]);
  if (typeof hue !== "number") return hue;

  const srgb = toSrgb(color as Color);
  const [, s, l] = srgbToHsl(srgb);
  const result = hslToSrgb(hue, s, l, srgb.a);
  return { type: "color", value: result };
}

// Channel setters

function fnSetRed(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  return { type: "color", value: { space: "srgb", r: clamp01(v), g: srgb.g, b: srgb.b, a: srgb.a } };
}

function fnSetGreen(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  return { type: "color", value: { space: "srgb", r: srgb.r, g: clamp01(v), b: srgb.b, a: srgb.a } };
}

function fnSetBlue(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  return { type: "color", value: { space: "srgb", r: srgb.r, g: srgb.g, b: clamp01(v), a: srgb.a } };
}

function fnSetHue(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  const [, s, l] = srgbToHsl(srgb);
  return { type: "color", value: hslToSrgb(v, s, l, srgb.a) };
}

function fnSetSaturation(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  const [h, , l] = srgbToHsl(srgb);
  return { type: "color", value: hslToSrgb(h, clamp01(v), l, srgb.a) };
}

function fnSetLightness(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  const [h, s] = srgbToHsl(srgb);
  return { type: "color", value: hslToSrgb(h, s, clamp01(v), srgb.a) };
}

// Channel adjusters

function fnAdjustRed(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  return { type: "color", value: { space: "srgb", r: clamp01(srgb.r + v), g: srgb.g, b: srgb.b, a: srgb.a } };
}

function fnAdjustGreen(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  return { type: "color", value: { space: "srgb", r: srgb.r, g: clamp01(srgb.g + v), b: srgb.b, a: srgb.a } };
}

function fnAdjustBlue(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  return { type: "color", value: { space: "srgb", r: srgb.r, g: srgb.g, b: clamp01(srgb.b + v), a: srgb.a } };
}

function fnAdjustHue(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  const [h, s, l] = srgbToHsl(srgb);
  return { type: "color", value: hslToSrgb(h + v, s, l, srgb.a) };
}

function fnAdjustSaturation(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  const [h, s, l] = srgbToHsl(srgb);
  return { type: "color", value: hslToSrgb(h, clamp01(s + v), l, srgb.a) };
}

function fnAdjustLightness(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const v = requireNumber(args[1]);
  if (typeof v !== "number") return v;

  const srgb = toSrgb(color as Color);
  const [h, s, l] = srgbToHsl(srgb);
  return { type: "color", value: hslToSrgb(h, s, clamp01(l + v), srgb.a) };
}

// Channel extractors

function fnRed(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const srgb = toSrgb(color as Color);
  return { type: "number", value: srgb.r };
}

function fnGreen(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const srgb = toSrgb(color as Color);
  return { type: "number", value: srgb.g };
}

function fnBlue(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const srgb = toSrgb(color as Color);
  return { type: "number", value: srgb.b };
}

function fnHueOf(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const srgb = toSrgb(color as Color);
  const [h] = srgbToHsl(srgb);
  return { type: "number", value: h };
}

function fnSaturationOf(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const srgb = toSrgb(color as Color);
  const [, s] = srgbToHsl(srgb);
  return { type: "number", value: s };
}

function fnLightnessOf(args: EvalValue[]): EvalValue | EvalError {
  const color = requireColor(args[0]);
  if ("type" in color && (color as EvalError).type === "typeError") return color as EvalError;
  const srgb = toSrgb(color as Color);
  const [, , l] = srgbToHsl(srgb);
  return { type: "number", value: l };
}

// Blend function with 11 modes

type BlendModeFn = (a: number, b: number) => number;

const BLEND_MODES: Record<string, BlendModeFn> = {
  normal: (_a, b) => b,
  multiply: (a, b) => a * b,
  screen: (a, b) => 1 - (1 - a) * (1 - b),
  overlay: (a, b) => (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)),
  darken: (a, b) => Math.min(a, b),
  lighten: (a, b) => Math.max(a, b),
  color_dodge: (a, b) => (b >= 1 ? 1 : Math.min(1, a / (1 - b))),
  color_burn: (a, b) => (b <= 0 ? 0 : Math.max(0, 1 - (1 - a) / b)),
  hard_light: (a, b) => (b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)),
  soft_light: (a, b) => {
    if (b <= 0.5) {
      return a - (1 - 2 * b) * a * (1 - a);
    }
    // Guard: Math.sqrt requires a >= 0; sRGB channels are [0,1] so this holds
    const d = a >= 0 ? Math.sqrt(a) : 0;
    return a + (2 * b - 1) * (d - a);
  },
  difference: (a, b) => Math.abs(a - b),
  exclusion: (a, b) => a + b - 2 * a * b,
};

function fnBlend(args: EvalValue[]): EvalValue | EvalError {
  const c1 = requireColor(args[0]);
  if ("type" in c1 && (c1 as EvalError).type === "typeError") return c1 as EvalError;
  const c2 = requireColor(args[1]);
  if ("type" in c2 && (c2 as EvalError).type === "typeError") return c2 as EvalError;

  if (args[2].type !== "string") {
    return { type: "typeError", expected: "string", got: args[2].type };
  }
  const modeName = args[2].value;
  const modeFn = BLEND_MODES[modeName];
  if (modeFn === undefined) {
    return { type: "domainError", message: `Unknown blend mode: '${modeName}'` };
  }

  const s1 = toSrgb(c1 as Color);
  const s2 = toSrgb(c2 as Color);

  const r = clamp01(modeFn(s1.r, s2.r));
  const g = clamp01(modeFn(s1.g, s2.g));
  const b = clamp01(modeFn(s1.b, s2.b));

  // Alpha: use source-over compositing
  const a = clamp01(s1.a + s2.a * (1 - s1.a));

  const result: ColorSrgb = { space: "srgb", r, g, b, a };
  return { type: "color", value: result };
}

// ── Function registry ─────────────────────────────────────────────────

const FUNCTION_REGISTRY: Record<string, FnDef> = {
  // Math (7)
  round: { arity: 1, call: fnRound },
  ceil: { arity: 1, call: fnCeil },
  floor: { arity: 1, call: fnFloor },
  abs: { arity: 1, call: fnAbs },
  min: { arity: 2, call: fnMin },
  max: { arity: 2, call: fnMax },
  clamp: { arity: 3, call: fnClamp },

  // Size (3)
  rem: { arity: 1, call: fnRem },
  em: { arity: 1, call: fnEm },
  px: { arity: 1, call: fnPx },

  // Color manipulation (9)
  lighten: { arity: 2, call: fnLighten },
  darken: { arity: 2, call: fnDarken },
  saturate: { arity: 2, call: fnSaturate },
  desaturate: { arity: 2, call: fnDesaturate },
  alpha: { arity: 2, call: fnAlpha },
  mix: { arity: 3, call: fnMix },
  contrast: { arity: 2, call: fnContrast },
  complement: { arity: 1, call: fnComplement },
  hue: { arity: 2, call: fnHue },

  // Channel setters (6)
  setRed: { arity: 2, call: fnSetRed },
  setGreen: { arity: 2, call: fnSetGreen },
  setBlue: { arity: 2, call: fnSetBlue },
  setHue: { arity: 2, call: fnSetHue },
  setSaturation: { arity: 2, call: fnSetSaturation },
  setLightness: { arity: 2, call: fnSetLightness },

  // Channel adjusters (6)
  adjustRed: { arity: 2, call: fnAdjustRed },
  adjustGreen: { arity: 2, call: fnAdjustGreen },
  adjustBlue: { arity: 2, call: fnAdjustBlue },
  adjustHue: { arity: 2, call: fnAdjustHue },
  adjustSaturation: { arity: 2, call: fnAdjustSaturation },
  adjustLightness: { arity: 2, call: fnAdjustLightness },

  // Channel extractors (6)
  red: { arity: 1, call: fnRed },
  green: { arity: 1, call: fnGreen },
  blue: { arity: 1, call: fnBlue },
  hueOf: { arity: 1, call: fnHueOf },
  saturationOf: { arity: 1, call: fnSaturationOf },
  lightnessOf: { arity: 1, call: fnLightnessOf },

  // Blend (1)
  blend: { arity: 3, call: fnBlend },
};

// ── Evaluator implementation ──────────────────────────────────────────

/**
 * Evaluate an expression AST against a token map.
 *
 * @param expr - The parsed AST node to evaluate.
 * @param tokens - Map of token names to Token objects.
 * @param depth - Current evaluation depth (for recursion guard). Zero-indexed;
 *                uses >= comparison per CLAUDE.md section 11 Recursive Functions.
 */
export function evaluateExpression(
  expr: TokenExpression,
  tokens: Record<string, Token>,
  depth: number = 0,
): EvalValue | EvalError {
  // Depth guard: uses >= so that depths 0..MAX_EVAL_DEPTH-1 are valid.
  if (depth >= MAX_EVAL_DEPTH) {
    return { type: "depthExceeded" };
  }

  switch (expr.type) {
    case "literal": {
      const lit = expr.value;
      switch (lit.type) {
        case "number":
          if (!Number.isFinite(lit.value)) {
            return { type: "domainError", message: "Non-finite number literal" };
          }
          return { type: "number", value: lit.value };
        case "percentage":
          if (!Number.isFinite(lit.value)) {
            return { type: "domainError", message: "Non-finite percentage literal" };
          }
          return { type: "number", value: lit.value };
        case "string":
          return { type: "string", value: lit.value };
      }
      break;
    }

    case "tokenRef": {
      const resolved = resolveToken(tokens, expr.name);
      if (resolved === null) {
        return { type: "referenceNotFound", name: expr.name };
      }
      // If the resolved value is an expression, recursively evaluate it
      if (resolved.type === "expression") {
        const parsed = parseExpression(resolved.expr);
        if (isEvalError(parsed as EvalValue | EvalError)) {
          return parsed as EvalError;
        }
        return evaluateExpression(parsed as TokenExpression, tokens, depth + 1);
      }
      return tokenValueToEvalValue(resolved);
    }

    case "binaryOp": {
      const leftVal = evaluateExpression(expr.left, tokens, depth + 1);
      if (isEvalError(leftVal)) return leftVal;

      const rightVal = evaluateExpression(expr.right, tokens, depth + 1);
      if (isEvalError(rightVal)) return rightVal;

      const leftNum = requireNumber(leftVal);
      if (typeof leftNum !== "number") return leftNum;

      const rightNum = requireNumber(rightVal);
      if (typeof rightNum !== "number") return rightNum;

      let result: number;
      switch (expr.op) {
        case "add":
          result = leftNum + rightNum;
          break;
        case "sub":
          result = leftNum - rightNum;
          break;
        case "mul":
          result = leftNum * rightNum;
          break;
        case "div":
          if (rightNum === 0) {
            return { type: "divisionByZero" };
          }
          result = leftNum / rightNum;
          break;
      }

      if (!Number.isFinite(result)) {
        return { type: "domainError", message: "Arithmetic produced non-finite result" };
      }
      return { type: "number", value: result };
    }

    case "unaryNeg": {
      const innerVal = evaluateExpression(expr.inner, tokens, depth + 1);
      if (isEvalError(innerVal)) return innerVal;
      const num = requireNumber(innerVal);
      if (typeof num !== "number") return num;
      const result = -num;
      if (!Number.isFinite(result)) {
        return { type: "domainError", message: "Negation produced non-finite result" };
      }
      return { type: "number", value: result };
    }

    case "functionCall": {
      const fnDef = FUNCTION_REGISTRY[expr.name];
      if (fnDef === undefined) {
        return { type: "unknownFunction", name: expr.name };
      }

      // Evaluate all arguments
      const evalArgs: EvalValue[] = [];
      for (const argExpr of expr.args) {
        const argVal = evaluateExpression(argExpr, tokens, depth + 1);
        if (isEvalError(argVal)) return argVal;
        evalArgs.push(argVal);
      }

      // Check arity
      const arityErr = checkArity(expr.name, evalArgs, fnDef.arity);
      if (arityErr !== null) return arityErr;

      return fnDef.call(evalArgs);
    }
  }

  // Should be unreachable — TypeScript exhaustive check
  return { type: "parse", message: "Unknown expression type" };
}

/**
 * Parse and evaluate an expression in one step.
 *
 * Convenience function that combines parseExpression and evaluateExpression.
 */
export function resolveExpression(
  input: string,
  tokens: Record<string, Token>,
): EvalValue | EvalError {
  const parsed = parseExpression(input);
  if (isEvalError(parsed as EvalValue | EvalError)) {
    return parsed as EvalError;
  }
  return evaluateExpression(parsed as TokenExpression, tokens);
}
