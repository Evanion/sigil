//! Document query tools — `get_document_info`, `get_document_tree`.
//!
//! These functions read document state through the shared `AppState` and
//! return token-efficient summaries for MCP agent consumption.

use agent_designer_core::NodeKind;
use agent_designer_state::AppState;

use crate::server::acquire_document_lock;
use crate::types::{DocumentInfo, DocumentTree, NodeInfo, PageTree, TransformInfo};

/// Maximum tree traversal depth to prevent stack overflow on cyclic references.
///
/// This is an MCP-crate-local constant (not in `crates/core/src/validate.rs`)
/// because it governs MCP response generation, not core engine operations.
///
/// Per CLAUDE.md defensive coding rules, this constant MUST be enforced via a
/// `>=` comparison and MUST have a corresponding test (`test_max_tree_depth_enforced`).
pub const MAX_TREE_DEPTH: usize = 100;

/// Builds a `DocumentInfo` from the current document state.
///
/// Acquires the document lock, reads metadata/arena/pages/history, then drops
/// the lock before returning. The lock is never held across an await point.
#[must_use]
pub fn get_document_info_impl(state: &AppState) -> DocumentInfo {
    let doc = acquire_document_lock(state);
    DocumentInfo {
        name: doc.metadata.name.clone(),
        page_count: doc.pages.len(),
        node_count: doc.arena.len(),
        can_undo: doc.can_undo(),
        can_redo: doc.can_redo(),
    }
}

/// Builds a full document tree from the current document state.
///
/// Pages are returned in document order. Within each page, nodes are returned
/// in a flattened depth-first list. Use the `children` field on each `NodeInfo`
/// to reconstruct the hierarchy.
#[must_use]
pub fn get_document_tree_impl(state: &AppState) -> DocumentTree {
    let doc = acquire_document_lock(state);
    let pages = doc
        .pages
        .iter()
        .map(|page| {
            let nodes: Vec<NodeInfo> = page
                .root_nodes
                .iter()
                .flat_map(|&root_id| collect_node_tree(&doc, root_id))
                .collect();
            PageTree {
                id: page.id.uuid().to_string(),
                name: page.name.clone(),
                nodes,
            }
        })
        .collect();

    DocumentTree {
        name: doc.metadata.name.clone(),
        pages,
    }
}

/// Recursively collects a node and all its descendants into a flat list.
///
/// Delegates to `collect_node_tree_inner` with an initial depth of 0.
fn collect_node_tree(
    doc: &agent_designer_core::Document,
    node_id: agent_designer_core::NodeId,
) -> Vec<NodeInfo> {
    let mut result = Vec::new();
    collect_node_tree_inner(doc, node_id, &mut result, 0);
    result
}

/// Inner recursive implementation with an explicit depth counter.
///
/// Depth is zero-indexed. When `depth >= MAX_TREE_DEPTH` the traversal stops
/// and a warning is logged. This prevents stack overflow on pathological inputs.
fn collect_node_tree_inner(
    doc: &agent_designer_core::Document,
    node_id: agent_designer_core::NodeId,
    out: &mut Vec<NodeInfo>,
    depth: usize,
) {
    if depth >= MAX_TREE_DEPTH {
        tracing::warn!(
            "max tree depth ({MAX_TREE_DEPTH}) reached during MCP tree collection, truncating"
        );
        return;
    }

    let Ok(node) = doc.arena.get(node_id) else {
        return;
    };

    let children_uuids: Vec<String> = node
        .children
        .iter()
        .filter_map(|&cid| doc.arena.uuid_of(cid).ok().map(|u| u.to_string()))
        .collect();

    out.push(NodeInfo {
        uuid: node.uuid.to_string(),
        name: node.name.clone(),
        kind: node_kind_to_string(&node.kind).to_string(),
        visible: node.visible,
        locked: node.locked,
        children: children_uuids,
        transform: TransformInfo {
            x: node.transform.x,
            y: node.transform.y,
            width: node.transform.width,
            height: node.transform.height,
            rotation: node.transform.rotation,
            scale_x: node.transform.scale_x,
            scale_y: node.transform.scale_y,
        },
    });

    for &child_id in &node.children {
        collect_node_tree_inner(doc, child_id, out, depth + 1);
    }
}

