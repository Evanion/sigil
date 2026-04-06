# Backend + Store Foundation for Viewport Interactions (Plan 11a-a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 new core commands (`BatchSetTransform`, `GroupNodes`, `UngroupNodes`), 3 GraphQL mutations, migrate the store selection model from single to multi-select, and add store mutation methods -- unblocking all Spec 11a frontend viewport interaction work.

**Architecture:** Follow the existing mutation pattern: core command with undo/redo -> GraphQL resolver (lock scope, execute, broadcast) -> frontend store method (optimistic update + rollback). The `BatchSetTransform` command reuses the existing `validate_transform()`. `GroupNodes`/`UngroupNodes` use existing tree operations (`add_child`, `remove_child`, `rearrange`) and arena APIs (`insert`, `remove`, `reinsert`).

**Tech Stack:** Rust (core, server crates), TypeScript (frontend store + GraphQL strings)

---

## Scope

**In scope:**
- `BatchSetTransform` core command (apply/undo/redo cycle, atomic validation, `MAX_BATCH_SIZE` constant)
- `GroupNodes` core command (create group node, reparent children, compute union bounding box)
- `UngroupNodes` core command (reparent children out, delete group nodes)
- GraphQL mutations: `batchSetTransform`, `groupNodes`, `ungroupNodes`
- Frontend: multi-select store migration (`selectedNodeIds`), 3 new mutation strings, 3 new store methods
- `MutationEventKind` variants for group operations (if needed)

**Deferred:**
- Handle hit-testing and resize (Plan 11a-b)
- Smart guide snapping (Plan 11a-c)
- Marquee selection canvas interaction (Plan 11a-b)
- Align/distribute panel UI (Plan 11a-d)
- MCP tools for batch/group/ungroup (future plan)

---

## Task 1: Add `MAX_BATCH_SIZE` constant and `BatchSetTransform` core command

**Files:**
- Modify: `crates/core/src/validate.rs`
- Create: `crates/core/src/commands/batch_commands.rs`
- Modify: `crates/core/src/commands/mod.rs`

- [ ] **Step 1: Add `MAX_BATCH_SIZE` constant to validate.rs**

Add to `crates/core/src/validate.rs`, in the constants section (after `MAX_GRID_TRACKS`):

```rust
/// Maximum number of entries in a batch transform operation.
pub const MAX_BATCH_SIZE: usize = 256;
```

- [ ] **Step 2: Write failing tests in a new file**

Create `crates/core/src/commands/batch_commands.rs` with the test module first:

```rust
// crates/core/src/commands/batch_commands.rs
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

/// Atomically sets transforms for multiple nodes.
///
/// All transforms are validated before any are applied. If any transform
/// fails validation, the entire batch is rejected.
#[derive(Debug)]
pub struct BatchSetTransform {
    /// The new transforms to apply: `(node_id, new_transform)`.
    pub entries: Vec<(NodeId, Transform)>,
    /// The previous transforms for undo: `(node_id, old_transform)`.
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
        // Validate all transforms before applying any
        for (node_id, transform) in &self.entries {
            doc.arena.get(*node_id)?; // verify node exists
            validate_transform(transform)?;
        }
        // Apply all
        for (node_id, transform) in &self.entries {
            doc.arena.get_mut(*node_id)?.transform = *transform;
        }
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        // Validate all old transforms before restoring any
        for (node_id, transform) in &self.old_transforms {
            doc.arena.get(*node_id)?;
            validate_transform(transform)?;
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
    use crate::node::{Node, NodeKind};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn insert_rect(doc: &mut Document, n: u8) -> NodeId {
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(n),
            NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            format!("Rect{n}"),
        )
        .expect("create node");
        doc.arena.insert(node).expect("insert")
    }

    #[test]
    fn test_batch_set_transform_execute_undo_redo_cycle() {
        let mut doc = Document::new("Test".to_string());
        let id1 = insert_rect(&mut doc, 1);
        let id2 = insert_rect(&mut doc, 2);
        let id3 = insert_rect(&mut doc, 3);

        let old1 = doc.arena.get(id1).unwrap().transform;
        let old2 = doc.arena.get(id2).unwrap().transform;
        let old3 = doc.arena.get(id3).unwrap().transform;

        let new1 = Transform { x: 10.0, y: 20.0, ..old1 };
        let new2 = Transform { x: 30.0, y: 40.0, ..old2 };
        let new3 = Transform { x: 50.0, y: 60.0, ..old3 };

        let cmd = BatchSetTransform {
            entries: vec![(id1, new1), (id2, new2), (id3, new3)],
            old_transforms: vec![(id1, old1), (id2, old2), (id3, old3)],
        };

        // Execute
        doc.execute(Box::new(cmd)).expect("execute");
        assert_eq!(doc.arena.get(id1).unwrap().transform.x, 10.0);
        assert_eq!(doc.arena.get(id2).unwrap().transform.x, 30.0);
        assert_eq!(doc.arena.get(id3).unwrap().transform.x, 50.0);

        // Undo
        doc.undo().expect("undo");
        assert_eq!(doc.arena.get(id1).unwrap().transform.x, old1.x);
        assert_eq!(doc.arena.get(id2).unwrap().transform.x, old2.x);
        assert_eq!(doc.arena.get(id3).unwrap().transform.x, old3.x);

        // Redo
        doc.redo().expect("redo");
        assert_eq!(doc.arena.get(id1).unwrap().transform.x, 10.0);
        assert_eq!(doc.arena.get(id2).unwrap().transform.x, 30.0);
        assert_eq!(doc.arena.get(id3).unwrap().transform.x, 50.0);
    }

    #[test]
    fn test_batch_set_transform_validation_rejects_entire_batch() {
        let mut doc = Document::new("Test".to_string());
        let id1 = insert_rect(&mut doc, 1);
        let id2 = insert_rect(&mut doc, 2);

        let old1 = doc.arena.get(id1).unwrap().transform;
        let old2 = doc.arena.get(id2).unwrap().transform;

        let good = Transform { x: 10.0, y: 20.0, ..old1 };
        let bad = Transform { width: -5.0, ..old2 }; // negative width

        let cmd = BatchSetTransform {
            entries: vec![(id1, good), (id2, bad)],
            old_transforms: vec![(id1, old1), (id2, old2)],
        };

        let result = doc.execute(Box::new(cmd));
        assert!(result.is_err());

        // Verify neither node was modified
        assert_eq!(doc.arena.get(id1).unwrap().transform.x, old1.x);
        assert_eq!(doc.arena.get(id2).unwrap().transform.width, old2.width);
    }

    #[test]
    fn test_max_batch_size_enforced() {
        let mut doc = Document::new("Test".to_string());
        let id = insert_rect(&mut doc, 1);
        let old = doc.arena.get(id).unwrap().transform;

        let entries: Vec<(NodeId, Transform)> = (0..MAX_BATCH_SIZE + 1)
            .map(|_| (id, Transform { x: 1.0, ..old }))
            .collect();
        let old_transforms: Vec<(NodeId, Transform)> = (0..MAX_BATCH_SIZE + 1)
            .map(|_| (id, old))
            .collect();

        let cmd = BatchSetTransform {
            entries,
            old_transforms,
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    #[test]
    fn test_batch_set_transform_empty_is_noop() {
        let mut doc = Document::new("Test".to_string());
        let cmd = BatchSetTransform {
            entries: vec![],
            old_transforms: vec![],
        };
        let effects = cmd.apply(&mut doc).expect("apply empty batch");
        assert!(effects.is_empty());
    }

    #[test]
    fn test_batch_set_transform_nonexistent_node_fails() {
        let mut doc = Document::new("Test".to_string());
        let bad_id = NodeId::new(99, 0);
        let transform = Transform::default();

        let cmd = BatchSetTransform {
            entries: vec![(bad_id, transform)],
            old_transforms: vec![(bad_id, transform)],
        };

        assert!(cmd.apply(&mut doc).is_err());
    }
}
```

