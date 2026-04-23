/**
 * Canvas 2D renderer for the design document.
 *
 * Draws visible nodes onto an HTML5 Canvas with viewport transform applied.
 * Supports frame, rectangle, ellipse, text, and group node kinds.
 *
 * RF-002: Selection is identified by UUID (string), not NodeId.
 * RF-005: Accepts an optional preview transform to render drag feedback.
 * RF-006: Accepts ReadonlySet<string> for selectedUuids (caller memoizes).
 */

import type {
  ColorSrgb,
  ConicGradientDef,
  DocumentNode,
  Fill,
  GradientDef,
  Token,
  Transform,
} from "../types/document";
import { resolveStyleValueColor, resolveStyleValueNumber } from "../store/token-store";
import type { PreviewRect } from "../tools/shape-tool";
import type { PreviewTransform } from "../tools/select-tool";
import type { MarqueeRect } from "../tools/select-tool";
import type { Viewport } from "./viewport";
import type { SnapGuide } from "./snap-engine";
import { computeCompoundBounds } from "./multi-select";
import { buildFontString, measureTextLines, DEFAULT_FONT_SIZE_PX } from "./text-measure";
import { resolveStopColorCSS } from "../components/gradient-editor/gradient-utils";

/** Default fill color for nodes without explicit fills. */
const DEFAULT_FILL = "#e0e0e0";

/**
 * RF-024: Clamp a resolved opacity value to the rendering-safe range [0, 1].
 *
 * Literal opacity values are validated at the frontend store + Rust boundaries
 * (see `validate_opacity` in crates/core/src/validate.rs). Token refs and
 * expressions, by contrast, defer type-checking to evaluation time — an
 * expression like `2 * {spacing.md}` might resolve to a value outside [0, 1],
 * and the evaluator is not opacity-aware. This helper performs the final
 * rendering-boundary clamp so an out-of-range evaluated result produces
 * visually-sensible output (fully transparent or fully opaque) rather than
 * an ignored `globalAlpha` assignment.
 *
 * Kept at the opacity-specific call site (NOT inside `resolveStyleValueNumber`,
 * which is generic for all number fields — see Spec 13c §5 Consistency
 * Guarantees). A non-finite input also returns 1 (fully opaque) so the
 * rendered artifact is visible for debugging.
 */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Selection highlight color. */
const SELECTION_COLOR = "#0d99ff";

/** Selection highlight line width in screen pixels. */
const SELECTION_LINE_WIDTH = 2;

/** Name label font size in screen pixels. */
const LABEL_FONT_SIZE = 10;

/** Selection handle size in screen pixels. */
const HANDLE_SIZE = 6;

/** Name label color. */
const LABEL_COLOR = "#999999";

/** Preview rect stroke color. */
const PREVIEW_COLOR = "#0d99ff";

/** Preview rect dash pattern in screen pixels. */
const PREVIEW_DASH = [4, 4];

/**
 * Convert an sRGB color to a CSS rgba() string.
 *
 * All channel values are guarded with Number.isFinite() per CLAUDE.md
 * "Floating-Point Validation" — NaN or Infinity in CSS rgba() produces a
 * malformed style string that the browser silently ignores.
 *
 * Returns null when any channel is non-finite so callers can fall back.
 */
