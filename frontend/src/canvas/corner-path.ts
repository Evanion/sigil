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
 * Per-corner geometric context computed by `appendCornerPath` and passed to
 * each per-shape helper. Insulates the shape helpers from corner-position
 * arithmetic.
 */
export interface CornerGeometry {
  /** Center of the ellipse / origin for the corner shape. */
  readonly cx: number;
  readonly cy: number;
  /** Effective radii after clamping. */
  readonly rx: number;
  readonly ry: number;
  /**
   * Angle in radians at which the corner curve starts (entering the curve from
   * the previous edge). Canvas convention: 0 = +x, π/2 = +y (down).
   */
  readonly startAngle: number;
  /** Angle in radians at which the corner curve ends (exiting onto the next edge). */
  readonly endAngle: number;
  /**
   * Unit vector pointing along the FIRST adjacent edge (the edge the curve
   * enters FROM). Used by Bevel / Notch / Superellipse for tangent math.
   */
  readonly entryDirX: number;
  readonly entryDirY: number;
  /** Unit vector along the SECOND adjacent edge (the edge the curve exits ONTO). */
  readonly exitDirX: number;
  readonly exitDirY: number;
  /** The geometric corner-point of the rectangle (where the two edges meet). */
  readonly cornerX: number;
  readonly cornerY: number;
}

/** Emit a single round-corner ellipse using the corner's geometry. */
export function appendRoundCorner(builder: PathBuilder, geom: CornerGeometry): void {
  builder.ellipse(
    geom.cx,
    geom.cy,
    geom.rx,
    geom.ry,
    0,
    geom.startAngle,
    geom.endAngle,
  );
}

/**
 * Emit a single diagonal `lineTo` for a Bevel corner.
 *
 * The bevel cuts from the point that's `ry` along the entry edge (away from
 * the geometric corner-point) to the point that's `rx` along the exit edge.
 * Both endpoints are at the same distance-from-edge as a Round corner would
 * have, so neighbouring edges remain aligned regardless of corner shape.
 *
 * The previous lineTo (in `appendCornerPath`) already placed the pen at the
 * entry endpoint; this helper only needs to draw the cut to the exit endpoint.
 */
export function appendBevelCorner(builder: PathBuilder, geom: CornerGeometry): void {
  // Exit edge endpoint: corner + exitDir * rx (toward next corner along the exit edge).
  const exitStartX = geom.cornerX + geom.exitDirX * geom.rx;
  const exitStartY = geom.cornerY + geom.exitDirY * geom.rx;
  builder.lineTo(exitStartX, exitStartY);
}

/**
 * Emit two `lineTo` segments for a Notch corner — a square step inward.
 *
 * Starting from the entry endpoint (where the previous lineTo placed the pen),
 * step perpendicular to the entry edge (toward the rectangle interior) by `rx`,
 * then step along the entry-edge direction outward to the exit endpoint.
 *
 * For a rectangle, the exit direction is perpendicular to the entry direction,
 * so the inward step is along `exitDir` and the final step lands on the exit
 * edge endpoint `(cornerX + exitDir * rx, cornerY + exitDir * rx)`.
 */
/**
 * Emit an inward-curving ellipse for a Scoop corner.
 *
 * Whereas Round centers the ellipse INSIDE the rectangle and sweeps a quarter
 * circle from edge to edge, Scoop centers the ellipse at the geometric corner-
 * point of the rectangle (outside) and sweeps the OPPOSITE quarter circle in
 * the reverse direction (counterclockwise), producing a concave bite.
 *
 * Mathematically: the start/end points on the edges are unchanged from Round
 * (so the path remains C0 continuous with the straight edges), only the center
 * and sweep direction change.
 */
export function appendScoopCorner(builder: PathBuilder, geom: CornerGeometry): void {
  // The complementary angle range covers the OUTSIDE arc; we sweep counterclockwise
  // to keep the path direction consistent with the outer polygon traversal.
  // For TL: instead of (PI to 1.5PI), use (2PI to 0.5PI) going CCW.
  builder.ellipse(
    geom.cornerX,
    geom.cornerY,
    geom.rx,
    geom.ry,
    0,
    geom.endAngle - Math.PI, // opposite-side start
    geom.startAngle - Math.PI, // opposite-side end
    true, // counterclockwise
  );
}