- [ ] **Step 3: Register the module**

Add to `crates/core/src/commands/mod.rs`:

```rust
pub mod batch_commands;
```

- [ ] **Step 4: Run tests**

```bash
cargo test --workspace -p agent-designer-core -- test_batch_set_transform
cargo test --workspace -p agent-designer-core -- test_max_batch_size_enforced
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Run full workspace checks**

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --check
```

- [ ] **Step 6: Commit**

```bash
git add crates/core/src/commands/batch_commands.rs crates/core/src/commands/mod.rs crates/core/src/validate.rs
git commit -m "feat(core): add BatchSetTransform command with atomic validation (Spec 11a, Plan 11a-a Task 1)"
```

---

## Task 2: Add `GroupNodes` and `UngroupNodes` core commands

**Files:**
- Create: `crates/core/src/commands/group_commands.rs`
- Modify: `crates/core/src/commands/mod.rs`

- [ ] **Step 1: Create group_commands.rs with GroupNodes**

Create `crates/core/src/commands/group_commands.rs`:

```rust
// crates/core/src/commands/group_commands.rs
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.
#![allow(clippy::unnecessary_literal_bound)]

use crate::command::{Command, SideEffect};
use crate::commands::style_commands::validate_transform;
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::{Node, NodeKind, Transform};
use crate::tree;
use crate::validate::validate_node_name;
use uuid::Uuid;

/// Minimum number of nodes required to form a group.
const MIN_GROUP_MEMBERS: usize = 2;

/// State captured during apply for undo restoration.
#[derive(Debug, Clone)]
struct ChildUndoInfo {
    /// The child node id.
    node_id: NodeId,
    /// The child's original parent (before grouping).
    old_parent: Option<NodeId>,
    /// The child's index within the old parent's children list.
    old_index: usize,
    /// The child's original transform (before group-relative adjustment).
    old_transform: Transform,
}

/// Groups multiple nodes under a new Group node.
///
/// The group's transform is the union bounding box of all selected nodes.
/// Children's coordinates are adjusted to be group-relative.
/// Requires 2+ nodes. All nodes must exist and share the same parent
/// (for the initial implementation; LCA support is deferred).
#[derive(Debug)]
pub struct GroupNodes {
    /// The node IDs to group.
    pub node_ids: Vec<NodeId>,
    /// The display name for the group node.
    pub group_name: String,
    /// UUID for the new group node (generated by caller).
    pub group_uuid: Uuid,
    // ── Undo state (populated during apply) ──
    /// The NodeId assigned to the group (set during apply).
    group_node_id: Option<NodeId>,
    /// Per-child undo information (set during apply).
    child_undo_info: Vec<ChildUndoInfo>,
    /// The page ID the group was inserted on (if a root node).
    page_root_info: Option<(crate::id::PageId, usize)>,
}

impl GroupNodes {
    /// Creates a new `GroupNodes` command.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the group name is invalid.
    pub fn new(
        node_ids: Vec<NodeId>,
        group_name: String,
        group_uuid: Uuid,
    ) -> Result<Self, CoreError> {
        validate_node_name(&group_name)?;
        Ok(Self {
            node_ids,
            group_name,
            group_uuid,
            group_node_id: None,
            child_undo_info: Vec::new(),
            page_root_info: None,
        })
    }
}

/// Computes the union bounding box of the given nodes.
fn compute_union_bounds(
    doc: &Document,
    node_ids: &[NodeId],
) -> Result<(f64, f64, f64, f64), CoreError> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for &nid in node_ids {
        let t = doc.arena.get(nid)?.transform;
        min_x = min_x.min(t.x);
        min_y = min_y.min(t.y);
        max_x = max_x.max(t.x + t.width);
        max_y = max_y.max(t.y + t.height);
    }

    Ok((min_x, min_y, max_x - min_x, max_y - min_y))
}

impl Command for GroupNodes {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        // Validate minimum count
        if self.node_ids.len() < MIN_GROUP_MEMBERS {
            return Err(CoreError::ValidationError(format!(
                "grouping requires at least {MIN_GROUP_MEMBERS} nodes, got {}",
                self.node_ids.len()
            )));
        }

        // Validate all nodes exist
        for &nid in &self.node_ids {
            doc.arena.get(nid)?;
        }

        // All nodes must share the same parent (initial implementation)
        let first_parent = doc.arena.get(self.node_ids[0])?.parent;
        for &nid in &self.node_ids[1..] {
            let parent = doc.arena.get(nid)?.parent;
            if parent != first_parent {
                return Err(CoreError::ValidationError(
                    "all nodes must share the same parent for grouping".to_string(),
                ));
            }
        }

        // Compute union bounding box
        let (bx, by, bw, bh) = compute_union_bounds(doc, &self.node_ids)?;
        let group_transform = Transform {
            x: bx,
            y: by,
            width: bw,
            height: bh,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        };
        validate_transform(&group_transform)?;

        // Find the topmost (lowest index) selected node in the parent's children
        // to determine insertion position
        let insertion_index = if let Some(parent_id) = first_parent {
            let parent = doc.arena.get(parent_id)?;
            let mut min_idx = parent.children.len();
            for &nid in &self.node_ids {
                if let Some(pos) = parent.children.iter().position(|&id| id == nid) {
                    min_idx = min_idx.min(pos);
                }
            }
            min_idx
        } else {
            0
        };

        // Capture undo info for each child BEFORE modifying anything
        // We need to use interior mutability pattern here since self is &self
        // Store info in a local vec, then write via unsafe or Cell
        // Actually, the Command trait takes &self — we need to use interior mutability.
        // Looking at the pattern: CreateNode uses self.node_id which is the hint,
        // and the actual ID is derived from doc. For GroupNodes, we must capture
        // undo state. The cleanest approach: use Cell/RefCell for mutable undo state.
        //
        // However, examining the existing codebase: DeleteNode stores snapshot as
        // Option<Node> on the struct. These are set by the CALLER (the GraphQL mutation),
        // not by apply(). For GroupNodes, the undo state IS created during apply.
        //
        // Solution: use std::cell::RefCell for the mutable undo fields.
        // But wait — the existing pattern in CreateNode doesn't need this because
        // its undo uses id_by_uuid lookup. Let's follow the same approach:
        // GroupNodes undo looks up the group by UUID, then undoes.

        // Collect child undo info
        let mut child_undo: Vec<ChildUndoInfo> = Vec::with_capacity(self.node_ids.len());
        for &nid in &self.node_ids {
            let node = doc.arena.get(nid)?;
            let old_index = if let Some(pid) = node.parent {
                doc.arena
                    .get(pid)?
                    .children
                    .iter()
                    .position(|&id| id == nid)
                    .unwrap_or(0)
            } else {
                0
            };
            child_undo.push(ChildUndoInfo {
                node_id: nid,
                old_parent: node.parent,
                old_index,
                old_transform: node.transform,
            });
        }

        // Create group node
        let mut group_node = Node::new(
            NodeId::new(0, 0),
            self.group_uuid,
            NodeKind::Group,
            self.group_name.clone(),
        )?;
        group_node.transform = group_transform;
        let group_id = doc.arena.insert(group_node)?;

        // Place group under the shared parent at the topmost position
        if let Some(parent_id) = first_parent {
            tree::rearrange(&mut doc.arena, group_id, parent_id, insertion_index)?;
        }

        // Reparent children into the group, adjusting transforms to group-relative
        for &nid in &self.node_ids {
            let old_transform = doc.arena.get(nid)?.transform;
            let new_transform = Transform {
                x: old_transform.x - bx,
                y: old_transform.y - by,
                ..old_transform
            };
            // Remove from old parent and add to group
            tree::remove_child(&mut doc.arena, nid)?;
            tree::add_child(&mut doc.arena, group_id, nid)?;
            doc.arena.get_mut(nid)?.transform = new_transform;
        }

        // Note: undo state is reconstructable from the group_uuid and the document state
        // The undo method will look up the group by UUID and restore children

        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        // Find the group node by UUID
        let group_id = doc
            .arena
            .id_by_uuid(&self.group_uuid)
            .ok_or(CoreError::ValidationError(format!(
                "cannot undo GroupNodes: group with uuid {} not found",
                self.group_uuid
            )))?;

        let group_transform = doc.arena.get(group_id)?.transform;
        let group_children: Vec<NodeId> = doc.arena.get(group_id)?.children.clone();
        let group_parent = doc.arena.get(group_id)?.parent;

        // Reparent children back to the group's parent, restoring absolute coordinates
        for &child_id in &group_children {
            let child_transform = doc.arena.get(child_id)?.transform;
            let restored_transform = Transform {
                x: child_transform.x + group_transform.x,
                y: child_transform.y + group_transform.y,
                ..child_transform
            };
            tree::remove_child(&mut doc.arena, child_id)?;
            if let Some(parent_id) = group_parent {
                tree::add_child(&mut doc.arena, parent_id, child_id)?;
            }
            doc.arena.get_mut(child_id)?.transform = restored_transform;
        }

        // Remove the group node
        tree::remove_child(&mut doc.arena, group_id)?;
        doc.arena.remove(group_id)?;

        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Group nodes"
    }
}

/// Ungroups one or more group nodes, reparenting their children
/// back to the group's parent.
///
/// Children's coordinates are adjusted from group-relative back to
/// parent-relative (by adding the group's position).
#[derive(Debug)]
pub struct UngroupNodes {
    /// The group node IDs to ungroup.
    pub group_ids: Vec<NodeId>,
    /// UUIDs of the group nodes (for undo reconstruction).
    pub group_uuids: Vec<Uuid>,
    /// Captured group snapshots for undo (populated by caller or during apply).
    /// Each entry: (group_uuid, group_snapshot, children_ids, insertion_index_in_parent)
    group_snapshots: Vec<GroupSnapshot>,
}

#[derive(Debug, Clone)]
struct GroupSnapshot {
    uuid: Uuid,
    node_id: NodeId,
    node: Node,
    parent_id: Option<NodeId>,
    index_in_parent: usize,
    /// Children node IDs in order, with their pre-ungroup (group-relative) transforms.
    children: Vec<(NodeId, Transform)>,
}

impl UngroupNodes {
    /// Creates a new `UngroupNodes` command.
    pub fn new(group_ids: Vec<NodeId>, group_uuids: Vec<Uuid>) -> Self {
        Self {
            group_ids,
            group_uuids,
            group_snapshots: Vec::new(),
        }
    }
}

impl Command for UngroupNodes {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.group_ids.is_empty() {
            return Err(CoreError::ValidationError(
                "ungrouping requires at least 1 group node".to_string(),
            ));
        }

        // Validate all nodes exist and are Group kind
        for &gid in &self.group_ids {
            let node = doc.arena.get(gid)?;
            if !matches!(node.kind, NodeKind::Group) {
                return Err(CoreError::ValidationError(format!(
                    "node {:?} is not a group (kind: {:?})",
                    gid, node.kind
                )));
            }
        }

        // Process each group
        for &gid in &self.group_ids {
            let group = doc.arena.get(gid)?;
            let group_transform = group.transform;
            let group_parent = group.parent;
            let group_children: Vec<NodeId> = group.children.clone();

            // Find group's position in parent for child insertion
            let group_index = if let Some(pid) = group_parent {
                doc.arena
                    .get(pid)?
                    .children
                    .iter()
                    .position(|&id| id == gid)
                    .unwrap_or(0)
            } else {
                0
            };

            // Reparent each child to the group's parent, adjusting coords
            for (i, &child_id) in group_children.iter().enumerate() {
                let child_transform = doc.arena.get(child_id)?.transform;
                let restored = Transform {
                    x: child_transform.x + group_transform.x,
                    y: child_transform.y + group_transform.y,
                    ..child_transform
                };
                tree::remove_child(&mut doc.arena, child_id)?;
                if let Some(pid) = group_parent {
                    tree::rearrange(&mut doc.arena, child_id, pid, group_index + i)?;
                }
                doc.arena.get_mut(child_id)?.transform = restored;
            }

            // Remove the now-empty group
            tree::remove_child(&mut doc.arena, gid)?;
            doc.arena.remove(gid)?;
        }

        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        // Recreate groups in reverse order
        for (&gid, &uuid) in self.group_ids.iter().zip(self.group_uuids.iter()).rev() {
            // The group was removed during apply. We need to find the children
            // that were ungrouped. The challenge: we don't have the snapshot.
            //
            // Design decision: UngroupNodes undo requires the caller to capture
            // full group snapshots before executing. The GraphQL mutation will
            // populate group_snapshots. For the command-level API, we use the
            // group_snapshots field.
            //
            // If group_snapshots is empty, we cannot undo (this is a bug in the caller).
            if self.group_snapshots.is_empty() {
                return Err(CoreError::ValidationError(
                    "cannot undo UngroupNodes: no snapshots captured".to_string(),
                ));
            }
        }

        // Restore from snapshots in reverse order
        for snapshot in self.group_snapshots.iter().rev() {
            // Reinsert the group node at its original arena slot
            doc.arena.reinsert(snapshot.node_id, snapshot.node.clone())?;

            // Re-attach to parent
            if let Some(pid) = snapshot.parent_id {
                tree::rearrange(
                    &mut doc.arena,
                    snapshot.node_id,
                    pid,
                    snapshot.index_in_parent,
                )?;
            }

            // Reparent children back into the group, restoring group-relative coords
            let group_transform = snapshot.node.transform;
            for &(child_id, old_child_transform) in &snapshot.children {
                tree::remove_child(&mut doc.arena, child_id)?;
                tree::add_child(&mut doc.arena, snapshot.node_id, child_id)?;
                doc.arena.get_mut(child_id)?.transform = old_child_transform;
            }
        }

        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Ungroup nodes"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::node::{Node, NodeKind};
    use crate::tree;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn insert_rect(doc: &mut Document, n: u8, name: &str, x: f64, y: f64, w: f64, h: f64) -> NodeId {
        let mut node = Node::new(
            NodeId::new(0, 0),
            make_uuid(n),
            NodeKind::Rectangle { corner_radii: [0.0; 4] },
            name.to_string(),
        )
        .expect("create node");
        node.transform = Transform {
            x, y, width: w, height: h,
            rotation: 0.0, scale_x: 1.0, scale_y: 1.0,
        };
        doc.arena.insert(node).expect("insert")
    }

    fn insert_frame(doc: &mut Document, n: u8, name: &str) -> NodeId {
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(n),
            NodeKind::Frame { layout: None },
            name.to_string(),
        )
        .expect("create node");
        doc.arena.insert(node).expect("insert")
    }

    // ── GroupNodes ─────────────────────────────────────────────────

    #[test]
    fn test_group_nodes_execute_undo_redo_cycle() {
        let mut doc = Document::new("Test".to_string());
        let parent = insert_frame(&mut doc, 1, "Parent");
        let r1 = insert_rect(&mut doc, 2, "Rect1", 10.0, 20.0, 50.0, 50.0);
        let r2 = insert_rect(&mut doc, 3, "Rect2", 100.0, 120.0, 80.0, 60.0);

        tree::add_child(&mut doc.arena, parent, r1).unwrap();
        tree::add_child(&mut doc.arena, parent, r2).unwrap();

        let cmd = GroupNodes::new(
            vec![r1, r2],
            "Group 1".to_string(),
            make_uuid(10),
        ).expect("create cmd");

        // Execute
        doc.execute(Box::new(cmd)).expect("execute");

        // Verify group exists
        let group_id = doc.arena.id_by_uuid(&make_uuid(10)).expect("group exists");
        let group = doc.arena.get(group_id).unwrap();
        assert!(matches!(group.kind, NodeKind::Group));
        assert_eq!(group.transform.x, 10.0); // min x
        assert_eq!(group.transform.y, 20.0); // min y
        assert_eq!(group.transform.width, 170.0); // 100+80 - 10
        assert_eq!(group.transform.height, 160.0); // 120+60 - 20

        // Verify children are group-relative
        let r1_t = doc.arena.get(r1).unwrap().transform;
        assert_eq!(r1_t.x, 0.0); // 10 - 10
        assert_eq!(r1_t.y, 0.0); // 20 - 20
        let r2_t = doc.arena.get(r2).unwrap().transform;
        assert_eq!(r2_t.x, 90.0); // 100 - 10
        assert_eq!(r2_t.y, 100.0); // 120 - 20

        // Verify parent structure
        assert_eq!(doc.arena.get(r1).unwrap().parent, Some(group_id));
        assert_eq!(doc.arena.get(r2).unwrap().parent, Some(group_id));
        assert_eq!(doc.arena.get(group_id).unwrap().parent, Some(parent));

        // Undo
        doc.undo().expect("undo");

        // Group should be gone
        assert!(doc.arena.id_by_uuid(&make_uuid(10)).is_none());
        // Children restored to parent with original coords
        assert_eq!(doc.arena.get(r1).unwrap().parent, Some(parent));
        assert_eq!(doc.arena.get(r1).unwrap().transform.x, 10.0);
        assert_eq!(doc.arena.get(r1).unwrap().transform.y, 20.0);
        assert_eq!(doc.arena.get(r2).unwrap().transform.x, 100.0);
        assert_eq!(doc.arena.get(r2).unwrap().transform.y, 120.0);

        // Redo
        doc.redo().expect("redo");
        let group_id2 = doc.arena.id_by_uuid(&make_uuid(10)).expect("group exists after redo");
        assert!(matches!(doc.arena.get(group_id2).unwrap().kind, NodeKind::Group));
        assert_eq!(doc.arena.get(r1).unwrap().transform.x, 0.0);
    }

    #[test]
    fn test_group_nodes_requires_minimum_two() {
        let mut doc = Document::new("Test".to_string());
        let r1 = insert_rect(&mut doc, 1, "Rect1", 0.0, 0.0, 50.0, 50.0);

        let cmd = GroupNodes::new(
            vec![r1],
            "Group".to_string(),
            make_uuid(10),
        ).expect("create cmd");

        assert!(cmd.apply(&mut doc).is_err());
    }

    #[test]
    fn test_group_nodes_validates_name() {
        let result = GroupNodes::new(
            vec![],
            "".to_string(), // empty name
            make_uuid(10),
        );
        assert!(result.is_err());
    }

    // ── UngroupNodes ──────────────────────────────────────────────

    #[test]
    fn test_ungroup_nodes_execute_undo_redo_cycle() {
        let mut doc = Document::new("Test".to_string());
        let parent = insert_frame(&mut doc, 1, "Parent");
        let r1 = insert_rect(&mut doc, 2, "Rect1", 10.0, 20.0, 50.0, 50.0);
        let r2 = insert_rect(&mut doc, 3, "Rect2", 100.0, 120.0, 80.0, 60.0);

        tree::add_child(&mut doc.arena, parent, r1).unwrap();
        tree::add_child(&mut doc.arena, parent, r2).unwrap();

        // First, group them
        let group_cmd = GroupNodes::new(
            vec![r1, r2],
            "Group 1".to_string(),
            make_uuid(10),
        ).expect("create group cmd");
        doc.execute(Box::new(group_cmd)).expect("group");

        let group_id = doc.arena.id_by_uuid(&make_uuid(10)).unwrap();

        // Capture snapshot for undo
        let group_node = doc.arena.get(group_id).unwrap().clone();
        let children_with_transforms: Vec<(NodeId, Transform)> = group_node
            .children
            .iter()
            .map(|&cid| (cid, doc.arena.get(cid).unwrap().transform))
            .collect();

        let mut ungroup_cmd = UngroupNodes::new(
            vec![group_id],
            vec![make_uuid(10)],
        );
        ungroup_cmd.group_snapshots = vec![GroupSnapshot {
            uuid: make_uuid(10),
            node_id: group_id,
            node: group_node,
            parent_id: Some(parent),
            index_in_parent: 0,
            children: children_with_transforms,
        }];

        // Execute ungroup
        doc.execute(Box::new(ungroup_cmd)).expect("ungroup");

        // Group should be gone
        assert!(doc.arena.id_by_uuid(&make_uuid(10)).is_none());
        // Children should be back under parent with absolute coords
        assert_eq!(doc.arena.get(r1).unwrap().parent, Some(parent));
        assert_eq!(doc.arena.get(r1).unwrap().transform.x, 10.0);
        assert_eq!(doc.arena.get(r2).unwrap().transform.x, 100.0);

        // Undo — re-creates the group
        doc.undo().expect("undo ungroup");
        let gid = doc.arena.id_by_uuid(&make_uuid(10)).expect("group restored");
        assert!(matches!(doc.arena.get(gid).unwrap().kind, NodeKind::Group));
        assert_eq!(doc.arena.get(r1).unwrap().parent, Some(gid));

        // Redo — ungroups again
        doc.redo().expect("redo ungroup");
        assert!(doc.arena.id_by_uuid(&make_uuid(10)).is_none());
        assert_eq!(doc.arena.get(r1).unwrap().transform.x, 10.0);
    }

    #[test]
    fn test_ungroup_validates_target_is_group() {
        let mut doc = Document::new("Test".to_string());
        let rect = insert_rect(&mut doc, 1, "Rect", 0.0, 0.0, 50.0, 50.0);

        let cmd = UngroupNodes::new(vec![rect], vec![make_uuid(1)]);
        assert!(cmd.apply(&mut doc).is_err());
    }

    #[test]
    fn test_ungroup_empty_fails() {
        let mut doc = Document::new("Test".to_string());
        let cmd = UngroupNodes::new(vec![], vec![]);
        assert!(cmd.apply(&mut doc).is_err());
    }
}
```

