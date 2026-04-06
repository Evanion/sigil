/**
 * Handle hit-testing for resize handles on selected nodes.
 *
 * Identifies which of 8 resize handles (4 corners + 4 edge midpoints)
 * the pointer is over, using an 8px screen-space hit zone that scales
 * inversely with zoom to remain consistent at any zoom level.
 *
 * Handle positions are computed identically to how renderer.ts draws
 * them (see drawSelectionHandles).
 *
 * NOTE: HandleType is declared as a regular enum (not const enum) because
 * the project tsconfig enables isolatedModules, which is incompatible with
 * const enum — isolated-module transpilers cannot inline cross-file const
 * enum values. A regular enum compiles to a plain JS object and is safe.
 */

import type { Transform } from "../types/document";

/** The 8 resize handle identifiers. */
export enum HandleType {
  NW = "nw",
  N = "n",
  NE = "ne",
  E = "e",
  SE = "se",
  S = "s",
  SW = "sw",
  W = "w",
}

/**
 * Hit zone size in screen pixels. The world-space hit zone is
 * HANDLE_HIT_ZONE_PX / zoom, keeping handle sensitivity constant
 * regardless of viewport zoom.
 */
const HANDLE_HIT_ZONE_PX = 8;

/**
 * Test whether a world-space point is within the hit zone of any
 * resize handle on the given transform.
 *
 * Corners are tested before edges so that corners take priority when
 * the pointer is near a corner (where an edge midpoint might also be
 * within range on small nodes).
 *
 * @param transform - The selected node's transform.
 * @param worldX - Pointer X in world coordinates.
 * @param worldY - Pointer Y in world coordinates.
 * @param zoom - Current viewport zoom level.
 * @returns The handle under the pointer, or null if no handle is hit.
 */
export function hitTestHandle(
  transform: Transform,
  worldX: number,
  worldY: number,
  zoom: number,
): HandleType | null {
  // RF-004: Guard against non-finite or non-positive zoom to prevent NaN/Infinity threshold.
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const { x, y, width, height } = transform;
  const threshold = HANDLE_HIT_ZONE_PX / safeZoom;

  // Handle positions: [handleType, centerX, centerY]
  // Corners first (priority over edges)
  const handles: ReadonlyArray<readonly [HandleType, number, number]> = [
    [HandleType.NW, x, y],
    [HandleType.NE, x + width, y],
    [HandleType.SE, x + width, y + height],
    [HandleType.SW, x, y + height],
    [HandleType.N, x + width / 2, y],
    [HandleType.E, x + width, y + height / 2],
    [HandleType.S, x + width / 2, y + height],
    [HandleType.W, x, y + height / 2],
  ];

  for (const [handleType, hx, hy] of handles) {
    const dx = Math.abs(worldX - hx);
    const dy = Math.abs(worldY - hy);
    if (dx <= threshold && dy <= threshold) {
      return handleType;
    }
  }

  return null;
}

/**
 * Map a handle type to the appropriate CSS cursor string.
 *
 * Cursor names follow the CSS spec for resize cursors and match the
 * table in Spec 11a section 1.1.
 */
export function getHandleCursor(handle: HandleType): string {
  switch (handle) {
    case HandleType.NW:
      return "nwse-resize";
    case HandleType.N:
      return "ns-resize";
    case HandleType.NE:
      return "nesw-resize";
    case HandleType.E:
      return "ew-resize";
    case HandleType.SE:
      return "nwse-resize";
    case HandleType.S:
      return "ns-resize";
    case HandleType.SW:
      return "nesw-resize";
    case HandleType.W:
      return "ew-resize";
  }
}
