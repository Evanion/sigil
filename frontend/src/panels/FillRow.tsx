/**
 * FillRow — single row in the Fills section of the Design panel.
 *
 * Shows a drag handle, color swatch (opens ColorPicker), fill type label,
 * and a remove button. Solid fills expose the ColorPicker; gradient and image
 * fills show the swatch as a visual preview only (editing those types is out
 * of scope for this task).
 *
 * The color swatch background is set inline; all numeric values interpolated
 * into CSS strings are guarded with Number.isFinite() per CLAUDE.md §11.
 */
import { createMemo, createSignal } from "solid-js";
import type { Color, Fill, FillSolid, StyleValue } from "../types/document";
import { ColorPicker } from "../components/color-picker";
import { colorToHex } from "../components/color-picker/color-math";
import "./FillRow.css";

export interface FillRowProps {
  readonly fill: Fill;
  readonly index: number;
  readonly onUpdate: (index: number, fill: Fill) => void;
  readonly onRemove: (index: number) => void;
}

// ── Fill type label ────────────────────────────────────────────────────

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

// ── Swatch background style ────────────────────────────────────────────

/**
 * Returns an inline CSS background string for the swatch.
 * All numeric values are validated with Number.isFinite() before CSS
 * interpolation (CLAUDE.md §11 Floating-Point Validation).
 */
function swatchBackground(fill: Fill): string {
  switch (fill.type) {
    case "solid": {
      if (fill.color.type === "literal") {
        return colorToHex(fill.color.value);
      }
      // token_ref — cannot resolve to a color without the token store, show placeholder
      return "var(--surface-4)";
    }
    case "linear_gradient": {
      const stops = fill.gradient.stops;
      if (stops.length === 0) return "var(--surface-4)";
      const parts = stops
        .map((stop) => {
          const positionPct = Number.isFinite(stop.position) ? stop.position * 100 : 0;
          if (stop.color.type === "literal") {
            return `${colorToHex(stop.color.value)} ${positionPct}%`;
          }
          return `var(--surface-4) ${positionPct}%`;
        })
        .join(", ");
      return `linear-gradient(to right, ${parts})`;
    }
    case "radial_gradient": {
      const stops = fill.gradient.stops;
      if (stops.length === 0) return "var(--surface-4)";
      const parts = stops
        .map((stop) => {
          const positionPct = Number.isFinite(stop.position) ? stop.position * 100 : 0;
          if (stop.color.type === "literal") {
            return `${colorToHex(stop.color.value)} ${positionPct}%`;
          }
          return `var(--surface-4) ${positionPct}%`;
        })
        .join(", ");
      return `radial-gradient(circle, ${parts})`;
    }
    case "image": {
      // Gray placeholder for image fills — no numeric interpolation
      return "var(--surface-4)";
    }
  }
}

// ── Solid fill color extraction ────────────────────────────────────────

function solidFillColor(fill: FillSolid): Color {
  if (fill.color.type === "literal") {
    return fill.color.value;
  }
  // token_ref — return a fallback opaque black
  return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
}

// ── FillRow component ──────────────────────────────────────────────────

export function FillRow(props: FillRowProps) {
  // Track popover open state so the swatch aria-label can reflect it
  const [open, setOpen] = createSignal(false);

  const label = createMemo(() => fillTypeLabel(props.fill));

  const background = createMemo(() => swatchBackground(props.fill));

  /**
   * Called when the ColorPicker emits a new color.
   * Only applicable for solid fills.
   */
  function handleColorChange(newColor: Color): void {
    if (props.fill.type !== "solid") return;
    const newStyleValue: StyleValue<Color> = { type: "literal", value: newColor };
    const newFill: FillSolid = { type: "solid", color: newStyleValue };
    props.onUpdate(props.index, newFill);
  }

  function handleRemove(): void {
    props.onRemove(props.index);
  }

  /**
   * Swatch element — passed as the ColorPicker trigger for solid fills.
   * For non-solid fills, it is a non-interactive visual preview (still a button
   * for accessibility, but with no popover).
   */
  const swatchAriaLabel = createMemo(() =>
    open() ? "Close color picker" : `Edit ${label()} fill color`,
  );

  // ── Solid fill branch — ColorPicker-connected swatch ────────────────
  if (props.fill.type === "solid") {
    const solidColor = createMemo(() =>
      props.fill.type === "solid"
        ? solidFillColor(props.fill as FillSolid)
        : { space: "srgb" as const, r: 0, g: 0, b: 0, a: 1 },
    );

    const swatchTrigger = (
      <button
        class="sigil-fill-row__swatch"
        style={{ background: background() }}
        aria-label={swatchAriaLabel()}
        type="button"
        onClick={() => setOpen((v) => !v)}
      />
    );

    return (
      <div class="sigil-fill-row">
        {/* Drag handle — decorative, hidden from screen readers */}
        <span class="sigil-fill-row__handle" aria-hidden="true">
          ☰
        </span>

        <ColorPicker
          color={solidColor()}
          onColorChange={handleColorChange}
          trigger={swatchTrigger}
        />

        <span class="sigil-fill-row__type">{label()}</span>

        <button
          class="sigil-fill-row__remove"
          type="button"
          tabindex={-1}
          aria-label="Remove fill"
          onClick={handleRemove}
        >
          ×
        </button>
      </div>
    );
  }

  // ── Non-solid fills (gradient, image) — swatch is preview-only ──────
  return (
    <div class="sigil-fill-row">
      <span class="sigil-fill-row__handle" aria-hidden="true">
        ☰
      </span>

      <button
        class="sigil-fill-row__swatch"
        style={{ background: background() }}
        aria-label={`${label()} fill preview`}
        type="button"
        disabled
      />

      <span class="sigil-fill-row__type">{label()}</span>

      <button
        class="sigil-fill-row__remove"
        type="button"
        tabindex={-1}
        aria-label="Remove fill"
        onClick={handleRemove}
      >
        ×
      </button>
    </div>
  );
}
