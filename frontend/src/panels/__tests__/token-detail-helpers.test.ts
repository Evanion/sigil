/**
 * Tests for token-detail-helpers.ts (Spec 13c)
 *
 * Covers tokenValueToString and parseTokenValueChange for all simple token
 * types (color, dimension, number, font_family) plus alias/expression paths.
 */

import { describe, it, expect } from "vitest";
import {
  tokenValueToString,
  parseTokenValueChange,
  parseDimensionString,
  acceptedTypesForToken,
} from "../token-detail-helpers";
import type { TokenValue } from "../../types/document";

// ── parseDimensionString ───────────────────────────────────────────────

describe("parseDimensionString", () => {
  it("parses integer px", () => {
    const r = parseDimensionString("16px");
    expect(r).toEqual({ value: 16, unit: "px" });
  });

  it("parses decimal rem", () => {
    const r = parseDimensionString("1.5rem");
    expect(r).toEqual({ value: 1.5, unit: "rem" });
  });

  it("parses percent", () => {
    const r = parseDimensionString("50%");
    expect(r).toEqual({ value: 50, unit: "percent" });
  });

  it("parses em", () => {
    const r = parseDimensionString("2em");
    expect(r).toEqual({ value: 2, unit: "em" });
  });

  it("defaults to px when no unit", () => {
    const r = parseDimensionString("8");
    expect(r).toEqual({ value: 8, unit: "px" });
  });

  it("parses negative value", () => {
    const r = parseDimensionString("-4px");
    expect(r).toEqual({ value: -4, unit: "px" });
  });

  it("returns null for empty string", () => {
    expect(parseDimensionString("")).toBeNull();
  });

  it("returns null for NaN-producing input", () => {
    expect(parseDimensionString("abc")).toBeNull();
  });

  it("handles whitespace trimming", () => {
    const r = parseDimensionString("  16px  ");
    expect(r).toEqual({ value: 16, unit: "px" });
  });
});

// ── tokenValueToString ─────────────────────────────────────────────────

describe("tokenValueToString", () => {
  it("color → hex string", () => {
    const val: TokenValue = { type: "color", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } };
    const result = tokenValueToString(val);
    // colorToHex returns lowercase hex
    expect(result).toMatch(/^#[0-9a-f]{6,8}$/i);
  });

  it("dimension px → '16px'", () => {
    const val: TokenValue = { type: "dimension", value: 16, unit: "px" };
    expect(tokenValueToString(val)).toBe("16px");
  });

  it("dimension percent → '50%'", () => {
    const val: TokenValue = { type: "dimension", value: 50, unit: "percent" };
    expect(tokenValueToString(val)).toBe("50%");
  });

  it("dimension rem → '1.5rem'", () => {
    const val: TokenValue = { type: "dimension", value: 1.5, unit: "rem" };
    expect(tokenValueToString(val)).toBe("1.5rem");
  });

  it("dimension non-finite → empty string", () => {
    const val: TokenValue = { type: "dimension", value: NaN, unit: "px" };
    expect(tokenValueToString(val)).toBe("");
  });

  it("number → numeric string", () => {
    const val: TokenValue = { type: "number", value: 42 };
    expect(tokenValueToString(val)).toBe("42");
  });

  it("number non-finite → empty string", () => {
    const val: TokenValue = { type: "number", value: Infinity };
    expect(tokenValueToString(val)).toBe("");
  });

  it("font_family single → family string", () => {
    const val: TokenValue = { type: "font_family", families: ["Inter"] };
    expect(tokenValueToString(val)).toBe("Inter");
  });

  it("font_family multiple → comma-joined", () => {
    const val: TokenValue = { type: "font_family", families: ["Inter", "sans-serif"] };
    expect(tokenValueToString(val)).toBe("Inter, sans-serif");
  });

  it("alias → {name}", () => {
    const val: TokenValue = { type: "alias", name: "colors.primary" };
    expect(tokenValueToString(val)).toBe("{colors.primary}");
  });

  it("expression → raw expr", () => {
    const val: TokenValue = { type: "expression", expr: "{spacing.base} * 2" };
    expect(tokenValueToString(val)).toBe("{spacing.base} * 2");
  });

  it("composite types → empty string", () => {
    const shadow: TokenValue = {
      type: "shadow",
      value: {
        color: { space: "srgb", r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 4 },
        blur: 8,
        spread: 0,
      },
    };
    expect(tokenValueToString(shadow)).toBe("");

    const typo: TokenValue = {
      type: "typography",
      value: {
        font_family: "Inter",
        font_size: 16,
        font_weight: 400,
        line_height: 1.5,
        letter_spacing: 0,
      },
    };
    expect(tokenValueToString(typo)).toBe("");
  });
});

