import { describe, it, expect } from "vitest";
import {
  formatStyleValue,
  parseColorInput,
  parseNumberInput,
  containsExpression,
} from "../style-value-format";
import type { ExtendedStyleValue, StyleValueExpression } from "../style-value-format";
import type { Color, ColorSrgb } from "../../../types/document";
import type { StyleValueLiteral, StyleValueTokenRef } from "../../../types/document";

// ── formatStyleValue ──────────────────────────────────────────────────

describe("formatStyleValue — literal variant", () => {
  it("should format a literal number with the provided formatter", () => {
    const sv: StyleValueLiteral<number> = { type: "literal", value: 16 };
    expect(formatStyleValue(sv, (n) => `${n}px`)).toBe("16px");
  });

  it("should format a literal string with the provided formatter", () => {
    const sv: StyleValueLiteral<string> = { type: "literal", value: "Inter" };
    expect(formatStyleValue(sv, (s) => s)).toBe("Inter");
  });

  it("should format a literal color (ColorSrgb) with the provided formatter", () => {
    const color: ColorSrgb = { space: "srgb", r: 1, g: 0, b: 0, a: 1 };
    const sv: StyleValueLiteral<Color> = { type: "literal", value: color };
    expect(formatStyleValue(sv, (_c) => "#ff0000")).toBe("#ff0000");
  });
});

describe("formatStyleValue — token_ref variant", () => {
  it("should format a token_ref as {name}", () => {
    const sv: StyleValueTokenRef = { type: "token_ref", name: "primary" };
    expect(formatStyleValue(sv, String)).toBe("{primary}");
  });

  it("should format a token_ref with a namespaced name as {colors.primary}", () => {
    const sv: StyleValueTokenRef = { type: "token_ref", name: "colors.primary" };
    expect(formatStyleValue(sv, String)).toBe("{colors.primary}");
  });

  it("should ignore the formatter for token_ref and always use {name}", () => {
    const sv: StyleValueTokenRef = { type: "token_ref", name: "size.md" };
    // The formatter should NOT be applied for token refs
    expect(formatStyleValue(sv, (_v: unknown) => "IGNORED")).toBe("{size.md}");
  });
});

describe("formatStyleValue — expression variant", () => {
  it("should return the raw expr string for an expression", () => {
    const sv: StyleValueExpression = { type: "expression", expr: "{a} + {b}" };
    expect(formatStyleValue(sv, String)).toBe("{a} + {b}");
  });

  it("should ignore the formatter for expression and always return raw expr", () => {
    const sv: StyleValueExpression = { type: "expression", expr: "calc(16)" };
    expect(formatStyleValue(sv, (_v: unknown) => "IGNORED")).toBe("calc(16)");
  });
});

// ── parseColorInput ───────────────────────────────────────────────────

describe("parseColorInput — hex literal", () => {
  it("should parse #ff0000 as a literal ColorSrgb", () => {
    const result = parseColorInput("#ff0000");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("literal");
    if (result.type === "literal") {
      const color = result.value as ColorSrgb;
      expect(color.space).toBe("srgb");
    }
  });

  it("should parse #f0a as a literal color (shorthand)", () => {
    const result = parseColorInput("#f0a");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("literal");
  });

  it("should parse #rrggbbaa as a literal color with alpha", () => {
    const result = parseColorInput("#0d99ff80");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("literal");
  });

  it("should return null for invalid hex like #xyz", () => {
    expect(parseColorInput("#xyz")).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(parseColorInput("")).toBeNull();
  });
});

describe("parseColorInput — token reference", () => {
  it("should parse {primary} as a token_ref", () => {
    const result = parseColorInput("{primary}");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("token_ref");
    if (result.type === "token_ref") {
      expect(result.name).toBe("primary");
    }
  });

  it("should parse {colors.primary} as a token_ref with namespaced name", () => {
    const result = parseColorInput("{colors.primary}");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("token_ref");
    if (result.type === "token_ref") {
      expect(result.name).toBe("colors.primary");
    }
  });
});

describe("parseColorInput — expression", () => {
  it("should parse {a} + {b} as expression", () => {
    const result = parseColorInput("{a} + {b}");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("expression");
    if (result.type === "expression") {
      expect(result.expr).toBe("{a} + {b}");
    }
  });

  it("should parse calc(16) as expression", () => {
    const result = parseColorInput("calc(16)");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("expression");
  });
});

describe("parseColorInput — unrecognized input", () => {
  it("should return null for plain text not matching any pattern", () => {
    expect(parseColorInput("hello")).toBeNull();
  });

  it("should return null for a standalone number", () => {
    expect(parseColorInput("16")).toBeNull();
  });
});

