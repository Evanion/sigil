# Fonts-1 — Font Model, Embedding & FontFace Loading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a document-level font table with fsType-based embed/reference classification and metric extraction (Rust core), embed custom fonts in the `.sigil/` package, and render them on the current Canvas-2D renderer via `FontFace` — so workfiles are portable and custom fonts render, engine-agnostically.

**Architecture:** A `FontEntry` table lives on the `Document`; each text node's `TextStyle` references an entry by id (`font_entry`), replacing `font_family`. `ttf-parser` (core, WASM-safe) parses `OS/2.fsType` + metrics and decides embed-vs-reference. Embeddable fonts store full-face sfnt bytes at `.sigil/fonts/<uuid>`. The frontend loads embedded bytes via `FontFace`/`document.fonts` and registers metric-retuned `@font-face` fallbacks for missing referenced fonts. Migration v2→v3 maps existing `font_family` strings to `SystemReference` entries.

**Tech Stack:** Rust (core `no_std`-friendly, `ttf-parser`), TypeScript/Solid.js, the platform `FontFace`/`document.fonts` API, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-fonts-1-font-model-embedding.md`. **Epic map:** `docs/superpowers/specs/2026-06-11-font-epic-overview.md`.

**Hard rules for the executor:**
1. **Mirror existing patterns exactly** (cited inline): validated types → `TextShadow` (`crates/core/src/node.rs:252-436`); commands → `SetTextStyleField` (`crates/core/src/commands/text_style_commands.rs`); migration+backup → `migrate_to_v2` (`crates/core/src/migrations.rs`) + `backup_v1_files` (`crates/server/src/workfile.rs`).
2. **Validated types have private fields + a validating `new()` + manual `Deserialize` routed through `new()` with duplicate-key rejection.** No `#[derive(Deserialize)]` on validated types (rust-defensive rule).
3. **Core stays WASM/no-I/O.** `ttf-parser` added with `default-features = false` (mirror the `uuid` no-std discipline in `crates/core/Cargo.toml`).
4. **Every `MAX_*` constant gets a `test_<const>_enforced`** (at-limit passes, over-limit errors). Every new command gets `test_<op>_validate_and_apply`.
5. **Discriminated unions (`FontSource`, `EmbedDecision`) get exhaustive Rust `match` (no wildcard) + a TS `.test-d.ts` sentinel + a parity fixture.**
6. Commit after every task. All commands via `./dev.sh`.

---

## File Structure

**New (core):**
- `crates/core/src/font.rs` — `FontEntry`, `FontSource`, `FontMetrics`, `FontAxis`, `EmbedDecision`, `FontEntryId`, the font table type. Validated types.
- `crates/core/src/font_parse.rs` — `classify_font(bytes, provenance) -> Result<ParsedFont, CoreError>` via `ttf-parser`.
- `crates/core/src/commands/font_commands.rs` — `AddFontEntry`, `RemoveFontEntry`, `SetNodeFont`.

**Modified (core):**
- `crates/core/src/node.rs` — `TextStyle.font_family: String` → `font_entry: FontEntryId`.
- `crates/core/src/document.rs` — add the font table to `Document`.
- `crates/core/src/validate.rs` — new constants + validators + `_enforced` tests; bump `CURRENT_SCHEMA_VERSION` to 3.
- `crates/core/src/migrations.rs` — `migrate_to_v3`.
- `crates/core/src/serialize.rs` — wire `migrate_to_v3`.
- `crates/core/src/lib.rs` + `commands/mod.rs` — module exports.
- `crates/core/Cargo.toml`, root `Cargo.toml` — add `ttf-parser`.

**Modified (server):**
- `crates/server/src/workfile.rs` — `fonts/` storage, `atomic_write_bytes`, manifest font-list, load validation, backup dir → `.backup-v2`.
- `crates/server/src/graphql/mutation.rs` — font ops.
- `crates/mcp/src/server.rs` + `crates/mcp/src/tools/` — font tools.

