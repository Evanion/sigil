/**
 * Pure math functions for multi-select operations.
 *
 * All functions are side-effect-free and do not depend on Solid reactivity,
 * DOM APIs, or canvas state. They operate exclusively on Transform values and
 * axis-aligned bounding boxes.
 *
 * Every function guards Number.isFinite on numeric inputs per CLAUDE.md
 * §11 "Floating-Point Validation".
 */

import type { Transform } from "../types/document";
import { computeAABB } from "./hit-test";

// ── Types ─────────────────────────────────────────────────────────────

/**
 * A node's position expressed as 0-1 fractions within a compound bounding box.
 *
 * - rx / ry: offset of the node's top-left corner from the compound bounds origin,
 *   as a fraction of the bounds' width / height.
 * - rw / rh: node width / height as a fraction of bounds' width / height.
 */
export interface RelativePosition {
  readonly rx: number; // 0-1 fraction of x offset within bounds
  readonly ry: number; // 0-1 fraction of y offset within bounds
  readonly rw: number; // 0-1 fraction of width within bounds
  readonly rh: number; // 0-1 fraction of height within bounds
}

// ── Guards ────────────────────────────────────────────────────────────

/** Assert that every field of a Transform contains a finite number. */
function assertFiniteTransform(t: Transform): void {
  const fields: (keyof Transform)[] = ["x", "y", "width", "height", "rotation", "scale_x", "scale_y"];
  for (const field of fields) {
    if (!Number.isFinite(t[field])) {
      throw new RangeError(
        `computeCompoundBounds: transform.${field} is not finite (got ${String(t[field])})`,
      );
    }
  }
}

// ── computeCompoundBounds ─────────────────────────────────────────────

/**
 * Compute the union axis-aligned bounding box that encompasses all transforms.
 *
 * For each transform the full AABB is computed (accounting for rotation) and
 * then all AABBs are unioned into a single bounding box.
 *
 * The returned Transform always has:
 * - rotation: 0  (compound bounds are always axis-aligned)
 * - scale_x: 1, scale_y: 1
 *
 * Guard: empty array → zero-dimension Transform at origin.
 */
export function computeCompoundBounds(transforms: Transform[]): Transform {
  if (transforms.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0, rotation: 0, scale_x: 1, scale_y: 1 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const t of transforms) {
    assertFiniteTransform(t);
    const [aMinX, aMinY, aMaxX, aMaxY] = computeAABB(t);
    if (aMinX < minX) minX = aMinX;
    if (aMinY < minY) minY = aMinY;
    if (aMaxX > maxX) maxX = aMaxX;
    if (aMaxY > maxY) maxY = aMaxY;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: 0,
    scale_x: 1,
    scale_y: 1,
  };
}

// ── computeRelativePositions ──────────────────────────────────────────

/**
 * Express each transform's position and size as 0-1 fractions within `bounds`.
 *
 * The fractions map the transform's AABB top-left corner and dimensions
 * relative to the compound bounds rectangle (not the screen origin).
 *
 * Guard: zero-dimension bounds (width or height === 0) → all fractions are 0.
 */
export function computeRelativePositions(
  transforms: Transform[],
  bounds: Transform,
): RelativePosition[] {
  assertFiniteTransform(bounds);

  const bw = bounds.width;
  const bh = bounds.height;

  // Zero-dimension bounds: cannot divide — return all-zero fractions.
  const canDivideW = bw !== 0;
  const canDivideH = bh !== 0;

  return transforms.map((t) => {
    assertFiniteTransform(t);
    const [minX, minY, maxX, maxY] = computeAABB(t);
    const nodeW = maxX - minX;
    const nodeH = maxY - minY;

    return {
      rx: canDivideW ? (minX - bounds.x) / bw : 0,
      ry: canDivideH ? (minY - bounds.y) / bh : 0,
      rw: canDivideW ? nodeW / bw : 0,
      rh: canDivideH ? nodeH / bh : 0,
    };
  });
}

// ── applyProportionalResize ───────────────────────────────────────────

/**
 * Map relative positions back to absolute coordinates within `newBounds`.
 *
 * Each output Transform has the same rotation, scale_x, and scale_y as the
 * corresponding original transform — only x, y, width, and height change.
 *
 * The arrays `originals` and `positions` must have the same length.
 */
export function applyProportionalResize(
  originals: Transform[],
  positions: RelativePosition[],
  newBounds: Transform,
): Transform[] {
  assertFiniteTransform(newBounds);

  return originals.map((original, i) => {
    assertFiniteTransform(original);
    const pos = positions[i];

    if (!Number.isFinite(pos.rx) || !Number.isFinite(pos.ry) || !Number.isFinite(pos.rw) || !Number.isFinite(pos.rh)) {
      throw new RangeError(
        `applyProportionalResize: RelativePosition at index ${i} contains non-finite value`,
      );
    }

    return {
      x: newBounds.x + pos.rx * newBounds.width,
      y: newBounds.y + pos.ry * newBounds.height,
      width: pos.rw * newBounds.width,
      height: pos.rh * newBounds.height,
      // Preserve the original's intrinsic transform properties.
      rotation: original.rotation,
      scale_x: original.scale_x,
      scale_y: original.scale_y,
    };
  });
}

// ── rectIntersectsAABB ────────────────────────────────────────────────

/**
 * Test whether a marquee rectangle overlaps a node's AABB.
 *
 * Uses strict overlap (touching edges are NOT considered intersecting).
 * Negative-dimension rects are normalized before the test — this handles
 * right-to-left and bottom-to-top marquee drags.
 *
 * @param rect  - The marquee rectangle; may have negative width/height.
 * @param aabb  - Node axis-aligned bounding box as [minX, minY, maxX, maxY].
 */
export function rectIntersectsAABB(
  rect: { x: number; y: number; width: number; height: number },
  aabb: [number, number, number, number],
): boolean {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    throw new RangeError("rectIntersectsAABB: rect contains non-finite value");
  }

  const [aMinX, aMinY, aMaxX, aMaxY] = aabb;

  if (
    !Number.isFinite(aMinX) ||
    !Number.isFinite(aMinY) ||
    !Number.isFinite(aMaxX) ||
    !Number.isFinite(aMaxY)
  ) {
    throw new RangeError("rectIntersectsAABB: aabb contains non-finite value");
  }

  // Normalize negative dimensions (marquee dragged in reverse direction).
  const rMinX = rect.width >= 0 ? rect.x : rect.x + rect.width;
  const rMinY = rect.height >= 0 ? rect.y : rect.y + rect.height;
  const rMaxX = rect.width >= 0 ? rect.x + rect.width : rect.x;
  const rMaxY = rect.height >= 0 ? rect.y + rect.height : rect.y;

  // Standard AABB overlap test — strict (touching edges do not count).
  return rMinX < aMaxX && rMaxX > aMinX && rMinY < aMaxY && rMaxY > aMinY;
}
