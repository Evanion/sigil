/**
 * @vitest-environment jsdom
 *
 * Tests the CornerPopover skeleton — header, shape picker, radius input,
 * Mixed indicator, and onCommit wiring.
 *
 * Note on Select interaction:
 *   The project's `Select` wrapper renders a Kobalte Select, NOT a native
 *   `<select>`. Tests inspect the trigger and Kobalte's portaled listbox
 *   (`role="listbox"` / `role="option"`) instead of `.options`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@solidjs/testing-library";
import { CornerPopover } from "../CornerPopover";
import { hotspotHasAsymmetricRadii } from "../corner-section-state";
import type { Corner, Corners } from "../../../types/document";

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}
function bevel(r: number): Corner {
  return { type: "bevel", radii: { x: r, y: r } };
}

const ROUND_8: Corners = [round(8), round(8), round(8), round(8)];
const MIXED: Corners = [round(8), bevel(8), round(8), round(8)];

describe("CornerPopover — common skeleton", () => {
  beforeEach(() => {
    // Stub native popover methods (ValueInput's color picker uses them)
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

  it("corner-popover renders header, shape picker, and radius input", () => {
    const { container } = render(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    expect(container.querySelector("h3")?.textContent).toBe("Top-left corner");
    expect(container.querySelector('[data-testid="corner-popover__shape"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="corner-popover__radius"]')).not.toBeNull();
  });

  it("corner popover offers 4 shapes (Round / Bevel / Notch / Scoop) — NOT Superellipse", () => {
    render(() => <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />);
    // Open the Kobalte Select by pointer-pressing the trigger.
    const trigger = screen.getByRole("button", { name: /Corner shape/i });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    // Kobalte renders options through a Portal — query against the entire document.
    const options = document.querySelectorAll('[role="option"]');
    const labels = Array.from(options).map((o) => o.textContent?.trim() ?? "");
    expect(labels).toEqual(["Round", "Bevel", "Notch", "Scoop"]);
  });

  it("center popover offers 5 shapes (adds Superellipse)", () => {
    render(() => <CornerPopover target="center" corners={ROUND_8} onCommit={() => {}} />);
    const trigger = screen.getByRole("button", { name: /Corner shape/i });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    const options = document.querySelectorAll('[role="option"]');
    const labels = Array.from(options).map((o) => o.textContent?.trim() ?? "");
    expect(labels).toEqual(["Round", "Bevel", "Notch", "Scoop", "Superellipse"]);
  });

  it("changing shape via the Select calls onCommit with the new shape applied to every targeted corner", () => {
    const handler = vi.fn();
    render(() => <CornerPopover target="top" corners={ROUND_8} onCommit={handler} />);

    // Open the listbox.
    const trigger = screen.getByRole("button", { name: /Corner shape/i });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });

    // Locate the "Bevel" option in the portal and pick it.
    const bevelOption = Array.from(document.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent?.trim() === "Bevel",
    ) as HTMLElement | undefined;
    expect(bevelOption).toBeTruthy();
    if (bevelOption === undefined) return; // type guard
    fireEvent.pointerDown(bevelOption, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(bevelOption, { button: 0, pointerType: "mouse" });
    fireEvent.click(bevelOption);

    // The "top" hotspot edits indices 0 and 1.
    expect(handler).toHaveBeenCalledTimes(1);
    const [newCorners] = handler.mock.calls[0] as [Corners];
    expect(newCorners[0].type).toBe("bevel");
    expect(newCorners[1].type).toBe("bevel");
    expect(newCorners[2].type).toBe("round"); // untouched
    expect(newCorners[3].type).toBe("round"); // untouched
  });

  it("shows the 'Mixed' indicator when targeted corners have different shapes", () => {
    const { container } = render(() => (
      <CornerPopover target="top" corners={MIXED} onCommit={() => {}} />
    ));
    expect(
      container.querySelector('[data-testid="corner-popover__mixed-indicator"]'),
    ).not.toBeNull();
  });
});

describe("CornerPopover — axis-unlock toggle", () => {
  beforeEach(() => {
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

  it("renders a Toggle labeled 'Unlock axes'", () => {
    const { container } = render(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    const toggle = container.querySelector('[data-testid="corner-popover__unlock"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-label")).toBe("Unlock axes");
  });

  it("pre-toggles on when any targeted corner has rx ≠ ry", () => {
    const asym: Corner = { type: "round", radii: { x: 30, y: 10 } };
    const corners = [asym, round(8), round(8), round(8)] as Corners;
    expect(hotspotHasAsymmetricRadii(corners, "tl")).toBe(true);
    const { container } = render(() => (
      <CornerPopover target="tl" corners={corners} onCommit={() => {}} />
    ));
    const sw = container.querySelector(
      '[data-testid="corner-popover__unlock"] [role="switch"]',
    ) as HTMLElement | null;
    expect(sw).not.toBeNull();
    expect(sw?.getAttribute("aria-checked")).toBe("true");
  });

  it("when unlocked, renders rx and ry ValueInputs and commits them separately", () => {
    const handler = vi.fn();
    const corners: Corners = [
      { type: "round", radii: { x: 8, y: 8 } },
      round(8),
      round(8),
      round(8),
    ];
    const { container } = render(() => (
      <CornerPopover target="tl" corners={corners} onCommit={handler} />
    ));

    // Click the toggle (the Switch element with role="switch") to unlock.
    const sw = container.querySelector(
      '[data-testid="corner-popover__unlock"] [role="switch"]',
    ) as HTMLElement;
    expect(sw).not.toBeNull();
    fireEvent.click(sw);

    const rxField = container.querySelector('[data-testid="corner-popover__rx"]');
    const ryField = container.querySelector('[data-testid="corner-popover__ry"]');
    expect(rxField).not.toBeNull();
    expect(ryField).not.toBeNull();
    if (rxField === null) return; // type guard

    // ValueInput is a contentEditable combobox — the inner editable element
    // is role="textbox" (NOT a native <input>). Drive a commit by setting
    // textContent + firing input + blur (matches ValueInput.test.tsx
    // "fires onCommit on blur when the value has changed" pattern).
    const rxTextbox = rxField.querySelector('[role="textbox"]') as HTMLElement;
    expect(rxTextbox).not.toBeNull();
    rxTextbox.textContent = "30";
    fireEvent.input(rxTextbox);
    fireEvent.blur(rxTextbox);

    expect(handler).toHaveBeenCalled();
    const lastCall = handler.mock.calls[handler.mock.calls.length - 1] as [Corners];
    const [newCorners] = lastCall;
    expect(newCorners[0].radii.x).toBe(30);
    expect(newCorners[0].radii.y).toBe(8); // unchanged
  });
});

function superellipseAll(s: number): Corners {
  return [
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
  ];
}

describe("CornerPopover — center smoothing control", () => {
  beforeEach(() => {
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

  it("does NOT render the smoothing control on non-center popovers", () => {
    const { container } = render(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).toBeNull();
  });

  it("does NOT render the smoothing control on center when shape != superellipse", () => {
    const { container } = render(() => (
      <CornerPopover target="center" corners={ROUND_8} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).toBeNull();
  });

  it("renders the smoothing control on center popover when shape = superellipse", () => {
    const { container } = render(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).not.toBeNull();
  });

  it("dragging the slider during a gesture batches into a single onCommit at gesture end", () => {
    // The wrapped Slider's onChangeEnd event drives the single commit
    // — per CLAUDE.md §11 "Continuous-Value Controls Must Coalesce
    // History Entries". Intermediate onChange events do NOT call onCommit.
    //
    // jsdom does not support a faithful Kobalte drag simulation (no layout,
    // no pointer-move slider geometry), but the Slider wrapper translates
    // pointerdown → pointerup into a single onChangeEnd call (see
    // Slider.test.tsx "should fire onChangeEnd at end of pointer interaction").
    // That single end event is what the smoothing control wires to onCommit.
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={handler} />
    ));
    const sliderWrapper = container.querySelector(
      '[data-testid="corner-popover__smoothing-slider"]',
    );
    expect(sliderWrapper).not.toBeNull();
    if (sliderWrapper === null) return; // type guard
    const thumb = sliderWrapper.querySelector('span[role="slider"]') as HTMLElement;
    expect(thumb).not.toBeNull();

    // Simulate a complete pointer gesture: pointerdown → pointerup.
    fireEvent.pointerDown(thumb, { pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.pointerUp(thumb, { pointerId: 1, clientX: 50, clientY: 0 });

    // Exactly one commit per gesture, regardless of intermediate updates.
    expect(handler).toHaveBeenCalledTimes(1);
    const [committed] = handler.mock.calls[0] as [Corners];
    // Every committed corner must remain superellipse and carry a finite
    // smoothing value (Slider final value, not necessarily 0.5).
    for (const c of committed) {
      expect(c.type).toBe("superellipse");
      if (c.type === "superellipse") {
        expect(Number.isFinite(c.smoothing)).toBe(true);
      }
    }
  });
});
