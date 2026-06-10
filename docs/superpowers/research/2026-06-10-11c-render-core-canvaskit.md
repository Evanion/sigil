# Architecture Research & Decision Notes — 11c-A Render Core (CanvasKit/Skia)

**Date:** 2026-06-10
**Status:** Pre-spec analysis (brainstorming phase). Informs the 11c-A spec.
**Question:** Replace the Canvas-2D renderer with a GPU renderer based on CanvasKit (Skia WASM, WebGL2 backend). What's the right architecture, and how does it fit the project's rules/pillars?

## Context (verified)
- Today: one Canvas-2D `render()` free function in `frontend/src/canvas/renderer.ts`, called directly by `Canvas.tsx`. **No renderer abstraction exists.**
- Parity surface: 8 NodeKinds, per-corner shapes (`corner-path.ts`), linear/radial/conic gradients, frame clipping (DFS clip-stack), 16 blend modes, text via `fillText`/`measureText`, plus selection/marquee/snap/handle chrome.
- **Display-P3 already ships (Spec 18)** across ~19 files / ~73 references via `colorToCss()`. Hard parity requirement.
- Ships as: Vite web SPA + Tauri 2.x desktop (`wry` → WKWebView/WebKitGTK/WebView2) + containerized server. Perf bar: 60fps @ 1000 nodes; startup <1s; limited-resource containers.
- PDR lists "WebGL canvas renderer" as **Deferred**, with "upgrade path to WebGL" as the intended evolution → this epic **promotes a deferred item into scope** (must be documented in PDR Traceability per §10).
- Executor = local 30B model driven like Sonnet → minimize hand-rolled, parity-sensitive, discipline-heavy surface.

## External research findings (canvaskit-wasm @ 0.41.1, BSD-3-Clause)
1. **GPU = WebGL2 only.** WebGPU was removed from CanvasKit (Chromium M118); Dawn now lives only in Skia's Graphite backend, which has **no CanvasKit integration and no roadmap**. Adopting CanvasKit = WebGL2 indefinitely. (Makes the earlier hb-gpu/WebGPU note moot — Skia owns shaping anyway.)
2. **Bundle:** default `canvaskit.wasm` ≈ 7.2 MB raw / **2.8 MB Brotli** over the wire. Lazy-loadable, local-serveable (fine for Tauri). Slim custom builds require DIY Skia compilation.
3. **Display-P3 = NOT guaranteed.** Color-space constants exist, but getting P3 pixels to screen via a WebGL CanvasKit surface is browser/compositor-limited; surfaces frequently end up effectively sRGB and silently gamut-clip. **Must validate empirically** — this is the biggest correctness risk given Spec 18.
4. **Text/OpenType: strong.** Bundled HarfBuzz; `TextStyle.fontFeatures` (4-char tags + int value) = full `font-feature-settings`; `fontVariations` for variable fonts; fonts loaded via `FontMgr.FromData` (no system fonts). → **Skia owns shaping/SDF; the old HarfBuzz/regl/SDF dependencies become redundant.**
5. **Tauri offline:** bundle `.wasm` locally; verify the custom protocol serves `application/wasm` (else streaming-compile falls back to slower arrayBuffer path).
6. **Headless CI:** software (CPU) surface runs headless in Node, deterministic PNGs (`makeImageSnapshot`/`encodeToBytes`) → snapshot harness is feasible. Pin version; baseline against software surface only; small per-pixel tolerance.
7. **Manual memory management = #1 gotcha.** Every Skia object (Paint/Path/Surface/Image/Shader/Paragraph/Typeface) must be explicitly `.delete()`'d; GC won't reclaim. Flutter built ref-counting + FinalizationRegistry layers. **Acute risk for a 30B executor** — needs an RAII-style dispose discipline baked into the design, not per-call vigilance.
8. **Main-thread jank.** Default CanvasKit paints on the main thread; Flutter migrated to worker-based Skwasm for this reason. 60fps @ 1000 nodes may require OffscreenCanvas + Web Worker from day one.
9. **Cadence:** slow (~annual). 0.41 made `Path` immutable (`PathBuilder`). Pin exact version; loader and `.wasm` must match.

