/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import { CornerSection } from "../CornerSection";
import type { DocumentNode } from "../../../types/document";

function makeRectNode(uuid = "n1"): DocumentNode {
  return {
    id: { index: 1, generation: 0 },
    uuid,
    kind: {
      type: "rectangle",
      corners: [
        { type: "round", radii: { x: 8, y: 8 } },
        { type: "round", radii: { x: 8, y: 8 } },
        { type: "round", radii: { x: 8, y: 8 } },
        { type: "round", radii: { x: 8, y: 8 } },
      ],
    },
    name: "Rect 1",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 80, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
  };
}

/**
 * jsdom does NOT fire the native `toggle` event when `HTMLElement.showPopover()`
 * is stubbed (the Popover wrapper's `isOpen` signal therefore stays false and
 * its `<Show when={isOpen()}>{children}</Show>` gate keeps content unmounted).
 * In a real browser the platform fires this event automatically. We simulate
 * it here so the popover body actually renders for assertion.
 */
function simulatePopoverToggle(open: boolean): void {
  const popoverEl = document.querySelector(".sigil-popover");
  if (popoverEl === null) return;
  const ev = new Event("toggle") as Event & { newState: string; oldState: string };
  Object.defineProperty(ev, "newState", { value: open ? "open" : "closed" });
  Object.defineProperty(ev, "oldState", { value: open ? "closed" : "open" });
  popoverEl.dispatchEvent(ev);
}

describe("CornerSection — orchestration", () => {
  beforeEach(() => {
    // Stub native popover methods — Popover wrapper calls show/hidePopover.
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("renders preview + 9 hotspots when given a rectangle node", () => {
    const { container } = render(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    expect(container.querySelectorAll("button[data-hotspot]").length).toBe(9);
  });

  it("clicking a hotspot opens a popover anchored to that hotspot", async () => {
    const { container } = render(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tl);
    simulatePopoverToggle(true);
    // After the click + toggle simulation, the popover content is rendered.
    // Look for the popover header text.
    const headers = Array.from(document.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headers).toContain("Top-left corner");
  });

  it("committing from the popover invokes onCorners with the new array", async () => {
    // The project's Select wrapper renders a Kobalte Select, not a native
    // <select>. Mirror the interaction pattern used by CornerPopover tests:
    // pointerDown the trigger to open the portaled listbox, then click the
    // "Bevel" option.
    const handler = vi.fn();
    const { container } = render(() => <CornerSection node={makeRectNode()} onCorners={handler} />);
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tl);
    simulatePopoverToggle(true);

    // Locate the Select trigger inside the corner-popover shape field.
    const shapeField = document.querySelector(
      '[data-testid="corner-popover__shape"]',
    ) as HTMLElement;
    expect(shapeField).not.toBeNull();
    const trigger = shapeField.querySelector('button[aria-label="Corner shape"]');
    expect(trigger).not.toBeNull();
    if (trigger === null) return; // type guard
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });

    // The listbox is portaled to document.body; locate the Bevel option.
    const bevelOption = Array.from(document.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent?.trim() === "Bevel",
    ) as HTMLElement | undefined;
    expect(bevelOption).toBeTruthy();
    if (bevelOption === undefined) return; // type guard
    fireEvent.pointerDown(bevelOption, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(bevelOption, { button: 0, pointerType: "mouse" });
    fireEvent.click(bevelOption);

    expect(handler).toHaveBeenCalled();
    const [newCorners] = handler.mock.calls[handler.mock.calls.length - 1];
    expect(newCorners[0].type).toBe("bevel");
  });
});

function makeSuperellipseRectNode(): DocumentNode {
  const c = { type: "superellipse" as const, radii: { x: 8, y: 8 }, smoothing: 0.5 };
  return {
    ...makeRectNode("n-se"),
    kind: { type: "rectangle", corners: [c, c, c, c] },
  };
}

describe("CornerSection — superellipse lock state", () => {
  it("disables the 8 non-center hotspots when the node is uniform-superellipse", () => {
    const { container } = render(() => (
      <CornerSection node={makeSuperellipseRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    const center = container.querySelector("button[data-hotspot='center']") as HTMLButtonElement;
    expect(tl.getAttribute("aria-disabled")).toBe("true");
    expect(center.getAttribute("aria-disabled")).toBeNull();
  });

  it("the disabled hotspots carry the locked-state tooltip via the title attribute", () => {
    const { container } = render(() => (
      <CornerSection node={makeSuperellipseRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    expect(tl.getAttribute("title")).toBe(
      "Superellipse applies to all corners. Change the shape to edit corners individually.",
    );
  });
});

function makeEllipseNode(): DocumentNode {
  return {
    ...makeRectNode("n-e"),
    kind: { type: "ellipse" },
  } as DocumentNode;
}

function makeGroupNode(): DocumentNode {
  return {
    ...makeRectNode("n-g"),
    kind: { type: "group" },
  } as DocumentNode;
}

describe("CornerSection — RF-038 disabled state for non-corner-bearing kinds", () => {
  it("renders the disabled placeholder for an ellipse node", () => {
    const { container } = render(() => (
      <CornerSection node={makeEllipseNode()} onCorners={() => {}} />
    ));
    expect(
      container.querySelector('[data-testid="corner-section__disabled"]'),
    ).not.toBeNull();
    expect(container.querySelector("button[data-hotspot]")).toBeNull();
    expect(container.textContent).toContain(
      "Corner radius applies to rectangles, frames, and images only",
    );
  });

  it("renders the disabled placeholder for a group node", () => {
    const { container } = render(() => (
      <CornerSection node={makeGroupNode()} onCorners={() => {}} />
    ));
    expect(
      container.querySelector('[data-testid="corner-section__disabled"]'),
    ).not.toBeNull();
  });

  it("the disabled state has a sr-only role=status line with the explanation", () => {
    const { container } = render(() => (
      <CornerSection node={makeEllipseNode()} onCorners={() => {}} />
    ));
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      "Corner radius applies to rectangles, frames, and images only",
    );
  });
});
