# Font Epic — Overview & Decomposition (completeness map)

**Date:** 2026-06-11
**Purpose:** Capture the ENTIRE font subsystem so nothing is missed, then slice it into shippable sub-specs. This is the umbrella; each sub-spec (Fonts-1/2/3) and the 11c-A loader swap is detailed separately.
**Research backing:** `docs/superpowers/research/2026-06-11-font-pipeline-architecture.md` (Figma/Penpot/CanvasKit), `docs/superpowers/research/2026-06-11-font-embedding-permissions.md` (fsType/embedding/substitution — to be written from the embedding research).

## Settled font model (decisions locked)
1. **Embed-vs-reference is decided per font from its own bytes — no system-font database.**
   - Read `OS/2.fsType`: **embed** when Installable (`0x0000`) or Editable (`0x0008`); **reference-only** when Restricted (`0x0002`), Preview&Print (`0x0004`, since docs are editable), Bitmap-only (`0x0200`) on outlines, or no OS/2 table. Resolve multi-bit (OS/2 v0–2) **least-restrictive-wins**; only canonical `0x0002` is Restricted. Honor **No-subsetting** (`0x0100`). **Never rewrite fsType.**
   - **Provenance belt-and-suspenders:** never embed a font read from an OS system-font directory (loader knows the path) — covers mis-set system fonts. Never transcode system fonts to WOFF.
2. **Custom (embeddable) fonts → embed FULL FACE** as original sfnt bytes inside the `.sigil/` package (`fonts/<uuid>.ttf`), referenced by manifest UUID. Subsetting reserved for a future export/print artifact (frozen text), never the editable workfile.
3. **Library (OFL/Google) fonts → reference + re-fetch** from Sigil's server/bundle (lean files). Embeddable, but recoverable, so not embedded.
4. **Every font reference (embedded or not) stores layout metrics** (ascent/descent/line-gap/cap-height/x-height/italic-angle/advance widths) + PANOSE + serif flag + unitsPerEm + identity + raw fsType + resolved decision, so a missing referenced font renders via a **metric-retuned local fallback with no reflow** + a missing-font alert (never silent).
5. **The pipeline is renderer-agnostic.** It works on the CURRENT Canvas-2D renderer via the browser `FontFace` API; 11c-A later swaps the loader to CanvasKit `FontMgr.FromData`, reusing the same model/bytes/metrics.

---

## Complete capability inventory (tagged to owning sub-spec)

### A. Data model & workfile (owner: **Fonts-1**)
- A1. `FontRef` per text node: PostScript name, family, subfamily/style, weight, width, italic, variable-font axis values; a `FontSource` discriminant. Replaces/augments today's `TextStyle.font_family: String`.
- A2. `FontSource` enum: `Bundled` | `Library { catalog id }` | `Custom { embedded asset uuid }` | `SystemReference { name }`. **Discriminated union → exhaustive dispatch across crates + TS mirror sentinel.**
- A3. Embedded-font asset storage: `.sigil/fonts/<uuid>.<sfnt-ext>`, original full-face bytes; manifest entry per font with the §metadata.
- A4. Per-font metadata record (stored for all refs): identity, PANOSE, serif flag, unitsPerEm, layout metrics, fsType raw + resolved decision, content hash, source. (Embedded: + full/subset flag = always "full" in editable.)
- A5. Cross-stack type wiring: Rust def (`crates/core`), TS mirror (`frontend/src/types/document.ts`), `.test-d.ts` exhaustiveness sentinel, transport handlers (GraphQL resolver, MCP tool, `apply-remote.ts`, persistence), parity fixture in `tests/fixtures/parity/`. (CLAUDE.md §10 Transport Boundary Inventory + §11 Parity Tests.)
- A6. Validation (`validate.rs` + TS single-source): family/PostScript name CSS-significant-char rejection (used in `ctx.font`/CSS); `MAX_EMBEDDED_FONT_BYTES`; `MAX_FONTS_PER_DOCUMENT`; axis value ranges; NaN/finite guards on all metric floats. Each `MAX_*` enforced + `test_*_enforced`.
- A7. Workfile manifest↔disk validation for `fonts/` (stale/orphan handling per the persistence contract); atomic writes; UUID filenames.
- A8. Migration: existing `font_family: String` → `FontRef::SystemReference { name }` (no bytes available). Schema version bump + `.backup-vN/` per the Schema Migration Persistence Contract; CI fixture + smoke test.
- A9. Undo/redo: set-font, embed-font, remove-font wired to the client HistoryManager (same PR as the mutations).
- A10. Commands (core): set font on node, embed font (add bytes), remove embedded font, change axes — create/rename/delete-class completeness for the embedded-font entity.

