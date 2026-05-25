# Spec 14 — Corner Shapes

## Overview

Expands the current circular-only corner radius model into a full CSS-parity corner-shape system. Rectangle, Frame, and Image nodes gain per-corner control over **shape** (round, bevel, notch, scoop, superellipse) and **axis-asymmetric radii** (separate horizontal/vertical radii per corner). The canvas begins rendering corner radii for the first time (it currently does not — see §4.1 below).

**Depends on:** Spec 01 (core types — `NodeKind`, `FieldOperation`), Spec 02 (GraphQL mutations), Spec 03 (MCP tools), Spec 09 (properties panel infrastructure), Spec 13 (`ValueInput` for token + expression support on numeric fields).

This spec is decomposed into four sub-plans:
- **Plan 14a** — End-to-end data layer: core model, FieldOperation, GraphQL mutation, MCP tool, frontend store.
- **Plan 14b** — `Slider` wrapper component + governance rule: all Kobalte imports live inside `frontend/src/components/` wrappers.
- **Plan 14c** — Canvas rendering: `buildCornerPath`, per-shape algorithms, radius clamping, frame clipping.
- **Plan 14d** — Corner editor UI: hotspot preview, popover controls, composite smoothing control, design-schema integration.

---

## 1. Architecture

### 1.1 Data model (core crate)

Two new types in `crates/core/src/node.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CornerRadii {
    pub x: f64,  // horizontal radius (along top/bottom edges)
    pub y: f64,  // vertical radius  (along left/right edges)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Corner {
    Round        { radii: CornerRadii },
    Bevel        { radii: CornerRadii },
    Notch        { radii: CornerRadii },
    Scoop        { radii: CornerRadii },
    Superellipse { radii: CornerRadii, smoothing: f64 },
}
```

Three `NodeKind` variants change shape:

- `Rectangle { corner_radii: [f64; 4] }` → `Rectangle { corners: [Corner; 4] }`
- `Frame { layout }` → `Frame { layout, corners: [Corner; 4] }`
- `Image { … }` gains `corners: [Corner; 4]`

All three use `[TL, TR, BR, BL]` indexing — the existing ordering (see `frontend/src/panels/schemas/design-schema.ts:62-65`).

**Shorthand expansion lives only at the input boundary.** On-wire, in the store, and in persisted workfiles, every `Corner` carries fully-expanded `{x, y}` radii. Shorthand (`radius: 8` → `{x: 8, y: 8}`) is accepted by the MCP tool and the corner editor UI, then expanded before a `Corner` is constructed.

**Why discriminated enum:** the `smoothing` parameter is only meaningful for superellipse. A flat struct (`{shape, radius, smoothing}`) would silently ignore smoothing on other shapes and leak invalid states through the API. The enum makes invalid states impossible by construction and matches our existing `NodeKind` pattern with `#[serde(tag = "type")]`.

### 1.2 Commands (core crate)

Replaces existing `SetCornerRadii` with:

```rust
pub struct SetCorners {
    pub node_id: NodeId,
    pub new_corners: [Corner; 4],
}
```

Behavioral inventory for the removal (CLAUDE.md §11 "Behavioral Inventory Before Deleting Implementation Code"):

| Behavior of `SetCornerRadii` | Fate in `SetCorners` |
|------------------------------|----------------------|
| Node existence check | Preserved |
| Rectangle-only type check | **Relaxed**: Rectangle + Frame + Image |
| `radii[i].is_finite()` validation | Preserved, extended to both `x` and `y` |
| `radii[i] >= 0.0` validation | Preserved, extended to both `x` and `y` |
| Whole-field replacement semantics | Preserved |

New behaviors added:
- `smoothing` validation (finite, `0.0..=1.0`) — only on Superellipse variant.
- Per-corner shape dispatch (no additional logic — enum variant carries it).
- **Superellipse uniformity rule.** Superellipse must be applied at the whole-shape level. `validate` rejects:
  - Mixed arrays — if any corner is `Superellipse`, all four must be. Typed error: `InvalidCornerShape { reason: "superellipse must be applied uniformly to all four corners" }`.
  - Smoothing mismatch — when all four are `Superellipse`, their `smoothing` values must be equal. Typed error: `InvalidCornerShape { reason: "superellipse smoothing must match across all four corners" }`.
  - Per-corner radii MAY still differ under superellipse (asymmetric shapes are legitimate and match Figma).

  Rationale: superellipse's curvature bleeds along the adjacent edges, so a superellipse corner next to a bevel/notch/scoop corner produces a broken-looking kink. Figma and iOS both treat smoothing as a shape-level property for this reason. Storing per-corner (for CSS export fidelity) while constraining at `validate` gives us the best of both.

Single `FieldOperation` for all four corners because history-entry granularity is at the node level: the frontend `HistoryManager` captures the full `[Corner; 4]` before-state, and a single undo restores atomically.

### 1.3 Transport (server + mcp crates)

**GraphQL mutation** (`crates/server/src/graphql/mutation.rs`): rename `setCornerRadii` → `setCorners`, accepting a `[CornerInput; 4]`.

