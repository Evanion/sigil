import { Slider as KobalteSlider } from "@kobalte/core/slider";
import { splitProps } from "solid-js";
import "./Slider.css";

export interface SliderProps {
  /** Current numeric value (single thumb). */
  value: number;
  /** Called on every change during interaction. Receives a finite number. */
  onChange: (value: number) => void;
  /**
   * Called once at the start of an interaction (pointerdown OR the first
   * keydown in a gesture). Use this to snapshot pre-mutation state for undo.
   * See CLAUDE.md frontend-defensive "Continuous-Value Controls Must Coalesce
   * History Entries".
   */
  onChangeStart?: () => void;
  /**
   * Called at the end of an interaction (pointerup OR keyup). Receives the
   * final value. Use this to commit a single history entry per gesture.
   */
  onChangeEnd?: (value: number) => void;
  /** Accessible label (required). */
  ariaLabel: string;
  /** Human-readable description of the current value for screen readers. */
  ariaValueText?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Additional CSS class merged with the base `sigil-slider` class. */
  class?: string;
}

/**
 * Extract a single finite numeric value from Kobalte's multi-thumb array
 * shape. Returns null when the value is missing, non-numeric, NaN, or
 * Infinity. Single-source helper for Number.isFinite guarding per
 * CLAUDE.md §11 "Floating-Point Validation".
 */
function extractFiniteValue(vals: number[]): number | null {
  const v = vals[0];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/**
 * Forward Kobalte's onChange to the wrapper's single-number onChange,
 * rejecting non-finite inputs. Required by frontend-defensive
 * "Business Logic Must Not Live in Inline JSX Handlers" — the JSX handler
 * delegates to this named, unit-testable helper. Emits a structured
 * console.warn on rejection per frontend-defensive
 * "Internal Mutation Entry Points Must Diagnose Their Own No-Ops".
 */
export function emitChange(vals: number[], onChange: (value: number) => void): void {
  const v = extractFiniteValue(vals);
  if (v === null) {
    console.warn("Slider: ignored non-finite value from Kobalte onChange", { vals });
    return;
  }
  onChange(v);
}

/**
 * Forward Kobalte's onChangeEnd to the wrapper's single-number onChangeEnd
 * and always run the gesture-reset side effect (so a malformed final value
 * does not leave gesture state stuck). Same diagnostic obligations as
 * emitChange.
 */
export function emitChangeEnd(
  vals: number[],
  onChangeEnd: ((value: number) => void) | undefined,
  resetGesture: () => void,
): void {
  // Reset gesture tracking unconditionally — even if the final value is
  // non-finite, the gesture itself is over.
  resetGesture();
  const v = extractFiniteValue(vals);
  if (v === null) {
    console.warn("Slider: ignored non-finite value from Kobalte onChangeEnd", { vals });
    return;
  }
  onChangeEnd?.(v);
}

export function Slider(props: SliderProps) {
  const [local] = splitProps(props, [
    "value",
    "onChange",
    "onChangeStart",
    "onChangeEnd",
    "ariaLabel",
    "ariaValueText",
    "min",
    "max",
    "step",
    "disabled",
    "class",
  ]);

  const className = (): string => {
    const classes = ["sigil-slider"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  // Gesture tracking: onChangeStart fires once per gesture. A gesture starts
  // on pointerdown OR the first keydown; it ends in emitChangeEnd. The
  // internal flag prevents duplicate start emissions within a single gesture.
  let gestureActive = false;

  const startGesture = (): void => {
    if (!gestureActive) {
      gestureActive = true;
      local.onChangeStart?.();
    }
  };

  const endGesture = (): void => {
    gestureActive = false;
  };

  return (
    <KobalteSlider
      class={className()}
      value={[local.value]}
      onChange={(vals) => emitChange(vals, local.onChange)}
      onChangeEnd={(vals) => emitChangeEnd(vals, local.onChangeEnd, endGesture)}
      minValue={local.min}
      maxValue={local.max}
      step={local.step}
      disabled={local.disabled}
      aria-label={local.ariaLabel}
    >
      <KobalteSlider.Track class="sigil-slider__track">
        <KobalteSlider.Fill class="sigil-slider__fill" />
        {/*
          Override aria-valuetext on the thumb directly when ariaValueText is
          provided. Kobalte's `getValueLabel` only feeds Slider.ValueLabel —
          not the thumb's aria-valuetext (which comes from
          state.getThumbValueLabel via numberFormatter). The thumb's
          render props spread `{...others}` after its own aria-valuetext, so
          a wrapper-provided value wins.

          onPointerDown and onKeyDown synthesize onChangeStart — Kobalte
          exposes onChange and onChangeEnd only. Without onChangeStart, a
          downstream consumer cannot capture the pre-gesture snapshot per
          frontend-defensive "Continuous-Value Controls Must Coalesce
          History Entries".
        */}
        <KobalteSlider.Thumb
          class="sigil-slider__thumb"
          aria-valuetext={local.ariaValueText}
          onPointerDown={startGesture}
          onKeyDown={startGesture}
        >
          <KobalteSlider.Input />
        </KobalteSlider.Thumb>
      </KobalteSlider.Track>
    </KobalteSlider>
  );
}
