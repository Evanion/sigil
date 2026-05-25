/**
 * Plan 14c — corner-shape path construction.
 *
 * Pure geometry helpers that emit canvas drawing operations onto a structural
 * `PathBuilder` target (satisfied by both `Path2D` in production and the
 * `PathRecorder` test helper). Each Corner variant has a dedicated append
 * helper so its instruction sequence is unit-testable in isolation.
 *
 * Spec: `docs/superpowers/specs/2026-04-23-14-corner-shapes.md` § 3.
 */

import type { Corner, Corners } from "../types/document";

/**
 * Subset of `Path2D` that the corner helpers emit. Allows tests to substitute
 * a `PathRecorder` without instantiating the real (browser-only) `Path2D`.
 */
export type PathBuilder = Pick<
  Path2D,
  "moveTo" | "lineTo" | "ellipse" | "bezierCurveTo" | "closePath"
>;

/** Bezier kappa for a circular arc (v1 superellipse anchor at smoothing = 0). */
export const KAPPA_CIRCULAR = 0.5522847498;

/** v1 anchor for superellipse smoothing = 0 — control points sit at distance `r` from corner. */
export const BLEED_AT_S0 = 1.0;

/** v1 anchor for superellipse smoothing = 1 — control points sit at distance `1.5 * r` from corner. */
export const BLEED_AT_S1 = 1.5;

/**
 * Append a single round corner to the path. (Stub — implemented in Task 3.)
 */
export function appendRoundCorner(_builder: PathBuilder, _corner: Corner): void {
  throw new Error("not implemented");
}

/**
 * Append the full 4-corner path (closed rectangle outline with per-corner shapes)
 * to `builder`. The path traces edges + corners in order: top-left → top-right →
 * bottom-right → bottom-left → close.
 *
 * Public `buildCornerPath` (Task 11) allocates a `Path2D` and delegates here.
 *
 * @param x — top-left X in canvas coordinates
 * @param y — top-left Y in canvas coordinates
 * @param width — node width (must be finite and > 0)
 * @param height — node height (must be finite and > 0)
 * @param corners — [topLeft, topRight, bottomRight, bottomLeft]
 */
export function appendCornerPath(
  _builder: PathBuilder,
  _x: number,
  _y: number,
  _width: number,
  _height: number,
  _corners: Corners,
): void {
  throw new Error("not implemented");
}
