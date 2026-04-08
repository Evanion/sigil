// crates/core/src/commands/tree_commands.rs

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::tree;

/// Moves a node to a new parent at a specific position.
#[derive(Debug)]
pub struct ReparentNode {
    /// The node to reparent.
    pub node_id: NodeId,
    /// The new parent to move the node under.
    pub new_parent_id: NodeId,
    /// The index within the new parent's children list.
    pub new_position: usize,
}

impl FieldOperation for ReparentNode {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        doc.arena.get(self.node_id)?;
        doc.arena.get(self.new_parent_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        tree::rearrange(
            &mut doc.arena,
            self.node_id,
            self.new_parent_id,
            self.new_position,
        )?;
        Ok(())
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
}

impl FieldOperation for ReorderChildren {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        let node = doc.arena.get(self.node_id)?;
        if node.parent.is_none() {
            return Err(CoreError::ValidationError(
                "ReorderChildren: node has no parent".to_string(),
            ));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let parent_id = doc
            .arena
            .get(self.node_id)?
            .parent
            .ok_or(CoreError::ValidationError(
                "ReorderChildren: node has no parent".to_string(),
            ))?;
        tree::rearrange(&mut doc.arena, self.node_id, parent_id, self.new_position)?;
        Ok(())
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
    fn test_reparent_node_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let parent_a = insert_frame(&mut doc, 1, "Parent A");
        let parent_b = insert_frame(&mut doc, 2, "Parent B");
        let child = insert_frame(&mut doc, 3, "Child");

        tree::add_child(&mut doc.arena, parent_a, child).expect("add child");
        assert_eq!(doc.arena.get(parent_a).unwrap().children, vec![child]);

        let op = ReparentNode {
            node_id: child,
            new_parent_id: parent_b,
            new_position: 0,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(doc.arena.get(parent_a).unwrap().children.is_empty());
        assert_eq!(doc.arena.get(parent_b).unwrap().children, vec![child]);
    }

    #[test]
    fn test_reparent_node_cycle_detection() {
        let mut doc = Document::new("Test".to_string());
        let parent = insert_frame(&mut doc, 1, "Parent");
        let child = insert_frame(&mut doc, 2, "Child");

        tree::add_child(&mut doc.arena, parent, child).expect("add child");

        let op = ReparentNode {
            node_id: parent,
            new_parent_id: child,
            new_position: 0,
        };

        // validate passes (both nodes exist), but apply detects cycle
        assert!(op.apply(&mut doc).is_err());
    }

    #[test]
    fn test_reparent_node_validate_rejects_missing_node() {
        let doc = Document::new("Test".to_string());
        let op = ReparentNode {
            node_id: NodeId::new(99, 0),
            new_parent_id: NodeId::new(98, 0),
            new_position: 0,
        };
        assert!(op.validate(&doc).is_err());
    }

    // ── ReorderChildren ─────────────────────────────────────────────

    #[test]
    fn test_reorder_children_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let parent = insert_frame(&mut doc, 1, "Parent");
        let child_a = insert_frame(&mut doc, 2, "A");
        let child_b = insert_frame(&mut doc, 3, "B");
        let child_c = insert_frame(&mut doc, 4, "C");

        tree::add_child(&mut doc.arena, parent, child_a).expect("add a");
        tree::add_child(&mut doc.arena, parent, child_b).expect("add b");
        tree::add_child(&mut doc.arena, parent, child_c).expect("add c");

        // Move A from position 0 to position 2
        let op = ReorderChildren {
            node_id: child_a,
            new_position: 2,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        let children = &doc.arena.get(parent).unwrap().children;
        assert_eq!(children, &[child_b, child_c, child_a]);
    }

    #[test]
    fn test_reorder_children_no_parent_fails() {
        let mut doc = Document::new("Test".to_string());
        let orphan = insert_frame(&mut doc, 1, "Orphan");

        let op = ReorderChildren {
            node_id: orphan,
            new_position: 0,
        };

        assert!(op.validate(&doc).is_err());
    }
}
