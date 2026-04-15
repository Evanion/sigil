import { describe, it, expect } from "vitest";
import {
  highlightExpression,
  type HighlightSegment,
} from "../expression-highlight";

describe("highlightExpression", () => {
  it("should return empty array for empty string", () => {
    expect(highlightExpression("")).toEqual([]);
  });

  it("should highlight number literal", () => {
    expect(highlightExpression("42")).toEqual([
      { text: "42", type: "number" },
    ]);
  });

  it("should highlight decimal number", () => {
    expect(highlightExpression("3.14")).toEqual([
      { text: "3.14", type: "number" },
    ]);
  });

  it("should highlight percentage", () => {
    expect(highlightExpression("20%")).toEqual([
      { text: "20%", type: "number" },
    ]);
  });

  it("should highlight decimal percentage", () => {
    expect(highlightExpression("12.5%")).toEqual([
      { text: "12.5%", type: "number" },
    ]);
  });

  it("should highlight token reference", () => {
    expect(highlightExpression("{spacing.md}")).toEqual([
      { text: "{spacing.md}", type: "tokenRef" },
    ]);
  });

  it("should highlight token reference with complex name", () => {
    expect(highlightExpression("{brand.colors.primary}")).toEqual([
      { text: "{brand.colors.primary}", type: "tokenRef" },
    ]);
  });

  it("should highlight function call", () => {
    const result = highlightExpression("round(42)");
    expect(result).toEqual([
      { text: "round", type: "function" },
      { text: "(", type: "paren" },
      { text: "42", type: "number" },
      { text: ")", type: "paren" },
    ]);
  });

  it("should highlight operators", () => {
    expect(highlightExpression("+")).toEqual([{ text: "+", type: "operator" }]);
    expect(highlightExpression("-")).toEqual([{ text: "-", type: "operator" }]);
    expect(highlightExpression("*")).toEqual([{ text: "*", type: "operator" }]);
    expect(highlightExpression("/")).toEqual([{ text: "/", type: "operator" }]);
  });

  it("should highlight parentheses and comma", () => {
    expect(highlightExpression("(")).toEqual([{ text: "(", type: "paren" }]);
    expect(highlightExpression(")")).toEqual([{ text: ")", type: "paren" }]);
    expect(highlightExpression(",")).toEqual([{ text: ",", type: "paren" }]);
  });

  it("should highlight binary expression", () => {
    const result = highlightExpression("{a} + {b} * 2");
    expect(result.map((s: HighlightSegment) => s.type)).toEqual([
      "tokenRef",
      "text",
      "operator",
      "text",
      "tokenRef",
      "text",
      "operator",
      "text",
      "number",
    ]);
  });

  it("should highlight unclosed brace as error", () => {
    const result = highlightExpression("{foo");
    expect(result[0].type).toBe("error");
    expect(result[0].text).toBe("{foo");
  });

  it("should highlight unclosed brace with trailing content as error", () => {
    const result = highlightExpression("{foo bar");
    expect(result[0].type).toBe("error");
    expect(result[0].text).toBe("{foo bar");
  });

  it("should highlight nested function", () => {
    const result = highlightExpression("lighten({brand.primary}, 20%)");
    const types = result.map((s: HighlightSegment) => s.type);
    expect(types).toContain("function");
    expect(types).toContain("tokenRef");
    expect(types).toContain("number");
  });

  it("should highlight nested function with correct segments", () => {
    const result = highlightExpression("lighten({brand.primary}, 20%)");
    expect(result).toEqual([
      { text: "lighten", type: "function" },
      { text: "(", type: "paren" },
      { text: "{brand.primary}", type: "tokenRef" },
      { text: ",", type: "paren" },
      { text: " ", type: "text" },
      { text: "20%", type: "number" },
      { text: ")", type: "paren" },
    ]);
  });

  it("should highlight whitespace as text", () => {
    const result = highlightExpression("  ");
    expect(result).toEqual([{ text: "  ", type: "text" }]);
  });

  it("should coalesce consecutive whitespace into one segment", () => {
    const result = highlightExpression("1   +   2");
    expect(result).toEqual([
      { text: "1", type: "number" },
      { text: "   ", type: "text" },
      { text: "+", type: "operator" },
      { text: "   ", type: "text" },
      { text: "2", type: "number" },
    ]);
  });

  it("should treat bare identifiers (not followed by paren) as text", () => {
    const result = highlightExpression("foo");
    expect(result).toEqual([{ text: "foo", type: "text" }]);
  });

  it("should treat unrecognized characters as text", () => {
    const result = highlightExpression("@");
    expect(result).toEqual([{ text: "@", type: "text" }]);
  });

  it("should handle multiple token refs with operators", () => {
    const result = highlightExpression("{a} + {b}");
    expect(result).toEqual([
      { text: "{a}", type: "tokenRef" },
      { text: " ", type: "text" },
      { text: "+", type: "operator" },
      { text: " ", type: "text" },
      { text: "{b}", type: "tokenRef" },
    ]);
  });

  it("should handle function with multiple arguments", () => {
    const result = highlightExpression("clamp(0, {val}, 100)");
    expect(result).toEqual([
      { text: "clamp", type: "function" },
      { text: "(", type: "paren" },
      { text: "0", type: "number" },
      { text: ",", type: "paren" },
      { text: " ", type: "text" },
      { text: "{val}", type: "tokenRef" },
      { text: ",", type: "paren" },
      { text: " ", type: "text" },
      { text: "100", type: "number" },
      { text: ")", type: "paren" },
    ]);
  });

  it("should handle number followed by operator without space", () => {
    const result = highlightExpression("1+2");
    expect(result).toEqual([
      { text: "1", type: "number" },
      { text: "+", type: "operator" },
      { text: "2", type: "number" },
    ]);
  });

  it("should handle mixed valid and error content", () => {
    // Valid token ref followed by unclosed brace
    const result = highlightExpression("{valid} + {broken");
    expect(result[0]).toEqual({ text: "{valid}", type: "tokenRef" });
    expect(result[result.length - 1].type).toBe("error");
  });
});
