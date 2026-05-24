/**
 * Tests for panel-value-helpers — conversion between StyleValue<T> and the
 * display strings used by ValueInput.
 */

import { describe, it, expect } from "vitest";
import type { Color, StyleValue } from "../../types/document";
import {
  formatNumber,
  formatColor,
  formatNumberStyleValue,
  formatColorStyleValue,
  formatOpacityStyleValue,
  parseOpacityInput,
  parseColorInput,
  parseNumberInput,
} from "../panel-value-helpers";

describe("formatNumber", () => {
  it("formats finite numbers to strings", () => {
    expect(formatNumber(16)).toBe("16");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-1.5)).toBe("-1.5");
  });

  it("returns empty string for NaN", () => {
    expect(formatNumber(NaN)).toBe("");
  });

  it("returns empty string for Infinity", () => {
    expect(formatNumber(Infinity)).toBe("");
    expect(formatNumber(-Infinity)).toBe("");
  });
});

describe("formatColor", () => {
  it("formats sRGB colors to hex strings", () => {
    const red: Color = { space: "srgb", r: 1, g: 0, b: 0, a: 1 };
    expect(formatColor(red)).toBe("#ff0000");
  });

  it("returns empty string for non-sRGB spaces", () => {
    const p3: Color = { space: "display_p3", r: 1, g: 0, b: 0, a: 1 };
    expect(formatColor(p3)).toBe("");
  });
});

describe("formatNumberStyleValue", () => {
  it("formats literals as numeric strings", () => {
    expect(formatNumberStyleValue({ type: "literal", value: 24 })).toBe("24");
  });

  it("formats token refs as {name}", () => {
    expect(formatNumberStyleValue({ type: "token_ref", name: "spacing.md" })).toBe("{spacing.md}");
  });

  it("formats expressions as raw expr strings", () => {
    expect(formatNumberStyleValue({ type: "expression", expr: "{a} + 2" })).toBe("{a} + 2");
  });
});

describe("formatColorStyleValue", () => {
  it("formats color literals as hex", () => {
    const sv: StyleValue<Color> = {
      type: "literal",
      value: { space: "srgb", r: 0, g: 0.5, b: 1, a: 1 },
    };
    expect(formatColorStyleValue(sv)).toBe("#0080ff");
  });

  it("formats color token refs as {name}", () => {
    expect(formatColorStyleValue({ type: "token_ref", name: "brand.primary" })).toBe(
      "{brand.primary}",
    );
  });
});

describe("formatOpacityStyleValue", () => {
  it("converts 0..=1 literals to percent strings", () => {
    expect(formatOpacityStyleValue({ type: "literal", value: 1 })).toBe("100");
    expect(formatOpacityStyleValue({ type: "literal", value: 0 })).toBe("0");
    expect(formatOpacityStyleValue({ type: "literal", value: 0.5 })).toBe("50");
  });

  it("rounds intermediate percent values", () => {
    expect(formatOpacityStyleValue({ type: "literal", value: 0.237 })).toBe("24");
  });

  it("passes through token refs unchanged", () => {
    expect(formatOpacityStyleValue({ type: "token_ref", name: "op.low" })).toBe("{op.low}");
  });

  it("passes through expressions unchanged", () => {
    expect(formatOpacityStyleValue({ type: "expression", expr: "{x} * 0.5" })).toBe("{x} * 0.5");
  });
});

describe("parseOpacityInput", () => {
  it("parses percent numbers to 0..=1 literals", () => {
    expect(parseOpacityInput("100")).toEqual({ type: "literal", value: 1 });
    expect(parseOpacityInput("0")).toEqual({ type: "literal", value: 0 });
    expect(parseOpacityInput("50")).toEqual({ type: "literal", value: 0.5 });
  });

  it("rejects percent values outside 0..=100", () => {
    expect(parseOpacityInput("101")).toBeNull();
    expect(parseOpacityInput("-1")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(parseOpacityInput("")).toBeNull();
    expect(parseOpacityInput("abc")).toBeNull();
  });

  it("passes token refs through", () => {
    expect(parseOpacityInput("{op.low}")).toEqual({ type: "token_ref", name: "op.low" });
  });

  it("passes expressions through", () => {
    expect(parseOpacityInput("{a} + 1")).toEqual({ type: "expression", expr: "{a} + 1" });
  });
});

describe("parseColorInput / parseNumberInput re-exports", () => {
  it("parses hex colors via re-export", () => {
    expect(parseColorInput("#ff0000")).toEqual({
      type: "literal",
      value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 },
    });
  });

  it("parses numeric literals via re-export", () => {
    expect(parseNumberInput("16")).toEqual({ type: "literal", value: 16 });
  });
});
