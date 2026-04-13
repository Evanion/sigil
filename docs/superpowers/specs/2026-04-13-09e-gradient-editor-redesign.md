# Spec 09e — Gradient Editor Redesign

## Overview

Redesigns the gradient fill editor from inline FillRow controls to a full popover with interactive stop management, adds conic gradient support, and adds repeating gradient variants. Brings gradient editing to CSS parity with proper UX matching Figma/Penpot.

**Depends on:** Spec 09d (gradient editing — existing linear/radial, canvas rendering, stop bar)

---

## 1. Core Type Changes

### 1.1 Conic Gradient Variant

Add to the `Fill` enum in `crates/core/src/node.rs`:

```rust
ConicGradient {
    gradient: ConicGradientDef,
}
```

New struct:
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConicGradientDef {
    pub center: Point,           // normalized 0–1 within the node
    pub start_angle: f64,        // degrees, 0 = top (12 o'clock)
    pub stops: Vec<GradientStop>,
}
```

### 1.2 Repeating Flag

Add `repeating: bool` to all three gradient definitions:

```rust
pub struct GradientDef {
    pub stops: Vec<GradientStop>,
    pub start: Point,
    pub end: Point,
    pub repeating: bool,  // NEW
}

pub struct ConicGradientDef {
    pub center: Point,
    pub start_angle: f64,
    pub stops: Vec<GradientStop>,
    pub repeating: bool,
}
```

Default: `repeating: false`.

### 1.3 Validation

In `validate.rs`:
- `MAX_GRADIENT_STOPS = 32` (existing)
- `MIN_GRADIENT_STOPS = 2` (existing)
- Conic `start_angle`: must be finite
- Conic `center`: x and y must be finite
- All stop positions: must be finite, clamped to [0, 1]
- All stop colors: validate via existing color pipeline

### 1.4 Serde Tag

The `Fill` enum uses `#[serde(tag = "type", rename_all = "snake_case")]`. The new variant serializes as `"conic_gradient"`.

---

## 2. Popover Editor UX

### 2.1 Trigger

In `FillRow`, when the fill is a gradient type, the gradient swatch (showing the gradient preview) is clickable and opens a `GradientEditorPopover`. Uses the existing Kobalte `Popover` component.

For solid fills, the existing ColorPicker popover remains.

### 2.2 Popover Layout

```
┌─────────────────────────────────────┐
│ [Linear] [Radial] [Conic]          │  ← Type tabs (segmented control)
│                                     │
│ ┌─────────────────────────────────┐ │
│ │                                 │ │  ← Gradient preview (120×80px)
│ │    (rendered gradient preview)  │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ○────●────────○────────────○────── │  ← Stop bar (drag stops, click to add)
│                                     │
│ [🎨 color] [Position: 40%] [× del] │  ← Selected stop controls
│                                     │
│ Angle: [135°]        [⇄ Reverse]   │  ← Type-specific controls
│                                     │
│ ☐ Repeating                         │  ← Repeating toggle
└─────────────────────────────────────┘
```

### 2.3 Type Tabs

Segmented control with three options: Linear, Radial, Conic. Switching types:

| From → To | Behavior |
|-----------|----------|
| Linear → Radial | Preserve stops. Default center 0.5/0.5. |
| Linear → Conic | Preserve stops. Default center 0.5/0.5, start_angle 0°. |
| Radial → Linear | Preserve stops. Default angle 180°. |
| Radial → Conic | Preserve stops. Keep center. Default start_angle 0°. |
| Conic → Linear | Preserve stops. Default angle 180°. |
| Conic → Radial | Preserve stops. Keep center. Default radius 0.5. |

All conversions preserve the `repeating` flag.

### 2.4 Gradient Preview

120×80px canvas-rendered preview of the gradient. Updates in real-time as stops, angle, or center change. Uses the same rendering functions as the main canvas renderer.

### 2.5 Stop Bar

Horizontal bar with the gradient as CSS background. Stop markers are circular, positioned at their stop position (0–1 mapped to bar width).

**Interactions:**
- **Click stop marker** → select it (highlight with accent border)
- **Drag stop marker** → reposition along bar (clamped 0–1, real-time update)
- **Click empty area of bar** → add new stop at that position, color interpolated from neighbors
- **Drag stop marker vertically off bar** → remove (minimum 2 stops enforced)
- **Keyboard:** Arrow Left/Right adjusts selected stop position by 1%, Delete removes selected stop

### 2.6 Selected Stop Controls

