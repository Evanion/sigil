/**
 * Tests for the canvas color → CSS fill helper.
 *
 * Mirrors the existing tests in `panels/__tests__/token-helpers.test.ts`
 * (which now re-exports `colorToCss` from this module) so the contract
 * is asserted at the renderer-facing module too.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { colorToCss } from "../color-fill";

describe("colorToCss (canvas/color-fill, RF-001)", () => {
  describe("sRGB", () => {
    it("emits rgba() for a basic sRGB color", () => {
      const css = colorToCss({ space: "srgb", r: 1, g: 0, b: 0, a: 1 });
      expect(css).toBe("rgba(255, 0, 0, 1)");
    });

    it("clamps out-of-range sRGB channels to [0, 1]", () => {
      const css = colorToCss({ space: "srgb", r: 2, g: -0.5, b: 0.5, a: 1 });
      // 2 → clamped to 1 → 255; -0.5 → clamped to 0 → 0; 0.5 → 128
      expect(css).toBe("rgba(255, 0, 128, 1)");
    });

    it("returns 0 for non-finite sRGB channels", () => {
      const css = colorToCss({ space: "srgb", r: NaN, g: Infinity, b: -Infinity, a: 1 });
      expect(css).toBe("rgba(0, 0, 0, 1)");
    });
  });

  describe("Display-P3", () => {
    it("emits color(display-p3 r g b / a) for a P3 color", () => {
      const css = colorToCss({ space: "display_p3", r: 1, g: 0, b: 0, a: 1 });
      expect(css).toBe("color(display-p3 1 0 0 / 1)");
    });

    it("rounds P3 channels to 4 decimal places", () => {
      const css = colorToCss({
        space: "display_p3",
        r: 0.123456789,
        g: 0.5,
        b: 0.987654321,
        a: 0.75,
      });
      expect(css).toBe("color(display-p3 0.1235 0.5 0.9877 / 0.75)");
    });

    it("guards non-finite P3 channels with 0", () => {
      const css = colorToCss({ space: "display_p3", r: NaN, g: Infinity, b: -Infinity, a: 1 });
      expect(css).toBe("color(display-p3 0 0 0 / 1)");
    });
  });

  describe("Unsupported color spaces", () => {
    it("falls back to gray for OkLCH (proper CSS output deferred)", () => {
      const css = colorToCss({ space: "oklch", l: 0.5, c: 0.1, h: 30, a: 1 });
      expect(css).toBe("rgba(128, 128, 128, 1)");
    });

    it("falls back to gray for OkLab (proper CSS output deferred)", () => {
      const css = colorToCss({ space: "oklab", l: 0.5, a: 0.1, b: 0.1, alpha: 1 });
      expect(css).toBe("rgba(128, 128, 128, 1)");
    });
  });
});