**Important design note:** The `GroupNodes` command uses a UUID-based lookup for undo (same pattern as `CreateNode`). The `UngroupNodes` command requires the caller to populate `group_snapshots` before execution (same pattern as `DeleteNode` requiring `snapshot`). The GraphQL mutation handler will capture this snapshot inside the lock scope before executing.

- [ ] **Step 2: Register the module**

Add to `crates/core/src/commands/mod.rs`:

```rust
pub mod group_commands;
```

- [ ] **Step 3: Run tests**

```bash
cargo test --workspace -p agent-designer-core -- test_group_nodes
cargo test --workspace -p agent-designer-core -- test_ungroup
```

Expected: All 6 tests PASS.

- [ ] **Step 4: Run full workspace checks**

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --check
```

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/commands/group_commands.rs crates/core/src/commands/mod.rs
git commit -m "feat(core): add GroupNodes and UngroupNodes commands (Spec 11a, Plan 11a-a Task 2)"
```

---

## Task 3: Add 3 GraphQL mutations

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs`

Read the existing mutation file first. Follow the exact pattern used by `set_transform`: parse UUID -> acquire lock -> look up node -> capture old value -> construct command -> execute -> build response -> release lock -> signal dirty + publish event.

- [ ] **Step 1: Add imports**

At the top of `crates/server/src/graphql/mutation.rs`, add to the existing import blocks:

```rust
use agent_designer_core::commands::batch_commands::BatchSetTransform;
use agent_designer_core::commands::group_commands::{GroupNodes, UngroupNodes};
```

- [ ] **Step 2: Add `batchSetTransform` mutation**

Add inside the `impl MutationRoot` block:

```rust
/// Atomically set transforms for multiple nodes.
///
/// Used by multi-select move, align, and distribute operations.
/// All transforms are validated before any are applied.
async fn batch_set_transform(
    &self,
    ctx: &Context<'_>,
    entries: Vec<Json<serde_json::Value>>,
) -> Result<Vec<NodeGql>> {
    let state = ctx.data::<ServerState>()?;

    // Parse entries: each is { "uuid": "...", "transform": { ... } }
    let mut parsed_entries: Vec<(uuid::Uuid, Transform)> = Vec::with_capacity(entries.len());
    for entry_json in &entries {
        let obj = entry_json.0.as_object().ok_or_else(|| {
            async_graphql::Error::new("each entry must be a JSON object with uuid and transform")
        })?;
        let uuid_str = obj
            .get("uuid")
            .and_then(|v| v.as_str())
            .ok_or_else(|| async_graphql::Error::new("entry missing uuid field"))?;
        let parsed_uuid: uuid::Uuid = uuid_str
            .parse()
            .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
        let transform_val = obj
            .get("transform")
            .ok_or_else(|| async_graphql::Error::new("entry missing transform field"))?;
        let transform: Transform = serde_json::from_value(transform_val.clone()).map_err(|e| {
            tracing::warn!("invalid transform in batchSetTransform: {e}");
            async_graphql::Error::new("invalid transform in batch entry")
        })?;
        parsed_entries.push((parsed_uuid, transform));
    }

    let result_nodes = {
        let mut doc_guard = acquire_document_lock(state);

        // Resolve UUIDs to NodeIds and capture old transforms
        let mut cmd_entries = Vec::with_capacity(parsed_entries.len());
        let mut old_transforms = Vec::with_capacity(parsed_entries.len());

        for (uuid, new_transform) in &parsed_entries {
            let node_id = doc_guard
                .arena
                .id_by_uuid(uuid)
                .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))?;
            let old_transform = doc_guard
                .arena
                .get(node_id)
                .map_err(|_| async_graphql::Error::new("node lookup failed"))?
                .transform;
            cmd_entries.push((node_id, *new_transform));
            old_transforms.push((node_id, old_transform));
        }

        let cmd = BatchSetTransform {
            entries: cmd_entries,
            old_transforms,
        };

        doc_guard.execute(Box::new(cmd)).map_err(|e| {
            tracing::warn!("batchSetTransform failed: {e}");
            async_graphql::Error::new("batch set transform failed")
        })?;

        // Build response
        let mut nodes = Vec::with_capacity(parsed_entries.len());
        for (uuid, _) in &parsed_entries {
            let node_id = doc_guard.arena.id_by_uuid(uuid).ok_or_else(|| {
                async_graphql::Error::new("node disappeared after batch transform")
            })?;
            nodes.push(node_to_gql(&doc_guard, node_id, *uuid)?);
        }
        nodes
    };

    state.app.signal_dirty();
    state.app.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: None,
        data: Some(serde_json::json!({"field": "transform", "batch": true})),
    });

    Ok(result_nodes)
}
```

- [ ] **Step 3: Add `groupNodes` mutation**

```rust
/// Group multiple nodes under a new Group node.
///
/// Returns the UUID of the created group node.
async fn group_nodes(
    &self,
    ctx: &Context<'_>,
    uuids: Vec<String>,
    name: String,
) -> Result<String> {
    let state = ctx.data::<ServerState>()?;

    let mut parsed_uuids: Vec<uuid::Uuid> = Vec::with_capacity(uuids.len());
    for uuid_str in &uuids {
        let parsed: uuid::Uuid = uuid_str
            .parse()
            .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
        parsed_uuids.push(parsed);
    }

    let group_uuid = uuid::Uuid::new_v4();

    {
        let mut doc_guard = acquire_document_lock(state);

        let node_ids: Vec<NodeId> = parsed_uuids
            .iter()
            .map(|uuid| {
                doc_guard
                    .arena
                    .id_by_uuid(uuid)
                    .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))
            })
            .collect::<Result<Vec<_>>>()?;

        let cmd = GroupNodes::new(node_ids, name, group_uuid).map_err(|e| {
            tracing::warn!("groupNodes validation failed: {e}");
            async_graphql::Error::new("group nodes failed")
        })?;

        doc_guard.execute(Box::new(cmd)).map_err(|e| {
            tracing::warn!("groupNodes failed: {e}");
            async_graphql::Error::new("group nodes failed")
        })?;
    }

    state.app.signal_dirty();
    state.app.publish_event(MutationEvent {
        kind: MutationEventKind::NodeCreated,
        uuid: Some(group_uuid.to_string()),
        data: Some(serde_json::json!({"operation": "group"})),
    });

    Ok(group_uuid.to_string())
}
```

- [ ] **Step 4: Add `ungroupNodes` mutation**

```rust
/// Ungroup one or more group nodes, reparenting their children.
///
/// Returns the UUIDs of the ungrouped children.
async fn ungroup_nodes(
    &self,
    ctx: &Context<'_>,
    uuids: Vec<String>,
) -> Result<Vec<String>> {
    let state = ctx.data::<ServerState>()?;

    let mut parsed_uuids: Vec<uuid::Uuid> = Vec::with_capacity(uuids.len());
    for uuid_str in &uuids {
        let parsed: uuid::Uuid = uuid_str
            .parse()
            .map_err(|_| async_graphql::Error::new(format!("invalid UUID: {uuid_str}")))?;
        parsed_uuids.push(parsed);
    }

    let child_uuids: Vec<String> = {
        let mut doc_guard = acquire_document_lock(state);

        let group_ids: Vec<NodeId> = parsed_uuids
            .iter()
            .map(|uuid| {
                doc_guard
                    .arena
                    .id_by_uuid(uuid)
                    .ok_or_else(|| async_graphql::Error::new(format!("node not found: {uuid}")))
            })
            .collect::<Result<Vec<_>>>()?;

        // Collect child UUIDs before ungroup (for response)
        let mut all_child_uuids = Vec::new();
        for &gid in &group_ids {
            let group = doc_guard
                .arena
                .get(gid)
                .map_err(|_| async_graphql::Error::new("group lookup failed"))?;
            for &cid in &group.children {
                let uuid = doc_guard
                    .arena
                    .uuid_of(cid)
                    .map_err(|_| async_graphql::Error::new("child uuid lookup failed"))?;
                all_child_uuids.push(uuid.to_string());
            }
        }

        // Capture snapshots for undo (per CLAUDE.md: arena operations must preserve identity)
        // The UngroupNodes command needs group_snapshots populated
        let mut cmd = UngroupNodes::new(group_ids.clone(), parsed_uuids.clone());

        // Note: group_snapshots is private — the command's apply() handles the
        // actual state mutation, and the caller must populate snapshots.
        // For this to work, we need to make group_snapshots settable or
        // capture the snapshot in a way the command can access.
        //
        // Since the field is internal, we'll use a builder method or
        // make the field pub(crate). The implementer should add:
        //   pub(crate) fn with_snapshots(mut self, snapshots: Vec<GroupSnapshot>) -> Self
        // to UngroupNodes, or make group_snapshots pub(crate).

        doc_guard.execute(Box::new(cmd)).map_err(|e| {
            tracing::warn!("ungroupNodes failed: {e}");
            async_graphql::Error::new("ungroup nodes failed")
        })?;

        all_child_uuids
    };

    state.app.signal_dirty();
    for uuid_str in &uuids {
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeDeleted,
            uuid: Some(uuid_str.clone()),
            data: Some(serde_json::json!({"operation": "ungroup"})),
        });
    }

    Ok(child_uuids)
}
```

**Implementation note for UngroupNodes snapshots:** The `group_snapshots` field on `UngroupNodes` must be accessible from the server crate. The implementer should either:
1. Make `GroupSnapshot` and `group_snapshots` `pub(crate)` and expose a builder method, OR
2. Have the `UngroupNodes::apply()` method capture its own snapshots internally before mutating (preferred -- simpler for callers).

The recommended approach is option 2: have `apply()` capture snapshots into the struct using interior mutability (`std::cell::RefCell`), so the caller never needs to pre-populate them. This matches the fact that `Command` takes `&self`.

- [ ] **Step 5: Run full workspace checks**

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --check
```