Below the stop bar, when a stop is selected:
- **Color swatch** — click opens the existing ColorPicker popover (nested popover) for this stop's color
- **Position input** — NumberInput 0–100% with step 1
- **Opacity** — NumberInput 0–100% (alpha channel of the stop's color)
- **Delete button** — removes selected stop (disabled if only 2 remain)

### 2.7 Type-Specific Controls

**Linear:**
- Angle NumberInput (0–360°, wraps)
- Reverse button (flips all stop positions: pos → 1 - pos)

**Radial:**
- Center X NumberInput (0–100%)
- Center Y NumberInput (0–100%)
- Radius NumberInput (0–100%)

**Conic:**
- Center X NumberInput (0–100%)
- Center Y NumberInput (0–100%)
- Start Angle NumberInput (0–360°)

### 2.8 Repeating Toggle

Checkbox "Repeating" at the bottom of the popover. Toggles `repeating: true/false` on the current gradient.

---

## 3. Canvas Rendering

### 3.1 Conic Gradient

```typescript
const grad = ctx.createConicGradient(
  startAngle * Math.PI / 180,  // radians
  cx, cy                        // center in world coordinates
);
for (const stop of gradient.stops) {
  grad.addColorStop(stop.position, resolveStopColorCSS(stop.color));
}
ctx.fillStyle = grad;
```

Note: `createConicGradient` is widely supported (Chrome 99+, Firefox 83+, Safari 15.4+).

### 3.2 Repeating Gradients

Canvas 2D does not natively support repeating gradients. Two approaches:

**A) CSS fallback for preview only** — use CSS `repeating-linear-gradient()` in the popover preview and stop bar, but render non-repeating on the main canvas (limitation documented).

**B) Manual tiling** — compute the repeat interval from stop positions and tile the gradient manually in the canvas renderer. More complex but accurate.

**Recommendation:** Start with **A** — repeating renders correctly in the popover preview (which uses CSS) and exports correctly to CSS output. The canvas shows the base gradient without repeating. This matches how some design tools handle it — the canvas is approximate, the export is exact. Document this as a known limitation for v1.

---

## 4. TypeScript Type Updates

### 4.1 Frontend Types

```typescript
export interface FillConicGradient {
  readonly type: "conic_gradient";
  readonly gradient: ConicGradientDef;
}

export interface ConicGradientDef {
  readonly center: Point;
  readonly start_angle: number;
  readonly stops: readonly GradientStop[];
  readonly repeating: boolean;
}
```

Update `Fill` union:
```typescript
export type Fill = FillSolid | FillLinearGradient | FillRadialGradient | FillConicGradient | FillImage;
```

Add `repeating: boolean` to existing `GradientDef`.

### 4.2 apply-remote.ts

The existing fill set_field handler already replaces the entire fills array — no changes needed for remote operation handling.

---

## 5. MCP / Server

### 5.1 Server GraphQL

The `set_field` path for `style.fills` already accepts the full Fill JSON. Adding `conic_gradient` as a new variant in the core `Fill` enum means it automatically deserializes through the existing path. No GraphQL schema changes needed.

### 5.2 MCP

The `set_fills` tool already accepts a JSON array of fills. Conic gradient fills will work automatically once the core type is extended. No MCP tool changes needed.

---

## 6. Input Validation

- **Conic center:** x and y must be finite. Displayed as 0–100%.
- **Conic start_angle:** must be finite. Displayed as 0–360° (wraps, CSS allows any value).
- **Repeating flag:** boolean, no validation needed.
- **All existing gradient validation** applies (stop count, stop position, stop color).

---

## 7. Consistency Guarantees

- **Fill replacement atomicity:** Same as before — entire fills array replaced via `setFills`.
- **Type conversion:** Stops are preserved across all type switches. Only geometry changes.
- **Repeating flag:** Preserved across type switches.

---

## 8. WASM Compatibility

`ConicGradientDef` is a plain struct with `f64` + `Point` + `Vec<GradientStop>`. No new dependencies. WASM-safe.

---

## 9. Recursion Safety

No recursive algorithms introduced.

---

## 10. PDR Traceability

**Implements:**
- PDR §3.4 "Fill types" — full CSS gradient parity (linear, radial, conic, repeating)
- PDR §4.2 "Property editing — fill management" — popover gradient editor

**Defers:**
- Canvas gradient handles (interactive on-canvas drag) — future enhancement
- Gradient interpolation color space selector (sRGB vs OKLab) — future enhancement
- Color hints / midpoints between stops — future enhancement

---

## 11. File Structure

### New files
| File | Responsibility |
|------|---------------|
| `frontend/src/panels/GradientEditorPopover.tsx` | Popover wrapper with type tabs, preview, controls |
| `frontend/src/panels/GradientEditorPopover.css` | Popover styles |

### Major modifications
| File | Changes |
|------|---------|
| `crates/core/src/node.rs` | Add `ConicGradient` variant, `ConicGradientDef` struct, `repeating` field |
| `crates/core/src/validate.rs` | Add conic validation constants |
| `frontend/src/types/document.ts` | Add `FillConicGradient`, `ConicGradientDef`, `repeating` field |
| `frontend/src/panels/FillRow.tsx` | Replace inline gradient controls with popover trigger |
| `frontend/src/panels/GradientControls.tsx` | Add conic tab, repeating toggle |
| `frontend/src/components/gradient-editor/GradientStopEditor.tsx` | Add drag-off-to-remove |
| `frontend/src/components/gradient-editor/gradient-utils.ts` | Add conic CSS builder, repeating CSS variants |
| `frontend/src/canvas/renderer.ts` | Add conic gradient rendering |
| `frontend/src/i18n/locales/*/panels.json` | Conic and repeating strings |
