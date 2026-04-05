# Spec 09: Properties Panel

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

Add visual property editing to the Design tab's right panel. Extends the schema-driven panel system (Spec 08) with three sub-tabs — **Layout**, **Appearance**, **Effects** — plus a color picker component supporting 4 color spaces and gradient editing.

The Design tab currently shows transform fields and name/visible/locked. This spec adds: corner radius editing, constraint editing, fill/stroke list management (add, remove, reorder via DnD, inline color editing), opacity slider, blend mode selector, effects list management, and a full-featured color picker popover.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Panel layout | Tabbed sub-panels (Layout \| Appearance \| Effects) | Reduces scrolling, groups related properties. Layout = spatial, Appearance = visual fills/strokes, Effects = shadows/blurs. |
| Fill/Stroke editing | Dynamic list with add/remove/reorder | Core supports up to 32 fills and 32 strokes. List rows are inline-editable with DnD reorder matching Plan 10a infrastructure. |
| Color picker | Popover with Solid/Gradient tabs, 4 color space switcher | Core supports sRGB, Display P3, OkLCH, OkLab. Full color space support is a differentiator vs Figma (sRGB-only). |
| Gradient editor | Stop bar inline in color picker | Gradient stops are draggable along a preview bar. Clicking a stop opens its color in the picker below. Matches Figma UX. |
| Effect type selection | Default to Drop Shadow on add, type dropdown on row | Drop shadow is ~80% of effect usage. One-click add for the common case, dropdown for the rest. |
| Token binding | Inline swap icon per bindable field | Small icon toggles between literal value and token picker. Discoverable without cluttering the UI. Full token browser deferred to token spec. |
| Optimistic updates | Required per CLAUDE.md S11 | All mutations apply locally before server round-trip, with rollback on error. |

## Architecture

### Sub-Tab Structure

The Design tab's right panel uses the existing `TabRegion` system. The current single-schema `SchemaPanel` is replaced with a sub-tabbed component:

```
<TabRegion region="right">
  Tab: "Design" → <DesignPanel>
    Sub-tab: "Layout"     → <SchemaPanel schema={layoutSchema} />
    Sub-tab: "Appearance"  → <AppearancePanel />  (custom, not generic schema)
    Sub-tab: "Effects"     → <EffectsPanel />     (custom, not generic schema)
  Tab: "Inspect" → <InspectPanel />  (future)
```

**Layout** uses the existing `SchemaPanel` with an extended schema. **Appearance** and **Effects** are custom panel components because list management (fill/stroke/effect lists with DnD, inline editors, add/remove) exceeds the generic schema renderer's capabilities.

### Data Flow

```
User edits field → Component dispatches store method (optimistic update)
  → GraphQL mutation → Server acquires lock → Core command (execute)
  → Broadcast to other clients → On error: rollback local state
```

