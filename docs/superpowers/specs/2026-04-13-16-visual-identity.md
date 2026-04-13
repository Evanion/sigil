# Spec 16: Visual Identity & Design Language

## Overview

Sigil's current UI is functional but visually generic — default Kobalte component styling on a dark background with Inter font and flat opaque surfaces. This spec defines a distinctive visual identity that makes Sigil recognizable as its own product rather than a generic Figma clone.

The design language is built on three pillars:
1. **Docked glass panels** — semi-transparent surfaces with backdrop-blur over the canvas
2. **Luminescent accents** — glow effects and gradient borders that add subtle "magic" to interactions
3. **Restraint** — effects are earned by importance, not applied everywhere

## Design Direction: Hybrid Glass + Magic Accents

Panels remain docked in the existing grid layout (no lost screen space) but use `backdrop-filter: blur()` with semi-transparent backgrounds so the canvas shows through subtly. Gradient borders and glow effects add atmosphere at panel boundaries and interactive moments, creating a feel that is modern and clean while carrying a distinct identity.

---

## Typography

### Font Family: Geist (OFL 1.1)

Sigil uses the Geist font family exclusively. Geist provides Sans, Mono, and Pixel variants designed to work together. All variants are licensed under the SIL Open Font License 1.1, which permits bundling in desktop applications and commercial products.

Inter is removed as the primary font. It remains in the CSS fallback stack only.

| Context | Variant | Weight | Size |
|---------|---------|--------|------|
| Panel headers, section labels | Geist Sans | 500 (Medium) | 11px |
| Layer names, menu items, body text | Geist Sans | 400 (Regular) | 12px |
| Property labels (X, Y, W, H) | Geist Sans | 400 | 10px |
| Numeric values, coordinates | Geist Mono | 400 | 11px |
| Hex color codes | Geist Mono | 400 | 11px |
| Status bar | Geist Mono | 400 | 10px |
| Brand accents (splash, empty states) | Geist Pixel | — | Decorative only |

### OpenType Features

Enable per-context for precision:

| Feature | Code | Where | Purpose |
|---------|------|-------|---------|
| Tabular numbers | `tnum` | All Mono contexts | Fixed-width digits align in property columns |
| Slashed zero | `zero` | Hex codes, coordinates | Distinguish 0 from O |
| Case-sensitive forms | `case` | Uppercase labels | Adjusts punctuation height for all-caps text |
| Ligatures | `liga` | Token expressions (future) | `->`, `=>`, `!=` rendering |

### Font Loading

Geist must be bundled with the application (Tauri) and served as WOFF2 (web/Docker). Do not rely on system font availability. The CSS fallback stack is:

```css
--font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'Geist Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
```

---

## Color Palette

### Accent Range

