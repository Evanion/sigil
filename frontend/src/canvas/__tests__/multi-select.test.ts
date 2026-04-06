/**
 * Tests for the multi-select math module.
 *
 * All functions are pure — no DOM, no Solid reactivity.
 */

import { describe, it, expect } from "vitest";
import type { Transform } from "../../types/document";
import {
  computeCompoundBounds,
  computeRelativePositions,
  applyProportionalResize,
  rectIntersectsAABB,
} from "../multi-select";

// ── Fixtures ──────────────────────────────────────────────────────────

function makeTransform(overrides: Partial<Transform> = {}): Transform {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    scale_x: 1,
    scale_y: 1,
    ...overrides,
  };
}

// ── computeCompoundBounds ─────────────────────────────────────────────

describe("computeCompoundBounds", () => {
  it("should return zero transform at origin for empty array", () => {
    const result = computeCompoundBounds([]);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.rotation).toBe(0);
    expect(result.scale_x).toBe(1);
    expect(result.scale_y).toBe(1);
  });

  it("should return the single transform's AABB for a one-node array", () => {
    const t = makeTransform({ x: 10, y: 20, width: 80, height: 60 });
    const result = computeCompoundBounds([t]);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
    expect(result.width).toBeCloseTo(80);
    expect(result.height).toBeCloseTo(60);
    expect(result.rotation).toBe(0);
    expect(result.scale_x).toBe(1);
    expect(result.scale_y).toBe(1);
  });

  it("should compute the union AABB for two non-overlapping nodes side by side", () => {
    const a = makeTransform({ x: 0, y: 0, width: 50, height: 50 });
    const b = makeTransform({ x: 100, y: 0, width: 50, height: 50 });
    const result = computeCompoundBounds([a, b]);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.width).toBeCloseTo(150); // 0 to 150
    expect(result.height).toBeCloseTo(50);
  });

  it("should compute the union AABB for two overlapping nodes", () => {
    const a = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const b = makeTransform({ x: 50, y: 50, width: 100, height: 100 });
    const result = computeCompoundBounds([a, b]);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.width).toBeCloseTo(150);
    expect(result.height).toBeCloseTo(150);
  });

  it("should expand bounds to encompass rotated nodes", () => {
    // A 100x10 rect rotated 90° becomes approximately 10x100 in AABB terms.
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 10, rotation: 90 });
    const result = computeCompoundBounds([t]);
    // The AABB of a 90°-rotated rect will be taller than wide.
    expect(result.height).toBeGreaterThan(result.width);
  });

  it("should always return rotation 0 and scales 1 for the compound bounds", () => {
    const a = makeTransform({ rotation: 45 });
    const b = makeTransform({ x: 200, rotation: -30, scale_x: 2, scale_y: 0.5 });
    const result = computeCompoundBounds([a, b]);
    expect(result.rotation).toBe(0);
    expect(result.scale_x).toBe(1);
    expect(result.scale_y).toBe(1);
  });
});

// ── computeRelativePositions ──────────────────────────────────────────

describe("computeRelativePositions", () => {
  it("should return 0-1 fractional positions for nodes within bounds", () => {
    const bounds = makeTransform({ x: 0, y: 0, width: 200, height: 100 });
    const transforms = [
      makeTransform({ x: 0, y: 0, width: 100, height: 50 }), // left half, top half
      makeTransform({ x: 100, y: 50, width: 100, height: 50 }), // right half, bottom half
    ];
    const positions = computeRelativePositions(transforms, bounds);

    expect(positions[0].rx).toBeCloseTo(0);
    expect(positions[0].ry).toBeCloseTo(0);
    expect(positions[0].rw).toBeCloseTo(0.5);
    expect(positions[0].rh).toBeCloseTo(0.5);

    expect(positions[1].rx).toBeCloseTo(0.5);
    expect(positions[1].ry).toBeCloseTo(0.5);
    expect(positions[1].rw).toBeCloseTo(0.5);
    expect(positions[1].rh).toBeCloseTo(0.5);
  });

  it("should return all-zero positions for zero-dimension bounds", () => {
    const bounds = makeTransform({ x: 0, y: 0, width: 0, height: 0 });
    const transforms = [makeTransform({ x: 10, y: 10, width: 50, height: 50 })];
    const positions = computeRelativePositions(transforms, bounds);
    expect(positions[0].rx).toBe(0);
    expect(positions[0].ry).toBe(0);
    expect(positions[0].rw).toBe(0);
    expect(positions[0].rh).toBe(0);
  });

  it("should return empty array for empty transforms array", () => {
    const bounds = makeTransform({ x: 0, y: 0, width: 200, height: 100 });
    expect(computeRelativePositions([], bounds)).toEqual([]);
  });

  it("should handle nodes offset from the bounds origin", () => {
    // bounds starts at (100, 200)
    const bounds = makeTransform({ x: 100, y: 200, width: 100, height: 100 });
    const t = makeTransform({ x: 125, y: 225, width: 50, height: 50 });
    const positions = computeRelativePositions([t], bounds);
    expect(positions[0].rx).toBeCloseTo(0.25);
    expect(positions[0].ry).toBeCloseTo(0.25);
    expect(positions[0].rw).toBeCloseTo(0.5);
    expect(positions[0].rh).toBeCloseTo(0.5);
  });
});

// ── applyProportionalResize ───────────────────────────────────────────

