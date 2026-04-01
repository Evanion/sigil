// crates/core/src/document.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::arena::Arena;
use crate::error::CoreError;
use crate::id::{ComponentId, NodeId, PageId};
use crate::validate::CURRENT_SCHEMA_VERSION;

/// Metadata about the document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocumentMetadata {
    pub name: String,
    pub schema_version: u32,
}

impl DocumentMetadata {
    /// Creates new metadata with the current schema version.
    #[must_use]
    pub fn new(name: String) -> Self {
        Self {
            name,
            schema_version: CURRENT_SCHEMA_VERSION,
        }
    }
}

/// A page within the document, containing top-level nodes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page {
    pub id: PageId,
    pub name: String,
    pub root_nodes: Vec<NodeId>,
}

impl Page {
    /// Creates a new empty page.
    #[must_use]
    pub fn new(id: PageId, name: String) -> Self {
        Self {
            id,
            name,
            root_nodes: Vec::new(),
        }
    }
}

/// Stub for component definitions — Plan 01c will fill this in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentDef {
    pub id: ComponentId,
    pub name: String,
    pub root_node: NodeId,
}

/// Stub for transition model — Plan 01c will fill this in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    pub id: Uuid,
}

/// Stub for token context — Plan 01c will fill this in.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TokenContext {
    pub tokens: HashMap<String, serde_json::Value>,
}

/// Stub for history — Plan 01b will fill this in.
#[derive(Debug, Clone)]
pub struct History {
    max_history: usize,
}

impl History {
    #[must_use]
    pub fn new(max_history: usize) -> Self {
        Self { max_history }
    }

    #[must_use]
    pub fn max_history(&self) -> usize {
        self.max_history
    }
}

impl Default for History {
    fn default() -> Self {
        Self::new(crate::validate::DEFAULT_MAX_HISTORY)
    }
}

/// Stub for layout engine — Plan 01b will fill this in.
#[derive(Debug, Clone, Default)]
pub struct LayoutEngine;

/// The top-level design document.
///
/// All mutations go through commands executed on the document (Plan 01b).
/// For Plan 01a, the document provides direct access to the arena and pages.
#[derive(Debug, Clone)]
pub struct Document {
    pub metadata: DocumentMetadata,
    pub arena: Arena,
    pub pages: Vec<Page>,
    pub components: HashMap<ComponentId, ComponentDef>,
    pub transitions: Vec<Transition>,
    pub token_context: TokenContext,
    pub history: History,
    pub layout_engine: LayoutEngine,
}

impl Document {
    /// Creates a new empty document with the given name.
    #[must_use]
    pub fn new(name: String) -> Self {
        Self {
            metadata: DocumentMetadata::new(name),
            arena: Arena::default(),
            pages: Vec::new(),
            components: HashMap::new(),
            transitions: Vec::new(),
            token_context: TokenContext::default(),
            history: History::default(),
            layout_engine: LayoutEngine,
        }
    }

    /// Creates a new document with a custom arena capacity.
    #[must_use]
    pub fn with_capacity(name: String, max_nodes: usize) -> Self {
        Self {
            metadata: DocumentMetadata::new(name),
            arena: Arena::new(max_nodes),
            pages: Vec::new(),
            components: HashMap::new(),
            transitions: Vec::new(),
            token_context: TokenContext::default(),
            history: History::default(),
            layout_engine: LayoutEngine,
        }
    }

    /// Adds a page to the document.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the document already has the maximum number of pages.
    pub fn add_page(&mut self, page: Page) -> Result<(), CoreError> {
        if self.pages.len() >= crate::validate::MAX_PAGES_PER_DOCUMENT {
            return Err(CoreError::ValidationError(format!(
                "document already has {} pages (maximum {})",
                self.pages.len(),
                crate::validate::MAX_PAGES_PER_DOCUMENT
            )));
        }
        self.pages.push(page);
        Ok(())
    }

    /// Finds a page by its ID.
    ///
    /// # Errors
    /// Returns `CoreError::PageNotFound` if no page has the given ID.
    pub fn page(&self, id: PageId) -> Result<&Page, CoreError> {
        self.pages
            .iter()
            .find(|p| p.id == id)
            .ok_or(CoreError::PageNotFound(id))
    }

    /// Finds a page by its ID (mutable).
    ///
    /// # Errors
    /// Returns `CoreError::PageNotFound` if no page has the given ID.
    pub fn page_mut(&mut self, id: PageId) -> Result<&mut Page, CoreError> {
        self.pages
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or(CoreError::PageNotFound(id))
    }

