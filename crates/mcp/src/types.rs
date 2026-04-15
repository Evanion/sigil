//! Shared input/output types for MCP tools.
//!
//! All types derive `schemars::JsonSchema` so rmcp can generate tool schemas
//! for agent consumption. Types are designed to be token-efficient — flat
//! structures with clear field names, no redundant nesting.
//!
//! ## Float validation
//!
//! Input types that carry `f64` fields (e.g. `TransformInput`) must have their
//! float values validated at the tool-handler layer before they are passed to
//! the core engine. NaN and infinity must be rejected there; see CLAUDE.md
//! §11 "Floating-Point Validation".

use rmcp::schemars;
use serde::{Deserialize, Serialize};

// ── Document types ────────────────────────────────────────────────────

/// Summary information about the current document.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct DocumentInfo {
    /// Document name.
    pub name: String,
    /// Number of pages.
    pub page_count: usize,
    /// Total number of nodes across all pages.
    pub node_count: usize,
}

/// A node in the document tree, serialized for MCP output.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct NodeInfo {
    /// Node UUID (stable identifier).
    pub uuid: String,
    /// Display name.
    pub name: String,
    /// Node type (e.g. "frame", "rectangle", "text", "group").
    pub kind: String,
    /// Whether the node is visible.
    pub visible: bool,
    /// Whether the node is locked.
    pub locked: bool,
    /// Child node UUIDs (order matters — front-to-back).
    pub children: Vec<String>,
    /// Transform: x, y, width, height, rotation.
    pub transform: TransformInfo,
}

/// Node transform values.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct TransformInfo {
    /// X position in pixels.
    pub x: f64,
    /// Y position in pixels.
    pub y: f64,
    /// Width in pixels.
    pub width: f64,
    /// Height in pixels.
    pub height: f64,
    /// Rotation in degrees.
    pub rotation: f64,
    /// Horizontal scale factor (omitted from output when 1.0).
    #[serde(skip_serializing_if = "is_default_scale")]
    pub scale_x: f64,
    /// Vertical scale factor (omitted from output when 1.0).
    #[serde(skip_serializing_if = "is_default_scale")]
    pub scale_y: f64,
}

#[allow(clippy::trivially_copy_pass_by_ref)] // serde skip_serializing_if requires &T
fn is_default_scale(v: &f64) -> bool {
    (*v - 1.0).abs() < f64::EPSILON
}

/// A page in the document.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PageInfo {
    /// Page UUID.
    pub id: String,
    /// Page name.
    pub name: String,
    /// UUIDs of root-level nodes on this page.
    pub root_nodes: Vec<String>,
}

/// The full document tree structure.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct DocumentTree {
    /// Document name.
    pub name: String,
    /// Pages with their node trees.
    pub pages: Vec<PageTree>,
}

/// A page with its complete node tree.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PageTree {
    /// Page UUID.
    pub id: String,
    /// Page name.
    pub name: String,
    /// All nodes on this page, flattened. Use `children` field to reconstruct hierarchy.
    pub nodes: Vec<NodeInfo>,
}

// ── Token types ───────────────────────────────────────────────────────

/// A design token.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct TokenInfo {
    /// Token name (e.g. "color.primary").
    pub name: String,
    /// Token type (e.g. "color", "dimension", "number").
    pub token_type: String,
    /// Token value as JSON.
    pub value: serde_json::Value,
    /// Optional description.
    pub description: Option<String>,
}

// ── Component types ───────────────────────────────────────────────────

/// A component definition summary.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ComponentInfo {
    /// Component UUID.
    pub id: String,
    /// Component name.
    pub name: String,
    /// Number of variants.
    pub variant_count: usize,
    /// Number of properties.
    pub property_count: usize,
}

// ── Tool input types ──────────────────────────────────────────────────

/// Input for creating a new page.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreatePageInput {
    /// Page name.
    pub name: String,
}

/// Input for deleting a page.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeletePageInput {
    /// UUID of the page to delete.
    pub page_id: String,
}

/// Input for renaming a page.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RenamePageInput {
    /// UUID of the page to rename.
    pub page_id: String,
    /// New name for the page.
    pub new_name: String,
}

