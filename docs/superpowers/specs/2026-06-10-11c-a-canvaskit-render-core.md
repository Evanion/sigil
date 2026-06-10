# Spec 11c-A — CanvasKit Render Core

**Date:** 2026-06-10
**Status:** Ready for plan
**Supersedes:** `2026-06-10-11c-webgl-text-rendering.md` (text-only WebGL/HarfBuzz/regl framing — wrong seam, live-2D-fallback, fabricated references). That file is to be deleted.
**Epic:** WebGL/GPU rendering (PDR "WebGL canvas renderer", promoted from Deferred → scope). Decomposed into:
- **11c-A (this spec):** CanvasKit/Skia render core — replace the Canvas-2D renderer; port all document content to Skia at visual parity; text renders via Skia at *current* behavior. Frontend-only.
- **11c-B (next spec):** OpenType features — `TextStyle.font_features` + transports + typography-panel UI, fed into Skia's shaper.

Research and validation backing this spec: `docs/superpowers/research/2026-06-10-11c-render-core-canvaskit.md` (all four load-bearing risks validated on real hardware via `spikes/canvaskit/`).

---

## 1. Overview

Replace Sigil's single Canvas-2D rendering function with a GPU renderer built on **CanvasKit** (Skia compiled to WASM, WebGL2 backend), pinned to `canvaskit-wasm@0.41.1`. Introduce a minimal `SceneRenderer` abstraction with exactly one implementation (`SkiaRenderer`) and delete the Canvas-2D document-drawing path in the same change. All document content (shapes, fills, strokes, corner shapes, gradients, images, clipping, Display-P3 color, and text at current behavior) renders through Skia at visual parity with today's output. Selection/marquee/snap-guide chrome stays on a separate 2D overlay canvas.

This is a **frontend-only** change. `crates/core` is not touched; the WASM constitution (§1/§4) is preserved.

## 2. Goals / Non-Goals

**Goals**
- A `SceneRenderer` interface + `SkiaRenderer` implementation replacing `frontend/src/canvas/renderer.ts`'s `render()`/`drawNode()` document-drawing path.
- Visual parity with the current Canvas-2D renderer for all 8 `NodeKind` variants, all corner shapes, all gradient types, all 16 blend modes, nested frame clipping, images, and **Display-P3 + sRGB** color — verified by a machine-checkable offscreen golden-image parity harness shipped in the same PR.
- WebGL2-GPU rendering with a Skia-software fallback (no Canvas-2D fallback).
- The Canvas-2D document renderer deleted (no legacy/dual renderer).
- 60fps for 1000 nodes on the GPU path (per §1 Performance).

**Non-Goals (deferred to 11c-B — see §11)**
- `TextStyle.font_features` field, OpenType feature toggles, `font-feature-settings` parity, feature-detection UI. Text in 11c-A renders with **today's behavior** (same shaping the current renderer produces; no new feature control).
- Moving selection/marquee/snap chrome into Skia (stays on the 2D overlay).
- WebGPU (unavailable in CanvasKit; WebGL2 only — documented in the research note).
- Any `crates/core` change.

## 3. PDR Traceability

