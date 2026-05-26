/**
 * Simplified node drawing function for page thumbnails.
 *
 * The main renderer's drawNode is not exported (it has many dependencies
 * on text measurement, font building, etc. that are unnecessary at
 * thumbnail scale). This provides a lightweight version that draws
 * basic shapes with fill colors, suitable for 64x48 previews.
 */

import type { DocumentNode, Transform, Fill } from "../types/document";
import { colorToCss } from "../canvas/color-fill";

/** Default fill color for nodes without explicit fills. */
const DEFAULT_FILL = "#e0e0e0";

/**
 * Resolve the first solid fill color from a node's fills.
 *
 * RF-001 (PR #67): routes via the shared `colorToCss` helper so Display-P3
 * thumbnail fills emit `color(display-p3 …)` instead of falling back to
 * the default grey. Token refs cannot be resolved at this layer — they
 * fall back to DEFAULT_FILL.
 */
function resolveFill(fills: readonly Fill[]): string {
  for (const fill of fills) {
    if (fill.type === "solid") {
      const cv = fill.color;
      if (cv.type === "literal") {
        return colorToCss(cv.value);
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
