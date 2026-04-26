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
- **Status:** open
- **Location:** `crates/server/src/graphql/mutation.rs:124-130, 328-358`
- **Issue:** GraphQL `setField` path eagerly captures the raw user-supplied `value` JSON into the broadcast. For shorthand corners input (`{shape:"round",radius:8}`), the broadcast forwards the shorthand. Frontend `apply-remote.ts case "kind"` requires a canonical 4-element corners array and silently drops shorthand — connected clients never see the change. MCP path is correct (it serializes post-mutation `node.kind`).
- **Recommendation:** After validate/apply succeed, build the broadcast `value` from the post-mutation canonical kind JSON (mirror MCP). Add an integration test driving GraphQL shorthand and asserting the broadcast `value` is canonical.

### RF-002 — 4 new corner shapes unreachable from the UI

- **Source:** UX
- **Severity:** Critical
- **Status:** open
- **Location:** `frontend/src/panels/schemas/design-schema.ts:58-67`
- **Issue:** The 4 new corner shapes (Bevel/Notch/Scoop/Superellipse) are unreachable from the UI. Schema only exposes `radii.x` per corner. A user opening the panel after the changelog announces 5 shapes will see no shape selector at all.
- **Recommendation:** Add a per-section Shape `<select>` (Round/Bevel/Notch/Scoop) above the 4 numeric inputs, OR document deferral and gate merge on 14d landing.

---

## High

### RF-003 — Cross-field corner invariants not enforced at workfile deserialization boundary

- **Source:** Architect, Security, BE
- **Severity:** High
- **Status:** open
- **Location:** `crates/core/src/serialize.rs` (`validate_deserialized_page`), `crates/core/src/node.rs:773-794`
- **Issue:** Cross-field invariants for `[Corner;4]` (superellipse uniformity, smoothing parity, MAX_CORNER_RADIUS) are NOT enforced at the workfile deserialization boundary. `validate_deserialized_page` walks floats but never calls `validate_corners`. A hand-edited workfile with mixed Superellipse+Round corners loads silently. Spec §7 promises this enforcement.
- **Recommendation:** In `validate_deserialized_page`, when kind is Rectangle/Frame/Image, call `validate_corners` on the corners array. Add a workfile-load test asserting hand-crafted invalid corners is rejected.

### RF-004 — Broadcast payload constructed before precondition verification

- **Source:** BE
- **Severity:** High
- **Status:** open
- **Location:** `crates/server/src/graphql/mutation.rs:124-130`
- **Issue:** Side-effect artifacts (broadcast payload) constructed before lock acquisition and precondition verification — violates rust-defensive "Side-Effect Artifacts Must Be Constructed After Precondition Verification". Affects all `parse_set_field` paths, not only `kind`.
- **Recommendation:** Move broadcast payload construction to after `validate()`/`apply()` succeed, populated from verified post-mutation document state (this also fixes RF-001).

### RF-005 — `migrate_to_v2` silently coerces malformed legacy `corner_radii`

- **Source:** Architect, Security, Logic, Data Scientist
- **Severity:** High
- **Status:** open
- **Location:** `crates/core/src/migrations.rs:42-53`
- **Issue:** `migrate_to_v2` silently coerces malformed legacy `corner_radii` (missing/null/non-numeric/string-encoded) to `0.0` via chained `unwrap_or_default()` / `unwrap_or(0.0)`. Violates §11 "No Silent Clamping of Invalid Input". A v1 file with `corner_radii: "broken"` becomes `[0,0,0,0]` Round corners with no diagnostic.
- **Recommendation:** Return `MigrationError::InvalidLegacyCornerRadii { node_id, raw_value }` when present-but-malformed. Missing field may default to 0; type-confused values must error. Add tests for null/string/wrong-arity.

### RF-006 — `defaultCorners()` returns aliased object references

- **Source:** FE, Data Scientist
- **Severity:** High
- **Status:** open
- **Location:** `frontend/src/store/default-corners.ts:14-17`
- **Issue:** `defaultCorners()` returns `[c, c, c, c]` — all four entries reference the same Corner object. Docstring claims "fresh tuple … callers may mutate without aliasing" but mutation of `corners[0].radii.x` mutates indices 1, 2, 3. Latent footgun for any future positional in-place mutation.
- **Recommendation:** Construct 4 independent objects in the array literal, OR `Object.freeze` and update the docstring. Add `result[0] !== result[1]` assertion test.

### RF-007 — Corner-radius NumberInput fields lack `max` bound

