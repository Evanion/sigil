/**
 * Pure helper functions extracted from EnhancedTokenInput (RF-026).
 *
 * These functions have no dependencies on Solid.js reactivity and can be
 * tested independently.
 */

import type { EvalValue, EvalError } from "../../store/expression-eval";

// ── Cursor position helpers ────────────────────────────────────────────

/**
 * Get the cursor offset (character count) within a contentEditable element.
 * Returns the offset from the start of the element's text content.
 */
export function getCursorOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

/**
 * Set the cursor to a specific character offset within a contentEditable element.
 * Walks through text nodes to find the correct position.
 */
export function setCursorOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let node: Text | null = null;
  while (walker.nextNode()) {
    node = walker.currentNode as Text;
    if (currentOffset + node.length >= offset) {
      const range = document.createRange();
      range.setStart(node, offset - currentOffset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    currentOffset += node.length;
  }
  // If offset exceeds content length, place cursor at end
  if (node) {
    const range = document.createRange();
    range.setStart(node, node.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ── Error formatting ───────────────────────────────────────────────────

export function formatEvalError(err: EvalError): string {
  switch (err.type) {
    case "parse":
      return `Parse error: ${err.message}`;
    case "unknownFunction":
      return `Unknown function: ${err.name}`;
    case "arityError":
      return `${err.name}() expects ${String(err.expected)} args, got ${String(err.got)}`;
    case "typeError":
      return `Type error: expected ${err.expected}, got ${err.got}`;
    case "referenceNotFound":
      return `Unknown token: ${err.name}`;
    case "depthExceeded":
      return "Expression too deeply nested";
    case "divisionByZero":
      return "Division by zero";
    case "domainError":
      return `Domain error: ${err.message}`;
  }
}

/**
 * Format an evaluated value for display.
 *
 * RF-004/RF-005/RF-015: sRGB channels are converted to 0-255 integers
 * and displayed as hex (e.g. #336699) which is much more useful for designers
 * than raw float display. All numeric values are guarded with Number.isFinite().
 */
export function formatEvalValue(val: EvalValue): string {
  switch (val.type) {
    case "number": {
      if (!Number.isFinite(val.value)) return "\u2014";
      return String(val.value);
    }
    case "color": {
      const c = val.value;
      switch (c.space) {
        case "srgb": {
          // Guard all channel values with Number.isFinite() before interpolation
          if (
            !Number.isFinite(c.r) ||
            !Number.isFinite(c.g) ||
            !Number.isFinite(c.b) ||
            !Number.isFinite(c.a)
          ) {
            return "\u2014";
          }
          // Convert 0-1 channels to 0-255 integers and display as hex
          const r = Math.round(c.r * 255);
          const g = Math.round(c.g * 255);
          const b = Math.round(c.b * 255);
          const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
          if (c.a < 1) {
            const a = Math.round(c.a * 255);
            return `${hex}${a.toString(16).padStart(2, "0")}`;
          }
          return hex;
        }
        case "display_p3": {
          if (
            !Number.isFinite(c.r) ||
            !Number.isFinite(c.g) ||
            !Number.isFinite(c.b) ||
            !Number.isFinite(c.a)
          ) {
            return "\u2014";
          }
          return `color(display-p3 ${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} / ${c.a.toFixed(2)})`;
        }
        case "oklch": {
          if (
            !Number.isFinite(c.l) ||
            !Number.isFinite(c.c) ||
            !Number.isFinite(c.h) ||
            !Number.isFinite(c.a)
          ) {
            return "\u2014";
          }
          return `oklch(${c.l.toFixed(3)} ${c.c.toFixed(3)} ${c.h.toFixed(1)} / ${c.a.toFixed(2)})`;
        }
        case "oklab": {
          if (
            !Number.isFinite(c.l) ||
            !Number.isFinite(c.a) ||
            !Number.isFinite(c.b) ||
            !Number.isFinite(c.alpha)
          ) {
            return "\u2014";
          }
          return `oklab(${c.l.toFixed(3)} ${c.a.toFixed(3)} ${c.b.toFixed(3)} / ${c.alpha.toFixed(2)})`;
        }
        default: {
          // Exhaustive check: if a new color space is added, this will produce a
          // compile error until handled above.
          const _exhaustive: never = c;
          void _exhaustive;
          return "\u2014";
        }
      }
    }
    case "string":
      return val.value;
    default: {
      // Exhaustive check for EvalValue.type
      const _exhaustive: never = val;
      void _exhaustive;
      return "\u2014";
    }
  }
}

/**
 * Insert plain text at the current selection in a contentEditable element,
 * using the modern DOM manipulation API instead of the deprecated execCommand.
 * (RF-020)
 */
export function insertPlainTextAtCursor(text: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  sel.deleteFromDocument();
  const textNode = document.createTextNode(text);
  sel.getRangeAt(0).insertNode(textNode);
  // Move cursor to end of inserted text
  const range = document.createRange();
  range.setStartAfter(textNode);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}
