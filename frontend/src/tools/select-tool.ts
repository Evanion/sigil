/**
 * Select tool implementation.
 *
 * Handles click-to-select and drag-to-move interactions on the canvas.
 * Uses hit testing to determine which node is under the pointer, selects
 * it in the store, and sends a single set_transform command on pointer up.
 *
 * RF-002: Uses UUID-based addressing. Looks up node fresh from store
 * on each interaction to get the latest NodeId (which may be a placeholder
 * until the server responds with node_created).
 *
 * RF-005: Only sends a single SetTransform command on pointerUp, not on
 * every pointerMove. During drag, updates a local previewTransform that
 * the renderer can query for visual feedback.
 */

import type { DocumentStore } from "../store/document-store";
import type { Transform } from "../types/document";
import { hitTest } from "../canvas/hit-test";
import { setTransform } from "../types/commands";
import type { Tool, ToolEvent } from "./tool-manager";

/** The placeholder NodeId used for optimistically inserted nodes. */
const PLACEHOLDER_NODE_ID = { index: 0, generation: 0 };

/** Check whether a NodeId is still the placeholder (not yet assigned by server). */
function isPlaceholderNodeId(id: { readonly index: number; readonly generation: number }): boolean {
  return id.index === PLACEHOLDER_NODE_ID.index && id.generation === PLACEHOLDER_NODE_ID.generation;
}

/** Internal drag state tracked between pointerdown and pointerup. */
interface DragState {
  /** UUID of the node being dragged. */
  readonly draggedUuid: string;
  /** World X at drag start. */
  readonly startWorldX: number;
  /** World Y at drag start. */
  readonly startWorldY: number;
  /** The node's original transform at drag start. */
  readonly originalTransform: Transform;
}

/** Preview transform exposed to the renderer during drag. */
export interface PreviewTransform {
  readonly uuid: string;
  readonly transform: Transform;
}

/**
 * Create a select tool that uses the given document store for
 * hit testing, selection, and sending move commands.
 *
 * @param store - The document store providing node data and command dispatch.
 * @returns A Tool implementation for selection and movement, with a
 *   getPreviewTransform method for the renderer to show drag feedback.
 */
export function createSelectTool(store: DocumentStore): Tool & {
  getPreviewTransform(): PreviewTransform | null;
} {
  let dragState: DragState | null = null;
  let previewTransform: PreviewTransform | null = null;

  return {
    onPointerDown(event: ToolEvent): void {
      const hit = hitTest(store.getAllNodes(), event.worldX, event.worldY);

      if (hit) {
        store.select(hit.uuid);
        dragState = {
          draggedUuid: hit.uuid,
          startWorldX: event.worldX,
          startWorldY: event.worldY,
          originalTransform: hit.transform,
        };
        previewTransform = null;
      } else {
        store.select(null);
        dragState = null;
        previewTransform = null;
      }
    },

    onPointerMove(event: ToolEvent): void {
      if (dragState === null) {
        // TODO: hover cursor requires throttled hit testing (RF-010)
        return;
      }

      const deltaX = event.worldX - dragState.startWorldX;
      const deltaY = event.worldY - dragState.startWorldY;

      const newTransform: Transform = {
        ...dragState.originalTransform,
        x: dragState.originalTransform.x + deltaX,
        y: dragState.originalTransform.y + deltaY,
      };

      // RF-005: Update local preview only — no command sent during drag.
      previewTransform = {
        uuid: dragState.draggedUuid,
        transform: newTransform,
      };
    },

    onPointerUp(): void {
      if (dragState !== null && previewTransform !== null) {
        // RF-002: Look up the node fresh from the store to get the latest NodeId.
        const node = store.getNodeByUuid(dragState.draggedUuid);
        if (node && !isPlaceholderNodeId(node.id)) {
          // RF-005: Send a single SetTransform command with old and new transforms.
          const command = setTransform(
            node.id,
            previewTransform.transform,
            dragState.originalTransform,
          );
          store.sendCommand(command);
        }
      }
      dragState = null;
      previewTransform = null;
    },

    getCursor(): string {
      if (dragState !== null) {
        return "grabbing";
      }
      return "default";
    },

    getPreviewTransform(): PreviewTransform | null {
      return previewTransform;
    },
  };
}
