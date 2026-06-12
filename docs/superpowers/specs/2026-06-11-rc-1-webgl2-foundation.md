# Spec RC-1 — WebGL2 Render Foundation + SceneRenderer Seam

**Date:** 2026-06-11
**Status:** Ready for plan
**Epic:** Render core (custom WebGL2 + hb-gpu). RC-1 is the foundation; RC-2 (shapes), RC-3 (hb-gpu text), RC-4 (integration + delete Canvas-2D) build on it. → `docs/superpowers/ROADMAP.md`.
**Carries over from** the superseded `2026-06-10-11c-a-canvaskit-render-core.md`: the `SceneRenderer` seam, the Display-P3 framebuffer recipe, the offscreen golden parity harness, the per-frame resource discipline, the chrome-on-2D-overlay split, and the frontend-only / WebGL2-required / delete-Canvas-2D posture.
**Infra backing:** `docs/superpowers/research/2026-06-11-render-core-infra-decisions.md` (GL-in-CI via SwiftShader/Playwright; P3 readback probe).

## 1. Overview
Stand up a custom WebGL2 rendering foundation behind a `SceneRenderer` seam, with a Display-P3 framebuffer, a small in-repo WebGL helper layer (no external GL dependency), viewport/DPR handling, redraw-on-change, and a `destroy()` lifecycle. Ship the **golden-image parity harness** (Playwright + headless Chromium + SwiftShader, `gl.readPixels` + pixelmatch) and prove the pipeline end-to-end by rendering one primitive — a solid-color filled rectangle — at parity. No shapes-beyond-rect, no text (RC-2/RC-3). Frontend-only; `crates/core` untouched.

## 2. Goals / Non-Goals
**Goals**
- `SceneRenderer` interface + a `WebGLRenderer` implementing the foundation (context, seam, lifecycle).
- WebGL2 context with a **Display-P3** drawing buffer (validated recipe), `alpha:false` for goldens determinism.
- A small internal `gl/` helper module: program compile/link, uniform/attribute/buffer/VAO/texture helpers — no external dependency (raw WebGL2).
- Viewport/DPR transform applied as a uniform; `MAX_DEVICE_PIXEL_RATIO` clamp.
- Redraw-on-change (no persistent rAF); `destroy()` reclaims all GL resources + context.
- **WebGL2-required**: detect absence and surface a clear unsupported state (no software fallback in production).
- The SwiftShader/Playwright golden harness + the **P3 readback probe** (gating).
- One primitive — a filled rect — rendered at parity (its golden), proving clear→transform→draw works in P3.

**Non-Goals (later RC specs)**
- Paths/fills/strokes/corners/gradients/images/clipping/blend modes (RC-2).
- Text / hb-gpu / Emscripten build (RC-3).
- Wiring into `Canvas.tsx`, chrome overlay, deleting the Canvas-2D renderer, full parity set, 60fps perf gate (RC-4).
- Any `crates/core` change.

## 3. PDR Traceability
**Implements:** the PDR "WebGL canvas renderer" (Deferred→scope) foundation. **Defers:** shapes (RC-2), text (RC-3), cutover (RC-4). **MVP coverage:** none dropped — RC-1 adds a parallel renderer foundation without removing the Canvas-2D path (cutover is RC-4).

## 4. Architecture
### 4.1 `SceneRenderer` seam (carried over)
`frontend/src/canvas/scene-renderer.ts`: `interface SceneRenderer { renderScene(scene: SceneInput): void; resize(cssW, cssH, dpr): void; destroy(): void }`. `SceneInput` = readonly `{ viewport, nodes, depths, dpr, tokens }` (document content only; chrome excluded). The interface exposes no WebGL types — consumers depend only on the plain data. RC-1 ships `WebGLRenderer implements SceneRenderer`; in RC-1 `renderScene` clears + draws only `rectangle` nodes' first solid fill (the rest no-op until RC-2).

