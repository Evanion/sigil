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
import type { Stroke, StrokeAlignment, Token } from "../types/document";
import { GripVertical } from "lucide-solid";
import ValueInput from "../components/value-input/ValueInput";
import {
  formatColorStyleValue,
  formatNumberStyleValue,
  parseColorInput,
  parseNumberInput,
} from "./panel-value-helpers";
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
  /**
   * Token dictionary used by the color and width ValueInputs for autocomplete
   * and swatch resolution. Defaults to an empty record when omitted.
   */
  readonly tokens?: Record<string, Token>;
  /**
   * Called at gesture boundaries (ValueInput blur/commit) so the parent can
   * flush history buffers into a single undo entry.
   */
  readonly onCommit?: () => void;
}

// ── StrokeRow component ────────────────────────────────────────────────

export function StrokeRow(props: StrokeRowProps) {
  const colorDisplay = createMemo(() => formatColorStyleValue(props.stroke.color));
  const widthDisplay = createMemo(() => formatNumberStyleValue(props.stroke.width));

  function handleAlignmentChange(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value;
    if (!ALIGNMENT_OPTIONS.some((o) => o.value === value)) return;
    props.onUpdate(props.index, { ...props.stroke, alignment: value as StrokeAlignment });
  }

  function handleColorChange(raw: string): void {
    const parsed = parseColorInput(raw);
    if (!parsed) return;
    props.onUpdate(props.index, { ...props.stroke, color: parsed });
  }

  function handleColorCommit(raw: string): void {
    handleColorChange(raw);
    props.onCommit?.();
  }

  function handleWidthChange(raw: string): void {
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    // Reject negative literal widths — UX clamp at zero is a legitimate
    // affordance only for the slider-style NumberInput; typed input should
    // surface the out-of-range value rather than silently coerce it. Here we
    // simply drop the update so the model stays consistent.
    if (parsed.type === "literal" && parsed.value < 0) return;
    props.onUpdate(props.index, { ...props.stroke, width: parsed });
  }

  function handleWidthCommit(raw: string): void {
    handleWidthChange(raw);
    props.onCommit?.();
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

      <ValueInput
        value={colorDisplay()}
        onChange={handleColorChange}
        onCommit={handleColorCommit}
        tokens={props.tokens ?? {}}
        acceptedTypes={["color"]}
        aria-label="Stroke color"
      />

      <div class="sigil-stroke-row__width">
        <ValueInput
          value={widthDisplay()}
          onChange={handleWidthChange}
          onCommit={handleWidthCommit}
          tokens={props.tokens ?? {}}
          acceptedTypes={["number", "dimension"]}
          aria-label="Stroke width"
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
