import { describe, it, expect } from "vitest";
import {
  parseExpression,
  evaluateExpression,
  resolveExpression,
  isEvalError,
  MAX_EXPRESSION_LENGTH,
  MAX_AST_DEPTH,
  MAX_FUNCTION_ARGS,
  MAX_EVAL_DEPTH,
} from "../expression-eval";
import type { TokenExpression, EvalValue, EvalError } from "../expression-eval";
import type { Token, TokenValue, Color } from "../../types/document";

// ── Test helpers ──────────────────────────────────────────────────────

const makeToken = (name: string, value: TokenValue): Token => ({
  id: `id-${name}`,
  name,
  value,
  token_type: (() => {
    switch (value.type) {
      case "color":
        return "color";
      case "dimension":
        return "dimension";
      case "number":
        return "number";
      case "font_family":
        return "font_family";
      case "font_weight":
        return "font_weight";
      case "duration":
        return "duration";
      case "cubic_bezier":
        return "cubic_bezier";
      case "shadow":
        return "shadow";
      case "gradient":
        return "gradient";
      case "typography":
        return "typography";
      case "alias":
        return "color";
      case "expression":
        return "number";
    }
  })(),
  description: null,
});

const RED: Color = { space: "srgb", r: 1, g: 0, b: 0, a: 1 };
const GREEN: Color = { space: "srgb", r: 0, g: 1, b: 0, a: 1 };
const BLUE: Color = { space: "srgb", r: 0, g: 0, b: 1, a: 1 };
const WHITE: Color = { space: "srgb", r: 1, g: 1, b: 1, a: 1 };
const BLACK: Color = { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
const MID_GRAY: Color = { space: "srgb", r: 0.5, g: 0.5, b: 0.5, a: 1 };

function expectNumber(
  result: EvalValue | EvalError,
  expected: number,
  tolerance: number = 1e-6,
): void {
  expect(isEvalError(result)).toBe(false);
  const val = result as EvalValue;
  expect(val.type).toBe("number");
  if (val.type === "number") {
    expect(val.value).toBeCloseTo(expected, -Math.log10(tolerance));
  }
}

function expectColor(result: EvalValue | EvalError): Color {
  expect(isEvalError(result)).toBe(false);
  const val = result as EvalValue;
  expect(val.type).toBe("color");
  if (val.type === "color") {
    return val.value;
  }
  throw new Error("Expected color");
}

function expectError(result: EvalValue | EvalError, errorType: EvalError["type"]): void {
  expect(isEvalError(result)).toBe(true);
  expect((result as EvalError).type).toBe(errorType);
}

// ── Parser tests ──────────────────────────────────────────────────────

describe("parseExpression", () => {
  it("should parse integer literals", () => {
    const result = parseExpression("42");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("literal");
    if (expr.type === "literal") {
      expect(expr.value).toEqual({ type: "number", value: 42 });
    }
  });

  it("should parse decimal literals", () => {
    const result = parseExpression("3.14");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("literal");
    if (expr.type === "literal") {
      expect(expr.value).toEqual({ type: "number", value: 3.14 });
    }
  });

  it("should parse percentage literals", () => {
    const result = parseExpression("20%");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("literal");
    if (expr.type === "literal") {
      expect(expr.value.type).toBe("percentage");
      if (expr.value.type === "percentage") {
        expect(expr.value.value).toBeCloseTo(0.2);
      }
    }
  });

  it("should parse braced token references", () => {
    const result = parseExpression("{spacing.md}");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("tokenRef");
    if (expr.type === "tokenRef") {
      expect(expr.name).toBe("spacing.md");
    }
  });

  it("should parse bare token references", () => {
    const result = parseExpression("spacing.md");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("tokenRef");
    if (expr.type === "tokenRef") {
      expect(expr.name).toBe("spacing.md");
    }
  });

  it("should parse addition", () => {
    const result = parseExpression("1 + 2");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("binaryOp");
    if (expr.type === "binaryOp") {
      expect(expr.op).toBe("add");
    }
  });

  it("should parse multiplication with higher precedence than addition", () => {
    const result = parseExpression("1 + 2 * 3");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    // Should be: 1 + (2 * 3), i.e., add(1, mul(2, 3))
    expect(expr.type).toBe("binaryOp");
    if (expr.type === "binaryOp") {
      expect(expr.op).toBe("add");
      expect(expr.right.type).toBe("binaryOp");
      if (expr.right.type === "binaryOp") {
        expect(expr.right.op).toBe("mul");
      }
    }
  });

  it("should parse unary negation", () => {
    const result = parseExpression("-5");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("unaryNeg");
  });

  it("should parse function calls with no arguments", () => {
    // Note: this will parse but may fail at evaluation if arity doesn't match
    const result = parseExpression("abs()");
    // abs expects 1 arg, but parser allows 0 args in syntax
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("functionCall");
    if (expr.type === "functionCall") {
      expect(expr.name).toBe("abs");
      expect(expr.args).toHaveLength(0);
    }
  });

  it("should parse function calls with arguments", () => {
    const result = parseExpression("min(1, 2)");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("functionCall");
    if (expr.type === "functionCall") {
      expect(expr.name).toBe("min");
      expect(expr.args).toHaveLength(2);
    }
  });

  it("should parse nested function calls", () => {
    const result = parseExpression("max(min(1, 2), 3)");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("functionCall");
    if (expr.type === "functionCall") {
      expect(expr.name).toBe("max");
      expect(expr.args[0].type).toBe("functionCall");
    }
  });

  it("should parse parenthesized expressions", () => {
    const result = parseExpression("(1 + 2) * 3");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("binaryOp");
    if (expr.type === "binaryOp") {
      expect(expr.op).toBe("mul");
      expect(expr.left.type).toBe("binaryOp");
    }
  });

  it("should parse string literals", () => {
    const result = parseExpression("'hello'");
    expect(isEvalError(result as EvalValue | EvalError)).toBe(false);
    const expr = result as TokenExpression;
    expect(expr.type).toBe("literal");
    if (expr.type === "literal") {
      expect(expr.value).toEqual({ type: "string", value: "hello" });
    }
  });

  // Error cases

  it("should return parse error on empty input", () => {
    const result = parseExpression("");
    expectError(result as EvalValue | EvalError, "parse");
  });

  it("should return parse error on unterminated string", () => {
    const result = parseExpression("'hello");
    expectError(result as EvalValue | EvalError, "parse");
  });

  it("should return parse error on unterminated token ref", () => {
    const result = parseExpression("{spacing.md");
    expectError(result as EvalValue | EvalError, "parse");
  });

  it("should return parse error on empty token ref", () => {
    const result = parseExpression("{}");
    expectError(result as EvalValue | EvalError, "parse");
  });

  it("should return parse error on trailing characters", () => {
    const result = parseExpression("1 + 2 )");
    expectError(result as EvalValue | EvalError, "parse");
  });

  it("should return parse error on missing closing paren", () => {
    const result = parseExpression("(1 + 2");
    expectError(result as EvalValue | EvalError, "parse");
  });

  it("should return error on expression exceeding MAX_EXPRESSION_LENGTH", () => {
    const long = "1" + " + 1".repeat(MAX_EXPRESSION_LENGTH);
    const result = parseExpression(long);
    expectError(result as EvalValue | EvalError, "parse");
  });

  it("should return error on deeply nested expression exceeding MAX_AST_DEPTH", () => {
    // Create deeply nested parenthesized expression: (((((...(1)...))))
    const depth = MAX_AST_DEPTH + 1;
    const open = "(".repeat(depth);
    const close = ")".repeat(depth);
    const expr = `${open}1${close}`;
    const result = parseExpression(expr);
    // Should get a depthExceeded error
    expect(isEvalError(result as EvalValue | EvalError)).toBe(true);
  });

  it("should return error when function has too many arguments", () => {
    const args = Array(MAX_FUNCTION_ARGS + 1)
      .fill("1")
      .join(", ");
    const result = parseExpression(`max(${args})`);
    expectError(result as EvalValue | EvalError, "parse");
  });
});

// ── Evaluator tests ───────────────────────────────────────────────────

describe("evaluateExpression", () => {
  const emptyTokens: Record<string, Token> = {};

  it("should evaluate number literals", () => {
    const expr = parseExpression("42") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, 42);
  });

  it("should evaluate percentage literals as decimal", () => {
    const expr = parseExpression("50%") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, 0.5);
  });

  it("should evaluate addition", () => {
    const expr = parseExpression("10 + 5") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, 15);
  });

  it("should evaluate subtraction", () => {
    const expr = parseExpression("10 - 3") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, 7);
  });

  it("should evaluate multiplication", () => {
    const expr = parseExpression("4 * 5") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, 20);
  });

  it("should evaluate division", () => {
    const expr = parseExpression("20 / 4") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, 5);
  });

  it("should return divisionByZero on division by zero", () => {
    const expr = parseExpression("1 / 0") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectError(result, "divisionByZero");
  });

  it("should evaluate unary negation", () => {
    const expr = parseExpression("-5") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, -5);
  });

  it("should respect operator precedence", () => {
    const expr = parseExpression("2 + 3 * 4") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, 14);
  });

  it("should respect parenthesized grouping", () => {
    const expr = parseExpression("(2 + 3) * 4") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectNumber(result, 20);
  });

  // Token resolution

  it("should resolve number token references", () => {
    const tokens: Record<string, Token> = {
      "spacing.md": makeToken("spacing.md", { type: "number", value: 16 }),
    };
    const expr = parseExpression("{spacing.md}") as TokenExpression;
    const result = evaluateExpression(expr, tokens);
    expectNumber(result, 16);
  });

  it("should resolve dimension token references", () => {
    const tokens: Record<string, Token> = {
      "size.sm": makeToken("size.sm", { type: "dimension", value: 8, unit: "px" }),
    };
    const expr = parseExpression("{size.sm}") as TokenExpression;
    const result = evaluateExpression(expr, tokens);
    expectNumber(result, 8);
  });

  it("should resolve color token references", () => {
    const tokens: Record<string, Token> = {
      "color.red": makeToken("color.red", { type: "color", value: RED }),
    };
    const expr = parseExpression("{color.red}") as TokenExpression;
    const result = evaluateExpression(expr, tokens);
    expect(isEvalError(result)).toBe(false);
    expect((result as EvalValue).type).toBe("color");
  });

  it("should resolve alias chains", () => {
    const tokens: Record<string, Token> = {
      "spacing.base": makeToken("spacing.base", { type: "number", value: 8 }),
      "spacing.md": makeToken("spacing.md", { type: "alias", name: "spacing.base" }),
    };
    const expr = parseExpression("{spacing.md}") as TokenExpression;
    const result = evaluateExpression(expr, tokens);
    expectNumber(result, 8);
  });

  it("should return referenceNotFound for missing tokens", () => {
    const expr = parseExpression("{nonexistent}") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens);
    expectError(result, "referenceNotFound");
  });

  it("should return typeError when using color in arithmetic", () => {
    const tokens: Record<string, Token> = {
      "color.red": makeToken("color.red", { type: "color", value: RED }),
    };
    const expr = parseExpression("{color.red} + 1") as TokenExpression;
    const result = evaluateExpression(expr, tokens);
    expectError(result, "typeError");
  });

  it("should return depthExceeded when evaluation depth is exceeded", () => {
    const expr = parseExpression("1") as TokenExpression;
    const result = evaluateExpression(expr, emptyTokens, MAX_EVAL_DEPTH);
    expectError(result, "depthExceeded");
  });

  // Expression token references
  it("should resolve expression token references", () => {
    const tokens: Record<string, Token> = {
      "spacing.base": makeToken("spacing.base", { type: "number", value: 8 }),
      "spacing.lg": makeToken("spacing.lg", { type: "expression", expr: "{spacing.base} * 2" }),
    };
    const expr = parseExpression("{spacing.lg}") as TokenExpression;
    const result = evaluateExpression(expr, tokens);
    expectNumber(result, 16);
  });
});

