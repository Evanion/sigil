# Color Picker Component (Plan 09b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained color picker component supporting solid colors in 4 color spaces (sRGB, Display P3, OkLCH, OkLab), gradient editing (linear + radial), and alpha — rendered as a Kobalte Popover anchored to a color swatch trigger.

**Architecture:** The color picker is split into: (1) a pure-logic color conversion module with no UI dependencies (sRGB to linear RGB to OkLab to OkLCH, hex parsing, gamut mapping), (2) low-level canvas-based interactive widgets (ColorArea, HueStrip, AlphaStrip), (3) a GradientEditor with draggable stops, and (4) the top-level ColorPicker popover that composes everything. Each layer is independently testable.

**Tech Stack:** Solid.js, Kobalte (Popover), HTML5 Canvas 2D (for picker area/strips), TypeScript

---

## Scope

**In scope:**
- color-math.ts: sRGB to/from OkLab, OkLCH, hex. Color type conversions. Gamut check.
- ColorArea: 2D canvas picker with pointer + keyboard, adapts to color space
- HueStrip: horizontal hue slider with canvas gradient
- AlphaStrip: horizontal alpha slider with checkerboard + gradient
- ColorSpaceSwitcher: segmented toggle (sRGB, P3, OkLCH, OkLab)
- ColorValueFields: numeric inputs adapting per space
- HexInput: hex text input with gamut warning badge
- GradientEditor: stop bar with drag/add/remove, linear/radial toggle, angle input
- ColorPicker: top-level Popover composing Solid tab with all widgets
- Storybook stories for ColorArea, HueStrip, AlphaStrip, and full ColorPicker

**Deferred to Plan 09c/09d:**
- Wiring into FillRow/StrokeRow/EffectCard
- Token binding toggle
- Gradient fill/stroke creation flow

---

## File Structure

All files in frontend/src/components/color-picker/:
- color-math.ts (pure conversions)
- __tests__/color-math.test.ts (unit tests)
- types.ts (shared types)
- ColorArea.tsx + ColorArea.css
- HueStrip.tsx
- AlphaStrip.tsx
- Strip.css (shared for hue + alpha)
- ColorSpaceSwitcher.tsx
- ColorValueFields.tsx
- HexInput.tsx
- GradientEditor.tsx + GradientEditor.css
- ColorPicker.tsx + ColorPicker.css
- ColorPicker.stories.tsx

---

## Task 1: Color conversion module (pure math, no UI)

Create color-math.ts with: clamp01, srgbToHex, hexToSrgb, srgbToOklab, oklabToSrgb, oklabToOklch, oklchToOklab, srgbToOklch, oklchToSrgb, colorToSrgb, srgbToColor, colorToHex, isOutOfSrgbGamut, colorAlpha, withAlpha.

Unit tests: hex round-trip, OkLab round-trip (white, red, black), OkLCH round-trip, Color type helpers.

Reference implementation: https://bottosson.github.io/posts/oklab/

---

## Task 2: Shared types + ColorArea widget

Create types.ts (ColorSpace, ColorPickerState). Create ColorArea.tsx: canvas-based 2D picker with pointer drag, pointer capture, keyboard arrows (1% step, Shift+Arrow 10%). CSS with cursor indicator, focus-visible, prefers-reduced-motion.

---

## Task 3: HueStrip + AlphaStrip widgets

HueStrip: canvas draws hue rainbow gradient, pointer drag, keyboard left/right (1 deg, Shift 10 deg). AlphaStrip: canvas draws checkerboard + color-to-transparent gradient, pointer drag, keyboard. Shared Strip.css for the thumb indicator.

---

## Task 4: ColorSpaceSwitcher + ColorValueFields + HexInput

ColorSpaceSwitcher: 4 radio buttons styled as segmented toggle. ColorValueFields: adapts labels/ranges per space (R/G/B/A for sRGB at 0-255, L/C/H/A for OkLCH). HexInput: text input with live preview swatch, gamut warning badge, Enter to commit, Escape to cancel.

---

## Task 5: GradientEditor

Stop bar with draggable handles (pointer capture). Click bar to add stop. Drag off bar to remove (min 2 stops). Keyboard: arrow keys reposition, Delete removes. Linear/Radial ToggleButton. Angle NumberInput (linear only). Selected stop index emitted to parent.

---

## Task 6: Top-level ColorPicker popover + stories

Composes all widgets inside Kobalte Popover. Internal state as sRGB + alpha + hue. Sync from props.color on mount. Emit Color on change. Storybook stories: ColorArea standalone, HueStrip standalone, AlphaStrip standalone, full ColorPicker with swatch trigger.

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Color math module (pure logic, unit tested) |
| 2 | ColorArea canvas widget |
| 3 | HueStrip + AlphaStrip canvas widgets |
| 4 | ColorSpaceSwitcher + ColorValueFields + HexInput |
| 5 | GradientEditor (stop bar, drag, angle) |
| 6 | ColorPicker popover + Storybook stories |
