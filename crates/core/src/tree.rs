// crates/core/src/tree.rs

use crate::arena::Arena;
use crate::error::{CoreError, NodeId};
use crate::validate::MAX_CHILDREN_PER_NODE;

/// Adds `child_id` as the last child of `parent_id`.
///
/// Updates both the parent's `children` vec and the child's `parent` field.
/// Validates that adding the child would not create a cycle and would not
/// exceed the maximum children limit.
///
/// # Errors
/// - `CoreError::CycleDetected` if `parent_id` is a descendant of `child_id`.
/// - `CoreError::ValidationError` if the parent would exceed max children.
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn add_child(arena: &mut Arena, parent_id: NodeId, child_id: NodeId) -> Result<(), CoreError> {
    // Validate both nodes exist
    arena.get(parent_id)?;
    arena.get(child_id)?;

    // Cannot add a node as its own child
    if parent_id == child_id {
        return Err(CoreError::CycleDetected(child_id, parent_id));
    }

    // Cycle detection: walk up from parent_id; if we reach child_id, it's a cycle
    if is_ancestor(arena, child_id, parent_id)? {
        return Err(CoreError::CycleDetected(child_id, parent_id));
    }

    // Check children limit
    let parent = arena.get(parent_id)?;
    if parent.children.len() >= MAX_CHILDREN_PER_NODE {
        return Err(CoreError::ValidationError(format!(
            "parent node already has {MAX_CHILDREN_PER_NODE} children (maximum)"
        )));
    }

    // Remove from old parent if any
    let old_parent = arena.get(child_id)?.parent;
    if let Some(old_parent_id) = old_parent {
        if old_parent_id == parent_id {
            // Already a child of this parent — just return Ok
            let parent_node = arena.get(parent_id)?;
            if parent_node.children.contains(&child_id) {
                return Ok(());
            }
        } else {
            let old_parent_node = arena.get_mut(old_parent_id)?;
            old_parent_node.children.retain(|id| *id != child_id);
        }
    }

    // Set child's parent
    arena.get_mut(child_id)?.parent = Some(parent_id);

    // Add to parent's children (only if not already there)
    let parent_node = arena.get_mut(parent_id)?;
    if !parent_node.children.contains(&child_id) {
        parent_node.children.push(child_id);
    }

    Ok(())
}

/// Removes `child_id` from its parent's children list and clears its parent field.
///
/// Does nothing if the node has no parent.
///
/// # Errors
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn remove_child(arena: &mut Arena, child_id: NodeId) -> Result<(), CoreError> {
    let parent_id = arena.get(child_id)?.parent;

    if let Some(parent_id) = parent_id {
        let parent = arena.get_mut(parent_id)?;
        parent.children.retain(|id| *id != child_id);
        arena.get_mut(child_id)?.parent = None;
    }

    Ok(())
}

/// Moves `child_id` to a specific position within its current parent's children list,
/// or within a new parent's children list.
///
/// `new_parent_id` — the parent to move under (can be the same parent for reordering).
/// `position` — the index at which to insert. Clamped to `children.len()`.
///
/// # Errors
/// - `CoreError::CycleDetected` if the move would create a cycle.
/// - `CoreError::ValidationError` if the new parent would exceed max children.
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn rearrange(
    arena: &mut Arena,
    child_id: NodeId,
    new_parent_id: NodeId,
    position: usize,
) -> Result<(), CoreError> {
    // Validate
    arena.get(new_parent_id)?;
    arena.get(child_id)?;

    if child_id == new_parent_id {
        return Err(CoreError::CycleDetected(child_id, new_parent_id));
    }

    if is_ancestor(arena, child_id, new_parent_id)? {
        return Err(CoreError::CycleDetected(child_id, new_parent_id));
    }

    let old_parent_id = arena.get(child_id)?.parent;

    // Remove from old parent
    if let Some(old_pid) = old_parent_id {
        let old_parent = arena.get_mut(old_pid)?;
        old_parent.children.retain(|id| *id != child_id);
    }

    // Check children limit (if moving to a new parent)
    let is_same_parent = old_parent_id == Some(new_parent_id);
    if !is_same_parent {
        let new_parent = arena.get(new_parent_id)?;
        if new_parent.children.len() >= MAX_CHILDREN_PER_NODE {
            // Restore old parent if we already removed
            if let Some(old_pid) = old_parent_id {
                arena.get_mut(old_pid)?.children.push(child_id);
            }
            arena.get_mut(child_id)?.parent = old_parent_id;
            return Err(CoreError::ValidationError(format!(
                "parent node already has {MAX_CHILDREN_PER_NODE} children (maximum)"
            )));
        }
    }

    // Set child's new parent
    arena.get_mut(child_id)?.parent = Some(new_parent_id);

    // Insert at position
    let new_parent = arena.get_mut(new_parent_id)?;
    let clamped_pos = position.min(new_parent.children.len());
    new_parent.children.insert(clamped_pos, child_id);

    Ok(())
}

