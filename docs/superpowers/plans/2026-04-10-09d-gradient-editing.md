# Gradient Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gradient fill editing to the properties panel — stop editor bar with drag/add/remove, color per stop, angle/center/radius controls, fill type switching, and canvas gradient rendering.

**Architecture:** Gradient editing works through the existing `setFills` mutation which replaces the entire fills array atomically. A new `GradientStopEditor` component handles the interactive stop bar. `GradientControls` wraps the stop editor with type-specific controls (angle for linear, center/radius for radial). `FillRow` is enhanced with a type switcher dropdown and expands to show gradient controls when the fill is a gradient type. The canvas renderer is extended to render linear and radial gradients using Canvas 2D gradient API.

**Tech Stack:** TypeScript/Solid.js (frontend components), Canvas 2D (gradient rendering), Vitest (tests)

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `frontend/src/components/gradient-editor/GradientStopEditor.tsx` | Interactive stop bar with drag, add, remove |
| `frontend/src/components/gradient-editor/GradientStopEditor.css` | Stop editor styles |
| `frontend/src/components/gradient-editor/gradient-utils.ts` | Color interpolation, CSS gradient string builder, angle/point conversion |
| `frontend/src/components/gradient-editor/__tests__/gradient-utils.test.ts` | Utility tests |
| `frontend/src/components/gradient-editor/__tests__/GradientStopEditor.test.tsx` | Stop editor component tests |
| `frontend/src/panels/GradientControls.tsx` | Angle/center/radius controls + stop editor wrapper |
| `frontend/src/panels/GradientControls.css` | Gradient controls styles |

### Major modifications
| File | Changes |
|------|---------|
| `frontend/src/types/document.ts` | Add `id` field to `GradientStop` |
| `frontend/src/panels/FillRow.tsx` | Fill type switcher dropdown, gradient row expansion |
| `frontend/src/panels/FillRow.css` | Expanded row styles |
| `frontend/src/panels/AppearancePanel.tsx` | Wire gradient-aware handlers |
| `frontend/src/canvas/renderer.ts` | Gradient fill rendering (linear + radial) |
| `frontend/src/i18n/locales/en/panels.json` | Gradient editing strings |
| `frontend/src/i18n/locales/es/panels.json` | Spanish gradient strings |
| `frontend/src/i18n/locales/fr/panels.json` | French gradient strings |

---

## Task 1: Gradient utility functions + TypeScript type updates

**Files:**
- Modify: `frontend/src/types/document.ts`
- Create: `frontend/src/components/gradient-editor/gradient-utils.ts`
- Create: `frontend/src/components/gradient-editor/__tests__/gradient-utils.test.ts`

- [ ] **Step 1: Add `id` field to GradientStop**

In `frontend/src/types/document.ts`, add an optional `id` field to `GradientStop`:

```typescript
export interface GradientStop {
  readonly id?: string;  // Frontend-only stable identity for selection/dispatch
  readonly position: number;
  readonly color: StyleValue<Color>;
}
```

The `id` is frontend-only (not persisted to server) — assigned when stops are loaded or created.

- [ ] **Step 2: Create gradient-utils.ts**

Create `frontend/src/components/gradient-editor/gradient-utils.ts`:

Utility functions:
- `assignStopIds(stops: readonly GradientStop[]): GradientStop[]` — assigns UUID to stops missing an `id`
- `interpolateStopColor(stops: readonly GradientStop[], position: number): Color` — interpolates color at a given position from neighboring stops
- `stopsToLinearGradientCSS(stops: readonly GradientStop[], angle?: number): string` — builds CSS `linear-gradient()` string for the stop bar preview
- `angleFromPoints(start: Point, end: Point, width: number, height: number): number` — converts start/end points to angle in degrees
- `pointsFromAngle(angle: number, width: number, height: number): { start: Point; end: Point }` — converts angle to start/end points
- `MAX_GRADIENT_STOPS = 32` — constant with enforcement

All numeric outputs guarded with `Number.isFinite()`.

- [ ] **Step 3: Write tests for utility functions**

Tests covering: `assignStopIds` assigns unique IDs, `interpolateStopColor` at 0/0.5/1 positions, `stopsToLinearGradientCSS` output format, `angleFromPoints` roundtrip with `pointsFromAngle`, `MAX_GRADIENT_STOPS` enforcement.

- [ ] **Step 4: Run tests and commit**

```
feat(frontend): add gradient utility functions and stop ID type (Spec 09d, Task 1)
```

---

## Task 2: Canvas gradient rendering

**Files:**
- Modify: `frontend/src/canvas/renderer.ts`

- [ ] **Step 1: Extend resolveFillColor to return gradient fill info**

Replace the current `resolveFillColor` (which returns a string) with a `resolveNodeFill` function that returns either a CSS color string OR a CanvasGradient object. Or better: refactor the draw path to iterate all fills and apply each one.

