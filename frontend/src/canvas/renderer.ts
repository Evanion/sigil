/**
 * Canvas 2D renderer for the design document.
 *
 * Draws visible nodes onto an HTML5 Canvas with viewport transform applied.
 * Supports frame, rectangle, ellipse, text, and group node kinds.
 */

import type { DocumentNode, NodeId } from "../types/document";
import type { Viewport } from "./viewport";

/** Default fill color for nodes without explicit fills. */
const DEFAULT_FILL = "#e0e0e0";

/** Selection highlight color. */
const SELECTION_COLOR = "#0d99ff";

/** Selection highlight line width in screen pixels. */
const SELECTION_LINE_WIDTH = 2;

/** Name label font size in screen pixels. */
const LABEL_FONT_SIZE = 10;

/** Name label color. */
const LABEL_COLOR = "#999999";

/** Compare two NodeId values for equality. */
function nodeIdEquals(a: NodeId, b: NodeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}

/**
 * Resolve the first solid fill color from a node's style, or return the default.
 */
function resolveFillColor(node: DocumentNode): string {
  for (const fill of node.style.fills) {
    if (fill.type === "solid") {
      const colorValue = fill.color;
      if (colorValue.type === "literal") {
        const c = colorValue.value;
        if (c.space === "srgb") {
          const r = Math.round(c.r * 255);
          const g = Math.round(c.g * 255);
          const b = Math.round(c.b * 255);
          return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(c.a)})`;
        }
      }
    }
  }
  return DEFAULT_FILL;
}

/**
 * Draw a single node onto the canvas context.
 *
 * Assumes the viewport transform is already applied to the context.
 */
function drawNode(ctx: CanvasRenderingContext2D, node: DocumentNode): void {
  const { x, y, width, height } = node.transform;

  switch (node.kind.type) {
    case "frame":
    case "rectangle":
    case "group":
    case "image":
    case "component_instance": {
      ctx.fillStyle = resolveFillColor(node);
      ctx.fillRect(x, y, width, height);
      break;
    }
    case "ellipse": {
      ctx.fillStyle = resolveFillColor(node);
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "text": {
      ctx.fillStyle = resolveFillColor(node);
      const fontSize =
        node.kind.text_style.font_size.type === "literal"
          ? node.kind.text_style.font_size.value
          : 14;
      ctx.font = `${String(fontSize)}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(node.kind.content, x, y, width);
      break;
    }
    case "path": {
      // Path rendering is deferred to a later plan (pen tool).
      // Draw bounding box as placeholder.
      ctx.fillStyle = resolveFillColor(node);
      ctx.fillRect(x, y, width, height);
      break;
    }
  }
}

/**
 * Draw a selection highlight around a node.
 *
 * Uses a screen-space line width so the highlight does not scale with zoom.
 */
function drawSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  node: DocumentNode,
  zoom: number,
): void {
  const { x, y, width, height } = node.transform;
  const lineWidth = SELECTION_LINE_WIDTH / zoom;

  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = lineWidth;

  if (node.kind.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, width, height);
  }
}

/**
 * Draw a name label above a node.
 *
 * Label is rendered in screen-space size so it does not scale with zoom.
 */
function drawNameLabel(ctx: CanvasRenderingContext2D, node: DocumentNode, zoom: number): void {
  const { x, y } = node.transform;
  const fontSize = LABEL_FONT_SIZE / zoom;

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = `${String(fontSize)}px sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.fillText(node.name, x, y - fontSize * 0.3);
}

/**
 * Render the document onto the canvas.
 *
 * Clears the canvas, applies the viewport transform, and draws all visible
 * nodes. If a selectedNodeId is provided, draws a selection highlight and
 * name label on the matching node.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  nodes: readonly DocumentNode[],
  selectedNodeId: NodeId | null,
  dpr = 1,
): void {
  // Clear the entire canvas in screen space.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Apply DPR + viewport: compose them so drawing uses world coordinates
  // scaled to physical pixels.
  ctx.setTransform(
    viewport.zoom * dpr,
    0,
    0,
    viewport.zoom * dpr,
    viewport.x * dpr,
    viewport.y * dpr,
  );

  // Draw each visible node.
  for (const node of nodes) {
    if (!node.visible) {
      continue;
    }
    drawNode(ctx, node);
  }

  // Draw selection highlight on top of all nodes.
  if (selectedNodeId !== null) {
    for (const node of nodes) {
      if (!node.visible) {
        continue;
      }
      if (nodeIdEquals(node.id, selectedNodeId)) {
        drawSelectionHighlight(ctx, node, viewport.zoom);
        drawNameLabel(ctx, node, viewport.zoom);
        break;
      }
    }
  }

  // Reset transform to identity.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
