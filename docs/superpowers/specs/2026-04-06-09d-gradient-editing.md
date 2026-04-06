# Spec 09d — Gradient Editing

## Overview

Adds gradient fill editing to the properties panel. Users can create and edit linear and radial gradients with a stop editor bar, color per stop, and gradient-specific controls (angle for linear, center/radius for radial). Builds on the existing fill system (Spec 09) where `FillRow` already labels "Linear" and "Radial" fill types.

**Depends on:** Spec 09 (properties panel — fill list, ColorSwatch), Spec 09b (ColorPicker component)

---

## 1. Gradient Data Model

The core types already define gradient fills (from Spec 01):

```rust
pub struct FillLinearGradient {
    pub type: "linear_gradient",
    pub angle: StyleValue<f64>,            // degrees, 0 = top-to-bottom
    pub stops: Vec<GradientStop>,
}

pub struct FillRadialGradient {
    pub type: "radial_gradient",
    pub center: StyleValue<Point2D>,       // normalized 0–1 within the node
    pub radius: StyleValue<f64>,           // normalized 0–1 (1 = node half-diagonal)
    pub stops: Vec<GradientStop>,
}

pub struct GradientStop {
    pub color: StyleValue<Color>,
    pub position: f64,                     // 0.0–1.0 along the gradient axis
}
```

### 1.1 Default Gradients

**New linear gradient default:**
```json
{
  "type": "linear_gradient",
  "angle": { "type": "literal", "value": 180 },
  "stops": [
    { "color": { "type": "literal", "value": { "space": "srgb", "r": 1, "g": 1, "b": 1, "a": 1 } }, "position": 0 },
    { "color": { "type": "literal", "value": { "space": "srgb", "r": 0, "g": 0, "b": 0, "a": 1 } }, "position": 1 }
  ]
}
```

**New radial gradient default:**
```json
{
  "type": "radial_gradient",
  "center": { "type": "literal", "value": { "x": 0.5, "y": 0.5 } },
  "radius": { "type": "literal", "value": 0.5 },
  "stops": [
    { "color": { "type": "literal", "value": { "space": "srgb", "r": 1, "g": 1, "b": 1, "a": 1 } }, "position": 0 },
    { "color": { "type": "literal", "value": { "space": "srgb", "r": 0, "g": 0, "b": 0, "a": 1 } }, "position": 1 }
  ]
}
```

---

## 2. FillRow Enhancement

### 2.1 Fill Type Switcher

The current `FillRow` shows a static type label ("Solid", "Linear", "Radial", "Image"). This changes to a clickable dropdown that allows switching between fill types:

| From → To | Behavior |
|-----------|----------|
| Solid → Linear | Create linear gradient. First stop = the solid color, last stop = black. |
| Solid → Radial | Create radial gradient. Same stop logic. |
| Linear → Solid | Convert to solid using the first stop's color. |
| Linear → Radial | Preserve stops. Default center/radius. |
| Radial → Linear | Preserve stops. Default angle (180°). |
| Radial → Solid | Convert to solid using the first stop's color. |

### 2.2 Gradient Row Expansion

When a fill is a gradient type, `FillRow` expands to show:
- The fill type dropdown (as above)
- A gradient preview swatch (shows the gradient instead of a solid color)
- The gradient stop editor bar (inline, below the row header)
- Type-specific controls below the stop editor

---

## 3. Gradient Stop Editor

### 3.1 Stop Bar

A horizontal bar (full width of the fill row) that visualizes the gradient as a CSS linear-gradient background. Stops are rendered as small triangular or circular markers on the bar at their position (0–1 mapped to bar width).