// ── Function tests ────────────────────────────────────────────────────

describe("math functions", () => {
  const tokens: Record<string, Token> = {};

  it("should evaluate round", () => {
    expectNumber(resolveExpression("round(3.7)", tokens), 4);
    expectNumber(resolveExpression("round(3.2)", tokens), 3);
    expectNumber(resolveExpression("round(3.5)", tokens), 4);
  });

  it("should evaluate ceil", () => {
    expectNumber(resolveExpression("ceil(3.1)", tokens), 4);
    expectNumber(resolveExpression("ceil(3.0)", tokens), 3);
  });

  it("should evaluate floor", () => {
    expectNumber(resolveExpression("floor(3.9)", tokens), 3);
    expectNumber(resolveExpression("floor(3.0)", tokens), 3);
  });

  it("should evaluate abs", () => {
    expectNumber(resolveExpression("abs(-5)", tokens), 5);
    expectNumber(resolveExpression("abs(5)", tokens), 5);
  });

  it("should evaluate min", () => {
    expectNumber(resolveExpression("min(3, 7)", tokens), 3);
    expectNumber(resolveExpression("min(7, 3)", tokens), 3);
  });

  it("should evaluate max", () => {
    expectNumber(resolveExpression("max(3, 7)", tokens), 7);
    expectNumber(resolveExpression("max(7, 3)", tokens), 7);
  });

  it("should evaluate clamp", () => {
    expectNumber(resolveExpression("clamp(5, 0, 10)", tokens), 5);
    expectNumber(resolveExpression("clamp(-1, 0, 10)", tokens), 0);
    expectNumber(resolveExpression("clamp(15, 0, 10)", tokens), 10);
  });

  it("should return unknownFunction for unregistered functions", () => {
    const result = resolveExpression("unknown(1)", tokens);
    expectError(result, "unknownFunction");
  });

  it("should return arityError for wrong argument count", () => {
    const result = resolveExpression("abs(1, 2)", tokens);
    expectError(result, "arityError");
  });

  it("should return typeError for wrong argument type", () => {
    const result = resolveExpression("abs('hello')", tokens);
    expectError(result, "typeError");
  });
});

