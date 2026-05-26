# Review Findings — PR #66 (i18n migration + CI gate lock)

**Branch:** `feature/i18n-spec-17`
**Spec:** `docs/superpowers/specs/2026-05-26-17-i18n-migration.md`
**Plan:** `docs/superpowers/plans/2026-05-26-17-i18n-migration.md`
**Review date:** 2026-05-26
**Reviewers (10):** Architect, Security, BE, Logic, Compliance, Data Scientist, FE, A11y, UX, DevOps

## Summary

Six independent reviewers converged on a single root-cause finding: the ESLint rule's `mode: "jsx-text-only"` silently bypasses every JSX attribute literal. Empirical verification confirmed **83–92 hardcoded English `aria-label`/`title`/`placeholder` attributes remain** across panels, components, and shell — strings the PR description claimed were resolved.

Path forward selected by maintainer: **Fix-in-PR** (Path 1).

---

## Findings

### Critical

#### RF-001 — ESLint `mode: "jsx-text-only"` makes `jsx-attributes.include` dead config
- **Sources:** Architect, BE, Logic, Compliance, FE, A11y
- **Severity:** Critical
- **File:** `frontend/eslint.config.js:52`
- **Description:** Under `mode: "jsx-text-only"`, the plugin's `filterOutJSX()` drops every literal whose direct parent is not `JSXElement` or `JSXFragment`. JSX attribute values have parent `JSXAttribute`, so the `jsx-attributes.include` allowlist is never inspected. The CI Gate green-lights any future hardcoded aria-label. Verified empirically — changing to `mode: "jsx-only"` reveals 83+ violations.
- **Fix:** Change `mode: "jsx-text-only"` → `mode: "jsx-only"`. Add a smoke test asserting the rule fires on attribute literals.
- **Status:** open

#### RF-002 — Migration is materially incomplete; 83+ aria-labels, titles, placeholders remain in English
- **Sources:** Architect, BE, Logic, FE, A11y
- **Severity:** Critical
- **Files:** `frontend/src/panels/AlignPanel.tsx:101,107,117,127,137,147,157,172,183`; `EffectCard.tsx:338,370,403,417,431,445,457`; `AppearancePanel.tsx:371,380,387,424,474`; `EffectsPanel.tsx:149,178`; `FillRow.tsx:290,298,306`; `StrokeRow.tsx:105,115`; `GradientControls.tsx:360,376`; `TokenDetailEditor.tsx:174,346,364,379,394,587`; `DesignPanel.tsx:69`; `components/color-picker/GradientEditor.tsx:271,312,330,364`; `HexInput.tsx:104`; `AlphaStrip.tsx:160`; `HueStrip.tsx:162`; `components/value-input/ValueInput.tsx:920,1016,130`; `corner-section/CornerPopover.tsx:62-73,86-110,629,637,657,673`; `panels/token-editor/TokenDetailPane.tsx:282`.
- **Description:** Direct consequence of RF-001. PR description's claim "no new hardcoded user-facing strings" is false. fr/es users see mixed-language UI.
- **Fix:** After RF-001, run lint to surface the full list, then migrate each to `t("panels:<key>")` or `t("a11y:<key>")` with corresponding entries in en/fr/es.
- **Status:** open

### High

#### RF-003 — `DISABLED_EXPLANATION` ALL_CAPS const ships hardcoded English
- **Sources:** BE
- **Severity:** High
- **File:** `frontend/src/panels/corner-section/CornerSection.tsx:88,173`
- **Description:** Module-level `const DISABLED_EXPLANATION = "Corner radius applies to..."` is rendered to DOM. Rule exempts ALL_CAPS declarations, so the gate doesn't flag it.
- **Fix:** Replace with `t("panels:corners.disabledExplanation")`; add the key to all three locales.
- **Status:** open

