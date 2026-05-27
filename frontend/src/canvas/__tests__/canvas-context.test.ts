/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { acquireWideGamut2D } from "../canvas-context";

/**
 * jsdom 29 does not implement `HTMLCanvasElement.getContext()` natively (it
 * returns null without the optional `canvas` npm package). These tests stub
 * `getContext` directly so we can verify the helper's contract: try
 * Display-P3 first, fall back to the default sRGB context, return null only
 * when both calls return null.
 */

function makeCanvas(getContextImpl: HTMLCanvasElement["getContext"]): HTMLCanvasElement {
  return { getContext: getContextImpl } as unknown as HTMLCanvasElement;
}

const fakeCtx = (label: string): CanvasRenderingContext2D =>
  ({ __label: label, fillRect: () => {} }) as unknown as CanvasRenderingContext2D;

describe("acquireWideGamut2D", () => {
  it("requests a display-p3 context first", () => {
    const getContext = vi.fn((_id: string, opts?: unknown) => {
      if (
        opts &&
        typeof opts === "object" &&
        (opts as { colorSpace?: string }).colorSpace === "display-p3"
      ) {
        return fakeCtx("p3");
      }
      return fakeCtx("srgb");
    }) as unknown as HTMLCanvasElement["getContext"];

    const canvas = makeCanvas(getContext);
    const ctx = acquireWideGamut2D(canvas);

    expect(ctx).not.toBeNull();
    expect((ctx as unknown as { __label: string }).__label).toBe("p3");
  });

  it("falls back to default sRGB when display-p3 returns null", () => {
    const getContext = vi.fn((_id: string, opts?: unknown) => {
      if (
        opts &&
        typeof opts === "object" &&
        (opts as { colorSpace?: string }).colorSpace === "display-p3"
      ) {
        return null;
      }
      return fakeCtx("srgb");
    }) as unknown as HTMLCanvasElement["getContext"];

    const canvas = makeCanvas(getContext);
    const ctx = acquireWideGamut2D(canvas);

    expect(ctx).not.toBeNull();
    expect((ctx as unknown as { __label: string }).__label).toBe("srgb");
  });

  it("falls back to default sRGB when display-p3 throws", () => {
    let firstCall = true;
    const getContext = vi.fn((_id: string, _opts?: unknown) => {
      if (firstCall) {
        firstCall = false;
        throw new Error("colorSpace option not supported");
      }
      return fakeCtx("srgb");
    }) as unknown as HTMLCanvasElement["getContext"];

    const canvas = makeCanvas(getContext);
    const ctx = acquireWideGamut2D(canvas);

    expect(ctx).not.toBeNull();
    expect((ctx as unknown as { __label: string }).__label).toBe("srgb");
  });

  it("returns null when both attempts return null", () => {
    const canvas = makeCanvas((() => null) as unknown as HTMLCanvasElement["getContext"]);
    expect(acquireWideGamut2D(canvas)).toBeNull();
  });
});