/// Returns `true` if `ancestor_id` is an ancestor of `node_id`.
///
/// Walks up the parent chain from `node_id`. Does NOT consider a node
/// to be its own ancestor.
///
/// # Errors
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn is_ancestor(arena: &Arena, ancestor_id: NodeId, node_id: NodeId) -> Result<bool, CoreError> {
    let mut current = arena.get(node_id)?.parent;
    while let Some(pid) = current {
        if pid == ancestor_id {
            return Ok(true);
        }
        current = arena.get(pid)?.parent;
    }
    Ok(false)
}

/// Returns a list of node IDs from root to `node_id` (inclusive).
///
/// # Errors
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn ancestors(arena: &Arena, node_id: NodeId) -> Result<Vec<NodeId>, CoreError> {
    let mut path = vec![node_id];
    let mut current = arena.get(node_id)?.parent;
    while let Some(pid) = current {
        path.push(pid);
        current = arena.get(pid)?.parent;
    }
    path.reverse();
    Ok(path)
}

/// Returns all descendant node IDs of `root_id` in depth-first pre-order.
/// Does NOT include `root_id` itself.
///
/// # Errors
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn descendants(arena: &Arena, root_id: NodeId) -> Result<Vec<NodeId>, CoreError> {
    let mut result = Vec::new();
    let mut stack: Vec<NodeId> = arena.get(root_id)?.children.iter().rev().copied().collect();

    while let Some(current) = stack.pop() {
        result.push(current);
        let node = arena.get(current)?;
        for child_id in node.children.iter().rev() {
            stack.push(*child_id);
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::{Node, NodeKind};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn insert_group(arena: &mut Arena, uuid: Uuid, name: &str) -> NodeId {
        let node = Node::new(NodeId::new(0, 0), uuid, NodeKind::Group, name.to_string());
        arena.insert(node).expect("insert")
    }

    // ── add_child ──────────────────────────────────────────────────────

    #[test]
    fn test_add_child_sets_parent_and_children() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        add_child(&mut arena, parent, child).expect("add_child");

        assert_eq!(arena.get(child).expect("get").parent, Some(parent));
        assert_eq!(arena.get(parent).expect("get").children, vec![child]);
    }

    #[test]
    fn test_add_child_multiple_children() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child1 = insert_group(&mut arena, make_uuid(2), "Child1");
        let child2 = insert_group(&mut arena, make_uuid(3), "Child2");

        add_child(&mut arena, parent, child1).expect("add_child");
        add_child(&mut arena, parent, child2).expect("add_child");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children, vec![child1, child2]);
    }

    #[test]
    fn test_add_child_reparents_from_old_parent() {
        let mut arena = Arena::new(100);
        let parent1 = insert_group(&mut arena, make_uuid(1), "Parent1");
        let parent2 = insert_group(&mut arena, make_uuid(2), "Parent2");
        let child = insert_group(&mut arena, make_uuid(3), "Child");

        add_child(&mut arena, parent1, child).expect("add_child");
        add_child(&mut arena, parent2, child).expect("add_child");

        assert_eq!(arena.get(child).expect("get").parent, Some(parent2));
        assert!(arena.get(parent1).expect("get").children.is_empty());
        assert_eq!(arena.get(parent2).expect("get").children, vec![child]);
    }

    #[test]
    fn test_add_child_cycle_self() {
        let mut arena = Arena::new(100);
        let node = insert_group(&mut arena, make_uuid(1), "Node");
        let result = add_child(&mut arena, node, node);
        assert!(matches!(result, Err(CoreError::CycleDetected(_, _))));
    }

    #[test]
    fn test_add_child_cycle_indirect() {
        let mut arena = Arena::new(100);
        let a = insert_group(&mut arena, make_uuid(1), "A");
        let b = insert_group(&mut arena, make_uuid(2), "B");
        let c = insert_group(&mut arena, make_uuid(3), "C");

        add_child(&mut arena, a, b).expect("add_child");
        add_child(&mut arena, b, c).expect("add_child");

        // Trying to make A a child of C would create a cycle: C -> A -> B -> C
        let result = add_child(&mut arena, c, a);
        assert!(matches!(result, Err(CoreError::CycleDetected(_, _))));
    }

    #[test]
    fn test_add_child_already_child_is_idempotent() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        add_child(&mut arena, parent, child).expect("add_child");
        add_child(&mut arena, parent, child).expect("add_child again");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children.len(), 1);
    }

    #[test]
    fn test_add_child_nonexistent_parent() {
        let mut arena = Arena::new(100);
        let child = insert_group(&mut arena, make_uuid(1), "Child");
        let fake_parent = NodeId::new(99, 0);
        let result = add_child(&mut arena, fake_parent, child);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_child_nonexistent_child() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let fake_child = NodeId::new(99, 0);
        let result = add_child(&mut arena, parent, fake_child);
        assert!(result.is_err());
    }

    // ── remove_child ───────────────────────────────────────────────────

    #[test]
    fn test_remove_child_clears_parent_and_children() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        add_child(&mut arena, parent, child).expect("add_child");
        remove_child(&mut arena, child).expect("remove_child");

        assert!(arena.get(child).expect("get").parent.is_none());
        assert!(arena.get(parent).expect("get").children.is_empty());
    }

    #[test]
    fn test_remove_child_no_parent_is_noop() {
        let mut arena = Arena::new(100);
        let node = insert_group(&mut arena, make_uuid(1), "Node");
        remove_child(&mut arena, node).expect("remove_child");
        assert!(arena.get(node).expect("get").parent.is_none());
    }

    #[test]
    fn test_remove_child_preserves_siblings() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child1 = insert_group(&mut arena, make_uuid(2), "Child1");
        let child2 = insert_group(&mut arena, make_uuid(3), "Child2");
        let child3 = insert_group(&mut arena, make_uuid(4), "Child3");

        add_child(&mut arena, parent, child1).expect("add_child");
        add_child(&mut arena, parent, child2).expect("add_child");
        add_child(&mut arena, parent, child3).expect("add_child");

        remove_child(&mut arena, child2).expect("remove_child");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children, vec![child1, child3]);
    }

    // ── rearrange ──────────────────────────────────────────────────────

    #[test]
    fn test_rearrange_within_same_parent() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child1 = insert_group(&mut arena, make_uuid(2), "Child1");
        let child2 = insert_group(&mut arena, make_uuid(3), "Child2");
        let child3 = insert_group(&mut arena, make_uuid(4), "Child3");

        add_child(&mut arena, parent, child1).expect("add_child");
        add_child(&mut arena, parent, child2).expect("add_child");
        add_child(&mut arena, parent, child3).expect("add_child");

        // Move child3 to position 0
        rearrange(&mut arena, child3, parent, 0).expect("rearrange");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children, vec![child3, child1, child2]);
    }

    #[test]
    fn test_rearrange_to_different_parent() {
        let mut arena = Arena::new(100);
        let parent1 = insert_group(&mut arena, make_uuid(1), "Parent1");
        let parent2 = insert_group(&mut arena, make_uuid(2), "Parent2");
        let child = insert_group(&mut arena, make_uuid(3), "Child");

        add_child(&mut arena, parent1, child).expect("add_child");
        rearrange(&mut arena, child, parent2, 0).expect("rearrange");

        assert!(arena.get(parent1).expect("get").children.is_empty());
        assert_eq!(arena.get(parent2).expect("get").children, vec![child]);
        assert_eq!(arena.get(child).expect("get").parent, Some(parent2));
    }

    #[test]
    fn test_rearrange_cycle_detection() {
        let mut arena = Arena::new(100);
        let a = insert_group(&mut arena, make_uuid(1), "A");
        let b = insert_group(&mut arena, make_uuid(2), "B");

        add_child(&mut arena, a, b).expect("add_child");

        let result = rearrange(&mut arena, a, b, 0);
        assert!(matches!(result, Err(CoreError::CycleDetected(_, _))));
    }

    #[test]
    fn test_rearrange_position_clamped() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        // Position 999 should be clamped to end
        rearrange(&mut arena, child, parent, 999).expect("rearrange");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children, vec![child]);
    }

    // ── is_ancestor ────────────────────────────────────────────────────

    #[test]
    fn test_is_ancestor_direct_parent() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        add_child(&mut arena, parent, child).expect("add_child");

        assert!(is_ancestor(&arena, parent, child).expect("is_ancestor"));
    }

    #[test]
    fn test_is_ancestor_grandparent() {
        let mut arena = Arena::new(100);
        let gp = insert_group(&mut arena, make_uuid(1), "GP");
        let parent = insert_group(&mut arena, make_uuid(2), "Parent");
        let child = insert_group(&mut arena, make_uuid(3), "Child");

        add_child(&mut arena, gp, parent).expect("add_child");
        add_child(&mut arena, parent, child).expect("add_child");

        assert!(is_ancestor(&arena, gp, child).expect("is_ancestor"));
    }

    #[test]
    fn test_is_ancestor_not_ancestor() {
        let mut arena = Arena::new(100);
        let a = insert_group(&mut arena, make_uuid(1), "A");
        let b = insert_group(&mut arena, make_uuid(2), "B");

        assert!(!is_ancestor(&arena, a, b).expect("is_ancestor"));
    }

    #[test]
    fn test_is_ancestor_self_is_not_ancestor() {
        let mut arena = Arena::new(100);
        let node = insert_group(&mut arena, make_uuid(1), "Node");

        assert!(!is_ancestor(&arena, node, node).expect("is_ancestor"));
    }

    // ── ancestors ──────────────────────────────────────────────────────

    #[test]
    fn test_ancestors_root_node() {
        let mut arena = Arena::new(100);
        let root = insert_group(&mut arena, make_uuid(1), "Root");

        let path = ancestors(&arena, root).expect("ancestors");
        assert_eq!(path, vec![root]);
    }

    #[test]
    fn test_ancestors_nested() {
        let mut arena = Arena::new(100);
        let a = insert_group(&mut arena, make_uuid(1), "A");
        let b = insert_group(&mut arena, make_uuid(2), "B");
        let c = insert_group(&mut arena, make_uuid(3), "C");

        add_child(&mut arena, a, b).expect("add_child");
        add_child(&mut arena, b, c).expect("add_child");

        let path = ancestors(&arena, c).expect("ancestors");
        assert_eq!(path, vec![a, b, c]);
    }

    // ── descendants ────────────────────────────────────────────────────

    #[test]
    fn test_descendants_leaf() {
        let mut arena = Arena::new(100);
        let leaf = insert_group(&mut arena, make_uuid(1), "Leaf");

        let desc = descendants(&arena, leaf).expect("descendants");
        assert!(desc.is_empty());
    }

    #[test]
    fn test_descendants_tree() {
        let mut arena = Arena::new(100);
        let root = insert_group(&mut arena, make_uuid(1), "Root");
        let a = insert_group(&mut arena, make_uuid(2), "A");
        let b = insert_group(&mut arena, make_uuid(3), "B");
        let c = insert_group(&mut arena, make_uuid(4), "C");

        add_child(&mut arena, root, a).expect("add_child");
        add_child(&mut arena, root, b).expect("add_child");
        add_child(&mut arena, a, c).expect("add_child");

        let desc = descendants(&arena, root).expect("descendants");
        // DFS pre-order: A, C, B
        assert_eq!(desc, vec![a, c, b]);
    }
}
