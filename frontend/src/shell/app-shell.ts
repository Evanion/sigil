/**
 * App shell — builds the editor layout DOM and wires up interactions.
 *
 * All DOM construction uses document.createElement and textContent.
 * No innerHTML is used anywhere in this module.
 *
 * Layout: 4-column CSS grid (48px toolbar, 240px left panel, 1fr canvas, 280px right panel)
 * with a status bar row at the bottom.
 */

import { tinykeys } from "tinykeys";
import type { DocumentStore } from "../store/document-store";
import type { Viewport } from "../canvas/viewport";
import { createViewport, screenToWorld, zoomAt } from "../canvas/viewport";
import { render } from "../canvas/renderer";
import { createToolManager } from "../tools/tool-manager";
import type { ToolType, Tool } from "../tools/tool-manager";
import { createSelectTool } from "../tools/select-tool";
import type { PreviewTransform } from "../tools/select-tool";
import { createShapeTool } from "../tools/shape-tool";
import type { PreviewRect } from "../tools/shape-tool";

/** Mouse button constants. */
const MIDDLE_BUTTON = 1;

/** Left mouse button constant. */
const LEFT_BUTTON = 0;

/** Human-readable labels for announcing tool changes (RF-013). */
const TOOL_DISPLAY_NAMES: Readonly<Record<ToolType, string>> = {
  select: "Select",
  frame: "Frame",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
};

/** Tool button definitions: key, label, tool type, and aria-label. */
const TOOL_BUTTONS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly toolType: ToolType;
  readonly ariaLabel: string;
}> = [
  { key: "v", label: "V", toolType: "select", ariaLabel: "Select tool (V)" },
  { key: "f", label: "F", toolType: "frame", ariaLabel: "Frame tool (F)" },
  { key: "r", label: "R", toolType: "rectangle", ariaLabel: "Rectangle tool (R)" },
  { key: "o", label: "O", toolType: "ellipse", ariaLabel: "Ellipse tool (O)" },
];

