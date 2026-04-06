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
import { hitTestHandle, getHandleCursor, HandleType } from "../canvas/handle-hit-test";
import { computeResize } from "../canvas/resize-math";
import { SnapEngine, type SnapGuide } from "../canvas/snap-engine";
import type { Tool, ToolEvent } from "./tool-manager";

/**
 * Determine which edges are moving for a given resize handle type (RF-002).
 * Used to restrict snap engine to only the edges being dragged.
 */
function getMovingEdges(handle: HandleType): {
  x: readonly ("left" | "right")[];
  y: readonly ("top" | "bottom")[];
} {
  switch (handle) {
    case HandleType.NW:
      return { x: ["left"], y: ["top"] };
    case HandleType.N:
      return { x: [], y: ["top"] };
    case HandleType.NE:
      return { x: ["right"], y: ["top"] };
    case HandleType.E:
      return { x: ["right"], y: [] };
    case HandleType.SE:
      return { x: ["right"], y: ["bottom"] };
    case HandleType.S:
      return { x: [], y: ["bottom"] };
    case HandleType.SW:
      return { x: ["left"], y: ["bottom"] };
    case HandleType.W:
      return { x: ["left"], y: [] };
  }
}

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
  // RF-009: Track last hover-test position to avoid redundant hit tests.
  let lastHoverX = -Infinity;
  let lastHoverY = -Infinity;

  const snapEngine = new SnapEngine();

  /** Prepare the snap engine with all nodes except the dragged one. */
  function prepareSnap(excludeUuid: string): void {
    const nodes = Array.from(store.getAllNodes().values());
    const snapNodes = nodes
      .filter((n) => n.visible && !n.locked)
      .map((n) => ({ uuid: n.uuid, transform: n.transform }));
    snapEngine.prepare(snapNodes, new Set([excludeUuid]), store.getViewportZoom());
  }

  return {
    onPointerDown(event: ToolEvent): void {
      const zoom = store.getViewportZoom();
      const selectedId = store.getSelectedNodeId();

      // If a node is selected, first check if we're clicking a resize handle
      if (selectedId !== null) {
        const selectedNode = store.getAllNodes().get(selectedId);
        // RF-014: Locked nodes cannot be resized.
        if (selectedNode && !selectedNode.locked) {
          const handle = hitTestHandle(selectedNode.transform, event.worldX, event.worldY, zoom);
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
        // RF-010: Clear hover handle when clicking empty canvas.
        hoverHandle = null;
      }
    },

    onPointerMove(event: ToolEvent): void {
      if (state.kind === "idle") {
        // RF-009: Only re-test handles if pointer moved > 1px world-space since last test.
        // TODO(RF-010): full rAF throttle for hover cursor
        const dxHover = event.worldX - lastHoverX;
        const dyHover = event.worldY - lastHoverY;
        if (dxHover * dxHover + dyHover * dyHover > 1) {
          lastHoverX = event.worldX;
          lastHoverY = event.worldY;

          // Update hover cursor for handles
          const selectedId = store.getSelectedNodeId();
          if (selectedId !== null) {
            const selectedNode = store.getAllNodes().get(selectedId);
            if (selectedNode) {
              const zoom = store.getViewportZoom();
              hoverHandle = hitTestHandle(selectedNode.transform, event.worldX, event.worldY, zoom);
            } else {
              hoverHandle = null;
            }
          } else {
            hoverHandle = null;
          }
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

        // RF-002: Only snap the MOVING edges based on the handle type to preserve the anchor invariant.
        const movingEdges = getMovingEdges(state.handle);
        const snapResult = snapEngine.snapEdges(resizedTransform, movingEdges.x, movingEdges.y);

        previewTransform = {
          uuid: state.draggedUuid,
          transform: snapResult.snappedTransform,
        };
        snapGuides = snapResult.guides;
      }
    },

    // RF-030: Accept ToolEvent parameter for interface consistency.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- matches Tool interface signature
    onPointerUp(event: ToolEvent): void {
      // RF-012: Use proper discriminated union narrowing instead of negation check.
      if ((state.kind === "moving" || state.kind === "resizing") && previewTransform !== null) {
        // RF-005: Send a single setTransform mutation with the final transform.
        store.setTransform(state.draggedUuid, previewTransform.transform);
      }
      state = { kind: "idle" };
      previewTransform = null;
      snapGuides = [];
      // RF-010: Clear hover handle to prevent stale cursor after drag ends.
      hoverHandle = null;
    },

    onKeyDown(key: string): void {
      // TODO: Add Alt+Arrow resize nudge for keyboard accessibility (tracking issue needed)
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
