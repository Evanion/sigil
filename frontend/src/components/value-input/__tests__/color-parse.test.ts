import { describe, it, expect } from "vitest";
import { parseHexColor, colorToHex } from "../color-parse";
import type { ColorSrgb, ColorOklch, ColorOklab } from "../../../types/document";

// ── Tolerance for floating-point comparisons ──────────────────────────

const EPSILON = 1e-4;

function approx(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) <= eps;
}

// ── parseHexColor ─────────────────────────────────────────────────────

describe("parseHexColor — #RRGGBB", () => {
  it("should parse #000000 as black with full alpha", () => {
    const result = parseHexColor("#000000");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.space).toBe("srgb");
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
    expect(result.a).toBe(1);
  });

  it("should parse #ffffff as white with full alpha", () => {
    const result = parseHexColor("#ffffff");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(approx(result.r, 1)).toBe(true);
    expect(approx(result.g, 1)).toBe(true);
    expect(approx(result.b, 1)).toBe(true);
    expect(result.a).toBe(1);
  });

  it("should parse #0d99ff correctly", () => {
    const result = parseHexColor("#0d99ff");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(approx(result.r, 13 / 255)).toBe(true);
    expect(approx(result.g, 153 / 255)).toBe(true);
    expect(approx(result.b, 255 / 255)).toBe(true);
    expect(result.a).toBe(1);
  });

  it("should parse uppercase hex #FF0000", () => {
    const result = parseHexColor("#FF0000");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(approx(result.r, 1)).toBe(true);
    expect(approx(result.g, 0)).toBe(true);
    expect(approx(result.b, 0)).toBe(true);
  });

  it("should parse hex without leading # (#RRGGBB without #)", () => {
    const result = parseHexColor("ff0000");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(approx(result.r, 1)).toBe(true);
  });
});

describe("parseHexColor — #RGB (shorthand)", () => {
  it("should expand #f0a to #ff00aa", () => {
    const result = parseHexColor("#f0a");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(approx(result.r, 1)).toBe(true);
    expect(approx(result.g, 0)).toBe(true);
    expect(approx(result.b, 170 / 255)).toBe(true);
    expect(result.a).toBe(1);
  });

  it("should expand #fff to white", () => {
    const result = parseHexColor("#fff");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(approx(result.r, 1)).toBe(true);
    expect(approx(result.g, 1)).toBe(true);
    expect(approx(result.b, 1)).toBe(true);
    expect(result.a).toBe(1);
  });

  it("should expand #000 to black", () => {
    const result = parseHexColor("#000");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });
});

describe("parseHexColor — #RRGGBBAA", () => {
  it("should parse #0d99ff80 with 50% alpha", () => {
    const result = parseHexColor("#0d99ff80");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(approx(result.r, 13 / 255)).toBe(true);
    expect(approx(result.g, 153 / 255)).toBe(true);
    expect(approx(result.b, 1)).toBe(true);
    expect(approx(result.a, 128 / 255)).toBe(true);
  });

  it("should parse #ffffff00 with 0 alpha (fully transparent)", () => {
    const result = parseHexColor("#ffffff00");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.a).toBe(0);
  });

  it("should parse #ffffffff with full alpha", () => {
    const result = parseHexColor("#ffffffff");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(approx(result.a, 1)).toBe(true);
  });
});

describe("parseHexColor — invalid inputs return null", () => {
  it("should return null for empty string", () => {
    expect(parseHexColor("")).toBeNull();
  });

  it("should return null for bare #", () => {
    expect(parseHexColor("#")).toBeNull();
  });

  it("should return null for invalid length #12", () => {
    expect(parseHexColor("#12")).toBeNull();
  });

  it("should return null for invalid length #12345", () => {
    expect(parseHexColor("#12345")).toBeNull();
  });

  it("should return null for non-hex characters #xyz", () => {
    expect(parseHexColor("#xyz")).toBeNull();
  });

  it("should return null for non-hex characters zzzzzz", () => {
    expect(parseHexColor("zzzzzz")).toBeNull();
  });

  it("should return null for NaN-producing hex (all whitespace)", () => {
    expect(parseHexColor("   ")).toBeNull();
  });

  it("should return null for too-long hex #123456789", () => {
    expect(parseHexColor("#123456789")).toBeNull();
  });
});

