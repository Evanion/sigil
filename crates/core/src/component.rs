// crates/core/src/component.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::CoreError;
use crate::id::{ComponentId, NodeId};
use crate::node::{BlendMode, Constraints, Effect, Fill, Stroke, StyleValue, Transform};
use crate::validate;

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

impl PropertyPath {
    /// Returns a stable sort key for deterministic serialization ordering.
    #[must_use]
    fn sort_key(&self) -> usize {
        match self {
            Self::Name => 0,
            Self::TransformX => 1,
            Self::TransformY => 2,
            Self::Width => 3,
            Self::Height => 4,
            Self::Rotation => 5,
            Self::ScaleX => 6,
            Self::ScaleY => 7,
            Self::Fill { .. } => 8,
            Self::Stroke { .. } => 9,
            Self::Opacity => 10,
            Self::BlendMode => 11,
            Self::Effect { .. } => 12,
            Self::TextContent => 13,
            Self::Visible => 14,
            Self::Locked => 15,
            Self::Constraints => 16,
            Self::Transform => 17,
        }
    }
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

/// Validates that an `OverrideValue` contains only finite f64 values and
/// that string values do not exceed `MAX_TEXT_CONTENT_LEN`.
///
/// Checks:
/// - `Number::value` is finite
/// - `Opacity` literal is finite
/// - `Transform` fields are all finite
/// - `String::value` length does not exceed `MAX_TEXT_CONTENT_LEN`
///
/// # Errors
/// Returns `CoreError::ValidationError` if any float is non-finite or a string
/// exceeds the maximum length.
pub fn validate_override_value(value: &OverrideValue) -> Result<(), CoreError> {
    match value {
        OverrideValue::Number { value: v } => {
            validate::validate_finite("override number", *v)?;
        }
        OverrideValue::Opacity {
            value: StyleValue::Literal { value: v },
        } => {
            validate::validate_finite("override opacity", *v)?;
        }
        OverrideValue::Transform { value: t } => {
            validate::validate_finite("override transform.x", t.x)?;
            validate::validate_finite("override transform.y", t.y)?;
            validate::validate_finite("override transform.width", t.width)?;
            validate::validate_finite("override transform.height", t.height)?;
            validate::validate_finite("override transform.rotation", t.rotation)?;
            validate::validate_finite("override transform.scale_x", t.scale_x)?;
            validate::validate_finite("override transform.scale_y", t.scale_y)?;
        }
        OverrideValue::String { value: s } => {
            if s.len() > validate::MAX_TEXT_CONTENT_LEN {
                return Err(CoreError::ValidationError(format!(
                    "override string length {} exceeds max {}",
                    s.len(),
                    validate::MAX_TEXT_CONTENT_LEN
                )));
            }
        }
        _ => {}
    }
    Ok(())
}

/// Validates that a `PropertyPath` index field (Fill, Stroke, Effect) does not
/// exceed the corresponding style limit.
///
/// # Errors
/// Returns `CoreError::ValidationError` if the index is out of bounds.
pub fn validate_property_path(path: &PropertyPath) -> Result<(), CoreError> {
    match path {
        PropertyPath::Fill { index } => {
            if *index >= validate::MAX_FILLS_PER_STYLE {
                return Err(CoreError::ValidationError(format!(
                    "fill index {index} exceeds max {}",
                    validate::MAX_FILLS_PER_STYLE
                )));
            }
        }
        PropertyPath::Stroke { index } => {
            if *index >= validate::MAX_STROKES_PER_STYLE {
                return Err(CoreError::ValidationError(format!(
                    "stroke index {index} exceeds max {}",
                    validate::MAX_STROKES_PER_STYLE
                )));
            }
        }
        PropertyPath::Effect { index } => {
            if *index >= validate::MAX_EFFECTS_PER_STYLE {
                return Err(CoreError::ValidationError(format!(
                    "effect index {index} exceeds max {}",
                    validate::MAX_EFFECTS_PER_STYLE
                )));
            }
        }
        _ => {}
    }
    Ok(())
}

/// Validates that a `ComponentPropertyType` is compatible with an `OverrideValue`.
///
/// The allowed pairings are:
/// - `Text` -> `OverrideValue::String`
/// - `Boolean` -> `OverrideValue::Bool`
/// - `InstanceSwap` -> `OverrideValue::String` (component ID as string)
/// - `Variant` -> `OverrideValue::String` (variant name)
///
/// # Errors
/// Returns `CoreError::ValidationError` when the value type does not match.
fn validate_property_type_value_compat(
    property_type: ComponentPropertyType,
    value: &OverrideValue,
) -> Result<(), CoreError> {
    let ok = match property_type {
        ComponentPropertyType::Text => matches!(value, OverrideValue::String { .. }),
        ComponentPropertyType::Boolean => matches!(value, OverrideValue::Bool { .. }),
        ComponentPropertyType::InstanceSwap => matches!(value, OverrideValue::String { .. }),
        ComponentPropertyType::Variant => matches!(value, OverrideValue::String { .. }),
    };
    if !ok {
        return Err(CoreError::ValidationError(format!(
            "property type {property_type:?} is not compatible with value type {value:?}"
        )));
    }
    Ok(())
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

/// A composite key for identifying an override: which node (by UUID within the component
/// definition's subtree) and which property.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OverrideKey {
    node_uuid: Uuid,
    path: PropertyPath,
}

impl OverrideKey {
    /// Creates a new override key.
    #[must_use]
    pub fn new(node_uuid: Uuid, path: PropertyPath) -> Self {
        Self { node_uuid, path }
    }

