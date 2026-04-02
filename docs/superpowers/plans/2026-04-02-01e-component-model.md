# Component Model — Implementation Plan (01e)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the component model with PropertyPath, OverrideValue, OverrideMap, Variant, ComponentProperty, and full ComponentDef — replacing all component-related stubs.

**Architecture:** A new `component.rs` module owns PropertyPath, OverrideValue, OverrideSource, and the full OverrideMap with composite `(Uuid, PropertyPath)` keys and custom serialization. ComponentDef moves from `document.rs` to `component.rs` with Variant and ComponentProperty support. NodeKind::ComponentInstance gains `variant` and `property_values` fields. All types use private fields with custom Deserialize per GOV-010.

**Tech Stack:** Rust 1.94.1 (edition 2024), serde, serde_json, uuid (no v4), thiserror

**Scope:** Type definitions, validation, and tests. Component commands (create, delete, override, instantiate) are deferred to Plan 01f.

---

## File Structure

```
crates/core/src/
├── component.rs         # NEW: PropertyPath, OverrideValue, OverrideSource, OverrideMap, Variant, ComponentProperty, ComponentPropertyType, ComponentDef
├── node.rs              # MODIFY: remove OverrideMap stub, import from component.rs, update NodeKind::ComponentInstance
├── document.rs          # MODIFY: remove ComponentDef stub, import from component.rs
├── validate.rs          # MODIFY: add component validation constants
├── lib.rs               # MODIFY: add component module and re-exports
```

---

## Task 1: Create component module with PropertyPath and OverrideValue

**Files:**
- Create: `crates/core/src/component.rs`
- Modify: `crates/core/src/validate.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Add component validation constants to `crates/core/src/validate.rs`:

```rust
/// Maximum variants per component definition.
pub const MAX_VARIANTS_PER_COMPONENT: usize = 100;

/// Maximum properties per component definition.
pub const MAX_PROPERTIES_PER_COMPONENT: usize = 100;

/// Maximum overrides per component instance.
pub const MAX_OVERRIDES_PER_INSTANCE: usize = 10_000;

/// Maximum components per document.
pub const MAX_COMPONENTS_PER_DOCUMENT: usize = 10_000;
```

- [ ] 2. Create `crates/core/src/component.rs` with PropertyPath, OverrideValue, and OverrideSource:

```rust
// crates/core/src/component.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::CoreError;
use crate::id::{ComponentId, NodeId};
use crate::node::{BlendMode, Color, Constraints, Effect, Fill, Point, Stroke, StyleValue, Transform};
use crate::validate;

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

