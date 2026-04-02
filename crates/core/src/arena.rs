// crates/core/src/arena.rs

use std::collections::HashMap;
use uuid::Uuid;

use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::Node;
use crate::validate::DEFAULT_MAX_NODES;

/// Generational arena for node storage.
///
/// Nodes are stored in a flat `Vec` indexed by `NodeId.index`. Each slot
/// has a generation counter; stale references (wrong generation) are rejected.
/// A free list enables slot reuse without shifting indices.
#[derive(Debug, Clone)]
pub struct Arena {
    nodes: Vec<Option<Node>>,
    free_list: Vec<u32>,
    uuid_to_id: HashMap<Uuid, NodeId>,
    uuids: Vec<Option<Uuid>>,
    generation: Vec<u64>,
    max_nodes: usize,
}

impl Arena {
    /// Creates a new arena with the given capacity limit.
    #[must_use]
    pub fn new(max_nodes: usize) -> Self {
        Self {
            nodes: Vec::new(),
            free_list: Vec::new(),
            uuid_to_id: HashMap::new(),
            uuids: Vec::new(),
            generation: Vec::new(),
            max_nodes,
        }
    }

    /// Returns the number of live nodes in the arena.
    #[must_use]
    pub fn len(&self) -> usize {
        self.uuid_to_id.len()
    }

