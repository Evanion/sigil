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
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
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
});