**Modified/new (frontend):**
- `frontend/src/types/document.ts` — `FontEntry`/`FontSource`/`FontMetrics` mirrors; `TextStyle.font_entry`.
- `frontend/src/types/__tests__/document-font-source.test-d.ts` — sentinel.
- `frontend/src/canvas/font-face-loader.ts` — `FontFace` registration + metric fallback.
- `frontend/src/operations/apply-remote.ts` — font op handlers.
- `frontend/src/store/document-store-solid.tsx` — font-table store + `setNodeFont`/`addFont` + history.
- `frontend/src/panels/TypographySection.tsx` — "add font from file" affordance.

**New (fixtures):**
- `tests/fixtures/parity/font_entry_encoding.json`.
- `tests/fixtures/fonts/*.ttf` — small OFL test fonts with known fsType values (for classification tests).

---

## Phase 1 — Core font types (validated)

### Task 1: Add `ttf-parser` dependency
**Files:** Modify root `Cargo.toml`, `crates/core/Cargo.toml`.

- [ ] **Step 1: Add to workspace deps.** In root `Cargo.toml` `[workspace.dependencies]`:
```toml
ttf-parser = { version = "0.21", default-features = false }
```
- [ ] **Step 2: Add to core.** In `crates/core/Cargo.toml` `[dependencies]`:
```toml
ttf-parser = { workspace = true }
```
- [ ] **Step 3: Verify WASM-clean build.**
Run: `./dev.sh cargo build -p sigil-core --target wasm32-unknown-unknown`
Expected: builds (proves `ttf-parser` `default-features=false` is WASM-safe). If it fails on a feature, disable it.
- [ ] **Step 4: Commit.** `git add Cargo.toml crates/core/Cargo.toml && git commit -m "build(core): add ttf-parser (wasm-safe) for font parsing (fonts-1)"`

### Task 2: `FontSource`, `EmbedDecision`, `FontAxis`, `FontMetrics`, `FontEntryId`
**Files:** Create `crates/core/src/font.rs`; Modify `crates/core/src/lib.rs` (add `pub mod font;`); Test: in-module `#[cfg(test)]`.

- [ ] **Step 1: Write failing tests** (`font.rs` test module):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_font_source_variants_construct() {
        let _ = FontSource::Bundled;
        let _ = FontSource::Library { catalog_id: "inter".into() };
        let _ = FontSource::Custom { asset_uuid: uuid::Uuid::nil() };
        let _ = FontSource::SystemReference;
    }
    #[test]
    fn test_font_metrics_rejects_nan() {
        let bad = FontMetrics::new(1000, f32::NAN, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0;10], true);
        assert!(bad.is_err());
    }
    #[test]
    fn test_font_metrics_rejects_zero_upem() {
        let bad = FontMetrics::new(0, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0;10], true);
        assert!(bad.is_err());
    }
    #[test]
    fn test_font_metrics_valid() {
        assert!(FontMetrics::new(1000, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0;10], true).is_ok());
    }
}
```
- [ ] **Step 2: Run → fail.** `./dev.sh cargo test -p sigil-core font::tests` → FAIL (module missing).
- [ ] **Step 3: Implement** the enums + `FontMetrics` validated type. `FontSource` and `EmbedDecision` are simple discriminated enums (derive `Serialize`/`Deserialize` is acceptable ONLY for fieldless/simple-payload enums — but to honor the no-derive-on-validated rule, `FontMetrics` and `FontEntry` use manual `Deserialize`; the enums may derive since they carry no validated invariants beyond their variants). `FontMetrics` mirrors `TextShadow` (node.rs:252-436): private fields, `new()` calling `validate_finite` (reuse from validate.rs) + `units_per_em > 0`, accessors, manual `Deserialize` with duplicate-key rejection routed through `new()`.
```rust
use serde::{Deserialize, Serialize};
pub type FontEntryId = uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum FontSource {
    Bundled,
    Library { catalog_id: String },
    Custom { asset_uuid: uuid::Uuid },
    SystemReference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbedDecision { Embed, ReferenceRestricted, ReferenceSystem, ReferenceNoOs2, ReferencePreviewPrint }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FontAxis { pub tag: [u8; 4], pub min: f32, pub default: f32, pub max: f32 }

#[derive(Debug, Clone, PartialEq)] // NO derive Deserialize — validated
pub struct FontMetrics { /* private fields per TextShadow pattern */ }
// new(units_per_em:u16, ascent,descent,line_gap,cap_height,x_height,italic_angle,avg_advance:f32, panose:[u8;10], is_serif:bool) -> Result<Self, CoreError>
// accessors + manual Serialize/Deserialize routed through new()
```
- [ ] **Step 4: Run → pass.** `./dev.sh cargo test -p sigil-core font::tests` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): FontSource/EmbedDecision/FontMetrics types (fonts-1)"`

### Task 3: `FontEntry` + font table
**Files:** Modify `crates/core/src/font.rs`; Test: in-module.

- [ ] **Step 1: Failing test** — `FontEntry::new` validates family name (reuse `validate_text_style_font_family` logic) + axes ranges; a `FontTable` add rejects past `MAX_FONTS_PER_DOCUMENT`:
```rust
#[test]
fn test_font_entry_rejects_bad_family() {
    let m = FontMetrics::new(1000,800.0,-200.0,0.0,700.0,500.0,0.0,500.0,[0;10],true).unwrap();
    assert!(FontEntry::new(uuid::Uuid::nil(), "Bad;Family".into(), "BadFamily".into(),
        FontSource::SystemReference, m, 0, EmbedDecision::ReferenceSystem, false, vec![]).is_err());
}
```
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `FontEntry` (validated type, private fields, manual `Deserialize`) with fields per the spec §4.1: `id, family, postscript_name, source, metrics, fs_type:u16, embeddable:EmbedDecision, is_variable:bool, axes:Vec<FontAxis>`. Add a `FontTable` newtype wrapping `Vec<FontEntry>` with `add()` (enforces `MAX_FONTS_PER_DOCUMENT`, rejects duplicate id), `remove(id)`, `get(id)`, `iter()`. Reuse the family-name validator (extract `validate_font_family_name(&str)` into `validate.rs` as a shared pub(crate) fn, replacing the inline body of `validate_text_style_font_family`).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): FontEntry + FontTable validated types (fonts-1)"`

