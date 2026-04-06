/**
 * Smart guide snap engine for move and resize operations.
 *
 * Collects snap targets (left edge, right edge, center per axis) from
 * all visible, non-dragged nodes into sorted arrays. On each pointer
 * move, binary-searches for the nearest match within a screen-space
 * threshold. X and Y axes snap independently.
 *
 * Returns the snapped transform and an array of guide lines for
 * the renderer to draw.
 */

import type { Transform } from "../types/document";

/** Default snap threshold in screen pixels. */
const SNAP_THRESHOLD_PX = 8;

/** A guide line to render when snapping is active. */
export interface SnapGuide {
  /** Which axis this guide line runs along. */
  readonly axis: "x" | "y";
  /** World-coordinate position of the guide line. */
  readonly position: number;
}

/** Result of a snap operation. */
export interface SnapResult {
  /** The transform after snapping has been applied. */
  readonly snappedTransform: Transform;
  /** Guide lines to render. */
  readonly guides: readonly SnapGuide[];
}

/** Minimal node shape required by the snap engine. */
interface SnapNode {
  readonly uuid: string;
  readonly transform: Transform;
}

/**
 * Binary search for the index of the closest value in a sorted array.
 * Returns -1 if the array is empty, otherwise the index of the element
 * with the smallest absolute difference from `target`.
 */
function findNearest(sorted: readonly number[], target: number): number {
  if (sorted.length === 0) return -1;

  let lo = 0;
  let hi = sorted.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is the insertion point. Compare lo and lo-1 for the closest value.
  if (lo === 0) return 0;
  // RF-024: Safety guard — binary search loop guarantees lo <= sorted.length-1 when
  // hi starts at sorted.length-1, but this branch handles any edge case defensively.
  if (lo >= sorted.length) return sorted.length - 1;

  const diffLo = Math.abs((sorted[lo] as number) - target);
  const diffPrev = Math.abs((sorted[lo - 1] as number) - target);
  return diffPrev <= diffLo ? lo - 1 : lo;
}

export class SnapEngine {
  /** Sorted X snap targets (left edges, right edges, center-x values). */
  private xTargets: number[] = [];
  /** Sorted Y snap targets (top edges, bottom edges, center-y values). */
  private yTargets: number[] = [];
  /** World-space threshold for this prepare cycle. */
  private threshold: number = SNAP_THRESHOLD_PX;

