/**
 * ColorValueFields — Numeric input row that adapts labels and ranges to the
 * active color space.
 *
 * All internal values are stored and communicated in sRGB [0, 1]. The
 * component converts display values to sRGB when calling onChange, and
 * converts from sRGB to the display space for rendering.
 *
 * Guard: every value received from NumberInput is checked with
 * Number.isFinite() before use (CLAUDE.md §11 Floating-Point Validation).
 */
import { createMemo, For } from "solid-js";
import { NumberInput } from "../number-input/NumberInput";
import { srgbToOklab, srgbToOklch, oklabToSrgb, oklchToSrgb } from "./color-math";
import type { ColorSpace } from "./types";
import "./ColorPicker.css";

export interface ColorValueFieldsProps {
  /** Red channel in sRGB [0, 1]. */
  r: number;
  /** Green channel in sRGB [0, 1]. */
  g: number;
  /** Blue channel in sRGB [0, 1]. */
  b: number;
  /** Alpha in [0, 1]. */
  alpha: number;
  /** Active color space controlling labels, ranges, and conversions. */
  space: ColorSpace;
  /** Called with the new sRGB+alpha values whenever any field changes. */
  onChange: (r: number, g: number, b: number, alpha: number) => void;
}

interface FieldDef {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export function ColorValueFields(props: ColorValueFieldsProps) {
  const fields = createMemo<FieldDef[]>(() => {
    const { r, g, b, alpha } = props;
    const alphaField: FieldDef = {
      label: "A",
      value: Math.round(alpha * 100),
      min: 0,
      max: 100,
      step: 1,
    };

    switch (props.space) {
      case "srgb":
      case "display_p3":
        return [
          { label: "R", value: Math.round(r * 255), min: 0, max: 255, step: 1 },
          { label: "G", value: Math.round(g * 255), min: 0, max: 255, step: 1 },
          { label: "B", value: Math.round(b * 255), min: 0, max: 255, step: 1 },
          alphaField,
        ];

      case "oklch": {
        const [l, c, h] = srgbToOklch(r, g, b);
        return [
          { label: "L", value: Math.round(l * 100 * 10) / 10, min: 0, max: 100, step: 0.1 },
          { label: "C", value: Math.round(c * 1000) / 1000, min: 0, max: 0.4, step: 0.001 },
          { label: "H", value: Math.round(h * 10) / 10, min: 0, max: 360, step: 0.1 },
          alphaField,
        ];
      }

      case "oklab": {
        const [l, aAxis, bAxis] = srgbToOklab(r, g, b);
        return [
          { label: "L", value: Math.round(l * 100 * 10) / 10, min: 0, max: 100, step: 0.1 },
          { label: "a", value: Math.round(aAxis * 1000) / 1000, min: -0.4, max: 0.4, step: 0.001 },
          { label: "b", value: Math.round(bAxis * 1000) / 1000, min: -0.4, max: 0.4, step: 0.001 },
          alphaField,
        ];
      }
    }
  });

  function handleChange(index: number, raw: number) {
    if (!Number.isFinite(raw)) return;

    const { r, g, b, alpha } = props;

    // Alpha field is always index 3.
    if (index === 3) {
      props.onChange(r, g, b, raw / 100);
      return;
    }

    switch (props.space) {
      case "srgb":
      case "display_p3": {
        // Channels are displayed as 0–255; convert back to 0–1.
        const channels: [number, number, number] = [r * 255, g * 255, b * 255];
        channels[index] = raw;
        props.onChange(channels[0] / 255, channels[1] / 255, channels[2] / 255, alpha);
        break;
      }

      case "oklch": {
        const [currentL, currentC, currentH] = srgbToOklch(r, g, b);
        const lch: [number, number, number] = [currentL, currentC, currentH];
        // L is displayed as 0–100, stored as 0–1.
        if (index === 0) lch[0] = raw / 100;
        else if (index === 1) lch[1] = raw;
        else if (index === 2) lch[2] = raw;
        const [nr, ng, nb] = oklchToSrgb(lch[0], lch[1], lch[2]);
        props.onChange(nr, ng, nb, alpha);
        break;
      }

      case "oklab": {
        const [currentL, currentA, currentB] = srgbToOklab(r, g, b);
        const lab: [number, number, number] = [currentL, currentA, currentB];
        // L is displayed as 0–100, stored as 0–1.
        if (index === 0) lab[0] = raw / 100;
        else if (index === 1) lab[1] = raw;
        else if (index === 2) lab[2] = raw;
        const [nr, ng, nb] = oklabToSrgb(lab[0], lab[1], lab[2]);
        props.onChange(nr, ng, nb, alpha);
        break;
      }
    }
  }

  return (
    <div class="sigil-color-value-fields" role="group" aria-label="Color channel values">
      <For each={fields()}>
        {(field, i) => (
          <div class="sigil-color-value-fields__field">
            <span class="sigil-color-value-fields__label" aria-hidden="true">
              {field.label}
            </span>
            <NumberInput
              value={field.value}
              onValueChange={(val) => handleChange(i(), val)}
              min={field.min}
              max={field.max}
              step={field.step}
              aria-label={field.label}
            />
          </div>
        )}
      </For>
    </div>
  );
}