describe("size functions", () => {
  const tokens: Record<string, Token> = {};

  it("should evaluate rem (base 16)", () => {
    expectNumber(resolveExpression("rem(1)", tokens), 16);
    expectNumber(resolveExpression("rem(1.5)", tokens), 24);
  });

  it("should evaluate em (base 16)", () => {
    expectNumber(resolveExpression("em(2)", tokens), 32);
  });

  it("should evaluate px (identity)", () => {
    expectNumber(resolveExpression("px(16)", tokens), 16);
  });
});

describe("color manipulation functions", () => {
  const tokens: Record<string, Token> = {
    red: makeToken("red", { type: "color", value: RED }),
    green: makeToken("green", { type: "color", value: GREEN }),
    blue: makeToken("blue", { type: "color", value: BLUE }),
    white: makeToken("white", { type: "color", value: WHITE }),
    black: makeToken("black", { type: "color", value: BLACK }),
    gray: makeToken("gray", { type: "color", value: MID_GRAY }),
  };

  it("should lighten a color", () => {
    const result = resolveExpression("lighten(black, 0.5)", tokens);
    const color = expectColor(result);
    // Black lightened by 0.5 should produce a gray with lightness ~0.5
    expect(color.space).toBe("srgb");
  });

  it("should darken a color", () => {
    const result = resolveExpression("darken(white, 0.5)", tokens);
    const color = expectColor(result);
    expect(color.space).toBe("srgb");
  });

  it("should saturate a color", () => {
    const result = resolveExpression("saturate(gray, 0.3)", tokens);
    expect(isEvalError(result)).toBe(false);
    expect((result as EvalValue).type).toBe("color");
  });

  it("should desaturate a color", () => {
    const result = resolveExpression("desaturate(red, 0.5)", tokens);
    const color = expectColor(result);
    expect(color.space).toBe("srgb");
  });

  it("should set alpha on a color", () => {
    const result = resolveExpression("alpha(red, 0.5)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.a).toBeCloseTo(0.5);
    }
  });

  it("should mix two colors at 50%", () => {
    const result = resolveExpression("mix(black, white, 0.5)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.5);
      expect(color.g).toBeCloseTo(0.5);
      expect(color.b).toBeCloseTo(0.5);
    }
  });

  it("should mix two colors at 0% (first color)", () => {
    const result = resolveExpression("mix(black, white, 0)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0);
      expect(color.g).toBeCloseTo(0);
      expect(color.b).toBeCloseTo(0);
    }
  });

  it("should mix two colors at 100% (second color)", () => {
    const result = resolveExpression("mix(black, white, 1)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(1);
      expect(color.g).toBeCloseTo(1);
      expect(color.b).toBeCloseTo(1);
    }
  });

  it("should compute contrast ratio", () => {
    const result = resolveExpression("contrast(black, white)", tokens);
    // WCAG contrast between black and white is 21:1
    expectNumber(result, 21, 0.1);
  });

  it("should compute complement of red", () => {
    const result = resolveExpression("complement(red)", tokens);
    const color = expectColor(result);
    // Complement of red is cyan (r=0, g=1, b=1)
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0, 1);
      expect(color.g).toBeCloseTo(1, 1);
      expect(color.b).toBeCloseTo(1, 1);
    }
  });

  it("should set hue on a color", () => {
    const result = resolveExpression("hue(red, 120)", tokens);
    const color = expectColor(result);
    // Hue 120 = green
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0, 1);
      expect(color.g).toBeCloseTo(1, 1);
      expect(color.b).toBeCloseTo(0, 1);
    }
  });
});

