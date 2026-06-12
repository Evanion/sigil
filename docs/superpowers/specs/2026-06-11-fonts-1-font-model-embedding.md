# Spec Fonts-1 — Font Model, Embedding & FontFace Loading

**Date:** 2026-06-11
**Status:** Ready for plan
**Epic:** Font subsystem — see `docs/superpowers/specs/2026-06-11-font-epic-overview.md` (completeness map). This is the foundation slice.
**Research:** `docs/superpowers/research/2026-06-11-font-pipeline-architecture.md`, `docs/superpowers/research/2026-06-11-font-embedding-permissions.md`.
**Downstream:** Fonts-2 (server/library/picker/missing-UX/MCP), Fonts-3 (Tauri/Local-Font-Access), 11c-A (swaps the FontFace loader for CanvasKit).

## 1. Overview
Introduce a document-level **font table** and a renderer-agnostic font pipeline so workfiles are **portable** (embeddable custom fonts travel inside the `.sigil/` package) without illegally redistributing system/proprietary fonts. Font classification (embed vs reference) and metric extraction run in `sigil-core` via `ttf-parser`. The **current Canvas-2D renderer** is wired to render embedded/custom fonts via the browser `FontFace` API, and to render a **metric-preserving fallback** (no reflow) for referenced fonts that aren't locally available. Server hosting, a real picker, library/Google fonts, and the full missing-font UX are **Fonts-2**.

## 2. Goals / Non-Goals
**Goals**
- A `FontEntry` font table in the document model + a per-text-node reference to it (replacing `TextStyle.font_family: String`).
- Core classification: `OS/2.fsType` → embed/reference decision; provenance flag; metric extraction — via `ttf-parser`.
- Embed full-face custom-font bytes into `.sigil/fonts/<uuid>` with manifest metadata; atomic writes; manifest↔disk validation.
- Commands: add/remove font entry, set node font — validated, undo-wired, transport-symmetric.
- `FontFace` loader: embedded fonts render in the current Canvas-2D renderer; metric-retuned fallback for missing referenced fonts.
- Minimal "add font from file" affordance wired to the existing typography font field.
- Schema migration of existing `font_family` strings → `SystemReference` entries.

