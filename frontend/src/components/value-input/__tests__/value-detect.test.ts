import { describe, it, expect } from "vitest";
import { detectValueMode } from "../value-detect";
import type { ValueType } from "../value-detect";

// ── detectValueMode ────────────────────────────────────────────────────

describe("detectValueMode — color detection", () => {
  const colorTypes: readonly ValueType[] = ["color"];

  it("should detect #RGB as literal-color", () => {
    expect(detectValueMode("#f0a", colorTypes)).toBe("literal-color");
  });

  it("should detect #RRGGBB as literal-color", () => {
    expect(detectValueMode("#0d99ff", colorTypes)).toBe("literal-color");
  });

  it("should detect #RRGGBBAA as literal-color", () => {
    expect(detectValueMode("#0d99ff80", colorTypes)).toBe("literal-color");
  });

  it("should detect uppercase hex as literal-color", () => {
    expect(detectValueMode("#AABBCC", colorTypes)).toBe("literal-color");
  });

  it("should not detect invalid hex (non-hex chars) as color", () => {
    // '#' with non-hex chars — unknown, not color
    expect(detectValueMode("#xyz", colorTypes)).toBe("unknown");
  });

  it("should not detect bare # as color", () => {
    expect(detectValueMode("#", colorTypes)).toBe("unknown");
  });
});

describe("detectValueMode — token reference detection", () => {
  const anyTypes: readonly ValueType[] = ["number", "color", "string"];

  it("should detect {name} as reference", () => {
    expect(detectValueMode("{primary}", anyTypes)).toBe("reference");
  });

  it("should detect {nested.name} as reference", () => {
    expect(detectValueMode("{colors.primary}", anyTypes)).toBe("reference");
  });

  it("should detect {name} with spaces as reference", () => {
    expect(detectValueMode("{my token}", anyTypes)).toBe("reference");
  });

  it("should detect a single token reference with no operators outside braces as reference", () => {
    expect(detectValueMode("{spacing.md}", anyTypes)).toBe("reference");
  });
});

describe("detectValueMode — expression detection", () => {
  const anyTypes: readonly ValueType[] = ["number", "color", "string"];

  it("should detect {a} + {b} as expression (operator outside braces)", () => {
    expect(detectValueMode("{a} + {b}", anyTypes)).toBe("expression");
  });

  it("should detect {a} * 2 as expression", () => {
    expect(detectValueMode("{a} * 2", anyTypes)).toBe("expression");
  });

  it("should detect {a} - 1 as expression", () => {
    expect(detectValueMode("{a} - 1", anyTypes)).toBe("expression");
  });

  it("should detect {a} / {b} as expression", () => {
    expect(detectValueMode("{a} / {b}", anyTypes)).toBe("expression");
  });

  it("should detect function call (ident followed by '(') as expression", () => {
    expect(detectValueMode("calc(16)", anyTypes)).toBe("expression");
  });

  it("should detect rem() as expression", () => {
    expect(detectValueMode("rem(16)", anyTypes)).toBe("expression");
  });

  it("should detect multiple token references as expression", () => {
    expect(detectValueMode("{a}{b}", anyTypes)).toBe("expression");
  });
});

describe("detectValueMode — numeric literal detection", () => {
  const numberTypes: readonly ValueType[] = ["number", "dimension"];

  it("should detect digits as literal-number", () => {
    expect(detectValueMode("16", numberTypes)).toBe("literal-number");
  });

  it("should detect decimal number as literal-number", () => {
    expect(detectValueMode("3.14", numberTypes)).toBe("literal-number");
  });

  it("should detect negative number as literal-number", () => {
    expect(detectValueMode("-8", numberTypes)).toBe("literal-number");
  });

  it("should detect 0 as literal-number", () => {
    expect(detectValueMode("0", numberTypes)).toBe("literal-number");
  });

  it("should detect number with unit suffix as literal-number", () => {
    expect(detectValueMode("16px", numberTypes)).toBe("literal-number");
  });

  it("should detect percentage as literal-number", () => {
    expect(detectValueMode("50%", numberTypes)).toBe("literal-number");
  });
});

describe("detectValueMode — font name detection", () => {
  it("should detect letter-starting string as literal-font when font_family is accepted", () => {
    expect(detectValueMode("Inter", ["font_family"])).toBe("literal-font");
  });

  it("should detect multi-word font name as literal-font", () => {
    expect(detectValueMode("Helvetica Neue", ["font_family"])).toBe("literal-font");
  });

  it("should NOT detect letter-starting string as literal-font when font_family is NOT accepted", () => {
    expect(detectValueMode("Inter", ["color", "number"])).toBe("unknown");
  });
});

describe("detectValueMode — empty and edge cases", () => {
  it("should return unknown for empty string", () => {
    expect(detectValueMode("", ["color", "number"])).toBe("unknown");
  });

  it("should return unknown for whitespace-only string", () => {
    expect(detectValueMode("   ", ["color", "number"])).toBe("unknown");
  });

  it("should return unknown for unrecognized input", () => {
    expect(detectValueMode("???", ["color", "number"])).toBe("unknown");
  });

  it("should handle acceptedTypes=[] and return unknown for any input", () => {
    // With no accepted types, font detection is off
    expect(detectValueMode("16", [])).toBe("unknown");
  });

  it("should not treat operators inside braces as expression markers", () => {
    // {a+b} is a token ref (operators inside braces), not an expression
    expect(detectValueMode("{a+b}", ["number"])).toBe("reference");
  });
});
