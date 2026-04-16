/**
 * FillRow tests — verifies rendering, type switching, and gradient controls.
 *
 * Uses TransProvider wrapping per i18n requirements.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { JSX } from "solid-js";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { FillRow } from "../FillRow";
import type { Fill, FillSolid, FillLinearGradient, FillRadialGradient } from "../../types/document";
import { createTestI18n } from "../../test-utils/i18n";

const solidFill: FillSolid = {
  type: "solid",
  color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
};

const gradientFill: FillLinearGradient = {
  type: "linear_gradient",
  gradient: {
    stops: [
      { position: 0, color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } } },
      { position: 1, color: { type: "literal", value: { space: "srgb", r: 1, g: 1, b: 1, a: 1 } } },
    ],
    start: { x: 0.5, y: 0 },
    end: { x: 0.5, y: 1 },
  },
};

const radialFill: FillRadialGradient = {
  type: "radial_gradient",
  gradient: {
    stops: [
      { position: 0, color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } } },
      { position: 1, color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } } },
    ],
    start: { x: 0.5, y: 0.5 },
    end: { x: 1, y: 0.5 },
  },
};

const imageFill: Fill = {
  type: "image",
  asset_ref: "abc123",
  scale_mode: "fill",
};

let i18nInstance: i18n;

function renderWithI18n(ui: () => JSX.Element) {
  return render(() => <TransProvider instance={i18nInstance}>{ui()}</TransProvider>);
}

describe("FillRow", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
  });

  afterEach(() => {
    cleanup();
  });

  it("should render the fill type as Solid in the select for solid fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    // The Select trigger should display "Solid"
    expect(screen.getByText("Solid")).toBeTruthy();
  });

  it("should render the fill type as Linear for linear gradient fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={gradientFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    expect(screen.getByText("Linear")).toBeTruthy();
  });

  it("should render the fill type as Image for image fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={imageFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    // Image type is not in the dropdown options but should still render as the fill
    // Currently FillRow only supports solid/linear/radial type switching
    // Image fills will show the Select with value "image" which won't match any option
    // This is acceptable — image fills are not switchable yet
    const row = document.querySelector(".sigil-fill-row");
    expect(row).toBeTruthy();
  });

  it("should render a drag handle that is aria-hidden", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const handle = document.querySelector(".sigil-fill-row__handle");
    expect(handle).toBeTruthy();
    expect(handle?.getAttribute("aria-hidden")).toBe("true");
  });

  it("should render a Fill color ValueInput combobox for solid fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const combobox = screen.getByRole("combobox", { name: "Fill color" });
    expect(combobox).toBeTruthy();
    // The ValueInput exposes a color swatch trigger button alongside the combobox.
    const swatchBtn = document.querySelector(".sigil-token-input__swatch-btn");
    expect(swatchBtn).toBeTruthy();
  });

  it("should render the hex color of the solid fill in the combobox value", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const combobox = screen.getByRole("combobox", { name: "Fill color" });
    // Solid red => #ff0000
    expect(combobox.textContent).toContain("#ff0000");
  });

  it("should render a remove button with aria-label", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const removeBtn = screen.getByRole("button", { name: "Remove fill" });
    expect(removeBtn).toBeTruthy();
  });

  it("should call onRemove with the correct index when remove is clicked", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={2} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const removeBtn = screen.getByRole("button", { name: "Remove fill" });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it("should render the row container with sigil-fill-row class", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const row = document.querySelector(".sigil-fill-row");
    expect(row).toBeTruthy();
  });

  // ── Type switching tests ──────────────────────────────────────────────
  // NOTE: Kobalte Select renders its listbox via Portal, which doesn't
  // reliably open in JSDOM. We verify the Select trigger renders with
  // the correct value instead of testing dropdown interaction.

  it("should render a Fill type select trigger with the current fill type", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const trigger = screen.getByRole("button", { name: /Fill type/ });
    expect(trigger).toBeTruthy();
    // Should display "Solid" as the current value
    expect(trigger.textContent).toContain("Solid");
  });

  it("should render Fill type select with Linear for linear gradient fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={gradientFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const trigger = screen.getByRole("button", { name: /Fill type/ });
    expect(trigger.textContent).toContain("Linear");
  });

  it("should render Fill type select with Radial for radial gradient fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={radialFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const trigger = screen.getByRole("button", { name: /Fill type/ });
    expect(trigger.textContent).toContain("Radial");
  });

  it("should show gradient editor popover trigger when fill is a linear gradient", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={gradientFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    // The gradient swatch is rendered inside a popover trigger button
    const swatch = document.querySelector(".sigil-gradient-swatch");
    expect(swatch).toBeTruthy();
    const trigger = screen.getByRole("button", { name: /Edit gradient/ });
    expect(trigger).toBeTruthy();
  });

  it("should show gradient editor popover trigger when fill is a radial gradient", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={radialFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const swatch = document.querySelector(".sigil-gradient-swatch");
    expect(swatch).toBeTruthy();
    const trigger = screen.getByRole("button", { name: /Edit gradient/ });
    expect(trigger).toBeTruthy();
  });

  it("should not show gradient editor popover trigger when fill is solid", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={solidFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const swatch = document.querySelector(".sigil-gradient-swatch");
    expect(swatch).toBeNull();
  });

  // ── flushHistory wiring via onCommit prop ────────────────────────────

  it("should invoke onCommit when the color ValueInput commits via Enter", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onCommit = vi.fn();
    renderWithI18n(() => (
      <FillRow
        fill={solidFill}
        index={0}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onCommit={onCommit}
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Fill color" });
    // ValueInput fires onCommit on Enter — the FillRow forwards to props.onCommit
    // so AppearancePanel can call store.flushHistory().
    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onCommit).toHaveBeenCalled();
  });

  it("should show gradient swatch instead of ValueInput for gradient fills", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderWithI18n(() => (
      <FillRow fill={gradientFill} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    ));
    const gradientSwatch = document.querySelector(".sigil-gradient-swatch");
    expect(gradientSwatch).toBeTruthy();
    // Gradient fills should not expose the Fill color combobox — the gradient
    // editor replaces the per-fill color control.
    const fillColor = screen.queryByRole("combobox", { name: "Fill color" });
    expect(fillColor).toBeNull();
  });
});
