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

describe("Tooltip", () => {
  it("should render the trigger element with children", () => {
    render(() => (
      <Tooltip content="Helpful tip">
        Hover me
      </Tooltip>
    ));
    expect(screen.getByText("Hover me")).toBeTruthy();
  });

  it("should render trigger as a button element (Kobalte default)", () => {
    render(() => (
      <Tooltip content="Button trigger tip">
        Click me
      </Tooltip>
    ));
    const btn = screen.getByText("Click me").closest("button");
    expect(btn).toBeTruthy();
    // Must not be wrapped in a <span> — the old as="span" violation
    let ancestor = btn?.parentElement;
    while (ancestor && ancestor !== document.body) {
      expect(ancestor.tagName.toLowerCase()).not.toBe("span");
      ancestor = ancestor.parentElement;
    }
  });

  it("should not show tooltip content initially", () => {
    render(() => (
      <Tooltip content="Hidden tip">
        Initial trigger
      </Tooltip>
    ));
    expect(screen.queryByText("Hidden tip")).toBeNull();
  });

  it("should show tooltip content on pointer enter after delay", async () => {
    render(() => (
      <Tooltip content="Delayed tip" openDelay={0}>
        Pointer trigger
      </Tooltip>
    ));
    const trigger = screen.getByText("Pointer trigger");
    fireEvent.pointerEnter(trigger);
    fireEvent.mouseEnter(trigger);
    await waitFor(() => {
      expect(screen.getByText("Delayed tip")).toBeTruthy();
    });
  });

  it("should close tooltip on pointer leave", async () => {
    render(() => (
      <Tooltip content="Vanishing tip" openDelay={0} closeDelay={0}>
        Leave trigger
      </Tooltip>
    ));
    const trigger = screen.getByText("Leave trigger");
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
        Focus trigger
      </Tooltip>
    ));
    const trigger = screen.getByText("Focus trigger").closest("button")!;
    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getByText("Focus tip")).toBeTruthy();
    });
  });

  it("should apply the sigil-tooltip class to the content element", async () => {
    render(() => (
      <Tooltip content="Styled tip" openDelay={0}>
        Style trigger
      </Tooltip>
    ));
    const trigger = screen.getByText("Style trigger");
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
        Arrow trigger
      </Tooltip>
    ));
    const trigger = screen.getByText("Arrow trigger");
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
        Placement trigger
      </Tooltip>
    ));
    expect(screen.getByText("Placement trigger")).toBeTruthy();
  });

  it("should forward aria-label to the trigger button", () => {
    render(() => (
      <Tooltip content="Labelled tip" aria-label="Custom label">
        Icon
      </Tooltip>
    ));
    const btn = screen.getByLabelText("Custom label");
    expect(btn).toBeTruthy();
    expect(btn.tagName.toLowerCase()).toBe("button");
  });
});