describe("parseHexColor — NaN guard", () => {
  it("should never produce NaN in output channels", () => {
    // Test a variety of potentially tricky inputs
    const inputs = ["#gg0000", "#00gg00", "#0000gg", "#GGGGGG"];
    for (const input of inputs) {
      const result = parseHexColor(input);
      if (result !== null) {
        expect(Number.isFinite(result.r)).toBe(true);
        expect(Number.isFinite(result.g)).toBe(true);
        expect(Number.isFinite(result.b)).toBe(true);
        expect(Number.isFinite(result.a)).toBe(true);
      }
    }
  });
});

// ── colorToHex ────────────────────────────────────────────────────────

describe("colorToHex — sRGB colors", () => {
  it("should convert sRGB red to #ff0000", () => {
    const color: ColorSrgb = { space: "srgb", r: 1, g: 0, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("#ff0000");
  });

  it("should convert sRGB black to #000000", () => {
    const color: ColorSrgb = { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("#000000");
  });

  it("should convert sRGB white to #ffffff", () => {
    const color: ColorSrgb = { space: "srgb", r: 1, g: 1, b: 1, a: 1 };
    expect(colorToHex(color)).toBe("#ffffff");
  });

  it("should produce lowercase hex", () => {
    const color: ColorSrgb = { space: "srgb", r: 0.8, g: 0.4, b: 0.2, a: 1 };
    expect(colorToHex(color)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("should round-trip through parseHexColor", () => {
    const color: ColorSrgb = { space: "srgb", r: 13 / 255, g: 153 / 255, b: 1, a: 1 };
    const hex = colorToHex(color);
    const parsed = parseHexColor(hex);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("expected non-null");
    expect(approx(parsed.r, color.r, 1 / 255)).toBe(true);
    expect(approx(parsed.g, color.g, 1 / 255)).toBe(true);
    expect(approx(parsed.b, color.b, 1 / 255)).toBe(true);
  });
});

describe("colorToHex — non-sRGB colors return empty string", () => {
  it("should return empty string for OkLCH color", () => {
    const color: ColorOklch = { space: "oklch", l: 0.5, c: 0.1, h: 200, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should return empty string for OkLab color", () => {
    const color: ColorOklab = { space: "oklab", l: 0.5, a: 0.1, b: 0.05, alpha: 1 };
    expect(colorToHex(color)).toBe("");
  });
});

describe("colorToHex — invalid channel values return empty string (no silent clamping)", () => {
  it("should return empty string when r is NaN", () => {
    const color: ColorSrgb = { space: "srgb", r: NaN, g: 0, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should return empty string when g is NaN", () => {
    const color: ColorSrgb = { space: "srgb", r: 0, g: NaN, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should return empty string when b is NaN", () => {
    const color: ColorSrgb = { space: "srgb", r: 0, g: 0, b: NaN, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should return empty string when r is Infinity", () => {
    const color: ColorSrgb = { space: "srgb", r: Infinity, g: 0, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should return empty string when r is -Infinity", () => {
    const color: ColorSrgb = { space: "srgb", r: -Infinity, g: 0, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should return empty string when r is above 1", () => {
    const color: ColorSrgb = { space: "srgb", r: 1.5, g: 0, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should return empty string when g is below 0", () => {
    const color: ColorSrgb = { space: "srgb", r: 0, g: -0.1, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should return empty string when b is above 1", () => {
    const color: ColorSrgb = { space: "srgb", r: 0, g: 0, b: 2, a: 1 };
    expect(colorToHex(color)).toBe("");
  });

  it("should accept boundary values 0 and 1 as valid", () => {
    const color: ColorSrgb = { space: "srgb", r: 0, g: 1, b: 0, a: 1 };
    expect(colorToHex(color)).toBe("#00ff00");
  });
});