All style mutations follow the same pattern as existing mutations (`renameNode`, `setVisible`, etc.) with optimistic local state changes and rollback on error per CLAUDE.md S11.

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DesignPanel` | `frontend/src/panels/DesignPanel.tsx` | Sub-tab container (Layout \| Appearance \| Effects) |
| `AppearancePanel` | `frontend/src/panels/AppearancePanel.tsx` | Opacity, blend mode, fill list, stroke list |
| `EffectsPanel` | `frontend/src/panels/EffectsPanel.tsx` | Effects list with per-type inline editors |
| `FillRow` | `frontend/src/panels/FillRow.tsx` | Single fill item: color swatch, opacity, visibility, drag handle, remove |
| `StrokeRow` | `frontend/src/panels/StrokeRow.tsx` | Single stroke item: color swatch, width, alignment, cap, join, drag handle, remove |
| `EffectCard` | `frontend/src/panels/EffectCard.tsx` | Single effect: type dropdown, per-type fields (shadow: color/offset/blur/spread, blur: radius) |
| `ColorPicker` | `frontend/src/components/color-picker/ColorPicker.tsx` | Popover: solid/gradient tabs, 4 color spaces, alpha |
| `ColorArea` | `frontend/src/components/color-picker/ColorArea.tsx` | 2D picker (adapts to color space: sat/brightness for sRGB, chroma/lightness for OkLCH) |
| `HueStrip` | `frontend/src/components/color-picker/HueStrip.tsx` | Hue slider bar |
| `AlphaStrip` | `frontend/src/components/color-picker/AlphaStrip.tsx` | Alpha slider bar with checkerboard background |
| `GradientEditor` | `frontend/src/components/color-picker/GradientEditor.tsx` | Stop bar with draggable stops, angle input, linear/radial toggle |
| `ColorSpaceSwitcher` | `frontend/src/components/color-picker/ColorSpaceSwitcher.tsx` | sRGB \| P3 \| OkLCH \| OkLab toggle |

### Backend Changes

| Change | Location | Purpose |
|--------|----------|---------|
| `SetCornerRadii` command | `crates/core/src/commands/style_commands.rs` | New command for rectangle corner radii (only missing style command) |
| `setOpacity` mutation | `crates/server/src/graphql/mutation.rs` | Set node opacity (0.0–1.0) |
| `setBlendMode` mutation | `crates/server/src/graphql/mutation.rs` | Set node blend mode |
| `setFills` mutation | `crates/server/src/graphql/mutation.rs` | Replace fills array |
| `setStrokes` mutation | `crates/server/src/graphql/mutation.rs` | Replace strokes array |
| `setEffects` mutation | `crates/server/src/graphql/mutation.rs` | Replace effects array |
| `setCornerRadii` mutation | `crates/server/src/graphql/mutation.rs` | Set rectangle corner radii |
| 6 MCP tools | `crates/mcp/src/tools/` | Mirror GraphQL mutations for agent access |

### Store Extensions

New methods on `DocumentStoreAPI`:

```typescript
setOpacity(uuid: string, opacity: number): void;
setBlendMode(uuid: string, blendMode: string): void;
setFills(uuid: string, fills: Fill[]): void;
setStrokes(uuid: string, strokes: Stroke[]): void;
setEffects(uuid: string, effects: Effect[]): void;
setCornerRadii(uuid: string, radii: [number, number, number, number]): void;
```

All follow the optimistic update pattern: snapshot → apply locally → mutation → rollback on error.

## UI Design

### Layout Tab

Contains the existing transform section plus new sections for corner radius and constraints:

**Sections:**
1. **Node identity** — name input, visible/locked toggles (already exists)
2. **Position & Size** — X, Y, W, H, Rotation (already exists)
3. **Corner Radius** — 4 independent number inputs with a "link" toggle to edit all at once. Only visible for `rectangle` node kind. Linked mode: editing one input sets all four.
4. **Constraints** — Horizontal (start, center, end, stretch) and Vertical (start, center, end, stretch) select dropdowns.

### Appearance Tab

**Sections:**
1. **Opacity & Blend** — Opacity slider (0–100%) with number input and token bind icon. Blend mode dropdown (Normal, Multiply, Screen, Overlay, etc.).
2. **Fill** — Section header with "+" button. Each fill row shows:
   - Drag handle (&#x2630;) for DnD reorder
   - Color swatch (click opens ColorPicker popover)
   - Fill type label (Solid / Linear / Radial) — clicking the swatch for gradient fills opens gradient editor
   - Per-fill opacity (0–100%, distinct from node-level opacity in Opacity & Blend section)
   - Visibility toggle (eye icon)
   - Remove button (×)
   - Adding a fill creates a `Solid` fill with the last-used color (or white default)
3. **Stroke** — Same list pattern as Fill, plus:
   - Width input (px)
   - Alignment dropdown (Inside, Outside, Center)
   - Adding a stroke creates a 1px Inside stroke with black color

### Effects Tab

**Section:**
1. **Effects** — Section header with "+" button (adds Drop Shadow by default). Each effect is an expandable card:
   - Drag handle for DnD reorder
   - Type dropdown (Drop Shadow, Inner Shadow, Layer Blur, Background Blur)
   - Visibility toggle + remove button
   - Per-type fields:
     - **Drop Shadow / Inner Shadow**: color swatch, X offset, Y offset, blur radius, spread radius
     - **Layer Blur / Background Blur**: blur radius only
   - Changing type via dropdown preserves compatible fields (e.g., switching Drop Shadow → Inner Shadow keeps all fields)

### Color Picker Popover

Opens when clicking any color swatch. Rendered as a Kobalte `Popover` anchored to the swatch.

**Solid tab:**
1. Color space switcher (sRGB | P3 | OkLCH | OkLab) — segmented toggle
2. 2D color area — adapts to the active color space:
   - sRGB: horizontal = saturation, vertical = brightness
   - OkLCH: horizontal = chroma, vertical = lightness
   - OkLab: horizontal = a*, vertical = b*
   - Display P3: same as sRGB but in P3 gamut
3. Hue strip — horizontal slider
4. Alpha strip — horizontal slider with checkerboard background
5. Numeric value fields — adapt to color space (R/G/B/A for sRGB, L/C/H/A for OkLCH, etc.)
6. Hex input — always shows sRGB hex equivalent (with gamut warning badge if color is outside sRGB)
7. Token bind icon — swaps to token picker (literal ↔ TokenRef)

**Gradient tab:**
1. Linear / Radial toggle
2. Gradient preview bar with draggable stop handles
   - Click on bar to add a new stop (interpolated color)
   - Drag a stop to reposition (0%–100%)
   - Drag a stop off the bar to remove (minimum 2 stops enforced)
3. Angle input + rotation dial (linear only)
4. Selected stop's color picker — same 2D area + hue strip as Solid tab, scoped to the active stop
5. Stop position input (numeric, 0–100%)

### Token Binding

Every `StyleValue<T>` field shows a small tag icon (&#x1F3F7;) next to its input. Clicking it:
1. If currently `Literal` → opens a token name input field. Typing a valid token name switches to `TokenRef { name }`. The field displays the token name with a colored indicator badge.
2. If currently `TokenRef` → clicking the icon switches back to `Literal` with the resolved value.

The full token browser/autocomplete is deferred to the token spec. This spec ships the toggle mechanism and manual name entry only.

## WASM Compatibility

The only core crate change is `SetCornerRadii`, which uses the same patterns as existing style commands (`SetFills`, `SetOpacity`, etc.). No new dependencies. No `Send`/`Sync` bounds. No system calls. WASM-compatible.

## Input Validation

### Color values
- All color channel values (`r`, `g`, `b`, `l`, `c`, `h`, `a`, `alpha`) are `f64` and must be validated for NaN/infinity at every boundary (core constructors, GraphQL resolvers, MCP tools, frontend `Number.isFinite()` guards).
- sRGB/P3 channels: 0.0–1.0. OkLCH lightness: 0.0–1.0, chroma: 0.0–0.4 (soft clamp), hue: 0.0–360.0. OkLab: L 0.0–1.0, a/b: -0.4–0.4.
- Alpha: 0.0–1.0 for all color spaces.

### Corner radii
- Each radius: non-negative `f64`, validated for NaN/infinity.
- No upper bound enforced at the property level (the canvas renderer clamps to half the shortest side).

### Fill/Stroke/Effect arrays
- Maximum 32 fills, 32 strokes, 32 effects per node (existing constants `MAX_FILLS_PER_STYLE`, `MAX_STROKES_PER_STYLE`, `MAX_EFFECTS_PER_STYLE`).
- Gradient stops: maximum 256 per gradient (existing constant `MAX_GRADIENT_STOPS`), minimum 2 stops.
- Stop positions: 0.0–1.0, validated for NaN/infinity.

### Stroke fields
- Width: positive `f64`, validated for NaN/infinity.
- Alignment: one of `Inside`, `Outside`, `Center`.
- Cap: one of `Butt`, `Round`, `Square`.
- Join: one of `Miter`, `Round`, `Bevel`.

### Opacity
- 0.0–1.0, validated for NaN/infinity at every boundary.

### Blend mode
- One of the 16 `BlendMode` enum variants. Invalid values rejected at deserialization.

## Consistency Guarantees

### Atomicity
- Each style mutation (`setFills`, `setStrokes`, `setEffects`) replaces the entire array atomically. There are no individual-item mutations (no `addFill`, `removeFill`). The frontend constructs the new array locally and sends it whole. This avoids ordering races when multiple clients edit simultaneously.
- `setCornerRadii` sets all 4 corners atomically.

### Undo/Redo
- Every command captures the previous value. Undo restores the previous value; redo restores the new value. The `SetCornerRadii` command follows the same `apply`/`undo` pattern as `SetFills`.
- Optimistic updates in the frontend are reverted on error via the captured snapshot.

### Partial failure
- No compound operations — each mutation is independent. Failure of one does not affect others.

## Recursion Safety

No new recursive structures or algorithms are introduced. The color picker and list editors are flat UI components. The existing depth-guarded `resolveValue` in `SchemaSection` (max depth 10) handles dot-path resolution for the layout schema.

## PDR Traceability

### Implemented by this spec
- "Properties panel — context-sensitive inspector for selected node(s): **transform, style, constraints, token bindings**" (PDR line 267)
- Node style: "fill, stroke, opacity, blend mode, effects (shadows, blur)" (PDR line 128)
- "Modify properties (transform, style, constraints, name)" (PDR line 183)

### Deferred
- "Override instance properties" (PDR line 190) — deferred to component spec
- Image fills (PDR mentions assets) — deferred to asset management spec
- Text-specific properties (font, line height, paragraph spacing) — deferred to text editing spec
- Gradient handle manipulation on canvas — deferred to canvas interaction spec
- Full token browser with autocomplete — deferred to token spec (this spec ships manual token name entry only)

## Keyboard Accessibility

Per CLAUDE.md S11, all pointer-only operations must have keyboard equivalents:

| Operation | Pointer | Keyboard |
|-----------|---------|----------|
| Edit color | Click swatch → popover | Enter on focused swatch → popover, arrow keys in picker |
| Add fill/stroke/effect | Click "+" button | Focus "+" button, Enter |
| Remove fill/stroke/effect | Click "×" button | Focus row, Delete key |
| Reorder fill/stroke/effect | Drag handle | Focus row, Alt+Arrow Up/Down |
| Toggle visibility | Click eye icon | Focus row, H key |
| Change effect type | Click type dropdown | Focus dropdown, arrow keys |
| Gradient stop manipulation | Click/drag on bar | Tab to stop, arrow keys to reposition, Delete to remove, Enter to add at cursor |
| Color area | Click/drag in 2D area | Arrow keys when area is focused (1% increments, Shift+Arrow for 10%) |
| Hue/Alpha strips | Click/drag strip | Arrow keys when strip is focused |
| Token bind toggle | Click tag icon | Focus tag icon, Enter |
| Corner radius link | Click link icon | Focus link icon, Enter |

## Scope

### In scope
- `DesignPanel` with Layout | Appearance | Effects sub-tabs
- Layout tab: corner radius editing (with link toggle), constraints editing
- Appearance tab: opacity slider + blend mode dropdown, fill list (add/remove/reorder/color edit), stroke list (add/remove/reorder/color edit/width/alignment)
- Effects tab: effect list (add/remove/reorder/type switch/per-type fields)
- `ColorPicker` component: solid colors in 4 color spaces, gradient editing (linear + radial), alpha
- Token bind/unbind toggle on `StyleValue` fields
- `SetCornerRadii` core command + undo/redo
- 6 GraphQL mutations + 6 MCP tools for all style properties
- Store methods with optimistic updates + rollback
- Keyboard equivalents for all pointer-only interactions (per CLAUDE.md S11)
- Storybook stories for all new components

### Out of scope
- Image fills (asset management)
- Text properties
- Gradient handles on canvas
- Full token browser / autocomplete
- Color palette / swatch library
- Eyedropper tool
