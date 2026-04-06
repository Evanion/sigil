/**
 * Pure resize math for computing new transforms during handle drag.
 *
 * Each handle has an anchor point (the opposite corner/edge). The new
 * transform is computed by applying the drag delta to the handle's axes
 * while keeping the anchor fixed (or centering with Alt).
 *
 * This module has zero side effects — it takes inputs and returns a
 * new Transform. All modifier logic (Shift for aspect lock, Alt for
 * center resize) is handled here.
 */

import type { Transform } from "../types/document";
import { HandleType } from "./handle-hit-test";

/** Minimum width or height during resize (world-space pixels). */
const MIN_SIZE = 1;

/** Which axes each handle affects and the sign of the delta for each field. */
interface HandleAxes {
  readonly affectsX: boolean;
  readonly affectsY: boolean;
  readonly affectsWidth: boolean;
  readonly affectsHeight: boolean;
  /** Sign of dx applied to x: 1 means handle moves origin, 0 means unchanged. */
  readonly xSign: number;
  /** Sign of dy applied to y. */
  readonly ySign: number;
  /** Sign of dx applied to width: 1 grows right, -1 grows left. */
  readonly wSign: number;
  /** Sign of dy applied to height: 1 grows down, -1 grows up. */
  readonly hSign: number;
  /** Whether this is a corner handle (eligible for aspect ratio lock). */
  readonly isCorner: boolean;
}

const HANDLE_AXES: Readonly<Record<HandleType, HandleAxes>> = {
  [HandleType.NW]: {
    affectsX: true,
    affectsY: true,
    affectsWidth: true,
    affectsHeight: true,
    xSign: 1,
    ySign: 1,
    wSign: -1,
    hSign: -1,
    isCorner: true,
  },
  [HandleType.N]: {
    affectsX: false,
    affectsY: true,
    affectsWidth: false,
    affectsHeight: true,
    xSign: 0,
    ySign: 1,
    wSign: 0,
    hSign: -1,
    isCorner: false,
  },
  [HandleType.NE]: {
    affectsX: false,
    affectsY: true,
    affectsWidth: true,
    affectsHeight: true,
    xSign: 0,
    ySign: 1,
    wSign: 1,
    hSign: -1,
    isCorner: true,
  },
  [HandleType.E]: {
    affectsX: false,
    affectsY: false,
    affectsWidth: true,
    affectsHeight: false,
    xSign: 0,
    ySign: 0,
    wSign: 1,
    hSign: 0,
    isCorner: false,
  },
  [HandleType.SE]: {
    affectsX: false,
    affectsY: false,
    affectsWidth: true,
    affectsHeight: true,
    xSign: 0,
    ySign: 0,
    wSign: 1,
    hSign: 1,
    isCorner: true,
  },
  [HandleType.S]: {
    affectsX: false,
    affectsY: false,
    affectsWidth: false,
    affectsHeight: true,
    xSign: 0,
    ySign: 0,
    wSign: 0,
    hSign: 1,
    isCorner: false,
  },
  [HandleType.SW]: {
    affectsX: true,
    affectsY: false,
    affectsWidth: true,
    affectsHeight: true,
    xSign: 1,
    ySign: 0,
    wSign: -1,
    hSign: 1,
    isCorner: true,
  },
  [HandleType.W]: {
    affectsX: true,
    affectsY: false,
    affectsWidth: true,
    affectsHeight: false,
    xSign: 1,
    ySign: 0,
    wSign: -1,
    hSign: 0,
    isCorner: false,
  },
};

/**
 * Compute a new transform for a resize operation.
 *
 * When Shift is held on a corner handle, aspect ratio is locked. The dominant
 * axis is determined by comparing absolute delta magnitudes. On a tiebreak
 * (|dx| === |dy|), width is treated as dominant (RF-028).
 *
 * @param original - The node's transform at drag start.
 * @param handle - Which handle is being dragged.
 * @param dragDelta - World-space delta from drag start to current pointer.
 * @param modifiers - Active modifier keys.
 * @returns A new Transform with the resized dimensions.
 */