### Task 4: Constants + enforcement tests
**Files:** Modify `crates/core/src/validate.rs`.

- [ ] **Step 1: Add constants** near the existing font constants (validate.rs ~line 57):
```rust
pub const MAX_EMBEDDED_FONT_BYTES: usize = 32 * 1024 * 1024; // 32 MiB
pub const MAX_FONTS_PER_DOCUMENT: usize = 256;
pub const MAX_POSTSCRIPT_NAME_LEN: usize = 256;
```
- [ ] **Step 2: Write enforcement tests** (mirror `test_max_text_shadow_blur_enforced`, validate.rs:1339):
```rust
#[test]
fn test_max_fonts_per_document_enforced() {
    let mut table = crate::font::FontTable::new();
    // fill to limit with valid entries (helper), assert the (MAX+1)th returns Err
    // ... build MAX_FONTS_PER_DOCUMENT valid entries, all Ok; the next add Err.
}
#[test]
fn test_max_embedded_font_bytes_enforced() {
    // AddFontEntry::validate with bytes.len() == MAX_EMBEDDED_FONT_BYTES → Ok path (size check passes);
    // MAX_EMBEDDED_FONT_BYTES + 1 → Err. (Exercised fully in Task 8 once the command exists; here assert the size guard fn.)
}
```
(Provide a `pub(crate) fn check_embedded_font_size(len: usize) -> Result<(), CoreError>` so this test exercises a real fallible validator now.)
- [ ] **Step 3: Run → fail, then implement the guard fn, then pass.**
- [ ] **Step 4: Commit.** `git commit -m "feat(core): font limit constants + enforcement tests (fonts-1)"`

---

## Phase 2 — Classification & metrics (ttf-parser)

### Task 5: `classify_font`
**Files:** Create `crates/core/src/font_parse.rs`; Modify `crates/core/src/lib.rs`; add `tests/fixtures/fonts/` test fonts; Test: in-module.

