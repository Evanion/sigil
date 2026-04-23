import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { StrokeRow } from "../StrokeRow";
import type { Stroke } from "../../types/document";

const baseStroke: Stroke = {
  color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
  width: { type: "literal", value: 2 },
  alignment: "center",
  cap: "butt",
  join: "miter",
};

const insideStroke: Stroke = {
  ...baseStroke,
  alignment: "inside",
};

const outsideStroke: Stroke = {
  ...baseStroke,
  alignment: "outside",
};

const tokenRefWidthStroke: Stroke = {
  ...baseStroke,
  width: { type: "token_ref", name: "stroke-width-sm" },
};

describe("StrokeRow", () => {
  // jsdom does not implement the native popover API — stub the methods so
  // ValueInput's Popover component does not throw on mount.
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

  it("should render the row container with sigil-stroke-row class", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const row = document.querySelector(".sigil-stroke-row");
    expect(row).toBeTruthy();
  });

  it("should render a drag handle that is aria-hidden", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const handle = document.querySelector(".sigil-stroke-row__handle");
    expect(handle).toBeTruthy();
    expect(handle?.getAttribute("aria-hidden")).toBe("true");
  });

  it("should render a Stroke color ValueInput combobox with swatch trigger", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const combobox = screen.getByRole("combobox", { name: "Stroke color" });
    expect(combobox).toBeTruthy();
    // The ValueInput exposes a swatch button for opening the color picker.
    // The swatch is now rendered by the shared Popover component — query by role.
    const swatchBtn = screen.getByRole("button", { name: "Color preview, click to edit" });
    expect(swatchBtn).toBeTruthy();
  });

  it("should render the alignment as Center text", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    expect(screen.getByText("Center")).toBeTruthy();
  });

  it("should render the alignment as Inside for inside strokes", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={insideStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    expect(screen.getByText("Inside")).toBeTruthy();
  });

  it("should render the alignment as Outside for outside strokes", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={outsideStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    expect(screen.getByText("Outside")).toBeTruthy();
  });

  it("should render a remove button with aria-label", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const removeBtn = screen.getByRole("button", { name: "Remove stroke" });
    expect(removeBtn).toBeTruthy();
  });

  it("should call onRemove with the correct index when remove is clicked", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={3} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const removeBtn = screen.getByRole("button", { name: "Remove stroke" });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith(3);
  });

  it("should render a width ValueInput showing the literal value", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const combobox = screen.getByRole("combobox", { name: "Stroke width" });
    expect(combobox).toBeTruthy();
    expect(combobox.textContent).toContain("2");
  });

  it("should render width as {name} for token_ref widths", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={tokenRefWidthStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    // ValueInput renders token refs as "{name}" rather than a number.
    const combobox = screen.getByRole("combobox", { name: "Stroke width" });
    expect(combobox.textContent).toContain("{stroke-width-sm}");
  });

  // ── flushHistory wiring via onCommit prop ────────────────────────────

  it("should invoke onCommit when the color ValueInput commits via Enter", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onCommit = vi.fn();
    render(() => (
      <StrokeRow
        stroke={baseStroke}
        index={0}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onCommit={onCommit}
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Stroke color" });
    // Event handlers live on the inner textbox div, not the outer combobox.
    const textbox = combobox.querySelector('[role="textbox"]') as HTMLElement;
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(onCommit).toHaveBeenCalled();
  });

  it("should invoke onCommit when the width ValueInput commits via Enter", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onCommit = vi.fn();
    render(() => (
      <StrokeRow
        stroke={baseStroke}
        index={0}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onCommit={onCommit}
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Stroke width" });
    // Event handlers live on the inner textbox div, not the outer combobox.
    const textbox = combobox.querySelector('[role="textbox"]') as HTMLElement;
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(onCommit).toHaveBeenCalled();
  });
});
