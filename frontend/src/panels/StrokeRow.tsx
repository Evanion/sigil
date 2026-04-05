/**
 * StrokeRow — single row in the Strokes section of the Design panel.
 *
 * Shows a drag handle, color swatch (opens ColorPicker), width NumberInput,
 * alignment label, and a remove button.
 *
 * All numeric values from NumberInput are guarded with Number.isFinite()
 * before use per CLAUDE.md §11 Floating-Point Validation.
 */
import { createMemo } from "solid-js";
import type { Color, Stroke, StrokeAlignment, StyleValue } from "../types/document";
import { GripVertical } from "lucide-solid";
import { ColorSwatch } from "../components/color-picker";
import { NumberInput } from "../components/number-input/NumberInput";
import "./StrokeRow.css";

// ── Alignment options ───────────────────────────────────────────────────

const ALIGNMENT_OPTIONS: readonly { value: StrokeAlignment; label: string }[] = [
  { value: "inside", label: "Inside" },
  { value: "center", label: "Center" },
  { value: "outside", label: "Outside" },
];

export interface StrokeRowProps {
  readonly stroke: Stroke;
  readonly index: number;
  readonly onUpdate: (index: number, stroke: Stroke) => void;
  readonly onRemove: (index: number) => void;
}

// ── Color extraction ───────────────────────────────────────────────────

function strokeColor(stroke: Stroke): Color {
  if (stroke.color.type === "literal") {
    return stroke.color.value;
  }
  // token_ref — return a fallback opaque black; cannot resolve without token store
  return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
}

// ── Width extraction ───────────────────────────────────────────────────

/**
 * Returns the stroke width as a number for display.
 * If the width is a token_ref, returns 0 (the token value is not available
 * at this level without a token store — the UI shows 0 as a placeholder).
 */
function strokeWidthValue(stroke: Stroke): number {
  if (stroke.width.type === "literal") {
    const v = stroke.width.value;
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

// ── StrokeRow component ────────────────────────────────────────────────

export function StrokeRow(props: StrokeRowProps) {
  const currentColor = createMemo(() => strokeColor(props.stroke));
  const widthValue = createMemo(() => strokeWidthValue(props.stroke));

  function handleAlignmentChange(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value;
    if (!ALIGNMENT_OPTIONS.some((o) => o.value === value)) return;
    props.onUpdate(props.index, { ...props.stroke, alignment: value as StrokeAlignment });
  }

  function handleColorChange(newColor: Color): void {
    const newColorValue: StyleValue<Color> = { type: "literal", value: newColor };
    props.onUpdate(props.index, { ...props.stroke, color: newColorValue });
  }

  function handleWidthChange(newWidth: number): void {
    // Number.isFinite guard: NumberInput already guards, but enforce here too
    if (!Number.isFinite(newWidth)) return;
    const newWidthValue: StyleValue<number> = { type: "literal", value: newWidth };
    props.onUpdate(props.index, { ...props.stroke, width: newWidthValue });
  }

  function handleRemove(): void {
    props.onRemove(props.index);
  }

  return (
    <div class="sigil-stroke-row">
      {/* Drag handle — decorative, hidden from screen readers */}
      <span class="sigil-stroke-row__handle" aria-hidden="true">
        <GripVertical size={14} />
      </span>

      <ColorSwatch color={currentColor()} onColorChange={handleColorChange} />

      <div class="sigil-stroke-row__width">
        <NumberInput
          value={widthValue()}
          onValueChange={handleWidthChange}
          aria-label="Stroke width"
          step={1}
          min={0}
        />
      </div>

      <select
        class="sigil-stroke-row__alignment"
        value={props.stroke.alignment}
        onChange={handleAlignmentChange}
        aria-label="Stroke alignment"
      >
        {ALIGNMENT_OPTIONS.map((opt) => (
          <option value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <button
        class="sigil-stroke-row__remove"
        type="button"
        tabIndex={-1}
        aria-label="Remove stroke"
        onClick={handleRemove}
      >
        ×
      </button>
    </div>
  );
}
