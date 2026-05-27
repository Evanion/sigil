/**
 * ColorArea — 2D canvas color picker widget.
 *
 * Renders a color gradient via the `renderBackground` prop (caller-supplied).
 * Exposes x (0–1) and y (0–1, top=1 bottom=0) normalized position values.
 *
 * DPR handling: canvas pixel dimensions are scaled by devicePixelRatio.
 * The DPR is composed into setTransform rather than a standalone scale() call,
 * per the Canvas DPR Handling conventions in CLAUDE.md.
 *
 * Accessibility (RF-011): The widget exposes TWO complementary ARIA sliders
 * (one per axis) inside a `role="group"` wrapper, per
 * `.claude/rules/a11y-rules.md` "2D Canvas Widgets Must Have Complete ARIA
 * Slider Semantics". Each slider carries the full ARIA slider attribute set
 * (label, valuenow, valuemin, valuemax, valuetext) and its own keyboard
 * handler — ArrowLeft/Right (and Home/End) drives X, ArrowUp/Down (and
 * Home/End) drives Y. The slider elements are visually hidden via CSS
 * (sr-only positioning) but remain keyboard-focusable; the visible canvas
 * + cursor provide the sighted-user presentation, and pointer/drag handling
 * stays on the outer container.
 */
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { acquireWideGamut2D } from "../../canvas/canvas-context";
import "./ColorArea.css";

/** Default width when container hasn't been measured yet. */
const DEFAULT_AREA_WIDTH = 240;
/** Aspect ratio: height = width * AREA_ASPECT */
const AREA_ASPECT = 2 / 3;

/**
 * Default axis labels used when the caller does not supply translated
 * strings via `xAxisLabel` / `yAxisLabel`. These are intentionally generic
 * fallbacks — consumers wired to the i18n layer (e.g., the HSV-driven
 * ColorPicker) MUST pass domain-specific labels (e.g., "Saturation",
 * "Brightness"). The fallbacks exist for standalone embedders that do not
 * have an i18n context (Storybook demos, unit tests).
 */
const DEFAULT_X_AXIS_LABEL = "Horizontal";
const DEFAULT_Y_AXIS_LABEL = "Vertical";

export interface ColorAreaProps {
  /** Normalized x position in [0, 1]. */
  xValue: number;
  /** Normalized y position in [0, 1], where 1 = top and 0 = bottom. */
  yValue: number;
  /** Called when the user changes the position (continuously during drag). */
  onChange: (x: number, y: number) => void;
  /** Called when the user finishes a drag gesture (pointerup). */
  onCommit?: () => void;
  /**
   * Caller-supplied function that paints the gradient background.
   * Called with the 2D context and the logical (CSS) dimensions.
   * The context transform is already set to account for DPR — callers draw
   * in logical pixel coordinates.
   */
  renderBackground: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /**
   * Accessible label for the whole 2D color-picker group (e.g.,
   * "Color saturation and lightness"). Becomes the `aria-label` on the
   * outer `role="group"` element.
   */
  "aria-label": string;
  /**
   * Accessible label for the X-axis slider (e.g., "Saturation"). Defaults
   * to a generic "Horizontal" when not provided.
   */
  xAxisLabel?: string;
  /**
   * Accessible label for the Y-axis slider (e.g., "Brightness"). Defaults
   * to a generic "Vertical" when not provided.
   */
  yAxisLabel?: string;
}