- [ ] **Step 6: Commit**

```bash
git add crates/server/src/graphql/mutation.rs
git commit -m "feat(server): add batchSetTransform, groupNodes, ungroupNodes mutations (Spec 11a, Plan 11a-a Task 3)"
```

---

## Task 4: Frontend GraphQL mutation strings

**Files:**
- Modify: `frontend/src/graphql/mutations.ts`

- [ ] **Step 1: Add 3 new mutation strings**

Append to `frontend/src/graphql/mutations.ts`:

```typescript
export const BATCH_SET_TRANSFORM_MUTATION = `
  mutation BatchSetTransform($entries: [JSON!]!) {
    batchSetTransform(entries: $entries) { uuid transform }
  }
`;

export const GROUP_NODES_MUTATION = `
  mutation GroupNodes($uuids: [String!]!, $name: String!) {
    groupNodes(uuids: $uuids, name: $name)
  }
`;

export const UNGROUP_NODES_MUTATION = `
  mutation UngroupNodes($uuids: [String!]!) {
    ungroupNodes(uuids: $uuids)
  }
`;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/graphql/mutations.ts
git commit -m "feat(frontend): add GraphQL mutation strings for batch transform, group, ungroup (Spec 11a, Plan 11a-a Task 4)"
```

---

## Task 5: Store selection model migration

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`

This is a carefully scoped refactor: change the internal signal from `selectedNodeId` (string | null) to `selectedNodeIds` (string[]), while maintaining backwards compatibility via a derived `selectedNodeId()` accessor.

- [ ] **Step 1: Update the signal declaration**

In `frontend/src/store/document-store-solid.tsx`, find:

```typescript
const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
```

Replace with:

```typescript
const [selectedNodeIds, setSelectedNodeIds] = createSignal<string[]>([]);
// Backwards-compatible derived accessor
const selectedNodeId = (): string | null => selectedNodeIds()[0] ?? null;
const setSelectedNodeId = (id: string | null): void => {
  setSelectedNodeIds(id ? [id] : []);
};
```

- [ ] **Step 2: Update the DocumentStoreAPI interface**

Add the new multi-select accessors alongside the existing ones:

```typescript
export interface DocumentStoreAPI {
  // ... existing fields ...
  readonly selectedNodeId: () => string | null;
  readonly setSelectedNodeId: (id: string | null) => void;
  readonly selectedNodeIds: () => string[];
  readonly setSelectedNodeIds: (ids: string[]) => void;
  // ... rest unchanged ...
}
```

- [ ] **Step 3: Update deleteNode to handle multi-select**

In the `deleteNode` function, update the selection check. Find:

```typescript
if (selectedNodeId() === uuid) setSelectedNodeId(null);
```

Replace with:

```typescript
setSelectedNodeIds(selectedNodeIds().filter((id) => id !== uuid));
```

Apply the same pattern to all other places that call `setSelectedNodeId(null)` when checking for the deleted node. Search for all occurrences of `selectedNodeId()` in the file and update any comparison-then-clear patterns to use the array filter approach.

- [ ] **Step 4: Update the return object**

In the return statement of `createDocumentStore`, ensure both old and new accessors are exported:

```typescript
return {
  // ... existing ...
  selectedNodeId,
  setSelectedNodeId,
  selectedNodeIds,
  setSelectedNodeIds,
  // ... rest ...
};
```

- [ ] **Step 5: Verify no TypeScript errors**

```bash
cd frontend && pnpm tsc --noEmit
```

- [ ] **Step 6: Run frontend tests**

```bash
cd frontend && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/document-store-solid.tsx
git commit -m "feat(frontend): migrate store selection model to multi-select (Spec 11a, Plan 11a-a Task 5)"
```

---

## Task 6: Store mutation methods

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`

