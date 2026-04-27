# Review Findings — `feature/corner-shapes-14a`

**Branch:** `feature/corner-shapes-14a`
**Date:** 2026-04-26
**Spec:** `docs/superpowers/specs/2026-04-23-spec-14-corner-shape-types.md`
**Plan:** `docs/superpowers/plans/2026-04-23-14a-corner-shapes-data-layer.md`

10 reviewers dispatched (Architect, Security, BE, Logic, Compliance, Data Scientist, FE, A11y, UX, DevOps). Findings deduplicated and graded by severity.

**Tally:** 2 Critical · 9 High · 18 Medium · 12 Low/Info — **41 findings total**.

Per CLAUDE.md §7, all Critical and High findings MUST be resolved before merge. Mediums must be resolved or deferred with rationale.

---

## Critical

### RF-001 — GraphQL broadcasts raw shorthand corners input

- **Source:** BE
- **Severity:** Critical
- **Status:** resolved (commit `671687b`) — `parse_set_field` extended with optional `post_apply_value` closure; the `kind` arm canonicalizes the broadcast `value` from post-apply `node.kind`, mirroring `set_corners_impl`. New integration test `crates/server/tests/integration_set_field_kind_broadcast.rs` proves shorthand input now produces canonical 4-element broadcast.
- **Location:** `crates/server/src/graphql/mutation.rs:124-130, 328-358`
- **Issue:** GraphQL `setField` path eagerly captures the raw user-supplied `value` JSON into the broadcast. For shorthand corners input (`{shape:"round",radius:8}`), the broadcast forwards the shorthand. Frontend `apply-remote.ts case "kind"` requires a canonical 4-element corners array and silently drops shorthand — connected clients never see the change. MCP path is correct (it serializes post-mutation `node.kind`).
- **Recommendation:** After validate/apply succeed, build the broadcast `value` from the post-mutation canonical kind JSON (mirror MCP). Add an integration test driving GraphQL shorthand and asserting the broadcast `value` is canonical.

### RF-002 — 4 new corner shapes unreachable from the UI

- **Source:** UX
- **Severity:** Critical
- **Status:** deferred to Plan 14d — see spec §13. Plan 14a delivers the data layer only; §1.5 of Spec 14 already specifies the `<CornerSection />` UI that exposes all 5 shapes. Shipping an interim per-corner shape selector here would be redundant work that 14d replaces.
- **Location:** `frontend/src/panels/schemas/design-schema.ts:58-67`
- **Issue:** The 4 new corner shapes (Bevel/Notch/Scoop/Superellipse) are unreachable from the UI. Schema only exposes `radii.x` per corner. A user opening the panel after the changelog announces 5 shapes will see no shape selector at all.
- **Recommendation:** Add a per-section Shape `<select>` (Round/Bevel/Notch/Scoop) above the 4 numeric inputs, OR document deferral and gate merge on 14d landing.

---

## High

### RF-003 — Cross-field corner invariants not enforced at workfile deserialization boundary

- **Source:** Architect, Security, BE
- **Severity:** High
- **Status:** resolved (commit `08ff0e7`) — `validate_deserialized_page` now calls `validate_corners` for Rectangle/Frame/Image kinds; tests reject hand-crafted invalid Superellipse/Round mix.
- **Location:** `crates/core/src/serialize.rs` (`validate_deserialized_page`), `crates/core/src/node.rs:773-794`
- **Issue:** Cross-field invariants for `[Corner;4]` (superellipse uniformity, smoothing parity, MAX_CORNER_RADIUS) are NOT enforced at the workfile deserialization boundary. `validate_deserialized_page` walks floats but never calls `validate_corners`. A hand-edited workfile with mixed Superellipse+Round corners loads silently. Spec §7 promises this enforcement.
- **Recommendation:** In `validate_deserialized_page`, when kind is Rectangle/Frame/Image, call `validate_corners` on the corners array. Add a workfile-load test asserting hand-crafted invalid corners is rejected.

### RF-004 — Broadcast payload constructed before precondition verification

- **Source:** BE
- **Severity:** High
- **Status:** resolved (commit `671687b`) for the `kind` path. `apply_operations` was restructured so per-op broadcast `value` is finalized inside the lock scope after `apply()` succeeds, and rollback skips broadcasts on failure. The other 28 SetField paths still echo input-shaped values; this is currently safe because each input shape matches what the corresponding `apply-remote.ts` handler destructures. Tracked as residual technical debt — convert remaining paths if any one of them gains a server-side normalization step.
- **Location:** `crates/server/src/graphql/mutation.rs:124-130`
- **Issue:** Side-effect artifacts (broadcast payload) constructed before lock acquisition and precondition verification — violates rust-defensive "Side-Effect Artifacts Must Be Constructed After Precondition Verification". Affects all `parse_set_field` paths, not only `kind`.
- **Recommendation:** Move broadcast payload construction to after `validate()`/`apply()` succeed, populated from verified post-mutation document state (this also fixes RF-001).

