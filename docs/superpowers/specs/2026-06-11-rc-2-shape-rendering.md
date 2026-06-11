# Spec RC-2 — WebGL2 Shape Rendering

**Date:** 2026-06-11
**Status:** Ready for plan
**Epic:** Render core (custom WebGL2 + hb-gpu). Builds on **RC-1** (foundation/seam/harness). Text is **RC-3**; cutover is **RC-4**. → `docs/superpowers/ROADMAP.md`.
**Technique research:** `docs/superpowers/research/2026-06-11-rc2-webgl2-shape-techniques.md` (Figma-shaped pipeline; PixiJS-style earcut fills).
**Depends on:** RC-1.

## 1. Overview
Render all **document shape content** through the RC-1 WebGL2 foundation at visual parity with the current Canvas-2D renderer: filled paths (rect/frame/ellipse/image bounds + all corner shapes), strokes, linear/radial/conic gradients, images, frame clipping, the 16 blend modes, opacity, and Display-P3 color. Frontend-only; `crates/core` untouched. Text remains on the existing path until RC-3; this spec does NOT wire into `Canvas.tsx` or delete Canvas-2D (RC-4). Each capability is gated by a golden parity test (extending RC-1's SwiftShader/Playwright harness).

## 2. Goals / Non-Goals
**Goals**
- **Fills:** triangulate shape geometry (frontend **earcut**) from the reused `corner-path.ts` / ellipse / rect geometry; draw via the RC-1 pipeline. Default-fill parity.
- **Strokes:** CPU stroke expansion → triangle strips, with analytic **SDF AA** on stroke edges.
- **Corner shapes:** round/bevel/notch/scoop/superellipse via the existing `corner-path.ts` geometry (incl. asymmetric radii) → earcut.
- **Gradients:** shader-analytic linear/radial/conic; stops baked into a **256×1 linear-P3 LUT texture**, hardware-filtered + dithered.
- **Images:** textured quads (`unpackColorSpace='display-p3'`).
- **Clipping:** **stencil-buffer** nested frame clipping (intersection semantics); scissor rect fast-path.
- **Blend modes:** separable (normal/multiply/screen/darken/lighten) via fixed-function blending; non-separable + 4 HSL via **shader backdrop blending** (W3C formulas).
- **Opacity:** node opacity via layer compositing (render-to-texture when a node has <1 opacity or a non-separable blend).
- **Color management:** single **linear Display-P3** working space; convert sRGB/`display_p3` sources at the boundary; composite/gradient/AA/blend in linear P3; gamma last.
- **AA:** WebGL2 **MSAA 4×** (multisampled FBO + blit-resolve) global default.
- Golden parity coverage for every NodeKind/corner/gradient/blend/clip + sRGB & P3.

**Non-Goals**
- Text / hb-gpu (RC-3). Wiring into `Canvas.tsx`, chrome overlay, deleting Canvas-2D, full 60fps gate (RC-4). Arbitrary self-intersecting `path` NodeKind fill (stays a bbox placeholder as today; full path fill — incl. `i_overlay` cleaning + stencil-then-cover fallback — is a later spec). Any `crates/core` change.

## 3. PDR Traceability
**Implements:** the WebGL renderer's shape pipeline (PDR Deferred→scope). **Defers:** text (RC-3), cutover (RC-4), arbitrary path fills (later). **MVP coverage:** none dropped; parity preserved (Canvas-2D remains live until RC-4).

## 4. Architecture
### 4.1 Color management (linear Display-P3 working space)
All blend/gradient/AA/composite math runs in **linear P3**. At the color boundary: `srgb` source → linearize (sRGB EOTF) → sRGB→P3 primaries matrix → linear P3; `display_p3` source → linearize → linear P3 (no primary change). The P3 OETF is applied only at the final write to the P3 drawing buffer. Implement once in a shared GLSL include + a TS color helper mirroring `color-fill.ts`'s discrimination; oklch/oklab keep today's gray fallback. (Spec 18 surface.)

### 4.2 Fills (earcut)
A frontend `tessellate.ts` turns a closed contour (from `corner-path.ts` `appendCornerPath` output, or ellipse/rect) into triangles via **earcut** (pinned dep). Holes supported (earcut multi-ring). Each fill → a draw with the fill's resolved color (or gradient shader). Default fill (`#e0e0e0`) when a shape has no fills, matching the current renderer. Reuse `corner-path.ts` geometry verbatim (incl. the asymmetric-radius cases).

### 4.3 Strokes
CPU stroke expansion (join/cap per the style) → triangle strip; SDF AA on the stroke edge in-shader for crisp lines at any zoom. Stroke resolution mirrors the current `resolveStroke` (first literal-color, positive finite width).

### 4.4 Gradients
One gradient shader family keyed by `gradientKind` uniform: linear (axis projection), radial (distance/transform-to-unit-circle), conic (`atan2`+start angle). Stops baked into a 256×1 RGBA LUT texture built in linear-P3, sampled by `t`, dithered on write to avoid 8-bit banding.

### 4.5 Images
Upload `asset_ref` image to a texture (`unpackColorSpace='display-p3'`); draw a textured quad in the node's transform, clipped by corners (stencil or SDF).

### 4.6 Clipping (stencil)
Nested frame clipping via the stencil buffer: push = increment within the clip shape (written with the §4.2 fill triangulation), draw children where stencil == depth, pop = decrement. Matches today's DFS clip-stack; drained in `try/finally` (push/pop rule). Scissor is a rect-only fast-path + dirty bound.

### 4.7 Blend modes + opacity (layer compositing)
- **Separable** (normal/multiply/screen/darken/lighten): fixed-function `blendFunc`/`blendEquation`, premultiplied alpha, no backdrop read.
- **Non-separable** (overlay, color-dodge, color-burn, hard-light, soft-light, difference, exclusion) + **HSL** (hue/saturation/color/luminosity): render the node to an offscreen layer texture, sample the backdrop, apply the W3C Compositing formula in-shader (shared `Lum`/`ClipColor`/`SetLum`/`SetSat` helpers, mode by int uniform).
- **Node opacity** <1 or any non-separable blend → render the node to a layer texture then composite at the node's opacity/blend (matches the current save→globalAlpha→composite→restore order).
- **`WEBGL_blend_equation_advanced_coherent` is NOT a dependency** — optional fast-path only if §11 probe proves it present+correct; the shader path is the contract.

### 4.8 AA
Scene renders into a **4× MSAA** multisampled FBO (sample count clamped to `MAX_SAMPLES`), resolved via `blitFramebuffer` to the P3 presentation buffer. Analytic SDF AA layered on stroke/corner primitives where it beats MSAA.

### 4.9 Dependencies on RC-1
Uses the RC-1 `gl/` helpers (program/buffer/texture/state), the `SceneRenderer` `renderScene` entry, the P3 framebuffer, and the golden harness. `renderScene` now dispatches per NodeKind to the shape draws (replacing RC-1's rect-only stub).

## 5. WASM Compatibility
**N/A — frontend-only.** No `crates/core` change; no Rust dep added. Tessellation is frontend `earcut` (JS). Receipt: change set touches no `crates/` path.

## 6. Input Validation Inventory
- Every numeric into a vertex/uniform/transform/gradient-stop guarded with `Number.isFinite()` (frontend-defensive); non-finite → documented default + `console.warn`.
- Gradient stop count cap `MAX_GRADIENT_STOPS` (mirror any existing constant; the LUT is fixed 256-wide regardless) + enforcement test.
- MSAA sample count clamped to `gl.MAX_SAMPLES`.
- No new persisted type / deserialization boundary.

## 7. Consistency Guarantees
- **Frame atomicity:** GL state (blend/stencil/scissor/bound FBO/textures) reset at frame start; a draw error is caught, logged, leaves the prior frame; the stencil clip stack drains in `try/finally`.
- **Layer textures** (opacity/blend) are pooled + reused per frame and released on `destroy()`; no per-frame texture leak (dev assertion).
- **Context loss:** layer/MSAA/LUT textures recreated on restore (RC-1 mechanism).

## 8. Recursion Safety
Scene/clip traversal reuses the existing depth-bounded node walk; clip nesting bounded by the document nesting limit. No new unbounded recursion.

## 9. Tool Lifecycle Contract
**N/A** — no new canvas tool.

## 10. Transport Boundary / Cross-Stack Type Extension Inventory
**No shared wire-format type added or changed.** Receipt: change set touches no `crates/`, `frontend/src/types/document.ts`, `apply-remote.ts`, or GraphQL/MCP path.

## 11. Spikes (gating, run on the 3 Tauri webviews: WKWebView/ANGLE-Metal, WebView2/ANGLE-D3D11, WebKitGTK)
1. **`WEBGL_blend_equation_advanced_coherent` availability** (`gl.getSupportedExtensions()` + a correctness draw). Strong prior: absent/unreliable. Outcome only toggles the optional fast-path; the shader-backdrop blend path is implemented regardless.
2. **P3 fragment output / wide-gamut correctness** — confirm `drawingBufferColorSpace='display-p3'` takes and an out-of-sRGB swatch displays saturated, not clamped (overlaps RC-1's P3 readback probe). Record results here before claiming P3 parity.

## 12. Testing — golden parity (extends RC-1's harness)
Golden tests (SwiftShader/Playwright, `readPixels` + pixelmatch) covering: every NodeKind fill; **every corner shape with asymmetric radii** (`{x:30,y:10}` AND swapped) — multi-axis rule; default fill; all three gradient types; **all 16 blend modes** (incl. the 4 HSL via the shader path); nested clipping (≥2 deep); node opacity <1; images; **sRGB and Display-P3** fills/strokes/gradients. Plus unit tests: `tessellate` (a known polygon → expected triangle count/winding; asymmetric corner produces bounded geometry); the color-conversion helper (sRGB→linear-P3 vs display_p3→linear-P3 vectors, with a parity fixture against the Rust color math); MSAA sample clamp; layer-texture leak assertion. Intentional sub-pixel AA differences vs Canvas-2D enumerated, not silently shipped.

## 13. Dependencies
- Frontend: `earcut` (pinned exact, tiny). No other runtime dep.
- Test: RC-1's pinned Playwright/Docker harness.

## 14. Performance
Foundation-level; the 60fps@1000-nodes gate is RC-4 (full scene + chrome). RC-2 asserts the shape draws complete and goldens pass; pool layer/MSAA textures to bound memory.

## 15. Acceptance Criteria
- [ ] Fills (earcut, reused corner geometry incl. asymmetric), strokes (+SDF AA), corner shapes, gradients (LUT+dither), images, stencil clipping, opacity, all 16 blend modes (separable via blendFunc + non-separable/HSL via shader backdrop), MSAA 4× — each with a passing golden.
- [ ] Linear-P3 color management with sRGB + display_p3 source conversion; color-helper unit tests + parity fixture vs Rust math.
- [ ] Both §11 spikes run; results + the resulting P3/blend strategy recorded.
- [ ] `MAX_GRADIENT_STOPS` enforcement test; layer-texture leak assertion; MSAA clamp test.
- [ ] No `crates/` or transport change (receipt per §10). No `Canvas.tsx`/Canvas-2D-deletion (RC-4).

## 16. References
- Techniques: `docs/superpowers/research/2026-06-11-rc2-webgl2-shape-techniques.md`
- RC-1 foundation: `docs/superpowers/specs/2026-06-11-rc-1-webgl2-foundation.md`
- Reused geometry/color: `frontend/src/canvas/corner-path.ts`, `color-fill.ts`; current renderer (RC-4 replaces): `frontend/src/canvas/renderer.ts`
