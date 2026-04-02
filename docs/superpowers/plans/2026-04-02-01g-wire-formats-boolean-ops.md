# Wire Formats & Boolean Path Operations — Implementation Plan (01g)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement SerializableCommand/BroadcastCommand tagged enums for command wire formats, and boolean path operations (union, subtract, intersect, exclude) using the `i_overlay` crate.

**Architecture:** Two independent subsystems. Wire formats: two serde-enabled enums (`SerializableCommand` with full undo state, `BroadcastCommand` with forward-only state) that mirror all 21 command types. Boolean ops: a `boolean.rs` module wrapping `i_overlay` with bezier-to-polyline approximation and back, with safety limits on iteration count. Both are pure logic, no I/O, WASM-compatible.

**Tech Stack:** Rust 1.94.1 (edition 2024), serde, serde_json, i_overlay (default features only — no `allow_multithreading`), uuid (no v4), thiserror

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. Rules in CLAUDE.md take precedence over code in this plan if they conflict.

---

## File Structure

```
crates/core/
├── Cargo.toml           # MODIFY: add i_overlay dependency
├── src/
│   ├── wire.rs          # NEW: SerializableCommand, BroadcastCommand enums
│   ├── boolean.rs       # NEW: BooleanOp enum, boolean_op function
│   ├── lib.rs           # MODIFY: add wire and boolean modules, re-exports
│   └── validate.rs      # MODIFY: add boolean op constants
```

---

## Task 1: Add `i_overlay` dependency

**Files:**
- Modify: `crates/core/Cargo.toml`

- [ ] 1. Read `CLAUDE.md` in full. Identify all dependency rules.

- [ ] 2. Add `i_overlay` to `crates/core/Cargo.toml` under `[dependencies]`:

```toml
i_overlay = { version = "4", default-features = false }
```

Use `default-features = false` to ensure no optional features (like `allow_multithreading`) are pulled in. The crate is `no_std` with `alloc` — fully WASM-compatible.

- [ ] 3. Verify it compiles:

```bash
cargo check -p agent-designer-core
```

- [ ] 4. Verify WASM compatibility:

```bash
cargo check --target wasm32-unknown-unknown -p agent-designer-core
```

If the WASM target is not installed, install it first: `rustup target add wasm32-unknown-unknown`

- [ ] 5. Commit:

```bash
git add crates/core/Cargo.toml Cargo.lock
git commit -m "feat(core): add i_overlay dependency for boolean path operations (spec-01)"
```

---

## Task 2: Implement boolean path operations

**Files:**
- Create: `crates/core/src/boolean.rs`
- Modify: `crates/core/src/validate.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Add boolean op constants to `validate.rs`:

```rust
/// Maximum number of points in a polyline approximation for boolean operations.
pub const MAX_BOOLEAN_OP_POINTS: usize = 1_000_000;

/// Number of segments to approximate a cubic bezier curve for boolean operations.
pub const BEZIER_APPROXIMATION_SEGMENTS: usize = 16;
```

- [ ] 3. Create `crates/core/src/boolean.rs`:

```rust
// crates/core/src/boolean.rs

use i_overlay::core::fill_rule::FillRule as IFillRule;
use i_overlay::core::overlay::ShapeType;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::f64::overlay::F64Overlay;
use i_overlay::f64::shape::F64Path;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::node::Point;
use crate::path::{FillRule, PathData, PathSegment, SubPath};
use crate::validate::{BEZIER_APPROXIMATION_SEGMENTS, MAX_BOOLEAN_OP_POINTS};

/// Boolean operation type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BooleanOp {
    /// Combine both shapes.
    Union,
    /// Subtract the second shape from the first.
    Subtract,
    /// Keep only the overlapping area.
    Intersect,
    /// Keep everything except the overlapping area.
    Exclude,
}

