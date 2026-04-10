/**
 * Simplified node drawing function for page thumbnails.
 *
 * The main renderer's drawNode is not exported (it has many dependencies
 * on text measurement, font building, etc. that are unnecessary at
 * thumbnail scale). This provides a lightweight version that draws
 * basic shapes with fill colors, suitable for 64x48 previews.
 */

import type { DocumentNode, Transform, ColorSrgb, Fill } from "../types/document";

/** Default fill color for nodes without explicit fills. */
const DEFAULT_FILL = "#e0e0e0";

/**
 * Convert an sRGB color to a CSS rgba() string.
 * Returns null when any channel is non-finite (CLAUDE.md: floating-point validation).
 */
function srgbToRgba(c: ColorSrgb): string | null {
  if (
    !Number.isFinite(c.r) ||
    !Number.isFinite(c.g) ||
    !Number.isFinite(c.b) ||
    !Number.isFinite(c.a)
  ) {
    return null;
  }
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(c.a)})`;
}

/**
 * Resolve the first solid fill color from a node's fills.
 */
function resolveFill(fills: readonly Fill[]): string {
  for (const fill of fills) {
    if (fill.type === "solid") {
      const cv = fill.color;
      if (cv.type === "literal" && cv.value.space === "srgb") {
        return srgbToRgba(cv.value) ?? DEFAULT_FILL;
      }
    }
  }
  return DEFAULT_FILL;
}

/**
 * Draw a single node onto a canvas context for thumbnail rendering.
 *
 * This is a simplified version of the main renderer's drawNode.
 * At thumbnail scale (64x48), text details are not visible, so
 * text nodes are rendered as filled rectangles.
 */
export function drawNodeForThumbnail(
  ctx: CanvasRenderingContext2D,
  node: DocumentNode,
  transform: Transform,
): void {
  const { x, y, width, height } = transform;

  // Guard all dimensions (CLAUDE.md: floating-point validation).
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return;
  }

  const fillColor = resolveFill(node.style.fills);

  switch (node.kind.type) {
    case "ellipse": {
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "frame":
    case "rectangle":
    case "group":
    case "image":
    case "text":
    case "path":
    case "component_instance":
    default: {
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y, width, height);
      break;
    }
  }
}