// ── parseNumberInput ──────────────────────────────────────────────────

describe("parseNumberInput — numeric literal", () => {
  it("should parse '16' as a literal number", () => {
    const result = parseNumberInput("16");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("literal");
    if (result.type === "literal") {
      expect(result.value).toBe(16);
    }
  });

  it("should parse '3.14' as a literal number", () => {
    const result = parseNumberInput("3.14");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("literal");
    if (result.type === "literal") {
      expect(Math.abs(result.value - 3.14)).toBeLessThan(1e-10);
    }
  });

  it("should parse '-8' as a literal number", () => {
    const result = parseNumberInput("-8");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("literal");
    if (result.type === "literal") {
      expect(result.value).toBe(-8);
    }
  });

  it("should parse '0' as a literal number", () => {
    const result = parseNumberInput("0");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("literal");
    if (result.type === "literal") {
      expect(result.value).toBe(0);
    }
  });

  it("should return null for NaN input like 'abc'", () => {
    expect(parseNumberInput("abc")).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(parseNumberInput("")).toBeNull();
  });

  it("should return null for Infinity", () => {
    expect(parseNumberInput("Infinity")).toBeNull();
  });

  it("should return null for -Infinity", () => {
    expect(parseNumberInput("-Infinity")).toBeNull();
  });
});

describe("parseNumberInput — token reference", () => {
  it("should parse {spacing.md} as a token_ref", () => {
    const result = parseNumberInput("{spacing.md}");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("token_ref");
    if (result.type === "token_ref") {
      expect(result.name).toBe("spacing.md");
    }
  });
});

describe("parseNumberInput — expression", () => {
  it("should parse {a} + {b} as expression", () => {
    const result = parseNumberInput("{a} + {b}");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("expression");
    if (result.type === "expression") {
      expect(result.expr).toBe("{a} + {b}");
    }
  });

  it("should parse rem(16) as expression", () => {
    const result = parseNumberInput("rem(16)");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected non-null");
    expect(result.type).toBe("expression");
  });
});

// ── containsExpression ────────────────────────────────────────────────

describe("containsExpression", () => {
  it("should return true for string with operator outside braces", () => {
    expect(containsExpression("{a} + {b}")).toBe(true);
  });

  it("should return true for string with * operator", () => {
    expect(containsExpression("{a} * 2")).toBe(true);
  });

  it("should return true for string with / operator", () => {
    expect(containsExpression("{a} / {b}")).toBe(true);
  });

  it("should return true for string with - operator outside braces", () => {
    expect(containsExpression("{a} - 1")).toBe(true);
  });

  it("should return true for function call (ident + '(')", () => {
    expect(containsExpression("calc(16)")).toBe(true);
    expect(containsExpression("rem(16)")).toBe(true);
  });

  it("should return true for multiple token references", () => {
    expect(containsExpression("{a}{b}")).toBe(true);
  });

  it("should return false for a single token reference", () => {
    expect(containsExpression("{primary}")).toBe(false);
  });

  it("should return false for a plain number", () => {
    expect(containsExpression("16")).toBe(false);
  });

  it("should return false for a hex color", () => {
    expect(containsExpression("#ff0000")).toBe(false);
  });

  it("should return false for operators inside braces (not expression)", () => {
    // Operators inside braces are part of the token name, not expression operators
    expect(containsExpression("{a+b}")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(containsExpression("")).toBe(false);
  });

  it("should return true for negation prefix on a non-number (like -{a})", () => {
    // '{a}' alone is a reference; '-{a}' has '-' outside braces, so it's an expression
    expect(containsExpression("-{a}")).toBe(true);
  });
});

// ── ExtendedStyleValue type — ensure correct narrowing ────────────────

describe("ExtendedStyleValue type narrowing", () => {
  it("should narrow to StyleValueLiteral<number>", () => {
    const sv: ExtendedStyleValue<number> = { type: "literal", value: 42 };
    if (sv.type === "literal") {
      expect(sv.value).toBe(42);
    }
  });

  it("should narrow to StyleValueTokenRef", () => {
    const sv: ExtendedStyleValue<number> = { type: "token_ref", name: "x" };
    if (sv.type === "token_ref") {
      expect(sv.name).toBe("x");
    }
  });

  it("should narrow to StyleValueExpression", () => {
    const sv: ExtendedStyleValue<number> = { type: "expression", expr: "{a} + 1" };
    if (sv.type === "expression") {
      expect(sv.expr).toBe("{a} + 1");
    }
  });
});
