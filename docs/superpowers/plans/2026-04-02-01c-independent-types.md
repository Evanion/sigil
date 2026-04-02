# Independent Types — Implementation Plan (01c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PathData, LayoutMode, and Transition stubs with full type implementations including validation, serialization, and tests.

**Architecture:** Three independent type families — path geometry (SubPath, PathSegment, AnchorPoint), grid layout (GridLayout, GridTrack, GridPlacement), and prototype transitions (Transition, TransitionTrigger, TransitionAnimation). Each lives in its own module. PathData moves from `node.rs` to a new `path.rs`. Grid types extend `node.rs`. Transition moves from `document.rs` to a new `prototype.rs`. All types derive Serialize/Deserialize and enforce validation limits from `validate.rs`.

**Tech Stack:** Rust 1.94.1 (edition 2024), serde, serde_json, uuid (no v4), thiserror

**Scope:** This plan covers type definitions, validation, and serialization only. Commands that operate on these types (e.g., `AddTransition`, path editing commands) are deferred to Plan 01e.

---

## File Structure

```
crates/core/src/
├── path.rs              # NEW: PathData, SubPath, PathSegment, AnchorPoint, CornerMode
├── prototype.rs         # NEW: Transition, TransitionTrigger, TransitionAnimation, SlideDirection
├── node.rs              # MODIFY: remove PathData stub, add Grid layout types, add GridPlacement to Node
├── document.rs          # MODIFY: remove Transition stub, import from prototype.rs
├── serialize.rs         # MODIFY: update SerializedPage.transitions type
├── validate.rs          # MODIFY: add new validation constants and functions
├── lib.rs               # MODIFY: add new modules and re-exports
```

---

## Task 1: Create path module with PathSegment and SubPath

**Files:**
- Create: `crates/core/src/path.rs`
- Modify: `crates/core/src/node.rs` (remove PathData stub, import from path.rs)
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Create `crates/core/src/path.rs` with the core path types and tests:

