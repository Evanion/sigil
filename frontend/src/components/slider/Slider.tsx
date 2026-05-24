import { Slider as KobalteSlider } from "@kobalte/core/slider";
import { splitProps } from "solid-js";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
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
 * `console.warn` on rejection per frontend-defensive
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

export function Slider(props: SliderProps) {
  const [local] = splitProps(props, [
    "value",
    "onChange",
    "ariaLabel",
    "min",
    "max",
    "step",
  ]);

  return (
    <KobalteSlider
      value={[local.value]}
      onChange={(vals) => emitChange(vals, local.onChange)}
      minValue={local.min}
      maxValue={local.max}
      step={local.step}
      aria-label={local.ariaLabel}
    >
      <KobalteSlider.Track>
        <KobalteSlider.Fill />
        <KobalteSlider.Thumb>
          <KobalteSlider.Input />
        </KobalteSlider.Thumb>
      </KobalteSlider.Track>
    </KobalteSlider>
  );
}