    /// Adds a root node to a page.
    ///
    /// # Errors
    /// - `CoreError::PageNotFound` if the page doesn't exist.
    /// - `CoreError::NodeNotFound` if the node doesn't exist in the arena.
    pub fn add_root_node_to_page(
        &mut self,
        page_id: PageId,
        node_id: NodeId,
    ) -> Result<(), CoreError> {
        // Verify node exists
        self.arena.get(node_id)?;

        let page = self.page_mut(page_id)?;
        if !page.root_nodes.contains(&node_id) {
            page.root_nodes.push(node_id);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::{Node, NodeKind};

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    #[test]
    fn test_document_new() {
        let doc = Document::new("Test".to_string());
        assert_eq!(doc.metadata.name, "Test");
        assert_eq!(doc.metadata.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(doc.arena.is_empty());
        assert!(doc.pages.is_empty());
        assert!(doc.components.is_empty());
        assert!(doc.transitions.is_empty());
    }

    #[test]
    fn test_document_with_capacity() {
        let doc = Document::with_capacity("Test".to_string(), 50);
        assert_eq!(doc.arena.max_nodes(), 50);
    }

    #[test]
    fn test_document_metadata_new() {
        let meta = DocumentMetadata::new("My Doc".to_string());
        assert_eq!(meta.name, "My Doc");
        assert_eq!(meta.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_page_new() {
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string());
        assert_eq!(page.name, "Home");
        assert!(page.root_nodes.is_empty());
    }

    #[test]
    fn test_add_page() {
        let mut doc = Document::new("Test".to_string());
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string());
        doc.add_page(page).expect("add page");
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].name, "Home");
    }

    #[test]
    fn test_find_page_by_id() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string())).expect("add page");

        let page = doc.page(page_id).expect("find page");
        assert_eq!(page.name, "Home");
    }

    #[test]
    fn test_find_page_not_found() {
        let doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(99));
        let result = doc.page(page_id);
        assert!(matches!(result, Err(CoreError::PageNotFound(_))));
    }

    #[test]
    fn test_add_root_node_to_page() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string())).expect("add page");

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(10),
            NodeKind::Frame { layout: None },
            "Frame 1".to_string(),
        )
        .expect("create test node");
        let node_id = doc.arena.insert(node).expect("insert");
        doc.add_root_node_to_page(page_id, node_id)
            .expect("add_root");

        let page = doc.page(page_id).expect("find page");
        assert_eq!(page.root_nodes, vec![node_id]);
    }

    #[test]
    fn test_add_root_node_to_page_idempotent() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string())).expect("add page");

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(10),
            NodeKind::Group,
            "Group".to_string(),
        )
        .expect("create test node");
        let node_id = doc.arena.insert(node).expect("insert");
        doc.add_root_node_to_page(page_id, node_id)
            .expect("add_root");
        doc.add_root_node_to_page(page_id, node_id)
            .expect("add_root again");

        let page = doc.page(page_id).expect("find page");
        assert_eq!(page.root_nodes.len(), 1);
    }

    #[test]
    fn test_add_root_node_nonexistent_page() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(10),
            NodeKind::Group,
            "Group".to_string(),
        )
        .expect("create test node");
        let node_id = doc.arena.insert(node).expect("insert");
        let fake_page = PageId::new(make_uuid(99));
        let result = doc.add_root_node_to_page(fake_page, node_id);
        assert!(matches!(result, Err(CoreError::PageNotFound(_))));
    }

    #[test]
    fn test_add_root_node_nonexistent_node() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string())).expect("add page");
        let fake_node = NodeId::new(99, 0);
        let result = doc.add_root_node_to_page(page_id, fake_node);
        assert!(result.is_err());
    }

    #[test]
    fn test_history_default() {
        let h = History::default();
        assert_eq!(h.max_history(), crate::validate::DEFAULT_MAX_HISTORY);
    }

    #[test]
    fn test_history_custom() {
        let h = History::new(100);
        assert_eq!(h.max_history(), 100);
    }

    #[test]
    fn test_page_serde_round_trip() {
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string());
        let json = serde_json::to_string(&page).expect("serialize");
        let deserialized: Page = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(page, deserialized);
    }

    #[test]
    fn test_document_metadata_serde_round_trip() {
        let meta = DocumentMetadata::new("Test Doc".to_string());
        let json = serde_json::to_string(&meta).expect("serialize");
        let deserialized: DocumentMetadata = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(meta, deserialized);
    }
}
