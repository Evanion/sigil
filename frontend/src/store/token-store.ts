/**
 * Pure token resolution functions — no side effects, no Solid.js dependencies.
 *
 * These functions walk alias chains in the token map and extract typed values.
 * All numeric outputs are guarded with Number.isFinite() per CLAUDE.md §11
 * Floating-Point Validation rules.
 */

import type { Token, TokenValue, Color, StyleValue } from "../types/document";

/**
 * Maximum alias chain depth before resolution is abandoned.
 * Prevents infinite loops from cycles and pathologically deep chains.
 * Using >= comparison: depth is zero-indexed, so depth >= MAX_ALIAS_DEPTH
 * rejects exactly at the limit boundary (0 through MAX_ALIAS_DEPTH-1 allowed).
 */
export const MAX_ALIAS_DEPTH = 16;

/**
 * Resolve a token by name, following alias chains up to MAX_ALIAS_DEPTH hops.
 *
 * Returns null if:
 * - The token does not exist in the map.
 * - An alias chain forms a cycle.
 * - The alias chain exceeds MAX_ALIAS_DEPTH hops.
 */
export function resolveToken(tokens: Record<string, Token>, name: string): TokenValue | null {
  // Iterative resolution — no recursion, explicit depth counter.
  // The visited set detects cycles (A→B→A) without relying solely on the depth guard.
  const visited = new Set<string>();
  let current = name;
  let depth = 0;

  while (true) {
    // Depth guard: uses >= so that depth 0..MAX_ALIAS_DEPTH-1 are valid hops.
    // A chain of MAX_ALIAS_DEPTH aliases requires MAX_ALIAS_DEPTH hops — rejected.
    if (depth >= MAX_ALIAS_DEPTH) {
      return null;
    }

    // Cycle detection
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);

    const token = tokens[current];
    if (token === undefined) {
      return null;
    }

    const value = token.value;
    if (value.type === "alias") {
      // Follow the alias
      current = value.name;
      depth += 1;
    } else if (value.type === "expression") {
      // Expression values are returned as-is for the expression evaluator to handle.
      // The caller (expression-eval.ts) is responsible for parsing and evaluating.
      return value;
    } else {
      // Concrete value found
      return value;
    }
  }
}

/**
 * Resolve a token and extract its Color value.
 * Returns null if the token does not exist, cannot be resolved, or is not a color token.
 */
export function resolveColorToken(tokens: Record<string, Token>, name: string): Color | null {
  const resolved = resolveToken(tokens, name);
  if (resolved === null || resolved.type !== "color") {
    return null;
  }
  return resolved.value;
}

/**
 * Resolve a token and extract its numeric value.
 * Supports: number, dimension, and font_weight token types.
 * Returns null if the token does not exist, cannot be resolved, is not numeric,
 * or the resolved number is not finite (NaN/Infinity guard per CLAUDE.md §11).
 */
export function resolveNumberToken(tokens: Record<string, Token>, name: string): number | null {
  const resolved = resolveToken(tokens, name);
  if (resolved === null) {
    return null;
  }

  let raw: number;
  switch (resolved.type) {
    case "number":
      raw = resolved.value;
      break;
    case "dimension":
      raw = resolved.value;
      break;
    case "font_weight":
      raw = resolved.weight;
      break;
    default:
      return null;
  }

  // Guard: reject NaN and Infinity per CLAUDE.md §11 Floating-Point Validation.
  if (!Number.isFinite(raw)) {
    return null;
  }

  return raw;
}

/**
 * Resolve a StyleValue<Color> to a concrete Color.
 *
 * - Literal: return the embedded value directly.
 * - TokenRef: resolve via the token store; return fallback if missing or non-color.
 */
export function resolveStyleValueColor(
  sv: StyleValue<Color>,
  tokens: Record<string, Token>,
  fallback: Color,
): Color {
  if (sv.type === "literal") {
    return sv.value;
  }
  // sv.type === "token_ref"
  const resolved = resolveColorToken(tokens, sv.name);
  return resolved !== null ? resolved : fallback;
}

/**
 * Resolve a StyleValue<number> to a concrete number.
 *
 * - Literal: return the embedded value (guarded for finiteness).
 * - TokenRef: resolve via the token store; return fallback if missing or non-numeric.
 */
export function resolveStyleValueNumber(
  sv: StyleValue<number>,
  tokens: Record<string, Token>,
  fallback: number,
): number {
  if (sv.type === "literal") {
    // Guard: reject NaN/Infinity from literal values per CLAUDE.md §11.
    return Number.isFinite(sv.value) ? sv.value : fallback;
  }
  // sv.type === "token_ref"
  const resolved = resolveNumberToken(tokens, sv.name);
  return resolved !== null ? resolved : fallback;
}
