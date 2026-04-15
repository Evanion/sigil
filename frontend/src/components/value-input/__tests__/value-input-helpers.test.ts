import { describe, it, expect } from "vitest";
import {
  resolveTokenTypeFilter,
  resolveSwatchColor,
  getTypeValidationMessage,
} from "../ValueInput";
import { getAutocompleteContext } from "../autocomplete-context";
import type { Token } from "../../../types/document";

// ── resolveTokenTypeFilter ─────────────────────────────────────────────

describe("resolveTokenTypeFilter — acceptedTypes mapping", () => {
  it("should return 'color' for acceptedTypes=['color']", () => {
    const result = resolveTokenTypeFilter(["color"], undefined);
    expect(result).toBe("color");
  });

  it("should return 'number' for acceptedTypes=['number']", () => {
    const result = resolveTokenTypeFilter(["number"], undefined);
    expect(result).toBe("number");
  });

  it("should return 'dimension' for acceptedTypes=['dimension']", () => {
    const result = resolveTokenTypeFilter(["dimension"], undefined);
    expect(result).toBe("dimension");
  });

  it("should return 'font_family' for acceptedTypes=['font_family']", () => {
    const result = resolveTokenTypeFilter(["font_family"], undefined);
    expect(result).toBe("font_family");
  });

  it("should return undefined for acceptedTypes=['string'] (all types accepted)", () => {
    const result = resolveTokenTypeFilter(["string"], undefined);
    expect(result).toBeUndefined();
  });

  it("should return undefined when acceptedTypes includes 'string' alongside other types", () => {
    const result = resolveTokenTypeFilter(["color", "string"], undefined);
    expect(result).toBeUndefined();
  });

  it("should return undefined for empty acceptedTypes, falling back to undefined legacyTokenType", () => {
    const result = resolveTokenTypeFilter([], undefined);
    expect(result).toBeUndefined();
  });

  it("should fall back to legacyTokenType when acceptedTypes is undefined", () => {
    const result = resolveTokenTypeFilter(undefined, "color");
    expect(result).toBe("color");
  });

  it("should fall back to legacyTokenType when acceptedTypes is empty", () => {
    const result = resolveTokenTypeFilter([], "number");
    expect(result).toBe("number");
  });

  it("should prefer acceptedTypes over legacyTokenType when both provided", () => {
    const result = resolveTokenTypeFilter(["dimension"], "color");
    expect(result).toBe("dimension");
  });

  it("should return undefined when both acceptedTypes is undefined and legacyTokenType is undefined", () => {
    const result = resolveTokenTypeFilter(undefined, undefined);
    expect(result).toBeUndefined();
  });

  it("should map the first matching value type from a multi-type array", () => {
    // ['number', 'dimension'] — first match is 'number'
    const result = resolveTokenTypeFilter(["number", "dimension"], undefined);
    expect(result).toBe("number");
  });
});

// ── resolveSwatchColor ─────────────────────────────────────────────────

describe("resolveSwatchColor — hex literals", () => {
  const emptyTokens: Record<string, Token> = {};

  it("should return a ColorSrgb for a valid 6-digit hex literal", () => {
    const result = resolveSwatchColor("#ff0000", emptyTokens);
    expect(result).not.toBeNull();
    expect(result?.space).toBe("srgb");
    expect(result?.r).toBeCloseTo(1);
    expect(result?.g).toBeCloseTo(0);
    expect(result?.b).toBeCloseTo(0);
    expect(result?.a).toBeCloseTo(1);
  });

  it("should return a ColorSrgb for a valid 3-digit hex shorthand", () => {
    const result = resolveSwatchColor("#f00", emptyTokens);
    expect(result).not.toBeNull();
    expect(result?.space).toBe("srgb");
    expect(result?.r).toBeCloseTo(1);
    expect(result?.g).toBeCloseTo(0);
    expect(result?.b).toBeCloseTo(0);
  });

  it("should return a ColorSrgb for an 8-digit hex with alpha", () => {
    const result = resolveSwatchColor("#ff000080", emptyTokens);
    expect(result).not.toBeNull();
    expect(result?.a).toBeCloseTo(128 / 255);
  });

  it("should return null for an invalid hex literal", () => {
    const result = resolveSwatchColor("#xyz", emptyTokens);
    expect(result).toBeNull();
  });

  it("should return null for an empty string", () => {
    const result = resolveSwatchColor("", emptyTokens);
    expect(result).toBeNull();
  });

  it("should return null for whitespace-only string", () => {
    const result = resolveSwatchColor("   ", emptyTokens);
    expect(result).toBeNull();
  });
});

