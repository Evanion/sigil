// crates/core/src/lib.rs
#![warn(clippy::all, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod arena;
pub mod boolean;
pub mod command;
pub mod commands;
pub mod component;
pub mod document;
pub mod error;
pub mod id;
pub mod node;
pub mod path;
pub mod prototype;
pub mod serialize;
pub mod token;
pub mod tree;
pub mod validate;
pub mod wire;

// ── Re-exports: Error ──────────────────────────────────────────────────
pub use error::CoreError;

// ── Re-exports: IDs ────────────────────────────────────────────────────
pub use id::{ComponentId, NodeId, PageId, TokenId};

// ── Re-exports: Node model ────────────────────────────────────────────
pub use node::{
    AlignItems, BlendMode, Color, Constraints, Effect, Fill, FillRule, FlexLayout, GradientDef,
    GradientStop, GridLayout, GridPlacement, GridSpan, GridTrack, JustifyContent, JustifyItems,
    LayoutDirection, LayoutMode, Node, NodeKind, Padding, PathData, PinConstraint, Point,
    ScaleMode, Stroke, StrokeAlignment, StrokeCap, StrokeJoin, Style, StyleValue, TextAlign,
    TextStyle, Transform,
};

// ── Re-exports: Path ─────────────────────────────────────────────────
pub use path::{AnchorPoint, CornerMode, PathSegment, SubPath};

// ── Re-exports: Boolean ──────────────────────────────────────────────
pub use boolean::{BooleanOp, boolean_op};

// ── Re-exports: Prototype ────────────────────────────────────────────
pub use prototype::{
    SlideDirection, TransitionAnimation, TransitionTrigger, validate_duration, validate_transition,
};

// ── Re-exports: Token ──────────────────────────────────────────────────
pub use token::{
    DimensionUnit, ShadowValue, Token, TokenContext, TokenType, TokenValue, TypographyValue,
    validate_token_value,
};

// ── Re-exports: Arena ──────────────────────────────────────────────────
pub use arena::Arena;

// ── Re-exports: Document ───────────────────────────────────────────────
pub use document::{Document, DocumentMetadata, LayoutEngine, Page, Transition};

// ── Re-exports: Serialization ──────────────────────────────────────────
pub use serialize::{
    SerializedNode, SerializedPage, SerializedTransition, deserialize_page, nodes_to_serialized,
    page_to_serialized, serialize_page,
};

// ── Re-exports: Command ──────────────────────────────────────────────
pub use command::{FieldOperation, SideEffect};

// ── Re-exports: Component ───────────────────────────────────────────────
pub use component::{
    ComponentDef, ComponentProperty, ComponentPropertyType, OverrideKey, OverrideMap,
    OverrideSource, OverrideValue, PropertyPath, Variant, validate_override_value,
    validate_property_path,
};

// ── Re-exports: Validation ─────────────────────────────────────────────
pub use validate::{
    BEZIER_APPROXIMATION_SEGMENTS, CURRENT_SCHEMA_VERSION, DEFAULT_MAX_NODES,
    MAX_ALIAS_CHAIN_DEPTH, MAX_ASSET_REF_LEN, MAX_BATCH_SIZE, MAX_BOOLEAN_OP_POINTS,
    MAX_CHILDREN_PER_NODE, MAX_COMPONENTS_PER_DOCUMENT, MAX_EFFECTS_PER_STYLE, MAX_FILE_SIZE,
    MAX_FILLS_PER_STYLE, MAX_FONT_FAMILY_LEN, MAX_FONT_WEIGHT, MAX_GRADIENT_STOPS, MAX_GRID_TRACKS,
    MAX_JSON_NESTING_DEPTH, MAX_NODE_NAME_LEN, MAX_OVERRIDES_PER_INSTANCE, MAX_PAGE_NAME_LEN,
    MAX_PAGES_PER_DOCUMENT, MAX_PROPERTIES_PER_COMPONENT, MAX_SEGMENTS_PER_SUBPATH,
    MAX_STROKES_PER_STYLE, MAX_SUBPATHS_PER_PATH, MAX_TEXT_CONTENT_LEN, MAX_TOKEN_DESCRIPTION_LEN,
    MAX_TOKEN_FONT_FAMILIES, MAX_TOKEN_NAME_LEN, MAX_TOKENS_PER_CONTEXT, MAX_TRANSITION_DURATION,
    MAX_TRANSITIONS_PER_DOCUMENT, MAX_VARIANTS_PER_COMPONENT, MIN_FONT_WEIGHT, MIN_GROUP_MEMBERS,
    validate_asset_ref, validate_collection_size, validate_finite, validate_floats_in_value,
    validate_grid_track, validate_node_name, validate_page_name, validate_text_content,
    validate_token_name,
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
