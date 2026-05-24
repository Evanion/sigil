/**
 * Tests for style-value-validate — transport-boundary shape validation.
 *
 * Covers:
 *  - isValidExpressionLength enforcement at MAX_EXPRESSION_LENGTH.
 *  - isValidStyleValue against all three StyleValue variants.
 *  - isValidColor across all four color spaces.
 *  - isValidFiniteNumber for numeric leaves.
 */

import { describe, it, expect } from "vitest";
import {
  isValidExpressionLength,
  isValidStyleValue,
  isValidColor,
  isValidFiniteNumber,
} from "../style-value-validate";
import { MAX_EXPRESSION_LENGTH } from "../expression-eval";

describe("isValidExpressionLength", () => {
  it("should accept a short expression", () => {
    expect(isValidExpressionLength("1 + 2")).toBe(true);
  });

  it("should reject an empty expression", () => {
    expect(isValidExpressionLength("")).toBe(false);
  });

  // RF-022: MAX_EXPRESSION_LENGTH enforcement (CLAUDE.md Constant Enforcement Tests)
  it("test_max_expression_length_enforced: should reject an expression at MAX_EXPRESSION_LENGTH + 1", () => {
    const tooLong = "a".repeat(MAX_EXPRESSION_LENGTH + 1);
    expect(isValidExpressionLength(tooLong)).toBe(false);
  });

  it("should accept an expression at exactly MAX_EXPRESSION_LENGTH", () => {
    const exact = "a".repeat(MAX_EXPRESSION_LENGTH);
    expect(isValidExpressionLength(exact)).toBe(true);
  });
});

describe("isValidStyleValue", () => {
  it("should accept a literal with a valid inner value", () => {
    expect(isValidStyleValue({ type: "literal", value: 42 }, isValidFiniteNumber)).toBe(true);
  });

  it("should reject a literal with an invalid inner value", () => {
    expect(isValidStyleValue({ type: "literal", value: "hello" }, isValidFiniteNumber)).toBe(false);
    expect(isValidStyleValue({ type: "literal", value: NaN }, isValidFiniteNumber)).toBe(false);
  });

  it("should accept a token_ref with a non-empty name", () => {
    expect(isValidStyleValue({ type: "token_ref", name: "brand.primary" }, isValidColor)).toBe(
      true,
    );
  });

  it("should reject a token_ref with an empty name", () => {
    expect(isValidStyleValue({ type: "token_ref", name: "" }, isValidColor)).toBe(false);
  });

  it("should reject a token_ref with a non-string name", () => {
    expect(isValidStyleValue({ type: "token_ref", name: 42 }, isValidColor)).toBe(false);
  });

  it("should accept an expression within length bounds", () => {
    expect(isValidStyleValue({ type: "expression", expr: "{a} + 1" }, isValidFiniteNumber)).toBe(
      true,
    );
  });

  it("should reject an expression exceeding MAX_EXPRESSION_LENGTH", () => {
    const tooLong = "a".repeat(MAX_EXPRESSION_LENGTH + 1);
    expect(isValidStyleValue({ type: "expression", expr: tooLong }, isValidFiniteNumber)).toBe(
      false,
    );
  });

  it("should reject an expression with an empty expr", () => {
    expect(isValidStyleValue({ type: "expression", expr: "" }, isValidFiniteNumber)).toBe(false);
  });

  it("should reject unknown discriminants", () => {
    expect(isValidStyleValue({ type: "bogus", value: 42 }, isValidFiniteNumber)).toBe(false);
  });

  it("should reject null and non-objects", () => {
    expect(isValidStyleValue(null, isValidFiniteNumber)).toBe(false);
    expect(isValidStyleValue(42, isValidFiniteNumber)).toBe(false);
    expect(isValidStyleValue("literal", isValidFiniteNumber)).toBe(false);
  });
});

describe("isValidColor", () => {
  it("should accept srgb colors", () => {
    expect(isValidColor({ space: "srgb", r: 1, g: 0, b: 0, a: 1 })).toBe(true);
  });

  it("should accept display_p3 colors", () => {
    expect(isValidColor({ space: "display_p3", r: 0.5, g: 0.5, b: 0.5, a: 1 })).toBe(true);
  });

  it("should accept oklch colors", () => {
    expect(isValidColor({ space: "oklch", l: 0.5, c: 0.1, h: 180, a: 1 })).toBe(true);
  });

  it("should accept oklab colors", () => {
    expect(isValidColor({ space: "oklab", l: 0.5, a: 0.0, b: 0.0, alpha: 1 })).toBe(true);
  });

  it("should reject an unknown color space", () => {
    expect(isValidColor({ space: "hsl", h: 0, s: 0, l: 0, a: 1 })).toBe(false);
  });

  it("should reject a color with non-finite channels", () => {
    expect(isValidColor({ space: "srgb", r: NaN, g: 0, b: 0, a: 1 })).toBe(false);
    expect(isValidColor({ space: "srgb", r: Infinity, g: 0, b: 0, a: 1 })).toBe(false);
  });

  it("should reject a color missing fields", () => {
    expect(isValidColor({ space: "srgb", r: 1, g: 0, b: 0 })).toBe(false);
  });

  it("should reject null and non-objects", () => {
    expect(isValidColor(null)).toBe(false);
    expect(isValidColor(42)).toBe(false);
    expect(isValidColor("red")).toBe(false);
  });
});

describe("isValidFiniteNumber", () => {
  it("should accept finite numbers", () => {
    expect(isValidFiniteNumber(0)).toBe(true);
    expect(isValidFiniteNumber(-1)).toBe(true);
    expect(isValidFiniteNumber(3.14)).toBe(true);
  });

  it("should reject NaN and Infinity", () => {
    expect(isValidFiniteNumber(NaN)).toBe(false);
    expect(isValidFiniteNumber(Infinity)).toBe(false);
    expect(isValidFiniteNumber(-Infinity)).toBe(false);
  });

  it("should reject non-numbers", () => {
    expect(isValidFiniteNumber("42")).toBe(false);
    expect(isValidFiniteNumber(null)).toBe(false);
    expect(isValidFiniteNumber(undefined)).toBe(false);
  });
});