## Recommended architecture (from Architect analysis, scored against §1 Design Decision Criteria)
1. **Abstraction = thin `SceneRenderer` seam, single `SkiaRenderer` impl, Canvas-2D deleted.** The seam (the swap point) is justified by a *future* backend (e.g. a later Graphite/WASM-core renderer), NOT by keeping legacy. This is the "seam without legacy" synthesis — satisfies the user's "delete old code / never deprecate" rule AND the engineering value of isolation. Interface passes a readonly **scene data structure**, never a 2D context.
2. **One renderer, capability-gated backend: WebGL2-GPU → Skia-software fallback (NOT Canvas-2D).** Same Skia code = same pixels on both backends, so there's no second pixel pipeline to keep at parity. 60fps@1000 is a **GPU-path** guarantee; software path gets a separate degraded target + a one-shot `role="status"` notice.
3. **11c-A ports document content to Skia; UI chrome stays on a separate 2D overlay canvas.** Chrome redraws per pointer-move while the scene is static; coupling them forces full scene re-render on drag. Reuse `corner-path.ts` geometry (don't reimplement in shaders).
4. **Mandatory snapshot-parity harness ships in the same PR** as the renderer (the §11 machine-verifiable receipt). Fixtures: every NodeKind, asymmetric corners (multi-axis rule), every gradient, all 16 blend modes, nested clipping, **sRGB + Display-P3**, wrapped/aligned/decorated text. Generated on a pinned software backend in CI.
5. **Re-cut the epic:** 11c-A = render core (frontend-only, no `crates/core` change). 11c-B = OpenType features (data model + transports + UI), now that Skia owns shaping. Supersede the old `2026-06-10-11c-webgl-text-rendering.md` (text-only framing, wrong seam, live-2D-fallback, fabricated PDR IDs/SHAs) rather than extend it.

## Top risks → must validate before committing a full plan
- **R1 (Correctness): Display-P3 to screen via CanvasKit/WebGL in the Tauri webview.** Validate with a known-P3 swatch + pixel sample. If it silently clips to sRGB, that's a Spec 18 regression.
- **R2 (Performance): 60fps @ 1000 nodes on the main thread.** If it janks, we need OffscreenCanvas+worker architecture from day one — a materially bigger design.
- **R3 (Robustness/feasibility): memory-management discipline.** Design an RAII dispose wrapper / per-frame arena so the executor can't leak. This is a design requirement, not an afterthought.
- **R4 (Tauri): `application/wasm` MIME under the custom protocol** for streaming compile.

## Spike results (2026-06-10, harness in `spikes/canvaskit/`)
Run on a real Apple M1 Pro MacBook with a **P3 display**, in headed **Safari (WebKit/Apple GPU)** and **Chrome (ANGLE/Metal)** — both reported `color-gamut: p3`.

- **R2 perf — GREEN.** 1000 mixed nodes (rrects + bézier + text, per-node transforms): cpuDraw median **3 ms** (Safari p95 6 ms, Chrome p95 6.8 ms), ~59–60 fps. ~4–5× headroom under 16.7 ms. No worker needed for v1.
- **R3 memory — GREEN.** 235 Skia objects created and deleted **every frame, zero leaks**, via reuse-Paint + delete-per-frame. The dispose discipline is tractable and must be a design rule.
- **R4 Tauri wasm — GREEN (one setup line).** Tauri 2 serves `.wasm` as `application/wasm` via content-sniffing; graceful arrayBuffer fallback otherwise. **Required:** add `'wasm-unsafe-eval'` to `script-src` whenever a CSP is set. Optional: custom URI-scheme protocol for extension-guaranteed MIME.
- **R1 Display-P3 — RED on the obvious path.** `MakeOnScreenGLSurface(grCtx, w, h, DISPLAY_P3)` returns **null in BOTH Safari and Chrome on a real P3 display** (sRGB surface created fine; `drawingBufferColorSpace` reports `srgb` even when `display-p3` requested). Skia's gamut *math* runs, but a native P3 on-screen GPU surface **cannot be allocated** on the macOS/Metal WebGL2 backend (incl. WebKit = the Tauri webview). **As-is, CanvasKit would gamut-clip P3 to sRGB → a visible regression vs Spec 18's shipped `color(display-p3 …)`.**
  - **Untested alternative P3 paths** (the spike tested only the obvious one): (a) pass P3 attrs to `GetWebGLContext` so the Skia-owned GL context's drawing buffer is P3; (b) render to an **extended-sRGB / RGBA_F16** offscreen render target (float surfaces often carry wide gamut where RGBA8 on-screen does not) then present; (c) set `drawingBufferColorSpace='display-p3'` on the context Skia actually uses. One of these may work — needs a focused P3 spike iteration before the engine is locked.

**Net (initial):** perf, memory, wasm cleared; P3 failed on the obvious path.

### P3 resolution (probe `spike-p3.mjs`, Safari + Chrome on real P3 display)
The naive failure was because CanvasKit's `GetWebGLContext` grabbed a **default sRGB** WebGL2 context. **Fix found and confirmed in both WebKit and Chrome:**
- **Working recipe (strategy C):** create the WebGL2 context explicitly with `{ colorSpace: 'display-p3' }`, set `gl.drawingBufferColorSpace = 'display-p3'`, THEN `GetWebGLContext(canvas)` → `MakeGrContext` → `MakeOnScreenGLSurface(grCtx, w, h, ColorSpace.DISPLAY_P3)`. Result: `surfaceCreated: true` **and** `drawingBufferColorSpace: 'display-p3'` (genuine P3 buffer + P3 surface).
- **Color management verified (strategy B, offscreen RGBA_F16 + DISPLAY_P3):** sRGB-red drawn into a P3 surface reads back `[0.917, 0.200, 0.139]` in P3 space and round-trips to `[1,0,0]` in sRGB — correct gamut transform.
- **Caveat for the harness:** on-screen surfaces can't be `readPixels`'d after buffer swap (return black) — the **parity/snapshot harness must render offscreen** (RGBA_F16 or readback-capable render target), which reads back correctly.

### Final spike verdict — all four risks cleared
- **R1 Display-P3: GREEN** via P3-configured GL context (strategy C). Works in WebKit (= Tauri webview) + Chrome on a real P3 display. **Spec must encode the exact context-config recipe.**
- **R2 perf: GREEN** (~3 ms/frame @ 1000 nodes; no worker needed for v1).
- **R3 memory: GREEN** (reuse-Paint + delete-per-frame; zero leaks).
- **R4 Tauri wasm: GREEN** (`application/wasm` served by content-sniffing; required `'wasm-unsafe-eval'` CSP entry).

**Decision: CanvasKit is viable for Sigil.** Proceed to write the 11c-A spec with: the P3 context-config recipe (strategy C) as a hard requirement; the offscreen-readback parity harness; the `'wasm-unsafe-eval'` CSP entry; the reuse-Paint/delete-per-frame memory discipline; WebGL2-required with Skia-software fallback; document-content-to-Skia with UI chrome on a 2D overlay; and the `SceneRenderer` seam with Canvas-2D deleted.
