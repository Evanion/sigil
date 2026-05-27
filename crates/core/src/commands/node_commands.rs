// crates/core/src/commands/node_commands.rs

use crate::command::FieldOperation;
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
        // Validate float fields in NodeKind variants.
        // Delegate to validate_node_kind which covers all variants exhaustively.
        crate::node::validate_node_kind(&self.kind)?;
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

/// Atomically deletes N nodes (Spec 19). The only delete path in the core
/// crate after the Spec 19 Task 16 migration — single-node delete callers
/// pass a one-element `targets` vector.
///
/// `targets` carries each node's `NodeId` paired with the `PageId` of the
/// page it is a root of (if any). The wire layer (GraphQL/MCP) resolves
/// UUIDs → `NodeId`s and looks up page roots before constructing this op.
#[derive(Debug)]
pub struct DeleteNodes {
    /// The list of nodes to delete, each paired with the page it is a root of
    /// (if any). `NodeId` is arena-local — the wire layer resolves UUIDs first.
    pub targets: Vec<(NodeId, Option<PageId>)>,
}

/// Per-target rollback snapshot for `DeleteNodes::apply`. Module-private.
///
/// `subtree` stores the cloned `Node` values in deletion order (descendants
/// first, root last). On rollback, the order is reversed so each subtree is
/// reinserted with its descendants present.
#[derive(Debug)]
struct DeleteNodesSnapshot {
    node_id: NodeId,
    page_id: Option<PageId>,
    parent_id: Option<NodeId>,
    original_index: usize,
    subtree: Vec<(NodeId, Node)>,
}

