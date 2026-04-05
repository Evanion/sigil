/**
 * FillRow — single row in the Fills section of the Design panel.
 *
 * Shows a drag handle, color swatch (opens ColorPicker popover), fill type
 * label, and a remove button.
 */
import { createMemo } from "solid-js";
import type { Color, Fill, FillSolid, StyleValue } from "../types/document";
import { GripVertical } from "lucide-solid";
import { ColorSwatch } from "../components/color-picker";
import "./FillRow.css";

export interface FillRowProps {
  readonly fill: Fill;
  readonly index: number;
  readonly onUpdate: (index: number, fill: Fill) => void;
  readonly onRemove: (index: number) => void;
}

function fillTypeLabel(fill: Fill): string {
  switch (fill.type) {
    case "solid":
      return "Solid";
    case "linear_gradient":
      return "Linear";
    case "radial_gradient":
      return "Radial";
    case "image":
      return "Image";
  }
}

function solidFillColor(fill: FillSolid): Color {
  if (fill.color.type === "literal") return fill.color.value;
  return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
}

export function FillRow(props: FillRowProps) {
  const label = createMemo(() => fillTypeLabel(props.fill));

  function handleColorChange(newColor: Color): void {
    if (props.fill.type !== "solid") return;
    const newStyleValue: StyleValue<Color> = { type: "literal", value: newColor };
    const newFill: FillSolid = { type: "solid", color: newStyleValue };
    props.onUpdate(props.index, newFill);
  }

  const solidColor = createMemo(() =>
    props.fill.type === "solid"
      ? solidFillColor(props.fill as FillSolid)
      : { space: "srgb" as const, r: 0, g: 0, b: 0, a: 1 },
  );

  return (
    <div class="sigil-fill-row">
      <span class="sigil-fill-row__handle" aria-hidden="true">
        <GripVertical size={14} />
      </span>

      <ColorSwatch color={solidColor()} onColorChange={handleColorChange} />

      <span class="sigil-fill-row__type">{label()}</span>

      <button
        class="sigil-fill-row__remove"
        type="button"
        tabIndex={-1}
        aria-label="Remove fill"
        onClick={() => props.onRemove(props.index)}
      >
        ×
      </button>
    </div>
  );
}
