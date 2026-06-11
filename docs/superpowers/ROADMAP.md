# Sigil Roadmap — Specs, Plans & Implementation Order

**Maintained as the single source of truth for what's specced, what's planned, and the order to build it.** Update this whenever a spec/plan is created, a status changes, or an order/dependency shifts. Last updated: 2026-06-11.

## Status legend
`spec✅` spec written · `plan✅` plan written · `impl…` implementing · `done✅` merged · `blocked` waiting on a dependency · `superseded` replaced.

---

## Locked decisions (don't re-litigate without a new decision record)
- **Render engine = custom WebGL2 shape renderer + hb-gpu text** (issue #43). Both CanvasKit and hb-gpu were spiked on real M1 Pro hardware; hb-gpu won on bundle (~12×), COLRv1 emoji, and resolution-independent text. CanvasKit approach **superseded**. → `research/2026-06-11-hb-gpu-spike.md`, `research/2026-06-11-render-core-infra-decisions.md`.
- **Font model:** workfile stores a **document-level font table** of `FontEntry` refs; embed-vs-reference decided per font from its own `OS/2.fsType` + provenance (no system-font DB); **custom fonts embed full-face** in `.sigil/fonts/`; **library/OFL fonts reference + re-fetch**; every ref stores metrics for no-reflow fallback. Parsing in Rust core via `ttf-parser`. → `research/2026-06-11-font-pipeline-architecture.md`, `research/2026-06-11-font-embedding-permissions.md`.
- **Fonts sequenced before the render core** (engine-agnostic; unblocks custom fonts on the current renderer now).
- **`SceneRenderer` seam** isolates the engine (swappable backend).
- **Parity testing:** golden images via Playwright + headless Chromium + SwiftShader (`gl.readPixels` + pixelmatch), pinned by digest. (CanvasKit's Node-CPU-surface approach not available for a custom WebGL2 renderer.)
- **qwen handoff:** `~/.claude/lmstudio.settings.json` → `http://127.0.0.1:1234` (lm-link → evanstar), model `unsloth/qwen3-coder-30b-a3b-instruct`. Treat qwen as Sonnet/Opus-class for plan granularity.

---

## Implementation order

| # | Item | Status | Depends on | Spec | Plan |
|---|------|--------|-----------|------|------|
| 1 | **Fonts-1** — font model, embedding & FontFace loading (current renderer) | spec✅ plan✅ | — | `specs/2026-06-11-fonts-1-font-model-embedding.md` | `plans/2026-06-11-fonts-1-font-model-embedding.md` |
| 2 | **RC-1** — WebGL2 foundation + SceneRenderer seam + golden harness (+P3 probe) | spec✅ | — (Fonts-1 parallel-ok) | `specs/2026-06-11-rc-1-webgl2-foundation.md` | _next_ |
| 3 | **RC-2** — shape rendering (fills/strokes/corners/gradients/images/clip/blend/P3) | planned | RC-1 | — | — |
| 4 | **RC-3** — text via hb-gpu (Emscripten build + WASM host + atlas) | planned | RC-1, **Fonts-1** | — | — |
| 5 | **RC-4** — integration + delete Canvas-2D (chrome overlay, full parity, perf) | planned | RC-2, RC-3 | — | — |
| 6 | **Fonts-2** — server font store + OFL/Google library + picker UI + missing-font UX + MCP | planned | Fonts-1 | — | — |
| 7 | **Fonts-3** — Tauri OS-font reader + web Local Font Access | planned | Fonts-1 | — | — |
| 8 | **11c-B** — OpenType features + variable-font axis editing | planned | RC-3 (hb-gpu text), Fonts-1 | — | — |
| — | Export/print subsetting (hb-subset) | backlog | Fonts-1 | — | — |

**Critical path to the new renderer shipping:** Fonts-1 → RC-1 → (RC-2 ∥ RC-3) → RC-4.
**Fastest user-visible value:** Fonts-1 alone (custom fonts + portable workfiles on the current Canvas-2D renderer).

### Dependency notes
- RC-3 (hb-gpu text) consumes Fonts-1's font bytes (`hb_face_create`) — do Fonts-1 first or in parallel, but RC-3 needs it.
- RC-2 and RC-3 both depend only on RC-1; they can run in parallel once RC-1 lands.
- Fonts-2 and Fonts-3 depend only on Fonts-1 and can run any time after it (parallel to the RC work).
- 11c-B needs the hb-gpu text path (RC-3) for feature/variable rendering, and Fonts-1 for the font model.

---

## Document index
**Specs:** `docs/superpowers/specs/`
- `2026-06-11-fonts-1-font-model-embedding.md` (ready) · `2026-06-11-font-epic-overview.md` (epic map)
- `2026-06-10-11c-a-canvaskit-render-core.md` (⚠️ superseded — engine changed; seam/P3/harness/chrome-split reusable)

**Plans:** `docs/superpowers/plans/`
- `2026-06-11-fonts-1-font-model-embedding.md` (ready) · `2026-06-11-11c-a-canvaskit-render-core.md` (⚠️ superseded)

**Research / decision notes:** `docs/superpowers/research/`
- `2026-06-10-11c-render-core-canvaskit.md` · `2026-06-11-hb-gpu-spike.md` · `2026-06-11-render-core-infra-decisions.md`
- `2026-06-11-font-pipeline-architecture.md` · `2026-06-11-font-embedding-permissions.md`

**Reviews:** `docs/superpowers/reviews/2026-06-10-spec-11c-webgl-text-rendering.md` (the original Spec 11c review).

**Spikes (throwaway harnesses):** `spikes/canvaskit/` (P3 recipe, perf), `spikes/hb-gpu/` (bundle size, COLRv1 emoji, sharpness; `harfbuzz-world.cc` build reference).

---

## How to use this file
- Before starting work, read this table top-to-bottom; pick the lowest-numbered non-`done` item whose dependencies are met.
- When you write a spec or plan, fill its path + flip the status here in the **same commit**.
- When a decision changes the order or supersedes an item, update the table AND add/justify it under "Locked decisions".
