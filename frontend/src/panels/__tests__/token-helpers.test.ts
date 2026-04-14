import { describe, it, expect } from "vitest";
import { sanitizeTokenName, validateTokenName } from "../token-helpers";

describe("sanitizeTokenName", () => {
  it("replaces spaces with dots", () => {
    expect(sanitizeTokenName("button background")).toBe("button.background");
  });

  it("replaces multiple spaces with dots", () => {
    expect(sanitizeTokenName("a b c")).toBe("a.b.c");
  });

  it("strips invalid characters", () => {
    expect(sanitizeTokenName("hello@world!")).toBe("helloworld");
  });

  it("preserves valid characters", () => {
    expect(sanitizeTokenName("brand.primary-100_alt/v2")).toBe("brand.primary-100_alt/v2");
  });

  it("handles empty string", () => {
    expect(sanitizeTokenName("")).toBe("");
  });

  it("strips unicode characters", () => {
    expect(sanitizeTokenName("brand.émoji🎨")).toBe("brand.moji");
  });

  it("combined: spaces + invalid chars", () => {
    expect(sanitizeTokenName("my token #1")).toBe("my.token.1");
  });

  it("result passes validateTokenName when non-empty and starts with letter", () => {
    const sanitized = sanitizeTokenName("Button Background Color");
    expect(validateTokenName(sanitized)).toBeNull();
  });
});