- [ ] **Step 1: Add small test fonts.** Place 3 tiny OFL fonts in `tests/fixtures/fonts/`: one with fsType Installable (`0x0000`, e.g. an Inter subset), one Editable (`0x0008`), and craft/modify one to Restricted (`0x0002`) using `fonttools` (`ttx` round-trip flipping OS/2.fsType) — commit them. Document provenance + license in `tests/fixtures/fonts/README.md`.
- [ ] **Step 2: Failing test:**
```rust
const INSTALLABLE: &[u8] = include_bytes!("../../../tests/fixtures/fonts/installable.ttf");
const RESTRICTED: &[u8] = include_bytes!("../../../tests/fixtures/fonts/restricted.ttf");
#[test]
fn test_classify_installable_user_supplied_embeds() {
    let p = classify_font(INSTALLABLE, FontProvenance::UserSupplied).unwrap();
    assert_eq!(p.decision, EmbedDecision::Embed);
    assert!(p.metrics.units_per_em() > 0);
}
#[test]
fn test_classify_restricted_references() {
    let p = classify_font(RESTRICTED, FontProvenance::UserSupplied).unwrap();
    assert_eq!(p.decision, EmbedDecision::ReferenceRestricted);
}
#[test]
fn test_classify_system_provenance_never_embeds() {
    let p = classify_font(INSTALLABLE, FontProvenance::SystemDirectory).unwrap();
    assert_eq!(p.decision, EmbedDecision::ReferenceSystem);
}
#[test]
fn test_classify_rejects_garbage() {
    assert!(classify_font(b"not a font", FontProvenance::UserSupplied).is_err());
}
```
- [ ] **Step 3: Run → fail.**
- [ ] **Step 4: Implement** `classify_font`:
```rust
use ttf_parser::Face;
pub enum FontProvenance { UserSupplied, SystemDirectory }
pub struct ParsedFont { pub family: String, pub postscript_name: String,
    pub metrics: FontMetrics, pub fs_type: u16, pub decision: EmbedDecision,
    pub is_variable: bool, pub axes: Vec<FontAxis> }

pub fn classify_font(bytes: &[u8], prov: FontProvenance) -> Result<ParsedFont, CoreError> {
    let face = Face::parse(bytes, 0).map_err(|e|
        CoreError::ValidationError(format!("invalid font: {e}")))?;
    let fs_type = face.tables().os2.map(|t| t.permissions_raw()).unwrap_or(0xFFFF); // sentinel: no OS/2
    let decision = resolve_decision(fs_type, &prov, &face);
    // metrics: face.units_per_em(), ascender(), descender(), line_gap(), capital_height(),
    //   x_height(), italic_angle(), an avg advance over a sample (or 0), os2 panose, is_serif from panose[0]==2
    // family: face.names() id 1; postscript_name: id 6
    // is_variable: face.is_variable(); axes: face.variation_axes()
    Ok(ParsedFont { /* ... */ })
}
fn resolve_decision(fs_type: u16, prov: &FontProvenance, face: &Face) -> EmbedDecision {
    if matches!(prov, FontProvenance::SystemDirectory) { return EmbedDecision::ReferenceSystem; }
    if fs_type == 0xFFFF { return EmbedDecision::ReferenceNoOs2; }
    let usage = fs_type & 0x000F;            // bits 0-3
    let bitmap_only = (fs_type & 0x0200) != 0;
    // least-restrictive-wins; only canonical 0x0002 is Restricted
    if usage == 0x0002 { return EmbedDecision::ReferenceRestricted; }
    if bitmap_only && /* has outlines */ true { return EmbedDecision::ReferenceRestricted; }
    // Installable(0) or Editable(8) → embed; Preview&Print(4) → reference for editable docs
    match usage {
        0x0000 | 0x0008 => EmbedDecision::Embed,
        0x0004 => EmbedDecision::ReferencePreviewPrint,
        _ => EmbedDecision::Embed, // multi-bit w/o canonical-restricted → least-restrictive
    }
}
```
(Verify `ttf-parser` exposes `permissions_raw()`/the OS/2 `fsType`; if the API differs in 0.21, read the raw OS/2 table `fsType` field via `face.raw_face()` table data. Confirm the exact accessor at implementation time.)
- [ ] **Step 5: Run → pass.**
- [ ] **Step 6: Commit.** `git commit -m "feat(core): fsType+metrics classification via ttf-parser (fonts-1)"`

---

## Phase 3 — Document font table + node reference

### Task 6: Add the font table to `Document`
**Files:** Modify `crates/core/src/document.rs`; Test: in-module.

