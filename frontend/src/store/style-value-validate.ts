/**
 * StyleValue shape validation shared between transport boundaries.
 *
 * Two call sites import from this module:
 *  - `operations/apply-remote.ts` (incoming GraphQL subscription payloads)
 *  - `store/document-store-solid.tsx` (outgoing user mutations before network)
 *
 * Symmetric validation per CLAUDE.md §11 "Validation Must Be Symmetric Across
 * All Transports". The frontend store layer is a transport boundary — it must
 * enforce the same `MAX_EXPRESSION_LENGTH` bound as the server.
 */

import type { StyleValue } from "../types/document";
import { MAX_EXPRESSION_LENGTH } from "./expression-eval";

/**
 * Validates an expression string's length against MAX_EXPRESSION_LENGTH.
 *
 * Returns true for non-empty strings within bounds. Does NOT parse or evaluate
 * the expression — that is a downstream concern. This guard exists to prevent
 * oversized payloads from crossing the transport boundary.
 */
export function isValidExpressionLength(expr: string): boolean {
  return typeof expr === "string" && expr.length > 0 && expr.length <= MAX_EXPRESSION_LENGTH;
}

/**
 * Shape-validates an unknown value as a StyleValue<T>.
 *
 * Runs at transport boundaries (apply-remote for incoming payloads). The
 * caller supplies `valueValidator` to typecheck the literal variant's value.
 *
 * Returns `false` and logs a warning (in the caller) if:
 * - The input is not an object or is null.
 * - The discriminant is not one of "literal" | "token_ref" | "expression".
 * - The `value` on a literal fails `valueValidator`.
 * - The `name` on a token_ref is not a non-empty string.
 * - The `expr` on an expression is empty or exceeds MAX_EXPRESSION_LENGTH.
 */
export function isValidStyleValue<T>(
  v: unknown,
  valueValidator: (x: unknown) => x is T,
): v is StyleValue<T> {
  if (typeof v !== "object" || v === null) return false;
  const sv = v as Record<string, unknown>;
  switch (sv["type"]) {
    case "literal":
      return valueValidator(sv["value"]);
    case "token_ref":
      return typeof sv["name"] === "string" && sv["name"].length > 0;
    case "expression":
      return typeof sv["expr"] === "string" && isValidExpressionLength(sv["expr"]);
    default:
      return false;
  }
}

/**
 * Type guard for Color — covers all supported color spaces.
 * Used by isValidStyleValue callers that expect StyleValue<Color>.
 */
export function isValidColor(v: unknown): v is import("../types/document").Color {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  const space = c["space"];
  if (space === "srgb" || space === "display_p3") {
    return (
      typeof c["r"] === "number" &&
      typeof c["g"] === "number" &&
      typeof c["b"] === "number" &&
      typeof c["a"] === "number" &&
      Number.isFinite(c["r"]) &&
      Number.isFinite(c["g"]) &&
      Number.isFinite(c["b"]) &&
      Number.isFinite(c["a"])
    );
  }
  if (space === "oklch") {
    return (
      typeof c["l"] === "number" &&
      typeof c["c"] === "number" &&
      typeof c["h"] === "number" &&
      typeof c["a"] === "number" &&
      Number.isFinite(c["l"]) &&
      Number.isFinite(c["c"]) &&
      Number.isFinite(c["h"]) &&
      Number.isFinite(c["a"])
    );
  }
  if (space === "oklab") {
    return (
      typeof c["l"] === "number" &&
      typeof c["a"] === "number" &&
      typeof c["b"] === "number" &&
      typeof c["alpha"] === "number" &&
      Number.isFinite(c["l"]) &&
      Number.isFinite(c["a"]) &&
      Number.isFinite(c["b"]) &&
      Number.isFinite(c["alpha"])
    );
  }
  return false;
}

/** Type guard for a finite number. */
export function isValidFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
