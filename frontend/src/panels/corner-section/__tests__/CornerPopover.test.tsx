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
