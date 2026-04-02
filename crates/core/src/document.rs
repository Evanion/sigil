// crates/core/src/document.rs

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

use crate::arena::Arena;
use crate::command::{Command, SideEffect};
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
    #[must_use]
    pub fn new(id: PageId, name: String) -> Self {
        Self {
            id,
            name,
            root_nodes: Vec::new(),
        }
    }
}

pub use crate::component::ComponentDef;
pub use crate::token::TokenContext;

/// Undo/redo history for the document.
///
/// Commands are pushed to the undo stack on execute. Undo pops from
/// undo and pushes to redo. Redo pops from redo and pushes to undo.
/// Executing a new command clears the redo stack.
/// FIFO eviction when undo stack exceeds `max_history`.
#[derive(Debug)]
#[allow(clippy::struct_field_names)]
pub struct History {
    undo_stack: VecDeque<Box<dyn Command>>,
    redo_stack: VecDeque<Box<dyn Command>>,
    max_history: usize,
}

impl History {
    #[must_use]
    pub fn new(max_history: usize) -> Self {
        Self {
            undo_stack: VecDeque::new(),
            redo_stack: VecDeque::new(),
            max_history: max_history.max(1),
        }
    }

    #[must_use]
    pub fn max_history(&self) -> usize {
        self.max_history
    }

    #[must_use]
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    #[must_use]
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
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
#[derive(Debug)]
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

    /// Restores a component definition (for undo paths).
    ///
    /// Skips the duplicate ID check but keeps the capacity check.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the document already has the maximum
    /// number of components.
    pub fn restore_component(&mut self, def: ComponentDef) -> Result<(), CoreError> {
        if self.components.len() >= crate::validate::MAX_COMPONENTS_PER_DOCUMENT
            && !self.components.contains_key(&def.id())
        {
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

    /// Restores a transition (for undo paths).
    ///
    /// Validates the transition and checks capacity, but skips the duplicate ID check.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the transition is invalid or the document
    /// is at capacity.
    pub fn restore_transition(
        &mut self,
        transition: crate::prototype::Transition,
    ) -> Result<(), CoreError> {
        crate::prototype::validate_transition(&transition)?;
        if self.transitions.len() >= crate::validate::MAX_TRANSITIONS_PER_DOCUMENT
            && !self.transitions.iter().any(|t| t.id == transition.id)
        {
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

    /// Executes a command, pushing it to the undo stack.
    /// Clears the redo stack. Evicts oldest command if stack exceeds `max_history`.
    ///
    /// # Errors
    /// Returns `CoreError` if the command's `apply` fails.
    pub fn execute(&mut self, cmd: Box<dyn Command>) -> Result<Vec<SideEffect>, CoreError> {
        let effects = cmd.apply(self)?;
        for effect in &effects {
            effect.validate()?;
        }
        self.history.redo_stack.clear();
        self.history.undo_stack.push_back(cmd);
        if self.history.undo_stack.len() > self.history.max_history {
            self.history.undo_stack.pop_front();
        }
        Ok(effects)
    }

    /// Undoes the most recent command.
    ///
    /// # Errors
    /// Returns `CoreError::NothingToUndo` if the undo stack is empty.
    pub fn undo(&mut self) -> Result<Vec<SideEffect>, CoreError> {
        let cmd = self
            .history
            .undo_stack
            .pop_back()
            .ok_or(CoreError::NothingToUndo)?;
        match cmd.undo(self) {
            Ok(effects) => {
                self.history.redo_stack.push_back(cmd);
                Ok(effects)
            }
            Err(e) => {
                self.history.undo_stack.push_back(cmd);
                Err(e)
            }
        }
    }

    /// Redoes the most recently undone command.
    ///
    /// # Errors
    /// Returns `CoreError::NothingToRedo` if the redo stack is empty.
    pub fn redo(&mut self) -> Result<Vec<SideEffect>, CoreError> {
        let cmd = self
            .history
            .redo_stack
            .pop_back()
            .ok_or(CoreError::NothingToRedo)?;
        match cmd.apply(self) {
            Ok(effects) => {
                self.history.undo_stack.push_back(cmd);
                Ok(effects)
            }
            Err(e) => {
                self.history.redo_stack.push_back(cmd);
                Err(e)
            }
        }
    }

    /// Returns true if there are commands that can be undone.
    #[must_use]
    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    /// Returns true if there are commands that can be redone.
    #[must_use]
    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
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
        doc.add_page(Page::new(page_id, "Home".to_string()))
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
        doc.add_page(Page::new(page_id, "Home".to_string()))
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
        doc.add_page(Page::new(page_id, "Home".to_string()))
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
        doc.add_page(Page::new(page_id, "Home".to_string()))
            .expect("add page");
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

    #[test]
    fn test_undo_empty_returns_error() {
        let mut doc = Document::new("Test".to_string());
        let result = doc.undo();
        assert!(matches!(result, Err(CoreError::NothingToUndo)));
    }

    #[test]
    fn test_redo_empty_returns_error() {
        let mut doc = Document::new("Test".to_string());
        let result = doc.redo();
        assert!(matches!(result, Err(CoreError::NothingToRedo)));
    }

    #[test]
    fn test_execute_pushes_to_undo_stack() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        // We'll use a simple test command — SetVisible
        let cmd = crate::commands::node_commands::SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };

        doc.execute(Box::new(cmd)).expect("execute");
        assert!(!doc.arena.get(node_id).expect("get node").visible);
        assert!(doc.can_undo());
        assert!(!doc.can_redo());
    }

    #[test]
    fn test_undo_reverses_command() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        let cmd = crate::commands::node_commands::SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };

        doc.execute(Box::new(cmd)).expect("execute");
        assert!(!doc.arena.get(node_id).expect("get node").visible);

        doc.undo().expect("undo");
        assert!(doc.arena.get(node_id).expect("get node").visible);
        assert!(!doc.can_undo());
        assert!(doc.can_redo());
    }