```rust
// crates/core/src/path.rs
#![allow(clippy::unnecessary_literal_bound)]

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::node::Point;
use crate::validate::{MAX_SEGMENTS_PER_SUBPATH, MAX_SUBPATHS_PER_PATH};

/// A segment in a vector path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PathSegment {
    /// Move the pen to a new position without drawing.
    MoveTo { point: Point },
    /// Draw a straight line to the given point.
    LineTo { point: Point },
    /// Draw a cubic bezier curve.
    CubicTo {
        control1: Point,
        control2: Point,
        end: Point,
    },
    /// Close the current subpath by drawing a line back to the start.
    Close,
}

/// A continuous sequence of path segments.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubPath {
    pub segments: Vec<PathSegment>,
    pub closed: bool,
}

impl SubPath {
    /// Creates a new subpath, validating the segment count.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if segments exceed the maximum.
    pub fn new(segments: Vec<PathSegment>, closed: bool) -> Result<Self, CoreError> {
        if segments.len() > MAX_SEGMENTS_PER_SUBPATH {
            return Err(CoreError::ValidationError(format!(
                "subpath has {} segments (max {MAX_SEGMENTS_PER_SUBPATH})",
                segments.len()
            )));
        }
        Ok(Self { segments, closed })
    }
}

/// Fill rule for path rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FillRule {
    /// Even-odd fill rule.
    EvenOdd,
    /// Non-zero winding fill rule.
    NonZero,
}

/// Vector path geometry data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PathData {
    pub subpaths: Vec<SubPath>,
    pub fill_rule: FillRule,
}

impl PathData {
    /// Creates a new PathData, validating subpath count.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if subpaths exceed the maximum.
    pub fn new(subpaths: Vec<SubPath>, fill_rule: FillRule) -> Result<Self, CoreError> {
        if subpaths.len() > MAX_SUBPATHS_PER_PATH {
            return Err(CoreError::ValidationError(format!(
                "path has {} subpaths (max {MAX_SUBPATHS_PER_PATH})",
                subpaths.len()
            )));
        }
        Ok(Self {
            subpaths,
            fill_rule,
        })
    }
}

impl Default for PathData {
    fn default() -> Self {
        Self {
            subpaths: Vec::new(),
            fill_rule: FillRule::EvenOdd,
        }
    }
}

/// Corner mode for anchor point handles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CornerMode {
    /// Handles are aligned and equal length.
    Smooth,
    /// Handles are aligned but can differ in length.
    Mirrored,
    /// Handles move independently.
    Disconnected,
    /// No handles — straight corner.
    Straight,
}

/// An anchor point in the path editing UI.
///
/// This is a runtime-only editing view — not serialized to the file format.
/// The serialized form is `PathSegment`.
#[derive(Debug, Clone, PartialEq)]
pub struct AnchorPoint {
    pub position: Point,
    pub handle_in: Option<Point>,
    pub handle_out: Option<Point>,
    pub corner_mode: CornerMode,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subpath_new_valid() {
        let segments = vec![
            PathSegment::MoveTo {
                point: Point::new(0.0, 0.0),
            },
            PathSegment::LineTo {
                point: Point::new(100.0, 0.0),
            },
            PathSegment::Close,
        ];
        let subpath = SubPath::new(segments, true).expect("valid subpath");
        assert!(subpath.closed);
        assert_eq!(subpath.segments.len(), 3);
    }

    #[test]
    fn test_subpath_exceeds_max_segments() {
        let segments: Vec<PathSegment> = (0..MAX_SEGMENTS_PER_SUBPATH + 1)
            .map(|i| PathSegment::LineTo {
                point: Point::new(i as f64, 0.0),
            })
            .collect();
        assert!(SubPath::new(segments, false).is_err());
    }

    #[test]
    fn test_path_data_new_valid() {
        let subpath = SubPath::new(
            vec![PathSegment::MoveTo {
                point: Point::zero(),
            }],
            false,
        )
        .expect("valid subpath");
        let path = PathData::new(vec![subpath], FillRule::EvenOdd).expect("valid path");
        assert_eq!(path.subpaths.len(), 1);
    }

    #[test]
    fn test_path_data_exceeds_max_subpaths() {
        let subpaths: Vec<SubPath> = (0..MAX_SUBPATHS_PER_PATH + 1)
            .map(|_| SubPath {
                segments: vec![],
                closed: false,
            })
            .collect();
        assert!(PathData::new(subpaths, FillRule::NonZero).is_err());
    }

    #[test]
    fn test_path_data_default() {
        let path = PathData::default();
        assert!(path.subpaths.is_empty());
        assert_eq!(path.fill_rule, FillRule::EvenOdd);
    }

    #[test]
    fn test_path_segment_serde_round_trip() {
        let segment = PathSegment::CubicTo {
            control1: Point::new(10.0, 20.0),
            control2: Point::new(30.0, 40.0),
            end: Point::new(50.0, 60.0),
        };
        let json = serde_json::to_string(&segment).expect("serialize");
        let deserialized: PathSegment = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(segment, deserialized);
    }

    #[test]
    fn test_subpath_serde_round_trip() {
        let subpath = SubPath::new(
            vec![
                PathSegment::MoveTo {
                    point: Point::zero(),
                },
                PathSegment::LineTo {
                    point: Point::new(100.0, 100.0),
                },
                PathSegment::Close,
            ],
            true,
        )
        .expect("valid subpath");
        let json = serde_json::to_string(&subpath).expect("serialize");
        let deserialized: SubPath = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(subpath, deserialized);
    }

    #[test]
    fn test_path_data_serde_round_trip() {
        let path = PathData::new(
            vec![SubPath::new(
                vec![
                    PathSegment::MoveTo {
                        point: Point::zero(),
                    },
                    PathSegment::CubicTo {
                        control1: Point::new(10.0, 0.0),
                        control2: Point::new(90.0, 100.0),
                        end: Point::new(100.0, 100.0),
                    },
                ],
                false,
            )
            .expect("valid subpath")],
            FillRule::NonZero,
        )
        .expect("valid path");
        let json = serde_json::to_string(&path).expect("serialize");
        let deserialized: PathData = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(path, deserialized);
    }

    #[test]
    fn test_anchor_point_construction() {
        let anchor = AnchorPoint {
            position: Point::new(50.0, 50.0),
            handle_in: Some(Point::new(40.0, 50.0)),
            handle_out: Some(Point::new(60.0, 50.0)),
            corner_mode: CornerMode::Smooth,
        };
        assert_eq!(anchor.corner_mode, CornerMode::Smooth);
    }
}
```

