// crates/core/src/node.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::id::{ComponentId, NodeId};

// Re-export path types for backwards compatibility
pub use crate::path::{FillRule, PathData};

// ── Forward declarations / stubs for Plan 01d types ────────────────────

/// Stub for the override map used in component instances.
/// Plan 01d will replace this with a full implementation.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OverrideMap {
    pub entries: HashMap<String, serde_json::Value>,
}

/// Layout mode for a frame's children.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum LayoutMode {
    Flex(FlexLayout),
    Grid(GridLayout),
}

/// Flex layout configuration for frame children.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlexLayout {
    pub direction: LayoutDirection,
    pub gap: f64,
    pub padding: Padding,
    pub align_items: AlignItems,
    pub justify_content: JustifyContent,
    pub wrap: bool,
}

impl Default for FlexLayout {
    fn default() -> Self {
        Self {
            direction: LayoutDirection::Row,
            gap: 0.0,
            padding: Padding::default(),
            align_items: AlignItems::Start,
            justify_content: JustifyContent::Start,
            wrap: false,
        }
    }
}

/// Direction for auto-layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayoutDirection {
    Row,
    Column,
}

/// Padding for auto-layout.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Padding {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

impl Default for Padding {
    fn default() -> Self {
        Self {
            top: 0.0,
            right: 0.0,
            bottom: 0.0,
            left: 0.0,
        }
    }
}

/// Alignment for auto-layout children.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlignItems {
    Start,
    Center,
    End,
    Stretch,
}

/// Justify content for auto-layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JustifyContent {
    Start,
    Center,
    End,
    SpaceBetween,
    SpaceAround,
    SpaceEvenly,
}

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
    /// From one line to another (1-based, exclusive end). Negative indices count from the end.
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

// ── Text Style ─────────────────────────────────────────────────────────

/// Text styling properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: StyleValue<f64>,
    pub font_weight: u16,
    pub line_height: StyleValue<f64>,
    pub letter_spacing: StyleValue<f64>,
    pub text_align: TextAlign,
    pub text_color: StyleValue<Color>,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "Inter".to_string(),
            font_size: StyleValue::Literal { value: 16.0 },
            font_weight: 400,
            line_height: StyleValue::Literal { value: 1.5 },
            letter_spacing: StyleValue::Literal { value: 0.0 },
            text_align: TextAlign::Left,
            text_color: StyleValue::Literal {
                value: Color::Srgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
        }
    }
}

/// Text alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextAlign {
    Left,
    Center,
    Right,
    Justify,
}

// ── Core Node Types ────────────────────────────────────────────────────

/// A 2D point.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    #[must_use]
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    #[must_use]
    pub fn zero() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

/// A style value that can be either a literal or a token reference.
///
/// Serializes as `{"type":"literal","value":...}` or `{"type":"token_ref","name":"..."}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StyleValue<T> {
    #[serde(rename = "literal")]
    Literal { value: T },
    #[serde(rename = "token_ref")]
    TokenRef { name: String },
}

impl<T: Default> Default for StyleValue<T> {
    fn default() -> Self {
        Self::Literal {
            value: T::default(),
        }
    }
}

/// Multi-color-space color representation.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "space", rename_all = "snake_case")]
pub enum Color {
    Srgb {
        r: f64,
        g: f64,
        b: f64,
        a: f64,
    },
    #[serde(rename = "display_p3")]
    DisplayP3 {
        r: f64,
        g: f64,
        b: f64,
        a: f64,
    },
    Oklch {
        l: f64,
        c: f64,
        h: f64,
        a: f64,
    },
    Oklab {
        l: f64,
        a: f64,
        b: f64,
        alpha: f64,
    },
}

impl Default for Color {
    fn default() -> Self {
        Self::Srgb {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        }
    }
}

/// Gradient stop point.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientStop {
    pub position: f64,
    pub color: StyleValue<Color>,
}

/// Gradient definition shared between linear and radial gradients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientDef {
    pub stops: Vec<GradientStop>,
    pub start: Point,
    pub end: Point,
}

/// Scale mode for image fills.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScaleMode {
    Fill,
    Fit,
    Tile,
    Stretch,
}

/// Fill types for a node's style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Fill {
    Solid {
        color: StyleValue<Color>,
    },
    LinearGradient {
        gradient: GradientDef,
    },
    RadialGradient {
        gradient: GradientDef,
    },
    Image {
        asset_ref: String,
        scale_mode: ScaleMode,
    },
}