// ── parseTokenValueChange ──────────────────────────────────────────────

describe("parseTokenValueChange", () => {
  // ── Alias path ──────────────────────────────────────────────────────

  it("bare token ref → alias for any type", () => {
    const result = parseTokenValueChange("{colors.brand}", "color");
    expect(result).toEqual({ type: "alias", name: "colors.brand" });
  });

  it("bare token ref → alias for dimension type", () => {
    const result = parseTokenValueChange("{spacing.base}", "dimension");
    expect(result).toEqual({ type: "alias", name: "spacing.base" });
  });

  // ── Expression path ─────────────────────────────────────────────────

  it("expression with operator → expression value", () => {
    const result = parseTokenValueChange("{spacing.base} * 2", "number");
    expect(result).toEqual({ type: "expression", expr: "{spacing.base} * 2" });
  });

  it("multiple refs → expression value", () => {
    const result = parseTokenValueChange("{a} + {b}", "number");
    expect(result).toEqual({ type: "expression", expr: "{a} + {b}" });
  });

  // ── Color parsing ────────────────────────────────────────────────────

  it("hex color → color value", () => {
    const result = parseTokenValueChange("#ff0000", "color");
    expect(result).toEqual({
      type: "color",
      value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 },
    });
  });

  it("invalid hex → null for color type", () => {
    expect(parseTokenValueChange("not-a-color", "color")).toBeNull();
  });

  it("empty string → null for color type", () => {
    expect(parseTokenValueChange("", "color")).toBeNull();
  });

  // ── Dimension parsing ────────────────────────────────────────────────

  it("'16px' → dimension value", () => {
    const result = parseTokenValueChange("16px", "dimension");
    expect(result).toEqual({ type: "dimension", value: 16, unit: "px" });
  });

  it("'1.5rem' → dimension value", () => {
    const result = parseTokenValueChange("1.5rem", "dimension");
    expect(result).toEqual({ type: "dimension", value: 1.5, unit: "rem" });
  });

  it("'50%' → dimension value with percent unit", () => {
    const result = parseTokenValueChange("50%", "dimension");
    expect(result).toEqual({ type: "dimension", value: 50, unit: "percent" });
  });

  it("invalid dimension string → null", () => {
    expect(parseTokenValueChange("abc", "dimension")).toBeNull();
  });

  // ── Number parsing ───────────────────────────────────────────────────

  it("integer string → number value", () => {
    const result = parseTokenValueChange("42", "number");
    expect(result).toEqual({ type: "number", value: 42 });
  });

  it("negative number → number value", () => {
    const result = parseTokenValueChange("-10", "number");
    expect(result).toEqual({ type: "number", value: -10 });
  });

  it("float string → number value", () => {
    const result = parseTokenValueChange("3.14", "number");
    expect(result).toMatchObject({ type: "number" });
    const num = result as { type: "number"; value: number };
    expect(Math.abs(num.value - 3.14)).toBeLessThan(0.0001);
  });

  it("NaN string → null for number type", () => {
    expect(parseTokenValueChange("NaN", "number")).toBeNull();
  });

  it("Infinity string → null for number type", () => {
    expect(parseTokenValueChange("Infinity", "number")).toBeNull();
  });

  it("non-numeric string → null for number type", () => {
    expect(parseTokenValueChange("hello", "number")).toBeNull();
  });

  // ── Font family parsing ──────────────────────────────────────────────

  it("single family → font_family value", () => {
    const result = parseTokenValueChange("Inter", "font_family");
    expect(result).toEqual({ type: "font_family", families: ["Inter"] });
  });

  it("comma-separated → font_family value", () => {
    const result = parseTokenValueChange("Inter, sans-serif", "font_family");
    expect(result).toEqual({ type: "font_family", families: ["Inter", "sans-serif"] });
  });

  it("whitespace-only string → null for font_family", () => {
    expect(parseTokenValueChange("   ", "font_family")).toBeNull();
  });

  // RF-031: CSS-significant characters must be rejected symmetrically with
  // crates/core/src/validate.rs :: FONT_FAMILY_FORBIDDEN_CHARS. Without this,
  // `parseTokenValueChange` produced a TokenValue the server rejected later,
  // turning a synchronous invariant violation into an async broadcast error.
  it("family with single quote → null", () => {
    expect(parseTokenValueChange("Inter'; drop", "font_family")).toBeNull();
  });

  it("family with double quote → null", () => {
    expect(parseTokenValueChange('Arial" ;', "font_family")).toBeNull();
  });

  it("family with semicolon → null", () => {
    expect(parseTokenValueChange("Arial;", "font_family")).toBeNull();
  });

  it("family with curly brace → null", () => {
    expect(parseTokenValueChange("Arial{}", "font_family")).toBeNull();
  });

  it("family with backslash → null", () => {
    expect(parseTokenValueChange("Arial\\test", "font_family")).toBeNull();
  });

  it("family with control character → null", () => {
    expect(parseTokenValueChange("Arial\u0001", "font_family")).toBeNull();
  });

  it("mixed valid + invalid in comma list → null (reject whole list)", () => {
    expect(parseTokenValueChange("Inter, Arial'; drop", "font_family")).toBeNull();
  });

  // ── Non-ValueInput types → null ──────────────────────────────────────

  it("font_weight type → null (handled by Select)", () => {
    expect(parseTokenValueChange("400", "font_weight")).toBeNull();
  });

  it("duration type → null (handled by NumberInput)", () => {
    expect(parseTokenValueChange("0.3", "duration")).toBeNull();
  });
});

