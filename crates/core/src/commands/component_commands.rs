// crates/core/src/commands/component_commands.rs

use crate::command::FieldOperation;
use crate::component::{ComponentDef, OverrideKey, OverrideSource, OverrideValue};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::{ComponentId, NodeId};

/// Registers a component definition in the document.
#[derive(Debug)]
pub struct AddComponent {
    /// The component definition to add.
    pub component: ComponentDef,
}

impl FieldOperation for AddComponent {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if doc.components.contains_key(&self.component.id()) {
            return Err(CoreError::ValidationError(format!(
                "component with id {:?} already exists",
                self.component.id()
            )));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.add_component(self.component.clone())?;
        Ok(())
    }
}

/// Removes a component definition from the document.
#[derive(Debug)]
pub struct RemoveComponent {
    /// The ID of the component to remove.
    pub component_id: ComponentId,
}

impl FieldOperation for RemoveComponent {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if !doc.components.contains_key(&self.component_id) {
            return Err(CoreError::ComponentNotFound(self.component_id));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.components
            .remove(&self.component_id)
            .ok_or(CoreError::ComponentNotFound(self.component_id))?;
        Ok(())
    }
}

/// Sets an override on a component instance node's `OverrideMap`.
#[derive(Debug)]
pub struct SetOverride {
    /// The node ID of the component instance.
    pub node_id: NodeId,
    /// The override key (node UUID + property path).
    pub key: OverrideKey,
    /// The new override value.
    pub new_value: OverrideValue,
    /// The new override source.
    pub new_source: OverrideSource,
}

impl FieldOperation for SetOverride {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        let node = doc.arena.get(self.node_id)?;
        if !matches!(node.kind, crate::node::NodeKind::ComponentInstance { .. }) {
            return Err(CoreError::ValidationError(
                "SetOverride: node is not a ComponentInstance".to_string(),
            ));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => {
                overrides.set(self.key.clone(), self.new_value.clone(), self.new_source)?;
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "SetOverride: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(())
    }
}

/// Removes an override from a component instance node's `OverrideMap`.
#[derive(Debug)]
pub struct RemoveOverride {
    /// The node ID of the component instance.
    pub node_id: NodeId,
    /// The override key to remove.
    pub key: OverrideKey,
}

impl FieldOperation for RemoveOverride {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        let node = doc.arena.get(self.node_id)?;
        match &node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => {
                if overrides.get(&self.key).is_none() {
                    return Err(CoreError::ValidationError(format!(
                        "override not found for key {:?}",
                        self.key
                    )));
                }
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "RemoveOverride: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => {
                overrides.remove(&self.key).ok_or_else(|| {
                    CoreError::ValidationError(format!("override not found for key {:?}", self.key))
                })?;
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "RemoveOverride: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::{OverrideKey, OverrideMap, PropertyPath};
    use crate::id::NodeId;
    use crate::node::{Node, NodeKind};
    use std::collections::HashMap;
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn setup_doc_with_instance() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::ComponentInstance {
                component_id: ComponentId::new(make_uuid(50)),
                variant: None,
                overrides: OverrideMap::new(),
                property_values: HashMap::new(),
            },
            "Button 1".to_string(),
        )
        .expect("valid node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    // ── AddComponent / RemoveComponent ──────────────────────────────

    #[test]
    fn test_add_component_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let def = ComponentDef::new(
            ComponentId::new(make_uuid(50)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");

        let op = AddComponent {
            component: def.clone(),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(
            doc.components
                .contains_key(&ComponentId::new(make_uuid(50)))
        );
    }

    #[test]
    fn test_add_component_validate_rejects_duplicate() {
        let mut doc = Document::new("Test".to_string());
        let def = ComponentDef::new(
            ComponentId::new(make_uuid(50)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");
        doc.add_component(def.clone()).expect("add");

        let op = AddComponent { component: def };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_remove_component_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let def = ComponentDef::new(
            ComponentId::new(make_uuid(50)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");
        doc.add_component(def).expect("add");

        let op = RemoveComponent {
            component_id: ComponentId::new(make_uuid(50)),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(doc.components.is_empty());
    }

    #[test]
    fn test_remove_component_validate_rejects_missing() {
        let doc = Document::new("Test".to_string());
        let op = RemoveComponent {
            component_id: ComponentId::new(make_uuid(99)),
        };
        assert!(op.validate(&doc).is_err());
    }

    // ── SetOverride / RemoveOverride ────────────────────────────────

    #[test]
    fn test_set_override_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Visible);

        let op = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_some());
            }
            _ => panic!("expected ComponentInstance"),
        }
    }

    #[test]
    fn test_set_override_replaces_existing() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Visible);

        // Set initial override
        let op1 = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
        };
        op1.apply(&mut doc).expect("apply first");

        // Replace it
        let op2 = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: true },
            new_source: OverrideSource::Variant,
        };
        op2.apply(&mut doc).expect("apply second");

        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                let (val, src) = overrides.get(&key).expect("get");
                assert_eq!(*val, OverrideValue::Bool { value: true });
                assert_eq!(*src, OverrideSource::Variant);
            }
            _ => panic!("expected ComponentInstance"),
        }
    }

    #[test]
    fn test_remove_override_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Name);

        // Add an override first
        let set_op = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::String {
                value: "Custom".to_string(),
            },
            new_source: OverrideSource::User,
        };
        set_op.apply(&mut doc).expect("set");

        let remove_op = RemoveOverride {
            node_id,
            key: key.clone(),
        };
        remove_op.validate(&doc).expect("validate");
        remove_op.apply(&mut doc).expect("apply");

        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_none());
            }
            _ => panic!("expected ComponentInstance"),
        }
    }

    #[test]
    fn test_set_override_wrong_node_kind() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("valid");
        let node_id = doc.arena.insert(node).expect("insert");

        let op = SetOverride {
            node_id,
            key: OverrideKey::new(make_uuid(10), PropertyPath::Visible),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_remove_override_validate_rejects_missing_key() {
        let (doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(99), PropertyPath::Visible);

        let op = RemoveOverride { node_id, key };
        assert!(op.validate(&doc).is_err());
    }
}