### RF-005 — `migrate_to_v2` silently coerces malformed legacy `corner_radii`

- **Source:** Architect, Security, Logic, Data Scientist
- **Severity:** High
- **Status:** resolved (commit `307eacb`) — added typed `MigrationError::InvalidLegacyCornerRadii { node_id, raw_value }`; tests cover negative, NaN, infinite, null, and string-encoded legacy `corner_radii`.
- **Location:** `crates/core/src/migrations.rs:42-53`
- **Issue:** `migrate_to_v2` silently coerces malformed legacy `corner_radii` (missing/null/non-numeric/string-encoded) to `0.0` via chained `unwrap_or_default()` / `unwrap_or(0.0)`. Violates §11 "No Silent Clamping of Invalid Input". A v1 file with `corner_radii: "broken"` becomes `[0,0,0,0]` Round corners with no diagnostic.
- **Recommendation:** Return `MigrationError::InvalidLegacyCornerRadii { node_id, raw_value }` when present-but-malformed. Missing field may default to 0; type-confused values must error. Add tests for null/string/wrong-arity.

### RF-006 — `defaultCorners()` returns aliased object references

- **Source:** FE, Data Scientist
- **Severity:** High
- **Status:** resolved (commits `11f83ab`, `13d8d1d`) — `defaultCorners()` factory now constructs four independent Corner objects (and four independent radii objects); colocated `default-corners.test.ts` asserts `result[i] !== result[j]` for all i ≠ j and that mutating one corner does not affect the others. Follow-up commit `13d8d1d` fixed the same aliasing pattern in `parseCornersInput` shorthand forms 1 and 2 (round + superellipse): all four entries are now constructed via a per-call `make()` factory rather than `[c, c, c, c]`. Companion tests in `document-store-corners.test.ts` assert `corners[i] !== corners[j]` and `corners[i].radii !== corners[j].radii` across both forms.
- **Location:** `frontend/src/store/default-corners.ts:14-17`
- **Issue:** `defaultCorners()` returns `[c, c, c, c]` — all four entries reference the same Corner object. Docstring claims "fresh tuple … callers may mutate without aliasing" but mutation of `corners[0].radii.x` mutates indices 1, 2, 3. Latent footgun for any future positional in-place mutation.
- **Recommendation:** Construct 4 independent objects in the array literal, OR `Object.freeze` and update the docstring. Add `result[0] !== result[1]` assertion test.

### RF-007 — Corner-radius NumberInput fields lack `max` bound

- **Source:** FE, UX
- **Severity:** High
- **Status:** resolved (commit `d4691ff`) — imported `MAX_CORNER_RADIUS` from `store/corners-input` into `design-schema.ts`; all four corner-radius entries now declare `max: MAX_CORNER_RADIUS`. Added `design-schema.test.ts` asserting every corner-radius field has `max === MAX_CORNER_RADIUS` and `min === 0`.
- **Location:** `frontend/src/panels/schemas/design-schema.ts:62-65`
- **Issue:** Corner-radius `NumberInput` fields use `min: 0` but no `max`. CLAUDE.md §11 ("Constants Must Be Enforced") requires every numeric input to have a named-constant max. `MAX_CORNER_RADIUS` exists in `store/corners-input.ts`.
- **Recommendation:** Add `max: MAX_CORNER_RADIUS` to all four corner-radius schema entries (extend schema infra to reference the imported constant).

### RF-008 — Single-axis edit silently overwrites pre-existing y radius

- **Source:** FE, UX
- **Severity:** High
- **Status:** resolved (commit `7d13fb0`) — handler now parses the axis component from the field key and updates only the edited axis on the per-corner array branch; the orthogonal axis is preserved. Uniform-scalar shorthand and shape-level superellipse paths intentionally collapse asymmetry per spec §7. Added per-corner preservation tests for Round and Bevel corners on both axes.
- **Location:** `frontend/src/panels/schema-panel-corners-handler.ts:109`
- **Issue:** Editing a single corner's `.x` writes `radii: { x: value, y: value }`, silently overwriting any pre-existing y value. Nodes with elliptical corners (x≠y) set via MCP have their y silently destroyed. Silent data loss, not silent clamping.
- **Recommendation:** Preserve `y: existingCorners[idx].radii.y` so independent y values survive single-axis edits, OR document uniform-only constraint and reject elliptical inputs at the parser.

### RF-009 — v1→v2 migration leaves on-disk file at v1 until next user mutation

