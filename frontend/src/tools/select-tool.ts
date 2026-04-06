/**
 * Select tool implementation.
 *
 * Handles click-to-select, drag-to-move, and drag-to-resize interactions
 * on the canvas. Uses handle hit testing to determine if a resize handle
 * is under the pointer. Integrates with the snap engine for smart guide
 * alignment during move and resize.
 *
 * State machine:
 *   idle -> pointerdown on handle -> resizing
 *   idle -> pointerdown on node body -> moving
 *   idle -> pointerdown on empty canvas -> deselect
 *   resizing -> pointermove -> update preview via resize-math
 *   resizing -> pointerup -> commit setTransform
 *   resizing -> escape -> cancel, restore original
 *   moving -> pointermove -> update preview with delta
 *   moving -> pointerup -> commit setTransform
 *
 * RF-002: Uses UUID-based addressing via GraphQL mutations.
 *
 * RF-005: Only sends a single setTransform on pointerUp, not on
 * every pointerMove. During drag, updates a local previewTransform that
 * the renderer can query for visual feedback.
 */

import type { ToolStore } from "../store/document-store-types";
import type { Transform } from "../types/document";
import { hitTest } from "../canvas/hit-test";
import {
  hitTestHandle,
  getHandleCursor,
  HandleType,
} from "../canvas/handle-hit-test";
import { computeResize } from "../canvas/resize-math";
import { SnapEngine, type SnapGuide } from "../canvas/snap-engine";
import type { Tool, ToolEvent } from "./tool-manager";

/** Internal state discriminator. */
type SelectState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "moving";
      readonly draggedUuid: string;
      readonly startWorldX: number;
      readonly startWorldY: number;
      readonly originalTransform: Transform;
    }
  | {
      readonly kind: "resizing";
      readonly draggedUuid: string;
      readonly handle: HandleType;
      readonly startWorldX: number;
      readonly startWorldY: number;
      readonly originalTransform: Transform;
    };

/** Preview transform exposed to the renderer during drag. */
export interface PreviewTransform {
  readonly uuid: string;
  readonly transform: Transform;
}

/**
 * Create a select tool that uses the given document store for
 * hit testing, selection, and sending move/resize commands.
 *
 * @param store - The tool store providing node data and command dispatch.
 * @returns A Tool implementation with preview and guide accessors.
 */
export function createSelectTool(store: ToolStore): Tool & {
  getPreviewTransform(): PreviewTransform | null;
  getSnapGuides(): readonly SnapGuide[];
} {
  let state: SelectState = { kind: "idle" };
  let previewTransform: PreviewTransform | null = null;
  let snapGuides: readonly SnapGuide[] = [];
  let hoverHandle: HandleType | null = null;

  const snapEngine = new SnapEngine();

  /** Prepare the snap engine with all nodes except the dragged one. */
  function prepareSnap(excludeUuid: string): void {
    const nodes = Array.from(store.getAllNodes().values());
    const snapNodes = nodes
      .filter((n) => n.visible && !n.locked)
      .map((n) => ({ uuid: n.uuid, transform: n.transform }));
    snapEngine.prepare(
      snapNodes,
      new Set([excludeUuid]),
      store.getViewportZoom(),
    );
  }

  return {
    onPointerDown(event: ToolEvent): void {
      const zoom = store.getViewportZoom();
      const selectedId = store.getSelectedNodeId();

      // If a node is selected, first check if we're clicking a resize handle
      if (selectedId !== null) {
        const selectedNode = store.getAllNodes().get(selectedId);
        if (selectedNode) {
          const handle = hitTestHandle(
            selectedNode.transform,
            event.worldX,
            event.worldY,
            zoom,
          );
          if (handle !== null) {
            state = {
              kind: "resizing",
              draggedUuid: selectedId,
              handle,
              startWorldX: event.worldX,
              startWorldY: event.worldY,
              originalTransform: selectedNode.transform,
            };
            previewTransform = null;
            snapGuides = [];
            prepareSnap(selectedId);
            return;
          }
        }
      }

      // Fall through to node body hit test
      const hit = hitTest(store.getAllNodes(), event.worldX, event.worldY);

      if (hit) {
        store.select(hit.uuid);
        state = {
          kind: "moving",
          draggedUuid: hit.uuid,
          startWorldX: event.worldX,
          startWorldY: event.worldY,
          originalTransform: hit.transform,
        };
        previewTransform = null;
        snapGuides = [];
        prepareSnap(hit.uuid);
      } else {
        store.select(null);
        state = { kind: "idle" };
        previewTransform = null;
        snapGuides = [];
      }
    },

    onPointerMove(event: ToolEvent): void {
      if (state.kind === "idle") {
        // Update hover cursor for handles
        const selectedId = store.getSelectedNodeId();
        if (selectedId !== null) {
          const selectedNode = store.getAllNodes().get(selectedId);
          if (selectedNode) {
            const zoom = store.getViewportZoom();
            hoverHandle = hitTestHandle(
              selectedNode.transform,
              event.worldX,
              event.worldY,
              zoom,
            );
          } else {
            hoverHandle = null;
          }
        } else {
          hoverHandle = null;
        }
        return;
      }

      if (state.kind === "moving") {
        const deltaX = event.worldX - state.startWorldX;
        const deltaY = event.worldY - state.startWorldY;

        const movedTransform: Transform = {
          ...state.originalTransform,
          x: state.originalTransform.x + deltaX,
          y: state.originalTransform.y + deltaY,
        };

        // Apply snapping
        const snapResult = snapEngine.snap(movedTransform);

        previewTransform = {
          uuid: state.draggedUuid,
          transform: snapResult.snappedTransform,
        };
        snapGuides = snapResult.guides;
        return;
      }

      if (state.kind === "resizing") {
        const dx = event.worldX - state.startWorldX;
        const dy = event.worldY - state.startWorldY;

        const resizedTransform = computeResize(
          state.originalTransform,
          state.handle,
          { dx, dy },
          { shift: event.shiftKey, alt: event.altKey },
        );

        // Apply snapping to the resized transform
        const snapResult = snapEngine.snap(resizedTransform);

        previewTransform = {
          uuid: state.draggedUuid,
          transform: snapResult.snappedTransform,
        };
        snapGuides = snapResult.guides;
      }
    },

    onPointerUp(): void {
      if (state.kind !== "idle" && previewTransform !== null) {
        // RF-005: Send a single setTransform mutation with the final transform.
        store.setTransform(state.draggedUuid, previewTransform.transform);
      }
      state = { kind: "idle" };
      previewTransform = null;
      snapGuides = [];
    },

    onKeyDown(key: string): void {
      if (key === "Escape" && state.kind !== "idle") {
        state = { kind: "idle" };
        previewTransform = null;
        snapGuides = [];
      }
    },

    getCursor(): string {
      if (state.kind === "moving") {
        return "grabbing";
      }
      if (state.kind === "resizing") {
        return getHandleCursor(state.handle);
      }
      if (hoverHandle !== null) {
        return getHandleCursor(hoverHandle);
      }
      return "default";
    },

    getPreviewTransform(): PreviewTransform | null {
      return previewTransform;
    },

    getSnapGuides(): readonly SnapGuide[] {
      return snapGuides;
    },
  };
}