- **Source:** FE, UX
- **Severity:** High
- **Status:** open
- **Location:** `frontend/src/panels/schemas/design-schema.ts:62-65`
- **Issue:** Corner-radius `NumberInput` fields use `min: 0` but no `max`. CLAUDE.md §11 ("Constants Must Be Enforced") requires every numeric input to have a named-constant max. `MAX_CORNER_RADIUS` exists in `store/corners-input.ts`.
- **Recommendation:** Add `max: MAX_CORNER_RADIUS` to all four corner-radius schema entries (extend schema infra to reference the imported constant).

### RF-008 — Single-axis edit silently overwrites pre-existing y radius

- **Source:** FE, UX
- **Severity:** High
- **Status:** open
- **Location:** `frontend/src/panels/schema-panel-corners-handler.ts:109`
- **Issue:** Editing a single corner's `.x` writes `radii: { x: value, y: value }`, silently overwriting any pre-existing y value. Nodes with elliptical corners (x≠y) set via MCP have their y silently destroyed. Silent data loss, not silent clamping.
- **Recommendation:** Preserve `y: existingCorners[idx].radii.y` so independent y values survive single-axis edits, OR document uniform-only constraint and reject elliptical inputs at the parser.

### RF-009 — v1→v2 migration leaves on-disk file at v1 until next user mutation

- **Source:** DevOps
- **Severity:** High
- **Status:** open
- **Location:** `crates/server/src/persistence.rs`, `crates/server/src/main.rs:52`
- **Issue:** After v1→v2 load, in-memory doc is v2 but on-disk file remains v1 until first user mutation triggers `signal_dirty`. Server restart re-runs migration each load; v1 file lingers indefinitely.
- **Recommendation:** Mark document dirty after successful v1→v2 migration (or write synchronously at end of `load_workfile`). Turns silent migration into observable migration.

### RF-010 — Migration overwrites v1 file with no backup

- **Source:** DevOps
- **Severity:** High
- **Status:** open
- **Location:** `crates/server/src/workfile.rs:159-197`
- **Issue:** Migrated v2 content overwrites v1 in place via `atomic_write` — no backup of v1 file. One-way migration with no rollback affordance if a v2 round-trip introduces an unintended mutation.
- **Recommendation:** Before first migrated write, copy `manifest.json` and `pages/*.json` to a sibling `.sigil/.backup-v1/` directory. Pass `migrated_from: Option<u32>` flag through to `write_prepared_save`.

### RF-011 — Renderer ignores `node.kind.corners` (deferred to 14b/c)

- **Source:** Data Scientist, FE, UX
- **Severity:** High (deferral disclosure)
- **Status:** open
- **Location:** `frontend/src/canvas/renderer.ts:234-254`
- **Issue:** Renderer ignores `node.kind.corners` — Rectangle/frame/image still drawn with flat `ctx.fillRect`. Likely deferred to 14b/c per spec, but PR description should explicitly document the deferral so reviewers don't expect visual output.
- **Recommendation:** Confirm scope deferral in PR description and spec. No code fix in 14a.

---

## Medium

### RF-012 — `Corner`/`CornerRadii` use derive Deserialize on validated types

- **Source:** Architect, Security, BE
- **Severity:** Medium
- **Status:** open
- **Location:** `crates/core/src/node.rs:773-794`
- **Issue:** Use `#[derive(Deserialize)]` with public fields. `deny_unknown_fields` does NOT reject duplicate keys (serde_json silently last-writer-wins). Direct `serde_json::from_str::<CornerRadii>` accepts NaN/inf/out-of-range. Per "No Derive Deserialize on Validated Types".
- **Recommendation:** Implement `Deserialize` manually for `Corner`/`CornerRadii` routing through validating constructors with duplicate-key tracking. Make fields private with accessors.

### RF-013 — `validate_corners` uses `unwrap()` on Corner accessors

- **Source:** Compliance, Logic, BE, Security
- **Severity:** Medium
- **Status:** open
- **Location:** `crates/core/src/validate.rs:618, 620`
- **Issue:** `corners[0].smoothing().unwrap()` and `c.smoothing().unwrap()` in `validate_corners` violate CLAUDE.md §1 "no `unwrap()` or `expect()` in core crate". SAFETY comment doesn't exempt the rule.
- **Recommendation:** Replace with `if let Corner::Superellipse { smoothing, .. } = corners[0]` pattern match, eliminating `.unwrap()` calls. Makes invariant compiler-enforced.

### RF-014 — Wildcard match arms on NodeKind in SetCorners and GraphQL

