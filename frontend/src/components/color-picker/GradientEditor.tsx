/**
 * GradientEditor — visual gradient stop editor with drag handles.
 *
 * Renders a gradient bar with draggable stop handles. Supports:
 *   - Click on bar to add a new stop (clones left neighbour's color).
 *   - Drag stops to reposition.
 *   - Drag >30px off bar vertically removes the stop (if stops.length > MIN_STOPS).
 *   - Arrow key repositioning (+/-1%, Shift +/-10%).
 *   - Delete key removes focused stop (if stops.length > MIN_STOPS).
 *   - Toggle between linear and radial gradient types (RF-017: radiogroup pattern).
 *   - Angle input shown only for linear gradients.
 *
 * Accessibility:
 *   - Each stop is role="slider" with aria-valuenow and aria-label.
 *   - Selected stop has aria-current="true" (RF-011).
 *   - Gradient bar is focusable; Enter adds a stop at midpoint (RF-010).
 *   - Type toggle uses role="radiogroup" with arrow-key navigation (RF-017).
 *   - Angle input uses NumberInput.
 *
 * Guard: all pointer coordinates checked with Number.isFinite() before use.
 * Guard: all NumberInput values checked with Number.isFinite() before use.
 */
import { createSignal, For, Show } from "solid-js";
import type { GradientStop, Color } from "../../types/document";
import { colorToSrgb, srgbToHex, colorAlpha } from "./color-math";
import { NumberInput } from "../number-input/NumberInput";
import "./GradientEditor.css";

export const BAR_WIDTH = 240;
export const BAR_HEIGHT = 28;
export const MIN_STOPS = 2;
/** RF-015: Maximum number of gradient stops. */
export const MAX_STOPS = 16;

/** The two gradient types supported by the editor. */
export type GradientType = "linear" | "radial";

/** Vertical distance (px) from bar centre that triggers stop removal on drag. */
const REMOVE_THRESHOLD_PX = 30;

/** Ordered gradient type options for the radiogroup (RF-017). */
const GRADIENT_TYPE_OPTIONS: readonly { value: GradientType; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
];

export interface GradientEditorProps {
  /** Ordered list of gradient stops. Must have at least MIN_STOPS entries. */
  stops: readonly GradientStop[];
  /** Gradient type. */
  gradientType: "linear" | "radial";
  /** Angle in degrees (only meaningful for linear gradients). */
  angle: number;
  /** Index of the currently selected stop. */
  selectedStopIndex: number;
  /** Called when stops change (add, remove, reposition). */
  onStopsChange: (stops: GradientStop[]) => void;
  /** Called when the gradient type changes. */
  onGradientTypeChange: (type: "linear" | "radial") => void;
  /** Called when the angle changes. */
  onAngleChange: (angle: number) => void;
  /** Called when the user selects a stop. */
  onSelectStop: (index: number) => void;
}

/**
 * Build a CSS linear-gradient string from the stop list.
 * Stops are rendered left-to-right (0% = left).
 */
function buildGradientCss(stops: readonly GradientStop[]): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const colorStops = sorted
    .filter((s) => Number.isFinite(s.position) && s.position >= 0 && s.position <= 1)
    .map((stop) => {
      let color: Color;
      if (stop.color.type === "literal") {
        color = stop.color.value;
      } else {
        // Token ref: fall back to transparent as a safe default display.
        return `transparent ${stop.position * 100}%`;
      }
      const [r, g, b] = colorToSrgb(color);
      const alpha = colorAlpha(color);
      const hex = srgbToHex(r, g, b);
      if (alpha < 1) {
        const a = Math.round(alpha * 255)
          .toString(16)
          .padStart(2, "0");
        return `${hex}${a} ${stop.position * 100}%`;
      }
      return `${hex} ${stop.position * 100}%`;
    })
    .join(", ");
  return `linear-gradient(90deg, ${colorStops})`;
}

/**
 * Extract the background color of a stop for rendering the handle swatch.
 */
function stopHandleColor(stop: GradientStop): string {
  if (stop.color.type !== "literal") return "transparent";
  const [r, g, b] = colorToSrgb(stop.color.value);
  return srgbToHex(r, g, b);
}

