/**
 * Gradient utility functions — pure helpers for gradient stop manipulation,
 * color interpolation, and CSS string generation.
 *
 * All numeric outputs are guarded with Number.isFinite() per CLAUDE.md
 * "Floating-Point Validation". All functions are pure — no side effects.
 */

import type {
  Color,
  ColorSrgb,
  GradientStop,
  Point,
  StyleValue,
  Token,
} from "../../types/document";
import { resolveStyleValueColor } from "../../store/token-store";

// ── Constants ────────────────────────────────────────────────────────

/** Maximum number of gradient stops allowed. */
export const MAX_GRADIENT_STOPS = 32;

/** Minimum number of gradient stops required for a valid gradient. */
export const MIN_GRADIENT_STOPS = 2;

/**
 * Check whether a stop can be added given the current count.
 * Returns false when the count has reached MAX_GRADIENT_STOPS.
 */
export function canAddStop(count: number): boolean {
  return count < MAX_GRADIENT_STOPS;
}

/**
 * Check whether a stop can be removed given the current count.
 * Returns false when the count is at or below MIN_GRADIENT_STOPS.
 */
export function canRemoveStop(count: number): boolean {
  return count > MIN_GRADIENT_STOPS;
}

// ── Stop ID Assignment ──────────────────────────────────────────────

/**
 * Assign stable IDs to gradient stops that are missing them.
 *
 * Returns a new array with UUIDs assigned to any stop missing an `id`.
 * Existing IDs are preserved. This is used to ensure every stop has a
 * stable identity for selection and dispatch (CLAUDE.md: "Do Not Use
 * Positional Index as Item Identity in Dynamic Lists").
 */
export function assignStopIds(stops: readonly GradientStop[]): GradientStop[] {
  return stops.map((stop) => {
    if (stop.id !== undefined && stop.id !== "") {
      return stop;
    }
    return { ...stop, id: crypto.randomUUID() };
  });
}

// ── Color Interpolation ─────────────────────────────────────────────

/**
 * Extract sRGB channels from a StyleValue<Color>, returning a default
 * opaque black for token refs or non-sRGB color spaces.
 */
