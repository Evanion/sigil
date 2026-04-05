/**
 * ColorArea — 2D canvas color picker widget.
 *
 * Renders a color gradient via the `renderBackground` prop (caller-supplied).
 * Exposes x (0–1) and y (0–1, top=1 bottom=0) normalized position values.
 *
 * DPR handling: canvas pixel dimensions are scaled by devicePixelRatio.
 * The DPR is composed into setTransform rather than a standalone scale() call,
 * per the Canvas DPR Handling conventions in CLAUDE.md.
 */
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import "./ColorArea.css";

export const AREA_WIDTH = 240;
export const AREA_HEIGHT = 160;

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
  /** Accessible label for the canvas widget (required by CLAUDE.md §5). */
  "aria-label": string;
}

export function ColorArea(props: ColorAreaProps) {
  // eslint-disable-next-line no-unassigned-vars
  let canvasRef: HTMLCanvasElement | undefined;
  // eslint-disable-next-line no-unassigned-vars
  let containerRef: HTMLDivElement | undefined;
  const [isDragging, setIsDragging] = createSignal(false);

  // ── DPR signal ────────────────────────────────────────────────────────
  // window.devicePixelRatio is NOT a Solid signal; we must listen for changes.
  const [dpr, setDpr] = createSignal(window.devicePixelRatio || 1);

  onMount(() => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handleDprChange = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener("change", handleDprChange);
    onCleanup(() => mq.removeEventListener("change", handleDprChange));
  });

  // ── Canvas render ─────────────────────────────────────────────────────
  createEffect(() => {
    const canvas = canvasRef;
    if (!canvas) return;

    const currentDpr = dpr();
    const pixelWidth = AREA_WIDTH * currentDpr;
    const pixelHeight = AREA_HEIGHT * currentDpr;

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Apply DPR scaling so canvas gradients render at logical CSS dimensions
    // (the canvas backing store is at physical pixel resolution).
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    props.renderBackground(ctx, AREA_WIDTH, AREA_HEIGHT);
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

  // ── Keyboard events ───────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.01;
    let { xValue, yValue } = props;
    let handled = false;

    switch (e.key) {
      case "ArrowRight":
        xValue = Math.max(0, Math.min(1, xValue + step));
        handled = true;
        break;
      case "ArrowLeft":
        xValue = Math.max(0, Math.min(1, xValue - step));
        handled = true;
        break;
      case "ArrowUp":
        yValue = Math.max(0, Math.min(1, yValue + step));
        handled = true;
        break;
      case "ArrowDown":
        yValue = Math.max(0, Math.min(1, yValue - step));
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      props.onChange(xValue, yValue);
    }
  }

  // ── Aria value text ───────────────────────────────────────────────────
  const ariaValueText = () =>
    `x: ${Math.round(props.xValue * 100)}%, y: ${Math.round(props.yValue * 100)}%`;

  return (
    <div
      ref={containerRef}
      class="sigil-color-area"
      role="slider"
      tabindex="0"
      aria-label={props["aria-label"]}
      aria-valuenow={Math.round(props.xValue * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={ariaValueText()}
      style={{ width: `${AREA_WIDTH}px`, height: `${AREA_HEIGHT}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <canvas
        ref={canvasRef}
        class="sigil-color-area__canvas"
        aria-hidden="true"
        style={{ width: `${AREA_WIDTH}px`, height: `${AREA_HEIGHT}px` }}
      >
        {/* Fallback text for non-canvas environments */}
        Color selection area
      </canvas>
      <div
        class="sigil-color-area__cursor"
        style={{
          left: `${props.xValue * 100}%`,
          bottom: `${props.yValue * 100}%`,
        }}
        aria-hidden="true"
      />
    </div>
  );
}
