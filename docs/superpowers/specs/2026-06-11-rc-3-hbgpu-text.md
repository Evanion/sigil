# Spec RC-3 — Text Rendering via hb-gpu

**Date:** 2026-06-11
**Status:** Ready for plan
**Epic:** Render core (custom WebGL2 + hb-gpu). Builds on **RC-1** (foundation), **RC-2** (shape pipeline). Cutover is **RC-4**. → `docs/superpowers/ROADMAP.md`.
**Build/binding backing:** `docs/superpowers/research/2026-06-11-render-core-infra-decisions.md` (Challenge 1: Emscripten build + bindings + one-module). **Spike evidence:** `docs/superpowers/research/2026-06-11-hb-gpu-spike.md` (COLRv1 emoji, sharpness, ~244 KB gzip).
**Depends on:** RC-1, RC-2, **Fonts-1** (font bytes).

## 1. Overview
Render document text on the GPU via **hb-gpu** (HarfBuzz's Slug-based renderer): CPU shaping → per-glyph outline/COLR encode → analytic GPU rasterization, into the same WebGL2 context as the RC-2 shapes (correct per-node z-order). Build HarfBuzz+hb-gpu to a pinned WASM module, drive it from a TS WebGL2 text host (glyph-encode atlas + cache + the hb-gpu GLSL), and replace the text arm of `renderScene`. Fonts come from Fonts-1's font table (`hb_face` from sfnt bytes). Frontend-only; `crates/core` untouched. This spec does NOT wire `Canvas.tsx` or delete Canvas-2D (RC-4).

## 2. Goals / Non-Goals
**Goals**
- A pinned, reproducible **HarfBuzz+hb-gpu WASM** module (shape + draw + paint), committed artifact + CI checksum rebuild.
- Hand-written `extern "C"` bindings (one module): `hbg_session_create/set_variations/set_size/is_color/destroy`, `hbg_shape` (packed 24-byte glyph records), `hbg_encode_glyph` (RGBA16I blob + extents), `hbg_shader_vertex_glsl/fragment_glsl`, `hbg_free`.
- A TS **WebGL2 text host**: load+instantiate the WASM, a **glyph-encode atlas** (texture-buffer, with `HB_GPU_ATLAS_2D` 2D-sampler fallback) keyed `(fontId, gid, sizeBucket, variationHash)`, compile the hb-gpu GLSL into a program, build instanced quads from shaped positions, draw via the **draw** (mono) and **paint** (COLRv1) paths in the shared RC-1/RC-2 context.
- Per-node **z-order** interleaving with shapes (shared depth/painter order).
- **Display-P3:** hb-gpu emits premultiplied RGBA into the P3 framebuffer; integrate with RC-2's linear-P3 working space.
- Fonts-1 integration: a node's `font_entry` → its sfnt bytes → `hbg_session_create`; variable-font axes + OpenType features passed to shaping.
- Replace the text arm of `renderScene`; async shape on text/font change with re-render and immediate invalidation (Penpot #9574 lesson).
- Golden parity for text incl. multi-line/align/decoration, COLRv1 emoji, and variable-weight.

**Non-Goals**
- Wiring `Canvas.tsx`, chrome overlay, deleting Canvas-2D, full perf gate (RC-4). OpenType feature/variable-axis editing UI (11c-B). Bitmap color fonts (CBDT/sbix/PNG — unsupported by hb-gpu; documented). Any `crates/core` change. The font *model* (Fonts-1, prerequisite).

## 3. PDR Traceability
**Implements:** the WebGL text rendering of the epic (issue #43) via hb-gpu. **Defers:** feature/variable editing UI (11c-B), cutover (RC-4). **MVP coverage:** none dropped; Canvas-2D text remains live until RC-4.

## 4. Architecture
### 4.1 The WASM module (per the infra research)
Build the HarfBuzz amalgamation (`harfbuzz-world.cc`) with `config.h` (`HB_HAS_GPU 1`, `HB_TINY 1`) + `config-override.h` (`#undef HB_NO_DRAW/HB_NO_PAINT/HB_NO_COLOR/HB_NO_VAR/HB_NO_METRICS`), `-std=c++17 -Oz -flto`, against pinned HarfBuzz `14.2.0` (commit SHA) + pinned emsdk. **One module** (shape + draw + paint); `HB_HAS_SUBSET` off. Hand-written `extern "C"` bindings + `_malloc`/`HEAPU8` transfer (not Embind). Artifact `frontend/src/render/wasm/hb-gpu.{wasm,js}` + `.sha256` committed; a CI stage rebuilds from pinned sources and asserts checksum-stable; emsdk stays out of the primary dev container. Target ~150–180 KB gzip (measure + record).

### 4.2 TS WebGL2 text host (`frontend/src/canvas/text/`)
- `hb-gpu-loader.ts` — instantiate the WASM (served `application/wasm`), expose the typed binding calls.
- `glyph-atlas.ts` — a GPU **texture-buffer** holding encoded RGBA16I glyph blobs; an LRU cache keyed `(fontId, gid, sizeBucket, variationHash)` → atlas offset. On miss: `hbg_encode_glyph` → upload texels → store offset. Bounded by `MAX_GLYPH_ATLAS_BYTES` (named constant; LRU eviction; enforcement test).
- `text-renderer.ts` — per text node: resolve `font_entry`→session (cache `HbSession` per `(fontId, variationHash)`); `hbg_shape(content, features)` → glyph records; for each glyph, get the atlas offset; build instanced quads at the shaped pen positions with the node transform; select the **draw** program (mono) or **paint** program (COLRv1) per `hbg_is_color`; draw into the shared FBO. Decoration (underline/strike) + alignment from the node's `TextStyle` (parity with current behavior; documented as Skia-free, hb-gpu-shaped — the spec's permitted metric exception).
- The hb-gpu GLSL (`hbg_shader_*`) is compiled via RC-1's `gl/program` helper into draw + paint programs.

### 4.3 Fonts-1 integration
A node's `TextStyle.font_entry` → the Fonts-1 font table entry → its sfnt bytes (embedded `Custom`, bundled, or locally-resolved `SystemReference`). Bytes are `_malloc`+`HEAPU8.set` into the WASM heap → `hbg_session_create(ptr, len, faceIndex)`. Variable-font axes → `hbg_session_set_variations`; OpenType feature strings → `hbg_shape` features param. The session owns its sfnt copy (JS buffer may be GC'd). Missing referenced font → render the Fonts-1 metric-fallback face (or the bundled default) and keep the node's `missing` flag.

### 4.4 Z-order, P3, async
- **Z-order:** text draws are issued in the same scene-order loop as RC-2 shapes into the shared FBO, so a text node between two shapes composites correctly (the reason hb-gpu beats the CanvasKit-in-a-Skia-surface model).
- **P3:** hb-gpu outputs premultiplied RGBA; the paint/draw fragment output is composed in RC-2's linear-P3 working space and written to the P3 buffer.
- **Async:** shaping + encoding happen on text/font/axis change (not per frame for unchanged text — cache shaped runs + atlas entries); a `font-loaded`/shape-complete event invalidates + re-renders immediately.

### 4.5 Memory
`hbg_shape` arrays and `hbg_encode_glyph` blob copies are `hbg_free`'d immediately after upload (the atlas owns the GPU copy); shader strings are static (never freed); `HbSession`s are pooled + `hbg_session_destroy`'d on eviction; the renderer's `destroy()` frees all sessions, the atlas texture, and the WASM module references. Per-frame created==freed assertion (dev).

## 5. WASM Compatibility
**`crates/core` unchanged — N/A for the core-WASM checklist.** The hb-gpu `.wasm` is a **browser-side frontend asset**, not a `wasm32-unknown-unknown` Rust dependency of core. Its build reproducibility is governed by §4.1 + Dependencies (pinned emsdk/HB SHA + committed artifact + CI checksum), per CLAUDE.md §1.

## 6. Input Validation Inventory
- `MAX_GLYPH_ATLAS_BYTES` (e.g. 64 MiB) — LRU-evicted; enforcement test (`test_max_glyph_atlas_bytes_enforced`).
- Text content length already capped by core (`MAX_TEXT_CONTENT_LEN`); the host must not assume a max but should chunk shaping for very long runs.
- All shaped positions/extents guarded `Number.isFinite()` before vertex build.
- WASM instantiation asserted (no silent ArrayBuffer-fallback masking a config bug).
- Font-feature tag strings validated (4 ASCII) before passing to `hbg_shape` (reuse Fonts-1/CSS-char rules).

## 7. Consistency Guarantees
- **Frame atomicity:** text draws share RC-2's GL-state-reset + `try/finally` discipline; a shaping/encode error on one node is caught, logged, and falls back to the metric-fallback face for that node (never aborts the frame).
- **Cache coherence:** changing a node's `font_entry`/axes/content invalidates its shaped-run + atlas entries.
- **Context loss:** atlas texture + programs recreated on restore; sessions survive (WASM heap), re-uploaded.

## 8. Recursion Safety
COLRv1 paint trees are walked by hb-gpu internally (HarfBuzz's bounded walk); the host adds no recursion. Scene/text iteration is flat.

## 9. Tool Lifecycle Contract
**N/A** — no new canvas tool; the text-edit overlay is unchanged (still a DOM overlay; hb-gpu renders the committed text, not the editor).

## 10. Transport Boundary / Cross-Stack Type Extension Inventory
**No shared wire-format type added or changed.** Text uses `TextStyle.font_entry` (added by Fonts-1, already wired through transports there). Receipt: change set touches no `crates/`, `document.ts`, `apply-remote.ts`, or GraphQL/MCP path.

## 11. Testing
- **Build:** CI stage rebuilds the WASM from pinned emsdk+HB SHA and asserts the committed `.sha256` matches (reproducibility receipt). Record the measured gzip size.
- **Golden parity** (RC-1 harness + the WASM loaded in headless Chromium): multi-line wrapped + left/center/right aligned + underlined/struck text; **COLRv1 color emoji** (a ZWJ + skin-tone sequence — the hb-gpu win); a **variable-weight** instance; text z-interleaved between two shapes (asserts per-node z-order); sRGB + P3 text color.
- **Unit:** glyph-atlas LRU + `MAX_GLYPH_ATLAS_BYTES` enforcement; cache invalidation on font/axis/content change; session pooling + free-on-evict; binding round-trips (shape a known string → expected glyph count; encode a glyph → non-empty blob); WASM-instantiation assertion.
- Intentional metric differences vs the old Canvas-2D text path enumerated (hb-gpu shaping), not silently shipped.

## 12. Accessibility
Text remains canvas-painted (already opaque to AT today — no regression). The DOM text-alternative mirror for screen readers stays the epic-level pre-existing gap. Canvas `aria-label` preserved.

## 13. Dependencies
- Build-time: pinned **emsdk** (exact) + **HarfBuzz 14.2.0** (commit SHA), `Dockerfile.hbgpu`/build stage; `earcut`/RC deps unchanged. Committed `hb-gpu.{wasm,js,sha256}`.
- Runtime: the committed hb-gpu WASM (lazy-loaded; served `application/wasm`; CSP `'wasm-unsafe-eval'` — already required for the epic).
- License: HarfBuzz/hb-gpu MIT; Slug public-domain — include notices.

## 14. Performance
Text contributes to the RC-4 60fps@1000-nodes gate. RC-3 asserts: shaped-run + atlas caching avoids per-frame re-encode; no per-frame WASM allocation leak; draw-path (mono) preferred over paint-path (color) cost. Record text-heavy frame timing on real GPU (spike showed ample headroom).

## 15. Acceptance Criteria
- [ ] Reproducible pinned HarfBuzz+hb-gpu WASM (one module) + committed artifact + CI checksum rebuild; measured gzip size recorded.
- [ ] TS text host: loader, glyph atlas (LRU + `MAX_GLYPH_ATLAS_BYTES` + enforcement test), shaped-run cache, draw + paint programs from the hb-gpu GLSL.
- [ ] Fonts-1 integration: `font_entry`→sfnt→`hb_face`; variable axes + features; missing-font → metric fallback.
- [ ] Text arm of `renderScene` rendered via hb-gpu, z-interleaved with shapes, in linear-P3.
- [ ] Golden parity: multi-line/align/decoration, COLRv1 emoji, variable-weight, z-order, sRGB+P3; all green.
- [ ] Memory: per-frame created==freed assertion; sessions/atlas freed on `destroy()`.
- [ ] No `crates/` or transport change (receipt per §10). No `Canvas.tsx`/Canvas-2D deletion (RC-4).

## 16. References
- Build/binding: `docs/superpowers/research/2026-06-11-render-core-infra-decisions.md`; spike: `2026-06-11-hb-gpu-spike.md`; reference build: `spikes/hb-gpu/harfbuzz-world.cc/`.
- Fonts model (prereq): `docs/superpowers/specs/2026-06-11-fonts-1-font-model-embedding.md`.
- RC-1/RC-2: the foundation + shape pipeline this consumes.
