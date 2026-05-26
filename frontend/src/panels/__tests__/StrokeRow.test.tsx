import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { JSX } from "solid-js";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { StrokeRow } from "../StrokeRow";
import type { Stroke } from "../../types/document";
import { createTestI18n } from "../../test-utils/i18n";

let i18nInstance: i18n;

function renderWithI18n(ui: () => JSX.Element) {
  return render(() => <TransProvider instance={i18nInstance}>{ui()}</TransProvider>);
}

const baseStroke: Stroke = {
  color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
  width: { type: "literal", value: 2 },
  alignment: "center",
  cap: "butt",
  join: "miter",
};

const tokenRefWidthStroke: Stroke = {
  ...baseStroke,
  width: { type: "token_ref", name: "stroke-width-sm" },
};

describe("StrokeRow", () => {
  // jsdom does not implement the native popover API — stub the methods so
  // ValueInput's Popover component does not throw on mount.
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
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
    renderWithI18n(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const row = document.querySelector(".sigil-stroke-row");
    expect(row).toBeTruthy();
  });

  it("should render a drag handle that is aria-hidden", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const handle = document.querySelector(".sigil-stroke-row__handle");
    expect(handle).toBeTruthy();
    expect(handle?.getAttribute("aria-hidden")).toBe("true");
  });

  it("should render a Stroke color ValueInput combobox with swatch trigger", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const combobox = screen.getByRole("combobox", { name: "Stroke color" });
    expect(combobox).toBeTruthy();
    // The ValueInput exposes a swatch button for opening the color picker.
    // The swatch is now rendered by the shared Popover component — query by role.
    const swatchBtn = screen.getByRole("button", { name: "Color preview, click to edit" });
    expect(swatchBtn).toBeTruthy();
  });

  // Stroke alignment UI hidden until WebGL renderer supports inside/outside.
  // Tests for alignment select removed — the element is not rendered.

  it("should render a remove button with aria-label", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const removeBtn = screen.getByRole("button", { name: "Remove stroke" });
    expect(removeBtn).toBeTruthy();
  });

  it("should call onRemove with the correct index when remove is clicked", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <StrokeRow stroke={baseStroke} index={3} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const removeBtn = screen.getByRole("button", { name: "Remove stroke" });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith(3);
  });

  it("should render a width ValueInput showing the literal value", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <StrokeRow stroke={baseStroke} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const combobox = screen.getByRole("combobox", { name: "Stroke width" });
    expect(combobox).toBeTruthy();
    expect(combobox.textContent).toContain("2");
  });

  it("should render width as {name} for token_ref widths", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
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
    renderWithI18n(() => (
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
    renderWithI18n(() => (
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
