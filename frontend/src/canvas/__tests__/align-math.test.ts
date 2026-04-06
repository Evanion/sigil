import { describe, it, expect } from "vitest";
import {
  alignLeft,
  alignCenter,
  alignRight,
  alignTop,
  alignMiddle,
  alignBottom,
  distributeHorizontal,
  distributeVertical,
  type AlignEntry,
} from "../align-math";

function makeEntry(uuid: string, x: number, y: number, w: number, h: number): AlignEntry {
  return {
    uuid,
    transform: { x, y, width: w, height: h, rotation: 0, scale_x: 1, scale_y: 1 },
  };
}

// ── alignLeft ────────────────────────────────────────────────────────────

describe("alignLeft", () => {
  it("should set each node's x to the minimum x across all nodes", () => {
    const nodes = [
      makeEntry("a", 10, 0, 50, 50),
      makeEntry("b", 30, 0, 50, 50),
      makeEntry("c", 50, 0, 50, 50),
    ];
    const result = alignLeft(nodes);
    expect(result).toHaveLength(3);
    expect(result[0]?.transform.x).toBe(10);
    expect(result[1]?.transform.x).toBe(10);
    expect(result[2]?.transform.x).toBe(10);
  });

  it("should return input unchanged for fewer than 2 nodes", () => {
    const single = [makeEntry("a", 10, 0, 50, 50)];
    expect(alignLeft(single)).toEqual(single);
    expect(alignLeft([])).toEqual([]);
  });

  it("should preserve y, width, height, rotation, scale", () => {
    const nodes = [makeEntry("a", 10, 20, 50, 60), makeEntry("b", 30, 40, 70, 80)];
    const result = alignLeft(nodes);
    expect(result[0]?.transform.y).toBe(20);
    expect(result[0]?.transform.width).toBe(50);
    expect(result[1]?.transform.y).toBe(40);
    expect(result[1]?.transform.height).toBe(80);
  });
});

// ── alignCenter ──────────────────────────────────────────────────────────

describe("alignCenter", () => {
  it("should center each node horizontally within compound bounds", () => {
    // Compound bounds: min x=10, max right=100 (node c: 50+50=100), center=55
    const nodes = [
      makeEntry("a", 10, 0, 50, 50), // center at 35
      makeEntry("b", 30, 0, 50, 50), // center at 55
      makeEntry("c", 50, 0, 50, 50), // center at 75
    ];
    const result = alignCenter(nodes);
    // Compound center x = (10 + 100) / 2 = 55
    // Each node should have its center at 55 => x = 55 - width/2
    expect(result[0]?.transform.x).toBe(30); // 55 - 25
    expect(result[1]?.transform.x).toBe(30); // 55 - 25
    expect(result[2]?.transform.x).toBe(30); // 55 - 25
  });

  it("should return input unchanged for fewer than 2 nodes", () => {
    const single = [makeEntry("a", 10, 0, 50, 50)];
    expect(alignCenter(single)).toEqual(single);
  });
});

// ── alignRight ───────────────────────────────────────────────────────────

describe("alignRight", () => {
  it("should set each node's right edge to the maximum right edge", () => {
    const nodes = [
      makeEntry("a", 10, 0, 50, 50), // right = 60
      makeEntry("b", 30, 0, 50, 50), // right = 80
      makeEntry("c", 50, 0, 50, 50), // right = 100
    ];
    const result = alignRight(nodes);
    // max right = 100, so each x = 100 - width
    expect(result[0]?.transform.x).toBe(50); // 100 - 50
    expect(result[1]?.transform.x).toBe(50);
    expect(result[2]?.transform.x).toBe(50);
  });

  it("should return input unchanged for fewer than 2 nodes", () => {
    expect(alignRight([])).toEqual([]);
  });
});

// ── alignTop ─────────────────────────────────────────────────────────────

