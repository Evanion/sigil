/**
 * Tests for the resize math module.
 *
 * Verifies that computeResize produces correct transforms for all 8 handle
 * types, with and without Shift (aspect lock) and Alt (resize from center)
 * modifiers, and that minimum size clamping works.
 */

import { describe, it, expect } from "vitest";
import { computeResize } from "../resize-math";
import { HandleType } from "../handle-hit-test";
import type { Transform } from "../../types/document";

const ORIGINAL: Transform = {
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  rotation: 0,
  scale_x: 1,
  scale_y: 1,
};

const NO_MODS = { shift: false, alt: false };

describe("computeResize — SE handle (simplest case)", () => {
  it("increases width and height with positive delta", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: 50, dy: 30 }, NO_MODS);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.width).toBe(250);
    expect(result.height).toBe(130);
  });

  it("decreases width and height with negative delta", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: -50, dy: -30 }, NO_MODS);
    expect(result.width).toBe(150);
    expect(result.height).toBe(70);
  });
});

describe("computeResize — NW handle", () => {
  it("moves origin and adjusts size", () => {
    const result = computeResize(ORIGINAL, HandleType.NW, { dx: 20, dy: 10 }, NO_MODS);
    expect(result.x).toBe(120);
    expect(result.y).toBe(110);
    expect(result.width).toBe(180);
    expect(result.height).toBe(90);
  });
});

describe("computeResize — edge handles (single axis)", () => {
  it("N handle adjusts y and height only", () => {
    const result = computeResize(ORIGINAL, HandleType.N, { dx: 999, dy: -30 }, NO_MODS);
    expect(result.x).toBe(100);
    expect(result.y).toBe(70);
    expect(result.width).toBe(200);
    expect(result.height).toBe(130);
  });

  it("E handle adjusts width only", () => {
    const result = computeResize(ORIGINAL, HandleType.E, { dx: 40, dy: 999 }, NO_MODS);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.width).toBe(240);
    expect(result.height).toBe(100);
  });

  it("S handle adjusts height only", () => {
    const result = computeResize(ORIGINAL, HandleType.S, { dx: 999, dy: 40 }, NO_MODS);
    expect(result.width).toBe(200);
    expect(result.height).toBe(140);
  });

  it("W handle adjusts x and width only", () => {
    const result = computeResize(ORIGINAL, HandleType.W, { dx: -20, dy: 999 }, NO_MODS);
    expect(result.x).toBe(80);
    expect(result.width).toBe(220);
    expect(result.height).toBe(100);
  });
});

describe("computeResize — NE and SW handles", () => {
  it("NE handle: width increases, y moves up, height increases", () => {
    const result = computeResize(ORIGINAL, HandleType.NE, { dx: 30, dy: -20 }, NO_MODS);
    expect(result.x).toBe(100);
    expect(result.y).toBe(80);
    expect(result.width).toBe(230);
    expect(result.height).toBe(120);
  });

  it("SW handle: x moves left, width increases, height increases", () => {
    const result = computeResize(ORIGINAL, HandleType.SW, { dx: -30, dy: 20 }, NO_MODS);
    expect(result.x).toBe(70);
    expect(result.y).toBe(100);
    expect(result.width).toBe(230);
    expect(result.height).toBe(120);
  });
});

describe("computeResize — minimum size clamping", () => {
  it("clamps width to 1 when drag would make it zero or negative", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: -300, dy: 0 }, NO_MODS);
    expect(result.width).toBe(1);
  });

  it("clamps height to 1 when drag would make it zero or negative", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: 0, dy: -300 }, NO_MODS);
    expect(result.height).toBe(1);
  });

  it("clamps NW handle: x does not exceed right edge minus 1", () => {
    const result = computeResize(ORIGINAL, HandleType.NW, { dx: 500, dy: 500 }, NO_MODS);
    // Right edge is at 300. Max x = 300 - 1 = 299.
    expect(result.x).toBe(299);
    expect(result.width).toBe(1);
    expect(result.y).toBe(199);
    expect(result.height).toBe(1);
  });
});

describe("computeResize — Shift modifier (aspect ratio lock)", () => {
  it("SE corner locks aspect ratio (2:1 original)", () => {
    // Original is 200x100 = 2:1 aspect ratio.
    // Drag SE by (60, 60). Unconstrained would be 260x160.
    // Constrained: pick the larger dimension change.
    // dx=60 => new width 260 => height 260/2 = 130
    // dy=60 => new height 160 => width 160*2 = 320
    // We use the axis with the larger absolute delta to drive.
    // Both are equal (60), so use width-dominant: 260x130.
    const result = computeResize(
      ORIGINAL,
      HandleType.SE,
      { dx: 60, dy: 60 },
      { shift: true, alt: false },
    );
    // With aspect lock, the dominant axis drives.
    // Implementation detail: when equal, width drives.
    expect(result.width / result.height).toBeCloseTo(2, 5);
    expect(result.width).toBeGreaterThan(200);
  });

  it("Shift has no effect on edge handles (single-axis only)", () => {
    const result = computeResize(
      ORIGINAL,
      HandleType.E,
      { dx: 50, dy: 0 },
      { shift: true, alt: false },
    );
    expect(result.width).toBe(250);
    expect(result.height).toBe(100);
  });
});