### B. Byte acquisition & classification (owner: **Fonts-1**)
- B1. fsType parser (OS/2) → embed/reference decision (A model rules).
- B2. Provenance check (system-dir → reference-only).
- B3. Metric extraction from font bytes (OS/2, hhea, head, post, PANOSE).
- B4. Format intake: TTF/OTF direct; **WOFF/WOFF2 → decompress to sfnt** (CanvasKit & embedding need sfnt). Reject corrupt/invalid fonts with a typed error.
- B5. Content-hash dedup.
- B6. Subsetting (EXPORT only, owner: a future export spec): `hb-subset` (WASM) over the union of document glyphs; forbidden when No-subsetting set.

### C. Loading & render integration
- C1. **FontFace loader for the CURRENT Canvas-2D renderer** (owner: **Fonts-1**): embedded/custom bytes → `new FontFace` → `document.fonts.add` → `ctx.font` resolves; await readiness; re-render on `font-loaded`. → custom fonts work on today's renderer.
- C2. **CanvasKit loader** (owner: **11c-A**): bytes → `FontMgr.FromData` → `FontCollection`/`TypefaceFontProvider`; `FontRef`→typeface resolution; re-layout on `font-loaded`. Swaps C1.
- C3. Metric-preserving fallback for missing referenced fonts (size-adjust/ascent-override model from stored metrics; reserve geometry so no reflow). (Fonts-1 establishes; 11c-A applies in Skia.)
- C4. Fallback chain & default floor: bundled default font always present; explicit Noto script fallbacks + Noto Color Emoji for CanvasKit (Skia has NO auto system fallback). (Bundled defaults: **Fonts-1**; CanvasKit fallback wiring: **11c-A**; broad Noto script coverage: **Fonts-2/3**.)
- C5. Async load + immediate invalidate/re-layout (Penpot #9574 lesson). (Fonts-1 for FontFace path; 11c-A for Skia path.)
- C6. Duplicate-family resolution priority across sources: custom/embedded > library > system (Figma org>local>google analog). (Fonts-1 defines; transports symmetric.)

### D. Server & catalog (owner: **Fonts-2**)
- D1. Font asset store: custom-upload endpoint (atomic tmp+rename, dedup, UUID), serve `GET /assets/fonts/by-id/<uuid>`. (Note: embedded fonts live in the workfile; the server store is for the team/library + upload staging.)
- D2. OFL/Google library: bundled/self-hosted set + optional Google proxy (`/internal/gfonts`), offline-disableable.
- D3. Catalog query API (families/variants/ids) — **symmetric across GraphQL + MCP**.
- D4. Bundled default set shipped + served (sans/mono/Noto emoji + ≥1 Noto CJK).
- D5. CORS allowlist + CSP for font fetches; no hotlinking.

### E. UI (owner: **Fonts-2**)
- E1. Font picker (browse bundled/library/custom; weight/style; variable axes) — WAI-ARIA combobox/listbox, keyboard, Kobalte wrapper.
- E2. Add/upload custom font flow (file picker → classify → embed) with the fsType decision surfaced.
- E3. Per-font status display: Embedded ✓ / Referenced (license-restricted) / Referenced (system), with reason + user-responsibility notice + takedown path.
- E4. Missing-font alert + remap UX (Figma-style): list affected layers, render metric-fallback meanwhile, remap-to-available / supply-original (→ embed if fsType allows). Never silent.
- E5. Variable-font axis controls (ties to 11c-B OpenType/variable features).

### F. MCP / agents (owner: **Fonts-2**)
- F1. Agents operate on `FontRef`s (token-efficient); catalog resolution name→ref.
- F2. Typed "font unavailable" error (no silent substitution); broadcast the canonical resolved ref (per the broadcast payload contract).
- F3. Resolution symmetric across GraphQL + MCP (same ambiguity/availability semantics).

### G. Local font sourcing (owner: **Fonts-3**)
- G1. Tauri Rust OS-font reader (read OS font files; feed loader) — in-process Font Agent; all platforms, no permission. Provenance = system → reference-only (don't embed).
- G2. Web Local Font Access API (`queryLocalFonts()`/`.blob()`) — Chromium-only, permission-gated; opportunistic.

### H. Licensing/legal (cross-cutting; surfaced in **Fonts-1** UI hooks + **Fonts-2** UI)
- fsType honoring + provenance; UI surfacing of decisions; user-responsibility notice; takedown; no system-font transcoding; OFL notice retention for bundled/library fonts. *(Engineering diligence, not legal advice; binding constraint is each EULA.)*

### I. Performance (cross-cutting)
- Lazy-load font bytes; cache loaded FontFaces/typefaces (don't reload per frame); transfer cost bounded; export-time subsetting; metric extraction off the render hot path.

### J. Edge cases / correctness (must be covered by tests in the owning sub-spec)
- Missing referenced font on open (C3/E4). Glyph not in font (full-face embed mitigates the subset case). Variable fonts (A1/E5). CJK/emoji fallback (C4). Duplicate family names across sources (C6). Corrupt/invalid upload (B4). No OS/2 table (B1 → reference). WOFF2 decode (B4). Color fonts COLR/CPAL emoji (C4). Font removed while still referenced by a node (A10 → reference fallback). Concurrent edits to font set (broadcast/transport).

---

## Sub-spec breakdown & sequencing

- **Fonts-1 — Font model, embedding & FontFace loading (NEXT; works on current Canvas-2D renderer).**
  Owns: A (all), B1–B5, C1, C3 (establish), C5 (FontFace), C6, H (UI hooks), I, and the J cases reachable on the Canvas-2D path. Delivers: portable workfiles + custom fonts rendering on today's renderer + missing-font metric fallback. **No server, no library catalog, no picker UI beyond add-from-file, no Skia.**
  Depends on: nothing new (frontend + core).

- **Fonts-2 — Server store, library catalog, picker UI, missing-font UX, MCP.**
  Owns: D, E, F, broad Noto coverage. Depends on: Fonts-1 (the model).

- **Fonts-3 — Local font sourcing.**
  Owns: G (Tauri OS fonts + web Local Font Access). Depends on: Fonts-1.

- **11c-A loader swap (part of the render-core spec).**
  Owns: C2, C4 (Skia fallback wiring), C5 (Skia path). Swaps the Fonts-1 FontFace loader for CanvasKit `FontMgr`. Depends on: Fonts-1.

- **Export/print subsetting (future spec).** Owns: B6.

Sequencing: **Fonts-1 → (Fonts-2, Fonts-3, 11c-A in any order, all depend only on Fonts-1)**. 11c-A's text consumes Fonts-1's model + (its own) Skia loader.

---

## Cross-cutting CLAUDE.md obligations (apply to every sub-spec that touches them)
- §10 Transport Boundary Inventory + Cross-Stack Type Extension Inventory for `FontRef`/`FontSource` (Fonts-1) and any catalog type (Fonts-2), with machine-verifiable receipts.
- §11 Parallel-Implementations Parity Tests: `tests/fixtures/parity/` fixture per `FontSource` variant.
- §11 Discriminated-Union exhaustive dispatch (Rust no-wildcard `match` + TS `.test-d.ts`) for `FontSource`.
- Schema Migration Persistence Contract (Fonts-1 A8): backup + forced-persist + CI fixture.
- Validation symmetric across transports; `validate.rs` single-source constants + `test_*_enforced`.
- MCP broadcast payload shape + canonical post-mutation value + `id` in create broadcasts (Fonts-1/2).
- Undo/redo wired same-PR for every user-mutatable font operation (Fonts-1 A9).
- a11y: font picker combobox pattern, missing-font alert as a scoped status region (Fonts-2 E1/E4).
- Filesystem atomic writes + UUID filenames + manifest validation for `.sigil/fonts/` (Fonts-1 A7) and the server store (Fonts-2 D1).
- CORS/CSP for font fetches (Fonts-2 D5).

## Open questions (resolve in the owning sub-spec)
- Exact `FontRef` representation: does `TextStyle.font_family: String` become `font: FontRef`, or do we keep `font_family` + add a resolved `font_ref`? (Fonts-1 — affects migration + 11c-B.)
- WOFF2 decoder: pure-Rust (`woff2` crate, WASM-safe?) vs a WASM `hb`/`brotli` path. (Fonts-1 B4.)
- Where metric extraction + fsType parsing live: Rust core (shared, WASM) vs frontend TS. Prefer core (single source, reused by server/headless). (Fonts-1.)
- Bundled default set exact list + licenses (Inter? Source Sans? + mono + Noto emoji + which Noto CJK). (Fonts-1 default floor + Fonts-2 library.)

## Nothing-missed checklist
Model ✓(A) · embedding ✓(A3) · fsType/provenance/legal ✓(B1/B2/H) · metrics+fallback ✓(A4/C3) · current-renderer loading ✓(C1) · Skia loading ✓(C2/11c-A) · server+catalog+library ✓(D) · upload+picker+status+missing-UX ✓(E) · MCP ✓(F) · Tauri/Local-Font-Access ✓(G) · subsetting/export ✓(B6) · migration ✓(A8) · undo ✓(A9) · transports/sentinels/parity ✓(A5) · validation/limits ✓(A6) · variable fonts ✓(A1/E5) · CJK/emoji fallback ✓(C4) · perf ✓(I) · edge cases ✓(J).
