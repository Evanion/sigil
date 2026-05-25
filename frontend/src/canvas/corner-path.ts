/**
 * Plan 14c — corner-shape path construction.
 *
 * Pure geometry helpers that emit canvas drawing operations onto a structural
 * `PathBuilder` target (satisfied by both `Path2D` in production and the
 * `PathRecorder` test helper). Each Corner variant has a dedicated append
 * helper so its instruction sequence is unit-testable in isolation.
 *
 * Public API (intended for production callers): `buildCornerPath`.
 *
 * Internal-but-exported (exported only to enable unit testing — do NOT
 * import these from production code; use `buildCornerPath` instead):
 *  - `PathBuilder` type, `CornerGeometry` type
 *  - `KAPPA_CIRCULAR`, `BLEED_AT_S0`, `BLEED_AT_S1` constants
 *  - `appendRoundCorner`, `appendBevelCorner`, `appendNotchCorner`,
 *    `appendScoopCorner`, `appendSuperellipseCorner`
 *  - `appendCornerPath`, `computeRadiusFitScale`
 *
 * Per-corner helpers assume their `CornerGeometry` argument has already been
 * validated by the orchestrator's input guards. Direct callers (tests,
 * future debug tools) MUST validate inputs first.
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

// CALIBRATION (v1 — see spec § 3.7):
//
// BLEED_AT_S0 and BLEED_AT_S1 are hand-tuned anchors interpolated linearly by
// `superellipseBleed(s)`. At s=0 the bezier matches a standard kappa-circle.
// At s=1 the control points sit ~67% along each edge from the corner, giving
// a visible squircle shoulder while preserving C0/C1 continuity with the
// adjacent straight edges and staying well clear of degenerate values.
//
// These constants are subject to designer recalibration in Plan 14d's
// Storybook tuning loop against iOS / Figma references. If you update them,
// also update the smoothing-related parity tests in `corner-path.test.ts`.

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
  /**
   * Scalar distance from the corner-point along the ENTRY edge to the entry
   * endpoint (where the previous straight edge meets the corner curve). Equals
   * `rx` when the entry edge runs horizontally (top/bottom), `ry` when it runs
   * vertically (left/right). Pre-computed so per-shape helpers don't have to
   * re-derive the axis-of-edge convention and avoid rx/ry conflation under
   * asymmetric radii (see RF-001 in PR #64 review).
   */
  readonly entryEdgeRadius: number;
  /** Scalar distance from the corner-point along the EXIT edge to the exit endpoint. */
  readonly exitEdgeRadius: number;
}

/** Emit a single round-corner ellipse using the corner's geometry. */
export function appendRoundCorner(builder: PathBuilder, geom: CornerGeometry): void {
  builder.ellipse(geom.cx, geom.cy, geom.rx, geom.ry, 0, geom.startAngle, geom.endAngle);
}

/**
 * Emit a single diagonal `lineTo` for a Bevel corner.
 *
 * The bevel cuts from the entry endpoint (where the previous `lineTo` placed
 * the pen — at distance `entryEdgeRadius` from the corner-point along the
 * entry edge) to the exit endpoint (distance `exitEdgeRadius` from the
 * corner-point along the exit edge). Both endpoints are at the same
 * distance-from-edge as a Round corner would have, so neighbouring straight
 * edges remain aligned regardless of corner shape — including under
 * asymmetric radii (rx ≠ ry).
 */
export function appendBevelCorner(builder: PathBuilder, geom: CornerGeometry): void {
  // Exit edge endpoint: corner + exitDir * exitEdgeRadius. Using the
  // axis-correct scalar (rx for horizontal edges, ry for vertical) is what
  // keeps the cut aligned with the orchestrator's next edge lineTo when
  // rx ≠ ry (RF-001).
  const exitStartX = geom.cornerX + geom.exitDirX * geom.exitEdgeRadius;
  const exitStartY = geom.cornerY + geom.exitDirY * geom.exitEdgeRadius;
  builder.lineTo(exitStartX, exitStartY);
}

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

/**
 * Compute the v1 bleed factor for a given smoothing value.
 * At s=0: standard circular-arc anchor (BLEED_AT_S0).
 * At s=1: anchor extends to BLEED_AT_S1, producing G2-like curvature.
 *
 * v1 uses linear interpolation. Calibration against iOS/Figma references is a
 * 14d follow-up per spec § 3.7.
 */
function superellipseBleed(smoothing: number): number {
  return (1 - smoothing) * BLEED_AT_S0 + smoothing * BLEED_AT_S1;
}

/**
 * Emit a single cubic bezier `bezierCurveTo` for a Superellipse corner.
 *
 * Control points are positioned along the edges, offset from the corner-point
 * by `bleed * radius`, and the cubic tangent at each endpoint is along the
 * adjacent edge (C1 continuity with the straight edges).
 *
 * At smoothing = 0, bleed = 1.0 and the bezier is the standard cubic
 * approximation of a quarter-circle (kappa = 0.5522 captured via the bleed
 * factor's interaction with the control-point offset).
 */
