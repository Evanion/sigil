/**
 * GradientStopEditor — horizontal gradient bar with draggable stop markers.
 *
 * Renders stops as draggable markers positioned along a gradient bar.
 * Uses stable string IDs for selection/dispatch per CLAUDE.md
 * "Do Not Use Positional Index as Item Identity in Dynamic Lists".
 *
 * Accessibility:
 *   - Each stop is role="slider" with aria-valuenow, aria-valuemin, aria-valuemax.
 *   - Arrow Left/Right adjusts selected stop position by 1%.
 *   - Delete key removes selected stop (if > MIN_GRADIENT_STOPS remain).
 *   - Click empty area adds a new stop.
 *
 * Guard: all position values checked with Number.isFinite() per CLAUDE.md.
 * Uses pointer events (not mouse events) for drag per CLAUDE.md.
 */
import { createSignal, Index, onCleanup } from "solid-js";
import type { GradientStop } from "../../types/document";
import { MIN_GRADIENT_STOPS, MAX_GRADIENT_STOPS } from "./gradient-utils";
import "./GradientStopEditor.css";

/** Arrow key position adjustment step (1%). */
const ARROW_STEP = 0.01;

/** Position min bound for stop slider. */
const STOP_POSITION_MIN = 0;

/** Position max bound for stop slider. */
const STOP_POSITION_MAX = 100;

export interface GradientStopEditorProps {
  readonly stops: GradientStop[];
  readonly selectedStopId: string | null;
  readonly onSelectStop: (id: string) => void;
  readonly onUpdateStop: (id: string, position: number) => void;
  readonly onAddStop: (position: number) => void;
  readonly onRemoveStop: (id: string) => void;
  /** CSS linear-gradient string for the bar background. */
  readonly gradientCSS: string;
}

