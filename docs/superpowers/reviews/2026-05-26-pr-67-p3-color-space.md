# Review Findings — PR #67 (Display-P3 color space support)

**Branch:** `feature/p3-color-spec-18`
**Spec:** `docs/superpowers/specs/2026-05-26-18-p3-color-space.md`
**Plan:** `docs/superpowers/plans/2026-05-26-18-p3-color-space.md`
**Review date:** 2026-05-26
**Reviewers (9):** Architect, Security, BE, Logic, Compliance, Data Scientist, FE, A11y, UX

## Summary

The central deliverable is broken end-to-end: the canvas renderer doesn't consume the new P3 emit path, so P3-tagged colors fall back to gray on the canvas — exactly the manual smoke-test failure (done criterion #6) the spec mandated. Same failure pattern as PR #66: producer and consumer not connected for the new variant, spec's §11 Transport Boundary Inventory undercounted the dispatch sites. Six independent reviewers raised findings; Security, Logic, A11y reviewers found no issues in their domains.

Path forward selected by maintainer: **Fix-in-PR** (Path 1).

---

## Findings

### Critical

#### RF-001 — Canvas renderer never consumes P3 path (central deliverable broken)
- **Sources:** Architect (RF-A01), FE (RF-F01)
- **Severity:** Critical
- **Files:** `frontend/src/canvas/renderer.ts:238,449,479`; `frontend/src/canvas/text-overlay.ts:64`; `frontend/src/components/gradient-editor/gradient-utils.ts:69,178`; `frontend/src/panels/page-thumbnail-draw.ts:41`; `frontend/src/components/value-input/ValueInput.tsx:198`
- **Description:** `resolveFillStyle` and seven sibling dispatch sites shortcut on `space === "srgb"` and fall back to `DEFAULT_FILL` (light grey) / `"#000000"` / `"rgba(0,0,0,0.3)"` for non-sRGB colors. The new `colorToCss` in `panels/token-helpers.ts` was added with P3 support but the canvas renderer doesn't call it — uses `srgbColorToRgba` directly. Net effect: pick a P3 color, see gray on canvas. Spec §11 Transport Boundary Inventory marked "Canvas renderer fill style — No code change (relies on `colorToCss`)" — factually wrong. Spec §12 Done criterion #6 (manual smoke: P3 #FF0000 renders more saturated than sRGB on a P3 display) cannot pass.
- **Fix:** Route every canvas dispatch site through `colorToCss` (or move it to a renderer-adjacent module since `panels/` is a higher layer than `canvas/`). Add an integration test asserting `ctx.fillStyle === "color(display-p3 …)"` for a P3 fill. Apply same change to gradient stops in `gradient-utils.ts` and the `ValueInput.tsx:198` token-ref swatch. Update spec §11 inventory.
- **Status:** open

#### RF-002 — Picker mode hardcoded to "srgb"; silently downgrades P3 storage tag
- **Sources:** Architect (RF-A02), UX (RF-U01)
- **Severity:** Critical
- **File:** `frontend/src/components/color-picker/ColorPicker.tsx:109`
- **Description:** `state.space` initialized to `"srgb"` regardless of `props.color.space`. Re-open picker on a `Color::DisplayP3` color → mode shows sRGB → fields display sRGB-clipped channels → any touch on the picker emits with `space: "srgb"` → P3 tag silently lost. Contradicts spec §1 "Storage tag is preserved until the user explicitly commits a new color in the new mode."
- **Fix:** Initialize: `space: props.color.space === "display_p3" ? "display_p3" : "srgb"`. Add regression test that opens picker on P3 color, asserts `state.space === "display_p3"`, and that subsequent drag emits preserve the P3 tag.
- **Status:** open

### High

