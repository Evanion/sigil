import { describe, it, expect } from "vitest";
import { groupTokensByHierarchy, countTokensByType } from "../token-grouping";
import type { Token } from "../../../types/document";

function makeToken(name: string, type: string = "color"): Token {
  return {
    id: crypto.randomUUID(),
    name,
    token_type: type as Token["token_type"],
    value: { type: "color", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
    description: null,
  };
}

describe("groupTokensByHierarchy", () => {
  it("groups tokens by their dot-separated prefix", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary"),
      "brand.error": makeToken("brand.error"),
      "action.primary": makeToken("action.primary"),
      "button.bg.default": makeToken("button.bg.default"),
    };
    const groups = groupTokensByHierarchy(tokens, "color");
    expect(groups.length).toBeGreaterThanOrEqual(3);
    const brand = groups.find((g) => g.label === "brand");
    expect(brand).toBeDefined();
    expect(brand?.tokenNames).toEqual(["brand.error", "brand.primary"]);
  });

  it("filters by token type", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary", "color"),
      "spacing.md": makeToken("spacing.md", "dimension"),
    };
    const groups = groupTokensByHierarchy(tokens, "color");
    const allNames = groups.flatMap((g) => g.tokenNames);
    expect(allNames).toContain("brand.primary");
    expect(allNames).not.toContain("spacing.md");
  });

  it("handles tokens with no dot separator", () => {
    const tokens: Record<string, Token> = {
      primary: makeToken("primary"),
    };
    const groups = groupTokensByHierarchy(tokens, "color");
    expect(groups.length).toBe(1);
    expect(groups[0].label).toBe("ungrouped");
    expect(groups[0].tokenNames).toEqual(["primary"]);
  });

  it("handles search filter", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary"),
      "brand.error": makeToken("brand.error"),
      "neutral.100": makeToken("neutral.100"),
    };
    const groups = groupTokensByHierarchy(tokens, "color", "prim");
    const allNames = groups.flatMap((g) => g.tokenNames);
    expect(allNames).toContain("brand.primary");
    expect(allNames).not.toContain("brand.error");
    expect(allNames).not.toContain("neutral.100");
  });

  it("returns empty array when no tokens match", () => {
    const groups = groupTokensByHierarchy({}, "color");
    expect(groups).toEqual([]);
  });

  it("sorts groups alphabetically and token names within groups", () => {
    const tokens: Record<string, Token> = {
      "z.beta": makeToken("z.beta"),
      "a.alpha": makeToken("a.alpha"),
      "z.alpha": makeToken("z.alpha"),
      "a.beta": makeToken("a.beta"),
    };
    const groups = groupTokensByHierarchy(tokens, "color");
    expect(groups[0].label).toBe("a");
    expect(groups[1].label).toBe("z");
    expect(groups[0].tokenNames).toEqual(["a.alpha", "a.beta"]);
  });

  it("passes all tokens when typeFilter is empty string", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary", "color"),
      "spacing.md": makeToken("spacing.md", "dimension"),
    };
    const groups = groupTokensByHierarchy(tokens, "");
    const allNames = groups.flatMap((g) => g.tokenNames);
    expect(allNames).toContain("brand.primary");
    expect(allNames).toContain("spacing.md");
  });
});

describe("countTokensByType", () => {
  it("counts tokens grouped by their token_type", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary", "color"),
      "brand.error": makeToken("brand.error", "color"),
      "spacing.md": makeToken("spacing.md", "dimension"),
    };
    const counts = countTokensByType(tokens);
    expect(counts.get("color")).toBe(2);
    expect(counts.get("dimension")).toBe(1);
    expect(counts.get("number")).toBeUndefined();
  });

  it("returns empty map for empty input", () => {
    const counts = countTokensByType({});
    expect(counts.size).toBe(0);
  });
});
