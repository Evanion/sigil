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