describe("channel setter functions", () => {
  const tokens: Record<string, Token> = {
    red: makeToken("red", { type: "color", value: RED }),
    black: makeToken("black", { type: "color", value: BLACK }),
  };

  it("should set red channel", () => {
    const result = resolveExpression("setRed(black, 0.5)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.5);
      expect(color.g).toBeCloseTo(0);
      expect(color.b).toBeCloseTo(0);
    }
  });

  it("should set green channel", () => {
    const result = resolveExpression("setGreen(black, 0.7)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.g).toBeCloseTo(0.7);
    }
  });

  it("should set blue channel", () => {
    const result = resolveExpression("setBlue(black, 1)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.b).toBeCloseTo(1);
    }
  });

  it("should set hue via setHue", () => {
    const result = resolveExpression("setHue(red, 240)", tokens);
    const color = expectColor(result);
    // Hue 240 = blue
    if (color.space === "srgb") {
      expect(color.b).toBeCloseTo(1, 1);
    }
  });

  it("should set saturation", () => {
    const result = resolveExpression("setSaturation(red, 0.5)", tokens);
    const color = expectColor(result);
    expect(color.space).toBe("srgb");
  });

  it("should set lightness", () => {
    const result = resolveExpression("setLightness(red, 0.75)", tokens);
    const color = expectColor(result);
    expect(color.space).toBe("srgb");
  });
});

