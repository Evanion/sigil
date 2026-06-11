# 11c-A CanvasKit Render Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Sigil's Canvas-2D document renderer with a CanvasKit/Skia (WebGL2) render core behind a `SceneRenderer` seam, at visual parity, with the old renderer deleted.

**Architecture:** A `SceneRenderer` interface with one implementation, `SkiaRenderer`, owns a CanvasKit `Surface` (WebGL2-GPU with a Display-P3 context; CPU-software fallback) and translates the existing per-node draw logic into Skia canvas commands. Corner geometry is reused unchanged via a `SkiaPathBuilder` adapter. Selection/marquee/guide chrome moves to a separate 2D overlay canvas. A golden-image parity harness (CanvasKit CPU surface, headless in Node) gates every port.

**Tech Stack:** TypeScript (strict), Solid.js, `canvaskit-wasm@0.41.1`, Vite, Vitest (jsdom + Node), Skia.

**Spec:** `docs/superpowers/specs/2026-06-10-11c-a-canvaskit-render-core.md`
**Validation:** `docs/superpowers/research/2026-06-10-11c-render-core-canvaskit.md`, harness in `spikes/canvaskit/`.

**Hard rules for the executor (do not deviate):**
1. **No orphaned files.** Every new module MUST be imported by a real consumer or a test in the same task it's created. A module nothing imports is a bug — delete or wire it.
2. **No stubs / no "in a real implementation" placeholders.** Every function does the real thing. If you can't implement it, stop and report.
3. **Reuse, don't reimplement.** `corner-path.ts`, `text-measure.ts` wrapping, `color-fill.ts` discrimination, `render-order.ts`, `viewport.ts` are reused. Do not rewrite corner geometry in shaders or duplicate types.
4. **Every CanvasKit object you `Make`/`new` MUST be `.delete()`'d** (long-lived ones in `destroy()`, per-frame ones in the same frame). This is enforced by a test.
5. **A port task is not done until its golden parity test passes.** Goldens are generated once (Task 2 helper) then committed; later runs compare.
6. Commit after every task. Branch is `docs/spec-11c-review` unless the controller says otherwise — never reset/rebase.

**Pre-req:** Run `./dev.sh pnpm --prefix frontend install` after Task 1 adds the dependency. All commands below assume the `./dev.sh` container prefix from the host.

---

## File Structure

**New files (all frontend-only):**
- `frontend/src/canvas/canvaskit-loader.ts` — async singleton loader for the pinned CanvasKit WASM.
- `frontend/src/canvas/scene-renderer.ts` — `SceneRenderer` interface + `SceneInput` type.
- `frontend/src/canvas/skia-renderer.ts` — `SkiaRenderer implements SceneRenderer` (surface, node→Skia mapping, destroy).
- `frontend/src/canvas/skia-path-builder.ts` — `SkiaPathBuilder` adapter (implements `PathBuilder`).
- `frontend/src/canvas/skia-color.ts` — `colorToSkiaColor4f`, `blendModeToSkia`, gradient shader builders.
- `frontend/src/canvas/skia-text.ts` — `TextStyle` → Skia Paragraph mapping + draw.
- `frontend/src/canvas/overlay-renderer.ts` — 2D chrome renderer (selection/handles/marquee/guides/labels/preview), moved out of `renderer.ts`.
- `frontend/src/canvas/__tests__/parity/parity-harness.ts` — Node CanvasKit CPU render-to-PNG + diff helper.
- `frontend/src/canvas/__tests__/parity/*.test.ts` — golden parity tests per node kind/feature.
- `frontend/src/canvas/__tests__/parity/goldens/*.png` — committed golden images.

**Modified files:**
- `frontend/package.json` — add `canvaskit-wasm@0.41.1` (exact).
- `frontend/vite.config.ts` — vendor/serve the wasm; ensure it's a static asset.
- `frontend/src/shell/Canvas.tsx` — two-canvas setup; use `SkiaRenderer` + `overlay-renderer`; `destroy()` in `onCleanup`.
- `frontend/src/canvas/renderer.ts` — **delete** `render`/`drawNode` document-draw path and the chrome functions (moved to `overlay-renderer.ts`). File is removed if nothing else remains.
- `frontend/src/canvas/__tests__/renderer.test.ts` — retire the drawNode-specific 2D-mock tests; chrome tests move to `overlay-renderer.test.ts`.
- `src-tauri/tauri.conf.json` — add `'wasm-unsafe-eval'` to CSP `script-src`.

---

## Phase 0 — Dependency & Parity Harness

### Task 1: Add and vendor CanvasKit

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/canvas/canvaskit-loader.ts`
- Test: `frontend/src/canvas/__tests__/canvaskit-loader.test.ts`

- [ ] **Step 1: Add the exact dependency**

Run: `./dev.sh pnpm --prefix frontend add -E canvaskit-wasm@0.41.1`
Expected: `package.json` shows `"canvaskit-wasm": "0.41.1"` (no `^`). Verify with: `grep canvaskit frontend/package.json` → `"canvaskit-wasm": "0.41.1"`.

- [ ] **Step 2: Write the failing loader test**

```ts
// frontend/src/canvas/__tests__/canvaskit-loader.test.ts
import { describe, it, expect } from "vitest";
import { loadCanvasKit } from "../canvaskit-loader";

