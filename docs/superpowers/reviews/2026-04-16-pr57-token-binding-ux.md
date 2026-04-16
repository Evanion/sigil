# PR #57 Review — Token Binding UX (Spec 13c)

**Date:** 2026-04-16
**PR:** https://github.com/Evanion/sigil/pull/57
**Branch:** `feature/token-binding`
**Reviewers:** Architect, Security, Backend Engineer, Logic, Compliance, Data Scientist, Frontend Engineer, Accessibility Reviewer, UX Reviewer

## Summary

9 specialized agents ran in parallel. Findings deduplicated and grouped below by severity. **3 Critical** issues block merge; all involve cross-stack parity (TS/Rust, renderer, drag-coalescing) that the PR description claims to ship but does not actually wire end-to-end.

---

## Critical

### RF-001 — Rust `StyleValue<T>` lacks `Expression` variant

**Source:** Architect, Backend Engineer, Compliance, Data Scientist
**Status:** open

Frontend adds `StyleValueExpression { type: "expression"; expr: string }` to `StyleValue<T>` in `frontend/src/types/document.ts:67-72`. Rust `crates/core/src/node.rs:468-475` retains only `Literal` and `TokenRef`. Every expression-typed mutation (opacity, fills, strokes, effects, text_style fields, stroke width) will fail server-side deserialization at `crates/server/src/graphql/mutation.rs:297` with `serde_json::from_value::<StyleValue<f64>>`. MCP (`crates/mcp/src/types.rs:449`) also lacks the variant; agents cannot bind expressions at all.

**Fix:** Add `Expression { expr: String }` to Rust `StyleValue<T>` with `MAX_EXPRESSION_LENGTH` validation on deserialize. Update every `match StyleValue` in `crates/core/` exhaustively. Add `StyleValueInput::Expression` to MCP types with parser validation via `TokenExpression::parse`. Add cross-language parity fixtures in `tests/fixtures/parity/style_value_encoding.json`. Update `frontend/src/operations/apply-remote.ts` for the new variant with shape validation.

### RF-002 — Canvas renderer silently discards expressions

**Source:** Architect, Data Scientist
**Status:** open

`frontend/src/store/token-store.ts:133-157` — both `resolveStyleValueColor` and `resolveStyleValueNumber` return `fallback` for the `expression` variant with a deferral comment. Plan Task 2 Step 5 explicitly required wiring `evaluateExpression()` from `expression-eval.ts`. Users see the expression echoed in the ValueInput (status area shows resolved value) but the canvas renders the default color/number.

**Fix:** Wire `parseExpression` + `evaluateExpression` into both resolve functions, with `Number.isFinite` guard and range clamping for the result. Fall back only on parse/eval error. Add integration test: expression-bound opacity renders the computed alpha.

### RF-003 — `onColorCommit` fires on every drag tick, flooding undo stack

**Source:** Logic, Frontend Engineer, Data Scientist
**Status:** open

`frontend/src/components/color-picker/ColorPicker.tsx:141-147` — `createEffect(() => { const _color = props.color; commitColor(); })` tracks both `props.color` changes AND internal state signals `state.r/g/b/alpha` via `commitColor()`. During a drag: emit → parent updates store → `props.color` changes → effect re-runs → `onColorCommit` fires → `handleColorPickerCommit` → `props.onCommit(hex)` → `flushHistory()` per tick. Breaks the PR's own stated undo coalescing guarantee.

**Fix:** Split `commitColor` into two functions: `announceCommit` (SR-only signal updates) and `commitColor` (announce + fire `onColorCommit`). Call `announceCommit` from the prop-sync effect; call `commitColor` only from user-event pointerup handlers in ColorArea/HueStrip/AlphaStrip. Add a regression test: simulate 10 onColorChange events; assert `onColorCommit` fires 0 times without pointerup.

---

## High

### RF-004 — Panel commit handlers double-dispatch mutations

**Source:** Logic
**Status:** open

In FillRow, StrokeRow, EffectCard, TypographySection — `handle*Commit(raw)` calls `handle*Change(raw)` AND `props.onCommit?.()`. Since `onChange` already fires before `onCommit`, the mutation applies twice per commit event. Double GraphQL mutations.

**Fix:** `handle*Commit` should only trigger gesture-boundary behavior (flushHistory), not re-invoke the change handler.

### RF-005 — Line-height and letter-spacing lost min validation

**Source:** Git History, Logic
**Status:** open

`frontend/src/panels/TypographySection.tsx:298-305, 312-318` — the old NumberInput had `min={0.1}`. Replacement ValueInput only checks `Number.isFinite`. Server enforces `> 0` in `crates/core/src/validate.rs:476` and will reject, but frontend has no user feedback.

**Fix:** Add `MIN_LINE_HEIGHT` constant matching Rust value; reject and show status message.

