# Font Pipeline Architecture — Research & Decision Notes

**Date:** 2026-06-11
**Status:** Pre-spec analysis. Surfaced while planning 11c-A (CanvasKit render core): the app has **no font binaries** today (text delegates to browser system fonts), but Skia/CanvasKit needs font *bytes* via `FontMgr.FromData`.
**Question:** How do Figma/Penpot feed fonts to a GPU/Skia renderer, and what should Sigil do?

## The hard constraint
CanvasKit/Skia has **no system fonts** and ships ~one font (NotoMono). Text renders only from font bytes explicitly loaded via `FontMgr.FromData`. So "store the family name string" (what Sigil does today) is insufficient post-CanvasKit — we must acquire, transport, and load the actual binary for every family/weight/style a document uses, or Skia paints a serif fallback ("tofu").

## How the analogs do it
**Penpot (closest analog — Rust + `skia-safe` WASM renderer "render-wasm"):**
- **Workfile stores a font *reference*** (family id + variant + source), **never the binary**.
- **Server owns the bytes:** pluggable asset storage (fs / S3 / Postgres blob), content-hash dedup, served by Penpot itself at `/assets/by-id/<uuid>` (custom) or an internal Google-Fonts proxy `/internal/gfonts/...` (self-hosted gstatic, disableable for offline).
- **Load path:** `fetch` → ArrayBuffer → copy into WASM heap (`_alloc_bytes` → `HEAPU8.set`) → `_store_font(uuid, weight, style, isEmoji, isFallback)` → Rust `FontMgr::new_from_data` → `TypefaceFontProvider::register_typeface` → `FontCollection`.
- **Bundled floor:** `include_bytes!("sourcesanspro-regular.ttf")` + a UI font compiled in, so the renderer is never empty.
- **Async:** renders before fonts arrive (shows fallback), then a `:font-loaded` event re-runs text layout + invalidates tiles. (Bug #9574: must invalidate immediately, not on hover.)
- **Fallbacks:** explicitly loads Noto fonts for 50+ scripts + Noto Color Emoji, each flagged `is-fallback`. WASM Skia has **no automatic system fallback** — you must load every fallback.
- **Custom fonts:** team-level upload, TTF/OTF/WOFF/WOFF2; same-family files grouped as variants; user owns licensing.

**Figma:** desktop reads OS fonts natively; the **web app ships a localhost "Font Agent"** that enumerates+serves installed-font bytes to figma.com (restricted to figma.com). Three sources by priority: org-uploaded > local (agent) > Google Web Fonts. Missing-font **modal** remaps affected layers to an available font; renders a substitute meanwhile.

**Flutter Web (CanvasKit):** bundles a base set, async-loads buffers, auto-downloads Noto per detected script filtered by glyph coverage, defaults to Noto Color Emoji. Real engineering (precedence, BMP gaps, multi-second tofu).

## Key architectural difference for Sigil
Penpot built its **own** Rust+skia-safe WASM module, so fonts cross JS→heap→Rust FFI. **Sigil uses CanvasKit** (prebuilt Skia WASM with a JS API) — so fonts load **JS-side, directly**: `fetch → arrayBuffer → CanvasKit.FontMgr.FromData([buf])`, then `ParagraphStyle.fontFamilies: ["Inter"]`. **No manual heap copy / FFI.** This makes Sigil's load path materially simpler than Penpot's.

## Local Font Access API (`queryLocalFonts()`)
Enumerate installed fonts + read raw SFNT via `.blob()` → feed to `FontMgr.FromData`. **Chromium desktop only** (no FF/Safari/mobile), permission-prompted, HTTPS-only. Opportunistic web enhancement, never baseline. In **Tauri desktop, read OS font files in Rust** instead (no API, no prompt, all platforms) — Sigil's Figma-Font-Agent equivalent, in-process and free.

## Licensing
Google Fonts are OFL (some Apache-2.0): bundling + redistribution + commercial use OK with notice retention; don't sell standalone; don't reuse a Reserved Font Name on a modified version. **Self-host, don't hotlink.** Skia needs **TTF/OTF (SFNT)** — WOFF2 must be decompressed before `FromData`. Subset bundled UI fonts; serve **full** files for document fonts (designers type any glyph).

## Recommended architecture for Sigil
**Principle (Penpot's proven split):** workfile stores a font *reference*; server/bundle owns *bytes*; Skia frontend fetches → `FontMgr.FromData`. Keeps `sigil-core` I/O-free (owns only the reference schema).

- **Bundled default set** (frontend Vite assets, fetched at startup): a default sans (Inter — current app default, OFL) + a mono + Noto Color Emoji (+ optionally 1–2 Noto CJK). Guarantees text always renders.
- **Server-hosted fonts** (later): Axum font asset store `GET /assets/fonts/by-id/<uuid>` (atomic tmp+rename, dedup) + Google proxy `/internal/gfonts/...` (offline-disableable) + a **catalog query** so the picker and MCP agents resolve name→id consistently.
- **Workfile/core (later):** a `FontRef { id, family, weight, style, source: Builtin | Google | Custom }` schema. This is a **shared wire-format type** → triggers §10 Transport Boundary Inventory + §11 exhaustiveness sentinels (Rust enum + TS mirror + `.test-d.ts` + apply-remote/GraphQL/MCP handling).
- **MCP/agents:** operate on references only (token-efficient); server validates a ref against the catalog and returns a typed "font unavailable" error (no silent substitution); broadcasts carry the canonical resolved ref.
- **Tauri:** Rust OS-font reader feeding the same load path; bundle defaults in app resources.
- **Missing-font UX (mandatory):** detect refs lacking bytes, render a labeled fallback, offer a remap modal (Figma-style) — not Penpot's silent serif.

## Proposed sequencing
- **11c-A (render core):** bundle a minimal default set (sans + mono + emoji) as frontend assets; build a `skia-fonts.ts` that `FontMgr.FromData`s them into a `FontCollection`/typeface provider at startup; `skia-text` renders using bundled families matched by name, falling back to the default. **No FontRef schema, no server store, no upload yet.** Documented limitation: unbundled family names render in the bundled default. Stays frontend-only.
- **Dedicated Font Pipeline spec (e.g. 11c-C / "fonts"):** the full system — `FontRef` schema (core/workfile + transports + sentinels), server asset store + Google catalog/proxy, custom upload, picker resolution, missing-font UX, Tauri OS fonts, optional Local Font Access. Its own cross-cutting epic.

## Sources
Penpot `frontend/src/app/render_wasm/api/fonts.cljs`, `render-wasm/src/render/fonts.rs`, PRs #6050/#6178, issue #9574; Figma help docs (font installer, missing-font, org upload); CanvasKit Quickstart + CHANGELOG; Flutter engine font-fallback PRs; MDN Local Font Access API; Google Fonts OFL; fonttools subset docs.