export function GradientStopEditor(props: GradientStopEditorProps) {
  // eslint-disable-next-line no-unassigned-vars
  let barRef: HTMLDivElement | undefined;
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  // Track whether a drag just ended to suppress click-to-add
  const [justDragged, setJustDragged] = createSignal(false);

  // ── Bar click (add stop) ────────────────────────────────────────────
  function handleBarClick(e: MouseEvent): void {
    // Ignore if click landed on a stop marker
    if ((e.target as HTMLElement).closest("[role='slider']")) return;
    // Ignore if a drag just ended
    if (justDragged()) return;
    if (!Number.isFinite(e.clientX)) return;
    if (!barRef) return;
    if (props.stops.length >= MAX_GRADIENT_STOPS) return;

    const rect = barRef.getBoundingClientRect();
    if (rect.width <= 0) return;
    const position = (e.clientX - rect.left) / rect.width;
    if (!Number.isFinite(position)) return;

    // Clamp is acceptable here: this is an explicit user-facing slider affordance
    const clamped = Math.max(0, Math.min(1, position));
    props.onAddStop(clamped);
  }

  // ── Bar keyboard handler (Enter adds stop at midpoint) ──────────────
  function handleBarKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      if (props.stops.length >= MAX_GRADIENT_STOPS) return;
      props.onAddStop(0.5);
    }
  }

  // ── Stop drag (pointer events) ─────────────────────────────────────
  function handleStopPointerDown(e: PointerEvent, stop: GradientStop): void {
    const id = stop.id;
    if (!id) return;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingId(id);
    setJustDragged(false);
    props.onSelectStop(id);
  }

  function handleStopPointerMove(e: PointerEvent, stop: GradientStop): void {
    const id = stop.id;
    if (!id) return;
    if (draggingId() !== id) return;
    if (!Number.isFinite(e.clientX)) return;
    if (!barRef) return;

    const rect = barRef.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rawPos = (e.clientX - rect.left) / rect.width;
    if (!Number.isFinite(rawPos)) return;

    // Clamp is acceptable: slider drag affordance
    const newPosition = Math.max(0, Math.min(1, rawPos));
    props.onUpdateStop(id, newPosition);
  }

  function handleStopPointerUp(e: PointerEvent, stop: GradientStop): void {
    const id = stop.id;
    if (!id) return;
    if (draggingId() !== id) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setDraggingId(null);
    setJustDragged(true);
    // Reset justDragged flag after a tick so subsequent clicks work
    const timer = setTimeout(() => setJustDragged(false), 0);
    onCleanup(() => clearTimeout(timer));
  }

  // ── Stop keyboard navigation ────────────────────────────────────────
  function handleStopKeyDown(e: KeyboardEvent, stop: GradientStop): void {
    const id = stop.id;
    if (!id) return;

    switch (e.key) {
      case "ArrowLeft": {
        e.preventDefault();
        const newPos = stop.position - ARROW_STEP;
        if (!Number.isFinite(newPos)) return;
        // Clamp: slider affordance
        props.onUpdateStop(id, Math.max(0, Math.min(1, newPos)));
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const newPos = stop.position + ARROW_STEP;
        if (!Number.isFinite(newPos)) return;
        // Clamp: slider affordance
        props.onUpdateStop(id, Math.max(0, Math.min(1, newPos)));
        break;
      }
      case "Delete":
      case "Backspace": {
        if (props.stops.length <= MIN_GRADIENT_STOPS) break;
        e.preventDefault();
        props.onRemoveStop(id);
        break;
      }
    }
  }

  return (
    <div class="sigil-gradient-stop-editor">
      <div
        ref={barRef}
        class="sigil-gradient-stop-editor__bar"
        style={{
          "--gradient-bar-bg": props.gradientCSS,
        }}
        onClick={handleBarClick}
        onKeyDown={handleBarKeyDown}
        tabindex={0}
        role="group"
        aria-label="Gradient stops"
      >
        <Index each={props.stops}>
          {(stop) => {
            const isSelected = () => props.selectedStopId === stop().id;
            const positionPct = () => {
              const p = stop().position;
              return Number.isFinite(p) ? p * 100 : 0;
            };
            const stopId = () => stop().id ?? "";

            return (
              <div
                class={
                  isSelected()
                    ? "sigil-gradient-stop-editor__stop sigil-gradient-stop-editor__stop--selected"
                    : "sigil-gradient-stop-editor__stop"
                }
                style={{
                  left: `${String(positionPct())}%`,
                  background: stopHandleColor(stop()),
                }}
                role="slider"
                tabindex={0}
                aria-label={`Color stop at ${String(Math.round(positionPct()))}%`}
                aria-valuenow={Math.round(positionPct())}
                aria-valuemin={STOP_POSITION_MIN}
                aria-valuemax={STOP_POSITION_MAX}
                aria-valuetext={`${String(Math.round(positionPct()))} percent`}
                aria-current={isSelected() ? "true" : undefined}
                data-stop-id={stopId()}
                onPointerDown={(e) => handleStopPointerDown(e, stop())}
                onPointerMove={(e) => handleStopPointerMove(e, stop())}
                onPointerUp={(e) => handleStopPointerUp(e, stop())}
                onKeyDown={(e) => handleStopKeyDown(e, stop())}
                onClick={(e) => {
                  e.stopPropagation();
                  const id = stop().id;
                  if (id) props.onSelectStop(id);
                }}
              />
            );
          }}
        </Index>
      </div>
    </div>
  );
}

/**
 * Extract the display color of a stop for its handle swatch.
 * Returns a CSS-safe color string.
 */
function stopHandleColor(stop: GradientStop): string {
  if (stop.color.type !== "literal") return "transparent";
  const c = stop.color.value;
  if (c.space !== "srgb") return "transparent";
  const r = Number.isFinite(c.r) ? Math.round(c.r * 255) : 0;
  const g = Number.isFinite(c.g) ? Math.round(c.g * 255) : 0;
  const b = Number.isFinite(c.b) ? Math.round(c.b * 255) : 0;
  const a = Number.isFinite(c.a) ? c.a : 1;
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(a)})`;
}