function srgbColorToRgba(c: ColorSrgb): string | null {
  if (
    !Number.isFinite(c.r) ||
    !Number.isFinite(c.g) ||
    !Number.isFinite(c.b) ||
    !Number.isFinite(c.a)
  ) {
    return null;
  }
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(c.a)})`;
}

/**
 * Add color stops from a GradientDef to a CanvasGradient.
 *
 * Skips stops with non-finite positions per CLAUDE.md "Floating-Point Validation".
 * Stop positions are clamped to [0, 1] since Canvas gradient stops require this range.
 * This is an explicit user-facing affordance (Canvas API constraint), not silent clamping.
 */
function addGradientStops(
  grad: CanvasGradient,
  gradient: GradientDef | ConicGradientDef,
  tokens: Record<string, Token>,
): void {
  for (const stop of gradient.stops) {
    if (!Number.isFinite(stop.position)) {
      continue;
    }
    const pos = Math.max(0, Math.min(1, stop.position));
    grad.addColorStop(pos, resolveStopColorCSS(stop.color, tokens));
  }
}

/**
 * Create a Canvas linear gradient from a GradientDef.
 *
 * gradient.start and gradient.end are normalized 0-1 within the node's bounds.
 * All coordinates are guarded with Number.isFinite() per CLAUDE.md.
 *
 * NOTE: The spec's pseudocode uses an angle-based approach (degrees from top),
 * but the implementation uses start/end points directly. Points are more general
 * than angles — they support non-centered and non-symmetric gradients. The angle
 * is a derived value computed from the points in the UI (angleFromPoints in
 * gradient-utils.ts). Both representations are equivalent for centered gradients;
 * points are the canonical representation stored in GradientDef.
 */
function createLinearGradientFill(
  ctx: CanvasRenderingContext2D,
  gradient: GradientDef,
  x: number,
  y: number,
  width: number,
  height: number,
  tokens: Record<string, Token>,
): CanvasGradient {
  const sx = Number.isFinite(gradient.start.x) ? x + gradient.start.x * width : x;
  const sy = Number.isFinite(gradient.start.y) ? y + gradient.start.y * height : y;
  const ex = Number.isFinite(gradient.end.x) ? x + gradient.end.x * width : x + width;
  const ey = Number.isFinite(gradient.end.y) ? y + gradient.end.y * height : y + height;
  const grad = ctx.createLinearGradient(sx, sy, ex, ey);
  addGradientStops(grad, gradient, tokens);
  return grad;
}

/**
 * Create a Canvas radial gradient from a GradientDef.
 *
 * The center is at gradient.start (normalized 0-1). The outer radius is
 * computed as the distance from start to end in node-local coordinates.
 * A minimum radius of 0.001 prevents a degenerate gradient.
 *
 * Math.sqrt domain guard: the argument is always >= 0 (sum of squares),
 * so no NaN can be produced. Math.max ensures a non-zero positive result.
 */
function createRadialGradientFill(
  ctx: CanvasRenderingContext2D,
  gradient: GradientDef,
  x: number,
  y: number,
  width: number,
  height: number,
  tokens: Record<string, Token>,
): CanvasGradient {
  const cx = Number.isFinite(gradient.start.x) ? x + gradient.start.x * width : x + width / 2;
  const cy = Number.isFinite(gradient.start.y) ? y + gradient.start.y * height : y + height / 2;
  const endX = Number.isFinite(gradient.end.x) ? gradient.end.x : 1;
  const endY = Number.isFinite(gradient.end.y) ? gradient.end.y : 0.5;
  const startX = Number.isFinite(gradient.start.x) ? gradient.start.x : 0.5;
  const startY = Number.isFinite(gradient.start.y) ? gradient.start.y : 0.5;
  const dx = (endX - startX) * width;
  const dy = (endY - startY) * height;
  // dx*dx + dy*dy is always >= 0, so Math.sqrt is safe here
  const r = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  addGradientStops(grad, gradient, tokens);
  return grad;
}

/**
 * Create a Canvas conic gradient from a ConicGradientDef.
 *
 * gradient.center is normalized 0-1 within the node's bounds.
 * gradient.start_angle is in degrees; Canvas API expects radians.
 * All coordinates are guarded with Number.isFinite() per CLAUDE.md.
 */
function createConicGradientFill(
  ctx: CanvasRenderingContext2D,
  gradient: ConicGradientDef,
  x: number,
  y: number,
  width: number,
  height: number,
  tokens: Record<string, Token>,
): CanvasGradient {
  const cx = Number.isFinite(gradient.center.x) ? x + gradient.center.x * width : x + width / 2;
  const cy = Number.isFinite(gradient.center.y) ? y + gradient.center.y * height : y + height / 2;
  // Convert degrees to radians for the Canvas API.
  // Math.PI / 180 is a constant multiplication — no domain guard needed.
  const angle = Number.isFinite(gradient.start_angle) ? (gradient.start_angle * Math.PI) / 180 : 0;
  const grad = ctx.createConicGradient(angle, cx, cy);
  addGradientStops(grad, gradient, tokens);
  return grad;
}

/**
 * Resolve a fill to a Canvas fillStyle value.
 *
 * Returns a CSS color string for solid fills, a CanvasGradient for gradient
 * fills, or null for unsupported fill types (image fills are deferred).
 */
function resolveFillStyle(
  ctx: CanvasRenderingContext2D,
  fill: Fill,
  x: number,
  y: number,
  width: number,
  height: number,
  tokens: Record<string, Token>,
): string | CanvasGradient | null {
  switch (fill.type) {
    case "solid": {
      // Resolve token refs via the token store, falling back to DEFAULT_FILL
      const defaultColor = { space: "srgb" as const, r: 0.878, g: 0.878, b: 0.878, a: 1 };
      const resolved = resolveStyleValueColor(fill.color, tokens, defaultColor);
      if (resolved.space === "srgb") {
        return srgbColorToRgba(resolved) ?? DEFAULT_FILL;
      }
      return DEFAULT_FILL;
    }
    case "linear_gradient":
      return createLinearGradientFill(ctx, fill.gradient, x, y, width, height, tokens);
    case "radial_gradient":
      return createRadialGradientFill(ctx, fill.gradient, x, y, width, height, tokens);
    case "conic_gradient":
      return createConicGradientFill(ctx, fill.gradient, x, y, width, height, tokens);
    case "image":
      // Image fills are deferred to a later plan.
      return null;
  }
}

/**
 * RF-005: Get the effective transform for a node, using a Map for O(1) lookup
 * instead of a linear scan over the previewTransforms array.
 */
function getEffectiveTransform(
  node: DocumentNode,
  previewMap: ReadonlyMap<string, Transform>,
): Transform {
  return previewMap.get(node.uuid) ?? node.transform;
}

/**
 * Draw a single node onto the canvas context.
 *
 * Assumes the viewport transform is already applied to the context.
 */
function drawNode(
  ctx: CanvasRenderingContext2D,
  node: DocumentNode,
  transform: Transform,
  tokens: Record<string, Token>,
): void {
  const { x, y, width, height } = transform;

  switch (node.kind.type) {
    case "frame":
    case "rectangle":
    case "group":
    case "image":
    case "component_instance": {
      if (node.style.fills.length === 0) {
        // No fills — draw with default fill color for visibility
        ctx.fillStyle = DEFAULT_FILL;
        ctx.fillRect(x, y, width, height);
      } else {
        // Draw the shape once per fill (bottom-to-top = array order)
        for (const fill of node.style.fills) {
          const fillStyle = resolveFillStyle(ctx, fill, x, y, width, height, tokens);
          if (fillStyle !== null) {
            ctx.fillStyle = fillStyle;
            ctx.fillRect(x, y, width, height);
          }
        }
      }
      break;
    }
    case "ellipse": {
      if (node.style.fills.length === 0) {
        ctx.fillStyle = DEFAULT_FILL;
        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (const fill of node.style.fills) {
          const fillStyle = resolveFillStyle(ctx, fill, x, y, width, height, tokens);
          if (fillStyle !== null) {
            ctx.fillStyle = fillStyle;
            ctx.beginPath();
            ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      break;
    }
    case "text": {
      const ts = node.kind.text_style;
      const fontStr = buildFontString(ts);
      ctx.font = fontStr;

      // Text color: resolve token refs, falling back to opaque black.
      const defaultTextColor = { space: "srgb" as const, r: 0, g: 0, b: 0, a: 1 };
      const resolvedTextColor = resolveStyleValueColor(ts.text_color, tokens, defaultTextColor);
      let textColor = "#000000";
      if (resolvedTextColor.space === "srgb") {
        textColor = srgbColorToRgba(resolvedTextColor) ?? "#000000";
      }
      ctx.fillStyle = textColor;
      ctx.textBaseline = "alphabetic";

      // Resolve font size via token store, falling back to default.
      const fontSize = resolveStyleValueNumber(ts.font_size, tokens, DEFAULT_FONT_SIZE_PX);
      // Resolve line height multiplier via token store, falling back to 1.5.
      const lineHeightMultiplier = resolveStyleValueNumber(ts.line_height, tokens, 1.5);
      const lh = lineHeightMultiplier * fontSize;

      const measurement = measureTextLines(
        ctx,
        node.kind.content,
        fontStr,
        node.kind.sizing,
        width,
        lh,
      );

      // Apply text shadow if present
      if (ts.text_shadow) {
        const defaultShadowColor = { space: "srgb" as const, r: 0, g: 0, b: 0, a: 0.3 };
        const resolvedShadowColor = resolveStyleValueColor(
          ts.text_shadow.color,
          tokens,
          defaultShadowColor,
        );
        const shadowColor =
          resolvedShadowColor.space === "srgb"
            ? (srgbColorToRgba(resolvedShadowColor) ?? "rgba(0,0,0,0.3)")
            : "rgba(0,0,0,0.3)";
        if (
          Number.isFinite(ts.text_shadow.offset_x) &&
          Number.isFinite(ts.text_shadow.offset_y) &&
          Number.isFinite(ts.text_shadow.blur_radius)
        ) {
          ctx.shadowOffsetX = ts.text_shadow.offset_x;
          ctx.shadowOffsetY = ts.text_shadow.offset_y;
          ctx.shadowBlur = ts.text_shadow.blur_radius;
          ctx.shadowColor = shadowColor;
        }
      }

      for (const line of measurement.lines) {
        // Compute horizontal offset from the text_align setting.
        let lineX = x;
        if (ts.text_align === "center") {
          lineX = x + (width - line.width) / 2;
        } else if (ts.text_align === "right") {
          lineX = x + width - line.width;
        }
        // "justify" is deferred — treated as "left" for now.

        ctx.fillText(line.text, lineX, y + line.y);

        // Text decoration — drawn as a manual line over/through the text.
        if (ts.text_decoration === "underline") {
          // RF-012: Use proportional offset instead of hardcoded +2 so
          // the underline scales correctly with font size.
          const underlineOffset = fontSize * 0.1;
          ctx.beginPath();
          ctx.moveTo(lineX, y + line.y + underlineOffset);
          ctx.lineTo(lineX + line.width, y + line.y + underlineOffset);
          ctx.strokeStyle = textColor;
          ctx.lineWidth = 1;
          ctx.stroke();
        } else if (ts.text_decoration === "strikethrough") {
          ctx.beginPath();
          // Place the strikethrough at ~30% above the baseline (ascender midpoint).
          const mid = y + line.y - fontSize * 0.3;
          ctx.moveTo(lineX, mid);
          ctx.lineTo(lineX + line.width, mid);
          ctx.strokeStyle = textColor;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Reset text shadow to prevent bleeding into subsequent draw calls
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      break;
    }
    case "path": {
      // Path rendering is deferred to a later plan (pen tool).
      // Draw bounding box as placeholder with fill support.
      if (node.style.fills.length === 0) {
        ctx.fillStyle = DEFAULT_FILL;
        ctx.fillRect(x, y, width, height);
      } else {
        for (const fill of node.style.fills) {
          const fillStyle = resolveFillStyle(ctx, fill, x, y, width, height, tokens);
          if (fillStyle !== null) {
            ctx.fillStyle = fillStyle;
            ctx.fillRect(x, y, width, height);
          }
        }
      }
      break;
    }
  }
}

/**
 * Draw a selection highlight around a node.
 *
 * Uses a screen-space line width so the highlight does not scale with zoom.
 */
function drawSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  node: DocumentNode,
  transform: Transform,
  zoom: number,
): void {
  const { x, y, width, height } = transform;
  const lineWidth = SELECTION_LINE_WIDTH / zoom;

  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = lineWidth;

  if (node.kind.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, width, height);
  }
}

/**
 * Draw a name label above a node.
 *
 * Label is rendered in screen-space size so it does not scale with zoom.
 */
function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  node: DocumentNode,
  transform: Transform,
  zoom: number,
): void {
  const { x, y } = transform;
  const fontSize = LABEL_FONT_SIZE / zoom;

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = `${String(fontSize)}px sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.fillText(node.name, x, y - fontSize * 0.3);
}

