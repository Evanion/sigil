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
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import type { Color } from "../../types/document";
import type { ColorSpace } from "./types";
import {
  colorToSrgb,
  colorAlpha,
  srgbToHex,
  isOutOfSrgbGamut,
  hsvToSrgb,
  srgbToHsv,
} from "./color-math";
import { ColorArea } from "./ColorArea";
import { HueStrip } from "./HueStrip";
import { AlphaStrip } from "./AlphaStrip";
import { ColorSpaceSwitcher } from "./ColorSpaceSwitcher";
import { ColorValueFields } from "./ColorValueFields";
import { HexInput } from "./HexInput";
import "./ColorPicker.css";

export interface ColorPickerProps {
  readonly color: Color;
  readonly onColorChange: (color: Color) => void;
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
    // RF-033: Guard against NaN/Infinity from color conversion.
    if (
      !Number.isFinite(r) ||
      !Number.isFinite(g) ||
      !Number.isFinite(b) ||
      !Number.isFinite(alpha)
    )
      return;
    // Derive hue from RGB (HSV model). Only update hue if the color has
    // saturation — preserve the previous hue for greys/achromatic colors.
    const [h, svS] = srgbToHsv(r, g, b);
    // RF-019: Read state.hue inside untrack to avoid creating a reactive loop
    const prevHue = untrack(() => state.hue);
    const newHue = svS > 0.001 ? h : prevHue;
    // Don't overwrite the display space — it's a local UI preference,
    // not part of the color value. Only update r/g/b/alpha/hue.
    setState({ r, g, b, alpha, hue: newHue });
  });

  // ── Emit helper ────────────────────────────────────────────────────────
  // Guard: suppress initial emit during mount. queueMicrotask fires after
  // all synchronous createEffect tracking runs, so mounted=false correctly
  // prevents the sync effect's emit. This is intentional timing — if effects
  // are restructured, verify this guard still works.
  let mounted = false;
  queueMicrotask(() => {
    mounted = true;
  });

  // Throttle color change emissions to avoid overwhelming the store.
  // During drag, emit at most once per animation frame.
  let emitPending = false;
  let pendingColor: { r: number; g: number; b: number; alpha: number; space: ColorSpace } | null =
    null;

  function flushEmit() {
    emitPending = false;
    if (pendingColor) {
      const { r, g, b, alpha } = pendingColor;
      pendingColor = null;
      // Always emit as sRGB — the display space is for the UI fields only,
      // not for storage. The canvas renderer and serialization expect sRGB.
      props.onColorChange({ space: "srgb", r, g, b, a: alpha });
    }
  }

  function emit(r: number, g: number, b: number, alpha: number) {
    if (!mounted) return;
    pendingColor = { r, g, b, alpha, space: "srgb" };
    if (!emitPending) {
      emitPending = true;
      requestAnimationFrame(flushEmit);
    }
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
  // RF-034: This createMemo intentionally returns a new function reference
  // Fast CSS-gradient-based background (GPU-accelerated, no per-pixel math).
  // Uses the classic HSV-style overlay: white→hue horizontal, transparent→black vertical.
  // This is an approximation (not perceptually uniform like OkLCH pixel render)
  // but is instant and matches Figma's color area performance.
  const renderAreaBackground = createMemo(() => {
    const hue = state.hue;
    // Compute the pure hue color at full saturation for the right edge (HSV: S=1, V=1)
    const [hr, hg, hb] = hsvToSrgb(hue, 1, 1);
    const hueHex = srgbToHex(hr, hg, hb);

    return (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      // White-to-hue horizontal gradient
      const hGrad = ctx.createLinearGradient(0, 0, width, 0);
      hGrad.addColorStop(0, "#ffffff");
      hGrad.addColorStop(1, hueHex);
      ctx.fillStyle = hGrad;
      ctx.fillRect(0, 0, width, height);

      // Transparent-to-black vertical overlay
      const vGrad = ctx.createLinearGradient(0, 0, 0, height);
      vGrad.addColorStop(0, "rgba(0,0,0,0)");
      vGrad.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = vGrad;
      ctx.fillRect(0, 0, width, height);
    };
  });

  // ── ColorArea x/y position (HSV-based) ──────────────────────────────
  // x = saturation (0–1), y = value/brightness (0=black at bottom, 1=bright at top)
  // HSV is always in-gamut for sRGB — no curved boundary issues.
  const areaPos = createMemo(() => {
    // Convert sRGB to HSV to get saturation and value
    const [, s, v] = srgbToHsv(state.r, state.g, state.b);
    return { x: s, y: v };
  });

  // ── ColorArea change handler (HSV-based) ───────────────────────────────
  function handleAreaChange(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // x = saturation, y = value (brightness)
    const [nr, ng, nb] = hsvToSrgb(state.hue, x, y);
    setState({ r: nr, g: ng, b: nb });
    emit(nr, ng, nb, state.alpha);
  }

  // ── Hue strip change handler ───────────────────────────────────────────
  function handleHueChange(hue: number) {
    if (!Number.isFinite(hue)) return;
    // Rotate hue while preserving saturation and value (HSV).
    const { x: s, y: v } = areaPos();
    const [nr, ng, nb] = hsvToSrgb(hue, s, v);
    setState({ r: nr, g: ng, b: nb, hue });
    emit(nr, ng, nb, state.alpha);
  }

  // ── Alpha strip change handler ─────────────────────────────────────────
  function handleAlphaChange(alpha: number) {
    if (!Number.isFinite(alpha)) return;
    setState({ alpha });
    emit(state.r, state.g, state.b, alpha);
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
    // Derive hue from HSV — preserve previous hue for achromatic colors
    const [derivedH, derivedS] = srgbToHsv(r, g, b);
    const h = derivedS > 0.001 ? derivedH : state.hue;
    setState({ r, g, b, alpha, hue: h });
    emit(r, g, b, alpha);
    commitColor();
  }

  // ── HexInput change handler ────────────────────────────────────────────
  function handleHexChange(r: number, g: number, b: number) {
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return;
    // Derive hue from HSV — preserve previous hue for achromatic colors
    const [derivedH, derivedS] = srgbToHsv(r, g, b);
    const h = derivedS > 0.001 ? derivedH : state.hue;
    setState({ r, g, b, hue: h });
    emit(r, g, b, state.alpha);
    commitColor();
  }

  // ── ColorSpace change handler ──────────────────────────────────────────
  // Only changes the display space; internal sRGB state is unchanged.
  function handleSpaceChange(space: ColorSpace) {
    // Only update the display space — don't emit a color change.
    // The color value stays the same (sRGB internally), only the
    // numeric field labels/ranges change.
    setState({ space });
  }

  // ── Alpha CSS color string for AlphaStrip ─────────────────────────────
  const alphaCss = createMemo(() => srgbToHex(state.r, state.g, state.b));

  // ── Out-of-gamut detection ─────────────────────────────────────────────
  const outOfGamut = createMemo(() => isOutOfSrgbGamut(props.color));

  return (
    <div class="sigil-color-picker" aria-label="Color picker">
      <ColorArea
        xValue={areaPos().x}
        yValue={areaPos().y}
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
  );
}
