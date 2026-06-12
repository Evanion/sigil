import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FontEntry, FontSource, EmbedDecision } from "../document";

// Parity test for fonts-1 Task 14.
//
// Loads tests/fixtures/parity/font_entry_encoding.json and asserts that each
// variant conforms to the FontEntry TypeScript shape. The matching Rust test in
// crates/core/src/font.rs consumes the same file. See CLAUDE.md "Parallel
// Implementations Must Have Parity Tests".

interface FixtureVariant {
  readonly name: string;
  readonly value: unknown;
}

interface Fixture {
  readonly description: string;
  readonly variants: readonly FixtureVariant[];
}

const VALID_FONT_SOURCES: ReadonlySet<string> = new Set([
  "bundled",
  "library",
  "custom",
  "system_reference",
]);

const VALID_EMBED_DECISIONS: ReadonlySet<string> = new Set([
  "embed",
  "reference_restricted",
  "reference_system",
  "reference_no_os2",
  "reference_preview_print",
]);

function loadFixture(): Fixture {
  // Resolve relative to this test file, walking up to the workspace root.
  // __dirname is not available in ESM; use import.meta.url + fileURLToPath.
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(here, "../../../../tests/fixtures/parity/font_entry_encoding.json");
  const raw = readFileSync(fixturePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("variants" in parsed) ||
    !Array.isArray((parsed as { variants: unknown }).variants)
  ) {
    throw new Error("font_entry_encoding parity fixture is malformed");
  }
  return parsed as Fixture;
}

/**
 * Validates that an unknown value conforms to the FontEntry TS shape.
 * Uses unknown + explicit narrowing — no `any` (CLAUDE.md §5 TypeScript rules).
 */
function assertFontEntry(value: unknown, variantName: string): asserts value is FontEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error(`[${variantName}] value must be an object`);
  }

  const obj = value as Record<string, unknown>;

  // id: string (UUID)
  if (typeof obj["id"] !== "string") {
    throw new Error(`[${variantName}] id must be a string`);
  }

  // family: string
  if (typeof obj["family"] !== "string" || obj["family"].length === 0) {
    throw new Error(`[${variantName}] family must be a non-empty string`);
  }

  // postscript_name: string
  if (typeof obj["postscript_name"] !== "string" || obj["postscript_name"].length === 0) {
    throw new Error(`[${variantName}] postscript_name must be a non-empty string`);
  }

  // source: FontSource — check discriminant
  if (typeof obj["source"] !== "object" || obj["source"] === null) {
    throw new Error(`[${variantName}] source must be an object`);
  }
  const source = obj["source"] as Record<string, unknown>;
  if (typeof source["source"] !== "string") {
    throw new Error(`[${variantName}] source.source must be a string`);
  }
  const sourceDiscriminant = source["source"];
  if (!VALID_FONT_SOURCES.has(sourceDiscriminant)) {
    throw new Error(
      `[${variantName}] source.source "${sourceDiscriminant}" is not a valid FontSource discriminant`,
    );
  }
  // Additional field checks per discriminant
  if (sourceDiscriminant === "library") {
    if (typeof source["catalog_id"] !== "string") {
      throw new Error(`[${variantName}] source.catalog_id must be a string for "library" source`);
    }
  }
  if (sourceDiscriminant === "custom") {
    if (typeof source["asset_uuid"] !== "string") {
      throw new Error(`[${variantName}] source.asset_uuid must be a string for "custom" source`);
    }
  }

  // metrics: FontMetrics
  if (typeof obj["metrics"] !== "object" || obj["metrics"] === null) {
    throw new Error(`[${variantName}] metrics must be an object`);
  }
  const metrics = obj["metrics"] as Record<string, unknown>;
  if (typeof metrics["units_per_em"] !== "number" || metrics["units_per_em"] <= 0) {
    throw new Error(`[${variantName}] metrics.units_per_em must be a positive number`);
  }
  for (const field of [
    "ascent",
    "descent",
    "line_gap",
    "cap_height",
    "x_height",
    "italic_angle",
    "avg_advance",
  ] as const) {
    if (typeof metrics[field] !== "number" || !Number.isFinite(metrics[field] as number)) {
      throw new Error(`[${variantName}] metrics.${field} must be a finite number`);
    }
  }
  // panose: 10-element array
  if (!Array.isArray(metrics["panose"]) || (metrics["panose"] as unknown[]).length !== 10) {
    throw new Error(`[${variantName}] metrics.panose must be an array of length 10`);
  }
  for (let i = 0; i < 10; i++) {
    const byte = (metrics["panose"] as unknown[])[i];
    if (typeof byte !== "number") {
      throw new Error(`[${variantName}] metrics.panose[${i}] must be a number`);
    }
  }
  if (typeof metrics["is_serif"] !== "boolean") {
    throw new Error(`[${variantName}] metrics.is_serif must be a boolean`);
  }

  // fs_type: number
  if (typeof obj["fs_type"] !== "number") {
    throw new Error(`[${variantName}] fs_type must be a number`);
  }

  // embeddable: EmbedDecision
  if (typeof obj["embeddable"] !== "string") {
    throw new Error(`[${variantName}] embeddable must be a string`);
  }
  if (!VALID_EMBED_DECISIONS.has(obj["embeddable"] as string)) {
    throw new Error(
      `[${variantName}] embeddable "${obj["embeddable"]}" is not a valid EmbedDecision`,
    );
  }

  // is_variable: boolean
  if (typeof obj["is_variable"] !== "boolean") {
    throw new Error(`[${variantName}] is_variable must be a boolean`);
  }

  // axes: array of FontAxis
  if (!Array.isArray(obj["axes"])) {
    throw new Error(`[${variantName}] axes must be an array`);
  }
  for (let i = 0; i < (obj["axes"] as unknown[]).length; i++) {
    const axis = (obj["axes"] as unknown[])[i];
    if (typeof axis !== "object" || axis === null) {
      throw new Error(`[${variantName}] axes[${i}] must be an object`);
    }
    const axisObj = axis as Record<string, unknown>;
    // tag: 4-element number array
    if (!Array.isArray(axisObj["tag"]) || (axisObj["tag"] as unknown[]).length !== 4) {
      throw new Error(`[${variantName}] axes[${i}].tag must be a 4-element array`);
    }
    for (let j = 0; j < 4; j++) {
      if (typeof (axisObj["tag"] as unknown[])[j] !== "number") {
        throw new Error(`[${variantName}] axes[${i}].tag[${j}] must be a number`);
      }
    }
    for (const field of ["min", "default", "max"] as const) {
      if (typeof axisObj[field] !== "number" || !Number.isFinite(axisObj[field] as number)) {
        throw new Error(`[${variantName}] axes[${i}].${field} must be a finite number`);
      }
    }
  }
}

