/**
 * Viewport transform for canvas pan/zoom.
 *
 * The viewport represents a screen-space pan offset and zoom level:
 *   - (x, y) is the screen-space offset (pan displacement in pixels).
 *   - zoom is the scale factor (screen pixels per world unit).
 *
 * Coordinate conversions:
 *   screenX = worldX * zoom + offsetX
 *   worldX  = (screenX - offsetX) / zoom
 */

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_SENSITIVITY = 0.002;

/** Create a default viewport at the origin with zoom level 1. */
export function createViewport(): Viewport {
  return { x: 0, y: 0, zoom: 1 };
}

/**
 * Convert screen (pixel) coordinates to world coordinates.
 *
 * worldX = (screenX - offsetX) / zoom
 */
export function screenToWorld(
  vp: Viewport,
  sx: number,
  sy: number,
): [number, number] {
  return [(sx - vp.x) / vp.zoom, (sy - vp.y) / vp.zoom];
}

/**
 * Convert world coordinates to screen (pixel) coordinates.
 *
 * screenX = worldX * zoom + offsetX
 */
export function worldToScreen(
  vp: Viewport,
  wx: number,
  wy: number,
): [number, number] {
  return [wx * vp.zoom + vp.x, wy * vp.zoom + vp.y];
}

/**
 * Apply viewport transform to a Canvas 2D rendering context.
 *
 * After calling this, draw operations use world coordinates.
 */
export function applyViewport(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
): void {
  ctx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.x, vp.y);
}

/**
 * Zoom the viewport at a screen-space cursor position.
 *
 * The world point under the cursor remains fixed after zooming.
 * Delta > 0 zooms in, delta < 0 zooms out.
 * Zoom is clamped to [0.1, 10].
 */
export function zoomAt(
  vp: Viewport,
  sx: number,
  sy: number,
  delta: number,
): Viewport {
  const factor = Math.exp(delta * ZOOM_SENSITIVITY);
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));

  // Keep the world point under the cursor stable:
  //   Before: worldX = (sx - oldOffsetX) / oldZoom
  //   After:  worldX = (sx - newOffsetX) / newZoom
  //   => newOffsetX = sx - worldX * newZoom
  const [wx, wy] = screenToWorld(vp, sx, sy);
  const newX = sx - wx * newZoom;
  const newY = sy - wy * newZoom;

  return { x: newX, y: newY, zoom: newZoom };
}