/**
 * Draw 8 selection handles (4 corners + 4 edge midpoints) on a node.
 *
 * Handles are drawn in world coordinates but sized relative to screen pixels
 * so they maintain a consistent visual size regardless of zoom.
 */
function drawSelectionHandles(
  ctx: CanvasRenderingContext2D,
  transform: Transform,
  zoom: number,
): void {
  const { x, y, width, height } = transform;
  const halfHandle = HANDLE_SIZE / 2 / zoom;

  // The 8 handle positions: 4 corners + 4 edge midpoints
  const positions: ReadonlyArray<readonly [number, number]> = [
    // Corners
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    // Edge midpoints
    [x + width / 2, y],
    [x + width, y + height / 2],
    [x + width / 2, y + height],
    [x, y + height / 2],
  ];

  ctx.fillStyle = SELECTION_COLOR;

  for (const [px, py] of positions) {
    ctx.fillRect(px - halfHandle, py - halfHandle, halfHandle * 2, halfHandle * 2);
  }
}

/**
 * Draw a dashed preview rectangle for the shape tool drag operation.
 *
 * Uses screen-space dash and line width so the preview does not scale with zoom.
 */
function drawPreviewRect(ctx: CanvasRenderingContext2D, preview: PreviewRect, zoom: number): void {
  const lineWidth = SELECTION_LINE_WIDTH / zoom;
  const dashScale = 1 / zoom;

  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(PREVIEW_DASH.map((d) => d * dashScale));
  ctx.strokeRect(preview.x, preview.y, preview.width, preview.height);
  ctx.setLineDash([]);
}