    /// Returns true if the arena contains no live nodes.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.uuid_to_id.is_empty()
    }

    /// Returns the maximum number of nodes allowed.
    #[must_use]
    pub fn max_nodes(&self) -> usize {
        self.max_nodes
    }

    /// Inserts a node into the arena, assigning it a `NodeId`.
    ///
    /// The node's `id` field is updated to match the assigned `NodeId`.
    /// The node's `uuid` must not already exist in the arena.
    ///
    /// # Errors
    /// - `CoreError::CapacityExceeded` if the arena is at capacity.
    /// - `CoreError::DuplicateUuid` if the node's UUID is already in use.
    pub fn insert(&mut self, mut node: Node) -> Result<NodeId, CoreError> {
        if self.len() >= self.max_nodes {
            return Err(CoreError::CapacityExceeded(self.max_nodes));
        }

        if self.uuid_to_id.contains_key(&node.uuid) {
            return Err(CoreError::DuplicateUuid(node.uuid));
        }

        let uuid = node.uuid;

        let id = if let Some(index) = self.free_list.pop() {
            let idx = index as usize;
            self.generation[idx] += 1;
            let generation = self.generation[idx];
            let id = NodeId::new(index, generation);
            node.id = id;
            self.uuids[idx] = Some(uuid);
            self.nodes[idx] = Some(node);
            id
        } else {
            let index = u32::try_from(self.nodes.len())
                .map_err(|_| CoreError::CapacityExceeded(self.max_nodes))?;
            let id = NodeId::new(index, 0);
            node.id = id;
            self.uuids.push(Some(uuid));
            self.nodes.push(Some(node));
            self.generation.push(0);
            id
        };

        self.uuid_to_id.insert(uuid, id);
        Ok(id)
    }

    /// Reinserts a previously removed node at its exact original slot and generation.
    ///
    /// Used by undo operations to preserve `NodeId` stability across undo/redo.
    /// The slot must be empty and the generation must still match (i.e., no other
    /// node has been inserted into this slot since the removal).
    ///
    /// # Errors
    /// - `CoreError::ValidationError` if the slot index is out of range.
    /// - `CoreError::ValidationError` if the slot is already occupied.
    /// - `CoreError::ValidationError` if the generation has been bumped (slot was reused).
    pub fn reinsert(&mut self, id: NodeId, mut node: Node) -> Result<(), CoreError> {
        let idx = id.index() as usize;

        if idx >= self.nodes.len() {
            return Err(CoreError::ValidationError(format!(
                "reinsert: slot {} out of range (arena has {} slots)",
                idx,
                self.nodes.len()
            )));
        }

        if self.nodes[idx].is_some() {
            return Err(CoreError::ValidationError(format!(
                "reinsert: slot {idx} is already occupied"
            )));
        }

        if self.generation[idx] != id.generation() {
            return Err(CoreError::ValidationError(format!(
                "reinsert: generation mismatch at slot {} (expected {}, found {})",
                idx,
                id.generation(),
                self.generation[idx]
            )));
        }

        // Remove this index from the free list
        self.free_list.retain(|&i| i != id.index());

        // Stamp the node with the correct NodeId
        node.id = id;

        // Restore UUID mapping
        let uuid = node.uuid;
        if self.uuid_to_id.contains_key(&uuid) {
            return Err(CoreError::DuplicateUuid(uuid));
        }
        self.uuids[idx] = Some(uuid);
        self.uuid_to_id.insert(uuid, id);

        // Restore the node
        self.nodes[idx] = Some(node);

        Ok(())
    }

    /// Removes a node from the arena by its `NodeId`.
    ///
    /// The slot is added to the free list for reuse.
    ///
    /// # Errors
    /// - `CoreError::NodeNotFound` if the slot is empty.
    /// - `CoreError::StaleNodeId` if the generation does not match.
    pub fn remove(&mut self, id: NodeId) -> Result<Node, CoreError> {
        self.validate_id(id)?;
        let idx = id.index() as usize;
        let node = self.nodes[idx].take().ok_or(CoreError::NodeNotFound(id))?;
        let uuid = self.uuids[idx].take();
        if let Some(uuid) = uuid {
            self.uuid_to_id.remove(&uuid);
        }
        self.free_list.push(id.index());
        Ok(node)
    }

    /// Returns a shared reference to the node with the given `NodeId`.
    ///
    /// # Errors
    /// - `CoreError::NodeNotFound` if the slot is empty.
    /// - `CoreError::StaleNodeId` if the generation does not match.
    pub fn get(&self, id: NodeId) -> Result<&Node, CoreError> {
        self.validate_id(id)?;
        let idx = id.index() as usize;
        self.nodes[idx].as_ref().ok_or(CoreError::NodeNotFound(id))
    }

    /// Returns a mutable reference to the node with the given `NodeId`.
    ///
    /// # Errors
    /// - `CoreError::NodeNotFound` if the slot is empty.
    /// - `CoreError::StaleNodeId` if the generation does not match.
    pub fn get_mut(&mut self, id: NodeId) -> Result<&mut Node, CoreError> {
        self.validate_id(id)?;
        let idx = id.index() as usize;
        self.nodes[idx].as_mut().ok_or(CoreError::NodeNotFound(id))
    }

    /// Looks up a `NodeId` by UUID.
    ///
    /// Returns `None` if the UUID is not found. Callers decide how to handle the absence.
    #[must_use]
    pub fn id_by_uuid(&self, uuid: &Uuid) -> Option<NodeId> {
        self.uuid_to_id.get(uuid).copied()
    }

    /// Returns the UUID for a given `NodeId`.
    ///
    /// # Errors
    /// - `CoreError::StaleNodeId` if the generation does not match.
    /// - `CoreError::NodeNotFound` if the slot is empty or has no UUID.
    pub fn uuid_of(&self, id: NodeId) -> Result<Uuid, CoreError> {
        self.validate_id(id)?;
        let idx = id.index() as usize;
        self.uuids[idx].ok_or(CoreError::NodeNotFound(id))
    }

    /// Deep-clones a subtree rooted at `root`, assigning fresh UUIDs via the provided generator.
    ///
    /// Returns the list of cloned nodes. The caller is responsible for inserting them into the arena
    /// and setting up parent/child relationships.
    ///
    /// # Errors
    /// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` if any node in the subtree is invalid.
    pub fn clone_subtree(
        &self,
        root: NodeId,
        uuid_generator: &mut dyn FnMut() -> Uuid,
    ) -> Result<Vec<Node>, CoreError> {
        let mut result = Vec::new();
        let mut stack = vec![root];

        while let Some(current_id) = stack.pop() {
            let node = self.get(current_id)?;
            let mut cloned = node.clone();
            cloned.uuid = uuid_generator();
            cloned.parent = None;
            cloned.children = Vec::new();
            // id will be reassigned when inserted into the arena
            result.push(cloned);

            // Push children in reverse so they come out in order
            for child_id in node.children.iter().rev() {
                stack.push(*child_id);
            }
        }

        Ok(result)
    }

    /// Returns an iterator over all live nodes in the arena.
    pub fn iter(&self) -> impl Iterator<Item = &Node> {
        self.nodes.iter().filter_map(Option::as_ref)
    }

    /// Validates that a `NodeId` refers to a valid, live slot.
    fn validate_id(&self, id: NodeId) -> Result<(), CoreError> {
        let idx = id.index() as usize;
        if idx >= self.generation.len() {
            return Err(CoreError::NodeNotFound(id));
        }
        if self.generation[idx] != id.generation() {
            return Err(CoreError::StaleNodeId(id));
        }
        Ok(())
    }
}

