#![warn(clippy::all, clippy::pedantic)]

pub mod arena;
pub mod document;
pub mod error;
pub mod id;
pub mod node;
pub mod tree;
pub mod validate;

pub use arena::Arena;
pub use document::{
    ComponentDef, Document, DocumentMetadata, History, LayoutEngine, Page, TokenContext,
    Transition,
};
pub use error::CoreError;
pub use id::{ComponentId, NodeId, PageId, TokenId};
pub use node::{
    AlignItems, AutoLayout, BlendMode, Color, Constraints, Effect, Fill, FillRule, GradientDef,
    GradientStop, JustifyContent, LayoutDirection, Node, NodeKind, OverrideMap, Padding, PathData,
    PinConstraint, Point, ScaleMode, Stroke, StrokeAlignment, StrokeCap, StrokeJoin, Style,
    StyleValue, TextAlign, TextStyle, Transform,
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