**MCP tool** (`crates/mcp/src/server.rs`): rename `set_corner_radii` → `set_corners`. Accepts three input shapes, ordered from most to least common agent use:

```jsonc
// 1. Uniform shorthand — same shape + radius on all four corners (most common)
{ "uuid": "...", "corners": { "shape": "round", "radius": 8 } }

// 2. Shape-level superellipse — required form for superellipse since it's whole-shape only
//    Either a single scalar radius, or per-corner radii, but shape + smoothing are shape-level.
{ "uuid": "...", "corners": { "shape": "superellipse", "radius": 8, "smoothing": 0.6 } }
{ "uuid": "...", "corners": {
    "shape": "superellipse",
    "smoothing": 0.6,
    "radii": [{"x": 8, "y": 8}, {"x": 12, "y": 12}, {"x": 12, "y": 12}, {"x": 8, "y": 8}]
}}

// 3. Full per-corner form — for mixing Round/Bevel/Notch/Scoop.
//    Superellipse is REJECTED in this form; use form 2 for superellipse.
{
  "uuid": "...",
  "corners": [
    { "shape": "round", "radii": { "x": 8,  "y": 8  } },
    { "shape": "bevel", "radii": { "x": 12, "y": 12 } },
    { "shape": "notch", "radii": { "x": 16, "y": 16 } },
    { "shape": "scoop", "radii": { "x": 4,  "y": 4  } }
  ]
}
```

The MCP tool's JSON schema description tells agents explicitly: *"To apply superellipse smoothing, use the shape-level form (#2). Superellipse cannot be mixed with other shapes on the same node."* This steers agents toward valid calls before they invoke the tool.

**Shorthand expansion lives in one shared helper** used by both the GraphQL resolver and the MCP tool (CLAUDE.md §11 "Validation Must Be Symmetric Across All Transports"). The helper expands shorthand to the canonical `[Corner; 4]` form, then the core `SetCorners::validate` runs — a single source of truth for the uniformity rule. Response payload is always the canonical expanded form so clients reconcile optimistic state against server-canonical values.

**Broadcast payload contract:** reuses the existing `set_field` op_type (the GraphQL `SetField` resolver already uses this for kind mutations today), unifying the shape across GraphQL and MCP:
```
op_type: "set_field"
path:    "kind"
value:   { type: "rectangle" | "frame" | "image", corners: [Corner, Corner, Corner, Corner], ...other kind fields }
```

The legacy MCP broadcast path `"kind.corner_radii"` (narrow-path variant) is removed — the GraphQL path-`"kind"` full-object form becomes the single broadcast shape. The matching `applyRemoteOperation` handler for `path: "kind"` in `frontend/src/operations/apply-remote.ts` is extended to handle the new corner data; the legacy `"kind.corner_radii"` case is deleted (CLAUDE.md §4 "MCP Broadcast Payload Shape Contract" + §11 "Migrations Must Remove All Superseded Code").

**Legacy `set_corner_radii` tool is fully removed**, not kept as an alias. CLAUDE.md §11 "Migrations Must Remove All Superseded Code" requires deleting:
1. The MCP tool definition and its handler.
2. The GraphQL mutation and its input type.
3. Any frontend types mentioning `corner_radii: [number; 4]`.
4. Broadcast payload handler for the old `op_type`.
5. Fixtures and mocks referencing the old schema.

### 1.4 Frontend store (frontend/)

TypeScript types mirror Rust (`frontend/src/types/document.ts`):

```typescript
export type CornerRadii = { x: number; y: number };

export type Corner =
  | { type: "round";        radii: CornerRadii }
  | { type: "bevel";        radii: CornerRadii }
  | { type: "notch";        radii: CornerRadii }
  | { type: "scoop";        radii: CornerRadii }
  | { type: "superellipse"; radii: CornerRadii; smoothing: number };
```

Store API (`frontend/src/store/document-store-solid.tsx`): replace `setCornerRadii(uuid, [n,n,n,n])` with `setCorners(uuid, corners: [Corner, Corner, Corner, Corner])`. Same debounced-mutation + optimistic-update pattern as today (CLAUDE.md §11 "Debounced Mutations Must Preserve Rollback Snapshots"). Pre-mutation snapshot captured before `produce()` per §11 "Capture Snapshots Before Mutations, Not After".

### 1.5 UI — the corner editor

Custom `<CornerSection />` component in the Design panel's Appearance tab. The existing schema-driven 4-input grid in `design-schema.ts:58-67` is replaced with a section that renders this component.

**Layout:**

1. **Shape preview** (~160 × 120 px): an SVG representation of the current `[Corner; 4]` state, scaled to fit. The preview is the selector.
2. **9 hotspot zones** along the preview's edge:
   - 4 corner hotspots (TL, TR, BR, BL) — edit that single corner.
   - 4 edge-midpoint hotspots (top, right, bottom, left) — edit the two connected corners.
   - 1 center hotspot — edit all four corners.
