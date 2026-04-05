import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { FillRow } from "../FillRow";
import type { Fill, FillSolid } from "../../types/document";

const solidFill: FillSolid = {
  type: "solid",
  color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
};

const gradientFill: Fill = {
  type: "linear_gradient",
  gradient: {
    stops: [
      { position: 0, color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } } },
      { position: 1, color: { type: "literal", value: { space: "srgb", r: 1, g: 1, b: 1, a: 1 } } },
    ],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },
};

const imageFill: Fill = {
  type: "image",
  asset_ref: "abc123",
  scale_mode: "fill",
};

describe("FillRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render the fill type label as Solid for solid fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />);
    expect(screen.getByText("Solid")).toBeTruthy();
  });

  it("should render the fill type label as Linear for linear gradient fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => <FillRow fill={gradientFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />);
    expect(screen.getByText("Linear")).toBeTruthy();
  });

  it("should render the fill type label as Image for image fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => <FillRow fill={imageFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />);
    expect(screen.getByText("Image")).toBeTruthy();
  });

  it("should render a drag handle that is aria-hidden", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />);
    // The drag handle has aria-hidden="true"
    const handle = document.querySelector(".sigil-fill-row__handle");
    expect(handle).toBeTruthy();
    expect(handle?.getAttribute("aria-hidden")).toBe("true");
  });

  it("should render a color swatch span inside a trigger button for solid fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />);
    const swatch = document.querySelector(".sigil-color-swatch");
    expect(swatch).toBeTruthy();
    // The swatch visual is a <span>; the Kobalte trigger <button> wraps it
    expect(swatch?.tagName.toLowerCase()).toBe("span");
    expect(swatch?.closest("button.sigil-popover-trigger")).toBeTruthy();
  });

  it("should render a remove button with aria-label", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />);
    const removeBtn = screen.getByRole("button", { name: "Remove fill" });
    expect(removeBtn).toBeTruthy();
  });

  it("should call onRemove with the correct index when remove is clicked", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => <FillRow fill={solidFill} index={2} onUpdate={onUpdate} onRemove={onRemove} />);
    const removeBtn = screen.getByRole("button", { name: "Remove fill" });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it("should render the row container with sigil-fill-row class", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(() => <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />);
    const row = document.querySelector(".sigil-fill-row");
    expect(row).toBeTruthy();
  });
});