#### RF-003 — handleSpaceChange ordering + ghost commits on same-mode click
- **Sources:** Architect (RF-A03), FE (RF-F02), UX (RF-U02)
- **Severity:** High
- **File:** `frontend/src/components/color-picker/ColorPicker.tsx:387-394`
- **Description:** Two issues at the same call site:
  1. `commitColor()` fires synchronously before `emit()`'s rAF-deferred `flushEmit()` actually delivers the new tag to the parent. History captures the previous color state; the new emit lands without an associated commit.
  2. No guard against `space === state.space` — clicking the already-active radio button still fires setState + emit + commitColor, producing a ghost undo entry. Same for cycling OkLCH↔HSL (both still emit `Color::Srgb`, so the document doesn't change but a history entry is committed). Violates "History Commits Must Contain At Least One Operation".
- **Fix:** Early-return when `space === state.space`. Fire emit synchronously (or move commit into flushEmit) so the commit captures post-mutation state. Skip commit when both modes map to the same storage tag (e.g., OkLCH↔HSL both → Srgb).
- **Status:** open

#### RF-004 — Color enum still uses #[derive(Deserialize)] — spec-self-commitment violated
- **Sources:** Architect (RF-A04)
- **Severity:** High
- **File:** `crates/core/src/node.rs:507-535`
- **Description:** Spec §6 explicitly committed: "Add NaN/inf guards in the deserialization path AND a value-construction validator. The current `Color::DisplayP3` derive-deserialize accepts NaN silently; the new path rejects with a typed error" and "Fix both [Srgb and DisplayP3] in this PR ... satisfies the existing rust-defensive.md rule 'No Derive Deserialize on Validated Types' — we move both variants to a manual deserialize that routes through a validating constructor." PR did NOT do this. Color still uses `#[derive(Deserialize)]`, NaN/Inf channels still accepted silently.
- **Fix:** Implement the manual deserialize routing through a validating constructor that rejects NaN/Infinity. Apply to both `Color::Srgb` and `Color::DisplayP3` per the spec commitment.
- **Status:** open

#### RF-005 — MIN/MAX_COLOR_CHANNEL constants tautological — false-confidence anti-pattern
- **Sources:** Architect (RF-A05), BE (RF-B01), Compliance (RF-C01), Data Scientist (RF-D01)
- **Severity:** High
- **Files:** `crates/core/src/validate.rs:159-165,1638-1646`; `frontend/src/types/validation.ts`
- **Description:** Both constants defined and mirrored in TS. Zero consumers across the workspace. The `test_<constant>_enforced` tests assert tautologies (`MIN <= 0.0`, `MAX >= 1.0`). Explicit anti-pattern per CLAUDE.md §11 "Constant Enforcement Tests": "A test that only reads the constant's value … does not prove enforcement and does not satisfy this requirement." Worse, the `_enforced` suffix gives future grep-based audits false confidence.
- **Fix:** Wire to the validating constructor from RF-004 — `validate_color_channel(c) -> Result<...>` called from the new manual Deserialize impl. Replace tautological tests with real rejection tests (NaN/Inf rejected, out-of-range rejected).
- **Status:** open

#### RF-006 — page-thumbnail.ts:73 deferral not in inventory
- **Sources:** Architect (RF-A07), FE (RF-F04)
- **Severity:** High
- **File:** `frontend/src/panels/page-thumbnail.ts:73`
- **Description:** Still calls raw `canvas.getContext("2d")`. Not enumerated in the PR's deferred-inventory. Violates §10 "Staged Feature Delivery Contract".
- **Fix:** Use `acquireWideGamut2D` for consistency with the main canvas + picker canvases.
- **Status:** open

#### RF-007 — TS math helpers don't guard NaN at entry
- **Sources:** Compliance (RF-C02)
- **Severity:** High
- **Files:** `frontend/src/components/color-picker/color-matrices.ts:49-82` (`srgbEotf`, `srgbOetf`, `multiplyMatrixVec3`)
- **Description:** `Math.pow(NaN, …) === NaN` propagates silently through the entire pipeline. Violates "Math Helpers Must Guard Their Domain" + "Floating-Point Validation: Any pure function … must guard against NaN and infinity at its own entry point — do not assume an upstream caller already validated."
- **Fix:** Add `if (!Number.isFinite(c)) return 0;` at entry of each function. Document the choice.
- **Status:** open

### Major

#### RF-008 — Rust P3 helpers marked `#[allow(dead_code)]` with no production consumers
- **Sources:** Architect (RF-A06)
- **Severity:** Major
- **File:** `crates/core/src/tokens/color_convert.rs:154,173`
- **Description:** `srgb_to_display_p3` and `is_out_of_srgb_gamut` are `pub` but only reached by tests. The `#[allow(dead_code)]` rationale names Plan 18 Tasks 10/11/12 as consumers — none of those tasks consume them.
- **Fix:** Wire to the validating constructor from RF-004 (use `is_out_of_srgb_gamut` for validation). Remove the `#[allow(dead_code)]` annotations once consumed.
- **Status:** open

#### RF-009 — ColorDisplayMode lacks exhaustiveness sentinel
- **Sources:** Architect (RF-A08)
- **Severity:** Major
- **File:** `frontend/src/components/color-picker/types.ts:14`
- **Description:** Used for runtime dispatch in 2 switches (`ColorValueFields.tsx`) + 1 (`ColorSpaceSwitcher.tsx`) + others (`value-input/input-helpers.ts`). Per frontend-defensive.md "Discriminated Unions Must Have a Type-Level Exhaustiveness Sentinel", a colocated `.test-d.ts` is required. Adding a 5th mode in the future would silently fail dispatch.
- **Fix:** Add `frontend/src/components/color-picker/__tests__/types.test-d.ts` with exhaustive switch + `_exhaustive: never` sentinel covering every dispatch site.
- **Status:** open

#### RF-010 — Parity fixture bootstrapped from Rust output (correlated-bug risk)
- **Sources:** Architect (RF-A09)
- **Severity:** Major
- **File:** `tests/fixtures/parity/p3-color-conversions.json`
- **Description:** Description explicitly says values bootstrapped from Rust. Cannot detect bugs that affect both implementations identically (e.g., wrong matrix row used in both languages).
- **Fix:** Add a one-time `scripts/generate-p3-parity.mjs` that computes vectors from the W3C-published matrices via an independent path, OR cite W3C reference values for cardinal-color rows in the fixture description with their expected values.
- **Status:** open

#### RF-011 — HexInput P3 badge has no test
- **Sources:** FE (RF-F03)
- **Severity:** Major
- **File:** `frontend/src/components/color-picker/HexInput.tsx:126`; missing test
- **Description:** Wiring `state.space === "display_p3"` → `isP3Mode` → badge visibility is a new reactive pipeline. No test asserts the badge appears on P3 mode and disappears on sRGB mode. Violates "Reactive Pipelines Must Be Verified End-to-End".
- **Fix:** Extend ColorPicker.test.tsx with an assertion: badge present after clicking P3 radio, absent before.
- **Status:** open

### Medium / Minor

#### RF-012 — is_out_of_srgb_gamut Srgb arm doesn't apply finite_or_zero
- **Sources:** BE (RF-B02)
- **Severity:** Minor
- **File:** `crates/core/src/tokens/color_convert.rs` (`Color::Srgb` arm in `is_out_of_srgb_gamut`)
- **Description:** P3 arm applies `finite_or_zero` before checking. Srgb arm uses raw values. NaN sRGB color is silently classified as in-gamut (NaN < -EPS = false, NaN > 1+EPS = false). Inconsistent.
- **Fix:** Apply `finite_or_zero` symmetrically in the Srgb arm.
- **Status:** open

#### RF-013 — acquireWideGamut2D doc should warn about re-acquisition
- **Sources:** Architect (RF-A10)
- **Severity:** Minor
- **File:** `frontend/src/canvas/canvas-context.ts`
- **Description:** HTML Canvas spec: subsequent `getContext("2d", ...)` calls on the same canvas return the existing context regardless of new options. Helper doesn't memoize, but the current consumers only call it once per mount, so no current bug.
- **Fix:** Add docstring note: "Call only once per canvas lifetime. Re-acquisition returns the existing context regardless of options (HTML Canvas spec)."
- **Status:** open

#### RF-014 — Spec §11 inventory undercounts canvas dispatch sites
- **Sources:** Architect (RF-A11)
- **Severity:** Minor
- **File:** `docs/superpowers/specs/2026-05-26-18-p3-color-space.md` §11
- **Description:** Spec marked "Canvas renderer fill style — No code change" but factually 7 sites need updating. The undercount is what produced RF-001.
- **Fix:** Part of RF-001 fix — update the spec inventory to enumerate all dispatch sites.
- **Status:** open

#### RF-015 — HexInput badge + warning lack flex-shrink: 0
- **Sources:** UX (RF-U03)
- **Severity:** Minor
- **Files:** `frontend/src/components/color-picker/ColorPicker.css`
- **Description:** When both gamut warning and P3 badge are visible (P3 OOG color), at narrow popover widths the layout could collapse.
- **Fix:** Add `flex-shrink: 0` to both `.sigil-hex-input__gamut-warning` and `.sigil-hex-input__p3-badge`.
- **Status:** open

#### RF-016 — OOG warning fires inappropriately in P3 mode
- **Sources:** UX (RF-U05)
- **Severity:** Minor
- **File:** `frontend/src/components/color-picker/ColorPicker.tsx:399`
- **Description:** In P3 mode, picking a vibrant P3 red fires the OOG warning glyph — but the user deliberately chose wide-gamut. Reads as defect rather than feature.
- **Fix:** Suppress OOG warning when `state.space === "display_p3"`, OR change copy/icon when P3 mode is active to signal "wide-gamut intended" rather than "color clipping".
- **Status:** open

#### RF-017 — P3 badge keyboard discoverability gap
- **Sources:** UX (RF-U04)
- **Severity:** Minor
- **File:** `frontend/src/components/color-picker/HexInput.tsx:126-135`
- **Description:** Badge has `aria-hidden="true"` + `title`. Keyboard users tabbing into hex input see "P3" with no way to discover that hex is interpreted as P3.
- **Fix:** Add `aria-describedby` on the hex input pointing at the badge (drop aria-hidden on the badge and give it an id), OR extend the P3 radio's title to mention hex reinterpretation explicitly.
- **Status:** open

### Suggestion (wont-fix candidates)

#### RF-018 — HSL tooltip mentions Figma's HSB
- **Sources:** UX (RF-U06)
- **Severity:** Suggestion
- **File:** locale files (panels.json hslTitle)
- **Description:** Always-visible tooltip surfaces competitor terminology.
- **Status:** wont-fix (deferred — keeps useful disambiguation for migrating users)

#### RF-019 — P3 channels at 4 decimal precision
- **Sources:** UX (RF-U07)
- **Severity:** Suggestion
- **File:** `frontend/src/components/color-picker/ColorValueFields.tsx`
- **Description:** Figma uses 3. 4 decimals exceeds display precision.
- **Status:** wont-fix (deferred — 4 decimals matches CSS spec syntax precision; revisit if user feedback)

---

## Verified-clean items (no findings)

- **Security:** No HTML-sink usage. CSS string construction guarded with Number.isFinite. JSON fixture is repo-vendored. Canvas color space cast is constant-literal. WASM safe. No new external deps.
- **Logic:** All 7 traced paths (matrix order, gamut detection, flushEmit snapshot, handleSpaceChange Solid sync semantics, acquireWideGamut2D fallback, parity fixture values, colorToCss format) verified correct.
- **A11y:** ColorSpaceSwitcher rewrite preserved all radiogroup + roving-tabindex semantics. HexInput P3 badge correctly uses `aria-hidden + title` (no aria-label on non-interactive). Canvas widgets' ARIA slider semantics untouched. Locale strings present + properly translated.

---

## Remediation plan

Path 1 chosen. Batches dispatched per-finding-group:

- **Batch A** — Canvas renderer wiring: RF-001 + RF-006 + RF-014. The headline fix.
- **Batch B** — ColorPicker fixes: RF-002 + RF-003 + RF-011.
- **Batch C** — Rust core fixes (combined): RF-004 + RF-005 + RF-008 + RF-012. Validate constructor + manual Deserialize + wire dead helpers + symmetric NaN guards.
- **Batch D** — TS math NaN guards: RF-007.
- **Batch E** — Type-level discriminated union sentinel: RF-009.
- **Batch F** — Parity fixture ground truth: RF-010.
- **Batch G** — UX polish: RF-013 + RF-015 + RF-016 + RF-017.
- **Deferred:** RF-018, RF-019 (suggestion-only).