### RF-006 — Color picker drops alpha on commit

**Source:** Logic, UX
**Status:** open

`frontend/src/components/value-input/color-parse.ts:163-192` — `colorToHex` emits only 6-char `#rrggbb`. `handleColorPickerChange` round-trips color through hex, losing alpha. Users dragging alpha slider in ColorPicker get `#000000` stored (alpha=1) regardless.

**Fix:** Extend `colorToHex` to emit `#rrggbbaa` when `alpha < 1`. `parseHexColor` already supports 8-char input. Update `isHexColorString` and related validators.

### RF-007 — Font family token refs silently rejected

**Source:** A11y, UX, Compliance
**Status:** open

`frontend/src/panels/TypographySection.tsx:252` — `validateCssIdentifier("{brand.primary}")` returns false; handler silently returns. No toast, no error message. The `tokens={{}}` suppresses autocomplete but user can still type `{...}` manually, and the font autocomplete dropdown doesn't distinguish tokens vs system fonts.

**Fix:** Show info message when `{` is typed ("Font family token binding not yet supported — requires data model update"). Filed as TODO in the same file.

### RF-008 — aria-live region announces on every keystroke

**Source:** A11y
**Status:** open

`frontend/src/components/value-input/ValueInput.tsx:925-940` — `<span role="status" aria-live="polite">` switches between `"${suggestions().length} suggestions available"`, `"No suggestions"`, and `committedStatus()`. First two branches update reactively on every keystroke via `autocompleteQuery()`. Violates "aria-live Regions Must Be Scoped to Discrete Status Changes." Makes typing unusable for SR users.

**Fix:** Remove the suggestion count from aria-live. Rely on `aria-expanded` + `aria-activedescendant` (already set) for listbox state. Announce count only on open/close transition, debounced.

### RF-009 — No `ValueInput.test.tsx`

**Source:** Frontend Engineer
**Status:** open

The 1006-line component has no direct test file. Only extracted helpers are tested. Behaviors untested: cursor preservation, auto-pairing, Enter/Escape/Tab flow, color-picker commit path, external value sync, paste truncation, onCommit drag contract.

**Fix:** Add `frontend/src/components/value-input/ValueInput.test.tsx` with one test per RF-xxx requirement already in comments.

### RF-010 — ValueInput file size (1006 lines)

**Source:** Frontend Engineer
**Status:** open

Component conflates 6 responsibilities. Extract: `useAutocomplete` composable, `<SwatchPopover>` component, `<HighlightedEditor>` component. Target ~300 lines for ValueInput itself.

### RF-011 — Behavioral inventory missing for EnhancedTokenInput rewrite

**Source:** Compliance
**Status:** open

PR deletes 633 lines of `EnhancedTokenInput.tsx` without the inventory required by CLAUDE.md §11 "Behavioral Inventory Before Deleting Implementation Code". Plan claims "pure rename/move — no behavioral changes" but the resulting ValueInput is 1006 lines with new features.

**Fix:** Add inventory section to the spec enumerating outgoing behaviors (keyboard state machine, autocomplete state, cursor preservation, CSS class logic) with preserved/moved/removed status.

### RF-012 — Accessibility audit missing for rewrite

**Source:** Accessibility Reviewer, Compliance
**Status:** open

a11y-rules.md requires enumeration of aria-live regions, focus management, keyboard handlers from the outgoing component. Neither spec nor plan contains this audit. The aria-live regression (RF-008) slipped through because of this gap.

**Fix:** Add A11y Audit section to the spec per the rule.

### RF-013 — Shadow X/Y/Blur/Spread lost visible prefix labels

**Source:** UX, Prior PR Comments
**Status:** open