**Non-Goals (owned by later specs — see §11)**
- Server font store, OFL/Google library catalog, Google proxy (Fonts-2).
- Full font picker, per-font embed/reference status panel, missing-font alert/remap UX (Fonts-2).
- MCP catalog resolution semantics (Fonts-2; the `FontEntry` type IS wired through MCP here).
- WOFF/WOFF2 ingestion (Fonts-2) — Fonts-1 ingests **sfnt TTF/OTF** only; non-sfnt uploads are rejected with a typed error.
- Tauri OS-font reading, Local Font Access API (Fonts-3).
- CanvasKit `FontMgr` loading + Skia script/emoji fallback (11c-A).
- Export-time subsetting (future export spec).
- Variable-font axis editing UI (Fonts-2/11c-B); the data model carries axes, no axis editor ships here.
- **Undo of font-library mutations.** Adding/removing a font in the document font library (`addFont`/`removeFont`) is a **resource-import** operation and is intentionally NOT on the undo stack (like importing an image asset). Only `setNodeFont` — which font a text node uses — is undoable (via the client HistoryManager). This is a deliberate deviation from the "all entity mutations wired to history" convention, recorded here per the Design Decision Criteria (RF-018, PR #77 review).

## 3. PDR Traceability
**Implements:** custom-fonts capability (memory `project_font_strategy`: "custom fonts essential for v1"); enables portable workfiles. **Defers:** library/Google fonts (Fonts-2), local OS fonts (Fonts-3), GPU text (11c-A), OpenType feature/variable editing (11c-B). **MVP coverage:** no MVP capability dropped; text rendering for the default/system case is preserved (migration maps existing nodes to `SystemReference`, which renders exactly as today via the browser).

## 4. Architecture

### 4.1 Document model — the font table (core)
A document owns a font table: an ordered, id-keyed collection of `FontEntry`. Each text node's `TextStyle` references a `FontEntry` by id and carries the *instance* parameters (weight/style/axes), so a single embedded file serves many nodes/weights (variable-font friendly).

```rust
// crates/core — sketch; field names finalized in implementation, private fields + validating constructor.
pub struct FontEntry {
    id: FontEntryId,              // stable UUID
    family: String,               // display/CSS family name (validated: no CSS-significant chars)
    postscript_name: String,
    source: FontSource,
    metrics: FontMetrics,         // for no-reflow fallback
    fs_type: u16,                 // raw OS/2 fsType (never rewritten)
    embeddable: EmbedDecision,    // resolved: Embed | ReferenceRestricted | ReferenceSystem | ReferenceNoOs2
    is_variable: bool,
    // available axes (for variable fonts): tag + min/default/max
    axes: Vec<FontAxis>,
}

pub enum FontSource {
    Bundled,                          // shipped default floor (no bytes in workfile)
    Library { catalog_id: String },   // OFL/Google — referenced, re-fetched (Fonts-2)
    Custom { asset_uuid: Uuid },      // embedded bytes at .sigil/fonts/<uuid>
    SystemReference,                  // resolved by name on the opening machine
}

pub struct FontMetrics {            // all f32, NaN/inf-rejected at construction
    units_per_em: u16,
    ascent: f32, descent: f32, line_gap: f32,
    cap_height: f32, x_height: f32, italic_angle: f32,
    avg_advance: f32,               // for size-adjust; per-glyph widths optional (deferred)
    panose: [u8; 10], is_serif: bool,
}
```

`TextStyle.font_family: String` is replaced by `font_entry: FontEntryId`. The existing `font_weight`/`font_style` remain on `TextStyle` as the chosen instance (resolved against the entry's `axes`/faces). The text node references the entry; the entry is the single source of truth for family/source/metrics/bytes.

### 4.2 Classification & metric extraction (core, `ttf-parser`)
A pure function in `crates/core` takes font bytes + a `provenance: FontProvenance` (`UserSupplied | SystemDirectory`) and returns the parsed identity, `FontMetrics`, raw `fs_type`, and the resolved `EmbedDecision`:
- `fsType` usage sub-field resolved **least-restrictive-wins**; only canonical `0x0002` = Restricted. Embed iff usage ∈ {Installable `0x0000`, Editable `0x0008`} AND provenance ≠ SystemDirectory AND not bitmap-only-on-outlines. Preview&Print `0x0004`, Restricted, bitmap-only, missing OS/2 → a Reference* decision. Honor No-subsetting (`0x0100`) — irrelevant in Fonts-1 (full-face only) but recorded.
- Never modify `fs_type`.
- Reject corrupt/non-sfnt input with a typed `FontError`.

### 4.3 Embedded storage (core workfile + server persistence)
Custom (embeddable) fonts store **original full-face sfnt bytes** at `.sigil/fonts/<asset_uuid>.<ext>`; the manifest carries the `FontEntry`. Atomic tmp+rename writes (unique suffix). On load, the `fonts/` directory is validated against the manifest: orphan files (on disk, not in manifest) warned/ignored; missing referenced files produce a typed load warning and the entry degrades to `SystemReference`-style fallback. UUID filenames only (no user-string names).

### 4.4 Commands (core; undo-wired; transport-symmetric)
- `AddFontEntry { bytes, provenance }` → classifies; if embeddable, writes bytes + adds a `Custom` entry; else adds a `SystemReference`/`Library` entry (no bytes). Rejects duplicates (same content hash) by returning the existing id. Broadcast includes the new entry's `id`.
- `RemoveFontEntry { id }` → validates no node still references it (or reparents references to a fallback with a typed error if in use); deletes bytes.
- `SetNodeFont { node, font_entry, weight, style, axes }` → validates the entry exists and the instance params are in range.
Each has `validate` → `apply`; `MAX_FONTS_PER_DOCUMENT` enforced on add.

### 4.5 FontFace loader (frontend, current Canvas-2D renderer)
On document load and on font-added events: for each `Custom` entry, fetch its bytes from the workfile, `new FontFace(family, arrayBuffer, { weight, style })` → `document.fonts.add(face)` → `await face.load()`; on completion fire a re-render. `SystemReference`/`Library` entries: attempt local resolution by family name; if `document.fonts.check()` fails, register a **metric-retuned fallback** `@font-face` (a local fallback family with `size-adjust`/`ascent-override`/`descent-override`/`line-gap-override` computed from the entry's `FontMetrics`) under the intended family name, so `ctx.font` resolves it **without reflow**, and set a per-entry `missing: true` flag (consumed by Fonts-2's alert UI). All loads are awaited and re-render-triggered (no fire-and-forget); failures revert + log.

### 4.6 Migration
Existing documents carry `TextStyle.font_family: String`. Migration creates one `SystemReference` `FontEntry` per distinct family (capturing metrics if the family resolves locally at migration time, else default metrics) and rewrites each node to reference it. Schema version bump (v(N)→v(N+1)); the load path force-persists and writes `.backup-v(N)/` per the Schema Migration Persistence Contract; a CI smoke test exercises a checked-in v(N) fixture and asserts the v(N+1) on-disk result + byte-identical backup.

## 5. WASM Compatibility
`crates/core` gains one dependency: **`ttf-parser`** — `no_std`, zero-allocation, no I/O, compiles to `wasm32-unknown-unknown` (used by `fontdue`, `cosmic-text`, `resvg`; WASM-proven). No `Send`/`Sync`/`'static` bounds introduced. No randomness/system calls. Font bytes are passed in by the caller (server reads files; frontend passes `ArrayBuffer`) — core never does I/O. Evidence to cite in the PR: `ttf-parser` crate `no_std` + `wasm32` CI.

## 6. Input Validation Inventory
- `MAX_EMBEDDED_FONT_BYTES` (e.g. 32 MiB) — enforced on `AddFontEntry`; `test_max_embedded_font_bytes_enforced`.
- `MAX_FONTS_PER_DOCUMENT` (e.g. 256) — enforced on add; `test_max_fonts_per_document_enforced`.
- Family / PostScript name: reject CSS-significant chars (quotes, `;`, `{}`, `\`, C0 controls) in `validate.rs` (shared with the frontend single-source module) — these flow into `ctx.font`/CSS. Length cap `MAX_FONT_NAME_LEN`.
- `FontMetrics` floats: reject NaN/inf at construction; ranges where bounded (units_per_em > 0; non-negative ascent/line_gap).
- Variable-font axis values: within the entry's declared min/max; tags are 4 ASCII chars.
- Deserialization: manual `Deserialize` routed through the validating constructor (no derive on validated types); duplicate-key rejection; private fields.
- Font bytes: must be valid sfnt (TTF/OTF magic) — typed `FontError` otherwise.

## 7. Consistency Guarantees
- **Atomicity:** `AddFontEntry` writes bytes (atomic tmp+rename) then adds the manifest entry; on failure either both or neither (write bytes first to a tmp, add entry, rename — or roll back the entry if rename fails). `RemoveFontEntry` removes the entry then the bytes; if the entry is still referenced, it fails before any deletion. Multi-node `SetNodeFont` batches roll back on partial failure.
- **Invariants:** every `TextStyle.font_entry` references an existing `FontEntry`; every `Custom` entry has a byte file present (else degraded on load with a warning); no orphan byte files survive a clean save.
- **Eviction/capacity:** font table bounded by `MAX_FONTS_PER_DOCUMENT`; no implicit eviction (removal is explicit).
- **Migration:** see §4.6 — one-way, backed up, force-persisted.

## 8. Recursion Safety
No new recursive algorithm. `ttf-parser` table parsing is bounded/iterative. Font-table iteration and node rewrites are flat loops. (No depth constant required.)

## 9. Tool Lifecycle Contract
**N/A** — no new canvas tool. Text-editing overlay lifecycle is unchanged (font selection mutates `TextStyle.font_entry` through the existing panel commit path).

## 10. Transport Boundary / Cross-Stack Type Extension Inventory
New shared wire-format types: `FontEntry`, `FontSource` (discriminated union), `FontMetrics`, `FontAxis`, `EmbedDecision`, and the `TextStyle.font_entry` field.
For each:
- **Rust def:** `crates/core` (font module + `validate.rs`).
- **TS mirror:** `frontend/src/types/document.ts` + a `.test-d.ts` exhaustiveness sentinel for `FontSource`/`EmbedDecision`.
- **Transport handlers (all updated this PR):** GraphQL resolver (font table + node font), MCP tool(s) for add/remove/set-font, `frontend/src/operations/apply-remote.ts` handler (incl. `id` in the add broadcast + canonical post-mutation `value`), persistence (workfile manifest + `fonts/`).
- **Pattern-match sites:** every Rust `match` on `FontSource` (no wildcard) across core/server/mcp; every TS `switch` on the mirror.
- **Parity fixture:** `tests/fixtures/parity/font_entry_encoding.json` — one entry per `FontSource` variant + a variable-font entry + sRGB/representative metrics; loaded by both the Rust and TS test suites.
Receipt: the PR enumerates each handler as updated (not "no change"); the `FontSource` exhaustiveness sentinel failing-on-missing-variant is the machine-verifiable guard.

## 11. Staged Feature Delivery Contract (deferred-to-Fonts-2/3/11c-A inventory)
Fonts-1 ships the data layer + a minimal add-font affordance + the current-renderer loader. Deferred, with owners:
1. Server font store + OFL/Google library + Google proxy → **Fonts-2**. (Until then, `Library` entries resolve by local name like `SystemReference`.)
2. Full font picker, per-font embed/reference status panel, missing-font **alert/remap** UX → **Fonts-2**. (Fonts-1 sets the `missing` flag and renders the metric fallback; no alert UI yet — text still renders, never silently wrong-without-trace because the entry carries `missing` + the decision.)
3. MCP catalog resolution semantics + typed "font unavailable" → **Fonts-2** (the `FontEntry` type and add/remove/set tools ARE wired here).
4. WOFF/WOFF2 ingestion → **Fonts-2**.
5. Tauri OS fonts / Local Font Access → **Fonts-3**.
6. CanvasKit `FontMgr` loading + Skia script/emoji fallback → **11c-A**.
Reviewers: do not file findings for these pre-disclosed deferrals. Each owning spec's PR references this inventory.

## 12. Accessibility
The only new UI is an "add font from file" control: a real `<button>` (or Kobalte Button wrapper) triggering a file input, with an accessible name; on add/failure, write a message to a scoped `role="status"` region (success "Added <family>", failure with the typed reason). No high-frequency live regions. Full picker a11y is Fonts-2.

## 13. Dependencies
- Core: `ttf-parser` (pinned exact). No other new core deps.
- Frontend: none new (uses the platform `FontFace`/`document.fonts` API + `@font-face` metric descriptors).
- No bundled font file required in Fonts-1 (the current renderer falls back to browser/system fonts for `SystemReference`); the bundled default floor arrives with the CanvasKit loader (11c-A) / library (Fonts-2).

## 14. Testing
- Rust: classification unit tests with fixture fonts covering each `fsType` decision (Installable/Editable embed; Restricted/Preview&Print/bitmap-only/no-OS2 reference; least-restrictive multi-bit; system-provenance override); metric extraction vs known values; `MAX_*` enforcement tests; duplicate-key/validation rejection; migration smoke test (v(N) fixture → v(N+1) + byte-identical `.backup-vN/`).
- Parity: `font_entry_encoding.json` asserted by Rust + TS.
- Frontend: FontFace loader integration test (embedded entry → `document.fonts` has the face → re-render fired); metric-fallback test (missing entry → a `@font-face` with the computed `size-adjust`/`ascent-override` is registered, `missing` flag set); add-font flow (file → core classify → entry appears) — Reactive-pipeline end-to-end (producer→consumer) per frontend-defensive rules.
- `.test-d.ts` exhaustiveness sentinel for `FontSource`/`EmbedDecision`.

## 15. Acceptance Criteria
- [ ] `FontEntry` font table + `TextStyle.font_entry` in core, with private fields + validating constructor + manual `Deserialize`.
- [ ] `ttf-parser` classification (fsType+provenance → decision) and metric extraction in core, fully unit-tested per decision branch.
- [ ] Custom fonts embed full-face bytes in `.sigil/fonts/<uuid>` (atomic, UUID-named) with manifest↔disk validation.
- [ ] Add/remove/set-node-font commands: validated, undo-wired, transport-symmetric (GraphQL+MCP+apply-remote+persistence), with the §10 receipt.
- [ ] FontFace loader renders embedded fonts in the current Canvas-2D renderer; missing referenced fonts render a metric-retuned fallback with no reflow + `missing` flag.
- [ ] "Add font from file" affordance wired to the typography font field, with a `role="status"` outcome.
- [ ] Migration: existing `font_family` → `SystemReference` entries, schema bump + `.backup-vN/` + CI smoke test (byte-identical backup).
- [ ] All `MAX_*` constants have enforcement tests; `FontSource`/`EmbedDecision` have exhaustiveness sentinels + parity fixture.
- [ ] No server, library, picker, missing-alert UI, WOFF2, Tauri, or CanvasKit code (those are deferred per §11).

## 16. References
- Epic map: `docs/superpowers/specs/2026-06-11-font-epic-overview.md`
- Research: `docs/superpowers/research/2026-06-11-font-pipeline-architecture.md`, `2026-06-11-font-embedding-permissions.md`
- Current text path to be extended (not replaced) in Fonts-1: `frontend/src/canvas/renderer.ts` (text arm), `frontend/src/canvas/text-measure.ts` (`buildFontString`), `frontend/src/panels/TypographySection.tsx` (font field).
- Core text type: `crates/core/src/node.rs` (`TextStyle`), `crates/core/src/validate.rs`.