describe("computeResize — Alt modifier (resize from center)", () => {
  it("SE corner with Alt: both sides move equally, center stays fixed", () => {
    // Original center: (200, 150). Drag SE by (40, 20).
    // Both sides expand by delta: width += 2*40 = 80, height += 2*20 = 40
    // New: x = 100-40=60, y = 100-20=80, width=280, height=140
    const result = computeResize(
      ORIGINAL,
      HandleType.SE,
      { dx: 40, dy: 20 },
      { shift: false, alt: true },
    );
    expect(result.x).toBe(60);
    expect(result.y).toBe(80);
    expect(result.width).toBe(280);
    expect(result.height).toBe(140);
    // Verify center is preserved
    expect(result.x + result.width / 2).toBeCloseTo(200, 5);
    expect(result.y + result.height / 2).toBeCloseTo(150, 5);
  });
});

describe("computeResize — Shift+Alt combined", () => {
  it("SE corner with Shift+Alt: proportional from center", () => {
    const result = computeResize(
      ORIGINAL,
      HandleType.SE,
      { dx: 60, dy: 60 },
      { shift: true, alt: true },
    );
    expect(result.width / result.height).toBeCloseTo(2, 5);
    // Center preserved
    expect(result.x + result.width / 2).toBeCloseTo(200, 5);
    expect(result.y + result.height / 2).toBeCloseTo(150, 5);
  });
});

describe("computeResize — preserves rotation and scale", () => {
  it("rotation and scale_x/scale_y are passed through unchanged", () => {
    const rotated: Transform = { ...ORIGINAL, rotation: 45, scale_x: 2, scale_y: 0.5 };
    const result = computeResize(rotated, HandleType.SE, { dx: 10, dy: 10 }, NO_MODS);
    expect(result.rotation).toBe(45);
    expect(result.scale_x).toBe(2);
    expect(result.scale_y).toBe(0.5);
  });
});

// RF-006: Canonical enforcement test for MIN_SIZE constant (CLAUDE.md §11)
describe("computeResize — constant enforcement", () => {
  it("test_min_size_enforced", () => {
    // Width clamped to MIN_SIZE (1) when drag exceeds node width
    const widthResult = computeResize(ORIGINAL, HandleType.SE, { dx: -300, dy: 0 }, NO_MODS);
    expect(widthResult.width).toBe(1);

    // Height clamped to MIN_SIZE (1) when drag exceeds node height
    const heightResult = computeResize(ORIGINAL, HandleType.SE, { dx: 0, dy: -300 }, NO_MODS);
    expect(heightResult.height).toBe(1);
  });
});

// RF-004: Non-finite input guard
describe("computeResize — Number.isFinite guards", () => {
  it("returns original unchanged when dragDelta contains NaN", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: NaN, dy: 10 }, NO_MODS);
    expect(result).toEqual(ORIGINAL);
  });

  it("returns original unchanged when original transform contains Infinity", () => {
    const bad: Transform = { ...ORIGINAL, width: Infinity };
    const result = computeResize(bad, HandleType.SE, { dx: 10, dy: 10 }, NO_MODS);
    expect(result).toEqual(bad);
  });
});

// RF-005: Zero-height aspect ratio guard
describe("computeResize — zero-dimension aspect ratio", () => {
  it("skips aspect lock when original height is zero", () => {
    const zeroHeight: Transform = { ...ORIGINAL, height: 0 };
    // With Shift on a corner, it should not divide by zero
    const result = computeResize(
      zeroHeight,
      HandleType.SE,
      { dx: 10, dy: 10 },
      { shift: true, alt: false },
    );
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
  });
});

// RF-007: Alt+clamp recenters
describe("computeResize — Alt+clamp recentering", () => {
  it("recenters when Alt is active and width clamps to MIN_SIZE", () => {
    const result = computeResize(
      ORIGINAL,
      HandleType.SE,
      { dx: -500, dy: 0 },
      { shift: false, alt: true },
    );
    expect(result.width).toBe(1);
    // Center should be preserved: original center x = 100 + 200/2 = 200
    expect(result.x + result.width / 2).toBeCloseTo(200, 5);
  });
});
