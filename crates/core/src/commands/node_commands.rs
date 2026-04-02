// crates/core/src/commands/node_commands.rs

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::{NodeId, PageId};
use crate::node::{Node, NodeKind};
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
}

impl Command for CreateNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = Node::new(
            self.node_id,
            self.uuid,
            self.kind.clone(),
            self.name.clone(),
        )?;
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
        doc.arena.remove(id)?;
        Ok(vec![])
    }

    #[allow(clippy::unnecessary_literal_bound)]
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
        let actual_id = doc.arena.insert(snapshot.clone())?;
        // Restore page root position
        if let Some(page_id) = self.page_id
            && let Ok(page) = doc.page_mut(page_id)
        {
            let idx = self.page_root_index.unwrap_or(page.root_nodes.len());
            let clamped = idx.min(page.root_nodes.len());
            page.root_nodes.insert(clamped, actual_id);
        }
        Ok(vec![])
    }

    #[allow(clippy::unnecessary_literal_bound)]
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
        let node = doc.arena.get_mut(self.node_id)?;
        node.name.clone_from(&self.old_name);
        Ok(vec![])
    }

    #[allow(clippy::unnecessary_literal_bound)]
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

    #[allow(clippy::unnecessary_literal_bound)]
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

    #[allow(clippy::unnecessary_literal_bound)]
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

    #[allow(clippy::unnecessary_literal_bound)]
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
        };

        cmd.apply(&mut doc).expect("apply delete");
        assert!(doc.arena.get(node_id).is_err());
        assert!(doc.page(page_id).unwrap().root_nodes.is_empty());

        cmd.undo(&mut doc).expect("undo delete");
        let restored_id = doc.arena.id_by_uuid(&make_uuid(1)).expect("find restored");
        assert_eq!(doc.arena.get(restored_id).unwrap().name, "Frame");
        assert!(doc.page(page_id).unwrap().root_nodes.contains(&restored_id));
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
}
