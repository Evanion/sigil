/**
 * acquireWideGamut2D — acquire a 2D rendering context with the Display-P3
 * color space when supported by the browser. Falls back to the default
 * (sRGB) color space if the option is unrecognized or returns null.
 *
 * Spec 18: the main editor canvas and the picker canvases use this helper
 * so that color(display-p3 …) CSS strings render in wide-gamut on
 * P3-capable displays. On sRGB displays the browser's color management
 * down-samples the wide-gamut values transparently.
 *
 * Browser support (as of 2026): Chrome 111+, Safari 16.4+, Firefox 113+
 * all honor the colorSpace argument. Earlier versions ignore unknown
 * properties (per spec) and return an sRGB context; we accept that
 * fallback silently.
 *
 * RF-013: Call this helper at most ONCE per canvas element lifetime. Per
 * the HTML Canvas spec, subsequent `getContext("2d", ...)` calls on the
 * same canvas return the existing context regardless of the new options —
 * a second acquire with different `colorSpace` does NOT reconfigure the
 * existing context. This function does not memoize; the existing
 * consumers (main canvas + 3 picker canvases) each acquire once on mount.
 * Re-acquiring is undefined behavior — the original context's color space
 * persists, and the second call silently returns the same handle.
 */
export function acquireWideGamut2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    // TypeScript's lib.dom.d.ts may not yet include the colorSpace option on
    // CanvasRenderingContext2DSettings. Cast to satisfy the type checker;
    // the runtime accepts the option per the HTML Canvas Color Management
    // spec, and browsers without support ignore unknown properties.
    const ctx = canvas.getContext("2d", {
      colorSpace: "display-p3",
    } as CanvasRenderingContext2DSettings);
    if (ctx) return ctx;
  } catch {
    // Browser implementations vary on how an unknown colorSpace value is
    // handled; some may throw. Fall through to the default-context path.
  }
  return canvas.getContext("2d");
}