/** Marquee rectangle stroke color. */
const MARQUEE_COLOR = "#0d99ff";

/** Marquee rectangle fill color (semi-transparent). */
const MARQUEE_FILL = "rgba(13, 153, 255, 0.1)";

/** Compound bounds outline color. */
const COMPOUND_BOUNDS_COLOR = "#0d99ff";

/**
 * Draw a marquee selection rectangle on the canvas.
 *
 * Renders a dashed blue outline with a semi-transparent blue fill.
 * All dimensions are in world coordinates; the viewport transform
 * is already applied by the caller.
 */
function drawMarqueeRect(ctx: CanvasRenderingContext2D, rect: MarqueeRect, zoom: number): void {
  const lineWidth = 1 / zoom;
  const dashPattern = [6 / zoom, 4 / zoom];

  ctx.strokeStyle = MARQUEE_COLOR;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashPattern);
  ctx.fillStyle = MARQUEE_FILL;

  // RF-016: Normalize negative dimensions before drawing. The marquee rect
  // may have negative width/height when the user drags right-to-left or
  // bottom-to-top. Canvas fillRect/strokeRect handle negatives inconsistently
  // across browsers, so we normalize to always-positive dimensions.
  const rx = rect.width >= 0 ? rect.x : rect.x + rect.width;
  const ry = rect.height >= 0 ? rect.y : rect.y + rect.height;
  const rw = Math.abs(rect.width);
  const rh = Math.abs(rect.height);

  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.setLineDash([]);
}

