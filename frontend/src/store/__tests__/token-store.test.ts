import { describe, it, expect } from "vitest";
import {
  resolveToken,
  resolveColorToken,
  resolveNumberToken,
  resolveStyleValueColor,
  resolveStyleValueNumber,
  MAX_ALIAS_DEPTH,
} from "../token-store";
import type { Token, TokenValue, Color, StyleValue } from "../../types/document";

// Helpers to build test tokens
const makeToken = (id: string, name: string, value: TokenValue): Token => ({
  id,
  name,
  value,
  token_type: (() => {
    switch (value.type) {
      case "color":
        return "color";
      case "dimension":
        return "dimension";
      case "font_family":
        return "font_family";
      case "font_weight":
        return "font_weight";
      case "duration":
        return "duration";
      case "cubic_bezier":
        return "cubic_bezier";
      case "number":
        return "number";
      case "shadow":
        return "shadow";
      case "gradient":
        return "gradient";
      case "typography":
        return "typography";
      case "alias":
        return "color"; // alias token_type is resolved at runtime
    }
  })(),
  description: null,
});

const RED: Color = { space: "srgb", r: 1, g: 0, b: 0, a: 1 };
const BLUE: Color = { space: "srgb", r: 0, g: 0, b: 1, a: 1 };

describe("resolveToken", () => {
  it("should return the value directly when the token has a concrete value", () => {
    const tokens: Record<string, Token> = {
      "brand/red": makeToken("1", "brand/red", { type: "color", value: RED }),
    };
    const result = resolveToken(tokens, "brand/red");
    expect(result).toEqual({ type: "color", value: RED });
  });

  it("should follow an alias chain and resolve to the concrete value", () => {
    // A → B → concrete
    const tokens: Record<string, Token> = {
      "alias/a": makeToken("1", "alias/a", { type: "alias", name: "alias/b" }),
      "alias/b": makeToken("2", "alias/b", { type: "alias", name: "concrete" }),
      concrete: makeToken("3", "concrete", { type: "color", value: RED }),
    };
    const result = resolveToken(tokens, "alias/a");
    expect(result).toEqual({ type: "color", value: RED });
  });

  it("should return null when the token does not exist", () => {
    const tokens: Record<string, Token> = {};
    const result = resolveToken(tokens, "missing/token");
    expect(result).toBeNull();
  });

  it("should return null when a cycle is detected (A → B → A)", () => {
    const tokens: Record<string, Token> = {
      "cycle/a": makeToken("1", "cycle/a", { type: "alias", name: "cycle/b" }),
      "cycle/b": makeToken("2", "cycle/b", { type: "alias", name: "cycle/a" }),
    };
    const result = resolveToken(tokens, "cycle/a");
    expect(result).toBeNull();
  });

  it("should return null when alias depth exceeds MAX_ALIAS_DEPTH", () => {
    // Build a chain of MAX_ALIAS_DEPTH + 1 aliases so the last hop exceeds the limit
    const tokens: Record<string, Token> = {};
    for (let i = 0; i <= MAX_ALIAS_DEPTH; i++) {
      const name = `deep/${i}`;
      const nextName = `deep/${i + 1}`;
      tokens[name] = makeToken(
        String(i),
        name,
        i < MAX_ALIAS_DEPTH ? { type: "alias", name: nextName } : { type: "color", value: RED },
      );
    }
    // Resolving deep/0 requires MAX_ALIAS_DEPTH hops — exactly at the limit this must return null
    const result = resolveToken(tokens, "deep/0");
    expect(result).toBeNull();
  });
});

describe("resolveColorToken", () => {
  it("should return the Color when the token is a color token", () => {
    const tokens: Record<string, Token> = {
      "color/brand": makeToken("1", "color/brand", {
        type: "color",
        value: RED,
      }),
    };
    const result = resolveColorToken(tokens, "color/brand");
    expect(result).toEqual(RED);
  });

  it("should return null when the token is not a color token", () => {
    const tokens: Record<string, Token> = {
      "spacing/md": makeToken("1", "spacing/md", {
        type: "dimension",
        value: 16,
        unit: "px",
      }),
    };
    const result = resolveColorToken(tokens, "spacing/md");
    expect(result).toBeNull();
  });
});

describe("resolveNumberToken", () => {
  it("should return the value for a number token", () => {
    const tokens: Record<string, Token> = {
      "scale/ratio": makeToken("1", "scale/ratio", {
        type: "number",
        value: 1.618,
      }),
    };
    const result = resolveNumberToken(tokens, "scale/ratio");
    expect(result).toBe(1.618);
  });

  it("should return the value for a dimension token", () => {
    const tokens: Record<string, Token> = {
      "spacing/md": makeToken("1", "spacing/md", {
        type: "dimension",
        value: 16,
        unit: "px",
      }),
    };
    const result = resolveNumberToken(tokens, "spacing/md");
    expect(result).toBe(16);
  });

  it("should return the weight for a font_weight token", () => {
    const tokens: Record<string, Token> = {
      "font/bold": makeToken("1", "font/bold", {
        type: "font_weight",
        weight: 700,
      }),
    };
    const result = resolveNumberToken(tokens, "font/bold");
    expect(result).toBe(700);
  });
});

describe("resolveStyleValueColor", () => {
  it("should pass through the literal value directly", () => {
    const sv: StyleValue<Color> = { type: "literal", value: RED };
    const tokens: Record<string, Token> = {};
    const result = resolveStyleValueColor(sv, tokens, BLUE);
    expect(result).toEqual(RED);
  });

  it("should resolve a token_ref to the token's Color value", () => {
    const sv: StyleValue<Color> = { type: "token_ref", name: "brand/red" };
    const tokens: Record<string, Token> = {
      "brand/red": makeToken("1", "brand/red", { type: "color", value: RED }),
    };
    const result = resolveStyleValueColor(sv, tokens, BLUE);
    expect(result).toEqual(RED);
  });

  it("should return the fallback when a token_ref points to a missing token", () => {
    const sv: StyleValue<Color> = { type: "token_ref", name: "missing" };
    const tokens: Record<string, Token> = {};
    const result = resolveStyleValueColor(sv, tokens, BLUE);
    expect(result).toEqual(BLUE);
  });
});

describe("resolveStyleValueNumber", () => {
  it("should pass through the literal value directly", () => {
    const sv: StyleValue<number> = { type: "literal", value: 42 };
    const tokens: Record<string, Token> = {};
    const result = resolveStyleValueNumber(sv, tokens, 0);
    expect(result).toBe(42);
  });

  it("should resolve a token_ref to the token's numeric value", () => {
    const sv: StyleValue<number> = { type: "token_ref", name: "spacing/md" };
    const tokens: Record<string, Token> = {
      "spacing/md": makeToken("1", "spacing/md", {
        type: "dimension",
        value: 16,
        unit: "px",
      }),
    };
    const result = resolveStyleValueNumber(sv, tokens, 0);
    expect(result).toBe(16);
  });

  it("should return the fallback when a token_ref points to a missing token", () => {
    const sv: StyleValue<number> = { type: "token_ref", name: "missing" };
    const tokens: Record<string, Token> = {};
    const result = resolveStyleValueNumber(sv, tokens, 99);
    expect(result).toBe(99);
  });
});