/// Converts a `NodeKind` variant to a simple string label for agent consumption.
///
/// Public so that other tool modules (e.g., `nodes.rs`) can reuse this mapping
/// without duplicating the match arm logic.
#[must_use]
pub fn node_kind_to_string(kind: &NodeKind) -> &'static str {
    match kind {
        NodeKind::Frame { .. } => "frame",
        NodeKind::Rectangle { .. } => "rectangle",
        NodeKind::Ellipse { .. } => "ellipse",
        NodeKind::Path { .. } => "path",
        NodeKind::Text { .. } => "text",
        NodeKind::Image { .. } => "image",
        NodeKind::Group => "group",
        NodeKind::ComponentInstance { .. } => "component_instance",
    }
}

#[cfg(test)]
mod tests {
    use agent_designer_core::{Node, NodeId, NodeKind, Page, PageId};
    use agent_designer_state::AppState;

    use super::*;

    #[test]
    fn test_get_document_info_returns_correct_counts() {
        let state = AppState::new();
        {
            let mut doc = state.document.lock().unwrap();
            let page = Page::new(PageId::new(uuid::Uuid::new_v4()), "Page 1".to_string()).unwrap();
            doc.add_page(page).unwrap();
        }
        let info = get_document_info_impl(&state);
        assert_eq!(info.name, "Untitled");
        assert_eq!(info.page_count, 1);
        assert_eq!(info.node_count, 0);
        assert!(!info.can_undo);
        assert!(!info.can_redo);
    }

    #[test]
    fn test_get_document_tree_returns_pages_and_nodes() {
        let state = AppState::new();
        let page_uuid = uuid::Uuid::new_v4();
        {
            let mut doc = state.document.lock().unwrap();
            let page = Page::new(PageId::new(page_uuid), "Home".to_string()).unwrap();
            doc.add_page(page).unwrap();

            // Node::new requires a valid NodeId; arena.insert will stamp the real id.
            let node = Node::new(
                NodeId::new(0, 0),
                uuid::Uuid::new_v4(),
                NodeKind::Frame { layout: None },
                "Header".to_string(),
            )
            .unwrap();
            let node_id = doc.arena.insert(node).unwrap();
            doc.add_root_node_to_page(PageId::new(page_uuid), node_id)
                .unwrap();
        }
        let tree = get_document_tree_impl(&state);
        assert_eq!(tree.pages.len(), 1);
        assert_eq!(tree.pages[0].name, "Home");
        assert_eq!(tree.pages[0].nodes.len(), 1);
        assert_eq!(tree.pages[0].nodes[0].name, "Header");
        assert_eq!(tree.pages[0].nodes[0].kind, "frame");
    }

    /// Verify that `MAX_TREE_DEPTH` is enforced — traversal stops at the depth
    /// limit and does not recurse indefinitely.
    #[test]
    fn test_max_tree_depth_enforced() {
        // Build a chain of nodes deeper than MAX_TREE_DEPTH.
        // The collect should stop at MAX_TREE_DEPTH levels and not panic.
        let state = AppState::new();
        let page_uuid = uuid::Uuid::new_v4();
        {
            let mut doc = state.document.lock().unwrap();
            let page = Page::new(PageId::new(page_uuid), "Deep".to_string()).unwrap();
            doc.add_page(page).unwrap();

            // Insert MAX_TREE_DEPTH + 5 nodes in a chain.
            let depth_target = MAX_TREE_DEPTH + 5;
            let mut prev_id: Option<agent_designer_core::NodeId> = None;
            let mut root_id: Option<agent_designer_core::NodeId> = None;

            for i in 0..depth_target {
                let node = Node::new(
                    NodeId::new(0, 0),
                    uuid::Uuid::new_v4(),
                    NodeKind::Frame { layout: None },
                    format!("node-{i}"),
                )
                .unwrap();
                let nid = doc.arena.insert(node).unwrap();

                if let Some(pid) = prev_id {
                    // Wire child into parent's children list.
                    let parent = doc.arena.get_mut(pid).unwrap();
                    parent.children.push(nid);
                    // Set child's parent pointer.
                    let child = doc.arena.get_mut(nid).unwrap();
                    child.parent = Some(pid);
                } else {
                    root_id = Some(nid);
                }
                prev_id = Some(nid);
            }

            if let Some(rid) = root_id {
                doc.add_root_node_to_page(PageId::new(page_uuid), rid)
                    .unwrap();
            }
        }

        // Should not panic. The tree is truncated at MAX_TREE_DEPTH.
        let tree = get_document_tree_impl(&state);
        assert_eq!(tree.pages.len(), 1);
        // Nodes collected should be at most MAX_TREE_DEPTH (depth guard stops recursion).
        assert!(
            tree.pages[0].nodes.len() <= MAX_TREE_DEPTH,
            "expected at most {MAX_TREE_DEPTH} nodes, got {}",
            tree.pages[0].nodes.len()
        );
    }
}
