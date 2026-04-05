# Review Findings: PR #30 — Properties Panel UI (Plan 09c)

**Date:** 2026-04-06
**PR:** #30 — feat: properties panel UI — sub-tabs, fills, strokes, effects
**Reviewers:** Architect, Security, BE, Logic, Compliance, Data Science, FE, A11y, UX (9 agents)
**Total findings:** 31 (2 Critical, 1 High, 14 Major, 4 Medium, 7 Minor, 3 Low)

---

## Critical

### RF-001 — Popover `as="span"` violates CLAUDE.md §5
- **Source:** Architect, BE, FE, Security, A11y, UX
- **File:** `frontend/src/components/popover/Popover.tsx:37`
- **Issue:** `KobaltePopover.Trigger as="span"` overrides the trigger with a non-interactive element, removing keyboard focus, Enter/Space activation, and ARIA semantics. Every ColorSwatch inherits this regression.
- **Fix:** Remove `as="span"`. Restructure so the swatch button IS the trigger (use Kobalte's default `<button>` rendering or the `asChild` pattern).
- **Status:** `resolved`

### RF-002 — `setFills` rollback removed (CLAUDE.md §11)
- **Source:** All 9 agents
- **File:** `frontend/src/store/document-store-solid.tsx` (setFills function)
- **Issue:** Debounce refactor deleted all rollback-on-error logic. On mutation failure, local store permanently diverges from server. `setStrokes`/`setEffects` retain rollback.
- **Fix:** Restore rollback. Capture pre-mutation snapshot before optimistic update. On error, revert to snapshot.
- **Status:** `resolved`

---

## High

### RF-003 — JSON.parse without try-catch in mutation handlers
- **Source:** Security
- **File:** `frontend/src/store/document-store-solid.tsx` (multiple functions)
- **Issue:** Multiple `JSON.parse(JSON.stringify(...))` clone calls are unwrapped. Non-JSON-serializable values crash the mutation handler mid-operation.
- **Fix:** Wrap each JSON.parse(JSON.stringify()) in try-catch, or revert to structuredClone where possible.
- **Status:** `resolved`

---

## Major

### RF-004 — `<For>` vs `<Index>` inconsistency for strokes/effects
- **Source:** BE, FE, Logic, Architect, UX
- **File:** `frontend/src/panels/AppearancePanel.tsx`, `frontend/src/panels/EffectsPanel.tsx`
- **Issue:** Fills use `<Index>` (stable DOM on reorder), strokes use `<For>` (recreates DOM). Focus behavior after Alt+Arrow reorder differs. Effects also uses `<For>`.
- **Fix:** Use `<Index>` for all three lists.
- **Status:** `resolved`

### RF-005 — HSV conversion duplicated 3x in ColorPicker
- **Source:** Architect, FE, DataSci
- **File:** `frontend/src/components/color-picker/ColorPicker.tsx`
- **Issue:** HSV↔RGB switch logic copy-pasted in handleAreaChange, handleHueChange, renderAreaBackground. Bug in one copy won't propagate.
- **Fix:** Extract `hsvToRgb()` and `rgbToHsv()` into `color-math.ts`.
- **Status:** `resolved`

### RF-006 — structuredClone → JSON.parse blanket regression
- **Source:** BE, Architect, DataSci
- **File:** `frontend/src/store/document-store-solid.tsx`
- **Issue:** All structuredClone() replaced with JSON.parse(JSON.stringify()) which is slower, drops undefined, converts NaN→null. Replacement was due to Solid store proxy incompatibility but is too broad.
- **Fix:** Document the Solid proxy issue. Use structuredClone where the source is NOT a Solid proxy. Keep JSON workaround only in produce() callbacks. Add comments.
- **Status:** `resolved`

### RF-007 — Debounce timer not cleared on destroy()
- **Source:** Logic
- **File:** `frontend/src/store/document-store-solid.tsx`
- **Issue:** `fillsMutationTimer` is module-level setTimeout. If store is destroyed, timer fires on stale URQL client.
- **Fix:** Clear the timer in the `destroy()` function.
- **Status:** `resolved`

### RF-008 — Missing aria-labels on fill/stroke group wrappers
- **Source:** A11y, FE
- **File:** `frontend/src/panels/AppearancePanel.tsx`
- **Issue:** Fill/stroke `<div role="group">` wrappers have no aria-label. Screen readers announce "group" with no identification.
- **Fix:** Add `aria-label={`Fill ${index + 1}`}` and `aria-label={`Stroke ${index + 1}`}`.
- **Status:** `resolved`

### RF-009 — Effects card wrapper not keyboard-focusable
- **Source:** A11y
- **File:** `frontend/src/panels/EffectsPanel.tsx`
- **Issue:** Effect card wrapper has no tabIndex, role, or aria-label. Alt+Arrow and Delete handlers unreachable via keyboard.
- **Fix:** Add `tabIndex={0}`, `role="group"`, and `aria-label` to effect card wrapper.
- **Status:** `resolved`

### RF-010 — TextInput focus-visible outline removed
- **Source:** A11y
- **File:** `frontend/src/components/text-input/TextInput.css`
- **Issue:** Changed to outline:none with only border-color change on :focus-within. May not meet WCAG 2.4.7.
- **Fix:** Add focus-visible style to group wrapper or verify contrast meets WCAG requirements.
- **Status:** `resolved`

### RF-011 — ColorArea: single slider for 2D widget (pre-existing)
- **Source:** A11y
- **File:** `frontend/src/components/color-picker/ColorArea.tsx`
- **Issue:** CLAUDE.md §11 requires two ARIA widgets for 2-axis controls. Currently one role="slider" with aria-valuenow for X only.
- **Fix:** Expose two complementary slider elements (saturation + brightness).
- **Status:** `deferred` — pre-existing, defer to a11y follow-up PR (TODO added)

### RF-012 — Unvalidated type casts (blend mode, effect type)
- **Source:** Security
- **File:** `frontend/src/panels/AppearancePanel.tsx`, `frontend/src/panels/EffectCard.tsx`
- **Issue:** Raw strings cast to BlendMode/EffectType without validation against allowed values.
- **Fix:** Validate against known values array before casting.
- **Status:** `resolved`

### RF-013 — Missing MAX_* enforcement tests
- **Source:** Security
- **File:** `frontend/src/panels/__tests__/AppearancePanel.test.tsx`, `EffectsPanel.test.tsx`
- **Issue:** CLAUDE.md §11 requires every MAX_* constant to have enforcement tests. MAX_FILLS, MAX_STROKES, MAX_EFFECTS have none.
- **Fix:** Add tests that verify add is no-op at max capacity.
- **Status:** `resolved`

### RF-014 — EffectCard offset floats unguarded
- **Source:** Security
- **File:** `frontend/src/panels/EffectCard.tsx`
- **Issue:** offset.x and offset.y accessed without Number.isFinite() guard, unlike blurVal/spreadVal.
- **Fix:** Add Number.isFinite() guard in offset memos.
- **Status:** `resolved`

### RF-015 — Shadow fields lack visible prefix labels
- **Source:** UX
- **File:** `frontend/src/panels/EffectCard.tsx`
- **Issue:** Four NumberInputs for X/Y/blur/spread have aria-label but no visible prefix. Users must guess.
- **Fix:** Add prefix="X", prefix="Y", prefix="B", prefix="S" to shadow NumberInputs.
- **Status:** `resolved`

### RF-016 — 3-tab split departs from Figma/Penpot convention
- **Source:** UX
- **File:** `frontend/src/panels/DesignPanel.tsx`
- **Issue:** Figma/Penpot show all properties in a single scrollable panel. Layout/Appearance/Effects split adds friction.
- **Fix:** Consider collapsible sections in a single scroll. May defer as intentional product decision.
- **Status:** `wont-fix` — user's intentional design choice (chose option B during brainstorming)

### RF-017 — Stroke alignment is read-only
- **Source:** UX
- **File:** `frontend/src/panels/StrokeRow.tsx`
- **Issue:** Alignment rendered as <span>, not interactive Select. No way to change Inside/Center/Outside.
- **Fix:** Replace span with compact Select component.
- **Status:** `resolved`

---

## Medium

### RF-018 — Per-fill opacity control missing
- **Source:** UX
- **File:** `frontend/src/panels/FillRow.tsx`
- **Issue:** Figma/Penpot have per-fill opacity inline. Currently requires opening color picker to adjust alpha.
- **Fix:** Add compact opacity NumberInput to FillRow. Can defer to follow-up.
- **Status:** `deferred` — follow-up PR for per-fill opacity

### RF-019 — handleHexChange stale 5th argument
- **Source:** BE, Logic, FE, Security, DataSci, Architect
- **File:** `frontend/src/components/color-picker/ColorPicker.tsx:363`
- **Issue:** Calls emit(r,g,b,alpha,space) but emit takes 4 params. Extra arg silently ignored.
- **Fix:** Remove 5th argument: `emit(r, g, b, state.alpha)`.
- **Status:** `resolved`

### RF-020 — `mounted` guard timing assumption undocumented
- **Source:** FE
- **File:** `frontend/src/components/color-picker/ColorPicker.tsx`
- **Issue:** Uses queueMicrotask to suppress initial emit. Pattern works but is fragile and undocumented.
- **Fix:** Add comment explaining timing assumption, or use untrack() as idiomatic alternative.
- **Status:** `resolved`

### RF-021 — setStrokes/setEffects not debounced
- **Source:** BE
- **File:** `frontend/src/store/document-store-solid.tsx`
- **Issue:** Only setFills debounces. During stroke color drag, setStrokes fires every rAF tick.
- **Fix:** Apply same debounce pattern to setStrokes and setEffects, or document why only fills.
- **Status:** `resolved`

---

## Minor

### RF-022 — Default new fill is white (invisible on canvas)
- **Source:** UX
- **File:** `frontend/src/panels/AppearancePanel.tsx`
- **Fix:** Change to visible default like {r:0.85, g:0.85, b:0.85, a:1}.
- **Status:** `resolved`

### RF-023 — Shared tabpanel ID for all 3 tabs
- **Source:** FE, A11y
- **File:** `frontend/src/panels/DesignPanel.tsx`
- **Fix:** Use per-tab tabpanel IDs. Can defer.
- **Status:** `resolved`

### RF-024 — createMockStore duplicated in 6 files
- **Source:** Architect
- **File:** Multiple test/story files
- **Fix:** Extract to `frontend/src/test-utils/mock-store.ts`.
- **Status:** `deferred` — mechanical refactor, defer to follow-up

### RF-025 — Shallow copy of DEFAULT_EFFECT/FILL/STROKE
- **Source:** BE
- **File:** `frontend/src/panels/AppearancePanel.tsx`, `frontend/src/panels/EffectsPanel.tsx`
- **Fix:** Use deep clone (JSON.parse(JSON.stringify()) or structuredClone) instead of spread.
- **Status:** `resolved`

### RF-026 — Drag handle is Unicode, not proper icon
- **Source:** UX
- **File:** `frontend/src/panels/FillRow.tsx`, `frontend/src/panels/StrokeRow.tsx`
- **Fix:** Replace with GripVertical from lucide-solid.
- **Status:** `resolved`

### RF-027 — No visibility toggle for individual effects
- **Source:** UX
- **File:** `frontend/src/panels/EffectCard.tsx`
- **Fix:** Requires `visible` field on Effect type (core change). Defer to follow-up.
- **Status:** `deferred` — requires core crate Effect.visible field

### RF-028 — No scroll-into-view / focus after add
- **Source:** UX
- **File:** `frontend/src/panels/AppearancePanel.tsx`, `frontend/src/panels/EffectsPanel.tsx`
- **Fix:** Scroll to and focus new item after add. Can defer.
- **Status:** `resolved`

---

## Low

### RF-029 — ColorSwatch CSS color defense-in-depth
- **Source:** Security
- **File:** `frontend/src/components/color-picker/ColorSwatch.tsx`
- **Fix:** Add Number.isFinite() check on r/g/b/a before hex conversion. Low risk since clamp01 handles NaN.
- **Status:** `resolved`

### RF-030 — preventDismissOnInteract blocks all outside clicks
- **Source:** Logic
- **File:** `frontend/src/components/popover/Popover.tsx`
- **Fix:** Consider more targeted approach (only during canvas pointer capture). Can defer.
- **Status:** `deferred` — current behavior intentional for color picker

### RF-031 — Test event bubbling fragility
- **Source:** Logic
- **File:** `frontend/src/panels/__tests__/AppearancePanel.test.tsx`
- **Fix:** Fire events on the wrapper element, not inner row. Low risk.
- **Status:** `deferred` — low risk, tests work via event bubbling
