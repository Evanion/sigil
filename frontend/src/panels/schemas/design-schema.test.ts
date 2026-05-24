/**
 * Tests for the Design panel schema.
 *
 * Verifies that bound-sensitive numeric fields use the named constants from
 * the store layer rather than hard-coded literals — per CLAUDE.md §11
 * "Constants Must Be Enforced": every NumberInput min/max must be a named
 * constant matching the corresponding Rust validation value.
 */

import { describe, it, expect } from "vitest";
import { designSchema } from "./design-schema";
import { MAX_CORNER_RADIUS } from "../../store/corners-input";

describe("designSchema — Corner Radius section", () => {
  const cornerSection = designSchema.sections.find((s) => s.name === "Corner Radius");

  it("includes a Corner Radius section", () => {
    expect(cornerSection).toBeDefined();
  });

  it("renders for rectangle, frame, and image kinds only", () => {
    expect(cornerSection?.when).toEqual(["rectangle", "frame", "image"]);
  });

  it("has exactly four corner-radius fields (TL, TR, BR, BL)", () => {
    const fields = cornerSection?.fields ?? [];
    expect(fields).toHaveLength(4);
    expect(fields[0]?.key).toBe("kind.corners.0.radii.x");
    expect(fields[1]?.key).toBe("kind.corners.1.radii.x");
    expect(fields[2]?.key).toBe("kind.corners.2.radii.x");
    expect(fields[3]?.key).toBe("kind.corners.3.radii.x");
  });

  it("sets max=MAX_CORNER_RADIUS on every corner-radius field", () => {
    const fields = cornerSection?.fields ?? [];
    expect(fields).toHaveLength(4);
    for (const field of fields) {
      expect(field.type).toBe("number");
      expect(field.max).toBe(MAX_CORNER_RADIUS);
    }
  });

  it("sets min=0 on every corner-radius field", () => {
    const fields = cornerSection?.fields ?? [];
    for (const field of fields) {
      expect(field.min).toBe(0);
    }
  });
});