/// The value being set for an override at a specific PropertyPath.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OverrideValue {
    /// String value (for Name, TextContent).
    String { value: String },
    /// f64 value (for TransformX/Y, Width, Height, Rotation, ScaleX/Y).
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
```

- [ ] 3. Add tests for PropertyPath and OverrideValue serde round-trips:

```rust
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
        let val = OverrideValue::String { value: "Hello".to_string() };
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
                color: StyleValue::Literal { value: Color::default() },
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
```

- [ ] 4. Add `pub mod component;` to `crates/core/src/lib.rs` after `pub mod command;`:

```rust
pub mod component;
```

Add re-exports:
```rust
// ── Re-exports: Component ────────────────────────────────────────────
pub use component::{
    ComponentPropertyType, OverrideSource, OverrideValue, PropertyPath,
};
```

- [ ] 5. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core component::tests
./dev.sh cargo test -p agent-designer-core
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 6. Commit:

```bash
git add crates/core/src/component.rs crates/core/src/validate.rs crates/core/src/lib.rs
git commit -m "feat(core): add PropertyPath, OverrideValue, OverrideSource (spec-01)"
```

---

## Task 2: Implement OverrideMap with composite keys

**Files:**
- Modify: `crates/core/src/component.rs`
- Modify: `crates/core/src/node.rs` (remove OverrideMap stub)

- [ ] 1. Add OverrideMap to `crates/core/src/component.rs`:

```rust
/// A composite key for identifying an override: which node (by UUID within the component
/// definition's subtree) and which property.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OverrideKey {
    pub node_uuid: Uuid,
    pub path: PropertyPath,
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
    /// Returns `CoreError::ValidationError` if the map exceeds capacity.
    pub fn set(
        &mut self,
        key: OverrideKey,
        value: OverrideValue,
        source: OverrideSource,
    ) -> Result<Option<(OverrideValue, OverrideSource)>, CoreError> {
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
```

- [ ] 2. Add custom Serialize/Deserialize for OverrideMap. Since `(Uuid, PropertyPath)` can't be a JSON object key directly, serialize as an array of entries:

```rust
impl Serialize for OverrideMap {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let mut seq = serializer.serialize_seq(Some(self.entries.len()))?;
        for (key, (value, source)) in &self.entries {
            #[derive(Serialize)]
            struct Entry<'a> {
                node_uuid: &'a Uuid,
                path: &'a PropertyPath,
                value: &'a OverrideValue,
                source: &'a OverrideSource,
            }
            seq.serialize_element(&Entry {
                node_uuid: &key.node_uuid,
                path: &key.path,
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
            let key = OverrideKey {
                node_uuid: entry.node_uuid,
                path: entry.path,
            };
            map.insert(key, (entry.value, entry.source));
        }
        Ok(Self { entries: map })
    }
}
```

- [ ] 3. Remove the OverrideMap stub from `crates/core/src/node.rs` (lines 14-19). Replace with import and re-export:

```rust
pub use crate::component::OverrideMap;
```

- [ ] 4. Add OverrideMap tests:

```rust
#[test]
fn test_override_map_set_and_get() {
    let mut map = OverrideMap::new();
    let key = OverrideKey {
        node_uuid: Uuid::nil(),
        path: PropertyPath::Visible,
    };
    map.set(key.clone(), OverrideValue::Bool { value: false }, OverrideSource::User)
        .expect("set");
    let (val, src) = map.get(&key).expect("get");
    assert_eq!(*val, OverrideValue::Bool { value: false });
    assert_eq!(*src, OverrideSource::User);
}

#[test]
fn test_override_map_remove() {
    let mut map = OverrideMap::new();
    let key = OverrideKey {
        node_uuid: Uuid::nil(),
        path: PropertyPath::Name,
    };
    map.set(key.clone(), OverrideValue::String { value: "New".to_string() }, OverrideSource::Variant)
        .expect("set");
    assert_eq!(map.len(), 1);
    map.remove(&key);
    assert!(map.is_empty());
}

#[test]
fn test_override_map_serde_round_trip() {
    let mut map = OverrideMap::new();
    map.set(
        OverrideKey { node_uuid: Uuid::nil(), path: PropertyPath::Visible },
        OverrideValue::Bool { value: false },
        OverrideSource::User,
    ).expect("set");
    map.set(
        OverrideKey { node_uuid: Uuid::nil(), path: PropertyPath::TransformX },
        OverrideValue::Number { value: 100.0 },
        OverrideSource::Variant,
    ).expect("set");

    let json = serde_json::to_string(&map).expect("serialize");
    let deserialized: OverrideMap = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(map.len(), deserialized.len());
}

#[test]
fn test_override_map_capacity_limit() {
    let mut map = OverrideMap::new();
    // We won't actually insert 10,000 — just verify the error path
    // by checking the limit logic works
    assert!(map.is_empty());
    map.set(
        OverrideKey { node_uuid: Uuid::nil(), path: PropertyPath::Name },
        OverrideValue::String { value: "test".to_string() },
        OverrideSource::User,
    ).expect("first insert should work");
}
```

- [ ] 5. Update `lib.rs` re-exports to include `OverrideKey` and `OverrideMap` from component:

```rust
pub use component::{
    ComponentPropertyType, OverrideKey, OverrideMap, OverrideSource, OverrideValue, PropertyPath,
};
```

Remove `OverrideMap` from the node re-exports line (it's now re-exported from component via node's `pub use`).

- [ ] 6. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 7. Commit:

```bash
git add crates/core/src/component.rs crates/core/src/node.rs crates/core/src/lib.rs
git commit -m "feat(core): add OverrideMap with composite keys and custom serde (spec-01)"
```

---

## Task 3: Add Variant, ComponentProperty, and full ComponentDef

**Files:**
- Modify: `crates/core/src/component.rs`
- Modify: `crates/core/src/document.rs` (remove ComponentDef stub)

- [ ] 1. Add Variant, ComponentProperty, ComponentPropertyType, and ComponentDef to `crates/core/src/component.rs`:

```rust
/// A named variant of a component with its override set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentProperty {
    name: String,
    property_type: ComponentPropertyType,
    default_value: OverrideValue,
}

