# Review Findings — PR #57 Color Picker Delta

**Date:** 2026-04-20
**PR:** #57 — feat: token binding UX (ValueInput) + follow-up color picker fixes
**Branch:** `feature/token-binding`
**Delta reviewed:** commits `739e0b0` (sRGB display desync fix) and `a7948f1` (OkLab → HSL display-mode swap). Earlier commits on this PR were reviewed in prior rounds; this file captures the follow-up delta only.

**Scope:** `frontend/src/components/color-picker/` — 6 files, 386 diff lines.

**Reviewers dispatched (9, all in parallel):** Architect, Security Reviewer, Backend Engineer (BE), Backend Engineer (Logic), Backend Engineer (Compliance), Backend Engineer (Data Scientist), Frontend Engineer, Accessibility Reviewer, UX Reviewer.

---

## Findings

### RF-D01 — HSL edits on achromatic colors are silently lost

- **Sources:** Logic, Architect, UX
- **Severity:** Major
- **Confidence:** 90
- **Location:** `frontend/src/components/color-picker/ColorValueFields.tsx:189-197` + `frontend/src/components/color-picker/ColorPicker.tsx:34`
- **Description:** When a color is achromatic (e.g. `rgb(0.5, 0.5, 0.5)`), `srgbToHsl` returns `h=0, s=0`. The HSL edit path re-derives HSL from sRGB each render, overwrites one channel with the user's input, and converts back. If the user types a new H on a grey color, `hslToSrgb(200, 0, 0.5)` hits the `sc < 0.0001` branch and returns the same grey. The next render re-derives H as 0 and the UI reverts the user's input. Same behaviour affects S edits (S jumps to 100 once any non-zero S is set at H=0, because `srgbToHsl(1,0,0)` gives S=1). Related: `ColorPicker.tsx:34` gates the initial hue on `initSat > 0.001`, so near-greys also lose their stored hue intent on mount.
- **Recommended fix:** Hold last-typed H and S in the picker's `state` across renders; when the derived sRGB is achromatic, read H/S from state instead of from sRGB. Also relax the `initSat > 0.001` gate on hue init (Number.isFinite alone is sufficient; downstream SV logic already treats `s=0` specially).
- **Status:** resolved — Added `hslH`/`hslS` fields to the picker's `InternalState`, initialised from `srgbToHsl(props.color)` on mount, preserved across the prop-sync effect when `hlS === 0`, and passed down to `ColorValueFields` via new `hslH`/`hslS` props. `ColorValueFields` now falls back to these preserved values when `derivedS <= 0` in both the display-memo and the HSL edit handler, and emits an optional `hslHint: {h, s}` back to the parent so the typed H/S survive achromatic round-trips. Hue-init gate relaxed from `initSat > 0.001` to `Number.isFinite(initHue)` (`ColorPicker.tsx:103`).

### RF-D02 — Missing Number.isFinite entry guards on color math helpers

- **Sources:** Security, Compliance, Frontend Engineer, Data Scientist
- **Severity:** Medium
- **Confidence:** 95
- **Location:** `frontend/src/components/color-picker/color-math.ts:310` (`srgbToHsl`), `:336` (`hslToSrgb`)
- **Description:** CLAUDE.md §11 "Floating-Point Validation" and "Math Helpers Must Guard Their Domain" require every pure numeric helper to guard NaN/Infinity at its own entry, independent of upstream validation. Neither `srgbToHsl` nor `hslToSrgb` does so. `srgbToHsl(NaN, 0, 0)` returns `[NaN, NaN, NaN]` silently (via `Math.max`). `hslToSrgb(NaN, ...)` returns `[NaN, NaN, NaN]` via `clamp01(NaN)`.
- **Recommended fix:** Add at the top of both functions: `if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return [0, 0, 0];` with a matching comment referencing the CLAUDE.md rule.
- **Status:** resolved — Added `Number.isFinite` entry guards at the top of both `srgbToHsl` and `hslToSrgb` in `color-math.ts`, returning `[0, 0, 0]` with a comment referencing the CLAUDE.md Math Helpers Must Guard Their Domain rule. Parity tests added in `color-math.test.ts` for NaN and Infinity inputs on both helpers.

### RF-D03 — Achromatic threshold `delta > 0.001` is too coarse

- **Sources:** Data Scientist, Frontend Engineer
- **Severity:** Medium
- **Confidence:** 90
- **Location:** `frontend/src/components/color-picker/color-math.ts:317`
- **Description:** The threshold `0.001` is ~18,000× larger than float64 epsilon. Any color whose channel spread is ≤ 0.001 in [0,1] space (≈ 0.25 units on a 0–255 scale) is silently coerced to `h=0, s=0`. This is a silent clamp (CLAUDE.md §11 "No Silent Clamping of Invalid Input"), and it compounds RF-D01 by expanding the "hue edits lost" domain. The division domain is already guarded by `delta > 0`, so the 0.001 tolerance is not required for numerical safety.
- **Recommended fix:** Relax to `delta > Number.EPSILON * 10` or simply `delta > 0`. Document the threshold rationale in a comment.
- **Status:** resolved — Changed the achromatic check in `srgbToHsl` from `delta > 0.001` to `delta > 0` and the inverse check in `hslToSrgb` from `sc < 0.0001` to `sc <= 0`. The division-by-zero guard is inherent in `delta > 0`; the former `0.001` coarse tolerance was acting as a silent clamp. Comments added describing why the threshold is now strictly zero.

