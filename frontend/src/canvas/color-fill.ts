/**
 * Color → CSS fill string conversion for the canvas renderer.
 *
 * Lives in `canvas/` (not `panels/`) because the renderer must call it.
 * `panels/` is a higher architectural layer than `canvas/` — the panels
 * may import from canvas helpers, but the renderer must not depend on
 * panel modules. A re-export shim in `panels/token-helpers.ts` preserves
 * the historical import path for existing panel consumers.
 *
 * RF-001 (PR #67): Replaces the per-call-site `space === "srgb" ?
 * srgbColorToRgba(color) : DEFAULT_FILL` pattern in the renderer,
 * text overlay, gradient utils, page-thumbnail-draw, and ValueInput
 * swatch. Routes Display-P3 through `color(display-p3 …)` so P3-tagged
 * colors actually render wide-gamut.
 *
 * All channels are guarded with Number.isFinite() per CLAUDE.md §11
 * "Floating-Point Validation" — NaN or Infinity in a CSS color value
 * produces a malformed style string that the browser silently ignores.
 */

import type { Color } from "../types/document";

/**
 * Convert a Color to a CSS color string suitable for direct assignment
 * to a Canvas 2D `fillStyle` or `strokeStyle`.
 *
 *  - sRGB → `rgba(r255, g255, b255, a)` (255-scaled integer channels)
 *  - Display-P3 → `color(display-p3 r g b / a)` (0-1 channels, 4-decimal precision)
 *  - OkLCH / OkLab → fallback gray (`rgba(128, 128, 128, 1)`) — proper CSS
 *    output for these spaces is deferred to a follow-up spec.
 *
 * Returning a deterministic fallback string (rather than null) lets the
 * caller assign the result directly without a `??` chain — matches the
 * `fillStyle = colorToCss(color)` ergonomics expected at every dispatch
 * site.
 */
export function colorToCss(color: Color): string {
  if (color.space === "srgb") {
    const r = Number.isFinite(color.r) ? Math.round(Math.max(0, Math.min(1, color.r)) * 255) : 0;
    const g = Number.isFinite(color.g) ? Math.round(Math.max(0, Math.min(1, color.g)) * 255) : 0;
    const b = Number.isFinite(color.b) ? Math.round(Math.max(0, Math.min(1, color.b)) * 255) : 0;
    const a = Number.isFinite(color.a) ? Math.max(0, Math.min(1, color.a)) : 1;
    return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(a)})`;
  }
  if (color.space === "display_p3") {
    const round4 = (n: number): number => Math.round(n * 10000) / 10000;
    const r = Number.isFinite(color.r) ? round4(color.r) : 0;
    const g = Number.isFinite(color.g) ? round4(color.g) : 0;
    const b = Number.isFinite(color.b) ? round4(color.b) : 0;
    const a = Number.isFinite(color.a) ? Math.max(0, Math.min(1, color.a)) : 1;
    return `color(display-p3 ${String(r)} ${String(g)} ${String(b)} / ${String(a)})`;
  }
  // OkLCH and OkLab: fallback to gray until proper CSS output is wired (out
  // of scope for Spec 18).
  return "rgba(128, 128, 128, 1)";
}
