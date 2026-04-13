/**
 * FillRow — single row in the Fills section of the Design panel.
 *
 * Shows a drag handle, color swatch (opens ColorPicker popover), fill type
 * dropdown, and a remove button.
 *
 * When the fill is a gradient type, expands to show GradientControls below
 * the main row.
 *
 * Type conversion logic (per spec section 2.1):
 *   Solid -> Linear: first stop = solid color, last stop = black. Default 180deg.
 *   Solid -> Radial: same stops. Default center 0.5/0.5.
 *   Linear -> Solid: use first stop's color.
 *   Radial -> Solid: use first stop's color.
 *   Linear <-> Radial: preserve stops, apply default geometry.
 */
import { createMemo } from "solid-js";
import { Show } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { GripVertical } from "lucide-solid";
import type {
  Color,
  Fill,
  FillLinearGradient,
  FillRadialGradient,
  FillSolid,
  GradientDef,
  GradientStop,
  StyleValue,
} from "../types/document";
import { ColorSwatch } from "../components/color-picker";
import { Select } from "../components/select/Select";
import {
  stopsToLinearGradientCSS,
  pointsFromAngle,
} from "../components/gradient-editor/gradient-utils";
import { GradientControls } from "./GradientControls";
import "./FillRow.css";

export interface FillRowProps {
  readonly fill: Fill;
  readonly index: number;
  readonly onUpdate: (index: number, fill: Fill) => void;
  readonly onRemove: (index: number) => void;
  /**
   * Called when a continuous drag gesture begins inside gradient controls.
   * Parent should flush pending history buffer to start a fresh coalesce window.
   */
  readonly onDragStart?: () => void;
  /**
   * Called when a continuous drag gesture ends inside gradient controls.
   * Parent should flush the history buffer to commit the drag as one undo entry.
   */
  readonly onDragEnd?: () => void;
}

/** Default opaque black color. */
const BLACK: Color = { space: "srgb", r: 0, g: 0, b: 0, a: 1 };

/** Default gradient start/end for 180deg (top-to-bottom). */
const DEFAULT_LINEAR_ANGLE = 180;

/** Default radial gradient center. */
const DEFAULT_RADIAL_CENTER = { x: 0.5, y: 0.5 };

function solidFillColor(fill: FillSolid): Color {
  if (fill.color.type === "literal") return fill.color.value;
  return BLACK;
}

/**
 * Get the first stop's color from a gradient fill, falling back to black.
 */
function firstStopColor(gradient: GradientDef): StyleValue<Color> {
  const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);
  const first = sorted[0];
  if (first) return first.color;
  return { type: "literal", value: BLACK };
}

/**
 * Convert a fill to a solid fill using its first stop or existing color.
 */
function toSolid(fill: Fill): FillSolid {
  switch (fill.type) {
    case "solid":
      return fill;
    case "linear_gradient":
    case "radial_gradient":
      return { type: "solid", color: firstStopColor(fill.gradient) };
    case "image":
      return {
        type: "solid",
        color: { type: "literal", value: BLACK },
      };
  }
}

/**
 * Create default gradient stops from a fill's color.
 * For solid fills: first stop = solid color, last stop = black.
 * For gradients: preserve existing stops.
 */
function stopsFromFill(fill: Fill): GradientStop[] {
  switch (fill.type) {
    case "linear_gradient":
    case "radial_gradient":
      return [...fill.gradient.stops];
    case "solid": {
      const colorValue: StyleValue<Color> =
        fill.color.type === "literal" ? fill.color : { type: "literal", value: BLACK };
      return [
        { position: 0, color: colorValue },
        { position: 1, color: { type: "literal", value: BLACK } },
      ];
    }
    case "image":
      return [
        { position: 0, color: { type: "literal", value: BLACK } },
        {
          position: 1,
          color: { type: "literal", value: { space: "srgb", r: 1, g: 1, b: 1, a: 1 } },
        },
      ];
  }
}

/**
 * Convert a fill to a linear gradient fill.
 */
