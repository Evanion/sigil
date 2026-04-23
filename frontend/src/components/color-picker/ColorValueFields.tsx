/**
 * ColorValueFields — Numeric input row that adapts labels and ranges to the
 * active color space.
 *
 * All internal values are stored and communicated in sRGB [0, 1]. The
 * component converts display values to sRGB when calling onChange, and
 * converts from sRGB to the display space for rendering.
 *
 * Guard: every value received from NumberInput is checked with
 * Number.isFinite() before use (CLAUDE.md S11 Floating-Point Validation).
 */
import { createMemo, Index } from "solid-js";
import { NumberInput } from "../number-input/NumberInput";
import { srgbToOklch, oklchToSrgb, srgbToHsl, hslToSrgb } from "./color-math";
import type { ColorDisplayMode } from "./types";
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
  space: ColorDisplayMode;
  /**
   * Preserved HSL hue [0, 360). When the current sRGB is achromatic, the HSL
   * display mode falls back to this value instead of the derived 0 so the
   * user's typed H persists across render cycles (RF-D01).
   */
  hslH?: number;
  /**
   * Preserved HSL saturation [0, 1]. Same rationale as `hslH` — preserves the
   * user's typed S across achromatic round-trips (RF-D01).
   */
  hslS?: number;
  /**
   * Called with the new sRGB+alpha values whenever any field changes.
   * In HSL display mode, also passes an `hslHint` with the target H and S so
   * the parent can preserve them across achromatic sRGB round-trips (RF-D01).
   */
  onChange: (
    r: number,
    g: number,
    b: number,
    alpha: number,
    hslHint?: { h: number; s: number },
  ) => void;
}

/** Semantic identifier for each color field (RF-008). */
type FieldId = "r" | "g" | "b" | "l" | "c" | "h" | "s" | "alpha";