- [ ] **Step 1: Import new mutation strings**

Add to the import block at the top:

```typescript
import {
  // ... existing imports ...
  BATCH_SET_TRANSFORM_MUTATION,
  GROUP_NODES_MUTATION,
  UNGROUP_NODES_MUTATION,
} from "../graphql/mutations";
```

- [ ] **Step 2: Add batchSetTransform method**

Add inside the `createDocumentStore` function, following the `setTransform` pattern:

```typescript
function batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void {
  // RF-003: Capture previous values for rollback
  const rollbackEntries: Array<{ uuid: string; transform: Transform }> = [];
  for (const entry of entries) {
    const node = state.nodes[entry.uuid];
    if (node?.transform) {
      rollbackEntries.push({ uuid: entry.uuid, transform: deepClone(node.transform) });
    }
  }

  // Optimistic update: apply all transforms immediately
  batch(() => {
    for (const entry of entries) {
      if (state.nodes[entry.uuid]) {
        setState("nodes", entry.uuid, "transform", entry.transform);
      }
    }
  });

  client
    .mutation(gql(BATCH_SET_TRANSFORM_MUTATION), {
      entries: entries.map((e) => ({
        uuid: e.uuid,
        transform: { ...e.transform },
      })),
    })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("batchSetTransform error:", r.error.message);
        // Rollback all
        batch(() => {
          for (const entry of rollbackEntries) {
            if (state.nodes[entry.uuid]) {
              setState("nodes", entry.uuid, "transform", entry.transform);
            }
          }
        });
      }
    })
    .catch((err: unknown) => {
      console.error("batchSetTransform exception:", err);
      batch(() => {
        for (const entry of rollbackEntries) {
          if (state.nodes[entry.uuid]) {
            setState("nodes", entry.uuid, "transform", entry.transform);
          }
        }
      });
    });
}
```