/// Input for reordering a page within the document's page list.
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ReorderPageInput {
    /// UUID of the page to move.
    pub page_id: String,
    /// New zero-based position in the page list.
    pub new_position: u32,
}

/// Input for deleting a node.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteNodeInput {
    /// UUID of the node to delete.
    pub uuid: String,
}

/// Input for renaming a node.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RenameNodeInput {
    /// UUID of the node to rename.
    pub uuid: String,
    /// New display name for the node.
    pub new_name: String,
}

/// Input for setting a node's visibility.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetVisibleInput {
    /// UUID of the node to modify.
    pub uuid: String,
    /// New visibility state.
    pub visible: bool,
}

/// Input for setting a node's locked state.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetLockedInput {
    /// UUID of the node to modify.
    pub uuid: String,
    /// New locked state.
    pub locked: bool,
}

/// Input for setting a node's transform.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetTransformInput {
    /// UUID of the node to modify.
    pub uuid: String,
    /// New transform values.
    pub transform: TransformInput,
}

/// Input for creating a new node.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateNodeInput {
    /// Node type. One of: "frame", "rectangle", "ellipse", "text", "group", "image".
    pub kind: String,
    /// Display name for the node.
    pub name: String,
    /// UUID of the page to place the node on. If omitted, node is created without page placement.
    pub page_id: Option<String>,
    /// Optional parent node UUID. If provided, the node is added as a child.
    pub parent_uuid: Option<String>,
    /// Optional initial position and size.
    pub transform: Option<TransformInput>,
}

/// Input for reparenting a node to a new parent.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReparentNodeInput {
    /// UUID of the node to reparent.
    pub uuid: String,
    /// UUID of the new parent node.
    pub new_parent_uuid: String,
    /// Position within the new parent's children list (0-based).
    /// Positions beyond the children count are clamped to append.
    pub position: u32,
}

/// Input for reordering a node within its parent's children list.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReorderChildrenInput {
    /// UUID of the node to reorder.
    pub uuid: String,
    /// New position within the parent's children list (0-based).
    /// Positions beyond the children count are clamped by the core engine.
    pub new_position: u32,
}

/// Input for setting a node's transform.
///
/// Float fields are validated at the tool-handler layer — NaN and infinity are
/// rejected before the values reach the core engine.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TransformInput {
    /// X position in pixels.
    pub x: f64,
    /// Y position in pixels.
    pub y: f64,
    /// Width in pixels.
    pub width: f64,
    /// Height in pixels.
    pub height: f64,
    /// Rotation in degrees. Defaults to 0.0.
    #[serde(default)]
    pub rotation: f64,
    /// Horizontal scale factor. Defaults to 1.0.
    #[serde(default = "default_scale")]
    pub scale_x: f64,
    /// Vertical scale factor. Defaults to 1.0.
    #[serde(default = "default_scale")]
    pub scale_y: f64,
}

fn default_scale() -> f64 {
    1.0
}

/// Input for creating a design token.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateTokenInput {
    /// Token name (e.g. "color.primary", "spacing.md").
    pub name: String,
    /// Token type. One of: "color", "dimension", "`font_family`", "`font_weight`",
    /// "duration", "`cubic_bezier`", "number", "shadow", "gradient", "typography".
    pub token_type: String,
    /// Token value as JSON. Structure depends on `token_type`.
    ///
    /// Examples:
    /// - color: `{"value": {"r": 255, "g": 0, "b": 0, "a": 1.0}}`
    /// - number: `{"value": 42.0}`
    /// - dimension: `{"value": 16.0, "unit": "px"}`
    pub value: serde_json::Value,
    /// Optional human-readable description.
    pub description: Option<String>,
}

/// Input for updating a design token.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateTokenInput {
    /// Token name (must match existing token).
    pub name: String,
    /// New token type.
    pub token_type: String,
    /// New token value as JSON.
    pub value: serde_json::Value,
    /// Optional new description.
    pub description: Option<String>,
}

/// Input for deleting a design token.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteTokenInput {
    /// Name of the token to delete (e.g. "color.primary").
    pub name: String,
}

/// Input for atomically renaming a design token.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RenameTokenInput {
    /// Current name of the token to rename (e.g. "color.primary").
    pub old_name: String,
    /// Desired new name for the token (e.g. "color.brand").
    pub new_name: String,
}

