/**
 * color-math.ts — Pure color conversion functions (no I/O, no side-effects).
 *
 * Conversions implemented:
 *   sRGB <-> Hex
 *   sRGB <-> Linear RGB (gamma encode/decode)
 *   Linear RGB <-> OkLab (via Björn Ottosson's matrices)
 *   OkLab <-> OkLCH (polar form)
 *
 * OkLab reference: https://bottosson.github.io/posts/oklab/
 *
 * All numeric inputs from user/external sources should be validated with
 * Number.isFinite() before being passed here (see CLAUDE.md §11
 * Floating-Point Validation). The clamp01 helper guards NaN internally.
 */

import type {
  Color,
  ColorSrgb,
  ColorDisplayP3,
  ColorOklch,
  ColorOklab,
} from "../../types/document";

// ── Utility ───────────────────────────────────────────────────────────

/**
 * Clamp a value to [0, 1]. NaN maps to 0 (safe default for color math).
 * This is an explicit user-facing affordance — sliders and color channels
 * visually constrain their range, so clamping IS the intended UX here.
 */
export function clamp01(v: number): number {
  // NaN comparisons are always false, so the fallback 0 is returned
  if (!(v >= 0)) return 0;
  if (v > 1) return 1;
  return v;
}

// ── sRGB ↔ Hex ────────────────────────────────────────────────────────

/**
 * Convert sRGB channels (each in [0, 1]) to a lowercase #rrggbb hex string.
 * Inputs are clamped before encoding.
 */