/// Performs a boolean operation on two paths.
///
/// Pipeline: bezier curves → polyline approximation → i_overlay boolean op → polyline result.
/// The result contains only MoveTo/LineTo/Close segments (no CubicTo — bezier refitting
/// is deferred to a future enhancement).
///
/// # Errors
/// - `CoreError::BooleanOpFailed` if the operation produces no valid geometry.
/// - `CoreError::ValidationError` if input paths exceed safety limits.
pub fn boolean_op(
    a: &PathData,
    b: &PathData,
    op: BooleanOp,
) -> Result<PathData, CoreError> {
    // Convert PathData to i_overlay polygon format
    let polys_a = path_data_to_polygons(a)?;
    let polys_b = path_data_to_polygons(b)?;

    if polys_a.is_empty() || polys_b.is_empty() {
        return Err(CoreError::BooleanOpFailed(
            "one or both paths have no geometry".to_string(),
        ));
    }

    // Map our FillRule to i_overlay's
    let fill_rule = match a.fill_rule() {
        FillRule::EvenOdd => IFillRule::EvenOdd,
        FillRule::NonZero => IFillRule::NonZero,
    };

    // Map our BooleanOp to i_overlay's OverlayRule
    let rule = match op {
        BooleanOp::Union => OverlayRule::Union,
        BooleanOp::Subtract => OverlayRule::Difference,
        BooleanOp::Intersect => OverlayRule::Intersect,
        BooleanOp::Exclude => OverlayRule::Xor,
    };

    // Build overlay
    let mut overlay = F64Overlay::new();
    for poly in &polys_a {
        overlay.add_path(poly.clone(), ShapeType::Subject);
    }
    for poly in &polys_b {
        overlay.add_path(poly.clone(), ShapeType::Clip);
    }

    // Execute
    let graph = overlay.into_graph(fill_rule);
    let result_shapes = graph.extract_shapes(rule);

    if result_shapes.is_empty() {
        return Err(CoreError::BooleanOpFailed(
            "boolean operation produced empty result".to_string(),
        ));
    }

    // Convert result back to PathData
    polygons_to_path_data(&result_shapes, a.fill_rule())
}

/// Converts PathData to i_overlay polygon format by flattening bezier curves.
fn path_data_to_polygons(path: &PathData) -> Result<Vec<F64Path>, CoreError> {
    let mut polygons = Vec::new();
    let mut total_points = 0usize;

    for subpath in path.subpaths() {
        let mut points: Vec<[f64; 2]> = Vec::new();
        let mut current = Point::zero();

        for segment in subpath.segments() {
            match segment {
                PathSegment::MoveTo { point } => {
                    if !points.is_empty() {
                        total_points += points.len();
                        if total_points > MAX_BOOLEAN_OP_POINTS {
                            return Err(CoreError::ValidationError(format!(
                                "boolean op input exceeds {MAX_BOOLEAN_OP_POINTS} points"
                            )));
                        }
                        polygons.push(points.clone());
                        points.clear();
                    }
                    points.push([point.x, point.y]);
                    current = *point;
                }
                PathSegment::LineTo { point } => {
                    points.push([point.x, point.y]);
                    current = *point;
                }
                PathSegment::CubicTo {
                    control1,
                    control2,
                    end,
                } => {
                    // Approximate cubic bezier with line segments
                    for i in 1..=BEZIER_APPROXIMATION_SEGMENTS {
                        let t = i as f64 / BEZIER_APPROXIMATION_SEGMENTS as f64;
                        let p = cubic_bezier_point(current, *control1, *control2, *end, t);
                        points.push([p.x, p.y]);
                    }
                    current = *end;
                }
                PathSegment::Close => {
                    // Close is implicit in polygon representation
                }
            }
        }

        if !points.is_empty() {
            total_points += points.len();
            if total_points > MAX_BOOLEAN_OP_POINTS {
                return Err(CoreError::ValidationError(format!(
                    "boolean op input exceeds {MAX_BOOLEAN_OP_POINTS} points"
                )));
            }
            polygons.push(points);
        }
    }

    Ok(polygons)
}