- [ ] 2. Remove the `PathData`, `FillRule`, and their impls from `crates/core/src/node.rs` (lines 18-41 approximately — the stub `PathData`, `Default for PathData`, and `FillRule`). Replace with an import:

At the top of `node.rs`, add:
```rust
use crate::path::{FillRule, PathData};
```

And re-export them so existing consumers don't break:
```rust
// Re-export path types for backwards compatibility
pub use crate::path::{FillRule, PathData};
```

Remove the `PathData` struct, its `Default` impl, and the `FillRule` enum from `node.rs` since they now live in `path.rs`.

- [ ] 3. Add `pub mod path;` to `crates/core/src/lib.rs` after `pub mod node;`:

```rust
pub mod path;
```

Add re-exports:
```rust
// ── Re-exports: Path ─────────────────────────────────────────────────
pub use path::{AnchorPoint, CornerMode, PathSegment, SubPath};
```

- [ ] 4. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core path::tests
./dev.sh cargo test -p agent-designer-core  # all tests still pass
```

Expected: all path tests pass, no regressions.

- [ ] 5. Run clippy and format:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 6. Commit:

```bash
git add crates/core/src/path.rs crates/core/src/node.rs crates/core/src/lib.rs
git commit -m "feat(core): add full path types — PathSegment, SubPath, AnchorPoint, CornerMode (spec-01)"
```

---

## Task 2: Add Grid layout types

**Files:**
- Modify: `crates/core/src/node.rs`
- Modify: `crates/core/src/validate.rs`

- [ ] 1. Add grid validation constants to `crates/core/src/validate.rs`, after the existing constants:

```rust
/// Maximum grid tracks (columns or rows) per grid layout.
pub const MAX_GRID_TRACKS: usize = 1_000;
```

- [ ] 2. Add the grid types to `crates/core/src/node.rs`. Add these after the `JustifyContent` enum (around line 123):

```rust
/// Justify items alignment for grid layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JustifyItems {
    Start,
    Center,
    End,
    Stretch,
}

/// A grid track definition (column or row).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GridTrack {
    /// Fixed size in pixels.
    Fixed { size: f64 },
    /// Fractional unit (like CSS `fr`).
    Fractional { fraction: f64 },
    /// Auto-sized based on content.
    Auto,
    /// Minimum and maximum size range.
    MinMax { min: f64, max: f64 },
}

/// Grid layout configuration for frame children.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridLayout {
    pub columns: Vec<GridTrack>,
    pub rows: Vec<GridTrack>,
    pub column_gap: f64,
    pub row_gap: f64,
    pub padding: Padding,
    pub align_items: AlignItems,
    pub justify_items: JustifyItems,
}

impl Default for GridLayout {
    fn default() -> Self {
        Self {
            columns: Vec::new(),
            rows: Vec::new(),
            column_gap: 0.0,
            row_gap: 0.0,
            padding: Padding::default(),
            align_items: AlignItems::Start,
            justify_items: JustifyItems::Start,
        }
    }
}

/// How a child is placed within a grid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GridSpan {
    /// Automatically placed by the grid algorithm.
    Auto,
    /// Placed at a specific grid line (1-based).
    Line { index: i32 },
    /// Spans a number of tracks from the auto-placed position.
    Span { count: u32 },
    /// From one line to another (1-based, exclusive end).
    LineToLine { start: i32, end: i32 },
}

/// Grid placement for a child node within a grid parent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridPlacement {
    pub column: GridSpan,
    pub row: GridSpan,
}

