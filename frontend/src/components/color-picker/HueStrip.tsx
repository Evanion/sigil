/**
 * HueStrip — horizontal hue rainbow strip widget.
 *
 * Renders a 6-stop hsl() rainbow gradient on a canvas. The user drags or
 * uses arrow keys to select a hue in [0, 360).
 *
 * DPR handling follows the same pattern as ColorArea: DPR is composed into
 * setTransform rather than a standalone scale() call.
 */
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import "./Strip.css";

export const STRIP_WIDTH = 240;
export const STRIP_HEIGHT = 14;

export interface HueStripProps {
  /** Current hue value in [0, 360). */
  hue: number;
  /** Called when the user changes the hue (continuously during drag). */
  onChange: (hue: number) => void;
  /** Called when the user finishes a drag gesture (pointerup). */
  onCommit?: () => void;
  /** Accessible label. Defaults to "Hue". */
  "aria-label"?: string;
}

export function HueStrip(props: HueStripProps) {
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

    const gradient = ctx.createLinearGradient(0, 0, STRIP_WIDTH, 0);
    // 6-stop hue rainbow: 0°, 60°, 120°, 180°, 240°, 300°, 360°
    gradient.addColorStop(0 / 6, "hsl(0, 100%, 50%)");
    gradient.addColorStop(1 / 6, "hsl(60, 100%, 50%)");
    gradient.addColorStop(2 / 6, "hsl(120, 100%, 50%)");
    gradient.addColorStop(3 / 6, "hsl(180, 100%, 50%)");
    gradient.addColorStop(4 / 6, "hsl(240, 100%, 50%)");
    gradient.addColorStop(5 / 6, "hsl(300, 100%, 50%)");
    gradient.addColorStop(6 / 6, "hsl(360, 100%, 50%)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  });

  // ── Coordinate helper ─────────────────────────────────────────────────
  function pointerToHue(clientX: number): number {
    if (!containerRef) return 0;
    const rect = containerRef.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    // Clamping is the intended UX for a slider widget.
    const clamped = Math.max(0, Math.min(1, ratio));
    return clamped * 360;
  }

  // ── Pointer events ────────────────────────────────────────────────────
  function handlePointerDown(e: PointerEvent) {
    if (!Number.isFinite(e.clientX)) return;
    if (e.currentTarget instanceof Element) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setIsDragging(true);
    props.onChange(pointerToHue(e.clientX));
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging()) return;
    if (!Number.isFinite(e.clientX)) return;
    props.onChange(pointerToHue(e.clientX));
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
    const step = e.shiftKey ? 10 : 1;
    let newHue = props.hue;
    let handled = false;

    switch (e.key) {
      case "ArrowRight":
        newHue = (props.hue + step) % 360;
        handled = true;
        break;
      case "ArrowLeft": {
        newHue = (props.hue - step + 360) % 360;
        handled = true;
        break;
      }
    }

    if (handled) {
      e.preventDefault();
      props.onChange(newHue);
    }
  }

  const label = () => props["aria-label"] ?? "Hue";

  return (
    <div
      ref={containerRef}
      class="sigil-strip"
      role="slider"
      tabindex="0"
      aria-label={label()}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(props.hue)}
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
        Hue selection strip
      </canvas>
      <div
        class="sigil-strip__thumb"
        style={{ left: `${(props.hue / 360) * 100}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
