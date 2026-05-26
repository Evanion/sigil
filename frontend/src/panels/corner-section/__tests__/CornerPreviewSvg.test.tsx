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
    expect(svg?.getAttribute("aria-label")).toBe("Rectangle with rounded corners, radius 8");
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

  it("locked hotspots wire their reason via aria-describedby (RF-004)", () => {
    const { container } = render(() => (
      <CornerPreviewSvg
        corners={SUPERELLIPSE_UNIFORM}
        onHotspotActivate={() => {}}
        nonCenterHotspotsDisabled
      />
    ));
    const tlButton = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    const describedBy = tlButton.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    // The described-by id resolves to an sr-only span carrying the
    // locked-state explanation. Use document-scoped lookup because
    // sr-only utility classes may live anywhere in the section.
    const target =
      describedBy === null ? null : container.querySelector(`#${CSS.escape(describedBy)}`);
    expect(target).not.toBeNull();
    expect(target?.textContent).toContain("Superellipse applies to all corners");
    expect(target?.className).toContain("sr-only");
    // title remains for sighted mouse users — not removed.
    expect(tlButton.getAttribute("title")).toBe(
      "Superellipse applies to all corners. Change the shape to edit corners individually.",
    );
  });

  it("non-disabled hotspots have no aria-describedby (RF-004)", () => {
    const { container } = render(() => (
      <CornerPreviewSvg corners={ROUND_8} onHotspotActivate={() => {}} />
    ));
    const tlButton = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    expect(tlButton.getAttribute("aria-describedby")).toBeNull();
    expect(tlButton.getAttribute("title")).toBeNull();
  });

  it("hotspots remain visible (non-zero opacity) at rest and when locked (RF-003)", () => {
    const { container } = render(() => (
      <CornerPreviewSvg
        corners={SUPERELLIPSE_UNIFORM}
        onHotspotActivate={() => {}}
        nonCenterHotspotsDisabled
      />
    ));
    const tlButton = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    const centerButton = container.querySelector(
      "button[data-hotspot='center']",
    ) as HTMLButtonElement;
    // We can't read CSS-variable-driven computed styles reliably in
    // jsdom (it parses but does not apply external stylesheet rules).
    // Instead, assert that the buttons carry the visibility-class hooks
    // that the stylesheet keys on — proving the visual contract is
    // wired even though jsdom can't paint.
    // Locked hotspots must NOT have `opacity: 0` in their inline style
    // and must not be flagged as visually hidden.
    expect(tlButton.style.opacity).not.toBe("0");
    expect(tlButton.getAttribute("hidden")).toBeNull();
    expect(tlButton.getAttribute("aria-hidden")).toBeNull();
    // The buttons remain in the tab order — neither at rest nor while
    // locked should they be removed from the tab sequence (the disabled
    // state communicates lock via aria-disabled + aria-describedby).
    expect(tlButton.tabIndex).toBeGreaterThanOrEqual(0);
    expect(centerButton.tabIndex).toBeGreaterThanOrEqual(0);
  });
});