describe("channel adjuster functions", () => {
  const tokens: Record<string, Token> = {
    gray: makeToken("gray", { type: "color", value: MID_GRAY }),
  };

  it("should adjust red channel", () => {
    const result = resolveExpression("adjustRed(gray, 0.2)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.7);
    }
  });

  it("should adjust green channel negatively", () => {
    const result = resolveExpression("adjustGreen(gray, -0.3)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.g).toBeCloseTo(0.2);
    }
  });

  it("should adjust blue channel", () => {
    const result = resolveExpression("adjustBlue(gray, 0.5)", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.b).toBeCloseTo(1.0);
    }
  });

  it("should adjust hue", () => {
    const result = resolveExpression("adjustHue(gray, 30)", tokens);
    expect(isEvalError(result)).toBe(false);
    expect((result as EvalValue).type).toBe("color");
  });

  it("should adjust saturation", () => {
    const result = resolveExpression("adjustSaturation(gray, 0.3)", tokens);
    expect(isEvalError(result)).toBe(false);
    expect((result as EvalValue).type).toBe("color");
  });

  it("should adjust lightness", () => {
    const result = resolveExpression("adjustLightness(gray, 0.2)", tokens);
    expect(isEvalError(result)).toBe(false);
    expect((result as EvalValue).type).toBe("color");
  });
});