describe("resolveSwatchColor — token references", () => {
  const colorToken: Token = {
    id: "tok-1",
    name: "primary",
    token_type: "color",
    description: null,
    value: { type: "color", value: { space: "srgb", r: 0, g: 0.5, b: 1, a: 1 } },
  };
  const numberToken: Token = {
    id: "tok-2",
    name: "spacing",
    token_type: "number",
    description: null,
    value: { type: "number", value: 16 },
  };
  const tokens: Record<string, Token> = {
    primary: colorToken,
    spacing: numberToken,
  };

  it("should return ColorSrgb for a single token ref that resolves to a color", () => {
    const result = resolveSwatchColor("{primary}", tokens);
    expect(result).not.toBeNull();
    expect(result?.space).toBe("srgb");
    expect(result?.r).toBeCloseTo(0);
    expect(result?.g).toBeCloseTo(0.5);
    expect(result?.b).toBeCloseTo(1);
  });

  it("should return null for a token ref that resolves to a non-color token", () => {
    const result = resolveSwatchColor("{spacing}", tokens);
    expect(result).toBeNull();
  });

  it("should return null for a token ref to an unknown token", () => {
    const result = resolveSwatchColor("{unknown}", tokens);
    expect(result).toBeNull();
  });

  it("should return null for an expression (multiple refs)", () => {
    const result = resolveSwatchColor("{primary} + {spacing}", tokens);
    expect(result).toBeNull();
  });

  it("should return null for a plain string (not a color or token ref)", () => {
    const result = resolveSwatchColor("hello", tokens);
    expect(result).toBeNull();
  });

  it("should handle whitespace around a token ref", () => {
    // trim() is called on value before matching
    const result = resolveSwatchColor("  {primary}  ", tokens);
    expect(result).not.toBeNull();
    expect(result?.space).toBe("srgb");
  });
});

// ── getTypeValidationMessage ───────────────────────────────────────────

describe("getTypeValidationMessage — null when valid", () => {
  it("should return null for mode='reference' regardless of acceptedTypes", () => {
    const result = getTypeValidationMessage("reference", ["number"]);
    expect(result).toBeNull();
  });

  it("should return null for mode='expression' regardless of acceptedTypes", () => {
    const result = getTypeValidationMessage("expression", ["color"]);
    expect(result).toBeNull();
  });

  it("should return null for mode='unknown' regardless of acceptedTypes", () => {
    const result = getTypeValidationMessage("unknown", ["color"]);
    expect(result).toBeNull();
  });

  it("should return null when mode='literal-color' and 'color' is accepted", () => {
    const result = getTypeValidationMessage("literal-color", ["color"]);
    expect(result).toBeNull();
  });

  it("should return null when mode='literal-number' and 'number' is accepted", () => {
    const result = getTypeValidationMessage("literal-number", ["number"]);
    expect(result).toBeNull();
  });

  it("should return null when mode='literal-number' and 'dimension' is accepted", () => {
    const result = getTypeValidationMessage("literal-number", ["dimension"]);
    expect(result).toBeNull();
  });

  it("should return null when mode='literal-font' and 'font_family' is accepted", () => {
    const result = getTypeValidationMessage("literal-font", ["font_family"]);
    expect(result).toBeNull();
  });
});

describe("getTypeValidationMessage — type mismatch messages", () => {
  it("should return error message when mode='literal-color' and only 'number' accepted", () => {
    const result = getTypeValidationMessage("literal-color", ["number"]);
    expect(result).not.toBeNull();
    expect(result).toContain("Color");
  });

  it("should return error message when mode='literal-number' and only 'color' accepted", () => {
    const result = getTypeValidationMessage("literal-number", ["color"]);
    expect(result).not.toBeNull();
    expect(result).toContain("Number");
  });

  it("should return error message when mode='literal-number' and only 'font_family' accepted", () => {
    const result = getTypeValidationMessage("literal-number", ["font_family"]);
    expect(result).not.toBeNull();
    expect(result).toContain("Number");
  });

  it("should return error message when mode='literal-font' and only 'color' accepted", () => {
    const result = getTypeValidationMessage("literal-font", ["color"]);
    expect(result).not.toBeNull();
    expect(result).toContain("Font");
  });

  it("should return error message when mode='literal-color' and no acceptedTypes overlap", () => {
    const result = getTypeValidationMessage("literal-color", ["string"]);
    expect(result).not.toBeNull();
  });
});

