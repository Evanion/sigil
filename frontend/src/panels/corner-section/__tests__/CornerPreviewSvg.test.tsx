/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { CornerPreviewSvg } from "../CornerPreviewSvg";
import type { Corners } from "../../../types/document";

const ROUND_8: Corners = [
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
];

const SUPERELLIPSE_UNIFORM: Corners = [
  { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
  { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
  { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
  { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
];

describe("CornerPreviewSvg", () => {
  it("renders an <svg role='img'> with a descriptive aria-label", () => {
    const { container } = render(() => (
      <CornerPreviewSvg corners={ROUND_8} onHotspotActivate={() => {}} />
    ));
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe(
      "Rectangle with rounded corners, radius 8",
    );
  });

  it("renders exactly 9 hotspot buttons, each with a unique aria-label", () => {
    const { container } = render(() => (
      <CornerPreviewSvg corners={ROUND_8} onHotspotActivate={() => {}} />
    ));
    const buttons = container.querySelectorAll("button[data-hotspot]");
    expect(buttons.length).toBe(9);
    const labels = Array.from(buttons).map((b) => b.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(9);
    expect(labels).toContain("Edit top-left corner");
    expect(labels).toContain("Edit all corners");
  });

  it("invokes onHotspotActivate with the clicked id", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerPreviewSvg corners={ROUND_8} onHotspotActivate={handler} />
    ));
    const tlButton = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tlButton);
    expect(handler).toHaveBeenCalledWith("tl", tlButton);
  });

  it("locks non-center hotspots when nonCenterHotspotsDisabled is true", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerPreviewSvg
        corners={SUPERELLIPSE_UNIFORM}
        onHotspotActivate={handler}
        nonCenterHotspotsDisabled
      />
    ));
    const tlButton = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    const centerButton = container.querySelector(
      "button[data-hotspot='center']",
    ) as HTMLButtonElement;
    expect(tlButton.getAttribute("aria-disabled")).toBe("true");
    expect(centerButton.getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(tlButton);
    expect(handler).not.toHaveBeenCalled();
    fireEvent.click(centerButton);
    expect(handler).toHaveBeenCalledWith("center", centerButton);
  });
});
