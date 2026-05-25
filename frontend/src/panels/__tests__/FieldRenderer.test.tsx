/**
 * @vitest-environment jsdom
 *
 * FieldRenderer regression tests for the slider field type.
 *
 * Plan 14b Task 9 replaced the placeholder `<input type="range">` with the
 * project-owned `<Slider>` wrapper (around `@kobalte/core/slider`). These
 * tests pin the wiring so a future change cannot silently regress back to a
 * raw range input.
 *
 * Note: Kobalte's Slider renders TWO elements with role=slider — the visible
 * thumb (`span[role="slider"]`) and a hidden `<input type="range">` used for
 * form integration. The wrapper's identifying signal is the `.sigil-slider`
 * class on its root, which the raw `<input type="range">` placeholder never
 * had.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { FieldRenderer } from "../FieldRenderer";

describe("FieldRenderer", () => {
  afterEach(() => cleanup());

  it("should render slider field type using the Slider wrapper (role=slider)", () => {
    const field = {
      key: "test.smoothing",
      label: "Smoothing",
      type: "slider" as const,
      min: 0,
      max: 1,
      step: 0.01,
    };
    const { container } = render(() => (
      <FieldRenderer field={field} value={0.5} onChange={() => {}} />
    ));
    // The wrapper publishes role=slider on both the thumb and the hidden
    // form-integration input. We assert at least one is present and that the
    // visible thumb carries aria-valuenow reflecting the current value.
    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);
    const thumb = container.querySelector('span[role="slider"]');
    expect(thumb).toBeTruthy();
    expect(thumb?.getAttribute("aria-valuenow")).toBe("0.5");
  });

  it("should NOT render slider field as a raw <input type=range> placeholder", () => {
    // The pre-14b placeholder rendered `<input type="range">` directly as the
    // visible affordance. The wrapper renders a `.sigil-slider` root with a
    // span thumb; Kobalte's hidden <input type="range"> still exists for form
    // integration, but the identifying signal of "we use the wrapper" is the
    // `.sigil-slider` class — the placeholder never had one.
    const field = {
      key: "test.smoothing",
      label: "Smoothing",
      type: "slider" as const,
      min: 0,
      max: 1,
    };
    const { container } = render(() => (
      <FieldRenderer field={field} value={0.5} onChange={() => {}} />
    ));
    const wrapperRoot = container.querySelector(".sigil-slider");
    expect(wrapperRoot).toBeTruthy();
  });
});