- **Source:** Architect, BE
- **Severity:** Medium
- **Status:** open
- **Location:** `crates/core/src/commands/style_commands.rs:223-246` (SetCorners), `crates/server/src/graphql/mutation.rs:359`
- **Issue:** Wildcard `other =>` arms on `NodeKind` matches violate rust-defensive "NodeKind Variants Must Have Complete Validation Coverage". Silent breakage if a new corner-bearing variant is added.
- **Recommendation:** Enumerate all NodeKind variants explicitly so future variants force a compile error here.

### RF-015 — `setCorners` silent no-op on invalid input

- **Source:** Architect, Security, FE, UX
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/store/document-store-solid.tsx:947-979` (`setCorners`)
- **Issue:** Silent no-op when `parseCornersInput` returns null or kind isn't corner-bearing. No log/error/toast. Violates §11 "No Silent Clamping" + frontend-defensive "User-Initiated Mutations" (#5: visible error notification).
- **Recommendation:** Surface typed error or `console.warn` with structured payload. Update callers to handle error path.

### RF-016 — Asymmetric `smoothing` validation on per-corner array

- **Source:** Logic
- **Severity:** Medium
- **Status:** open
- **Location:** `crates/core/src/corners_input.rs:99-128` (`parse_per_corner_array`), `frontend/src/store/corners-input.ts`
- **Issue:** Per-corner array form silently ignores stray `smoothing` field on non-superellipse shapes. Shorthand form rejects it. Violates "Validation Must Be Symmetric Across All Transports".
- **Recommendation:** Reject `smoothing` on non-superellipse entries in per-corner array. Mirror in TS.

### RF-017 — `setCorners` `deepClone` not wrapped in try-catch

- **Source:** FE
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/store/document-store-solid.tsx` (setCorners)
- **Issue:** `deepClone(node.kind)` not wrapped in try-catch like sibling `setTextContent`/`setTextStyle`. Asymmetric defensive pattern.
- **Recommendation:** Wrap in try-catch matching sibling functions.

### RF-018 — No integration test for SchemaPanel → setCorners → store path

- **Source:** FE
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/panels/__tests__/` (gap)
- **Issue:** No integration test exercising SchemaPanel → setCorners → store path. "Reactive Pipelines Must Be Verified End-to-End" rule requires producer→consumer chain test.
- **Recommendation:** Mount `<SchemaPanel>` inside `DocumentProvider`, dispatch corner field change, assert `state.nodes[uuid].kind.corners[0].radii.x` updated.

### RF-019 — Double-cast `as unknown as Corners` bypasses variance check

- **Source:** FE
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/panels/schema-panel-corners-handler.ts:112`
- **Issue:** Double-cast `as unknown as Corners` bypasses TypeScript variance check. Single cast suffices.
- **Recommendation:** Replace with single `as Corners` cast or define `newCorners` directly as Corners type.

### RF-020 — `[Corner;4]` is 4× the in-memory size of old representation

- **Source:** Data Scientist
- **Severity:** Medium
- **Status:** open
- **Location:** `crates/core/src/node.rs:786-794`
- **Issue:** `Corner` enum is 32 bytes; `[Corner;4]` = 128 bytes vs old 32 bytes — 4× memory regression per node. ~50% wasted for common Round-uniform case. At 1000 nodes: +96 KB.
- **Recommendation:** Either accept and document in spec performance section, or use a niche representation (separate discriminant + radii arrays). Add benchmark.

### RF-021 — Default-Round corners serialize as 4 identical objects (6× growth)

- **Source:** Data Scientist
- **Severity:** Medium
- **Status:** open
- **Location:** `crates/core/src/migrations.rs:55-58` (default v2 emission)
- **Issue:** Default-Round-uniform rectangles serialize as 4 identical 50-byte objects = ~180 chars vs old ~28 — 6× growth uncompressed. At 1000 rectangles: +150 KB JSON.
- **Recommendation:** Add `Serialize` shorthand: emit `"corners":{"shape":"round","radius":r}` when all 4 corners identical Round with x==y. Deserializer already accepts shorthand.

### RF-022 — Disclosure button has `aria-expanded` but no `aria-controls`

- **Source:** A11y
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/panels/SchemaSection.tsx:42-52`
- **Issue:** Disclosure button has `aria-expanded` but no `aria-controls`. Screen-reader users can't programmatically jump to the controlled region. WCAG 1.3.1, 4.1.2. Pre-existing pattern; this PR adds another instance.
- **Recommendation:** Add generated `id` to `<div class="sigil-schema-section__fields">`; set `aria-controls={fieldsId}` on the toggle button. Apply across all sections.

### RF-023 — Duplicate label announcement on NumberInput

- **Source:** A11y
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/components/number-input/NumberInput.tsx:62-65`
- **Issue:** Visible label `<span class="sigil-number-input__prefix">` is not `aria-hidden`, AND input has duplicate `aria-label` — screen reader announces field twice ("TL, edit … TL"). WCAG 1.3.1, 4.1.2.
- **Recommendation:** Add `aria-hidden="true"` to prefix span (rely on input aria-label), OR drop input aria-label and use `aria-labelledby` to prefix span.