/**
 * Mount the app shell into the given root element.
 *
 * Wires up:
 * - Canvas with ResizeObserver for responsive sizing
 * - Wheel events for pan (scroll) and zoom (ctrl/cmd+scroll)
 * - Middle-click and Space+drag for pan dragging
 * - Tool manager with select, frame, rectangle, and ellipse tools
 * - Keyboard shortcuts: V/F/R/O for tool switching
 * - Ctrl+Z / Ctrl+Shift+Z for undo/redo
 * - Ctrl+0 reset zoom, Ctrl+= zoom in, Ctrl+- zoom out
 * - Zoom percentage display in the status bar
 * - Store subscription for re-render on state change
 * - Connection status indicator in status bar
 * - requestAnimationFrame batching for render calls
 * - RF-011: aria-pressed on tool buttons
 * - RF-012: roving tabindex on toolbar buttons
 * - RF-013: aria-live announcements for tool and selection changes
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

  // Track the previous selection UUID so we can announce changes (RF-013).
  let previousSelectedUuid: string | null = null;

  // ── Tool Manager Setup ────────────────────────────────────────

  const selectTool = createSelectTool(store);

  const frameTool = createShapeTool(
    store,
    () => ({ type: "frame", layout: null }),
    "Frame",
    () => {
      toolManager.setActiveTool("select");
    },
  );

  const rectangleTool = createShapeTool(
    store,
    () => ({ type: "rectangle", corner_radii: [0, 0, 0, 0] }),
    "Rectangle",
    () => {
      toolManager.setActiveTool("select");
    },
  );

  const ellipseTool = createShapeTool(
    store,
    () => ({ type: "ellipse", arc_start: 0, arc_end: 360 }),
    "Ellipse",
    () => {
      toolManager.setActiveTool("select");
    },
  );

  const toolImplementations = new Map<ToolType, Tool>([
    ["select", selectTool],
    ["frame", frameTool],
    ["rectangle", rectangleTool],
    ["ellipse", ellipseTool],
  ]);

  const toolManager = createToolManager(toolImplementations);

  // ── DOM Construction ───────────────────────────────────────────

  // Clear the root
  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  // RF-013: Visually-hidden live region for announcements
  const liveRegion = document.createElement("span");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("role", "log");
  liveRegion.className = "sr-only";
  // Visually hidden but accessible to screen readers
  liveRegion.style.position = "absolute";
  liveRegion.style.width = "1px";
  liveRegion.style.height = "1px";
  liveRegion.style.padding = "0";
  liveRegion.style.margin = "-1px";
  liveRegion.style.overflow = "hidden";
  liveRegion.style.clip = "rect(0, 0, 0, 0)";
  liveRegion.style.whiteSpace = "nowrap";
  liveRegion.style.border = "0";
  root.appendChild(liveRegion);

  /** Announce a message to screen readers via the live region. */
  function announce(message: string): void {
    liveRegion.textContent = message;
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

  // Tool buttons — built via document.createElement (no innerHTML)
  const toolButtonElements: HTMLElement[] = [];

  for (let i = 0; i < TOOL_BUTTONS.length; i++) {
    const def = TOOL_BUTTONS[i];
    const btn = document.createElement("button");
    btn.className = "toolbar__tool-btn";
    btn.textContent = def.label;
    btn.setAttribute("aria-label", def.ariaLabel);
    // RF-011: aria-pressed
    btn.setAttribute("aria-pressed", "false");
    // RF-012: roving tabindex — only the first (default active) button gets tabindex="0"
    btn.setAttribute("tabindex", i === 0 ? "0" : "-1");
    btn.setAttribute("type", "button");
    btn.addEventListener("click", () => {
      toolManager.setActiveTool(def.toolType);
    });
    toolButtonElements.push(btn);
    toolbar.appendChild(btn);
  }

  // RF-012: Roving tabindex — Arrow key navigation within the toolbar
  toolbar.addEventListener("keydown", (e: KeyboardEvent) => {
    const focusableButtons = toolButtonElements;
    const currentIndex = focusableButtons.indexOf(document.activeElement as HTMLElement);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % focusableButtons.length;
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + focusableButtons.length) % focusableButtons.length;
    }

    if (nextIndex !== null) {
      // Update tabindex: old gets -1, new gets 0
      focusableButtons[currentIndex].setAttribute("tabindex", "-1");
      focusableButtons[nextIndex].setAttribute("tabindex", "0");
      focusableButtons[nextIndex].focus();
    }
  });

  /** Update the active highlight, aria-pressed, and roving tabindex on tool buttons. */
  function updateToolButtonHighlight(): void {
    const activeType = toolManager.getActiveTool();
    for (let i = 0; i < TOOL_BUTTONS.length; i++) {
      const def = TOOL_BUTTONS[i];
      const btn = toolButtonElements[i];
      if (def.toolType === activeType) {
        btn.classList.add("toolbar__tool-btn--active");
        // RF-011: aria-pressed
        btn.setAttribute("aria-pressed", "true");
        // RF-012: roving tabindex — active button is focusable
        btn.setAttribute("tabindex", "0");
      } else {
        btn.classList.remove("toolbar__tool-btn--active");
        // RF-011: aria-pressed
        btn.setAttribute("aria-pressed", "false");
        // RF-012: roving tabindex — inactive buttons are not tab-focusable
        btn.setAttribute("tabindex", "-1");
      }
    }
  }

  // Set initial highlight
  updateToolButtonHighlight();

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

  // ── Cursor Update ───────────────────────────────────────────────

  function updateCursor(): void {
    canvasContainer.style.cursor = toolManager.getCursor();
  }

  // Set initial cursor
  updateCursor();

  // Subscribe to tool manager changes for cursor + button highlight updates
  const unsubscribeToolManager = toolManager.subscribe(() => {
    updateCursor();
    updateToolButtonHighlight();
    // RF-013: Announce tool change
    const activeType = toolManager.getActiveTool();
    const displayName = TOOL_DISPLAY_NAMES[activeType];
    announce(`${displayName} tool active`);
    scheduleRender();
  });

  // ── Canvas Context ─────────────────────────────────────────────

  const ctx = canvas.getContext("2d");

  // ── Render Batching ────────────────────────────────────────────

  /**
   * Get the preview rect from the active shape tool, if applicable.
   * Returns null if the active tool is not a shape tool or has no preview.
   */
  function getActiveToolPreviewRect(): PreviewRect | null {
    const activeTool = toolImplementations.get(toolManager.getActiveTool());
    if (activeTool && "getPreviewRect" in activeTool) {
      return (activeTool as Tool & { getPreviewRect(): PreviewRect | null }).getPreviewRect();
    }
    return null;
  }

  /**
   * Get the preview transform from the select tool, if applicable.
   * Returns null if the select tool is not active or has no preview.
   */
  function getSelectToolPreviewTransform(): PreviewTransform | null {
    return selectTool.getPreviewTransform();
  }

  function scheduleRender(): void {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      zoomText.textContent = `${String(Math.round(viewport.zoom * 100))}%`;
      if (ctx) {
        const selectedUuid = store.getSelectedNodeId();
        const nodes = [...store.getAllNodes().values()];

        const previewRect = getActiveToolPreviewRect();
        const previewTransform = getSelectToolPreviewTransform();

        render(
          ctx,
          viewport,
          nodes,
          selectedUuid,
          window.devicePixelRatio || 1,
          previewRect,
          previewTransform,
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

  // ── Pointer Events (Pan + Tool Delegation) ─────────────────────

  function handlePointerDown(e: PointerEvent): void {
    // Delegate left-click to tool manager when not panning
    if (e.button === LEFT_BUTTON && !spaceHeld) {
      const [worldX, worldY] = screenToWorld(viewport, e.offsetX, e.offsetY);
      toolManager.onPointerDown({
        worldX,
        worldY,
        screenX: e.offsetX,
        screenY: e.offsetY,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
      scheduleRender();
    }

    // Pan via middle-click or space+drag
    const isMiddleClick = e.button === MIDDLE_BUTTON;
    const isSpaceDrag = spaceHeld && e.button === LEFT_BUTTON;

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
    if (isPanning) {
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;

      viewport = {
        x: panStartVpX + dx,
        y: panStartVpY + dy,
        zoom: viewport.zoom,
      };

      scheduleRender();
      return;
    }

    // Delegate to tool manager for non-panning move
    const [worldX, worldY] = screenToWorld(viewport, e.offsetX, e.offsetY);
    toolManager.onPointerMove({
      worldX,
      worldY,
      screenX: e.offsetX,
      screenY: e.offsetY,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    });
    scheduleRender();
  }

  function handlePointerUp(e: PointerEvent): void {
    if (isPanning) {
      isPanning = false;
      canvasContainer.classList.remove("canvas-container--panning");
      canvasContainer.releasePointerCapture(e.pointerId);
      return;
    }

    // Delegate to tool manager
    const [worldX, worldY] = screenToWorld(viewport, e.offsetX, e.offsetY);
    toolManager.onPointerUp({
      worldX,
      worldY,
      screenX: e.offsetX,
      screenY: e.offsetY,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    });
    scheduleRender();
  }

  canvasContainer.addEventListener("pointerdown", handlePointerDown);
  canvasContainer.addEventListener("pointermove", handlePointerMove);
  canvasContainer.addEventListener("pointerup", handlePointerUp);

  // ── Keyboard Shortcuts (via tinykeys) ──────────────────────────

  /** Zoom multiplier for keyboard zoom shortcuts. */
  const KEYBOARD_ZOOM_FACTOR = 1.5;

  /** Helper: check if the active element is a text input (skip shortcuts). */
  function isTyping(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  }

  // Space key needs manual tracking for space+drag panning
  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === " " && !e.repeat) {
      spaceHeld = true;
      canvasContainer.classList.add("canvas-container--grab");
      e.preventDefault();
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

  // All other shortcuts via tinykeys
  const unsubscribeKeys = tinykeys(window, {
    // Undo / Redo
    "$mod+z": (e: KeyboardEvent) => {
      e.preventDefault();
      store.undo();
    },
    "$mod+Shift+z": (e: KeyboardEvent) => {
      e.preventDefault();
      store.redo();
    },
    "$mod+y": (e: KeyboardEvent) => {
      e.preventDefault();
      store.redo();
    },

    // Zoom
    "$mod+0": (e: KeyboardEvent) => {
      e.preventDefault();
      viewport = { x: viewport.x, y: viewport.y, zoom: 1 };
      scheduleRender();
    },
    "$mod+=": (e: KeyboardEvent) => {
      e.preventDefault();
      viewport = { ...viewport, zoom: Math.min(10, viewport.zoom * KEYBOARD_ZOOM_FACTOR) };
      scheduleRender();
    },
    "$mod+-": (e: KeyboardEvent) => {
      e.preventDefault();
      viewport = { ...viewport, zoom: Math.max(0.1, viewport.zoom / KEYBOARD_ZOOM_FACTOR) };
      scheduleRender();
    },

    // Tool shortcuts (only when not typing in an input)
    v: () => {
      if (!isTyping()) toolManager.setActiveTool("select");
    },
    f: () => {
      if (!isTyping()) toolManager.setActiveTool("frame");
    },
    r: () => {
      if (!isTyping()) toolManager.setActiveTool("rectangle");
    },
    o: () => {
      if (!isTyping()) toolManager.setActiveTool("ellipse");
    },
  });

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

  // ── Selection Change Announcements (RF-013) ────────────────────

  function announceSelectionChange(): void {
    const currentUuid = store.getSelectedNodeId();
    if (currentUuid === previousSelectedUuid) return;

    if (currentUuid === null) {
      announce("Selection cleared");
    } else {
      const node = store.getNodeByUuid(currentUuid);
      if (node) {
        announce(`${node.name} selected`);
      }
    }
    previousSelectedUuid = currentUuid;
  }

  // ── Store Subscription ─────────────────────────────────────────

  const unsubscribe = store.subscribe(() => {
    updateStatusBar();
    announceSelectionChange();
    scheduleRender();
  });

  // Initial render and status update
  updateStatusBar();
  scheduleRender();
  // RF-013: Announce initial tool
  announce(`${TOOL_DISPLAY_NAMES[toolManager.getActiveTool()]} tool active`);

  // ── Cleanup ────────────────────────────────────────────────────

  return () => {
    unsubscribe();
    unsubscribeToolManager();
    resizeObserver.disconnect();
    canvasContainer.removeEventListener("wheel", handleWheel);
    canvasContainer.removeEventListener("pointerdown", handlePointerDown);
    canvasContainer.removeEventListener("pointermove", handlePointerMove);
    canvasContainer.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("keyup", handleKeyUp);
    unsubscribeKeys();
  };
}