// ── Edge cases — multiple accepted types ────────────────────────────────

describe("getTypeValidationMessage — multiple accepted types", () => {
  it("should return null when mode='literal-number' and acceptedTypes includes both 'number' and 'color'", () => {
    const result = getTypeValidationMessage("literal-number", ["number", "color"]);
    expect(result).toBeNull();
  });

  it("should return null when mode='literal-color' and acceptedTypes includes 'color' and 'number'", () => {
    const result = getTypeValidationMessage("literal-color", ["color", "number"]);
    expect(result).toBeNull();
  });
});

// ── getAutocompleteContext ─────────────────────────────────────────────

describe("getAutocompleteContext — token mode", () => {
  it("should return token mode when cursor is inside {}", () => {
    const result = getAutocompleteContext("{primary", 8);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("token");
    expect(result?.query).toBe("primary");
    expect(result?.triggerStart).toBe(0);
  });

  it("should return token mode with empty query when cursor is directly after {", () => {
    const result = getAutocompleteContext("{", 1);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("token");
    expect(result?.query).toBe("");
  });

  it("should return token mode with partial query", () => {
    const result = getAutocompleteContext("{col", 4);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("token");
    expect(result?.query).toBe("col");
  });

  it("should return token mode inside nested expression context", () => {
    // Text: "lighten({primary", cursor at end
    const text = "lighten({primary";
    const result = getAutocompleteContext(text, text.length);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("token");
    expect(result?.query).toBe("primary");
  });
});

describe("getAutocompleteContext — function mode", () => {
  it("should return function mode for identifier prefix outside braces in non-font field", () => {
    // "li" typed outside braces — non-font field → function mode
    const result = getAutocompleteContext("li", 2, false);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("function");
    expect(result?.query).toBe("li");
  });

  it("should return function mode with longer identifier", () => {
    const result = getAutocompleteContext("lighten", 7, false);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("function");
    expect(result?.query).toBe("lighten");
  });

  it("should return function mode when isFontField is undefined (not a font field)", () => {
    const result = getAutocompleteContext("ro", 2);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("function");
    expect(result?.query).toBe("ro");
  });
});

describe("getAutocompleteContext — font mode", () => {
  it("should return font mode for identifier chars in a font field", () => {
    const result = getAutocompleteContext("Rob", 3, true);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("font");
    expect(result?.query).toBe("Rob");
  });

  it("should return font mode after comma in a font field", () => {
    // "Roboto, Hel" cursor at end — query is "Hel"
    const text = "Roboto, Hel";
    const result = getAutocompleteContext(text, text.length, true);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("font");
    expect(result?.query).toBe("Hel");
  });

  it("should return font mode with a single character in a font field", () => {
    const result = getAutocompleteContext("A", 1, true);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("font");
    expect(result?.query).toBe("A");
  });
});

describe("getAutocompleteContext — null cases", () => {
  it("should return null for empty string", () => {
    const result = getAutocompleteContext("", 0);
    expect(result).toBeNull();
  });

  it("should return null when cursor is at position 0 with non-empty text", () => {
    // Cursor at 0 means nothing has been typed yet — no identifier behind cursor.
    const result = getAutocompleteContext("lighten({primary})", 0);
    expect(result).toBeNull();
  });

  it("should return null when cursor is after a closed brace (not inside a ref)", () => {
    // "{primary}" is a complete token ref — cursor after } is not inside braces.
    const text = "{primary}";
    const result = getAutocompleteContext(text, text.length);
    // Cursor after "}" — no unclosed "{", and no identifier chars outside braces
    expect(result).toBeNull();
  });

  it("should return null for a single space in a non-font field (no identifier chars)", () => {
    const result = getAutocompleteContext(" ", 1, false);
    expect(result).toBeNull();
  });

  it("should return null in a font field when nothing is typed after a comma (empty segment)", () => {
    // "Arial, " — empty query in font field → null (query.length < 1)
    const result = getAutocompleteContext("Arial, ", 7, true);
    expect(result).toBeNull();
  });
});