`frontend/src/panels/EffectCard.tsx` lines 345-405 — ValueInput replaces NumberInput which had `prefix="X"/"Y"/"B"/"S"` (added in PR #30 RF-015). Now four identical-looking fields with only `aria-label`. Sighted users cannot distinguish them.

**Fix:** Add `prefix` prop to ValueInput, OR render `<span aria-hidden="true">` prefix in the grid cell.

### RF-014 — `parseNumberInput` silently strips unit suffixes

**Source:** Logic, UX
**Status:** open

`frontend/src/components/value-input/style-value-format.ts:182` — regex `/^-?(\d+\.?\d*|\.\d+)/` is start-anchored but not end-anchored. `parseNumberInput("16px")` returns `{literal, 16}` silently dropping the unit. Same for `parseTokenValueChange` number path.

**Fix:** Anchor regex at both ends. Reject inputs with unit suffix for `acceptedTypes: ["number"]` only. For `["number", "dimension"]`, preserve the unit via expression variant or typed error.

### RF-015 — EffectCard offset X/Y silently drop non-literal input

**Source:** Frontend Engineer, UX
**Status:** open

`frontend/src/panels/EffectCard.tsx:199-220` — handlers have `if (parsed.type !== "literal") return;` because `Point` type is plain numbers. No user feedback. Documented in TODO but silent-reject is confusing.

**Fix:** Show info message in ValueInput status: "Token bindings not yet supported for offsets (requires Point → StyleValue promotion)".

### RF-016 — StrokeRow negative width silently dropped

**Source:** Frontend Engineer, Compliance
**Status:** open

`frontend/src/panels/StrokeRow.tsx:77` — `if (parsed.value < 0) return;` silently without feedback. Violates "No Silent Clamping of Invalid Input".

**Fix:** Show info message "Stroke width must be ≥ 0".

---

## Major

### RF-017 — apply-remote.ts not updated for expression variant

**Source:** Prior PR Comments
**Status:** open

`frontend/src/operations/apply-remote.ts` blind-casts `value as StyleValue<number>` at line 244. Plan listed this file as changed. Not in the diff. Missing shape validation for incoming StyleValue payloads — malformed remote broadcast `{"type":"expression", "expr": null}` corrupts the store.

**Fix:** Add explicit variant dispatch and shape validation. Run `parseXxxInput` guards on incoming remote values.

### RF-018 — Swatch `aria-haspopup="dialog"` without matching role

**Source:** Accessibility Reviewer
**Status:** open

`ValueInput.tsx:843-862` swatch declares `aria-haspopup="dialog"`; target `<div popover="auto">` at line 868 has no `role="dialog"`, no `aria-label`, no focus move on open, no focus trap. Users expect dialog semantics; get native popover that doesn't trap.

**Fix:** Either tighten contract (add role="dialog" + aria-label + focus move) or relax (`aria-haspopup="true"`).

### RF-019 — No focus return after popover dismiss

**Source:** Accessibility Reviewer
**Status:** open

`ValueInput.tsx:547-559` — `handlePopoverToggle` doesn't call `swatchRef.focus()` on close. Escape/click-outside loses focus entirely.

**Fix:** Add `swatchRef` and focus it in the close branch.

### RF-020 — NumberInput spinbutton semantics lost

**Source:** Accessibility Reviewer
**Status:** open

ValueInput combobox lacks `aria-valuenow`/`min`/`max`, arrow-key increment. For literal-number mode in numeric fields this is a regression.

**Fix:** When `detectedMode === "literal-number"` and `acceptedTypes` includes only `"number"` or `"dimension"`, expose `aria-valuemin/max/now` and support ArrowUp/Down increment.

### RF-021 — `resolveTokenTypeFilter` collapses multi-type acceptedTypes

**Source:** Architect
**Status:** open

`ValueInput.tsx:113-141` — `resolveTokenTypeFilter` returns first matching TokenType. For `acceptedTypes: ["number", "dimension"]`, returns only `"number"`. `filterTokenSuggestions` filters by single TokenType. Dimension tokens never appear in autocomplete for numeric fields.

**Fix:** Change `filterTokenSuggestions` to accept `readonly TokenType[]`. Update `resolveTokenTypeFilter` to return full accepted set.

### RF-022 — Frontend store missing MAX_EXPRESSION_LENGTH validation

**Source:** Architect, Data Scientist
**Status:** open

`frontend/src/store/document-store-solid.tsx:993-1014` — `setOpacity` only validates literal range. Expression length unbounded at transport boundary.

**Fix:** Add `if (opacity.type === "expression" && opacity.expr.length > MAX_EXPRESSION_LENGTH) return;` guard. Apply to all StyleValue setters.

### RF-023 — Hardcoded CSS fallback colors

**Source:** Frontend Engineer
**Status:** open

`ValueInput.css:50, 54, 59, 63, 82, 89-92` — `#3b82f6`, `#8b5cf6`, `#444`, `#808080` hardcoded as CSS variable fallbacks.

**Fix:** Add tokens to `theme.css` (--accent-border, --expression-border, --border-muted, --checkerboard-color) and remove fallback literals.

### RF-024 — Opacity validation asymmetric across transports

**Source:** Architect, Frontend Engineer
**Status:** open

`setOpacity` validates literal range only. Expression/token_ref forwarded unchecked. Server likewise validates only literals. Expressions evaluating outside [0,1] will be rendered clamped or NaN.

**Fix:** Define opacity binding contract: expressions/token-refs resolve to 0..=1 at render time with clamping + diagnostic log.

### RF-025 — Escape handler doesn't reset liveText

**Source:** Frontend Engineer
**Status:** open

`ValueInput.tsx:668-674` — Escape branch calls `renderHighlighted(revertTo, false)` but doesn't `setLiveText(revertTo)`. Downstream memos (detectedMode, swatchColor, evalResult) stay stale until next keystroke.

**Fix:** Add `setLiveText(revertTo)` to Escape handler.

### RF-026 — MAX_FONT_SIZE mismatch (frontend 1000 vs Rust 10000)

**Source:** Logic
**Status:** open

`TypographySection.tsx:58` uses 1000; `crates/core/src/validate.rs:131` allows 10000.

**Fix:** Align frontend constant to 10000 or add shared source.

### RF-027 — handleInput doesn't propagate typing via onChange

**Source:** Frontend Engineer
**Status:** open

`ValueInput.tsx:563-581` — `handleInput` updates internal liveText only. Typing hex character-by-character doesn't live-preview on canvas (only commits on blur/Enter). Contradicts docstring promising intermediate updates.

**Fix:** Call `props.onChange(text)` in handleInput after MAX_EXPRESSION_LENGTH guard.

### RF-028 — handlePaste mutates DOM without state sync

**Source:** Frontend Engineer
**Status:** open

`ValueInput.tsx:700-717` — `insertPlainTextAtCursor` doesn't dispatch input event. After paste: liveText stale, no highlight, no autocomplete, no validation.

**Fix:** Call `handleInput()` after `insertPlainTextAtCursor`.

### RF-029 — Empty token-ref name accepted

**Source:** Logic
**Status:** open

`style-value-format.ts:21-33` — `extractTokenRefName("{}")` returns `""` not `null`. Invalid persistent state: `{type: "token_ref", name: ""}` stored.

**Fix:** Return null when inner content is empty after trim. Use shared `validateTokenName` helper.

### RF-030 — TokenDetailEditor typography font_family bypasses validateCssIdentifier

**Source:** Security Reviewer
**Status:** open

`TokenDetailEditor.tsx:398-413` — plain `<input>` writes font_family directly with no validation.

**Fix:** Add `validateCssIdentifier` gate on onChange. Show toast on failure.

### RF-031 — parseTokenValueChange font_family skips CSS validation

**Source:** Security Reviewer
**Status:** open

`frontend/src/panels/token-detail-helpers.ts:231-238` — splits on comma and stores family list without per-entry CSS validation. Output-boundary defenses exist but input-boundary is required per rule.

**Fix:** Apply `validateCssIdentifier` to each family; return null if any fail.

### RF-032 — Default placeholder too long for narrow panels

**Source:** UX
**Status:** open

`ValueInput.tsx:105` — `"Type { for tokens, or an expression"` (~37 chars) truncates in inspector panels (~240-280px wide).

**Fix:** Per-field short placeholders: `"#rrggbb or {token}"`, `"16 or {token}"`, `"0–100"`.

### RF-033 — Positional index as item identity in Fill/Stroke reorder

**Source:** Compliance
**Status:** open

`AppearancePanel.tsx:220-254` — Alt+Arrow reorder uses `index: number` to identify items. Concurrent remote ops could reorder between keydown and mutation.

**Fix:** Add stable `id` fields to `Fill` and `Stroke` types (long-term, requires Rust-side change).

---

## Medium/Low (deferred to follow-ups unless deemed blocking)

- **RF-034** — CSS class names still use `sigil-token-input` prefix (Compliance M1)
- **RF-035** — `font_family` typography sub-editor uses ColorSwatch (UX Finding 14)
- **RF-036** — `{` auto-pair doesn't sync liveText (Frontend Engineer M4)
- **RF-037** — JSON.parse(JSON.stringify) without required comment in AppearancePanel (Frontend Engineer M1)
- **RF-038** — Enter on empty autocomplete does nothing (Frontend Engineer M6)
- **RF-039** — Font autocomplete lacks recent-fonts ranking (UX Finding 16)
- **RF-040** — No aria-invalid on parse failure (UX Finding 17)

---

## Remediation Strategy

**Phase 3 Priority Order:**

1. **RF-001** (Critical) — decision required: (a) add Rust Expression variant end-to-end, or (b) revert TS variant until core lands. If (a): requires touching crates/core, crates/mcp, crates/server, parity tests, and frontend wiring.
2. **RF-002** (Critical) — wire evaluator into renderer once RF-001 decision is made.
3. **RF-003** (Critical) — fix ColorPicker reactive loop; add regression test.
4. **RF-004** (High) — remove double-dispatch in panel commit handlers.
5. **RF-005–RF-016** (High) — address in parallel where independent.
6. **RF-017–RF-033** (Major) — after Critical/High resolved.
7. Medium/Low deferred if out of scope; mark wont-fix with rationale.

**Scope Decision Needed:** RF-001 changes the PR scope materially (adds Rust work). Propose to user: either (a) expand PR to include Rust StyleValue::Expression or (b) feature-flag expression mode in ValueInput until a follow-up PR lands Rust support.
