/**
 * Text tool for creating text nodes on the canvas.
 *
 * Two creation modes:
 * - Click (no drag or small drag): creates an auto-width text node at the click point
 * - Click+drag: creates a fixed-width text node with the dragged dimensions
 *
 * After creation, the tool fires an `onEditRequest` callback so the canvas
 * can open an inline text editing overlay.
 */

import type { Tool, ToolEvent } from "./tool-manager";
import type { ToolStore } from "../store/document-store-types";
import type { NodeKind, Transform, TextStyle } from "../types/document";
import type { PreviewRect } from "./shape-tool";

/** Minimum drag dimension (in world units) to treat as a fixed-width drag. */
const MIN_DRAG_DIMENSION = 2;

/** Default width for auto-width text nodes (initial bounding box). */
const DEFAULT_AUTO_WIDTH = 100;

/** Default height for text nodes. */
const DEFAULT_HEIGHT = 24;

/**
 * Default text style matching the spec:
 * Inter, 16px, weight 400, normal, auto line height (1.5), letter spacing 0,
 * left align, no decoration, black color.
 */
function defaultTextStyle(): TextStyle {
  return {
    font_family: "Inter",
    font_size: { type: "literal", value: 16 },
    font_weight: 400,
    font_style: "normal",
    line_height: { type: "literal", value: 1.5 },
    letter_spacing: { type: "literal", value: 0 },
    text_align: "left",
    text_decoration: "none",
    text_color: {
      type: "literal",
      value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 },
    },
  };
}

/**
 * Compute a normalized rectangle from two corner points.
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
 * Create a text tool that supports click-to-create and drag-to-create text nodes.
 *
 * @param store - The tool store used to create nodes.
 * @param onComplete - Called after a node is successfully created (e.g. to switch back to select tool).
 * @param onEditRequest - Called with the UUID of the newly created text node so the canvas can open the text editing overlay.
 * @returns A Tool with an additional `getPreviewRect()` method for rendering the drag preview.
 */
export function createTextTool(
  store: ToolStore,
  onComplete: () => void,
  onEditRequest: (uuid: string) => void,
): Tool & { getPreviewRect(): PreviewRect | null } {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let previewRect: PreviewRect | null = null;
  let nameCounter = 0;

  function createTextKind(sizing: "auto_width" | "fixed_width"): NodeKind {
    return {
      type: "text" as const,
      content: "",
      text_style: defaultTextStyle(),
      sizing,
    };
  }

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

      nameCounter++;
      const name = `Text ${String(nameCounter)}`;

      // Determine if this is a click (auto-width) or drag (fixed-width)
      const isDrag = rect.width > MIN_DRAG_DIMENSION && rect.height > MIN_DRAG_DIMENSION;

      const sizing = isDrag ? "fixed_width" : "auto_width";

      const transform: Transform = isDrag
        ? {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            rotation: 0,
            scale_x: 1,
            scale_y: 1,
          }
        : {
            x: startX,
            y: startY,
            width: DEFAULT_AUTO_WIDTH,
            height: DEFAULT_HEIGHT,
            rotation: 0,
            scale_x: 1,
            scale_y: 1,
          };

      const uuid = store.createNode(createTextKind(sizing), name, transform);
      store.select(uuid);
      onEditRequest(uuid);
      onComplete();
    },

    getCursor(): string {
      return "text";
    },

    getPreviewRect(): PreviewRect | null {
      return previewRect;
    },
  };
}
