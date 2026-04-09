/**
 * Text editing overlay — a contenteditable div positioned over the canvas
 * to provide native text editing (cursor, selection, IME input).
 *
 * The overlay is positioned in screen-space coordinates computed from
 * the node's world-space transform and the current viewport.
 *
 * All numeric values interpolated into CSS are guarded with Number.isFinite()
 * per CLAUDE.md "Floating-Point Validation".
 */

import type { DocumentNode, NodeKindText, Color, StyleValue } from "../types/document";
import type { Viewport } from "./viewport";
// RF-031: Import shared constant instead of duplicating.
import { DEFAULT_FONT_SIZE_PX } from "./text-measure";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default line height multiplier when not available. */
const DEFAULT_LINE_HEIGHT = 1.5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TextOverlayHandle {
  /** The overlay DOM element. */
  readonly element: HTMLDivElement;
  /** Update position when viewport changes. */
  updatePosition(viewport: Viewport): void;
  /** Get current text content from overlay. */
  getContent(): string;
  /** Destroy the overlay and clean up all event listeners. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a StyleValue<number> to its literal value or a fallback.
 * Token refs cannot be resolved at this layer.
 */
function resolveNumeric(sv: StyleValue<number>, fallback: number): number {
  if (sv.type === "literal") {
    const v = sv.value;
    return Number.isFinite(v) ? v : fallback;
  }
  return fallback;
}

/**
 * Resolve a StyleValue<Color> to a CSS rgba() string.
 * Only srgb colors are fully resolved; other color spaces fall back to black.
 */
function resolveColorToCss(sv: StyleValue<Color>): string {
  if (sv.type !== "literal") {
    return "rgba(0, 0, 0, 1)";
  }
  const c = sv.value;
  if (c.space === "srgb") {
    const r = Number.isFinite(c.r) ? Math.round(c.r * 255) : 0;
    const g = Number.isFinite(c.g) ? Math.round(c.g * 255) : 0;
    const b = Number.isFinite(c.b) ? Math.round(c.b * 255) : 0;
    const a = Number.isFinite(c.a) ? c.a : 1;
    return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(a)})`;
  }
  // Non-srgb spaces: fall back to black. Full color space support is deferred.
  return "rgba(0, 0, 0, 1)";
}

/**
 * Map the internal TextDecoration enum to CSS text-decoration-line value.
 */
function mapTextDecoration(dec: string): string {
  switch (dec) {
    case "underline":
      return "underline";
    case "strikethrough":
      return "line-through";
    default:
      return "none";
  }
}

/**
 * Safely produce a finite number or return the fallback.
 */
function safeFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Compute the screen-space position and dimensions for the overlay.
 *
 * Viewport formula:
 *   screenX = worldX * zoom + offsetX
 *   screenY = worldY * zoom + offsetY
 *   screenWidth = worldWidth * zoom
 *   screenHeight = worldHeight * zoom
 */
function computeScreenRect(
  nodeX: number,
  nodeY: number,
  nodeWidth: number,
  nodeHeight: number,
  viewport: Viewport,
): { left: number; top: number; width: number; height: number } {
  const zoom = safeFinite(viewport.zoom, 1);
  const vpX = safeFinite(viewport.x, 0);
  const vpY = safeFinite(viewport.y, 0);
  const wx = safeFinite(nodeX, 0);
  const wy = safeFinite(nodeY, 0);
  const ww = safeFinite(nodeWidth, 0);
  const wh = safeFinite(nodeHeight, 0);

  return {
    left: wx * zoom + vpX,
    top: wy * zoom + vpY,
    width: ww * zoom,
    height: wh * zoom,
  };
}

/**
 * Apply CSS position styles to the overlay element.
 */
function applyPositionStyles(
  el: HTMLDivElement,
  rect: { left: number; top: number; width: number; height: number },
  fontSize: number,
  lineHeight: number,
  letterSpacing: number,
  zoom: number,
): void {
  const safeZoom = safeFinite(zoom, 1);
  const safeFontSize = safeFinite(fontSize, DEFAULT_FONT_SIZE_PX);
  const safeLineH = safeFinite(lineHeight, safeFontSize * DEFAULT_LINE_HEIGHT);
  const safeLetterSpacing = safeFinite(letterSpacing, 0);

  el.style.left = `${String(rect.left)}px`;
  el.style.top = `${String(rect.top)}px`;
  el.style.width = `${String(rect.width)}px`;
  el.style.minHeight = `${String(rect.height)}px`;
  el.style.fontSize = `${String(safeFontSize * safeZoom)}px`;
  el.style.lineHeight = `${String(safeLineH * safeZoom)}px`;
  el.style.letterSpacing = `${String(safeLetterSpacing * safeZoom)}px`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a text editing overlay positioned over a text node on the canvas.
 *
 * The overlay is a contenteditable div styled to match the node's TextStyle.
 * It is appended to the canvas element's parent (which must have
 * `position: relative`).
 *
 * Event listeners registered on the element are tracked and removed in
 * destroy() per CLAUDE.md "Module-Level Timers and Subscriptions Must Be
 * Cleared on Teardown".
 */
export function createTextOverlay(
  node: DocumentNode,
  viewport: Viewport,
  canvasElement: HTMLCanvasElement,
): TextOverlayHandle {
  const kind = node.kind as NodeKindText;
  const textStyle = kind.text_style;

  // -- Create element -------------------------------------------------------

  const el = document.createElement("div");
  el.contentEditable = "true";
  el.spellcheck = false;

  // Accessibility
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", "true");
  el.setAttribute("aria-label", "Edit text");

  // -- Apply text styling ---------------------------------------------------

  const fontSize = resolveNumeric(textStyle.font_size, DEFAULT_FONT_SIZE_PX);
  const lineHeightMultiplier = resolveNumeric(textStyle.line_height, DEFAULT_LINE_HEIGHT);
  const lineHeight = fontSize * lineHeightMultiplier;
  const letterSpacing = resolveNumeric(textStyle.letter_spacing, 0);

  el.style.fontFamily = textStyle.font_family;
  el.style.fontWeight = String(textStyle.font_weight);
  el.style.fontStyle = textStyle.font_style;
  el.style.textAlign = textStyle.text_align;
  el.style.textDecoration = mapTextDecoration(textStyle.text_decoration);
  el.style.color = resolveColorToCss(textStyle.text_color);

  // -- Layout styles --------------------------------------------------------

  el.style.position = "absolute";
  el.style.boxSizing = "border-box";
  el.style.margin = "0";
  el.style.padding = "0";
  el.style.border = "none";
  // RF-025: Do not suppress outline — use a CSS class for :focus-visible styling.
  el.style.background = "transparent";
  el.classList.add("sigil-text-overlay");
  el.style.overflow = "visible";
  el.style.whiteSpace = kind.sizing === "fixed_width" ? "pre-wrap" : "pre";
  el.style.wordBreak = kind.sizing === "fixed_width" ? "break-word" : "normal";
  el.style.zIndex = "var(--z-text-overlay, 5)";
  // Transform origin for potential rotation support in the future
  el.style.transformOrigin = "0 0";

  // -- Position -------------------------------------------------------------

  const screenRect = computeScreenRect(
    node.transform.x,
    node.transform.y,
    node.transform.width,
    node.transform.height,
    viewport,
  );

  applyPositionStyles(
    el,
    screenRect,
    fontSize,
    lineHeight,
    letterSpacing,
    safeFinite(viewport.zoom, 1),
  );

  // -- Content --------------------------------------------------------------

  if (kind.content) {
    el.textContent = kind.content;
  }

  // -- Mount ----------------------------------------------------------------

  const parent = canvasElement.parentElement;
  if (parent) {
    parent.appendChild(el);
  }

  // Focus the overlay so the user can start typing immediately.
  // Use requestAnimationFrame to ensure the element is in the DOM first.
  // RF-028: Store the rAF id so it can be cancelled in destroy().
  let focusRafId = requestAnimationFrame(() => {
    focusRafId = 0;
    el.focus();
    // Place cursor at end of content
    const selection = window.getSelection();
    if (selection && el.childNodes.length > 0) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false); // collapse to end
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  // -- Event listener tracking for cleanup ----------------------------------

  const listeners: Array<{
    target: EventTarget;
    type: string;
    handler: EventListener;
  }> = [];

  function addTrackedListener(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    listeners.push({ target, type, handler });
  }

  // Prevent wheel events on the overlay from reaching the canvas
  // (avoids accidental zoom while editing text)
  addTrackedListener(el, "wheel", (e: Event) => {
    e.stopPropagation();
  });

  // Prevent pointer events from reaching the canvas
  addTrackedListener(el, "pointerdown", (e: Event) => {
    e.stopPropagation();
  });

  // -- Build handle ---------------------------------------------------------

  const handle: TextOverlayHandle = {
    element: el,

    updatePosition(vp: Viewport): void {
      const rect = computeScreenRect(
        node.transform.x,
        node.transform.y,
        node.transform.width,
        node.transform.height,
        vp,
      );
      applyPositionStyles(el, rect, fontSize, lineHeight, letterSpacing, safeFinite(vp.zoom, 1));
    },

    getContent(): string {
      return el.textContent ?? "";
    },

    destroy(): void {
      // RF-028: Cancel pending focus rAF if overlay is destroyed before it fires.
      if (focusRafId !== 0) {
        cancelAnimationFrame(focusRafId);
        focusRafId = 0;
      }

      // Remove all tracked event listeners
      for (const { target, type, handler } of listeners) {
        target.removeEventListener(type, handler);
      }
      listeners.length = 0;

      // Remove from DOM
      if (el.parentElement) {
        el.parentElement.removeChild(el);
      }
    },
  };

  return handle;
}