impl Default for Arena {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_NODES)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::NodeKind;

    fn make_node(uuid: Uuid, name: &str) -> Node {
        Node::new(
            NodeId::new(0, 0), // will be overwritten by arena
            uuid,
            NodeKind::Group,
            name.to_string(),
        )
        .expect("create test node")
    }

    #[test]
    fn test_arena_new_is_empty() {
        let arena = Arena::new(100);
        assert!(arena.is_empty());
        assert_eq!(arena.len(), 0);
        assert_eq!(arena.max_nodes(), 100);
    }

    #[test]
    fn test_arena_default_max_nodes() {
        let arena = Arena::default();
        assert_eq!(arena.max_nodes(), DEFAULT_MAX_NODES);
    }

    #[test]
    fn test_insert_and_get() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let node = make_node(uuid, "Node 1");
        let id = arena.insert(node).expect("insert");
        let retrieved = arena.get(id).expect("get");
        assert_eq!(retrieved.name, "Node 1");
        assert_eq!(retrieved.uuid, uuid);
        assert_eq!(retrieved.id, id);
    }

    #[test]
    fn test_insert_increments_len() {
        let mut arena = Arena::new(100);
        assert_eq!(arena.len(), 0);
        arena.insert(make_node(Uuid::nil(), "A")).expect("insert");
        assert_eq!(arena.len(), 1);
    }

    #[test]
    fn test_insert_duplicate_uuid_fails() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        arena.insert(make_node(uuid, "A")).expect("insert");
        let result = arena.insert(make_node(uuid, "B"));
        assert!(result.is_err());
    }

    #[test]
    fn test_insert_capacity_exceeded() {
        let mut arena = Arena::new(1);
        arena.insert(make_node(Uuid::nil(), "A")).expect("insert");
        // Need a different UUID for the second insert
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let result = arena.insert(make_node(uuid2, "B"));
        assert!(matches!(result, Err(CoreError::CapacityExceeded(1))));
    }

    #[test]
    fn test_remove_and_reuse_slot() {
        let mut arena = Arena::new(100);
        let uuid1 = Uuid::nil();
        let id1 = arena.insert(make_node(uuid1, "A")).expect("insert");
        let removed = arena.remove(id1).expect("remove");
        assert_eq!(removed.name, "A");
        assert_eq!(arena.len(), 0);

        // Insert again — should reuse the slot with bumped generation
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let id2 = arena.insert(make_node(uuid2, "B")).expect("insert");
        assert_eq!(id2.index(), id1.index()); // same slot
        assert_eq!(id2.generation(), id1.generation() + 1); // bumped generation
    }

    #[test]
    fn test_stale_id_after_remove() {
        let mut arena = Arena::new(100);
        let uuid1 = Uuid::nil();
        let id1 = arena.insert(make_node(uuid1, "A")).expect("insert");
        arena.remove(id1).expect("remove");

        // Old id is now stale
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let _id2 = arena.insert(make_node(uuid2, "B")).expect("insert");
        let result = arena.get(id1);
        assert!(matches!(result, Err(CoreError::StaleNodeId(_))));
    }

    #[test]
    fn test_get_nonexistent_node() {
        let arena = Arena::new(100);
        let id = NodeId::new(0, 0);
        let result = arena.get(id);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_mut() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "A")).expect("insert");
        {
            let node = arena.get_mut(id).expect("get_mut");
            node.name = "B".to_string();
        }
        let node = arena.get(id).expect("get");
        assert_eq!(node.name, "B");
    }

    #[test]
    fn test_id_by_uuid() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "A")).expect("insert");
        let found = arena.id_by_uuid(&uuid).expect("id_by_uuid");
        assert_eq!(found, id);
    }

    #[test]
    fn test_id_by_uuid_not_found() {
        let arena = Arena::new(100);
        let uuid = Uuid::nil();
        let result = arena.id_by_uuid(&uuid);
        assert!(result.is_none());
    }

    #[test]
    fn test_uuid_of() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "A")).expect("insert");
        let found = arena.uuid_of(id).expect("uuid_of");
        assert_eq!(found, uuid);
    }

    #[test]
    fn test_uuid_of_stale() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "A")).expect("insert");
        arena.remove(id).expect("remove");
        let stale_result = arena.uuid_of(id);
        // After remove+reinsert at same slot, old id is stale
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let _id2 = arena.insert(make_node(uuid2, "B")).expect("insert");
        let result = arena.uuid_of(id);
        assert!(stale_result.is_err() || result.is_err());
    }

    #[test]
    fn test_clone_subtree_single_node() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "Root")).expect("insert");

        let mut counter: u8 = 1;
        let clones = arena
            .clone_subtree(id, &mut || {
                let bytes = [counter, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
                counter += 1;
                Uuid::from_bytes(bytes)
            })
            .expect("clone");

        assert_eq!(clones.len(), 1);
        assert_ne!(clones[0].uuid, uuid); // fresh UUID
        assert_eq!(clones[0].name, "Root");
        assert!(clones[0].parent.is_none());
        assert!(clones[0].children.is_empty());
    }

    #[test]
    fn test_clone_subtree_with_children() {
        let mut arena = Arena::new(100);
        let uuid_root = Uuid::nil();
        let uuid_child1 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let uuid_child2 = Uuid::from_bytes([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

        let root_id = arena.insert(make_node(uuid_root, "Root")).expect("insert");
        let child1_id = arena
            .insert(make_node(uuid_child1, "Child1"))
            .expect("insert");
        let child2_id = arena
            .insert(make_node(uuid_child2, "Child2"))
            .expect("insert");

        // Manually set up parent/child (normally tree.rs does this)
        arena.get_mut(root_id).expect("get_mut").children = vec![child1_id, child2_id];
        arena.get_mut(child1_id).expect("get_mut").parent = Some(root_id);
        arena.get_mut(child2_id).expect("get_mut").parent = Some(root_id);

        let mut counter: u8 = 10;
        let clones = arena
            .clone_subtree(root_id, &mut || {
                let bytes = [counter, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
                counter += 1;
                Uuid::from_bytes(bytes)
            })
            .expect("clone");

        assert_eq!(clones.len(), 3);
        // All should have fresh UUIDs and no parent/children
        for c in &clones {
            assert!(c.parent.is_none());
            assert!(c.children.is_empty());
        }
    }

    #[test]
    fn test_clone_subtree_nonexistent_root() {
        let arena = Arena::new(100);
        let id = NodeId::new(99, 0);
        let result = arena.clone_subtree(id, &mut || Uuid::nil());
        assert!(result.is_err());
    }

    #[test]
    fn test_iter_returns_live_nodes() {
        let mut arena = Arena::new(100);
        let uuid1 = Uuid::nil();
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let uuid3 = Uuid::from_bytes([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

        arena.insert(make_node(uuid1, "A")).expect("insert");
        let id2 = arena.insert(make_node(uuid2, "B")).expect("insert");
        arena.insert(make_node(uuid3, "C")).expect("insert");

        arena.remove(id2).expect("remove");

        let names: Vec<&str> = arena.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"A"));
        assert!(names.contains(&"C"));
    }

    #[test]
    fn test_multiple_insert_remove_cycles() {
        let mut arena = Arena::new(100);
        let mut uuids_used = Vec::new();

        for i in 0..10u8 {
            let uuid = Uuid::from_bytes([i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            uuids_used.push(uuid);
            arena
                .insert(make_node(uuid, &format!("Node {i}")))
                .expect("insert");
        }
        assert_eq!(arena.len(), 10);

        // Remove all
        for uuid in &uuids_used {
            let id = arena.id_by_uuid(uuid).expect("lookup");
            arena.remove(id).expect("remove");
        }
        assert_eq!(arena.len(), 0);

        // Reinsert — should reuse slots
        for i in 0..10u8 {
            let uuid = Uuid::from_bytes([i + 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            let id = arena
                .insert(make_node(uuid, &format!("New {i}")))
                .expect("insert");
            assert_eq!(id.generation(), 1); // all reused, generation bumped once
        }
        assert_eq!(arena.len(), 10);
    }

    // ── reinsert ──────────────────────────────────────────────────────

    #[test]
    fn test_reinsert_restores_at_exact_slot() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let node = make_node(uuid, "Original");
        let id = arena.insert(node).expect("insert");

        let removed = arena.remove(id).expect("remove");
        assert_eq!(arena.len(), 0);

        arena.reinsert(id, removed).expect("reinsert");
        assert_eq!(arena.len(), 1);

        // The exact same NodeId must work
        let retrieved = arena.get(id).expect("get after reinsert");
        assert_eq!(retrieved.name, "Original");
        assert_eq!(retrieved.id, id);
    }

    #[test]
    fn test_reinsert_occupied_slot_fails() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let node = make_node(uuid, "Occupied");
        let id = arena.insert(node).expect("insert");

        // Slot is still occupied — reinsert must fail
        let other_node = make_node(
            Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            "Other",
        );
        let result = arena.reinsert(id, other_node);
        assert!(result.is_err());
        assert!(
            matches!(result, Err(CoreError::ValidationError(ref msg)) if msg.contains("already occupied")),
            "expected 'already occupied' error, got: {result:?}"
        );
    }

    #[test]
    fn test_reinsert_preserves_uuid_mapping() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let node = make_node(uuid, "Mapped");
        let id = arena.insert(node).expect("insert");

        let removed = arena.remove(id).expect("remove");
        assert!(arena.id_by_uuid(&uuid).is_none());

        arena.reinsert(id, removed).expect("reinsert");
        let found_id = arena.id_by_uuid(&uuid).expect("uuid lookup after reinsert");
        assert_eq!(found_id, id);
        assert_eq!(arena.uuid_of(id).expect("uuid_of"), uuid);
    }

    #[test]
    fn test_reinsert_out_of_range_slot_fails() {
        let mut arena = Arena::new(100);
        let fake_id = NodeId::new(99, 0);
        let node = make_node(Uuid::nil(), "Ghost");
        let result = arena.reinsert(fake_id, node);
        assert!(result.is_err());
        assert!(
            matches!(result, Err(CoreError::ValidationError(ref msg)) if msg.contains("out of range")),
            "expected 'out of range' error, got: {result:?}"
        );
    }

    #[test]
    fn test_reinsert_generation_mismatch_fails() {
        let mut arena = Arena::new(100);
        let uuid1 = Uuid::nil();
        let id1 = arena.insert(make_node(uuid1, "First")).expect("insert");
        arena.remove(id1).expect("remove");

        // Insert a new node that reuses the slot, bumping the generation
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let id2 = arena.insert(make_node(uuid2, "Second")).expect("insert reuse");
        assert_eq!(id2.index(), id1.index()); // same slot
        arena.remove(id2).expect("remove second");

        // Try to reinsert with the old generation — must fail
        let node = make_node(uuid1, "Stale");
        let result = arena.reinsert(id1, node);
        assert!(result.is_err());
        assert!(
            matches!(result, Err(CoreError::ValidationError(ref msg)) if msg.contains("generation mismatch")),
            "expected 'generation mismatch' error, got: {result:?}"
        );
    }

    #[test]
    fn test_reinsert_duplicate_uuid_fails() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

        let id1 = arena.insert(make_node(uuid, "A")).expect("insert A");
        let id2 = arena.insert(make_node(uuid2, "B")).expect("insert B");

        let removed = arena.remove(id2).expect("remove B");

        // Manually create a node with uuid that collides with the live node
        let mut collision_node = removed;
        collision_node.uuid = uuid; // same UUID as the still-live node A
        let result = arena.reinsert(id2, collision_node);
        assert!(matches!(result, Err(CoreError::DuplicateUuid(_))));

        // Verify slot was not corrupted — id1 still works
        let _ = arena.get(id1).expect("id1 still valid");
    }
}