export function computeResize(
  original: Transform,
  handle: HandleType,
  dragDelta: { readonly dx: number; readonly dy: number },
  modifiers: { readonly shift: boolean; readonly alt: boolean },
): Transform {
  // RF-004: Guard against non-finite inputs to prevent NaN propagation.
  if (
    !Number.isFinite(original.x) ||
    !Number.isFinite(original.y) ||
    !Number.isFinite(original.width) ||
    !Number.isFinite(original.height) ||
    !Number.isFinite(dragDelta.dx) ||
    !Number.isFinite(dragDelta.dy)
  ) {
    return original;
  }

  const axes = HANDLE_AXES[handle];
  let { dx, dy } = dragDelta;

  // Shift: lock aspect ratio (corner handles only).
  // Determine the dominant axis by comparing absolute delta magnitudes,
  // then derive the constrained delta for the other axis.
  // RF-005: Skip aspect lock if dimensions are degenerate (zero/negative) to avoid Infinity.
  if (modifiers.shift && axes.isCorner && original.width > 0 && original.height > 0) {
    const aspectRatio = original.width / original.height;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx >= absDy) {
      // Width-dominant: derive height from width delta.
      const newWidth = original.width + dx * axes.wSign;
      const newHeight = newWidth / aspectRatio;
      // Back-compute the dy that produces this height via the handle's hSign.
      dy = (newHeight - original.height) * axes.hSign;
    } else {
      // Height-dominant: derive width from height delta.
      const newHeight = original.height + dy * axes.hSign;
      const newWidth = newHeight * aspectRatio;
      // Back-compute the dx that produces this width via the handle's wSign.
      dx = (newWidth - original.width) * axes.wSign;
    }
  }

  // Apply handle-specific deltas to each affected axis.
  let newX = original.x;
  let newY = original.y;
  let newWidth = original.width;
  let newHeight = original.height;

  if (axes.affectsX) {
    newX = original.x + dx * axes.xSign;
  }
  if (axes.affectsY) {
    newY = original.y + dy * axes.ySign;
  }
  if (axes.affectsWidth) {
    newWidth = original.width + dx * axes.wSign;
  }
  if (axes.affectsHeight) {
    newHeight = original.height + dy * axes.hSign;
  }

  // Alt: resize from center — mirror the delta to the opposite side so the
  // center point stays fixed. This doubles the effective size change and
  // repositions the origin to keep the center constant.
  if (modifiers.alt) {
    const centerX = original.x + original.width / 2;
    const centerY = original.y + original.height / 2;

    if (axes.affectsWidth) {
      const widthDelta = newWidth - original.width;
      newWidth = original.width + widthDelta * 2;
      newX = centerX - newWidth / 2;
    }
    if (axes.affectsHeight) {
      const heightDelta = newHeight - original.height;
      newHeight = original.height + heightDelta * 2;
      newY = centerY - newHeight / 2;
    }
  }

  // CLAUDE.md §11 exception: clamping is the intended UX for resize handles (user-facing affordance).
  // Clamp minimum size to MIN_SIZE. When the origin-moving side hits the
  // minimum, pin the origin so the far edge stays at its current position.
  if (newWidth < MIN_SIZE) {
    if (modifiers.alt) {
      // RF-007: When Alt is active, recenter so the center point stays fixed.
      newX = original.x + original.width / 2 - MIN_SIZE / 2;
    } else if (axes.affectsX) {
      // The left edge is moving (NW, SW, W handles). Pin x so the right edge
      // stays at original.x + original.width.
      newX = original.x + original.width - MIN_SIZE;
    }
    newWidth = MIN_SIZE;
  }
  if (newHeight < MIN_SIZE) {
    if (modifiers.alt) {
      // RF-007: When Alt is active, recenter so the center point stays fixed.
      newY = original.y + original.height / 2 - MIN_SIZE / 2;
    } else if (axes.affectsY) {
      // The top edge is moving (NW, N, NE handles). Pin y so the bottom edge
      // stays at original.y + original.height.
      newY = original.y + original.height - MIN_SIZE;
    }
    newHeight = MIN_SIZE;
  }

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
    rotation: original.rotation,
    scale_x: original.scale_x,
    scale_y: original.scale_y,
  };
}