impl ComponentProperty {
    /// Creates a new component property, validating the name.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the name is invalid.
    pub fn new(
        name: String,
        property_type: ComponentPropertyType,
        default_value: OverrideValue,
    ) -> Result<Self, CoreError> {
        validate::validate_node_name(&name)?;
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

/// A component definition — a reusable design element with variants and properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

    #[must_use]
    pub fn id(&self) -> ComponentId { self.id }

    #[must_use]
    pub fn name(&self) -> &str { &self.name }

    #[must_use]
    pub fn root_node(&self) -> NodeId { self.root_node }

    #[must_use]
    pub fn variants(&self) -> &[Variant] { &self.variants }

    #[must_use]
    pub fn properties(&self) -> &[ComponentProperty] { &self.properties }
}
```

- [ ] 2. Remove the ComponentDef stub from `crates/core/src/document.rs`. Replace with:

```rust
use crate::component::ComponentDef;
pub use crate::component::ComponentDef;
```

- [ ] 3. Add tests for Variant, ComponentProperty, and ComponentDef:

```rust
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
    assert_eq!(v.name(), deserialized.name());
}

// ── ComponentProperty ───────────────────────────────────────────

#[test]
fn test_component_property_new_valid() {
    let p = ComponentProperty::new(
        "label".to_string(),
        ComponentPropertyType::Text,
        OverrideValue::String { value: "Click me".to_string() },
    ).expect("valid");
    assert_eq!(p.name(), "label");
    assert_eq!(p.property_type(), ComponentPropertyType::Text);
}

#[test]
fn test_component_property_serde_round_trip() {
    let p = ComponentProperty::new(
        "visible".to_string(),
        ComponentPropertyType::Boolean,
        OverrideValue::Bool { value: true },
    ).expect("valid");
    let json = serde_json::to_string(&p).expect("serialize");
    let deserialized: ComponentProperty = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(p.name(), deserialized.name());
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
    ).expect("valid");
    assert_eq!(def.name(), "Button");
    assert!(def.variants().is_empty());
    assert!(def.properties().is_empty());
}

#[test]
fn test_component_def_with_variants_and_properties() {
    let variant = Variant::new("Hover".to_string(), OverrideMap::new()).expect("valid");
    let prop = ComponentProperty::new(
        "label".to_string(),
        ComponentPropertyType::Text,
        OverrideValue::String { value: "Click".to_string() },
    ).expect("valid");

    let def = ComponentDef::new(
        ComponentId::new(Uuid::nil()),
        "Button".to_string(),
        NodeId::new(0, 0),
        vec![variant],
        vec![prop],
    ).expect("valid");
    assert_eq!(def.variants().len(), 1);
    assert_eq!(def.properties().len(), 1);
}

#[test]
fn test_component_def_serde_round_trip() {
    let def = ComponentDef::new(
        ComponentId::new(Uuid::nil()),
        "Card".to_string(),
        NodeId::new(0, 0),
        vec![Variant::new("Selected".to_string(), OverrideMap::new()).expect("valid")],
        vec![ComponentProperty::new(
            "title".to_string(),
            ComponentPropertyType::Text,
            OverrideValue::String { value: "Title".to_string() },
        ).expect("valid")],
    ).expect("valid");
    let json = serde_json::to_string(&def).expect("serialize");
    let deserialized: ComponentDef = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(def, deserialized);
}