/**
 * Draw compound bounding box outline and 8 resize handles for multi-selection.
 *
 * Computes the union bounding box of all provided transforms and draws a
 * dashed outline with resize handles at corners and edge midpoints.
 *
 * RF-010: This recomputes compound bounds separately from select-tool.ts.
 * Known redundancy — the tool computes bounds for resize math, the renderer
 * computes bounds for drawing. Merging would require plumbing compound bounds
 * through the preview signal, deferred for simplicity.
 */
function drawCompoundBounds(
  ctx: CanvasRenderingContext2D,
  transforms: Transform[],
  zoom: number,
): void {
  if (transforms.length < 2) return;

  const bounds = computeCompoundBounds(transforms);
  const lineWidth = SELECTION_LINE_WIDTH / zoom;

  ctx.strokeStyle = COMPOUND_BOUNDS_COLOR;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.setLineDash([]);

  // Draw 8 handles on the compound bounds
  drawSelectionHandles(ctx, bounds, zoom);
}

/** Smart guide line color (pink/red). */
const GUIDE_COLOR = "#ff3366";

/** Smart guide line width in screen pixels. */
const GUIDE_LINE_WIDTH = 1;

/**
 * Draw smart guide lines when snapping is active.
 *
 * Each guide is drawn as a full-extent line across the canvas:
 * - X guides are vertical lines (full canvas height).
 * - Y guides are horizontal lines (full canvas width).
 *
 * Lines are drawn in world coordinates but with a 1px screen-space width
 * so they remain visually crisp regardless of zoom.
 */