### RF-024 — Corner labels are unspoken abbreviations

- **Source:** A11y
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/panels/schemas/design-schema.ts:62-65`
- **Issue:** Labels are abbreviations only ("TL", "TR", "BR", "BL") — read as letter sequences without sighted context. WCAG 4.1.2.
- **Recommendation:** Set full-spoken `aria-label` ("Top-left corner radius") with visible "TL" prefix retained, or wire `aria-labelledby` to section heading + prefix span.

### RF-025 — Current corner shape invisible to user (no per-corner shape display)

- **Source:** UX
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/panels/SchemaPanel` (gap)
- **Issue:** Current corner shape is invisible to user. An MCP agent setting Bevel via `set_corners` produces no visible panel signal. Violates "Agents and humans see each other's changes" (CLAUDE.md §1 UX).
- **Recommendation:** Render a one-line status row showing per-corner shape ("Shapes: round, bevel, round, round") in the Corner Radius section. ~5 LOC change.

### RF-026 — Linked-corners rule is implicit and unobservable

- **Source:** UX
- **Severity:** Medium
- **Status:** open
- **Location:** Schema panel (gap)
- **Issue:** Linked-corners rule (uniform shorthand emitted only when all 4 corners identical) is implicit and unobservable — no Figma-style chain-link icon. User edits TL but unclear when it edits all vs only TL.
- **Recommendation:** Add visible link/unlink toggle adjacent to the 4 inputs (Figma chain-icon pattern).

### RF-027 — Superellipse-must-be-uniform rule not communicated client-side

- **Source:** UX
- **Severity:** Medium
- **Status:** open
- **Location:** Schema panel (gap)
- **Issue:** Superellipse-must-be-uniform constraint enforced server-side but not communicated client-side. Failure mode is after-the-fact rejection.
- **Recommendation:** When a shape selector is added (per RF-002), exclude Superellipse from per-corner options; only offer it at the all-corners scope.

### RF-028 — No CLI tool to migrate or validate-migrate a `.sigil/` directory

- **Source:** DevOps
- **Severity:** Medium
- **Status:** open
- **Location:** `cli/` (gap)
- **Issue:** No CLI tool to migrate or validate-migrate a `.sigil/` directory. Operators must start the server to find out if migration succeeds.
- **Recommendation:** Add `sigil-cli migrate <path>` subcommand running `migrate_to_v2` against each page file with success/error reporting. Enables CI smoke job.

### RF-029 — No fixture-based v1→v2 integration test

- **Source:** DevOps
- **Severity:** Medium
- **Status:** open
- **Location:** `.github/workflows/ci.yml`, `crates/server/tests/` (gap)
- **Issue:** No fixture-based v1→v2 integration test. The `core::deserialize_page` ↔ `server::load_workfile` boundary is where regressions hide.
- **Recommendation:** Add `crates/server` integration test with checked-in `tests/fixtures/legacy-v1.sigil/` containing v1 nodes; assert `load_workfile` succeeds and round-trips to v2 on save.

---

## Low

### RF-030 — Silent early returns in `apply-remote.ts` corners handler

- **Source:** Security, FE
- **Severity:** Low
- **Status:** open
- **Location:** `frontend/src/operations/apply-remote.ts:251-313`
- **Issue:** Multiple validation early-`return`s with no `console.warn`. A misbehaving server (or compromised peer) can produce silent client-side drops. Inconsistent with neighboring `applyCreateNode`.
- **Recommendation:** Add `console.warn` at each early-return identifying the rejection cause.

### RF-031 — Duplicate corner validation constants in frontend

- **Source:** FE
- **Severity:** Low
- **Status:** open
- **Location:** `frontend/src/operations/apply-remote.ts:33-49` vs `frontend/src/store/corners-input.ts`
- **Issue:** `MAX_CORNER_RADIUS`/min/max smoothing duplicated as module-private constants in both files. Will diverge silently.
- **Recommendation:** Import from a single shared module (`frontend/src/types/validation.ts` or extend `corners-input.ts` exports).

### RF-032 — `eslint-disable @typescript-eslint/no-explicit-any` in test code

