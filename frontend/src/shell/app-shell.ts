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
 * - Middle-click and Space+drag for pan dragging
 * - Ctrl+Z / Ctrl+Shift+Z for undo/redo
 * - Ctrl+0 reset zoom, Ctrl+= zoom in, Ctrl+- zoom out
 * - Zoom percentage display in the status bar
 * - Store subscription for re-render on state change
 * - Connection status indicator in status bar
 * - requestAnimationFrame batching for render calls
 */
export function mountAppShell(root: HTMLElement, store: DocumentStore): () => void {
  // ── State ──────────────────────────────────────────────────────

  let viewport: Viewport = createViewport();
  let renderScheduled = false;
  let isPanning = false;
  let spaceHeld = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartVpX = 0;
  let panStartVpY = 0;

  // ── DOM Construction ───────────────────────────────────────────

  // Clear the root
  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  // Toolbar (RF-001: landmark, RF-002: focusable)
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Tools");
  toolbar.setAttribute("tabindex", "0");

  const logo = document.createElement("div");
  logo.className = "toolbar__logo";
  logo.textContent = "SIGIL";
  toolbar.appendChild(logo);

  // Left panel (RF-001: landmark, RF-002: focusable)
  const leftPanel = document.createElement("div");
  leftPanel.className = "panel panel--left";
  leftPanel.setAttribute("role", "complementary");
  leftPanel.setAttribute("aria-label", "Layers panel");
  leftPanel.setAttribute("tabindex", "0");

  // RF-011: semantic heading element
  const layersHeading = document.createElement("h2");
  layersHeading.className = "panel__heading";
  layersHeading.textContent = "LAYERS";
  leftPanel.appendChild(layersHeading);

  // Canvas container (RF-001: landmark)
  const canvasContainer = document.createElement("div");
  canvasContainer.className = "canvas-container";
  canvasContainer.setAttribute("role", "main");
  canvasContainer.setAttribute("aria-label", "Design canvas");

  // RF-003: canvas aria-label
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "Design canvas");
  canvasContainer.appendChild(canvas);

  // Right panel (RF-001: landmark, RF-002: focusable)
  const rightPanel = document.createElement("div");
  rightPanel.className = "panel panel--right";
  rightPanel.setAttribute("role", "complementary");
  rightPanel.setAttribute("aria-label", "Properties panel");
  rightPanel.setAttribute("tabindex", "0");

  // RF-011: semantic heading element
  const propertiesHeading = document.createElement("h2");
  propertiesHeading.className = "panel__heading";
  propertiesHeading.textContent = "PROPERTIES";
  rightPanel.appendChild(propertiesHeading);

  // Status bar (RF-001: landmark, RF-010: live region)
  const statusBar = document.createElement("div");
  statusBar.className = "status-bar";
  statusBar.setAttribute("role", "status");
  statusBar.setAttribute("aria-label", "Editor status");

  const statusLeft = document.createElement("div");
  statusLeft.className = "status-bar__left";

  // RF-010 / RF-020: decorative indicator hidden from assistive tech
  const connectionIndicator = document.createElement("span");
  connectionIndicator.className = "status-bar__indicator";
  connectionIndicator.setAttribute("aria-hidden", "true");

  const connectionText = document.createElement("span");
  connectionText.textContent = "Disconnected";

  statusLeft.appendChild(connectionIndicator);
  statusLeft.appendChild(connectionText);

  const statusRight = document.createElement("div");
  statusRight.className = "status-bar__right";

  const docInfoText = document.createElement("span");
  docInfoText.textContent = "No document";

  const zoomText = document.createElement("span");
  zoomText.textContent = "100%";

  statusRight.appendChild(docInfoText);
  statusRight.appendChild(zoomText);

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
      zoomText.textContent = `${String(Math.round(viewport.zoom * 100))}%`;
      if (ctx) {
        render(
          ctx,
          viewport,
          [...store.getAllNodes().values()],
          null,
          window.devicePixelRatio || 1,
        );
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

  // ── Pan Dragging (Middle-Click or Space+Drag) ──────────────────

  function handlePointerDown(e: PointerEvent): void {
    const isMiddleClick = e.button === MIDDLE_BUTTON;
    const isSpaceDrag = spaceHeld && e.button === 0;

    if (!isMiddleClick && !isSpaceDrag) return;

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

  /** Zoom multiplier for keyboard zoom shortcuts (Ctrl+= / Ctrl+-). */
  const KEYBOARD_ZOOM_FACTOR = 1.5;

  function handleKeyDown(e: KeyboardEvent): void {
    // Track space for Space+drag panning
    if (e.key === " " && !e.repeat) {
      spaceHeld = true;
      canvasContainer.classList.add("canvas-container--grab");
      e.preventDefault();
      return;
    }

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
    } else if (isCtrlOrMeta && e.key === "0") {
      // Reset zoom to 100%
      e.preventDefault();
      viewport = { x: viewport.x, y: viewport.y, zoom: 1 };
      scheduleRender();
    } else if (isCtrlOrMeta && e.key === "=") {
      // Zoom in
      e.preventDefault();
      viewport = {
        x: viewport.x,
        y: viewport.y,
        zoom: Math.min(10, viewport.zoom * KEYBOARD_ZOOM_FACTOR),
      };
      scheduleRender();
    } else if (isCtrlOrMeta && e.key === "-") {
      // Zoom out
      e.preventDefault();
      viewport = {
        x: viewport.x,
        y: viewport.y,
        zoom: Math.max(0.1, viewport.zoom / KEYBOARD_ZOOM_FACTOR),
      };
      scheduleRender();
    }
  }

  function handleKeyUp(e: KeyboardEvent): void {
    if (e.key === " ") {
      spaceHeld = false;
      canvasContainer.classList.remove("canvas-container--grab");
    }
  }

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

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
      // RF-023: reflect document name in browser tab
      document.title = `${info.name} \u2014 Sigil`;
    } else {
      docInfoText.textContent = "No document";
      document.title = "Sigil";
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
    document.removeEventListener("keyup", handleKeyUp);
  };
}
