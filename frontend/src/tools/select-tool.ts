/**
 * Select tool implementation.
 *
 * Handles click-to-select, drag-to-move, drag-to-resize, multi-select
 * (Shift/Meta+click toggle), marquee selection, multi-move, and
 * multi-resize interactions on the canvas. Uses handle hit testing to
 * determine if a resize handle is under the pointer. Integrates with the
 * snap engine for smart guide alignment during move and resize.
 *
 * State machine:
 *   idle -> pointerdown on handle -> resizing
 *   idle -> pointerdown on node body -> moving
 *   idle -> pointerdown on empty canvas -> marquee-selecting
 *   idle -> shift/meta+pointerdown on node -> toggle selection (stay idle)
 *   moving -> pointermove -> update preview via delta
 *   moving -> pointerup -> commit setTransform / batchSetTransform
 *   resizing -> pointermove -> update preview via resize-math
 *   resizing -> pointerup -> commit setTransform / batchSetTransform
 *   resizing -> escape -> cancel, restore original
 *   marquee-selecting -> pointermove -> update marquee rect
 *   marquee-selecting -> pointerup -> select intersecting nodes
 *   marquee-selecting -> escape -> cancel, clear marquee
 *
 * RF-002: Uses UUID-based addressing via GraphQL mutations.
 *
 * RF-005: Only sends a single setTransform/batchSetTransform on pointerUp,
 * not on every pointerMove. During drag, updates local previewTransforms
 * that the renderer can query for visual feedback.
 */

import type { ToolStore } from "../store/document-store-types";
import type { Transform } from "../types/document";
import { hitTest, computeAABB } from "../canvas/hit-test";
import { hitTestHandle, getHandleCursor, HandleType } from "../canvas/handle-hit-test";
import { computeResize } from "../canvas/resize-math";
import {
  computeCompoundBounds,
  computeRelativePositions,
  applyProportionalResize,
  rectIntersectsAABB,
} from "../canvas/multi-select";
import type { RelativePosition } from "../canvas/multi-select";
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

