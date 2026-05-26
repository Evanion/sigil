# PR #65 / Plan 14d — Review Findings

**PR:** https://github.com/Evanion/sigil/pull/65
**Branch:** `feature/corner-editor-14d`
**Date:** 2026-05-26
**Reviewers dispatched:** Architect, Security, Logic (BE), Compliance, Data Scientist, FE, A11y, UX, BE code quality

**Summary:** 4 Critical / 3 High / 11 Major / 8 Medium / 12 Low-Info = 38 distinct findings after dedup.

The Critical findings cluster around accessibility — `aria-hidden` covering focusable triggers, focus not returning on popover close, hotspot reveal-on-hover blocks keyboard discoverability, lock-state reason via unreliable `title`. The High findings include the popover-anchoring shortcut flagged in the PR description (multiple reviewers agreed it's more than polish), a reactive override that clobbers user toggle state, and silent rejection in three commit handlers.

---

## Remediation Summary

All Critical, High, Major, and Medium findings are resolved across six commits on `feature/corner-editor-14d`. The Low findings split into surgical fixes (RF-028, RF-030..RF-033) committed in Batch F, and deferred polish items (RF-027, RF-034..RF-038) marked `wont-fix` with rationale below.

| Batch | Commit | Findings resolved |
|-------|--------|-------------------|
| A | `ac39fc6` | RF-005 (Popover wrapper `anchorRef` extension) |
| B | `866cf18` | RF-001, RF-002, RF-003, RF-004 (a11y blockers) |
| C | `fdd82a5` | RF-006, RF-007, RF-019 (reactive clobber + commit diagnostics) |
| D | `6bf4442` | RF-008..RF-015 (logic + a11y batch) |
| E | `d6f9396` | RF-016..RF-018, RF-020..RF-023, RF-025, RF-026 (UX + styling + medium) |
| F | `2d04ae5` | RF-028, RF-030..RF-033 (low polish surgical fixes) |

**Deferred (`wont-fix`)** with rationale:
- **RF-024** — historical scope on commits already in branch history; future docs commits use `docs:` (scopeless).
- **RF-027** — promoting `PathBuilder` to `frontend/src/types/` has no immediate cross-team need; all consumers live under `frontend/src/`.
- **RF-034, RF-035, RF-036** — UX polish items requiring designer iteration and/or analytics; the v1 baseline is acceptable per Spec 14 §1.5 user-facing design.
- **RF-037** — jsdom slider drag simulation is fundamentally limited; the current test asserts the gesture-end contract (the core history-coalescing invariant). A Playwright integration test is the right venue and out of scope for this remediation.
- **RF-038** — the pipeline test verifies the full UI→store→re-render chain on a rectangle; the contract is identical for frame/image per the kind switch in DesignPanel and CornerSection. Per-kind dispatch is locked by CornerSection's own unit tests.

---

## Critical Severity (4) — block merge

### RF-001 — `aria-hidden="true"` wraps the focusable popover trigger button

- **Sources:** A11y (A11Y-001), Architect (RF-004), Security
- **Severity:** Critical
- **Status:** resolved (Batch B, commit `866cf18`)
- **Location:** `frontend/src/panels/corner-section/CornerSection.tsx:141-153`
- **Issue:** The wrapper `<div class="sigil-corner-section__popover-host" aria-hidden="true">` contains the `Popover` component, which always renders a real `<button class="sigil-popover-trigger">`. That button remains in the keyboard tab order (only visually hidden by `width:0; height:0`). `aria-hidden` on an ancestor of a focusable, tabbable element is a documented ARIA 1.2 §5.2.7.6 anti-pattern.
- **Recommended fix:** Apply `tabindex="-1"` directly to the wrapper popover button (or add a `hideTrigger` prop to the Popover wrapper that sets `tabindex="-1"` and `aria-hidden` on the trigger itself). Remove `aria-hidden="true"` from the host div. Cleanest: extend Popover to support headless controlled mode without rendering a trigger button at all.

### RF-002 — Focus not returned to activating hotspot when popover closes

- **Sources:** A11y (A11Y-002)
- **Severity:** Critical
- **Status:** resolved (Batch B, commit `866cf18`)
- **Location:** `frontend/src/panels/corner-section/CornerSection.tsx:100-106, 131`
- **Issue:** `handleHotspotActivate` receives the activating `HTMLButtonElement` as the second arg (from `CornerPreviewSvg.tsx:29`) but discards it. `handleOpenChange(false)` only clears `activeHotspot` — it never restores focus to the hotspot. After Escape or outside click, focus is lost to `<body>`, breaking the documented "Escape returns focus to hotspot" contract.
- **Recommended fix:** Store the activating element in a `[lastTrigger, setLastTrigger] = createSignal<HTMLButtonElement | null>(null)` at activation time; in `handleOpenChange(false)`, call `lastTrigger()?.focus()` before clearing `activeHotspot`.

### RF-003 — Hotspots invisible at rest + invisible while disabled — keyboard/SR users can't discover them

- **Sources:** A11y (A11Y-003), UX (UX-003)
- **Severity:** Critical
- **Status:** resolved (Batch B, commit `866cf18`)
- **Location:** `frontend/src/panels/corner-section/CornerPreviewSvg.css:30-66`
- **Issue:** Hotspot buttons default to `opacity: 0` revealed only via `:hover` / `:focus-within` on the preview container. `opacity: 0` keeps the button focusable. Until a user tabs into the panel, the buttons are completely invisible — keyboard user receives no visual cue. Once tabbed into, `:focus-within` reveals the set. Worse: when `aria-disabled="true"` the rule sets `opacity: 0` (overriding the hover reveal) — the button remains in tab order yet invisible even when focused. Screen-magnifier users navigating with arrow keys cannot discover them.
- **Recommended fix:** (a) Always render at least a low-opacity affordance (e.g., faint dot or border) so hotspots have a discoverable resting visual. (b) For `aria-disabled="true"` hotspots, either set `tabindex="-1"` to remove them from tab order, OR keep them visible with a "locked" styling. As written, a keyboard user lands on an invisible button that does nothing on Enter.

### RF-004 — Locked-hotspot reason conveyed only via `title` attribute

- **Sources:** A11y (A11Y-004)
- **Severity:** Critical
- **Status:** resolved (Batch B, commit `866cf18`)
- **Location:** `frontend/src/panels/corner-section/CornerPreviewSvg.tsx:105-109`
- **Issue:** `title="Superellipse applies to all corners..."` is unreliable for SRs (JAWS/NVDA/VoiceOver behaviors differ; touch users get nothing). The hotspot announces only its `aria-label` ("Edit top-left corner") with no indication of locked state or reason.
- **Recommended fix:** Add a visually-hidden `<span id="locked-${id}">` containing the explanation; wire each locked hotspot via `aria-describedby={lockedId}` so AT announces "Edit top-left corner, dimmed, Superellipse applies to all corners…". Keep the `title` for sighted mouse users.

---

## High Severity (3) — block merge

### RF-005 — Popover anchors to a hidden zero-size trigger, not to the clicked hotspot

- **Sources:** Architect (RF-002), UX (UX-001), A11y (overlaps A11Y-001)
- **Severity:** High
- **Status:** resolved (Batch A, commit `ac39fc6`)
- **Location:** `frontend/src/panels/corner-section/CornerSection.tsx:140-153` + `CornerSection.css:30-42`
- **Issue:** Spec 14 §1.5 says: "Popover per hotspot **anchored to the hotspot element**." This PR's workaround renders a hidden zero-size `<span>` inside an `aria-hidden` host positioned `absolute; width:0; height:0` — CSS Anchor Positioning targets the wrong element. The popover therefore appears in roughly the same screen position regardless of which of 9 hotspots was clicked. The `onHotspotActivate` callback already passes the clicked `HTMLButtonElement` — the wiring is half-built and discarded.
- **Recommended fix (preferred):** Extend `frontend/src/components/popover/Popover.tsx` to accept an external `anchorRef?: HTMLElement` (or `anchorName?: string`) prop. When provided, the wrapper applies `anchor-name` to that element instead of its internal trigger. CornerSection passes the activated hotspot's `HTMLButtonElement` (already passed to `handleHotspotActivate`). Document the new prop in the wrapper.
- **Acceptable as v1 alternative:** Explicitly defer in the spec's deferred-findings table with rationale, and update the PR description from "Known polish item" to "spec gap" — but extending the wrapper is cleaner and isn't large.

### RF-006 — `createEffect` clobbers user "Unlock axes" toggle state on every reactive corners refresh

- **Sources:** Architect (RF-001), FE (FE-6), Security (SEC-14d-02), Logic (LOG-001)
- **Severity:** High
- **Status:** resolved (Batch C, commit `fdd82a5`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:242-244`
- **Issue:** `createEffect(() => setUnlocked(hotspotHasAsymmetricRadii(props.corners, props.target)))` re-runs every time `props.corners` changes (including after this popover's own commits). If the user manually toggles "Unlock axes" ON on a symmetric-radii corner and then commits a value where rx === ry (e.g., re-commits 16 → 16), the effect fires → `hotspotHasAsymmetricRadii` returns false → `setUnlocked(false)` collapsing the toggle behind the user's back. This is the "Display Layers Must Preserve User Intent Across Lossy Transforms" pattern from `frontend-defensive.md` (RF-D01 precedent from PR #57).
- **Recommended fix:** Remove the effect. Initialize `unlocked` from `hotspotHasAsymmetricRadii` once via `createSignal`. The popover unmounts on close (per `<Show when={activeHotspot()}>` in CornerSection), so re-mounting on next open re-runs the initial state. If reactive remote-edit reflection is desired, track an explicit "user has touched the toggle" flag that disables the auto-sync after first user interaction.

### RF-007 — `commitRadius` / `commitRx` / `commitRy` silently reject invalid input

- **Sources:** Security (SEC-14d-01), FE (FE-7), BE (Q14d-01), Logic (LOG-004), Compliance
- **Severity:** High
- **Status:** resolved (Batch C, commit `fdd82a5`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:213-227 (commitRadius), 279-296 (commitRx), 387-404 (commitRy), 375-381 (commitSmoothingFromValueInput)`
- **Issue:** Each handler early-returns on invalid input (`trimmed.length === 0`, `!Number.isFinite(parsed)`, `parsed < 0 || parsed > MAX_CORNER_RADIUS`) with NO `console.warn` AND no user-visible status. The popover root has no aria-live status region. `commitShape` (line 197) and `commitSmoothing` (line 350) DO emit structured warns — the asymmetry within the same file is suspicious. Banned by CLAUDE.md §11 "Handlers Must Surface Validation Failures" anti-pattern #2 (silent rejection) and `frontend-defensive.md` "Internal Mutation Entry Points Must Diagnose Their Own No-Ops".
- **Recommended fix:** Add structured `console.warn("CornerPopover: <field> commit rejected", { raw, parsed, reason, target: props.target, max: MAX_CORNER_RADIUS })` at each early-return path other than the intentional empty-string short-circuit (which represents "no destructive intent"). For range failures, also surface to a popover-root `<span class="sr-only" role="status" aria-live="polite">` element with a user-readable message.

---

## Major Severity (11)

### RF-008 — `commitSmoothing` silently converts non-superellipse corners to superellipse

- **Sources:** Logic (LOG-002)
- **Severity:** Major
- **Status:** resolved (Batch D, commit `6bf4442`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:362-366`
- **Issue:** The factory unconditionally returns `{type: "superellipse", radii: { ...prev.radii }, smoothing: s}` regardless of `prev.type`. Gated by `showSmoothing()` at the JSX call site, but if an external mutation (MCP, another tab) changes one corner from superellipse to round while the popover is open, the next slider tick or ValueInput commit silently converts that corner back to superellipse.
- **Recommended fix:** Either guard inside `commitSmoothing` (re-check `showSmoothing()` and bail with structured warn) or preserve `prev.type` and only update smoothing on already-superellipse corners; non-superellipse corners returned unchanged.

### RF-009 — `isSuperellipseUniform` strict equality brittle to FP drift on smoothing

- **Sources:** Logic (LOG-003)
- **Severity:** Major
- **Status:** resolved (Batch D, commit `6bf4442`)
- **Location:** `frontend/src/panels/corner-section/corner-section-state.ts:58-60, 34-41`
- **Issue:** `tl.smoothing === tr.smoothing && ...` strict-equality across smoothings. Kobalte's value normalization + slider step + FP arithmetic can produce 1-ULP drift (0.5 vs 0.5000000000000001). The lock state then flips false, disabling the lock UI even though the user perceives uniform smoothing. Same issue in `cornerEq` driving `isLinked`.
- **Recommended fix:** Compare with a tight tolerance: `Math.abs(a - b) < 1e-9`. Same in `cornerEq` for radii (where drift is less likely but defensive).

### RF-010 — Heading level mismatch between CornerSection (h2) and sibling TypographySection (h3)

- **Sources:** A11y (A11Y-005)
- **Severity:** Major
- **Status:** resolved (Batch D, commit `6bf4442`)
- **Location:** `frontend/src/panels/corner-section/CornerSection.tsx:114` + `frontend/src/panels/TypographySection.tsx:528`
- **Issue:** Inconsistent heading outline within the Appearance tab. Within the popover, `<h3>` for "Top-left corner" header should be downgraded if Corners is `<h3>`.
- **Recommended fix:** Downgrade `sigil-corner-section__header` to `<h3>` to match sibling. Downgrade `sigil-corner-popover__header` to `<h4>`.

### RF-011 — `<label>` elements not programmatically associated with their inputs

- **Sources:** A11y (A11Y-006)
- **Severity:** Major
- **Status:** resolved (Batch D, commit `6bf4442`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:411, 449, 467, 482, 512`
- **Issue:** Every field uses `<label class="sigil-corner-popover__label">Shape</label>` as a sibling to its input — no `for=`, no `htmlFor`, no input `id`. Each control also has `aria-label`. SRs announce only the `aria-label`; the visible `<label>` text is announced as orphan body text. Violates the "Label association" a11y rule.
- **Recommended fix:** Give each `<label>` an `id`, wire each control's `aria-labelledby` to that id, drop the duplicate `aria-label`. Alternatively: keep `aria-label` on the control, mark visible labels `aria-hidden="true"`. The first option is preferred since the visible text matches the intended name.

### RF-012 — `aria-label="Unlock axes"` on wrapper div duplicates Switch.Label announcement

- **Sources:** A11y (A11Y-007), FE (FE-8)
- **Severity:** Major
- **Status:** resolved (Batch D, commit `6bf4442`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:437-443`
- **Issue:** `aria-label` is invalid on a non-interactive `<div>` with no role. Kobalte Switch.Label supplies the accessible name. Duplicate label noise (and the inline comment claims the aria-label is for test reviewers — `data-testid` already exists for that purpose).
- **Recommended fix:** Remove `aria-label` from the wrapper div. Keep `data-testid`.

### RF-013 — "Mixed" badge `role="status"` announces on every popover open

- **Sources:** A11y (A11Y-008), UX (UX-006)
- **Severity:** Major
- **Status:** resolved (Batch D, commit `6bf4442`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:413-420`
- **Issue:** `role="status"` (implicit `aria-live="polite"`) on `<span>Mixed</span>` causes SR to announce "Mixed" each popover open, doubled with the popover heading and Select label. The badge is *state*, not a *status message*.
- **Recommended fix:** Replace `role="status"` with no role. Give the span an `id` (e.g., `mixed-indicator-${target}`), add `aria-describedby={isMixed() ? mixedId : undefined}` to the Select. SR hears "Shape combobox, Round, Mixed" instead of orphan "Mixed".

### RF-014 — `role="status"` on disabled-state span re-announces on every selection change

- **Sources:** A11y (A11Y-009)
- **Severity:** Major
- **Status:** resolved (Batch D, commit `6bf4442`)
- **Location:** `frontend/src/panels/corner-section/CornerSection.tsx:121-123`
- **Issue:** "Corner radius applies to rectangles, frames, and images only" rendered inside `<span role="status">` is redundant with the adjacent visible `<p>`. Every selection change to a non-corner-bearing node re-mounts the span, triggering announcement.
- **Recommended fix:** Remove the `role="status"` span; the visible `<p>` (line 120) already provides the information and the section is reachable by Tab. If a per-selection announcement is desired, hoist to a single panel-level live region.

### RF-015 — Slider missing `ariaValueText` for smoothing — bare numeric ratio is meaningless

- **Sources:** A11y (A11Y-011)
- **Severity:** Major
- **Status:** resolved (Batch D, commit `6bf4442`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:527-540`
- **Issue:** Kobalte's default `aria-valuetext` is the numeric value. SR users hear "zero point five" with no unit or domain. The Slider wrapper accepts `ariaValueText` but it's unused.
- **Recommended fix:** `ariaValueText={\`Smoothing \${Math.round((gestureSmoothing() ?? currentSmoothing()) * 100)} percent\`}`.

### RF-016 — Dead `fillColor` prop — preview always renders in accent color

- **Sources:** UX (UX-002)
- **Severity:** Major
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/CornerPreviewSvg.tsx:92` + `frontend/src/panels/DesignPanel.tsx:114-117`
- **Issue:** Spec §1.6 implies the preview "fills with the node's effective fill color." The component accepts `fillColor?` but DesignPanel never passes it. Every preview renders in `var(--sigil-accent, #4a9eff)`. The prop is dead code, the spec is silently unimplemented.
- **Recommended fix:** Wire DesignPanel to resolve the node's first solid fill (reuse `resolveFill` helper from `page-thumbnail-draw.ts:73`) and pass it. Alternative: delete the `fillColor` prop and make the accent a CSS variable.

### RF-017 — Hardcoded `rgba()` colors in CornerPreviewSvg.css

- **Sources:** FE (FE-3)
- **Severity:** Major
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/CornerPreviewSvg.css:47-66`
- **Issue:** CLAUDE.md §5 styling rule: "No hardcoded visual values in component CSS." Lines 47-54 use `rgba(255,255,255,…)` and `rgba(74,158,255,…)`. Line 92 of `CornerPreviewSvg.tsx` falls back to `#4a9eff`.
- **Recommended fix:** Add semantic CSS custom properties (`--hotspot-bg`, `--hotspot-bg-hover`, `--hotspot-border`, `--hotspot-border-hover`) to `styles/theme.css` and reference them. Drop the literal `#4a9eff` fallback.

### RF-018 — Over-exports from CornerPopover.tsx: `headerLabel`, `makeCornerOfShape`, `writeCorners`

- **Sources:** Architect (RF-005), BE (Q14d-03)
- **Severity:** Major (low end of Major)
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:82, 114, 133`
- **Issue:** Exported but used only inside the file + by tests. Widens API surface unnecessarily.
- **Recommended fix:** Mark `/** @internal — exported for unit tests only */` OR move to a sibling `corner-popover-helpers.ts` so the public/private contract is explicit.

---

## Medium Severity (8)

### RF-019 — `commitSmoothingFromValueInput` silent rejection (subset of RF-007)

- **Sources:** Logic, Architect, BE
- **Severity:** Medium
- **Status:** resolved (Batch C, commit `fdd82a5`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:375-381`
- **Issue:** Same family as RF-007. Resolved together.

### RF-020 — Duplicate `CORNER_POSITION_LABEL` constant across two files

- **Sources:** Architect (RF-006), BE (Q14d-05), Compliance
- **Severity:** Medium
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/corner-aria-label.ts:24` and `corner-section-state.ts:27`
- **Issue:** Same 4-element array in two modules. CLAUDE.md §5 "Validation constants and predicates that are used by more than one frontend module MUST be defined in a single source-of-truth module."
- **Recommended fix:** Delete the duplicate in `corner-aria-label.ts`; import from `corner-section-state.ts`.

### RF-021 — Parity test doesn't assert SVG coordinate equality

- **Sources:** Logic (LOG-005), BE (Q14d-07)
- **Severity:** Medium
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts:158-197`
- **Issue:** `expectParity` only counts op kinds (M/L/C/Z/A). It does NOT compare numeric arguments. A bug like swapping rx and ry in the SVG `A` command, or emitting the wrong large-arc flag, would pass parity.
- **Recommended fix:** Add a coordinate-level assertion: for each `ellipse` op in the recorder, derive the expected `L startX startY A rx ry rotDeg large sweep endX endY` and compare against the corresponding tokens in `builder.toString()`.

### RF-022 — Asymmetric superellipse parity fixture missing (rx ≠ ry)

- **Sources:** Logic (LOG-006)
- **Severity:** Medium
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts:230-240`
- **Issue:** The asymmetric-radii parity case uses `superellipse(20, 0.7)` — single `r` → rx === ry === 20. Per the multi-axis-input rule (and PR #64 RF-001 precedent), the rx ≠ ry case must be covered for every shape that supports independent axes. The test comment incorrectly states "rx == ry for superellipse per spec uniformity" — Corner for superellipse is `{type: "superellipse", radii: {x, y}, smoothing}` and supports independent axes.
- **Recommended fix:** Add a `superellipseXY(rx, ry, smoothing)` helper and include a fixture with rx ≠ ry. Also include the swapped fixture per the rule.

### RF-023 — Stale `gestureSmoothing` on slider unmount mid-gesture

- **Sources:** Security (SEC-14d-03), Architect (RF-009)
- **Severity:** Medium
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/CornerPopover.tsx:312, 526-540`
- **Issue:** If an external mutation flips `showSmoothing()` to false during a slider drag, the Slider unmounts → `onChangeEnd` never fires → `gestureSmoothing` stays non-null.
- **Recommended fix:** Register `onCleanup` at the Smoothing block's setup to clear `gestureSmoothing(null)`, or hoist the gesture state into CornerSection.

### RF-024 — Two commits use `docs(spec-14):` scope outside §6 allowlist

- **Sources:** Compliance
- **Severity:** Medium (style/governance)
- **Status:** wont-fix (historical scope on commits already in branch history; future docs commits will use `docs:` scopeless)
- **Location:** Commits `d693246` and `26a1cc5`
- **Issue:** Same as PR #64's RF-010 — recurring. CLAUDE.md §6 allowlist: `{core, server, mcp, frontend, cli, bindings, devops}`.
- **Recommended fix:** Use `docs:` (scopeless) or `docs(frontend):` going forward. No history rewrite for this PR.

### RF-025 — Inline JSX handlers with conditional ternaries in CornerPreviewSvg

- **Sources:** FE (FE-2)
- **Severity:** Medium
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/CornerPreviewSvg.tsx:101-110`
- **Issue:** The disabled-state predicate `props.nonCenterHotspotsDisabled && id !== "center"` is duplicated 3× per button (aria-disabled, title, onClick guard).
- **Recommended fix:** Extract a named `isHotspotDisabled(id, locked)` helper in a `*-helpers.ts` module. Add unit test.

### RF-026 — `commitRx`/`commitRy` tests don't exercise different `ry` values

- **Sources:** BE (Q14d-06)
- **Severity:** Medium
- **Status:** resolved (Batch E, commit `d6f9396`)
- **Location:** `frontend/src/panels/corner-section/__tests__/CornerPopover.test.tsx`
- **Issue:** Multi-axis-input rule applies to the partial-update path too. Current test asserts `radii.y === 8` (unchanged) but all corners start with `y === 8`. A regression where `ry` is incorrectly captured once outside the factory would silently pass.
- **Recommended fix:** Add a test: `[round{x:8,y:5}, round{x:8,y:9}, round{x:8,y:8}, round{x:8,y:8}]` → commit rx=30 on "top" hotspot → assert `[0].radii.y === 5 && [1].radii.y === 9`. Same for `commitRy`.

---

## Low Severity (12 — mostly polish, batch in one commit)

- **RF-027** — PathBuilder type lives in `canvas/` but is reached from `panels/`; consider promoting to `frontend/src/types/path-builder.ts`. *Source: Architect (RF-007).* **Status: wont-fix** — no immediate cross-team need; all consumers live under `frontend/src/`. Benefit is only architectural cleanliness.
- **RF-028** — Verify Storybook stories' unique UUIDs. *Source: Architect (RF-008).* **Status: resolved (Batch F, commit `2d04ae5`)** — each story now passes a distinct uuid through `rectWith`.
- **RF-029** — Document Popover wrapper's "controlled mode + hidden trigger" pattern as supported/discouraged. *Source: Architect (RF-010).* **Status: resolved (Batch F, commit `2d04ae5`)** — JSDoc now documents the `anchorRef`-based controlled-mode-without-trigger pattern.
- **RF-030** — `currentSmoothing()` returns silent 0.5 fallback when non-superellipse; gated, but add `console.warn` on the unreachable path. *Source: FE (FE-9).* **Status: resolved (Batch F, commit `2d04ae5`)** — structured warn added on the gate-failure branch.
- **RF-031** — `as unknown as Corners` double-cast in `writeCorners` avoidable via explicit 4-tuple construction. *Source: FE (FE-5).* **Status: resolved (Batch F, commit `2d04ae5`)** — explicit 4-tuple construction replaces the cast.
- **RF-032** — `headerLabel` naming → `popoverHeaderLabel` for greppability. *Source: BE (Q14d-09).* **Status: resolved (Batch F, commit `2d04ae5`)** — renamed throughout `CornerPopover.tsx`.
- **RF-033** — Slider `onChangeEnd` inline handler does 2 statements (call + signal set); extract to `commitSmoothingGesture(v)`. *Source: Compliance.* **Status: resolved (Batch F, commit `2d04ae5`)** — extracted as `endSmoothingGesture`.
- **RF-034** — No first-time discoverability cue for the preview's interactivity. Mitigated by RF-003 fix. *Source: UX (UX-004).* **Status: wont-fix** — requires designer iteration; v1 baseline (low-opacity hotspot affordance from RF-003) is acceptable per Spec 14 §1.5 user-facing design.
- **RF-035** — "Mixed" state not surfaced on the hotspot itself, only inside the popover. Suggestion for next iteration. *Source: UX (UX-005).* **Status: wont-fix** — requires designer iteration; popover-internal "Mixed" badge is sufficient for v1 per Spec 14 §1.5.
- **RF-036** — Smoothing slider lacks tick marks / numeric badge / calibration labels. *Source: UX (UX-007).* **Status: wont-fix** — requires designer iteration; current slider + ValueInput pairing provides numeric feedback in v1.
- **RF-037** — Smoothing slider gesture test jsdom-limited; asserts only finite, not actual value. *Source: BE (Q14d-10).* **Status: wont-fix** — jsdom slider drag simulation is fundamentally limited; the current test asserts the gesture-end contract (the core history-coalescing invariant). A Playwright integration test is the right venue and is out of scope for this remediation.
- **RF-038** — `corner-section-pipeline.test.tsx` could exercise more node-kind paths. *Source: BE.* **Status: wont-fix** — the pipeline test verifies the full UI→store→re-render chain on a rectangle; the contract is identical for frame/image per the kind switch in DesignPanel and CornerSection. Per-kind dispatch is locked by CornerSection's own unit tests.

---

## Info / Pre-disclosed / Already-OK

- **A11Y-012** — Disabled-state placeholder accessibility correctly handled (`aria-hidden="true"` on decorative div).
- **A11Y-013** — `role="group"` on popover root could be redundant given the heading. **Status: optional follow-up** — RF-010 (Batch D, commit `6bf4442`) downgraded the popover header to `<h4>` but retained `role="group"` with `aria-label={popoverHeaderLabel(...)}` to keep the popover's accessible name announced as a discrete group regardless of heading-level perception. A future iteration may drop the role if user testing shows the heading alone is sufficient.
- **Performance (Data Scientist):** all allocations bounded; no concerns at the 60fps/1000-node ceiling. Panel-side renders are infrequent.
- **CSS animations** properly paired with `@media (prefers-reduced-motion: reduce)` in `CornerPreviewSvg.css`.
- **Kobalte discipline:** verified — no direct `@kobalte/core` imports outside `components/`.
- **Constant enforcement tests:** `test_min_superellipse_smoothing_enforced` and `test_max_superellipse_smoothing_enforced` present and correctly named.
- **Migration completeness:** `schema-panel-corners-handler.ts` deletion is clean; no dangling references.
- **Asymmetric-radii fixture present** for bevel/notch/scoop (RF-022 only catches the superellipse gap).

---

## Remediation Plan (proposed)

### Must resolve before merge (Critical + High):
1. **RF-005** — Extend Popover wrapper with `anchorRef` prop; wire CornerSection to pass clicked hotspot button. (Architectural; addresses RF-005 + RF-001 + RF-002 + RF-003 partially.)
2. **RF-001** — Drop `aria-hidden` from popover host; use `tabindex="-1"` on the trigger button itself (or `hideTrigger` mode added to wrapper).
3. **RF-002** — Store last activating button ref; restore focus on popover close.
4. **RF-003** — Always render a low-opacity affordance on hotspots; set `tabindex="-1"` on disabled hotspots OR keep them visibly disabled.
5. **RF-004** — Replace `title` with `aria-describedby` to sr-only `<span>` for the lock-state reason.
6. **RF-006** — Remove the `createEffect` that resets `unlocked`; rely on initial signal value + re-mount on popover close.
7. **RF-007** — Add `console.warn` diagnostics + aria-live status to radius/rx/ry/smoothing-from-ValueInput commit handlers.

### Must resolve in same PR (Major):
8. **RF-008** — Guard `commitSmoothing` against non-superellipse corners.
9. **RF-009** — Tolerance-based equality for smoothing comparison.
10. **RF-010** — Heading level adjustment (h2 → h3, h3 → h4).
11. **RF-011** — Wire `<label>` ↔ input via `id` + `aria-labelledby`; drop duplicate `aria-label`.
12. **RF-012** — Drop `aria-label` from Toggle wrapper div.
13. **RF-013** — Replace "Mixed" badge `role="status"` with `aria-describedby` wiring.
14. **RF-014** — Remove `role="status"` from disabled-state span.
15. **RF-015** — Add `ariaValueText` to smoothing Slider.
16. **RF-016** — Either wire `fillColor` from DesignPanel or delete the dead prop.
17. **RF-017** — Replace hardcoded `rgba()` colors with theme tokens.
18. **RF-018** — Mark over-exports as `@internal` or move to helpers file.

### Must resolve in same PR (Medium):
19. **RF-019** — Folds into RF-007 fix.
20. **RF-020** — Delete duplicate constant.
21. **RF-021** — Strengthen parity test with coordinate assertions.
22. **RF-022** — Add asymmetric superellipse parity fixture.
23. **RF-023** — Add `onCleanup` for `gestureSmoothing`.
24. **RF-025** — Extract `isHotspotDisabled` helper.
25. **RF-026** — Add multi-axis test fixture for commitRx/Ry.

### Defer / batch (Low):
26. **RF-024** — No history rewrite; note for next PR.
27-38 — Polish; resolve in a single low-priority commit.

The Popover-wrapper extension (RF-005) is the single biggest architectural lift. The a11y fixes (RF-001..RF-004, RF-010..RF-015) are individually small but additively substantial. The diagnostic/symmetry fixes (RF-007 + RF-019) are mechanical.
