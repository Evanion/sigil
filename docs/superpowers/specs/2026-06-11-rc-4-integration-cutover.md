# Spec RC-4 — Render-Core Integration & Canvas-2D Cutover

**Date:** 2026-06-11
**Status:** Ready for plan
**Epic:** Render core (custom WebGL2 + hb-gpu). Final slice. Builds on **RC-1** (foundation), **RC-2** (shapes), **RC-3** (text). → `docs/superpowers/ROADMAP.md`.
**Carries over from** the superseded CanvasKit spec's integration phases (two-canvas setup, chrome overlay, delete-Canvas-2D, full parity, perf/CSP).
**Depends on:** RC-1, RC-2, RC-3 (and Fonts-1 for text).

## 1. Overview
Cut the live editor over from the Canvas-2D renderer to the WebGL2 + hb-gpu `SceneRenderer`. Wire it into `Canvas.tsx` as the document layer with a separate 2D **overlay canvas** for interaction chrome, **delete the Canvas-2D document renderer**, pass the full golden parity set, hold the 60fps@1000-node bar on the GPU path, and finish packaging (lazy-load the hb-gpu WASM, CSP, bundle budget). Frontend-only; `crates/core` untouched.

## 2. Goals / Non-Goals
**Goals**
- Two stacked canvases in `Canvas.tsx`: a WebGL2 canvas (document content via `SceneRenderer`) below; a 2D **overlay canvas** (selection/handles/marquee/guides/labels/preview) above (`pointer-events:none`, `aria-hidden`).
- Move the chrome-drawing functions out of `renderer.ts` into an `overlay-renderer.ts` (`renderOverlay(ctx, overlayInput)`), redrawn cheaply on pointer events.
- Wire `WebGLRenderer` (RC-2 shapes + RC-3 text) into the reactive render effect; `resize`/DPR; `destroy()` in `onCleanup`.
- **Delete** the Canvas-2D document-drawing path (`render`/`drawNode` and the moved chrome fns); retire its 2D-mock tests (coverage replaced by goldens + overlay tests).
- Full golden parity across every NodeKind, corner, gradient, blend mode, nested clip, image, text (incl. COLRv1 emoji + variable), sRGB + P3.
- **60fps@1000 nodes** on the GPU path (the binding §1 Performance bar), measured.
- WebGL2-required unsupported state surfaced in the real app.
- Packaging: lazy-load hb-gpu WASM after first shell paint; CSP `script-src 'wasm-unsafe-eval'`; stated bundle-size delta.

**Non-Goals**
- New rendering capability (all in RC-1/2/3). OpenType feature/variable UI (11c-B). Any `crates/core` change. Arbitrary path-fill (later spec).

## 3. PDR Traceability
**Implements:** completes the "WebGL canvas renderer" (PDR Deferred→scope) — the GPU renderer is now the live editor renderer; Canvas-2D removed. **Defers:** feature/variable UI (11c-B). **MVP coverage:** parity preserved (the golden set is the receipt); P3 (Spec 18) preserved via the RC-2 linear-P3 path.

## 4. Architecture
### 4.1 Two-canvas layering
`Canvas.tsx` renders a WebGL2 `<canvas>` (document, `role="application"`, `aria-label`, `tabindex`, the pointer handlers) and, absolutely positioned above it in the same box, a 2D overlay `<canvas>` (`pointer-events:none`, `aria-hidden="true"`, no focusable descendants). Document content → WebGL; interaction chrome → 2D overlay. The overlay redraws on pointer/selection signals without touching the GPU scene.

### 4.2 `overlay-renderer.ts`
Move verbatim from `renderer.ts`: `drawSelectionHighlight`, `drawNameLabel`, `drawSelectionHandles`, `drawPreviewRect`, `drawMarqueeRect`, `drawCompoundBounds`, `drawGuideLines` + their constants. Expose `renderOverlay(ctx, overlayInput)` where `OverlayInput = { viewport, nodes, depths, selectedUuids, previewRect, previewTransforms, snapGuides, marqueeRect, canvasWidth, canvasHeight }`. Clears + applies the viewport transform + runs the selection/preview/guide/marquee passes (the old `render` chrome passes).

### 4.3 `Canvas.tsx` wiring
`onMount`: `const renderer = await createWebGLRenderer(webglCanvas)` (typed unavailable → unsupported message, §4.5); acquire the overlay 2D ctx. `ResizeObserver`: size both canvases; `renderer.resize(w,h,dpr)`. Render effect: build `SceneInput` from the existing signals → `renderer.renderScene(scene)`, then `renderOverlay(overlayCtx, overlayInput)` from the chrome signals. `onCleanup`: `renderer.destroy()` + the existing listener teardown.

### 4.4 Delete the Canvas-2D renderer
Remove `render`/`drawNode` + the moved chrome fns from `renderer.ts`; keep still-imported pure helpers (grep first), else delete the file + update imports. Retire the drawNode/render 2D-mock tests; move chrome tests to `overlay-renderer.test.ts`. Receipt: `grep` shows no consumer importing a deleted symbol; no Canvas-2D document drawing remains.