- [ ] **Step 1: Failing test:** a fresh `Document` has an empty font table + a default `Bundled` entry; `doc.font_table().get(default_id)` is `Some`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** a `font_table: FontTable` field on `Document` (private + accessor `font_table()`/`font_table_mut()`), seeded with one `FontSource::Bundled` default entry (the app default family "Inter") whose `FontEntryId` is a fixed constant `DEFAULT_FONT_ENTRY_ID` so migration/new-node code can reference it. Update `Document::new()` + any `Serialize`/`Deserialize` of `Document`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): document font table with bundled default (fonts-1)"`

### Task 7: `TextStyle.font_family` → `font_entry`
**Files:** Modify `crates/core/src/node.rs`, `crates/core/src/validate.rs`, all in-core constructors/tests that build `TextStyle`.

- [ ] **Step 1: Failing test:** building a `TextStyle` now requires a `font_entry: FontEntryId`; `validate_text_style` checks the referenced entry exists (validation moves to require the `Document` context — adjust `validate_text_style` signature to take `&Document` or validate the reference at the command layer; mirror how `SetTextStyleField::validate` already has the doc). Test asserts a `TextStyle` referencing `DEFAULT_FONT_ENTRY_ID` validates, and an unknown id fails at the command layer.
- [ ] **Step 2: Run → fail (compile errors at every TextStyle construction site — expected).**
- [ ] **Step 3: Implement** the field swap: remove `font_family: String`, add `font_entry: FontEntryId`. Update `TextStyle` (still a plain carrier — keep `derive(Deserialize)`; the *validated* types are the font types). Update `validate_text_style` to drop the family-string check (now on `FontEntry`) and add a font-entry-existence check at the command layer (`SetNodeFont`/`SetTextStyleField`). Update every construction site flagged by the compiler (search `font_family:`), defaulting to `DEFAULT_FONT_ENTRY_ID`.
- [ ] **Step 4: Run → `./dev.sh cargo test -p sigil-core` green.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): TextStyle references font table by id (fonts-1)"`

---

## Phase 4 — Commands

### Task 8: `AddFontEntry`
**Files:** Create `crates/core/src/commands/font_commands.rs`; Modify `crates/core/src/commands/mod.rs`; Test: in-module.

- [ ] **Step 1: Failing test** (mirror `test_set_text_style_field_validate_and_apply`, text_style_commands.rs:315):
```rust
#[test]
fn test_add_font_entry_validate_and_apply() {
    let mut doc = Document::new();
    let bytes = include_bytes!("../../../../tests/fixtures/fonts/installable.ttf").to_vec();
    let op = AddFontEntry { entry_id: uuid::Uuid::from_u128(1), bytes, provenance: FontProvenance::UserSupplied };
    op.validate(&doc).expect("validate ok");
    op.apply(&mut doc).expect("apply ok");
    let e = doc.font_table().get(uuid::Uuid::from_u128(1)).expect("entry added");
    assert_eq!(e.embeddable(), EmbedDecision::Embed);
}
#[test]
fn test_add_font_entry_rejects_oversize() {
    let mut doc = Document::new();
    let op = AddFontEntry { entry_id: uuid::Uuid::from_u128(2), bytes: vec![0u8; MAX_EMBEDDED_FONT_BYTES + 1], provenance: FontProvenance::UserSupplied };
    assert!(op.validate(&doc).is_err());
}
```
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `AddFontEntry { pub entry_id, pub bytes, pub provenance }` as a `FieldOperation`: `validate` runs `check_embedded_font_size`, `classify_font`, and `font_table` capacity; `apply` re-classifies and inserts a `FontEntry`. NOTE: the bytes themselves are persisted by the server (Task 11) — the core command records the entry + the asset_uuid (= entry_id) for `Custom` decisions; for reference decisions no bytes are stored. The command does NOT write files (core is I/O-free) — it returns/records that bytes must be persisted; the server reads `op` results to write `fonts/<uuid>`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): AddFontEntry command (fonts-1)"`

### Task 9: `RemoveFontEntry` + `SetNodeFont`
**Files:** Modify `font_commands.rs`; Test: in-module.