#### RF-004 — `t("panels:tokens.invalidValue")` references a key that does not exist
- **Sources:** Logic
- **Severity:** High
- **File:** `frontend/src/panels/TokenDetailEditor.tsx:137`
- **Description:** Key absent from all locale files. i18next default missing-key behavior returns the key string (truthy), so `|| "Invalid value"` fallback never fires.
- **Fix:** Add key to en/fr/es. Enable `returnNull: true` so future missing keys surface.
- **Status:** open

#### RF-005 — CI grep crashes when an eslint-disable directive is on line 1
- **Sources:** Logic, DevOps
- **Severity:** High
- **File:** `.github/workflows/ci.yml:295`
- **Description:** `sed -n "$((lineno - 1)),${lineno}p"` produces `sed -n "0,1p"` when `lineno == 1`. GNU sed rejects address 0. With `set -euo pipefail` the job aborts with an opaque error.
- **Fix:** Clamp: `start=$((lineno > 1 ? lineno - 1 : 1))`.
- **Status:** open

#### RF-006 — Template-literal attribute values not validated
- **Sources:** Architect
- **Severity:** High
- **Files:** `AppearancePanel.tsx:424,474`; `EffectsPanel.tsx:178`; `TokenRow.tsx:300,314`; `SchemaSection.tsx:51`; `GradientEditor.tsx:330`
- **Description:** Template literals like `` aria-label={`Fill ${index + 1}`} `` contain hardcoded English. `should-validate-template` defaults to false. After RF-001 is fixed, these still slip through.
- **Fix:** Set `"should-validate-template": true`. Migrate to interpolation: `t("a11y:fills.itemLabel", { index: index + 1 })`.
- **Status:** open

### Major

#### RF-007 — `callees.include` is dead config (plugin only honors `callees.exclude`)
- **Sources:** Architect
- **Severity:** Major
- **File:** `frontend/eslint.config.js:65-67`
- **Description:** Plugin's `shouldSkip(options.callees, ...)` only consumes `exclude`. The `include: ["setAnnouncement", "toast", "showToast"]` has no effect.
- **Fix:** Remove dead `include` setting.
- **Status:** open

#### RF-008 — Helper functions returning hardcoded strings bypass the rule
- **Sources:** Architect
- **Severity:** Major
- **File:** `frontend/src/panels/corner-section/CornerPopover.tsx:62-73,86-110`
- **Description:** `popoverHeaderLabel(target)` returns hardcoded English; module-scope `CORNER_SHAPE_OPTIONS = [{label: "Round"}]` ALL_CAPS-exempts option labels.
- **Fix:** Refactor helpers to take `t` or return keys. Build option arrays inside components.
- **Status:** open

#### RF-009 — `_meta.needsNativeReview` provenance missing (spec mandates; plan deferred)
- **Sources:** Architect
- **Severity:** Major
- **Files:** `frontend/src/i18n/locales/{fr,es}/*.json`; spec §1.7
- **Description:** Spec §1.7 specifies `_meta.needsNativeReview: true` on fr/es files. Plan explicitly noted this was dropped. Spec wasn't updated to match.
- **Fix:** Update spec to remove `_meta` requirement (matching plan + implementation). Keep parity script's top-level `_*` skip for future provenance.
- **Status:** open

#### RF-010 — Locale-parity script doesn't verify `{{var}}` placeholder parity
- **Sources:** Data Scientist
- **Severity:** Major
- **File:** `frontend/scripts/check-locale-parity.mjs`
- **Description:** fr missing `{{name}}` while en has it passes CI but silently drops dynamic content at runtime.
- **Fix:** Extract placeholders via `/\{\{(\w+)\}\}/g` per leaf, compare sets. Add self-test.
- **Status:** open

