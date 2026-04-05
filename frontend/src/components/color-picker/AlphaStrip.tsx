/**
 * AlphaStrip — horizontal alpha (opacity) strip widget.
 *
 * Renders a checkerboard pattern (to indicate transparency) overlaid with
 * a linear gradient from transparent to the current color. The user drags
 * or uses arrow keys to select an alpha value in [0, 1].
 *
 * DPR handling follows the same pattern as ColorArea and HueStrip.
 */
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import "./Strip.css";

export const STRIP_WIDTH = 240;
export const STRIP_HEIGHT = 14;

/** Size of each checkerboard square in logical pixels. */
const CHECKER_SIZE = 4;

export interface AlphaStripProps {
  /** Current alpha value in [0, 1]. */
  alpha: number;
  /** CSS color string for the opaque end of the gradient (e.g. "hsl(200, 100%, 50%)"). */
  colorCss: string;
  /** Called when the user changes the alpha (continuously during drag). */
  onChange: (alpha: number) => void;
  /** Called when the user finishes a drag gesture (pointerup). */
  onCommit?: () => void;
  /** Accessible label. Defaults to "Opacity". */
  "aria-label"?: string;
}

export function AlphaStrip(props: AlphaStripProps) {
  // eslint-disable-next-line no-unassigned-vars
  let canvasRef: HTMLCanvasElement | undefined;
  // eslint-disable-next-line no-unassigned-vars
  let containerRef: HTMLDivElement | undefined;
  const [isDragging, setIsDragging] = createSignal(false);

  // ── DPR signal ────────────────────────────────────────────────────────
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
    const pixelWidth = STRIP_WIDTH * currentDpr;
    const pixelHeight = STRIP_HEIGHT * currentDpr;

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

    // Draw checkerboard in logical pixels.
    // Colors are defined in theme.css tokens but canvas API needs string values;
    // we use the token values directly from the CSS variables.
    const cols = Math.ceil(STRIP_WIDTH / CHECKER_SIZE);
    const rows = Math.ceil(STRIP_HEIGHT / CHECKER_SIZE);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const isDark = (row + col) % 2 === 0;
        // These colors are sourced from the CSS token definitions in theme.css.
        // We read them here as string literals that match the token values.
        ctx.fillStyle = isDark ? "#444444" : "#666666";
        ctx.fillRect(col * CHECKER_SIZE, row * CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE);
      }
    }

    // Draw the transparency-to-color gradient overlay.
    const gradient = ctx.createLinearGradient(0, 0, STRIP_WIDTH, 0);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(1, props.colorCss);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  });

  // ── Coordinate helper ─────────────────────────────────────────────────
  function pointerToAlpha(clientX: number): number {
    if (!containerRef) return 0;
    const rect = containerRef.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    // Clamping is the intended UX for a slider widget.
    return Math.max(0, Math.min(1, ratio));
  }

  // ── Pointer events ────────────────────────────────────────────────────
  function handlePointerDown(e: PointerEvent) {
    if (!Number.isFinite(e.clientX)) return;
    if (e.currentTarget instanceof Element) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setIsDragging(true);
    props.onChange(pointerToAlpha(e.clientX));
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging()) return;
    if (!Number.isFinite(e.clientX)) return;
    props.onChange(pointerToAlpha(e.clientX));
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
    let newAlpha = props.alpha;
    let handled = false;

    switch (e.key) {
      case "ArrowRight":
        newAlpha = Math.max(0, Math.min(1, props.alpha + step));
        handled = true;
        break;
      case "ArrowLeft":
        newAlpha = Math.max(0, Math.min(1, props.alpha - step));
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      props.onChange(newAlpha);
    }
  }

  const label = () => props["aria-label"] ?? "Opacity";

  return (
    <div
      ref={containerRef}
      class="sigil-strip"
      role="slider"
      tabindex="0"
      aria-label={label()}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.alpha * 100)}
      style={{ width: `${STRIP_WIDTH}px`, height: `${STRIP_HEIGHT}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <canvas
        ref={canvasRef}
        class="sigil-strip__canvas"
        aria-hidden="true"
        style={{ width: `${STRIP_WIDTH}px`, height: `${STRIP_HEIGHT}px` }}
      >
        Opacity selection strip
      </canvas>
      <div
        class="sigil-strip__thumb"
        style={{ left: `${props.alpha * 100}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