// ── acceptedTypesForToken ──────────────────────────────────────────────────

describe("acceptedTypesForToken", () => {
  it("color → [color]", () => {
    expect(acceptedTypesForToken("color")).toEqual(["color"]);
  });

  it("dimension → [number, dimension]", () => {
    expect(acceptedTypesForToken("dimension")).toEqual(["number", "dimension"]);
  });

  it("number → [number]", () => {
    expect(acceptedTypesForToken("number")).toEqual(["number"]);
  });

  it("font_family → [font_family, string]", () => {
    expect(acceptedTypesForToken("font_family")).toEqual(["font_family", "string"]);
  });

  it("font_weight → [number]", () => {
    expect(acceptedTypesForToken("font_weight")).toEqual(["number"]);
  });

  it("duration → [number]", () => {
    expect(acceptedTypesForToken("duration")).toEqual(["number"]);
  });

  it("cubic_bezier → [string]", () => {
    expect(acceptedTypesForToken("cubic_bezier")).toEqual(["string"]);
  });

  it("shadow → [string]", () => {
    expect(acceptedTypesForToken("shadow")).toEqual(["string"]);
  });

  it("gradient → [string]", () => {
    expect(acceptedTypesForToken("gradient")).toEqual(["string"]);
  });

  it("typography → [string]", () => {
    expect(acceptedTypesForToken("typography")).toEqual(["string"]);
  });
});