impl Default for GridPlacement {
    fn default() -> Self {
        Self {
            column: GridSpan::Auto,
            row: GridSpan::Auto,
        }
    }
}
```

- [ ] 3. Add the `Grid` variant to `LayoutMode`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum LayoutMode {
    Flex(FlexLayout),
    Grid(GridLayout),
}
```

- [ ] 4. Add `grid_placement: Option<GridPlacement>` to the `Node` struct, after the `constraints` field:

```rust
pub struct Node {
    pub id: NodeId,
    pub uuid: Uuid,
    pub kind: NodeKind,
    pub name: String,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub transform: Transform,
    pub style: Style,
    pub constraints: Constraints,
    pub grid_placement: Option<GridPlacement>,
    pub visible: bool,
    pub locked: bool,
}
```

Update `Node::new()` to set `grid_placement: None`.

- [ ] 5. Add grid validation function to `crates/core/src/validate.rs`:

```rust
/// Validates a grid track value.
///
/// # Errors
/// Returns `CoreError::ValidationError` if values are non-finite, negative,
/// or MinMax has min > max.
pub fn validate_grid_track(track: &crate::node::GridTrack) -> Result<(), CoreError> {
    use crate::node::GridTrack;
    match track {
        GridTrack::Fixed { size } => {
            if !size.is_finite() || *size < 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "grid track fixed size must be non-negative and finite, got {size}"
                )));
            }
        }
        GridTrack::Fractional { fraction } => {
            if !fraction.is_finite() || *fraction < 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "grid track fraction must be non-negative and finite, got {fraction}"
                )));
            }
        }
        GridTrack::Auto => {}
        GridTrack::MinMax { min, max } => {
            if !min.is_finite() || !max.is_finite() || *min < 0.0 || *max < 0.0 {
                return Err(CoreError::ValidationError(
                    "grid track min/max must be non-negative and finite".to_string(),
                ));
            }
            if min > max {
                return Err(CoreError::ValidationError(format!(
                    "grid track min ({min}) must be <= max ({max})"
                )));
            }
        }
    }
    Ok(())
}
```

- [ ] 6. Add tests to `node.rs` test module:

```rust
#[test]
fn test_grid_layout_default() {
    let grid = GridLayout::default();
    assert!(grid.columns.is_empty());
    assert!(grid.rows.is_empty());
    assert_eq!(grid.column_gap, 0.0);
}

#[test]
fn test_grid_layout_serde_round_trip() {
    let grid = GridLayout {
        columns: vec![
            GridTrack::Fixed { size: 100.0 },
            GridTrack::Fractional { fraction: 1.0 },
            GridTrack::Auto,
        ],
        rows: vec![GridTrack::MinMax {
            min: 50.0,
            max: 200.0,
        }],
        column_gap: 10.0,
        row_gap: 10.0,
        padding: Padding::default(),
        align_items: AlignItems::Center,
        justify_items: JustifyItems::Stretch,
    };
    let json = serde_json::to_string(&grid).expect("serialize");
    let deserialized: GridLayout = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(grid, deserialized);
}

#[test]
fn test_layout_mode_grid_serde() {
    let mode = LayoutMode::Grid(GridLayout::default());
    let json = serde_json::to_string(&mode).expect("serialize");
    assert!(json.contains("\"mode\":\"grid\""));
    let deserialized: LayoutMode = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(mode, deserialized);
}

#[test]
fn test_grid_placement_default() {
    let placement = GridPlacement::default();
    assert_eq!(placement.column, GridSpan::Auto);
    assert_eq!(placement.row, GridSpan::Auto);
}

#[test]
fn test_grid_span_serde_round_trip() {
    let spans = vec![
        GridSpan::Auto,
        GridSpan::Line { index: 2 },
        GridSpan::Span { count: 3 },
        GridSpan::LineToLine { start: 1, end: 4 },
    ];
    for span in spans {
        let json = serde_json::to_string(&span).expect("serialize");
        let deserialized: GridSpan = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(span, deserialized);
    }
}

#[test]
fn test_node_with_grid_placement() {
    let mut node = Node::new(
        NodeId::new(0, 0),
        Uuid::nil(),
        NodeKind::Rectangle {
            corner_radii: [0.0; 4],
        },
        "Rect".to_string(),
    )
    .expect("create node");
    assert!(node.grid_placement.is_none());
    node.grid_placement = Some(GridPlacement {
        column: GridSpan::Span { count: 2 },
        row: GridSpan::Line { index: 1 },
    });
    assert!(node.grid_placement.is_some());
}
```

