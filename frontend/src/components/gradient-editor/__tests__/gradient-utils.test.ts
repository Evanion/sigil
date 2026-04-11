/**
 * Tests for gradient utility functions.
 *
 * Covers: assignStopIds, interpolateStopColor, stopsToLinearGradientCSS,
 * angleFromPoints, pointsFromAngle, resolveStopColorCSS, and constant enforcement.
 */

import { describe, expect, it } from "vitest";
import type { Color, ColorSrgb, GradientStop, StyleValue } from "../../../types/document";
import {
  MAX_GRADIENT_STOPS,
  MIN_GRADIENT_STOPS,
  angleFromPoints,
  assignStopIds,
  interpolateStopColor,
  pointsFromAngle,
  resolveStopColorCSS,
  stopsToLinearGradientCSS,
} from "../gradient-utils";

// ── Helpers ─────────────────────────────────────────────────────────

function makeSrgbLiteral(r: number, g: number, b: number, a = 1): StyleValue<Color> {
  return { type: "literal", value: { space: "srgb", r, g, b, a } };
}

function makeStop(position: number, r: number, g: number, b: number, id?: string): GradientStop {
  const stop: GradientStop = {
    position,
    color: makeSrgbLiteral(r, g, b),
  };
  if (id !== undefined) {
    return { ...stop, id };
  }
  return stop;
}

// ── assignStopIds ───────────────────────────────────────────────────

