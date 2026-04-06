/**
 * Solid.js Canvas wrapper component.
 *
 * Manages the HTML5 Canvas element lifecycle, pointer/keyboard events,
 * tool state machine, and viewport pan/zoom. A `createEffect` reads all
 * rendering-relevant signals and calls the imperative `render()` function,
 * guaranteeing the canvas never shows stale state.
 *
 * The existing tools (`createSelectTool`, `createShapeTool`) expect the
 * `ToolStore` interface. A lightweight adapter bridges the Solid
 * store signals to that interface.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  onCleanup,
  type Component,
} from "solid-js";
import { useDocument } from "../store/document-context";
import { render as renderCanvas } from "../canvas/renderer";
import { screenToWorld, zoomAt, type Viewport } from "../canvas/viewport";
import { createToolManager, type ToolEvent, type Tool } from "../tools/tool-manager";
import type { ToolType } from "../store/document-store-solid";
import { createSelectTool, type PreviewTransform, type MarqueeRect } from "../tools/select-tool";
import type { SnapGuide } from "../canvas/snap-engine";
import { createShapeTool, type PreviewRect } from "../tools/shape-tool";
import type { ToolStore } from "../store/document-store-types";
import type { DocumentNode, NodeKind, Transform } from "../types/document";
import type { AlignEntry } from "../canvas/align-math";
import {
  alignLeft,
  alignCenter,
  alignRight,
  alignTop,
  alignMiddle,
  alignBottom,
} from "../canvas/align-math";
import { useAnnounce } from "./AnnounceProvider";
import { tinykeys } from "tinykeys";
import "./Canvas.css";

/** Wheel zoom sensitivity multiplier -- matches the value in viewport.ts. */
const WHEEL_ZOOM_SENSITIVITY = 1;

/**
 * Build a store adapter that satisfies the `ToolStore` interface.
 *
 * The `getAllNodes` method receives a pre-built memoized Map so it
 * does not allocate a new Map on every call (RF-020).
 */
function createStoreAdapter(
  store: ReturnType<typeof useDocument>,
  nodesMap: () => ReadonlyMap<string, DocumentNode>,
): ToolStore {
  return {
    getAllNodes(): ReadonlyMap<string, DocumentNode> {
      return nodesMap();
    },
    getSelectedNodeId(): string | null {
      return store.selectedNodeId();
    },
    select(uuid: string | null): void {
      store.setSelectedNodeId(uuid);
    },
    setTransform(uuid: string, transform: Transform): void {
      store.setTransform(uuid, transform);
    },
    createNode(kind: NodeKind, name: string, transform: Transform): string {
      return store.createNode(kind, name, transform);
    },
    getViewportZoom(): number {
      return store.viewport().zoom;
    },
    getSelectedNodeIds(): string[] {
      return store.selectedNodeIds();
    },
    setSelectedNodeIds(ids: string[]): void {
      store.setSelectedNodeIds(ids);
    },
    batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void {
      store.batchSetTransform(entries);
    },
  };
}