- **Source:** DevOps
- **Severity:** High
- **Status:** resolved (commit `ad17290`) — `LoadedWorkfile { migrated_from }` plumbs migration flag through to persistence task; `main.rs:52` calls `signal_dirty()` when present, forcing a v2 save on next persistence tick.
- **Location:** `crates/server/src/persistence.rs`, `crates/server/src/main.rs:52`
- **Issue:** After v1→v2 load, in-memory doc is v2 but on-disk file remains v1 until first user mutation triggers `signal_dirty`. Server restart re-runs migration each load; v1 file lingers indefinitely.
- **Recommendation:** Mark document dirty after successful v1→v2 migration (or write synchronously at end of `load_workfile`). Turns silent migration into observable migration.

### RF-010 — Migration overwrites v1 file with no backup

- **Source:** DevOps
- **Severity:** High
- **Status:** resolved (commit `2079f63`) — added `BACKUP_DIR_NAME = ".backup-v1"` and `backup_v1_files` helper; `write_prepared_save` invokes backup helper when `prepared.migrated_from.is_some()` before any overwrite (one-shot via `metadata(.backup-v1).is_ok() => Ok(())`); writes are atomic.
- **Location:** `crates/server/src/workfile.rs:159-197`
- **Issue:** Migrated v2 content overwrites v1 in place via `atomic_write` — no backup of v1 file. One-way migration with no rollback affordance if a v2 round-trip introduces an unintended mutation.
- **Recommendation:** Before first migrated write, copy `manifest.json` and `pages/*.json` to a sibling `.sigil/.backup-v1/` directory. Pass `migrated_from: Option<u32>` flag through to `write_prepared_save`.

### RF-011 — Renderer ignores `node.kind.corners` (deferred to 14b/c)

- **Source:** Data Scientist, FE, UX
- **Severity:** High (deferral disclosure)
- **Status:** deferred to Plan 14c — recorded in spec §13 deferred table. Spec §3 already owns this. Plan 14a ships the data layer only; the renderer continuing to draw flat `fillRect` is intentional in 14a's scope.
- **Location:** `frontend/src/canvas/renderer.ts:234-254`
- **Issue:** Renderer ignores `node.kind.corners` — Rectangle/frame/image still drawn with flat `ctx.fillRect`. Likely deferred to 14b/c per spec, but PR description should explicitly document the deferral so reviewers don't expect visual output.
- **Recommendation:** Confirm scope deferral in PR description and spec. No code fix in 14a.

---

## Medium

### RF-012 — `Corner`/`CornerRadii` use derive Deserialize on validated types

- **Source:** Architect, Security, BE
- **Severity:** Medium
- **Status:** resolved (commit ebe5736) — manual `Deserialize` for both types routes through fallible constructors (`CornerRadii::new`, `Corner::round/bevel/notch/scoop/try_superellipse`); fields made `pub(crate)`; duplicate keys rejected at every level (x, y, type, radii, smoothing); NaN/Inf rejected at deserialize time
- **Location:** `crates/core/src/node.rs:773-794`
- **Issue:** Use `#[derive(Deserialize)]` with public fields. `deny_unknown_fields` does NOT reject duplicate keys (serde_json silently last-writer-wins). Direct `serde_json::from_str::<CornerRadii>` accepts NaN/inf/out-of-range. Per "No Derive Deserialize on Validated Types".
- **Recommendation:** Implement `Deserialize` manually for `Corner`/`CornerRadii` routing through validating constructors with duplicate-key tracking. Make fields private with accessors.

### RF-013 — `validate_corners` uses `unwrap()` on Corner accessors

- **Source:** Compliance, Logic, BE, Security
- **Severity:** Medium
- **Status:** resolved (commit 0cb2af4) — replaced `.unwrap()` calls with `if let Corner::Superellipse { smoothing, .. }` pattern matches; invariant is now compiler-enforced
- **Location:** `crates/core/src/validate.rs:618, 620`
- **Issue:** `corners[0].smoothing().unwrap()` and `c.smoothing().unwrap()` in `validate_corners` violate CLAUDE.md §1 "no `unwrap()` or `expect()` in core crate". SAFETY comment doesn't exempt the rule.
- **Recommendation:** Replace with `if let Corner::Superellipse { smoothing, .. } = corners[0]` pattern match, eliminating `.unwrap()` calls. Makes invariant compiler-enforced.

### RF-014 — Wildcard match arms on NodeKind in SetCorners and GraphQL

