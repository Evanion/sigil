import { describe, it, expect } from "vitest";
import {
  clamp01,
  srgbToHex,
  hexToSrgb,
  srgbToOklab,
  oklabToSrgb,
  oklabToOklch,
  oklchToOklab,
  srgbToOklch,
  oklchToSrgb,
  srgbToHsl,
  hslToSrgb,
  colorToSrgb,
  srgbToColor,
  colorToHex,
  isOutOfSrgbGamut,
  colorAlpha,
  withAlpha,
} from "../color-math";
import type { Color, ColorSrgb, ColorOklch, ColorOklab } from "../../../types/document";

// ── Tolerance for floating-point comparisons ──────────────────────────

const EPSILON = 1e-4;

function approx(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) <= eps;
}

function approxTuple(a: readonly number[], b: readonly number[], eps = EPSILON): boolean {
  return a.length === b.length && a.every((v, i) => approx(v, b[i] ?? 0, eps));
}

// ── clamp01 ───────────────────────────────────────────────────────────

describe("clamp01", () => {
  it("should return 0 for NaN", () => {
    expect(clamp01(NaN)).toBe(0);
  });

  it("should clamp values above 1 to 1", () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(2)).toBe(1);
  });

  it("should clamp values below 0 to 0", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(-1)).toBe(0);
  });

  it("should pass through values in [0, 1] unchanged", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });
});

// ── srgbToHex ─────────────────────────────────────────────────────────

describe("srgbToHex", () => {
  it("should convert black to #000000", () => {
    expect(srgbToHex(0, 0, 0)).toBe("#000000");
  });

  it("should convert white to #ffffff", () => {
    expect(srgbToHex(1, 1, 1)).toBe("#ffffff");
  });

  it("should convert blue #0d99ff", () => {
    // 0x0d = 13, 0x99 = 153, 0xff = 255
    const r = 13 / 255;
    const g = 153 / 255;
    const b = 255 / 255;
    expect(srgbToHex(r, g, b)).toBe("#0d99ff");
  });

  it("should clamp out-of-range inputs before hex encoding", () => {
    // r=2 clamps to 1.0 (0xff), g=-1 clamps to 0.0 (0x00),
    // b=0.5 -> Math.round(0.5 * 255) = Math.round(127.5) = 128 = 0x80
    expect(srgbToHex(2, -1, 0.5)).toBe("#ff0080");
  });

  it("should produce lowercase hex digits", () => {
    expect(srgbToHex(0.6784313725490196, 0.8470588235294118, 0.9019607843137255)).toMatch(
      /^#[0-9a-f]{6}$/,
    );
  });
});

// ── hexToSrgb ─────────────────────────────────────────────────────────

