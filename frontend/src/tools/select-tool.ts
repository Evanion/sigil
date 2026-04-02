/**
 * Select tool implementation.
 *
 * Handles click-to-select and drag-to-move interactions on the canvas.
 * Uses hit testing to determine which node is under the pointer, selects
 * it in the store, and sends set_transform commands when dragging.
 */

import type { DocumentStore } from "../store/document-store";
import type { DocumentNode, Transform } from "../types/document";
import { hitTest } from "../canvas/hit-test";
import { setTransform } from "../types/commands";
import type { Tool, ToolEvent } from "./tool-manager";

/** Internal drag state tracked between pointerdown and pointerup. */
interface DragState {
  /** The node being dragged. */
  readonly node: DocumentNode;
  /** World X at drag start. */
  readonly startWorldX: number;
  /** World Y at drag start. */
  readonly startWorldY: number;
  /** The node's original transform at drag start. */
  readonly originalTransform: Transform;
}

/**
 * Create a select tool that uses the given document store for
 * hit testing, selection, and sending move commands.
 *
 * @param store - The document store providing node data and command dispatch.
 * @returns A Tool implementation for selection and movement.
 */
export function createSelectTool(store: DocumentStore): Tool {
  let dragState: DragState | null = null;

  return {
    onPointerDown(event: ToolEvent): void {
      const hit = hitTest(store.getAllNodes(), event.worldX, event.worldY);

      if (hit) {
        store.select(hit.uuid);
        dragState = {
          node: hit,
          startWorldX: event.worldX,
          startWorldY: event.worldY,
          originalTransform: hit.transform,
        };
      } else {
        store.select(null);
        dragState = null;
      }
    },

    onPointerMove(event: ToolEvent): void {
      if (dragState === null) {
        return;
      }

      const deltaX = event.worldX - dragState.startWorldX;
      const deltaY = event.worldY - dragState.startWorldY;

      const newTransform: Transform = {
        ...dragState.originalTransform,
        x: dragState.originalTransform.x + deltaX,
        y: dragState.originalTransform.y + deltaY,
      };

      const command = setTransform(dragState.node.id, newTransform, dragState.originalTransform);

      store.sendCommand(command);
    },

    onPointerUp(): void {
      dragState = null;
    },

    getCursor(): string {
      if (dragState !== null) {
        return "grabbing";
      }
      return "default";
    },
  };
}