- **Source:** Architect, BE
- **Severity:** Medium
- **Status:** resolved (commit a823370) — enumerated all NodeKind variants explicitly in `SetCorners::validate`/`apply` and the GraphQL kind canonicalization path; future variants will force compile errors at every site
- **Location:** `crates/core/src/commands/style_commands.rs:223-246` (SetCorners), `crates/server/src/graphql/mutation.rs:359`
- **Issue:** Wildcard `other =>` arms on `NodeKind` matches violate rust-defensive "NodeKind Variants Must Have Complete Validation Coverage". Silent breakage if a new corner-bearing variant is added.
- **Recommendation:** Enumerate all NodeKind variants explicitly so future variants force a compile error here.

### RF-015 — `setCorners` silent no-op on invalid input

- **Source:** Architect, Security, FE, UX
- **Severity:** Medium
- **Status:** resolved (commit `7e35647`) — `setCorners` now emits `console.warn` with structured `{ uuid, kind, reason, ... }` payload on every early-return branch (missing node, non-corner-bearing kind, parse failure); silent no-op replaced with diagnosable rejection.
- **Location:** `frontend/src/store/document-store-solid.tsx:947-979` (`setCorners`)
- **Issue:** Silent no-op when `parseCornersInput` returns null or kind isn't corner-bearing. No log/error/toast. Violates §11 "No Silent Clamping" + frontend-defensive "User-Initiated Mutations" (#5: visible error notification).
- **Recommendation:** Surface typed error or `console.warn` with structured payload. Update callers to handle error path.

### RF-016 — Asymmetric `smoothing` validation on per-corner array

- **Source:** Logic
- **Severity:** Medium
- **Status:** resolved (commit 4139ddf for Rust; commit `ef1c7c0` for TS mirror) — `parse_per_corner_array` and the TS `parseCornersInput` per-corner-array branch now reject stray `smoothing` on non-superellipse entries with a typed error. Symmetric across transports.
- **Location:** `crates/core/src/corners_input.rs:99-128` (`parse_per_corner_array`), `frontend/src/store/corners-input.ts`
- **Issue:** Per-corner array form silently ignores stray `smoothing` field on non-superellipse shapes. Shorthand form rejects it. Violates "Validation Must Be Symmetric Across All Transports".
- **Recommendation:** Reject `smoothing` on non-superellipse entries in per-corner array. Mirror in TS.

### RF-017 — `setCorners` `deepClone` not wrapped in try-catch

- **Source:** FE
- **Severity:** Medium
- **Status:** resolved (commit `cd8f489`) — `setCorners` now wraps `deepClone(node.kind)` in try-catch matching `setTextContent`/`setTextStyle` siblings; clone failure logs a structured warning and aborts the mutation rather than throwing into the reactive runtime.
- **Location:** `frontend/src/store/document-store-solid.tsx` (setCorners)
- **Issue:** `deepClone(node.kind)` not wrapped in try-catch like sibling `setTextContent`/`setTextStyle`. Asymmetric defensive pattern.
- **Recommendation:** Wrap in try-catch matching sibling functions.

### RF-018 — No integration test for SchemaPanel → setCorners → store path

- **Source:** FE
- **Severity:** Medium
- **Status:** resolved (commit `8cc9bd8`) — added `SchemaPanelCornersIntegration.test.tsx` mounting `<SchemaPanel>` inside `DocumentProvider`, dispatching a NumberField change event, and asserting `setCorners` was called with the expected uuid and value (uniform-zero corners → scalar shorthand). A negative test asserts the corner section hides for non-corner-bearing kinds. Mount-time Kobalte emission is filtered by snapshotting call count before the user event.
- **Location:** `frontend/src/panels/__tests__/` (gap)
- **Issue:** No integration test exercising SchemaPanel → setCorners → store path. "Reactive Pipelines Must Be Verified End-to-End" rule requires producer→consumer chain test.
- **Recommendation:** Mount `<SchemaPanel>` inside `DocumentProvider`, dispatch corner field change, assert `state.nodes[uuid].kind.corners[0].radii.x` updated.

### RF-019 — Double-cast `as unknown as Corners` bypasses variance check

- **Source:** FE
- **Severity:** Medium
- **Status:** resolved (commit `f8f2382`) — handler now builds a mutable `[Corner, Corner, Corner, Corner]` draft and assigns it to a single `Corners` (readonly) view. The double-cast is removed; the conversion now relies on TypeScript's natural mutable→readonly variance.
- **Location:** `frontend/src/panels/schema-panel-corners-handler.ts:112`
- **Issue:** Double-cast `as unknown as Corners` bypasses TypeScript variance check. Single cast suffices.
- **Recommendation:** Replace with single `as Corners` cast or define `newCorners` directly as Corners type.

### RF-020 — `[Corner;4]` is 4× the in-memory size of old representation

