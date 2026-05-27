/**
 * @vitest-environment jsdom
 *
 * ColorArea accessibility tests — RF-011.
 *
 * The 2D color-picker widget exposes two independent axes (X and Y), so
 * per `.claude/rules/a11y-rules.md` "2D Canvas Widgets Must Have Complete
 * ARIA Slider Semantics" it MUST expose two complementary ARIA slider
 * widgets — one per axis — rather than a single slider with only the X
 * value in aria-valuenow. Both sliders must carry the full ARIA slider
 * attribute set, and arrow-key navigation must affect only the axis the
 * focused slider controls.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { ColorArea } from "../ColorArea";

// JSDOM doesn't implement ResizeObserver; ColorArea constructs one in onMount.
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function mockMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function noopRender(): void {}

describe("ColorArea — dual ARIA slider semantics (RF-011)", () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
      MockResizeObserver;
    mockMatchMedia();
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes two role=slider widgets — one per axis", () => {
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.75}
        onChange={() => {}}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));
    const sliders = container.querySelectorAll('[role="slider"]');
    expect(sliders.length).toBe(2);
  });

  it("each slider has the full ARIA attribute set", () => {
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.75}
        onChange={() => {}}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const xSlider = container.querySelector('[role="slider"][aria-label*="Saturation"]');
    expect(xSlider).not.toBeNull();
    expect(xSlider?.getAttribute("aria-valuenow")).toBe("50");
    expect(xSlider?.getAttribute("aria-valuemin")).toBe("0");
    expect(xSlider?.getAttribute("aria-valuemax")).toBe("100");
    expect(xSlider?.getAttribute("aria-valuetext")).toContain("Saturation");
    expect(xSlider?.getAttribute("aria-valuetext")).toContain("50");

    const ySlider = container.querySelector('[role="slider"][aria-label*="Brightness"]');
    expect(ySlider).not.toBeNull();
    expect(ySlider?.getAttribute("aria-valuenow")).toBe("75");
    expect(ySlider?.getAttribute("aria-valuemin")).toBe("0");
    expect(ySlider?.getAttribute("aria-valuemax")).toBe("100");
    expect(ySlider?.getAttribute("aria-valuetext")).toContain("Brightness");
    expect(ySlider?.getAttribute("aria-valuetext")).toContain("75");
  });

  it("each slider is keyboard-focusable via tabindex=0", () => {
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={() => {}}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));
    const sliders = container.querySelectorAll('[role="slider"]');
    for (const slider of Array.from(sliders)) {
      expect(slider.getAttribute("tabindex")).toBe("0");
    }
  });

  it("ArrowRight on the X slider increments x only", () => {
    const handler = vi.fn();
    const [xValue, _setX] = createSignal(0.5);
    const [yValue, _setY] = createSignal(0.5);

    const { container } = render(() => (
      <ColorArea
        xValue={xValue()}
        yValue={yValue()}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const xSlider = container.querySelector(
      '[role="slider"][aria-label*="Saturation"]',
    ) as HTMLElement;
    expect(xSlider).not.toBeNull();
    xSlider.focus();
    fireEvent.keyDown(xSlider, { key: "ArrowRight" });

    expect(handler).toHaveBeenCalledTimes(1);
    const args = handler.mock.calls[0];
    expect(args).toBeDefined();
    if (!args) return;
    expect(args[0]).toBeGreaterThan(0.5);
    expect(args[1]).toBe(0.5);
  });

  it("ArrowLeft on the X slider decrements x only", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const xSlider = container.querySelector(
      '[role="slider"][aria-label*="Saturation"]',
    ) as HTMLElement;
    xSlider.focus();
    fireEvent.keyDown(xSlider, { key: "ArrowLeft" });

    expect(handler).toHaveBeenCalledTimes(1);
    const args = handler.mock.calls[0];
    if (!args) return;
    expect(args[0]).toBeLessThan(0.5);
    expect(args[1]).toBe(0.5);
  });

  it("ArrowUp on the Y slider increments y only", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const ySlider = container.querySelector(
      '[role="slider"][aria-label*="Brightness"]',
    ) as HTMLElement;
    ySlider.focus();
    fireEvent.keyDown(ySlider, { key: "ArrowUp" });

    expect(handler).toHaveBeenCalledTimes(1);
    const args = handler.mock.calls[0];
    if (!args) return;
    expect(args[0]).toBe(0.5);
    expect(args[1]).toBeGreaterThan(0.5);
  });

  it("ArrowDown on the Y slider decrements y only", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const ySlider = container.querySelector(
      '[role="slider"][aria-label*="Brightness"]',
    ) as HTMLElement;
    ySlider.focus();
    fireEvent.keyDown(ySlider, { key: "ArrowDown" });

    expect(handler).toHaveBeenCalledTimes(1);
    const args = handler.mock.calls[0];
    if (!args) return;
    expect(args[0]).toBe(0.5);
    expect(args[1]).toBeLessThan(0.5);
  });

  it("ArrowUp/Down on the X slider does NOT change either axis", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const xSlider = container.querySelector(
      '[role="slider"][aria-label*="Saturation"]',
    ) as HTMLElement;
    xSlider.focus();
    fireEvent.keyDown(xSlider, { key: "ArrowUp" });
    fireEvent.keyDown(xSlider, { key: "ArrowDown" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("ArrowLeft/Right on the Y slider does NOT change either axis", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const ySlider = container.querySelector(
      '[role="slider"][aria-label*="Brightness"]',
    ) as HTMLElement;
    ySlider.focus();
    fireEvent.keyDown(ySlider, { key: "ArrowLeft" });
    fireEvent.keyDown(ySlider, { key: "ArrowRight" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("Home/End jumps to 0/1 on the X slider", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const xSlider = container.querySelector(
      '[role="slider"][aria-label*="Saturation"]',
    ) as HTMLElement;
    xSlider.focus();
    fireEvent.keyDown(xSlider, { key: "Home" });
    expect(handler).toHaveBeenLastCalledWith(0, 0.5);

    fireEvent.keyDown(xSlider, { key: "End" });
    expect(handler).toHaveBeenLastCalledWith(1, 0.5);
  });

  it("Home/End jumps to 0/1 on the Y slider", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const ySlider = container.querySelector(
      '[role="slider"][aria-label*="Brightness"]',
    ) as HTMLElement;
    ySlider.focus();
    fireEvent.keyDown(ySlider, { key: "Home" });
    expect(handler).toHaveBeenLastCalledWith(0.5, 0);

    fireEvent.keyDown(ySlider, { key: "End" });
    expect(handler).toHaveBeenLastCalledWith(0.5, 1);
  });

  it("defaults axis labels to non-empty strings when not provided", () => {
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={() => {}}
        renderBackground={noopRender}
        aria-label="Color"
      />
    ));

    const sliders = container.querySelectorAll('[role="slider"]');
    expect(sliders.length).toBe(2);
    for (const slider of Array.from(sliders)) {
      const label = slider.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label?.length).toBeGreaterThan(0);
    }
  });

  it("aria-label on the outer container provides the group label", () => {
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={() => {}}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute("aria-label")).toBe("Color");
  });

  it("pointer drag on the visible canvas still updates both axes", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <ColorArea
        xValue={0.5}
        yValue={0.5}
        onChange={handler}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const area = container.querySelector(".sigil-color-area") as HTMLElement;
    expect(area).not.toBeNull();

    // JSDOM doesn't implement setPointerCapture/releasePointerCapture.
    area.setPointerCapture = vi.fn();
    area.releasePointerCapture = vi.fn();

    vi.spyOn(area, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      top: 0,
      right: 240,
      bottom: 160,
      left: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(area, { clientX: 60, clientY: 40, pointerId: 1 });
    expect(handler).toHaveBeenCalled();
    const args = handler.mock.calls[0];
    if (!args) return;
    // x = 60/240 = 0.25, y = 1 - 40/160 = 0.75
    expect(args[0]).toBeCloseTo(0.25, 2);
    expect(args[1]).toBeCloseTo(0.75, 2);
  });

  it("updates aria-valuenow on both sliders as values change", () => {
    const [xValue, setX] = createSignal(0.1);
    const [yValue, setY] = createSignal(0.2);

    const { container } = render(() => (
      <ColorArea
        xValue={xValue()}
        yValue={yValue()}
        onChange={() => {}}
        renderBackground={noopRender}
        aria-label="Color"
        xAxisLabel="Saturation"
        yAxisLabel="Brightness"
      />
    ));

    const xSlider = container.querySelector('[role="slider"][aria-label*="Saturation"]');
    const ySlider = container.querySelector('[role="slider"][aria-label*="Brightness"]');
    expect(xSlider?.getAttribute("aria-valuenow")).toBe("10");
    expect(ySlider?.getAttribute("aria-valuenow")).toBe("20");

    setX(0.9);
    setY(0.4);

    expect(xSlider?.getAttribute("aria-valuenow")).toBe("90");
    expect(ySlider?.getAttribute("aria-valuenow")).toBe("40");
  });
});
