import { describe, it, expect } from "vitest";
import type { Token, TokenType } from "../../../types/document";
import {
  filterTokenSuggestions,
  filterFunctionSuggestions,
  filterFontSuggestions,
  extractFontQuery,
  isGenericFamily,
  MAX_AUTOCOMPLETE_RESULTS,
  MIN_FUNCTION_QUERY_LENGTH,
  FUNCTION_REGISTRY_NAMES,
} from "../token-autocomplete";
import { FUNCTION_REGISTRY_NAMES as EVAL_FUNCTION_NAMES } from "../../../store/expression-eval";
import { SystemFontProvider } from "../font-provider";
import type { FontProvider, FontInfo } from "../font-provider";

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

function makeTokenMap(...entries: Array<[string, TokenType]>): Record<string, Token> {
  const map: Record<string, Token> = {};
  for (const [name, type] of entries) {
    map[name] = makeToken(name, type);
  }
  return map;
}

// ── filterTokenSuggestions ─────────────────────────────────────────────

describe("filterTokenSuggestions", () => {
  it("should filter tokens by substring match", () => {
    const tokens = makeTokenMap(["brand.primary", "color"], ["spacing.md", "dimension"]);
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

  it("should filter tokens by type (single TokenType argument)", () => {
    const tokens = makeTokenMap(["brand.primary", "color"], ["spacing.md", "dimension"]);
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
    expect(result.map((s) => s.name)).toEqual(["brand.primary", "brand.secondary"]);
  });

  // RF-021: multi-type filtering — fields that accept number+dimension (or
  // color+...) must surface tokens of any accepted type.
  it("RF-021: should filter tokens by an array of TokenTypes", () => {
    const tokens = makeTokenMap(["num.a", "number"], ["dim.b", "dimension"], ["col.c", "color"]);
    const result = filterTokenSuggestions(tokens, "", ["number", "dimension"]);
    const names = result.map((s) => s.name).sort();
    expect(names).toEqual(["dim.b", "num.a"]);
  });

  it("RF-021: empty array argument should act as 'no filter' (all tokens pass)", () => {
    const tokens = makeTokenMap(["a", "number"], ["b", "color"]);
    const result = filterTokenSuggestions(tokens, "", []);
    expect(result).toHaveLength(2);
  });

  it("RF-021: array filter combined with query should behave like set-intersection", () => {
    const tokens = makeTokenMap(
      ["brand.primary", "color"],
      ["brand.size", "dimension"],
      ["other.size", "dimension"],
    );
    const result = filterTokenSuggestions(tokens, "brand", ["color", "dimension"]);
    const names = result.map((s) => s.name).sort();
    expect(names).toEqual(["brand.primary", "brand.size"]);
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
    const tokens = makeTokenMap(["a", "number"], ["b", "number"], ["c", "number"]);
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
    expect(result.map((s) => s.name)).toEqual(["a.token", "b.token", "c.token"]);
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

// ── RF-016: BUILTIN_FUNCTIONS parity with FUNCTION_REGISTRY ────────────

describe("BUILTIN_FUNCTIONS names should match FUNCTION_REGISTRY_NAMES", () => {
  it("should export the same function names as the evaluator registry (RF-016)", () => {
    // FUNCTION_REGISTRY_NAMES re-exported from token-autocomplete must equal
    // the canonical list from expression-eval.ts.
    expect([...FUNCTION_REGISTRY_NAMES].sort()).toEqual([...EVAL_FUNCTION_NAMES].sort());
  });
});

// ── RF-021: MIN_FUNCTION_QUERY_LENGTH threshold enforcement ────────────

describe("MIN_FUNCTION_QUERY_LENGTH enforcement (RF-021)", () => {
  it("should return empty results for a single-character query", () => {
    // Single char is below the 2-char threshold — must return nothing.
    const result = filterFunctionSuggestions("r");
    expect(result).toHaveLength(0);
  });

  it("should return results for a two-character query", () => {
    // Two chars meets the threshold — 'ro' matches 'round'.
    const result = filterFunctionSuggestions("ro");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should return results for empty query (show-all mode)", () => {
    // Empty query bypasses the threshold — used to show the full list when
    // the user opens the autocomplete without typing.
    const result = filterFunctionSuggestions("");
    expect(result.length).toBeGreaterThan(0);
  });

  it("MIN_FUNCTION_QUERY_LENGTH should equal 2", () => {
    expect(MIN_FUNCTION_QUERY_LENGTH).toBe(2);
  });
});

// ── extractFontQuery ───────────────────────────────────────────────────

describe("extractFontQuery", () => {
  it("should return the full text when there is no comma", () => {
    expect(extractFontQuery("Inter")).toBe("Inter");
  });

  it("should return trimmed text after the last comma", () => {
    expect(extractFontQuery("Roboto, Hel")).toBe("Hel");
  });

  it("should return empty string when nothing is typed after the last comma", () => {
    expect(extractFontQuery("Arial, ")).toBe("");
  });

  it("should handle multiple commas — use last one", () => {
    expect(extractFontQuery("Georgia, Arial, Hel")).toBe("Hel");
  });

  it("should trim leading and trailing whitespace from the query", () => {
    expect(extractFontQuery("Arial,  Helvetica ")).toBe("Helvetica");
  });

  it("should return empty string for empty input", () => {
    expect(extractFontQuery("")).toBe("");
  });

  it("should return empty string for whitespace-only input", () => {
    expect(extractFontQuery("   ")).toBe("");
  });

  it("should return empty string after a trailing comma with no content", () => {
    expect(extractFontQuery("Times New Roman,")).toBe("");
  });
});

// ── isGenericFamily ────────────────────────────────────────────────────

describe("isGenericFamily", () => {
  it("should return true for 'serif'", () => {
    expect(isGenericFamily("serif")).toBe(true);
  });

  it("should return true for 'sans-serif'", () => {
    expect(isGenericFamily("sans-serif")).toBe(true);
  });

  it("should return true for 'monospace'", () => {
    expect(isGenericFamily("monospace")).toBe(true);
  });

  it("should be case-insensitive", () => {
    expect(isGenericFamily("Serif")).toBe(true);
    expect(isGenericFamily("SANS-SERIF")).toBe(true);
  });

  it("should return false for a named system font", () => {
    expect(isGenericFamily("Arial")).toBe(false);
    expect(isGenericFamily("Roboto")).toBe(false);
  });

  it("should return false for an empty string", () => {
    expect(isGenericFamily("")).toBe(false);
  });
});

// ── filterFontSuggestions ──────────────────────────────────────────────

/** Minimal FontProvider for testing that returns a fixed font list. */
function makeTestFontProvider(
  fonts: Array<{ name: string; source: FontInfo["source"] }>,
): FontProvider {
  return {
    listFonts(): readonly FontInfo[] {
      return fonts.map((f) => ({ name: f.name, source: f.source }));
    },
  };
}

describe("filterFontSuggestions", () => {
  it("should return provider fonts plus all generic families for an empty query", () => {
    // Generic families (10) are always appended — empty query returns 2 provider
    // fonts + all 10 generic families = 12, which equals MAX_AUTOCOMPLETE_RESULTS.
    const provider = makeTestFontProvider([
      { name: "Arial", source: "system" },
      { name: "Roboto", source: "workspace" },
    ]);
    const result = filterFontSuggestions(provider, "");
    // The 2 provider fonts come first (sorted), then the 10 generics (sorted).
    // Total is 12, which equals MAX_AUTOCOMPLETE_RESULTS — the slice caps it.
    expect(result.length).toBe(MAX_AUTOCOMPLETE_RESULTS);
    // Provider fonts come before generics
    expect(result[0].name).toBe("Arial");
    expect(result[1].name).toBe("Roboto");
  });

  it("should do case-insensitive substring match", () => {
    const provider = makeTestFontProvider([
      { name: "Helvetica Neue", source: "system" },
      { name: "Arial", source: "system" },
    ]);
    const result = filterFontSuggestions(provider, "helv");
    // "helv" matches "Helvetica Neue" from the provider, plus all 10 generics
    // are always appended. Helvetica Neue first, then generics sorted.
    const names = result.map((s) => s.name);
    expect(names[0]).toBe("Helvetica Neue");
    // Generic families should follow
    expect(names.length).toBeGreaterThan(1);
  });

  it("should match substring anywhere in font name", () => {
    const provider = makeTestFontProvider([
      { name: "Times New Roman", source: "system" },
      { name: "Georgia", source: "system" },
    ]);
    const result = filterFontSuggestions(provider, "New");
    // "New" matches "Times New Roman" from provider; generics always appended.
    const names = result.map((s) => s.name);
    expect(names[0]).toBe("Times New Roman");
    expect(names.length).toBeGreaterThan(1);
  });

  it("should sort provider matches alphabetically before generics", () => {
    const provider = makeTestFontProvider([
      { name: "Verdana", source: "system" },
      { name: "Arial", source: "system" },
      { name: "Georgia", source: "system" },
    ]);
    const result = filterFontSuggestions(provider, "");
    const names = result.map((s) => s.name);
    // Provider fonts (sorted) come first
    expect(names[0]).toBe("Arial");
    expect(names[1]).toBe("Georgia");
    expect(names[2]).toBe("Verdana");
    // Generics follow (result is capped at MAX_AUTOCOMPLETE_RESULTS)
    expect(names.length).toBe(MAX_AUTOCOMPLETE_RESULTS);
  });

  it("should produce FontSuggestion with correct type and source", () => {
    const provider = makeTestFontProvider([{ name: "Roboto", source: "workspace" }]);
    const result = filterFontSuggestions(provider, "rob");
    expect(result[0].type).toBe("font");
    expect(result[0].name).toBe("Roboto");
    expect(result[0].source).toBe("workspace");
  });

  it("should always include generic families even when no provider fonts match query", () => {
    // "zzz" matches nothing from the provider, but generics are always included.
    const provider = makeTestFontProvider([{ name: "Arial", source: "system" }]);
    const result = filterFontSuggestions(provider, "zzz");
    // All 10 GENERIC_FAMILIES are appended regardless of the query.
    expect(result.length).toBe(10);
    const names = result.map((s) => s.name);
    expect(names).toContain("serif");
    expect(names).toContain("sans-serif");
    expect(names).toContain("monospace");
  });

  it("should respect maxResults limit", () => {
    const provider = makeTestFontProvider([
      { name: "Arial", source: "system" },
      { name: "Roboto", source: "system" },
      { name: "Georgia", source: "system" },
      { name: "Verdana", source: "system" },
    ]);
    const result = filterFontSuggestions(provider, "", 2);
    expect(result).toHaveLength(2);
  });

  it("should default to MAX_AUTOCOMPLETE_RESULTS limit", () => {
    // Create more than MAX_AUTOCOMPLETE_RESULTS fonts
    const fonts = Array.from({ length: MAX_AUTOCOMPLETE_RESULTS + 5 }, (_, i) => ({
      name: `Font ${String(i).padStart(2, "0")}`,
      source: "system" as const,
    }));
    const provider = makeTestFontProvider(fonts);
    const result = filterFontSuggestions(provider, "");
    expect(result).toHaveLength(MAX_AUTOCOMPLETE_RESULTS);
  });

  it("should work with SystemFontProvider", () => {
    const provider = new SystemFontProvider();
    const result = filterFontSuggestions(provider, "Arial");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe("Arial");
    expect(result[0].type).toBe("font");
  });

  it("should not duplicate generics when provider already includes them", () => {
    // Provider includes "serif" — it should appear only once in the output.
    const provider = makeTestFontProvider([
      { name: "serif", source: "system" },
      { name: "Arial", source: "system" },
    ]);
    const result = filterFontSuggestions(provider, "");
    const names = result.map((s) => s.name);
    // "serif" must appear exactly once
    expect(names.filter((n) => n === "serif")).toHaveLength(1);
  });

  it("should match generic families via substring and not duplicate them", () => {
    // Provider has serif and sans-serif; query "serif" matches both.
    // The remaining generics are still appended without duplicating the matched ones.
    const provider = makeTestFontProvider([
      { name: "serif", source: "system" },
      { name: "sans-serif", source: "system" },
      { name: "Arial", source: "system" },
    ]);
    const result = filterFontSuggestions(provider, "serif");
    const names = result.map((s) => s.name);
    // Provider matches first: "sans-serif", "serif" (sorted)
    expect(names[0]).toBe("sans-serif");
    expect(names[1]).toBe("serif");
    // The remaining GENERIC_FAMILIES (8 others) are appended
    expect(names).not.toContain("Arial"); // "Arial" doesn't match "serif"
    // Total: 2 matched + 8 remaining generics = 10
    expect(names.length).toBe(10);
    // No duplicates
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("should collect all matches before sorting (not break early)", () => {
    // Verifies Issue 4 fix: early break would give wrong results.
    // Create fonts where the alphabetically-last ones match the query but
    // would have been excluded if we broke at limit before sorting.
    // Use maxResults=3 with 5 fonts starting with 'A' — all match "", so
    // after sorting alphabetically the first 3 should always be the first 3.
    const provider = makeTestFontProvider([
      { name: "A-Zzz", source: "system" }, // last alphabetically among these
      { name: "A-Aaa", source: "system" }, // first
      { name: "A-Bbb", source: "system" }, // second
      { name: "A-Ccc", source: "system" }, // third
      { name: "A-Ddd", source: "system" }, // fourth
    ]);
    // maxResults=3, no generics included by name (prefix "A-" won't match generics)
    const result = filterFontSuggestions(provider, "A-", 3);
    const names = result.map((s) => s.name);
    // With correct collect-all-then-sort, we get the first 3 alphabetically.
    expect(names[0]).toBe("A-Aaa");
    expect(names[1]).toBe("A-Bbb");
    expect(names[2]).toBe("A-Ccc");
  });
});

// ── MAX_AUTOCOMPLETE_RESULTS enforcement for filterFontSuggestions ─────

describe("MAX_AUTOCOMPLETE_RESULTS enforcement for font suggestions", () => {
  it("test_max_autocomplete_results_enforced: filterFontSuggestions respects MAX_AUTOCOMPLETE_RESULTS", () => {
    const fonts = Array.from({ length: MAX_AUTOCOMPLETE_RESULTS + 10 }, (_, i) => ({
      name: `TestFont${String(i).padStart(2, "0")}`,
      source: "system" as const,
    }));
    const provider = makeTestFontProvider(fonts);
    const result = filterFontSuggestions(provider, "");
    expect(result.length).toBeLessThanOrEqual(MAX_AUTOCOMPLETE_RESULTS);
    expect(result).toHaveLength(MAX_AUTOCOMPLETE_RESULTS);
  });
});

// ── Font insertion behaviour — pure helper coverage (Issue 3) ─────────
//
// The `insertSuggestion` function in ValueInput.tsx is a closure inside the
// component that depends on DOM state (`inputRef`, `getCursorOffset`,
// `setCursorOffset`, `renderHighlighted`). It cannot be unit-tested without a
// DOM environment and a mounted component. A JSDOM + Solid testing-library
// integration test would be the right vehicle; that is deferred to the
// component-level test suite.
//
// The pure sub-functions that drive the insertion logic ARE tested above:
//   - `extractFontQuery`  — determines the query for the current font segment.
//   - `isGenericFamily`   — determines whether to append ", " after insertion.
//
// The trailing comma rule is implicitly exercised by the tests below and by
// the `isGenericFamily` tests above: non-generic fonts get ", " appended;
// generic families do not (they are final fallbacks).

describe("trailing comma logic — isGenericFamily drives the insertSuggestion rule", () => {
  it("should return false for named fonts (they get a trailing comma)", () => {
    // Named fonts are not generics → trailing comma appended → font stack continues.
    expect(isGenericFamily("Arial")).toBe(false);
    expect(isGenericFamily("Roboto")).toBe(false);
    expect(isGenericFamily("Inter")).toBe(false);
    expect(isGenericFamily("Helvetica Neue")).toBe(false);
  });

  it("should return true for all CSS generic families (no trailing comma)", () => {
    // Generics are final fallbacks → no trailing comma → stack terminates.
    const generics = [
      "serif",
      "sans-serif",
      "monospace",
      "cursive",
      "fantasy",
      "system-ui",
      "ui-serif",
      "ui-sans-serif",
      "ui-monospace",
      "ui-rounded",
    ];
    for (const name of generics) {
      expect(isGenericFamily(name)).toBe(true);
    }
  });

  it("should be case-insensitive for both named and generic fonts", () => {
    expect(isGenericFamily("SERIF")).toBe(true);
    expect(isGenericFamily("Monospace")).toBe(true);
    expect(isGenericFamily("ARIAL")).toBe(false);
  });
});
