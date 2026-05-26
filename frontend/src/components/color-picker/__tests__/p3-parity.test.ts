/**
 * Parity test for Spec 18 — Display-P3 conversion.
 *
 * Loads tests/fixtures/parity/p3-color-conversions.json and asserts that
 * the TypeScript `displayP3ToSrgb` / `srgbToDisplayP3` paths (via
 * colorToSrgb / srgbToColor) produce outputs matching the fixture to within
 * the documented tolerance. The matching Rust test in
 * crates/core/src/tokens/color_convert.rs consumes the same file. See
 * CLAUDE.md "Parallel Implementations Must Have Parity Tests".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { colorToSrgb, srgbToColor } from "../color-math";

interface P3ToSrgbCase {
  readonly name: string;
  readonly p3: readonly [number, number, number];
  readonly srgb: readonly [number, number, number];
}

interface SrgbToP3Case {
  readonly name: string;
  readonly srgb: readonly [number, number, number];
  readonly p3: readonly [number, number, number];
}

interface Fixture {
  readonly description: string;
  readonly tolerance: number;
  readonly p3_to_srgb: readonly P3ToSrgbCase[];
  readonly srgb_to_p3: readonly SrgbToP3Case[];
}

function loadFixture(): Fixture {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "../../../../../tests/fixtures/parity/p3-color-conversions.json");
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !("p3_to_srgb" in parsed)) {
    throw new Error("p3 parity fixture is malformed");
  }
  return parsed as Fixture;
}

describe("Display-P3 parity with Rust fixture (Spec 18)", () => {
  const fixture = loadFixture();

  for (const c of fixture.p3_to_srgb) {
    it(`displayP3ToSrgb ${c.name}`, () => {
      const [r, g, b] = colorToSrgb({
        space: "display_p3",
        r: c.p3[0],
        g: c.p3[1],
        b: c.p3[2],
        a: 1,
      });
      expect(Math.abs(r - c.srgb[0])).toBeLessThan(fixture.tolerance);
      expect(Math.abs(g - c.srgb[1])).toBeLessThan(fixture.tolerance);
      expect(Math.abs(b - c.srgb[2])).toBeLessThan(fixture.tolerance);
    });
  }

  for (const c of fixture.srgb_to_p3) {
    it(`srgbToDisplayP3 ${c.name}`, () => {
      const color = srgbToColor(c.srgb[0], c.srgb[1], c.srgb[2], 1, "display_p3");
      if (color.space !== "display_p3") throw new Error("type narrowing failed");
      expect(Math.abs(color.r - c.p3[0])).toBeLessThan(fixture.tolerance);
      expect(Math.abs(color.g - c.p3[1])).toBeLessThan(fixture.tolerance);
      expect(Math.abs(color.b - c.p3[2])).toBeLessThan(fixture.tolerance);
    });
  }
});