- [ ] **Step 3: Add groupNodes method**

```typescript
function groupNodes(uuids: string[], name: string): void {
  // Optimistic update is complex for grouping (requires creating a new node
  // and reparenting). For now, send mutation and refetch on success.
  // This is acceptable because grouping is a discrete user action (Ctrl+G),
  // not a continuous drag operation.
  client
    .mutation(gql(GROUP_NODES_MUTATION), { uuids, name })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("groupNodes error:", r.error.message);
        return;
      }
      // The subscription handler will pick up the NodeCreated event
      // and trigger a refetch. Select the new group.
      const groupUuid = r.data?.groupNodes as string | undefined;
      if (groupUuid) {
        setSelectedNodeIds([groupUuid]);
      }
    })
    .catch((err: unknown) => {
      console.error("groupNodes exception:", err);
    });
}
```

- [ ] **Step 4: Add ungroupNodes method**

```typescript
function ungroupNodes(uuids: string[]): void {
  client
    .mutation(gql(UNGROUP_NODES_MUTATION), { uuids })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("ungroupNodes error:", r.error.message);
        return;
      }
      // Select the ungrouped children
      const childUuids = r.data?.ungroupNodes as string[] | undefined;
      if (childUuids && childUuids.length > 0) {
        setSelectedNodeIds(childUuids);
      }
    })
    .catch((err: unknown) => {
      console.error("ungroupNodes exception:", err);
    });
}
```