export function srgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number): string => {
    const byte = Math.round(clamp01(c) * 255);
    return byte.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Parse a 3- or 6-character hex string (with or without leading #) to sRGB.
 * Returns null for any invalid input.
 */
export function hexToSrgb(hex: string): [number, number, number] | null {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;

  let normalized: string;
  if (clean.length === 3) {
    // Expand shorthand: "f0a" -> "ff00aa"
    normalized = clean
      .split("")
      .map((c) => c + c)
      .join("");
  } else if (clean.length === 6) {
    normalized = clean;
  } else {
    return null;
  }

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  const n = parseInt(normalized, 16);
  return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

// ── sRGB ↔ Linear RGB ─────────────────────────────────────────────────

/**
 * Decode a single sRGB channel to linear light (gamma decode).
 * Uses the IEC 61966-2-1 piecewise transfer function.
 */
export function srgbChannelToLinear(c: number): number {
  const v = clamp01(c);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Encode a single linear light channel to sRGB (gamma encode).
 * Uses the IEC 61966-2-1 piecewise transfer function.
 */
export function linearToSrgbChannel(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// ── Linear RGB ↔ OkLab ────────────────────────────────────────────────

/**
 * Convert sRGB [0,1] to OkLab [L, a, b].
 * Pipeline: sRGB -> linear RGB -> LMS (cube root) -> OkLab
 *
 * Matrices from https://bottosson.github.io/posts/oklab/
 */
export function srgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);

  // Linear RGB -> LMS (then cube root)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  // LMS -> OkLab
  const L = 0.2104542553 * l + 0.793617785 * m - 0.004072046800000001 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bOut = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return [L, a, bOut];
}

/**
 * Convert OkLab [L, a, b] to sRGB [r, g, b].
 * Inverse of srgbToOklab. Output is clamped to [0, 1].
 *
 * Pipeline: OkLab -> LMS (cube) -> linear RGB -> sRGB (gamma encode)
 *
 * Inverse matrices from https://bottosson.github.io/posts/oklab/
 */
export function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  // OkLab -> LMS (cube root space)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  // Cube to get linear LMS
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // Linear LMS -> linear RGB
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.004196086300000001 * l - 0.7034186147 * m + 1.707614701 * s;

  // Linear RGB -> sRGB (gamma encode), clamp output
  return [
    clamp01(linearToSrgbChannel(lr)),
    clamp01(linearToSrgbChannel(lg)),
    clamp01(linearToSrgbChannel(lb)),
  ];
}

// ── OkLab ↔ OkLCH ────────────────────────────────────────────────────

/**
 * Convert OkLab to OkLCH (polar form).
 * C = sqrt(a² + b²)
 * H = atan2(b, a) in degrees, normalized to [0, 360)
 */
export function oklabToOklch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

/**
 * Convert OkLCH to OkLab.
 * a = C * cos(H in radians)
 * b = C * sin(H in radians)
 */
export function oklchToOklab(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  return [L, a, b];
}

// ── Shortcut composites ───────────────────────────────────────────────

/** Convert sRGB to OkLCH in one step. */
export function srgbToOklch(r: number, g: number, b: number): [number, number, number] {
  return oklabToOklch(...srgbToOklab(r, g, b));
}

/** Convert OkLCH to sRGB in one step. Output clamped to [0, 1]. */
export function oklchToSrgb(L: number, C: number, H: number): [number, number, number] {
  return oklabToSrgb(...oklchToOklab(L, C, H));
}

// ── Color type helpers ────────────────────────────────────────────────

/**
 * Convert any Color variant to sRGB [r, g, b] channels.
 *
 * For display_p3: treated as sRGB approximation (channels returned as-is).
 * This is an intentional simplification — full gamut mapping is deferred.
 */
export function colorToSrgb(color: Color): [number, number, number] {
  switch (color.space) {
    case "srgb":
      return [color.r, color.g, color.b];

    case "display_p3":
      // Approximation: treat P3 channels as if they were sRGB.
      // Full P3 -> sRGB gamut mapping is deferred (Plan 09b note).
      return [color.r, color.g, color.b];

    case "oklch":
      return oklchToSrgb(color.l, color.c, color.h);

    case "oklab":
      // Note: ColorOklab uses `alpha` (not `a`) for the alpha channel
      // because `a` is the OkLab chroma-a axis.
      return oklabToSrgb(color.l, color.a, color.b);
  }
}

/**
 * Convert sRGB [r, g, b] + alpha to a Color of the target color space.
 *
 * For display_p3: channels stored as sRGB approximation (same as colorToSrgb).
 */
export function srgbToColor(
  r: number,
  g: number,
  b: number,
  alpha: number,
  space: Color["space"],
): Color {
  switch (space) {
    case "srgb": {
      const color: ColorSrgb = { space: "srgb", r, g, b, a: alpha };
      return color;
    }

    case "display_p3": {
      // Approximation: store channels as-is (same as colorToSrgb treatment).
      const color: ColorDisplayP3 = { space: "display_p3", r, g, b, a: alpha };
      return color;
    }

    case "oklch": {
      const [l, c, h] = srgbToOklch(r, g, b);
      const color: ColorOklch = { space: "oklch", l, c, h, a: alpha };
      return color;
    }

    case "oklab": {
      const [l, aAxis, bAxis] = srgbToOklab(r, g, b);
      const color: ColorOklab = { space: "oklab", l, a: aAxis, b: bAxis, alpha };
      return color;
    }
  }
}

/**
 * Convert any Color to a lowercase #rrggbb hex string.
 * Goes via colorToSrgb, so out-of-gamut values are clamped.
 */
export function colorToHex(color: Color): string {
  const [r, g, b] = colorToSrgb(color);
  return srgbToHex(r, g, b);
}

/**
 * Return true if any sRGB channel would fall outside [0, 1] when the
 * color is converted to sRGB (indicating the color is out of sRGB gamut).
 *
 * This is a pre-clamp check: it intentionally does NOT clamp before checking.
 */
export function isOutOfSrgbGamut(color: Color): boolean {
  switch (color.space) {
    case "srgb":
    case "display_p3":
      return color.r < 0 || color.r > 1 || color.g < 0 || color.g > 1 || color.b < 0 || color.b > 1;

    case "oklch": {
      const [r, g, b] = oklchToSrgbUnclamped(color.l, color.c, color.h);
      return r < 0 || r > 1 || g < 0 || g > 1 || b < 0 || b > 1;
    }

    case "oklab": {
      const [r, g, b] = oklabToSrgbUnclamped(color.l, color.a, color.b);
      return r < 0 || r > 1 || g < 0 || g > 1 || b < 0 || b > 1;
    }
  }
}

/**
 * Extract the alpha value from any Color variant.
 *
 * Note: ColorOklab uses field `alpha` (not `a`) because `a` is the
 * OkLab chroma axis. All other Color variants use `a` for alpha.
 */
export function colorAlpha(color: Color): number {
  if (color.space === "oklab") {
    return color.alpha;
  }
  return color.a;
}

/**
 * Return a new Color with the alpha channel replaced.
 * The original Color object is not mutated (all Color types are readonly).
 */
export function withAlpha(color: Color, alpha: number): Color {
  if (color.space === "oklab") {
    return { ...color, alpha };
  }
  return { ...color, a: alpha };
}

// ── Internal unclamped helpers (for gamut detection) ──────────────────

/**
 * OkLab -> linear RGB -> sRGB without clamping.
 * Used only by isOutOfSrgbGamut to detect out-of-gamut colors.
 */
function oklabToSrgbUnclamped(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.004196086300000001 * l - 0.7034186147 * m + 1.707614701 * s;

  const toSrgb = (c: number): number =>
    c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  return [toSrgb(lr), toSrgb(lg), toSrgb(lb)];
}

function oklchToSrgbUnclamped(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  return oklabToSrgbUnclamped(L, a, b);
}