export function GradientEditor(props: GradientEditorProps) {
  // eslint-disable-next-line no-unassigned-vars
  let barRef: HTMLDivElement | undefined;
  const [draggingIndex, setDraggingIndex] = createSignal<number | null>(null);

  // ── RF-017: Type toggle radio button refs ──────────────────────────
  const typeButtonRefs: (HTMLButtonElement | undefined)[] = [];

  // ── Gradient bar click (add stop) ────────────────────────────────────
  function handleBarClick(e: MouseEvent) {
    // Ignore if the click originated on a stop handle.
    if ((e.target as HTMLElement).classList.contains("sigil-gradient-editor__stop")) return;
    if (!Number.isFinite(e.clientX)) return;
    if (!barRef) return;

    // RF-015: enforce MAX_STOPS limit.
    if (props.stops.length >= MAX_STOPS) return;

    const rect = barRef.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    // Find the stop immediately to the left (or the first stop if none).
    const sorted = [...props.stops].sort((a, b) => a.position - b.position);
    const leftNeighbour = sorted.filter((s) => s.position <= position).pop() ?? sorted[0];

    const newStop: GradientStop = {
      position,
      color: leftNeighbour.color,
    };

    const newStops = [...props.stops, newStop];
    props.onStopsChange(newStops);
    // Select the newly added stop.
    props.onSelectStop(newStops.length - 1);
  }

  // ── RF-010: Bar keyboard handler (Enter adds stop at midpoint) ──────
  function handleBarKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      // RF-015: enforce MAX_STOPS limit.
      if (props.stops.length >= MAX_STOPS) return;

      // Add a stop at position 0.5 (midpoint).
      const sorted = [...props.stops].sort((a, b) => a.position - b.position);
      const leftNeighbour = sorted.filter((s) => s.position <= 0.5).pop() ?? sorted[0];

      const newStop: GradientStop = {
        position: 0.5,
        color: leftNeighbour.color,
      };

      const newStops = [...props.stops, newStop];
      props.onStopsChange(newStops);
      props.onSelectStop(newStops.length - 1);
    }
  }

  // ── Stop drag ────────────────────────────────────────────────────────
  function handleStopPointerDown(e: PointerEvent, index: number) {
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingIndex(index);
    props.onSelectStop(index);
  }

  function handleStopPointerMove(e: PointerEvent, index: number) {
    if (draggingIndex() !== index) return;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    if (!barRef) return;

    const rect = barRef.getBoundingClientRect();
    const barCentreY = rect.top + rect.height / 2;
    const verticalOffset = Math.abs(e.clientY - barCentreY);

    // Remove the stop if dragged far enough off the bar vertically.
    if (verticalOffset > REMOVE_THRESHOLD_PX && props.stops.length > MIN_STOPS) {
      setDraggingIndex(null);
      const newStops = props.stops.filter((_, i) => i !== index);
      props.onStopsChange(newStops);
      // Move selection to the nearest remaining stop.
      const clampedIndex = Math.min(index, newStops.length - 1);
      props.onSelectStop(clampedIndex);
      return;
    }

    const newPosition = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newStops = props.stops.map((stop, i) =>
      i === index ? { ...stop, position: newPosition } : stop,
    );
    props.onStopsChange(newStops);
  }

  function handleStopPointerUp(e: PointerEvent, index: number) {
    if (draggingIndex() !== index) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setDraggingIndex(null);
  }

  // ── Stop keyboard navigation ─────────────────────────────────────────
  function handleStopKeyDown(e: KeyboardEvent, index: number) {
    const step = e.shiftKey ? 0.1 : 0.01;
    const stop = props.stops[index];

    switch (e.key) {
      case "ArrowLeft": {
        e.preventDefault();
        const newPos = Math.max(0, Math.min(1, stop.position - step));
        props.onStopsChange(
          props.stops.map((s, i) => (i === index ? { ...s, position: newPos } : s)),
        );
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const newPos = Math.max(0, Math.min(1, stop.position + step));
        props.onStopsChange(
          props.stops.map((s, i) => (i === index ? { ...s, position: newPos } : s)),
        );
        break;
      }
      case "Delete":
      case "Backspace": {
        if (props.stops.length <= MIN_STOPS) break;
        e.preventDefault();
        const newStops = props.stops.filter((_, i) => i !== index);
        props.onStopsChange(newStops);
        const clampedIndex = Math.min(index, newStops.length - 1);
        props.onSelectStop(clampedIndex);
        break;
      }
    }
  }

  // ── RF-017: Gradient type radio keyboard navigation ─────────────────
  function handleTypeKeyDown(e: KeyboardEvent) {
    const currentIndex = GRADIENT_TYPE_OPTIONS.findIndex((o) => o.value === props.gradientType);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % GRADIENT_TYPE_OPTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + GRADIENT_TYPE_OPTIONS.length) % GRADIENT_TYPE_OPTIONS.length;
    }

    if (nextIndex !== null) {
      const nextOption = GRADIENT_TYPE_OPTIONS[nextIndex];
      if (nextOption) {
        props.onGradientTypeChange(nextOption.value);
        typeButtonRefs[nextIndex]?.focus();
      }
    }
  }

  return (
    <div class="sigil-gradient-editor">
      {/* RF-017: Type toggle row — radiogroup with arrow-key navigation */}
      <div class="sigil-gradient-editor__type-row" role="radiogroup" aria-label="Gradient type">
        <For each={GRADIENT_TYPE_OPTIONS}>
          {(option, i) => {
            const isActive = () => props.gradientType === option.value;
            return (
              <button
                ref={(el) => {
                  typeButtonRefs[i()] = el;
                }}
                class={
                  isActive()
                    ? "sigil-gradient-editor__type-btn sigil-gradient-editor__type-btn--active"
                    : "sigil-gradient-editor__type-btn"
                }
                role="radio"
                aria-checked={isActive()}
                tabindex={isActive() ? 0 : -1}
                onClick={() => props.onGradientTypeChange(option.value)}
                onKeyDown={handleTypeKeyDown}
                type="button"
              >
                {option.label}
              </button>
            );
          }}
        </For>
      </div>

      {/* Gradient bar — RF-010: focusable, Enter to add stop */}
      <div
        ref={barRef}
        class="sigil-gradient-editor__bar"
        style={{
          width: `${BAR_WIDTH}px`,
          height: `${BAR_HEIGHT}px`,
          background: buildGradientCss(props.stops),
        }}
        onClick={handleBarClick}
        onKeyDown={handleBarKeyDown}
        tabindex={0}
        role="group"
        aria-label="Gradient stops"
      >
        <For each={props.stops}>
          {(stop, i) => {
            const isSelected = () => props.selectedStopIndex === i();
            return (
              <div
                class={
                  isSelected()
                    ? "sigil-gradient-editor__stop sigil-gradient-editor__stop--selected"
                    : "sigil-gradient-editor__stop"
                }
                style={{
                  left: `${stop.position * 100}%`,
                  background: stopHandleColor(stop),
                }}
                role="slider"
                tabindex={0}
                aria-label={`Gradient stop ${i() + 1} at ${Math.round(stop.position * 100)}%`}
                aria-valuenow={Math.round(stop.position * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-current={isSelected() ? "true" : undefined}
                onPointerDown={(e) => handleStopPointerDown(e, i())}
                onPointerMove={(e) => handleStopPointerMove(e, i())}
                onPointerUp={(e) => handleStopPointerUp(e, i())}
                onKeyDown={(e) => handleStopKeyDown(e, i())}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSelectStop(i());
                }}
              />
            );
          }}
        </For>
      </div>

      {/* Angle input — linear only */}
      <Show when={props.gradientType === "linear"}>
        <div class="sigil-gradient-editor__angle-row">
          <span class="sigil-gradient-editor__angle-label">Angle</span>
          <NumberInput
            value={props.angle}
            onValueChange={(val) => {
              if (Number.isFinite(val)) {
                props.onAngleChange(val);
              }
            }}
            step={1}
            min={0}
            max={360}
            suffix="deg"
            aria-label="Gradient angle"
          />
        </div>
      </Show>
    </div>
  );
}
