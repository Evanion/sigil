# Spec 17 i18n migration inventory — Batch A (PR #66 remediation)

This document captures the 95 hardcoded English literal-string violations
revealed when the ESLint i18n rule was switched from `mode: "jsx-text-only"`
(which silently bypassed every JSX attribute literal — RF-001) to
`mode: "jsx-only"` with `should-validate-template: true` (RF-006).

It exists to support reviewers during Batch A; once the migration is
complete it may be deleted again (Task 12 deleted the original at the
end of the initial Spec 17 implementation).

## Routing

Each violation is routed to a translation namespace or marked as
decorative (kept inline with an `i18n-allow:` rationale comment).

### True i18n violations migrated to `t()`

| File | Lines | Namespace | Notes |
|---|---|---|---|
| `panels/AlignPanel.tsx` | 101,107-108,117-118,127-128,137-138,147-148,157-158,172-173,183-184 | `panels:align.*` | 9 aria-label + 8 title pairs + 1 toolbar |
| `panels/AppearancePanel.tsx` | 371,380,387,424,474 | `panels:typography.*`, `panels:regions.appearance`, `a11y:fills.itemLabel`, `a11y:strokes.itemLabel` | template literals → t() with interpolation |
| `panels/ComponentPanel.tsx` | 5 | `panels:tabs.component` | reuses existing key |
| `panels/DesignPanel.tsx` | 69 | `panels:regions.designPanelTabs` | reuses existing key |
| `panels/EffectCard.tsx` | 338,370,403,417,431,445,457 | `panels:effects.fields.*` | new sub-keys |
| `panels/EffectsPanel.tsx` | 149,178 | `panels:tabs.effects`, `a11y:effects.itemLabel` | template literal → t() with interpolation |
| `panels/FillRow.tsx` | 290,298,306 | `panels:fill.*` | new sub-keys (color, type, remove) |
| `panels/GradientControls.tsx` | 360,376 | `panels:gradient.controls`, `panels:gradient.selectedStop` | new sub-keys |
| `panels/InspectPanel.tsx` | 5 | `panels:tabs.inspect` | reuses existing key |
| `panels/SchemaSection.tsx` | 51 | `panels:tokens.expand`, `panels:tokens.collapse` | new sub-keys |
| `panels/StrokeRow.tsx` | 105,115 | `panels:stroke.color`, `panels:stroke.width` | new sub-keys |
| `panels/TokenDetailEditor.tsx` | 174,346,364,379,394,587 | `panels:tokens.*`, `panels:tokens.dimensionPlaceholder` | new sub-keys |
| `panels/TokenRow.tsx` | 314 | `a11y:tokens.valuePreview` | template literal → t() with interpolation |
| `panels/token-editor/TokenDetailPane.tsx` | 282 | `panels:tokens.clickToRename` | new sub-key |
| `panels/PlaceholderPanel.tsx` | 11 | `panels:placeholder.comingSoon` | new sub-key |
| `components/color-picker/ColorPicker.tsx` | 389,396,402,409 | `panels:colorPicker.*` | new sub-keys |
| `components/color-picker/ColorSpaceSwitcher.tsx` | 72 | `panels:colorPicker.colorSpace` | new sub-key |
| `components/color-picker/ColorValueFields.tsx` | 240 | `panels:colorPicker.colorChannelValues` | new sub-key |
| `components/color-picker/GradientEditor.tsx` | 271,312,330,364 | `panels:gradient.*`, `a11y:gradient.stopAtPercent` | template literal → t() with interpolation |
| `components/color-picker/HexInput.tsx` | 104 | `panels:colorPicker.hexColor` | new sub-key |
| `components/dialog/Dialog.tsx` | 106 | `common:close` | reuses existing key |
| `components/gradient-editor/GradientStopEditor.tsx` | 206,234 | `panels:gradient.stops`, `panels:gradient.colorStop` | new sub-keys |
| `components/number-input/NumberInput.tsx` | 78,81 | `common:increment`, `common:decrement` | new sub-keys |
| `components/toast/Toast.tsx` | 27,37 | `common:close`, `common:notifications` | new sub-keys |
| `components/value-input/ValueInput.tsx` | 877-882,920,1016 | `panels:valueInput.*` | new sub-keys |

### Decorative — keep inline with `i18n-allow:` rationale

| File | Lines | Reason |
|---|---|---|
| `panels/FillRow.tsx` | 309 | `×` Unicode multiplication sign close glyph (aria-label provides name) |
| `panels/SchemaSection.tsx` | 55 | `▸` / `▾` chevron glyph (aria-label provides name) |
| `panels/TokensPanel.tsx` | 389 | `▶` / `▼` chevron glyph (aria-label provides name) |
| `panels/TreeNode.tsx` | 161 | `▾` / `▸` chevron glyph (aria-label provides name) |
| `panels/TreeNode.tsx` | 204 | `🔒` / `🔓` emoji (button text; parent aria-label provides name) |
| `panels/TreeNode.tsx` | 215 | `👁` / `👁‍🗨` emoji (button text; parent aria-label provides name) |

### False positives — `var(--*)` CSS values and CSS class names

| File | Lines | Reason |
|---|---|---|
| `panels/token-editor/TokenColorGrid.tsx` | 41,45 | `var(--surface-3)` CSS value, not user-facing |
| `components/gradient-editor/GradientStopEditor.tsx` | 219-221 | `sigil-gradient-stop-editor__*` CSS class names |
| `panels/token-editor/TokenTypographyList.tsx` | 68 | CSS `font-family` style property value |
| `panels/token-editor/TokenTypographyList.tsx` | 79 | Typography preview text (decorative; not in JSX attribute) |
| `shell/Toolbar.tsx` | 157 | `${t(...)} (${shortcut})` composes already-translated text with keyboard shortcut |

These are suppressed with `// eslint-disable-next-line i18next/no-literal-string -- i18n-allow: <rationale>` line comments.

### Deferred to Batch B (RF-008)

| File | Lines | Item |
|---|---|---|
| `panels/corner-section/CornerPopover.tsx` | 62-73,86-110,629,637,657,673 | `popoverHeaderLabel()` helper + `CORNER_SHAPE_OPTIONS` const arrays |

These are architectural refactors per RF-008 and addressed in Batch B,
not Batch A.
