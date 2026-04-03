/**
 * Solid.js Canvas wrapper component.
 *
 * Manages the HTML5 Canvas element lifecycle, pointer/keyboard events,
 * tool state machine, and viewport pan/zoom. A `createEffect` reads all
 * rendering-relevant signals and calls the imperative `render()` function,
 * guaranteeing the canvas never shows stale state.
 *
 * The existing tools (`createSelectTool`, `createShapeTool`) expect the
 * old `DocumentStore` interface. A lightweight adapter bridges the Solid
 * store signals to that interface.
 */

import { createEffect, createSignal, onMount, onCleanup, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import { render as renderCanvas } from "../canvas/renderer";
import { screenToWorld, zoomAt, type Viewport } from "../canvas/viewport";
import { createToolManager, type ToolEvent, type Tool } from "../tools/tool-manager";
import type { ToolType } from "../store/document-store-solid";
import { createSelectTool, type PreviewTransform } from "../tools/select-tool";
import { createShapeTool, type PreviewRect } from "../tools/shape-tool";
import type { ToolStore } from "../store/document-store-types";
import type { DocumentNode, NodeKind, Transform } from "../types/document";
import { tinykeys } from "tinykeys";
import "./Canvas.css";

/** Wheel zoom sensitivity multiplier — matches the value in viewport.ts. */
const WHEEL_ZOOM_SENSITIVITY = 1;

/**
 * Build a store adapter that satisfies the old `DocumentStore` interface
 * for the subset of methods the tools actually call.
 *
 * Tools call: getAllNodes, select, setTransform, createNode.
 * We cast this to `DocumentStore` because the tools type-check against
 * the full interface, but only use these four methods at runtime.
 */
function createStoreAdapter(store: ReturnType<typeof useDocument>): ToolStore {
  return {
    getAllNodes(): ReadonlyMap<string, DocumentNode> {
      const nodesObj = store.state.nodes;
      const map = new Map<string, DocumentNode>();
      for (const [uuid, node] of Object.entries(nodesObj)) {
        map.set(uuid, node as DocumentNode);
      }
      return map;
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
  };
}

export const Canvas: Component = () => {
  let canvasRef: HTMLCanvasElement | undefined;
  const store = useDocument();
  // canvasRef is assigned via callback ref below — guaranteed defined inside onMount

  // Preview state for tool feedback (signals so the canvas effect re-triggers)
  const [previewTransform, setPreviewTransform] = createSignal<PreviewTransform | null>(null);
  const [previewRect, setPreviewRect] = createSignal<PreviewRect | null>(null);
  const [cursor, setCursor] = createSignal("default");

  // Space key tracking for grab cursor
  const [spaceHeld, setSpaceHeld] = createSignal(false);

  onMount(() => {
    if (!canvasRef) return;
    const canvas = canvasRef;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── Tool setup ───────────────────────────────────────────────────

    const storeAdapter = createStoreAdapter(store);

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

    // ── Pointer events ───────────────────────────────────────────────

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
      setPreviewTransform(selectTool.getPreviewTransform());
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
      setPreviewTransform(selectTool.getPreviewTransform());
      const activeTool = toolImpls.get(store.activeTool());
      if (activeTool && "getPreviewRect" in activeTool) {
        setPreviewRect((activeTool as ReturnType<typeof createShapeTool>).getPreviewRect());
      }
      setCursor(toolManager.getCursor());
    }

    function handlePointerUp(e: PointerEvent): void {
      if (isPanning) {
        isPanning = false;
        setCursor(spaceHeld() ? "grab" : toolManager.getCursor());
        return;
      }

      toolManager.onPointerUp(makeToolEvent(e));
      setPreviewTransform(null);
      setPreviewRect(null);
      setCursor(toolManager.getCursor());
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);

    // ── Viewport: zoom via wheel ─────────────────────────────────────

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

    // ── Keyboard shortcuts ───────────────────────────────────────────

    const isTyping = (): boolean => {
      const el = document.activeElement;
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    };

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

    // ── Resize observer (DPR-aware) ──────────────────────────────────

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = entry.contentRect.width * dpr;
      canvas.height = entry.contentRect.height * dpr;
    });
    observer.observe(canvas);

    // ── THE KEY: createEffect reads ALL signals and triggers render ──

    createEffect(() => {
      // Read every signal that affects rendering so Solid tracks them.
      const nodesObj = store.state.nodes;
      const selected = store.selectedNodeId();
      const vp = store.viewport();
      const preview = previewTransform();
      const prevRect = previewRect();
      const dpr = window.devicePixelRatio || 1;

      // Convert nodes Record to array for the renderer
      const nodesArray: DocumentNode[] = Object.values(nodesObj) as DocumentNode[];

      renderCanvas(ctx, vp, nodesArray, selected, dpr, prevRect, preview);
    });

    // ── Cleanup ──────────────────────────────────────────────────────

    onCleanup(() => {
      observer.disconnect();
      unbindKeys();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
    });
  });

  return (
    <canvas
      ref={(el) => {
        canvasRef = el;
      }}
      class="sigil-canvas-container__canvas"
      role="main"
      aria-label="Design canvas"
      tabindex={0}
      style={{ cursor: cursor() }}
    />
  );
};
