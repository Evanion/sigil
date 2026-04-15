import { describe, it, expect } from "vitest";
import { formatEvalError, formatEvalValue } from "../input-helpers";
import type { EvalValue, EvalError } from "../../../store/expression-eval";

describe("formatEvalError", () => {
  it("should format parse error", () => {
    const err: EvalError = { type: "parse", message: "unexpected token" };
    expect(formatEvalError(err)).toBe("Parse error: unexpected token");
  });

  it("should format unknown function error", () => {
    const err: EvalError = { type: "unknownFunction", name: "foo" };
    expect(formatEvalError(err)).toBe("Unknown function: foo");
  });

  it("should format arity error", () => {
    const err: EvalError = { type: "arityError", name: "mix", expected: 3, got: 2 };
    expect(formatEvalError(err)).toBe("mix() expects 3 args, got 2");
  });

  it("should format type error", () => {
    const err: EvalError = { type: "typeError", expected: "number", got: "color" };
    expect(formatEvalError(err)).toBe("Type error: expected number, got color");
  });

  it("should format reference not found", () => {
    const err: EvalError = { type: "referenceNotFound", name: "brand.primary" };
    expect(formatEvalError(err)).toBe("Unknown token: brand.primary");
  });

  it("should format depth exceeded", () => {
    const err: EvalError = { type: "depthExceeded" };
    expect(formatEvalError(err)).toBe("Expression too deeply nested");
  });

  it("should format division by zero", () => {
    const err: EvalError = { type: "divisionByZero" };
    expect(formatEvalError(err)).toBe("Division by zero");
  });

  it("should format domain error", () => {
    const err: EvalError = { type: "domainError", message: "negative input to sqrt" };
    expect(formatEvalError(err)).toBe("Domain error: negative input to sqrt");
  });
});

describe("formatEvalValue", () => {
  it("should format finite number", () => {
    const val: EvalValue = { type: "number", value: 42 };
    expect(formatEvalValue(val)).toBe("42");
  });

  it("should return em-dash for NaN number", () => {
    const val: EvalValue = { type: "number", value: NaN };
    expect(formatEvalValue(val)).toBe("\u2014");
  });

  it("should return em-dash for Infinity number", () => {
    const val: EvalValue = { type: "number", value: Infinity };
    expect(formatEvalValue(val)).toBe("\u2014");
  });

  it("should format sRGB color as hex", () => {
    const val: EvalValue = {
      type: "color",
      value: { space: "srgb" as const, r: 0.2, g: 0.4, b: 0.6, a: 1 },
    };
    const result = formatEvalValue(val);
    expect(result).toBe("#336699");
  });

  it("should format sRGB color with alpha as 8-digit hex", () => {
    const val: EvalValue = {
      type: "color",
      value: { space: "srgb" as const, r: 1, g: 0, b: 0, a: 0.5 },
    };
    const result = formatEvalValue(val);
    expect(result).toMatch(/^#ff000080$/);
  });

  it("should return em-dash for sRGB color with NaN channel", () => {
    const val: EvalValue = {
      type: "color",
      value: { space: "srgb" as const, r: NaN, g: 0.4, b: 0.6, a: 1 },
    };
    expect(formatEvalValue(val)).toBe("\u2014");
  });

  it("should format display_p3 color", () => {
    const val: EvalValue = {
      type: "color",
      value: { space: "display_p3" as const, r: 0.5, g: 0.25, b: 0.75, a: 1 },
    };
    const result = formatEvalValue(val);
    expect(result).toContain("display-p3");
  });

  it("should format oklch color", () => {
    const val: EvalValue = {
      type: "color",
      value: { space: "oklch" as const, l: 0.5, c: 0.2, h: 180, a: 1 },
    };
    const result = formatEvalValue(val);
    expect(result).toContain("oklch");
  });

  it("should format oklab color", () => {
    const val: EvalValue = {
      type: "color",
      value: { space: "oklab" as const, l: 0.5, a: 0.1, b: -0.1, alpha: 1 },
    };
    const result = formatEvalValue(val);
    expect(result).toContain("oklab");
  });

  it("should format string value", () => {
    const val: EvalValue = { type: "string", value: "hello" };
    expect(formatEvalValue(val)).toBe("hello");
  });
});
