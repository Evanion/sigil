// crates/core/src/lib.rs
#![warn(clippy::all, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod arena;
pub mod command;
pub mod commands;
pub mod document;
pub mod error;
pub mod id;
pub mod node;
pub mod serialize;
pub mod tree;
pub mod validate;

// ── Re-exports: Error ──────────────────────────────────────────────────
pub use error::CoreError;

// ── Re-exports: IDs ────────────────────────────────────────────────────
pub use id::{ComponentId, NodeId, PageId, TokenId};

// ── Re-exports: Node model ────────────────────────────────────────────
pub use node::{
    AlignItems, BlendMode, Color, Constraints, Effect, Fill, FillRule, FlexLayout, GradientDef,
    GradientStop, JustifyContent, LayoutDirection, LayoutMode, Node, NodeKind, OverrideMap,
    Padding, PathData, PinConstraint, Point, ScaleMode, Stroke, StrokeAlignment, StrokeCap,
    StrokeJoin, Style, StyleValue, TextAlign, TextStyle, Transform,
};

// ── Re-exports: Arena ──────────────────────────────────────────────────
pub use arena::Arena;

// ── Re-exports: Document ───────────────────────────────────────────────
pub use document::{
    ComponentDef, Document, DocumentMetadata, History, LayoutEngine, Page, TokenContext, Transition,
};

// ── Re-exports: Serialization ──────────────────────────────────────────
pub use serialize::{
    SerializedNode, SerializedPage, deserialize_page, nodes_to_serialized, page_to_serialized,
    serialize_page,
};

// ── Re-exports: Command ──────────────────────────────────────────────
pub use command::{Command, CompoundCommand, SideEffect};

// ── Re-exports: Validation ─────────────────────────────────────────────
pub use validate::{
    CURRENT_SCHEMA_VERSION, DEFAULT_MAX_HISTORY, DEFAULT_MAX_NODES, MAX_ALIAS_CHAIN_DEPTH,
    MAX_ASSET_REF_LEN, MAX_CHILDREN_PER_NODE, MAX_EFFECTS_PER_STYLE, MAX_FILE_SIZE,
    MAX_FILLS_PER_STYLE, MAX_FONT_FAMILY_LEN, MAX_GRADIENT_STOPS, MAX_JSON_NESTING_DEPTH,
    MAX_NODE_NAME_LEN, MAX_PAGES_PER_DOCUMENT, MAX_SEGMENTS_PER_SUBPATH, MAX_STROKES_PER_STYLE,
    MAX_SUBPATHS_PER_PATH, MAX_TEXT_CONTENT_LEN, MAX_TOKEN_NAME_LEN, validate_asset_ref,
    validate_collection_size, validate_node_name, validate_text_content, validate_token_name,
};

#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!version().is_empty());
    }
}
