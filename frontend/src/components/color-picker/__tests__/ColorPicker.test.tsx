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
import type { JSX } from "solid-js";
import { cleanup, fireEvent } from "@solidjs/testing-library";
import type { i18n } from "i18next";
import { createSignal } from "solid-js";
import { ColorPicker } from "../ColorPicker";
import { ColorValueFields } from "../ColorValueFields";
import type { Color } from "../../../types/document";
import { createTestI18n, renderWithI18n as renderWithI18nShared } from "../../../test-utils/i18n";

let i18nInstance: i18n;

const renderWithI18n = (ui: () => JSX.Element) => renderWithI18nShared(ui, i18nInstance);

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
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
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

      renderWithI18n(() => (
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

      const { container } = renderWithI18n(() => (
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

      const { container } = renderWithI18n(() => (
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

      const { container } = renderWithI18n(() => (
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
      const { container } = renderWithI18n(() => (
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

      const { container } = renderWithI18n(() => (
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

describe("ColorPicker emit storage tag (Spec 18)", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
      MockResizeObserver;
    mockMatchMedia();
  });

  afterEach(() => {
    cleanup();
  });

  it("emits Color::DisplayP3 after the user switches to P3 mode", async () => {
    const emissions: Color[] = [];

    const { container } = renderWithI18n(() => (
      <ColorPicker
        color={{ space: "srgb", r: 1, g: 0, b: 0, a: 1 }}
        onColorChange={(c) => {
          emissions.push(c);
        }}
      />
    ));

    // Allow mount guard to elapse (queueMicrotask in ColorPicker flips
    // `mounted = true`).
    await Promise.resolve();

    // Find the P3 radio button in the switcher and click it.
    const radioButtons = container.querySelectorAll<HTMLButtonElement>("[role='radio']");
    const p3Button = Array.from(radioButtons).find(
      (b) =>
        (b.getAttribute("title") ?? "").toLowerCase().includes("p3") ||
        (b.textContent ?? "").trim() === "P3",
    );
    expect(p3Button, "P3 radio button should be present in the switcher").not.toBeUndefined();
    if (!p3Button) throw new Error("P3 radio button missing");
    p3Button.click();

    // RF-003: handleSpaceChange now flushes the emit synchronously, so the
    // emission is observable immediately. The historical rAF wait stays
    // here as a no-op tick — harmless and protects against any
    // browser/JSDOM scheduling differences.
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    expect(emissions.length).toBeGreaterThan(0);
    const lastEmit = emissions[emissions.length - 1];
    expect(lastEmit?.space).toBe("display_p3");
  });

  it("initializes mode to display_p3 when seed color is Color::DisplayP3 (RF-002)", async () => {
    // RF-002 regression: ColorPicker used to hardcode state.space="srgb".
    // Opening the picker on a DisplayP3 color must surface the P3 radio
    // as the active selection, otherwise the first drag silently emits
    // a Color::Srgb downgrade.
    const { container } = renderWithI18n(() => (
      <ColorPicker
        color={{ space: "display_p3", r: 1, g: 0, b: 0, a: 1 }}
        onColorChange={() => {}}
      />
    ));

    const radioButtons = container.querySelectorAll<HTMLButtonElement>("[role='radio']");
    const p3Radio = Array.from(radioButtons).find(
      (b) =>
        (b.getAttribute("title") ?? "").toLowerCase().includes("p3") ||
        (b.textContent ?? "").trim() === "P3",
    );
    expect(p3Radio, "P3 radio button should exist").not.toBeUndefined();
    expect(p3Radio?.getAttribute("aria-checked")).toBe("true");
  });

  it("emits Color::DisplayP3 on a drag-like change when seed is Color::DisplayP3 (RF-002)", async () => {
    // RF-002 regression: prior to the fix, ColorPicker hardcoded
    // state.space="srgb", so the first emission after mounting on a P3
    // seed silently downgraded the storage tag to sRGB. Now state.space
    // initialises from props.color.space, so any user gesture (here
    // simulated via the alpha keyboard arrow) emits with the correct
    // P3 discriminant. The test asserts post-fix: every emission MUST be
    // Color::DisplayP3 (the picker is in P3 mode and no mode switch is
    // triggered in this test).
    const emissions: Color[] = [];

    const { container } = renderWithI18n(() => (
      <ColorPicker
        color={{ space: "display_p3", r: 0.5, g: 0.5, b: 0.5, a: 1 }}
        onColorChange={(c) => {
          emissions.push(c);
        }}
      />
    ));

    // Allow mount guard to elapse.
    await Promise.resolve();

    // Trigger a drag-like emit by sending an arrow key to the alpha
    // slider. JSDOM may not have a slider focused, but the keydown
    // handler runs on the slider element regardless.
    const sliders = container.querySelectorAll<HTMLElement>("[role='slider']");
    const alphaSlider = Array.from(sliders).find((s) =>
      (s.getAttribute("aria-label") ?? "").toLowerCase().includes("opacity"),
    );
    if (alphaSlider) {
      fireEvent.keyDown(alphaSlider, { key: "ArrowRight" });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }

    // Every emission MUST carry the P3 tag — no silent sRGB downgrades.
    for (const e of emissions) {
      expect(e.space).toBe("display_p3");
    }
  });

  it("does not commit when the user clicks the already-active radio (RF-003)", async () => {
    // RF-003 regression: handleSpaceChange used to fire commitColor() on
    // every click, including no-op transitions. Clicking the already-
    // active radio must be a fully silent operation — no emit, no commit.
    const emissions: Color[] = [];
    const onColorCommit = vi.fn();

    const { container } = renderWithI18n(() => (
      <ColorPicker
        color={{ space: "srgb", r: 1, g: 0, b: 0, a: 1 }}
        onColorChange={(c) => {
          emissions.push(c);
        }}
        onColorCommit={onColorCommit}
      />
    ));

    await Promise.resolve();
    // Clear any mount-time commits so we measure only the click effect.
    onColorCommit.mockClear();
    const emissionsBefore = emissions.length;

    // Click the sRGB radio (already active).
    const radioButtons = container.querySelectorAll<HTMLButtonElement>("[role='radio']");
    const srgbRadio = Array.from(radioButtons).find((b) => (b.textContent ?? "").trim() === "sRGB");
    expect(srgbRadio, "sRGB radio should be present").not.toBeUndefined();
    if (!srgbRadio) throw new Error("sRGB radio missing");
    srgbRadio.click();
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    expect(onColorCommit).not.toHaveBeenCalled();
    // No new emissions for a no-op mode switch.
    expect(emissions.length).toBe(emissionsBefore);
  });
});

describe("HexInput P3 affordances (Spec 18)", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
      MockResizeObserver;
    mockMatchMedia();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows P3 badge in HexInput when picker switches to P3 mode (RF-011)", async () => {
    // RF-011 regression: the P3 badge visibility must be tied to
    // state.space. The badge mounts via <Show when={props.isP3Mode}> in
    // HexInput; the wiring through ColorPicker (state.space === "display_p3"
    // → isP3Mode prop) is what this test exercises end-to-end.
    const { container } = renderWithI18n(() => (
      <ColorPicker color={{ space: "srgb", r: 1, g: 0, b: 0, a: 1 }} onColorChange={() => {}} />
    ));

    await Promise.resolve();

    // Initially in sRGB mode — no P3 badge.
    expect(container.querySelector(".sigil-hex-input__p3-badge")).toBeNull();

    // Click P3 radio.
    const radioButtons = container.querySelectorAll<HTMLButtonElement>("[role='radio']");
    const p3Radio = Array.from(radioButtons).find(
      (b) =>
        (b.getAttribute("title") ?? "").toLowerCase().includes("p3") ||
        (b.textContent ?? "").trim() === "P3",
    );
    expect(p3Radio, "P3 radio should be present").not.toBeUndefined();
    p3Radio?.click();
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // Badge now visible.
    expect(container.querySelector(".sigil-hex-input__p3-badge")).not.toBeNull();
  });

  it("hex input aria-describedby points at the P3 hint while in P3 mode (RF-017)", async () => {
    // RF-017: the badge is aria-hidden=true so it doesn't add tab clutter.
    // To keep the hint discoverable for screen-reader users tabbing into
    // the hex input, the input's aria-describedby must reference a
    // sibling node carrying the full description text.
    const { container } = renderWithI18n(() => (
      <ColorPicker
        color={{ space: "display_p3", r: 0.5, g: 0.5, b: 0.5, a: 1 }}
        onColorChange={() => {}}
      />
    ));

    await Promise.resolve();

    const hexInput = container.querySelector<HTMLInputElement>(".sigil-hex-input__input");
    expect(hexInput, "hex input should be present").not.toBeNull();
    const describedBy = hexInput?.getAttribute("aria-describedby");
    expect(describedBy, "aria-describedby should be set in P3 mode").toBeTruthy();
    const descElement = describedBy ? container.querySelector(`#${describedBy}`) : null;
    expect(descElement, "referenced description element should exist").not.toBeNull();
    expect(descElement?.textContent ?? "").toContain("Display-P3");
  });

  it("suppresses out-of-gamut warning when picker is in P3 mode (RF-016)", async () => {
    // RF-016: an OOG-of-sRGB color displayed in P3 mode is the *intended*
    // state — the user chose wide gamut to access those colors. Showing
    // the warning here reads as a defect. Pair that with RF-002's
    // mode-from-prop init: opening the picker on a DisplayP3-tagged red
    // (which is OOG of sRGB) must show the P3 badge and NOT the warning.
    const { container } = renderWithI18n(() => (
      <ColorPicker
        color={{ space: "display_p3", r: 1, g: 0, b: 0, a: 1 }}
        onColorChange={() => {}}
      />
    ));

    await Promise.resolve();

    // Sanity check that we *are* in P3 mode (RF-002 wiring).
    expect(container.querySelector(".sigil-hex-input__p3-badge")).not.toBeNull();
    // Warning is suppressed.
    expect(container.querySelector(".sigil-hex-input__gamut-warning")).toBeNull();
  });
});

describe("ColorValueFields display_p3 mode (Spec 18)", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders 4 fields with 0-1 float ranges for R/G/B in P3 mode", () => {
    let lastChange: { r: number; g: number; b: number; alpha: number } | null = null;

    const { container } = renderWithI18n(() => (
      <ColorValueFields
        r={0.5}
        g={0.5}
        b={0.5}
        alpha={1}
        space="display_p3"
        hslH={undefined}
        hslS={undefined}
        onChange={(r, g, b, alpha) => {
          lastChange = { r, g, b, alpha };
        }}
      />
    ));

    // Should have 4 numeric spinbuttons (R, G, B, Alpha) — Kobalte's
    // NumberField renders the input with role="spinbutton".
    const spinButtons = container.querySelectorAll<HTMLElement>('[role="spinbutton"]');
    expect(spinButtons).toHaveLength(4);

    // Read displayed value. Kobalte's NumberField renders raw value into the
    // input's value/textContent.
    const readValue = (el: HTMLElement | undefined): string => {
      if (!el) return "";
      if (el instanceof HTMLInputElement) return el.value;
      return (el.textContent ?? "").trim();
    };

    // sRGB grey (0.5, 0.5, 0.5) maps to P3 grey close to 0.5 because the
    // P3↔sRGB matrix preserves the achromatic axis. The R field should NOT
    // display 128 (that's the sRGB 0-255 mode); it must be a 0-1 float.
    const [rInput] = Array.from(spinButtons);
    const rValue = readValue(rInput);
    expect(rValue).toMatch(/^0\.5/);

    void lastChange;
  });
});
