// crates/core/src/commands/node_commands.rs

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::id::{NodeId, PageId};
use crate::node::{Node, NodeKind, Transform};
use crate::validate::{validate_finite, validate_node_name, validate_text_content};
use uuid::Uuid;

/// Creates a new node and inserts it into the arena.
/// Optionally adds it as a root node on a page.
#[derive(Debug)]
pub struct CreateNode {
    /// The UUID for the new node.
    pub uuid: Uuid,
    /// The kind of node to create.
    pub kind: NodeKind,
    /// The display name for the new node.
    pub name: String,
    /// If set, the node is added as a root node on this page.
    pub page_id: Option<PageId>,
    /// Optional initial transform. If set, overrides the default transform
    /// on the created node.
    pub initial_transform: Option<Transform>,
}

impl FieldOperation for CreateNode {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_node_name(&self.name)?;
        // Validate float fields in NodeKind variants
        match &self.kind {
            NodeKind::Rectangle { corner_radii } => {
                for (i, &r) in corner_radii.iter().enumerate() {
                    validate_finite(&format!("corner_radii[{i}]"), r)?;
                    if r < 0.0 {
                        return Err(CoreError::ValidationError(format!(
                            "corner_radii[{i}] must be non-negative, got {r}"
                        )));
                    }
                }
            }
            NodeKind::Ellipse {
                arc_start, arc_end, ..
            } => {
                validate_finite("arc_start", *arc_start)?;
                validate_finite("arc_end", *arc_end)?;
            }
            _ => {}
        }
        if let Some(ref t) = self.initial_transform {
            crate::commands::style_commands::validate_transform(t)?;
        }
        if let Some(page_id) = self.page_id {
            doc.page(page_id)?;
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let mut node = Node::new(
            NodeId::new(0, 0),
            self.uuid,
            self.kind.clone(),
            self.name.clone(),
        )?;
        if let Some(ref t) = self.initial_transform {
            crate::commands::style_commands::validate_transform(t)?;
            node.transform = *t;
        }
        let actual_id = doc.arena.insert(node)?;
        if let Some(page_id) = self.page_id {
            doc.add_root_node_to_page(page_id, actual_id)?;
        }
        Ok(())
    }
}

/// Deletes a node from the arena.
#[derive(Debug)]
pub struct DeleteNode {
    /// The ID of the node to delete.
    pub node_id: NodeId,
    /// The page this node was a root of (if any), for removing from page `root_nodes`.
    pub page_id: Option<PageId>,
}

impl FieldOperation for DeleteNode {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        // Remove from page root_nodes if present
        if let Some(page_id) = self.page_id
            && let Ok(page) = doc.page_mut(page_id)
        {
            page.root_nodes.retain(|nid| *nid != self.node_id);
        }
        // Collect all descendants before removal (iterative, depth-guarded by arena size)
        let descendants = crate::tree::descendants(&doc.arena, self.node_id)?;
        // Detach from parent
        crate::tree::remove_child(&mut doc.arena, self.node_id)?;
        // Remove all descendants from the arena (children first, then the node itself)
        for desc_id in descendants {
            doc.arena.remove(desc_id)?;
        }
        doc.arena.remove(self.node_id)?;
        Ok(())
    }
}

/// Renames a node.
#[derive(Debug)]
pub struct RenameNode {
    /// The ID of the node to rename.
    pub node_id: NodeId,
    /// The new name to assign.
    pub new_name: String,
}

impl FieldOperation for RenameNode {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_node_name(&self.new_name)?;
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        node.name.clone_from(&self.new_name);
        Ok(())
    }
}

/// Sets a node's visibility.
#[derive(Debug)]
pub struct SetVisible {
    /// The ID of the node to modify.
    pub node_id: NodeId,
    /// The new visibility value.
    pub new_visible: bool,
}

impl FieldOperation for SetVisible {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena.get_mut(self.node_id)?.visible = self.new_visible;
        Ok(())
    }
}

/// Sets a node's locked state.
#[derive(Debug)]
pub struct SetLocked {
    /// The ID of the node to modify.
    pub node_id: NodeId,
    /// The new locked value.
    pub new_locked: bool,
}

impl FieldOperation for SetLocked {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena.get_mut(self.node_id)?.locked = self.new_locked;
        Ok(())
    }
}

/// Updates the text content of a Text node.
#[derive(Debug)]
pub struct SetTextContent {
    /// The ID of the text node to modify.
    pub node_id: NodeId,
    /// The new text content.
    pub new_content: String,
}