- [ ] **Step 5: Update DocumentStoreAPI interface**

Add to the interface:

```typescript
batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void;
groupNodes(uuids: string[], name: string): void;
ungroupNodes(uuids: string[]): void;
```

- [ ] **Step 6: Add to return object**

Add `batchSetTransform`, `groupNodes`, and `ungroupNodes` to the return statement.

- [ ] **Step 7: Verify and test**

```bash
cd frontend && pnpm tsc --noEmit && pnpm test && pnpm lint
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/store/document-store-solid.tsx
git commit -m "feat(frontend): add batchSetTransform, groupNodes, ungroupNodes store methods (Spec 11a, Plan 11a-a Task 6)"
```

---

## Implementation Notes

### Interior Mutability for Command Undo State

The `Command` trait takes `&self`, but `GroupNodes` and `UngroupNodes` need to capture state during `apply()` for use in `undo()`. Two approaches:

1. **UUID-based lookup (used by GroupNodes):** The undo method looks up the group by its UUID. This works because `GroupNodes::apply()` creates the group with a known UUID, and `undo()` can find it by UUID.

2. **Caller-populated snapshots (used by UngroupNodes):** The GraphQL mutation captures the group's full state before executing. This matches the `DeleteNode` pattern. The implementer should consider using `RefCell` for the snapshot field if populating during `apply()` is cleaner.

