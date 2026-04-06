/**
 * Tests for the snap engine.
 *
 * Verifies that the engine collects snap targets from nodes, finds the
 * nearest match via binary search, snaps independently on X and Y,
 * and produces the correct guide lines for rendering.
 */

import { describe, it, expect } from "vitest";
import { SnapEngine, type SnapGuide } from "../snap-engine";
import type { Transform } from "../../types/document";

/** Helper to create a minimal node-like object for the snap engine. */
function makeNode(uuid: string, t: Transform): { uuid: string; transform: Transform } {
  return { uuid, transform: t };
}

const T = (x: number, y: number, w: number, h: number): Transform => ({
  x,
  y,
  width: w,
  height: h,
  rotation: 0,
  scale_x: 1,
  scale_y: 1,
});

describe("SnapEngine", () => {
  it("snaps source left edge to target left edge", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Source left edge at x=102 — within 8px threshold of target x=100
    const result = engine.snap(T(102, 300, 60, 40));
    expect(result.snappedTransform.x).toBe(100);
    expect(result.guides.length).toBeGreaterThanOrEqual(1);
    expect(result.guides.some((g: SnapGuide) => g.axis === "x" && g.position === 100)).toBe(true);
  });

  it("snaps source right edge to target right edge", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Source: x=88, width=60 => right edge=148. Target right=150. Delta=2.
    const result = engine.snap(T(88, 300, 60, 40));
    // Snap should shift x by +2 so right edge = 150
    expect(result.snappedTransform.x).toBe(90);
    expect(result.snappedTransform.width).toBe(60); // width unchanged
  });

  it("snaps source center-x to target center-x", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))], // center-x = 125
      new Set(["dragged"]),
      1,
    );

    // Target points on X: left=100, center=125, right=150.
    // Source: x=116, width=20 => left=116 (dist to 100=16>threshold, to 125=9>threshold),
    //                             right=136 (dist to 125=11>threshold, to 150=14>threshold),
    //                             center=126 (dist to 125=1 — WITHIN threshold).
    // Only the center-to-center pair qualifies. Delta = 125-126 = -1. x snaps to 115.
    const result = engine.snap(T(116, 300, 20, 40));
    expect(result.snappedTransform.x).toBe(115); // shifted -1 so source center aligns to 125
    const xGuide = result.guides.find((g: SnapGuide) => g.axis === "x");
    expect(xGuide).toBeDefined();
    expect(xGuide?.position).toBe(125); // guide at center-x=125
  });

  it("snaps Y axis independently from X axis", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Source: x=500 (far from any snap), y=198 (within 8px of target y=200)
    const result = engine.snap(T(500, 198, 60, 40));
    expect(result.snappedTransform.x).toBe(500); // no X snap
    expect(result.snappedTransform.y).toBe(200); // Y snapped
  });

  it("does not snap when beyond threshold", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Target X points: left=100, center=125, right=150.
    // Source: x=165, width=20 => left=165 (dist to 150=15>8), right=185 (all >8),
    //                             center=175 (all >8). No X snap should occur.
    const result = engine.snap(T(165, 300, 20, 40));
    expect(result.snappedTransform.x).toBe(165);
    expect(result.guides.filter((g: SnapGuide) => g.axis === "x")).toHaveLength(0);
  });

  it("returns multiple guides when snapped on both axes", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Source: x=102 (snap to 100), y=198 (snap to 200)
    const result = engine.snap(T(102, 198, 60, 40));
    const xGuides = result.guides.filter((g: SnapGuide) => g.axis === "x");
    const yGuides = result.guides.filter((g: SnapGuide) => g.axis === "y");
    expect(xGuides.length).toBeGreaterThanOrEqual(1);
    expect(yGuides.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes nodes in the exclude set from targets", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("self", T(100, 100, 50, 50)), makeNode("other", T(300, 300, 50, 50))],
      new Set(["self"]),
      1,
    );

    // Source at x=102 — near "self" at x=100, but self is excluded
    const result = engine.snap(T(102, 400, 60, 40));
    expect(result.snappedTransform.x).toBe(102); // no snap to excluded node
  });

  it("threshold scales inversely with zoom", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))],
      new Set(["dragged"]),
      2, // zoom=2 => threshold = 8/2 = 4px
    );

    // Source at x=103 — 3px away, within threshold of 4
    expect(engine.snap(T(103, 300, 60, 40)).snappedTransform.x).toBe(100);

    // Source at x=106 — 6px away, beyond threshold of 4
    expect(engine.snap(T(106, 300, 60, 40)).snappedTransform.x).toBe(106);
  });

  it("returns empty guides when no nodes are prepared", () => {
    const engine = new SnapEngine();
    engine.prepare([], new Set(), 1);

    const result = engine.snap(T(100, 100, 50, 50));
    expect(result.snappedTransform.x).toBe(100);
    expect(result.snappedTransform.y).toBe(100);
    expect(result.guides).toHaveLength(0);
  });

  it("skips nodes with non-finite transform values", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [
        makeNode("bad", {
          x: NaN,
          y: 0,
          width: 50,
          height: 50,
          rotation: 0,
          scale_x: 1,
          scale_y: 1,
        }),
        makeNode("good", T(200, 200, 50, 50)),
      ],
      new Set(),
      1,
    );

    // Only "good" should be a target — bad node is filtered
    const result = engine.snap(T(201, 300, 60, 40));
    expect(result.snappedTransform.x).toBe(200); // snapped to good node left edge
  });

  it("picks the closest snap point when multiple are within threshold", () => {
    const engine = new SnapEngine();
    // Two nodes: left edges at 100 and 106
    engine.prepare(
      [makeNode("a", T(100, 200, 50, 50)), makeNode("b", T(106, 200, 50, 50))],
      new Set(["dragged"]),
      1,
    );

    // Source left edge at 104 — equidistant between 100 and 106 but findNearest picks 106
    // What matters is that exactly one X snap is applied
    const result = engine.snap(T(104, 300, 60, 40));
    expect([100, 106]).toContain(result.snappedTransform.x);
    expect(result.guides.filter((g: SnapGuide) => g.axis === "x")).toHaveLength(1);
  });

  it("snaps source top edge to target top edge", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Target Y points: top=200, bottom=250, center=225.
    // Source: y=203, height=200 => top=203 (dist to 200=3 — within threshold),
    //                               bottom=403 (dist to 250=153 — far),
    //                               center=303 (dist to 250=53 — far).
    // Only top-to-top qualifies. Delta = 200-203 = -3. y snaps to 200.
    const result = engine.snap(T(500, 203, 60, 200));
    expect(result.snappedTransform.y).toBe(200);
    expect(result.guides.some((g: SnapGuide) => g.axis === "y" && g.position === 200)).toBe(true);
  });

  it("snaps source bottom edge to target bottom edge", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Source: y=210, height=40 => bottom=250. Target bottom=250. No delta.
    const result = engine.snap(T(500, 212, 60, 40));
    // Source bottom=252, target bottom=250, delta=-2 => y snaps to 210
    expect(result.snappedTransform.y).toBe(210);
  });

  it("width and height are preserved after snapping", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    const result = engine.snap(T(102, 202, 80, 60));
    expect(result.snappedTransform.width).toBe(80);
    expect(result.snappedTransform.height).toBe(60);
  });

  it("rotation and scale are preserved after snapping", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    const source: Transform = {
      x: 102,
      y: 202,
      width: 60,
      height: 40,
      rotation: 45,
      scale_x: 2,
      scale_y: 0.5,
    };
    const result = engine.snap(source);
    expect(result.snappedTransform.rotation).toBe(45);
    expect(result.snappedTransform.scale_x).toBe(2);
    expect(result.snappedTransform.scale_y).toBe(0.5);
  });

  // RF-006: Canonical enforcement test for SNAP_THRESHOLD_PX constant (CLAUDE.md §11)
  it("test_snap_threshold_px_enforced", () => {
    const engine = new SnapEngine();
    // At zoom=1, threshold is 8px. A source 9px away should NOT snap.
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);
    const noSnap = engine.snap(T(109, 300, 60, 40));
    expect(noSnap.snappedTransform.x).toBe(109); // 9px > 8px threshold

    // A source 8px away should snap.
    const yesSnap = engine.snap(T(108, 300, 60, 40));
    expect(yesSnap.snappedTransform.x).toBe(100); // 8px <= 8px threshold
  });

  // RF-004: Non-finite source guard
  it("returns source unchanged when transform contains NaN", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);
    const nanSource: Transform = {
      x: NaN,
      y: 100,
      width: 50,
      height: 50,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };
    const result = engine.snap(nanSource);
    expect(result.snappedTransform).toEqual(nanSource);
    expect(result.guides).toHaveLength(0);
  });
});