    #[test]
    fn test_redo_reapplies_command() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        let cmd = crate::commands::node_commands::SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };

        doc.execute(Box::new(cmd)).expect("execute");
        doc.undo().expect("undo");
        doc.redo().expect("redo");
        assert!(!doc.arena.get(node_id).expect("get node").visible);
        assert!(doc.can_undo());
        assert!(!doc.can_redo());
    }

    #[test]
    fn test_execute_clears_redo_stack() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        let cmd1 = crate::commands::node_commands::SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };
        let cmd2 = crate::commands::node_commands::SetVisible {
            node_id,
            new_visible: true,
            old_visible: false,
        };

        doc.execute(Box::new(cmd1)).expect("execute cmd1");
        doc.undo().expect("undo cmd1");
        assert!(doc.can_redo());

        doc.execute(Box::new(cmd2)).expect("execute cmd2");
        assert!(!doc.can_redo()); // redo stack cleared
    }

    #[test]
    fn test_history_eviction_fifo() {
        let mut doc = Document::new("Test".to_string());
        doc.history = History::new(2); // max 2 undo entries

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        // Execute 3 commands with max_history=2
        for i in 0..3u8 {
            let cmd = crate::commands::node_commands::RenameNode {
                node_id,
                new_name: format!("Name {i}"),
                old_name: if i == 0 {
                    "Frame".to_string()
                } else {
                    format!("Name {}", i - 1)
                },
            };
            doc.execute(Box::new(cmd)).expect("execute");
        }

        // Only 2 undos should be possible (oldest evicted)
        assert!(doc.undo().is_ok()); // undo "Name 2" -> "Name 1"
        assert!(doc.undo().is_ok()); // undo "Name 1" -> "Name 0"
        assert!(doc.undo().is_err()); // nothing left — "Name 0" -> "Frame" was evicted
    }

    #[test]
    fn test_failed_undo_preserves_command() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        // Execute a SetVisible command so it lands on the undo stack
        let cmd = crate::commands::node_commands::SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };
        doc.execute(Box::new(cmd)).expect("execute");
        assert!(doc.can_undo());

        // Remove the node from the arena so that undo will fail
        // (the command tries to get_mut on a node that no longer exists)
        doc.arena.remove(node_id).expect("remove node");

        // Undo should fail because the node is gone
        let result = doc.undo();
        assert!(result.is_err());

        // The command must still be on the undo stack — not lost
        assert!(doc.can_undo());
    }

    #[test]
    fn test_failed_redo_preserves_command() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        // Execute then undo so the command lands on the redo stack
        let cmd = crate::commands::node_commands::SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };
        doc.execute(Box::new(cmd)).expect("execute");
        doc.undo().expect("undo");
        assert!(doc.can_redo());

        // Remove the node from the arena so that redo (apply) will fail
        doc.arena.remove(node_id).expect("remove node");

        // Redo should fail because the node is gone
        let result = doc.redo();
        assert!(result.is_err());

        // The command must still be on the redo stack — not lost
        assert!(doc.can_redo());
    }

    #[test]
    fn test_history_eviction_at_min_capacity_1() {
        let mut doc = Document::new("Test".to_string());
        doc.history = History::new(1);

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        // Execute 2 commands with max_history=1
        let cmd1 = crate::commands::node_commands::RenameNode {
            node_id,
            new_name: "Name 0".to_string(),
            old_name: "Frame".to_string(),
        };
        doc.execute(Box::new(cmd1)).expect("execute cmd1");

        let cmd2 = crate::commands::node_commands::RenameNode {
            node_id,
            new_name: "Name 1".to_string(),
            old_name: "Name 0".to_string(),
        };
        doc.execute(Box::new(cmd2)).expect("execute cmd2");

        // Only 1 undo should be possible (the oldest was evicted)
        assert!(doc.undo().is_ok()); // undo "Name 1" -> "Name 0"
        assert!(doc.undo().is_err()); // nothing left — "Name 0" -> "Frame" was evicted
    }

    #[test]
    fn test_history_min_capacity_enforced() {
        let h = History::new(0);
        assert_eq!(h.max_history(), 1, "max_history must be at least 1");

        let h2 = History::new(1);
        assert_eq!(h2.max_history(), 1);

        let h3 = History::new(100);
        assert_eq!(h3.max_history(), 100);
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
    fn test_add_component_enforces_max_limit() {
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