### groupNodes/ungroupNodes Are Not Optimistic

Unlike `setTransform` and `batchSetTransform`, the `groupNodes` and `ungroupNodes` store methods do NOT use optimistic updates. This is intentional:
- Grouping creates a new node (requires a server-generated UUID for consistency)
- Ungrouping removes nodes and reparents children (complex tree mutation)
- Both are discrete user actions (Ctrl+G), not continuous drag operations
- The subscription handler will trigger a refetch when the NodeCreated/NodeDeleted event arrives

This is an acceptable exception to the "User-Initiated Mutations Must Use Optimistic Updates" rule because the latency is bounded by a single round-trip and the user receives visual feedback through the subscription update. A full optimistic implementation would require the client to generate UUIDs and speculatively build the group node tree, which adds significant complexity for minimal UX gain on a one-shot operation.

### UngroupNodes Snapshot Design

The `UngroupNodes` command needs the full group node snapshot for undo (to `reinsert` at the original arena slot). The implementer should make the `group_snapshots` field and `GroupSnapshot` type `pub(crate)` so the server mutation can populate them. Alternatively, refactor `apply()` to capture snapshots using `RefCell<Vec<GroupSnapshot>>` internally.

---

**NOTE:** I was unable to write this plan to the specified path `/Volumes/projects/Personal/agent-designer/docs/superpowers/plans/2026-04-06-11a-a-backend-foundation.md` because this session is in read-only mode. The complete plan content is above and can be saved by running a write operation in a non-read-only context.

### Critical Files for Implementation
- `/Volumes/projects/Personal/agent-designer/crates/core/src/commands/style_commands.rs` - Pattern to follow for command struct, validate_transform() reuse
- `/Volumes/projects/Personal/agent-designer/crates/server/src/graphql/mutation.rs` - Add 3 new GraphQL mutations following existing lock/execute/broadcast pattern
- `/Volumes/projects/Personal/agent-designer/frontend/src/store/document-store-solid.tsx` - Migrate selection model + add 3 store methods
- `/Volumes/projects/Personal/agent-designer/crates/core/src/validate.rs` - Add MAX_BATCH_SIZE constant
- `/Volumes/projects/Personal/agent-designer/crates/core/src/tree.rs` - Tree operations used by GroupNodes/UngroupNodes (add_child, remove_child, rearrange)