function toLinear(fill: Fill): FillLinearGradient {
  if (fill.type === "linear_gradient") return fill;
  const stops = stopsFromFill(fill);
  const { start, end } = pointsFromAngle(DEFAULT_LINEAR_ANGLE);
  return {
    type: "linear_gradient",
    gradient: { stops, start, end },
  };
}

/**
 * Convert a fill to a radial gradient fill.
 */
function toRadial(fill: Fill): FillRadialGradient {
  if (fill.type === "radial_gradient") return fill;
  const stops = stopsFromFill(fill);
  return {
    type: "radial_gradient",
    gradient: {
      stops,
      start: DEFAULT_RADIAL_CENTER,
      end: { x: 1, y: 0.5 },
    },
  };
}

export function FillRow(props: FillRowProps) {
  const [t] = useTransContext();

  const fillType = createMemo(() => props.fill.type);

  // Labels sourced from i18n
  const fillTypeOptions = createMemo(() => [
    { value: "solid", label: t("panels:fill.typeSolid") },
    { value: "linear_gradient", label: t("panels:fill.typeLinear") },
    { value: "radial_gradient", label: t("panels:fill.typeRadial") },
  ]);

  function handleColorChange(newColor: Color): void {
    if (props.fill.type !== "solid") return;
    const newStyleValue: StyleValue<Color> = { type: "literal", value: newColor };
    const newFill: FillSolid = { type: "solid", color: newStyleValue };
    props.onUpdate(props.index, newFill);
  }

  function handleTypeChange(newType: string): void {
    let newFill: Fill;
    switch (newType) {
      case "solid":
        newFill = toSolid(props.fill);
        break;
      case "linear_gradient":
        newFill = toLinear(props.fill);
        break;
      case "radial_gradient":
        newFill = toRadial(props.fill);
        break;
      default:
        return;
    }
    props.onUpdate(props.index, newFill);
  }

  function handleGradientUpdate(updatedFill: Fill): void {
    props.onUpdate(props.index, updatedFill);
  }

  const solidColor = createMemo(() =>
    props.fill.type === "solid" ? solidFillColor(props.fill as FillSolid) : BLACK,
  );

  /**
   * CSS gradient string for the swatch preview.
   * For solid fills, this is unused (swatch shows solid color).
   * For gradient fills, shows a mini gradient preview.
   */
  const gradientPreviewCSS = createMemo((): string | null => {
    if (props.fill.type === "solid" || props.fill.type === "image") return null;
    const sorted = [...props.fill.gradient.stops].sort((a, b) => a.position - b.position);
    return stopsToLinearGradientCSS(sorted, 90);
  });

  return (
    <div class="sigil-fill-row-container">
      <div class="sigil-fill-row">
        <span class="sigil-fill-row__handle" aria-hidden="true">
          <GripVertical size={14} />
        </span>

        <Show
          when={props.fill.type === "solid"}
          fallback={
            <span
              class="sigil-fill-row__gradient-swatch"
              style={{ background: gradientPreviewCSS() ?? "transparent" }}
              aria-hidden="true"
            />
          }
        >
          <ColorSwatch color={solidColor()} onColorChange={handleColorChange} />
        </Show>

        <Select
          options={fillTypeOptions()}
          value={fillType()}
          onValueChange={handleTypeChange}
          aria-label="Fill type"
          class="sigil-fill-row__type-select"
        />

        <button
          class="sigil-fill-row__remove"
          type="button"
          tabIndex={0}
          aria-label="Remove fill"
          onClick={() => props.onRemove(props.index)}
        >
          {"\u00D7"}
        </button>
      </div>

      {/* Gradient controls shown when fill is a gradient type */}
      <Show
        when={
          props.fill.type === "linear_gradient" || props.fill.type === "radial_gradient"
            ? (props.fill as FillLinearGradient | FillRadialGradient)
            : null
        }
      >
        {(gradientFill) => (
          <GradientControls
            fill={gradientFill()}
            onUpdate={handleGradientUpdate}
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
          />
        )}
      </Show>
    </div>
  );
}