describe("hexToSrgb", () => {
  it("should parse a 6-char hex string", () => {
    const result = hexToSrgb("#0d99ff");
    expect(result).not.toBeNull();
    if (result === null) throw new Error("expected non-null result");
    expect(approxTuple(result, [13 / 255, 153 / 255, 255 / 255])).toBe(true);
  });

  it("should parse a 6-char hex string without hash prefix", () => {
    const result = hexToSrgb("ff0000");
    expect(result).not.toBeNull();
    if (result === null) throw new Error("expected non-null result");
    expect(approxTuple(result, [1, 0, 0])).toBe(true);
  });

  it("should parse a 3-char hex string and expand it", () => {
    // #f0a => #ff00aa
    const result = hexToSrgb("#f0a");
    expect(result).not.toBeNull();
    if (result === null) throw new Error("expected non-null result");
    expect(approxTuple(result, [1, 0, 170 / 255])).toBe(true);
  });

  it("should return null for an invalid hex string", () => {
    expect(hexToSrgb("zzzzzz")).toBeNull();
    expect(hexToSrgb("#xyz")).toBeNull();
    expect(hexToSrgb("")).toBeNull();
    expect(hexToSrgb("#12")).toBeNull();
  });

  it("should parse black #000000", () => {
    const result = hexToSrgb("#000000");
    expect(result).not.toBeNull();
    if (result === null) throw new Error("expected non-null result");
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it("should parse white #ffffff", () => {
    const result = hexToSrgb("#ffffff");
    expect(result).not.toBeNull();
    if (result === null) throw new Error("expected non-null result");
    expect(approxTuple(result, [1, 1, 1])).toBe(true);
  });
});

// ── srgbToOklab / oklabToSrgb ─────────────────────────────────────────

describe("srgbToOklab", () => {
  it("should convert black to L≈0", () => {
    const [L, a, b] = srgbToOklab(0, 0, 0);
    expect(approx(L, 0)).toBe(true);
    expect(approx(a, 0, 1e-5)).toBe(true);
    expect(approx(b, 0, 1e-5)).toBe(true);
  });

  it("should convert white to L≈1, a≈0, b≈0", () => {
    const [L, a, b] = srgbToOklab(1, 1, 1);
    expect(approx(L, 1, 1e-4)).toBe(true);
    expect(approx(a, 0, 1e-4)).toBe(true);
    expect(approx(b, 0, 1e-4)).toBe(true);
  });

  it("should produce a round-trip for white through oklabToSrgb", () => {
    const [L, a, b] = srgbToOklab(1, 1, 1);
    const [r, g, bch] = oklabToSrgb(L, a, b);
    expect(approx(r, 1)).toBe(true);
    expect(approx(g, 1)).toBe(true);
    expect(approx(bch, 1)).toBe(true);
  });

  it("should produce a round-trip for red through oklabToSrgb", () => {
    const [L, a, b] = srgbToOklab(1, 0, 0);
    const [r, g, bch] = oklabToSrgb(L, a, b);
    expect(approx(r, 1)).toBe(true);
    expect(approx(g, 0, 1e-4)).toBe(true);
    expect(approx(bch, 0, 1e-4)).toBe(true);
  });

  it("should produce a round-trip for black through oklabToSrgb", () => {
    const [L, a, b] = srgbToOklab(0, 0, 0);
    const [r, g, bch] = oklabToSrgb(L, a, b);
    expect(approx(r, 0, 1e-4)).toBe(true);
    expect(approx(g, 0, 1e-4)).toBe(true);
    expect(approx(bch, 0, 1e-4)).toBe(true);
  });
});

describe("oklabToSrgb", () => {
  it("should clamp output channels to [0, 1]", () => {
    // Extreme OkLab values that map outside sRGB gamut
    const [r, g, b] = oklabToSrgb(0.5, 0.5, 0.5);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});

// ── oklabToOklch / oklchToOklab ───────────────────────────────────────

describe("oklabToOklch", () => {
  it("should convert achromatic color (a=0, b=0) to C=0", () => {
    const [L, C] = oklabToOklch(0.7, 0, 0);
    expect(approx(L, 0.7)).toBe(true);
    expect(approx(C, 0, 1e-10)).toBe(true);
  });

  it("should compute C as sqrt(a²+b²)", () => {
    const a = 0.1;
    const b = 0.2;
    const expectedC = Math.sqrt(a * a + b * b);
    const [, C] = oklabToOklch(0.5, a, b);
    expect(approx(C, expectedC)).toBe(true);
  });

  it("should produce H in [0, 360)", () => {
    const [, , H] = oklabToOklch(0.5, -0.1, -0.1);
    expect(H).toBeGreaterThanOrEqual(0);
    expect(H).toBeLessThan(360);
  });

  it("should round-trip through oklchToOklab for a chromatic color", () => {
    const L0 = 0.6;
    const a0 = 0.1;
    const b0 = 0.15;
    const [L, C, H] = oklabToOklch(L0, a0, b0);
    const [rL, ra, rb] = oklchToOklab(L, C, H);
    expect(approx(rL, L0)).toBe(true);
    expect(approx(ra, a0)).toBe(true);
    expect(approx(rb, b0)).toBe(true);
  });
});

describe("oklchToOklab", () => {
  it("should convert achromatic color (C=0) back to a=0, b=0", () => {
    const [L, a, b] = oklchToOklab(0.7, 0, 180);
    expect(approx(L, 0.7)).toBe(true);
    expect(approx(a, 0, 1e-10)).toBe(true);
    expect(approx(b, 0, 1e-10)).toBe(true);
  });
});

// ── srgbToOklch / oklchToSrgb ─────────────────────────────────────────

describe("srgbToOklch / oklchToSrgb round-trip", () => {
  it("should round-trip blue #0d99ff", () => {
    const r = 13 / 255;
    const g = 153 / 255;
    const b = 1;
    const [L, C, H] = srgbToOklch(r, g, b);
    const [rr, rg, rb] = oklchToSrgb(L, C, H);
    expect(approx(rr, r, 1e-3)).toBe(true);
    expect(approx(rg, g, 1e-3)).toBe(true);
    expect(approx(rb, b, 1e-3)).toBe(true);
  });

  it("should round-trip white", () => {
    const [L, C, H] = srgbToOklch(1, 1, 1);
    const [r, g, b] = oklchToSrgb(L, C, H);
    expect(approx(r, 1, 1e-3)).toBe(true);
    expect(approx(g, 1, 1e-3)).toBe(true);
    expect(approx(b, 1, 1e-3)).toBe(true);
  });
});

// ── srgbToHsl / hslToSrgb ─────────────────────────────────────────────

describe("srgbToHsl", () => {
  it("should convert black to [0, 0, 0]", () => {
    const [h, s, l] = srgbToHsl(0, 0, 0);
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(0);
  });

  it("should convert white to [0, 0, 1]", () => {
    const [h, s, l] = srgbToHsl(1, 1, 1);
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(1);
  });

  it("should convert pure red to [0, 1, 0.5]", () => {
    const [h, s, l] = srgbToHsl(1, 0, 0);
    expect(approx(h, 0)).toBe(true);
    expect(approx(s, 1)).toBe(true);
    expect(approx(l, 0.5)).toBe(true);
  });

  it("should convert pure green to [120, 1, 0.5]", () => {
    const [h, s, l] = srgbToHsl(0, 1, 0);
    expect(approx(h, 120)).toBe(true);
    expect(approx(s, 1)).toBe(true);
    expect(approx(l, 0.5)).toBe(true);
  });

  it("should convert pure blue to [240, 1, 0.5]", () => {
    const [h, s, l] = srgbToHsl(0, 0, 1);
    expect(approx(h, 240)).toBe(true);
    expect(approx(s, 1)).toBe(true);
    expect(approx(l, 0.5)).toBe(true);
  });

  it("should produce hue in [0, 360) for achromatic colors", () => {
    const [h] = srgbToHsl(0.5, 0.5, 0.5);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  // RF-D08: exercise every branch of the max === {r,g,b} cascade in round-trip.
  // The tests above only covered pure R, G, B primaries; yellow (max === r,
  // but with g at the same value) and cyan / magenta hit the other two
  // branches.
  it("should convert yellow (1, 1, 0) to [60, 1, 0.5]", () => {
    const [h, s, l] = srgbToHsl(1, 1, 0);
    expect(approx(h, 60)).toBe(true);
    expect(approx(s, 1)).toBe(true);
    expect(approx(l, 0.5)).toBe(true);
  });

  it("should convert cyan (0, 1, 1) to [180, 1, 0.5]", () => {
    const [h, s, l] = srgbToHsl(0, 1, 1);
    expect(approx(h, 180)).toBe(true);
    expect(approx(s, 1)).toBe(true);
    expect(approx(l, 0.5)).toBe(true);
  });

  it("should convert magenta (1, 0, 1) to [300, 1, 0.5]", () => {
    const [h, s, l] = srgbToHsl(1, 0, 1);
    expect(approx(h, 300)).toBe(true);
    expect(approx(s, 1)).toBe(true);
    expect(approx(l, 0.5)).toBe(true);
  });

  // RF-D02 / CLAUDE.md §11 Floating-Point Validation: every math helper must
  // guard NaN/Infinity at its entry. Verify the helper defends itself.
  it("should return [0, 0, 0] for NaN input (RF-D02 entry guard)", () => {
    expect(srgbToHsl(NaN, 0.5, 0.5)).toEqual([0, 0, 0]);
    expect(srgbToHsl(0.5, NaN, 0.5)).toEqual([0, 0, 0]);
    expect(srgbToHsl(0.5, 0.5, NaN)).toEqual([0, 0, 0]);
  });

  it("should return [0, 0, 0] for Infinity input (RF-D02 entry guard)", () => {
    expect(srgbToHsl(Infinity, 0.5, 0.5)).toEqual([0, 0, 0]);
    expect(srgbToHsl(0.5, -Infinity, 0.5)).toEqual([0, 0, 0]);
  });
});

describe("hslToSrgb", () => {
  it("should convert [0, 0, 0] back to black", () => {
    const [r, g, b] = hslToSrgb(0, 0, 0);
    expect(approx(r, 0)).toBe(true);
    expect(approx(g, 0)).toBe(true);
    expect(approx(b, 0)).toBe(true);
  });

  it("should convert [0, 0, 1] back to white", () => {
    const [r, g, b] = hslToSrgb(0, 0, 1);
    expect(approx(r, 1)).toBe(true);
    expect(approx(g, 1)).toBe(true);
    expect(approx(b, 1)).toBe(true);
  });

  it("should convert [0, 1, 0.5] to pure red", () => {
    const [r, g, b] = hslToSrgb(0, 1, 0.5);
    expect(approx(r, 1)).toBe(true);
    expect(approx(g, 0)).toBe(true);
    expect(approx(b, 0)).toBe(true);
  });

  it("should normalize negative hue to [0, 360)", () => {
    // -120 should be equivalent to 240 (blue)
    const [r, g, b] = hslToSrgb(-120, 1, 0.5);
    expect(approx(r, 0)).toBe(true);
    expect(approx(g, 0)).toBe(true);
    expect(approx(b, 1)).toBe(true);
  });

  it("should clamp out-of-range saturation and lightness", () => {
    // s=2 clamps to 1, l=-1 clamps to 0 → black
    const [r, g, b] = hslToSrgb(0, 2, -1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  // RF-D08: H=360 is the upper boundary of the [0, 360) hue range and must
  // normalise to the same color as H=0 (pure red at full sat / 0.5 lightness).
  it("should treat H=360 identically to H=0 (boundary normalisation)", () => {
    const atZero = hslToSrgb(0, 1, 0.5);
    const atThreeSixty = hslToSrgb(360, 1, 0.5);
    expect(approx(atZero[0], atThreeSixty[0])).toBe(true);
    expect(approx(atZero[1], atThreeSixty[1])).toBe(true);
    expect(approx(atZero[2], atThreeSixty[2])).toBe(true);
  });

  // RF-D02 / CLAUDE.md §11 Floating-Point Validation.
  it("should return [0, 0, 0] for NaN input (RF-D02 entry guard)", () => {
    expect(hslToSrgb(NaN, 0.5, 0.5)).toEqual([0, 0, 0]);
    expect(hslToSrgb(180, NaN, 0.5)).toEqual([0, 0, 0]);
    expect(hslToSrgb(180, 0.5, NaN)).toEqual([0, 0, 0]);
  });

  it("should return [0, 0, 0] for Infinity input (RF-D02 entry guard)", () => {
    expect(hslToSrgb(Infinity, 0.5, 0.5)).toEqual([0, 0, 0]);
    expect(hslToSrgb(180, Infinity, 0.5)).toEqual([0, 0, 0]);
  });
});

describe("srgbToHsl / hslToSrgb round-trip", () => {
  it("should round-trip red", () => {
    const [h, s, l] = srgbToHsl(1, 0, 0);
    const [r, g, b] = hslToSrgb(h, s, l);
    expect(approx(r, 1)).toBe(true);
    expect(approx(g, 0)).toBe(true);
    expect(approx(b, 0)).toBe(true);
  });

  it("should round-trip an arbitrary color (teal)", () => {
    const r0 = 0.2;
    const g0 = 0.6;
    const b0 = 0.8;
    const [h, s, l] = srgbToHsl(r0, g0, b0);
    const [r, g, b] = hslToSrgb(h, s, l);
    expect(approx(r, r0, 1e-6)).toBe(true);
    expect(approx(g, g0, 1e-6)).toBe(true);
    expect(approx(b, b0, 1e-6)).toBe(true);
  });

  // RF-D08: every branch of the srgbToHsl `max === r/g/b` cascade must
  // round-trip. Yellow hits `max === r` with g participating, cyan hits
  // `max === g`, magenta hits `max === b`. Plus an off-primary (olive) to
  // stress the `max === g` branch at non-extreme saturation.
  it("should round-trip yellow", () => {
    const [h, s, l] = srgbToHsl(1, 1, 0);
    const [r, g, b] = hslToSrgb(h, s, l);
    expect(approx(r, 1, 1e-6)).toBe(true);
    expect(approx(g, 1, 1e-6)).toBe(true);
    expect(approx(b, 0, 1e-6)).toBe(true);
  });

  it("should round-trip cyan", () => {
    const [h, s, l] = srgbToHsl(0, 1, 1);
    const [r, g, b] = hslToSrgb(h, s, l);
    expect(approx(r, 0, 1e-6)).toBe(true);
    expect(approx(g, 1, 1e-6)).toBe(true);
    expect(approx(b, 1, 1e-6)).toBe(true);
  });

  it("should round-trip magenta", () => {
    const [h, s, l] = srgbToHsl(1, 0, 1);
    const [r, g, b] = hslToSrgb(h, s, l);
    expect(approx(r, 1, 1e-6)).toBe(true);
    expect(approx(g, 0, 1e-6)).toBe(true);
    expect(approx(b, 1, 1e-6)).toBe(true);
  });

  it("should round-trip grey through achromatic path", () => {
    const [h, s, l] = srgbToHsl(0.5, 0.5, 0.5);
    const [r, g, b] = hslToSrgb(h, s, l);
    expect(approx(r, 0.5)).toBe(true);
    expect(approx(g, 0.5)).toBe(true);
    expect(approx(b, 0.5)).toBe(true);
  });
});

// ── colorToSrgb ───────────────────────────────────────────────────────

describe("colorToSrgb", () => {
  it("should return sRGB channels directly for an sRGB Color", () => {
    const color: ColorSrgb = { space: "srgb", r: 0.2, g: 0.4, b: 0.8, a: 1 };
    const [r, g, b] = colorToSrgb(color);
    expect(r).toBe(0.2);
    expect(g).toBe(0.4);
    expect(b).toBe(0.8);
  });

  it("should convert an OkLCH white (L=1, C=0, H=0) Color to sRGB ≈ [1,1,1]", () => {
    const color: ColorOklch = { space: "oklch", l: 1, c: 0, h: 0, a: 1 };
    const [r, g, b] = colorToSrgb(color);
    expect(approx(r, 1, 1e-3)).toBe(true);
    expect(approx(g, 1, 1e-3)).toBe(true);
    expect(approx(b, 1, 1e-3)).toBe(true);
  });

  it("should convert an OkLab Color via oklabToSrgb", () => {
    // Round-trip: srgb white -> oklab -> Color -> colorToSrgb -> srgb
    const [L, a, b] = srgbToOklab(1, 1, 1);
    const color: ColorOklab = { space: "oklab", l: L, a, b, alpha: 1 };
    const [r, g, bOut] = colorToSrgb(color);
    expect(approx(r, 1, 1e-3)).toBe(true);
    expect(approx(g, 1, 1e-3)).toBe(true);
    expect(approx(bOut, 1, 1e-3)).toBe(true);
  });

  it("should treat display_p3 as sRGB approximation and return its channels", () => {
    const color: Color = { space: "display_p3", r: 0.3, g: 0.5, b: 0.7, a: 1 };
    const [r, g, b] = colorToSrgb(color);
    expect(r).toBe(0.3);
    expect(g).toBe(0.5);
    expect(b).toBe(0.7);
  });
});

// ── srgbToColor ───────────────────────────────────────────────────────

describe("srgbToColor", () => {
  it("should create an oklch Color from sRGB values", () => {
    const color = srgbToColor(1, 0, 0, 1, "oklch");
    expect(color.space).toBe("oklch");
    const oklch = color as ColorOklch;
    expect(oklch.l).toBeGreaterThan(0);
    expect(oklch.a).toBe(1);
  });

  it("should create an sRGB Color with the correct channel values", () => {
    const color = srgbToColor(0.2, 0.4, 0.8, 0.5, "srgb");
    const srgb = color as ColorSrgb;
    expect(srgb.space).toBe("srgb");
    expect(srgb.r).toBe(0.2);
    expect(srgb.g).toBe(0.4);
    expect(srgb.b).toBe(0.8);
    expect(srgb.a).toBe(0.5);
  });

  it("should create an oklab Color from sRGB white", () => {
    const color = srgbToColor(1, 1, 1, 1, "oklab");
    expect(color.space).toBe("oklab");
    const oklab = color as ColorOklab;
    expect(approx(oklab.l, 1, 1e-4)).toBe(true);
    expect(oklab.alpha).toBe(1);
  });
});

// ── colorToHex ────────────────────────────────────────────────────────

describe("colorToHex", () => {
  it("should convert an sRGB red Color to #ff0000", () => {
    const color: ColorSrgb = { space: "srgb", r: 1, g: 0, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("#ff0000");
  });

  it("should convert an sRGB black Color to #000000", () => {
    const color: ColorSrgb = { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("#000000");
  });
});

// ── isOutOfSrgbGamut ──────────────────────────────────────────────────

describe("isOutOfSrgbGamut", () => {
  it("should return false for an sRGB Color with channels in [0, 1]", () => {
    const color: ColorSrgb = { space: "srgb", r: 0.5, g: 0.5, b: 0.5, a: 1 };
    expect(isOutOfSrgbGamut(color)).toBe(false);
  });

  it("should return false for OkLCH white which is within sRGB gamut", () => {
    const color: ColorOklch = { space: "oklch", l: 1, c: 0, h: 0, a: 1 };
    expect(isOutOfSrgbGamut(color)).toBe(false);
  });

  it("should return true for OkLCH color with high chroma that exceeds sRGB gamut (RF-003)", () => {
    // High chroma at medium lightness is out of sRGB gamut
    const color: ColorOklch = { space: "oklch", l: 0.5, c: 0.3, h: 150, a: 1 };
    expect(isOutOfSrgbGamut(color)).toBe(true);
  });

  it("should return true for OkLab color that maps to negative linear RGB (RF-003)", () => {
    // Large a/b values map to out-of-gamut sRGB
    const color: ColorOklab = { space: "oklab", l: 0.5, a: 0.3, b: 0.3, alpha: 1 };
    expect(isOutOfSrgbGamut(color)).toBe(true);
  });

  it("should return true for sRGB Color with negative channel", () => {
    const color: ColorSrgb = { space: "srgb", r: -0.1, g: 0.5, b: 0.5, a: 1 };
    expect(isOutOfSrgbGamut(color)).toBe(true);
  });

  it("should return true for sRGB Color with channel above 1", () => {
    const color: ColorSrgb = { space: "srgb", r: 0.5, g: 1.1, b: 0.5, a: 1 };
    expect(isOutOfSrgbGamut(color)).toBe(true);
  });
});

// ── colorAlpha ────────────────────────────────────────────────────────

describe("colorAlpha", () => {
  it("should extract alpha from an sRGB Color (field: a)", () => {
    const color: ColorSrgb = { space: "srgb", r: 1, g: 0, b: 0, a: 0.75 };
    expect(colorAlpha(color)).toBe(0.75);
  });

  it("should extract alpha from an OkLCH Color (field: a)", () => {
    const color: ColorOklch = { space: "oklch", l: 0.5, c: 0.1, h: 180, a: 0.5 };
    expect(colorAlpha(color)).toBe(0.5);
  });

  it("should extract alpha from an OkLab Color (field: alpha)", () => {
    const color: ColorOklab = { space: "oklab", l: 0.5, a: 0.1, b: 0.05, alpha: 0.3 };
    expect(colorAlpha(color)).toBe(0.3);
  });
});

// ── withAlpha ─────────────────────────────────────────────────────────

describe("withAlpha", () => {
  it("should return a new sRGB Color with updated alpha", () => {
    const color: ColorSrgb = { space: "srgb", r: 1, g: 0, b: 0, a: 1 };
    const updated = withAlpha(color, 0.5) as ColorSrgb;
    expect(updated.a).toBe(0.5);
    expect(updated.r).toBe(1);
    expect(updated.g).toBe(0);
    expect(updated.b).toBe(0);
    // original is not mutated
    expect(color.a).toBe(1);
  });

  it("should return a new OkLCH Color with updated alpha", () => {
    const color: ColorOklch = { space: "oklch", l: 0.5, c: 0.1, h: 180, a: 1 };
    const updated = withAlpha(color, 0.25) as ColorOklch;
    expect(updated.a).toBe(0.25);
    expect(updated.l).toBe(0.5);
  });

  it("should return a new OkLab Color with updated alpha field", () => {
    const color: ColorOklab = { space: "oklab", l: 0.5, a: 0.1, b: 0.05, alpha: 1 };
    const updated = withAlpha(color, 0.4) as ColorOklab;
    expect(updated.alpha).toBe(0.4);
    expect(updated.l).toBe(0.5);
  });
});
