import { describe, it, expect } from "vitest";
import type { Token, TokenType } from "../../../types/document";
import {
  filterTokenSuggestions,
  filterFunctionSuggestions,
  MAX_AUTOCOMPLETE_RESULTS,
} from "../token-autocomplete";

// ── Test helpers ───────────────────────────────────────────────────────

function makeToken(name: string, tokenType: TokenType): Token {
  switch (tokenType) {
    case "color":
      return {
        id: `id-${name}`,
        name,
        token_type: tokenType,
        description: null,
        value: {
          type: "color",
          value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 },
        },
      };
    case "dimension":
      return {
        id: `id-${name}`,
        name,
        token_type: tokenType,
        description: null,
        value: { type: "dimension", value: 16, unit: "px" },
      };
    case "number":
      return {
        id: `id-${name}`,
        name,
        token_type: tokenType,
        description: null,
        value: { type: "number", value: 42 },
      };
    default:
      return {
        id: `id-${name}`,
        name,
        token_type: tokenType,
        description: null,
        value: { type: "number", value: 0 },
      };
  }
}

function makeTokenMap(
  ...entries: Array<[string, TokenType]>
): Record<string, Token> {
  const map: Record<string, Token> = {};
  for (const [name, type] of entries) {
    map[name] = makeToken(name, type);
  }
  return map;
}

// ── filterTokenSuggestions ─────────────────────────────────────────────

describe("filterTokenSuggestions", () => {
  it("should filter tokens by substring match", () => {
    const tokens = makeTokenMap(
      ["brand.primary", "color"],
      ["spacing.md", "dimension"],
    );
    const result = filterTokenSuggestions(tokens, "brand");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("brand.primary");
  });

  it("should be case-insensitive", () => {
    const tokens = makeTokenMap(["Brand.Primary", "color"]);
    const result = filterTokenSuggestions(tokens, "brand");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Brand.Primary");
  });

  it("should filter tokens by type", () => {
    const tokens = makeTokenMap(
      ["brand.primary", "color"],
      ["spacing.md", "dimension"],
    );
    const result = filterTokenSuggestions(tokens, "", "color");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("brand.primary");
  });

  it("should combine query and type filter", () => {
    const tokens = makeTokenMap(
      ["brand.primary", "color"],
      ["brand.secondary", "color"],
      ["brand.spacing", "dimension"],
    );
    const result = filterTokenSuggestions(tokens, "brand", "color");
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toEqual([
      "brand.primary",
      "brand.secondary",
    ]);
  });

  it("should return empty array when no match", () => {
    const tokens = makeTokenMap(["brand.primary", "color"]);
    const result = filterTokenSuggestions(tokens, "xyz");
    expect(result).toHaveLength(0);
  });

  it("should return all tokens for empty query up to limit", () => {
    const entries: Array<[string, TokenType]> = [];
    for (let i = 0; i < 20; i++) {
      entries.push([`token.${String(i).padStart(2, "0")}`, "number"]);
    }
    const tokens = makeTokenMap(...entries);
    const result = filterTokenSuggestions(tokens, "");
    expect(result).toHaveLength(MAX_AUTOCOMPLETE_RESULTS);
  });

  it("should respect custom maxResults", () => {
    const tokens = makeTokenMap(
      ["a", "number"],
      ["b", "number"],
      ["c", "number"],
    );
    const result = filterTokenSuggestions(tokens, "", undefined, 2);
    expect(result).toHaveLength(2);
  });

  it("should sort results by name", () => {
    const tokens = makeTokenMap(
      ["c.token", "number"],
      ["a.token", "number"],
      ["b.token", "number"],
    );
    const result = filterTokenSuggestions(tokens, "");
    expect(result.map((s) => s.name)).toEqual([
      "a.token",
      "b.token",
      "c.token",
    ]);
  });

  it("should include correct type and preview", () => {
    const tokens = makeTokenMap(["spacing.md", "dimension"]);
    const result = filterTokenSuggestions(tokens, "spacing");
    expect(result[0].type).toBe("token");
    expect(result[0].tokenType).toBe("dimension");
    expect(result[0].preview).toBe("16px");
  });

  it("should handle empty token map", () => {
    const result = filterTokenSuggestions({}, "foo");
    expect(result).toHaveLength(0);
  });

  it("should match substring anywhere in name", () => {
    const tokens = makeTokenMap(["spacing.medium", "dimension"]);
    const result = filterTokenSuggestions(tokens, "medium");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("spacing.medium");
  });
});

// ── filterFunctionSuggestions ──────────────────────────────────────────

describe("filterFunctionSuggestions", () => {
  it("should filter functions by prefix", () => {
    const result = filterFunctionSuggestions("lig");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe("lighten");
  });

  it("should be case-insensitive", () => {
    const result = filterFunctionSuggestions("ROUND");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("round");
  });

  it("should respect maxResults", () => {
    const result = filterFunctionSuggestions("", 3);
    expect(result).toHaveLength(3);
  });

  it("should return functions sorted alphabetically", () => {
    const result = filterFunctionSuggestions("", 100);
    const names = result.map((s) => s.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("should return empty for non-matching prefix", () => {
    const result = filterFunctionSuggestions("zzz");
    expect(result).toHaveLength(0);
  });

  it("should include signature and description", () => {
    const result = filterFunctionSuggestions("round");
    expect(result[0].signature).toBe("round(n)");
    expect(result[0].description).toBe("Round to nearest integer");
  });

  it("should match all functions starting with 'set'", () => {
    const result = filterFunctionSuggestions("set", 100);
    expect(result.length).toBe(6);
    for (const fn of result) {
      expect(fn.name.startsWith("set")).toBe(true);
    }
  });

  it("should match all functions starting with 'adjust'", () => {
    const result = filterFunctionSuggestions("adjust", 100);
    expect(result.length).toBe(6);
    for (const fn of result) {
      expect(fn.name.startsWith("adjust")).toBe(true);
    }
  });

  it("should default to MAX_AUTOCOMPLETE_RESULTS limit", () => {
    const result = filterFunctionSuggestions("");
    expect(result.length).toBeLessThanOrEqual(MAX_AUTOCOMPLETE_RESULTS);
  });
});

// ── MAX_AUTOCOMPLETE_RESULTS enforcement ───────────────────────────────

describe("MAX_AUTOCOMPLETE_RESULTS enforcement", () => {
  it("should enforce MAX_AUTOCOMPLETE_RESULTS on token suggestions", () => {
    const entries: Array<[string, TokenType]> = [];
    for (let i = 0; i < MAX_AUTOCOMPLETE_RESULTS + 5; i++) {
      entries.push([`token.${String(i).padStart(2, "0")}`, "number"]);
    }
    const tokens = makeTokenMap(...entries);
    const result = filterTokenSuggestions(tokens, "");
    expect(result).toHaveLength(MAX_AUTOCOMPLETE_RESULTS);
  });

  it("should enforce MAX_AUTOCOMPLETE_RESULTS on function suggestions", () => {
    // With empty query, all 38 functions match; should be limited
    const result = filterFunctionSuggestions("");
    expect(result).toHaveLength(MAX_AUTOCOMPLETE_RESULTS);
  });
});