describe("channel extractor functions", () => {
  const tokens: Record<string, Token> = {
    red: makeToken("red", { type: "color", value: RED }),
    green: makeToken("green", { type: "color", value: GREEN }),
    blue: makeToken("blue", { type: "color", value: BLUE }),
  };

  it("should extract red channel", () => {
    expectNumber(resolveExpression("red(red)", tokens), 1);
    expectNumber(resolveExpression("red(green)", tokens), 0);
  });

  it("should extract green channel", () => {
    expectNumber(resolveExpression("green(green)", tokens), 1);
    expectNumber(resolveExpression("green(red)", tokens), 0);
  });

  it("should extract blue channel", () => {
    expectNumber(resolveExpression("blue(blue)", tokens), 1);
    expectNumber(resolveExpression("blue(red)", tokens), 0);
  });

  it("should extract hue", () => {
    // Red hue = 0, green hue = 120, blue hue = 240
    expectNumber(resolveExpression("hueOf(red)", tokens), 0);
    expectNumber(resolveExpression("hueOf(green)", tokens), 120);
    expectNumber(resolveExpression("hueOf(blue)", tokens), 240);
  });

  it("should extract saturation", () => {
    // Pure red has saturation 1
    expectNumber(resolveExpression("saturationOf(red)", tokens), 1);
  });

  it("should extract lightness", () => {
    // Pure red has lightness 0.5
    expectNumber(resolveExpression("lightnessOf(red)", tokens), 0.5);
  });
});

describe("blend function", () => {
  const tokens: Record<string, Token> = {
    white: makeToken("white", { type: "color", value: WHITE }),
    black: makeToken("black", { type: "color", value: BLACK }),
    red: makeToken("red", { type: "color", value: RED }),
    gray: makeToken("gray", { type: "color", value: MID_GRAY }),
  };

  it("should blend with normal mode", () => {
    const result = resolveExpression("blend(white, black, 'normal')", tokens);
    const color = expectColor(result);
    // Normal blend: result is the top layer (black)
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0);
      expect(color.g).toBeCloseTo(0);
      expect(color.b).toBeCloseTo(0);
    }
  });

  it("should blend with multiply mode", () => {
    const result = resolveExpression("blend(gray, gray, 'multiply')", tokens);
    const color = expectColor(result);
    // multiply(0.5, 0.5) = 0.25
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.25);
    }
  });

  it("should blend with screen mode", () => {
    const result = resolveExpression("blend(gray, gray, 'screen')", tokens);
    const color = expectColor(result);
    // screen(0.5, 0.5) = 1 - (1-0.5)*(1-0.5) = 0.75
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.75);
    }
  });

  it("should blend with overlay mode", () => {
    const result = resolveExpression("blend(gray, gray, 'overlay')", tokens);
    expect(isEvalError(result)).toBe(false);
    expect((result as EvalValue).type).toBe("color");
  });

  it("should blend with darken mode", () => {
    const result = resolveExpression("blend(white, gray, 'darken')", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.5);
    }
  });

  it("should blend with lighten mode", () => {
    const result = resolveExpression("blend(black, gray, 'lighten')", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.5);
    }
  });

  it("should blend with difference mode", () => {
    const result = resolveExpression("blend(white, gray, 'difference')", tokens);
    const color = expectColor(result);
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.5);
    }
  });

  it("should blend with exclusion mode", () => {
    const result = resolveExpression("blend(gray, gray, 'exclusion')", tokens);
    const color = expectColor(result);
    // exclusion(0.5, 0.5) = 0.5 + 0.5 - 2*0.5*0.5 = 0.5
    if (color.space === "srgb") {
      expect(color.r).toBeCloseTo(0.5);
    }
  });

  it("should return domainError for unknown blend mode", () => {
    const result = resolveExpression("blend(white, black, 'nonexistent')", tokens);
    expectError(result, "domainError");
  });

  it("should return typeError when blend mode is not a string", () => {
    const result = resolveExpression("blend(white, black, 1)", tokens);
    expectError(result, "typeError");
  });
});

// ── Integration tests ─────────────────────────────────────────────────