### RF-D04 — No end-to-end test for the synchronous-init reactive path

- **Sources:** Compliance, Frontend Engineer
- **Severity:** Medium
- **Confidence:** 85
- **Location:** missing `frontend/src/components/color-picker/__tests__/ColorPicker.test.tsx` coverage for init
- **Description:** CLAUDE.md frontend-defensive §"Reactive Pipelines Must Be Verified End-to-End" requires that every new reactive connection be covered by an integration/component test. The new sync-init path (triggered by the Kobalte NumberField + `createControllableSignal` mount-time capture bug) has no regression test. The original bug would silently re-appear if the init order changes or the store shape regresses.
- **Recommended fix:** Add component test: render `<ColorPicker color={{space:"srgb", r:13/255, g:153/255, b:255/255, alpha:1}} />`, assert the three spinbutton elements for R/G/B display `13`, `153`, `255` synchronously without any user interaction.
- **Status:** resolved — Added `"should render the initial props.color synchronously in ColorValueFields (RF-D04)"` to `ColorPicker.test.tsx`. Renders the picker with `rgb(13, 153, 255)`, queries `[role="spinbutton"]`, and asserts the first three fields display `13`, `153`, `255` on the initial render with no awaits or user interaction — directly exercising the sync-init reactive path.

### RF-D05 — `ColorSpace` display union carries dead `"display_p3"` variant

- **Sources:** Frontend Engineer
- **Severity:** Medium
- **Confidence:** 85
- **Location:** `frontend/src/components/color-picker/types.ts:12`
- **Description:** `ColorSpaceSwitcher` does not expose `"display_p3"` (hidden, per comment), and `ColorPicker.tsx:109, 115` hardcodes `space: "srgb"` in all emissions. Keeping `"display_p3"` in the display union is dead surface, conflicting with CLAUDE.md §11 "Migrations Must Remove All Superseded Code".
- **Recommended fix:** Trim union to `"srgb" | "oklch" | "hsl"`. Re-add P3 when ColorSpaceSwitcher re-introduces it (blocked on proper color matrix conversion per the existing inline comment).
- **Status:** resolved — `types.ts` now exports `ColorDisplayMode = "srgb" | "oklch" | "hsl"`. All consumers (`ColorPicker`, `ColorValueFields`, `ColorSpaceSwitcher`, `ColorPicker.stories`) updated. `"display_p3"` arms removed from both switch blocks in `ColorValueFields`. Comment in `types.ts` describes the intentional omission and the re-add trigger (RF-D10 link).

### RF-D06 — `srgbToHsv` called before `Number.isFinite` guards are applied

- **Sources:** Compliance, Logic
- **Severity:** Low
- **Confidence:** 85
- **Location:** `frontend/src/components/color-picker/ColorPicker.tsx:23`
- **Description:** `const [initHue, initSat] = srgbToHsv(initR, initG, initB);` runs before the `Number.isFinite` checks at line 30-34. The IEEE 754 semantics of `NaN > 0.001 === false` make the final `hue` assignment safe by coincidence, but the call is fragile and depends on implementation details of `srgbToHsv` never throwing on NaN.
- **Recommended fix:** Guard `initR/initG/initB` before the `srgbToHsv` call; fall back to `(0, 0, 0)` if any channel is non-finite.
- **Status:** resolved — Init block split into `rawInitR/G/B/Alpha` (raw `colorToSrgb` output) followed by `initR/G/B/Alpha` (`Number.isFinite(raw) ? raw : 0`). `srgbToHsv` and `srgbToHsl` now receive only guarded values. RF-D02 already hardens the helpers themselves; this is the defence-in-depth at the caller per CLAUDE.md §11.

### RF-D07 — Init comment misdiagnoses the timing bug

- **Sources:** Frontend Engineer
- **Severity:** Low
- **Confidence:** 85
- **Location:** `frontend/src/components/color-picker/ColorPicker.tsx:61-69`
- **Description:** The inline comment attributes the Kobalte timing bug to `NumberInput` using `{ defer: true }` on a `rawValue`-watching effect. Reading `frontend/src/components/number-input/NumberInput.tsx`, there is no `defer: true` and no rawValue-watching effect in our wrapper — Kobalte's internal `createControllableSignal` is the actual source. The fix chosen (sync init in the parent) is correct; the diagnostic comment is wrong and will mislead future maintainers.
- **Recommended fix:** Rewrite the comment to describe Kobalte's internal `createControllableSignal` mount-time capture behavior, not our wrapper.
- **Status:** resolved — Rewrote the inline init comment in `ColorPicker.tsx:69-82` to name Kobalte's internal `createControllableSignal` as the source of the mount-time capture, describe how the controlled signal's "external" slot fails to update after the captured initial value, and explain why synchronous parent init (not `{ defer: true }` on an effect in our wrapper) is the correct fix.