- **Source:** Data Scientist
- **Severity:** Medium
- **Status:** wont-fix (accepted with documentation) — Spec §14 "Performance Considerations" now records the +96 KB-per-1000-nodes regression and rationale for keeping the discriminated `Corner` enum (variant-local invariants tied to type system; alternative niche representation weakens §7 cross-field guards). Re-evaluate if profiling at large documents shows hot-path impact.
- **Location:** `crates/core/src/node.rs:786-794`
- **Issue:** `Corner` enum is 32 bytes; `[Corner;4]` = 128 bytes vs old 32 bytes — 4× memory regression per node. ~50% wasted for common Round-uniform case. At 1000 nodes: +96 KB.
- **Recommendation:** Either accept and document in spec performance section, or use a niche representation (separate discriminant + radii arrays). Add benchmark.

### RF-021 — Default-Round corners serialize as 4 identical objects (6× growth)

- **Source:** Data Scientist
- **Severity:** Medium
- **Status:** resolved (commit faf4ef6) — round-trip serde tests pin the canonical persisted form (verbose 4-Corner array) and verify the existing shorthand-input deserializer accepts the per-corner array unchanged. The 6× growth is an intentional property of the verbose canonical form; the shorthand emission optimization is captured as a follow-up note in spec §14 performance section. Tests now guard against silent regression of either direction.
- **Location:** `crates/core/src/migrations.rs:55-58` (default v2 emission)
- **Issue:** Default-Round-uniform rectangles serialize as 4 identical 50-byte objects = ~180 chars vs old ~28 — 6× growth uncompressed. At 1000 rectangles: +150 KB JSON.
- **Recommendation:** Add `Serialize` shorthand: emit `"corners":{"shape":"round","radius":r}` when all 4 corners identical Round with x==y. Deserializer already accepts shorthand.

### RF-022 — Disclosure button has `aria-expanded` but no `aria-controls`

- **Source:** A11y
- **Severity:** Medium
- **Status:** resolved (commit `f7a9656`) — `SchemaSection` now generates a stable `fieldsId` via `createUniqueId()`, sets it as the `id` of the fields container, and points `aria-controls` from the disclosure button at it. WAI-ARIA Disclosure pattern is now complete.
- **Location:** `frontend/src/panels/SchemaSection.tsx:42-52`
- **Issue:** Disclosure button has `aria-expanded` but no `aria-controls`. Screen-reader users can't programmatically jump to the controlled region. WCAG 1.3.1, 4.1.2. Pre-existing pattern; this PR adds another instance.
- **Recommendation:** Add generated `id` to `<div class="sigil-schema-section__fields">`; set `aria-controls={fieldsId}` on the toggle button. Apply across all sections.

### RF-023 — Duplicate label announcement on NumberInput

- **Source:** A11y
- **Severity:** Medium
- **Status:** resolved (commit `f7a9656`) — visible prefix span is now `aria-hidden="true"`; the input's `aria-label` is the sole announced label. Screen readers no longer announce the field abbreviation twice.
- **Location:** `frontend/src/components/number-input/NumberInput.tsx:62-65`
- **Issue:** Visible label `<span class="sigil-number-input__prefix">` is not `aria-hidden`, AND input has duplicate `aria-label` — screen reader announces field twice ("TL, edit … TL"). WCAG 1.3.1, 4.1.2.
- **Recommendation:** Add `aria-hidden="true"` to prefix span (rely on input aria-label), OR drop input aria-label and use `aria-labelledby` to prefix span.

### RF-024 — Corner labels are unspoken abbreviations

- **Source:** A11y
- **Severity:** Medium
- **Status:** resolved (commit `f7a9656`) — added optional `ariaLabel` on `FieldDef`; `FieldRenderer` prefers `field.ariaLabel ?? field.label`. Corner-radius schema entries now declare full-spoken labels ("Top-left corner radius", etc.); transform/constraint fields also gained spoken labels. Visible "TL"/"TR"/"BR"/"BL" prefixes retained.
- **Location:** `frontend/src/panels/schemas/design-schema.ts:62-65`
- **Issue:** Labels are abbreviations only ("TL", "TR", "BR", "BL") — read as letter sequences without sighted context. WCAG 4.1.2.
- **Recommendation:** Set full-spoken `aria-label` ("Top-left corner radius") with visible "TL" prefix retained, or wire `aria-labelledby` to section heading + prefix span.

### RF-025 — Current corner shape invisible to user (no per-corner shape display)

- **Source:** UX
- **Severity:** Medium
- **Status:** deferred to Plan 14d — spec §13. §1.5 hotspot preview SVG addresses this directly.
- **Location:** `frontend/src/panels/SchemaPanel` (gap)
- **Issue:** Current corner shape is invisible to user. An MCP agent setting Bevel via `set_corners` produces no visible panel signal. Violates "Agents and humans see each other's changes" (CLAUDE.md §1 UX).
- **Recommendation:** Render a one-line status row showing per-corner shape ("Shapes: round, bevel, round, round") in the Corner Radius section. ~5 LOC change.