- **Source:** FE
- **Severity:** Low
- **Status:** open
- **Location:** `frontend/src/panels/__tests__/schema-panel-corners.test.ts:27-28`
- **Issue:** `eslint-disable @typescript-eslint/no-explicit-any` in test code. CLAUDE.md "no any types" is unqualified.
- **Recommendation:** Type the mock as `Mock<typeof setCorners>` or `vi.fn<Parameters<...>, void>()`.

### RF-033 — No exhaustiveness sentinel test for Corner discriminated union

- **Source:** FE
- **Severity:** Low
- **Status:** open
- **Location:** `frontend/src/types/document.ts:582-622`
- **Issue:** No exhaustiveness sentinel test for Corner discriminated union. Adding a variant won't force update of `VALID_CORNER_TYPES` set, `CORNER_BEARING_KINDS` set, or renderer.
- **Recommendation:** Add type-level test in `document-corners.test-d.ts`: exhaustive `switch (c.type)` with `default: const _exhaust: never = c;`.

### RF-034 — Duplicate radius validation logic between `corners_input.rs` and `validate.rs`

- **Source:** BE
- **Severity:** Low
- **Status:** open
- **Location:** `crates/core/src/corners_input.rs` vs `crates/core/src/validate.rs`
- **Issue:** `check_radius_value` and `check_smoothing_value` duplicate logic of `validate_radius_component`. Per CLAUDE.md §5 "Define all validation artifacts in `validate.rs`".
- **Recommendation:** Extract single `pub(crate) fn validate_radius_value` in `validate.rs`, call from both sites.

### RF-035 — Missing direct max-enforcement tests on SetCorners FieldOperation

- **Source:** BE
- **Severity:** Low
- **Status:** open
- **Location:** `crates/core/src/commands/style_commands.rs` (SetCorners tests)
- **Issue:** No direct `test_set_corners_rejects_radius_above_max` / `test_set_corners_rejects_smoothing_above_max`. Constants are transitively enforced via `validate_corners`, but FieldOperation-level test would make the contract explicit.
- **Recommendation:** Add direct enforcement tests at the FieldOperation boundary.

### RF-036 — `default_corners` not const fn

- **Source:** Data Scientist
- **Severity:** Low
- **Status:** open
- **Location:** `crates/core/src/node.rs:828-833` (`default_corners`)
- **Issue:** Not `const fn`. Allocates per-call (cheap, but easy to avoid).
- **Recommendation:** Make `pub const fn default_corners()` or expose `pub const DEFAULT_CORNERS: [Corner; 4]`.

### RF-037 — `?? DEFAULT_SMOOTHING` masks invariant violation

- **Source:** UX
- **Severity:** Low
- **Status:** open
- **Location:** `frontend/src/panels/schema-panel-corners-handler.ts:71`
- **Issue:** `?? DEFAULT_SMOOTHING` fallback masks a potential type-system invariant violation (superellipse Corner without smoothing).
- **Recommendation:** Replace with invariant assertion: `if (c0.smoothing === undefined) { console.error("invariant: ..."); return; }`.

### RF-038 — Corner section disappears for non-rectangular kinds without hint

- **Source:** UX
- **Severity:** Low
- **Status:** open
- **Location:** `frontend/src/panels/schemas/design-schema.ts:60` (`when` filter)
- **Issue:** Section disappears for non-rectangular kinds — no hint that it's kind-specific. Layout jitter; obscures discoverability.
- **Recommendation:** Render disabled with tooltip "Corner radius applies to rectangles, frames, and images only".

### RF-039 — Migration cost not documented

- **Source:** Security
- **Severity:** Low
- **Status:** open
- **Location:** `crates/core/src/migrations.rs` (no pre-migration size check)
- **Issue:** Migration walks unbounded within `MAX_FILE_SIZE` envelope. Acceptable but worth documenting.
- **Recommendation:** Document explicitly that migration cost is O(n) bounded by `MAX_FILE_SIZE`.

---

## Info

### RF-040 — Serde recursion limit not asserted

- **Source:** Security
- **Severity:** Info
- **Status:** open
- **Location:** `crates/core/src/serialize.rs:87-88`
- **Issue:** Comment notes serde_json default 128-recursion limit matches `MAX_JSON_NESTING_DEPTH`. No compile-time/runtime assertion.
- **Recommendation:** Optional: pin serde_json version with CI check, or add explicit depth assertion.

### RF-041 — Wildcard arm on string-typed kind dispatch in migrations

- **Source:** Architect, BE
- **Severity:** Info
- **Status:** open
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