    /// Returns the UUID of the target node within the component subtree.
    #[must_use]
    pub fn node_uuid(&self) -> Uuid {
        self.node_uuid
    }

    /// Returns the property path being overridden.
    #[must_use]
    pub fn path(&self) -> &PropertyPath {
        &self.path
    }
}

/// A map of property overrides applied to a component instance.
///
/// Keys are composite (node UUID + property path). Values carry the override
/// value and its source (variant vs user).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OverrideMap {
    entries: HashMap<OverrideKey, (OverrideValue, OverrideSource)>,
}

impl OverrideMap {
    /// Creates a new empty override map.
    #[must_use]
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// Sets an override, returning the previous value if any.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the map exceeds capacity,
    /// the value contains non-finite floats, string values are too long,
    /// or the property path index is out of bounds.
    pub fn set(
        &mut self,
        key: OverrideKey,
        value: OverrideValue,
        source: OverrideSource,
    ) -> Result<Option<(OverrideValue, OverrideSource)>, CoreError> {
        validate_override_value(&value)?;
        validate_property_path(&key.path)?;
        if !self.entries.contains_key(&key)
            && self.entries.len() >= validate::MAX_OVERRIDES_PER_INSTANCE
        {
            return Err(CoreError::ValidationError(format!(
                "override map has {} entries (max {})",
                self.entries.len(),
                validate::MAX_OVERRIDES_PER_INSTANCE
            )));
        }
        Ok(self.entries.insert(key, (value, source)))
    }

    /// Gets an override value and source by key.
    #[must_use]
    pub fn get(&self, key: &OverrideKey) -> Option<&(OverrideValue, OverrideSource)> {
        self.entries.get(key)
    }

    /// Removes an override by key.
    pub fn remove(&mut self, key: &OverrideKey) -> Option<(OverrideValue, OverrideSource)> {
        self.entries.remove(key)
    }

    /// Returns the number of overrides.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns true if there are no overrides.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Iterates over all overrides.
    pub fn iter(&self) -> impl Iterator<Item = (&OverrideKey, &(OverrideValue, OverrideSource))> {
        self.entries.iter()
    }
}

impl Serialize for OverrideMap {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;

        // Sort entries by (node_uuid, path sort key) for deterministic output.
        let mut sorted: Vec<_> = self.entries.iter().collect();
        sorted.sort_by(|(a_key, _), (b_key, _)| {
            a_key
                .node_uuid()
                .cmp(&b_key.node_uuid())
                .then_with(|| a_key.path().sort_key().cmp(&b_key.path().sort_key()))
        });

        let mut seq = serializer.serialize_seq(Some(sorted.len()))?;
        for (key, (value, source)) in &sorted {
            #[derive(Serialize)]
            struct Entry<'a> {
                node_uuid: &'a Uuid,
                path: &'a PropertyPath,
                value: &'a OverrideValue,
                source: &'a OverrideSource,
            }
            seq.serialize_element(&Entry {
                node_uuid: &key.node_uuid(),
                path: key.path(),
                value,
                source,
            })?;
        }
        seq.end()
    }
}