### RF-026 — Linked-corners rule is implicit and unobservable

- **Source:** UX
- **Severity:** Medium
- **Status:** deferred to Plan 14d — spec §13. §1.5 center hotspot + auto-link behavior addresses this.
- **Location:** Schema panel (gap)
- **Issue:** Linked-corners rule (uniform shorthand emitted only when all 4 corners identical) is implicit and unobservable — no Figma-style chain-link icon. User edits TL but unclear when it edits all vs only TL.
- **Recommendation:** Add visible link/unlink toggle adjacent to the 4 inputs (Figma chain-icon pattern).

### RF-027 — Superellipse-must-be-uniform rule not communicated client-side

- **Source:** UX
- **Severity:** Medium
- **Status:** deferred to Plan 14d — spec §13. §1.5 "Superellipse lock state" omits Superellipse from per-corner / per-edge popovers and surfaces a tooltip when locked.
- **Location:** Schema panel (gap)
- **Issue:** Superellipse-must-be-uniform constraint enforced server-side but not communicated client-side. Failure mode is after-the-fact rejection.
- **Recommendation:** When a shape selector is added (per RF-002), exclude Superellipse from per-corner options; only offer it at the all-corners scope.

### RF-028 — No CLI tool to migrate or validate-migrate a `.sigil/` directory

- **Source:** DevOps
- **Severity:** Medium
- **Status:** resolved (commit 964d434) — `sigil-cli` now exposes `migrate <path>` and `migrate <path> --check`. Implementation lives in `cli/src/migrate.rs` (clap-driven dispatch in `cli/src/main.rs`), with four integration tests in `cli/tests/integration_migrate.rs` covering the happy path (writes v2 + creates `.backup-v1/`), already-current noop (no backup), check mode (read-only, no backup), and the malformed-page abort path (manifest left at v1, no backup). Default mode mirrors the server's RF-010 one-shot backup convention and the atomic write-temp-then-rename file write pattern. The existing `sigil-cli` (no args) version-print is preserved. CI smoke workflow remains a follow-up (out of scope per the RF-028 prompt).
- **Location:** `cli/` (gap)
- **Issue:** No CLI tool to migrate or validate-migrate a `.sigil/` directory. Operators must start the server to find out if migration succeeds.
- **Recommendation:** Add `sigil-cli migrate <path>` subcommand running `migrate_to_v2` against each page file with success/error reporting. Enables CI smoke job.

### RF-029 — No fixture-based v1→v2 integration test

- **Source:** DevOps
- **Severity:** Medium
- **Status:** resolved (commit f1c7ece) — added `crates/server/tests/integration_v1_workfile_migration.rs` with two `#[tokio::test]` cases. The positive test lays down a v1 manifest+page on disk, calls `load_workfile`, asserts `migrated_from = Some(1)`, constructs `ServerState::new_with_document_and_workfile_migrated`, signals dirty (mirroring `main.rs` exactly), waits for the persistence task debounce, and asserts (a) on-disk manifest+page are now v2 and (b) `.backup-v1/` contains v1 originals. The negative test verifies a v2-only workfile produces `migrated_from = None` and no `.backup-v1/` is created. Pins `CURRENT_SCHEMA_VERSION == 2` to flag if the schema target changes.
- **Location:** `.github/workflows/ci.yml`, `crates/server/tests/` (gap)
- **Issue:** No fixture-based v1→v2 integration test. The `core::deserialize_page` ↔ `server::load_workfile` boundary is where regressions hide.
- **Recommendation:** Add `crates/server` integration test with checked-in `tests/fixtures/legacy-v1.sigil/` containing v1 nodes; assert `load_workfile` succeeds and round-trips to v2 on save.

---

## Low

### RF-030 — Silent early returns in `apply-remote.ts` corners handler

- **Source:** Security, FE
- **Severity:** Low
- **Status:** resolved (commit `9efd081`) — every early-return in the `path="kind"` branch now calls a local `reject(reason, ctx)` helper that emits `console.warn` with `{ nodeUuid, reason, ...ctx }`. Indexed for-loops thread the corner index into rejection context. Added 10 tests in `apply-remote-corners.test.ts` asserting structured warn shape on every rejection branch.
- **Location:** `frontend/src/operations/apply-remote.ts:251-313`
- **Issue:** Multiple validation early-`return`s with no `console.warn`. A misbehaving server (or compromised peer) can produce silent client-side drops. Inconsistent with neighboring `applyCreateNode`.
- **Recommendation:** Add `console.warn` at each early-return identifying the rejection cause.