describe("resolveExpression integration", () => {
  it("should resolve {spacing.md} * 2 to 32", () => {
    const tokens: Record<string, Token> = {
      "spacing.md": makeToken("spacing.md", { type: "number", value: 16 }),
    };
    const result = resolveExpression("{spacing.md} * 2", tokens);
    expectNumber(result, 32);
  });

  it("should resolve complex expressions with multiple token refs", () => {
    const tokens: Record<string, Token> = {
      "spacing.sm": makeToken("spacing.sm", { type: "number", value: 4 }),
      "spacing.md": makeToken("spacing.md", { type: "number", value: 16 }),
    };
    const result = resolveExpression("{spacing.sm} + {spacing.md}", tokens);
    expectNumber(result, 20);
  });

  it("should resolve expressions with functions and token refs", () => {
    const tokens: Record<string, Token> = {
      "spacing.base": makeToken("spacing.base", { type: "number", value: 8 }),
    };
    const result = resolveExpression("round({spacing.base} * 1.5)", tokens);
    expectNumber(result, 12);
  });

  it("should resolve nested expression tokens", () => {
    const tokens: Record<string, Token> = {
      base: makeToken("base", { type: "number", value: 4 }),
      double: makeToken("double", { type: "expression", expr: "{base} * 2" }),
      quad: makeToken("quad", { type: "expression", expr: "{double} * 2" }),
    };
    const result = resolveExpression("{quad}", tokens);
    expectNumber(result, 16);
  });

  it("should resolve color function with token ref", () => {
    const tokens: Record<string, Token> = {
      "brand.primary": makeToken("brand.primary", { type: "color", value: RED }),
    };
    const result = resolveExpression("lighten({brand.primary}, 0.2)", tokens);
    expect(isEvalError(result)).toBe(false);
    expect((result as EvalValue).type).toBe("color");
  });

  it("should handle division and remainder with rounding", () => {
    const tokens: Record<string, Token> = {};
    const result = resolveExpression("floor(7 / 2)", tokens);
    expectNumber(result, 3);
  });
});

// ── Constant enforcement tests ────────────────────────────────────────

describe("constant enforcement", () => {
  it("should enforce MAX_EXPRESSION_LENGTH", () => {
    const overLength = "a".repeat(MAX_EXPRESSION_LENGTH + 1);
    const result = parseExpression(overLength);
    expect(isEvalError(result as EvalValue | EvalError)).toBe(true);
    expect((result as EvalError).type).toBe("parse");
  });

  it("should enforce MAX_AST_DEPTH via nested parentheses", () => {
    const depth = MAX_AST_DEPTH + 1;
    const expr = "(".repeat(depth) + "1" + ")".repeat(depth);
    const result = parseExpression(expr);
    expect(isEvalError(result as EvalValue | EvalError)).toBe(true);
  });

  it("should enforce MAX_FUNCTION_ARGS", () => {
    const args = Array(MAX_FUNCTION_ARGS + 1)
      .fill("1")
      .join(", ");
    const result = parseExpression(`clamp(${args})`);
    expect(isEvalError(result as EvalValue | EvalError)).toBe(true);
    expect((result as EvalError).type).toBe("parse");
  });

  it("should enforce MAX_EVAL_DEPTH", () => {
    const expr = parseExpression("1") as TokenExpression;
    const result = evaluateExpression(expr, {}, MAX_EVAL_DEPTH);
    expect(isEvalError(result)).toBe(true);
    expect((result as EvalError).type).toBe("depthExceeded");
  });
});

// ── isEvalError type guard tests ──────────────────────────────────────

describe("isEvalError", () => {
  it("should return true for all error types", () => {
    const errors: EvalError[] = [
      { type: "parse", message: "test" },
      { type: "unknownFunction", name: "test" },
      { type: "arityError", name: "test", expected: 1, got: 2 },
      { type: "typeError", expected: "number", got: "string" },
      { type: "referenceNotFound", name: "test" },
      { type: "depthExceeded" },
      { type: "divisionByZero" },
      { type: "domainError", message: "test" },
    ];
    for (const err of errors) {
      expect(isEvalError(err)).toBe(true);
    }
  });

  it("should return false for value types", () => {
    const values: EvalValue[] = [
      { type: "number", value: 42 },
      { type: "color", value: RED },
      { type: "string", value: "hello" },
    ];
    for (const val of values) {
      expect(isEvalError(val)).toBe(false);
    }
  });
});
