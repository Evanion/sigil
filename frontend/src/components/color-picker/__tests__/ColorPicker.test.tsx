/**
 * ColorPicker regression tests.
 *
 * RF-003 (Critical): onColorCommit must only fire on discrete gesture-end
 * events (pointerup on strips/area, blur/Enter on hex, change on
 * ColorValueFields) — NOT on every `props.color` update. The parent writes
 * the live color into its store during drag, which re-flows into
 * `props.color`; if the prop-sync effect called the full commit path, every
 * drag tick would create a new undo entry.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { ColorPicker } from "../ColorPicker";
import type { Color } from "../../../types/document";

// JSDOM doesn't implement ResizeObserver; the color-picker children
// (ColorArea, HueStrip, AlphaStrip) construct one in onMount.
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// JSDOM doesn't implement matchMedia; the strips register a listener for
// devicePixelRatio changes.
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

function makeColor(r: number, g: number, b: number, a = 1): Color {
  return { space: "srgb", r, g, b, a };
}

describe("ColorPicker", () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
      MockResizeObserver;
    mockMatchMedia();
  });

  afterEach(() => {
    cleanup();
  });

  describe("RF-003: onColorCommit must not fire during drag prop updates", () => {
    it("should NOT call onColorCommit when props.color updates multiple times (simulated drag ticks)", async () => {
      const onColorChange = vi.fn();
      const onColorCommit = vi.fn();
      const [color, setColor] = createSignal<Color>(makeColor(1, 0, 0));

      render(() => (
        <ColorPicker color={color()} onColorChange={onColorChange} onColorCommit={onColorCommit} />
      ));

      // Let mount guard elapse (queueMicrotask in ColorPicker flips `mounted`).
      await Promise.resolve();

      // Simulate 10 drag ticks — parent writes live color into its store
      // during drag, which flows back into props.color.
      for (let i = 0; i < 10; i += 1) {
        setColor(makeColor(1 - i * 0.05, i * 0.05, 0));
        // Allow Solid's scheduler to flush the prop-sync effect.
        await Promise.resolve();
      }

      // RF-003: commit must not fire for prop-driven updates.
      expect(onColorCommit).not.toHaveBeenCalled();
    });

    it("should call onColorCommit exactly once on ColorArea pointerup", async () => {
      const onColorChange = vi.fn();
      const onColorCommit = vi.fn();
      const [color, setColor] = createSignal<Color>(makeColor(1, 0, 0));

      const { container } = render(() => (
        <ColorPicker color={color()} onColorChange={onColorChange} onColorCommit={onColorCommit} />
      ));

      await Promise.resolve();

      const colorArea = container.querySelector<HTMLElement>(".sigil-color-area");
      if (!colorArea) throw new Error("ColorArea container not found");

      // JSDOM doesn't implement setPointerCapture/releasePointerCapture.
      colorArea.setPointerCapture = vi.fn();
      colorArea.releasePointerCapture = vi.fn();

      // Mock getBoundingClientRect so pointer->normalized math succeeds.
      vi.spyOn(colorArea, "getBoundingClientRect").mockReturnValue({
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

      // Simulate a drag gesture: pointerdown, several moves (flooding
      // props.color via onColorChange → parent → back into props), then
      // pointerup which is the discrete commit point.
      fireEvent.pointerDown(colorArea, { clientX: 100, clientY: 80, pointerId: 1 });
      await Promise.resolve();

      for (let i = 0; i < 5; i += 1) {
        fireEvent.pointerMove(colorArea, {
          clientX: 100 + i * 10,
          clientY: 80,
          pointerId: 1,
        });
        // Simulate the parent reflecting the color change back into props.
        setColor(makeColor(0.5 + i * 0.05, 0.2, 0.1));
        await Promise.resolve();
      }

      // Before pointerup: commit must not have fired for any of the moves
      // or prop updates.
      expect(onColorCommit).not.toHaveBeenCalled();

      // Discrete commit point — pointerup.
      fireEvent.pointerUp(colorArea, { clientX: 140, clientY: 80, pointerId: 1 });
      await Promise.resolve();

      // RF-003: exactly one commit per gesture, regardless of how many
      // drag ticks happened.
      expect(onColorCommit).toHaveBeenCalledTimes(1);
    });

    it("should call onColorCommit exactly once on HueStrip pointerup", async () => {
      const onColorChange = vi.fn();
      const onColorCommit = vi.fn();
      const [color, setColor] = createSignal<Color>(makeColor(1, 0, 0));

      const { container } = render(() => (
        <ColorPicker color={color()} onColorChange={onColorChange} onColorCommit={onColorCommit} />
      ));

      await Promise.resolve();

      // First .sigil-strip (non-alpha) is the HueStrip.
      const strips = container.querySelectorAll<HTMLElement>(".sigil-strip");
      const hueStrip = Array.from(strips).find((s) => !s.classList.contains("sigil-strip--alpha"));
      if (!hueStrip) throw new Error("HueStrip not found");

      hueStrip.setPointerCapture = vi.fn();
      hueStrip.releasePointerCapture = vi.fn();

      vi.spyOn(hueStrip, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        width: 240,
        height: 14,
        top: 0,
        right: 240,
        bottom: 14,
        left: 0,
        toJSON: () => ({}),
      });

      fireEvent.pointerDown(hueStrip, { clientX: 60, clientY: 7, pointerId: 2 });
      await Promise.resolve();

      for (let i = 0; i < 5; i += 1) {
        fireEvent.pointerMove(hueStrip, {
          clientX: 60 + i * 20,
          clientY: 7,
          pointerId: 2,
        });
        setColor(makeColor(0.3 + i * 0.1, 0.2, 0.1));
        await Promise.resolve();
      }

      expect(onColorCommit).not.toHaveBeenCalled();

      fireEvent.pointerUp(hueStrip, { clientX: 160, clientY: 7, pointerId: 2 });
      await Promise.resolve();

      expect(onColorCommit).toHaveBeenCalledTimes(1);
    });

    it("should call onColorCommit exactly once on AlphaStrip pointerup", async () => {
      const onColorChange = vi.fn();
      const onColorCommit = vi.fn();
      const [color, setColor] = createSignal<Color>(makeColor(1, 0, 0, 1));

      const { container } = render(() => (
        <ColorPicker color={color()} onColorChange={onColorChange} onColorCommit={onColorCommit} />
      ));

      await Promise.resolve();

      const alphaStrip = container.querySelector<HTMLElement>(".sigil-strip--alpha");
      if (!alphaStrip) throw new Error("AlphaStrip not found");

      alphaStrip.setPointerCapture = vi.fn();
      alphaStrip.releasePointerCapture = vi.fn();

      vi.spyOn(alphaStrip, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        width: 240,
        height: 14,
        top: 0,
        right: 240,
        bottom: 14,
        left: 0,
        toJSON: () => ({}),
      });

      fireEvent.pointerDown(alphaStrip, { clientX: 100, clientY: 7, pointerId: 3 });
      await Promise.resolve();

      for (let i = 0; i < 5; i += 1) {
        fireEvent.pointerMove(alphaStrip, {
          clientX: 100 + i * 10,
          clientY: 7,
          pointerId: 3,
        });
        setColor(makeColor(1, 0, 0, 1 - i * 0.1));
        await Promise.resolve();
      }

      expect(onColorCommit).not.toHaveBeenCalled();

      fireEvent.pointerUp(alphaStrip, { clientX: 150, clientY: 7, pointerId: 3 });
      await Promise.resolve();

      expect(onColorCommit).toHaveBeenCalledTimes(1);
    });

    it("should render the initial props.color synchronously in ColorValueFields (RF-D04)", async () => {
      // RF-D04: The synchronous-init path in ColorPicker exists to defeat a
      // Kobalte `createControllableSignal` mount-time capture bug that
      // otherwise leaves NumberInput display text stuck at 0 forever. If the
      // init order regresses (e.g. children re-render before state is
      // populated), this test catches it: the R/G/B spinbuttons must show
      // 13, 153, 255 at first paint without any user interaction or prop
      // update.
      const onColorChange = vi.fn();
      const { container } = render(() => (
        <ColorPicker
          color={makeColor(13 / 255, 153 / 255, 255 / 255)}
          onColorChange={onColorChange}
        />
      ));

      // The sync-init guarantee is that children render correct values on
      // the very first render, synchronously. No microtask / tick flushes
      // should be needed to observe the seeded values.
      const spinButtons = container.querySelectorAll<HTMLElement>('[role="spinbutton"]');
      // 4 spinbuttons: R, G, B, A
      expect(spinButtons.length).toBeGreaterThanOrEqual(4);
      const [rInput, gInput, bInput] = Array.from(spinButtons);
      // Kobalte's NumberField renders its raw value into the input's
      // `textContent` / `value`. Read both in case the primitive changes.
      const readValue = (el: HTMLElement | undefined): string => {
        if (!el) return "";
        if (el instanceof HTMLInputElement) return el.value;
        return (el.textContent ?? "").trim();
      };
      expect(readValue(rInput)).toBe("13");
      expect(readValue(gInput)).toBe("153");
      expect(readValue(bInput)).toBe("255");
    });

    it("should still fire onColorCommit when a user increments a NumberInput (echo gate must not block real edits)", async () => {
      const onColorChange = vi.fn();
      const onColorCommit = vi.fn();
      const [color, setColor] = createSignal<Color>(makeColor(100 / 255, 100 / 255, 100 / 255));

      const { container } = render(() => (
        <ColorPicker color={color()} onColorChange={onColorChange} onColorCommit={onColorCommit} />
      ));

      // Allow mount + initial prop-echo to settle.
      await Promise.resolve();
      await Promise.resolve();
      onColorCommit.mockClear();

      // Kobalte renders its increment button with aria-label "Increment".
      // There are 4 fields (R, G, B, A) — click the first Increment (R).
      const incrementButtons = container.querySelectorAll<HTMLElement>(
        'button[aria-label="Increment"]',
      );
      if (incrementButtons.length < 1) throw new Error("No Increment buttons rendered");

      // Simulate user incrementing R by 1 unit. Kobalte will fire
      // onRawValueChange with the new value (101), which flows through
      // ColorValueFields.handleChange → handleFieldsChange. The echo gate
      // must detect this as a real edit (1/255 > CHANNEL_ECHO_TOLERANCE)
      // and fire commitColor() once.
      const rIncrement = incrementButtons[0];
      if (!rIncrement) throw new Error("R increment button not found");
      fireEvent.click(rIncrement);
      await Promise.resolve();

      // Simulate the parent echoing the new color back (which happens in
      // production via the onColorChange → store → props pipeline).
      setColor(makeColor(101 / 255, 100 / 255, 100 / 255));
      await Promise.resolve();

      expect(onColorCommit).toHaveBeenCalledTimes(1);
    });
  });
});
