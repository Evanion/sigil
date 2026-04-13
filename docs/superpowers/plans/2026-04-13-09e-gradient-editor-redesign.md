# Gradient Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the gradient editor from inline controls to a Figma-style popover, add conic gradient support, add repeating gradient variants, and implement drag-off-to-remove for stops.

**Architecture:** Three independent layers: (1) core type extension (ConicGradient variant + repeating flag in Rust), (2) canvas rendering (conic gradient via createConicGradient), (3) popover UX (move GradientControls into a popover, add type tabs, stop color picker, repeating toggle). Each layer produces independently testable code.

**Tech Stack:** Rust (core types), TypeScript/Solid.js (frontend), Canvas 2D (conic rendering), Kobalte Popover (UI), Vitest (tests)

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `frontend/src/panels/GradientEditorPopover.tsx` | Popover wrapper with type tabs, preview, all controls |
| `frontend/src/panels/GradientEditorPopover.css` | Popover styles |

### Major modifications
| File | Changes |
|------|---------|
| `crates/core/src/node.rs` | Add `ConicGradient` variant, `ConicGradientDef` struct, `repeating` field to `GradientDef` |
| `crates/core/src/validate.rs` | Conic validation |
| `frontend/src/types/document.ts` | Add `FillConicGradient`, `ConicGradientDef`, `repeating` field |
| `frontend/src/canvas/renderer.ts` | Add `createConicGradientFill` |
| `frontend/src/components/gradient-editor/gradient-utils.ts` | Conic CSS builder, repeating CSS variants, conic conversion helpers |
| `frontend/src/panels/FillRow.tsx` | Replace inline gradient controls with popover trigger |
| `frontend/src/panels/GradientControls.tsx` | Add conic tab, repeating toggle, integrate into popover |
| `frontend/src/components/gradient-editor/GradientStopEditor.tsx` | Add drag-off-to-remove |
| `frontend/src/i18n/locales/*/panels.json` | Conic + repeating strings |

---

## Task 1: Core type extension — ConicGradient + repeating flag

**Files:**
- Modify: `crates/core/src/node.rs`
- Modify: `crates/core/src/validate.rs`

- [ ] **Step 1: Add `repeating` field to GradientDef**

```rust
pub struct GradientDef {
    pub stops: Vec<GradientStop>,
    pub start: Point,
    pub end: Point,
    pub repeating: bool,  // NEW — default false
}
```

Update `Default` impl if one exists, and fix all construction sites to include `repeating: false`.

- [ ] **Step 2: Add ConicGradientDef struct**

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConicGradientDef {
    pub center: Point,
    pub start_angle: f64,
    pub stops: Vec<GradientStop>,
    pub repeating: bool,
}
```

- [ ] **Step 3: Add ConicGradient variant to Fill enum**

```rust
pub enum Fill {
    // ... existing variants ...
    ConicGradient {
        gradient: ConicGradientDef,
    },
}
```

- [ ] **Step 4: Add validation**

In `validate.rs`, validate conic fields: `start_angle` finite, `center.x` and `center.y` finite, stops within limits.

- [ ] **Step 5: Fix compilation**

Run `cargo check --workspace` and fix all match exhaustiveness errors — every `match fill { ... }` in the codebase needs a `ConicGradient` arm. This includes:
- `resolveFillColor` equivalent in any Rust code
- Workfile serialization/deserialization
- Any fill validation logic

- [ ] **Step 6: Add tests**

Tests for ConicGradientDef serde roundtrip, validation rejection of NaN angles.

- [ ] **Step 7: Commit**

```
feat(core): add ConicGradient variant and repeating flag (Spec 09e, Task 1)
```

---

## Task 2: Frontend type updates + conic canvas rendering

**Files:**
- Modify: `frontend/src/types/document.ts`
- Modify: `frontend/src/canvas/renderer.ts`
- Modify: `frontend/src/components/gradient-editor/gradient-utils.ts`

- [ ] **Step 1: Add TypeScript types**

```typescript
export interface ConicGradientDef {
  readonly center: Point;
  readonly start_angle: number;
  readonly stops: readonly GradientStop[];
  readonly repeating: boolean;
}