/// Input for setting a node's opacity.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetOpacityInput {
    /// UUID of the node to modify.
    pub uuid: String,
    /// Opacity value in [0.0, 1.0].
    pub opacity: f64,
}

/// Input for setting a node's blend mode.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetBlendModeInput {
    /// UUID of the node to modify.
    pub uuid: String,
    /// Blend mode name (e.g. "normal", "multiply", "screen", "overlay").
    pub blend_mode: String,
}

/// Input for setting a node's fills.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetFillsInput {
    /// UUID of the node to modify.
    pub uuid: String,
    /// Array of fill objects. Deserialized to `Vec<Fill>` in the handler.
    pub fills: serde_json::Value,
}

/// Input for setting a node's strokes.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetStrokesInput {
    /// UUID of the node to modify.
    pub uuid: String,
    /// Array of stroke objects. Deserialized to `Vec<Stroke>` in the handler.
    pub strokes: serde_json::Value,
}

/// Input for setting a node's effects.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetEffectsInput {
    /// UUID of the node to modify.
    pub uuid: String,
    /// Array of effect objects. Deserialized to `Vec<Effect>` in the handler.
    pub effects: serde_json::Value,
}

/// Input for setting a rectangle node's corner radii.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetCornerRadiiInput {
    /// UUID of the node to modify (must be a rectangle).
    pub uuid: String,
    /// Four corner radii: [top-left, top-right, bottom-right, bottom-left].
    /// Each must be finite and non-negative.
    pub radii: Vec<f64>,
}

// ── Text tool input types ─────────────────────────────────────────────

/// Input for setting the text content of a text node.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetTextContentInput {
    /// UUID of the text node to modify.
    pub uuid: String,
    /// New text content.
    pub content: String,
}

/// Input for setting text style properties on a text node.
///
/// Only include the fields you want to change — omitted fields are left
/// unchanged. At least one field must be provided.
#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
pub struct SetTextStyleInput {
    /// UUID of the text node to modify.
    pub uuid: String,
    /// Partial text style — only fields that are `Some` will be applied.
    pub style: PartialTextStyle,
}

/// A partial text style object — only fields that are present will be updated.
///
/// Float fields are validated at the tool-handler layer — NaN and infinity are
/// rejected before the values reach the core engine.
#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
pub struct PartialTextStyle {
    /// Font family name (e.g. "Inter", "Roboto").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// Font size in pixels. Can be a literal or a token reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<StyleValueInput<f64>>,
    /// CSS font weight (1–1000).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    /// Font style: "normal" or "italic".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_style: Option<String>,
    /// Line height multiplier or absolute pixel value. Can be a literal or a token reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<StyleValueInput<f64>>,
    /// Letter spacing in pixels. Can be a literal or a token reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<StyleValueInput<f64>>,
    /// Text alignment: "left", "center", "right", or "justify".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,
    /// Text decoration: "none", "underline", or "strikethrough".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_decoration: Option<String>,
    /// Foreground text color. Can be a literal or a token reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color: Option<StyleValueInput<ColorInput>>,
    /// Text shadow. Pass `null` to remove an existing shadow; pass an object to set one.
    /// Omit the field entirely to leave the shadow unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_shadow: Option<Option<TextShadowInput>>,
}

/// A style value that is either a literal or a token reference.
///
/// Mirrors the core `StyleValue<T>` enum with `JsonSchema` support.
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StyleValueInput<T> {
    /// A literal value.
    Literal {
        /// The value.
        value: T,
    },
    /// A reference to a design token by name.
    TokenRef {
        /// Token name.
        name: String,
    },
}

/// Input representation of a color value.
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "space", rename_all = "snake_case")]
pub enum ColorInput {
    /// sRGB color with RGBA channels in [0.0, 1.0].
    Srgb {
        /// Red channel.
        r: f64,
        /// Green channel.
        g: f64,
        /// Blue channel.
        b: f64,
        /// Alpha channel.
        a: f64,
    },
    /// Display P3 color with RGBA channels.
    #[serde(rename = "display_p3")]
    DisplayP3 {
        /// Red channel.
        r: f64,
        /// Green channel.
        g: f64,
        /// Blue channel.
        b: f64,
        /// Alpha channel.
        a: f64,
    },
    /// Oklch color space.
    Oklch {
        /// Lightness.
        l: f64,
        /// Chroma.
        c: f64,
        /// Hue in degrees.
        h: f64,
        /// Alpha channel.
        a: f64,
    },
    /// Oklab color space.
    Oklab {
        /// Lightness.
        l: f64,
        /// a axis.
        a: f64,
        /// b axis.
        b: f64,
        /// Alpha channel.
        alpha: f64,
    },
}

