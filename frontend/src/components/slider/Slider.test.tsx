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
  const proto = (globalThis as typeof globalThis & { CSSStyleDeclaration?: typeof CSSStyleDeclaration })
    .CSSStyleDeclaration?.prototype;
  if (!proto) return;
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
    const callArg = handler.mock.calls[0]![0];
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
      const firstCall = warnSpy.mock.calls[0]!;
      expect(firstCall[0]).toMatch(/Slider/);
      expect(typeof firstCall[1]).toBe("object");

      emitChange([42], handler);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(42);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