export function appendNotchCorner(builder: PathBuilder, geom: CornerGeometry): void {
  // Entry endpoint (current pen position): corner - entryDir * ry.
  const entryEndX = geom.cornerX - geom.entryDirX * geom.ry;
  const entryEndY = geom.cornerY - geom.entryDirY * geom.ry;
  // First inward step: from entry endpoint, perpendicular to entry edge by `rx`/`ry`.
  // Perpendicular to entryDir (pointing into the rectangle) = exitDir for a rectangle.
  // At any rectangle corner, exactly one of exitDir's components is zero, so the
  // mismatched axis multiplier (rx vs ry) has no effect — the inner point lands
  // at `(cornerX + exitDirX * rx, cornerY + exitDirY * ry)`.
  const innerX = entryEndX + geom.exitDirX * geom.rx;
  const innerY = entryEndY + geom.exitDirY * geom.ry;
  builder.lineTo(innerX, innerY);
  // Second step: along the entry edge (back outward) to the exit endpoint.
  const exitStartX = geom.cornerX + geom.exitDirX * geom.rx;
  const exitStartY = geom.cornerY + geom.exitDirY * geom.rx;
  builder.lineTo(exitStartX, exitStartY);
}

/** Compute geometry for the 4 corners of a rectangle. */
function cornerGeometries(
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): readonly [CornerGeometry, CornerGeometry, CornerGeometry, CornerGeometry] {
  const [tl, tr, br, bl] = corners;
  return [
    // Top-left: corner point at (x, y), ellipse center at (x+rx, y+ry).
    // Arc sweeps from +π (left) to +3π/2 (up).
    {
      cornerX: x,
      cornerY: y,
      cx: x + tl.radii.x,
      cy: y + tl.radii.y,
      rx: tl.radii.x,
      ry: tl.radii.y,
      startAngle: Math.PI,
      endAngle: 1.5 * Math.PI,
      entryDirX: 0,
      entryDirY: -1,
      exitDirX: 1,
      exitDirY: 0,
    },
    // Top-right: corner at (x+w, y), ellipse center at (x+w-rx, y+ry).
    // Arc sweeps from +3π/2 (up) to 0 (right). Note Canvas ellipse uses
    // clockwise sweep by default when end > start.
    {
      cornerX: x + width,
      cornerY: y,
      cx: x + width - tr.radii.x,
      cy: y + tr.radii.y,
      rx: tr.radii.x,
      ry: tr.radii.y,
      startAngle: 1.5 * Math.PI,
      endAngle: 2 * Math.PI,
      entryDirX: 1,
      entryDirY: 0,
      exitDirX: 0,
      exitDirY: 1,
    },
    // Bottom-right: corner at (x+w, y+h). Arc sweeps from 0 (right) to π/2 (down).
    {
      cornerX: x + width,
      cornerY: y + height,
      cx: x + width - br.radii.x,
      cy: y + height - br.radii.y,
      rx: br.radii.x,
      ry: br.radii.y,
      startAngle: 0,
      endAngle: 0.5 * Math.PI,
      entryDirX: 0,
      entryDirY: 1,
      exitDirX: -1,
      exitDirY: 0,
    },
    // Bottom-left: corner at (x, y+h). Arc sweeps from π/2 (down) to π (left).
    {
      cornerX: x,
      cornerY: y + height,
      cx: x + bl.radii.x,
      cy: y + height - bl.radii.y,
      rx: bl.radii.x,
      ry: bl.radii.y,
      startAngle: 0.5 * Math.PI,
      endAngle: Math.PI,
      entryDirX: -1,
      entryDirY: 0,
      exitDirX: 0,
      exitDirY: -1,
    },
  ];
}

/**
 * Dispatch to the appropriate per-shape helper for a single corner.
 * Round only for now; other variants added in Tasks 4-7.
 */
function appendCorner(builder: PathBuilder, corner: Corner, geom: CornerGeometry): void {
  switch (corner.type) {
    case "round":
      appendRoundCorner(builder, geom);
      return;
    case "bevel":
      appendBevelCorner(builder, geom);
      return;
    case "notch":
      appendNotchCorner(builder, geom);
      return;
    case "scoop":
      appendScoopCorner(builder, geom);
      return;
    default:
      // Other variants implemented in later tasks.
      throw new Error(`appendCorner not yet implemented for ${corner.type}`);
  }
}

export function appendCornerPath(
  builder: PathBuilder,
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): void {
  const [tl, tr, br, bl] = corners;
  const [glTL, glTR, glBR, glBL] = cornerGeometries(x, y, width, height, corners);

  // Top-left corner — start the path on the top edge just to the right of the TL corner curve.
  builder.moveTo(x + tl.radii.x, y);
  // Top edge → top-right corner
  builder.lineTo(x + width - tr.radii.x, y);
  appendCorner(builder, tr, glTR);
  // Right edge → bottom-right corner
  builder.lineTo(x + width, y + height - br.radii.y);
  appendCorner(builder, br, glBR);
  // Bottom edge → bottom-left corner
  builder.lineTo(x + bl.radii.x, y + height);
  appendCorner(builder, bl, glBL);
  // Left edge → top-left corner
  builder.lineTo(x, y + tl.radii.y);
  appendCorner(builder, tl, glTL);
  builder.closePath();
}