  /**
   * Collect snap targets from all provided nodes, excluding the dragged
   * node(s). Call once at drag start, or whenever the viewport or node set changes.
   *
   * RF-027: Targets are captured at drag-start and remain static for the
   * duration of the drag. This means other clients' concurrent changes will
   * not affect snap targets until the next drag begins.
   *
   * @param nodes - All visible nodes in the document.
   * @param excludeIds - UUIDs of the node(s) being dragged (these are skipped).
   * @param zoom - Current viewport zoom; the screen-pixel threshold is divided by zoom
   *               to yield a world-space threshold.
   */
  prepare(nodes: readonly SnapNode[], excludeIds: ReadonlySet<string>, zoom: number): void {
    // Guard: zoom must be finite and positive to avoid NaN threshold.
    // If zoom is invalid, fall back to 1 (no scaling of threshold).
    const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    this.threshold = SNAP_THRESHOLD_PX / safeZoom;

    const xs: number[] = [];
    const ys: number[] = [];

    for (const node of nodes) {
      if (excludeIds.has(node.uuid)) continue;

      const { x, y, width, height } = node.transform;

      // Per CLAUDE.md §11 Floating-Point Validation: reject non-finite values
      // before adding them as snap targets to prevent NaN propagation.
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      ) {
        continue;
      }

      // X snap targets: left edge, right edge, center-x
      xs.push(x, x + width, x + width / 2);
      // Y snap targets: top edge, bottom edge, center-y
      ys.push(y, y + height, y + height / 2);
    }

    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);

    this.xTargets = xs;
    this.yTargets = ys;
  }

  /**
   * Snap a source transform to the nearest targets within the threshold.
   *
   * Tests 3 source points per axis:
   *   X: left edge (x), right edge (x+width), center-x (x+width/2)
   *   Y: top edge (y), bottom edge (y+height), center-y (y+height/2)
   *
   * Picks the closest match within the threshold for each axis.
   * X and Y axes snap independently. Width and height are never modified.
   *
   * @param source - The current preview transform (before snapping).
   * @returns The snapped transform and guide lines to render.
   */
  snap(source: Transform): SnapResult {
    // RF-004: Guard against non-finite source transform fields to prevent NaN propagation.
    if (
      !Number.isFinite(source.x) ||
      !Number.isFinite(source.y) ||
      !Number.isFinite(source.width) ||
      !Number.isFinite(source.height)
    ) {
      return { snappedTransform: source, guides: [] };
    }

    const threshold = this.threshold;
    const { x, y, width, height } = source;
    const guides: SnapGuide[] = [];

    // --- X axis ---
    const sourceXPoints = [x, x + width, x + width / 2];
    let bestXDelta: number | null = null;
    let bestXDistance = Infinity;
    let bestXGuidePos = 0;

    for (const sx of sourceXPoints) {
      const idx = findNearest(this.xTargets, sx);
      if (idx < 0) continue;
      const targetVal = this.xTargets[idx] as number;
      const dist = Math.abs(targetVal - sx);
      if (dist <= threshold && dist < bestXDistance) {
        bestXDistance = dist;
        bestXDelta = targetVal - sx;
        bestXGuidePos = targetVal;
      }
    }

    // --- Y axis ---
    const sourceYPoints = [y, y + height, y + height / 2];
    let bestYDelta: number | null = null;
    let bestYDistance = Infinity;
    let bestYGuidePos = 0;

    for (const sy of sourceYPoints) {
      const idx = findNearest(this.yTargets, sy);
      if (idx < 0) continue;
      const targetVal = this.yTargets[idx] as number;
      const dist = Math.abs(targetVal - sy);
      if (dist <= threshold && dist < bestYDistance) {
        bestYDistance = dist;
        bestYDelta = targetVal - sy;
        bestYGuidePos = targetVal;
      }
    }

    const snappedX = bestXDelta !== null ? x + bestXDelta : x;
    const snappedY = bestYDelta !== null ? y + bestYDelta : y;

    if (bestXDelta !== null) {
      guides.push({ axis: "x", position: bestXGuidePos });
    }
    if (bestYDelta !== null) {
      guides.push({ axis: "y", position: bestYGuidePos });
    }

    return {
      snappedTransform: {
        x: snappedX,
        y: snappedY,
        width,
        height,
        rotation: source.rotation,
        scale_x: source.scale_x,
        scale_y: source.scale_y,
      },
      guides,
    };
  }

  /**
   * Snap only specific edges of a transform during resize (RF-002).
   *
   * Unlike `snap()` which tests all 3 source points per axis, this method
   * only tests the edges that are actually moving based on the resize handle.
   * The snap delta is applied to the moving edge's position AND the dimension,
   * preserving the anchored edge.
   *
   * @param source - The current resized transform (after computeResize).
   * @param movingXEdges - Which X-axis edges to snap: "left", "right", or both.
   * @param movingYEdges - Which Y-axis edges to snap: "top", "bottom", or both.
   * @returns The snapped transform and guide lines to render.
   */
  snapEdges(
    source: Transform,
    movingXEdges: readonly ("left" | "right")[],
    movingYEdges: readonly ("top" | "bottom")[],
  ): SnapResult {
    // Guard against non-finite source transform fields.
    if (
      !Number.isFinite(source.x) ||
      !Number.isFinite(source.y) ||
      !Number.isFinite(source.width) ||
      !Number.isFinite(source.height)
    ) {
      return { snappedTransform: source, guides: [] };
    }

    const threshold = this.threshold;
    const { x, y, width, height } = source;
    const guides: SnapGuide[] = [];

    // --- X axis: only snap the moving edge(s) ---
    let bestXDelta: number | null = null;
    let bestXDistance = Infinity;
    let bestXGuidePos = 0;

    for (const edge of movingXEdges) {
      const sx = edge === "left" ? x : x + width;
      const idx = findNearest(this.xTargets, sx);
      if (idx < 0) continue;
      const targetVal = this.xTargets[idx] as number;
      const dist = Math.abs(targetVal - sx);
      if (dist <= threshold && dist < bestXDistance) {
        bestXDistance = dist;
        bestXDelta = targetVal - sx;
        bestXGuidePos = targetVal;
      }
    }

    // --- Y axis: only snap the moving edge(s) ---
    let bestYDelta: number | null = null;
    let bestYDistance = Infinity;
    let bestYGuidePos = 0;

    for (const edge of movingYEdges) {
      const sy = edge === "top" ? y : y + height;
      const idx = findNearest(this.yTargets, sy);
      if (idx < 0) continue;
      const targetVal = this.yTargets[idx] as number;
      const dist = Math.abs(targetVal - sy);
      if (dist <= threshold && dist < bestYDistance) {
        bestYDistance = dist;
        bestYDelta = targetVal - sy;
        bestYGuidePos = targetVal;
      }
    }

    // Apply snap delta to the moving edge while preserving the anchor.
    // For moving right edge: increase width by delta (x stays fixed).
    // For moving left edge: decrease x by delta and increase width correspondingly.
    let snappedX = x;
    let snappedY = y;
    let snappedWidth = width;
    let snappedHeight = height;

    if (bestXDelta !== null) {
      guides.push({ axis: "x", position: bestXGuidePos });
      const hasLeft = movingXEdges.includes("left");
      const hasRight = movingXEdges.includes("right");
      if (hasLeft && !hasRight) {
        // Left edge moves: shift x, compensate width
        snappedX = x + bestXDelta;
        snappedWidth = width - bestXDelta;
      } else if (hasRight && !hasLeft) {
        // Right edge moves: grow width, x stays
        snappedWidth = width + bestXDelta;
      } else {
        // Both edges move (e.g., Alt resize from center): shift position only
        snappedX = x + bestXDelta;
      }
    }

    if (bestYDelta !== null) {
      guides.push({ axis: "y", position: bestYGuidePos });
      const hasTop = movingYEdges.includes("top");
      const hasBottom = movingYEdges.includes("bottom");
      if (hasTop && !hasBottom) {
        snappedY = y + bestYDelta;
        snappedHeight = height - bestYDelta;
      } else if (hasBottom && !hasTop) {
        snappedHeight = height + bestYDelta;
      } else {
        snappedY = y + bestYDelta;
      }
    }

    return {
      snappedTransform: {
        x: snappedX,
        y: snappedY,
        width: snappedWidth,
        height: snappedHeight,
        rotation: source.rotation,
        scale_x: source.scale_x,
        scale_y: source.scale_y,
      },
      guides,
    };
  }
}
