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
    /// Whether undo is available.
    pub can_undo: bool,
    /// Whether redo is available.
    pub can_redo: bool,
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
    pub position: i32,
}

/// Input for reordering a node within its parent's children list.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReorderChildrenInput {
    /// UUID of the node to reorder.
    pub uuid: String,
    /// New position within the parent's children list (0-based).
    pub new_position: i32,
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

/// Result of undo/redo.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct UndoRedoResult {
    /// Whether undo is still available after the operation.
    pub can_undo: bool,
    /// Whether redo is still available after the operation.
    pub can_redo: bool,
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
            can_undo: true,
            can_redo: false,
        };
        let json = serde_json::to_string(&info).expect("serializable");
        assert!(json.contains("\"name\":\"My Doc\""));
        assert!(json.contains("\"page_count\":3"));
        assert!(json.contains("\"can_undo\":true"));
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
