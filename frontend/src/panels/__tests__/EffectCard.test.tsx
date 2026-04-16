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

  it("should render four ValueInputs for drop_shadow effects (X, Y, blur, spread)", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    // drop_shadow has: X offset, Y offset, blur, spread (4 numeric ValueInputs,
    // plus a color ValueInput in the color row)
    const numericFields = document
      .querySelector(".sigil-effect-card__fields")
      ?.querySelectorAll("[role='combobox']");
    // 1 color + 4 numeric = 5 comboboxes inside the fields container
    expect(numericFields?.length).toBe(5);
  });

  it("should render X offset ValueInput showing correct value for drop_shadow", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    // X = 0, Y = 4
    const xInput = screen.getByRole("combobox", { name: "X offset" });
    const yInput = screen.getByRole("combobox", { name: "Y offset" });
    expect(xInput.textContent).toContain("0");
    expect(yInput.textContent).toContain("4");
  });

  it("should render blur and spread ValueInputs for drop_shadow effects", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    const blur = screen.getByRole("combobox", { name: "Blur" });
    const spread = screen.getByRole("combobox", { name: "Spread" });
    expect(blur.textContent).toContain("8");
    expect(spread.textContent).toContain("0");
  });

  it("should render one ValueInput for layer_blur effects (radius)", () => {
    render(() => <EffectCard effect={layerBlur} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    const radius = screen.getByRole("combobox", { name: "Radius" });
    expect(radius.textContent).toContain("4");
  });

  it("should not render shadow-only fields for layer_blur effects", () => {
    render(() => <EffectCard effect={layerBlur} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    // layer_blur only exposes radius — no offset, blur, or spread comboboxes.
    expect(screen.queryByRole("combobox", { name: "X offset" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Y offset" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Blur" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Spread" })).toBeNull();
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
    const onUpdate = vi.fn();
    render(() => (
      <EffectCard effect={dropShadowBlur12} index={0} onUpdate={onUpdate} onRemove={vi.fn()} />
    ));
    const blur = screen.getByRole("combobox", { name: "Blur" });
    expect(blur.textContent).toContain("12");
  });

  it("should render a Shadow color ValueInput with swatch trigger for drop_shadow effects", () => {
    render(() => (
      <EffectCard effect={dropShadow} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    ));
    const combobox = screen.getByRole("combobox", { name: "Shadow color" });
    expect(combobox).toBeTruthy();
    const swatchBtn = document.querySelector(".sigil-token-input__swatch-btn");
    expect(swatchBtn).toBeTruthy();
  });

  // ── flushHistory wiring via onCommit prop ────────────────────────────

  it("should invoke onCommit when the shadow color ValueInput commits via Enter", () => {
    const onCommit = vi.fn();
    render(() => (
      <EffectCard
        effect={dropShadow}
        index={0}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onCommit={onCommit}
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Shadow color" });
    // ValueInput fires onCommit on Enter — EffectCard forwards to props.onCommit
    // so EffectsPanel can call store.flushHistory().
    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onCommit).toHaveBeenCalled();
  });

  it("should invoke onCommit when the blur ValueInput commits via Enter", () => {
    const onCommit = vi.fn();
    render(() => (
      <EffectCard
        effect={dropShadow}
        index={0}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onCommit={onCommit}
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Blur" });
    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onCommit).toHaveBeenCalled();
  });

  it("should invoke onCommit when the radius ValueInput commits via Enter", () => {
    const onCommit = vi.fn();
    render(() => (
      <EffectCard
        effect={layerBlur}
        index={0}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onCommit={onCommit}
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Radius" });
    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onCommit).toHaveBeenCalled();
  });
});