The primary accent shifts from the current blue (#0d99ff) to a violet-blue range that carries the "magic" identity:

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#5a4cf6` | Primary accent, filled elements |
| `--accent-light` | `#7c6cf6` | Gradient endpoints, lighter accent uses |
| `--accent-glow` | `#a090ff` | Glow effects, luminescent highlights |
| `--accent-hover` | `rgba(120, 100, 240, 0.18)` | Button hover backgrounds |
| `--accent-subtle` | `rgba(120, 100, 240, 0.08)` | Selected item backgrounds |

### Surface Hierarchy

Surfaces remain dark but shift slightly cooler to complement the violet accent:

| Token | Value | Usage |
|-------|-------|-------|
| `--surface-canvas` | `#18181c` | Canvas background |
| `--surface-glass` | `rgba(14, 14, 18, 0.72)` | Glass panel fill (with backdrop-blur) |
| `--surface-toolbar` | `rgba(12, 12, 16, 0.85)` | Toolbar fill |
| `--surface-status` | `rgba(10, 10, 14, 0.85)` | Status bar fill |
| `--surface-input` | `rgba(255, 255, 255, 0.035)` | Input field background |
| `--surface-input-hover` | `rgba(255, 255, 255, 0.045)` | Input hover state |
| `--surface-input-focus` | `rgba(255, 255, 255, 0.05)` | Input focus state |

### Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--danger` | `#ef4444` | Destructive actions |
| `--success` | `#22c55e` | Confirmations |
| `--warning` | `#f59e0b` | Alerts |

### Text Hierarchy

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#e0e0e0` | Primary text |
| `--text-secondary` | `#999` | Labels, secondary info |
| `--text-tertiary` | `#666` | Disabled, placeholder |
| `--text-accent` | `#c0b8f0` | Accent-colored text (active states) |
| `--text-on-accent` | `#ffffff` | Text on accent backgrounds |

### Border Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--border-default` | `rgba(100, 90, 200, 0.12)` | Panel borders, card borders |
| `--border-subtle` | `rgba(255, 255, 255, 0.04)` | Section dividers within panels |
| `--border-input` | `rgba(255, 255, 255, 0.05)` | Input field borders |
| `--border-input-hover` | `rgba(120, 100, 240, 0.3)` | Input hover border |
| `--border-input-focus` | `rgba(120, 100, 240, 0.4)` | Input focus border |

---

## Glass Surfaces

### Implementation

Glass panels use `backdrop-filter: blur()` with semi-transparent backgrounds. The canvas renders behind the panels at full resolution; the blur creates depth without losing screen real estate.

```css
.panel {
  background: var(--surface-glass); /* rgba(14, 14, 18, 0.72) */
  backdrop-filter: blur(24px) saturate(1.15);
  -webkit-backdrop-filter: blur(24px) saturate(1.15);
}
```

### Canvas Ambient Light

The canvas background includes subtle ambient color patches (radial gradients at very low opacity) that give the glass panels something to blur against. Without these, the glass effect is invisible on a solid dark background.

```css
.canvas::before {
  background: radial-gradient(ellipse at 40% 30%,
    rgba(100, 80, 200, 0.04) 0%, transparent 70%);
}
.canvas::after {
  background: radial-gradient(ellipse at 70% 60%,
    rgba(60, 130, 220, 0.03) 0%, transparent 70%);
}
```

These patches are static (no animation) and do not interfere with the canvas content layer.

### Where Glass Applies

| Element | Glass | Notes |
|---------|-------|-------|
| Side panels (left, right) | Yes | Primary glass surfaces |
| Toolbar | Yes | Matches panels |
| Status bar | Yes | Matches panels |
| Dropdowns / Popovers | Yes | Floating glass |
| Context menus | Yes | Floating glass |
| Dialogs | Yes | Glass with gradient border |
| Tooltips | No | Solid background for readability |
| Inputs, buttons, controls | No | Solid for readability and interaction clarity |

---

## Gradient Borders

### Direction: Top Edge Highlight

All gradient borders use a top-edge highlight: brightest along the top, fading uniformly down both sides. This direction is consistent across all elements and does not imply a specific light source position.

### Three-Layer Construction

Gradient borders are built from three layers:

1. **1px border** — subtle `--border-default` color visible all the way around
2. **Pseudo-element gradient** — brighter along the top edge, overlaid on the border using CSS mask to clip to the border area only
3. **Box-shadow glow** — inset and outer shadows positioned at the top edge, creating a soft light bloom

```css
.panel {
  border: 1px solid var(--border-default);
  box-shadow:
    0 -8px 20px -8px rgba(140, 120, 240, 0.12),    /* outer glow */
    inset 0 8px 20px -8px rgba(140, 120, 240, 0.08); /* inset glow */
}
.panel::before {
  /* Gradient overlay — bright top, fading down */
  background: linear-gradient(180deg,
    rgba(160, 144, 255, 0.3) 0%,
    rgba(130, 115, 240, 0.08) 30%,
    transparent 50%
  ) border-box;
  /* Mask to border area only */
  mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
}
```

### Where Gradient Borders Apply

| Element | Gradient border |
|---------|----------------|
| Side panels | Yes |
| Toolbar | Subtle (top edge, reduced intensity) |
| Dialogs | Yes |
| Popovers / Menus | No |
| Buttons | No |
| Inputs | No |
| Tooltips | No |

---

## Glow System

### Three Intensities

| Level | Usage | Box-shadow |
|-------|-------|------------|
| Subtle | Toolbar icon hover, color swatch bleed | `0 0 10px rgba(120, 100, 240, 0.08)` |
| Medium | Button hover, input focus, toggle on, sliders | `0 0 14px rgba(120, 100, 240, 0.2)` |
| Strong | Selection handles, CTA buttons | `0 0 20px rgba(120, 100, 240, 0.35)` |

### Pulse Animation

Buttons pulse on hover — the glow breathes in both size and intensity to signal "this is interactive, click me." On press (`active`), the pulse stops and the glow locks to its brightest state.

```css
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 10px rgba(120, 100, 240, 0.06); }
  50%      { box-shadow: 0 0 20px rgba(120, 100, 240, 0.3); }
}
```

Pulse applies to:
- Buttons on hover (1.8s cycle)
- CTA buttons on hover (1.8s, stronger range)
- Agent presence indicator in status bar (2s cycle)

Pulse does NOT apply to:
- Inputs (steady glow on focus — you're typing, not deciding)
- Toggles (steady glow when on)
- Selection handles (steady glow)
- Active tool indicator (steady glow)
- Any element at rest

---

## Effect Budget

The master table governing where each effect applies. This is the primary reference for implementation — if an element is not listed with "Yes" for an effect, it does not get that effect.

| Element | Glass | Gradient border | Glow | Pulse |
|---------|-------|----------------|------|-------|
| Side panels | Yes | Yes | No | No |
| Toolbar | Yes | Subtle (top edge, reduced intensity) | No | No |
| Status bar | Yes | No | No | No |
| Dialogs | Yes | Yes | No | No |
| Popovers / Menus | Yes | No | No | No |
| Tooltips | No | No | No | No |
| Buttons (hover) | No | No | Yes (medium) | Yes |
| CTA buttons (hover) | No | No | Yes (strong) | Yes |
| Toolbar icons (hover) | No | No | Yes (subtle) | Yes (subtle) |
| Active tool indicator | No | No | Yes (medium) | No |
| Inputs (rest) | No | No | No | No |
| Inputs (hover) | No | No | No | No |
| Inputs (focus) | No | No | Yes (medium) | No |
| Selection handles | No | No | Yes (strong) | No |
| Toggle (on) | No | No | Yes (medium) | No |
| Toggle (off) | No | No | No | No |
| Sliders | No | No | Yes (medium) | No |
| Color swatches | No | No | Yes (subtle) | No |
| Agent presence dot | No | No | Yes (medium) | Yes |

---

## Interactive State Design

### Buttons

| Variant | Rest | Hover | Active |
|---------|------|-------|--------|
| **Primary** | `rgba(120,100,240,0.12)` bg, `--accent` border at 0.18 opacity, `--text-accent` text | Background brightens, border brightens, glow pulse starts | Pulse stops, glow locks to brightest, `scale(0.98)` |
| **CTA** | Gradient fill `--accent` → `--accent-light`, steady subtle glow | Glow pulse starts (strong), gradient lightens | Pulse stops, max glow, `scale(0.98)` |
| **Ghost** | Transparent bg, `rgba(255,255,255,0.1)` border, `#999` text | `rgba(120,100,240,0.08)` bg, accent border, `--text-accent` text, subtle pulse | Bg brightens, glow locks |
| **Icon (toolbar)** | Transparent, dim icon color | Subtle accent bg, subtle glow pulse | N/A (becomes active tool) |
| **Active tool** | `rgba(120,100,240,0.1)` bg, accent border, `--text-accent`, steady glow — no pulse | — | — |

### Inputs

| State | Border | Background | Shadow |
|-------|--------|------------|--------|
| Rest | `--border-input` | `--surface-input` | None |
| Hover | `--border-input-hover` | `--surface-input-hover` | None |
| Focus | `--border-input-focus` | `--surface-input-focus` | `0 0 10px rgba(120,100,240,0.1)` |

### Toggles

| State | Track | Knob | Shadow |
|-------|-------|------|--------|
| Off | `rgba(255,255,255,0.08)` | `#555` | None |
| On | `rgba(120,100,240,0.3)` | `#a898f8` | Track: `0 0 10px rgba(120,100,240,0.15)`, Knob: `0 0 8px rgba(168,152,248,0.4)` |

---

## Logo

### Mark: Circle + Inner Circle + 4 Cardinal Spokes

The Sigil mark consists of:
- An outer circle (ring)
- An inner circle (ring, smaller, concentric)
- Four cardinal spokes connecting the two circles (top, right, bottom, left)
- Even stroke weight throughout

The mark is geometric, abstract, and original. It is not derived from any religious, cultural, or faith-based symbol. It evokes precision (crosshair), connection (spokes bridging inner and outer), and identity (a unique glyph — a sigil).

### Size Adaptations

| Size | Adaptation |
|------|------------|
| 16px (favicon) | Heavier stroke weights to maintain clarity |
| 24px (toolbar) | Standard weights |
| 32px+ | Full detail with gradient fill |
| 48px+ (dock, splash) | Gradient fill from `--accent-glow` to `--accent` |

### Usage Contexts

- **Favicon:** Monochrome, heavy strokes
- **Toolbar:** Accent color, standard strokes
- **File icon (.sigil):** Subdued, within file icon chrome
- **Dock/app icon:** Gradient fill, on dark rounded-rect background with gradient border
- **Splash/about:** Large, with "SIGIL" wordmark in Geist Sans (weight 300, letter-spacing 0.12em)

### Professional Refinement Required

This mark is a directional sketch. Before shipping, the logo requires:
1. Professional designer refinement for optical balance and stroke consistency across all sizes
2. Cultural sensitivity review to confirm no unintended resemblance to faith or cultural symbols
3. Trademark search
4. Export as SVG (scalable), PNG at standard icon sizes (16, 32, 64, 128, 256, 512, 1024), and ICO (Windows)

---

## Accessibility

### Contrast

All text/background combinations must meet WCAG 2.1 AA contrast ratios (4.5:1 for normal text, 3:1 for large text). The glass panel opacity (72%) is tuned to maintain sufficient contrast with `--text-primary` on `--surface-glass`.

### Reduced Motion

Every animation (glow pulse, hover transitions) must have a corresponding `@media (prefers-reduced-motion: reduce)` block that disables or shortens it. Glass blur is static. Gradient borders are static. The "magic" glows but does not move for users with motion sensitivity.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Focus Visibility

The existing `focus-visible` ring system is retained but updated to use the accent color with glow:

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 8px rgba(120, 100, 240, 0.2);
}
```

---

## Canvas Background

The canvas uses a subtle dot grid pattern for spatial reference:

```css
.canvas {
  background-color: var(--surface-canvas);
  background-image: radial-gradient(
    circle, rgba(255, 255, 255, 0.025) 1px, transparent 1px
  );
  background-size: 20px 20px;
}
```

The dot grid is intentionally very subtle — it provides spatial orientation without competing with the design content on the canvas.

---

## Dark Mode / Light Mode

This spec defines dark mode only. Light mode is deferred. The token-based architecture (CSS custom properties) supports a future light mode by overriding the token values in a `[data-theme="light"]` selector.

---

## Migration Strategy

This is a visual reskinning of the existing component system, not a structural rewrite. The changes are:

1. **Replace theme.css tokens** — new color values, new font stack
2. **Add Geist font loading** — bundle WOFF2 files, update font-face declarations
3. **Add backdrop-filter to panels/toolbar/status** — CSS-only change to existing selectors
4. **Add gradient border pseudo-elements** — to panel, dialog, and toolbar containers
5. **Update component CSS** — button, input, toggle, slider hover/focus/active states
6. **Add glow keyframes** — new animation definitions
7. **Add canvas ambient patches** — pseudo-elements on the canvas container
8. **Update logo SVG** — replace the current placeholder in the toolbar

No component API changes. No store changes. No server changes. No new dependencies beyond the Geist font files.

---

## PDR Traceability

- This spec implements the "Human-quality editor" PDR goal — making the editor feel professional and distinctive.
- This spec implements the "feels like Figma/Penpot" CLAUDE.md requirement by establishing a visual identity that is on par with professional design tools while being distinctly Sigil.
- Visual identity is a prerequisite for the Tauri desktop app release (M3, ADR-001) — first impressions of a native app are permanent.

## Consistency Guarantees

- All visual changes are CSS-only and do not affect document state.
- No mutations, no undo implications, no server changes.
- The migration can be applied incrementally (one component at a time) or as a single batch.

## Recursion Safety

No recursive structures introduced.

## Input Validation

No new input types introduced.

## WASM Compatibility

No changes to the core crate.
