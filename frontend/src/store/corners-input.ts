/**
 * Shared corner-shorthand parsing used by the document store's setCorners
 * function. Mirrors the server-side parser in crates/core/src/corners_input.rs.
 *
 * Accepts three input forms and expands them to a canonical Corners tuple:
 * 1. Uniform scalar — a single non-negative number; produces 4 round corners.
 * 2. Shape-level superellipse — { type: "superellipse", radius, smoothing? }.
 * 3. Per-corner array — exactly 4 Corner objects; superellipse is rejected.
 *
 * Validation constants are kept in sync with crates/core/src/validate.rs.
 * If the Rust constants change, update these constants and the corresponding
 * enforcement tests in __tests__/document-store-corners.test.ts.
 */

import type { Corner, Corners } from "../types/document";

// ── Constants (symmetric with crates/core/src/validate.rs) ──────────────

/** Maximum value for a single corner radius component (pixels).
 *  Matches Rust validate.rs `MAX_CORNER_RADIUS = 100_000.0`. */
export const MAX_CORNER_RADIUS = 100_000;

/** Minimum superellipse smoothing value.
 *  Matches Rust validate.rs `MIN_CORNER_SMOOTHING = 0.0`. */
export const MIN_CORNER_SMOOTHING = 0.0;

/** Maximum superellipse smoothing value.
 *  Matches Rust validate.rs `MAX_CORNER_SMOOTHING = 1.0`. */
export const MAX_CORNER_SMOOTHING = 1.0;

/** Default smoothing applied when the caller provides a shape-level
 *  superellipse input without an explicit smoothing value. Matches the
 *  Figma/iOS squircle default. */
export const DEFAULT_SMOOTHING = 0.6;

// ── Input type ───────────────────────────────────────────────────────────

/** Shape-level superellipse shorthand object. */
export interface SuperellipseInput {
  readonly type: "superellipse";
  readonly radius: number;
  readonly smoothing?: number;
}

/**
 * The three accepted forms for the setCorners store function.
 *
 * 1. `number` — uniform scalar applied to all four corners as `round`.
 * 2. `SuperellipseInput` — shape-level superellipse applied to all four corners.
 * 3. `Corners` — full per-corner array; superellipse is forbidden in this form.
 */
export type CornersInput = number | SuperellipseInput | Corners;

// ── Parser ───────────────────────────────────────────────────────────────

/**
 * Parses a CornersInput into a canonical Corners tuple, or returns null if
 * the input is invalid. The caller (setCorners store function) must treat a
 * null result as a no-op — no silent clamping, no mutation.
 *
 * All numeric values are validated with `Number.isFinite()` per CLAUDE.md
 * "Floating-Point Validation" rules. Negative radii and radii exceeding
 * `MAX_CORNER_RADIUS` are rejected. Invalid smoothing values are rejected.
 */
export function parseCornersInput(input: CornersInput): Corners | null {
  // ── Form 1: uniform scalar ──────────────────────────────────────────
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0 || input > MAX_CORNER_RADIUS) return null;
    const corner: Corner = { type: "round", radii: { x: input, y: input } };
    return [corner, corner, corner, corner];
  }

  // ── Form 2: shape-level superellipse object ─────────────────────────
  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as SuperellipseInput).type === "superellipse"
  ) {
    const { radius, smoothing } = input as SuperellipseInput;
    if (!Number.isFinite(radius) || radius < 0 || radius > MAX_CORNER_RADIUS) return null;
    const smooth = smoothing ?? DEFAULT_SMOOTHING;
    if (!Number.isFinite(smooth) || smooth < MIN_CORNER_SMOOTHING || smooth > MAX_CORNER_SMOOTHING)
      return null;
    const corner: Corner = {
      type: "superellipse",
      radii: { x: radius, y: radius },
      smoothing: smooth,
    };
    return [corner, corner, corner, corner];
  }

  // ── Form 3: per-corner array ────────────────────────────────────────
  if (Array.isArray(input) && input.length === 4) {
    for (const c of input as Corner[]) {
      // Superellipse is forbidden in per-corner form — must use shape-level.
      if (c.type === "superellipse") return null;
      // RF-016: reject stray `smoothing` on non-superellipse entries — symmetric
      // with the Rust `parse_per_corner_array` validation. Round/Bevel/Notch/Scoop
      // do not carry a `smoothing` field; an attacker (or buggy caller) MUST NOT
      // be able to silently smuggle one through.
      if ("smoothing" in (c as Record<string, unknown>)) return null;
      if (!Number.isFinite(c.radii.x) || c.radii.x < 0 || c.radii.x > MAX_CORNER_RADIUS)
        return null;
      if (!Number.isFinite(c.radii.y) || c.radii.y < 0 || c.radii.y > MAX_CORNER_RADIUS)
        return null;
    }
    return input as Corners;
  }

  // Not a recognised form (wrong-length array, null, undefined, etc.)
  return null;
}
