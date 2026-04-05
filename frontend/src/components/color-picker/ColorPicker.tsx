/**
 * ColorPicker — top-level color picker popover.
 *
 * Wraps all color picker widgets (ColorArea, HueStrip, AlphaStrip,
 * ColorSpaceSwitcher, ColorValueFields, HexInput) inside a Kobalte Popover.
 *
 * Internal state is always stored as sRGB [r, g, b] + alpha [0,1] + hue [0,360].
 * The hue signal is kept separately so that dragging hue does not lose
 * information when chroma is near zero (achromatic colors have undefined hue in
 * OkLCH — preserving the last explicit hue avoids the hue snapping to 0).
 *
 * All numeric values from callbacks are guarded with Number.isFinite() before
 * use (CLAUDE.md §11 Floating-Point Validation).
 */
import { createEffect, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { Color } from "../../types/document";
import type { ColorSpace } from "./types";
import {
  colorToSrgb,
  colorAlpha,
  srgbToColor,
  srgbToOklch,
  oklchToSrgb,
  srgbToHex,
  isOutOfSrgbGamut,
} from "./color-math";
import { Popover } from "../popover/Popover";
import { ColorArea } from "./ColorArea";
import { HueStrip } from "./HueStrip";
import { AlphaStrip } from "./AlphaStrip";
import { ColorSpaceSwitcher } from "./ColorSpaceSwitcher";
import { ColorValueFields } from "./ColorValueFields";
import { HexInput } from "./HexInput";
import "./ColorPicker.css";
import type { JSX } from "solid-js";

export interface ColorPickerProps {
  readonly color: Color;
  readonly onColorChange: (color: Color) => void;
  /** The trigger element that opens the popover. */
  readonly trigger: JSX.Element;
}

interface InternalState {
  r: number;
  g: number;
  b: number;
  alpha: number;
  /** Preserved hue in [0, 360) so achromatic colors don't lose hue memory. */
  hue: number;
  space: ColorSpace;
}

export function ColorPicker(props: ColorPickerProps) {
  // ── Internal state ─────────────────────────────────────────────────────
  const [state, setState] = createStore<InternalState>({
    r: 0,
    g: 0,
    b: 0,
    alpha: 1,
    hue: 0,
    space: "srgb",
  });

  // ── Sync from props.color ──────────────────────────────────────────────
  // Reads props.color (reactive) and syncs internal signals on each change.
  createEffect(() => {
    const color = props.color;
    const [r, g, b] = colorToSrgb(color);
    const alpha = colorAlpha(color);
    // Derive hue from OkLCH; only update hue if chroma is non-trivial to
    // preserve the previous hue for achromatic colors.
    const [, c, h] = srgbToOklch(r, g, b);
    const newHue = c > 0.001 ? h : state.hue;
    setState({ r, g, b, alpha, hue: newHue, space: color.space });
  });

  // ── Emit helper ────────────────────────────────────────────────────────
  function emit(r: number, g: number, b: number, alpha: number, space: ColorSpace) {
    props.onColorChange(srgbToColor(r, g, b, alpha, space));
  }

  // ── Committed color for aria-live (RF-002) ──────────────────────────────
  // Only updated on discrete events (pointerup, blur, Enter, space change)
  // so that the aria-live region does not flood the screen reader at 60Hz.
  const [committedColor, setCommittedColor] = createSignal("");

  function commitColor() {
    setCommittedColor(
      `Color: ${srgbToHex(state.r, state.g, state.b)} opacity ${Math.round(state.alpha * 100)}%`,
    );
  }

  // Initialize the committed color from the incoming prop.
  createEffect(() => {
    // Re-read props.color to track it reactively; this fires on prop changes
    // (which are discrete events, not drag events).
    const _color = props.color;
    void _color;
    commitColor();
  });

  // ── ColorArea background render (RF-004) ─────────────────────────────
  // Renders a pixel-accurate OkLCH gradient via ImageData.
  // X-axis = chroma (0 at left to 0.2 at right).
  // Y-axis = lightness (1 at top to 0 at bottom).
  // This matches handleAreaChange which maps y->lightness, x->chroma.
  const renderAreaBackground = createMemo(() => {
    const hue = state.hue;
    return (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;

      for (let py = 0; py < height; py++) {
        // Top row = lightness 1, bottom row = lightness 0
        const lightness = 1 - py / (height - 1 || 1);
        for (let px = 0; px < width; px++) {
          const chroma = (px / (width - 1 || 1)) * 0.2;
          const [r, g, b] = oklchToSrgb(lightness, chroma, hue);
          const idx = (py * width + px) * 4;
          data[idx] = Math.round(r * 255);
          data[idx + 1] = Math.round(g * 255);
          data[idx + 2] = Math.round(b * 255);
          data[idx + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    };
  });

  // ── ColorArea x/y position (RF-006: single srgbToOklch call) ─────────
  // Map current sRGB to x (chroma normalized) and y (lightness) in OkLCH space.
  // x ≈ chroma / max-chroma (use 0.2 as typical max for in-gamut sRGB colors)
  // y ≈ lightness (OkLCH L is 0–1, top=white so y=L)
  const areaOklch = createMemo(() => {
    const [l, c, h] = srgbToOklch(state.r, state.g, state.b);
    return { x: Math.min(1, c / 0.2), y: l, l, c, h };
  });

  // ── ColorArea change handler ───────────────────────────────────────────
  // User moved the 2D color area: map x/y back to a color via OkLCH.
  function handleAreaChange(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // x = chroma (0..0.2), y = lightness (0..1)
    const c = x * 0.2;
    const l = y;
    const [nr, ng, nb] = oklchToSrgb(l, c, state.hue);
    setState({ r: nr, g: ng, b: nb });
    // Preserve hue only if chroma is non-trivial.
    const [, newC, newH] = srgbToOklch(nr, ng, nb);
    if (newC > 0.001) setState("hue", newH);
    emit(nr, ng, nb, state.alpha, state.space);
  }

  // ── Hue strip change handler ───────────────────────────────────────────
  function handleHueChange(hue: number) {
    if (!Number.isFinite(hue)) return;
    // Rotate hue while preserving L and C.
    const [l, c] = srgbToOklch(state.r, state.g, state.b);
    const [nr, ng, nb] = oklchToSrgb(l, c, hue);
    setState({ r: nr, g: ng, b: nb, hue });
    emit(nr, ng, nb, state.alpha, state.space);
  }

  // ── Alpha strip change handler ─────────────────────────────────────────
  function handleAlphaChange(alpha: number) {
    if (!Number.isFinite(alpha)) return;
    setState({ alpha });
    emit(state.r, state.g, state.b, alpha, state.space);
  }

  // ── ColorValueFields change handler ───────────────────────────────────
  function handleFieldsChange(r: number, g: number, b: number, alpha: number) {
    if (
      !Number.isFinite(r) ||
      !Number.isFinite(g) ||
      !Number.isFinite(b) ||
      !Number.isFinite(alpha)
    )
      return;
    const [, c, h] = srgbToOklch(r, g, b);
    const newHue = c > 0.001 ? h : state.hue;
    setState({ r, g, b, alpha, hue: newHue });
    emit(r, g, b, alpha, state.space);
    commitColor();
  }

  // ── HexInput change handler ────────────────────────────────────────────
  function handleHexChange(r: number, g: number, b: number) {
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return;
    const [, c, h] = srgbToOklch(r, g, b);
    const newHue = c > 0.001 ? h : state.hue;
    setState({ r, g, b, hue: newHue });
    emit(r, g, b, state.alpha, state.space);
    commitColor();
  }

  // ── ColorSpace change handler ──────────────────────────────────────────
  // Only changes the display space; internal sRGB state is unchanged.
  function handleSpaceChange(space: ColorSpace) {
    setState({ space });
    emit(state.r, state.g, state.b, state.alpha, space);
    commitColor();
  }

  // ── Alpha CSS color string for AlphaStrip ─────────────────────────────
  const alphaCss = createMemo(() => srgbToHex(state.r, state.g, state.b));

  // ── Out-of-gamut detection ─────────────────────────────────────────────
  const outOfGamut = createMemo(() => isOutOfSrgbGamut(props.color));

  return (
    <Popover trigger={props.trigger} placement="bottom" class="sigil-color-picker-popover">
      <div class="sigil-color-picker" aria-label="Color picker">
        <ColorArea
          xValue={areaOklch().x}
          yValue={areaOklch().y}
          onChange={handleAreaChange}
          onCommit={commitColor}
          renderBackground={renderAreaBackground()}
          aria-label="Color saturation and lightness"
        />
        <HueStrip
          hue={state.hue}
          onChange={handleHueChange}
          onCommit={commitColor}
          aria-label="Hue"
        />
        <AlphaStrip
          alpha={state.alpha}
          colorCss={alphaCss()}
          onChange={handleAlphaChange}
          onCommit={commitColor}
          aria-label="Opacity"
        />
        <HexInput
          r={state.r}
          g={state.g}
          b={state.b}
          isOutOfGamut={outOfGamut()}
          onChange={handleHexChange}
        />
        <ColorSpaceSwitcher value={state.space} onChange={handleSpaceChange} />
        <ColorValueFields
          r={state.r}
          g={state.g}
          b={state.b}
          alpha={state.alpha}
          space={state.space}
          onChange={handleFieldsChange}
        />
        {/* Visually-hidden live region for discrete color change announcements.
            Not placed on the picker container (high-frequency updates would
            flood the announcement queue — CLAUDE.md §11). */}
        <span
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            padding: "0",
            margin: "-1px",
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            "white-space": "nowrap",
            "border-width": "0",
          }}
        >
          {committedColor()}
        </span>
      </div>
    </Popover>
  );
}