/// Input for a text shadow effect.
///
/// Float fields are validated at the tool-handler layer.
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct TextShadowInput {
    /// Horizontal offset in pixels.
    pub offset_x: f64,
    /// Vertical offset in pixels.
    pub offset_y: f64,
    /// Blur radius in pixels (must be >= 0).
    pub blur_radius: f64,
    /// Shadow color. Can be a literal or a token reference.
    pub color: StyleValueInput<ColorInput>,
}

// ── Tool output types ─────────────────────────────────────────────────

/// Result of listing pages.
///
/// Wraps the page list in an object so the MCP output schema has a root
/// `object` type, as required by the MCP specification.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct PageListResult {
    /// All pages in the document.
    pub pages: Vec<PageInfo>,
}

/// Result of listing tokens.
///
/// Wraps the token list in an object so the MCP output schema has a root
/// `object` type, as required by the MCP specification.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct TokenListResult {
    /// All tokens in the document, sorted by name.
    pub tokens: Vec<TokenInfo>,
}

/// Result of listing components.
///
/// Wraps the component list in an object so the MCP output schema has a root
/// `object` type, as required by the MCP specification.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct ComponentListResult {
    /// All component definitions in the document, sorted by name.
    pub components: Vec<ComponentInfo>,
}

/// Result of a successful mutation.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct MutationResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// Human-readable message.
    pub message: String,
}

/// Result of creating a node.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct CreateNodeResult {
    /// UUID of the newly created node.
    pub uuid: String,
    /// The created node's info.
    pub node: NodeInfo,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_input_rotation_defaults_to_zero() {
        let json = r#"{"x": 10.0, "y": 20.0, "width": 100.0, "height": 50.0}"#;
        let input: TransformInput = serde_json::from_str(json).expect("valid JSON");
        assert_eq!(input.rotation, 0.0);
    }

    #[test]
    fn test_transform_input_scale_defaults_to_one() {
        let json = r#"{"x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0}"#;
        let input: TransformInput = serde_json::from_str(json).expect("valid JSON");
        assert_eq!(input.scale_x, 1.0);
        assert_eq!(input.scale_y, 1.0);
    }

    #[test]
    fn test_document_info_serializes_all_fields() {
        let info = DocumentInfo {
            name: "My Doc".to_string(),
            page_count: 3,
            node_count: 42,
        };
        let json = serde_json::to_string(&info).expect("serializable");
        assert!(json.contains("\"name\":\"My Doc\""));
        assert!(json.contains("\"page_count\":3"));
        assert!(json.contains("\"node_count\":42"));
    }

    #[test]
    fn test_mutation_result_serializes() {
        let result = MutationResult {
            success: true,
            message: "Node created".to_string(),
        };
        let json = serde_json::to_string(&result).expect("serializable");
        assert!(json.contains("\"success\":true"));
    }

    #[test]
    fn test_create_node_input_optional_fields_absent() {
        let json = r#"{"kind": "frame", "name": "My Frame"}"#;
        let input: CreateNodeInput = serde_json::from_str(json).expect("valid JSON");
        assert_eq!(input.kind, "frame");
        assert!(input.page_id.is_none());
        assert!(input.parent_uuid.is_none());
        assert!(input.transform.is_none());
    }

    #[test]
    fn test_create_token_input_deserializes() {
        let json = r#"{
            "name": "color.primary",
            "token_type": "color",
            "value": {"r": 255, "g": 0, "b": 0, "a": 1.0}
        }"#;
        let input: CreateTokenInput = serde_json::from_str(json).expect("valid JSON");
        assert_eq!(input.name, "color.primary");
        assert_eq!(input.token_type, "color");
        assert!(input.description.is_none());
    }
}