describe("assignStopIds", () => {
  it("should assign unique IDs to stops without them", () => {
    const stops = [makeStop(0, 1, 0, 0), makeStop(1, 0, 0, 1)];
    const result = assignStopIds(stops);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBeDefined();
    expect(result[1].id).toBeDefined();
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("should preserve existing IDs", () => {
    const stops = [makeStop(0, 1, 0, 0, "existing-id"), makeStop(1, 0, 0, 1)];
    const result = assignStopIds(stops);

    expect(result[0].id).toBe("existing-id");
    expect(result[1].id).toBeDefined();
    expect(result[1].id).not.toBe("existing-id");
  });

  it("should not modify stop position or color", () => {
    const stops = [makeStop(0.5, 0.2, 0.4, 0.6)];
    const result = assignStopIds(stops);

    expect(result[0].position).toBe(0.5);
    expect(result[0].color).toEqual(makeSrgbLiteral(0.2, 0.4, 0.6));
  });

  it("should handle empty array", () => {
    expect(assignStopIds([])).toEqual([]);
  });

  it("should replace empty string IDs", () => {
    const stops = [makeStop(0, 1, 0, 0, "")];
    const result = assignStopIds(stops);

    expect(result[0].id).toBeDefined();
    expect(result[0].id).not.toBe("");
  });
});

// ── interpolateStopColor ────────────────────────────────────────────

describe("interpolateStopColor", () => {
  // Black (r=0,g=0,b=0,a=1) at position 0, White (r=1,g=1,b=1,a=1) at position 1
  const black = makeStop(0, 0, 0, 0);
  const white = makeStop(1, 1, 1, 1);

  it("should return first stop color at position 0", () => {
    const result = interpolateStopColor([black, white], 0);
    expect(result).toEqual({ space: "srgb", r: 0, g: 0, b: 0, a: 1 });
  });

  it("should return last stop color at position 1", () => {
    const result = interpolateStopColor([black, white], 1);
    expect(result).toEqual({ space: "srgb", r: 1, g: 1, b: 1, a: 1 });
  });

  it("should interpolate at midpoint", () => {
    const result = interpolateStopColor([black, white], 0.5) as ColorSrgb;
    expect(result.space).toBe("srgb");
    expect(result.r).toBeCloseTo(0.5);
    expect(result.g).toBeCloseTo(0.5);
    expect(result.b).toBeCloseTo(0.5);
    // Alpha is 1.0 for both stops, so midpoint alpha is also 1.0
    expect(result.a).toBeCloseTo(1.0);
  });

  it("should handle single-stop edge case", () => {
    const red = makeStop(0.5, 1, 0, 0);
    const result = interpolateStopColor([red], 0.75);
    expect(result).toEqual({ space: "srgb", r: 1, g: 0, b: 0, a: 1 });
  });

  it("should return fallback for empty stops array", () => {
    const result = interpolateStopColor([], 0.5);
    expect(result).toEqual({ space: "srgb", r: 0, g: 0, b: 0, a: 1 });
  });

  it("should return first color when position is before first stop", () => {
    const red = makeStop(0.3, 1, 0, 0);
    const blue = makeStop(0.7, 0, 0, 1);
    const result = interpolateStopColor([red, blue], 0.1);
    expect(result).toEqual({ space: "srgb", r: 1, g: 0, b: 0, a: 1 });
  });

  it("should return last color when position is after last stop", () => {
    const red = makeStop(0.3, 1, 0, 0);
    const blue = makeStop(0.7, 0, 0, 1);
    const result = interpolateStopColor([red, blue], 0.9);
    // Last stop has r=0, g=0, b=1, a=1 (blue)
    expect(result).toEqual({ space: "srgb", r: 0, g: 0, b: 1, a: 1 });
  });

  it("should handle three stops correctly", () => {
    const red = makeStop(0, 1, 0, 0);
    const green = makeStop(0.5, 0, 1, 0);
    const blue = makeStop(1, 0, 0, 1);

    // At 0.25, should be midpoint between red and green
    const result = interpolateStopColor([red, green, blue], 0.25) as ColorSrgb;
    expect(result.r).toBeCloseTo(0.5);
    expect(result.g).toBeCloseTo(0.5);
  });

  it("should handle NaN position gracefully", () => {
    const result = interpolateStopColor([black, white], NaN);
    // NaN position treated as 0, should return first stop color (black, a=1)
    expect(result).toEqual({ space: "srgb", r: 0, g: 0, b: 0, a: 1 });
  });

  it("should handle token ref stops by falling back to black", () => {
    const tokenStop: GradientStop = {
      position: 0,
      color: { type: "token_ref", name: "primary" },
    };
    const white = makeStop(1, 1, 1, 1);
    const result = interpolateStopColor([tokenStop, white], 0);
    // Token ref resolves to opaque black
    expect(result).toEqual({ space: "srgb", r: 0, g: 0, b: 0, a: 1 });
  });
});

// ── resolveStopColorCSS ─────────────────────────────────────────────

describe("resolveStopColorCSS", () => {
  it("should convert sRGB color to rgba string", () => {
    const color = makeSrgbLiteral(1, 0.5, 0, 0.8);
    const result = resolveStopColorCSS(color);
    expect(result).toBe("rgba(255, 128, 0, 0.8)");
  });

  it("should return fallback for token ref", () => {
    const color: StyleValue<Color> = { type: "token_ref", name: "primary" };
    const result = resolveStopColorCSS(color);
    expect(result).toBe("rgba(0, 0, 0, 1)");
  });

  it("should handle non-sRGB color space with fallback", () => {
    const color: StyleValue<Color> = {
      type: "literal",
      value: { space: "oklch", l: 0.5, c: 0.2, h: 120, a: 1 },
    };
    const result = resolveStopColorCSS(color);
    expect(result).toBe("rgba(0, 0, 0, 1)");
  });

  it("should guard NaN channel values", () => {
    const color = makeSrgbLiteral(NaN, 0.5, Infinity, 1);
    const result = resolveStopColorCSS(color);
    // NaN r -> 0, Infinity b -> 0, valid g -> 128, valid a -> 1
    expect(result).toBe("rgba(0, 128, 0, 1)");
  });
});

// ── stopsToLinearGradientCSS ────────────────────────────────────────

describe("stopsToLinearGradientCSS", () => {
  it("should produce correct CSS linear-gradient string", () => {
    const stops = [makeStop(0, 1, 0, 0), makeStop(1, 0, 0, 1)];
    const result = stopsToLinearGradientCSS(stops, 180);
    expect(result).toBe("linear-gradient(180deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)");
  });

  it("should use default 90deg angle when not specified", () => {
    const stops = [makeStop(0, 0, 0, 0), makeStop(1, 1, 1, 1)];
    const result = stopsToLinearGradientCSS(stops);
    expect(result).toMatch(/^linear-gradient\(90deg/);
  });

  it("should handle midpoint stops", () => {
    const stops = [makeStop(0, 1, 0, 0), makeStop(0.5, 0, 1, 0), makeStop(1, 0, 0, 1)];
    const result = stopsToLinearGradientCSS(stops);
    expect(result).toContain("50%");
  });

  it("should guard NaN angle", () => {
    const stops = [makeStop(0, 0, 0, 0)];
    const result = stopsToLinearGradientCSS(stops, NaN);
    // NaN angle should fall back to 90
    expect(result).toMatch(/^linear-gradient\(90deg/);
  });

  it("should guard NaN stop position", () => {
    const stop: GradientStop = {
      position: NaN,
      color: makeSrgbLiteral(1, 0, 0),
    };
    const result = stopsToLinearGradientCSS([stop]);
    // NaN position -> 0%
    expect(result).toContain("0%");
  });
});

// ── angleFromPoints + pointsFromAngle roundtrip ─────────────────────

describe("angleFromPoints", () => {
  it("should return 0 for a top-to-bottom gradient (toward negative Y)", () => {
    // CSS 0deg = to top, so start at bottom center, end at top center
    const angle = angleFromPoints({ x: 0.5, y: 1 }, { x: 0.5, y: 0 });
    expect(angle).toBeCloseTo(0);
  });

  it("should return 90 for a left-to-right gradient", () => {
    const angle = angleFromPoints({ x: 0, y: 0.5 }, { x: 1, y: 0.5 });
    expect(angle).toBeCloseTo(90);
  });

  it("should return 180 for a bottom-to-top gradient (toward positive Y)", () => {
    const angle = angleFromPoints({ x: 0.5, y: 0 }, { x: 0.5, y: 1 });
    expect(angle).toBeCloseTo(180);
  });

  it("should return 0 for non-finite inputs", () => {
    expect(angleFromPoints({ x: NaN, y: 0 }, { x: 1, y: 1 })).toBe(0);
    expect(angleFromPoints({ x: 0, y: Infinity }, { x: 1, y: 1 })).toBe(0);
  });
});

describe("pointsFromAngle", () => {
  it("should return top-to-bottom for 180deg", () => {
    const { start, end } = pointsFromAngle(180);
    expect(start.x).toBeCloseTo(0.5);
    expect(start.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(0.5);
    expect(end.y).toBeCloseTo(1);
  });

  it("should return left-to-right for 90deg", () => {
    const { start, end } = pointsFromAngle(90);
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(0.5);
    expect(end.x).toBeCloseTo(1);
    expect(end.y).toBeCloseTo(0.5);
  });

  it("should return default for NaN input", () => {
    const { start, end } = pointsFromAngle(NaN);
    expect(start).toEqual({ x: 0.5, y: 0 });
    expect(end).toEqual({ x: 0.5, y: 1 });
  });
});

describe("angleFromPoints + pointsFromAngle roundtrip", () => {
  const testAngles = [0, 45, 90, 135, 180, -45, -90, 270];

  for (const inputAngle of testAngles) {
    it(`should roundtrip angle ${String(inputAngle)}deg`, () => {
      const { start, end } = pointsFromAngle(inputAngle);
      const recovered = angleFromPoints(start, end);

      // Normalize both to 0-360 range for comparison
      const normalizeAngle = (a: number): number => ((a % 360) + 360) % 360;
      expect(normalizeAngle(recovered)).toBeCloseTo(normalizeAngle(inputAngle), 5);
    });
  }
});

// ── Constant enforcement tests ──────────────────────────────────────

describe("MAX_GRADIENT_STOPS constant", () => {
  it("should be 32", () => {
    expect(MAX_GRADIENT_STOPS).toBe(32);
  });

  it("should be enforceable by callers", () => {
    // Verify the constant is a positive integer usable as a limit
    expect(Number.isInteger(MAX_GRADIENT_STOPS)).toBe(true);
    expect(MAX_GRADIENT_STOPS).toBeGreaterThan(0);
  });
});

describe("MIN_GRADIENT_STOPS constant", () => {
  it("should be 2", () => {
    expect(MIN_GRADIENT_STOPS).toBe(2);
  });

  it("should be enforceable by callers", () => {
    expect(Number.isInteger(MIN_GRADIENT_STOPS)).toBe(true);
    expect(MIN_GRADIENT_STOPS).toBeGreaterThan(0);
    expect(MIN_GRADIENT_STOPS).toBeLessThan(MAX_GRADIENT_STOPS);
  });
});