describe("alignTop", () => {
  it("should set each node's y to the minimum y across all nodes", () => {
    const nodes = [
      makeEntry("a", 0, 10, 50, 50),
      makeEntry("b", 0, 30, 50, 50),
      makeEntry("c", 0, 50, 50, 50),
    ];
    const result = alignTop(nodes);
    expect(result[0]?.transform.y).toBe(10);
    expect(result[1]?.transform.y).toBe(10);
    expect(result[2]?.transform.y).toBe(10);
  });

  it("should return input unchanged for fewer than 2 nodes", () => {
    const single = [makeEntry("a", 0, 10, 50, 50)];
    expect(alignTop(single)).toEqual(single);
  });
});

// ── alignMiddle ──────────────────────────────────────────────────────────

describe("alignMiddle", () => {
  it("should center each node vertically within compound bounds", () => {
    const nodes = [
      makeEntry("a", 0, 10, 50, 50), // bottom = 60
      makeEntry("b", 0, 30, 50, 40), // bottom = 70
      makeEntry("c", 0, 50, 50, 60), // bottom = 110
    ];
    const result = alignMiddle(nodes);
    // Compound center y = (10 + 110) / 2 = 60
    // a: y = 60 - 25 = 35
    // b: y = 60 - 20 = 40
    // c: y = 60 - 30 = 30
    expect(result[0]?.transform.y).toBe(35);
    expect(result[1]?.transform.y).toBe(40);
    expect(result[2]?.transform.y).toBe(30);
  });

  it("should return input unchanged for fewer than 2 nodes", () => {
    expect(alignMiddle([])).toEqual([]);
  });
});

// ── alignBottom ──────────────────────────────────────────────────────────

describe("alignBottom", () => {
  it("should set each node's bottom edge to the maximum bottom edge", () => {
    const nodes = [
      makeEntry("a", 0, 10, 50, 50), // bottom = 60
      makeEntry("b", 0, 30, 50, 40), // bottom = 70
      makeEntry("c", 0, 50, 50, 60), // bottom = 110
    ];
    const result = alignBottom(nodes);
    // max bottom = 110
    expect(result[0]?.transform.y).toBe(60); // 110 - 50
    expect(result[1]?.transform.y).toBe(70); // 110 - 40
    expect(result[2]?.transform.y).toBe(50); // 110 - 60
  });

  it("should return input unchanged for fewer than 2 nodes", () => {
    const single = [makeEntry("a", 0, 10, 50, 50)];
    expect(alignBottom(single)).toEqual(single);
  });
});

// ── distributeHorizontal ─────────────────────────────────────────────────

describe("distributeHorizontal", () => {
  it("should distribute nodes with equal gaps between them", () => {
    // Three nodes, sorted by x: a(10), b(40), c(200)
    // Total width span from left of leftmost to right of rightmost:
    // leftmost x = 10, rightmost right = 200 + 30 = 230
    // Total node widths: 20 + 50 + 30 = 100
    // Available gap space: (230 - 10) - 100 = 120
    // gap = 120 / 2 = 60
    // Sorted by x: a(10,w=20), b(40,w=50), c(200,w=30)
    // a stays at 10
    // b = 10 + 20 + 60 = 90
    // c = 90 + 50 + 60 = 200 (happens to be same)
    const nodes = [
      makeEntry("a", 10, 0, 20, 50),
      makeEntry("b", 40, 0, 50, 50),
      makeEntry("c", 200, 0, 30, 50),
    ];
    const result = distributeHorizontal(nodes);
    expect(result).toHaveLength(3);

    // Sort result by uuid to find each node
    const a = result.find((n) => n.uuid === "a");
    const b = result.find((n) => n.uuid === "b");
    const c = result.find((n) => n.uuid === "c");

    // a (leftmost, stays): x=10
    expect(a?.transform.x).toBe(10);
    // b: 10 + 20 + 60 = 90
    expect(b?.transform.x).toBe(90);
    // c: 90 + 50 + 60 = 200
    expect(c?.transform.x).toBe(200);
  });

  it("should return input unchanged for fewer than 3 nodes", () => {
    const two = [makeEntry("a", 10, 0, 50, 50), makeEntry("b", 80, 0, 50, 50)];
    expect(distributeHorizontal(two)).toEqual(two);
    expect(distributeHorizontal([])).toEqual([]);
  });

  it("should preserve y coordinates", () => {
    const nodes = [
      makeEntry("a", 10, 100, 20, 50),
      makeEntry("b", 40, 200, 20, 50),
      makeEntry("c", 70, 300, 20, 50),
    ];
    const result = distributeHorizontal(nodes);
    const a = result.find((n) => n.uuid === "a");
    const b = result.find((n) => n.uuid === "b");
    const c = result.find((n) => n.uuid === "c");
    expect(a?.transform.y).toBe(100);
    expect(b?.transform.y).toBe(200);
    expect(c?.transform.y).toBe(300);
  });
});