impl FieldOperation for DeleteNodes {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        // 1. Empty batch
        if self.targets.is_empty() {
            return Err(CoreError::ValidationError(
                "DeleteNodes: empty batch not allowed".to_string(),
            ));
        }
        // 2. Oversized batch
        if self.targets.len() > crate::validate::MAX_NODES_PER_DELETE_BATCH {
            return Err(CoreError::ValidationError(format!(
                "DeleteNodes: batch of {} exceeds MAX_NODES_PER_DELETE_BATCH ({})",
                self.targets.len(),
                crate::validate::MAX_NODES_PER_DELETE_BATCH,
            )));
        }
        // 3. Duplicates
        let mut seen: std::collections::HashSet<NodeId> = std::collections::HashSet::new();
        for (node_id, _) in &self.targets {
            if !seen.insert(*node_id) {
                return Err(CoreError::ValidationError(format!(
                    "DeleteNodes: duplicate NodeId {node_id:?} in batch"
                )));
            }
        }
        // 4. Every node must exist
        for (idx, (node_id, _)) in self.targets.iter().enumerate() {
            doc.arena.get(*node_id).map_err(|_| {
                CoreError::ValidationError(format!(
                    "DeleteNodes: target at index {idx} ({node_id:?}) not found in arena"
                ))
            })?;
        }
        // 5. Verify (node, page_id) invariant: if page_id is Some, the node must
        // actually be a root of that page. Without this check, a malformed wire-
        // layer call could trigger silent corruption during rollback.
        for (idx, (node_id, page_id)) in self.targets.iter().enumerate() {
            let node = doc.arena.get(*node_id)?;
            let has_parent = node.parent.is_some();
            match (has_parent, *page_id) {
                (true, Some(_)) => {
                    return Err(CoreError::ValidationError(format!(
                        "DeleteNodes: target at index {idx} ({node_id:?}) has a \
                         parent but page_id is Some — page_id must be None for non-root nodes"
                    )));
                }
                (false, Some(pid)) => {
                    let page = doc.page(pid)?;
                    if !page.root_nodes.contains(node_id) {
                        return Err(CoreError::ValidationError(format!(
                            "DeleteNodes: target at index {idx} ({node_id:?}) claims to be \
                             a root of page {pid:?} but is not in page.root_nodes"
                        )));
                    }
                }
                // (true, None): node has a parent, no page claimed — valid.
                // (false, None): orphan — valid but rare.
                _ => {}
            }
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        // Re-run validation. Self-protecting per RF-024.
        self.validate(doc)?;

        // ── 1. Dedup ancestor/descendant pairs ──────────────────────────
        // For each target, walk its ancestors. If any ancestor is also a
        // target, drop this entry — its parent will delete it transitively.
        let target_set: std::collections::HashSet<NodeId> =
            self.targets.iter().map(|(id, _)| *id).collect();
        let mut retained: Vec<(NodeId, Option<PageId>)> = Vec::with_capacity(self.targets.len());
        for (node_id, page_id) in &self.targets {
            let chain =
                crate::tree::ancestors(&doc.arena, *node_id, crate::validate::MAX_NODE_TREE_DEPTH)?;
            // `ancestors` returns [root, ..., node_id]. Drop the trailing
            // self entry to leave only true ancestors.
            let is_descendant_of_other = chain
                .iter()
                .filter(|a| *a != node_id)
                .any(|a| target_set.contains(a));
            if !is_descendant_of_other {
                retained.push((*node_id, *page_id));
            }
        }
        // Hard check: dedup must not produce an empty set when validate()
        // guarantees a non-empty input. A debug_assert! would silently no-op
        // in release builds (CLAUDE.md §11 "No Silent Error Suppression").
        if retained.is_empty() {
            return Err(CoreError::ValidationError(
                "DeleteNodes: dedup produced empty set (validate invariant violated)".to_string(),
            ));
        }

        // ── 2. Capture snapshots BEFORE mutation ────────────────────────
        let mut snapshots: Vec<DeleteNodesSnapshot> = Vec::with_capacity(retained.len());
        for (node_id, page_id) in &retained {
            let node = doc.arena.get(*node_id)?;
            let parent_id = node.parent;
            let original_index = if let Some(pid) = parent_id {
                doc.arena
                    .get(pid)?
                    .children
                    .iter()
                    .position(|c| *c == *node_id)
                    .ok_or_else(|| {
                        CoreError::ValidationError(format!(
                            "DeleteNodes: node {node_id:?} not found in parent's children"
                        ))
                    })?
            } else if let Some(pid) = page_id {
                // validate() guarantees the node IS in this page's root_nodes.
                // If it isn't, that's a bug or concurrent mutation — surface it.
                doc.page(*pid)?
                    .root_nodes
                    .iter()
                    .position(|n| *n == *node_id)
                    .ok_or_else(|| {
                        CoreError::ValidationError(format!(
                            "DeleteNodes: node {node_id:?} not found in page {pid:?} root_nodes \
                             (validate() invariant violated)"
                        ))
                    })?
            } else {
                // True orphan: no parent, no page. Index is irrelevant — both rollback
                // branches will no-op below since parent_id and page_id are both None.
                0
            };
            let descendants = crate::tree::descendants(
                &doc.arena,
                *node_id,
                crate::validate::MAX_NODE_TREE_DEPTH,
            )?;
            let mut subtree_clone = Vec::with_capacity(descendants.len() + 1);
            for desc_id in &descendants {
                subtree_clone.push((*desc_id, doc.arena.get(*desc_id)?.clone()));
            }
            subtree_clone.push((*node_id, doc.arena.get(*node_id)?.clone()));
            snapshots.push(DeleteNodesSnapshot {
                node_id: *node_id,
                page_id: *page_id,
                parent_id,
                original_index,
                subtree: subtree_clone,
            });
        }

        // ── 3. Sort by (parent_id, original_index DESCENDING) ───────────
        // `NodeId` does not derive `Ord`; project it to (index, generation)
        // for a stable total order over parents.
        let parent_key = |p: Option<NodeId>| p.map(|id| (id.index(), id.generation()));
        snapshots.sort_by(
            |a, b| match parent_key(a.parent_id).cmp(&parent_key(b.parent_id)) {
                std::cmp::Ordering::Equal => b.original_index.cmp(&a.original_index),
                other => other,
            },
        );

        // ── 4. Delete loop with rollback tracking ───────────────────────
        let mut completed: Vec<&DeleteNodesSnapshot> = Vec::with_capacity(snapshots.len());
        for snap in &snapshots {
            match delete_nodes_subtree(doc, snap) {
                Ok(()) => completed.push(snap),
                Err(e) => {
                    // Rollback in reverse order. Accumulate any rollback
                    // errors so callers see the full diagnostic trail
                    // (CLAUDE.md §11 "No Silent Error Suppression"). Continue
                    // attempting reinsertion of subsequent completed items
                    // even if one rollback fails — abandoning rollback on
                    // first failure would leave more items unrolled-back.
                    let mut rollback_errors: Vec<CoreError> = Vec::new();
                    for done in completed.iter().rev() {
                        if let Err(rb_err) = reinsert_nodes_subtree(doc, done) {
                            rollback_errors.push(rb_err);
                        }
                    }
                    if rollback_errors.is_empty() {
                        return Err(e);
                    }
                    return Err(CoreError::RollbackFailed {
                        primary: Box::new(e),
                        rollback_errors,
                    });
                }
            }
        }
        Ok(())
    }
}

