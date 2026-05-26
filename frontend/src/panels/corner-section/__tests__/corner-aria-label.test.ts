import { describe, it, expect } from "vitest";
import { summarizeCornersForAria } from "../corner-aria-label";
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

describe("summarizeCornersForAria", () => {
  it("uniform round → 'Rectangle with rounded corners, radius 8'", () => {
    const c: Corners = [round(8), round(8), round(8), round(8)];
    expect(summarizeCornersForAria(c)).toBe("Rectangle with rounded corners, radius 8");
  });

  it("zero radii → 'Rectangle with square corners'", () => {
    const c: Corners = [round(0), round(0), round(0), round(0)];
    expect(summarizeCornersForAria(c)).toBe("Rectangle with square corners");
  });

  it("uniform shape mismatched radii → 'Rectangle with rounded corners, mixed radii'", () => {
    const c: Corners = [round(4), round(8), round(12), round(16)];
    expect(summarizeCornersForAria(c)).toBe("Rectangle with rounded corners, mixed radii");
  });

  it("mixed shapes → 'Rectangle with round top corners, bevel bottom corners'", () => {
    const c: Corners = [round(8), round(8), bevel(8), bevel(8)];
    expect(summarizeCornersForAria(c)).toBe(
      "Rectangle with round top corners, bevel bottom corners",
    );
  });

  it("all four different → uses per-corner summary", () => {
    const c: Corners = [
      round(8),
      bevel(8),
      { type: "notch", radii: { x: 8, y: 8 } },
      { type: "scoop", radii: { x: 8, y: 8 } },
    ];
    expect(summarizeCornersForAria(c)).toBe(
      "Rectangle with round top-left, bevel top-right, notch bottom-right, scoop bottom-left",
    );
  });

  it("uniform superellipse exposes smoothing", () => {
    const c: Corners = [
      superellipse(8, 0.6),
      superellipse(8, 0.6),
      superellipse(8, 0.6),
      superellipse(8, 0.6),
    ];
    expect(summarizeCornersForAria(c)).toBe(
      "Rectangle with superellipse corners, radius 8, smoothing 0.6",
    );
  });
});
