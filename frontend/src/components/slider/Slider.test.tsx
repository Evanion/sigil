/**
 * @vitest-environment jsdom
 *
 * Slider wrapper tests.
 *
 * jsdom 29 + css-tree throws on `calc(NaN%)` produced by Kobalte's slider
 * during the initial render (thumb index is -1 before its ref callback fires,
 * which makes the percent computation NaN; real browsers silently ignore the
 * resulting CSS, jsdom throws a SyntaxError). We patch
 * `CSSStyleDeclaration.prototype.setProperty` to swallow css-tree parse
 * errors so the test environment behaves like a real browser.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { Slider } from "./Slider";

beforeAll(() => {
  const proto = (
    globalThis as typeof globalThis & { CSSStyleDeclaration?: typeof CSSStyleDeclaration }
  ).CSSStyleDeclaration?.prototype;
  if (proto) {
    const original = proto.setProperty;
    proto.setProperty = function patchedSetProperty(
      this: CSSStyleDeclaration,
      property: string,
      value: string | null,
      priority?: string,
    ): void {
      try {
        original.call(this, property, value as string, priority ?? "");
      } catch {
        // Real browsers silently ignore invalid CSS values; mirror that here.
      }
    };
  }
  // jsdom 29 does not implement PointerEvent pointer-capture APIs. Kobalte's
  // slider thumb calls setPointerCapture/hasPointerCapture/releasePointerCapture
  // unconditionally inside its pointerdown/pointermove/pointerup handlers.
  // Stub them so gesture tests can exercise the real Kobalte event flow.
  const elProto = (globalThis as typeof globalThis & { Element?: typeof Element }).Element
    ?.prototype;
  if (elProto) {
    const captured = new WeakMap<Element, Set<number>>();
    const getSet = (el: Element): Set<number> => {
      let s = captured.get(el);
      if (!s) {
        s = new Set();
        captured.set(el, s);
      }
      return s;
    };
    if (!("setPointerCapture" in elProto)) {
      (elProto as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture =
        function (this: Element, pointerId: number) {
          getSet(this).add(pointerId);
        };
    }
    if (!("releasePointerCapture" in elProto)) {
      (
        elProto as unknown as { releasePointerCapture: (id: number) => void }
      ).releasePointerCapture = function (this: Element, pointerId: number) {
        getSet(this).delete(pointerId);
      };
    }
    if (!("hasPointerCapture" in elProto)) {
      (elProto as unknown as { hasPointerCapture: (id: number) => boolean }).hasPointerCapture =
        function (this: Element, pointerId: number) {
          return getSet(this).has(pointerId);
        };
    }
  }
});

describe("Slider", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render an element with role=slider", () => {
    render(() => <Slider value={50} onChange={() => {}} ariaLabel="Test" />);
    // Kobalte renders both a thumb (span[role=slider]) and a hidden
    // <input type="range"> for form integration; the input has an implicit
    // slider role. Use getAllByRole so we tolerate both.
    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);
  });

  it("should display the current value via aria-valuenow on the thumb", () => {
    const { container } = render(() => (
      <Slider value={42} onChange={() => {}} min={0} max={100} ariaLabel="Test" />
    ));
    // The thumb is the span with role=slider (not the hidden <input>).
    const thumb = container.querySelector('span[role="slider"]');
    expect(thumb?.getAttribute("aria-valuenow")).toBe("42");
  });

  it("should call onChange with the single numeric value (not array)", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <Slider value={50} onChange={handler} min={0} max={100} ariaLabel="Test" />
    ));
    const thumb = container.querySelector('span[role="slider"]') as HTMLElement;
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(handler).toHaveBeenCalled();
    const firstCall = handler.mock.calls[0];
    expect(firstCall).toBeDefined();
    const callArg = firstCall?.[0];
    expect(typeof callArg).toBe("number");
    expect(Number.isFinite(callArg)).toBe(true);
  });

  it("should remove the thumb from the tab order when disabled", () => {
    // Kobalte's slider does not set aria-disabled on the thumb; instead the
    // thumb's tabIndex becomes undefined when disabled (see Kobalte source
    // slider-thumb.tsx line 226), and the root carries data-disabled. We
    // verify both observable signals here.
    const { container } = render(() => (
      <Slider value={50} onChange={() => {}} disabled ariaLabel="Test" />
    ));
    const thumb = container.querySelector('span[role="slider"]');
    expect(thumb?.hasAttribute("tabindex")).toBe(false);
    const root = container.querySelector("[data-disabled]");
    expect(root).toBeTruthy();
  });

  it("should not call onChange when disabled and interacted via keyboard", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <Slider value={50} onChange={handler} disabled min={0} max={100} ariaLabel="Test" />
    ));
    const thumb = container.querySelector('span[role="slider"]') as HTMLElement;
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("should set aria-valuetext on the thumb from ariaValueText prop", () => {
    const { container } = render(() => (
      <Slider
        value={75}
        onChange={() => {}}
        ariaLabel="Smoothing"
        ariaValueText="75 percent smoothing"
        min={0}
        max={100}
      />
    ));
    const thumb = container.querySelector('span[role="slider"]');
    expect(thumb?.getAttribute("aria-valuetext")).toBe("75 percent smoothing");
  });

  it("should default aria-valuetext to the formatted value when ariaValueText not provided", () => {
    const { container } = render(() => (
      <Slider value={42} onChange={() => {}} ariaLabel="Test" min={0} max={100} />
    ));
    const thumb = container.querySelector('span[role="slider"]');
    // Kobalte's default getThumbValueLabel uses Intl.NumberFormat decimal,
    // which formats whole numbers as the bare digits.
    expect(thumb?.getAttribute("aria-valuetext")).toBe("42");
  });

  it("should fire onChangeStart on pointer down", () => {
    const startSpy = vi.fn();
    const { container } = render(() => (
      <Slider
        value={50}
        onChange={() => {}}
        onChangeStart={startSpy}
        min={0}
        max={100}
        ariaLabel="Test"
      />
    ));
    const thumb = container.querySelector('span[role="slider"]') as HTMLElement;
    fireEvent.pointerDown(thumb, { pointerId: 1, clientX: 50, clientY: 0 });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("should fire onChangeStart on keyboard interaction (ArrowRight)", () => {
    const startSpy = vi.fn();
    const { container } = render(() => (
      <Slider
        value={50}
        onChange={() => {}}
        onChangeStart={startSpy}
        min={0}
        max={100}
        ariaLabel="Test"
      />
    ));
    const thumb = container.querySelector('span[role="slider"]') as HTMLElement;
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("should fire onChangeStart only once per gesture (not per pointermove)", () => {
    const startSpy = vi.fn();
    const { container } = render(() => (
      <Slider
        value={50}
        onChange={() => {}}
        onChangeStart={startSpy}
        min={0}
        max={100}
        ariaLabel="Test"
      />
    ));
    const thumb = container.querySelector('span[role="slider"]') as HTMLElement;
    fireEvent.pointerDown(thumb, { pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.pointerMove(thumb, { pointerId: 1, clientX: 60, clientY: 0 });
    fireEvent.pointerMove(thumb, { pointerId: 1, clientX: 70, clientY: 0 });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("should fire onChangeEnd at end of pointer interaction with the final value", () => {
    const endSpy = vi.fn();
    const { container } = render(() => (
      <Slider
        value={50}
        onChange={() => {}}
        onChangeEnd={endSpy}
        min={0}
        max={100}
        ariaLabel="Test"
      />
    ));
    const thumb = container.querySelector('span[role="slider"]') as HTMLElement;
    fireEvent.pointerDown(thumb, { pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.pointerUp(thumb, { pointerId: 1, clientX: 50, clientY: 0 });
    expect(endSpy).toHaveBeenCalled();
    const lastCall = endSpy.mock.calls[endSpy.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const endVal = lastCall?.[0];
    expect(typeof endVal).toBe("number");
    expect(Number.isFinite(endVal)).toBe(true);
  });

  it("should reset gesture-start tracking after onChangeEnd", () => {
    const startSpy = vi.fn();
    const { container } = render(() => (
      <Slider
        value={50}
        onChange={() => {}}
        onChangeStart={startSpy}
        min={0}
        max={100}
        ariaLabel="Test"
      />
    ));
    const thumb = container.querySelector('span[role="slider"]') as HTMLElement;
    // Gesture 1
    fireEvent.pointerDown(thumb, { pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.pointerUp(thumb, { pointerId: 1, clientX: 50, clientY: 0 });
    // Gesture 2
    fireEvent.pointerDown(thumb, { pointerId: 2, clientX: 50, clientY: 0 });
    expect(startSpy).toHaveBeenCalledTimes(2);
  });

  it("emitChangeEnd helper rejects non-finite values and warns", async () => {
    const { emitChangeEnd } = await import("./Slider");
    const endHandler = vi.fn();
    const resetSpy = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      emitChangeEnd([Number.NaN], endHandler, resetSpy);
      // gesture reset must run regardless of value validity
      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(endHandler).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();

      emitChangeEnd([7], endHandler, resetSpy);
      expect(resetSpy).toHaveBeenCalledTimes(2);
      expect(endHandler).toHaveBeenCalledWith(7);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("should apply the base sigil-slider class on root", () => {
    const { container } = render(() => (
      <Slider value={0} onChange={() => {}} ariaLabel="Test" min={0} max={100} />
    ));
    const root = container.querySelector(".sigil-slider");
    expect(root).toBeTruthy();
  });

  it("should merge custom class prop with base class", () => {
    const { container } = render(() => (
      <Slider
        value={0}
        onChange={() => {}}
        ariaLabel="Test"
        min={0}
        max={100}
        class="custom-class"
      />
    ));
    const root = container.querySelector(".sigil-slider.custom-class");
    expect(root).toBeTruthy();
  });

  it("should reject non-finite values via Number.isFinite guard and warn", async () => {
    // Import the helper directly so we can exercise it without depending on
    // Kobalte producing NaN (which it never does in practice — this is the
    // wrapper-level defensive guard required by CLAUDE.md §11 Floating-Point
    // Validation).
    const { emitChange } = await import("./Slider");
    const handler = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      emitChange([Number.NaN], handler);
      emitChange([Number.POSITIVE_INFINITY], handler);
      emitChange([Number.NEGATIVE_INFINITY], handler);
      emitChange([], handler);
      expect(handler).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      // Each warn call's first arg names the wrapper and a structured payload.
      const firstCall = warnSpy.mock.calls[0];
      expect(firstCall).toBeDefined();
      expect(firstCall?.[0]).toMatch(/Slider/);
      expect(typeof firstCall?.[1]).toBe("object");

      emitChange([42], handler);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(42);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
