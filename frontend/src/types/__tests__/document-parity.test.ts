import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  StyleValue,
  StyleValueLiteral,
  StyleValueTokenRef,
  StyleValueExpression,
  Color,
} from "../document";
import { DEFAULT_FONT_ENTRY_ID } from "../document";

// Parity test for Spec 13c Phase A.
//
// Loads tests/fixtures/parity/style_value_encoding.json and asserts that each
// documented StyleValue variant round-trips through JSON.parse/JSON.stringify
// with the correct TypeScript discriminated-union narrowing. The matching Rust
// test in crates/core/src/node.rs consumes the same file. See CLAUDE.md
// "Parallel Implementations Must Have Parity Tests".

interface FixtureVariant {
  readonly name: string;
  readonly value: unknown;
}

interface Fixture {
  readonly description: string;
  readonly variants: readonly FixtureVariant[];
}

function loadFixture(): Fixture {
  // Resolve relative to this test file, walking up to the workspace root.
  // __dirname is not available in ESM; use import.meta.url + fileURLToPath.
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(here, "../../../../tests/fixtures/parity/style_value_encoding.json");
  const raw = readFileSync(fixturePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("variants" in parsed) ||
    !Array.isArray((parsed as { variants: unknown }).variants)
  ) {
    throw new Error("parity fixture is malformed");
  }
  return parsed as Fixture;
}

function isColorVariant(name: string): boolean {
  return name.startsWith("literal_color_");
}

describe("StyleValue parity with Rust fixture", () => {
  const fixture = loadFixture();

  it("fixture contains all three StyleValue variants", () => {
    const types = new Set<string>();
    for (const variant of fixture.variants) {
      if (
        typeof variant.value === "object" &&
        variant.value !== null &&
        "type" in variant.value &&
        typeof (variant.value as { type: unknown }).type === "string"
      ) {
        types.add((variant.value as { type: string }).type);
      }
    }
    expect(types.has("literal")).toBe(true);
    expect(types.has("token_ref")).toBe(true);
    expect(types.has("expression")).toBe(true);
  });

  it("round-trips every variant through JSON.parse/stringify", () => {
    for (const variant of fixture.variants) {
      const serialized = JSON.stringify(variant.value);
      const parsed: unknown = JSON.parse(serialized);
      expect(parsed).toEqual(variant.value);
    }
  });

  it("narrows number-typed variants via the discriminated union", () => {
    for (const variant of fixture.variants) {
      if (isColorVariant(variant.name)) {
        continue;
      }
      const sv = variant.value as StyleValue<number>;
      switch (sv.type) {
        case "literal": {
          const lit: StyleValueLiteral<number> = sv;
          expect(typeof lit.value).toBe("number");
          break;
        }
        case "token_ref": {
          const ref: StyleValueTokenRef = sv;
          expect(typeof ref.name).toBe("string");
          expect(ref.name.length).toBeGreaterThan(0);
          break;
        }
        case "expression": {
          const expr: StyleValueExpression = sv;
          expect(typeof expr.expr).toBe("string");
          expect(expr.expr.length).toBeGreaterThan(0);
          break;
        }
        default: {
          // Exhaustiveness check — if a new variant is added and this test is
          // not updated, the TypeScript compiler rejects the assignment below.
          const _exhaustive: never = sv;
          throw new Error(`unhandled StyleValue variant: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }
  });

  it("narrows color-typed variants via the discriminated union", () => {
    for (const variant of fixture.variants) {
      if (!isColorVariant(variant.name)) {
        continue;
      }
      const sv = variant.value as StyleValue<Color>;
      expect(sv.type).toBe("literal");
      if (sv.type === "literal") {
        expect(typeof sv.value.space).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_FONT_ENTRY_ID parity test
//
// The Rust constant `DEFAULT_FONT_ENTRY_ID` in `crates/core/src/font.rs` is
// pinned to the same string by `test_default_font_entry_id_string` in font.rs.
// This test pins the TypeScript side. Together they assert Rust↔TS agreement.
// ---------------------------------------------------------------------------

describe("DEFAULT_FONT_ENTRY_ID parity with Rust constant", () => {
  it("matches the Rust DEFAULT_FONT_ENTRY_ID string representation", () => {
    // Cross-reference: crates/core/src/font.rs :: test_default_font_entry_id_string
    // Both tests assert the same literal; any change to the Rust constant will
    // break the Rust test, and any change to the TS constant will break this test.
    expect(DEFAULT_FONT_ENTRY_ID).toBe("0defa000-dead-f047-beef-cafe00000001");
  });

  it("is a valid lowercase hyphenated UUID string", () => {
    // UUID format: 8-4-4-4-12 hex chars
    expect(DEFAULT_FONT_ENTRY_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
