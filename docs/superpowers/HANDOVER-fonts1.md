# Handover — Fonts-1 execution (resume here)

**Branch:** `feat/fonts-1` (26 commits ahead of `main` = `ee5eb69`). **Last HEAD at handover:** see `git log -1`.
**Status:** Phases 1–2 (Rust-core foundation) **complete and reviewed**; Phases 3–9 remain.
**How it's being built:** `superpowers:subagent-driven-development` — this session as Opus controller dispatching one **Sonnet `Backend Engineer`** implementer per task (TDD), with an independent review per logic task and a fix loop. Continue the same way.

## What to read first
1. **Plan** (the task list, verbatim steps): `docs/superpowers/plans/2026-06-11-fonts-1-font-model-embedding.md`
2. **Spec**: `docs/superpowers/specs/2026-06-11-fonts-1-font-model-embedding.md` · **Epic map**: `…/font-epic-overview.md`
3. **Roadmap** (Fonts-1 row = `impl…`): `docs/superpowers/ROADMAP.md`
4. **Memory** (auto-loaded): `project_fonts1_execution.md` — same gotchas as below.

## Done — Tasks 1–5 (1078 core tests green, WASM-clean, clippy/fmt clean)
- **1** `ttf-parser` dep (`default-features=false` + `no-std-float` + `variable-fonts`).
- **2** `crates/core/src/font.rs`: `FontSource`, `EmbedDecision`, `FontAxis`, validated `FontMetrics`.
- **3** same file: validated `FontEntry` + `FontTable` (capacity+uniqueness enforced incl. on deserialize); shared `validate_font_family_name` extracted into `validate.rs`.
- **4** `validate.rs`: `MAX_FONTS_PER_DOCUMENT=256`, `MAX_EMBEDDED_FONT_BYTES=32 MiB`, `MAX_POSTSCRIPT_NAME_LEN=256` + `_enforced` tests + `check_embedded_font_size`.
- **5** `crates/core/src/font_parse.rs`: `classify_font(bytes, FontProvenance) -> ParsedFont` (fsType→embed/reference, metrics, variable axes). Reviewed clean (no defects).

## Next — Task 6 (Phase 3): add the font table to `Document`
Seed a `Bundled` default entry at a fixed `DEFAULT_FONT_ENTRY_ID` (family "Inter") so migration/new-node code can reference it. Then Tasks 7–19 (node ref, commands, server embedding, migration v2→v3, transports/parity, frontend FontFace loader, store + UI).

## Resume gotchas (do not relearn the hard way)
- **Docker is down** → run **native** `cargo` / `pnpm`, NOT `./dev.sh`. Native toolchain present: `cargo 1.94.1`, `pnpm 10`, `wasm32-unknown-unknown` target, and `fonttools 4.63` (for regenerating font fixtures).
- **ttf-parser 0.25.1 API**: the plan's `permissions_raw()` does **not** exist. Use `face.tables().os2.and_then(|t| t.permissions())` (version-aware) + read the raw `fsType` u16 from `face.raw_face().table(Tag::from_bytes(b"OS/2"))` offset 8 for the bitmap-only bit `0x0200`. `Name::to_string()` is `std`-gated → a UTF-16BE decoder lives in `font_parse.rs`.
- **Fixtures**: `tests/fixtures/fonts/{installable,editable,restricted,variable}.ttf` — synthetic, license-free, **byte-reproducible** via `_generate.py` (`SOURCE_DATE_EPOCH=0`). Task 8's `include_bytes!` from `crates/core/src/commands/font_commands.rs` needs **`../../../../`** (4 levels up).
- **Validated-type discipline**: private fields, `new()` validates, **manual `Deserialize` routed through `new()`** with duplicate-key rejection — no `#[derive(Deserialize)]` on validated types. Every `MAX_*` ships with a real (non-tautology) `test_*_enforced`.
- **Carry into Task 7** (removes `TextStyle.font_family` → `font_entry`): also close the deferred review item — `crates/core/src/serialize.rs:~383` JSON `font_family` guard checks only length (not CSS chars); and delete the now-thin `validate_font_family` wrapper in `text_style_commands.rs` as the field disappears.
- **Reviews**: a stale rust-analyzer "unresolved import" diagnostic appeared twice after subagent edits — `cargo` is authoritative; verify with `cargo test`/`cargo check`, don't trust the IDE lag.

## Untracked / out-of-scope (leave as-is, not part of Fonts-1)
- `docs/superpowers/reviews/2026-04-14-governance-inline-logic-extraction.md` — pre-existing untracked governance doc.
- `spikes/` (`canvaskit/`, `hb-gpu/`) — throwaway validation harnesses; `spikes/hb-gpu/harfbuzz-world.cc` is the **RC-3** build reference. Intentionally untracked.

## Unrelated open thread (not blocking)
Router/budget experiment for next month (vacation): metered Opus API capped at ~€200 (Anthropic Console spend limit, or LiteLLM/agentgateway routing main→Anthropic + subagents→local qwen). Replaces — not caps — the subscription for that month. Scaffold on request near end of month.