/// Stroke alignment relative to the path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokeAlignment {
    Inside,
    Outside,
    Center,
}

/// Stroke cap style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokeCap {
    Butt,
    Round,
    Square,
}

/// Stroke join style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokeJoin {
    Miter,
    Round,
    Bevel,
}

/// Stroke definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub color: StyleValue<Color>,
    pub width: StyleValue<f64>,
    pub alignment: StrokeAlignment,
    pub cap: StrokeCap,
    pub join: StrokeJoin,
}

impl Default for Stroke {
    fn default() -> Self {
        Self {
            color: StyleValue::Literal {
                value: Color::Srgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
            width: StyleValue::Literal { value: 1.0 },
            alignment: StrokeAlignment::Center,
            cap: StrokeCap::Butt,
            join: StrokeJoin::Miter,
        }
    }
}

/// Visual effects applied to a node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Effect {
    DropShadow {
        color: StyleValue<Color>,
        offset: Point,
        blur: StyleValue<f64>,
        spread: StyleValue<f64>,
    },
    InnerShadow {
        color: StyleValue<Color>,
        offset: Point,
        blur: StyleValue<f64>,
        spread: StyleValue<f64>,
    },
    LayerBlur {
        radius: StyleValue<f64>,
    },
    BackgroundBlur {
        radius: StyleValue<f64>,
    },
}

/// Blend mode for compositing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

/// Visual style properties for a node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Style {
    pub fills: Vec<Fill>,
    pub strokes: Vec<Stroke>,
    pub opacity: StyleValue<f64>,
    pub blend_mode: BlendMode,
    pub effects: Vec<Effect>,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            fills: Vec::new(),
            strokes: Vec::new(),
            opacity: StyleValue::Literal { value: 1.0 },
            blend_mode: BlendMode::Normal,
            effects: Vec::new(),
        }
    }
}

/// Spatial transform for a node.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        }
    }
}

/// Pin constraint for positioning within a parent.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PinConstraint {
    #[default]
    Start,
    End,
    StartAndEnd,
    Center,
    Scale,
}

/// Positioning constraints for a node within its parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Constraints {
    pub horizontal: PinConstraint,
    pub vertical: PinConstraint,
}

impl Default for Constraints {
    fn default() -> Self {
        Self {
            horizontal: PinConstraint::Start,
            vertical: PinConstraint::Start,
        }
    }
}

/// The kind of a node, determining its specific properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeKind {
    Frame {
        layout: Option<LayoutMode>,
    },
    Rectangle {
        corner_radii: [f64; 4],
    },
    Ellipse {
        arc_start: f64,
        arc_end: f64,
    },
    Path {
        path_data: PathData,
    },
    Text {
        content: String,
        text_style: TextStyle,
    },
    Image {
        asset_ref: String,
    },
    Group,
    ComponentInstance {
        component_id: ComponentId,
        overrides: OverrideMap,
    },
}

/// A node in the design document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

impl Node {
    /// Creates a new node with the given id, uuid, kind, and name.
    /// All other fields are set to defaults.
    ///
    /// Validates the node name and kind-specific invariants.
    ///
    /// # Errors
    /// - `CoreError::ValidationError` if the name is invalid.
    /// - `CoreError::ValidationError` if kind-specific validation fails (e.g.,
    ///   invalid `asset_ref`, non-finite corner radii, text content too long, etc.).
    pub fn new(
        id: NodeId,
        uuid: Uuid,
        kind: NodeKind,
        name: String,
    ) -> Result<Self, crate::error::CoreError> {
        crate::validate::validate_node_name(&name)?;
        validate_node_kind(&kind)?;

        Ok(Self {
            id,
            uuid,
            kind,
            name,
            parent: None,
            children: Vec::new(),
            transform: Transform::default(),
            style: Style::default(),
            constraints: Constraints::default(),
            grid_placement: None,
            visible: true,
            locked: false,
        })
    }
}

