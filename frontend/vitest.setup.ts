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
 * - jsdom 29 does not expose `Path2D` as a global. The canvas renderer
 *   (Plan 14c) uses `new Path2D()` to build corner-shape outlines and pass
 *   them to `ctx.fill(path)` / `ctx.stroke(path)` / `ctx.clip(path)`. Tests
 *   use a Proxy-recording mock context that records the calls without
 *   inspecting the Path2D contents, so a minimal Path2D shim suffices — the
 *   shape's methods are no-ops in tests (the geometry helpers are tested
 *   independently via the `PathRecorder` in `corner-path.test.ts`).
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

if (typeof (globalThis as Record<string, unknown>).Path2D === "undefined") {
  // Minimal Path2D shim — no-op methods. Production canvas calls accept the
  // path object opaquely; the recorder mock context records the call args
  // without inspecting the path's contents. Geometry correctness is verified
  // via the structural `PathBuilder` interface in `corner-path.test.ts`.
  class Path2DShim {
    addPath(): void {}
    arc(): void {}
    arcTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
    ellipse(): void {}
    lineTo(): void {}
    moveTo(): void {}
    quadraticCurveTo(): void {}
    rect(): void {}
    roundRect(): void {}
  }
  (globalThis as Record<string, unknown>).Path2D = Path2DShim;
}
