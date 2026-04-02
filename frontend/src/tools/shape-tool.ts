/**
 * Shape tool factory for drag-to-create shapes on the canvas.
 *
 * Creates frame, rectangle, and ellipse nodes by dragging from
 * one corner to the opposite corner. Handles negative drag directions
 * by normalizing the rectangle coordinates.
 */

import type { Tool, ToolEvent } from "./tool-manager";
import type { DocumentStore } from "../store/document-store";
import type { NodeKind, Transform } from "../types/document";

/** The rectangle displayed during a drag operation as a creation preview. */
export interface PreviewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Minimum dimension (in world units) required to create a node. */
const MIN_DIMENSION = 1;

/**
 * Compute a normalized rectangle from two corner points.
 *
 * Uses Math.min for position and Math.abs for dimensions so that
 * dragging in any direction produces a valid positive-sized rect.
 */
function computeRect(startX: number, startY: number, endX: number, endY: number): PreviewRect {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

/**
 * Create a shape tool that supports drag-to-create for a given node kind.
 *
 * @param store - The document store used to create nodes on the server.
 * @param kindFactory - Function returning the NodeKind for each created node.
 * @param namePrefix - Prefix for auto-generated node names (e.g. "Rectangle").
 * @param onComplete - Called after a node is successfully created (e.g. to switch back to select tool).
 * @returns A Tool with an additional `getPreviewRect()` method for rendering the drag preview.
 */
export function createShapeTool(
  store: DocumentStore,
  kindFactory: () => NodeKind,
  namePrefix: string,
  onComplete: () => void,
): Tool & { getPreviewRect(): PreviewRect | null } {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let previewRect: PreviewRect | null = null;
  let nameCounter = 0;

  return {
    onPointerDown(event: ToolEvent): void {
      dragging = true;
      startX = event.worldX;
      startY = event.worldY;
      previewRect = null;
    },

    onPointerMove(event: ToolEvent): void {
      if (!dragging) {
        return;
      }
      previewRect = computeRect(startX, startY, event.worldX, event.worldY);
    },

    onPointerUp(event: ToolEvent): void {
      if (!dragging) {
        return;
      }

      const rect = computeRect(startX, startY, event.worldX, event.worldY);

      // Reset state before any callbacks
      dragging = false;
      previewRect = null;

      // Only create the node if both dimensions exceed the minimum size
      if (rect.width <= MIN_DIMENSION || rect.height <= MIN_DIMENSION) {
        return;
      }

      nameCounter++;
      const name = `${namePrefix} ${String(nameCounter)}`;

      const transform: Transform = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
      };

      // RF-009: Select the newly created node immediately.
      const uuid = store.createNode(kindFactory(), name, transform);
      store.select(uuid);
      onComplete();
    },

    getCursor(): string {
      return "crosshair";
    },

    getPreviewRect(): PreviewRect | null {
      return previewRect;
    },
  };
}