/** Marquee selection rectangle in world coordinates. */
export interface MarqueeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Internal state discriminator. */
type SelectState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "moving";
      readonly startWorldX: number;
      readonly startWorldY: number;
      /** Original transforms for all nodes being moved, keyed by uuid. */
      readonly originalTransforms: ReadonlyMap<string, Transform>;
      /** UUIDs of nodes being moved — matches selectedNodeIds at drag start. */
      readonly movingUuids: readonly string[];
    }
  | {
      readonly kind: "resizing";
      readonly handle: HandleType;
      readonly startWorldX: number;
      readonly startWorldY: number;
      /** Original transform for single-node resize. */
      readonly originalTransform: Transform;
      /** UUID of the single selected node (single resize). */
      readonly draggedUuid: string;
      // RF-032: draggedUuid is for cursor tracking only in multi-resize — not used
      // for transform dispatch. In multi-resize, all selected UUIDs are in
      // multiResize.uuids; draggedUuid just identifies the first for cursor style.
      /** Multi-resize state: null for single node. */
      readonly multiResize: {
        readonly originalTransforms: Transform[];
        readonly relativePositions: RelativePosition[];
        readonly compoundBounds: Transform;
        readonly uuids: readonly string[];
      } | null;
    }
  | {
      readonly kind: "marquee-selecting";
      readonly startWorldX: number;
      readonly startWorldY: number;
      readonly shiftKey: boolean;
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
 * @returns A Tool implementation with preview, marquee, and guide accessors.
 */
export function createSelectTool(store: ToolStore): Tool & {
  getPreviewTransforms(): PreviewTransform[];
  getMarqueeRect(): MarqueeRect | null;
  getSnapGuides(): readonly SnapGuide[];
} {
  let state: SelectState = { kind: "idle" };
  let previewTransforms: PreviewTransform[] = [];
  let marqueeRect: MarqueeRect | null = null;
  let snapGuides: readonly SnapGuide[] = [];
  let hoverHandle: HandleType | null = null;
  // RF-009: Track last hover-test position to avoid redundant hit tests.
  let lastHoverX = -Infinity;
  let lastHoverY = -Infinity;

  const snapEngine = new SnapEngine();

  /** Prepare the snap engine with all nodes except the excluded ones. */
  function prepareSnap(excludeUuids: ReadonlySet<string>): void {
    const nodes = Array.from(store.getAllNodes().values());
    const snapNodes = nodes
      .filter((n) => n.visible && !n.locked)
      .map((n) => ({ uuid: n.uuid, transform: n.transform }));
    snapEngine.prepare(snapNodes, excludeUuids, store.getViewportZoom());
  }

  function resetToIdle(): void {
    state = { kind: "idle" };
    previewTransforms = [];
    marqueeRect = null;
    snapGuides = [];
  }

  return {
    onPointerDown(event: ToolEvent): void {
      const zoom = store.getViewportZoom();
      const selectedIds = store.getSelectedNodeIds();
      const selectedId = store.getSelectedNodeId();
      // RF-008: Derive isMultiSelect from visible+unlocked count, not raw selectedIds.length.
      // This ensures resize handles appear when only one actionable node is selected
      // alongside locked/hidden nodes.
      let actionableCount = 0;
      for (const id of selectedIds) {
        const node = store.getAllNodes().get(id);
        if (node && node.visible && !node.locked) actionableCount++;
      }
      const isMultiSelect = actionableCount > 1;
      // RF-001: metaKey is Cmd on Mac but Windows key on Win/Linux.
      // ctrlKey is Ctrl on all platforms. Accept all three for cross-platform toggle.
      const isToggleModifier = event.shiftKey || event.metaKey || event.ctrlKey;

      // If nodes are selected and we have a multi-selection, check compound bounds handles
      if (isMultiSelect) {
        // For multi-select resize: compute compound bounds and check handle hit
        const selectedTransforms: Transform[] = [];
        const selectedUuids: string[] = [];
        for (const id of selectedIds) {
          const node = store.getAllNodes().get(id);
          if (node && node.visible && !node.locked) {
            selectedTransforms.push(node.transform);
            selectedUuids.push(id);
          }
        }

        if (selectedTransforms.length > 1) {
          const compoundBounds = computeCompoundBounds(selectedTransforms);
          const handle = hitTestHandle(compoundBounds, event.worldX, event.worldY, zoom);
          if (handle !== null) {
            const relativePositions = computeRelativePositions(selectedTransforms, compoundBounds);
            state = {
              kind: "resizing",
              handle,
              startWorldX: event.worldX,
              startWorldY: event.worldY,
              originalTransform: compoundBounds,
              draggedUuid: selectedUuids[0], // primary for cursor tracking
              multiResize: {
                originalTransforms: selectedTransforms,
                relativePositions,
                compoundBounds,
                uuids: selectedUuids,
              },
            };
            previewTransforms = [];
            snapGuides = [];
            prepareSnap(new Set(selectedUuids));
            return;
          }
        }
      }

      // If a single node is selected, check for resize handle on that node
      if (selectedId !== null && !isMultiSelect) {
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
              multiResize: null,
            };
            previewTransforms = [];
            snapGuides = [];
            prepareSnap(new Set([selectedId]));
            return;
          }
        }
      }

      // Fall through to node body hit test
      const hit = hitTest(store.getAllNodes(), event.worldX, event.worldY);

      if (hit) {
        if (isToggleModifier) {
          // Toggle this node in/out of selectedNodeIds
          const currentIds = store.getSelectedNodeIds();
          const idx = currentIds.indexOf(hit.uuid);
          if (idx >= 0) {
            // Remove from selection
            const newIds = [...currentIds];
            newIds.splice(idx, 1);
            store.setSelectedNodeIds(newIds);
          } else {
            // Add to selection
            store.setSelectedNodeIds([...currentIds, hit.uuid]);
          }
          // Stay idle — don't enter moving state on toggle
          state = { kind: "idle" };
          previewTransforms = [];
          snapGuides = [];
        } else {
          // Check if the hit node is already in the multi-selection
          const currentIds = store.getSelectedNodeIds();
          const alreadySelected = currentIds.includes(hit.uuid);

          if (alreadySelected && currentIds.length > 1) {
            // Multi-move: keep current selection, enter moving for all selected
            const originalTransforms = new Map<string, Transform>();
            const movingUuids: string[] = [];
            for (const id of currentIds) {
              const node = store.getAllNodes().get(id);
              if (node) {
                originalTransforms.set(id, node.transform);
                movingUuids.push(id);
              }
            }
            state = {
              kind: "moving",
              startWorldX: event.worldX,
              startWorldY: event.worldY,
              originalTransforms,
              movingUuids,
            };
            previewTransforms = [];
            snapGuides = [];
            prepareSnap(new Set(movingUuids));
          } else {
            // RF-014: Use only setSelectedNodeIds — the derived selectedNodeId signal
            // provides backward compatibility automatically.
            store.setSelectedNodeIds([hit.uuid]);
            const originalTransforms = new Map<string, Transform>();
            originalTransforms.set(hit.uuid, hit.transform);
            state = {
              kind: "moving",
              startWorldX: event.worldX,
              startWorldY: event.worldY,
              originalTransforms,
              movingUuids: [hit.uuid],
            };
            previewTransforms = [];
            snapGuides = [];
            prepareSnap(new Set([hit.uuid]));
          }
        }
      } else {
        // Clicked empty space
        if (!isToggleModifier) {
          // RF-014: Use only setSelectedNodeIds — no dual store.select() call.
          store.setSelectedNodeIds([]);
        }
        // Enter marquee-selecting state
        state = {
          kind: "marquee-selecting",
          startWorldX: event.worldX,
          startWorldY: event.worldY,
          shiftKey: isToggleModifier,
        };
        marqueeRect = null;
        previewTransforms = [];
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

      if (state.kind === "marquee-selecting") {
        marqueeRect = {
          x: state.startWorldX,
          y: state.startWorldY,
          width: event.worldX - state.startWorldX,
          height: event.worldY - state.startWorldY,
        };
        return;
      }

      if (state.kind === "moving") {
        const deltaX = event.worldX - state.startWorldX;
        const deltaY = event.worldY - state.startWorldY;

        if (state.movingUuids.length === 1) {
          // Single node move with snapping
          const uuid = state.movingUuids[0];
          const original = state.originalTransforms.get(uuid);
          if (!original) return;

          const movedTransform: Transform = {
            ...original,
            x: original.x + deltaX,
            y: original.y + deltaY,
          };

          const snapResult = snapEngine.snap(movedTransform);

          previewTransforms = [
            {
              uuid,
              transform: snapResult.snappedTransform,
            },
          ];
          snapGuides = snapResult.guides;
        } else {
          // RF-002: Multi-node move — apply same delta to all.
          // Skip nodes with missing original transforms instead of falling back to zero-transform.
          // Capture narrowed state in a const to preserve discriminated union narrowing inside the callback.
          const movingState = state;
          previewTransforms = movingState.movingUuids.flatMap((uuid) => {
            const original = movingState.originalTransforms.get(uuid);
            if (!original) return [];
            return [
              {
                uuid,
                transform: {
                  ...original,
                  x: original.x + deltaX,
                  y: original.y + deltaY,
                },
              },
            ];
          });
          snapGuides = [];
        }
        return;
      }

      if (state.kind === "resizing") {
        const dx = event.worldX - state.startWorldX;
        const dy = event.worldY - state.startWorldY;

        if (state.multiResize !== null) {
          // Multi-resize: resize compound bounds, then apply proportional resize
          // TODO(RF-015): Apply snapEdges to compound bounds for multi-resize snapping.
          const resizedCompound = computeResize(
            state.originalTransform,
            state.handle,
            { dx, dy },
            { shift: event.shiftKey, alt: event.altKey },
          );

          const newTransforms = applyProportionalResize(
            state.multiResize.originalTransforms,
            state.multiResize.relativePositions,
            resizedCompound,
          );

          // RF-009: Guard against undefined newTransforms[i] if arrays are misaligned.
          previewTransforms = state.multiResize.uuids.flatMap((uuid, i) => {
            const transform = newTransforms[i];
            if (!transform) return [];
            return [{ uuid, transform }];
          });
          snapGuides = [];
        } else {
          // Single-node resize
          const resizedTransform = computeResize(
            state.originalTransform,
            state.handle,
            { dx, dy },
            { shift: event.shiftKey, alt: event.altKey },
          );

          // RF-002: Only snap the MOVING edges based on the handle type to preserve the anchor invariant.
          const movingEdges = getMovingEdges(state.handle);
          const snapResult = snapEngine.snapEdges(resizedTransform, movingEdges.x, movingEdges.y);

          previewTransforms = [
            {
              uuid: state.draggedUuid,
              transform: snapResult.snappedTransform,
            },
          ];
          snapGuides = snapResult.guides;
        }
      }
    },

    onPointerUp(event: ToolEvent): void {
      if (state.kind === "marquee-selecting") {
        // Select all visible/unlocked nodes whose AABB intersects the marquee rect
        if (marqueeRect !== null) {
          const matchingUuids: string[] = [];
          const allNodes = store.getAllNodes();

          for (const node of allNodes.values()) {
            if (!node.visible || node.locked) continue;
            const aabb = computeAABB(node.transform);
            if (rectIntersectsAABB(marqueeRect, aabb)) {
              matchingUuids.push(node.uuid);
            }
          }

          // RF-028: Re-read shift from the pointer-up event, not the stored
          // state.shiftKey from pointer-down. The user may have pressed or
          // released Shift between pointer-down and pointer-up.
          const additive = event.shiftKey;

          if (additive) {
            // Additive: union with previous selection
            const previous = store.getSelectedNodeIds();
            const combined = new Set([...previous, ...matchingUuids]);
            store.setSelectedNodeIds(Array.from(combined));
          } else {
            store.setSelectedNodeIds(matchingUuids);
          }
        }

        resetToIdle();
        return;
      }

      if (state.kind === "moving" || state.kind === "resizing") {
        if (previewTransforms.length > 0) {
          if (previewTransforms.length === 1) {
            // Single node: use setTransform for backward compatibility
            store.setTransform(previewTransforms[0].uuid, previewTransforms[0].transform);
          } else {
            // Multi-node: use batchSetTransform
            store.batchSetTransform(
              previewTransforms.map((pt) => ({ uuid: pt.uuid, transform: pt.transform })),
            );
          }
        }
      }

      state = { kind: "idle" };
      previewTransforms = [];
      marqueeRect = null;
      snapGuides = [];
      // RF-010: Clear hover handle to prevent stale cursor after drag ends.
      hoverHandle = null;
    },

    onKeyDown(key: string): void {
      // TODO(a11y): Add Alt+Arrow resize nudge for keyboard accessibility
      // TODO(a11y): Add Arrow key nudge for multi-select move
      if (key === "Escape" && state.kind !== "idle") {
        resetToIdle();
      }
    },

    getCursor(): string {
      if (state.kind === "moving") {
        return "grabbing";
      }
      if (state.kind === "resizing") {
        return getHandleCursor(state.handle);
      }
      if (state.kind === "marquee-selecting") {
        return "crosshair";
      }
      if (hoverHandle !== null) {
        return getHandleCursor(hoverHandle);
      }
      return "default";
    },

    getPreviewTransforms(): PreviewTransform[] {
      return previewTransforms;
    },

    getMarqueeRect(): MarqueeRect | null {
      return marqueeRect;
    },

    getSnapGuides(): readonly SnapGuide[] {
      return snapGuides;
    },
  };
}
