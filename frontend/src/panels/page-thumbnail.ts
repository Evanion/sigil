/**
 * Offscreen canvas renderer for page thumbnails.
 *
 * Creates a small canvas preview of a page's visible root nodes,
 * scaled and centered to fit within the thumbnail dimensions.
 */

import type { DocumentNode, Transform } from "../types/document";

/** Thumbnail logical width in CSS pixels. */
export const THUMBNAIL_WIDTH = 64;

/** Thumbnail logical height in CSS pixels. */
export const THUMBNAIL_HEIGHT = 48;

/** Padding (in thumbnail pixels) around content when fitting to bounds. */
const THUMBNAIL_PADDING = 4;

/**
 * Compute the axis-aligned bounding box of a set of transforms.
 * Returns null if no valid transforms are provided.
 */
function computeBoundingBox(
  transforms: readonly Transform[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (transforms.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const t of transforms) {
    if (
      !Number.isFinite(t.x) ||
      !Number.isFinite(t.y) ||
      !Number.isFinite(t.width) ||
      !Number.isFinite(t.height)
    ) {
      continue;
    }
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.width);
    maxY = Math.max(maxY, t.y + t.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return { minX, minY, maxX, maxY };
}

/**
 * Render a page thumbnail onto an offscreen canvas.
 *
 * @param nodes - The full node store (Record<uuid, DocumentNode>).
 * @param pageRootUuids - UUIDs of root-level nodes on this page.
 * @param drawNodeFn - Function that draws a single node onto a canvas context.
 * @returns An HTMLCanvasElement with the rendered thumbnail.
 */
export function renderPageThumbnail(
  nodes: Record<string, DocumentNode>,
  pageRootUuids: string[],
  drawNodeFn: (ctx: CanvasRenderingContext2D, node: DocumentNode, transform: Transform) => void,
): HTMLCanvasElement {
  const dpr = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(THUMBNAIL_WIDTH * dpr);
  canvas.height = Math.round(THUMBNAIL_HEIGHT * dpr);
  canvas.style.width = `${THUMBNAIL_WIDTH}px`;
  canvas.style.height = `${THUMBNAIL_HEIGHT}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Collect visible root nodes and their transforms.
  const visibleNodes: DocumentNode[] = [];
  const transforms: Transform[] = [];
  for (const uuid of pageRootUuids) {
    const node = nodes[uuid];
    if (!node || !node.visible) continue;
    visibleNodes.push(node);
    transforms.push(node.transform);
  }

  if (visibleNodes.length === 0) {
    // Empty page -- return blank canvas.
    return canvas;
  }

  const bounds = computeBoundingBox(transforms);
  if (!bounds) return canvas;

  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;

  // Guard against zero or negative content dimensions.
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return canvas;
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return canvas;

  // Compute scale to fit content within padded thumbnail area.
  const availableWidth = THUMBNAIL_WIDTH - THUMBNAIL_PADDING * 2;
  const availableHeight = THUMBNAIL_HEIGHT - THUMBNAIL_PADDING * 2;

  if (availableWidth <= 0 || availableHeight <= 0) return canvas;

  const scaleX = availableWidth / contentWidth;
  const scaleY = availableHeight / contentHeight;
  const scale = Math.min(scaleX, scaleY);

  if (!Number.isFinite(scale) || scale <= 0) return canvas;

  // Center the content within the thumbnail.
  const scaledWidth = contentWidth * scale;
  const scaledHeight = contentHeight * scale;
  const offsetX = (THUMBNAIL_WIDTH - scaledWidth) / 2;
  const offsetY = (THUMBNAIL_HEIGHT - scaledHeight) / 2;

  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return canvas;

  // Apply DPR + viewport transform via setTransform (CLAUDE.md: compose DPR into viewport).
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

  // Draw each visible root node with offset-adjusted transform.
  for (const node of visibleNodes) {
    const t = node.transform;
    const adjustedTransform: Transform = {
      x: t.x - bounds.minX,
      y: t.y - bounds.minY,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
      scale_x: t.scale_x,
      scale_y: t.scale_y,
    };
    drawNodeFn(ctx, node, adjustedTransform);
  }

  // Reset transform.
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return canvas;
}