/// Deletes a single subtree (helper for `DeleteNodes::apply`).
/// Deletion order: page root cleanup → tree detach → descendant removal
/// → root removal.
fn delete_nodes_subtree(doc: &mut Document, snap: &DeleteNodesSnapshot) -> Result<(), CoreError> {
    // Propagate page_mut errors instead of silently swallowing
    // (CLAUDE.md §11 "No Silent Error Suppression"). A missing page during
    // forward deletion is an invariant violation that must surface.
    if let Some(page_id) = snap.page_id {
        let page = doc.page_mut(page_id)?;
        page.root_nodes.retain(|nid| *nid != snap.node_id);
    }
    let descendants = crate::tree::descendants(
        &doc.arena,
        snap.node_id,
        crate::validate::MAX_NODE_TREE_DEPTH,
    )?;
    crate::tree::remove_child(&mut doc.arena, snap.node_id)?;
    for desc_id in descendants {
        doc.arena.remove(desc_id)?;
    }
    doc.arena.remove(snap.node_id)?;
    Ok(())
}

/// Reinserts a previously-deleted subtree at its captured position.
/// Preserves `NodeId` identity via `Arena::reinsert`.
fn reinsert_nodes_subtree(doc: &mut Document, snap: &DeleteNodesSnapshot) -> Result<(), CoreError> {
    // Reinsert arena entries in REVERSE of deletion order so the root
    // exists before descendants reattach. The snapshot's `subtree` is
    // stored in deletion order [descendants..., root], so iterate in
    // reverse to insert [root, ...descendants].
    for (id, node) in snap.subtree.iter().rev() {
        doc.arena.reinsert(*id, node.clone())?;
    }
    // Restore parent linkage at the original index.
    if let Some(parent_id) = snap.parent_id {
        let parent = doc.arena.get_mut(parent_id)?;
        // Clamp the index defensively in case the parent's children
        // vector has changed (shouldn't happen under the lock, but
        // bound the insert position).
        let pos = snap.original_index.min(parent.children.len());
        parent.children.insert(pos, snap.node_id);
    }
    // Restore page root entry. Propagate page_mut errors instead of silently
    // swallowing — a missing page during rollback is a critical invariant
    // violation (CLAUDE.md §11 "No Silent Error Suppression").
    if let Some(page_id) = snap.page_id {
        let page = doc.page_mut(page_id)?;
        let pos = snap.original_index.min(page.root_nodes.len());
        page.root_nodes.insert(pos, snap.node_id);
    }
    Ok(())
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
        // Enumerate every non-Text variant explicitly so a new variant in
        // core forces a compile error here (rust-defensive "NodeKind
        // Variants Must Have Complete Validation Coverage", RF-040).
        match &mut node.kind {
            NodeKind::Text { content, .. } => {
                content.clone_from(&self.new_content);
            }
            NodeKind::Frame { .. }
            | NodeKind::Rectangle { .. }
            | NodeKind::Ellipse { .. }
            | NodeKind::Path { .. }
            | NodeKind::Image { .. }
            | NodeKind::Group
            | NodeKind::ComponentInstance { .. } => {
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
            NodeKind::Frame {
                layout: None,
                corners: crate::node::default_corners(),
            },
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
                corners: crate::node::default_corners(),
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
                sizing: crate::node::TextSizing::AutoWidth,
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
                corners: crate::node::corner_radii_to_corners([0.0, f64::NAN, 0.0, 0.0]),
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
                corners: crate::node::corner_radii_to_corners([0.0, 0.0, -1.0, 0.0]),
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

    // ── DeleteNodes (Spec 19) ───────────────────────────────────────────

    #[test]
    fn test_delete_nodes_validate_rejects_empty_batch() {
        let doc = Document::new("Test".to_string());
        let op = DeleteNodes { targets: vec![] };
        let err = op.validate(&doc).expect_err("empty batch must error");
        assert!(format!("{err:?}").to_lowercase().contains("empty"));
    }

    #[test]
    fn test_max_nodes_per_delete_batch_enforced() {
        // Per CLAUDE.md §11 "Constant Enforcement Tests": this test rejects a real
        // out-of-range input (not a tautology). Per the PR #67 amendment, this is
        // the canonical _enforced test for MAX_NODES_PER_DELETE_BATCH.
        let doc = Document::new("Test".to_string());
        let oversize = crate::validate::MAX_NODES_PER_DELETE_BATCH + 1;
        let targets: Vec<(NodeId, Option<PageId>)> = (0..oversize)
            .map(|i| {
                (
                    NodeId::new(u32::try_from(i & 0xffff_ffff).unwrap(), 0),
                    None,
                )
            })
            .collect();
        let op = DeleteNodes { targets };
        let err = op.validate(&doc).expect_err("oversized batch must error");
        assert!(
            format!("{err:?}").to_lowercase().contains("batch"),
            "expected 'batch' in error: {err:?}"
        );
    }

    #[test]
    fn test_delete_nodes_validate_rejects_duplicate_node_id() {
        let mut doc = Document::new("Test".to_string());
        let n = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Group,
            "G".to_string(),
        )
        .expect("create");
        let id = doc.arena.insert(n).expect("insert");
        let op = DeleteNodes {
            targets: vec![(id, None), (id, None)],
        };
        let err = op.validate(&doc).expect_err("duplicate must error");
        assert!(format!("{err:?}").to_lowercase().contains("duplicate"));
    }

    #[test]
    fn test_delete_nodes_validate_rejects_missing_node() {
        let doc = Document::new("Test".to_string());
        let op = DeleteNodes {
            targets: vec![(NodeId::new(99, 0), None)],
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_delete_nodes_validate_and_apply() {
        // Per CLAUDE.md §1: every FieldOperation needs a test exercising validate → apply.
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");

        let mut ids = Vec::new();
        for i in 1..=3u8 {
            let n = Node::new(
                NodeId::new(0, 0),
                make_uuid(i),
                NodeKind::Rectangle {
                    corners: crate::node::default_corners(),
                },
                format!("R{i}"),
            )
            .expect("create");
            let id = doc.arena.insert(n).expect("insert");
            doc.add_root_node_to_page(page_id, id).expect("add root");
            ids.push(id);
        }
        assert_eq!(doc.page(page_id).unwrap().root_nodes.len(), 3);

        let op = DeleteNodes {
            targets: ids.iter().map(|id| (*id, Some(page_id))).collect(),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        for id in &ids {
            assert!(doc.arena.get(*id).is_err(), "expected node {id:?} removed");
        }
        assert!(doc.page(page_id).unwrap().root_nodes.is_empty());
    }

    #[test]
    fn test_delete_nodes_deduplicates_ancestor_descendant() {
        let mut doc = Document::new("Test".to_string());
        let parent = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame {
                layout: None,
                corners: crate::node::default_corners(),
            },
            "P".to_string(),
        )
        .expect("create parent");
        let parent_id = doc.arena.insert(parent).expect("insert parent");
        let child = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Rectangle {
                corners: crate::node::default_corners(),
            },
            "C".to_string(),
        )
        .expect("create child");
        let child_id = doc.arena.insert(child).expect("insert child");
        crate::tree::add_child(&mut doc.arena, parent_id, child_id).expect("link");

        // Target both parent and child. Dedup must retain only parent (descendant
        // is removed transitively).
        let op = DeleteNodes {
            targets: vec![(parent_id, None), (child_id, None)],
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        assert!(doc.arena.get(parent_id).is_err());
        assert!(doc.arena.get(child_id).is_err());
    }

    #[test]
    fn test_delete_nodes_descending_sibling_index_order() {
        // Two children at parent indices 0 and 1. Provide ASCENDING input;
        // apply must internally sort DESCENDING so the higher-index removal
        // happens first (leaving lower-index intact for the second removal).
        let mut doc = Document::new("Test".to_string());
        let parent = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame {
                layout: None,
                corners: crate::node::default_corners(),
            },
            "P".to_string(),
        )
        .expect("create");
        let parent_id = doc.arena.insert(parent).expect("insert parent");

        let c0 = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Group,
            "C0".to_string(),
        )
        .expect("create");
        let c0_id = doc.arena.insert(c0).expect("insert");
        let c1 = Node::new(
            NodeId::new(0, 0),
            make_uuid(3),
            NodeKind::Group,
            "C1".to_string(),
        )
        .expect("create");
        let c1_id = doc.arena.insert(c1).expect("insert");

        crate::tree::add_child(&mut doc.arena, parent_id, c0_id).expect("link c0");
        crate::tree::add_child(&mut doc.arena, parent_id, c1_id).expect("link c1");

        let op = DeleteNodes {
            targets: vec![(c0_id, None), (c1_id, None)],
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        assert!(doc.arena.get(c0_id).is_err());
        assert!(doc.arena.get(c1_id).is_err());
        assert!(doc.arena.get(parent_id).unwrap().children.is_empty());
    }

    #[test]
    fn test_delete_nodes_removes_subtree_children() {
        // A parent with a grandchild — verify all 3 levels are removed when only
        // the parent is targeted (descendant cleanup is the responsibility of
        // `DeleteNodes::apply`).
        let mut doc = Document::new("Test".to_string());
        let p = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame {
                layout: None,
                corners: crate::node::default_corners(),
            },
            "P".to_string(),
        )
        .expect("create");
        let p_id = doc.arena.insert(p).expect("insert");
        let c = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Group,
            "C".to_string(),
        )
        .expect("create");
        let c_id = doc.arena.insert(c).expect("insert");
        let gc = Node::new(
            NodeId::new(0, 0),
            make_uuid(3),
            NodeKind::Group,
            "GC".to_string(),
        )
        .expect("create");
        let gc_id = doc.arena.insert(gc).expect("insert");
        crate::tree::add_child(&mut doc.arena, p_id, c_id).expect("link c");
        crate::tree::add_child(&mut doc.arena, c_id, gc_id).expect("link gc");

        let op = DeleteNodes {
            targets: vec![(p_id, None)],
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        assert!(doc.arena.get(p_id).is_err());
        assert!(doc.arena.get(c_id).is_err());
        assert!(doc.arena.get(gc_id).is_err());
    }

    #[test]
    fn test_delete_nodes_subtree_rollback_preserves_identity() {
        // Per CLAUDE.md §11 "Multi-Item Mutations Must Roll Back on Partial Failure"
        // and "Arena Operations Must Preserve Identity on Undo": this test exercises
        // the rollback path of DeleteNodes by directly calling the private helpers.
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(20));
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");

        // Parent → child → grandchild
        let parent = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame {
                layout: None,
                corners: crate::node::default_corners(),
            },
            "P".to_string(),
        )
        .expect("create");
        let parent_id = doc.arena.insert(parent).expect("insert");
        doc.add_root_node_to_page(page_id, parent_id).expect("root");

        let child = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Group,
            "C".to_string(),
        )
        .expect("create");
        let child_id = doc.arena.insert(child).expect("insert");
        crate::tree::add_child(&mut doc.arena, parent_id, child_id).expect("link c");

        let gc = Node::new(
            NodeId::new(0, 0),
            make_uuid(3),
            NodeKind::Group,
            "GC".to_string(),
        )
        .expect("create");
        let gc_id = doc.arena.insert(gc).expect("insert");
        crate::tree::add_child(&mut doc.arena, child_id, gc_id).expect("link gc");

        // Capture initial state for post-rollback comparison
        let initial_parent_children = doc.arena.get(parent_id).unwrap().children.clone();
        let initial_page_roots = doc.page(page_id).unwrap().root_nodes.clone();

        // Build a snapshot the same way DeleteNodes::apply does.
        let descendants =
            crate::tree::descendants(&doc.arena, parent_id, crate::validate::MAX_NODE_TREE_DEPTH)
                .expect("descendants");
        let mut subtree_clone = Vec::with_capacity(descendants.len() + 1);
        for desc_id in &descendants {
            subtree_clone.push((*desc_id, doc.arena.get(*desc_id).unwrap().clone()));
        }
        subtree_clone.push((parent_id, doc.arena.get(parent_id).unwrap().clone()));
        let snap = super::DeleteNodesSnapshot {
            node_id: parent_id,
            page_id: Some(page_id),
            parent_id: None,
            original_index: 0,
            subtree: subtree_clone,
        };

        // Delete the subtree.
        super::delete_nodes_subtree(&mut doc, &snap).expect("delete");
        assert!(doc.arena.get(parent_id).is_err());
        assert!(doc.arena.get(child_id).is_err());
        assert!(doc.arena.get(gc_id).is_err());
        assert!(doc.page(page_id).unwrap().root_nodes.is_empty());

        // Roll back. NodeId identity must be preserved.
        super::reinsert_nodes_subtree(&mut doc, &snap).expect("reinsert");
        assert!(
            doc.arena.get(parent_id).is_ok(),
            "parent restored with same NodeId"
        );
        assert!(
            doc.arena.get(child_id).is_ok(),
            "child restored with same NodeId"
        );
        assert!(
            doc.arena.get(gc_id).is_ok(),
            "grandchild restored with same NodeId"
        );

        // Structural restoration: page.root_nodes and parent.children must match
        // pre-deletion state.
        assert_eq!(
            doc.page(page_id).unwrap().root_nodes,
            initial_page_roots,
            "page.root_nodes restored at original index"
        );
        assert_eq!(
            doc.arena.get(parent_id).unwrap().children,
            initial_parent_children,
            "parent.children restored at original index"
        );
    }

    #[test]
    fn test_delete_nodes_validate_rejects_inconsistent_page_id() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");
        let parent = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame {
                layout: None,
                corners: crate::node::default_corners(),
            },
            "P".to_string(),
        )
        .expect("create");
        let parent_id = doc.arena.insert(parent).expect("insert");
        let child = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Group,
            "C".to_string(),
        )
        .expect("create");
        let child_id = doc.arena.insert(child).expect("insert");
        crate::tree::add_child(&mut doc.arena, parent_id, child_id).expect("link");

        // Bad input: child has a parent but page_id is Some.
        let op = DeleteNodes {
            targets: vec![(child_id, Some(page_id))],
        };
        assert!(op.validate(&doc).is_err());

        // Bad input: parent has no parent but isn't actually a page root.
        let op2 = DeleteNodes {
            targets: vec![(parent_id, Some(page_id))],
        };
        assert!(
            op2.validate(&doc).is_err(),
            "parent not added to page roots"
        );
    }
}