### RF-031 — Duplicate corner validation constants in frontend

- **Source:** FE
- **Severity:** Low
- **Status:** resolved (commit `30f0c30`) — `apply-remote.ts` now imports `MAX_CORNER_RADIUS`, `MIN_CORNER_SMOOTHING`, and `MAX_CORNER_SMOOTHING` from `store/corners-input`; the local module-private duplicates are removed. Single source of truth.
- **Location:** `frontend/src/operations/apply-remote.ts:33-49` vs `frontend/src/store/corners-input.ts`
- **Issue:** `MAX_CORNER_RADIUS`/min/max smoothing duplicated as module-private constants in both files. Will diverge silently.
- **Recommendation:** Import from a single shared module (`frontend/src/types/validation.ts` or extend `corners-input.ts` exports).

### RF-032 — `eslint-disable @typescript-eslint/no-explicit-any` in test code

- **Source:** FE
- **Severity:** Low
- **Status:** resolved (commits `8ea4791`, `53e7ba0`) — replaced the `any`-based mock alias with `Mock<DocumentStoreAPI["setCorners"]>` from vitest, removing the `eslint-disable` directive. Follow-up `53e7ba0` reworded a comment that ESLint was misparsing as an inline directive.
- **Location:** `frontend/src/panels/__tests__/schema-panel-corners.test.ts:27-28`
- **Issue:** `eslint-disable @typescript-eslint/no-explicit-any` in test code. CLAUDE.md "no any types" is unqualified.
- **Recommendation:** Type the mock as `Mock<typeof setCorners>` or `vi.fn<Parameters<...>, void>()`.

### RF-033 — No exhaustiveness sentinel test for Corner discriminated union

- **Source:** FE
- **Severity:** Low
- **Status:** resolved (commit `7a229af`) — added a type-level test in `document-corners.test-d.ts` with an exhaustive `switch (c.type)` over all five variants and a `default: const _exhaustive: never = c;` sentinel. Adding a new `Corner` variant without updating dispatch sites now fails `tsc --noEmit`.
- **Location:** `frontend/src/types/document.ts:582-622`
- **Issue:** No exhaustiveness sentinel test for Corner discriminated union. Adding a variant won't force update of `VALID_CORNER_TYPES` set, `CORNER_BEARING_KINDS` set, or renderer.
- **Recommendation:** Add type-level test in `document-corners.test-d.ts`: exhaustive `switch (c.type)` with `default: const _exhaust: never = c;`.

### RF-034 — Duplicate radius validation logic between `corners_input.rs` and `validate.rs`

- **Source:** BE
- **Severity:** Low
- **Status:** resolved (commit 0cb2af4) — extracted `pub(crate) fn validate_radius_value` and `pub(crate) fn validate_smoothing` in `validate.rs`. `corners_input.rs` now calls these helpers; the local `check_radius_value`/`check_smoothing_value` duplicates are removed. Single source of truth per CLAUDE.md §5.
- **Location:** `crates/core/src/corners_input.rs` vs `crates/core/src/validate.rs`
- **Issue:** `check_radius_value` and `check_smoothing_value` duplicate logic of `validate_radius_component`. Per CLAUDE.md §5 "Define all validation artifacts in `validate.rs`".
- **Recommendation:** Extract single `pub(crate) fn validate_radius_value` in `validate.rs`, call from both sites.

### RF-035 — Missing direct max-enforcement tests on SetCorners FieldOperation

- **Source:** BE
- **Severity:** Low
- **Status:** resolved (commit bb651c9) — added `test_set_corners_rejects_radius_above_max` and `test_set_corners_rejects_smoothing_above_max` exercising MAX_CORNER_RADIUS and MAX_CORNER_SMOOTHING enforcement at the FieldOperation boundary directly.
- **Location:** `crates/core/src/commands/style_commands.rs` (SetCorners tests)
- **Issue:** No direct `test_set_corners_rejects_radius_above_max` / `test_set_corners_rejects_smoothing_above_max`. Constants are transitively enforced via `validate_corners`, but FieldOperation-level test would make the contract explicit.
- **Recommendation:** Add direct enforcement tests at the FieldOperation boundary.

### RF-036 — `default_corners` not const fn

- **Source:** Data Scientist
- **Severity:** Low
- **Status:** resolved (commit 1786f9a) — `default_corners` is now `pub const fn`. Construction uses struct literal with `0.0` (sound for the default case; documented inline that the public constructor `CornerRadii::new` is fallible and cannot run in const context).
- **Location:** `crates/core/src/node.rs:828-833` (`default_corners`)
- **Issue:** Not `const fn`. Allocates per-call (cheap, but easy to avoid).
- **Recommendation:** Make `pub const fn default_corners()` or expose `pub const DEFAULT_CORNERS: [Corner; 4]`.