#### RF-011 — `collectKeys` recursion lacks depth guard (CLAUDE.md §11)
- **Sources:** Compliance, BE, Data Scientist
- **Severity:** Major
- **File:** `frontend/scripts/check-locale-parity.mjs:23-35`
- **Description:** CLAUDE.md §11 "Recursive Functions Require Depth Guards" mandates a named MAX constant + `>=` check.
- **Fix:** `const MAX_LOCALE_NESTING_DEPTH = 16;`, plumb `depth` param, throw on `depth >= MAX`. Enforcement test.
- **Status:** open

#### RF-012 — Spanish stroke vocabulary inconsistency: "Trazo" vs "Contorno"
- **Sources:** UX
- **Severity:** Major
- **File:** `frontend/src/i18n/locales/es/panels.json:91-94`
- **Description:** `stroke.title`/`empty`/`add` use "Trazo"; new `stroke.remove` uses "Contorno". Breaks SR user's mental model.
- **Fix:** Change `"Eliminar contorno"` → `"Eliminar trazo"`.
- **Status:** open

#### RF-013 — Parity script doesn't verify `t()` calls resolve to real keys
- **Sources:** Logic
- **Severity:** Major
- **File:** `frontend/scripts/check-locale-parity.mjs`
- **Description:** RF-004 (missing `tokens.invalidValue`) demonstrates the gap. Script structurally can't catch missing-key references because it never reads source.
- **Fix:** Extend script (or add sibling) walking `frontend/src/**/*.{ts,tsx}`, extract `t("ns:key")` calls, assert each resolves in `en/<ns>.json`.
- **Status:** open

#### RF-014 — `aria-valuetext` missing on AlphaStrip/HueStrip (pre-existing)
- **Sources:** A11y
- **Severity:** Major
- **Files:** `frontend/src/components/color-picker/AlphaStrip.tsx:163-176`, `HueStrip.tsx:166-179`
- **Description:** Pre-existing. CLAUDE.md a11y rule requires `aria-valuetext` for 2D canvas slider widgets. ColorArea provides it; strips do not.
- **Fix:** Add `aria-valuetext` (e.g., `"{n}%"`, `"{n}°"`).
- **Status:** open

### Medium

#### RF-015 — Bash arithmetic expansion of `lineno` is a code-injection sink
- **Sources:** Security
- **Severity:** Medium
- **File:** `.github/workflows/ci.yml:295`
- **Description:** `$((lineno - 1))` performs recursive variable evaluation. Filename containing `$(...)` flowing into arithmetic can execute arbitrary commands in the CI runner.
- **Fix:** Validate `[[ "$lineno" =~ ^[0-9]+$ ]]` before arithmetic. Use `awk` for extraction. Add `--` before `"$file"` in sed.
- **Status:** open

#### RF-016 — Colon-in-filename breaks `cut -d:` parsing
- **Sources:** Security, DevOps
- **Severity:** Medium
- **File:** `.github/workflows/ci.yml:292-293`
- **Description:** `cut -d: -f1` assumes `:` only appears as grep-output delimiter.
- **Fix:** Use parameter expansion: `file="${line%%:*}"; rest="${line#*:}"; lineno="${rest%%:*}"`.
- **Status:** open

#### RF-017 — CI grep accepts empty rationale
- **Sources:** FE
- **Severity:** Medium
- **File:** `.github/workflows/ci.yml:286-307`
- **Description:** `grep -q 'i18n-allow:'` accepts `// i18n-allow:` with nothing after.
- **Fix:** Tighten to `grep -qE 'i18n-allow:[[:space:]]*[A-Za-z]+'`.
- **Status:** open

#### RF-018 — Block-form eslint-disable wraps too much code
- **Sources:** FE
- **Severity:** Medium
- **Files:** 10 files with block disables
- **Description:** Block-form spans entire elements when only one literal needs exemption.
- **Fix:** Replace with `eslint-disable-next-line` adjacent to specific literal.
- **Status:** open

#### RF-019 — `framework` plugin option not explicitly set
- **Sources:** FE
- **Severity:** Medium
- **File:** `frontend/eslint.config.js`
- **Description:** Plugin defaults `framework: 'react'`. Solid JSX shares AST so works today, but implicit default is fragile.
- **Fix:** Add `framework: 'react'` with rationale comment.
- **Status:** open

