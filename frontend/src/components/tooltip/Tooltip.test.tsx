/**
 * Tests for the Tooltip component.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@solidjs/testing-library";
import { Tooltip } from "./Tooltip";

afterEach(() => {
  cleanup();
});

/** Returns the closest ancestor `<span>` wrapping a trigger element. */
function getTriggerSpan(text: string): HTMLElement {
  const el = screen.getByText(text).closest("span");
  if (el === null) {
    throw new Error(`Could not find <span> ancestor for text: ${text}`);
  }
  return el;
}

describe("Tooltip", () => {
  it("should render the trigger element", () => {
    render(() => (
      <Tooltip content="Helpful tip">
        <button>Hover me</button>
      </Tooltip>
    ));
    expect(screen.getByText("Hover me")).toBeTruthy();
  });

  it("should not show tooltip content initially", () => {
    render(() => (
      <Tooltip content="Hidden tip">
        <button>Initial trigger</button>
      </Tooltip>
    ));
    expect(screen.queryByText("Hidden tip")).toBeNull();
  });

  it("should show tooltip content on pointer enter after delay", async () => {
    render(() => (
      <Tooltip content="Delayed tip" openDelay={0}>
        <button>Pointer trigger</button>
      </Tooltip>
    ));
    const trigger = getTriggerSpan("Pointer trigger");
    fireEvent.pointerEnter(trigger);
    fireEvent.mouseEnter(trigger);
    await waitFor(() => {
      expect(screen.getByText("Delayed tip")).toBeTruthy();
    });
  });

  it("should close tooltip on pointer leave", async () => {
    render(() => (
      <Tooltip content="Vanishing tip" openDelay={0} closeDelay={0}>
        <button>Leave trigger</button>
      </Tooltip>
    ));
    const trigger = getTriggerSpan("Leave trigger");
    fireEvent.pointerEnter(trigger);
    fireEvent.mouseEnter(trigger);
    await waitFor(() => {
      const tooltipContent = screen.getByRole("tooltip");
      expect(tooltipContent).toBeTruthy();
      expect(tooltipContent.hasAttribute("data-closed")).toBe(false);
    });
    fireEvent.pointerLeave(trigger);
    fireEvent.mouseLeave(trigger);
    await waitFor(() => {
      const tooltipContent = screen.getByRole("tooltip");
      expect(tooltipContent.hasAttribute("data-closed")).toBe(true);
    });
  });

  it("should show tooltip content on focus", async () => {
    render(() => (
      <Tooltip content="Focus tip" openDelay={0}>
        <button>Focus trigger</button>
      </Tooltip>
    ));
    const trigger = getTriggerSpan("Focus trigger");
    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getByText("Focus tip")).toBeTruthy();
    });
  });

  it("should apply the sigil-tooltip class to the content element", async () => {
    render(() => (
      <Tooltip content="Styled tip" openDelay={0}>
        <button>Style trigger</button>
      </Tooltip>
    ));
    const trigger = getTriggerSpan("Style trigger");
    fireEvent.pointerEnter(trigger);
    fireEvent.mouseEnter(trigger);
    await waitFor(() => {
      const content = screen.getByText("Styled tip");
      expect(content.closest(".sigil-tooltip")).toBeTruthy();
    });
  });

  it("should render an arrow element inside the tooltip", async () => {
    render(() => (
      <Tooltip content="Arrow tip" openDelay={0}>
        <button>Arrow trigger</button>
      </Tooltip>
    ));
    const trigger = getTriggerSpan("Arrow trigger");
    fireEvent.pointerEnter(trigger);
    fireEvent.mouseEnter(trigger);
    await waitFor(() => {
      const content = screen.getByText("Arrow tip").closest(".sigil-tooltip");
      expect(content).toBeTruthy();
      const arrow = content?.querySelector(".sigil-tooltip__arrow");
      expect(arrow).toBeTruthy();
    });
  });

  it("should accept placement prop without error", () => {
    render(() => (
      <Tooltip content="Bottom tip" placement="bottom">
        <button>Placement trigger</button>
      </Tooltip>
    ));
    expect(screen.getByText("Placement trigger")).toBeTruthy();
  });
});