**Implements:** PDR "Canvas Engine" upgrade path — *"HTML5 Canvas 2D for MVP. Upgrade path to WebGL for performance"* — promoting the PDR-**Deferred** item *"WebGL canvas renderer"* into scope. Rationale: the GPU renderer is the prerequisite for OpenType typography (11c-B, issue #43) and for the performance pillar at scale.

**Defers:** OpenType feature support (11c-B). WebGPU backend (not available in CanvasKit; revisit if Skia Graphite ships a CanvasKit integration).

**MVP coverage:** No MVP-scope capability is dropped — this preserves all current rendering behavior (the parity harness is the proof) while changing the rendering backend. P3 (Spec 18) is explicitly preserved via the validated context-config recipe (§4.4).

## 4. Architecture

### 4.1 The `SceneRenderer` seam
A minimal interface in `frontend/src/canvas/scene-renderer.ts`:

```ts
export interface SceneRenderer {
  // Render the full document scene for one frame. Input is a readonly data
  // structure (nodes, draw order, resolved tokens, viewport) — NOT a 2D context.
  renderScene(scene: ReadonlyScene): void;
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  destroy(): void; // reclaim GPU surface, GrContext, listeners, rAF
}
```

The seam exists for a *future* backend (e.g. a later Graphite/WASM-core renderer), not to retain Canvas-2D. Exactly one implementation ships: `SkiaRenderer`. The interface MUST NOT leak `CanvasRenderingContext2D` or any Skia type — consumers depend only on `SceneRenderer` + the plain `ReadonlyScene` data.

### 4.2 `SkiaRenderer` (`frontend/src/canvas/skia-renderer.ts`)
Owns CanvasKit init, the `Surface` + `GrDirectContext`, and the node→Skia command mapping (a 1:1 port of today's `drawNode` logic, drawing with `canvas.drawPath/drawImageRect/save/restore/clipPath` instead of Canvas-2D calls). Reuses existing renderer-independent math: `corner-path.ts` (corner geometry — feed its output into a Skia `Path`), `text-measure.ts`, `color-fill.ts` color resolution, hit-testing, snapping. These are NOT reimplemented.

### 4.3 Backend selection & fallback
1. Try WebGL2-GPU surface (see 4.4). If it succeeds → GPU path (60fps@1000 guarantee).
2. If WebGL2 is unavailable/unstable → CanvasKit **software** surface (`MakeSWCanvasSurface`). Same Skia drawing code → same pixels; this is a backend choice, not a second renderer. The software path carries a **degraded** perf target (§15), not the 60fps guarantee, and surfaces a one-shot `role="status"` notice (non-high-frequency, per a11y-rules).
3. There is **no Canvas-2D fallback.** The Canvas-2D document renderer is deleted.

### 4.4 Display-P3 (validated recipe — hard requirement)
The GPU surface MUST be created with a P3-configured WebGL2 context, or P3 colors gamut-clip to sRGB (a Spec 18 regression). Validated recipe (confirmed in WebKit + Chrome on a real P3 display):

```ts
const gl = canvas.getContext('webgl2', { colorSpace: 'display-p3', alpha: true });
if (gl && 'drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = 'display-p3';
const handle = CanvasKit.GetWebGLContext(canvas);
const grCtx  = CanvasKit.MakeGrContext(handle);
const surface = CanvasKit.MakeOnScreenGLSurface(grCtx, w, h, CanvasKit.ColorSpace.DISPLAY_P3);
```

`colorToCss()`'s P3 values map to Skia `Color4f` in the DISPLAY_P3 surface space. The parity harness MUST include P3 fixtures (§14). Note: on-screen surfaces cannot be `readPixels`'d after buffer swap — the harness renders **offscreen** (RGBA_F16 render target) where readback is correct.

### 4.5 Document-content vs UI-chrome boundary
`SceneRenderer`/`SkiaRenderer` render **document content only** (the current `drawNode` surface). Selection highlight, handles, marquee, guide lines, compound bounds, name labels, preview rect — the high-frequency interaction chrome — stay on a **separate 2D overlay canvas** layered above the Skia canvas, redrawn cheaply on pointer events without re-rendering the GPU scene. Two stacked canvases: Skia document scene below, 2D chrome above.

### 4.6 Integration points (exact)
- `frontend/src/shell/Canvas.tsx` — replace the `import { render } from "../canvas/renderer"` call site with a `SkiaRenderer` instance; call `renderScene` from the existing reactive effect; call `destroy()` in `onCleanup`.
- `frontend/src/canvas/renderer.ts` — **delete** the `render()` + `drawNode()` document-drawing path (chrome-drawing functions move to the overlay module). No Canvas-2D document drawing remains.
- No new files outside `frontend/src/canvas/` and the parity-harness test dir. No orphaned/parallel modules (the plan enforces integration gates).

### 4.7 Memory-management contract (validated pattern — mandatory)
Every CanvasKit object created (`Paint`, `Path`/`PathBuilder`, `Image`, `Shader`, `Paragraph`/`TextBlob`, `Surface`, `GrDirectContext`) holds WASM heap memory and MUST be explicitly `.delete()`'d — GC does not reclaim it. Required discipline (validated: 235 objects/frame, zero leaks):
- Long-lived, reused: `Surface`, `GrDirectContext`, fill `Paint`, text `Paint`, `Font`/`Typeface`.
- Per-frame allocations (`PathBuilder`+`Path`, `TextBlob`, `Shader` for gradients): `.delete()`'d **in the same frame** that created them.
- `SkiaRenderer.destroy()` deletes all long-lived objects and the surface/context, removes listeners, and cancels any rAF.
- A dev-mode assertion (created-count == deleted-count per frame) guards against regressions.

## 5. WASM Compatibility
**N/A — frontend-only.** This spec adds **zero** `wasm32-unknown-unknown` Rust dependencies to `crates/core`; `crates/core` is not modified. CanvasKit is a browser-side frontend asset (it does not touch the core crate). The §10 core-WASM checklist does not apply. (Receipt: the change set touches no file under `crates/`.)

## 6. Input Validation Inventory
This spec introduces no new persisted data type, deserialization boundary, or user-facing parameter (the scene it renders is the existing validated document model). New limits:
- **Glyph/resource caching:** Skia manages its own internal glyph atlas; no app-level glyph cache is introduced in 11c-A. No app-level cache constant is therefore defined here (deferred until a measured need arises).
- **devicePixelRatio clamp:** the backing surface size is `cssSize * dpr`; `dpr` MUST be clamped to a sane max (named constant `MAX_DEVICE_PIXEL_RATIO`, e.g. 3) before sizing the surface to avoid pathological allocations on misreporting displays. Enforced where the surface is sized; test `test_max_device_pixel_ratio_enforced`.
- All numeric values fed to Skia (positions, sizes, radii, colors) already pass the existing document validation; `SkiaRenderer` additionally guards any value interpolated into a path/transform with `Number.isFinite()` before use (frontend-defensive Floating-Point rule), substituting a documented default and emitting a `console.warn` on violation.

## 7. Consistency Guarantees
- **Frame atomicity:** a frame either renders fully or the frame is skipped; a draw error inside `renderScene` is caught, logged, and the previous frame remains on screen (no partial scene). The Skia `save`/`restore` clip stack is drained in a `try/finally` (frontend-defensive push/pop rule) so a throw mid-scene cannot leak GPU state into the next frame.
- **Invariants:** the document model is identical regardless of active backend (GPU vs software); the two backends produce the same pixels (same Skia code). No new undoable operations are introduced (rendering is a projection of state), so history capacity/eviction is unaffected.
- **Partial failure:** CanvasKit init failure (WASM load fails) → blocking "rendering unavailable" state (not a blank canvas). WebGL2 unavailable → software-backend degrade (non-blocking). WebGL context loss (`webglcontextlost`) → recreate surface + GPU resources on `webglcontextrestored`; until restored, skip frames.
- **No bounded app-collection with an eviction policy is introduced** (Skia owns its caches).

## 8. Recursion Safety
The scene walk is the existing node-tree traversal (frame clipping is a DFS), already depth-guarded by the document model's nesting limit. `SkiaRenderer`'s traversal reuses that bound (named constant from the existing model); it adds no new unbounded recursion. The clip stack is iterative (save/restore), not recursive. No new recursive algorithm is introduced.

## 9. Tool Lifecycle Contract
**N/A** — this spec introduces no new canvas tool. It does not change any tool's commit/cancel lifecycle or document-level keyboard handling; tools continue to operate on the document model unchanged. (The text edit-overlay keyboard contract is unaffected — text editing remains a DOM overlay, not part of the Skia scene.)

## 10. Transport Boundary / Cross-Stack Type Extension Inventory
**No shared wire-format type is added or changed.** 11c-A introduces no field on `NodeKind`/`TextStyle`, no GraphQL/MCP/persistence/`apply-remote.ts` change, and no new discriminant. This is a rendering-backend swap behind the existing document model.

**Machine-verifiable receipt (no-change claim):** the PR description MUST include the reproducible command output showing the change set touches no shared-type or transport file:
`git diff --name-only` contains **no** path under `crates/`, and none of `frontend/src/types/document.ts`, `frontend/src/operations/apply-remote.ts`, or any GraphQL/MCP resolver. (Per §10 "Completion claims require machine-verifiable receipts.")

## 11. Staged Feature Delivery Contract (deferred-to-11c-B inventory)
11c-A ships the render core without OpenType feature affordances. Deferred items, each owned by **11c-B**:
1. `TextStyle.font_features` data field (Rust + TS mirror) — not added here; no UI exposes it.
2. OpenType feature toggles / `font-feature-settings` parity in the typography panel — not present; the panel is unchanged.
3. Feature-detection UI ("which OT features this font supports") — not present.

Safety of staged delivery: text in 11c-A renders with **current behavior** (the parity harness asserts text output matches today's, or documents any intentional metric change as a fixture exception). No user-facing affordance silently degrades — there is no feature toggle to be ignored until 11c-B. Reviewers: do NOT file findings for these pre-disclosed deferrals. 11c-B's PR MUST reference this inventory and confirm each item is addressed.

## 12. Accessibility
Text is already canvas-rendered today (Canvas-2D `fillText`), so it is already opaque to assistive tech — **11c-A does not regress a11y.** The canvas accessible-name/`aria-label` strategy is preserved through the rewrite (audited per a11y-rules "Accessibility Behavior Must Be Audited During UI Rewrites"). The software-fallback `role="status"` notice is a single, persistent, text-replaced region (not high-frequency, not transient-mount). A DOM text-alternative mirror for screen-reader access to canvas text is a **pre-existing gap** (not introduced here) and is recorded as a follow-up.

## 13. Dependencies & Packaging
- `canvaskit-wasm@0.41.1` pinned exactly (no `^`/`~`); `.wasm` + JS loader are a matched pair.
- The `.wasm` is **vendored/served locally** (Vite static asset), not from a CDN — required for Tauri offline.
- Lazy-loaded after first shell paint (the ~2.8 MB Brotli wasm must not block editor chrome appearing). Startup budget stated in §15.
- **CSP:** when a CSP is set, `script-src` MUST include `'wasm-unsafe-eval'` (else WASM will not instantiate in the Tauri webview). Tauri serves `.wasm` as `application/wasm` via content-sniffing; optional hardening is a custom URI-scheme protocol with an explicit `Content-Type`.
- License: CanvasKit/Skia is BSD-3-Clause; include its notice in third-party attributions.

## 14. Testing — Parity Harness (the machine-verifiable receipt; ships in the same PR)
A golden-image suite renders a fixture document through `SkiaRenderer` on a **pinned Skia-software backend** (deterministic, headless, no GPU) **offscreen** (RGBA_F16 render target — on-screen surfaces can't be read back), encodes PNG via `makeImageSnapshot`/`encodeToBytes`, and diffs against committed goldens with a pinned per-pixel tolerance. Fixtures MUST cover:
- Every `NodeKind` variant (direct assertion per variant — sentinel presence is not enough).
- Every corner shape, including **asymmetric radii** (`{x:30,y:10}` and the swapped `{x:10,y:30}`) — multi-axis rule.
- Every gradient type (linear/radial/conic).
- All 16 blend modes.
- Nested frame clipping.
- **sRGB and Display-P3** fills, strokes, and text.
- Multi-line wrapped + aligned + decorated text.

Plus: unit tests for the node→Skia mapping; a `destroy()` lifecycle test (asserts surface/context deleted, listeners removed); the per-frame leak assertion (created==deleted); `test_max_device_pixel_ratio_enforced`. Intentional sub-pixel AA/text-hinting differences vs the old Canvas-2D output are enumerated and signed off in the PR (per §1 deviation-documentation), never silently shipped. Pin the CanvasKit version; regenerate goldens on upgrade.

## 15. Performance
- **GPU path:** maintain ≥60fps (≤16.6 ms/frame) for a 1000-node fixture document on the reference profile. (Spike: ~3 ms/frame headroom on M1 Pro.) No worker/OffscreenCanvas required for v1.
- **Software path:** explicitly NOT the 60fps guarantee; define a degraded target (interactive, ≥X fps for N nodes) and measure it; surface the degrade notice.
- **Startup:** editor chrome paints within the existing <1s budget; CanvasKit wasm lazy-loads after first paint. State the measured bundle delta (~2.8 MB Brotli) and assert the lazy-load (wasm not in the initial critical bundle).
- Establish the current Canvas-2D baseline before cutover so "no perceptible regression" is measurable.

## 16. Risks & Mitigations
1. **Pixel-parity regression (primary risk).** → Offscreen golden harness ships in the same PR with full NodeKind/corner/gradient/blend/clip/P3/text coverage; intentional AA differences enumerated. This is the gating receipt.
2. **Skia memory leaks (acute for any executor).** → The §4.7 reuse+delete-per-frame contract + a dev-mode per-frame created==deleted assertion; `destroy()` lifecycle test.
3. **WebGL2 unavailable / context loss.** → Software fallback (same pixels) + context-loss recreate; degrade notice; CI runs the software backend deterministically.
4. **Bundle/startup.** → Lazy-load, vendor locally, state budget + assert lazy-load.

## 17. Acceptance Criteria
- [ ] `SceneRenderer` interface + single `SkiaRenderer` implementation; `Canvas.tsx` uses it; `destroy()` called in `onCleanup`.
- [ ] Canvas-2D document-drawing path (`render`/`drawNode`) deleted; chrome moved to a 2D overlay module. (Receipt: grep shows no Canvas-2D document drawing remains.)
- [ ] GPU (WebGL2) rendering with Display-P3 via the §4.4 recipe; Skia-software fallback wired; no Canvas-2D fallback.
- [ ] Parity harness passes for all fixtures in §14, run on the pinned software backend in CI.
- [ ] Per-frame leak assertion green; `destroy()` test green; `test_max_device_pixel_ratio_enforced` green.
- [ ] 60fps@1000 nodes measured on the GPU path; bundle lazy-loaded; `'wasm-unsafe-eval'` CSP entry present.
- [ ] No `crates/` change; no shared-type/transport change (receipt per §10).
- [ ] OpenType-feature items remain deferred to 11c-B (§11); text renders at current behavior.

## 18. References
- Research & validation: `docs/superpowers/research/2026-06-10-11c-render-core-canvaskit.md`
- Spike harness (P3 recipe, perf, memory): `spikes/canvaskit/`
- Superseded: `docs/superpowers/specs/2026-06-10-11c-webgl-text-rendering.md` (to delete)
- Current renderer (to port + delete document path): `frontend/src/canvas/renderer.ts`, consumer `frontend/src/shell/Canvas.tsx`
- Reused math: `frontend/src/canvas/corner-path.ts`, `text-measure.ts`, `color-fill.ts`