- [ ] **Step 1: Failing tests:** `test_remove_font_entry_validate_and_apply` (rejects if any text node still references the id → `CoreError::ValidationError`; succeeds otherwise and removes it). `test_set_node_font_validate_and_apply` (sets `TextStyle.font_entry` on a text node; rejects unknown entry id and non-text node).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** both as `FieldOperation`s. `SetNodeFont { pub node_id, pub font_entry }` mirrors `SetTextStyleField::apply` (exhaustive `NodeKind` match). `RemoveFontEntry { pub entry_id }` scans nodes for references before removal.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): RemoveFontEntry + SetNodeFont commands (fonts-1)"`

---

## Phase 5 — Workfile embedding

### Task 10: `atomic_write_bytes` + `fonts/` storage
**Files:** Modify `crates/server/src/workfile.rs`; Test: `crates/server/tests/` (integration).

- [ ] **Step 1: Failing test** (concurrency, mirror the persistence-concurrency rule): N concurrent `atomic_write_bytes` to the same `fonts/<uuid>.ttf` end with on-disk content equal to exactly one writer's payload (no partial bytes).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `async fn atomic_write_bytes(path, content: &[u8])` mirroring `atomic_write` (workfile.rs:160) but binary + UUID tmp suffix. Add a `fonts/` dir under the package; `write_prepared_save` writes each `Custom` entry's bytes to `fonts/<asset_uuid>.ttf` (extension from sfnt sniff). Extend `Manifest` with `font_assets: Vec<Uuid>` (the embedded asset uuids) so load can validate disk↔manifest. Provide the bytes to `PreparedSave` (add a `font_assets: Vec<(Uuid, Vec<u8>)>` field captured in `prepare_save` from the document's font table + a server-side byte cache, since core holds no bytes — see Task 11 for where bytes live).
- [ ] **Step 4: Run → pass.** Commit. `git commit -m "feat(server): atomic_write_bytes + fonts/ embedding (fonts-1)"`

### Task 11: Font-byte lifecycle (server holds bytes; manifest↔disk validation)
**Files:** Modify `crates/server/src/workfile.rs` + the session/state that owns the document.

- [ ] **Step 1: Failing test:** loading a `.sigil` whose manifest lists a `font_assets` uuid with no `fonts/<uuid>.ttf` on disk produces a warning + the entry degrades (no crash); an orphan `fonts/*.ttf` not in the manifest is ignored with a warning. A round-trip (add font → save → load) yields identical bytes (byte-for-byte).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the byte store: the server-side session keeps a `HashMap<Uuid, Vec<u8>>` of embedded font bytes (populated on `AddFontEntry` from the GraphQL/MCP layer, and on load from `fonts/*.ttf`). `prepare_save` reads it for `PreparedSave.font_assets`. `load_workfile` reads `fonts/*.ttf`, validates against `manifest.font_assets`, and returns the bytes in `LoadedWorkfile`. Mirror the manifest-validation discipline in CLAUDE.md (orphans ignored+warned, missing→warn+degrade).
- [ ] **Step 4: Run → pass.** Commit. `git commit -m "feat(server): font byte store + manifest/disk validation (fonts-1)"`

---

## Phase 6 — Migration v2→v3

### Task 12: `migrate_to_v3`
**Files:** Modify `crates/core/src/migrations.rs`, `crates/core/src/serialize.rs`, `crates/core/src/validate.rs` (bump `CURRENT_SCHEMA_VERSION` to 3); Modify `crates/server/src/workfile.rs` (`BACKUP_DIR_NAME` → `.backup-v2`); Test: in-module + a CI smoke test with a checked-in v2 fixture.

- [ ] **Step 1: Failing test** (mirror existing migration tests): a v2 `SerializedPage` JSON whose text nodes carry `text_style.font_family: "Roboto"` migrates to v3 where each distinct family becomes a `SystemReference` font-table entry and nodes carry `font_entry: <that id>`. Plus a CI smoke test: load a checked-in `tests/fixtures/workfiles/v2-fonts.sigil/`, assert post-load persistence writes v3 + `.backup-v2/` exists with byte-identical originals.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `migrate_to_v3(page: Value) -> Result<Value, MigrationError>`: walk text nodes; for each `text_style.font_family` string, allocate a deterministic `FontEntryId` per distinct family (hash the name → uuid v5 in a fixed namespace so the same family maps consistently across pages), emit a `SystemReference` entry into a page-or-document-level font-table collection, and replace the node field with `font_entry`. A present-but-malformed `font_family` (non-string) → `MigrationError` (no silent coercion); a truly absent field → default to `DEFAULT_FONT_ENTRY_ID` with a comment. Wire into `deserialize_page_with_version` (call when `on_disk_version < 3`). Bump `CURRENT_SCHEMA_VERSION = 3`; set `BACKUP_DIR_NAME = ".backup-v2"`.
- [ ] **Step 4: Run → pass** (incl. the CI smoke test asserting byte-identical backup).
- [ ] **Step 5: Commit.** `git commit -m "feat(core): migrate v2->v3 font_family -> font table (fonts-1)"`

---

## Phase 7 — Transports, TS mirror, sentinels, parity

### Task 13: GraphQL + MCP font ops
**Files:** Modify `crates/server/src/graphql/mutation.rs`, `crates/mcp/src/server.rs` + `crates/mcp/src/tools/`.
- [ ] Implement GraphQL mutations `addFont(bytes, provenance)`, `removeFont(id)`, `setNodeFont(node, fontEntry)` and the MCP tools `add_font`/`remove_font`/`set_node_font`, each constructing the Task 8/9 commands under the write lock following the `apply_operations` sequence (validate→apply→build broadcast from post-mutation state→`seq` under lock→enqueue→`signal_dirty`). The add broadcast MUST include the entry `id`. Broadcast `op_type`s: `"add_font"`, `"remove_font"`, `"set_field"` with `path:"kind.text_style.font_entry"`. Tests: server integration test (add→broadcast carries id; set_node_font changes the node). Commit.

### Task 14: TS mirror + sentinel + parity fixture
**Files:** Modify `frontend/src/types/document.ts`; Create `frontend/src/types/__tests__/document-font-source.test-d.ts`; Create `tests/fixtures/parity/font_entry_encoding.json`; Modify the Rust + TS parity tests.
- [ ] Add `FontSource`, `EmbedDecision`, `FontMetrics`, `FontAxis`, `FontEntry` TS interfaces mirroring the Rust serde shape; change `TextStyle.font_family` → `font_entry: string` (uuid). Add the `.test-d.ts` exhaustiveness sentinel for `FontSource` + `EmbedDecision` (mirror `document-node-kind.test-d.ts`). Create `font_entry_encoding.json` with one entry per `FontSource` variant + a variable-font entry; load+assert in both the Rust test (`include_str!`) and `document-parity.test.ts` (`readFileSync`). Run both suites. Commit.

### Task 15: `apply-remote.ts` font handlers
**Files:** Modify `frontend/src/operations/apply-remote.ts`.
- [ ] Add handlers: `op_type:"add_font"` (insert into the store font table using the payload incl. `id` — warn+skip if `id` missing, per the internal-no-op-diagnostic rule), `"remove_font"`, and extend the `kind.text_style.*` dispatch (apply-remote.ts:538) to accept `font_entry` (validate it's a uuid string; warn+skip otherwise). Test: component test that an `add_font` remote op populates the store font table and a `font_entry` set updates the node. Commit.

---

## Phase 8 — Frontend FontFace loader

### Task 16: `font-face-loader.ts`
**Files:** Create `frontend/src/canvas/font-face-loader.ts`; Test: `frontend/src/canvas/__tests__/font-face-loader.test.ts`.
- [ ] **Step 1: Failing test** (jsdom + a `FontFace`/`document.fonts` mock): given a font table with a `Custom` entry + its bytes, `loadFonts(table, bytesById)` calls `new FontFace(family, bytes)` + `document.fonts.add` + awaits load, and resolves; given a `SystemReference` entry whose family `document.fonts.check()` reports missing, it registers a fallback `@font-face` (a `FontFace` for the family with `ascentOverride`/`descentOverride`/`sizeAdjust` computed from the entry's metrics) and marks the entry `missing`.
- [ ] **Step 2–4:** implement `loadFonts` + `buildMetricFallback(metrics): { ascentOverride, descentOverride, lineGapOverride, sizeAdjust }` (compute from units_per_em + ascent/descent/line_gap; `sizeAdjust` from avg_advance vs a reference). All loads awaited; failures logged + reverted (no fire-and-forget). Re-render is triggered by the caller on the `font-loaded` resolution. Tests green. Commit.

### Task 17: Wire the loader into the render path
**Files:** Modify `frontend/src/shell/Canvas.tsx` (or the doc-load path) + `document-store-solid.tsx`.
- [ ] On document load and on font-table change, call `loadFonts(...)`; on each `FontFace` resolution, invalidate/re-render (the current Canvas-2D renderer's `ctx.font` will now resolve the embedded family). `buildFontString` (text-measure.ts) continues to emit the family name — confirm the family name on the `FontEntry` is what `ctx.font` uses. Test: integration test that an embedded font becomes available in `document.fonts` and the render effect re-runs. Commit.

---

## Phase 9 — Minimal add-font UI + history

### Task 18: Store `addFont` + `setNodeFont` with history
**Files:** Modify `frontend/src/store/document-store-solid.tsx`.
- [ ] Add `addFont(bytes): Promise<entryId>` (optimistic: classify is server-side, so this awaits the GraphQL `addFont` mutation, then inserts the returned entry into the store table — full optimistic+rollback per the mutation rules; on error revert + toast) and `setNodeFont(uuid, entryId)` mirroring `setTextStyle` (interceptor.set for undo coalescing + `pendingServerOps` setField on `kind.text_style.font_entry` + `flushHistory` on commit). Tests for both (optimistic apply, rollback on error, undo entry created). Commit.

### Task 19: "Add font from file" affordance
**Files:** Modify `frontend/src/panels/TypographySection.tsx`.
- [ ] Add a `<button>` (or Kobalte Button wrapper) "Add font…" opening a hidden `<input type=file accept=".ttf,.otf">`; on select, read `arrayBuffer()`, call `store.addFont(bytes)`, then `store.setNodeFont(selectedUuid, entryId)`; write success/failure to a `role="status"` region (the typed error from classification surfaces here — e.g. "Restricted-license font: referenced, not embedded"). The font field shows the table entries (minimal — the full picker is Fonts-2). Test: component test (file → addFont called → status updated). Commit.

---

## Self-Review (plan author)

**Spec coverage:** §4.1 font table + node ref → Tasks 6,7; §4.2 classification → Task 5; §4.3 embedding → Tasks 10,11; §4.4 commands → Tasks 8,9; §4.5 FontFace loader + metric fallback → Tasks 16,17; §4.6 migration → Task 12; §5 WASM (ttf-parser) → Task 1; §6 validation/limits → Tasks 3,4 (+ `_enforced` tests); §7 consistency (atomic, manifest validation, rollback) → Tasks 10,11; §10 transports/sentinels/parity → Tasks 13,14,15; §11 staged-deferral (no server/picker/WOFF2/Skia) → respected (none of those tasks exist here); §12 a11y (`role="status"`) → Task 19; §14 testing → each task is TDD; §15 acceptance criteria → all mapped.

**Placeholder scan:** Tasks 13–19 are concrete (exact files, the pattern to mirror with file:line, the test to write) but condense the repetitive transport/UI wiring rather than printing every line — each names the exact verbatim pattern (apply_operations sequence, setTextStyle, document-node-kind.test-d.ts) the executor copies. If executing via subagents, the controller MUST pass the cited verbatim pattern in each dispatch.

**Type consistency:** `FontEntry`, `FontSource`, `EmbedDecision`, `FontMetrics`, `FontAxis`, `FontEntryId`, `FontTable`, `classify_font`/`ParsedFont`/`FontProvenance`, `AddFontEntry`/`RemoveFontEntry`/`SetNodeFont`, `DEFAULT_FONT_ENTRY_ID`, `atomic_write_bytes`, `loadFonts`/`buildMetricFallback`, `addFont`/`setNodeFont` — used consistently across tasks.

**Open item flagged to the human:** confirm `ttf-parser` 0.21's exact accessor for the OS/2 `fsType` raw value (`permissions_raw()` vs reading the raw table) at Task 5 implementation; and decide whether the font table is document-level or page-level for the migration (Task 12 assumes document-level — the spec says document-level; ensure `SerializedPage` vs `Document` placement matches the existing serialize split).