export const Canvas: Component = () => {
  let canvasRef: HTMLCanvasElement | undefined;
  const store = useDocument();
  const announce = useAnnounce();

  // RF-001: Announce selection changes to screen readers
  createEffect(() => {
    const selectedId = store.selectedNodeId();
    if (selectedId === null) {
      announce("Selection cleared");
      return;
    }
    const node = store.state.nodes[selectedId];
    if (node) {
      announce(`Selected ${node.name}`);
    }
  });

  // Preview state for tool feedback (signals so the canvas effect re-triggers)
  const [previewTransforms, setPreviewTransforms] = createSignal<PreviewTransform[]>([]);
  const [previewRect, setPreviewRect] = createSignal<PreviewRect | null>(null);
  const [snapGuides, setSnapGuides] = createSignal<readonly SnapGuide[]>([]);
  const [marqueeRect, setMarqueeRect] = createSignal<MarqueeRect | null>(null);
  const [cursor, setCursor] = createSignal("default");

  // Space key tracking for grab cursor
  const [spaceHeld, setSpaceHeld] = createSignal(false);

  // RF-013: Track canvas size + DPR as a signal so the render effect re-triggers
  const [canvasSize, setCanvasSize] = createSignal({ w: 0, h: 0, dpr: 1 });

  // RF-020: Memoize the nodes Map so it only recreates when store.state.nodes changes
  const nodesMap = createMemo((): ReadonlyMap<string, DocumentNode> => {
    const nodesObj = store.state.nodes;
    const map = new Map<string, DocumentNode>();
    for (const [uuid, node] of Object.entries(nodesObj)) {
      map.set(uuid, node as DocumentNode);
    }
    return map;
  });

  // RF-020 (a11y): Dynamic aria-label reflecting the selected node(s).
  const canvasAriaLabel = createMemo((): string => {
    const ids = store.selectedNodeIds();
    if (ids.length === 0) return "Design canvas";
    if (ids.length === 1) {
      const node = store.state.nodes[ids[0]];
      if (node) return `Design canvas — ${node.name} selected`;
      return "Design canvas";
    }
    return `Design canvas — ${String(ids.length)} nodes selected`;
  });

  onMount(() => {
    if (!canvasRef) return;
    const canvas = canvasRef;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // -- Tool setup -----------------------------------------------------------

    const storeAdapter = createStoreAdapter(store, nodesMap);

    const selectTool = createSelectTool(storeAdapter);

    const makeShapeTool = (kindFactory: () => NodeKind, prefix: string) =>
      createShapeTool(storeAdapter, kindFactory, prefix, () => store.setActiveTool("select"));

    const frameKind = (): NodeKind => ({ type: "frame" as const, layout: null });
    const rectKind = (): NodeKind => ({
      type: "rectangle" as const,
      corner_radii: [0, 0, 0, 0] as readonly [number, number, number, number],
    });
    const ellipseKind = (): NodeKind => ({
      type: "ellipse" as const,
      arc_start: 0,
      arc_end: Math.PI * 2,
    });

    const frameTool = makeShapeTool(frameKind, "Frame");
    const rectangleTool = makeShapeTool(rectKind, "Rectangle");
    const ellipseTool = makeShapeTool(ellipseKind, "Ellipse");

    const toolImpls = new Map<ToolType, Tool>([
      ["select", selectTool],
      ["frame", frameTool],
      ["rectangle", rectangleTool],
      ["ellipse", ellipseTool],
    ]);

    const toolManager = createToolManager(toolImpls, "select");

    // Sync tool manager with store's active tool signal
    createEffect(() => {
      toolManager.setActiveTool(store.activeTool());
      setCursor(toolManager.getCursor());
    });

    // -- Pointer events -------------------------------------------------------

    function makeToolEvent(e: PointerEvent): ToolEvent {
      const rect = canvas.getBoundingClientRect();
      const vp = store.viewport();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = screenToWorld(vp, sx, sy);
      return {
        worldX: wx,
        worldY: wy,
        screenX: sx,
        screenY: sy,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      };
    }

    // Panning state
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartVp: Viewport = { x: 0, y: 0, zoom: 1 };

    function handlePointerDown(e: PointerEvent): void {
      // Middle-click or space+left-click starts panning
      if (e.button === 1 || (e.button === 0 && spaceHeld())) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartVp = store.viewport();
        canvas.setPointerCapture(e.pointerId);
        setCursor("grabbing");
        return;
      }

      toolManager.onPointerDown(makeToolEvent(e));
      // Update preview from select tool
      setPreviewTransforms(selectTool.getPreviewTransforms());
    }

    function handlePointerMove(e: PointerEvent): void {
      if (isPanning) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        store.setViewport({
          ...panStartVp,
          x: panStartVp.x + dx,
          y: panStartVp.y + dy,
        });
        return;
      }

      toolManager.onPointerMove(makeToolEvent(e));

      // Update preview signals
      setPreviewTransforms(selectTool.getPreviewTransforms());
      setMarqueeRect(selectTool.getMarqueeRect());
      // RF-011: Only query snap guides when the select tool is active.
      if (store.activeTool() === "select") {
        setSnapGuides(selectTool.getSnapGuides());
      }
      const activeTool = toolImpls.get(store.activeTool());
      if (activeTool && "getPreviewRect" in activeTool) {
        setPreviewRect((activeTool as ReturnType<typeof createShapeTool>).getPreviewRect());
      }
      // RF-015: Update cursor after the tool's onPointerMove to reflect hover state changes.
      setCursor(toolManager.getCursor());
    }

    function handlePointerUp(e: PointerEvent): void {
      if (isPanning) {
        isPanning = false;
        setCursor(spaceHeld() ? "grab" : toolManager.getCursor());
        return;
      }

      toolManager.onPointerUp(makeToolEvent(e));
      setPreviewTransforms([]);
      setPreviewRect(null);
      setMarqueeRect(null);
      // RF-003: Clear snap guides when pointer is released.
      setSnapGuides([]);
      setCursor(toolManager.getCursor());
    }

    // RF-024: Reset isPanning when pointer capture is lost (e.g. window blur)
    function handleLostPointerCapture(): void {
      isPanning = false;
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("lostpointercapture", handleLostPointerCapture);

    // -- Viewport: zoom via wheel ---------------------------------------------

    function handleWheel(e: WheelEvent): void {
      e.preventDefault();
      const vp = store.viewport();
      if (e.ctrlKey || e.metaKey) {
        // Zoom at cursor
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        store.setViewport(zoomAt(vp, sx, sy, -e.deltaY * WHEEL_ZOOM_SENSITIVITY));
      } else {
        // Pan via trackpad/scroll
        store.setViewport({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY });
      }
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });

    // -- Keyboard shortcuts ---------------------------------------------------

    const isTyping = (): boolean => {
      const el = document.activeElement;
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    };

    /**
     * Execute an alignment function on the currently selected nodes.
     * Shared helper used by both AlignPanel buttons and keyboard shortcuts.
     */
    function executeAlign(alignFn: (nodes: readonly AlignEntry[]) => readonly AlignEntry[]): void {
      const ids = store.selectedNodeIds();
      if (ids.length < 2) return;
      const entries: AlignEntry[] = [];
      for (const id of ids) {
        const node = store.state.nodes[id];
        if (node?.transform) {
          entries.push({ uuid: id, transform: node.transform });
        }
      }
      if (entries.length < 2) return;
      const result = alignFn(entries);
      store.batchSetTransform(result.map((r) => ({ uuid: r.uuid, transform: r.transform })));
    }

    const unbindKeys = tinykeys(window, {
      "$mod+z": (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          store.undo();
        }
      },
      "$mod+Shift+z": (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          store.redo();
        }
      },
      "$mod+y": (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          store.redo();
        }
      },
      "$mod+0": (e: KeyboardEvent) => {
        e.preventDefault();
        store.setViewport({ x: 0, y: 0, zoom: 1 });
      },
      "$mod+Equal": (e: KeyboardEvent) => {
        e.preventDefault();
        const vp = store.viewport();
        const rect = canvas.getBoundingClientRect();
        store.setViewport(zoomAt(vp, rect.width / 2, rect.height / 2, 200));
      },
      "$mod+Minus": (e: KeyboardEvent) => {
        e.preventDefault();
        const vp = store.viewport();
        const rect = canvas.getBoundingClientRect();
        store.setViewport(zoomAt(vp, rect.width / 2, rect.height / 2, -200));
      },
      Escape: (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          toolManager.onKeyDown("Escape");
          setPreviewTransforms([]);
          setMarqueeRect(null);
          setSnapGuides([]);
          setCursor(toolManager.getCursor());
        }
      },

      // -- Group / Ungroup --
      "$mod+g": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        const ids = store.selectedNodeIds();
        if (ids.length >= 2) {
          store.groupNodes(ids, "Group");
          announce(`Grouped ${String(ids.length)} nodes`);
        }
      },
      "$mod+Shift+g": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        const ids = store.selectedNodeIds();
        const groupUuids = ids.filter((id) => {
          const node = store.state.nodes[id];
          return node?.kind.type === "group";
        });
        if (groupUuids.length > 0) {
          store.ungroupNodes(groupUuids);
          announce("Ungrouped");
        }
      },

      // -- Select all --
      "$mod+a": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        const allIds: string[] = [];
        const nodes = store.state.nodes;
        for (const uuid of Object.keys(nodes)) {
          const node = nodes[uuid];
          if (node && node.visible && !node.locked) {
            allIds.push(uuid);
          }
        }
        store.setSelectedNodeIds(allIds);
        announce(`Selected all (${String(allIds.length)} nodes)`);
      },

      // -- Delete selected --
      Delete: (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        const ids = store.selectedNodeIds();
        if (ids.length === 0) return;
        const count = ids.length;
        for (const uuid of ids) {
          store.deleteNode(uuid);
        }
        store.setSelectedNodeIds([]);
        announce(`Deleted ${String(count)} nodes`);
      },
      Backspace: (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        const ids = store.selectedNodeIds();
        if (ids.length === 0) return;
        const count = ids.length;
        for (const uuid of ids) {
          store.deleteNode(uuid);
        }
        store.setSelectedNodeIds([]);
        announce(`Deleted ${String(count)} nodes`);
      },

      // -- Alignment shortcuts --
      "$mod+Shift+l": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        executeAlign(alignLeft);
        announce("Aligned left");
      },
      "$mod+Shift+c": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        executeAlign(alignCenter);
        announce("Aligned center");
      },
      "$mod+Shift+r": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        executeAlign(alignRight);
        announce("Aligned right");
      },
      "$mod+Shift+t": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        executeAlign(alignTop);
        announce("Aligned top");
      },
      "$mod+Shift+m": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        executeAlign(alignMiddle);
        announce("Aligned middle");
      },
      "$mod+Shift+b": (e: KeyboardEvent) => {
        if (isTyping()) return;
        e.preventDefault();
        executeAlign(alignBottom);
        announce("Aligned bottom");
      },
    });

    // Space key for grab cursor
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code === "Space" && !isTyping()) {
        e.preventDefault();
        setSpaceHeld(true);
        setCursor("grab");
      }
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === "Space") {
        setSpaceHeld(false);
        setCursor(toolManager.getCursor());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // -- Resize observer (DPR-aware) ------------------------------------------

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const dpr = window.devicePixelRatio || 1;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      // RF-013: Update signal so the render effect re-triggers on resize/DPR change
      setCanvasSize({ w, h, dpr });
    });
    observer.observe(canvas);

    // -- THE KEY: createEffect reads ALL signals and triggers render -----------

    createEffect(() => {
      // Read every signal that affects rendering so Solid tracks them.
      const nodesObj = store.state.nodes;
      const selectedIds = store.selectedNodeIds();
      const vp = store.viewport();
      const previews = previewTransforms();
      const prevRect = previewRect();
      // RF-001: Read snap guides and pass them to the renderer as the 8th argument.
      const guides = snapGuides();
      const marquee = marqueeRect();
      // RF-013: Read canvasSize to track resize/DPR changes as a dependency
      const size = canvasSize();
      const dpr = size.dpr;

      // Convert nodes Record to array for the renderer.
      // IMPORTANT: Object.keys() must be called to create a reactive dependency
      // on key additions/deletions in Solid's store. Object.values() alone does
      // not track new keys being added (e.g., optimistic node creation).
      const keys = Object.keys(nodesObj);
      const nodesArray = keys.map((k) => nodesObj[k]).filter((n) => n != null) as DocumentNode[];

      renderCanvas(ctx, vp, nodesArray, selectedIds, dpr, prevRect, previews, guides, marquee);
    });

    // -- Cleanup --------------------------------------------------------------

    onCleanup(() => {
      observer.disconnect();
      unbindKeys();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("lostpointercapture", handleLostPointerCapture);
      canvas.removeEventListener("wheel", handleWheel);
    });
  });

  // TODO(a11y): Add discrete aria-live announcements for resize start/commit/cancel

  return (
    <canvas
      ref={(el) => {
        canvasRef = el;
      }}
      class="sigil-canvas-container__canvas"
      role="application"
      aria-label={canvasAriaLabel()}
      tabindex={0}
      style={{ cursor: cursor() }}
    />
  );
};
