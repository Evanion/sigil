// crates/core/src/commands/component_commands.rs
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.
#![allow(clippy::unnecessary_literal_bound)]

use crate::command::{Command, SideEffect};
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

impl Command for AddComponent {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.add_component(self.component.clone())?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.components
            .remove(&self.component.id())
            .ok_or(CoreError::ComponentNotFound(self.component.id()))?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Add component"
    }
}

/// Removes a component definition from the document.
#[derive(Debug)]
pub struct RemoveComponent {
    /// The ID of the component to remove.
    pub component_id: ComponentId,
    /// Snapshot of the removed component for undo.
    pub snapshot: ComponentDef,
}

impl Command for RemoveComponent {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.components
            .remove(&self.component_id)
            .ok_or(CoreError::ComponentNotFound(self.component_id))?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.add_component(self.snapshot.clone())?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Remove component"
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
    /// The old override value and source (None if this is a new override).
    pub old_entry: Option<(OverrideValue, OverrideSource)>,
}

impl Command for SetOverride {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
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
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => match &self.old_entry {
                Some((val, src)) => {
                    overrides.set(self.key.clone(), val.clone(), *src)?;
                }
                None => {
                    overrides.remove(&self.key);
                }
            },
            _ => {
                return Err(CoreError::ValidationError(
                    "SetOverride undo: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set override"
    }
}

/// Removes an override from a component instance node's `OverrideMap`.
#[derive(Debug)]
pub struct RemoveOverride {
    /// The node ID of the component instance.
    pub node_id: NodeId,
    /// The override key to remove.
    pub key: OverrideKey,
    /// The old value and source for undo.
    pub old_entry: (OverrideValue, OverrideSource),
}

impl Command for RemoveOverride {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
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
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => {
                overrides.set(self.key.clone(), self.old_entry.0.clone(), self.old_entry.1)?;
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "RemoveOverride undo: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Remove override"
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
    fn test_add_component_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let def = ComponentDef::new(
            ComponentId::new(make_uuid(50)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");

        let cmd = AddComponent {
            component: def.clone(),
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(
            doc.components
                .contains_key(&ComponentId::new(make_uuid(50)))
        );

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.components.is_empty());
    }

    #[test]
    fn test_remove_component_apply_and_undo() {
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

        let cmd = RemoveComponent {
            component_id: ComponentId::new(make_uuid(50)),
            snapshot: def,
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(doc.components.is_empty());

        cmd.undo(&mut doc).expect("undo");
        assert!(
            doc.components
                .contains_key(&ComponentId::new(make_uuid(50)))
        );
    }

    // ── SetOverride / RemoveOverride ────────────────────────────────

    #[test]
    fn test_set_override_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Visible);

        let cmd = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
            old_entry: None,
        };
        cmd.apply(&mut doc).expect("apply");

        // Verify override was set
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_some());
            }
            _ => panic!("expected ComponentInstance"),
        }

        cmd.undo(&mut doc).expect("undo");
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_none());
            }
            _ => panic!("expected ComponentInstance"),
        }
    }

    #[test]
    fn test_set_override_replaces_existing() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Visible);

        // Set initial override
        let cmd1 = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
            old_entry: None,
        };
        cmd1.apply(&mut doc).expect("apply first");

        // Replace it
        let cmd2 = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: true },
            new_source: OverrideSource::Variant,
            old_entry: Some((OverrideValue::Bool { value: false }, OverrideSource::User)),
        };
        cmd2.apply(&mut doc).expect("apply second");

        // Undo should restore the first value
        cmd2.undo(&mut doc).expect("undo");
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                let (val, src) = overrides.get(&key).expect("get");
                assert_eq!(*val, OverrideValue::Bool { value: false });
                assert_eq!(*src, OverrideSource::User);
            }
            _ => panic!("expected ComponentInstance"),
        }
    }

    #[test]
    fn test_remove_override_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Name);

        // Add an override first
        let set_cmd = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::String {
                value: "Custom".to_string(),
            },
            new_source: OverrideSource::User,
            old_entry: None,
        };
        set_cmd.apply(&mut doc).expect("set");

        let cmd = RemoveOverride {
            node_id,
            key: key.clone(),
            old_entry: (
                OverrideValue::String {
                    value: "Custom".to_string(),
                },
                OverrideSource::User,
            ),
        };
        cmd.apply(&mut doc).expect("apply remove");

        // Verify removed
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_none());
            }
            _ => panic!("expected ComponentInstance"),
        }

        cmd.undo(&mut doc).expect("undo");
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_some());
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

        let cmd = SetOverride {
            node_id,
            key: OverrideKey::new(make_uuid(10), PropertyPath::Visible),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
            old_entry: None,
        };
        assert!(cmd.apply(&mut doc).is_err());
    }
}
