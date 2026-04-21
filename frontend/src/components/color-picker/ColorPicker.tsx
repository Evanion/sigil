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
import type { ColorDisplayMode } from "./types";
import {
  colorToSrgb,
  colorAlpha,
  srgbToHex,
  isOutOfSrgbGamut,
  hsvToSrgb,
  srgbToHsv,
  srgbToHsl,
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
  /**
   * Called on discrete gesture-end events (pointerup on area/strip, blur, Enter
   * on hex input).  Use for history-tracked mutations.  `onColorChange` fires on
   * every drag tick for visual preview.
   */
  readonly onColorCommit?: () => void;
}

interface InternalState {
  r: number;
  g: number;
  b: number;
  alpha: number;
  /** Preserved HSV hue in [0, 360) so achromatic colors don't lose hue memory
   * in the HSV-driven widgets (ColorArea, HueStrip). */
  hue: number;
  /** Preserved HSL hue in [0, 360). Separate from `hue` because HSL and HSV
   * agree on hue for chromatic colors but must be tracked independently once
   * the user edits H in HSL display mode — the HSL and HSV hue wheels share
   * the same numeric range but our H-strip is HSV-based. */
  hslH: number;
  /** Preserved HSL saturation in [0, 1]. Needed so that editing H on a grey
   * color via the HSL fields does not collapse back to grey on the next render
   * (RF-D01). */
  hslS: number;
  space: ColorDisplayMode;
}