impl FieldOperation for SetTextContent {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_text_content(&self.new_content)?;
        let node = doc.arena.get(self.node_id)?;
        if !matches!(node.kind, NodeKind::Text { .. }) {
            return Err(CoreError::ValidationError(
                "SetTextContent can only be applied to Text nodes".to_string(),
            ));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Text { content, .. } => {
                content.clone_from(&self.new_content);
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "SetTextContent can only be applied to Text nodes".to_string(),
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Document, Page};
    use crate::id::{NodeId, PageId};
    use crate::node::{NodeKind, TextStyle};

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn setup_doc_with_frame() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame 1".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    // ── CreateNode ──────────────────────────────────────────────────

    #[test]
    fn test_create_node_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");

        let op = CreateNode {
            uuid: make_uuid(1),
            kind: NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            name: "Rect".to_string(),
            page_id: Some(page_id),
            initial_transform: None,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        let id = doc.arena.id_by_uuid(&make_uuid(1)).expect("find by uuid");
        assert_eq!(doc.arena.get(id).unwrap().name, "Rect");
        assert!(doc.page(page_id).unwrap().root_nodes.contains(&id));
    }

    // ── DeleteNode ──────────────────────────────────────────────────

    #[test]
    fn test_delete_node_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");
        doc.add_root_node_to_page(page_id, node_id)
            .expect("add root");

        let op = DeleteNode {
            node_id,
            page_id: Some(page_id),
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(doc.arena.get(node_id).is_err());
        assert!(doc.page(page_id).unwrap().root_nodes.is_empty());
    }

    #[test]
    fn test_delete_node_validate_rejects_missing_node() {
        let doc = Document::new("Test".to_string());
        let op = DeleteNode {
            node_id: NodeId::new(99, 0),
            page_id: None,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_delete_node_detaches_from_parent() {
        let mut doc = Document::new("Test".to_string());
        let parent_node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Parent".to_string(),
        )
        .expect("create parent");
        let parent_id = doc.arena.insert(parent_node).expect("insert parent");

        let child_node = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            "Child".to_string(),
        )
        .expect("create child");
        let child_id = doc.arena.insert(child_node).expect("insert child");

        crate::tree::add_child(&mut doc.arena, parent_id, child_id).expect("add child");
        assert_eq!(doc.arena.get(parent_id).unwrap().children, vec![child_id]);

        let op = DeleteNode {
            node_id: child_id,
            page_id: None,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(doc.arena.get(child_id).is_err());
        assert!(doc.arena.get(parent_id).unwrap().children.is_empty());
    }

    // ── RenameNode ──────────────────────────────────────────────────

    #[test]
    fn test_rename_node_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let op = RenameNode {
            node_id,
            new_name: "Renamed".to_string(),
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().name, "Renamed");
    }

    #[test]
    fn test_rename_node_validates_name() {
        let (doc, node_id) = setup_doc_with_frame();

        let op = RenameNode {
            node_id,
            new_name: "a".repeat(513), // exceeds MAX_NODE_NAME_LEN
        };

        assert!(op.validate(&doc).is_err());
    }

    // ── SetVisible ──────────────────────────────────────────────────

    #[test]
    fn test_set_visible_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_frame();
        assert!(doc.arena.get(node_id).unwrap().visible);

        let op = SetVisible {
            node_id,
            new_visible: false,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(!doc.arena.get(node_id).unwrap().visible);
    }

    // ── SetLocked ───────────────────────────────────────────────────

    #[test]
    fn test_set_locked_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_frame();
        assert!(!doc.arena.get(node_id).unwrap().locked);

        let op = SetLocked {
            node_id,
            new_locked: true,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(doc.arena.get(node_id).unwrap().locked);
    }

    // ── SetTextContent ──────────────────────────────────────────────

    #[test]
    fn test_set_text_content_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle::default(),
            },
            "Text 1".to_string(),
        )
        .expect("create text node");
        let node_id = doc.arena.insert(node).expect("insert");

        let op = SetTextContent {
            node_id,
            new_content: "World".to_string(),
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        match &doc.arena.get(node_id).unwrap().kind {
            NodeKind::Text { content, .. } => assert_eq!(content, "World"),
            _ => panic!("expected Text node"),
        }
    }

    #[test]
    fn test_set_text_content_wrong_node_kind() {
        let (doc, node_id) = setup_doc_with_frame();

        let op = SetTextContent {
            node_id,
            new_content: "World".to_string(),
        };

        assert!(op.validate(&doc).is_err());
    }

    // ── Stale NodeId edge case (RF-015) ────────────────────────────

    #[test]
    fn test_command_on_stale_node_id() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Group,
            "G".to_string(),
        )
        .expect("node");
        let node_id = doc.arena.insert(node).expect("insert");
        doc.arena.remove(node_id).expect("remove");
        // Insert a new node at the same slot (different generation)
        let node2 = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Group,
            "G2".to_string(),
        )
        .expect("node");
        let _new_id = doc.arena.insert(node2).expect("insert");

        // Old node_id should be stale
        let op = SetVisible {
            node_id,
            new_visible: false,
        };
        assert!(op.validate(&doc).is_err());
    }

    // ── RF-015: NodeKind float validation ─────────────────────────────

    #[test]
    fn test_create_node_rejects_nan_corner_radii() {
        let doc = Document::new("Test".to_string());
        let op = CreateNode {
            uuid: make_uuid(1),
            kind: NodeKind::Rectangle {
                corner_radii: [0.0, f64::NAN, 0.0, 0.0],
            },
            name: "Rect".to_string(),
            page_id: None,
            initial_transform: None,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_create_node_rejects_negative_corner_radii() {
        let doc = Document::new("Test".to_string());
        let op = CreateNode {
            uuid: make_uuid(1),
            kind: NodeKind::Rectangle {
                corner_radii: [0.0, 0.0, -1.0, 0.0],
            },
            name: "Rect".to_string(),
            page_id: None,
            initial_transform: None,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_create_node_rejects_nan_arc_fields() {
        let doc = Document::new("Test".to_string());
        let op = CreateNode {
            uuid: make_uuid(1),
            kind: NodeKind::Ellipse {
                arc_start: f64::NAN,
                arc_end: 360.0,
            },
            name: "Ellipse".to_string(),
            page_id: None,
            initial_transform: None,
        };
        assert!(op.validate(&doc).is_err());
    }

    // ── RF-024: apply-without-validate tests ──────────────────────────

    #[test]
    fn test_set_transform_apply_on_missing_node_returns_error() {
        use crate::commands::style_commands::SetTransform;

        let mut doc = Document::new("Test".to_string());
        let op = SetTransform {
            node_id: NodeId::new(99, 0),
            new_transform: crate::node::Transform::default(),
        };
        // Calling apply directly without validate — apply must still be self-protecting
        assert!(op.apply(&mut doc).is_err());
    }

    #[test]
    fn test_rename_node_apply_on_missing_node_returns_error() {
        let mut doc = Document::new("Test".to_string());
        let op = RenameNode {
            node_id: NodeId::new(99, 0),
            new_name: "New".to_string(),
        };
        assert!(op.apply(&mut doc).is_err());
    }

    #[test]
    fn test_set_text_content_apply_on_non_text_node_returns_error() {
        let (mut doc, node_id) = setup_doc_with_frame();
        let op = SetTextContent {
            node_id,
            new_content: "text".to_string(),
        };
        // Frame node is not a Text node — apply must reject
        assert!(op.apply(&mut doc).is_err());
    }

    // ── RF-013: DeleteNode cleans up children ────────────────────────

    #[test]
    fn test_delete_node_removes_children_from_arena() {
        let mut doc = Document::new("Test".to_string());
        let parent = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Parent".to_string(),
        )
        .expect("create parent");
        let parent_id = doc.arena.insert(parent).expect("insert parent");

        let child = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            "Child".to_string(),
        )
        .expect("create child");
        let child_id = doc.arena.insert(child).expect("insert child");

        let grandchild = Node::new(
            NodeId::new(0, 0),
            make_uuid(3),
            NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            "Grandchild".to_string(),
        )
        .expect("create grandchild");
        let grandchild_id = doc.arena.insert(grandchild).expect("insert grandchild");

        crate::tree::add_child(&mut doc.arena, parent_id, child_id).expect("add child");
        crate::tree::add_child(&mut doc.arena, child_id, grandchild_id).expect("add grandchild");

        let op = DeleteNode {
            node_id: parent_id,
            page_id: None,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        // All three nodes should be removed from the arena
        assert!(doc.arena.get(parent_id).is_err());
        assert!(doc.arena.get(child_id).is_err());
        assert!(doc.arena.get(grandchild_id).is_err());
    }
}