interface FieldDef {
  /** Semantic identifier used for dispatch and aria-label lookup (RF-008). */
  id: FieldId;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

/** Descriptive aria-labels for each field id (RF-012). */
const FIELD_ARIA_LABELS: Record<FieldId, string> = {
  r: "Red",
  g: "Green",
  b: "Blue",
  l: "Lightness",
  c: "Chroma",
  h: "Hue",
  s: "Saturation",
  alpha: "Opacity",
};

export function ColorValueFields(props: ColorValueFieldsProps) {
  // Guard to prevent re-entrant handleChange calls when props update
  // triggers onRawValueChange on the NumberInput.
  let isUpdating = false;

  // Track the previous space so we can suppress spurious onRawValueChange
  // callbacks that fire when space changes (NumberInput re-renders with new
  // values and Kobalte fires onRawValueChange for each).
  let lastSpace: ColorDisplayMode = props.space;

  const fields = createMemo<FieldDef[]>(() => {
    const { r, g, b, alpha } = props;
    // When space changes, suppress handleChange until the next microtask
    if (props.space !== lastSpace) {
      lastSpace = props.space;
      isUpdating = true;
      queueMicrotask(() => {
        isUpdating = false;
      });
    }
    const alphaField: FieldDef = {
      id: "alpha",
      label: "A",
      value: Math.round(alpha * 100),
      min: 0,
      max: 100,
      step: 1,
    };

    switch (props.space) {
      case "srgb":
        return [
          { id: "r", label: "R", value: Math.round(r * 255), min: 0, max: 255, step: 1 },
          { id: "g", label: "G", value: Math.round(g * 255), min: 0, max: 255, step: 1 },
          { id: "b", label: "B", value: Math.round(b * 255), min: 0, max: 255, step: 1 },
          alphaField,
        ];

      case "oklch": {
        const [l, c, h] = srgbToOklch(r, g, b);
        return [
          {
            id: "l",
            label: "L",
            value: Math.round(l * 100 * 10) / 10,
            min: 0,
            max: 100,
            step: 0.1,
          },
          {
            id: "c",
            label: "C",
            value: Math.round(c * 1000) / 1000,
            min: 0,
            max: 0.4,
            step: 0.001,
          },
          { id: "h", label: "H", value: Math.round(h * 10) / 10, min: 0, max: 360, step: 0.1 },
          alphaField,
        ];
      }

      case "hsl": {
        // RF-D01: When the sRGB is achromatic, srgbToHsl returns h=0/s=0.
        // Fall back to the preserved hslH/hslS from the picker so the user's
        // typed H and S are visible in the fields instead of collapsing to 0.
        const [derivedH, derivedS, derivedL] = srgbToHsl(r, g, b);
        const isAchromatic = derivedS <= 0;
        const h = isAchromatic && props.hslH !== undefined ? props.hslH : derivedH;
        const s = isAchromatic && props.hslS !== undefined ? props.hslS : derivedS;
        return [
          { id: "h", label: "H", value: Math.round(h * 10) / 10, min: 0, max: 360, step: 0.1 },
          {
            id: "s",
            label: "S",
            value: Math.round(s * 100 * 10) / 10,
            min: 0,
            max: 100,
            step: 0.1,
          },
          {
            id: "l",
            label: "L",
            value: Math.round(derivedL * 100 * 10) / 10,
            min: 0,
            max: 100,
            step: 0.1,
          },
          alphaField,
        ];
      }
    }
  });

  /** Dispatch by field.id instead of numeric index (RF-008).
   *  Reject out-of-range values rather than clamping (RF-014, CLAUDE.md S11). */
  function handleChange(field: FieldDef, raw: number) {
    if (!Number.isFinite(raw)) return;
    if (isUpdating) return;

    // RF-014: validate range — reject rather than clamp.
    if (raw < field.min || raw > field.max) return;

    isUpdating = true;
    queueMicrotask(() => {
      isUpdating = false;
    });

    const { r, g, b, alpha } = props;

    // Alpha field — common to all spaces.
    if (field.id === "alpha") {
      props.onChange(r, g, b, raw / 100);
      return;
    }

    switch (props.space) {
      case "srgb": {
        // Channels are displayed as 0-255; convert back to 0-1.
        const channels: [number, number, number] = [r * 255, g * 255, b * 255];
        if (field.id === "r") channels[0] = raw;
        else if (field.id === "g") channels[1] = raw;
        else if (field.id === "b") channels[2] = raw;
        props.onChange(channels[0] / 255, channels[1] / 255, channels[2] / 255, alpha);
        break;
      }

      case "oklch": {
        const [currentL, currentC, currentH] = srgbToOklch(r, g, b);
        const lch: [number, number, number] = [currentL, currentC, currentH];
        if (field.id === "l") lch[0] = raw / 100;
        else if (field.id === "c") lch[1] = raw;
        else if (field.id === "h") lch[2] = raw;
        const [nr, ng, nb] = oklchToSrgb(lch[0], lch[1], lch[2]);
        props.onChange(nr, ng, nb, alpha);
        break;
      }

      case "hsl": {
        // RF-D01: Base the HSL edit on the *displayed* H/S (possibly
        // preserved via props.hslH/hslS when sRGB is achromatic), not on the
        // re-derived values from sRGB. Otherwise editing H or S on a grey
        // color silently collapses back to grey because derivedH=0/derivedS=0.
        const [derivedH, derivedS, derivedL] = srgbToHsl(r, g, b);
        const isAchromatic = derivedS <= 0;
        const baseH = isAchromatic && props.hslH !== undefined ? props.hslH : derivedH;
        const baseS = isAchromatic && props.hslS !== undefined ? props.hslS : derivedS;
        const hsl: [number, number, number] = [baseH, baseS, derivedL];
        if (field.id === "h") hsl[0] = raw;
        else if (field.id === "s") hsl[1] = raw / 100;
        else if (field.id === "l") hsl[2] = raw / 100;
        const [nr, ng, nb] = hslToSrgb(hsl[0], hsl[1], hsl[2]);
        // Pass the target H and S so the parent can preserve them even when
        // the resulting sRGB is still achromatic (S=0) or the color is grey.
        props.onChange(nr, ng, nb, alpha, { h: hsl[0], s: hsl[1] });
        break;
      }
    }
  }

  return (
    <div class="sigil-color-value-fields" role="group" aria-label="Color channel values">
      <Index each={fields()}>
        {(field) => (
          <div class="sigil-color-value-fields__field">
            <span class="sigil-color-value-fields__label" aria-hidden="true">
              {field().label}
            </span>
            <NumberInput
              value={field().value}
              onValueChange={(val) => handleChange(field(), val)}
              min={field().min}
              max={field().max}
              step={field().step}
              aria-label={FIELD_ARIA_LABELS[field().id]}
            />
          </div>
        )}
      </Index>
    </div>
  );
}