3. **Popover per hotspot** anchored to the hotspot element. Opens on click or Enter/Space. Contents depend on which hotspot:

   **Corner hotspots (TL/TR/BR/BL) and edge hotspots (top/right/bottom/left):**
   - Shape dropdown (wrapped `<Select>`) — options: Round, Bevel, Notch, Scoop. **Superellipse is NOT available here.**
   - Radius input — `<ValueInput>` from Spec 13, so tokens (e.g. `$radius-md`) and expressions work.
   - "Unlock axes" toggle (wrapped `<ToggleButton>`). When unlocked, radius splits into `rx` and `ry` fields, each a `ValueInput`.

   **Center hotspot (all four):**
   - Shape dropdown — options: Round, Bevel, Notch, Scoop, **Superellipse**.
   - Radius input (same as above; applies to all four corners).
   - "Unlock axes" toggle (same as above; applies to all four corners).
   - **Smoothing control** (conditional — only when shape = Superellipse): a composite of `ValueInput` (for tokens/expressions) + the new `<Slider>` wrapper (Plan 14b), rendering side-by-side. Literal mode: dragging the slider scrubs the number. Token/expression mode: slider is disabled with a tooltip; its position reflects the resolved value read-only.

**Superellipse lock state.** When the current shape state is superellipse (all four corners are `Corner::Superellipse`), the 4 corner hotspots and 4 edge hotspots are rendered disabled — non-focusable, with a tooltip on hover/focus: *"Superellipse applies to all corners. Change the shape to edit corners individually."* Only the center hotspot remains active. Switching the center hotspot's shape picker away from Superellipse re-enables per-corner editing.

**Multi-select is not in v1.** Each popover edits exactly the hotspot's target set (1, 2, or 4 corners). Users change all four via the center hotspot.

**Auto-link behavior:**
- On load, if all four corners are identical, the section opens in a visually "linked" state (center hotspot shows as active).
- If the current shape is Superellipse, the shape is *always* in linked state — per-corner hotspots are disabled per the lock state above.
- If one corner has `x != y`, the "unlock axes" toggle in its popover is pre-activated.

**Accessibility:**
- Every hotspot is a focusable `<button>` with `aria-label` describing its target (e.g. "Edit top-right corner", "Edit all corners").
- Popover uses the wrapped `<Popover>` component (focus trap + restore + dismiss on outside click / Escape — provided by the wrapper).
- The shape preview `<svg>` has `role="img"` and an `aria-label` summarizing the current corner state in text (e.g. "Rectangle with round top corners, bevel bottom corners").
- All interactive primitives are keyboard-navigable with Tab / Enter / Space / Escape.