**Interactions:**
- **Click stop:** Select it. The ColorSwatch below updates to show that stop's color. The position NumberInput shows that stop's position.
- **Drag stop:** Reposition along the bar. Position is clamped to [0, 1]. Update in real-time (optimistic, debounced mutation like fills).
- **Click empty area:** Add a new stop at that position. Color is interpolated from neighbors.
- **Drag stop off bar (vertically):** Remove the stop (minimum 2 stops enforced — can't remove if only 2 remain).

### 3.2 Stop Controls

Below the stop bar, when a stop is selected:
- **ColorSwatch** — opens ColorPicker to edit the selected stop's color
- **Position NumberInput** — 0–100% with step 1, maps to 0.0–1.0
- **Remove button** — removes the selected stop (disabled if only 2 stops)

### 3.3 Stop Identity

Per CLAUDE.md §11 "Do Not Use Positional Index as Item Identity in Dynamic Lists" — each stop gets a stable UUID assigned at creation time. Selection and dispatch use the UUID, not the array index. When stops are reordered by dragging, the UUID follows the stop.

---

## 4. Gradient-Specific Controls

### 4.1 Linear Gradient

- **Angle** — NumberInput with degree suffix (°). Range: 0–360. Step: 1. Shift+drag on the angle input for fine control.
- **Reverse button** — swaps all stop positions (pos → 1 − pos). Quick way to flip gradient direction.

### 4.2 Radial Gradient

- **Center X** — NumberInput, 0–100% (maps to 0.0–1.0 normalized within node)
- **Center Y** — NumberInput, 0–100%
- **Radius** — NumberInput, 0–100% (0.5 = half the node diagonal)

---

## 5. Canvas Gradient Rendering

### 5.1 Current State

The canvas renderer currently only resolves the first solid fill for node color. This must be extended to render gradient fills.

### 5.2 Linear Gradient Rendering

```typescript
const angle = gradientAngle * Math.PI / 180;
const cx = x + width / 2;
const cy = y + height / 2;
const length = Math.max(width, height);
const dx = Math.cos(angle) * length / 2;
const dy = Math.sin(angle) * length / 2;
const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
for (const stop of fill.stops) {
  grad.addColorStop(stop.position, stopToCSS(stop.color));
}
ctx.fillStyle = grad;
```

### 5.3 Radial Gradient Rendering

```typescript
const cx = x + width * center.x;
const cy = y + height * center.y;
const r = Math.max(width, height) * radius;
const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
for (const stop of fill.stops) {
  grad.addColorStop(stop.position, stopToCSS(stop.color));
}
ctx.fillStyle = grad;
```

### 5.4 Multiple Fills

The renderer iterates all fills in order (bottom to top). Each fill is drawn as a separate `fillRect`/`fillPath` call with its own fill style. Solid fills use flat color, gradient fills use canvas gradient objects.

---

## 6. Components

### 6.1 GradientStopEditor

New component: `frontend/src/components/gradient-editor/GradientStopEditor.tsx`

Props:
```typescript
interface GradientStopEditorProps {
  stops: GradientStop[];
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  onUpdateStop: (id: string, updates: Partial<GradientStop>) => void;
  onAddStop: (position: number) => void;
  onRemoveStop: (id: string) => void;
  gradientCSS: string;  // for the bar background preview
}
```

### 6.2 GradientControls

New component: `frontend/src/panels/GradientControls.tsx`

Renders the stop editor + type-specific controls (angle or center/radius) for a gradient fill. Embedded within FillRow when the fill type is a gradient.

---

## 7. Store Methods

New store method:

```typescript
setFills(uuid: string, fills: Fill[]): void  // already exists — used as-is
```

Gradient editing modifies fills in place (update a stop color, reposition a stop, add/remove stops, change angle) and calls the existing `setFills` with the modified fills array. No new mutation type needed — the fill array is replaced atomically.

---

## 8. File Structure

### New files

```
frontend/src/components/gradient-editor/
  GradientStopEditor.tsx     — stop bar with drag + add + remove
  GradientStopEditor.css
  GradientStopEditor.test.tsx
  GradientStopEditor.stories.tsx
  gradient-utils.ts           — interpolateColor, CSS gradient string builder

frontend/src/panels/
  GradientControls.tsx         — angle/center/radius controls + stop editor
  GradientControls.css
  GradientControls.test.tsx
```

### Modified files

```
frontend/src/panels/FillRow.tsx        — fill type switcher, gradient row expansion
frontend/src/panels/FillRow.css        — expanded row styles
frontend/src/panels/AppearancePanel.tsx — pass gradient-aware handlers
frontend/src/canvas/renderer.ts        — gradient fill rendering
frontend/src/types/document.ts         — add stop id field to GradientStop type
```

---

## 9. Input Validation

- **Stop position:** Clamped to [0.0, 1.0], must be finite. Enforced at UI boundary with Number.isFinite.
- **Stop color:** Validated by existing color pipeline (sRGB, Number.isFinite on channels).
- **Gradient angle:** Must be finite. Displayed as 0–360 but stored as-is (CSS allows angles outside 0–360, they wrap).
- **Radial center:** x and y must be finite, displayed as 0–100%.
- **Radial radius:** Must be finite and > 0.
- **Stop count:** Minimum 2 stops enforced in UI (remove button disabled). Maximum 32 stops (MAX_GRADIENT_STOPS constant with enforcement test).
- **Stop ID:** UUID assigned at creation. Used for selection/dispatch per CLAUDE.md §11.
- **All CSS string interpolation:** Validated with Number.isFinite before building gradient CSS strings per CLAUDE.md §11.

---

## 10. Consistency Guarantees

- **Fill replacement atomicity:** The entire fills array is replaced via `setFills` on every change. Single undo step per user action (same as solid fill editing).
- **Stop ordering:** Stops are sorted by position for rendering. The stop editor displays them in position order. Dragging a stop past another reorders them.
- **Type switching:** Fill type conversion preserves as much data as possible (stops carry over between gradient types, first stop color becomes solid color). No data is silently dropped.

---

## 11. WASM Compatibility

No core crate changes needed. The gradient types already exist. Stop ID is a frontend-only concept (added to the TypeScript type, not persisted — stops are identified by position in the serialized format). Canvas gradient rendering is browser-only.

---

## 12. Recursion Safety

No recursive algorithms. Stop iteration is flat array traversal.

---

## 13. PDR Traceability

**Implements:**
- PDR §3.4 "Fill types — solid, linear gradient, radial gradient" — full editing UI
- PDR §4.2 "Property editing — fill management" — gradient stop editing

**Defers:**
- Canvas gradient handles (interactive drag on canvas to reposition gradient) — documented as future enhancement (Spec 11a §10)
- Image fills — separate spec
- Mesh gradients — not in PDR scope

---

## 14. Future Enhancements (Documented, Not Implemented)

### 14.1 Canvas Gradient Handles

Interactive handles overlaid on the selected node showing gradient start/end (linear) or center/radius (radial). Drag to reposition directly on canvas. Matches Figma's gradient editing UX.

### 14.2 Gradient Presets

A library of preset gradients (e.g., sunset, ocean, brand gradients). Selectable from a dropdown in the gradient controls.

### 14.3 Gradient Copy/Paste

Copy a gradient from one fill to another, or across nodes. Paste preserves all stops and settings.