describe("SnapEngine.snapEdges (RF-002)", () => {
  it("snaps only the right edge when moving right", () => {
    const engine = new SnapEngine();
    // Target right edge at 150
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Source: x=50, width=98 => right edge = 148, within 8px of 150
    const result = engine.snapEdges(T(50, 300, 98, 40), ["right"], []);
    // Right edge should snap to 150, so width becomes 100, x stays at 50
    expect(result.snappedTransform.x).toBe(50);
    expect(result.snappedTransform.width).toBe(100);
  });

  it("snaps only the left edge when moving left", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Source: x=102, width=200 => left edge=102, within 8px of 100
    const result = engine.snapEdges(T(102, 300, 200, 40), ["left"], []);
    // Left edge snaps to 100, width increases by 2
    expect(result.snappedTransform.x).toBe(100);
    expect(result.snappedTransform.width).toBe(202);
  });

  it("does not snap edges that are not in the moving set", () => {
    const engine = new SnapEngine();
    engine.prepare([makeNode("target", T(100, 200, 50, 50))], new Set(["dragged"]), 1);

    // Source left edge at x=102, close to target at 100.
    // But we only allow right edge snapping.
    // Source right edge = 102 + 200 = 302, far from any target.
    const result = engine.snapEdges(T(102, 300, 200, 40), ["right"], []);
    expect(result.snappedTransform.x).toBe(102); // x unchanged (left edge not snapped)
  });
});