#### RF-020 — `import.meta.url` direct-invocation check not portable
- **Sources:** BE, Logic
- **Severity:** Medium
- **File:** `frontend/scripts/check-locale-parity.mjs:93`
- **Description:** Fails on paths with spaces and on Windows.
- **Fix:** `fileURLToPath(import.meta.url) === realpathSync(process.argv[1])`.
- **Status:** open

#### RF-021 — Test coverage gaps in `compareLocaleTrees`
- **Sources:** BE
- **Severity:** Medium
- **File:** `frontend/scripts/__tests__/check-locale-parity.test.mjs`
- **Description:** No tests for null leaf values, array values, structural mismatch (string vs object at same path), `loadLocaleNamespace` error path.
- **Fix:** Add four tests.
- **Status:** open

#### RF-022 — Missing ESLint rule smoke test
- **Sources:** Architect
- **Severity:** Medium
- **File:** missing `frontend/src/i18n/__tests__/eslint-rule-smoke.test.ts`
- **Description:** Spec §5.4 mandates it. Regressing rule config produces no test signal.
- **Fix:** Add smoke test covering JSX text, JSX attribute (RF-001), template-literal (RF-006).
- **Status:** open

### Minor / Low / Info

#### RF-023 — Module-level i18n subscription has no teardown
- **Sources:** BE
- **Severity:** Low
- **File:** `frontend/src/i18n/index.ts:94`
- **Description:** `.on("languageChanged", persistLocale)` without `.off()`. Benign in production (singleton), accumulates in HMR/tests.
- **Fix:** Expose `teardownI18n()` or document singleton-lifetime assumption.
- **Status:** open

#### RF-024 — Spec §1.3 says "no persistence" but code has localStorage persistence
- **Sources:** Architect
- **Severity:** Minor
- **File:** spec §1.3
- **Description:** Spec/code drift. Code shipped persistence; spec wasn't updated.
- **Fix:** Update spec §1.3 to describe shipped state.
- **Status:** open

#### RF-025 — Orphan locale keys not checked
- **Sources:** Architect
- **Severity:** Minor
- **File:** `frontend/scripts/check-locale-parity.mjs`
- **Description:** Per CLAUDE.md §11 "Migrations Must Remove All Superseded Code", dead keys are in scope.
- **Fix:** Add `check-locale-usage.mjs` sibling. Acceptable to defer if documented.
- **Status:** open

#### RF-026 — `outOfGamut` collapses two distinct strings into one
- **Sources:** A11y
- **Severity:** Minor
- **File:** `frontend/src/components/color-picker/HexInput.tsx:117-118`
- **Description:** Pre-migration had short aria-label + longer title. Post-migration uses same string for both.
- **Fix:** Split into `outOfGamutShort` + `outOfGamutLong` keys.
- **Status:** open

#### RF-027 — `<span>Aa</span>` typography preview not aria-hidden
- **Sources:** A11y
- **Severity:** Minor
- **File:** `frontend/src/panels/token-editor/TokenDetailPane.tsx:195-203`
- **Description:** Pre-existing. SR users hear "Aa" noise.
- **Fix:** Add `aria-hidden="true"` to the span.
- **Status:** open

#### RF-028 — Per-locale smoke test only covers `common:cancel`
- **Sources:** A11y
- **Severity:** Minor
- **File:** `frontend/src/i18n/__tests__/locale-rendering.test.tsx`
- **Description:** No migrated panels-namespace key is exercised.
- **Fix:** Extend test to verify one key per namespace per locale.
- **Status:** open