Add validation tests to `validate.rs`:

```rust
#[test]
fn test_validate_grid_track_fixed_valid() {
    use crate::node::GridTrack;
    assert!(validate_grid_track(&GridTrack::Fixed { size: 100.0 }).is_ok());
}

#[test]
fn test_validate_grid_track_fixed_negative() {
    use crate::node::GridTrack;
    assert!(validate_grid_track(&GridTrack::Fixed { size: -1.0 }).is_err());
}

#[test]
fn test_validate_grid_track_fixed_nan() {
    use crate::node::GridTrack;
    assert!(validate_grid_track(&GridTrack::Fixed { size: f64::NAN }).is_err());
}

#[test]
fn test_validate_grid_track_minmax_valid() {
    use crate::node::GridTrack;
    assert!(validate_grid_track(&GridTrack::MinMax { min: 50.0, max: 200.0 }).is_ok());
}

#[test]
fn test_validate_grid_track_minmax_inverted() {
    use crate::node::GridTrack;
    assert!(validate_grid_track(&GridTrack::MinMax { min: 200.0, max: 50.0 }).is_err());
}

#[test]
fn test_validate_grid_track_auto() {
    use crate::node::GridTrack;
    assert!(validate_grid_track(&GridTrack::Auto).is_ok());
}
```

- [ ] 7. Update re-exports in `lib.rs` — add new types to the node model re-exports:

```rust
pub use node::{
    AlignItems, BlendMode, Color, Constraints, Effect, Fill, FillRule, FlexLayout, GradientDef,
    GradientStop, GridLayout, GridPlacement, GridSpan, GridTrack, JustifyContent, JustifyItems,
    LayoutDirection, LayoutMode, Node, NodeKind, OverrideMap, Padding, PathData, PinConstraint,
    Point, ScaleMode, Stroke, StrokeAlignment, StrokeCap, StrokeJoin, Style, StyleValue,
    TextAlign, TextStyle, Transform,
};
```

Add `MAX_GRID_TRACKS` and `validate_grid_track` to the validate re-exports.

- [ ] 8. Run tests and clippy:

```bash
./dev.sh cargo test -p agent-designer-core
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 9. Commit:

```bash
git add crates/core/src/node.rs crates/core/src/validate.rs crates/core/src/lib.rs
git commit -m "feat(core): add grid layout types — GridLayout, GridTrack, GridPlacement, GridSpan (spec-01)"
```

---

## Task 3: Create prototype module with full Transition types

**Files:**
- Create: `crates/core/src/prototype.rs`
- Modify: `crates/core/src/document.rs` (remove Transition stub)
- Modify: `crates/core/src/lib.rs`
- Modify: `crates/core/src/validate.rs`

- [ ] 1. Add validation constants to `crates/core/src/validate.rs`:

```rust
/// Maximum transition duration in seconds.
pub const MAX_TRANSITION_DURATION: f64 = 300.0;

/// Maximum transitions per document.
pub const MAX_TRANSITIONS_PER_DOCUMENT: usize = 10_000;
```

- [ ] 2. Create `crates/core/src/prototype.rs`:

```rust
// crates/core/src/prototype.rs

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::CoreError;
use crate::id::{NodeId, PageId};
use crate::validate::MAX_TRANSITION_DURATION;

/// Direction for slide/push transition animations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlideDirection {
    Left,
    Right,
    Up,
    Down,
}

