/**
 * Tests for the `defaultCorners()` factory.
 *
 * The factory returns four independent Corner objects — no aliasing. This is
 * a load-bearing invariant: earlier revisions returned `[c, c, c, c]` with a
 * single shared reference, which silently coupled positional mutations
 * across all four indices.
 */

import { describe, it, expect } from "vitest";
import { defaultCorners } from "../default-corners";

describe("defaultCorners", () => {
  it("returns four independent Corner object references", () => {
    const result = defaultCorners();
    expect(result).toHaveLength(4);
    expect(result[0]).not.toBe(result[1]);
    expect(result[0]).not.toBe(result[2]);
    expect(result[0]).not.toBe(result[3]);
    expect(result[1]).not.toBe(result[2]);
    expect(result[1]).not.toBe(result[3]);
    expect(result[2]).not.toBe(result[3]);
  });

  it("returns four independent radii object references", () => {
    const result = defaultCorners();
    // Each corner must have its own radii object too — otherwise mutating
    // result[0].radii.x would still alias.
    expect(result[0].radii).not.toBe(result[1].radii);
    expect(result[0].radii).not.toBe(result[2].radii);
    expect(result[0].radii).not.toBe(result[3].radii);
    expect(result[1].radii).not.toBe(result[2].radii);
    expect(result[1].radii).not.toBe(result[3].radii);
    expect(result[2].radii).not.toBe(result[3].radii);
  });

  it("mutating one corner's radii does not affect the others", () => {
    // Cast through `unknown` to bypass `readonly` for this aliasing-detection
    // assertion. Real callers should treat the result as immutable; this
    // probe exists solely to verify object identity is not shared.
    const result = defaultCorners() as unknown as Array<{
      radii: { x: number; y: number };
    }>;
    result[0].radii.x = 99;
    expect(result[1].radii.x).toBe(0);
    expect(result[2].radii.x).toBe(0);
    expect(result[3].radii.x).toBe(0);
  });

  it("returns the canonical default — 4 round corners at radius 0/0", () => {
    const result = defaultCorners();
    for (const corner of result) {
      expect(corner.type).toBe("round");
      expect(corner.radii.x).toBe(0);
      expect(corner.radii.y).toBe(0);
    }
  });

  it("returns a fresh tuple on each call", () => {
    const a = defaultCorners();
    const b = defaultCorners();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});