function resolveToSrgb(color: StyleValue<Color>): ColorSrgb {
  if (color.type === "literal" && color.value.space === "srgb") {
    return color.value;
  }
  // Fallback: opaque black for token refs and non-sRGB spaces
  return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Guard a numeric value, returning 0 if non-finite.
 * Used internally to prevent NaN/Infinity propagation.
 */
function finiteOrZero(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Linearly interpolate between two numbers.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate a color at the given position (0-1) along a gradient
 * defined by sorted stops.
 *
 * - If position is at or before the first stop, returns the first stop's color.
 * - If position is at or after the last stop, returns the last stop's color.
 * - Otherwise, finds the two bounding stops and linearly interpolates each
 *   sRGB channel.
 * - For a single stop, returns that stop's color.
 * - For an empty array, returns opaque black.
 *
 * All inputs are guarded with Number.isFinite().
 */
export function interpolateStopColor(stops: readonly GradientStop[], position: number): Color {
  const fallback: ColorSrgb = { space: "srgb", r: 0, g: 0, b: 0, a: 1 };

  if (stops.length === 0) {
    return fallback;
  }

  const pos = Number.isFinite(position) ? position : 0;

  if (stops.length === 1) {
    return resolveToSrgb(stops[0].color);
  }

  // Guard: if position is at or before the first stop
  const firstPos = finiteOrZero(stops[0].position);
  if (pos <= firstPos) {
    return resolveToSrgb(stops[0].color);
  }

  // Guard: if position is at or after the last stop
  const lastStop = stops[stops.length - 1];
  const lastPos = finiteOrZero(lastStop.position);
  if (pos >= lastPos) {
    return resolveToSrgb(lastStop.color);
  }

  // Find the two bounding stops
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const aPos = finiteOrZero(a.position);
    const bPos = finiteOrZero(b.position);

    if (pos >= aPos && pos <= bPos) {
      const range = bPos - aPos;
      // Avoid division by zero when two stops are at the same position
      const t = range > 0 ? (pos - aPos) / range : 0;

      const cA = resolveToSrgb(a.color);
      const cB = resolveToSrgb(b.color);

      return {
        space: "srgb",
        r: finiteOrZero(lerp(cA.r, cB.r, t)),
        g: finiteOrZero(lerp(cA.g, cB.g, t)),
        b: finiteOrZero(lerp(cA.b, cB.b, t)),
        a: finiteOrZero(lerp(cA.a, cB.a, t)),
      };
    }
  }

  // Should not reach here with valid sorted stops, but guard anyway
  return resolveToSrgb(lastStop.color);
}

// ── CSS String Generation ───────────────────────────────────────────

/**
 * Convert a StyleValue<Color> to a CSS rgba() string.
 *
 * For literal sRGB colors, uses the channel values.
 * For token refs or non-sRGB color spaces, returns a fallback rgba() string.
 *
 * All numeric values are guarded with Number.isFinite() before CSS interpolation
 * per CLAUDE.md "Floating-Point Validation".
 */
export function resolveStopColorCSS(
  color: StyleValue<Color>,
  tokens: Record<string, Token> = {},
): string {
  // Resolve token refs via the token store, falling back to opaque black
  const defaultColor: Color = { space: "srgb" as const, r: 0, g: 0, b: 0, a: 1 };
  const resolved = resolveStyleValueColor(color, tokens, defaultColor);

  if (resolved.space === "srgb") {
    const c = resolved;
    // Guard all channels individually
    const r = Number.isFinite(c.r) ? Math.round(c.r * 255) : 0;
    const g = Number.isFinite(c.g) ? Math.round(c.g * 255) : 0;
    const b = Number.isFinite(c.b) ? Math.round(c.b * 255) : 0;
    const a = Number.isFinite(c.a) ? c.a : 1;
    return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(a)})`;
  }
  // Fallback for non-sRGB spaces
  return "rgba(0, 0, 0, 1)";
}

/**
 * Build CSS color stop strings from gradient stops.
 *
 * Each stop becomes `rgba(r,g,b,a) position%`.
 * All numeric values are guarded with Number.isFinite() before CSS interpolation.
 */
function buildCSSColorStops(stops: readonly GradientStop[]): string[] {
  return stops.map((stop) => {
    const css = resolveStopColorCSS(stop.color);
    const pct = Number.isFinite(stop.position) ? stop.position * 100 : 0;
    return `${css} ${String(pct)}%`;
  });
}

/**
 * Build a CSS linear-gradient() string from gradient stops.
 *
 * Each stop becomes `rgba(r,g,b,a) position%`.
 * All numeric values are guarded with Number.isFinite() before CSS interpolation.
 *
 * @param stops - The gradient stops (should be sorted by position)
 * @param angleDeg - Optional angle in degrees (default: 180, top-to-bottom)
 * @param repeating - When true, produces repeating-linear-gradient()
 */
export function stopsToLinearGradientCSS(
  stops: readonly GradientStop[],
  angleDeg?: number,
  repeating = false,
): string {
  const angle = angleDeg !== undefined && Number.isFinite(angleDeg) ? angleDeg : 180;
  const colorStops = buildCSSColorStops(stops);
  const fn = repeating ? "repeating-linear-gradient" : "linear-gradient";
  return `${fn}(${String(angle)}deg, ${colorStops.join(", ")})`;
}

/**
 * Build a CSS radial-gradient() string from gradient stops.
 *
 * All numeric values are guarded with Number.isFinite() before CSS interpolation.
 *
 * @param stops - The gradient stops (should be sorted by position)
 * @param repeating - When true, produces repeating-radial-gradient()
 */
export function stopsToRadialGradientCSS(
  stops: readonly GradientStop[],
  repeating = false,
): string {
  const colorStops = buildCSSColorStops(stops);
  const fn = repeating ? "repeating-radial-gradient" : "radial-gradient";
  return `${fn}(circle, ${colorStops.join(", ")})`;
}

/**
 * Build a CSS conic-gradient() string from gradient stops.
 *
 * All numeric values are guarded with Number.isFinite() before CSS interpolation.
 *
 * @param stops - The gradient stops (should be sorted by position)
 * @param startAngleDeg - Start angle in degrees (default: 0)
 * @param repeating - When true, produces repeating-conic-gradient()
 */
export function stopsToConicGradientCSS(
  stops: readonly GradientStop[],
  startAngleDeg = 0,
  repeating = false,
): string {
  const angle = Number.isFinite(startAngleDeg) ? startAngleDeg : 0;
  const colorStops = buildCSSColorStops(stops);
  const fn = repeating ? "repeating-conic-gradient" : "conic-gradient";
  return `${fn}(from ${String(angle)}deg, ${colorStops.join(", ")})`;
}

// ── Angle/Point Conversion ──────────────────────────────────────────

/**
 * Compute the angle in degrees from a start point to an end point.
 *
 * Points are normalized (0-1 range). The angle is measured clockwise
 * from the positive Y-axis (top), matching CSS gradient angle convention.
 *
 * Math.atan2 is safe for all finite inputs (domain is all reals).
 * Non-finite inputs are guarded and return 0.
 */
export function angleFromPoints(start: Point, end: Point): number {
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    return 0;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // atan2(dx, -dy) gives clockwise angle from top (positive Y-axis),
  // matching CSS gradient convention where 0deg = to top, 90deg = to right.
  const rad = Math.atan2(dx, -dy);
  const deg = rad * (180 / Math.PI);
  return finiteOrZero(deg);
}

/**
 * Compute start and end points (normalized 0-1, centered at 0.5/0.5)
 * from a CSS gradient angle in degrees.
 *
 * This is the inverse of angleFromPoints. The line passes through the
 * center (0.5, 0.5) with endpoints at the gradient line intersections.
 *
 * Non-finite input returns a default top-to-bottom gradient (start: top-center, end: bottom-center).
 */
export function pointsFromAngle(angleDeg: number): { start: Point; end: Point } {
  const defaultResult = {
    start: { x: 0.5, y: 0 } as Point,
    end: { x: 0.5, y: 1 } as Point,
  };

  if (!Number.isFinite(angleDeg)) {
    return defaultResult;
  }

  const rad = angleDeg * (Math.PI / 180);
  // CSS gradient convention: 0deg = to top, 90deg = to right.
  // The gradient direction vector is (sin(angle), -cos(angle)) in screen coords
  // (Y-down). The start point is center minus half the direction vector,
  // the end point is center plus half the direction vector.
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);

  // Start = center - direction/2, End = center + direction/2
  // In normalized 0-1 space with center at (0.5, 0.5):
  const sx = finiteOrZero(0.5 - dx * 0.5);
  const sy = finiteOrZero(0.5 - dy * 0.5);
  const ex = finiteOrZero(0.5 + dx * 0.5);
  const ey = finiteOrZero(0.5 + dy * 0.5);

  return {
    start: { x: sx, y: sy },
    end: { x: ex, y: ey },
  };
}
