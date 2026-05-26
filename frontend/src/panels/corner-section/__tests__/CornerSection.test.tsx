/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JSX } from "solid-js";
import { fireEvent, cleanup } from "@solidjs/testing-library";
import type { i18n } from "i18next";
import { CornerSection } from "../CornerSection";
import type { DocumentNode } from "../../../types/document";
import { createTestI18n, renderWithI18n as renderWithI18nShared } from "../../../test-utils/i18n";

let i18nInstance: i18n;

const renderWithI18n = (ui: () => JSX.Element) => renderWithI18nShared(ui, i18nInstance);

/** Wait for queueMicrotask-scheduled focus restoration to flush. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

/** Wait for multiple ticks of microtask / Solid reactive flushing. */
async function flushReactive(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await flushMicrotasks();
    // A `Promise.resolve()` await is a separate microtask checkpoint
    // than queueMicrotask, helping Solid's effect scheduler catch up.
    await Promise.resolve();
  }
}

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
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
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
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    expect(container.querySelectorAll("button[data-hotspot]").length).toBe(9);
  });

  it("clicking a hotspot opens a popover anchored to that hotspot", async () => {
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tl);
    simulatePopoverToggle(true);
    // After the click + toggle simulation, the popover content is rendered.
    // RF-010: popover header is h4 (one level below CornerSection's h3).
    const headers = Array.from(document.querySelectorAll("h4")).map((h) => h.textContent);
    expect(headers).toContain("Top-left corner");
  });

  it("does not wrap the popover in an aria-hidden host element (RF-001)", () => {
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    // The legacy aria-hidden host wrapper around the Popover wrapper has
    // been removed — the Popover is anchored via the new anchorRef API
    // directly to the clicked hotspot button.
    expect(container.querySelector(".sigil-corner-section__popover-host")).toBeNull();
    // Sanity: no aria-hidden container should sit between the preview and
    // any focusable popover element it controls.
    const ariaHiddenContainers = container.querySelectorAll('[aria-hidden="true"]');
    for (const el of ariaHiddenContainers) {
      // Allow the disabled-preview decoration; reject anything that holds
      // a focusable button.
      expect(el.querySelector("button")).toBeNull();
    }
  });

  it("mirrors aria-expanded onto the clicked hotspot when the popover opens (RF-001 anchorRef)", async () => {
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    // Before activation, no anchor is bound so the wrapper hasn't yet
    // mirrored ARIA expand-state onto the hotspot. After click + toggle,
    // the wrapper's external-anchor effect adopts the element and
    // mirrors `aria-expanded` + `aria-haspopup` + `aria-controls`.
    fireEvent.click(tl);
    simulatePopoverToggle(true);
    await flushReactive();
    expect(tl.getAttribute("aria-expanded")).toBe("true");
    expect(tl.getAttribute("aria-haspopup")).toBe("dialog");
    expect(tl.getAttribute("aria-controls")).not.toBeNull();
  });

  it("focus returns to the activating hotspot when handleOpenChange(false) fires (RF-002)", async () => {
    // Install a second focusable element to simulate focus moving inside
    // the popover content (jsdom does not move focus when the body or a
    // non-tabbable element is targeted by .focus()).
    const sink = document.createElement("button");
    sink.textContent = "focus sink";
    document.body.appendChild(sink);
    try {
      const { container } = renderWithI18n(() => (
        <CornerSection node={makeRectNode()} onCorners={() => {}} />
      ));
      const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
      tl.focus();
      fireEvent.click(tl);
      simulatePopoverToggle(true);
      // Move focus AWAY from the trigger — this is what would happen
      // when focus moves into the popover content in a real browser.
      sink.focus();
      expect(document.activeElement).toBe(sink);
      // Close via the Popover wrapper's toggle event.
      simulatePopoverToggle(false);
      // Focus restoration is scheduled via queueMicrotask so the popover's
      // own teardown completes first.
      await flushMicrotasks();
      expect(document.activeElement).toBe(tl);
    } finally {
      sink.remove();
    }
  });

  it("focus returns to the activating hotspot when the popover closes via Escape (RF-002)", async () => {
    const sink = document.createElement("button");
    sink.textContent = "focus sink";
    document.body.appendChild(sink);
    try {
      const { container } = renderWithI18n(() => (
        <CornerSection node={makeRectNode()} onCorners={() => {}} />
      ));
      const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
      tl.focus();
      fireEvent.click(tl);
      simulatePopoverToggle(true);
      sink.focus();
      // Escape triggers the Popover wrapper's hidePopover which in turn
      // fires a toggle event (newState=closed). Simulate that here.
      simulatePopoverToggle(false);
      await flushMicrotasks();
      expect(document.activeElement).toBe(tl);
    } finally {
      sink.remove();
    }
  });

  it("committing from the popover invokes onCorners with the new array", async () => {
    // The project's Select wrapper renders a Kobalte Select, not a native
    // <select>. Mirror the interaction pattern used by CornerPopover tests:
    // pointerDown the trigger to open the portaled listbox, then click the
    // "Bevel" option.
    const handler = vi.fn();
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeRectNode()} onCorners={handler} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tl);
    simulatePopoverToggle(true);

    // Locate the Select trigger inside the corner-popover shape field.
    // RF-011: the Select is wired via aria-labelledby (visible <label> is
    // the accessible name). Kobalte composes aria-labelledby from our
    // label id + its internal value id, so we match by membership.
    const shapeField = document.querySelector(
      '[data-testid="corner-popover__shape"]',
    ) as HTMLElement;
    expect(shapeField).not.toBeNull();
    const label = shapeField.querySelector("label") as HTMLLabelElement;
    const trigger = (Array.from(shapeField.querySelectorAll("button")).find((b) => {
      const lb = b.getAttribute("aria-labelledby");
      return lb !== null && lb.split(/\s+/).includes(label.id);
    }) ?? null) as HTMLElement | null;
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
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeSuperellipseRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    const center = container.querySelector("button[data-hotspot='center']") as HTMLButtonElement;
    expect(tl.getAttribute("aria-disabled")).toBe("true");
    expect(center.getAttribute("aria-disabled")).toBeNull();
  });

  it("the disabled hotspots carry the locked-state tooltip via the title attribute", () => {
    const { container } = renderWithI18n(() => (
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
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeEllipseNode()} onCorners={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-section__disabled"]')).not.toBeNull();
    expect(container.querySelector("button[data-hotspot]")).toBeNull();
    expect(container.textContent).toContain(
      "Corner radius applies to rectangles, frames, and images only",
    );
  });

  it("renders the disabled placeholder for a group node", () => {
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeGroupNode()} onCorners={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-section__disabled"]')).not.toBeNull();
  });

  // RF-014: the disabled state used to render a duplicate sr-only span with
  // role="status" alongside the visible <p>. The role re-fired its
  // announcement every time the user selected a non-corner-bearing node,
  // flooding SR queues. The visible <p> sits in the reading flow already.
  it("RF-014: the disabled state renders the explanation as a visible <p> and not as an aria-live status duplicate", () => {
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeEllipseNode()} onCorners={() => {}} />
    ));
    // The visible paragraph carries the explanation.
    const p = container.querySelector(".sigil-corner-section__disabled-text");
    expect(p?.textContent).toContain(
      "Corner radius applies to rectangles, frames, and images only",
    );

    // No additional role="status" span inside the disabled block — the
    // role-fire on every selection change is the regression we are
    // removing. Any role="status" elements elsewhere in the document (e.g.
    // the CornerPopover's aria-live region when the popover is open) are
    // unaffected; the disabled block specifically must not host one.
    const disabledBlock = container.querySelector(
      '[data-testid="corner-section__disabled"]',
    ) as HTMLElement;
    expect(disabledBlock.querySelector('[role="status"]')).toBeNull();
  });

  // RF-010: CornerSection's heading is h3 (matches sibling sections like
  // TypographySection). Was previously h2 — that broke heading hierarchy.
  it("RF-010: CornerSection header is h3 to match sibling section levels", () => {
    const { container } = renderWithI18n(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    const heading = container.querySelector(".sigil-corner-section__header");
    expect(heading?.tagName.toLowerCase()).toBe("h3");
    expect(heading?.textContent).toBe("Corners");
  });
});
