// crates/core/src/document.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::arena::Arena;
use crate::error::CoreError;
use crate::id::{ComponentId, NodeId, PageId};
pub use crate::prototype::Transition;
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
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the page name is empty, too long,
    /// or contains control characters.
    pub fn new(id: PageId, name: String) -> Result<Self, CoreError> {
        crate::validate::validate_page_name(&name)?;
        Ok(Self {
            id,
            name,
            root_nodes: Vec::new(),
        })
    }
}

pub use crate::component::ComponentDef;
pub use crate::token::TokenContext;

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

    /// Adds a component definition to the document.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if a component with the same ID already exists
    /// or the document already has the maximum number of components.
    pub fn add_component(&mut self, def: ComponentDef) -> Result<(), CoreError> {
        if self.components.contains_key(&def.id()) {
            return Err(CoreError::ValidationError(format!(
                "component with id {:?} already exists",
                def.id()
            )));
        }
        if self.components.len() >= crate::validate::MAX_COMPONENTS_PER_DOCUMENT {
            return Err(CoreError::ValidationError(format!(
                "document already has {} components (maximum {})",
                self.components.len(),
                crate::validate::MAX_COMPONENTS_PER_DOCUMENT
            )));
        }
        self.components.insert(def.id(), def);
        Ok(())
    }

    /// Adds a transition to the document.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the transition is invalid, a transition
    /// with the same ID already exists, or the document is at capacity.
    pub fn add_transition(
        &mut self,
        transition: crate::prototype::Transition,
    ) -> Result<(), CoreError> {
        crate::prototype::validate_transition(&transition)?;
        if self.transitions.iter().any(|t| t.id == transition.id) {
            return Err(CoreError::ValidationError(format!(
                "transition with id {} already exists",
                transition.id
            )));
        }
        if self.transitions.len() >= crate::validate::MAX_TRANSITIONS_PER_DOCUMENT {
            return Err(CoreError::ValidationError(format!(
                "document already has {} transitions (maximum {})",
                self.transitions.len(),
                crate::validate::MAX_TRANSITIONS_PER_DOCUMENT
            )));
        }
        self.transitions.push(transition);
        Ok(())
    }

    /// Removes a transition by ID. Returns the removed transition if found.
    pub fn remove_transition(&mut self, id: uuid::Uuid) -> Option<crate::prototype::Transition> {
        if let Some(pos) = self.transitions.iter().position(|t| t.id == id) {
            Some(self.transitions.remove(pos))
        } else {
            None
        }
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
            if page.root_nodes.len() >= crate::validate::MAX_ROOT_NODES_PER_PAGE {
                return Err(CoreError::ValidationError(format!(
                    "page already has {} root nodes (maximum {})",
                    page.root_nodes.len(),
                    crate::validate::MAX_ROOT_NODES_PER_PAGE
                )));
            }
            page.root_nodes.push(node_id);
        }
        Ok(())
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
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string()).expect("create page");
        assert_eq!(page.name, "Home");
        assert!(page.root_nodes.is_empty());
    }

    #[test]
    fn test_page_new_rejects_empty_name() {
        let result = Page::new(PageId::new(make_uuid(1)), String::new());
        assert!(result.is_err());
    }

    #[test]
    fn test_page_new_rejects_control_chars() {
        let result = Page::new(PageId::new(make_uuid(1)), "foo\0bar".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_add_page() {
        let mut doc = Document::new("Test".to_string());
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string()).expect("create page");
        doc.add_page(page).expect("add page");
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].name, "Home");
    }

    #[test]
    fn test_find_page_by_id() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");

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
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");

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
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");

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
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");
        let fake_node = NodeId::new(99, 0);
        let result = doc.add_root_node_to_page(page_id, fake_node);
        assert!(result.is_err());
    }

    #[test]
    fn test_page_serde_round_trip() {
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string()).expect("create page");
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

    // ── Transition mutation API ────────────────────────────────────────

    #[test]
    fn test_add_transition() {
        use crate::prototype::{TransitionAnimation, TransitionTrigger};

        let mut doc = Document::new("Test".to_string());
        let t = Transition {
            id: make_uuid(1),
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(make_uuid(10)),
            target_node: None,
            trigger: TransitionTrigger::OnClick,
            animation: TransitionAnimation::Instant,
        };
        doc.add_transition(t).expect("add transition");
        assert_eq!(doc.transitions.len(), 1);
    }

    #[test]
    fn test_add_transition_validates() {
        use crate::prototype::{TransitionAnimation, TransitionTrigger};

        let mut doc = Document::new("Test".to_string());
        let t = Transition {
            id: make_uuid(1),
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(make_uuid(10)),
            target_node: None,
            trigger: TransitionTrigger::AfterDelay { seconds: -1.0 },
            animation: TransitionAnimation::Instant,
        };
        assert!(doc.add_transition(t).is_err());
    }

    #[test]
    fn test_remove_transition() {
        use crate::prototype::{TransitionAnimation, TransitionTrigger};

        let mut doc = Document::new("Test".to_string());
        let id = make_uuid(1);
        let t = Transition {
            id,
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(make_uuid(10)),
            target_node: None,
            trigger: TransitionTrigger::OnClick,
            animation: TransitionAnimation::Instant,
        };
        doc.add_transition(t).expect("add");
        let removed = doc.remove_transition(id);
        assert!(removed.is_some());
        assert!(doc.transitions.is_empty());
    }

    #[test]
    fn test_remove_transition_not_found() {
        let mut doc = Document::new("Test".to_string());
        assert!(doc.remove_transition(make_uuid(99)).is_none());
    }

    #[test]
    fn test_max_transitions_per_document_enforced() {
        use crate::prototype::{TransitionAnimation, TransitionTrigger};

        let mut doc = Document::new("Test".to_string());
        for i in 0..crate::validate::MAX_TRANSITIONS_PER_DOCUMENT {
            let uuid = Uuid::from_u128(i as u128);
            let t = Transition {
                id: uuid,
                source_node: NodeId::new(0, 0),
                target_page: PageId::new(make_uuid(10)),
                target_node: None,
                trigger: TransitionTrigger::OnClick,
                animation: TransitionAnimation::Instant,
            };
            doc.add_transition(t).expect("add transition");
        }
        assert_eq!(
            doc.transitions.len(),
            crate::validate::MAX_TRANSITIONS_PER_DOCUMENT
        );
        let overflow = Transition {
            id: Uuid::from_u128(999_999),
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(make_uuid(10)),
            target_node: None,
            trigger: TransitionTrigger::OnClick,
            animation: TransitionAnimation::Instant,
        };
        assert!(doc.add_transition(overflow).is_err());
    }

    #[test]
    fn test_add_transition_duplicate_id_rejected() {
        use crate::prototype::{TransitionAnimation, TransitionTrigger};

        let mut doc = Document::new("Test".to_string());
        let t = Transition {
            id: make_uuid(1),
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(make_uuid(10)),
            target_node: None,
            trigger: TransitionTrigger::OnClick,
            animation: TransitionAnimation::Instant,
        };
        doc.add_transition(t.clone()).expect("add first");
        let result = doc.add_transition(t);
        assert!(
            matches!(result, Err(CoreError::ValidationError(msg)) if msg.contains("already exists"))
        );
    }

    #[test]
    fn test_max_pages_per_document_enforced() {
        use crate::validate::MAX_PAGES_PER_DOCUMENT;

        let mut doc = Document::new("Test".to_string());
        for i in 0..MAX_PAGES_PER_DOCUMENT {
            let uuid = Uuid::from_u128(i as u128);
            let page = Page::new(PageId::new(uuid), format!("Page {i}")).expect("create page");
            doc.add_page(page).expect("add page");
        }
        assert_eq!(doc.pages.len(), MAX_PAGES_PER_DOCUMENT);

        // One more should fail.
        let overflow = Page::new(
            PageId::new(Uuid::from_u128(999_999)),
            "Overflow".to_string(),
        )
        .expect("create overflow page");
        let result = doc.add_page(overflow);
        assert!(result.is_err());
        assert!(matches!(&result, Err(CoreError::ValidationError(msg)) if msg.contains("maximum")));
    }

    // ── RF-006: add_component ─────────────────────────────────────────

    #[test]
    fn test_add_component_succeeds() {
        use crate::component::ComponentDef;
        use crate::id::ComponentId;

        let mut doc = Document::new("Test".to_string());
        let def = ComponentDef::new(
            ComponentId::new(make_uuid(1)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");
        doc.add_component(def).expect("add component");
        assert_eq!(doc.components.len(), 1);
    }

    #[test]
    fn test_add_component_duplicate_id_rejected() {
        use crate::component::ComponentDef;
        use crate::id::ComponentId;

        let mut doc = Document::new("Test".to_string());
        let def = ComponentDef::new(
            ComponentId::new(make_uuid(1)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");
        doc.add_component(def.clone()).expect("add first");
        let result = doc.add_component(def);
        assert!(
            matches!(result, Err(CoreError::ValidationError(msg)) if msg.contains("already exists"))
        );
    }

    #[test]
    fn test_max_components_per_document_enforced() {
        use crate::component::ComponentDef;
        use crate::id::ComponentId;

        let mut doc = Document::new("Test".to_string());
        for i in 0..crate::validate::MAX_COMPONENTS_PER_DOCUMENT {
            let uuid = Uuid::from_u128(i as u128);
            let def = ComponentDef::new(
                ComponentId::new(uuid),
                format!("C{i}"),
                NodeId::new(0, 0),
                vec![],
                vec![],
            )
            .expect("valid");
            doc.add_component(def).expect("add component");
        }
        assert_eq!(
            doc.components.len(),
            crate::validate::MAX_COMPONENTS_PER_DOCUMENT
        );
        let overflow = ComponentDef::new(
            ComponentId::new(Uuid::from_u128(999_999)),
            "Overflow".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");
        assert!(doc.add_component(overflow).is_err());
    }
}