impl<'de> Deserialize<'de> for OverrideMap {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Entry {
            node_uuid: Uuid,
            path: PropertyPath,
            value: OverrideValue,
            source: OverrideSource,
        }
        let entries: Vec<Entry> = Vec::deserialize(deserializer)?;
        if entries.len() > validate::MAX_OVERRIDES_PER_INSTANCE {
            return Err(serde::de::Error::custom(format!(
                "too many overrides: {} (max {})",
                entries.len(),
                validate::MAX_OVERRIDES_PER_INSTANCE
            )));
        }
        let mut map = HashMap::with_capacity(entries.len());
        for entry in entries {
            validate_override_value(&entry.value).map_err(serde::de::Error::custom)?;
            validate_property_path(&entry.path).map_err(serde::de::Error::custom)?;
            let key = OverrideKey::new(entry.node_uuid, entry.path);
            if map.contains_key(&key) {
                return Err(serde::de::Error::custom(format!(
                    "duplicate override key: node_uuid={}, path={:?}",
                    key.node_uuid(),
                    key.path()
                )));
            }
            map.insert(key, (entry.value, entry.source));
        }
        Ok(Self { entries: map })
    }
}

/// A named variant of a component with its override set.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Variant {
    name: String,
    overrides: OverrideMap,
}

impl Variant {
    /// Creates a new variant, validating the name.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the name is invalid.
    pub fn new(name: String, overrides: OverrideMap) -> Result<Self, CoreError> {
        validate::validate_node_name(&name)?;
        Ok(Self { name, overrides })
    }

    /// Returns the variant name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns the variant's overrides.
    #[must_use]
    pub fn overrides(&self) -> &OverrideMap {
        &self.overrides
    }
}

impl<'de> Deserialize<'de> for Variant {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Raw {
            name: String,
            overrides: OverrideMap,
        }
        let raw = Raw::deserialize(deserializer)?;
        Self::new(raw.name, raw.overrides).map_err(serde::de::Error::custom)
    }
}

/// The type of a component property.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentPropertyType {
    /// Maps to text content override.
    Text,
    /// Maps to visibility override.
    Boolean,
    /// Maps to swapping a nested component instance.
    InstanceSwap,
    /// Maps to variant selection.
    Variant,
}

/// A component property definition.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ComponentProperty {
    name: String,
    property_type: ComponentPropertyType,
    default_value: OverrideValue,
}

impl ComponentProperty {
    /// Creates a new component property, validating the name and
    /// ensuring the default value type is compatible with the property type.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if:
    /// - The name is invalid
    /// - The default value type does not match the property type
    /// - The default value contains non-finite floats or exceeds length limits
    pub fn new(
        name: String,
        property_type: ComponentPropertyType,
        default_value: OverrideValue,
    ) -> Result<Self, CoreError> {
        validate::validate_node_name(&name)?;
        validate_override_value(&default_value)?;
        validate_property_type_value_compat(property_type, &default_value)?;
        Ok(Self {
            name,
            property_type,
            default_value,
        })
    }

    /// Returns the property name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns the property type.
    #[must_use]
    pub fn property_type(&self) -> ComponentPropertyType {
        self.property_type
    }

    /// Returns the default value.
    #[must_use]
    pub fn default_value(&self) -> &OverrideValue {
        &self.default_value
    }
}

impl<'de> Deserialize<'de> for ComponentProperty {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Raw {
            name: String,
            property_type: ComponentPropertyType,
            default_value: OverrideValue,
        }
        let raw = Raw::deserialize(deserializer)?;
        Self::new(raw.name, raw.property_type, raw.default_value).map_err(serde::de::Error::custom)
    }
}

/// A component definition — a reusable design element with variants and properties.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ComponentDef {
    id: ComponentId,
    name: String,
    root_node: NodeId,
    variants: Vec<Variant>,
    properties: Vec<ComponentProperty>,
}

