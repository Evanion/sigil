import { describe, it, expect } from "vitest";
import {
  isHotspotDisabled,
  isLinked,
  isSuperellipseUniform,
  hotspotTargetIndices,
  cornersAtHotspot,
  hotspotShapeIsMixed,
  ALL_HOTSPOT_IDS,
  type HotspotId,
} from "../corner-section-state";
import type { Corner, Corners } from "../../../types/document";

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}
function bevel(r: number): Corner {
  return { type: "bevel", radii: { x: r, y: r } };
}
function superellipse(r: number, s: number): Corner {
  return { type: "superellipse", radii: { x: r, y: r }, smoothing: s };
}

describe("isLinked", () => {
  it("returns true when all four corners are deep-equal", () => {
    const c: Corners = [round(8), round(8), round(8), round(8)];
    expect(isLinked(c)).toBe(true);
  });
  it("returns false when shape differs", () => {
    const c: Corners = [round(8), bevel(8), round(8), round(8)];
    expect(isLinked(c)).toBe(false);
  });
  it("returns false when radii differ", () => {
    const c: Corners = [round(8), round(8), round(12), round(8)];
    expect(isLinked(c)).toBe(false);
  });
});

describe("isSuperellipseUniform", () => {
  it("true when all four corners are superellipse with matching smoothing", () => {
    const c: Corners = [
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
    ];
    expect(isSuperellipseUniform(c)).toBe(true);
  });
  it("false when any corner is non-superellipse", () => {
    const c: Corners = [superellipse(8, 0.5), superellipse(8, 0.5), superellipse(8, 0.5), round(8)];
    expect(isSuperellipseUniform(c)).toBe(false);
  });

  // RF-009: smoothing equality must tolerate floating-point drift from the
  // Kobalte Slider's normalization. Strict equality would flag a uniform
  // tuple as non-uniform when one corner's smoothing carries 1-ULP drift
  // produced by the slider's step rounding.
  it("RF-009: treats sub-epsilon smoothing drift as uniform", () => {
    const c: Corners = [
      superellipse(8, 0.5),
      // 1e-12 is far below SMOOTHING_EPSILON (1e-9); should still register
      // as uniform.
      superellipse(8, 0.5 + 1e-12),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
    ];
    expect(isSuperellipseUniform(c)).toBe(true);
  });

  it("RF-009: treats supra-epsilon smoothing drift as non-uniform", () => {
    const c: Corners = [
      superellipse(8, 0.5),
      // 0.01 is well above SMOOTHING_EPSILON (1e-9); a real divergence.
      superellipse(8, 0.5 + 0.01),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
    ];
    expect(isSuperellipseUniform(c)).toBe(false);
  });
});

describe("hotspotTargetIndices", () => {
  it("corner hotspots target exactly one index", () => {
    expect(hotspotTargetIndices("tl")).toEqual([0]);
    expect(hotspotTargetIndices("tr")).toEqual([1]);
    expect(hotspotTargetIndices("br")).toEqual([2]);
    expect(hotspotTargetIndices("bl")).toEqual([3]);
  });
  it("edge hotspots target the two adjacent corners", () => {
    expect(hotspotTargetIndices("top")).toEqual([0, 1]);
    expect(hotspotTargetIndices("right")).toEqual([1, 2]);
    expect(hotspotTargetIndices("bottom")).toEqual([2, 3]);
    expect(hotspotTargetIndices("left")).toEqual([3, 0]);
  });
  it("center hotspot targets all four corners", () => {
    expect(hotspotTargetIndices("center")).toEqual([0, 1, 2, 3]);
  });
});

describe("cornersAtHotspot", () => {
  it("returns the corners at the targeted indices", () => {
    const c: Corners = [round(4), round(8), bevel(12), round(16)];
    expect(cornersAtHotspot(c, "top")).toEqual([round(4), round(8)]);
    expect(cornersAtHotspot(c, "br")).toEqual([bevel(12)]);
  });
});

describe("hotspotShapeIsMixed", () => {
  it("false for corner hotspot (always one corner)", () => {
    const c: Corners = [round(8), bevel(8), round(8), round(8)];
    expect(hotspotShapeIsMixed(c, "tl")).toBe(false);
  });
  it("true for edge hotspot with two different shapes", () => {
    const c: Corners = [round(8), bevel(8), round(8), round(8)];
    expect(hotspotShapeIsMixed(c, "top")).toBe(true);
  });
  it("false for center when all four match", () => {
    const c: Corners = [round(8), round(8), round(8), round(8)];
    expect(hotspotShapeIsMixed(c, "center")).toBe(false);
  });
});

describe("HotspotId — type-level enumeration", () => {
  // Compile-time check: the type covers exactly 9 ids.
  it("includes all 9 hotspot ids", () => {
    const ids: HotspotId[] = ["tl", "tr", "br", "bl", "top", "right", "bottom", "left", "center"];
    expect(ids.length).toBe(9);
  });
});

describe("isHotspotDisabled — RF-025", () => {
  it("returns false for every hotspot when nonCenterDisabled is false", () => {
    for (const id of ALL_HOTSPOT_IDS) {
      expect(isHotspotDisabled(id, false)).toBe(false);
    }
  });

  it("returns true for every non-center hotspot when nonCenterDisabled is true", () => {
    const nonCenter: HotspotId[] = ["tl", "tr", "br", "bl", "top", "right", "bottom", "left"];
    for (const id of nonCenter) {
      expect(isHotspotDisabled(id, true)).toBe(true);
    }
  });

  it("returns false for the center hotspot regardless of nonCenterDisabled", () => {
    expect(isHotspotDisabled("center", true)).toBe(false);
    expect(isHotspotDisabled("center", false)).toBe(false);
  });
});