describe("applyProportionalResize", () => {
  it("should restore original transforms when new bounds equals original bounds (round-trip)", () => {
    const originals = [
      makeTransform({ x: 0, y: 0, width: 50, height: 50 }),
      makeTransform({ x: 100, y: 0, width: 50, height: 50 }),
    ];
    const bounds = computeCompoundBounds(originals);
    const positions = computeRelativePositions(originals, bounds);
    const result = applyProportionalResize(originals, positions, bounds);

    expect(result[0].x).toBeCloseTo(originals[0].x);
    expect(result[0].y).toBeCloseTo(originals[0].y);
    expect(result[0].width).toBeCloseTo(originals[0].width);
    expect(result[0].height).toBeCloseTo(originals[0].height);

    expect(result[1].x).toBeCloseTo(originals[1].x);
    expect(result[1].y).toBeCloseTo(originals[1].y);
    expect(result[1].width).toBeCloseTo(originals[1].width);
    expect(result[1].height).toBeCloseTo(originals[1].height);
  });

  it("should scale transforms proportionally when bounds doubles in width", () => {
    const originals = [
      makeTransform({ x: 0, y: 0, width: 50, height: 50 }),
      makeTransform({ x: 50, y: 0, width: 50, height: 50 }),
    ];
    const bounds = computeCompoundBounds(originals); // x:0,y:0,w:100,h:50
    const positions = computeRelativePositions(originals, bounds);
    const newBounds = makeTransform({ x: 0, y: 0, width: 200, height: 50 });
    const result = applyProportionalResize(originals, positions, newBounds);

    // First node occupies left half → x:0, width:100
    expect(result[0].x).toBeCloseTo(0);
    expect(result[0].width).toBeCloseTo(100);
    // Second node occupies right half → x:100, width:100
    expect(result[1].x).toBeCloseTo(100);
    expect(result[1].width).toBeCloseTo(100);
  });

  it("should preserve each original's rotation, scale_x, and scale_y", () => {
    const originals = [
      makeTransform({ x: 0, y: 0, width: 50, height: 50, rotation: 45, scale_x: 2, scale_y: 0.5 }),
    ];
    const bounds = computeCompoundBounds(originals);
    const positions = computeRelativePositions(originals, bounds);
    const newBounds = makeTransform({ x: 10, y: 10, width: 200, height: 200 });
    const result = applyProportionalResize(originals, positions, newBounds);

    expect(result[0].rotation).toBe(45);
    expect(result[0].scale_x).toBe(2);
    expect(result[0].scale_y).toBe(0.5);
  });

  it("should return empty array for empty inputs", () => {
    const newBounds = makeTransform({ x: 0, y: 0, width: 200, height: 200 });
    expect(applyProportionalResize([], [], newBounds)).toEqual([]);
  });
});

// ── rectIntersectsAABB ────────────────────────────────────────────────

describe("rectIntersectsAABB", () => {
  it("should return true when marquee rect overlaps the AABB", () => {
    const aabb: [number, number, number, number] = [100, 100, 200, 200];
    const rect = { x: 150, y: 150, width: 100, height: 100 };
    expect(rectIntersectsAABB(rect, aabb)).toBe(true);
  });

  it("should return false when marquee rect does not overlap the AABB", () => {
    const aabb: [number, number, number, number] = [100, 100, 200, 200];
    const rect = { x: 300, y: 300, width: 100, height: 100 };
    expect(rectIntersectsAABB(rect, aabb)).toBe(false);
  });

  it("should return true when marquee rect fully contains the AABB", () => {
    const aabb: [number, number, number, number] = [110, 110, 190, 190];
    const rect = { x: 100, y: 100, width: 200, height: 200 };
    expect(rectIntersectsAABB(rect, aabb)).toBe(true);
  });

  it("should return true when the AABB fully contains the marquee rect", () => {
    const aabb: [number, number, number, number] = [0, 0, 500, 500];
    const rect = { x: 100, y: 100, width: 100, height: 100 };
    expect(rectIntersectsAABB(rect, aabb)).toBe(true);
  });

  it("should return false when marquee rect is entirely to the left of the AABB", () => {
    const aabb: [number, number, number, number] = [200, 100, 300, 200];
    const rect = { x: 0, y: 100, width: 100, height: 100 };
    expect(rectIntersectsAABB(rect, aabb)).toBe(false);
  });

  it("should return false when marquee rect is entirely above the AABB", () => {
    const aabb: [number, number, number, number] = [100, 200, 200, 300];
    const rect = { x: 100, y: 0, width: 100, height: 100 };
    expect(rectIntersectsAABB(rect, aabb)).toBe(false);
  });

  it("should normalize a negative-width rect before testing (drag right-to-left)", () => {
    // rect from x:200 dragged left to x:50 → width is negative but spans [50, 200]
    const aabb: [number, number, number, number] = [100, 100, 150, 150];
    const rect = { x: 200, y: 50, width: -150, height: 200 };
    expect(rectIntersectsAABB(rect, aabb)).toBe(true);
  });

  it("should normalize a negative-height rect before testing (drag bottom-to-top)", () => {
    const aabb: [number, number, number, number] = [100, 100, 200, 200];
    const rect = { x: 50, y: 250, width: 200, height: -200 };
    expect(rectIntersectsAABB(rect, aabb)).toBe(true);
  });

  it("should return false for an adjacent-but-not-touching rect (no shared area)", () => {
    // AABB right edge = 200, rect left edge = 200 → touching but no overlap
    const aabb: [number, number, number, number] = [0, 0, 200, 200];
    const rect = { x: 200, y: 0, width: 100, height: 200 };
    // Strictly no overlap — edges are touching
    expect(rectIntersectsAABB(rect, aabb)).toBe(false);
  });
});
