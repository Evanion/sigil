/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { CornerPreviewSvg } from "../CornerPreviewSvg";
import type { Corners } from "../../../types/document";

const ROUND_8: Corners = [
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
];

describe("CornerPreviewSvg", () => {
  it("renders an <svg role='img'> with a descriptive aria-label", () => {
    const { container } = render(() => <CornerPreviewSvg corners={ROUND_8} />);
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("expected <svg> in render output");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Rectangle with rounded corners, radius 8");
  });

  it("contains a single <path> with a non-empty d attribute", () => {
    const { container } = render(() => <CornerPreviewSvg corners={ROUND_8} />);
    const path = container.querySelector("svg > path");
    if (!path) throw new Error("expected <path> in render output");
    const d = path.getAttribute("d") ?? "";
    expect(d.length).toBeGreaterThan(0);
    // Round corners produce one A (arc) per corner = 4 arcs.
    const arcCount = (d.match(/A /g) ?? []).length;
    expect(arcCount).toBe(4);
  });
});
