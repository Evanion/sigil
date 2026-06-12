# hb-gpu Spike — Findings (vs CanvasKit)

**Date:** 2026-06-11 · Apple M1 Pro, Chromium/ANGLE-Metal, WebGL2 · HarfBuzz 14.2.0 · throwaway spike (artifacts in `spikes/hb-gpu/`).
**Context:** issue #43 (Behdad recommended hb-gpu). Evaluated apples-to-apples with the CanvasKit spike.

## What hb-gpu is
Text-only GPU rasterizer (Slug analytic coverage): CPU shaping → CPU outline/COLR encode → GPU fragment-shader rasterization, **no glyph atlas**. Renders glyphs only — needs a separate shape renderer for paths/fills/images. C API (~6 calls), ships GLSL/WGSL/MSL/HLSL shaders; you own the GL context. MIT-licensed; Slug algorithm public-domain since 2026-03.

## Measured results
- **Bundle size (measured over the wire):** wasm 210 KB gzip / 489 KB decoded + JS glue 34 KB gzip → **~244 KB gzip total**. CanvasKit is **~2.8 MB gzip / 7–9 MB raw** → hb-gpu is **~12× smaller gzipped, ~15× raw.** Biggest single differentiator; directly serves the "<1s startup" + "limited-resource containers" pillars. (~0.05 KB encoded per glyph.)
- **COLRv1 color emoji: WORKS** on WebGL2 — gradients, ZWJ sequences, and **two distinct skin-tone modifiers composed correctly** (`05-colrv1-emoji.png`). This is CanvasKit's genuine web weakness (COLRv1 reportedly broken in CanvasKit's web path).
- **Resolution-independent sharpness @60fps:** extreme zoom keeps analytic-AA crisp edges, no atlas blockiness (`03-zoom-in-sharpness.png`). Ideal for a zoomable design canvas.
- **WebGL2 production-functional** (WebGPU also available). 
- **Display-P3 achievable:** a WebGL2 canvas accepts `drawingBufferColorSpace="display-p3"` (same recipe CanvasKit used); P3 is the app's framebuffer/shader responsibility. No hb-gpu-side blocker.
- **Compositing/z-order:** hb-gpu draws into a context **you own** → text + a custom WebGL2 shape renderer share one context with correct **per-node z-order** (shared depth buffer). Reasoned from API + demo, not built. (This is why CanvasKit+hb-gpu is the trap — Skia owns its GL state.)

## Costs / caveats
- **Text-only → choosing hb-gpu means building a custom WebGL2 SHAPE renderer too** (tessellated fills/strokes/corners/gradients/images/clipping/P3). This is the big scope item — you build the whole renderer, not adopt CanvasKit.
- **No packaged JS/WASM wrapper.** Requires an Emscripten build of HarfBuzz-with-`-DHB_HAS_GPU` (emsdk) + a TS WebGL2 host (compile shaders, glyph-encode atlas + (font,gid)→offset cache, instanced quads, viewport/DPR, paint-vs-draw programs). Integration effort: **medium-high**. (Local build not attempted — no emsdk in the spike env; sizes are real wire measurements.)
- **Experimental** (14.2: "expected to graduate… in the near future"; API shifted 14.0→14.2).
- **Bitmap color fonts (CBDT/sbix/PNG) unsupported** — outline + COLR only (fine for Sigil).

## Bottom line
hb-gpu decisively wins on **bundle size (~12×), COLRv1 emoji, and zoom sharpness**, with P3 and per-node z-order achievable in a custom WebGL2 renderer. The cost is **building the whole custom WebGL2 renderer** (shapes) + the hb-gpu host + an Emscripten build, on experimental tech. CanvasKit wins on **drop-in maturity and the already-validated P3/perf**, at ~12× the bundle and weak web emoji.

Decision pending: CanvasKit-everything (lower build effort, bigger/weaker) vs custom WebGL2 + hb-gpu (the issue #43 path, tiny + best text, but build the whole renderer). Fonts-1 is unaffected either way. The `SceneRenderer` seam keeps it a backend choice.