/// Validates kind-specific invariants for a `NodeKind`.
///
/// Called from `Node::new` to ensure all node kinds pass validation
/// before the node is constructed.
///
/// # Errors
/// Returns `CoreError::ValidationError` if any kind-specific validation fails.
fn validate_node_kind(kind: &NodeKind) -> Result<(), crate::error::CoreError> {
    use crate::validate::{
        MAX_FONT_FAMILY_LEN, MAX_FONT_WEIGHT, MIN_FONT_WEIGHT, validate_finite,
        validate_text_content,
    };

    match kind {
        NodeKind::Image { asset_ref } => {
            crate::validate::validate_asset_ref(asset_ref)?;
        }
        NodeKind::Text {
            content,
            text_style,
        } => {
            validate_text_content(content)?;
            if text_style.font_family.len() > MAX_FONT_FAMILY_LEN {
                return Err(crate::error::CoreError::ValidationError(format!(
                    "font_family exceeds max length of {MAX_FONT_FAMILY_LEN} (got {})",
                    text_style.font_family.len()
                )));
            }
            if text_style.font_weight < MIN_FONT_WEIGHT
                || text_style.font_weight > MAX_FONT_WEIGHT
            {
                return Err(crate::error::CoreError::ValidationError(format!(
                    "font_weight must be in {}..={}, got {}",
                    MIN_FONT_WEIGHT, MAX_FONT_WEIGHT, text_style.font_weight
                )));
            }
        }
        NodeKind::Rectangle { corner_radii } => {
            for (i, r) in corner_radii.iter().enumerate() {
                validate_finite(&format!("corner_radii[{i}]"), *r)?;
                if *r < 0.0 {
                    return Err(crate::error::CoreError::ValidationError(format!(
                        "corner_radii[{i}] must be >= 0.0, got {r}"
                    )));
                }
            }
        }
        NodeKind::Ellipse {
            arc_start,
            arc_end,
        } => {
            validate_finite("arc_start", *arc_start)?;
            validate_finite("arc_end", *arc_end)?;
        }
        NodeKind::Frame {
            layout: Some(LayoutMode::Flex(flex)),
        } => {
            validate_flex_layout(flex)?;
        }
        NodeKind::Frame {
            layout: Some(LayoutMode::Grid(grid)),
        } => {
            validate_grid_layout(grid)?;
        }
        _ => {}
    }

    Ok(())
}

/// Validates a flex layout's gap and padding values.
fn validate_flex_layout(flex: &FlexLayout) -> Result<(), crate::error::CoreError> {
    use crate::validate::validate_finite;

    validate_finite("flex gap", flex.gap)?;
    if flex.gap < 0.0 {
        return Err(crate::error::CoreError::ValidationError(format!(
            "flex gap must be >= 0.0, got {}",
            flex.gap
        )));
    }
    validate_padding("flex", &flex.padding)?;
    Ok(())
}

/// Validates a grid layout's gaps, padding, track counts, and track values.
fn validate_grid_layout(grid: &GridLayout) -> Result<(), crate::error::CoreError> {
    use crate::validate::{MAX_GRID_TRACKS, validate_finite, validate_grid_track};

    validate_finite("grid column_gap", grid.column_gap)?;
    validate_finite("grid row_gap", grid.row_gap)?;
    if grid.column_gap < 0.0 {
        return Err(crate::error::CoreError::ValidationError(format!(
            "grid column_gap must be >= 0.0, got {}",
            grid.column_gap
        )));
    }
    if grid.row_gap < 0.0 {
        return Err(crate::error::CoreError::ValidationError(format!(
            "grid row_gap must be >= 0.0, got {}",
            grid.row_gap
        )));
    }
    validate_padding("grid", &grid.padding)?;
    if grid.columns.len() > MAX_GRID_TRACKS {
        return Err(crate::error::CoreError::ValidationError(format!(
            "grid columns exceeds max of {MAX_GRID_TRACKS} (got {})",
            grid.columns.len()
        )));
    }
    if grid.rows.len() > MAX_GRID_TRACKS {
        return Err(crate::error::CoreError::ValidationError(format!(
            "grid rows exceeds max of {MAX_GRID_TRACKS} (got {})",
            grid.rows.len()
        )));
    }
    for track in &grid.columns {
        validate_grid_track(track)?;
    }
    for track in &grid.rows {
        validate_grid_track(track)?;
    }
    Ok(())
}