/// What triggers a transition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransitionTrigger {
    /// Triggered on click/tap.
    OnClick,
    /// Triggered on drag.
    OnDrag,
    /// Triggered on hover.
    OnHover,
    /// Triggered after a delay in seconds.
    AfterDelay { seconds: f64 },
}

/// Animation style for a transition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransitionAnimation {
    /// Instant transition with no animation.
    Instant,
    /// Cross-fade dissolve.
    Dissolve { duration: f64 },
    /// Slide in from a direction.
    SlideIn {
        direction: SlideDirection,
        duration: f64,
    },
    /// Slide out to a direction.
    SlideOut {
        direction: SlideDirection,
        duration: f64,
    },
    /// Push content in a direction.
    Push {
        direction: SlideDirection,
        duration: f64,
    },
}

/// A prototype transition between frames/pages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    /// Unique identifier for this transition.
    pub id: Uuid,
    /// The node that triggers the transition.
    pub source_node: NodeId,
    /// The page to navigate to.
    pub target_page: PageId,
    /// Optional specific node to scroll to on the target page.
    pub target_node: Option<NodeId>,
    /// What triggers the transition.
    pub trigger: TransitionTrigger,
    /// How the transition animates.
    pub animation: TransitionAnimation,
}

/// Validates a transition duration.
///
/// # Errors
/// Returns `CoreError::ValidationError` if duration is negative, NaN, infinity,
/// or exceeds the maximum.
pub fn validate_duration(duration: f64) -> Result<(), CoreError> {
    if !duration.is_finite() || duration < 0.0 {
        return Err(CoreError::ValidationError(format!(
            "duration must be non-negative and finite, got {duration}"
        )));
    }
    if duration > MAX_TRANSITION_DURATION {
        return Err(CoreError::ValidationError(format!(
            "duration {duration}s exceeds maximum {MAX_TRANSITION_DURATION}s"
        )));
    }
    Ok(())
}