/// Converts i_overlay result polygons back to PathData.
fn polygons_to_path_data(
    shapes: &[Vec<F64Path>],
    fill_rule: FillRule,
) -> Result<PathData, CoreError> {
    let mut subpaths = Vec::new();

    for shape in shapes {
        for polygon in shape {
            if polygon.is_empty() {
                continue;
            }
            let mut segments = Vec::with_capacity(polygon.len() + 2);
            segments.push(PathSegment::MoveTo {
                point: Point::new(polygon[0][0], polygon[0][1]),
            });
            for pt in &polygon[1..] {
                segments.push(PathSegment::LineTo {
                    point: Point::new(pt[0], pt[1]),
                });
            }
            segments.push(PathSegment::Close);
            subpaths.push(SubPath::new(segments, true)?);
        }
    }

    PathData::new(subpaths, fill_rule)
}

/// Evaluates a cubic bezier curve at parameter t.
fn cubic_bezier_point(p0: Point, p1: Point, p2: Point, p3: Point, t: f64) -> Point {
    let t2 = t * t;
    let t3 = t2 * t;
    let mt = 1.0 - t;
    let mt2 = mt * mt;
    let mt3 = mt2 * mt;

    Point::new(
        mt3 * p0.x + 3.0 * mt2 * t * p1.x + 3.0 * mt * t2 * p2.x + t3 * p3.x,
        mt3 * p0.y + 3.0 * mt2 * t * p1.y + 3.0 * mt * t2 * p2.y + t3 * p3.y,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a simple rectangular path.
    fn make_rect(x: f64, y: f64, w: f64, h: f64) -> PathData {
        let segments = vec![
            PathSegment::MoveTo {
                point: Point::new(x, y),
            },
            PathSegment::LineTo {
                point: Point::new(x + w, y),
            },
            PathSegment::LineTo {
                point: Point::new(x + w, y + h),
            },
            PathSegment::LineTo {
                point: Point::new(x, y + h),
            },
            PathSegment::Close,
        ];
        let subpath = SubPath::new(segments, true).expect("valid rect");
        PathData::new(vec![subpath], FillRule::EvenOdd).expect("valid path")
    }

    #[test]
    fn test_boolean_op_union() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0);
        let b = make_rect(5.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Union).expect("union");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_subtract() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0);
        let b = make_rect(5.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Subtract).expect("subtract");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_intersect() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0);
        let b = make_rect(5.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Intersect).expect("intersect");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_exclude() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0);
        let b = make_rect(5.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Exclude).expect("exclude");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_no_overlap_subtract() {
        let a = make_rect(0.0, 0.0, 5.0, 5.0);
        let b = make_rect(10.0, 10.0, 5.0, 5.0);
        // Subtracting a non-overlapping shape should return the original shape
        let result = boolean_op(&a, &b, BooleanOp::Subtract).expect("subtract no overlap");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_no_overlap_intersect() {
        let a = make_rect(0.0, 0.0, 5.0, 5.0);
        let b = make_rect(10.0, 10.0, 5.0, 5.0);
        // Intersecting non-overlapping shapes should produce empty result
        let result = boolean_op(&a, &b, BooleanOp::Intersect);
        assert!(result.is_err()); // Empty result returns BooleanOpFailed
    }

    #[test]
    fn test_boolean_op_empty_path() {
        let a = PathData::default(); // empty
        let b = make_rect(0.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Union);
        assert!(result.is_err());
    }

    #[test]
    fn test_boolean_op_serde_round_trip() {
        let op = BooleanOp::Exclude;
        let json = serde_json::to_string(&op).expect("serialize");
        let deserialized: BooleanOp = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(op, deserialized);
    }

    #[test]
    fn test_boolean_op_with_curves() {
        // Test that paths containing CubicTo segments are approximated and processed
        let segments = vec![
            PathSegment::MoveTo {
                point: Point::new(0.0, 0.0),
            },
            PathSegment::CubicTo {
                control1: Point::new(5.0, 10.0),
                control2: Point::new(10.0, 10.0),
                end: Point::new(15.0, 0.0),
            },
            PathSegment::LineTo {
                point: Point::new(15.0, -5.0),
            },
            PathSegment::LineTo {
                point: Point::new(0.0, -5.0),
            },
            PathSegment::Close,
        ];
        let subpath = SubPath::new(segments, true).expect("valid");
        let a = PathData::new(vec![subpath], FillRule::EvenOdd).expect("valid");
        let b = make_rect(5.0, -5.0, 10.0, 10.0);

        let result = boolean_op(&a, &b, BooleanOp::Intersect).expect("intersect with curves");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_cubic_bezier_point_at_extremes() {
        let p0 = Point::new(0.0, 0.0);
        let p1 = Point::new(1.0, 2.0);
        let p2 = Point::new(3.0, 2.0);
        let p3 = Point::new(4.0, 0.0);

        let start = cubic_bezier_point(p0, p1, p2, p3, 0.0);
        assert!((start.x - p0.x).abs() < 1e-10);
        assert!((start.y - p0.y).abs() < 1e-10);

        let end = cubic_bezier_point(p0, p1, p2, p3, 1.0);
        assert!((end.x - p3.x).abs() < 1e-10);
        assert!((end.y - p3.y).abs() < 1e-10);
    }
}
```

- [ ] 4. Add `pub mod boolean;` to `lib.rs` and re-exports:

```rust
pub mod boolean;

// ── Re-exports: Boolean ──────────────────────────────────────────────
pub use boolean::{BooleanOp, boolean_op};
```

Add `MAX_BOOLEAN_OP_POINTS` and `BEZIER_APPROXIMATION_SEGMENTS` to the validate re-exports.

- [ ] 5. Run tests and verify WASM compat:

```bash
cargo test -p agent-designer-core boolean::tests
cargo test -p agent-designer-core
cargo clippy -p agent-designer-core -- -D warnings
cargo fmt -p agent-designer-core
cargo check --target wasm32-unknown-unknown -p agent-designer-core
```

- [ ] 6. Commit:

```bash
git add crates/core/src/boolean.rs crates/core/src/validate.rs crates/core/src/lib.rs
git commit -m "feat(core): add boolean path operations — union, subtract, intersect, exclude (spec-01)"
```

---

## Task 3: Implement SerializableCommand and BroadcastCommand

**Files:**
- Create: `crates/core/src/wire.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `crates/core/src/wire.rs` with both enums. `SerializableCommand` carries full state (both new and old values) for local persistence. `BroadcastCommand` carries only forward state for WebSocket sync.

Since there are 21 commands, this file will be large but mechanical — each command maps to a variant in both enums. The `BroadcastCommand` variant omits `old_*` and `snapshot` fields.

```rust
// crates/core/src/wire.rs
//
// Wire format enums for command serialization.
// SerializableCommand: full state for local undo/redo persistence.
// BroadcastCommand: forward-only state for WebSocket sync (omits old_* fields).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::component::{
    ComponentDef, OverrideKey, OverrideSource, OverrideValue,
};
use crate::id::{ComponentId, NodeId, PageId, TokenId};
use crate::node::{
    BlendMode, Constraints, Effect, Fill, NodeKind, Stroke, StyleValue, Transform,
};
use crate::prototype::Transition;
use crate::token::Token;

/// Full command representation for local undo/redo persistence.
/// Includes both forward and reverse state so the engine can reconstruct
/// undo operations without access to the original document state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SerializableCommand {
    // ── Node commands ────────────────────────────────────────────
    CreateNode {
        node_id: NodeId,
        uuid: Uuid,
        kind: NodeKind,
        name: String,
        page_id: Option<PageId>,
    },
    DeleteNode {
        node_id: NodeId,
        page_id: Option<PageId>,
        page_root_index: Option<usize>,
        parent_id: Option<NodeId>,
        parent_child_index: Option<usize>,
    },
    RenameNode {
        node_id: NodeId,
        new_name: String,
        old_name: String,
    },
    SetVisible {
        node_id: NodeId,
        new_visible: bool,
        old_visible: bool,
    },
    SetLocked {
        node_id: NodeId,
        new_locked: bool,
        old_locked: bool,
    },
    SetTextContent {
        node_id: NodeId,
        new_content: String,
        old_content: String,
    },

    // ── Style commands ───────────────────────────────────────────
    SetTransform {
        node_id: NodeId,
        new_transform: Transform,
        old_transform: Transform,
    },
    SetFills {
        node_id: NodeId,
        new_fills: Vec<Fill>,
        old_fills: Vec<Fill>,
    },
    SetStrokes {
        node_id: NodeId,
        new_strokes: Vec<Stroke>,
        old_strokes: Vec<Stroke>,
    },
    SetOpacity {
        node_id: NodeId,
        new_opacity: StyleValue<f64>,
        old_opacity: StyleValue<f64>,
    },
    SetBlendMode {
        node_id: NodeId,
        new_blend_mode: BlendMode,
        old_blend_mode: BlendMode,
    },
    SetEffects {
        node_id: NodeId,
        new_effects: Vec<Effect>,
        old_effects: Vec<Effect>,
    },
    SetConstraints {
        node_id: NodeId,
        new_constraints: Constraints,
        old_constraints: Constraints,
    },

    // ── Tree commands ────────────────────────────────────────────
    ReparentNode {
        node_id: NodeId,
        new_parent_id: NodeId,
        new_position: usize,
        old_parent_id: Option<NodeId>,
        old_position: Option<usize>,
    },
    ReorderChildren {
        node_id: NodeId,
        new_position: usize,
        old_position: usize,
    },

    // ── Transition commands ──────────────────────────────────────
    AddTransition {
        transition: Transition,
    },
    RemoveTransition {
        transition_id: Uuid,
        snapshot: Transition,
    },
    UpdateTransition {
        transition_id: Uuid,
        new_transition: Transition,
        old_transition: Transition,
    },

    // ── Token commands ───────────────────────────────────────────
    AddToken {
        token: Token,
    },
    RemoveToken {
        token_name: String,
        snapshot: Token,
    },
    UpdateToken {
        new_token: Token,
        old_token: Token,
    },

    // ── Component commands ───────────────────────────────────────
    AddComponent {
        component: ComponentDef,
    },
    RemoveComponent {
        component_id: ComponentId,
        snapshot: ComponentDef,
    },
    SetOverride {
        node_id: NodeId,
        key: OverrideKey,
        new_value: OverrideValue,
        new_source: OverrideSource,
        old_entry: Option<(OverrideValue, OverrideSource)>,
    },
    RemoveOverride {
        node_id: NodeId,
        key: OverrideKey,
        old_entry: (OverrideValue, OverrideSource),
    },
}

/// Forward-only command representation for WebSocket broadcast.
/// Omits all `old_*` and `snapshot` fields to avoid leaking historical
/// document state to other clients and to reduce message size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BroadcastCommand {
    // ── Node commands ────────────────────────────────────────────
    CreateNode {
        uuid: Uuid,
        kind: NodeKind,
        name: String,
        page_id: Option<PageId>,
    },
    DeleteNode {
        node_id: NodeId,
    },
    RenameNode {
        node_id: NodeId,
        new_name: String,
    },
    SetVisible {
        node_id: NodeId,
        new_visible: bool,
    },
    SetLocked {
        node_id: NodeId,
        new_locked: bool,
    },
    SetTextContent {
        node_id: NodeId,
        new_content: String,
    },

    // ── Style commands ───────────────────────────────────────────
    SetTransform {
        node_id: NodeId,
        new_transform: Transform,
    },
    SetFills {
        node_id: NodeId,
        new_fills: Vec<Fill>,
    },
    SetStrokes {
        node_id: NodeId,
        new_strokes: Vec<Stroke>,
    },
    SetOpacity {
        node_id: NodeId,
        new_opacity: StyleValue<f64>,
    },
    SetBlendMode {
        node_id: NodeId,
        new_blend_mode: BlendMode,
    },
    SetEffects {
        node_id: NodeId,
        new_effects: Vec<Effect>,
    },
    SetConstraints {
        node_id: NodeId,
        new_constraints: Constraints,
    },

    // ── Tree commands ────────────────────────────────────────────
    ReparentNode {
        node_id: NodeId,
        new_parent_id: NodeId,
        new_position: usize,
    },
    ReorderChildren {
        node_id: NodeId,
        new_position: usize,
    },

    // ── Transition commands ──────────────────────────────────────
    AddTransition {
        transition: Transition,
    },
    RemoveTransition {
        transition_id: Uuid,
    },
    UpdateTransition {
        transition_id: Uuid,
        new_transition: Transition,
    },

    // ── Token commands ───────────────────────────────────────────
    AddToken {
        token: Token,
    },
    RemoveToken {
        token_name: String,
    },
    UpdateToken {
        new_token: Token,
    },

    // ── Component commands ───────────────────────────────────────
    AddComponent {
        component: ComponentDef,
    },
    RemoveComponent {
        component_id: ComponentId,
    },
    SetOverride {
        node_id: NodeId,
        key: OverrideKey,
        new_value: OverrideValue,
        new_source: OverrideSource,
    },
    RemoveOverride {
        node_id: NodeId,
        key: OverrideKey,
    },
}

/// Converts a SerializableCommand to a BroadcastCommand by stripping undo state.
impl From<&SerializableCommand> for BroadcastCommand {
    fn from(cmd: &SerializableCommand) -> Self {
        match cmd {
            SerializableCommand::CreateNode { uuid, kind, name, page_id, .. } => {
                BroadcastCommand::CreateNode {
                    uuid: *uuid,
                    kind: kind.clone(),
                    name: name.clone(),
                    page_id: *page_id,
                }
            }
            SerializableCommand::DeleteNode { node_id, .. } => {
                BroadcastCommand::DeleteNode { node_id: *node_id }
            }
            SerializableCommand::RenameNode { node_id, new_name, .. } => {
                BroadcastCommand::RenameNode {
                    node_id: *node_id,
                    new_name: new_name.clone(),
                }
            }
            SerializableCommand::SetVisible { node_id, new_visible, .. } => {
                BroadcastCommand::SetVisible {
                    node_id: *node_id,
                    new_visible: *new_visible,
                }
            }
            SerializableCommand::SetLocked { node_id, new_locked, .. } => {
                BroadcastCommand::SetLocked {
                    node_id: *node_id,
                    new_locked: *new_locked,
                }
            }
            SerializableCommand::SetTextContent { node_id, new_content, .. } => {
                BroadcastCommand::SetTextContent {
                    node_id: *node_id,
                    new_content: new_content.clone(),
                }
            }
            SerializableCommand::SetTransform { node_id, new_transform, .. } => {
                BroadcastCommand::SetTransform {
                    node_id: *node_id,
                    new_transform: *new_transform,
                }
            }
            SerializableCommand::SetFills { node_id, new_fills, .. } => {
                BroadcastCommand::SetFills {
                    node_id: *node_id,
                    new_fills: new_fills.clone(),
                }
            }
            SerializableCommand::SetStrokes { node_id, new_strokes, .. } => {
                BroadcastCommand::SetStrokes {
                    node_id: *node_id,
                    new_strokes: new_strokes.clone(),
                }
            }
            SerializableCommand::SetOpacity { node_id, new_opacity, .. } => {
                BroadcastCommand::SetOpacity {
                    node_id: *node_id,
                    new_opacity: new_opacity.clone(),
                }
            }
            SerializableCommand::SetBlendMode { node_id, new_blend_mode, .. } => {
                BroadcastCommand::SetBlendMode {
                    node_id: *node_id,
                    new_blend_mode: *new_blend_mode,
                }
            }
            SerializableCommand::SetEffects { node_id, new_effects, .. } => {
                BroadcastCommand::SetEffects {
                    node_id: *node_id,
                    new_effects: new_effects.clone(),
                }
            }
            SerializableCommand::SetConstraints { node_id, new_constraints, .. } => {
                BroadcastCommand::SetConstraints {
                    node_id: *node_id,
                    new_constraints: *new_constraints,
                }
            }
            SerializableCommand::ReparentNode { node_id, new_parent_id, new_position, .. } => {
                BroadcastCommand::ReparentNode {
                    node_id: *node_id,
                    new_parent_id: *new_parent_id,
                    new_position: *new_position,
                }
            }
            SerializableCommand::ReorderChildren { node_id, new_position, .. } => {
                BroadcastCommand::ReorderChildren {
                    node_id: *node_id,
                    new_position: *new_position,
                }
            }
            SerializableCommand::AddTransition { transition } => {
                BroadcastCommand::AddTransition {
                    transition: transition.clone(),
                }
            }
            SerializableCommand::RemoveTransition { transition_id, .. } => {
                BroadcastCommand::RemoveTransition {
                    transition_id: *transition_id,
                }
            }
            SerializableCommand::UpdateTransition { transition_id, new_transition, .. } => {
                BroadcastCommand::UpdateTransition {
                    transition_id: *transition_id,
                    new_transition: new_transition.clone(),
                }
            }
            SerializableCommand::AddToken { token } => {
                BroadcastCommand::AddToken {
                    token: token.clone(),
                }
            }
            SerializableCommand::RemoveToken { token_name, .. } => {
                BroadcastCommand::RemoveToken {
                    token_name: token_name.clone(),
                }
            }
            SerializableCommand::UpdateToken { new_token, .. } => {
                BroadcastCommand::UpdateToken {
                    new_token: new_token.clone(),
                }
            }
            SerializableCommand::AddComponent { component } => {
                BroadcastCommand::AddComponent {
                    component: component.clone(),
                }
            }
            SerializableCommand::RemoveComponent { component_id, .. } => {
                BroadcastCommand::RemoveComponent {
                    component_id: *component_id,
                }
            }
            SerializableCommand::SetOverride { node_id, key, new_value, new_source, .. } => {
                BroadcastCommand::SetOverride {
                    node_id: *node_id,
                    key: key.clone(),
                    new_value: new_value.clone(),
                    new_source: *new_source,
                }
            }
            SerializableCommand::RemoveOverride { node_id, key, .. } => {
                BroadcastCommand::RemoveOverride {
                    node_id: *node_id,
                    key: key.clone(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::NodeId;
    use crate::node::NodeKind;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    #[test]
    fn test_serializable_command_serde_round_trip() {
        let cmd = SerializableCommand::RenameNode {
            node_id: NodeId::new(0, 0),
            new_name: "New Name".to_string(),
            old_name: "Old Name".to_string(),
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: SerializableCommand =
            serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_broadcast_command_serde_round_trip() {
        let cmd = BroadcastCommand::RenameNode {
            node_id: NodeId::new(0, 0),
            new_name: "New Name".to_string(),
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: BroadcastCommand =
            serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_serializable_to_broadcast_conversion() {
        let serializable = SerializableCommand::SetVisible {
            node_id: NodeId::new(1, 0),
            new_visible: false,
            old_visible: true,
        };
        let broadcast: BroadcastCommand = (&serializable).into();
        assert_eq!(
            broadcast,
            BroadcastCommand::SetVisible {
                node_id: NodeId::new(1, 0),
                new_visible: false,
            }
        );
    }

    #[test]
    fn test_broadcast_omits_old_state() {
        let serializable = SerializableCommand::RenameNode {
            node_id: NodeId::new(0, 0),
            new_name: "New".to_string(),
            old_name: "Old".to_string(),
        };
        let broadcast_json =
            serde_json::to_string(&BroadcastCommand::from(&serializable)).expect("serialize");
        assert!(!broadcast_json.contains("old_name"));
        assert!(!broadcast_json.contains("Old"));
    }

    #[test]
    fn test_serializable_create_node_round_trip() {
        let cmd = SerializableCommand::CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: make_uuid(1),
            kind: NodeKind::Frame { layout: None },
            name: "Frame".to_string(),
            page_id: Some(PageId::new(make_uuid(10))),
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: SerializableCommand =
            serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_serializable_add_transition_round_trip() {
        use crate::prototype::{TransitionAnimation, TransitionTrigger};

        let cmd = SerializableCommand::AddTransition {
            transition: Transition {
                id: make_uuid(1),
                source_node: NodeId::new(0, 0),
                target_page: PageId::new(make_uuid(10)),
                target_node: None,
                trigger: TransitionTrigger::OnClick,
                animation: TransitionAnimation::Dissolve { duration: 0.3 },
            },
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: SerializableCommand =
            serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_broadcast_set_override_round_trip() {
        use crate::component::{OverrideKey, PropertyPath};

        let cmd = BroadcastCommand::SetOverride {
            node_id: NodeId::new(0, 0),
            key: OverrideKey::new(make_uuid(5), PropertyPath::Visible),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
        };
        let json = serde_json::to_string(&cmd).expect("serialize");
        let deserialized: BroadcastCommand =
            serde_json::from_str(&json).expect("deserialize");
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_all_serializable_variants_to_broadcast() {
        // Verify the From conversion compiles for a representative sample
        let commands: Vec<SerializableCommand> = vec![
            SerializableCommand::SetVisible {
                node_id: NodeId::new(0, 0),
                new_visible: true,
                old_visible: false,
            },
            SerializableCommand::AddToken {
                token: Token::new(
                    TokenId::new(make_uuid(1)),
                    "color.primary".to_string(),
                    crate::token::TokenValue::Number { value: 42.0 },
                    crate::token::TokenType::Number,
                    None,
                )
                .expect("valid"),
            },
        ];

        for cmd in &commands {
            let _broadcast: BroadcastCommand = cmd.into();
        }
    }
}
```

- [ ] 3. Add `pub mod wire;` to `lib.rs` and re-exports:

```rust
pub mod wire;

// ── Re-exports: Wire ─────────────────────────────────────────────────
pub use wire::{BroadcastCommand, SerializableCommand};
```

- [ ] 4. Run tests:

```bash
cargo test -p agent-designer-core wire::tests
cargo test -p agent-designer-core
cargo clippy -p agent-designer-core -- -D warnings
cargo fmt -p agent-designer-core
```

- [ ] 5. Commit:

```bash
git add crates/core/src/wire.rs crates/core/src/lib.rs
git commit -m "feat(core): add SerializableCommand and BroadcastCommand wire format enums (spec-01)"
```

---

## Task 4: Run full workspace verification

**Files:** None (verification only)

- [ ] 1. Full test suite:

```bash
cargo test --workspace
```

- [ ] 2. Clippy:

```bash
cargo clippy --workspace -- -D warnings
```

- [ ] 3. Format:

```bash
cargo fmt --check
```

- [ ] 4. WASM check:

```bash
cargo check --target wasm32-unknown-unknown -p agent-designer-core
```

- [ ] 5. If any issues, fix and commit.