/// Validates that all padding values are finite and non-negative.
fn validate_padding(prefix: &str, padding: &Padding) -> Result<(), crate::error::CoreError> {
    use crate::validate::validate_finite;

    validate_finite(&format!("{prefix} padding.top"), padding.top)?;
    validate_finite(&format!("{prefix} padding.right"), padding.right)?;
    validate_finite(&format!("{prefix} padding.bottom"), padding.bottom)?;
    validate_finite(&format!("{prefix} padding.left"), padding.left)?;
    if padding.top < 0.0 || padding.right < 0.0 || padding.bottom < 0.0 || padding.left < 0.0 {
        return Err(crate::error::CoreError::ValidationError(format!(
            "{prefix} padding values must be >= 0.0"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Node construction ──────────────────────────────────────────────

    #[test]
    fn test_new_node_has_defaults() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node =
            Node::new(id, uuid, NodeKind::Group, "Group 1".to_string()).expect("create test node");
        assert_eq!(node.id, id);
        assert_eq!(node.uuid, uuid);
        assert_eq!(node.name, "Group 1");
        assert!(node.parent.is_none());
        assert!(node.children.is_empty());
        assert!(node.visible);
        assert!(!node.locked);
    }

    #[test]
    fn test_new_frame_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Frame { layout: None },
            "Frame 1".to_string(),
        )
        .expect("create test node");
        match &node.kind {
            NodeKind::Frame { layout } => assert!(layout.is_none()),
            other => panic!("expected Frame, got {other:?}"),
        }
    }

    #[test]
    fn test_new_rectangle_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Rectangle {
                corner_radii: [4.0, 4.0, 4.0, 4.0],
            },
            "Rect 1".to_string(),
        )
        .expect("create test node");
        match &node.kind {
            NodeKind::Rectangle { corner_radii } => {
                assert_eq!(*corner_radii, [4.0, 4.0, 4.0, 4.0]);
            }
            other => panic!("expected Rectangle, got {other:?}"),
        }
    }

    #[test]
    fn test_new_ellipse_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Ellipse {
                arc_start: 0.0,
                arc_end: 360.0,
            },
            "Ellipse 1".to_string(),
        )
        .expect("create test node");
        match &node.kind {
            NodeKind::Ellipse { arc_start, arc_end } => {
                assert!((arc_start - 0.0).abs() < f64::EPSILON);
                assert!((arc_end - 360.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Ellipse, got {other:?}"),
        }
    }

    #[test]
    fn test_new_text_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle::default(),
            },
            "Text 1".to_string(),
        )
        .expect("create test node");
        match &node.kind {
            NodeKind::Text { content, .. } => assert_eq!(content, "Hello"),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[test]
    fn test_new_image_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Image {
                asset_ref: "images/logo.png".to_string(),
            },
            "Image 1".to_string(),
        )
        .expect("create test node");
        match &node.kind {
            NodeKind::Image { asset_ref } => assert_eq!(asset_ref, "images/logo.png"),
            other => panic!("expected Image, got {other:?}"),
        }
    }

    #[test]
    fn test_new_path_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Path {
                path_data: PathData::default(),
            },
            "Path 1".to_string(),
        )
        .expect("create test node");
        match &node.kind {
            NodeKind::Path { path_data } => {
                assert!(path_data.subpaths().is_empty());
                assert_eq!(path_data.fill_rule(), FillRule::EvenOdd);
            }
            other => panic!("expected Path, got {other:?}"),
        }
    }

    #[test]
    fn test_new_component_instance_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let component_id = ComponentId::new(Uuid::nil());
        let node = Node::new(
            id,
            uuid,
            NodeKind::ComponentInstance {
                component_id,
                overrides: OverrideMap::default(),
            },
            "Instance 1".to_string(),
        )
        .expect("create test node");
        match &node.kind {
            NodeKind::ComponentInstance {
                component_id: cid,
                overrides,
            } => {
                assert_eq!(*cid, component_id);
                assert!(overrides.entries.is_empty());
            }
            other => panic!("expected ComponentInstance, got {other:?}"),
        }
    }

    // ── Transform ──────────────────────────────────────────────────────

    #[test]
    fn test_transform_default() {
        let t = Transform::default();
        assert!((t.x - 0.0).abs() < f64::EPSILON);
        assert!((t.y - 0.0).abs() < f64::EPSILON);
        assert!((t.width - 100.0).abs() < f64::EPSILON);
        assert!((t.height - 100.0).abs() < f64::EPSILON);
        assert!((t.rotation - 0.0).abs() < f64::EPSILON);
        assert!((t.scale_x - 1.0).abs() < f64::EPSILON);
        assert!((t.scale_y - 1.0).abs() < f64::EPSILON);
    }

    // ── Style ──────────────────────────────────────────────────────────

    #[test]
    fn test_style_default() {
        let s = Style::default();
        assert!(s.fills.is_empty());
        assert!(s.strokes.is_empty());
        assert_eq!(s.opacity, StyleValue::Literal { value: 1.0 });
        assert_eq!(s.blend_mode, BlendMode::Normal);
        assert!(s.effects.is_empty());
    }

    // ── Color ──────────────────────────────────────────────────────────

    #[test]
    fn test_color_srgb_default() {
        let c = Color::default();
        match c {
            Color::Srgb { r, g, b, a } => {
                assert!((r - 0.0).abs() < f64::EPSILON);
                assert!((g - 0.0).abs() < f64::EPSILON);
                assert!((b - 0.0).abs() < f64::EPSILON);
                assert!((a - 1.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Srgb, got {other:?}"),
        }
    }

    #[test]
    fn test_color_display_p3() {
        let c = Color::DisplayP3 {
            r: 1.0,
            g: 0.0,
            b: 0.5,
            a: 0.8,
        };
        match c {
            Color::DisplayP3 { r, g, b, a } => {
                assert!((r - 1.0).abs() < f64::EPSILON);
                assert!((g - 0.0).abs() < f64::EPSILON);
                assert!((b - 0.5).abs() < f64::EPSILON);
                assert!((a - 0.8).abs() < f64::EPSILON);
            }
            other => panic!("expected DisplayP3, got {other:?}"),
        }
    }

    #[test]
    fn test_color_oklch() {
        let c = Color::Oklch {
            l: 0.7,
            c: 0.15,
            h: 180.0,
            a: 1.0,
        };
        match c {
            Color::Oklch { l, c, h, a } => {
                assert!((l - 0.7).abs() < f64::EPSILON);
                assert!((c - 0.15).abs() < f64::EPSILON);
                assert!((h - 180.0).abs() < f64::EPSILON);
                assert!((a - 1.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Oklch, got {other:?}"),
        }
    }

    #[test]
    fn test_color_oklab() {
        let c = Color::Oklab {
            l: 0.5,
            a: -0.1,
            b: 0.2,
            alpha: 1.0,
        };
        match c {
            Color::Oklab { l, a, b, alpha } => {
                assert!((l - 0.5).abs() < f64::EPSILON);
                assert!((a - (-0.1)).abs() < f64::EPSILON);
                assert!((b - 0.2).abs() < f64::EPSILON);
                assert!((alpha - 1.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Oklab, got {other:?}"),
        }
    }

    // ── StyleValue ─────────────────────────────────────────────────────

    #[test]
    fn test_style_value_literal() {
        let sv: StyleValue<f64> = StyleValue::Literal { value: 0.5 };
        match sv {
            StyleValue::Literal { value: v } => assert!((v - 0.5).abs() < f64::EPSILON),
            StyleValue::TokenRef { .. } => panic!("expected Literal"),
        }
    }

    #[test]
    fn test_style_value_token_ref() {
        let sv: StyleValue<f64> = StyleValue::TokenRef {
            name: "opacity.primary".to_string(),
        };
        match sv {
            StyleValue::TokenRef { name } => assert_eq!(name, "opacity.primary"),
            StyleValue::Literal { .. } => panic!("expected TokenRef"),
        }
    }

    #[test]
    fn test_style_value_default() {
        let sv: StyleValue<f64> = StyleValue::default();
        assert_eq!(sv, StyleValue::Literal { value: 0.0 });
    }

    // ── Fill ───────────────────────────────────────────────────────────

    #[test]
    fn test_fill_solid() {
        let fill = Fill::Solid {
            color: StyleValue::Literal {
                value: Color::Srgb {
                    r: 1.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
        };
        match &fill {
            Fill::Solid { color } => {
                assert_eq!(
                    *color,
                    StyleValue::Literal {
                        value: Color::Srgb {
                            r: 1.0,
                            g: 0.0,
                            b: 0.0,
                            a: 1.0
                        }
                    }
                );
            }
            other => panic!("expected Solid, got {other:?}"),
        }
    }

    #[test]
    fn test_fill_solid_with_token_ref() {
        let fill = Fill::Solid {
            color: StyleValue::TokenRef {
                name: "color.primary.500".to_string(),
            },
        };
        match &fill {
            Fill::Solid { color } => {
                assert_eq!(
                    *color,
                    StyleValue::TokenRef {
                        name: "color.primary.500".to_string()
                    }
                );
            }
            other => panic!("expected Solid, got {other:?}"),
        }
    }

    #[test]
    fn test_fill_image() {
        let fill = Fill::Image {
            asset_ref: "images/bg.png".to_string(),
            scale_mode: ScaleMode::Fill,
        };
        match &fill {
            Fill::Image {
                asset_ref,
                scale_mode,
            } => {
                assert_eq!(asset_ref, "images/bg.png");
                assert_eq!(*scale_mode, ScaleMode::Fill);
            }
            other => panic!("expected Image, got {other:?}"),
        }
    }

    // ── Stroke ─────────────────────────────────────────────────────────

    #[test]
    fn test_stroke_default() {
        let s = Stroke::default();
        assert_eq!(s.alignment, StrokeAlignment::Center);
        assert_eq!(s.cap, StrokeCap::Butt);
        assert_eq!(s.join, StrokeJoin::Miter);
        assert_eq!(s.width, StyleValue::Literal { value: 1.0 });
    }

    // ── Effect ─────────────────────────────────────────────────────────

    #[test]
    fn test_effect_drop_shadow() {
        let effect = Effect::DropShadow {
            color: StyleValue::Literal {
                value: Color::Srgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 0.25,
                },
            },
            offset: Point::new(0.0, 4.0),
            blur: StyleValue::Literal { value: 8.0 },
            spread: StyleValue::Literal { value: 0.0 },
        };
        match &effect {
            Effect::DropShadow { offset, .. } => {
                assert!((offset.y - 4.0).abs() < f64::EPSILON);
            }
            other => panic!("expected DropShadow, got {other:?}"),
        }
    }

    #[test]
    fn test_effect_layer_blur() {
        let effect = Effect::LayerBlur {
            radius: StyleValue::Literal { value: 10.0 },
        };
        match &effect {
            Effect::LayerBlur { radius } => {
                assert_eq!(*radius, StyleValue::Literal { value: 10.0 });
            }
            other => panic!("expected LayerBlur, got {other:?}"),
        }
    }

    #[test]
    fn test_effect_background_blur() {
        let effect = Effect::BackgroundBlur {
            radius: StyleValue::TokenRef {
                name: "blur.background".to_string(),
            },
        };
        match &effect {
            Effect::BackgroundBlur { radius } => {
                assert_eq!(
                    *radius,
                    StyleValue::TokenRef {
                        name: "blur.background".to_string()
                    }
                );
            }
            other => panic!("expected BackgroundBlur, got {other:?}"),
        }
    }

    // ── BlendMode ──────────────────────────────────────────────────────

    #[test]
    fn test_blend_mode_default() {
        assert_eq!(BlendMode::default(), BlendMode::Normal);
    }

    // ── Constraints ────────────────────────────────────────────────────

    #[test]
    fn test_constraints_default() {
        let c = Constraints::default();
        assert_eq!(c.horizontal, PinConstraint::Start);
        assert_eq!(c.vertical, PinConstraint::Start);
    }

    // ── Point ──────────────────────────────────────────────────────────

    #[test]
    fn test_point_new() {
        let p = Point::new(3.0, 4.0);
        assert!((p.x - 3.0).abs() < f64::EPSILON);
        assert!((p.y - 4.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_point_zero() {
        let p = Point::zero();
        assert!((p.x - 0.0).abs() < f64::EPSILON);
        assert!((p.y - 0.0).abs() < f64::EPSILON);
    }

    // ── Serde round-trip for key types ─────────────────────────────────

    #[test]
    fn test_color_srgb_serde_round_trip() {
        let c = Color::Srgb {
            r: 0.5,
            g: 0.6,
            b: 0.7,
            a: 0.8,
        };
        let json = serde_json::to_string(&c).expect("serialize");
        let deserialized: Color = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(c, deserialized);
    }

    #[test]
    fn test_color_display_p3_serde_round_trip() {
        let c = Color::DisplayP3 {
            r: 1.0,
            g: 0.0,
            b: 0.5,
            a: 1.0,
        };
        let json = serde_json::to_string(&c).expect("serialize");
        let deserialized: Color = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(c, deserialized);
    }

    #[test]
    fn test_node_kind_frame_serde_round_trip() {
        let kind = NodeKind::Frame { layout: None };
        let json = serde_json::to_string(&kind).expect("serialize");
        let deserialized: NodeKind = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(kind, deserialized);
    }

    #[test]
    fn test_node_kind_rectangle_serde_round_trip() {
        let kind = NodeKind::Rectangle {
            corner_radii: [1.0, 2.0, 3.0, 4.0],
        };
        let json = serde_json::to_string(&kind).expect("serialize");
        let deserialized: NodeKind = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(kind, deserialized);
    }

    #[test]
    fn test_blend_mode_serde_round_trip() {
        let modes = [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
            BlendMode::ColorDodge,
            BlendMode::ColorBurn,
            BlendMode::HardLight,
            BlendMode::SoftLight,
            BlendMode::Difference,
            BlendMode::Exclusion,
            BlendMode::Hue,
            BlendMode::Saturation,
            BlendMode::Color,
            BlendMode::Luminosity,
        ];
        for mode in &modes {
            let json = serde_json::to_string(mode).expect("serialize");
            let deserialized: BlendMode = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(*mode, deserialized);
        }
    }

    #[test]
    fn test_fill_solid_serde_round_trip() {
        let fill = Fill::Solid {
            color: StyleValue::Literal {
                value: Color::Srgb {
                    r: 1.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
        };
        let json = serde_json::to_string(&fill).expect("serialize");
        let deserialized: Fill = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(fill, deserialized);
    }

    #[test]
    fn test_effect_serde_round_trip() {
        let effect = Effect::DropShadow {
            color: StyleValue::Literal {
                value: Color::Srgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 0.5,
                },
            },
            offset: Point::new(2.0, 4.0),
            blur: StyleValue::Literal { value: 8.0 },
            spread: StyleValue::Literal { value: 0.0 },
        };
        let json = serde_json::to_string(&effect).expect("serialize");
        let deserialized: Effect = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(effect, deserialized);
    }

    #[test]
    fn test_style_value_serde_literal_round_trip() {
        let sv: StyleValue<f64> = StyleValue::Literal { value: 0.75 };
        let json = serde_json::to_string(&sv).expect("serialize");
        let deserialized: StyleValue<f64> = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(sv, deserialized);
    }

    #[test]
    fn test_style_value_serde_token_ref_round_trip() {
        let sv: StyleValue<f64> = StyleValue::TokenRef {
            name: "opacity.hover".to_string(),
        };
        let json = serde_json::to_string(&sv).expect("serialize");
        let deserialized: StyleValue<f64> = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(sv, deserialized);
    }

    #[test]
    fn test_full_node_serde_round_trip() {
        let id = NodeId::new(5, 12);
        let uuid = Uuid::nil();
        let node = Node {
            id,
            uuid,
            kind: NodeKind::Frame { layout: None },
            name: "Test Frame".to_string(),
            parent: None,
            children: vec![NodeId::new(6, 12)],
            transform: Transform {
                x: 10.0,
                y: 20.0,
                width: 200.0,
                height: 150.0,
                rotation: 45.0,
                scale_x: 1.0,
                scale_y: 1.0,
            },
            style: Style {
                fills: vec![Fill::Solid {
                    color: StyleValue::Literal {
                        value: Color::Srgb {
                            r: 1.0,
                            g: 1.0,
                            b: 1.0,
                            a: 1.0,
                        },
                    },
                }],
                strokes: vec![],
                opacity: StyleValue::Literal { value: 0.9 },
                blend_mode: BlendMode::Normal,
                effects: vec![],
            },
            constraints: Constraints {
                horizontal: PinConstraint::StartAndEnd,
                vertical: PinConstraint::Start,
            },
            visible: true,
            locked: false,
            grid_placement: None,
        };
        let json = serde_json::to_string_pretty(&node).expect("serialize");
        let deserialized: Node = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(node, deserialized);
    }

    #[test]
    fn test_layout_default() {
        let al = FlexLayout::default();
        assert_eq!(al.direction, LayoutDirection::Row);
        assert!((al.gap - 0.0).abs() < f64::EPSILON);
        assert!(!al.wrap);
    }

    #[test]
    fn test_node_kind_group_serde_round_trip() {
        let kind = NodeKind::Group;
        let json = serde_json::to_string(&kind).expect("serialize");
        let deserialized: NodeKind = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(kind, deserialized);
    }

    #[test]
    fn test_node_kind_text_serde_round_trip() {
        let kind = NodeKind::Text {
            content: "Hello World".to_string(),
            text_style: TextStyle::default(),
        };
        let json = serde_json::to_string(&kind).expect("serialize");
        let deserialized: NodeKind = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(kind, deserialized);
    }

    #[test]
    fn test_constraints_serde_round_trip() {
        let c = Constraints {
            horizontal: PinConstraint::Center,
            vertical: PinConstraint::Scale,
        };
        let json = serde_json::to_string(&c).expect("serialize");
        let deserialized: Constraints = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(c, deserialized);
    }

    // ── Grid layout types ─────────────────────────────────────────────

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

    // ── RF-006: Node::new validation for all NodeKind variants ────────

    #[test]
    fn test_text_node_rejects_too_long_content() {
        let content = "x".repeat(crate::validate::MAX_TEXT_CONTENT_LEN + 1);
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Text {
                content,
                text_style: TextStyle::default(),
            },
            "Text".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_text_node_rejects_too_long_font_family() {
        let font_family = "x".repeat(crate::validate::MAX_FONT_FAMILY_LEN + 1);
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle {
                    font_family,
                    ..TextStyle::default()
                },
            },
            "Text".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_text_node_rejects_zero_font_weight() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle {
                    font_weight: 0,
                    ..TextStyle::default()
                },
            },
            "Text".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_text_node_rejects_font_weight_over_1000() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle {
                    font_weight: 1001,
                    ..TextStyle::default()
                },
            },
            "Text".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_text_node_accepts_valid_font_weight_boundaries() {
        for weight in [1, 400, 1000] {
            let result = Node::new(
                NodeId::new(0, 0),
                Uuid::nil(),
                NodeKind::Text {
                    content: "Hello".to_string(),
                    text_style: TextStyle {
                        font_weight: weight,
                        ..TextStyle::default()
                    },
                },
                "Text".to_string(),
            );
            assert!(result.is_ok(), "font_weight {weight} should be valid");
        }
    }

    #[test]
    fn test_rectangle_rejects_nan_corner_radius() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Rectangle {
                corner_radii: [0.0, f64::NAN, 0.0, 0.0],
            },
            "Rect".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_rectangle_rejects_negative_corner_radius() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Rectangle {
                corner_radii: [4.0, -1.0, 4.0, 4.0],
            },
            "Rect".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_rectangle_rejects_infinite_corner_radius() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Rectangle {
                corner_radii: [4.0, 4.0, f64::INFINITY, 4.0],
            },
            "Rect".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_ellipse_rejects_nan_arc_start() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Ellipse {
                arc_start: f64::NAN,
                arc_end: 360.0,
            },
            "Ellipse".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_ellipse_rejects_infinite_arc_end() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Ellipse {
                arc_start: 0.0,
                arc_end: f64::INFINITY,
            },
            "Ellipse".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_frame_flex_rejects_nan_gap() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Frame {
                layout: Some(LayoutMode::Flex(FlexLayout {
                    gap: f64::NAN,
                    ..FlexLayout::default()
                })),
            },
            "Frame".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_frame_flex_rejects_negative_gap() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Frame {
                layout: Some(LayoutMode::Flex(FlexLayout {
                    gap: -1.0,
                    ..FlexLayout::default()
                })),
            },
            "Frame".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_frame_flex_rejects_negative_padding() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Frame {
                layout: Some(LayoutMode::Flex(FlexLayout {
                    padding: Padding {
                        top: -1.0,
                        ..Padding::default()
                    },
                    ..FlexLayout::default()
                })),
            },
            "Frame".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_frame_grid_rejects_negative_gap() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Frame {
                layout: Some(LayoutMode::Grid(GridLayout {
                    column_gap: -1.0,
                    ..GridLayout::default()
                })),
            },
            "Frame".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_frame_grid_rejects_too_many_columns() {
        let tracks: Vec<GridTrack> = (0..crate::validate::MAX_GRID_TRACKS + 1)
            .map(|_| GridTrack::Auto)
            .collect();
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Frame {
                layout: Some(LayoutMode::Grid(GridLayout {
                    columns: tracks,
                    ..GridLayout::default()
                })),
            },
            "Frame".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_frame_grid_validates_track_values() {
        let result = Node::new(
            NodeId::new(0, 0),
            Uuid::nil(),
            NodeKind::Frame {
                layout: Some(LayoutMode::Grid(GridLayout {
                    columns: vec![GridTrack::Fixed { size: -10.0 }],
                    ..GridLayout::default()
                })),
            },
            "Frame".to_string(),
        );
        assert!(result.is_err());
    }
}