### RF-D08 — HSL test coverage gaps

- **Sources:** Frontend Engineer, Data Scientist
- **Severity:** Low
- **Confidence:** 80
- **Location:** `frontend/src/components/color-picker/__tests__/color-math.test.ts`
- **Description:**
  1. Round-trip tests only cover red and teal; the `max === g` and `max === b` branches of `srgbToHsl` are not exercised in round-trip (yellow, cyan, magenta).
  2. Hue=360 boundary not tested (spec says `[0, 360)` — should normalize to 0).
  3. NaN/Infinity inputs not tested.
  4. `approx(..., 1e-6)` on arbitrary-color round-trip is ~9 orders of magnitude looser than the float64 achievable bound.
- **Recommended fix:** Add 4 tests covering the above.
- **Status:** resolved — Added to `color-math.test.ts`: (1) `srgbToHsl` yellow/cyan/magenta expected-value assertions covering the `max === g` and `max === b` branches, (2) `hslToSrgb(360, …)` equals `hslToSrgb(0, …)` boundary test, (3) NaN and Infinity inputs on both `srgbToHsl` and `hslToSrgb` asserted to return `[0, 0, 0]`, (4) explicit round-trip assertions for yellow/cyan/magenta. Tests pass with the existing `approx(..., 1e-6)` tolerance; tightening is deferred since the helper's precision budget is dominated by the Wikipedia algorithm's inherent float rounding, not by the test tolerance.

### RF-D09 — HSL vs HSB disambiguation

- **Sources:** Architect, UX
- **Severity:** Minor
- **Confidence:** 85
- **Location:** `frontend/src/components/color-picker/ColorSpaceSwitcher.tsx:31`
- **Description:** Figma uses HSB (alias HSV); designers coming from Figma may expect B, not L. The current title `"Hue/Saturation/Lightness (HSL)"` is accurate but doesn't disambiguate.
- **Recommended fix:** Expand tooltip to `"Hue/Saturation/Lightness (HSL — CSS-style, not Figma's HSB)"`. Defer HSB as a future 4th mode.
- **Status:** resolved — Updated the HSL `title` in `ColorSpaceSwitcher.tsx` to the recommended disambiguating string (using the proper `—` em-dash via `\u2014`). HSB remains deferred.

### RF-D10 — `ColorSpace` type name is overloaded

- **Sources:** Architect
- **Severity:** Minor
- **Confidence:** 80
- **Location:** `frontend/src/components/color-picker/types.ts`
- **Description:** The type now means "display mode" in the picker while `Color["space"]` means "storage space" in `document.ts`. Same word, different meaning. Future readers will conflate them.
- **Recommended fix:** Rename to `ColorDisplayMode` (or `PickerDisplayMode`).
- **Status:** resolved (partial) — Renamed the type from `ColorSpace` to `ColorDisplayMode` across `types.ts`, `ColorPicker.tsx`, `ColorValueFields.tsx`, `ColorSpaceSwitcher.tsx`, and `ColorPicker.stories.tsx`. The component/file name `ColorSpaceSwitcher` was deliberately kept (the switcher's user-facing label `aria-label="Color space"` already reads as the switch between spaces/modes, and the CSS class `sigil-color-space-switcher` is stable). The readers' confusion risk identified in the finding was on the *type* (`ColorSpace` vs `Color["space"]`), which is now disambiguated. Renaming the component and CSS class is deferred as a separate cosmetic cleanup.

---

## Positive Verifications (not findings)

- Wire contract intact: `"hsl"` never reaches the network. `ColorPicker.tsx:109, 115` hardcode `space: "srgb"` in `onColorChange` emissions; `srgbToColor` in `color-math.ts` has no `"hsl"` branch. Rust-side serde would reject `"hsl"` as an unknown variant by construction.
- Accessibility: `FIELD_ARIA_LABELS` map cleanly updated (`a_axis`/`b_axis` removed, `s` = "Saturation" added). Radiogroup semantics preserved. No 2D canvas widgets added.
- Math formulas: `srgbToHsl` and `hslToSrgb` match canonical Wikipedia HSL↔RGB algorithm. Sector boundaries correct (strict less-than produces standard 6-sector cascade). Hue normalisation handles negatives.
- Sync-init pattern addresses the real Kobalte timing bug; Number.isFinite guards on the store fields are the correct defensive pattern.

## Severity Thresholds

- No Critical findings.
- No High findings.
- 1 Major (RF-D01) — should be resolved before merge.
- 4 Medium (RF-D02, RF-D03, RF-D04, RF-D05) — should be resolved or deferred with rationale.
- 3 Low (RF-D06, RF-D07, RF-D08) — resolve if low-cost.
- 2 Minor (RF-D09, RF-D10) — optional.