### 4.5 WebGL2-required (production)
If `createWebGLRenderer` returns the typed unavailable result, render a clear accessible "This editor requires WebGL2" state (real DOM, `role="alert"`). No Canvas-2D fallback (it's deleted).

## 5. WASM Compatibility
**N/A — frontend-only.** No `crates/core` change. (The hb-gpu WASM is RC-3's; RC-4 only lazy-loads it.) Receipt: change set touches no `crates/` path.

## 6. Input Validation Inventory
No new persisted type/boundary. dpr clamp + finite guards inherited from RC-1/RC-2. The overlay's numeric inputs (handle positions, marquee) guarded `Number.isFinite()`.

## 7. Consistency Guarantees
- **Atomicity:** document layer and overlay are independent draws; a document-render error leaves the prior GPU frame and the overlay still draws (and vice-versa).
- **Invariants:** exactly one live renderer (Canvas-2D deleted); the document model is unchanged by the swap.
- **No new undoable ops / bounded collections.**

## 8. Recursion Safety
No new recursion (reuses RC-1/2/3 traversals + the flat overlay passes).

## 9. Tool Lifecycle Contract
**N/A** — tools unchanged. The two-canvas split must preserve the current pointer-handler attachment (handlers stay on the WebGL/document canvas; the overlay is `pointer-events:none`), and the text-edit overlay keyboard contract is unaffected. Confirm in an acceptance check.

## 10. Transport Boundary / Cross-Stack Type Extension Inventory
**No shared wire-format type added or changed.** Receipt: change set touches no `crates/`, `document.ts`, `apply-remote.ts`, or GraphQL/MCP path.

## 11. Testing
- **Full golden parity set** (RC-1 harness): every NodeKind, asymmetric corners (+swapped), every gradient, all 16 blend modes, nested clip (≥2), images, text (multi-line/align/decoration), COLRv1 emoji, variable-weight, text z-interleaved with shapes, sRGB + P3 — on the pinned SwiftShader/Playwright harness.
- **Perf gate:** a 1000-node fixture (mixed shapes + text) renders at **≥60fps (≤16.6ms/frame)** on the reference GPU profile; recorded. Software/SwiftShader path explicitly NOT the 60fps guarantee.
- **Integration:** `Canvas.tsx` two-canvas render (document via WebGL, chrome via overlay); `destroy()` lifecycle on unmount; WebGL2-unavailable shows the unsupported state.
- **Deletion receipts:** grep for removed symbols (no consumers); `overlay-renderer.test.ts` (moved chrome tests) green.
- **Behavioral inventory** (CLAUDE.md "Behavioral Inventory Before Deleting/Rewriting") of the outgoing `renderer.ts` produced + each behavior preserved-or-documented.

## 12. Accessibility
- The WebGL canvas keeps `role="application"` + `aria-label` (UI-rewrite a11y audit: enumerate the outgoing renderer's a11y surface — canvas name, focus, keyboard — and preserve each).
- The overlay canvas is `aria-hidden="true"` with no focusable descendants (decorative chrome).
- WebGL2-unavailable message is real DOM in a `role="alert"`, keyboard-reachable.
- Canvas text-alternative for screen readers remains the epic-level pre-existing gap (tracked, not introduced here).

## 13. Dependencies
Runtime: the RC-3 hb-gpu WASM lazy-loaded after first shell paint. CSP `script-src 'self' 'wasm-unsafe-eval'` set in `src-tauri/tauri.conf.json` (merge, don't loosen). No new runtime dep.

## 14. Performance
This is where the **60fps@1000-node** §1 bar is enforced (full scene: shapes + text + clipping). State the measured bundle-size delta (shapes are dep-light; hb-gpu ~150–180 KB gzip) and assert the hb-gpu WASM is a separate lazy chunk, not in the entry bundle. Establish the Canvas-2D baseline before cutover so "no perceptible regression" is measurable.

## 15. Acceptance Criteria
- [ ] Two-canvas `Canvas.tsx` (WebGL document below, 2D chrome overlay above); pointer handlers preserved; `destroy()` in `onCleanup`.
- [ ] `overlay-renderer.ts` with the moved chrome; `WebGLRenderer` wired into the render effect.
- [ ] Canvas-2D document renderer **deleted**; deletion receipts (grep) clean; chrome tests moved + green.
- [ ] Full golden parity set green on the pinned harness.
- [ ] 60fps@1000 nodes measured + recorded on the GPU path.
- [ ] WebGL2-required unsupported state in the app; hb-gpu WASM lazy-loaded; CSP `'wasm-unsafe-eval'` set; bundle delta stated.
- [ ] Behavioral inventory + a11y audit of the outgoing renderer produced.
- [ ] No `crates/` or transport change (receipt per §10).

## 16. References
- RC-1/RC-2/RC-3 specs (the foundation/shapes/text this integrates).
- Superseded CanvasKit spec (reusable integration design): `docs/superpowers/specs/2026-06-10-11c-a-canvaskit-render-core.md`.
- Current renderer to integrate + delete: `frontend/src/canvas/renderer.ts`, `frontend/src/shell/Canvas.tsx`.
