import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("should render a color swatch button", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const swatch = document.querySelector(".sigil-stroke-row__swatch");
    expect(swatch).toBeTruthy();
    expect(swatch?.tagName.toLowerCase()).toBe("button");
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

  it("should render a width input showing the literal value", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    // NumberInput renders an <input> element; value should be 2
    const input = document.querySelector(".sigil-stroke-row__width input");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("2");
  });

  it("should render width as 0 for token_ref widths (unknown literal value)", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={tokenRefWidthStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    // token_ref widths cannot display a number, so we fall back to 0
    const input = document.querySelector(".sigil-stroke-row__width input");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("0");
  });

  it("should call onUpdate with updated width when width input changes", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <StrokeRow stroke={baseStroke} index={1} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const input = document.querySelector(".sigil-stroke-row__width input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "4" } });
    // onUpdate should have been called with index 1 and new stroke with width 4
    expect(onUpdate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ width: { type: "literal", value: 4 } }),
    );
  });
});