// ── distributeVertical ───────────────────────────────────────────────────

describe("distributeVertical", () => {
  it("should distribute nodes with equal gaps between them", () => {
    const nodes = [
      makeEntry("a", 0, 10, 50, 20),
      makeEntry("b", 0, 40, 50, 50),
      makeEntry("c", 0, 200, 50, 30),
    ];
    const result = distributeVertical(nodes);
    // Sorted by y: a(10,h=20), b(40,h=50), c(200,h=30)
    // span = 230 - 10 = 220, total heights = 100, gap = 120/2 = 60
    const a = result.find((n) => n.uuid === "a");
    const b = result.find((n) => n.uuid === "b");
    const c = result.find((n) => n.uuid === "c");

    expect(a?.transform.y).toBe(10);
    expect(b?.transform.y).toBe(90); // 10 + 20 + 60
    expect(c?.transform.y).toBe(200); // 90 + 50 + 60
  });

  it("should return input unchanged for fewer than 3 nodes", () => {
    const two = [makeEntry("a", 0, 10, 50, 50), makeEntry("b", 0, 80, 50, 50)];
    expect(distributeVertical(two)).toEqual(two);
  });

  it("should preserve x coordinates", () => {
    const nodes = [
      makeEntry("a", 100, 10, 50, 20),
      makeEntry("b", 200, 40, 50, 20),
      makeEntry("c", 300, 70, 50, 20),
    ];
    const result = distributeVertical(nodes);
    const a = result.find((n) => n.uuid === "a");
    const b = result.find((n) => n.uuid === "b");
    const c = result.find((n) => n.uuid === "c");
    expect(a?.transform.x).toBe(100);
    expect(b?.transform.x).toBe(200);
    expect(c?.transform.x).toBe(300);
  });
});

// ── NaN / non-finite guards ──────────────────────────────────────────────

describe("non-finite input guards", () => {
  it("should return input unchanged when any transform field is NaN", () => {
    const nodes = [makeEntry("a", NaN, 0, 50, 50), makeEntry("b", 30, 0, 50, 50)];
    expect(alignLeft(nodes)).toEqual(nodes);
  });

  it("should return input unchanged when any transform field is Infinity", () => {
    const nodes = [makeEntry("a", 10, 0, 50, 50), makeEntry("b", 30, Infinity, 50, 50)];
    expect(alignTop(nodes)).toEqual(nodes);
  });

  it("should return input unchanged when width is NaN for distribute", () => {
    const nodes = [
      makeEntry("a", 10, 0, NaN, 50),
      makeEntry("b", 30, 0, 50, 50),
      makeEntry("c", 50, 0, 50, 50),
    ];
    expect(distributeHorizontal(nodes)).toEqual(nodes);
  });

  it("should return input unchanged when height is Infinity for distribute", () => {
    const nodes = [
      makeEntry("a", 0, 10, 50, Infinity),
      makeEntry("b", 0, 30, 50, 50),
      makeEntry("c", 0, 50, 50, 50),
    ];
    expect(distributeVertical(nodes)).toEqual(nodes);
  });
});