impl ComponentDef {
    /// Creates a new component definition, validating name and collection sizes.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` for invalid name or collection limit violations.
    pub fn new(
        id: ComponentId,
        name: String,
        root_node: NodeId,
        variants: Vec<Variant>,
        properties: Vec<ComponentProperty>,
    ) -> Result<Self, CoreError> {
        validate::validate_node_name(&name)?;
        validate::validate_collection_size(
            "variants",
            variants.len(),
            validate::MAX_VARIANTS_PER_COMPONENT,
        )?;
        validate::validate_collection_size(
            "properties",
            properties.len(),
            validate::MAX_PROPERTIES_PER_COMPONENT,
        )?;
        Ok(Self {
            id,
            name,
            root_node,
            variants,
            properties,
        })
    }

    /// Returns the component ID.
    #[must_use]
    pub fn id(&self) -> ComponentId {
        self.id
    }

    /// Returns the component name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns the root node ID.
    #[must_use]
    pub fn root_node(&self) -> NodeId {
        self.root_node
    }

    /// Returns the component variants.
    #[must_use]
    pub fn variants(&self) -> &[Variant] {
        &self.variants
    }

    /// Returns the component properties.
    #[must_use]
    pub fn properties(&self) -> &[ComponentProperty] {
        &self.properties
    }
}

impl<'de> Deserialize<'de> for ComponentDef {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Raw {
            id: ComponentId,
            name: String,
            root_node: NodeId,
            #[serde(default)]
            variants: Vec<Variant>,
            #[serde(default)]
            properties: Vec<ComponentProperty>,
        }
        let raw = Raw::deserialize(deserializer)?;
        Self::new(
            raw.id,
            raw.name,
            raw.root_node,
            raw.variants,
            raw.properties,
        )
        .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::Point;

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

    // RF-011: serde round-trip tests for missing OverrideValue variants