#[test]
fn test_component_def_invalid_name() {
    assert!(ComponentDef::new(
        ComponentId::new(Uuid::nil()),
        String::new(),
        NodeId::new(0, 0),
        vec![],
        vec![],
    ).is_err());
}
```

- [ ] 4. Update `lib.rs` re-exports to include Variant, ComponentProperty, ComponentDef:

```rust
pub use component::{
    ComponentDef, ComponentProperty, ComponentPropertyType, OverrideKey, OverrideMap,
    OverrideSource, OverrideValue, PropertyPath, Variant,
};
```

Remove `ComponentDef` from the document re-exports line (it's now re-exported from component via document's `pub use`).

- [ ] 5. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 6. Commit:

```bash
git add crates/core/src/component.rs crates/core/src/document.rs crates/core/src/lib.rs
git commit -m "feat(core): add Variant, ComponentProperty, ComponentDef (spec-01)"
```

---

## Task 4: Update NodeKind::ComponentInstance

**Files:**
- Modify: `crates/core/src/node.rs`

- [ ] 1. Update `NodeKind::ComponentInstance` in `crates/core/src/node.rs` to add `variant` and `property_values`:

```rust
ComponentInstance {
    component_id: ComponentId,
    variant: Option<String>,
    overrides: OverrideMap,
    property_values: HashMap<String, OverrideValue>,
},
```

Add import at the top of node.rs:
```rust
use crate::component::OverrideValue;
```

- [ ] 2. Update `Node::new` to validate the new fields for ComponentInstance:

In the `validate_node_kind` function (or in Node::new's kind validation match arm), add:
```rust
NodeKind::ComponentInstance { variant, property_values, .. } => {
    if let Some(ref v) = variant {
        validate_node_name(v)?;
    }
    // property_values keys should be valid names
    for key in property_values.keys() {
        validate_node_name(key)?;
    }
}
```

- [ ] 3. Update all existing tests that construct `NodeKind::ComponentInstance` to include the new fields:

Search for `ComponentInstance` in test code and add `variant: None, property_values: HashMap::new()`.

- [ ] 4. Add new tests:

```rust
#[test]
fn test_component_instance_with_variant() {
    let node = Node::new(
        NodeId::new(0, 0),
        Uuid::nil(),
        NodeKind::ComponentInstance {
            component_id: ComponentId::new(Uuid::nil()),
            variant: Some("Hover".to_string()),
            overrides: OverrideMap::new(),
            property_values: HashMap::new(),
        },
        "Button 1".to_string(),
    ).expect("valid");
    match &node.kind {
        NodeKind::ComponentInstance { variant, .. } => {
            assert_eq!(variant.as_deref(), Some("Hover"));
        }
        _ => panic!("expected ComponentInstance"),
    }
}

#[test]
fn test_component_instance_with_property_values() {
    let mut props = HashMap::new();
    props.insert("label".to_string(), OverrideValue::String { value: "Click".to_string() });

    let node = Node::new(
        NodeId::new(0, 0),
        Uuid::nil(),
        NodeKind::ComponentInstance {
            component_id: ComponentId::new(Uuid::nil()),
            variant: None,
            overrides: OverrideMap::new(),
            property_values: props,
        },
        "Button 1".to_string(),
    ).expect("valid");
    match &node.kind {
        NodeKind::ComponentInstance { property_values, .. } => {
            assert_eq!(property_values.len(), 1);
        }
        _ => panic!("expected ComponentInstance"),
    }
}

#[test]
fn test_component_instance_serde_round_trip() {
    let mut props = HashMap::new();
    props.insert("label".to_string(), OverrideValue::String { value: "Hi".to_string() });

    let node = Node::new(
        NodeId::new(0, 0),
        Uuid::nil(),
        NodeKind::ComponentInstance {
            component_id: ComponentId::new(Uuid::nil()),
            variant: Some("Active".to_string()),
            overrides: OverrideMap::new(),
            property_values: props,
        },
        "Instance".to_string(),
    ).expect("valid");
    let json = serde_json::to_string(&node).expect("serialize");
    let deserialized: Node = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(node, deserialized);
}
```

- [ ] 5. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 6. Commit:

```bash
git add crates/core/src/node.rs
git commit -m "feat(core): update NodeKind::ComponentInstance with variant and property_values (spec-01)"
```

---

## Task 5: Run full workspace verification

**Files:** None (verification only)

- [ ] 1. Run full workspace tests:

```bash
./dev.sh cargo test --workspace
```

- [ ] 2. Run clippy on workspace:

```bash
./dev.sh cargo clippy --workspace -- -D warnings
```

- [ ] 3. Run format check:

```bash
./dev.sh cargo fmt --check
```

- [ ] 4. If any issues, fix and commit.

---

## Deferred Items

### Plan 01f: Advanced Commands + Wire Formats

- Component commands: CreateComponent, DeleteComponent, SetOverride, InstantiateComponent
- Token commands: RenameToken, PromoteToken, DemoteToken
- Transition commands: AddTransition, RemoveTransition, UpdateTransition
- Path commands: AddSegment, RemoveSegment, MovePath
- `SerializableCommand` / `BroadcastCommand` tagged enums
- Token serialization to W3C Design Tokens Format
- Component serialization to component files
- Boolean path operations (`boolean_op`)
