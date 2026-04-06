// crates/core/src/commands/batch_commands.rs
//
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.
#![allow(clippy::unnecessary_literal_bound)]

use crate::command::{Command, SideEffect};
use crate::commands::style_commands::validate_transform;
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::Transform;
use crate::validate::MAX_BATCH_SIZE;

/// Atomically sets the transform on multiple nodes in a single undo-able command.
///
/// Validation is performed for ALL entries before any mutation is applied —
/// if any entry fails validation the entire batch is rejected and no node is
/// modified.
#[derive(Debug)]
pub struct BatchSetTransform {
    /// `(node_id, new_transform)` pairs to apply.
    pub entries: Vec<(NodeId, Transform)>,
    /// `(node_id, old_transform)` pairs used for undo.
    pub old_transforms: Vec<(NodeId, Transform)>,
}

impl Command for BatchSetTransform {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.entries.len() > MAX_BATCH_SIZE {
            return Err(CoreError::ValidationError(format!(
                "batch size {} exceeds maximum of {MAX_BATCH_SIZE}",
                self.entries.len()
            )));
        }

        // Validate ALL transforms before touching any node (atomicity).
        for (node_id, transform) in &self.entries {
            validate_transform(transform).map_err(|e| {
                CoreError::ValidationError(format!("invalid transform for node {node_id}: {e}"))
            })?;
        }

        // All entries are valid — now apply.
        for (node_id, transform) in &self.entries {
            doc.arena.get_mut(*node_id)?.transform = *transform;
        }

        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        // Symmetric validation: validate all old transforms before restoring any.
        for (node_id, transform) in &self.old_transforms {
            validate_transform(transform).map_err(|e| {
                CoreError::ValidationError(format!("invalid old transform for node {node_id}: {e}"))
            })?;
        }