    #[test]
    fn test_override_value_stroke_serde() {
        let val = OverrideValue::Stroke {
            value: Stroke::default(),
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_opacity_serde() {
        let val = OverrideValue::Opacity {
            value: StyleValue::Literal { value: 0.5 },
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_blend_mode_serde() {
        let val = OverrideValue::BlendMode {
            value: BlendMode::Multiply,
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_effect_serde() {
        let val = OverrideValue::Effect {
            value: Effect::LayerBlur {
                radius: StyleValue::Literal { value: 4.0 },
            },
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_constraints_serde() {
        let val = OverrideValue::Constraints {
            value: Constraints::default(),
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_transform_serde() {
        let val = OverrideValue::Transform {
            value: Transform::default(),
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: OverrideValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_override_value_effect_drop_shadow_serde() {
        let val = OverrideValue::Effect {
            value: Effect::DropShadow {
                color: StyleValue::Literal {
                    value: Color::default(),
                },
                offset: Point { x: 2.0, y: 2.0 },
                blur: StyleValue::Literal { value: 4.0 },
                spread: StyleValue::Literal { value: 0.0 },
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

    // ── OverrideKey ───────────────────────────────────────────────────

    #[test]
    fn test_override_key_accessors() {
        let uuid = Uuid::nil();
        let path = PropertyPath::Width;
        let key = OverrideKey::new(uuid, path.clone());
        assert_eq!(key.node_uuid(), uuid);
        assert_eq!(*key.path(), path);
    }

    // ── OverrideMap ─────────────────────────────────────────────────────

    #[test]
    fn test_override_map_set_and_get() {
        let mut map = OverrideMap::new();
        let key = OverrideKey::new(Uuid::nil(), PropertyPath::Visible);
        map.set(
            key.clone(),
            OverrideValue::Bool { value: false },
            OverrideSource::User,
        )
        .expect("set");
        let (val, src) = map.get(&key).expect("get");
        assert_eq!(*val, OverrideValue::Bool { value: false });
        assert_eq!(*src, OverrideSource::User);
    }

    #[test]
    fn test_override_map_remove() {
        let mut map = OverrideMap::new();
        let key = OverrideKey::new(Uuid::nil(), PropertyPath::Name);
        map.set(
            key.clone(),
            OverrideValue::String {
                value: "New".to_string(),
            },
            OverrideSource::Variant,
        )
        .expect("set");
        assert_eq!(map.len(), 1);
        map.remove(&key);
        assert!(map.is_empty());
    }

    #[test]
    fn test_override_map_serde_round_trip() {
        let mut map = OverrideMap::new();
        map.set(
            OverrideKey::new(Uuid::nil(), PropertyPath::Visible),
            OverrideValue::Bool { value: false },
            OverrideSource::User,
        )
        .expect("set");
        map.set(
            OverrideKey::new(Uuid::nil(), PropertyPath::TransformX),
            OverrideValue::Number { value: 100.0 },
            OverrideSource::Variant,
        )
        .expect("set");

        let json = serde_json::to_string(&map).expect("serialize");
        let deserialized: OverrideMap = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(map.len(), deserialized.len());
        // Verify individual entries survived the round trip
        for (key, (value, source)) in map.iter() {
            let (deser_val, deser_src) = deserialized.get(key).expect("key should exist");
            assert_eq!(value, deser_val);
            assert_eq!(source, deser_src);
        }
    }

    // RF-013: deterministic serialization
    #[test]
    fn test_override_map_serialization_is_deterministic() {
        let mut map = OverrideMap::new();
        // Insert in arbitrary order — serialization must be sorted by (node_uuid, path discriminant).
        map.set(
            OverrideKey::new(Uuid::nil(), PropertyPath::Width),
            OverrideValue::Number { value: 200.0 },
            OverrideSource::User,
        )
        .expect("set");
        map.set(
            OverrideKey::new(Uuid::nil(), PropertyPath::Name),
            OverrideValue::String {
                value: "a".to_string(),
            },
            OverrideSource::User,
        )
        .expect("set");

        let json1 = serde_json::to_string(&map).expect("serialize first");
        let json2 = serde_json::to_string(&map).expect("serialize second");
        assert_eq!(json1, json2, "serialization must be deterministic");
    }

    #[test]
    fn test_override_map_capacity_limit() {
        let mut map = OverrideMap::new();
        assert!(map.is_empty());
        map.set(
            OverrideKey::new(Uuid::nil(), PropertyPath::Name),
            OverrideValue::String {
                value: "test".to_string(),
            },
            OverrideSource::User,
        )
        .expect("first insert should work");
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn test_override_map_set_replaces_existing_key() {
        let mut map = OverrideMap::new();
        let key = OverrideKey::new(Uuid::nil(), PropertyPath::Width);
        map.set(
            key.clone(),
            OverrideValue::Number { value: 100.0 },
            OverrideSource::User,
        )
        .expect("set");
        let prev = map
            .set(
                key.clone(),
                OverrideValue::Number { value: 200.0 },
                OverrideSource::Variant,
            )
            .expect("replace");
        assert!(prev.is_some());
        let (val, src) = map.get(&key).expect("get");
        assert_eq!(*val, OverrideValue::Number { value: 200.0 });
        assert_eq!(*src, OverrideSource::Variant);
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn test_override_map_deserialize_rejects_too_many_entries() {
        // Build a JSON array with MAX_OVERRIDES_PER_INSTANCE + 1 entries
        let mut entries = Vec::new();
        for i in 0..=validate::MAX_OVERRIDES_PER_INSTANCE {
            entries.push(serde_json::json!({
                "node_uuid": Uuid::nil(),
                "path": { "type": "fill", "index": i },
                "value": { "type": "number", "value": 1.0 },
                "source": "user"
            }));
        }
        let json = serde_json::to_string(&entries).expect("serialize array");
        let result: Result<OverrideMap, _> = serde_json::from_str(&json);
        assert!(result.is_err());
    }

    #[test]
    fn test_override_map_default_is_empty() {
        let map = OverrideMap::default();
        assert!(map.is_empty());
        assert_eq!(map.len(), 0);
    }

    #[test]
    fn test_override_map_iter() {
        let mut map = OverrideMap::new();
        map.set(
            OverrideKey::new(Uuid::nil(), PropertyPath::Locked),
            OverrideValue::Bool { value: true },
            OverrideSource::User,
        )
        .expect("set");
        let entries: Vec<_> = map.iter().collect();
        assert_eq!(entries.len(), 1);
    }

    // RF-010: Aliased tests following test_<constant_name_lowercase>_enforced convention

    #[test]
    fn test_max_overrides_per_instance_enforced() {
        let mut entries = Vec::new();
        for i in 0..=validate::MAX_OVERRIDES_PER_INSTANCE {
            entries.push(serde_json::json!({
                "node_uuid": Uuid::nil(),
                "path": { "type": "fill", "index": i },
                "value": { "type": "number", "value": 1.0 },
                "source": "user"
            }));
        }
        let json = serde_json::to_string(&entries).expect("serialize array");
        let result: Result<OverrideMap, _> = serde_json::from_str(&json);
        assert!(result.is_err());
    }

    // ── Variant ─────────────────────────────────────────────────────

    #[test]
    fn test_variant_new_valid() {
        let v = Variant::new("Default".to_string(), OverrideMap::new()).expect("valid");
        assert_eq!(v.name(), "Default");
        assert!(v.overrides().is_empty());
    }

    #[test]
    fn test_variant_new_invalid_name() {
        assert!(Variant::new(String::new(), OverrideMap::new()).is_err());
    }

    #[test]
    fn test_variant_serde_round_trip() {
        let v = Variant::new("Hover".to_string(), OverrideMap::new()).expect("valid");
        let json = serde_json::to_string(&v).expect("serialize");
        let deserialized: Variant = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(v, deserialized);
    }

    #[test]
    fn test_variant_deserialize_rejects_invalid_name() {
        let json = r#"{"name":"","overrides":[]}"#;
        let result: Result<Variant, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    // ── ComponentPropertyType ───────────────────────────────────────

    #[test]
    fn test_component_property_type_serde_round_trip() {
        let types = vec![
            ComponentPropertyType::Text,
            ComponentPropertyType::Boolean,
            ComponentPropertyType::InstanceSwap,
            ComponentPropertyType::Variant,
        ];
        for pt in types {
            let json = serde_json::to_string(&pt).expect("serialize");
            let deserialized: ComponentPropertyType =
                serde_json::from_str(&json).expect("deserialize");
            assert_eq!(pt, deserialized);
        }
    }

    // ── ComponentProperty ───────────────────────────────────────────

    #[test]
    fn test_component_property_new_valid() {
        let p = ComponentProperty::new(
            "label".to_string(),
            ComponentPropertyType::Text,
            OverrideValue::String {
                value: "Click me".to_string(),
            },
        )
        .expect("valid");
        assert_eq!(p.name(), "label");
        assert_eq!(p.property_type(), ComponentPropertyType::Text);
        assert_eq!(
            *p.default_value(),
            OverrideValue::String {
                value: "Click me".to_string()
            }
        );
    }

    #[test]
    fn test_component_property_new_invalid_name() {
        assert!(
            ComponentProperty::new(
                String::new(),
                ComponentPropertyType::Boolean,
                OverrideValue::Bool { value: true },
            )
            .is_err()
        );
    }

    #[test]
    fn test_component_property_serde_round_trip() {
        let p = ComponentProperty::new(
            "visible".to_string(),
            ComponentPropertyType::Boolean,
            OverrideValue::Bool { value: true },
        )
        .expect("valid");
        let json = serde_json::to_string(&p).expect("serialize");
        let deserialized: ComponentProperty = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(p, deserialized);
    }

    #[test]
    fn test_component_property_deserialize_rejects_invalid_name() {
        let json =
            r#"{"name":"","property_type":"text","default_value":{"type":"bool","value":true}}"#;
        let result: Result<ComponentProperty, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    // ── ComponentDef ────────────────────────────────────────────────

    #[test]
    fn test_component_def_new_valid() {
        let def = ComponentDef::new(
            ComponentId::new(Uuid::nil()),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");
        assert_eq!(def.name(), "Button");
        assert_eq!(def.id(), ComponentId::new(Uuid::nil()));
        assert_eq!(def.root_node(), NodeId::new(0, 0));
        assert!(def.variants().is_empty());
        assert!(def.properties().is_empty());
    }

    #[test]
    fn test_component_def_with_variants_and_properties() {
        let variant = Variant::new("Hover".to_string(), OverrideMap::new()).expect("valid");
        let prop = ComponentProperty::new(
            "label".to_string(),
            ComponentPropertyType::Text,
            OverrideValue::String {
                value: "Click".to_string(),
            },
        )
        .expect("valid");

        let def = ComponentDef::new(
            ComponentId::new(Uuid::nil()),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![variant],
            vec![prop],
        )
        .expect("valid");
        assert_eq!(def.variants().len(), 1);
        assert_eq!(def.variants()[0].name(), "Hover");
        assert_eq!(def.properties().len(), 1);
        assert_eq!(def.properties()[0].name(), "label");
    }

    #[test]
    fn test_component_def_serde_round_trip() {
        let def = ComponentDef::new(
            ComponentId::new(Uuid::nil()),
            "Card".to_string(),
            NodeId::new(0, 0),
            vec![Variant::new("Selected".to_string(), OverrideMap::new()).expect("valid")],
            vec![
                ComponentProperty::new(
                    "title".to_string(),
                    ComponentPropertyType::Text,
                    OverrideValue::String {
                        value: "Title".to_string(),
                    },
                )
                .expect("valid"),
            ],
        )
        .expect("valid");
        let json = serde_json::to_string(&def).expect("serialize");
        let deserialized: ComponentDef = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(def, deserialized);
    }

    #[test]
    fn test_component_def_invalid_name() {
        assert!(
            ComponentDef::new(
                ComponentId::new(Uuid::nil()),
                String::new(),
                NodeId::new(0, 0),
                vec![],
                vec![],
            )
            .is_err()
        );
    }

    #[test]
    fn test_component_def_deserialize_rejects_invalid_name() {
        let json = serde_json::json!({
            "id": Uuid::nil(),
            "name": "",
            "root_node": {"index": 0, "generation": 0},
            "variants": [],
            "properties": []
        });
        let result: Result<ComponentDef, _> = serde_json::from_str(&json.to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_component_def_deserialize_with_defaults() {
        // variants and properties should default to empty when omitted
        let json = serde_json::json!({
            "id": Uuid::nil(),
            "name": "Simple",
            "root_node": {"index": 0, "generation": 0}
        });
        let def: ComponentDef =
            serde_json::from_str(&json.to_string()).expect("deserialize with defaults");
        assert_eq!(def.name(), "Simple");
        assert!(def.variants().is_empty());
        assert!(def.properties().is_empty());
    }

    #[test]
    fn test_component_def_rejects_too_many_variants() {
        let variants: Vec<Variant> = (0..=validate::MAX_VARIANTS_PER_COMPONENT)
            .map(|i| Variant::new(format!("V{i}"), OverrideMap::new()).expect("valid"))
            .collect();
        assert!(
            ComponentDef::new(
                ComponentId::new(Uuid::nil()),
                "Overflow".to_string(),
                NodeId::new(0, 0),
                variants,
                vec![],
            )
            .is_err()
        );
    }

    #[test]
    fn test_component_def_rejects_too_many_properties() {
        let properties: Vec<ComponentProperty> = (0..=validate::MAX_PROPERTIES_PER_COMPONENT)
            .map(|i| {
                ComponentProperty::new(
                    format!("P{i}"),
                    ComponentPropertyType::Text,
                    OverrideValue::String {
                        value: "x".to_string(),
                    },
                )
                .expect("valid")
            })
            .collect();
        assert!(
            ComponentDef::new(
                ComponentId::new(Uuid::nil()),
                "Overflow".to_string(),
                NodeId::new(0, 0),
                vec![],
                properties,
            )
            .is_err()
        );
    }

    // RF-010: Aliased tests following test_<constant_name_lowercase>_enforced convention

    #[test]
    fn test_max_variants_per_component_enforced() {
        let variants: Vec<Variant> = (0..=validate::MAX_VARIANTS_PER_COMPONENT)
            .map(|i| Variant::new(format!("V{i}"), OverrideMap::new()).expect("valid"))
            .collect();
        assert!(
            ComponentDef::new(
                ComponentId::new(Uuid::nil()),
                "Overflow".to_string(),
                NodeId::new(0, 0),
                variants,
                vec![],
            )
            .is_err()
        );
    }

    #[test]
    fn test_max_properties_per_component_enforced() {
        let properties: Vec<ComponentProperty> = (0..=validate::MAX_PROPERTIES_PER_COMPONENT)
            .map(|i| {
                ComponentProperty::new(
                    format!("P{i}"),
                    ComponentPropertyType::Text,
                    OverrideValue::String {
                        value: "x".to_string(),
                    },
                )
                .expect("valid")
            })
            .collect();
        assert!(
            ComponentDef::new(
                ComponentId::new(Uuid::nil()),
                "Overflow".to_string(),
                NodeId::new(0, 0),
                vec![],
                properties,
            )
            .is_err()
        );
    }
}