**Viewport drag-handles (future scope, not in this spec's plans):**
- When a rect-shaped node is selected on canvas, render 4 corner drag handles that scrub radius on drag.
- Shape picker stays in the sidebar.
- Data model is stable across this extension — no core changes required.

### 1.6 Plan 14d execution commitments (decided at brainstorm)

These supplement §1.5 with architectural decisions made during 14d planning. They do not change the user-facing design; they pin down implementation specifics that affect file layout, code sharing, and testing.

- **SVG preview path generation reuses Plan 14c geometry.** Plan 14d adds an `SvgPathBuilder` class that implements the same structural `PathBuilder` interface as `Path2D` in `frontend/src/canvas/corner-path.ts`. The same `appendCornerPath` orchestrator drives both Canvas and SVG output. Parity is enforced by a vitest that runs both builders against shared fixtures. No separate corner-geometry implementation for SVG — single source of truth.
- **Tab placement.** CornerSection lives in the Appearance tab of `DesignPanel.tsx`, alongside the existing `TypographySection` and `AppearancePanel`. The current "Corner Radius" entry in `frontend/src/panels/schemas/design-schema.ts` is removed; CornerSection is a dedicated component (matching the AppearancePanel / TypographySection / EffectsPanel pattern), not a new schema escape hatch.
- **Hotspot affordance is reveal-on-hover/focus.** The 9 hotspot buttons are invisible by default; visible when the section receives `:hover` or `:focus-within`. This is the v1 default — easily swapped to "always visible" later based on user feedback, since the swap is purely a CSS rule.
- **Hotspot substrate is HTML buttons absolutely positioned over the SVG.** Not SVG `<rect>` children. Native `<button>` semantics, keyboard activation, and focus management come for free.
- **Component decomposition** (under `frontend/src/panels/corner-section/`):
  - `CornerSection.tsx` — section frame, state orchestration, self-gating by node kind
  - `CornerPreviewSvg.tsx` — preview SVG + hotspot overlay
  - `CornerPopover.tsx` — popover contents (shape picker, radius ValueInput, axis-unlock toggle, conditional smoothing control)
  - `corner-svg-builder.ts` — `SvgPathBuilder` implementing PathBuilder
  - `__tests__/` — component, a11y, parity, and pipeline tests
- **Smoothing calibration is lightweight self-review for v1.** Storybook story renders the smoothing scale (s ∈ {0, 0.25, 0.5, 0.75, 1.0}) for visual inspection during 14d implementation. The implementer eyeballs and tunes `BLEED_AT_S1` if needed. No external designer review blocks 14d. The constants are subject to recalibration in a future PR based on user feedback per §3.7.
- **Mixed-state popover.** When an edge or center hotspot opens against corners with mixed shapes (e.g., TL=Round, TR=Bevel under the top-edge hotspot), the shape picker shows a "Mixed" indicator and the radius shows blank. Committing a new value writes uniformly to every targeted corner.

---

## 2. Kobalte wrapper governance (Plan 14b)

All `@kobalte/core/*` imports must live inside `frontend/src/components/<wrapper>/` directories. Consumer code (panels, canvas, tools, stores) imports from the project wrapper (`components/popover/Popover.tsx`), never directly from `@kobalte/core/*`.

**Why:** Direct Kobalte imports scattered across the app create silent drift — when interaction fixes, a11y improvements, or styling updates land on a wrapped primitive, call sites that bypassed the wrapper never get those updates. Wrapping ensures every improvement applies everywhere.

Plan 14b lands this rule in CLAUDE.md §5 and/or `.claude/rules/frontend-defensive.md` (Governance agent picks the right location) together with the new `<Slider>` wrapper — the rule's first enforced application.

**Slider wrapper** (`frontend/src/components/slider/Slider.tsx`):
- Wraps `@kobalte/core/slider`.
- Project API: `value`, `onChange(value)`, `min`, `max`, `step`, `disabled`, `class`, `ariaLabel`, `ariaValueText`.
- CSS file, Storybook story, Vitest tests following the pattern of existing wrappers (e.g. `components/popover/`).

---

## 3. Canvas rendering (Plan 14c)

### 3.1 The rendering gap

Today `drawNode` in `frontend/src/canvas/renderer.ts` renders Rectangle, Frame, and Image using `ctx.fillRect(x, y, width, height)`. Corner radii are stored in the data model but **never drawn**. Additionally — and not previously captured in this spec — **frames do not clip their children**. The renderer iterates a flattened render-order array of nodes and paints each in turn without any save/clip/restore around frame subtrees. A frame with a beveled corner therefore shows the bevel only on its own paint; the moment any child overflows the frame's bounds, the bevel becomes visually invisible because the child renders past it. Corner shapes are essentially decorative-on-the-frame's-own-paint without clipping.

Plan 14c closes both gaps: path-based shape rendering for rect/frame/image, and frame child clipping using the corner-shape path.

### 3.2 Path construction

New helper `frontend/src/canvas/corner-path.ts`:

```typescript
export function buildCornerPath(
  x: number, y: number, width: number, height: number,
  corners: readonly [Corner, Corner, Corner, Corner],
): Path2D;
```

Each corner contributes one arc or polyline segment; edges between corners are always straight. Per-shape algorithms:

- **Round** — `path.ellipse(cx, cy, rx, ry, 0, startAngle, endAngle)`. Matches CSS circular/elliptical border-radius.
- **Bevel** — single `lineTo(cornerPoint)` diagonal cut. Uses `rx` and `ry` as offsets along the two adjacent edges.
- **Notch** — two straight segments forming a square step inward: `in by rx along one edge`, `over by ry perpendicular`, `back out`. Axis-asymmetry supported natively.
- **Scoop** — same ellipse math as round but with the sweep direction reversed (concave arc).
- **Superellipse** — cubic beziers per corner approximating a squircle. `smoothing = 0` collapses to the same geometry as the round case (circular/elliptical arc approximation, kappa ≈ 0.5522). `smoothing = 1` produces curvature that bleeds further along the adjacent edges (Apple/Figma-style smoothing). Intermediate values linearly interpolate the bezier control-point offsets between these two anchors. Radii asymmetry scales control points independently on x and y. **v1 ships a credible approximation, not a pixel-perfect Figma/iOS match** — see §3.7 design decisions.

Each algorithm lives in its own pure helper function (`appendRoundCorner`, `appendBevelCorner`, etc.) so it's unit-testable against Path2D instruction sequences.

### 3.3 Radius clamping

CSS rule: if the sum of two adjacent corners' radii on an edge exceeds that edge length, all corner radii on the node scale down by the same factor so the largest offender fits.

Implemented as a single pre-pass inside `buildCornerPath`:
1. Compute each edge's radii sum (`rx_left + rx_right` for top edge, etc.).
2. Compute `scale = min(1, edge_len / radii_sum)` for each of the 4 edges.
3. Multiply every corner's `rx`/`ry` by the minimum scale.

Clamping is a **render-time** operation — stored radii remain what the user typed, so a later resize can reveal them again. Not a mutation.

### 3.4 Numeric guards

Every helper that uses `Math.sqrt`, `Math.asin`, `Math.acos`, `Math.pow` with a fractional exponent guards its domain at function entry (CLAUDE.md §11 "Math Helpers Must Guard Their Domain"). Every numeric result flowing into a Canvas 2D path call passes `Number.isFinite` (§11 "Floating-Point Validation").

### 3.5 Fill, stroke, clip — and frame child clipping (new)

- **Fill**: existing per-fill loop in `drawNode` constructs the path once, then each fill does `ctx.fill(path)`. Replaces the `fillRect` call.
- **Stroke**: the stroke rendering pipeline (separate from fills) uses the same `Path2D`. Centered-stroke offset logic continues to work — the new path is a drop-in replacement.
- **Frame child clipping (new in 14c).** The render loop in `render()` (`frontend/src/canvas/renderer.ts`) receives nodes in depth-first parent-then-children order via `buildRenderOrder()`. Plan 14c threads a "clip stack" through the loop:
  - On entering a `frame` node: call `ctx.save()`, then `ctx.clip(buildCornerPath(...))` using the frame's transform + corner data. Push the frame's UUID onto the clip stack.
  - Before drawing each node: while the next node's ancestry chain does NOT include the top-of-stack frame UUID, `ctx.restore()` and pop. This emits restores when the iterator leaves a frame's subtree.
  - At end of frame loop: drain remaining stack with `ctx.restore()` calls.
  - Groups do NOT push a clip — `group` nodes are containers without their own bounds (Figma semantics).
- **Recursion safety:** the clip stack depth is bounded by `MAX_RENDER_DEPTH = 64` (already enforced in `buildRenderOrder`). No additional limit needed; the same constant gates both.

### 3.6 Hit-testing

Stays AABB-based for v1. Picking a rectangular region containing the shape matches Figma behavior — clicking the empty area in a bevel or scoop corner still selects the node. Path-level hit-test can be a future enhancement if user demand surfaces.

### 3.7 Design decisions (CLAUDE.md §1 Design Decision Criteria)

This spec section was expanded during Plan 14c brainstorming after discovering that the originally-stated "replace `ctx.rect; ctx.clip` with `ctx.clip(path)`" understated the work — no clipping existed at all. Three decisions worth recording:

- **Frame child clipping is in-scope for Plan 14c, not deferred.** Corner shapes without frame clipping are decorative-on-paint only — the moment a child overflows, the shape becomes visually invisible. A Frame that does not clip is functionally a Group. Including clipping in 14c is the difference between corner shapes being a real UX feature and being half-baked data. Correctness > Simplicity (CLAUDE.md §1).
- **Superellipse smoothing in v1 ships a credible approximation, not pixel-perfect Figma matching.** Calibrating to Figma's exact bezier constants requires either reverse-engineering Figma's renderer or extensive designer-in-the-loop tuning. The data layer (Plan 14a) already validates smoothing ∈ [0, 1]; the visual fidelity can sharpen post-merge through designer feedback without a schema change. v1 uses linear interpolation between kappa = 0.5522 (s=0) and a chosen bleed length (s=1) tuned to be visually plausible. Calibration against iOS/Figma references is a tracked follow-up after designer review.
- **Test strategy: Path2D instruction snapshots, not pixel snapshots.** "Golden pixel tests" would require installing the heavy `canvas` npm package (libcairo bindings) plus an image-snapshot library, with cross-platform brittleness. Instead: pure geometry helpers are tested by snapshotting the sequence of canvas operations (`moveTo` / `lineTo` / `bezierCurveTo` / `ellipse`) they emit — for pure deterministic geometry, instruction sequence == output. The renderer integration test uses a recorder-mock of `CanvasRenderingContext2D` to verify call ordering (path → fill → stroke; save → clip → child draws → restore). Visual fidelity QA happens via Storybook stories in Plan 14d. Simplicity + Robustness over pixel-level coverage that we don't have infrastructure for.

---

## 4. Testing

### 4.1 Core (Plan 14a)

- `test_set_corners_validate_and_apply` — the standard `FieldOperation` contract test (CLAUDE.md §1).
- One test per `Corner` variant (round, bevel, notch, scoop, superellipse) covering `validate` + `apply`.
- `test_set_corners_rejects_nan_radius`, `test_set_corners_rejects_negative_radius`, `test_set_corners_rejects_infinite_radius` — for both `x` and `y`.
- `test_set_corners_rejects_out_of_range_smoothing` (below 0 and above 1).
- `test_set_corners_rejects_mixed_superellipse` — one corner Superellipse, three others Round. Expect `InvalidCornerShape` with the uniformity reason.
- `test_set_corners_rejects_superellipse_smoothing_mismatch` — all four Superellipse but smoothing differs. Expect `InvalidCornerShape` with the smoothing-match reason.
- `test_set_corners_accepts_uniform_superellipse_with_asymmetric_radii` — all four Superellipse, same smoothing, different `{x, y}` per corner. Expect success.
- `test_set_corners_rejects_non_rect_shaped_node` (Ellipse, Text, Group, Component instance).
- `test_max_corner_radius_enforced`, `test_min_corner_smoothing_enforced`, `test_max_corner_smoothing_enforced` — constant enforcement tests (CLAUDE.md §11).
- `test_corner_deserialize_rejects_nan_radii`, `test_corner_deserialize_rejects_duplicate_keys` — custom deserializer tests.
- Workfile migration: `test_legacy_corner_radii_migrates_to_round_corners`.

### 4.2 Transport (Plan 14a)

- MCP tool: `test_set_corners_uniform_shorthand_expansion` (scalar → `{x, y}`), `test_set_corners_superellipse_shape_level_form`, `test_set_corners_full_per_corner_form`, `test_set_corners_rejects_superellipse_in_full_per_corner_form`, `test_set_corners_rejects_shorthand_with_smoothing_on_non_superellipse`.
- GraphQL resolver: equivalent coverage. Both use the shared helper so a single helper-level test suite covers shorthand logic.
- Broadcast: `test_set_corners_broadcasts_to_other_clients`.

### 4.3 Canvas (Plan 14c)

Per §3.7, tests use **Path2D instruction snapshots** for pure geometry helpers and a **CanvasRenderingContext2D recorder-mock** for renderer integration. No pixel snapshots, no `canvas` npm package, no cross-platform image-diff brittleness.

**Pure helpers in `corner-path.test.ts`:**

- `test_build_round_corners_uniform_radii` — snapshot the recorded operation sequence for a 100×100 rect with all-round 16/16 corners. Asserts the sequence: `moveTo` → `ellipse` × 4 → `closePath`.
- `test_build_bevel_corners_uniform_radii` — same, asserts `lineTo` × 8 (4 edges × 2 segments each: corner-cut + edge).
- `test_build_notch_corners` — asserts the two-segment step inward per corner.
- `test_build_scoop_corners` — asserts ellipse with reversed sweep direction (concave).
- `test_build_superellipse_corners_smoothing_0` — at smoothing = 0, the bezier control points should produce a path visually indistinguishable from round (kappa = 0.5522 anchor).
- `test_build_superellipse_corners_smoothing_1` — at smoothing = 1, control points are at the "bleed length" extreme.
- `test_build_superellipse_corners_smoothing_0_5` — interpolation midpoint; assert control points are halfway between the s=0 and s=1 values.
- `test_build_corners_clamps_when_radii_exceed_edge` — input 60×40 rect with all-round 40/40 corners. Expect clamping: top edge has 40+40 = 80 > 60, so scale = 60/80 = 0.75. Asserts ellipse calls use rx=30, not 40.
- `test_build_corners_clamps_minimum_axis` — asymmetric radii: top edge {x: 40, y: 10} corners with edge length 50 must clamp x to 25 each, leaving y unchanged.
- `test_build_corners_mixed_shapes` — one rect with round/bevel/notch/scoop in the 4 corners; assert the per-corner branch in the operation sequence.
- `test_corner_path_rejects_non_finite_dimensions` — `buildCornerPath(NaN, 0, 100, 100, ...)` should produce a defined fallback (empty path) and emit a structured `console.warn` per the frontend-defensive rule. Equivalent test for Infinity.
- `test_corner_path_rejects_non_finite_radii` — same for a corner whose `radii.x` is NaN.

**Per-shape `Math.*` domain guard tests** (one per helper that calls `Math.sqrt`/`Math.pow`/`Math.asin`/`Math.acos`):

- `test_superellipse_helper_guards_math_pow_domain` — exercise inputs that would produce a negative base under fractional exponent and assert the helper returns a degenerate-but-defined value (no NaN escapes).

**Renderer integration in `renderer.test.ts` (using recorder mock):**

- `test_drawNode_rectangle_uses_corner_path` — render a Rectangle node, assert the recorder captured `ctx.fill(<Path2D>)`, NOT `ctx.fillRect`. The recorder must capture the Path2D identity so the test can correlate it with a separately-built reference path.
- `test_drawNode_frame_with_round_corners_clips_children` — render a parent Frame with round 16/16 corners and a child Rectangle. Assert the operation sequence: `save` → `clip(framePath)` → child `fill(rectPath)` → `restore`.
- `test_drawNode_group_does_not_clip_children` — group is NOT a clip boundary; assert NO `save`/`clip`/`restore` pair around the group's subtree.
- `test_drawNode_nested_frames_stack_clip` — Frame A contains Frame B contains Rect. Assert nested `save`/`clip`/`save`/`clip`/draw/`restore`/`restore` ordering.
- `test_drawNode_clip_stack_drains_on_loop_exit` — last node in render order is a child of a frame; assert the loop's final `restore` is called before `render()` returns.
- `test_drawNode_clip_uses_max_render_depth_guard` — render a 65-deep frame chain (exceeds MAX_RENDER_DEPTH=64); assert traversal stops with a structured `console.warn`, no stack overflow.

**Visual QA (Plan 14d Storybook):**

- 14d adds Storybook stories rendering each shape on a Frame containing a child that would overflow without clipping. Manual designer review compares against iOS / Figma reference for superellipse-smoothing acceptance (per §3.7 — calibration is a 14d-time tuning loop, not blocked by 14c shipping a v1 approximation).

### 4.4 UI (Plan 14d)

- `<CornerSection />` Storybook stories covering: all-round default, mixed shapes, axis-unlocked corner, superellipse with smoothing.
- Vitest component tests: popover opens on hotspot click, shape picker updates the targeted corners, link/unlink state reflects corner identity, keyboard navigation (Tab → Enter → Select → Escape).
- A11y test: every hotspot has a unique `aria-label`, shape preview `<svg>` has `role="img"` with `aria-label`.
- Pipeline test (CLAUDE.md §11 "Reactive Pipelines Must Be Verified End-to-End"): shape picker change → store mutation → canvas re-render → visible corner shape change.

---

## 5. Migration

Only Rectangle has a legacy field today. Frame and Image currently have no corner radius field at all — they gain one for the first time in this spec.

**Rectangle** — Workfile loader (`crates/core/src/serialize.rs`) detects legacy `corner_radii: [r0, r1, r2, r3]` and maps to:

```rust
corners: [
    Corner::Round { radii: CornerRadii { x: r0, y: r0 } },
    Corner::Round { radii: CornerRadii { x: r1, y: r1 } },
    Corner::Round { radii: CornerRadii { x: r2, y: r2 } },
    Corner::Round { radii: CornerRadii { x: r3, y: r3 } },
]
```

**Frame and Image** — no migration data exists. The loader inserts `[Round { radii: {x:0, y:0} } × 4]` (visually identical to today's rendering, since canvas rendering ignored corners before §3).

Workfile schema version bumps by 1. No runtime-detected conversion — the loader produces the new format on load, and the next save persists it.

No migration for in-memory state: a session-wide schema change happens on file load; the store never sees the legacy shape.

---

## 6. WASM Compatibility

- `Corner` and `CornerRadii` are plain `f64` + derived serde. No new dependencies.
- No `Send` / `Sync` / `'static` trait bounds added in the core crate.
- No I/O, no randomness, no system calls.
- Canvas 2D path construction and superellipse bezier math live in `frontend/` only — outside the WASM boundary.

---

## 7. Input Validation Inventory

| Field | Type | Constraint |
|-------|------|------------|
| `CornerRadii.x` | `f64` | finite; `0.0 ..= MAX_CORNER_RADIUS` (100 000.0) |
| `CornerRadii.y` | `f64` | finite; `0.0 ..= MAX_CORNER_RADIUS` |
| `Corner::Superellipse.smoothing` | `f64` | finite; `MIN_CORNER_SMOOTHING ..= MAX_CORNER_SMOOTHING` (0.0 ..= 1.0) |
| `[Corner; 4]` (Rectangle/Frame/Image) | array | fixed length 4, validated element-wise |

**No string or path fields.** No collection capacity limits (fixed-length array). No deserialization depth changes. No recursion introduced.

**Cross-field invariants** (all enforced in `SetCorners::validate` and any deserializer that produces `[Corner; 4]`):

1. **Variant-local.** Smoothing cannot exist on non-superellipse corners — the enum variant IS the guard.
2. **Superellipse uniformity.** If any element of `[Corner; 4]` is `Corner::Superellipse`, all four must be `Corner::Superellipse`. A mixed array is rejected with `InvalidCornerShape { reason: "superellipse must be applied uniformly to all four corners" }`.
3. **Superellipse smoothing parity.** When all four corners are `Corner::Superellipse`, their `smoothing` values must be equal. A mismatched array is rejected with `InvalidCornerShape { reason: "superellipse smoothing must match across all four corners" }`. Per-corner radii may differ under superellipse — only shape and smoothing are uniform.

Custom `Deserialize` for `Corner` rejects duplicate keys (CLAUDE.md rust-defensive "Deserialization Boundaries Must Match Validation Rules").

**Shorthand expansion** happens only at the MCP/GraphQL input boundary; internal `Corner` construction requires fully-expanded `{x, y}` values. Validation is symmetric across both transports via a shared helper.

---

## 8. PDR Traceability

- **Implements** roadmap M2 item 2.2 (Corner shape types — elliptical, chamfer/bevel, notch, scoop, superellipse).
- **Exceeds** roadmap scope by modeling per-corner axis-asymmetric radii (`CornerRadii { x, y }`) beyond Figma parity. Justified by CSS export requirements when that ships.
- **Defers** percentage token support for the smoothing parameter — smoothing accepts a literal `f64` via `ValueInput`. Token-type extension will ship when percentage tokens land (not currently planned).
- **Defers** viewport drag-handle corner manipulation. Documented as future scope in §1.5; data model is stable across this extension.
- **Defers** path-level hit-testing. Renderer uses AABB hit-testing, same as today.

---

## 9. Consistency Guarantees

- `SetCorners` is **atomic** — single field assignment on `node.kind.corners` replaces all four corners together or nothing changes. No partial state is representable.
- **Pre-condition invariant:** `node.kind` is Rectangle, Frame, or Image. Validated before `apply`.
- **Post-condition invariant:** `node.kind.corners` is `[Corner; 4]` where every `Corner` satisfies validation rules in §7.
- **Rollback:** none needed. Single-field set, no partial application possible.
- **History:** the frontend `HistoryManager` captures the full `[Corner; 4]` before-state via the standard `set_field` operation mechanism (CLAUDE.md §11 "Capture Snapshots Before Mutations, Not After"). Undo restores atomically.
- **Batching:** N/A — single-node, single-field operation. No multi-item rollback concerns.

---

## 10. Recursion Safety

No new recursive data structures. No new recursive algorithms.

The canvas render path walks corners with a fixed `for i in 0..4` loop in `buildCornerPath`. Superellipse bezier construction is unrolled into 4 per-corner segments with no recursion.

Depth inventory: N/A.

---

## 11. Tool Lifecycle Contract

N/A — Spec 14 introduces no new canvas tools. The corner editor is a property edit surface in the sidebar; canvas selection and shape-tool behavior are unchanged.

---

## 12. Sub-plan summary

| Plan | Scope | Key deliverables |
|------|-------|------------------|
| **14a** | Data layer end-to-end | `Corner` / `CornerRadii` types (Rust + TS), `SetCorners` FieldOperation, GraphQL mutation, MCP tool, `setCorners` store fn, `applyRemoteOperation` handler, workfile migration, legacy `SetCornerRadii`/`set_corner_radii` deleted. |
| **14b** | UI primitive governance | `<Slider>` wrapper in `frontend/src/components/slider/`, governance rule added to CLAUDE.md §5 and/or `.claude/rules/frontend-defensive.md`, optional CI grep for direct `@kobalte/core` imports outside `components/`. |
| **14c** | Canvas rendering | `buildCornerPath` helper, per-shape algorithms, radius clamping pre-pass, `drawNode` switch to `fill(path)`, frame clipping uses rounded path, golden tests. |
| **14d** | Corner editor UI | `<CornerSection />` with hotspot preview, popover per hotspot, composite smoothing control (`ValueInput` + `Slider`), link/unlock behavior, design-schema integration, Storybook + tests. |

Plan 14a must land first (it provides the data layer). Plans 14b and 14c are parallelizable. Plan 14d depends on all three.

---

## 13. Deferred review findings (from Plan 14a)

The Plan 14a `/review` pass surfaced findings that align with work already scoped to later sub-plans. Rather than ship interim UI that 14d throws away, the items below are explicitly deferred and their target sub-plan owns the fix. Each must be acknowledged as in-scope for the receiving plan before the receiving plan is considered ready for review.

Persisted source: `docs/superpowers/reviews/2026-04-26-corner-shapes-14a.md`.

### Deferred to Plan 14d (UI — corner editor)

The `<CornerSection />` design in §1.5 already addresses these. They are recorded here so Plan 14d's review checklist includes them as acceptance criteria.

| Finding | Severity | Title | What 14d must deliver |
|---------|----------|-------|------------------------|
| **RF-002** | Critical | 4 new corner shapes unreachable from the UI | Shape selector exposing Round / Bevel / Notch / Scoop in per-corner and per-edge popovers; Round / Bevel / Notch / Scoop / Superellipse in the center popover. (§1.5 already specifies this.) |
| **RF-025** | Medium | Current corner shape invisible to user | Shape preview SVG (§1.5 layout item 1) communicates the active per-corner shape — covers the "MCP agent set Bevel and the panel shows nothing" gap. |
| **RF-026** | Medium | Linked-corners rule implicit and unobservable | Center hotspot + per-hotspot popover model (§1.5) makes the link state explicit. The auto-link behavior in §1.5 must visibly reflect identity across all four corners. |
| **RF-027** | Medium | Superellipse-must-be-uniform constraint not communicated client-side | §1.5 "Superellipse lock state" — per-corner / per-edge popovers omit Superellipse; only the center popover offers it. Lock-state tooltip must surface when a non-center hotspot is focused while shape state is Superellipse. |
| **RF-038** | Low | Section disappears for non-rectangular kinds | When the selected node's kind is not Rectangle/Frame/Image, the corner section must render disabled with a tooltip explaining "Corner radius applies to rectangles, frames, and images only" (rather than vanishing). |

### Deferred to Plan 14c (canvas rendering)

| Finding | Severity | Title | What 14c must deliver |
|---------|----------|-------|------------------------|
| **RF-011** | High (deferral) | Renderer ignores `node.kind.corners` | §3 (`buildCornerPath`, per-shape path construction, radius clamping, `drawNode` switch to `fill(path)`, frame clipping). 14c's PR description must explicitly close this finding. |

### Tracked outside sub-plans

| Finding | Severity | Title | Disposition |
|---------|----------|-------|-------------|
| **RF-020** | Medium | `[Corner; 4]` is 4× the in-memory size of legacy representation | Accepted with documentation. See §14 "Performance Considerations" below. A niche representation (separate discriminant + radii arrays) is rejected for v1 because the discriminated `Corner` enum is the source of variant-local invariants — splitting them weakens the type-level guard described in §7. Re-evaluate if profiling at 1000-node documents shows measurable impact. |

---

## 14. Performance Considerations

### Memory footprint (added by Plan 14a)

| Type | Size on x86_64 | Per-node cost |
|------|---------------|---------------|
| `Corner` enum | 32 bytes | — |
| `[Corner; 4]` | 128 bytes | replaces the prior `[f64; 4]` (32 bytes) on Rectangle |

Net effect on memory: rectangles, frames, and images each carry 96 additional bytes. At 1 000 nodes: +96 KB. Within the workspace's "design for 1 000-node documents at 60 fps" envelope. Profiling has not detected a measurable hot-path regression.

The shorthand `Serialize` representation (RF-021, fixed in Plan 14a) keeps the on-disk and on-wire JSON compact when all four corners are identical Round/x==y — the common case — so persistence and broadcast costs are unchanged from the legacy format for that case.