export function appendSuperellipseCorner(
  builder: PathBuilder,
  geom: CornerGeometry,
  smoothing: number,
): void {
  const bleed = superellipseBleed(smoothing);
  // Control point near entry: along the entry edge, offset from the
  // corner-point by entryEdgeRadius * (1 - KAPPA_CIRCULAR) * bleed.
  // At bleed=1.0 this matches the standard cubic-circle anchor; at bleed=1.5
  // it produces a flatter G2-style "shoulder." Using entryEdgeRadius (rx on
  // horizontal edges, ry on vertical) is what keeps the tangent on the edge
  // when rx ≠ ry (RF-001).
  const entryOffset = geom.entryEdgeRadius * (1 - KAPPA_CIRCULAR) * bleed;
  const cp1X = geom.cornerX - geom.entryDirX * entryOffset;
  const cp1Y = geom.cornerY - geom.entryDirY * entryOffset;
  // Control point near exit: same logic along the exit edge.
  const exitOffset = geom.exitEdgeRadius * (1 - KAPPA_CIRCULAR) * bleed;
  const cp2X = geom.cornerX + geom.exitDirX * exitOffset;
  const cp2Y = geom.cornerY + geom.exitDirY * exitOffset;
  // Exit endpoint: corner + exitDir * exitEdgeRadius.
  const exitX = geom.cornerX + geom.exitDirX * geom.exitEdgeRadius;
  const exitY = geom.cornerY + geom.exitDirY * geom.exitEdgeRadius;
  builder.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, exitX, exitY);
}

/**
 * Emit two `lineTo` segments for a Notch corner — a square step inward.
 *
 * Starting from the entry endpoint (where the previous `lineTo` placed the
 * pen), step perpendicular to the entry edge into the rectangle interior by
 * `exitEdgeRadius`, then step along the entry-edge direction to the exit
 * endpoint at distance `exitEdgeRadius` from the corner-point. Both
 * endpoints align with what Bevel / Round / Superellipse would have produced,
 * so neighbouring straight edges remain seam-free under asymmetric radii.
 */