### 4.2 WebGL2 context + Display-P3 (validated recipe)
```ts
const gl = canvas.getContext("webgl2", { colorSpace: "display-p3", alpha: false, antialias: true,
  premultipliedAlpha: false, preserveDrawingBuffer: false });
if (!gl) { /* surface WebGL2-required state; do not throw into the app */ }
if ("drawingBufferColorSpace" in gl) gl.drawingBufferColorSpace = "display-p3";
```
`alpha:false` + fixed `premultipliedAlpha` make goldens deterministic. P3 colors are emitted in the fragment shader (RC-2 handles color math; RC-1's rect uses a uniform color). The exact P3 encoding for `readPixels` goldens is resolved by the §11 probe.

### 4.3 Internal GL helper (`frontend/src/canvas/gl/`)
No external dep. Modules: `program.ts` (compile/link with error surfacing), `buffer.ts` (VBO/VAO), `texture.ts` (incl. texture-buffer for RC-3's glyph atlas), `state.ts` (blend/scissor/viewport setters). Each function throws a typed `GlError` with the shader/link log on failure (surfaced, never swallowed). Unit-tested via the headless GL harness.

### 4.4 Viewport / DPR / transform
The camera (`viewport.zoom`, `viewport.x/y`) + DPR compose into a 3×3 (or 4×4) transform passed as a uniform; vertices are in world space, the shader maps to clip space. `MAX_DEVICE_PIXEL_RATIO` (=3) clamps `dpr` before sizing the drawing buffer (`canvas.width = cssW * clampedDpr`).

### 4.5 Redraw-on-change + lifecycle
`renderScene` is called by the owner's reactive effect on scene change (no internal rAF). `destroy()` deletes all programs/buffers/VAOs/textures, removes any listeners, and calls `loseContext()` (`WEBGL_lose_context`). Handle `webglcontextlost` (preventDefault + stop rendering) and `webglcontextrestored` (recreate GL resources). Idempotent `destroy()`.

### 4.6 WebGL2-required
A `createWebGLRenderer(canvas)` returns either the renderer or a typed `WebGL2Unavailable` result; the owner renders a clear "This editor requires WebGL2" message (accessible, see §12). No Canvas-2D fallback.

## 5. WASM Compatibility
**N/A — frontend-only.** No `crates/core` change; no `wasm32-unknown-unknown` Rust dependency added. (Receipt: the change set touches no file under `crates/`.) The hb-gpu WASM is RC-3, not RC-1.

## 6. Input Validation Inventory
- `MAX_DEVICE_PIXEL_RATIO` (=3) — clamps dpr before buffer sizing; enforced where the buffer is sized; `test_max_device_pixel_ratio_enforced`.
- Every numeric fed into a transform/uniform guarded with `Number.isFinite()` (frontend-defensive); non-finite → documented default + `console.warn`.
- No new persisted type / deserialization boundary (the scene is the existing validated model).

## 7. Consistency Guarantees
- **Frame atomicity:** a draw error in `renderScene` is caught, logged, and leaves the previous frame; GL state (blend/scissor/bound buffers) is reset at frame start so a prior error can't corrupt the next frame.
- **Context loss:** on `webglcontextlost`, stop drawing; on restore, recreate resources. No partial state leaks.
- **No new undoable ops / bounded collections** introduced.

## 8. Recursion Safety
No new recursion. The (eventual) scene walk reuses the existing depth-bounded node traversal; RC-1's `renderScene` is a flat loop over nodes drawing only rects.

## 9. Tool Lifecycle Contract
**N/A** — no new canvas tool; tools are unaffected (they mutate the document model; RC-1 only changes how content is drawn, and only behind a not-yet-wired renderer).

## 10. Transport Boundary / Cross-Stack Type Extension Inventory
**No shared wire-format type added or changed.** RC-1 introduces no field on any document type and no transport change. Receipt: the PR `git diff --name-only` contains no path under `crates/`, `frontend/src/types/document.ts`, `apply-remote.ts`, or any GraphQL/MCP resolver.

## 11. Testing — golden harness + P3 probe (the receipt; ships in RC-1)
- **Harness:** Playwright (pinned exact version → pins Chromium) + headless Chromium with `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader --no-sandbox --disable-gpu`, run in the Playwright Docker image **pinned by digest**; the `./dev.sh` container is/extends that image so local == CI. Render a fixture, `gl.readPixels` from the WebGL2 framebuffer → PNG → **pixelmatch** vs committed goldens (`threshold:0.1`, `allowedMismatchedPixelRatio:0.01`; relax toward three.js's `0.2`/`5%` only if SwiftShader edge-AA proves flaky). Runner: Vitest 4 browser mode (Playwright provider) with a custom `readPixels→PNG` step. Goldens regenerated only via a deliberate version-bump PR.
- **First golden:** a solid-color rect on a known background, sRGB.
- **P3 readback probe (gating task — resolve before claiming P3 golden coverage):** set `drawingBufferColorSpace='display-p3'`, clear to a known P3-red, `readPixels`, record the returned bytes. Per the infra note, branch on the outcome: (1) P3 honored → store P3 goldens w/ colorspace metadata; (2) sRGB-converted readback → sRGB goldens + P3 as an upstream encoding concern; (3) P3 ignored headless → P3 parity is covered by **Rust color-math unit tests (Spec 18 surface) + a manual GPU smoke**, NOT headless goldens. Record the probe result in this spec's testing section before marking P3 done (PR #67 P3 history).
- **Unit tests:** the `gl/` helpers (program compile error surfaces a typed `GlError`; buffer/texture round-trip); `destroy()` lifecycle (resources deleted, context lost, idempotent); `test_max_device_pixel_ratio_enforced`; WebGL2-unavailable returns the typed unsupported result.

## 12. Accessibility
The WebGL canvas keeps `role="application"` + `aria-label` (carried from the current canvas; preserved through the renderer swap per the UI-rewrite a11y audit rule). The WebGL2-unavailable message is real DOM text (not canvas-painted), in a `role="status"`/`role="alert"` region, keyboard-reachable. (Canvas text-alternative for screen readers remains the pre-existing gap tracked at the epic level — not introduced or regressed by RC-1.)

## 13. Dependencies
- No external runtime dependency (raw WebGL2 + internal `gl/` helpers).
- Dev/test: `@playwright/test` pinned exact; Playwright Docker image pinned by digest; `pixelmatch` (Vitest-native). Pin per CLAUDE.md §1.

## 14. Performance
RC-1 is the foundation; the 60fps@1000-nodes gate is RC-4 (full scene). RC-1 asserts only that the rect-render path completes and the harness runs. Establish the redraw-on-change model (no idle rAF) as the baseline.

## 15. Acceptance Criteria
- [ ] `SceneRenderer` seam + `WebGLRenderer` foundation; `destroy()` reclaims all GL resources + loses context; idempotent.
- [ ] WebGL2 context with Display-P3 drawing buffer via the §4.2 recipe; `alpha:false` goldens.
- [ ] Internal `gl/` helper modules with typed `GlError` surfacing; unit-tested.
- [ ] Viewport/DPR transform uniform; `MAX_DEVICE_PIXEL_RATIO` clamp + enforcement test.
- [ ] Redraw-on-change; context-loss/restore handled.
- [ ] WebGL2-required path: typed unavailable result + accessible message.
- [ ] Golden harness (SwiftShader/Playwright/readPixels/pixelmatch, pinned by digest) green on the rect golden.
- [ ] P3 readback probe run; its outcome + the resulting P3-golden strategy recorded in §11.
- [ ] No `crates/` or transport change (receipt per §10).

## 16. References
- Superseded design (reusable parts): `docs/superpowers/specs/2026-06-10-11c-a-canvaskit-render-core.md`
- Infra: `docs/superpowers/research/2026-06-11-render-core-infra-decisions.md`
- Current renderer (RC-4 replaces; RC-1 does not touch): `frontend/src/canvas/renderer.ts`, `frontend/src/shell/Canvas.tsx`
- Reused (RC-2+): `frontend/src/canvas/corner-path.ts`, `color-fill.ts`, `viewport.ts`, `render-order.ts`
