/**
 * Canvas 2D renderer for the design document.
 *
 * Draws visible nodes onto an HTML5 Canvas with viewport transform applied.
 * Supports frame, rectangle, ellipse, text, and group node kinds.
 *
 * RF-002: Selection is identified by UUID (string), not NodeId.
 * RF-005: Accepts an optional preview transform to render drag feedback.
 */

import type { DocumentNode, Transform } from "../types/document";
import type { PreviewRect } from "../tools/shape-tool";
import type { PreviewTransform } from "../tools/select-tool";
import type { Viewport } from "./viewport";

/** Default fill color for nodes without explicit fills. */
const DEFAULT_FILL = "#e0e0e0";

/** Selection highlight color. */
const SELECTION_COLOR = "#0d99ff";

/** Selection highlight line width in screen pixels. */
const SELECTION_LINE_WIDTH = 2;

/** Name label font size in screen pixels. */
const LABEL_FONT_SIZE = 10;

/** Selection handle size in screen pixels. */
const HANDLE_SIZE = 6;

/** Name label color. */
const LABEL_COLOR = "#999999";

/** Preview rect stroke color. */
const PREVIEW_COLOR = "#0d99ff";

/** Preview rect dash pattern in screen pixels. */
const PREVIEW_DASH = [4, 4];

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
 * Get the effective transform for a node, taking into account any active
 * preview transform (e.g. during drag).
 */
function getEffectiveTransform(
  node: DocumentNode,
  previewTransform: PreviewTransform | null,
): Transform {
  if (previewTransform !== null && previewTransform.uuid === node.uuid) {
    return previewTransform.transform;
  }
  return node.transform;
}

/**
 * Draw a single node onto the canvas context.
 *
 * Assumes the viewport transform is already applied to the context.
 */
function drawNode(
  ctx: CanvasRenderingContext2D,
  node: DocumentNode,
  transform: Transform,
): void {
  const { x, y, width, height } = transform;

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
  transform: Transform,
  zoom: number,
): void {
  const { x, y, width, height } = transform;
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
function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  node: DocumentNode,
  transform: Transform,
  zoom: number,
): void {
  const { x, y } = transform;
  const fontSize = LABEL_FONT_SIZE / zoom;

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = `${String(fontSize)}px sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.fillText(node.name, x, y - fontSize * 0.3);
}

/**
 * Draw 8 selection handles (4 corners + 4 edge midpoints) on a node.
 *
 * Handles are drawn in world coordinates but sized relative to screen pixels
 * so they maintain a consistent visual size regardless of zoom.
 */
function drawSelectionHandles(
  ctx: CanvasRenderingContext2D,
  transform: Transform,
  zoom: number,
): void {
  const { x, y, width, height } = transform;
  const halfHandle = HANDLE_SIZE / 2 / zoom;

  // The 8 handle positions: 4 corners + 4 edge midpoints
  const positions: ReadonlyArray<readonly [number, number]> = [
    // Corners
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    // Edge midpoints
    [x + width / 2, y],
    [x + width, y + height / 2],
    [x + width / 2, y + height],
    [x, y + height / 2],
  ];

  ctx.fillStyle = SELECTION_COLOR;

  for (const [px, py] of positions) {
    ctx.fillRect(px - halfHandle, py - halfHandle, halfHandle * 2, halfHandle * 2);
  }
}

/**
 * Draw a dashed preview rectangle for the shape tool drag operation.
 *
 * Uses screen-space dash and line width so the preview does not scale with zoom.
 */
function drawPreviewRect(
  ctx: CanvasRenderingContext2D,
  preview: PreviewRect,
  zoom: number,
): void {
  const lineWidth = SELECTION_LINE_WIDTH / zoom;
  const dashScale = 1 / zoom;

  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(PREVIEW_DASH.map((d) => d * dashScale));
  ctx.strokeRect(preview.x, preview.y, preview.width, preview.height);
  ctx.setLineDash([]);
}

/**
 * Render the document onto the canvas.
 *
 * Clears the canvas, applies the viewport transform, and draws all visible
 * nodes. If a selectedUuid is provided, draws a selection highlight,
 * name label, and 8 resize handles on the matching node. If a previewRect
 * is provided, draws a dashed outline for the shape tool drag preview.
 * If a previewTransform is provided, uses it for the dragged node's position.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  nodes: readonly DocumentNode[],
  selectedUuid: string | null,
  dpr = 1,
  previewRect: PreviewRect | null = null,
  previewTransform: PreviewTransform | null = null,
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
    const effectiveTransform = getEffectiveTransform(node, previewTransform);
    drawNode(ctx, node, effectiveTransform);
  }

  // Draw selection highlight on top of all nodes.
  if (selectedUuid !== null) {
    for (const node of nodes) {
      if (!node.visible) {
        continue;
      }
      if (node.uuid === selectedUuid) {
        const effectiveTransform = getEffectiveTransform(node, previewTransform);
        drawSelectionHighlight(ctx, node, effectiveTransform, viewport.zoom);
        drawNameLabel(ctx, node, effectiveTransform, viewport.zoom);
        drawSelectionHandles(ctx, effectiveTransform, viewport.zoom);
        break;
      }
    }
  }

  // Draw shape tool preview rectangle if active.
  if (previewRect !== null) {
    drawPreviewRect(ctx, previewRect, viewport.zoom);
  }

  // Reset transform to identity.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