The spec says: "The renderer iterates all fills in order (bottom to top). Each fill is drawn as a separate `fillRect`/`fillPath` call with its own fill style."

Refactor `drawNode` to:
1. Iterate `node.style.fills` in order
2. For each fill:
   - Solid: `ctx.fillStyle = srgbColorToRgba(color)`
   - Linear gradient: create `ctx.createLinearGradient()` from start/end points, add stops
   - Radial gradient: create `ctx.createRadialGradient()` from center/radius, add stops
3. Draw the shape for each fill

- [ ] **Step 2: Implement linear gradient rendering**

```typescript
function createLinearGradientFill(
  ctx: CanvasRenderingContext2D,
  gradient: GradientDef,
  x: number, y: number, width: number, height: number,
): CanvasGradient {
  const sx = x + gradient.start.x * width;
  const sy = y + gradient.start.y * height;
  const ex = x + gradient.end.x * width;
  const ey = y + gradient.end.y * height;
  const grad = ctx.createLinearGradient(sx, sy, ex, ey);
  for (const stop of gradient.stops) {
    if (Number.isFinite(stop.position)) {
      grad.addColorStop(
        Math.max(0, Math.min(1, stop.position)),
        resolveStopColor(stop.color),
      );
    }
  }
  return grad;
}
```

- [ ] **Step 3: Implement radial gradient rendering**

```typescript
function createRadialGradientFill(
  ctx: CanvasRenderingContext2D,
  gradient: GradientDef,
  x: number, y: number, width: number, height: number,
): CanvasGradient {
  // For radial, start = center, end determines radius
  const cx = x + gradient.start.x * width;
  const cy = y + gradient.start.y * height;
  const dx = (gradient.end.x - gradient.start.x) * width;
  const dy = (gradient.end.y - gradient.start.y) * height;
  const r = Math.sqrt(dx * dx + dy * dy);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r, 0.001));
  for (const stop of gradient.stops) {
    if (Number.isFinite(stop.position)) {
      grad.addColorStop(
        Math.max(0, Math.min(1, stop.position)),
        resolveStopColor(stop.color),
      );
    }
  }
  return grad;
}
```

- [ ] **Step 4: Refactor drawNode to support multiple fills**

Update the switch cases in `drawNode` to iterate fills and apply each one.

- [ ] **Step 5: Run tests and commit**

```
feat(frontend): add canvas gradient rendering for linear and radial fills (Spec 09d, Task 2)
```

---

## Task 3: GradientStopEditor component

**Files:**
- Create: `frontend/src/components/gradient-editor/GradientStopEditor.tsx`
- Create: `frontend/src/components/gradient-editor/GradientStopEditor.css`
- Create: `frontend/src/components/gradient-editor/__tests__/GradientStopEditor.test.tsx`

- [ ] **Step 1: Implement the stop bar component**

A horizontal bar showing the gradient as a CSS background. Stops are rendered as circular markers at their position (0-1 mapped to bar width).

Props:
```typescript
interface GradientStopEditorProps {
  stops: GradientStop[];
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  onUpdateStop: (id: string, updates: Partial<GradientStop>) => void;
  onAddStop: (position: number) => void;
  onRemoveStop: (id: string) => void;
  gradientCSS: string;
}
```

Interactions:
- Click stop marker → select it
- Drag stop marker → reposition (clamped 0-1, update in real-time)
- Click empty area of bar → add new stop at that position
- Double-click stop → remove (if more than 2 stops remain)
- Keyboard: Left/Right arrow moves selected stop position, Delete removes

- [ ] **Step 2: Add styles**

CSS for the stop bar, stop markers (selected state highlight), drag cursor.

- [ ] **Step 3: Add ARIA**

`role="slider"` on each stop marker with `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-label`.

- [ ] **Step 4: Write tests**

Tests: renders correct number of stops, click selects stop, drag repositions, click empty adds stop, min 2 stops enforced, keyboard navigation.

- [ ] **Step 5: Run tests and commit**

```
feat(frontend): add GradientStopEditor component (Spec 09d, Task 3)
```

---

## Task 4: GradientControls + FillRow enhancement

**Files:**
- Create: `frontend/src/panels/GradientControls.tsx`
- Create: `frontend/src/panels/GradientControls.css`
- Modify: `frontend/src/panels/FillRow.tsx`
- Modify: `frontend/src/panels/FillRow.css`
- Modify: `frontend/src/panels/AppearancePanel.tsx`

- [ ] **Step 1: Create GradientControls component**

Wraps the `GradientStopEditor` with type-specific controls:
- For linear: Angle NumberInput (0-360°), Reverse button
- For radial: Center X/Y NumberInputs (0-100%), Radius NumberInput (0-100%)
- Below: Selected stop color swatch + position NumberInput (0-100%) + remove button

