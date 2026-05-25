/**
 * Global Vitest setup — applied to every test file via vitest config.
 *
 * Polyfills jsdom 29 gaps so that Kobalte primitives and any component using
 * pointer-capture / CSS calc with non-finite intermediates behave the way a
 * real browser would. These shims are additive: they add missing methods and
 * mirror real-browser tolerance of invalid CSS. They do not change behavior
 * for any test that does not exercise these jsdom limitations.
 *
 * Source of the polyfill needs:
 * - css-tree throws SyntaxError on `calc(NaN%)`. Kobalte's slider thumb
 *   computes a percent position from a thumb index of `-1` during initial
 *   render (before the thumb ref callback fires), producing NaN. Real
 *   browsers silently ignore the invalid declaration; jsdom 29 throws.
 * - jsdom 29 does not implement Element.setPointerCapture / releasePointerCapture
 *   / hasPointerCapture. Kobalte's slider thumb calls these unconditionally
 *   inside its pointerdown/pointermove/pointerup handlers.
 */

const cssProto = (
  globalThis as typeof globalThis & { CSSStyleDeclaration?: typeof CSSStyleDeclaration }
).CSSStyleDeclaration?.prototype;

if (cssProto) {
  const originalSetProperty = cssProto.setProperty;
  cssProto.setProperty = function patchedSetProperty(
    this: CSSStyleDeclaration,
    property: string,
    value: string | null,
    priority?: string,
  ): void {
    try {
      originalSetProperty.call(this, property, value as string, priority ?? "");
    } catch {
      // Real browsers silently ignore invalid CSS values; mirror that here.
    }
  };
}

const elProto = (globalThis as typeof globalThis & { Element?: typeof Element }).Element?.prototype;

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
      function (this: Element, pointerId: number): void {
        getSet(this).add(pointerId);
      };
  }
  if (!("releasePointerCapture" in elProto)) {
    (elProto as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture =
      function (this: Element, pointerId: number): void {
        getSet(this).delete(pointerId);
      };
  }
  if (!("hasPointerCapture" in elProto)) {
    (elProto as unknown as { hasPointerCapture: (id: number) => boolean }).hasPointerCapture =
      function (this: Element, pointerId: number): boolean {
        return getSet(this).has(pointerId);
      };
  }
}
