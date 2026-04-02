/**
 * App shell — builds the editor layout DOM and wires up interactions.
 *
 * All DOM construction uses document.createElement and textContent.
 * No innerHTML is used anywhere in this module.
 *
 * Layout: 4-column CSS grid (48px toolbar, 240px left panel, 1fr canvas, 280px right panel)
 * with a status bar row at the bottom.
 */

import type { DocumentStore } from "../store/document-store";
import type { Viewport } from "../canvas/viewport";
import { createViewport, zoomAt } from "../canvas/viewport";
import { render } from "../canvas/renderer";

/** Mouse button constants. */
const MIDDLE_BUTTON = 1;

/**
 * Mount the app shell into the given root element.
 *
 * Wires up:
 * - Canvas with ResizeObserver for responsive sizing
 * - Wheel events for pan (scroll) and zoom (ctrl/cmd+scroll)
 * - Middle-click and shift+click for pan dragging
 * - Ctrl+Z / Ctrl+Shift+Z for undo/redo
 * - Store subscription for re-render on state change
 * - Connection status indicator in status bar
 * - requestAnimationFrame batching for render calls
 */
export function mountAppShell(root: HTMLElement, store: DocumentStore): () => void {
  // ── State ──────────────────────────────────────────────────────

  let viewport: Viewport = createViewport();
  let renderScheduled = false;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartVpX = 0;
  let panStartVpY = 0;

  // ── DOM Construction ───────────────────────────────────────────

  // Clear the root
  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const logo = document.createElement("div");
  logo.className = "toolbar__logo";
  logo.textContent = "SIGIL";
  toolbar.appendChild(logo);

  // Left panel
  const leftPanel = document.createElement("div");
  leftPanel.className = "panel panel--left";

  const layersHeading = document.createElement("div");
  layersHeading.className = "panel__heading";
  layersHeading.textContent = "LAYERS";
  leftPanel.appendChild(layersHeading);

  // Canvas container
  const canvasContainer = document.createElement("div");
  canvasContainer.className = "canvas-container";

  const canvas = document.createElement("canvas");
  canvasContainer.appendChild(canvas);

  // Right panel
  const rightPanel = document.createElement("div");
  rightPanel.className = "panel panel--right";

  const propertiesHeading = document.createElement("div");
  propertiesHeading.className = "panel__heading";
  propertiesHeading.textContent = "PROPERTIES";
  rightPanel.appendChild(propertiesHeading);

  // Status bar
  const statusBar = document.createElement("div");
  statusBar.className = "status-bar";

  const statusLeft = document.createElement("div");
  statusLeft.className = "status-bar__left";

  const connectionIndicator = document.createElement("span");
  connectionIndicator.className = "status-bar__indicator";

  const connectionText = document.createElement("span");
  connectionText.textContent = "Disconnected";

  statusLeft.appendChild(connectionIndicator);
  statusLeft.appendChild(connectionText);

  const statusRight = document.createElement("div");
  statusRight.className = "status-bar__right";

  const docInfoText = document.createElement("span");
  docInfoText.textContent = "No document";

  statusRight.appendChild(docInfoText);

  statusBar.appendChild(statusLeft);
  statusBar.appendChild(statusRight);

  // Append all to root
  root.appendChild(toolbar);
  root.appendChild(leftPanel);
  root.appendChild(canvasContainer);
  root.appendChild(rightPanel);
  root.appendChild(statusBar);

  // ── Canvas Context ─────────────────────────────────────────────

  const ctx = canvas.getContext("2d");

  // ── Render Batching ────────────────────────────────────────────

  function scheduleRender(): void {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (ctx) {
        render(ctx, viewport, [...store.getAllNodes().values()], null);
      }
    });
  }

  // ── Canvas Sizing ──────────────────────────────────────────────

  function resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvasContainer.getBoundingClientRect();
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${String(rect.width)}px`;
      canvas.style.height = `${String(rect.height)}px`;

      if (ctx) {
        ctx.scale(dpr, dpr);
      }

      scheduleRender();
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
  });
  resizeObserver.observe(canvasContainer);

  // ── Wheel Events (Pan & Zoom) ──────────────────────────────────

  function handleWheel(e: WheelEvent): void {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom at cursor position; negate deltaY so scroll-up zooms in
      viewport = zoomAt(viewport, e.offsetX, e.offsetY, -e.deltaY);
    } else {
      // Pan
      viewport = {
        x: viewport.x - e.deltaX,
        y: viewport.y - e.deltaY,
        zoom: viewport.zoom,
      };
    }

    scheduleRender();
  }

  canvasContainer.addEventListener("wheel", handleWheel, { passive: false });

  // ── Pan Dragging (Middle-Click or Shift+Click) ─────────────────

  function handlePointerDown(e: PointerEvent): void {
    const isMiddleClick = e.button === MIDDLE_BUTTON;
    const isShiftClick = e.shiftKey && e.button === 0;

    if (!isMiddleClick && !isShiftClick) return;

    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartVpX = viewport.x;
    panStartVpY = viewport.y;

    canvasContainer.classList.add("canvas-container--panning");
    canvasContainer.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!isPanning) return;

    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;

    viewport = {
      x: panStartVpX + dx,
      y: panStartVpY + dy,
      zoom: viewport.zoom,
    };

    scheduleRender();
  }

  function handlePointerUp(e: PointerEvent): void {
    if (!isPanning) return;

    isPanning = false;
    canvasContainer.classList.remove("canvas-container--panning");
    canvasContainer.releasePointerCapture(e.pointerId);
  }

  canvasContainer.addEventListener("pointerdown", handlePointerDown);
  canvasContainer.addEventListener("pointermove", handlePointerMove);
  canvasContainer.addEventListener("pointerup", handlePointerUp);

  // ── Keyboard Shortcuts ─────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent): void {
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;

    if (isCtrlOrMeta && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if (isCtrlOrMeta && e.key === "z" && e.shiftKey) {
      e.preventDefault();
      store.redo();
    } else if (isCtrlOrMeta && e.key === "y") {
      // Windows-style redo
      e.preventDefault();
      store.redo();
    }
  }

  document.addEventListener("keydown", handleKeyDown);

  // ── Status Bar Updates ─────────────────────────────────────────

  function updateStatusBar(): void {
    const connected = store.isConnected();

    if (connected) {
      connectionIndicator.className = "status-bar__indicator status-bar__indicator--connected";
      connectionText.textContent = "Connected";
    } else {
      connectionIndicator.className = "status-bar__indicator status-bar__indicator--disconnected";
      connectionText.textContent = "Disconnected";
    }

    const info = store.getInfo();
    if (info) {
      docInfoText.textContent = `${info.name} \u2014 ${String(info.node_count)} nodes, ${String(info.page_count)} pages`;
    } else {
      docInfoText.textContent = "No document";
    }
  }

  // ── Store Subscription ─────────────────────────────────────────

  const unsubscribe = store.subscribe(() => {
    updateStatusBar();
    scheduleRender();
  });

  // Initial render and status update
  updateStatusBar();
  scheduleRender();

  // ── Cleanup ────────────────────────────────────────────────────

  return () => {
    unsubscribe();
    resizeObserver.disconnect();
    canvasContainer.removeEventListener("wheel", handleWheel);
    canvasContainer.removeEventListener("pointerdown", handlePointerDown);
    canvasContainer.removeEventListener("pointermove", handlePointerMove);
    canvasContainer.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("keydown", handleKeyDown);
  };
}