describe("FontEntry parity with Rust fixture", () => {
  const fixture = loadFixture();

  it("fixture contains all four FontSource discriminants", () => {
    const sources = new Set<string>();
    for (const variant of fixture.variants) {
      if (
        typeof variant.value === "object" &&
        variant.value !== null &&
        "source" in variant.value
      ) {
        const src = (variant.value as { source: unknown })["source"];
        if (typeof src === "object" && src !== null && "source" in src) {
          const disc = (src as { source: unknown })["source"];
          if (typeof disc === "string") {
            sources.add(disc);
          }
        }
      }
    }
    expect(sources.has("bundled")).toBe(true);
    expect(sources.has("library")).toBe(true);
    expect(sources.has("custom")).toBe(true);
    expect(sources.has("system_reference")).toBe(true);
  });

  it("every variant conforms to the FontEntry shape", () => {
    for (const variant of fixture.variants) {
      expect(() => assertFontEntry(variant.value, variant.name)).not.toThrow();
    }
  });

  it("the custom variant has source.asset_uuid", () => {
    const customVariant = fixture.variants.find((v) => v.name === "custom");
    expect(customVariant).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by toBeDefined above
    const val = customVariant!.value as FontEntry;
    // FontSource discriminated union narrowing
    const src: FontSource = val.source;
    expect(src.source).toBe("custom");
    if (src.source === "custom") {
      expect(typeof src.asset_uuid).toBe("string");
      expect(src.asset_uuid.length).toBeGreaterThan(0);
    }
  });

  it("the variable font variant has is_variable=true and at least one axis", () => {
    const varVariable = fixture.variants.find((v) => v.name === "variable_font");
    expect(varVariable).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by toBeDefined above
    const val = varVariable!.value as FontEntry;
    expect(val.is_variable).toBe(true);
    expect(val.axes.length).toBeGreaterThanOrEqual(1);
    // First axis tag must be a 4-element number array
    const firstTag = val.axes[0].tag;
    expect(firstTag.length).toBe(4);
    expect(firstTag.every((b) => typeof b === "number")).toBe(true);
  });

  it("the library variant has source.catalog_id", () => {
    const libVariant = fixture.variants.find((v) => v.name === "library");
    expect(libVariant).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by toBeDefined above
    const val = libVariant!.value as FontEntry;
    const src: FontSource = val.source;
    expect(src.source).toBe("library");
    if (src.source === "library") {
      expect(typeof src.catalog_id).toBe("string");
      expect(src.catalog_id.length).toBeGreaterThan(0);
    }
  });

  it("every variant round-trips through JSON.parse/stringify", () => {
    for (const variant of fixture.variants) {
      const serialized = JSON.stringify(variant.value);
      const parsed: unknown = JSON.parse(serialized);
      expect(parsed).toEqual(variant.value);
    }
  });

  it("every variant has a valid EmbedDecision", () => {
    for (const variant of fixture.variants) {
      const val = variant.value as FontEntry;
      const decision: EmbedDecision = val.embeddable;
      expect(VALID_EMBED_DECISIONS.has(decision)).toBe(true);
    }
  });
});