describe("loadCanvasKit", () => {
  it("loads CanvasKit and exposes core factories", async () => {
    const ck = await loadCanvasKit();
    expect(typeof ck.MakeSurface).toBe("function");
    expect(ck.ColorSpace.DISPLAY_P3).toBeDefined();
  });
  it("returns the same instance on repeated calls (singleton)", async () => {
    const a = await loadCanvasKit();
    const b = await loadCanvasKit();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `./dev.sh pnpm --prefix frontend test src/canvas/__tests__/canvaskit-loader.test.ts`
Expected: FAIL — `Cannot find module '../canvaskit-loader'`.

- [ ] **Step 4: Implement the loader**

```ts
// frontend/src/canvas/canvaskit-loader.ts
import CanvasKitInit, { type CanvasKit } from "canvaskit-wasm";
// The wasm binary is resolved by the bundler. In the browser Vite serves it as a
// static asset; in Node (tests) it resolves from node_modules.
import wasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";

let instance: CanvasKit | null = null;
let pending: Promise<CanvasKit> | null = null;

export async function loadCanvasKit(): Promise<CanvasKit> {
  if (instance) return instance;
  if (pending) return pending;
  pending = CanvasKitInit({
    locateFile: (file: string) => (file.endsWith(".wasm") ? wasmUrl : file),
  }).then((ck) => {
    instance = ck;
    pending = null;
    return ck;
  });
  return pending;
}
```

Note: in the Node test env, `?url` import yields a path; if Vitest cannot resolve `?url` for the wasm, add to `frontend/vite.config.ts` `test` block: `server: { deps: { inline: ["canvaskit-wasm"] } }` and use a Node-conditional `locateFile` returning the absolute `node_modules/canvaskit-wasm/bin/canvaskit.wasm` path. Verify the chosen approach by the test passing in Step 5 — do not leave both paths in.

- [ ] **Step 5: Run it, expect pass**

Run: `./dev.sh pnpm --prefix frontend test src/canvas/__tests__/canvaskit-loader.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Ensure the wasm is a served static asset (browser)**

In `frontend/vite.config.ts`, confirm `assetsInclude` covers `**/*.wasm` (Vite includes `.wasm` by default; if a custom `assetsInclude` exists, add `"**/*.wasm"`). No code change if default. Document the decision in a one-line comment at the `?url` import.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/vite.config.ts \
        frontend/src/canvas/canvaskit-loader.ts \
        frontend/src/canvas/__tests__/canvaskit-loader.test.ts
git commit -m "feat(frontend): add pinned canvaskit-wasm loader (spec-11c-a)"
```

---

### Task 2: Parity harness (Node CPU surface → PNG → diff)

**Files:**
- Create: `frontend/src/canvas/__tests__/parity/parity-harness.ts`
- Test: `frontend/src/canvas/__tests__/parity/harness.test.ts`
- Create (generated): `frontend/src/canvas/__tests__/parity/goldens/clear.png`

The harness renders via a CanvasKit **CPU raster surface** (`MakeSurface(w,h)` — works headless in Node, no GPU/DOM), snapshots a PNG, and compares to a committed golden with a small per-pixel tolerance. A `GENERATE_GOLDENS=1` env var writes goldens instead of comparing.

- [ ] **Step 1: Write the harness helper**

```ts
// frontend/src/canvas/__tests__/parity/parity-harness.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import type { Canvas, CanvasKit, Surface } from "canvaskit-wasm";
import { loadCanvasKit } from "../../canvaskit-loader";

const GOLDEN_DIR = join(__dirname, "goldens");
const TOLERANCE = 2; // max per-channel byte delta allowed (AA noise)

export async function withSurface(
  w: number,
  h: number,
  draw: (ck: CanvasKit, canvas: Canvas) => void,
): Promise<Uint8Array> {
  const ck = await loadCanvasKit();
  const surface: Surface | null = ck.MakeSurface(w, h);
  if (!surface) throw new Error("MakeSurface returned null");
  try {
    draw(ck, surface.getCanvas());
    surface.flush();
    const img = surface.makeImageSnapshot();
    const png = img.encodeToBytes(); // PNG
    img.delete();
    if (!png) throw new Error("encodeToBytes returned null");
    return png;
  } finally {
    surface.delete();
  }
}

export function assertGolden(name: string, png: Uint8Array): void {
  const path = join(GOLDEN_DIR, `${name}.png`);
  if (process.env.GENERATE_GOLDENS === "1") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    return;
  }
  if (!existsSync(path)) {
    throw new Error(`Missing golden ${name}.png. Run with GENERATE_GOLDENS=1 to create it.`);
  }
  const expected = readFileSync(path);
  // Decode both PNGs to raw RGBA via CanvasKit for a tolerant compare.
  // (PNG bytes can differ while pixels match; compare decoded pixels.)
  expect(png.length).toBeGreaterThan(0);
  comparePngPixels(expected, png);
}

function comparePngPixels(a: Uint8Array, b: Uint8Array): void {
  // Decoded compare lives in decodePixels(); see Step 2.
  const pa = decodePixels(a);
  const pb = decodePixels(b);
  expect(pb.width).toBe(pa.width);
  expect(pb.height).toBe(pa.height);
  let maxDelta = 0;
  for (let i = 0; i < pa.data.length; i++) {
    const d = Math.abs(pa.data[i] - pb.data[i]);
    if (d > maxDelta) maxDelta = d;
  }
  expect(maxDelta, `max per-channel delta ${maxDelta} > ${TOLERANCE}`).toBeLessThanOrEqual(TOLERANCE);
}
```

- [ ] **Step 2: Add the PNG decoder (CanvasKit) to the harness**

Append to `parity-harness.ts`:

```ts
import type { Image } from "canvaskit-wasm";

interface RawPixels { width: number; height: number; data: Uint8Array; }

let ckCache: CanvasKit | null = null;
function decodePixels(png: Uint8Array): RawPixels {
  if (!ckCache) throw new Error("decodePixels called before CanvasKit loaded");
  const img: Image | null = ckCache.MakeImageFromEncoded(png);
  if (!img) throw new Error("MakeImageFromEncoded returned null");
  const w = img.width();
  const h = img.height();
  const info = {
    width: w, height: h,
    colorType: ckCache.ColorType.RGBA_8888,
    alphaType: ckCache.AlphaType.Unpremul,
    colorSpace: ckCache.ColorSpace.SRGB,
  };
  const data = img.readPixels(0, 0, info) as Uint8Array;
  img.delete();
  return { width: w, height: h, data: new Uint8Array(data) };
}
```

In `withSurface`, set `ckCache = ck;` right after `loadCanvasKit()` so `decodePixels` has the instance.

- [ ] **Step 3: Write the harness self-test (golden round-trip)**

```ts
// frontend/src/canvas/__tests__/parity/harness.test.ts
import { describe, it } from "vitest";
import { withSurface, assertGolden } from "./parity-harness";

describe("parity harness", () => {
  it("renders a solid clear color and matches its golden", async () => {
    const png = await withSurface(32, 32, (ck, canvas) => {
      canvas.clear(ck.Color4f(0.1, 0.2, 0.3, 1));
    });
    assertGolden("clear", png);
  });
});
```

- [ ] **Step 4: Generate the first golden, then verify compare**

Run: `GENERATE_GOLDENS=1 ./dev.sh pnpm --prefix frontend test src/canvas/__tests__/parity/harness.test.ts`
Expected: creates `goldens/clear.png`, test PASSES.
Then run without the env: `./dev.sh pnpm --prefix frontend test src/canvas/__tests__/parity/harness.test.ts`
Expected: PASS (compare path). Sanity: temporarily change the clear color, run again, expect FAIL (proves the diff fires). Revert.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/canvas/__tests__/parity/parity-harness.ts \
        frontend/src/canvas/__tests__/parity/harness.test.ts \
        frontend/src/canvas/__tests__/parity/goldens/clear.png
git commit -m "test(frontend): canvaskit golden-image parity harness (spec-11c-a)"
```

---

## Phase 1 — Seam, Surface, Adapters

### Task 3: `SceneRenderer` interface + `SceneInput`

**Files:**
- Create: `frontend/src/canvas/scene-renderer.ts`
- Test: `frontend/src/canvas/__tests__/scene-renderer.test.ts`

`SceneInput` bundles exactly today's `render()` document-content inputs (chrome inputs are excluded — they go to the overlay). Source param types from `renderer.ts`/`render-order.ts`/`viewport.ts`.

- [ ] **Step 1: Write the interface + type (no logic to test yet — add a type-level test)**

```ts
// frontend/src/canvas/scene-renderer.ts
import type { Viewport } from "./viewport";
import type { RenderOrderNode } from "./render-order";
import type { Token } from "../types/document";

/** Document-content inputs for one frame. Chrome (selection/marquee/guides) is NOT here. */
export interface SceneInput {
  readonly viewport: Viewport;
  readonly nodes: readonly RenderOrderNode[];
  readonly depths: readonly number[];
  readonly dpr: number;
  readonly tokens: Record<string, Token>;
}

export interface SceneRenderer {
  /** Render the document scene for one frame. */
  renderScene(scene: SceneInput): void;
  /** Resize the backing surface. cssWidth/Height in CSS px; dpr applied internally. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /** Reclaim GPU surface, context, listeners. Idempotent. */
  destroy(): void;
}
```

```ts
// frontend/src/canvas/__tests__/scene-renderer.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { SceneRenderer, SceneInput } from "../scene-renderer";

describe("SceneRenderer types", () => {
  it("SceneInput excludes chrome and includes the document content fields", () => {
    expectTypeOf<SceneInput>().toHaveProperty("nodes");
    expectTypeOf<SceneInput>().toHaveProperty("viewport");
    expectTypeOf<SceneInput>().not.toHaveProperty("selectedUuids");
    expectTypeOf<SceneRenderer>().toHaveProperty("destroy");
  });
});
```

- [ ] **Step 2: Run → expect pass (type test compiles)**

Run: `./dev.sh pnpm --prefix frontend test src/canvas/__tests__/scene-renderer.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/canvas/scene-renderer.ts frontend/src/canvas/__tests__/scene-renderer.test.ts
git commit -m "feat(frontend): SceneRenderer interface + SceneInput (spec-11c-a)"
```

---

### Task 4: `SkiaPathBuilder` adapter (reuse corner geometry)

**Files:**
- Create: `frontend/src/canvas/skia-path-builder.ts`
- Test: `frontend/src/canvas/__tests__/skia-path-builder.test.ts`

`corner-path.ts` `appendCornerPath` writes `moveTo/lineTo/ellipse/bezierCurveTo/closePath` into a `PathBuilder`. Skia's `Path` lacks a Canvas-2D-style `ellipse`/`bezierCurveTo`, so this adapter translates: `ellipse(cx,cy,rx,ry,rot,start,end)` → `path.arcToOval`/manual arc; `bezierCurveTo` → `path.cubicTo`.

- [ ] **Step 1: Write the failing test (geometry parity vs a known corner)**

```ts
// frontend/src/canvas/__tests__/skia-path-builder.test.ts
import { describe, it, expect } from "vitest";
import { loadCanvasKit } from "../canvaskit-loader";
import { SkiaPathBuilder } from "../skia-path-builder";
import { appendCornerPath } from "../corner-path";
import type { Corners, CornerRound } from "../../types/document";

const round = (x: number, y: number): CornerRound => ({ type: "round", radii: { x, y } });

describe("SkiaPathBuilder", () => {
  it("builds a non-empty bounded Skia path for an asymmetric rounded rect", async () => {
    const ck = await loadCanvasKit();
    const b = new SkiaPathBuilder(ck);
    const corners: Corners = [round(30, 10), round(30, 10), round(30, 10), round(30, 10)];
    appendCornerPath(b, 0, 0, 100, 60, corners);
    const path = b.finish();
    const bounds = path.getBounds(); // Float32Array [l,t,r,b]
    expect(bounds[2] - bounds[0]).toBeGreaterThan(90); // ~width
    expect(bounds[3] - bounds[1]).toBeGreaterThan(50); // ~height
    path.delete();
  });
});
```

- [ ] **Step 2: Run → expect fail (module missing).**

Run: `./dev.sh pnpm --prefix frontend test src/canvas/__tests__/skia-path-builder.test.ts`
Expected: FAIL — cannot find `../skia-path-builder`.

- [ ] **Step 3: Implement the adapter**

```ts
// frontend/src/canvas/skia-path-builder.ts
import type { CanvasKit, Path } from "canvaskit-wasm";
import type { PathBuilder } from "./corner-path";

/** Adapts corner-path.ts's Canvas-2D PathBuilder onto a Skia Path. */
export class SkiaPathBuilder implements PathBuilder {
  private readonly path: Path;
  constructor(private readonly ck: CanvasKit) {
    this.path = new ck.Path();
  }
  moveTo(x: number, y: number): void { this.path.moveTo(x, y); }
  lineTo(x: number, y: number): void { this.path.lineTo(x, y); }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.path.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }
  closePath(): void { this.path.close(); }
  // Canvas-2D ellipse arc → Skia. corner-path uses axis-aligned arcs (rotation=0).
  ellipse(
    cx: number, cy: number, rx: number, ry: number,
    _rotation: number, startAngle: number, endAngle: number,
    counterclockwise = false,
  ): void {
    const oval = this.ck.LTRBRect(cx - rx, cy - ry, cx + rx, cy + ry);
    const toDeg = (r: number) => (r * 180) / Math.PI;
    let sweep = toDeg(endAngle - startAngle);
    if (!counterclockwise && sweep < 0) sweep += 360;
    if (counterclockwise && sweep > 0) sweep -= 360;
    // arcToOval(oval, startDeg, sweepDeg, forceMoveTo=false) appends connected to current point.
    this.path.arcToOval(oval, toDeg(startAngle), sweep, false);
  }
  /** Returns the built path. Caller owns it and MUST .delete() it. */
  finish(): Path { return this.path; }
}
```

- [ ] **Step 4: Run → expect pass.**

Run: `./dev.sh pnpm --prefix frontend test src/canvas/__tests__/skia-path-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a golden parity test for an asymmetric rounded rect fill**

```ts
// append to skia-path-builder.test.ts
import { withSurface, assertGolden } from "./parity/parity-harness";

it("fills an asymmetric rounded rect matching its golden", async () => {
  const corners: Corners = [round(30, 10), round(8, 8), round(30, 10), round(8, 8)];
  const png = await withSurface(120, 80, (ck, canvas) => {
    canvas.clear(ck.WHITE);
    const b = new SkiaPathBuilder(ck);
    appendCornerPath(b, 10, 10, 100, 60, corners);
    const path = b.finish();
    const paint = new ck.Paint();
    paint.setColor(ck.Color4f(0.85, 0.1, 0.1, 1));
    paint.setAntiAlias(true);
    canvas.drawPath(path, paint);
    paint.delete();
    path.delete();
  });
  assertGolden("corner-asymmetric", png);
});
```

Generate + verify: `GENERATE_GOLDENS=1 ./dev.sh pnpm --prefix frontend test src/canvas/__tests__/skia-path-builder.test.ts` then without the env. Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/canvas/skia-path-builder.ts \
        frontend/src/canvas/__tests__/skia-path-builder.test.ts \
        frontend/src/canvas/__tests__/parity/goldens/corner-asymmetric.png
git commit -m "feat(frontend): SkiaPathBuilder reusing corner-path geometry (spec-11c-a)"
```

---

### Task 5: `skia-color.ts` — color, blend modes, gradients

**Files:**
- Create: `frontend/src/canvas/skia-color.ts`
- Test: `frontend/src/canvas/__tests__/skia-color.test.ts`

Mirrors `color-fill.ts` discrimination but returns Skia values. Color targets a P3 surface: `srgb` colors are tagged sRGB and Skia converts; `display_p3` colors are provided in the P3 space.

- [ ] **Step 1: Failing test**

```ts
// frontend/src/canvas/__tests__/skia-color.test.ts
import { describe, it, expect } from "vitest";
import { loadCanvasKit } from "../canvaskit-loader";
import { colorToSkiaColor4f, blendModeToSkia } from "../skia-color";

describe("skia-color", () => {
  it("maps srgb red to Color4f(1,0,0,1)", async () => {
    const ck = await loadCanvasKit();
    const c = colorToSkiaColor4f(ck, { space: "srgb", r: 1, g: 0, b: 0, a: 1 });
    expect(Array.from(c)).toEqual([1, 0, 0, 1]);
  });
  it("maps display_p3 channels straight through to Color4f", async () => {
    const ck = await loadCanvasKit();
    const c = colorToSkiaColor4f(ck, { space: "display_p3", r: 1, g: 0, b: 0, a: 0.5 });
    expect(Array.from(c)).toEqual([1, 0, 0, 0.5]);
  });
  it("maps every BlendMode to a Skia BlendMode object", async () => {
    const ck = await loadCanvasKit();
    expect(blendModeToSkia(ck, "normal")).toBe(ck.BlendMode.SrcOver);
    expect(blendModeToSkia(ck, "multiply")).toBe(ck.BlendMode.Multiply);
  });
});
```

- [ ] **Step 2: Run → expect fail.**

Run: `./dev.sh pnpm --prefix frontend test src/canvas/__tests__/skia-color.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement. Reuse the document `Color`/`BlendMode` unions.**

```ts
// frontend/src/canvas/skia-color.ts
import type { CanvasKit, Color as SkColor, Shader } from "canvaskit-wasm";
import type { Color, BlendMode } from "../types/document";

const finite = (n: number, d: number): number => (Number.isFinite(n) ? n : d);

/** Returns a Skia Color4f (Float32Array[r,g,b,a]). srgb tagged sRGB; display_p3 passed through. */
export function colorToSkiaColor4f(ck: CanvasKit, color: Color): SkColor {
  switch (color.space) {
    case "srgb":
      return ck.Color4f(
        Math.max(0, Math.min(1, finite(color.r, 0))),
        Math.max(0, Math.min(1, finite(color.g, 0))),
        Math.max(0, Math.min(1, finite(color.b, 0))),
        Math.max(0, Math.min(1, finite(color.a, 1))),
      );
    case "display_p3":
      // P3 channels are provided in the P3 surface space (see SkiaRenderer surface config).
      return ck.Color4f(finite(color.r, 0), finite(color.g, 0), finite(color.b, 0),
        Math.max(0, Math.min(1, finite(color.a, 1))));
    case "oklch":
    case "oklab":
      return ck.Color4f(0.5, 0.5, 0.5, 1); // parity with color-fill.ts gray fallback (deferred)
    default: {
      const _exhaustive: never = color;
      return _exhaustive;
    }
  }
}

export function blendModeToSkia(ck: CanvasKit, mode: BlendMode) {
  // Map the document BlendMode union to Skia BlendMode. Exhaustive — no wildcard.
  switch (mode) {
    case "normal": return ck.BlendMode.SrcOver;
    case "multiply": return ck.BlendMode.Multiply;
    case "screen": return ck.BlendMode.Screen;
    case "overlay": return ck.BlendMode.Overlay;
    case "darken": return ck.BlendMode.Darken;
    case "lighten": return ck.BlendMode.Lighten;
    case "color_dodge": return ck.BlendMode.ColorDodge;
    case "color_burn": return ck.BlendMode.ColorBurn;
    case "hard_light": return ck.BlendMode.HardLight;
    case "soft_light": return ck.BlendMode.SoftLight;
    case "difference": return ck.BlendMode.Difference;
    case "exclusion": return ck.BlendMode.Exclusion;
    case "hue": return ck.BlendMode.Hue;
    case "saturation": return ck.BlendMode.Saturation;
    case "color": return ck.BlendMode.Color;
    case "luminosity": return ck.BlendMode.Luminosity;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
```

Before writing, verify the exact `BlendMode` string union in `frontend/src/types/document.ts` and align every arm; the switch MUST be exhaustive (the `never` sentinel fails compile if a variant is missing). If a document blend value has no Skia equivalent, map to `SrcOver` and add a code comment naming it.

- [ ] **Step 4: Run → expect pass.**

Run: `./dev.sh pnpm --prefix frontend test src/canvas/__tests__/skia-color.test.ts` → PASS.

- [ ] **Step 5: Add gradient shader builders**

Append to `skia-color.ts` `linearGradientShader`, `radialGradientShader`, `conicGradientShader` taking the document `Fill` gradient variants and returning a `Shader` (caller `.delete()`s). Read the exact gradient field names (`stops`, `start`/`end`, `center`, `radius`, angle) from `document.ts` `FillLinearGradient`/`FillRadialGradient`/`FillConicGradient`. Use `ck.Shader.MakeLinearGradient`, `MakeRadialGradient`, `MakeSweepGradient`. Convert each stop color via `colorToSkiaColor4f`. Add a unit test asserting each returns a non-null `Shader` and `.delete()`s cleanly.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/canvas/skia-color.ts frontend/src/canvas/__tests__/skia-color.test.ts
git commit -m "feat(frontend): skia color/blend/gradient mapping (spec-11c-a)"
```

---

### Task 6: `SkiaRenderer` surface lifecycle (GPU+P3, software fallback, destroy)

**Files:**
- Create: `frontend/src/canvas/skia-renderer.ts`
- Test: `frontend/src/canvas/__tests__/skia-renderer.test.ts`

This task creates the class shell: surface creation with the validated P3 recipe, software fallback, `resize`, `destroy` (deletes surface + context, idempotent), and an empty `renderScene` that just clears. Node tests can't make a WebGL surface, so the constructor accepts an injected surface factory for testability; the production factory uses the P3 GL recipe.

- [ ] **Step 1: Failing test (lifecycle via CPU surface injection)**

```ts
// frontend/src/canvas/__tests__/skia-renderer.test.ts
import { describe, it, expect } from "vitest";
import { loadCanvasKit } from "../canvaskit-loader";
import { SkiaRenderer } from "../skia-renderer";

describe("SkiaRenderer lifecycle", () => {
  it("creates, clears, and destroys without leaking (cpu surface)", async () => {
    const ck = await loadCanvasKit();
    const r = await SkiaRenderer.createForTest(ck, 64, 64);
    r.renderScene({ viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], depths: [], dpr: 1, tokens: {} });
    expect(r.isDestroyed()).toBe(false);
    r.destroy();
    expect(r.isDestroyed()).toBe(true);
    r.destroy(); // idempotent, must not throw
  });
});
```

- [ ] **Step 2: Run → expect fail.** `FAIL` (module missing).

- [ ] **Step 3: Implement the shell**

```ts
// frontend/src/canvas/skia-renderer.ts
import type { CanvasKit, Surface, Canvas as SkCanvas } from "canvaskit-wasm";
import type { SceneRenderer, SceneInput } from "./scene-renderer";
import { loadCanvasKit } from "./canvaskit-loader";

const MAX_DEVICE_PIXEL_RATIO = 3;

export class SkiaRenderer implements SceneRenderer {
  private destroyed = false;
  private constructor(
    private readonly ck: CanvasKit,
    private surface: Surface,
    private readonly htmlCanvas: HTMLCanvasElement | null,
  ) {}

  /** Production: WebGL2 GPU surface with a Display-P3 context; software fallback. */
  static async create(htmlCanvas: HTMLCanvasElement): Promise<SkiaRenderer> {
    const ck = await loadCanvasKit();
    const w = htmlCanvas.width || 1;
    const h = htmlCanvas.height || 1;
    const surface = makeGpuP3Surface(ck, htmlCanvas, w, h) ?? makeSoftwareSurface(ck, htmlCanvas, w, h);
    if (!surface) throw new Error("Failed to create any Skia surface");
    return new SkiaRenderer(ck, surface, htmlCanvas);
  }

  /** Test-only: CPU raster surface, no DOM. */
  static async createForTest(ck: CanvasKit, w: number, h: number): Promise<SkiaRenderer> {
    const surface = ck.MakeSurface(w, h);
    if (!surface) throw new Error("MakeSurface null");
    return new SkiaRenderer(ck, surface, null);
  }

  renderScene(scene: SceneInput): void {
    if (this.destroyed) return;
    const canvas = this.surface.getCanvas();
    canvas.clear(this.ck.Color4f(1, 1, 1, 1)); // overwritten by real bg in later tasks
    this.drawScene(canvas, scene);
    this.surface.flush();
  }

  // drawScene is filled in by Tasks 7–13. For now, a no-op.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private drawScene(_canvas: SkCanvas, _scene: SceneInput): void {}

  resize(cssW: number, cssH: number, dpr: number): void {
    if (this.destroyed || !this.htmlCanvas) return;
    const clamped = Math.max(1, Math.min(MAX_DEVICE_PIXEL_RATIO, dpr));
    this.htmlCanvas.width = Math.max(1, Math.floor(cssW * clamped));
    this.htmlCanvas.height = Math.max(1, Math.floor(cssH * clamped));
    // Recreate the surface bound to the resized canvas.
    this.surface.delete();
    const w = this.htmlCanvas.width, h = this.htmlCanvas.height;
    const next = makeGpuP3Surface(this.ck, this.htmlCanvas, w, h) ?? makeSoftwareSurface(this.ck, this.htmlCanvas, w, h);
    if (!next) throw new Error("resize: failed to recreate surface");
    this.surface = next;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.surface.delete();
    this.destroyed = true;
  }

  isDestroyed(): boolean { return this.destroyed; }
  clampedDpr(dpr: number): number { return Math.max(1, Math.min(MAX_DEVICE_PIXEL_RATIO, dpr)); }
}

/** Validated P3 recipe (spike strategy C). Returns null if WebGL2/P3 unavailable. */
function makeGpuP3Surface(ck: CanvasKit, canvas: HTMLCanvasElement, w: number, h: number): Surface | null {
  try {
    const gl = canvas.getContext("webgl2", { colorSpace: "display-p3", alpha: true }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    if ("drawingBufferColorSpace" in gl) {
      try { (gl as unknown as { drawingBufferColorSpace: string }).drawingBufferColorSpace = "display-p3"; } catch { /* ignore */ }
    }
    const handle = ck.GetWebGLContext(canvas);
    if (!handle) return null;
    const grCtx = ck.MakeGrContext(handle);
    if (!grCtx) return null;
    return ck.MakeOnScreenGLSurface(grCtx, w, h, ck.ColorSpace.DISPLAY_P3);
  } catch {
    return null;
  }
}

function makeSoftwareSurface(ck: CanvasKit, canvas: HTMLCanvasElement, _w: number, _h: number): Surface | null {
  try { return ck.MakeSWCanvasSurface(canvas); } catch { return null; }
}

export const SKIA_MAX_DEVICE_PIXEL_RATIO = MAX_DEVICE_PIXEL_RATIO;
```

- [ ] **Step 4: Run → expect pass.** PASS.

- [ ] **Step 5: Enforcement test for MAX_DEVICE_PIXEL_RATIO**

```ts
// append to skia-renderer.test.ts
import { SKIA_MAX_DEVICE_PIXEL_RATIO } from "../skia-renderer";
it("max_device_pixel_ratio_enforced: clamps dpr above the cap", async () => {
  const ck = await loadCanvasKit();
  const r = await SkiaRenderer.createForTest(ck, 8, 8);
  expect(r.clampedDpr(99)).toBe(SKIA_MAX_DEVICE_PIXEL_RATIO);
  expect(r.clampedDpr(0)).toBe(1);
  r.destroy();
});
```
Run → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/canvas/skia-renderer.ts frontend/src/canvas/__tests__/skia-renderer.test.ts
git commit -m "feat(frontend): SkiaRenderer surface lifecycle + P3 recipe + dpr clamp (spec-11c-a)"
```

---

## Phase 2 — Port `drawNode` to Skia (each gated by a golden)

Each task fills in `drawScene` / a `drawNode(ck, canvas, node, transform, tokens)` private method on `SkiaRenderer`, translating one arm of the old `renderer.ts:drawNode`. Pattern per task: write a golden parity test that renders ONE node kind through `SkiaRenderer.createForTest` (CPU), generate the golden, verify compare. Reuse `resolveStyleValueNumber`, `clampOpacity`, `resolveStroke`, `buildCornerPath` semantics from the old code (import the still-living helpers; do not duplicate).

> Before Task 7, read the verbatim old `drawNode` (renderer.ts:315–574) and `render` (808–939) — your translations must preserve the same winding, fill order, default-fill behavior, opacity/blend application order (save → globalAlpha → composite → fills → stroke → restore), and the ellipse arc behavior (full 0..2π, arc_start/end ignored, matching today).

The per-arm Skia translations:

### Task 7: Scene transform + node iteration + clip stack
- [ ] Implement `drawScene`: apply viewport as a Skia matrix (`canvas.save(); canvas.scale(zoom*dpr...)` equivalent — replicate `setTransform(zoom*dpr,0,0,zoom*dpr, x*dpr, y*dpr)` via `canvas.translate(vp.x*dpr, vp.y*dpr); canvas.scale(vp.zoom*dpr, vp.zoom*dpr)`). Iterate `scene.nodes`, call `drawNode` per node, and replicate the **frame clip stack** using `canvas.save()/clipPath/restore()` keyed on `depths` exactly as the old loop (lines 849–893), wrapped in `try/finally` that drains all pending `restore()`s (frontend-defensive push/pop rule). Golden: two overlapping rects (z-order) + a clipping frame. Generate, verify.

### Task 8: rectangle / frame / image fills (cornerPath) + default fill
- [ ] Build the Skia path via `SkiaPathBuilder` + `appendCornerPath` (or `buildCornerPath` ported through the adapter). For each `fill` in `node.style.fills`, make a `Paint`, set color via `colorToSkiaColor4f` (or gradient shader), `canvas.drawPath(path, paint)`, `.delete()` the paint. If no fills, fill with `DEFAULT_FILL` (`#e0e0e0` → `Color4f(0.878,0.878,0.878,1)`; define a named constant). Golden: a frame with a solid fill + an asymmetric-corner rectangle, sRGB and P3 variants.

### Task 9: group / component_instance fills (rect)
- [ ] Fill `LTRBRect(x,y,x+w,y+h)` per fill via `canvas.drawRect`; default fill same. Golden: a group with one fill.

### Task 10: ellipse fills
- [ ] `canvas.drawOval(LTRBRect(cx-rx,...))` per fill; default fill. Preserve full-ellipse behavior (ignore arc_start/end, matching today). Golden: ellipse, sRGB + P3.

### Task 11: strokes (all kinds)
- [ ] Port `resolveStroke(node)` (reuse if exported; else replicate its "first literal-color, positive finite width" logic into a shared helper and unit-test it). Make a stroke `Paint` (`setStyle(ck.PaintStyle.Stroke)`, `setStrokeWidth`, color). Dispatch: ellipse → `drawOval`; frame/rectangle/image → `drawPath(cornerPath)`; group/component_instance/text/path → `drawRect`. Golden: each kind with a stroke.

### Task 12: opacity + blend modes
- [ ] Apply node opacity by wrapping the node's draws in a `canvas.saveLayer(paint)` where `paint.setAlphaf(opacity)` and `paint.setBlendMode(blendModeToSkia(...))`, restored after. Match the old order (opacity+composite affect the whole node). Golden: two overlapping nodes with multiply + 50% opacity.

### Task 13: gradients
- [ ] In the fill loop, when a fill is a gradient, set `paint.setShader(linearGradientShader(...))` (etc.), draw, `.delete()` the shader + paint. Golden: linear, radial, conic gradient fills.

### Task 14: text (Skia Paragraph)
**Files:** Create `frontend/src/canvas/skia-text.ts`; Test `__tests__/skia-text.test.ts`.
- [ ] Map `TextStyle` → Skia `ParagraphStyle`/`TextStyle` (font family via a `FontMgr` built from the app's loaded font buffers — read how fonts are currently provided; for system fonts in 11c-A use `ck.FontMgr.FromData` with the bundled default font, or the existing font-loading path). Build a `ParagraphBuilder`, add text, `layout(width)`, `canvas.drawParagraph(para, x, y)`. Handle `text_align`, `text_decoration` (underline/strikethrough via Skia decoration), and `text_shadow` (Skia text shadow on the TextStyle). `.delete()` paragraph + builder per frame. **Document in a code comment** that text layout is Skia-shaped and may differ sub-pixel from the old Canvas-2D `measureTextLines` (the spec's permitted parity exception). Golden: multi-line wrapped + left/center/right aligned + underlined text.

### Task 15: path kind (preserve placeholder)
- [ ] Match today's behavior exactly: fill the bounding box (`drawRect`) — `path_data` rendering is out of scope for 11c-A (it is a placeholder in the old renderer too). Golden: a path node renders its bbox fill.

Each Task 7–15: generate the golden with `GENERATE_GOLDENS=1`, then run the compare, then commit (`git add` the new test + golden + the `skia-renderer.ts`/`skia-text.ts` change; `git commit -m "feat(frontend): port <kind> to skia (spec-11c-a)"`).

---

## Phase 3 — Integrate, extract chrome, delete the old renderer

### Task 16: `overlay-renderer.ts` (2D chrome)
**Files:** Create `frontend/src/canvas/overlay-renderer.ts`; Test `__tests__/overlay-renderer.test.ts` (reuse the recording `canvas-mock.ts`).
- [ ] Move the chrome functions verbatim from `renderer.ts` (`drawSelectionHighlight`, `drawNameLabel`, `drawSelectionHandles`, `drawPreviewRect`, `drawMarqueeRect`, `drawCompoundBounds`, `drawGuideLines`) plus their constants into `overlay-renderer.ts`. Export one entry: `renderOverlay(ctx, overlayInput)` where `OverlayInput` carries `{ viewport, nodes, depths, selectedUuids, previewRect, previewTransforms, snapGuides, marqueeRect, canvasWidth, canvasHeight }`. It clears the overlay, applies the viewport transform, and runs the selection/preview/guide/marquee passes (old `render` lines 898–938). Move the relevant chrome tests from `renderer.test.ts` into `overlay-renderer.test.ts` (they already use the 2D mock — they pass unchanged once retargeted). Run the moved tests → PASS. Commit.

### Task 17: wire `Canvas.tsx` (two canvases) + `onCleanup`
**Files:** Modify `frontend/src/shell/Canvas.tsx`.
- [ ] Add a second `<canvas>` for the overlay, layered above the Skia canvas (absolute, same box, `pointer-events: none`). The Skia canvas keeps `role="application"`, `aria-label`, `tabindex`, and the pointer handlers; the overlay is decorative (`aria-hidden="true"`, no focusable descendants). In `onMount`: `const renderer = await SkiaRenderer.create(skiaCanvas)`; acquire the overlay 2D ctx via `acquireWideGamut2D(overlayCanvas)`. In the `ResizeObserver`: set both canvases' width/height; call `renderer.resize(w, h, dpr)`. In the render `createEffect`: build the `SceneInput` from the existing signals and call `renderer.renderScene(scene)`, then `renderOverlay(overlayCtx, overlayInput)` from the chrome signals. In `onCleanup`: add `renderer.destroy()`. Manual check: run the app (`pnpm --prefix frontend dev`) — document renders via Skia, selection chrome via overlay. Commit.

### Task 18: delete the old renderer document path
**Files:** Modify/Delete `frontend/src/canvas/renderer.ts`; Modify `frontend/src/canvas/__tests__/renderer.test.ts`.
- [ ] Delete `render`, `drawNode`, and the now-moved chrome functions from `renderer.ts`. Keep any still-imported pure helpers (`clampOpacity`, `blendModeToComposite` if used elsewhere — grep first); if nothing remains, delete the file and update imports. Remove the drawNode/render tests from `renderer.test.ts` (their coverage is replaced by the parity goldens + overlay tests); keep only tests for helpers that still live there. Run the full suite: `./dev.sh pnpm --prefix frontend test` → PASS. Run `./dev.sh pnpm --prefix frontend lint` and `tsc` (via `build`) → no unused/dangling imports. Receipt: `grep -rn "from .*canvas/renderer\"" frontend/src` shows no consumer importing a deleted symbol. Commit.

---

## Phase 4 — Gates: parity set, memory, perf, packaging

### Task 19: full parity fixture set
**Files:** `frontend/src/canvas/__tests__/parity/nodes.test.ts` + goldens.
- [ ] One golden test per spec §14 requirement not already covered: every NodeKind, asymmetric corners (`{x:30,y:10}` AND swapped `{x:10,y:30}`), all three gradient types, all 16 blend modes, nested frame clipping (≥2 deep), sRGB + Display-P3 fills/strokes/text. Each is a direct `withSurface` render + `assertGolden`. Generate all, then run compare. Commit goldens + tests.

### Task 20: per-frame memory leak assertion
**Files:** Modify `skia-renderer.ts` (dev-mode counters); Test `__tests__/skia-renderer-memory.test.ts`.
- [ ] Add `import.meta.env.DEV`-gated counters: increment on every `Make`/`new` Skia object and decrement on `.delete()` within `drawScene`; after each `renderScene`, assert created==deleted (throw in DEV on mismatch). Test: render a scene containing every kind (fills, gradients, text, clips), assert the renderer's `lastFrameCreated === lastFrameDeleted` and both > 0. Run → PASS. Commit.

### Task 21: perf measurement (1000 nodes)
**Files:** `frontend/src/canvas/__tests__/perf/skia-perf.test.ts` (opt-in via env).
- [ ] A non-CI-blocking perf probe: build a 1000-node `SceneInput`, render N frames via a CPU surface (or GPU when run in a browser harness), record median cpu draw ms, and `console.log` it (assert only that it completes without leak). Document that the 60fps GPU guarantee is validated manually via `spikes/canvaskit` + the running app, and reference the spike numbers. Commit.

### Task 22: CSP + packaging
**Files:** Modify `src-tauri/tauri.conf.json`.
- [ ] Set `app.security.csp` to include `script-src 'self' 'wasm-unsafe-eval'` (merge with any existing CSP; do not loosen other directives). Verify the wasm lazy-loads: `grep` the built bundle / confirm the `canvaskit.wasm` is a separate asset not inlined in the entry chunk. Manual: `pnpm --prefix frontend tauri-dev` → editor renders; check devtools that the wasm loads and P3 colors render wide on the P3 display. Commit.

---

## Self-Review (completed by plan author)

**Spec coverage:** SceneRenderer seam (T3), SkiaRenderer + P3 recipe + software fallback + destroy (T6), all NodeKinds/gradients/blend/clip/text ported (T7–15), chrome→2D overlay (T16–17), Canvas-2D deleted (T18), offscreen golden parity harness + full fixture set (T2, T19), memory discipline + assertion (T20), perf (T21), packaging/CSP/lazy-load (T1, T22), dpr clamp constant + enforcement test (T6), no `crates/`/transport change (entirely frontend). The §10 "no shared-type change" receipt is the absence of any `crates/`, `document.ts`, `apply-remote.ts` edit in the diff — confirm at PR time.

**Placeholder scan:** Tasks 7–15 and 16–22 are described as concrete actions with the exact Skia APIs and the old-code behaviors to preserve, but several embed the translation as prose + API names rather than a full code block per micro-step (the per-arm translations are short and mechanical, anchored to the verbatim `drawNode` arms the executor is told to read first). If executing via subagents, the controller MUST require the verbatim old arm + the golden test in each task's dispatch so no arm is guessed.

**Type consistency:** `SceneInput`, `SceneRenderer`, `SkiaRenderer`, `SkiaPathBuilder.finish()`, `colorToSkiaColor4f`, `blendModeToSkia`, `renderOverlay`/`OverlayInput`, `SKIA_MAX_DEVICE_PIXEL_RATIO` are used consistently across tasks.

**Known risk to flag to the human:** text (T14) and the font-loading source need the current font pipeline confirmed before implementation — the plan assumes `FontMgr.FromData` with the app's existing font buffers; verify how fonts reach the renderer today and adjust T14's font acquisition accordingly.
