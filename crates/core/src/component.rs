// crates/core/src/component.rs

use serde::{Deserialize, Serialize};

use crate::node::{BlendMode, Constraints, Effect, Fill, Stroke, StyleValue, Transform};

#[cfg(test)]
use crate::node::Color;

/// Identifies which property on a node is being overridden.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PropertyPath {
    /// Node name.
    Name,
    /// Transform X position.
    TransformX,
    /// Transform Y position.
    TransformY,
    /// Width.
    Width,
    /// Height.
    Height,
    /// Rotation in degrees.
    Rotation,
    /// Scale X factor.
    ScaleX,
    /// Scale Y factor.
    ScaleY,
    /// A specific fill by index.
    Fill { index: usize },
    /// A specific stroke by index.
    Stroke { index: usize },
    /// Opacity.
    Opacity,
    /// Blend mode.
    BlendMode,
    /// A specific effect by index.
    Effect { index: usize },
    /// Text content (for Text nodes).
    TextContent,
    /// Visibility.
    Visible,
    /// Locked state.
    Locked,
    /// Constraints.
    Constraints,
    /// Full transform override.
    Transform,
}

/// The value being set for an override at a specific `PropertyPath`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OverrideValue {
    /// String value (for Name, `TextContent`).
    String { value: String },
    /// f64 value (for `TransformX`/Y, Width, Height, Rotation, `ScaleX`/Y).
    Number { value: f64 },
    /// Boolean value (for Visible, Locked).
    Bool { value: bool },
    /// Fill value.
    Fill { value: Fill },
    /// Stroke value.
    Stroke { value: Stroke },
    /// Opacity (may be token ref).
    Opacity { value: StyleValue<f64> },
    /// Blend mode.
    BlendMode { value: BlendMode },
    /// Effect value.
    Effect { value: Effect },
    /// Constraints value.
    Constraints { value: Constraints },
    /// Full transform.
    Transform { value: Transform },
}

/// Tracks whether an override came from a variant or was applied by the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverrideSource {
    /// Override came from the selected variant definition.
    Variant,
    /// Override was applied directly by user or agent.
    User,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_property_path_serde_round_trip() {
        let paths = vec![
            PropertyPath::Name,
            PropertyPath::TransformX,
            PropertyPath::Width,
            PropertyPath::Fill { index: 0 },
            PropertyPath::Stroke { index: 2 },
            PropertyPath::Effect { index: 1 },
            PropertyPath::TextContent,
            PropertyPath::Visible,
            PropertyPath::Transform,
        ];
        for path in paths {
            let json = serde_json::to_string(&path).expect("serialize");
            let deserialized: PropertyPath = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(path, deserialized);
        }
    }

    #[test]
    fn test_override_value_string_serde() {
        let val = OverrideValue::String {
            value: "Hello".to_string(),
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_number_serde() {
        let val = OverrideValue::Number { value: 42.0 };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_bool_serde() {
        let val = OverrideValue::Bool { value: true };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_fill_serde() {
        let val = OverrideValue::Fill {
            value: Fill::Solid {
                color: StyleValue::Literal {
                    value: Color::default(),
                },
            },
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_source_serde() {
        let sources = vec![OverrideSource::Variant, OverrideSource::User];
        for source in sources {
            let json = serde_json::to_string(&source).expect("serialize");
            let deserialized: OverrideSource = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(source, deserialized);
        }
    }

    #[test]
    fn test_property_path_hash_uniqueness() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(PropertyPath::Fill { index: 0 });
        set.insert(PropertyPath::Fill { index: 1 });
        set.insert(PropertyPath::Name);
        assert_eq!(set.len(), 3);
    }
}