export function ColorArea(props: ColorAreaProps) {
  // eslint-disable-next-line no-unassigned-vars
  let canvasRef: HTMLCanvasElement | undefined;
  // eslint-disable-next-line no-unassigned-vars
  let containerRef: HTMLDivElement | undefined;
  const [isDragging, setIsDragging] = createSignal(false);

  // ── Measured container width ────────────────────────────────────────
  const [measuredWidth, setMeasuredWidth] = createSignal(DEFAULT_AREA_WIDTH);

  onMount(() => {
    if (!containerRef) return;
    // Initial measurement
    const w = containerRef.clientWidth;
    if (w > 0) setMeasuredWidth(w);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newW = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        if (Number.isFinite(newW) && newW > 0) setMeasuredWidth(newW);
      }
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  // ── DPR signal ────────────────────────────────────────────────────────
  // window.devicePixelRatio is NOT a Solid signal; we must listen for changes.
  const [dpr, setDpr] = createSignal(window.devicePixelRatio || 1);

  onMount(() => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handleDprChange = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener("change", handleDprChange);
    onCleanup(() => mq.removeEventListener("change", handleDprChange));
  });

  const areaWidth = () => measuredWidth();
  const areaHeight = () => Math.round(measuredWidth() * AREA_ASPECT);

  // ── Canvas render ─────────────────────────────────────────────────────
  createEffect(() => {
    const canvas = canvasRef;
    if (!canvas) return;

    const w = areaWidth();
    const h = areaHeight();
    const currentDpr = dpr();
    const pixelWidth = Math.round(w * currentDpr);
    const pixelHeight = Math.round(h * currentDpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = acquireWideGamut2D(canvas);
    if (!ctx) return;

    // Apply DPR scaling so canvas gradients render at logical CSS dimensions
    // (the canvas backing store is at physical pixel resolution).
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    props.renderBackground(ctx, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  });

  // ── Coordinate helpers ────────────────────────────────────────────────
  function pointerToNormalized(clientX: number, clientY: number): [number, number] {
    if (!containerRef) return [0, 0];
    const rect = containerRef.getBoundingClientRect();
    const rawX = (clientX - rect.left) / rect.width;
    const rawY = 1 - (clientY - rect.top) / rect.height;
    // Clamping is the intended UX for a slider widget (CLAUDE.md §11 exception).
    const x = Math.max(0, Math.min(1, rawX));
    const y = Math.max(0, Math.min(1, rawY));
    return [x, y];
  }

  // ── Pointer events ────────────────────────────────────────────────────
  function handlePointerDown(e: PointerEvent) {
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    // Prevent default to stop the dialog/browser from interfering with the drag
    e.preventDefault();
    if (e.currentTarget instanceof Element) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setIsDragging(true);
    const [x, y] = pointerToNormalized(e.clientX, e.clientY);
    props.onChange(x, y);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging()) return;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    const [x, y] = pointerToNormalized(e.clientX, e.clientY);
    props.onChange(x, y);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isDragging()) return;
    if (e.currentTarget instanceof Element) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
    props.onCommit?.();
  }

  // ── Keyboard events — one handler per axis ────────────────────────────
  // Splitting the handlers is required by `.claude/rules/a11y-rules.md`
  // "2D Canvas Widgets Must Have Complete ARIA Slider Semantics": each
  // axis slider must respond only to keys on its own axis.
  function handleXKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.01;
    let next = props.xValue;
    switch (e.key) {
      case "ArrowRight":
        next = Math.max(0, Math.min(1, next + step));
        break;
      case "ArrowLeft":
        next = Math.max(0, Math.min(1, next - step));
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    props.onChange(next, props.yValue);
  }

  function handleYKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.01;
    let next = props.yValue;
    switch (e.key) {
      case "ArrowUp":
        next = Math.max(0, Math.min(1, next + step));
        break;
      case "ArrowDown":
        next = Math.max(0, Math.min(1, next - step));
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    props.onChange(props.xValue, next);
  }

  // ── Per-axis aria-valuetext ───────────────────────────────────────────
  const xLabel = () => props.xAxisLabel ?? DEFAULT_X_AXIS_LABEL;
  const yLabel = () => props.yAxisLabel ?? DEFAULT_Y_AXIS_LABEL;
  const xPercent = () => Math.round(props.xValue * 100);
  const yPercent = () => Math.round(props.yValue * 100);
  const xValueText = () => `${xLabel()}: ${xPercent()}%`;
  const yValueText = () => `${yLabel()}: ${yPercent()}%`;

  return (
    <div
      ref={containerRef}
      class="sigil-color-area"
      role="group"
      aria-label={props["aria-label"]}
      style={{ width: "100%", height: `${areaHeight()}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <canvas
        ref={canvasRef}
        class="sigil-color-area__canvas"
        aria-hidden="true"
        style={{ width: "100%", height: `${areaHeight()}px` }}
      >
        {/* eslint-disable-next-line i18next/no-literal-string -- i18n-allow: canvas fallback text inside aria-hidden canvas; never reaches screen readers or modern browsers */}
        {"Color selection area"}
      </canvas>
      <div
        class="sigil-color-area__cursor"
        style={{
          left: `${props.xValue * 100}%`,
          bottom: `${props.yValue * 100}%`,
        }}
        aria-hidden="true"
      />
      {/* Visually-hidden but keyboard-focusable per-axis ARIA sliders. */}
      <div
        class="sigil-color-area__sr-slider"
        role="slider"
        tabindex="0"
        aria-label={xLabel()}
        aria-valuenow={xPercent()}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={xValueText()}
        onKeyDown={handleXKeyDown}
      />
      <div
        class="sigil-color-area__sr-slider"
        role="slider"
        tabindex="0"
        aria-label={yLabel()}
        aria-valuenow={yPercent()}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={yValueText()}
        onKeyDown={handleYKeyDown}
      />
    </div>
  );
}
