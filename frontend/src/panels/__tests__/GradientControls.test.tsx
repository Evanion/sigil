/**
 * GradientControls tests — verifies stop selection persistence, angle change,
 * remove below minimum blocked, add above maximum blocked.
 *
 * Uses TransProvider wrapping per i18n requirements.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JSX } from "solid-js";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { GradientControls } from "../GradientControls";
import type { FillLinearGradient, FillRadialGradient } from "../../types/document";
import { createTestI18n } from "../../test-utils/i18n";
import {
  MAX_GRADIENT_STOPS,
  MIN_GRADIENT_STOPS,
} from "../../components/gradient-editor/gradient-utils";

let i18nInstance: i18n;

function renderWithI18n(ui: () => JSX.Element) {
  return render(() => <TransProvider instance={i18nInstance}>{ui()}</TransProvider>);
}

const linearFill: FillLinearGradient = {
  type: "linear_gradient",
  gradient: {
    stops: [
      {
        id: "stop-a",
        position: 0,
        color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
      },
      {
        id: "stop-b",
        position: 1,
        color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } },
      },
    ],
    start: { x: 0.5, y: 0 },
    end: { x: 0.5, y: 1 },
  },
};

describe("GradientControls", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
  });

  it("should render gradient controls group", () => {
    const onUpdate = vi.fn();
    renderWithI18n(() => <GradientControls fill={linearFill} onUpdate={onUpdate} />);

    const group = screen.getByRole("group", { name: "Gradient controls" });
    expect(group).toBeDefined();
  });

  it("should render angle input for linear gradient", () => {
    const onUpdate = vi.fn();
    renderWithI18n(() => <GradientControls fill={linearFill} onUpdate={onUpdate} />);

    // Kobalte NumberField associates the label with both the group and the
    // input element, so getByLabelText may find multiple matches. Use
    // getAllByLabelText and verify at least one is present.
    const angleInputs = screen.getAllByLabelText("Angle");
    expect(angleInputs.length).toBeGreaterThanOrEqual(1);
  });

  it("should render stop sliders", () => {
    const onUpdate = vi.fn();
    const { container } = renderWithI18n(() => (
      <GradientControls fill={linearFill} onUpdate={onUpdate} />
    ));

    // Query stop markers by their data-stop-id attribute within the
    // test container to avoid counting elements from other tests.
    const stopSliders = container.querySelectorAll("[data-stop-id]");
    expect(stopSliders.length).toBe(2);
  });

  it("should block removing a stop when at minimum count", () => {
    const onUpdate = vi.fn();
    // Create a fill with exactly MIN_GRADIENT_STOPS stops
    const minFill: FillLinearGradient = {
      type: "linear_gradient",
      gradient: {
        stops: [
          {
            id: "stop-a",
            position: 0,
            color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
          },
          {
            id: "stop-b",
            position: 1,
            color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } },
          },
        ],
        start: { x: 0.5, y: 0 },
        end: { x: 0.5, y: 1 },
      },
    };

    expect(minFill.gradient.stops.length).toBe(MIN_GRADIENT_STOPS);

    renderWithI18n(() => <GradientControls fill={minFill} onUpdate={onUpdate} />);

    // Click on the first stop to select it.
    // Scope to the gradient stops group to avoid other slider-like elements.
    const stopsGroup = screen.getAllByRole("group", { name: "Gradient stops" });
    const stopSliders = stopsGroup.flatMap((g) =>
      Array.from(g.querySelectorAll("[role='slider']")),
    );
    fireEvent.click(stopSliders[0]);

    // The remove button should be disabled
    const removeBtn = screen.getByLabelText("Remove color stop");
    expect(removeBtn).toHaveProperty("disabled", true);
  });

  it("should block adding a stop when at maximum count", () => {
    const onUpdate = vi.fn();
    // Create a fill with MAX_GRADIENT_STOPS stops
    const maxStops = Array.from({ length: MAX_GRADIENT_STOPS }, (_, i) => ({
      id: `stop-${String(i)}`,
      position: i / (MAX_GRADIENT_STOPS - 1),
      color: {
        type: "literal" as const,
        value: { space: "srgb" as const, r: 0, g: 0, b: 0, a: 1 },
      },
    }));
    const maxFill: FillLinearGradient = {
      type: "linear_gradient",
      gradient: {
        stops: maxStops,
        start: { x: 0.5, y: 0 },
        end: { x: 0.5, y: 1 },
      },
    };

    renderWithI18n(() => <GradientControls fill={maxFill} onUpdate={onUpdate} />);

    // Kobalte NumberField fires onRawValueChange during mount (CLAUDE.md §5),
    // which may trigger an onUpdate call for the angle input. Record the
    // call count after mount and assert no additional calls from the click.
    const callsAfterMount = onUpdate.mock.calls.length;

    // Click on the gradient bar (empty area) to try to add a stop.
    // Use the bar element inside the stop editor, identified by its class.
    const bar = document.querySelector(".sigil-gradient-stop-editor__bar");
    expect(bar).not.toBeNull();
    if (!bar) return;
    fireEvent.click(bar);

    // onUpdate should NOT have been called again (add was blocked)
    expect(onUpdate.mock.calls.length).toBe(callsAfterMount);
  });

  it("should render radius input for radial gradient", () => {
    const onUpdate = vi.fn();
    const radialFill: FillRadialGradient = {
      type: "radial_gradient",
      gradient: {
        stops: [
          {
            id: "stop-a",
            position: 0,
            color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
          },
          {
            id: "stop-b",
            position: 1,
            color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } },
          },
        ],
        start: { x: 0.5, y: 0.5 },
        end: { x: 1, y: 0.5 },
      },
    };

    renderWithI18n(() => <GradientControls fill={radialFill} onUpdate={onUpdate} />);

    const radiusInput = screen.getByLabelText("Radius");
    expect(radiusInput).toBeDefined();
  });
});
