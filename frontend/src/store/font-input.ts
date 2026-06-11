/**
 * Single source-of-truth for FontEntry validation.
 *
 * Per CLAUDE.md §5 "single source-of-truth" rule: validation predicates that
 * are used by more than one frontend module MUST be defined here and imported
 * by every consumer.  This module is consumed by:
 *
 *   1. `parseFontsResponse` in document-store-solid.tsx (per-entry validation
 *      during the bulk fonts query result parse).
 *   2. `applyAddFont` in apply-remote.ts (per-entry validation on remote
 *      add_font broadcast payloads).
 *
 * Mirrors the Rust §5 `validate.rs` rule for TypeScript.
 */

import type { FontEntry } from "../types/document";

/**
 * Validate and cast an unknown value as a FontEntry.
 *
 * Rules:
 *  - `value` must be a non-null object.
 *  - `value.id` must be a non-empty string (UUID).
 *  - `value.family` must be a non-empty string (flows into `ctx.font` during
 *    canvas rendering — a missing/empty family would silently produce
 *    `"undefined"` in the CSS font string; see Task 17).
 *
 * Returns the validated entry cast to `FontEntry`, or `null` if any
 * required field is missing or invalid.  The caller is responsible for
 * emitting a diagnostic `console.warn` if `null` is returned.
 */
export function parseFontEntry(value: unknown): FontEntry | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const entry = value as Record<string, unknown>;

  const id = entry["id"];
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  // `family` is the field that flows into `ctx.font` during canvas rendering
  // (Task 17).  A missing or empty family would silently produce
  // `"undefined 12px sans-serif"` in the CSS font string — validate early.
  const family = entry["family"];
  if (typeof family !== "string" || family.length === 0) {
    return null;
  }

  return entry as unknown as FontEntry;
}
