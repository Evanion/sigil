import { describe, it, expect } from "vitest";
import { colorToCss, sanitizeTokenName, validateTokenName } from "../token-helpers";

describe("sanitizeTokenName", () => {
  it("replaces spaces with dots", () => {
    expect(sanitizeTokenName("button background")).toBe("button.background");
  });

  it("replaces multiple spaces with dots", () => {
    expect(sanitizeTokenName("a b c")).toBe("a.b.c");
  });

  it("strips invalid characters", () => {
    expect(sanitizeTokenName("hello@world!")).toBe("helloworld");
  });

  it("preserves valid characters", () => {
    expect(sanitizeTokenName("brand.primary-100_altv2")).toBe("brand.primary-100_altv2");
  });

  it("handles empty string", () => {
    expect(sanitizeTokenName("")).toBe("");
  });

  it("strips unicode characters", () => {
    expect(sanitizeTokenName("brand.émoji🎨")).toBe("brand.moji");
  });

  it("combined: spaces + invalid chars", () => {
    expect(sanitizeTokenName("my token #1")).toBe("my.token.1");
  });

  it("result passes validateTokenName when non-empty and starts with letter", () => {
    const sanitized = sanitizeTokenName("Button Background Color");
    expect(validateTokenName(sanitized)).toBeNull();
  });
});

describe("colorToCss display_p3 (Spec 18)", () => {
  it("emits color(display-p3 r g b / a) for a P3-tagged color", () => {
    const css = colorToCss({ space: "display_p3", r: 1, g: 0, b: 0, a: 1 });
    expect(css).toBe("color(display-p3 1 0 0 / 1)");
  });

  it("rounds channels to 4 decimals", () => {
    const css = colorToCss({
      space: "display_p3",
      r: 0.123456789,
      g: 0.5,
      b: 0.987654321,
      a: 0.75,
    });
    expect(css).toBe("color(display-p3 0.1235 0.5 0.9877 / 0.75)");
  });

  it("guards non-finite channels and emits zeros", () => {
    const css = colorToCss({ space: "display_p3", r: NaN, g: Infinity, b: -Infinity, a: 1 });
    expect(css).toBe("color(display-p3 0 0 0 / 1)");
  });
});