Manages local state: selected stop ID, stop list with assigned IDs.

When any value changes, reconstruct the fill object and call `onUpdate(fill)`.

- [ ] **Step 2: Enhance FillRow with type switcher**

Replace the static type label with a dropdown (`<select>` or Kobalte `Select`) that allows switching between Solid, Linear, Radial fill types.

On type switch:
- Solid → Linear: first stop = solid color, last stop = black, default angle 180°
- Solid → Radial: same stops, default center 0.5/0.5, radius 0.5
- Linear/Radial → Solid: use first stop's color
- Linear ↔ Radial: preserve stops, apply default geometry

When fill is a gradient, render `<GradientControls>` below the row header.

- [ ] **Step 3: Wire into AppearancePanel**

The existing `handleFillUpdate` already handles replacing a fill at an index. Just ensure it works with gradient Fill objects (it should — `setFills` is type-agnostic).

Add `handleFillTypeChange` if the type switcher needs special logic.

- [ ] **Step 4: Add i18n strings**

Add gradient-related keys to locale files:
```json
"gradient.angle": "Angle",
"gradient.centerX": "Center X",
"gradient.centerY": "Center Y",
"gradient.radius": "Radius",
"gradient.reverse": "Reverse gradient",
"gradient.addStop": "Add color stop",
"gradient.removeStop": "Remove color stop",
"gradient.stopPosition": "Stop position",
"gradient.stopColor": "Stop color",
"fill.typeLinear": "Linear",
"fill.typeRadial": "Radial",
"fill.typeSolid": "Solid",
"fill.typeImage": "Image"
```

Add corresponding Spanish and French translations.

- [ ] **Step 5: Run tests and commit**

```
feat(frontend): add GradientControls, enhance FillRow with type switching (Spec 09d, Task 4)
```

---

## Task 5: History coalescing for gradient drag operations

**Files:**
- Modify: `frontend/src/panels/GradientControls.tsx`

- [ ] **Step 1: Implement gesture coalescing for stop drag**

Per CLAUDE.md §11 "Continuous-Value Controls Must Coalesce History Entries": dragging a stop should produce a single undo entry, not one per pixel.

Pattern:
- On pointerdown (drag start): capture snapshot of the fills array
- During drag: update the store without creating history entries (use a batch/suppress flag or direct `setState` without `interceptor`)
- On pointerup (drag end): commit a single history entry with the full before/after delta

Check how existing continuous controls (e.g., opacity slider, color picker drag) implement this in the codebase and follow the same pattern.

- [ ] **Step 2: Commit**

```
feat(frontend): add history coalescing for gradient stop drag (Spec 09d, Task 5)
```

---

## Task 6: Tests + integration verification

**Files:**
- Create: `frontend/src/panels/__tests__/GradientControls.test.tsx`

- [ ] **Step 1: Write GradientControls tests**

Tests covering:
- Linear gradient shows angle control
- Radial gradient shows center/radius controls
- Changing angle updates the fill
- Selected stop shows color swatch and position
- Reverse button flips stop positions
- Stop count enforced (can't remove below 2, can't add above MAX_GRADIENT_STOPS)

- [ ] **Step 2: Write FillRow type-switching tests**

Tests covering:
- Solid → Linear conversion preserves color as first stop
- Linear → Solid uses first stop color
- Linear → Radial preserves stops
- Type dropdown renders all options

- [ ] **Step 3: Run full test suites**

```bash
pnpm test
pnpm lint
pnpm build
npx tsc --noEmit
npx prettier --check 'src/**/*.{ts,tsx,json,css}'
```

- [ ] **Step 4: Commit**

```
test(frontend): add gradient editing tests (Spec 09d, Task 6)
```

---

## Task 7: Browser verification

- [ ] **Step 1: Build and start server**

- [ ] **Step 2: Test in browser**

- Create a rectangle
- Go to Appearance tab → Fill section
- Click the fill type dropdown → switch to "Linear"
- Verify: gradient renders on canvas, stop editor bar appears
- Drag a stop → gradient updates in real-time
- Click empty area of bar → new stop added
- Change angle → gradient direction changes
- Switch to "Radial" → concentric gradient renders
- Undo → gradient changes revert
- Switch back to "Solid" → solid fill restored

- [ ] **Step 3: Commit if needed**

```
test: integration verification for gradient editing (Spec 09d, Task 7)
```

---

## Dependency Graph

```
Task 1 (utils + types) → Task 2 (canvas rendering)
Task 1 → Task 3 (stop editor)
Task 3 → Task 4 (gradient controls + fill row)
Task 4 → Task 5 (history coalescing)
Tasks 2-5 → Task 6 (tests)
All → Task 7 (browser test)
```

Tasks 2 and 3 are independent after Task 1.