#### RF-029 — Three locales eagerly loaded at startup
- **Sources:** FE, Data Scientist
- **Severity:** Info
- **File:** `frontend/src/i18n/index.ts`
- **Description:** ~7-10KB gzipped dead-weight for unused locales. Acceptable today.
- **Fix:** No action this PR. Deferred performance optimization.
- **Status:** wont-fix (deferred — backlog)

#### RF-030 — Test wrapper boilerplate duplicated across 8 test files
- **Sources:** FE
- **Severity:** Low
- **Files:** 8 test files
- **Description:** `renderWithI18n` helper duplicated.
- **Fix:** Extract to `frontend/src/test-utils/i18n.ts`.
- **Status:** open

#### RF-031 — `escapeValue: false` lacks guardrail
- **Sources:** Security
- **Severity:** Info
- **File:** `frontend/src/i18n/index.ts:85-88`
- **Description:** Safe today; no HTML-sink consumers in `frontend/src`. Future regression risk if such usage is introduced.
- **Fix:** Add inline warning comment + optional CI grep flagging HTML-sink introductions.
- **Status:** open

#### RF-032 — Cosmetic: leading blank line in CI error output
- **Sources:** DevOps
- **Severity:** Minor
- **File:** `.github/workflows/ci.yml:289-298`
- **Description:** `bad="$bad\n..."` accumulator produces leading blank line.
- **Fix:** Use bash array + `printf '%s\n'`.
- **Status:** open

#### RF-033 — `lodash@4.18.1` transitive dependency (unusual version)
- **Sources:** BE, FE
- **Severity:** Low
- **File:** `frontend/pnpm-lock.yaml`
- **Description:** Dev-only transitive of `eslint-plugin-i18next`. Not exploitable.
- **Fix:** Track for next dep audit.
- **Status:** wont-fix (informational)

---

## Verified-clean items (no findings)

- **XSS surface:** No HTML-sink usage in `frontend/src`. Translation values flow only into JSX text and DOM attribute slots (auto-escaped by Solid).
- **CORS / WebSocket / file persistence:** Not touched.
- **`eslint-plugin-i18next` pinning:** `6.1.4` locked, install uses `--frozen-lockfile`.
- **Action SHA pinning:** New CI jobs use SHAs matching existing pins.
- **Sentinel/wire-format types:** No new types crossing Rust↔TS boundary.
- **Translation quality (fr/es excluding RF-012):** "Ombre portée", "Lissage", "Mixto", "Sombra paralela" are professional and idiomatic.
- **`collectKeys` `_meta` skip semantics:** Correctly scoped to top-level only via `isTopLevel` flag.
- **Solid reactivity through `useTransContext`:** `t` is a reactive accessor; locale switches propagate correctly.
- **Block-form `eslint-disable`/`enable` pairing:** All 11 pairs match (scope concern — see RF-018).
- **Per-locale smoke test correctness:** With `lng={c.lng}` prop, correctly exercises locale lookup.
- **Locale parity at HEAD:** All 17 new keys present in en/fr/es.

---

## Remediation plan

Path 1 chosen. Batches dispatched per-finding-group in subsequent commits:

- **Batch A** — Fix the gate + complete the migration: RF-001 + RF-002 + RF-006 + RF-007 + RF-019 (eslint config), then migrate the now-revealed 83+ violations
- **Batch B** — Specific hardcoded-string + missing-key bugs: RF-003 + RF-004 + RF-008
- **Batch C** — Bash/CI hardening: RF-005 + RF-015 + RF-016 + RF-017 + RF-018 + RF-032
- **Batch D** — Parity script hardening: RF-010 + RF-011 + RF-013 + RF-020 + RF-021
- **Batch E** — Spanish translation fix: RF-012
- **Batch F** — A11y improvements: RF-014 + RF-026 + RF-027 + RF-028
- **Batch G** — Spec alignment: RF-009 + RF-024
- **Batch H** — Test smoke + small items: RF-022 + RF-023 + RF-030 + RF-031
- **Deferred:** RF-025, RF-029, RF-033 (backlog or no-action)
