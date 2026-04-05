/**
 * StrokeRow — single row in the Strokes section of the Design panel.
 *
 * Shows a drag handle, color swatch (opens ColorPicker), width NumberInput,
 * alignment label, and a remove button.
 *
 * All numeric values from NumberInput are guarded with Number.isFinite()
 * before use per CLAUDE.md §11 Floating-Point Validation.
 */
import { createMemo, createSignal } from "solid-js";
import type { Color, Stroke, StrokeAlignment, StyleValue } from "../types/document";
import { ColorPicker } from "../components/color-picker";
import { colorToHex } from "../components/color-picker/color-math";
import { NumberInput } from "../components/number-input/NumberInput";
import "./StrokeRow.css";

export interface StrokeRowProps {
  readonly stroke: Stroke;
  readonly index: number;
  readonly onUpdate: (index: number, stroke: Stroke) => void;
  readonly onRemove: (index: number) => void;
}

// ── Alignment label ────────────────────────────────────────────────────

function alignmentLabel(alignment: StrokeAlignment): string {
  switch (alignment) {
    case "inside":
      return "Inside";
    case "outside":
      return "Outside";
    case "center":
      return "Center";
  }
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

// ── Swatch background ──────────────────────────────────────────────────

function swatchBackground(stroke: Stroke): string {
  if (stroke.color.type === "literal") {
    return colorToHex(stroke.color.value);
  }
  return "var(--surface-4)";
}

// ── StrokeRow component ────────────────────────────────────────────────

export function StrokeRow(props: StrokeRowProps) {
  const [open, setOpen] = createSignal(false);

  const currentColor = createMemo(() => strokeColor(props.stroke));
  const widthValue = createMemo(() => strokeWidthValue(props.stroke));
  const background = createMemo(() => swatchBackground(props.stroke));
  const alignment = createMemo(() => alignmentLabel(props.stroke.alignment));

  const swatchAriaLabel = createMemo(() => (open() ? "Close color picker" : "Edit stroke color"));

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

  const swatchTrigger = (
    <button
      class="sigil-stroke-row__swatch"
      style={{ background: background() }}
      aria-label={swatchAriaLabel()}
      type="button"
      onClick={() => setOpen((v) => !v)}
    />
  );

  return (
    <div class="sigil-stroke-row">
      {/* Drag handle — decorative, hidden from screen readers */}
      <span class="sigil-stroke-row__handle" aria-hidden="true">
        ☰
      </span>

      <ColorPicker
        color={currentColor()}
        onColorChange={handleColorChange}
        trigger={swatchTrigger}
      />

      <div class="sigil-stroke-row__width">
        <NumberInput
          value={widthValue()}
          onValueChange={handleWidthChange}
          aria-label="Stroke width"
          step={1}
          min={0}
        />
      </div>

      <span class="sigil-stroke-row__alignment">{alignment()}</span>

      <button
        class="sigil-stroke-row__remove"
        type="button"
        tabindex={-1}
        aria-label="Remove stroke"
        onClick={handleRemove}
      >
        ×
      </button>
    </div>
  );
}