        for (node_id, transform) in &self.old_transforms {
            doc.arena.get_mut(*node_id)?.transform = *transform;
        }

        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Batch set transform"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::node::{Node, NodeKind};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn make_frame(doc: &mut Document, uuid_byte: u8, name: &str) -> NodeId {
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(uuid_byte),
            NodeKind::Frame { layout: None },
            name.to_string(),
        )
        .expect("create node");
        doc.arena.insert(node).expect("insert node")
    }

    fn transform_at(x: f64, y: f64) -> Transform {
        Transform {
            x,
            y,
            width: 100.0,
            height: 100.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        }
    }

    // ── Integration: execute / undo / redo ─────────────────────────────

    #[test]
    fn test_batch_set_transform_execute_undo_redo_cycle() {
        let mut doc = Document::new("Test".to_string());
        let id_a = make_frame(&mut doc, 1, "A");
        let id_b = make_frame(&mut doc, 2, "B");
        let id_c = make_frame(&mut doc, 3, "C");

        let orig_a = doc.arena.get(id_a).expect("get a").transform;
        let orig_b = doc.arena.get(id_b).expect("get b").transform;
        let orig_c = doc.arena.get(id_c).expect("get c").transform;

        let new_a = transform_at(10.0, 20.0);
        let new_b = transform_at(30.0, 40.0);
        let new_c = transform_at(50.0, 60.0);

        let cmd = BatchSetTransform {
            entries: vec![(id_a, new_a), (id_b, new_b), (id_c, new_c)],
            old_transforms: vec![(id_a, orig_a), (id_b, orig_b), (id_c, orig_c)],
        };

        // Execute
        doc.execute(Box::new(cmd)).expect("execute");
        assert_eq!(doc.arena.get(id_a).expect("get a").transform.x, 10.0);
        assert_eq!(doc.arena.get(id_b).expect("get b").transform.x, 30.0);
        assert_eq!(doc.arena.get(id_c).expect("get c").transform.x, 50.0);

        // Undo
        doc.undo().expect("undo");
        assert_eq!(
            doc.arena.get(id_a).expect("get a").transform,
            orig_a,
            "undo: A should be restored"
        );
        assert_eq!(
            doc.arena.get(id_b).expect("get b").transform,
            orig_b,
            "undo: B should be restored"
        );
        assert_eq!(
            doc.arena.get(id_c).expect("get c").transform,
            orig_c,
            "undo: C should be restored"
        );

        // Redo
        doc.redo().expect("redo");
        assert_eq!(doc.arena.get(id_a).expect("get a").transform.x, 10.0);
        assert_eq!(doc.arena.get(id_b).expect("get b").transform.x, 30.0);
        assert_eq!(doc.arena.get(id_c).expect("get c").transform.x, 50.0);
    }

    // ── Atomic validation: bad entry rejects entire batch ──────────────

    #[test]
    fn test_batch_set_transform_validation_rejects_entire_batch() {
        let mut doc = Document::new("Test".to_string());
        let id_good = make_frame(&mut doc, 1, "Good");
        let id_bad = make_frame(&mut doc, 2, "Bad");

        let orig_good = doc.arena.get(id_good).expect("get good").transform;
        let orig_bad = doc.arena.get(id_bad).expect("get bad").transform;

        let good_transform = transform_at(99.0, 99.0);
        let bad_transform = Transform {
            x: 0.0,
            y: 0.0,
            width: -1.0, // negative width — invalid
            height: 100.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        };

        let cmd = BatchSetTransform {
            entries: vec![(id_good, good_transform), (id_bad, bad_transform)],
            old_transforms: vec![(id_good, orig_good), (id_bad, orig_bad)],
        };

        let result = cmd.apply(&mut doc);
        assert!(result.is_err(), "batch with invalid entry must fail");

        // Neither node should have been modified.
        assert_eq!(
            doc.arena.get(id_good).expect("get good").transform,
            orig_good,
            "good node must not be modified when batch is rejected"
        );
        assert_eq!(
            doc.arena.get(id_bad).expect("get bad").transform,
            orig_bad,
            "bad node must not be modified when batch is rejected"
        );
    }

    // ── MAX_BATCH_SIZE enforcement ─────────────────────────────────────

    #[test]
    fn test_max_batch_size_enforced() {
        let mut doc = Document::new("Test".to_string());
        // Create one real node for old_transforms; new entries use a placeholder id.
        let id = make_frame(&mut doc, 1, "Node");
        let t = transform_at(0.0, 0.0);

        let entries: Vec<(NodeId, Transform)> = (0..=MAX_BATCH_SIZE)
            .map(|i| (NodeId::new(i as u32, 0), t))
            .collect();

        let cmd = BatchSetTransform {
            entries,
            old_transforms: vec![(id, t)],
        };

        let result = cmd.apply(&mut doc);
        assert!(
            result.is_err(),
            "batch with {MAX_BATCH_SIZE}+1 entries must be rejected"
        );
    }

    // ── Empty batch is a no-op ─────────────────────────────────────────

    #[test]
    fn test_batch_set_transform_empty_is_noop() {
        let mut doc = Document::new("Test".to_string());
        let id = make_frame(&mut doc, 1, "Node");
        let orig = doc.arena.get(id).expect("get").transform;

        let cmd = BatchSetTransform {
            entries: vec![],
            old_transforms: vec![],
        };

        doc.execute(Box::new(cmd)).expect("execute empty batch");
        assert_eq!(
            doc.arena.get(id).expect("get").transform,
            orig,
            "empty batch must leave node unchanged"
        );
    }

    // ── Non-existent node returns error ───────────────────────────────

    #[test]
    fn test_batch_set_transform_nonexistent_node_fails() {
        let mut doc = Document::new("Test".to_string());
        let ghost_id = NodeId::new(9999, 9999);
        let t = transform_at(0.0, 0.0);

        let cmd = BatchSetTransform {
            entries: vec![(ghost_id, t)],
            old_transforms: vec![(ghost_id, t)],
        };

        let result = cmd.apply(&mut doc);
        assert!(
            result.is_err(),
            "batch referencing a non-existent node must fail"
        );
    }
}
