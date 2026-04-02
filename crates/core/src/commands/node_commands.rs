// crates/core/src/commands/node_commands.rs
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.
#![allow(clippy::unnecessary_literal_bound)]

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::{NodeId, PageId};
use crate::node::{Node, NodeKind, Transform};
use crate::validate::{validate_node_name, validate_text_content};
use uuid::Uuid;

/// Creates a new node and inserts it into the arena.
/// Optionally adds it as a root node on a page.
#[derive(Debug)]
pub struct CreateNode {
    /// The initial `NodeId` hint (arena may reassign the actual index).
    pub node_id: NodeId,
    /// The UUID for the new node.
    pub uuid: Uuid,
    /// The kind of node to create.
    pub kind: NodeKind,
    /// The display name for the new node.
    pub name: String,
    /// If set, the node is added as a root node on this page.
    pub page_id: Option<PageId>,
    /// Optional initial transform. If set, overrides the default transform
    /// on the created node. This ensures redo restores the correct position.
    pub initial_transform: Option<Transform>,
}

impl Command for CreateNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let mut node = Node::new(
            self.node_id,
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
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let id = doc
            .arena
            .id_by_uuid(&self.uuid)
            .ok_or(CoreError::ValidationError(format!(
                "cannot undo CreateNode: node with uuid {} not found",
                self.uuid
            )))?;
        // Remove from page root_nodes if present
        if let Some(page_id) = self.page_id
            && let Ok(page) = doc.page_mut(page_id)
        {
            page.root_nodes.retain(|nid| *nid != id);
        }
        // Detach from parent before removing from arena (fixes RF-008)
        crate::tree::remove_child(&mut doc.arena, id)?;
        doc.arena.remove(id)?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Create node"
    }
}

/// Deletes a node from the arena, capturing its full state for undo.
#[derive(Debug)]
pub struct DeleteNode {
    /// The ID of the node to delete.
    pub node_id: NodeId,
    /// A snapshot of the node before deletion (required for undo).
    pub snapshot: Option<Node>,
    /// The page this node was a root of (if any).
    pub page_id: Option<PageId>,
    /// The index within the page's `root_nodes` list (for restoring position on undo).
    pub page_root_index: Option<usize>,
    /// The parent `NodeId` before deletion (for restoring the parent-child link on undo).
    pub parent_id: Option<NodeId>,
    /// The index within the parent's `children` list (for restoring position on undo).
    pub parent_child_index: Option<usize>,
}

impl Command for DeleteNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        // Remove from page root_nodes if present
        if let Some(page_id) = self.page_id
            && let Ok(page) = doc.page_mut(page_id)
        {
            page.root_nodes.retain(|nid| *nid != self.node_id);
        }
        // Detach from parent
        crate::tree::remove_child(&mut doc.arena, self.node_id)?;
        doc.arena.remove(self.node_id)?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let snapshot = self.snapshot.as_ref().ok_or(CoreError::ValidationError(
            "cannot undo DeleteNode: no snapshot captured".to_string(),
        ))?;

        // Reinsert at the exact original slot to preserve NodeId stability
        doc.arena.reinsert(self.node_id, snapshot.clone())?;

        // Restore parent-child link
        if let Some(parent_id) = self.parent_id {
            let parent = doc.arena.get_mut(parent_id)?;
            let idx = self.parent_child_index.unwrap_or(parent.children.len());
            let clamped = idx.min(parent.children.len());
            parent.children.insert(clamped, self.node_id);
            doc.arena.get_mut(self.node_id)?.parent = Some(parent_id);
        }

        // Restore page root position
        if let Some(page_id) = self.page_id
            && let Ok(page) = doc.page_mut(page_id)
        {
            let idx = self.page_root_index.unwrap_or(page.root_nodes.len());
            let clamped = idx.min(page.root_nodes.len());
            page.root_nodes.insert(clamped, self.node_id);
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Delete node"
    }
}

/// Renames a node.
#[derive(Debug)]
pub struct RenameNode {
    /// The ID of the node to rename.
    pub node_id: NodeId,
    /// The new name to assign.
    pub new_name: String,
    /// The previous name (captured for undo).
    pub old_name: String,
}

impl Command for RenameNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_node_name(&self.new_name)?;
        let node = doc.arena.get_mut(self.node_id)?;
        node.name.clone_from(&self.new_name);
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_node_name(&self.old_name)?;
        let node = doc.arena.get_mut(self.node_id)?;
        node.name.clone_from(&self.old_name);
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Rename node"
    }
}

/// Sets a node's visibility.
#[derive(Debug)]
pub struct SetVisible {
    /// The ID of the node to modify.
    pub node_id: NodeId,
    /// The new visibility value.
    pub new_visible: bool,
    /// The previous visibility value (captured for undo).
    pub old_visible: bool,
}

impl Command for SetVisible {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.visible = self.new_visible;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.visible = self.old_visible;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set visibility"
    }
}

