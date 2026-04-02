// crates/core/src/commands/tree_commands.rs
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.
#![allow(clippy::unnecessary_literal_bound)]

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::tree;

/// Moves a node to a new parent at a specific position.
/// Captures the old parent and position for undo.
#[derive(Debug)]
pub struct ReparentNode {
    /// The node to reparent.
    pub node_id: NodeId,
    /// The new parent to move the node under.
    pub new_parent_id: NodeId,
    /// The index within the new parent's children list.
    pub new_position: usize,
    /// The previous parent (if any), captured before apply for undo.
    pub old_parent_id: Option<NodeId>,
    /// The previous position within the old parent, captured before apply for undo.
    pub old_position: Option<usize>,
}

impl Command for ReparentNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        tree::rearrange(
            &mut doc.arena,
            self.node_id,
            self.new_parent_id,
            self.new_position,
        )?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        match self.old_parent_id {
            Some(old_parent) => {
                let pos = self.old_position.ok_or(CoreError::ValidationError(
                    "ReparentNode undo: old_position is required when old_parent_id is set"
                        .to_string(),
                ))?;
                tree::rearrange(&mut doc.arena, self.node_id, old_parent, pos)?;
            }
            None => {
                // Was a root node — detach from current parent
                tree::remove_child(&mut doc.arena, self.node_id)?;
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Reparent node"
    }
}

/// Reorders children within the same parent.
/// Moves `node_id` to `new_position` within its current parent.
#[derive(Debug)]
pub struct ReorderChildren {
    /// The node to reorder within its parent.
    pub node_id: NodeId,
    /// The target position within the parent's children list.
    pub new_position: usize,
    /// The original position, captured before apply for undo.
    pub old_position: usize,
}

impl Command for ReorderChildren {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let parent_id = doc
            .arena
            .get(self.node_id)?
            .parent
            .ok_or(CoreError::ValidationError(
                "ReorderChildren: node has no parent".to_string(),
            ))?;
        tree::rearrange(&mut doc.arena, self.node_id, parent_id, self.new_position)?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let parent_id = doc
            .arena
            .get(self.node_id)?
            .parent
            .ok_or(CoreError::ValidationError(
                "ReorderChildren undo: node has no parent".to_string(),
            ))?;
        tree::rearrange(&mut doc.arena, self.node_id, parent_id, self.old_position)?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Reorder children"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::id::NodeId;
    use crate::node::{Node, NodeKind};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn insert_frame(doc: &mut Document, uuid_byte: u8, name: &str) -> NodeId {
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(uuid_byte),
            NodeKind::Frame { layout: None },
            name.to_string(),
        )
        .expect("create node");
        doc.arena.insert(node).expect("insert")
    }

    // ── ReparentNode ────────────────────────────────────────────────

    #[test]
    fn test_reparent_node_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let parent_a = insert_frame(&mut doc, 1, "Parent A");
        let parent_b = insert_frame(&mut doc, 2, "Parent B");
        let child = insert_frame(&mut doc, 3, "Child");

        // Add child to parent_a first
        tree::add_child(&mut doc.arena, parent_a, child).expect("add child");
        assert_eq!(doc.arena.get(parent_a).unwrap().children, vec![child]);

        let cmd = ReparentNode {
            node_id: child,
            new_parent_id: parent_b,
            new_position: 0,
            old_parent_id: Some(parent_a),
            old_position: Some(0),
        };

        cmd.apply(&mut doc).expect("apply");
        assert!(doc.arena.get(parent_a).unwrap().children.is_empty());
        assert_eq!(doc.arena.get(parent_b).unwrap().children, vec![child]);

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.arena.get(parent_a).unwrap().children, vec![child]);
        assert!(doc.arena.get(parent_b).unwrap().children.is_empty());
    }

    #[test]
    fn test_reparent_node_cycle_detection() {
        let mut doc = Document::new("Test".to_string());
        let parent = insert_frame(&mut doc, 1, "Parent");
        let child = insert_frame(&mut doc, 2, "Child");

        tree::add_child(&mut doc.arena, parent, child).expect("add child");

        let cmd = ReparentNode {
            node_id: parent,
            new_parent_id: child,
            new_position: 0,
            old_parent_id: None,
            old_position: None,
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── ReorderChildren ─────────────────────────────────────────────

    #[test]
    fn test_reorder_children_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let parent = insert_frame(&mut doc, 1, "Parent");
        let child_a = insert_frame(&mut doc, 2, "A");
        let child_b = insert_frame(&mut doc, 3, "B");
        let child_c = insert_frame(&mut doc, 4, "C");

        tree::add_child(&mut doc.arena, parent, child_a).expect("add a");
        tree::add_child(&mut doc.arena, parent, child_b).expect("add b");
        tree::add_child(&mut doc.arena, parent, child_c).expect("add c");

        // Move A from position 0 to position 2
        let cmd = ReorderChildren {
            node_id: child_a,
            new_position: 2,
            old_position: 0,
        };

        cmd.apply(&mut doc).expect("apply");
        let children = &doc.arena.get(parent).unwrap().children;
        assert_eq!(children, &[child_b, child_c, child_a]);

        cmd.undo(&mut doc).expect("undo");
        let children = &doc.arena.get(parent).unwrap().children;
        assert_eq!(children, &[child_a, child_b, child_c]);
    }

    #[test]
    fn test_reorder_children_no_parent_fails() {
        let mut doc = Document::new("Test".to_string());
        let orphan = insert_frame(&mut doc, 1, "Orphan");

        let cmd = ReorderChildren {
            node_id: orphan,
            new_position: 0,
            old_position: 0,
        };

        assert!(cmd.apply(&mut doc).is_err());
    }
}