/// Validates a transition's timing values.
///
/// # Errors
/// Returns `CoreError::ValidationError` if any duration or delay is invalid.
pub fn validate_transition(transition: &Transition) -> Result<(), CoreError> {
    // Validate trigger
    if let TransitionTrigger::AfterDelay { seconds } = &transition.trigger {
        validate_duration(*seconds)?;
    }

    // Validate animation durations
    match &transition.animation {
        TransitionAnimation::Instant => {}
        TransitionAnimation::Dissolve { duration }
        | TransitionAnimation::SlideIn { duration, .. }
        | TransitionAnimation::SlideOut { duration, .. }
        | TransitionAnimation::Push { duration, .. } => {
            validate_duration(*duration)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_transition() -> Transition {
        Transition {
            id: Uuid::nil(),
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(Uuid::nil()),
            target_node: None,
            trigger: TransitionTrigger::OnClick,
            animation: TransitionAnimation::Instant,
        }
    }

    #[test]
    fn test_transition_basic_construction() {
        let t = make_transition();
        assert_eq!(t.trigger, TransitionTrigger::OnClick);
        assert_eq!(t.animation, TransitionAnimation::Instant);
    }

    #[test]
    fn test_transition_serde_round_trip_instant() {
        let t = make_transition();
        let json = serde_json::to_string(&t).expect("serialize");
        let deserialized: Transition = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(t, deserialized);
    }

    #[test]
    fn test_transition_serde_round_trip_dissolve() {
        let t = Transition {
            animation: TransitionAnimation::Dissolve { duration: 0.3 },
            ..make_transition()
        };
        let json = serde_json::to_string(&t).expect("serialize");
        let deserialized: Transition = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(t, deserialized);
    }

    #[test]
    fn test_transition_serde_round_trip_slide() {
        let t = Transition {
            animation: TransitionAnimation::SlideIn {
                direction: SlideDirection::Right,
                duration: 0.5,
            },
            trigger: TransitionTrigger::AfterDelay { seconds: 2.0 },
            ..make_transition()
        };
        let json = serde_json::to_string(&t).expect("serialize");
        let deserialized: Transition = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(t, deserialized);
    }

    #[test]
    fn test_transition_trigger_serde() {
        let triggers = vec![
            TransitionTrigger::OnClick,
            TransitionTrigger::OnDrag,
            TransitionTrigger::OnHover,
            TransitionTrigger::AfterDelay { seconds: 1.5 },
        ];
        for trigger in triggers {
            let json = serde_json::to_string(&trigger).expect("serialize");
            let deserialized: TransitionTrigger =
                serde_json::from_str(&json).expect("deserialize");
            assert_eq!(trigger, deserialized);
        }
    }

    #[test]
    fn test_validate_duration_valid() {
        assert!(validate_duration(0.0).is_ok());
        assert!(validate_duration(1.5).is_ok());
        assert!(validate_duration(300.0).is_ok());
    }

    #[test]
    fn test_validate_duration_negative() {
        assert!(validate_duration(-1.0).is_err());
    }

    #[test]
    fn test_validate_duration_nan() {
        assert!(validate_duration(f64::NAN).is_err());
    }

    #[test]
    fn test_validate_duration_infinity() {
        assert!(validate_duration(f64::INFINITY).is_err());
    }

    #[test]
    fn test_validate_duration_exceeds_max() {
        assert!(validate_duration(301.0).is_err());
    }

    #[test]
    fn test_validate_transition_valid() {
        let t = Transition {
            animation: TransitionAnimation::Dissolve { duration: 0.5 },
            trigger: TransitionTrigger::AfterDelay { seconds: 2.0 },
            ..make_transition()
        };
        assert!(validate_transition(&t).is_ok());
    }

    #[test]
    fn test_validate_transition_bad_delay() {
        let t = Transition {
            trigger: TransitionTrigger::AfterDelay { seconds: -1.0 },
            ..make_transition()
        };
        assert!(validate_transition(&t).is_err());
    }

    #[test]
    fn test_validate_transition_bad_animation_duration() {
        let t = Transition {
            animation: TransitionAnimation::Push {
                direction: SlideDirection::Left,
                duration: f64::NAN,
            },
            ..make_transition()
        };
        assert!(validate_transition(&t).is_err());
    }

    #[test]
    fn test_slide_direction_serde() {
        let directions = vec![
            SlideDirection::Left,
            SlideDirection::Right,
            SlideDirection::Up,
            SlideDirection::Down,
        ];
        for dir in directions {
            let json = serde_json::to_string(&dir).expect("serialize");
            let deserialized: SlideDirection = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(dir, deserialized);
        }
    }
}
```

- [ ] 3. Remove the `Transition` stub from `crates/core/src/document.rs` (lines 59-63). Replace with an import:

```rust
use crate::prototype::Transition;
```

And re-export for backwards compatibility:
```rust
pub use crate::prototype::Transition;
```

- [ ] 4. Add `pub mod prototype;` to `crates/core/src/lib.rs` after `pub mod path;`:

```rust
pub mod prototype;
```

Add re-exports:
```rust
// ── Re-exports: Prototype ────────────────────────────────────────────
pub use prototype::{
    SlideDirection, TransitionAnimation, TransitionTrigger, validate_duration,
    validate_transition,
};
```

Note: `Transition` is already re-exported from `document` — keep it there to avoid breaking changes. The document module re-exports it from prototype.

Add the new validate constants to the validate re-exports.

- [ ] 5. Run tests and clippy:

```bash
./dev.sh cargo test -p agent-designer-core prototype::tests
./dev.sh cargo test -p agent-designer-core  # all tests
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 6. Commit:

```bash
git add crates/core/src/prototype.rs crates/core/src/document.rs crates/core/src/validate.rs crates/core/src/lib.rs
git commit -m "feat(core): add full transition types — TransitionTrigger, TransitionAnimation, SlideDirection (spec-01)"
```

---

## Task 4: Update serialization for typed transitions

**Files:**
- Modify: `crates/core/src/serialize.rs`

- [ ] 1. Change `SerializedPage.transitions` from `Vec<serde_json::Value>` to `Vec<Transition>`:

```rust
use crate::prototype::Transition;

pub struct SerializedPage {
    pub schema_version: u32,
    pub id: Uuid,
    pub name: String,
    pub nodes: Vec<SerializedNode>,
    pub transitions: Vec<Transition>,
}
```

- [ ] 2. Update `page_to_serialized` to pass real transitions. The function takes `page` and `arena` — it needs access to `transitions` from the document. Add a `transitions` parameter:

```rust
pub fn page_to_serialized(
    page: &crate::document::Page,
    arena: &crate::arena::Arena,
    transitions: &[Transition],
) -> Result<SerializedPage, CoreError> {
```

Filter transitions for this page (by `source_node` being in the page's node set):

```rust
    // Collect all node UUIDs in this page
    let mut page_node_uuids = std::collections::HashSet::new();
    for node in &all_nodes {
        page_node_uuids.insert(arena.uuid_of(node.id)?);
    }

    // Filter transitions whose source_node belongs to this page
    let page_transitions: Vec<Transition> = transitions
        .iter()
        .filter(|t| {
            arena
                .uuid_of(t.source_node)
                .ok()
                .map_or(false, |uuid| page_node_uuids.contains(&uuid))
        })
        .cloned()
        .collect();

    Ok(SerializedPage {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: page.id.uuid(),
        name: page.name.clone(),
        nodes: serialized_nodes,
        transitions: page_transitions,
    })
```

- [ ] 3. Update `serialize_page` (the wrapper that calls `page_to_serialized`) to also accept transitions:

```rust
pub fn serialize_page(
    page: &crate::document::Page,
    arena: &crate::arena::Arena,
    transitions: &[Transition],
) -> Result<String, CoreError> {
    let serialized = page_to_serialized(page, arena, transitions)?;
```

- [ ] 4. Update `deserialize_page` — the deserialized transitions are now typed `Vec<Transition>`. Add validation:

```rust
    // Validate transitions
    for transition in &page.transitions {
        crate::prototype::validate_transition(transition)?;
    }
```

- [ ] 5. Update all callers — search for existing calls to `page_to_serialized` and `serialize_page` in tests and update them to pass `&[]` or appropriate transition slices.

- [ ] 6. Add serialization tests:

```rust
#[test]
fn test_serialized_page_with_transitions_round_trip() {
    // Create a page, serialize with transitions, deserialize, verify transitions preserved
}
```

- [ ] 7. Run tests and clippy:

```bash
./dev.sh cargo test -p agent-designer-core
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 8. Commit:

```bash
git add crates/core/src/serialize.rs
git commit -m "feat(core): update serialization for typed transitions (spec-01)"
```

---

## Task 5: Run full workspace verification

**Files:** None (verification only)

- [ ] 1. Run full workspace tests:

```bash
./dev.sh cargo test --workspace
```

Expected: all tests pass.

- [ ] 2. Run clippy on workspace:

```bash
./dev.sh cargo clippy --workspace -- -D warnings
```

Expected: no warnings.

- [ ] 3. Run format check:

```bash
./dev.sh cargo fmt --check
```

Expected: clean.

- [ ] 4. If any issues, fix and commit.

---

## Deferred Items

### Plan 01d: Token Model + Component Model

- `Token`, `TokenValue`, `TokenType`, `DimensionUnit`, `ShadowValue`, `GradientValue`, `TypographyValue`
- `TokenContext` with alias resolution and cycle detection
- `OverrideMap` with `(Uuid, PropertyPath)` keys and `OverrideValue` values
- `ComponentDef` with `Variant`, `ComponentProperty`, `ComponentPropertyType`
- `NodeKind::ComponentInstance` updated with `variant` and `property_values` fields
- Token and component serialization (W3C Design Tokens Format)

### Plan 01e: Advanced Commands + Wire Formats

- Commands for transitions, tokens, components, path editing
- `SerializableCommand` / `BroadcastCommand` tagged enums
- Boolean path operations (`boolean_op`)