export interface FillConicGradient {
  readonly type: "conic_gradient";
  readonly gradient: ConicGradientDef;
}
```

Update `Fill` union to include `FillConicGradient`.

Add `repeating: boolean` to existing `GradientDef`.

- [ ] **Step 2: Add conic gradient rendering**

In `renderer.ts`, add `createConicGradientFill`:

```typescript
function createConicGradientFill(
  ctx: CanvasRenderingContext2D,
  gradient: ConicGradientDef,
  x: number, y: number, width: number, height: number,
): CanvasGradient {
  const cx = Number.isFinite(gradient.center.x) ? x + gradient.center.x * width : x + width / 2;
  const cy = Number.isFinite(gradient.center.y) ? y + gradient.center.y * height : y + height / 2;
  const angle = Number.isFinite(gradient.start_angle) ? gradient.start_angle * Math.PI / 180 : 0;
  const grad = ctx.createConicGradient(angle, cx, cy);
  for (const stop of gradient.stops) {
    if (Number.isFinite(stop.position)) {
      grad.addColorStop(Math.max(0, Math.min(1, stop.position)), resolveStopColorCSS(stop.color));
    }
  }
  return grad;
}
```

Add `case "conic_gradient":` to `resolveFillStyle`.

- [ ] **Step 3: Add conic CSS builder to gradient-utils**

```typescript
export function stopsToConicGradientCSS(
  stops: readonly GradientStop[],
  startAngleDeg = 0,
  repeating = false,
): string {
  const fn = repeating ? "repeating-conic-gradient" : "conic-gradient";
  // ... build CSS string
}
```

Also update `stopsToLinearGradientCSS` and add `stopsToRadialGradientCSS` to accept `repeating` flag:

```typescript
export function stopsToLinearGradientCSS(
  stops: readonly GradientStop[],
  angleDeg = 180,
  repeating = false,
): string {
  const fn = repeating ? "repeating-linear-gradient" : "linear-gradient";
  // ...
}
```

Add type conversion helpers: `toConic(fill)`, `fromConic(fill, targetType)`.

- [ ] **Step 4: Fix all TypeScript exhaustiveness errors**

Search for `switch (fill.type)` or `if (fill.type === ...)` patterns and add conic handling.

- [ ] **Step 5: Add tests**

- Canvas: node with conic_gradient fill renders correctly
- gradient-utils: conic CSS builder output
- gradient-utils: repeating CSS variants

- [ ] **Step 6: Commit**

```
feat(frontend): add conic gradient type, canvas rendering, and CSS builders (Spec 09e, Task 2)
```

---

## Task 3: GradientStopEditor — drag-off-to-remove

**Files:**
- Modify: `frontend/src/components/gradient-editor/GradientStopEditor.tsx`

- [ ] **Step 1: Add drag-off detection**

During `handleStopPointerMove`, track the vertical distance from the bar. If the pointer moves more than 30px above or below the bar, trigger removal:

```typescript
const barRect = barRef?.getBoundingClientRect();
if (barRect) {
  const distanceFromBar = Math.abs(e.clientY - (barRect.top + barRect.height / 2));
  if (distanceFromBar > 30 && stopsWithinLimit()) {
    // Remove this stop
    props.onRemoveStop(draggedId);
    setDraggingId(null);
    return;
  }
}
```

The stop marker should show a visual cue (e.g., reduced opacity, "×" cursor) when it's far enough to be removed.

- [ ] **Step 2: Add visual feedback during drag-off**

Track `isOverRemoveThreshold` signal. When true, the dragged stop marker gets a CSS class for visual feedback (semi-transparent, red border or similar).

- [ ] **Step 3: Add test**

Test: dragging a stop 40px vertically off the bar calls onRemoveStop. Test: cannot remove when only MIN_GRADIENT_STOPS remain.

- [ ] **Step 4: Commit**

```
feat(frontend): add drag-off-to-remove for gradient stops (Spec 09e, Task 3)
```

---

## Task 4: GradientEditorPopover — popover UX

**Files:**
- Create: `frontend/src/panels/GradientEditorPopover.tsx`
- Create: `frontend/src/panels/GradientEditorPopover.css`
- Modify: `frontend/src/panels/FillRow.tsx`
- Modify: `frontend/src/panels/GradientControls.tsx`

- [ ] **Step 1: Create GradientEditorPopover**

A component that wraps GradientControls inside a Kobalte Popover:

```typescript
interface GradientEditorPopoverProps {
  fill: FillLinearGradient | FillRadialGradient | FillConicGradient;
  onUpdate: (fill: Fill) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function GradientEditorPopover(props: GradientEditorPopoverProps) {
  return (
    <Popover
      trigger={<GradientSwatch fill={props.fill} />}
      triggerAriaLabel={t("panels:gradient.editGradient")}
      placement="bottom"
      preventDismissOnInteract={true}
    >
      <div class="sigil-gradient-editor-popover">
        <GradientControls
          fill={props.fill}
          onUpdate={props.onUpdate}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
        />
      </div>
    </Popover>
  );
}
```

`GradientSwatch` renders a small preview of the gradient as a CSS background (reuse `stopsToLinearGradientCSS` / radial / conic).

- [ ] **Step 2: Add gradient preview canvas to popover**

Add a 120×80px canvas inside the popover that renders the gradient using the same renderer functions. This gives an accurate preview (especially for radial/conic which CSS can't perfectly approximate in a swatch).

- [ ] **Step 3: Update GradientControls with conic tab and repeating toggle**

Add a third tab "Conic" to the type segmented control. Add conic-specific controls:
- Center X NumberInput (0–100%)
- Center Y NumberInput (0–100%)
- Start Angle NumberInput (0–360°)

Add a "Repeating" checkbox at the bottom of the controls.

Type conversion: add `toConic`/`fromConic` to the existing `toLinear`/`toRadial`/`toSolid` conversion functions in FillRow or GradientControls.

- [ ] **Step 4: Update FillRow to use popover**

Replace the inline `<GradientControls>` render in FillRow with a `<GradientEditorPopover>` trigger. The gradient swatch in the fill row opens the popover on click.

Add "Conic" to the fill type dropdown options.

- [ ] **Step 5: Add i18n strings**

Add to all three locale files (en/es/fr):
```json
"gradient.conic": "Conic",
"gradient.startAngle": "Start angle",
"gradient.editGradient": "Edit gradient",
"gradient.repeating": "Repeating",
"fill.typeConic": "Conic"
```

- [ ] **Step 6: Add styles**

```css
.sigil-gradient-editor-popover {
  width: 280px;
  padding: var(--size-3);
}

.sigil-gradient-editor-popover__preview {
  height: 80px;
  border-radius: var(--radius-2);
  margin-bottom: var(--size-3);
  border: 1px solid var(--border-1);
}
```

- [ ] **Step 7: Commit**

```
feat(frontend): add GradientEditorPopover with conic support and repeating toggle (Spec 09e, Task 4)
```

---

## Task 5: Tests + integration verification

**Files:**
- Create/modify: test files for new components

- [ ] **Step 1: GradientEditorPopover tests**

- Opens on swatch click
- Shows type tabs (Linear/Radial/Conic)
- Type switching calls onUpdate with correct fill type
- Repeating toggle updates fill
- Popover stays open during stop drag (preventDismissOnInteract)

- [ ] **Step 2: Conic gradient tests**

- Core: serde roundtrip for ConicGradientDef
- Canvas: createConicGradient called with correct args
- gradient-utils: conic CSS output
- FillRow: "Conic" appears in type dropdown

- [ ] **Step 3: Repeating gradient tests**

- CSS builder outputs `repeating-linear-gradient` when flag is true
- Toggle checkbox updates fill.gradient.repeating

- [ ] **Step 4: Run full test suites**

```bash
cargo test --workspace
pnpm --prefix frontend test
pnpm --prefix frontend lint
pnpm --prefix frontend build
```

- [ ] **Step 5: Commit**

```
test(frontend): add gradient editor redesign tests (Spec 09e, Task 5)
```

---

## Task 6: Browser verification

- [ ] **Step 1: Build and start**

- [ ] **Step 2: Test gradient popover**

- Create a rectangle
- Click fill type → "Linear" → gradient swatch appears
- Click swatch → popover opens with full editor
- Drag stops on the bar → gradient updates live
- Click empty area → new stop added
- Drag stop off bar vertically → stop removed
- Click stop color swatch → color picker opens (nested popover)
- Switch to "Conic" tab → conic gradient renders
- Toggle "Repeating" → popover preview shows repeating pattern
- Switch to "Radial" → concentric gradient
- Close popover → gradient persists
- Undo → gradient reverts

- [ ] **Step 3: Commit if needed**

```
test: browser verification for gradient editor redesign (Spec 09e, Task 6)
```

---

## Dependency Graph

```
Task 1 (core types) → Task 2 (frontend types + canvas rendering)
Task 2 → Task 4 (popover UX)
Task 3 (drag-off-to-remove) → Task 4
Task 4 → Task 5 (tests)
All → Task 6 (browser)
```

Tasks 1, 3 are independent starting points. Task 2 follows Task 1. Task 4 requires both 2 and 3.