/// Sets a node's locked state.
#[derive(Debug)]
pub struct SetLocked {
    /// The ID of the node to modify.
    pub node_id: NodeId,
    /// The new locked value.
    pub new_locked: bool,
    /// The previous locked value (captured for undo).
    pub old_locked: bool,
}

impl Command for SetLocked {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.locked = self.new_locked;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.locked = self.old_locked;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set locked"
    }
}

/// Updates the text content of a Text node.
#[derive(Debug)]
pub struct SetTextContent {
    /// The ID of the text node to modify.
    pub node_id: NodeId,
    /// The new text content.
    pub new_content: String,
    /// The previous text content (captured for undo).
    pub old_content: String,
}

impl Command for SetTextContent {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_text_content(&self.new_content)?;
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
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_text_content(&self.old_content)?;
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Text { content, .. } => {
                content.clone_from(&self.old_content);
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "SetTextContent undo: node is not a Text node".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set text content"
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
    fn test_create_node_apply() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()))
            .expect("add page");

        let cmd = CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: make_uuid(1),
            kind: NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            name: "Rect".to_string(),
            page_id: Some(page_id),
            initial_transform: None,
        };

        cmd.apply(&mut doc).expect("apply");
        let id = doc.arena.id_by_uuid(&make_uuid(1)).expect("find by uuid");
        assert_eq!(doc.arena.get(id).unwrap().name, "Rect");
        assert!(doc.page(page_id).unwrap().root_nodes.contains(&id));
    }

    #[test]
    fn test_create_node_undo() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()))
            .expect("add page");

        let cmd = CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: make_uuid(1),
            kind: NodeKind::Frame { layout: None },
            name: "Frame".to_string(),
            page_id: Some(page_id),
            initial_transform: None,
        };

        cmd.apply(&mut doc).expect("apply");
        cmd.undo(&mut doc).expect("undo");
        assert!(doc.arena.id_by_uuid(&make_uuid(1)).is_none());
        assert!(doc.page(page_id).unwrap().root_nodes.is_empty());
    }

    // ── DeleteNode ──────────────────────────────────────────────────

    #[test]
    fn test_delete_node_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()))
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

        let snapshot = doc.arena.get(node_id).unwrap().clone();
        let cmd = DeleteNode {
            node_id,
            snapshot: Some(snapshot),
            page_id: Some(page_id),
            page_root_index: Some(0),
            parent_id: None,
            parent_child_index: None,
        };

        cmd.apply(&mut doc).expect("apply delete");
        assert!(doc.arena.get(node_id).is_err());
        assert!(doc.page(page_id).unwrap().root_nodes.is_empty());

        cmd.undo(&mut doc).expect("undo delete");
        // NodeId must be exactly the same after undo (reinsert preserves slot+generation)
        let restored = doc
            .arena
            .get(node_id)
            .expect("get by original NodeId after undo");
        assert_eq!(restored.name, "Frame");
        assert!(doc.page(page_id).unwrap().root_nodes.contains(&node_id));
    }

    #[test]
    fn test_delete_node_undo_restores_parent_child_link() {
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

        // Capture snapshot before delete (includes parent field)
        let snapshot = doc.arena.get(child_id).unwrap().clone();
        let child_index = doc
            .arena
            .get(parent_id)
            .unwrap()
            .children
            .iter()
            .position(|&id| id == child_id);

        let cmd = DeleteNode {
            node_id: child_id,
            snapshot: Some(snapshot),
            page_id: None,
            page_root_index: None,
            parent_id: Some(parent_id),
            parent_child_index: child_index,
        };

        cmd.apply(&mut doc).expect("apply delete");
        assert!(doc.arena.get(child_id).is_err());
        assert!(doc.arena.get(parent_id).unwrap().children.is_empty());

        cmd.undo(&mut doc).expect("undo delete");
        // Child is back at exact NodeId
        let restored = doc
            .arena
            .get(child_id)
            .expect("child restored at same NodeId");
        assert_eq!(restored.name, "Child");
        assert_eq!(restored.parent, Some(parent_id));
        // Parent's children list is restored
        assert_eq!(doc.arena.get(parent_id).unwrap().children, vec![child_id]);
    }

    #[test]
    fn test_delete_node_undo_restores_child_at_correct_position() {
        let mut doc = Document::new("Test".to_string());
        let parent_node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Parent".to_string(),
        )
        .expect("create parent");
        let parent_id = doc.arena.insert(parent_node).expect("insert parent");

        // Add three children
        let mut child_ids = Vec::new();
        for i in 2..=4u8 {
            let child = Node::new(
                NodeId::new(0, 0),
                make_uuid(i),
                NodeKind::Group,
                format!("Child {i}"),
            )
            .expect("create child");
            let cid = doc.arena.insert(child).expect("insert child");
            crate::tree::add_child(&mut doc.arena, parent_id, cid).expect("add child");
            child_ids.push(cid);
        }

        // Delete the middle child (index 1)
        let middle_id = child_ids[1];
        let snapshot = doc.arena.get(middle_id).unwrap().clone();
        let cmd = DeleteNode {
            node_id: middle_id,
            snapshot: Some(snapshot),
            page_id: None,
            page_root_index: None,
            parent_id: Some(parent_id),
            parent_child_index: Some(1),
        };

        cmd.apply(&mut doc).expect("apply delete");
        assert_eq!(
            doc.arena.get(parent_id).unwrap().children,
            vec![child_ids[0], child_ids[2]]
        );

        cmd.undo(&mut doc).expect("undo delete");
        assert_eq!(
            doc.arena.get(parent_id).unwrap().children,
            vec![child_ids[0], middle_id, child_ids[2]]
        );
    }

    #[test]
    fn test_create_node_undo_detaches_from_parent() {
        let mut doc = Document::new("Test".to_string());

        // Create a parent node first
        let parent_node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Parent".to_string(),
        )
        .expect("create parent");
        let parent_id = doc.arena.insert(parent_node).expect("insert parent");

        // Create a child node via command
        let cmd = CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: make_uuid(2),
            kind: NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            name: "Child".to_string(),
            page_id: None,
            initial_transform: None,
        };
        cmd.apply(&mut doc).expect("apply create");
        let child_id = doc.arena.id_by_uuid(&make_uuid(2)).expect("find child");

        // Manually add as child of parent (simulating a reparent command)
        crate::tree::add_child(&mut doc.arena, parent_id, child_id).expect("add child");
        assert_eq!(doc.arena.get(parent_id).unwrap().children, vec![child_id]);

        // Undo create should detach from parent before removing
        cmd.undo(&mut doc).expect("undo create");
        assert!(doc.arena.id_by_uuid(&make_uuid(2)).is_none());
        // Parent's children list must be cleaned up
        assert!(doc.arena.get(parent_id).unwrap().children.is_empty());
    }

    // ── RenameNode ──────────────────────────────────────────────────

    #[test]
    fn test_rename_node_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let cmd = RenameNode {
            node_id,
            new_name: "Renamed".to_string(),
            old_name: "Frame 1".to_string(),
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().name, "Renamed");

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.arena.get(node_id).unwrap().name, "Frame 1");
    }

    #[test]
    fn test_rename_node_validates_name() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let cmd = RenameNode {
            node_id,
            new_name: "a".repeat(513), // exceeds MAX_NODE_NAME_LEN
            old_name: "Frame 1".to_string(),
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── SetVisible ──────────────────────────────────────────────────

    #[test]
    fn test_set_visible_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_frame();
        assert!(doc.arena.get(node_id).unwrap().visible);

        let cmd = SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };

        cmd.apply(&mut doc).expect("apply");
        assert!(!doc.arena.get(node_id).unwrap().visible);

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.arena.get(node_id).unwrap().visible);
    }

    // ── SetLocked ───────────────────────────────────────────────────

    #[test]
    fn test_set_locked_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_frame();
        assert!(!doc.arena.get(node_id).unwrap().locked);

        let cmd = SetLocked {
            node_id,
            new_locked: true,
            old_locked: false,
        };

        cmd.apply(&mut doc).expect("apply");
        assert!(doc.arena.get(node_id).unwrap().locked);

        cmd.undo(&mut doc).expect("undo");
        assert!(!doc.arena.get(node_id).unwrap().locked);
    }

    // ── SetTextContent ──────────────────────────────────────────────

    #[test]
    fn test_set_text_content_apply_and_undo() {
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

        let cmd = SetTextContent {
            node_id,
            new_content: "World".to_string(),
            old_content: "Hello".to_string(),
        };

        cmd.apply(&mut doc).expect("apply");
        match &doc.arena.get(node_id).unwrap().kind {
            NodeKind::Text { content, .. } => assert_eq!(content, "World"),
            _ => panic!("expected Text node"),
        }

        cmd.undo(&mut doc).expect("undo");
        match &doc.arena.get(node_id).unwrap().kind {
            NodeKind::Text { content, .. } => assert_eq!(content, "Hello"),
            _ => panic!("expected Text node"),
        }
    }

    #[test]
    fn test_set_text_content_wrong_node_kind() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let cmd = SetTextContent {
            node_id,
            new_content: "World".to_string(),
            old_content: "Hello".to_string(),
        };

        assert!(cmd.apply(&mut doc).is_err());
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
        let cmd = SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };
        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── Integration: execute / undo / redo ────────────────────────────

    #[test]
    fn test_rename_node_execute_undo_redo_round_trip() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let cmd = RenameNode {
            node_id,
            new_name: "Renamed".to_string(),
            old_name: "Frame 1".to_string(),
        };
        doc.execute(Box::new(cmd)).expect("execute");
        assert_eq!(doc.arena.get(node_id).expect("get").name, "Renamed");

        doc.undo().expect("undo");
        assert_eq!(doc.arena.get(node_id).expect("get").name, "Frame 1");

        doc.redo().expect("redo");
        assert_eq!(doc.arena.get(node_id).expect("get").name, "Renamed");
    }
}
