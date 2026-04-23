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

**Broadcast payload contract:**
```
op_type: "set_corners"       // was "set_corner_radii"
path:    "kind"
value:   { corners: [Corner, Corner, Corner, Corner] }
```

The matching `applyRemoteOperation` handler in `frontend/src/operations/apply-remote.ts` lands in the same PR (CLAUDE.md §4 "MCP Broadcast Payload Shape Contract").

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

Today `drawNode` in `frontend/src/canvas/renderer.ts:236-254` renders Rectangle, Frame, and Image using `ctx.fillRect(x, y, width, height)`. Corner radii are stored in the data model but **never drawn**. Spec 14 closes this gap as a prerequisite for supporting any shape beyond `round, radius: 0`.

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
- **Superellipse** — cubic beziers per corner approximating a squircle. `smoothing = 0` collapses to the same geometry as the round case (circular/elliptical arc approximation). `smoothing = 1` produces Apple-style G2-continuous curvature bleeding along the adjacent edges. Intermediate values interpolate the control-point offsets between these two anchors. Exact constants (circular-arc kappa ≈ 0.5522, squircle bleed length) and the interpolation curve are a Plan 14c deliverable — derive against reference renders from iOS / Figma's corner smoothing, not from a formula stated up-front. Radii asymmetry scales control points independently on x and y.

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

### 3.5 Fill, stroke, clip

- **Fill**: existing per-fill loop in `drawNode` constructs the path once, then each fill does `ctx.fill(path)`. Replaces the `fillRect` call.
- **Stroke**: the stroke rendering pipeline (separate from fills) uses the same `Path2D`. Centered-stroke offset logic continues to work — the new path is a drop-in replacement.
- **Clip**: frames clipping their children today use `ctx.rect(...); ctx.clip();`. Replace with `ctx.clip(path)` so children clip to the rounded/beveled frame outline, not a plain AABB.

### 3.6 Hit-testing

Stays AABB-based for v1. Picking a rectangular region containing the shape matches Figma behavior — clicking the empty area in a bevel or scoop corner still selects the node. Path-level hit-test can be a future enhancement if user demand surfaces.

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

- Golden pixel tests per shape × (axes locked / unlocked) × 2 radii sizes in `frontend/src/canvas/__tests__/renderer.test.ts`.
- `test_radius_clamping_when_sum_exceeds_edge` — renders a node with oversized radii and verifies the output matches a clamped version.
- `test_mixed_shapes_per_corner_render` — one rectangle with round/bevel/notch/scoop on the 4 corners.
- `test_superellipse_smoothing_varies_curvature` — render at smoothing = 0, 0.5, 1.0 and verify visible divergence.
- Frame clipping: `test_frame_clip_uses_corner_path` — children of a rounded frame are clipped to the rounded outline.

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