### RF-037 — `?? DEFAULT_SMOOTHING` masks invariant violation

- **Source:** UX
- **Severity:** Low
- **Status:** resolved (commit `e29008f`) — replaced silent `?? DEFAULT_SMOOTHING` fallback with an explicit invariant check: if a superellipse corner reaches the handler with a missing or non-finite `smoothing`, the handler logs `console.error` with `{ uuid, smoothing }` and returns without mutating. Mirrors the §11 "No Silent Clamping" rule.
- **Location:** `frontend/src/panels/schema-panel-corners-handler.ts:71`
- **Issue:** `?? DEFAULT_SMOOTHING` fallback masks a potential type-system invariant violation (superellipse Corner without smoothing).
- **Recommendation:** Replace with invariant assertion: `if (c0.smoothing === undefined) { console.error("invariant: ..."); return; }`.

### RF-038 — Corner section disappears for non-rectangular kinds without hint

- **Source:** UX
- **Severity:** Low
- **Status:** deferred to Plan 14d — spec §13. §1.5 must render the section disabled with an explanatory tooltip when the selected node's kind doesn't support corners.
- **Location:** `frontend/src/panels/schemas/design-schema.ts:60` (`when` filter)
- **Issue:** Section disappears for non-rectangular kinds — no hint that it's kind-specific. Layout jitter; obscures discoverability.
- **Recommendation:** Render disabled with tooltip "Corner radius applies to rectangles, frames, and images only".

### RF-039 — Migration cost not documented

- **Source:** Security
- **Severity:** Low
- **Status:** resolved (commit d032e04) — `migrations.rs` module-level doc now records the O(n) migration cost bounded by the deserialization envelope `MAX_FILE_SIZE`. No separate per-migration size check is needed because the page has already been parsed under that limit.
- **Location:** `crates/core/src/migrations.rs` (no pre-migration size check)
- **Issue:** Migration walks unbounded within `MAX_FILE_SIZE` envelope. Acceptable but worth documenting.
- **Recommendation:** Document explicitly that migration cost is O(n) bounded by `MAX_FILE_SIZE`.

---

## Info

### RF-040 — Serde recursion limit not asserted

- **Source:** Security
- **Severity:** Info
- **Status:** resolved (commit d032e04) — added a compile-time `const _: () = assert!(MAX_JSON_NESTING_DEPTH == 128, ...)` in `serialize.rs::deserialize_page_with_version`. If `MAX_JSON_NESTING_DEPTH` is ever changed without an audit of `serde_json`'s default recursion limit, the build will fail rather than silently diverging from the upstream default.
- **Location:** `crates/core/src/serialize.rs:87-88`
- **Issue:** Comment notes serde_json default 128-recursion limit matches `MAX_JSON_NESTING_DEPTH`. No compile-time/runtime assertion.
- **Recommendation:** Optional: pin serde_json version with CI check, or add explicit depth assertion.

### RF-041 — Wildcard arm on string-typed kind dispatch in migrations

- **Source:** Architect, BE
- **Severity:** Info
- **Status:** resolved (commit d032e04) — `migrate_to_v2` wildcard arm now documents the closed set of v1 kind-type strings (ellipse, path, text, group, component_instance) and the rationale for the wildcard (forward compatibility on unknown kinds; the listed kinds did not gain a `corners` field in v1→v2). Future migrations that touch additional kinds must re-enumerate. Compile-time exhaustiveness is impossible for a free-form `serde_json::Value` string match — the related fix on the typed `NodeKind` matches in core FieldOperations was committed separately as 4eca688.
- **Location:** `crates/core/src/migrations.rs:31`
- **Issue:** Wildcard `_ => {}` arm on string-typed kind dispatch. Less risky than NodeKind match (free-form Value), but a new corner-bearing variant added in v3 wouldn't trigger compile error.
- **Recommendation:** Document v1→v2 scope in comment, or enumerate v1 kind-type strings explicitly.

---

## Critical/High Halt

Per the slash command, Critical and High findings must be flagged and remediation halted until addressed. **RF-001 through RF-011 must be resolved before merge.**

The most pressing items:

- **RF-001** — GraphQL broadcasts shorthand input that frontend can't decode → connected clients silently miss GraphQL-originated corner changes
- **RF-002** — UI doesn't expose 4 of 5 new shapes; either ship interim shape selector or gate merge on 14d
- **RF-003** — workfile loads accept invariant-violating corner data
- **RF-005** — silent coercion of malformed legacy v1 data masks corruption
