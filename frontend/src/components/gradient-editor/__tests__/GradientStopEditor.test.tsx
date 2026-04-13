/**
 * GradientStopEditor tests — verifies stop rendering, keyboard navigation,
 * and ARIA attributes.
 *
 * NOTE: Solid.js uses event delegation for native events (onClick, onKeyDown).
 * The handlers fire correctly, but fireEvent in JSDOM may interact differently
 * with Solid's delegation model for click events. We test keyboard interactions
 * (which are more reliable in test) and verify DOM state directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { GradientStopEditor } from "../GradientStopEditor";
import type { GradientStop } from "../../../types/document";
import { MIN_GRADIENT_STOPS, MAX_GRADIENT_STOPS } from "../gradient-utils";

function makeStop(id: string, position: number, r = 1, g = 0, b = 0): GradientStop {
  return {
    id,
    position,
    color: { type: "literal", value: { space: "srgb", r, g, b, a: 1 } },
  };
}

const defaultStops: GradientStop[] = [
  makeStop("stop-a", 0, 1, 0, 0),
  makeStop("stop-b", 0.5, 0, 1, 0),
  makeStop("stop-c", 1, 0, 0, 1),
];

const defaultGradientCSS = "linear-gradient(90deg, red 0%, green 50%, blue 100%)";

function renderEditor(overrides: Partial<Parameters<typeof GradientStopEditor>[0]> = {}) {
  const onSelectStop = vi.fn();
  const onUpdateStop = vi.fn();
  const onAddStop = vi.fn();
  const onRemoveStop = vi.fn();

  const result = render(() => (
    <GradientStopEditor
      stops={overrides.stops ?? defaultStops}
      selectedStopId={overrides.selectedStopId ?? null}
      onSelectStop={overrides.onSelectStop ?? onSelectStop}
      onUpdateStop={overrides.onUpdateStop ?? onUpdateStop}
      onAddStop={overrides.onAddStop ?? onAddStop}
      onRemoveStop={overrides.onRemoveStop ?? onRemoveStop}
      gradientCSS={overrides.gradientCSS ?? defaultGradientCSS}
    />
  ));

  return { ...result, onSelectStop, onUpdateStop, onAddStop, onRemoveStop };
}

describe("GradientStopEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render all stop markers with role=slider", () => {
    renderEditor();
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(3);
  });

  it("should set aria-valuenow to the stop position percentage", () => {
    renderEditor();
    const sliders = screen.getAllByRole("slider");
    // stop-b is at position 0.5 -> aria-valuenow = 50
    const secondSlider = sliders[1];
    expect(secondSlider?.getAttribute("aria-valuenow")).toBe("50");
  });

  it("should set aria-valuemin and aria-valuemax", () => {
    renderEditor();
    const sliders = screen.getAllByRole("slider");
    const first = sliders[0];
    expect(first?.getAttribute("aria-valuemin")).toBe("0");
    expect(first?.getAttribute("aria-valuemax")).toBe("100");
  });

  it("should set aria-valuetext with percentage", () => {
    renderEditor();
    const sliders = screen.getAllByRole("slider");
    const first = sliders[0];
    expect(first?.getAttribute("aria-valuetext")).toBe("0 percent");
  });

  it("should set data-stop-id on each marker", () => {
    renderEditor();
    const sliders = screen.getAllByRole("slider");
    expect(sliders[0]?.getAttribute("data-stop-id")).toBe("stop-a");
    expect(sliders[1]?.getAttribute("data-stop-id")).toBe("stop-b");
    expect(sliders[2]?.getAttribute("data-stop-id")).toBe("stop-c");
  });

  it("should apply selected class and aria-current to the selected stop", () => {
    renderEditor({ selectedStopId: "stop-b" });
    const sliders = screen.getAllByRole("slider");
    // stop-b is the second rendered stop marker
    const second = sliders[1];
    expect(second?.classList.contains("sigil-gradient-stop-editor__stop--selected")).toBe(true);
    expect(second?.getAttribute("aria-current")).toBe("true");
    // Others should not have selected class
    expect(sliders[0]?.classList.contains("sigil-gradient-stop-editor__stop--selected")).toBe(
      false,
    );
    expect(sliders[2]?.classList.contains("sigil-gradient-stop-editor__stop--selected")).toBe(
      false,
    );
  });

  it("should not apply selected class when no stop is selected", () => {
    renderEditor({ selectedStopId: null });
    const sliders = screen.getAllByRole("slider");
    for (const s of sliders) {
      expect(s.classList.contains("sigil-gradient-stop-editor__stop--selected")).toBe(false);
    }
  });

  it("should call onRemoveStop when Delete key is pressed on a stop with >MIN stops", () => {
    const onRemoveStop = vi.fn();
    renderEditor({ onRemoveStop });
    const sliders = screen.getAllByRole("slider");
    const second = sliders[1];
    if (second) {
      fireEvent.keyDown(second, { key: "Delete" });
    }
    expect(onRemoveStop).toHaveBeenCalledWith("stop-b");
  });

  it("should not call onRemoveStop when at MIN_GRADIENT_STOPS", () => {
    const minStops = [makeStop("s1", 0), makeStop("s2", 1)];
    expect(minStops).toHaveLength(MIN_GRADIENT_STOPS);
    const onRemoveStop = vi.fn();
    renderEditor({ stops: minStops, onRemoveStop });
    const sliders = screen.getAllByRole("slider");
    const first = sliders[0];
    if (first) {
      fireEvent.keyDown(first, { key: "Delete" });
    }
    expect(onRemoveStop).not.toHaveBeenCalled();
  });

  it("should call onUpdateStop with position+0.01 on ArrowRight", () => {
    const onUpdateStop = vi.fn();
    renderEditor({ onUpdateStop });
    const sliders = screen.getAllByRole("slider");
    const second = sliders[1];
    if (second) {
      fireEvent.keyDown(second, { key: "ArrowRight" });
    }
    expect(onUpdateStop).toHaveBeenCalledTimes(1);
    const args = onUpdateStop.mock.calls[0] as [string, number];
    expect(args[0]).toBe("stop-b");
    // 0.5 + 0.01 = 0.51
    expect(args[1]).toBeCloseTo(0.51, 2);
  });

  it("should call onUpdateStop with position-0.01 on ArrowLeft", () => {
    const onUpdateStop = vi.fn();
    renderEditor({ onUpdateStop });
    const sliders = screen.getAllByRole("slider");
    const second = sliders[1];
    if (second) {
      fireEvent.keyDown(second, { key: "ArrowLeft" });
    }
    expect(onUpdateStop).toHaveBeenCalledTimes(1);
    const args = onUpdateStop.mock.calls[0] as [string, number];
    expect(args[0]).toBe("stop-b");
    // 0.5 - 0.01 = 0.49
    expect(args[1]).toBeCloseTo(0.49, 2);
  });

  it("should clamp ArrowLeft at 0 for first stop", () => {
    const onUpdateStop = vi.fn();
    renderEditor({ onUpdateStop });
    const sliders = screen.getAllByRole("slider");
    const first = sliders[0];
    if (first) {
      fireEvent.keyDown(first, { key: "ArrowLeft" });
    }
    expect(onUpdateStop).toHaveBeenCalledTimes(1);
    const args = onUpdateStop.mock.calls[0] as [string, number];
    // 0 - 0.01 clamped to 0
    expect(args[1]).toBe(0);
  });

  it("should clamp ArrowRight at 1 for last stop", () => {
    const onUpdateStop = vi.fn();
    renderEditor({ onUpdateStop });
    const sliders = screen.getAllByRole("slider");
    const last = sliders[2];
    if (last) {
      fireEvent.keyDown(last, { key: "ArrowRight" });
    }
    expect(onUpdateStop).toHaveBeenCalledTimes(1);
    const args = onUpdateStop.mock.calls[0] as [string, number];
    // 1 + 0.01 clamped to 1
    expect(args[1]).toBe(1);
  });

  it("should render the gradient CSS as custom property on bar", () => {
    const { container } = renderEditor({ gradientCSS: "linear-gradient(90deg, red, blue)" });
    const bar = container.querySelector(".sigil-gradient-stop-editor__bar") as HTMLElement;
    expect(bar).not.toBeNull();
    const style = bar.style.getPropertyValue("--gradient-bar-bg");
    expect(style).toBe("linear-gradient(90deg, red, blue)");
  });

  it("test_max_gradient_stops_enforced: should not add stop via Enter when at maximum", () => {
    const maxStops = Array.from({ length: MAX_GRADIENT_STOPS }, (_, i) =>
      makeStop(`s-${String(i)}`, i / (MAX_GRADIENT_STOPS - 1)),
    );
    const onAddStop = vi.fn();
    const { container } = renderEditor({ stops: maxStops, onAddStop });
    const bar = container.querySelector(".sigil-gradient-stop-editor__bar") as HTMLElement;
    expect(bar).not.toBeNull();
    fireEvent.keyDown(bar, { key: "Enter" });
    expect(onAddStop).not.toHaveBeenCalled();
  });

  it("should call onAddStop with 0.5 when Enter is pressed on the bar", () => {
    const onAddStop = vi.fn();
    const { container } = renderEditor({ onAddStop });
    const bar = container.querySelector(".sigil-gradient-stop-editor__bar") as HTMLElement;
    expect(bar).not.toBeNull();
    fireEvent.keyDown(bar, { key: "Enter" });
    expect(onAddStop).toHaveBeenCalledWith(0.5);
  });

  it("should position stops absolutely via left CSS property", () => {
    renderEditor();
    const sliders = screen.getAllByRole("slider");
    // stop-a at 0% -> left: 0%
    expect(sliders[0]?.style.left).toBe("0%");
    // stop-b at 50% -> left: 50%
    expect(sliders[1]?.style.left).toBe("50%");
    // stop-c at 100% -> left: 100%
    expect(sliders[2]?.style.left).toBe("100%");
  });

  describe("drag-off-to-remove", () => {
    it("should not call onRemoveStop when dragged within the bar bounds", () => {
      const onRemoveStop = vi.fn();
      const { container } = renderEditor({ onRemoveStop });
      const bar = container.querySelector(".sigil-gradient-stop-editor__bar") as HTMLElement;

      // Mock getBoundingClientRect for the bar — bar is at y=100, height=20
      vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 100,
        width: 200,
        height: 20,
        top: 100,
        right: 200,
        bottom: 120,
        left: 0,
        toJSON: () => ({}),
      });

      const sliders = screen.getAllByRole("slider");
      const second = sliders[1];
      if (!second) throw new Error("slider not found");

      // Mock setPointerCapture and releasePointerCapture
      // JSDOM does not define setPointerCapture/releasePointerCapture
      second.setPointerCapture = vi.fn();
      second.releasePointerCapture = vi.fn();

      // Start drag at bar center (y=110)
      fireEvent.pointerDown(second, {
        clientX: 100,
        clientY: 110,
        pointerId: 1,
      });

      // Move within threshold (y=125, distance from bar center 110 = 15 < 30)
      fireEvent.pointerMove(second, {
        clientX: 120,
        clientY: 125,
        pointerId: 1,
      });

      // Release
      fireEvent.pointerUp(second, {
        clientX: 120,
        clientY: 125,
        pointerId: 1,
      });

      expect(onRemoveStop).not.toHaveBeenCalled();
    });

    it("should call onRemoveStop when stop is dragged beyond the threshold", () => {
      const onRemoveStop = vi.fn();
      const { container } = renderEditor({ onRemoveStop });
      const bar = container.querySelector(".sigil-gradient-stop-editor__bar") as HTMLElement;

      // Mock getBoundingClientRect — bar center Y = 110
      vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 100,
        width: 200,
        height: 20,
        top: 100,
        right: 200,
        bottom: 120,
        left: 0,
        toJSON: () => ({}),
      });

      const sliders = screen.getAllByRole("slider");
      const second = sliders[1];
      if (!second) throw new Error("slider not found");

      // JSDOM does not define setPointerCapture/releasePointerCapture
      second.setPointerCapture = vi.fn();
      second.releasePointerCapture = vi.fn();

      // Start drag
      fireEvent.pointerDown(second, {
        clientX: 100,
        clientY: 110,
        pointerId: 1,
      });

      // Move beyond threshold (y=150, distance from bar center 110 = 40 > 30)
      fireEvent.pointerMove(second, {
        clientX: 120,
        clientY: 150,
        pointerId: 1,
      });

      // Release while still beyond threshold
      fireEvent.pointerUp(second, {
        clientX: 120,
        clientY: 150,
        pointerId: 1,
      });

      expect(onRemoveStop).toHaveBeenCalledWith("stop-b");
    });

    it("should not call onRemoveStop via drag-off when at MIN_GRADIENT_STOPS", () => {
      const minStops = [makeStop("s1", 0), makeStop("s2", 1)];
      const onRemoveStop = vi.fn();
      const { container } = renderEditor({ stops: minStops, onRemoveStop });
      const bar = container.querySelector(".sigil-gradient-stop-editor__bar") as HTMLElement;

      vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 100,
        width: 200,
        height: 20,
        top: 100,
        right: 200,
        bottom: 120,
        left: 0,
        toJSON: () => ({}),
      });

      const sliders = screen.getAllByRole("slider");
      const first = sliders[0];
      if (!first) throw new Error("slider not found");

      // JSDOM does not define setPointerCapture/releasePointerCapture
      first.setPointerCapture = vi.fn();
      first.releasePointerCapture = vi.fn();

      // Start drag
      fireEvent.pointerDown(first, {
        clientX: 0,
        clientY: 110,
        pointerId: 1,
      });

      // Move far beyond threshold
      fireEvent.pointerMove(first, {
        clientX: 0,
        clientY: 200,
        pointerId: 1,
      });

      // Release
      fireEvent.pointerUp(first, {
        clientX: 0,
        clientY: 200,
        pointerId: 1,
      });

      expect(onRemoveStop).not.toHaveBeenCalled();
    });

    it("should apply removing class when dragged beyond threshold", () => {
      const { container } = renderEditor();
      const bar = container.querySelector(".sigil-gradient-stop-editor__bar") as HTMLElement;

      vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 100,
        width: 200,
        height: 20,
        top: 100,
        right: 200,
        bottom: 120,
        left: 0,
        toJSON: () => ({}),
      });

      const sliders = screen.getAllByRole("slider");
      const second = sliders[1];
      if (!second) throw new Error("slider not found");

      // JSDOM does not define setPointerCapture
      second.setPointerCapture = vi.fn();

      fireEvent.pointerDown(second, {
        clientX: 100,
        clientY: 110,
        pointerId: 1,
      });

      // Move beyond threshold
      fireEvent.pointerMove(second, {
        clientX: 120,
        clientY: 150,
        pointerId: 1,
      });

      expect(second.classList.contains("sigil-gradient-stop-editor__stop--removing")).toBe(true);
    });
  });
});