export function ColorPicker(props: ColorPickerProps) {
  // ── Internal state ─────────────────────────────────────────────────────
  // Initialise from props.color synchronously so that children (HexInput,
  // ColorValueFields, HueStrip, AlphaStrip) receive the correct sRGB values
  // on their very first render. Initialising to zeros and relying on the
  // prop-sync createEffect below to "catch up" causes a timing bug with
  // Kobalte's NumberField: its internal `createControllableSignal` captures
  // the initial `rawValue` at mount time (= 0 because zero-init state hadn't
  // caught up yet) and uses that captured value as the baseline for its own
  // reactive display state. Subsequent prop-driven updates land in the
  // controlled signal's "external" slot but never propagate to the display
  // text because Kobalte treats the first post-mount value as "initial" and
  // suppresses the update. The fix is synchronous init here, which ensures
  // the first render already has the correct values and Kobalte captures
  // them correctly. Children then render real channels on first paint while
  // HexInput (which reads props.r/g/b directly every render) matches.
  const [rawInitR, rawInitG, rawInitB] = colorToSrgb(props.color);
  const rawInitAlpha = colorAlpha(props.color);
  // RF-D06: guard initR/G/B before passing to srgbToHsv, since srgbToHsv is a
  // math helper that must guard its own domain (CLAUDE.md §11) but defence-
  // in-depth at the caller keeps the init path hardened against upstream
  // changes to colorToSrgb.
  const initR = Number.isFinite(rawInitR) ? rawInitR : 0;
  const initG = Number.isFinite(rawInitG) ? rawInitG : 0;
  const initB = Number.isFinite(rawInitB) ? rawInitB : 0;
  const initAlpha = Number.isFinite(rawInitAlpha) ? rawInitAlpha : 1;
  const [initHue] = srgbToHsv(initR, initG, initB);
  const [initHslH, initHslS] = srgbToHsl(initR, initG, initB);
  const [state, setState] = createStore<InternalState>({
    r: initR,
    g: initG,
    b: initB,
    alpha: initAlpha,
    // RF-D01: accept any finite hue on mount. Gating on saturation caused
    // near-grey seeds to lose their stored hue intent; IEEE 754 semantics
    // already default NaN through Number.isFinite.
    hue: Number.isFinite(initHue) ? initHue : 0,
    hslH: Number.isFinite(initHslH) ? initHslH : 0,
    hslS: Number.isFinite(initHslS) ? initHslS : 0,
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
    const [hlH, hlS] = srgbToHsl(r, g, b);
    // RF-019: Read state.* inside untrack to avoid creating a reactive loop
    const prevHue = untrack(() => state.hue);
    const prevHslH = untrack(() => state.hslH);
    const prevHslS = untrack(() => state.hslS);
    const newHue = svS > 0 ? h : prevHue;
    // RF-D01: preserve HSL hue/saturation memory across achromatic round-trips.
    // When the sRGB channels are flat (delta = 0), srgbToHsl returns h=0/s=0,
    // which would collapse any prior user-typed HSL values. Keep the previous
    // hslH/hslS in that case so HSL edits on grey colors persist visually
    // until the user changes chromatic channels.
    const newHslH = hlS > 0 ? hlH : prevHslH;
    const newHslS = hlS > 0 ? hlS : prevHslS;
    // Don't overwrite the display space — it's a local UI preference,
    // not part of the color value.
    setState({ r, g, b, alpha, hue: newHue, hslH: newHslH, hslS: newHslS });
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
  let pendingColor: {
    r: number;
    g: number;
    b: number;
    alpha: number;
    space: ColorDisplayMode;
  } | null = null;

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
  // The aria-live announcement ("announce") is separate from the history
  // commit ("commit") on purpose — see RF-003.
  //
  // RF-003 (Critical): `props.color` updates on every drag tick because the
  // parent writes the live value into the store during drag. If the prop-sync
  // effect called the full `commitColor()` path, `props.onColorCommit?.()`
  // would fire on every tick and flood the parent's history manager with one
  // undo entry per sub-millisecond pointer event.
  //
  // Split the concerns:
  //   - `announceCommit()` — updates the visually-hidden aria-live region
  //     only. Safe to call from the prop-sync effect; the region's content is
  //     a human-readable string whose next update simply queues one more
  //     screen-reader announcement (and the aria-live guidance in
  //     `.claude/rules/a11y-rules.md` already permits this because
  //     announcements are throttled by the user agent).
  //   - `commitColor()` — announces AND calls `props.onColorCommit?.()`.
  //     Must only run on discrete gesture-end events: pointerup on
  //     ColorArea/HueStrip/AlphaStrip, blur/Enter on HexInput, and
  //     NumberInput changes in ColorValueFields.
  const [committedColor, setCommittedColor] = createSignal("");

  function announceCommit() {
    setCommittedColor(
      `Color: ${srgbToHex(state.r, state.g, state.b)} opacity ${Math.round(state.alpha * 100)}%`,
    );
  }

  function commitColor() {
    announceCommit();
    props.onColorCommit?.();
  }

  // Initialize/update the aria-live announcement from the incoming prop.
  // This effect re-runs on every `props.color` change (including per-tick
  // drag updates), so it MUST NOT call `commitColor()` — it calls the
  // announce-only path. The discrete gesture-end handlers below call the
  // full `commitColor()` path.
  createEffect(() => {
    // Re-read props.color to track it reactively.
    const _color = props.color;
    void _color;
    announceCommit();
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

  // Tolerance for round-tripped sRGB channel comparison. ColorValueFields
  // renders sRGB channels as 0–255 integers; the round-trip back to [0, 1]
  // divides by 255, introducing a quantisation step of 1/255 ≈ 0.00392. A
  // tolerance of 1/256 allows equality detection to ignore the echo-induced
  // delta while still recognising a user change of a single integer unit.
  const CHANNEL_ECHO_TOLERANCE = 1 / 256;

  function isEcho(r: number, g: number, b: number, alpha: number | null = null): boolean {
    if (Math.abs(r - state.r) > CHANNEL_ECHO_TOLERANCE) return false;
    if (Math.abs(g - state.g) > CHANNEL_ECHO_TOLERANCE) return false;
    if (Math.abs(b - state.b) > CHANNEL_ECHO_TOLERANCE) return false;
    if (alpha !== null && Math.abs(alpha - state.alpha) > CHANNEL_ECHO_TOLERANCE) return false;
    return true;
  }

  // ── ColorValueFields change handler ───────────────────────────────────
  //
  // RF-003: Kobalte's NumberField fires `onRawValueChange` when its `rawValue`
  // prop changes from outside — not only on user input. When the parent
  // pushes a new `props.color` (which it does on every drag tick), our
  // prop-sync effect updates `state.{r,g,b,alpha}`, which re-renders
  // ColorValueFields with new channel values, which causes Kobalte to echo
  // `onRawValueChange` for each of the four fields. Without an echo gate
  // those echoes would each call `commitColor()` and produce a history entry
  // per drag tick. `isEcho()` detects round-tripped values (within the
  // quantisation tolerance for 0–255 sRGB channels) and suppresses the
  // commit in that case.
  function handleFieldsChange(
    r: number,
    g: number,
    b: number,
    alpha: number,
    hslHint?: { h: number; s: number },
  ) {
    if (
      !Number.isFinite(r) ||
      !Number.isFinite(g) ||
      !Number.isFinite(b) ||
      !Number.isFinite(alpha)
    )
      return;
    const echo = isEcho(r, g, b, alpha);
    // Derive hue from HSV — preserve previous hue for achromatic colors
    const [derivedH, derivedS] = srgbToHsv(r, g, b);
    const h = derivedS > 0 ? derivedH : state.hue;
    // RF-D01: Accept the caller's HSL intent directly when provided.
    // ColorValueFields sends the *target* H/S chosen by the user in HSL mode
    // so we can preserve them across the round-trip even when the resulting
    // sRGB is achromatic (e.g. H=200 at S=0 still produces grey, but the user
    // meant H=200 and the next render must not reset the H field to 0).
    const hslPatch =
      hslHint !== undefined && Number.isFinite(hslHint.h) && Number.isFinite(hslHint.s)
        ? { hslH: hslHint.h, hslS: hslHint.s }
        : undefined;
    setState({ r, g, b, alpha, hue: h, ...(hslPatch ?? {}) });
    emit(r, g, b, alpha);
    if (!echo) commitColor();
  }

  // ── HexInput change handler ────────────────────────────────────────────
  //
  // RF-003: HexInput only fires `onChange` on blur or Enter — both discrete
  // commit points — so we do not expect echo behaviour here. However, the
  // hex string is reconstructed from `props.{r,g,b}` inside HexInput, and a
  // blur that occurs after a prop-echo (e.g. the user focused then clicked
  // out without editing) could produce the same round-tripped value. Apply
  // the same echo gate for safety.
  function handleHexChange(r: number, g: number, b: number) {
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return;
    const echo = isEcho(r, g, b);
    // Derive hue from HSV — preserve previous hue for achromatic colors
    const [derivedH, derivedS] = srgbToHsv(r, g, b);
    const h = derivedS > 0 ? derivedH : state.hue;
    setState({ r, g, b, hue: h });
    emit(r, g, b, state.alpha);
    if (!echo) commitColor();
  }

  // ── ColorDisplayMode change handler ────────────────────────────────────
  // Only changes the display mode; internal sRGB state is unchanged.
  function handleSpaceChange(space: ColorDisplayMode) {
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
        hslH={state.hslH}
        hslS={state.hslS}
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
