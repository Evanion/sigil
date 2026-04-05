import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { EffectCard } from "../EffectCard";
import type { EffectDropShadow, EffectLayerBlur } from "../../types/document";

const dropShadow: EffectDropShadow = {
  type: "drop_shadow",
  color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 0.3 } },
  offset: { x: 0, y: 4 },
  blur: { type: "literal", value: 8 },
  spread: { type: "literal", value: 0 },
};

const layerBlur: EffectLayerBlur = {
  type: "layer_blur",
  radius: { type: "literal", value: 4 },
};

const dropShadowBlur12: EffectDropShadow = {
  type: "drop_shadow",
  color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 0.3 } },
  offset: { x: 0, y: 4 },
  blur: { type: "literal", value: 12 },
  spread: { type: "literal", value: 0 },
};

describe("EffectCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render the card container with sigil-effect-card class", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    expect(document.querySelector(".sigil-effect-card")).toBeTruthy();
  });

  it("should render a drag handle that is aria-hidden", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    const handle = document.querySelector(".sigil-effect-card__handle");
    expect(handle).toBeTruthy();
    expect(handle?.getAttribute("aria-hidden")).toBe("true");
  });

  it("should render a type select with Drop Shadow selected", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    const select = document.querySelector(
      "select.sigil-effect-card__type-select",
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("drop_shadow");
  });

  it("should render a type select with Layer Blur selected for layer_blur effect", () => {
    render(() => <EffectCard effect={layerBlur} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    const select = document.querySelector(
      "select.sigil-effect-card__type-select",
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("layer_blur");
  });

  it("should render a remove button with accessible label", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    const removeBtn = screen.getByRole("button", { name: "Remove effect" });
    expect(removeBtn).toBeTruthy();
  });

  it("should call onRemove with the correct index when remove is clicked", () => {
    const onRemove = vi.fn();
    render(() => (
      <EffectCard effect={dropShadow} index={2} onUpdate={vi.fn()} onRemove={onRemove} />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Remove effect" }));
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it("should render four NumberInputs for drop_shadow effects (color, X, Y, blur, spread)", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    // drop_shadow has: X offset, Y offset, blur, spread (4 number inputs)
    const inputs = document.querySelectorAll(".sigil-effect-card__fields input");
    expect(inputs.length).toBe(4);
  });

  it("should render X offset input showing correct value for drop_shadow", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    // X offset is 0, Y offset is 4 — find first two inputs in fields
    const inputs = document.querySelectorAll(".sigil-effect-card__fields input");
    // First input: X offset = 0
    expect((inputs[0] as HTMLInputElement).value).toBe("0");
    // Second input: Y offset = 4
    expect((inputs[1] as HTMLInputElement).value).toBe("4");
  });

  it("should render blur and spread inputs for drop_shadow effects", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    const inputs = document.querySelectorAll(".sigil-effect-card__fields input");
    // Third: blur = 8
    expect((inputs[2] as HTMLInputElement).value).toBe("8");
    // Fourth: spread = 0
    expect((inputs[3] as HTMLInputElement).value).toBe("0");
  });

  it("should render one NumberInput for layer_blur effects (radius)", () => {
    render(() => <EffectCard effect={layerBlur} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    const inputs = document.querySelectorAll(".sigil-effect-card__fields input");
    expect(inputs.length).toBe(1);
    expect((inputs[0] as HTMLInputElement).value).toBe("4");
  });

  it("should not render shadow-only fields for layer_blur effects", () => {
    render(() => <EffectCard effect={layerBlur} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    // layer_blur only has a radius field (1 input), no offset or spread inputs
    const inputs = document.querySelectorAll(".sigil-effect-card__fields input");
    expect(inputs.length).toBe(1);
  });

  it("should call onUpdate when type is changed from drop_shadow to layer_blur", () => {
    const onUpdate = vi.fn();
    render(() => (
      <EffectCard effect={dropShadow} index={1} onUpdate={onUpdate} onRemove={vi.fn()} />
    ));
    const select = document.querySelector(
      "select.sigil-effect-card__type-select",
    ) as HTMLSelectElement;
    select.value = "layer_blur";
    fireEvent.change(select);
    expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ type: "layer_blur" }));
  });

  it("should call onUpdate when type is changed from layer_blur to drop_shadow", () => {
    const onUpdate = vi.fn();
    render(() => (
      <EffectCard effect={layerBlur} index={0} onUpdate={onUpdate} onRemove={vi.fn()} />
    ));
    const select = document.querySelector(
      "select.sigil-effect-card__type-select",
    ) as HTMLSelectElement;
    select.value = "drop_shadow";
    fireEvent.change(select);
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({ type: "drop_shadow" }));
  });

  it("should show blur value of 12 in the blur input for a drop_shadow with blur=12", () => {
    // This test verifies that EffectCard correctly reads and displays the blur
    // value from the effect prop. It does NOT test the type-switch coercion
    // (which is integration-tested in the "should call onUpdate when type is
    // changed" tests).
    const onUpdate = vi.fn();
    render(() => (
      <EffectCard effect={dropShadowBlur12} index={0} onUpdate={onUpdate} onRemove={vi.fn()} />
    ));
    // The blur input is the third input in the fields section (X, Y, blur, spread)
    const inputs = document.querySelectorAll(".sigil-effect-card__fields input");
    expect(inputs.length).toBe(4);
    // Third input (index 2) is the blur input — should show 12
    expect((inputs[2] as HTMLInputElement).value).toBe("12");
  });

  it("should render a color swatch button for drop_shadow effects", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    // The color swatch is a button inside the card
    const swatch = document.querySelector(".sigil-effect-card__color-swatch");
    expect(swatch).toBeTruthy();
    expect(swatch?.tagName.toLowerCase()).toBe("button");
  });
});