function drawGuideLines(
  ctx: CanvasRenderingContext2D,
  guides: readonly SnapGuide[],
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (guides.length === 0) return;

  const lineWidth = GUIDE_LINE_WIDTH / viewport.zoom;
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = lineWidth;

  // Compute the world-space extent visible on screen.
  // screenX = worldX * zoom + offsetX => worldX = (screenX - offsetX) / zoom
  const worldLeft = -viewport.x / viewport.zoom;
  const worldTop = -viewport.y / viewport.zoom;
  const worldRight = (canvasWidth - viewport.x) / viewport.zoom;
  const worldBottom = (canvasHeight - viewport.y) / viewport.zoom;

  for (const guide of guides) {
    ctx.beginPath();
    if (guide.axis === "x") {
      // Vertical line at world x = guide.position
      ctx.moveTo(guide.position, worldTop);
      ctx.lineTo(guide.position, worldBottom);
    } else {
      // Horizontal line at world y = guide.position
      ctx.moveTo(worldLeft, guide.position);
      ctx.lineTo(worldRight, guide.position);
    }
    ctx.stroke();
  }
}

/**
 * Render the document onto the canvas.
 *
 * Clears the canvas, applies the viewport transform, and draws all visible
 * nodes. For each UUID in selectedUuids, draws a selection highlight. If
 * multiple nodes are selected, draws a compound bounding box with handles;
 * if exactly one is selected, draws handles on that node. If a previewRect
 * is provided, draws a dashed outline for the shape tool drag preview.
 * If previewTransforms are provided, uses them for the dragged nodes' positions.
 * If a marqueeRect is provided, draws a dashed selection rectangle on top.
 *
 * RF-006: selectedUuids is now ReadonlySet<string> (memoized by caller).
 * RF-005: previewTransforms are converted to a Map once before the render loop.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  nodes: readonly DocumentNode[],
  selectedUuids: ReadonlySet<string>,
  dpr = 1,
  previewRect: PreviewRect | null = null,
  previewTransforms: readonly PreviewTransform[] = [],
  snapGuides: readonly SnapGuide[] = [],
  marqueeRect: MarqueeRect | null = null,
  tokens: Record<string, Token> = {},
): void {
  // Clear the entire canvas in screen space.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Apply DPR + viewport: compose them so drawing uses world coordinates
  // scaled to physical pixels.
  ctx.setTransform(
    viewport.zoom * dpr,
    0,
    0,
    viewport.zoom * dpr,
    viewport.x * dpr,
    viewport.y * dpr,
  );

  // RF-005: Build Map<string, Transform> from previewTransforms once before
  // the render loop, replacing the O(n*k) linear scan per node.
  const previewMap = new Map<string, Transform>(
    previewTransforms.map((pt) => [pt.uuid, pt.transform]),
  );

  // Draw each visible node.
  for (const node of nodes) {
    if (!node.visible) {
      continue;
    }
    const effectiveTransform = getEffectiveTransform(node, previewMap);
    drawNode(ctx, node, effectiveTransform, tokens);
  }

  // RF-006: selectedUuids is already a Set — no per-frame allocation needed.

  // Draw selection highlights on all selected nodes.
  if (selectedUuids.size > 0) {
    const selectedTransforms: Transform[] = [];

    for (const node of nodes) {
      if (!node.visible) continue;
      if (!selectedUuids.has(node.uuid)) continue;

      const effectiveTransform = getEffectiveTransform(node, previewMap);
      drawSelectionHighlight(ctx, node, effectiveTransform, viewport.zoom);
      selectedTransforms.push(effectiveTransform);

      // Draw name label + individual handles only for single selection.
      if (selectedUuids.size === 1) {
        drawNameLabel(ctx, node, effectiveTransform, viewport.zoom);
        drawSelectionHandles(ctx, effectiveTransform, viewport.zoom);
      }
    }

    // For multi-selection: draw compound bounding box + handles.
    if (selectedUuids.size >= 2 && selectedTransforms.length >= 2) {
      drawCompoundBounds(ctx, selectedTransforms, viewport.zoom);
    }
  }

  // Draw shape tool preview rectangle if active.
  if (previewRect !== null) {
    drawPreviewRect(ctx, previewRect, viewport.zoom);
  }

  // Draw smart guide lines (after nodes and selection, before marquee).
  if (snapGuides.length > 0) {
    drawGuideLines(ctx, snapGuides, viewport, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
  }

  // Draw marquee selection rectangle on top of everything.
  if (marqueeRect !== null) {
    drawMarqueeRect(ctx, marqueeRect, viewport.zoom);
  }

  // Reset transform to identity.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