export function appendNotchCorner(builder: PathBuilder, geom: CornerGeometry): void {
  // Entry endpoint: corner - entryDir * entryEdgeRadius (axis-correct scalar).
  const entryEndX = geom.cornerX - geom.entryDirX * geom.entryEdgeRadius;
  const entryEndY = geom.cornerY - geom.entryDirY * geom.entryEdgeRadius;
  // First inward step: from entry endpoint, step in the exit-edge direction
  // by exitEdgeRadius. This lands at the inner corner of the square notch —
  // (cornerX - entryDir*entryEdgeRadius + exitDir*exitEdgeRadius).
  const innerX = entryEndX + geom.exitDirX * geom.exitEdgeRadius;
  const innerY = entryEndY + geom.exitDirY * geom.exitEdgeRadius;
  builder.lineTo(innerX, innerY);
  // Second step: out to the exit endpoint on the exit edge.
  const exitStartX = geom.cornerX + geom.exitDirX * geom.exitEdgeRadius;
  const exitStartY = geom.cornerY + geom.exitDirY * geom.exitEdgeRadius;
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
    // Entry edge runs vertically (left side) → entryEdgeRadius = ry.
    // Exit edge runs horizontally (top) → exitEdgeRadius = rx.
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
      entryEdgeRadius: tl.radii.y,
      exitEdgeRadius: tl.radii.x,
    },
    // Top-right: corner at (x+w, y), ellipse center at (x+w-rx, y+ry).
    // Entry edge runs horizontally (top) → entryEdgeRadius = rx.
    // Exit edge runs vertically (right) → exitEdgeRadius = ry.
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
      entryEdgeRadius: tr.radii.x,
      exitEdgeRadius: tr.radii.y,
    },
    // Bottom-right: corner at (x+w, y+h).
    // Entry edge runs vertically (right) → entryEdgeRadius = ry.
    // Exit edge runs horizontally (bottom) → exitEdgeRadius = rx.
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
      entryEdgeRadius: br.radii.y,
      exitEdgeRadius: br.radii.x,
    },
    // Bottom-left: corner at (x, y+h).
    // Entry edge runs horizontally (bottom) → entryEdgeRadius = rx.
    // Exit edge runs vertically (left) → exitEdgeRadius = ry.
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
      entryEdgeRadius: bl.radii.x,
      exitEdgeRadius: bl.radii.y,
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
    case "superellipse":
      appendSuperellipseCorner(builder, geom, corner.smoothing);
      return;
    default: {
      // Exhaustiveness sentinel per
      // `.claude/rules/frontend-defensive.md` "Discriminated Unions Must Have
      // a Type-Level Exhaustiveness Sentinel". Adding a new Corner variant
      // without a case here will fail `tsc --noEmit`.
      const _exhaustive: never = corner;
      throw new Error(`unexpected corner type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Compute the maximum scale factor that fits the per-corner radii within the
 * rectangle edges. Returns 1.0 if no clamping is required.
 *
 * For each of the 4 edges, the two adjacent corners contribute their on-edge
 * radius (x for top/bottom, y for left/right). If the sum exceeds the edge
 * length, that edge needs scaling. The minimum scale across all edges is
 * applied uniformly to every corner's rx and ry so the shape stays
 * proportional. Per spec § 3.3.
 *
 * Returns a scale FACTOR in (0, 1], not a clamped value — the orchestrator
 * multiplies every corner's radii by this scalar.
 *
 * RF-008: guards non-finite / non-positive dimensions at the function entry
 * per CLAUDE.md §11 "Math Helpers Must Guard Their Domain". A bad input
 * returns 1 (no clamping) with a structured `console.warn`; downstream
 * helpers' validation catches the bad geometry separately. Exported, so
 * future direct callers (panels, debug tools) get defense-in-depth.
 */
export function computeRadiusFitScale(width: number, height: number, corners: Corners): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    console.warn(
      "corner-path: computeRadiusFitScale rejected non-finite or non-positive dimensions",
      {
        width,
        height,
      },
    );
    return 1;
  }
  const [tl, tr, br, bl] = corners;
  // Top edge: tl.rx + tr.rx ≤ width
  const topSum = tl.radii.x + tr.radii.x;
  const topScale = topSum > 0 ? width / topSum : Infinity;
  // Bottom edge: bl.rx + br.rx ≤ width
  const bottomSum = bl.radii.x + br.radii.x;
  const bottomScale = bottomSum > 0 ? width / bottomSum : Infinity;
  // Left edge: tl.ry + bl.ry ≤ height
  const leftSum = tl.radii.y + bl.radii.y;
  const leftScale = leftSum > 0 ? height / leftSum : Infinity;
  // Right edge: tr.ry + br.ry ≤ height
  const rightSum = tr.radii.y + br.radii.y;
  const rightScale = rightSum > 0 ? height / rightSum : Infinity;
  return Math.min(1, topScale, bottomScale, leftScale, rightScale);
}

/** Apply a uniform scale to every corner's radii. */
function scaleCorners(corners: Corners, scale: number): Corners {
  const scaled = corners.map((c): Corner => {
    const radii = { x: c.radii.x * scale, y: c.radii.y * scale };
    switch (c.type) {
      case "round":
        return { type: "round", radii };
      case "bevel":
        return { type: "bevel", radii };
      case "notch":
        return { type: "notch", radii };
      case "scoop":
        return { type: "scoop", radii };
      case "superellipse":
        return { type: "superellipse", radii, smoothing: c.smoothing };
      default: {
        // Exhaustiveness sentinel — adding a Corner variant without a case
        // here will fail `tsc --noEmit`.
        const _exhaustive: never = c;
        throw new Error(`unexpected corner type: ${String(_exhaustive)}`);
      }
    }
  });
  return [scaled[0], scaled[1], scaled[2], scaled[3]] as Corners;
}

/**
 * Per CLAUDE.md §11 "Floating-Point Validation": every f64 numeric input to a
 * path-construction call must be guarded. NaN/Infinity in canvas calls
 * produces malformed paths silently — the browser ignores the offending
 * operation without error.
 *
 * On failure: emit a structured `console.warn` per `.claude/rules/frontend-defensive.md`
 * "Internal Mutation Entry Points Must Diagnose Their Own No-Ops", and return
 * `false` so the caller emits NO ops to the builder.
 */
function validateDimensions(x: number, y: number, width: number, height: number): boolean {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    console.warn("corner-path: rejected non-finite or non-positive dimensions", {
      x,
      y,
      width,
      height,
    });
    return false;
  }
  return true;
}

function validateCornerRadii(corners: Corners): boolean {
  for (const corner of corners) {
    if (
      !Number.isFinite(corner.radii.x) ||
      !Number.isFinite(corner.radii.y) ||
      corner.radii.x < 0 ||
      corner.radii.y < 0
    ) {
      console.warn("corner-path: rejected non-finite or negative radii", { corner });
      return false;
    }
    if (corner.type === "superellipse") {
      if (!Number.isFinite(corner.smoothing) || corner.smoothing < 0 || corner.smoothing > 1) {
        console.warn("corner-path: rejected out-of-range superellipse smoothing", { corner });
        return false;
      }
    }
  }
  return true;
}

export function appendCornerPath(
  builder: PathBuilder,
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): void {
  if (!validateDimensions(x, y, width, height)) return;
  if (!validateCornerRadii(corners)) return;
  const scale = computeRadiusFitScale(width, height, corners);
  const effective = scale < 1 ? scaleCorners(corners, scale) : corners;
  const [tl, tr, br, bl] = effective;
  const [glTL, glTR, glBR, glBL] = cornerGeometries(x, y, width, height, effective);

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

/**
 * Public API for the canvas renderer. Allocates a fresh `Path2D` and writes
 * the corner-shape geometry into it. Returns the populated path ready for
 * `ctx.fill(path)` / `ctx.stroke(path)` / `ctx.clip(path)`.
 *
 * If `appendCornerPath` rejects the input (see guards), the returned Path2D
 * is empty — the caller will draw nothing, matching the safe fallback.
 */
export function buildCornerPath(
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): Path2D {
  const path = new Path2D();
  appendCornerPath(path, x, y, width, height, corners);
  return path;
}
