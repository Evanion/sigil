// crates/core/src/commands/page_commands.rs
//
// Commands for page mutations: create, delete, rename.
// All page mutations flow through these commands so they participate in
// undo/redo and are broadcastable.

// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.
#![allow(clippy::unnecessary_literal_bound)]

use crate::command::{Command, SideEffect};
use crate::document::{Document, Page};
use crate::error::CoreError;
use crate::id::PageId;
use crate::validate::validate_page_name;

/// Creates a new page and adds it to the document.
#[derive(Debug)]
pub struct CreatePage {
    /// The ID for the new page.
    pub page_id: PageId,
    /// The name for the new page.
    pub name: String,
}

impl Command for CreatePage {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_page_name(&self.name)?;
        let page = Page::new(self.page_id, self.name.clone())?;
        doc.add_page(page)?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_page_name(&self.name)?;
        let pos = doc
            .pages
            .iter()
            .position(|p| p.id == self.page_id)
            .ok_or(CoreError::PageNotFound(self.page_id))?;
        doc.pages.remove(pos);
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Create page"
    }
}

/// Deletes a page from the document, capturing its full state for undo.
#[derive(Debug)]
pub struct DeletePage {
    /// The ID of the page to delete.
    pub page_id: PageId,
    /// Snapshot of the deleted page (captured on first apply for undo).
    pub snapshot: Option<Page>,
    /// Index position of the page at the time of deletion (for position-preserving undo).
    pub page_index: Option<usize>,
}

impl Command for DeletePage {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let pos = doc
            .pages
            .iter()
            .position(|p| p.id == self.page_id)
            .ok_or(CoreError::PageNotFound(self.page_id))?;

        let removed = doc.pages.remove(pos);

        // Store snapshot and index for undo via interior mutability is not possible
        // with &self. Instead, the caller must set snapshot before apply, or we
        // rely on the snapshot being set. Since the Command trait takes &self,
        // we use a Cell-like pattern. However, per project conventions we avoid
        // RefCell in core. Instead, we require the caller to pre-populate snapshot.
        //
        // If snapshot was not pre-populated, we need to store it. Since we can't
        // mutate &self, we need to check that snapshot is set. If it isn't, the
        // undo will fail with a clear error.
        //
        // Actually, looking at the existing pattern (e.g. DeleteNode), they use
        // public fields. The caller captures the snapshot before constructing the
        // command. Let's verify the page data is available for undo via snapshot.
        if self.snapshot.is_none() {
            // First apply: snapshot not set. The caller should have set it.
            // We cannot store it in &self. Return the page to the document
            // and error.
            doc.pages.insert(pos, removed);
            return Err(CoreError::ValidationError(
                "DeletePage: snapshot must be set before apply (capture the page state)"
                    .to_string(),
            ));
        }

        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let snapshot = self.snapshot.as_ref().ok_or_else(|| {
            CoreError::ValidationError("DeletePage: cannot undo without snapshot".to_string())
        })?;
        validate_page_name(&snapshot.name)?;

        let index = self.page_index.unwrap_or(doc.pages.len());
        let clamped_index = index.min(doc.pages.len());

        // Check capacity before inserting
        if doc.pages.len() >= crate::validate::MAX_PAGES_PER_DOCUMENT {
            return Err(CoreError::ValidationError(format!(
                "document already has {} pages (maximum {})",
                doc.pages.len(),
                crate::validate::MAX_PAGES_PER_DOCUMENT
            )));
        }

        doc.pages.insert(clamped_index, snapshot.clone());
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Delete page"
    }
}

/// Renames a page.
#[derive(Debug)]
pub struct RenamePage {
    /// The ID of the page to rename.
    pub page_id: PageId,
    /// The new name to assign.
    pub new_name: String,
    /// The previous name (captured for undo).
    pub old_name: String,
}

impl Command for RenamePage {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_page_name(&self.new_name)?;
        let page = doc.page_mut(self.page_id)?;
        page.name.clone_from(&self.new_name);
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_page_name(&self.old_name)?;
        let page = doc.page_mut(self.page_id)?;
        page.name.clone_from(&self.old_name);
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Rename page"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    // ── CreatePage ────────────────────────────────────────────────────

    #[test]
    fn test_create_page_execute_undo_redo_cycle() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));

        let cmd = CreatePage {
            page_id,
            name: "Home".to_string(),
        };

        // Execute
        doc.execute(Box::new(cmd)).expect("execute");
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].name, "Home");
        assert_eq!(doc.pages[0].id, page_id);

        // Undo
        doc.undo().expect("undo");
        assert!(doc.pages.is_empty());

        // Redo
        doc.redo().expect("redo");
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].name, "Home");
        assert_eq!(doc.pages[0].id, page_id);
    }

    #[test]
    fn test_create_page_rejects_empty_name() {
        let mut doc = Document::new("Test".to_string());
        let cmd = CreatePage {
            page_id: PageId::new(make_uuid(1)),
            name: String::new(),
        };
        assert!(doc.execute(Box::new(cmd)).is_err());
        assert!(doc.pages.is_empty());
    }

    #[test]
    fn test_create_page_rejects_control_chars() {
        let mut doc = Document::new("Test".to_string());
        let cmd = CreatePage {
            page_id: PageId::new(make_uuid(1)),
            name: "foo\nbar".to_string(),
        };
        assert!(doc.execute(Box::new(cmd)).is_err());
    }

    #[test]
    fn test_create_page_rejects_name_too_long() {
        let mut doc = Document::new("Test".to_string());
        let long_name = "a".repeat(crate::validate::MAX_PAGE_NAME_LEN + 1);
        let cmd = CreatePage {
            page_id: PageId::new(make_uuid(1)),
            name: long_name,
        };
        assert!(doc.execute(Box::new(cmd)).is_err());
    }

    // ── DeletePage ────────────────────────────────────────────────────

    #[test]
    fn test_delete_page_execute_undo_redo_cycle() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));

        // First create a page
        let create_cmd = CreatePage {
            page_id,
            name: "Home".to_string(),
        };
        doc.execute(Box::new(create_cmd)).expect("create page");
        assert_eq!(doc.pages.len(), 1);

        // Capture snapshot for delete
        let snapshot = doc.pages[0].clone();
        let delete_cmd = DeletePage {
            page_id,
            snapshot: Some(snapshot),
            page_index: Some(0),
        };

        // Execute delete
        doc.execute(Box::new(delete_cmd)).expect("delete page");
        assert!(doc.pages.is_empty());

        // Undo delete
        doc.undo().expect("undo delete");
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].name, "Home");
        assert_eq!(doc.pages[0].id, page_id);

        // Redo delete
        doc.redo().expect("redo delete");
        assert!(doc.pages.is_empty());
    }

    #[test]
    fn test_delete_page_preserves_position() {
        let mut doc = Document::new("Test".to_string());
        let page_a = PageId::new(make_uuid(1));
        let page_b = PageId::new(make_uuid(2));
        let page_c = PageId::new(make_uuid(3));

        for (id, name) in [(page_a, "A"), (page_b, "B"), (page_c, "C")] {
            let cmd = CreatePage {
                page_id: id,
                name: name.to_string(),
            };
            doc.execute(Box::new(cmd)).expect("create page");
        }

        // Delete the middle page (index 1)
        let snapshot = doc.pages[1].clone();
        let delete_cmd = DeletePage {
            page_id: page_b,
            snapshot: Some(snapshot),
            page_index: Some(1),
        };
        doc.execute(Box::new(delete_cmd)).expect("delete");
        assert_eq!(doc.pages.len(), 2);
        assert_eq!(doc.pages[0].name, "A");
        assert_eq!(doc.pages[1].name, "C");

        // Undo should restore at position 1
        doc.undo().expect("undo delete");
        assert_eq!(doc.pages.len(), 3);
        assert_eq!(doc.pages[0].name, "A");
        assert_eq!(doc.pages[1].name, "B");
        assert_eq!(doc.pages[2].name, "C");
    }

    #[test]
    fn test_delete_page_not_found() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(99));
        let cmd = DeletePage {
            page_id,
            snapshot: Some(Page::new(page_id, "Ghost".to_string()).expect("create page")),
            page_index: Some(0),
        };
        assert!(doc.execute(Box::new(cmd)).is_err());
    }

    #[test]
    fn test_delete_page_without_snapshot_errors() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        let create_cmd = CreatePage {
            page_id,
            name: "Home".to_string(),
        };
        doc.execute(Box::new(create_cmd)).expect("create");

        let delete_cmd = DeletePage {
            page_id,
            snapshot: None,
            page_index: None,
        };
        let result = doc.execute(Box::new(delete_cmd));
        assert!(result.is_err());
        // Page should still be there (restored before error)
        assert_eq!(doc.pages.len(), 1);
    }

    // ── RenamePage ────────────────────────────────────────────────────

    #[test]
    fn test_rename_page_execute_undo_redo_cycle() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));

        let create_cmd = CreatePage {
            page_id,
            name: "Old Name".to_string(),
        };
        doc.execute(Box::new(create_cmd)).expect("create page");

        let rename_cmd = RenamePage {
            page_id,
            new_name: "New Name".to_string(),
            old_name: "Old Name".to_string(),
        };

        // Execute rename
        doc.execute(Box::new(rename_cmd)).expect("rename");
        assert_eq!(doc.pages[0].name, "New Name");

        // Undo
        doc.undo().expect("undo rename");
        assert_eq!(doc.pages[0].name, "Old Name");

        // Redo
        doc.redo().expect("redo rename");
        assert_eq!(doc.pages[0].name, "New Name");
    }

    #[test]
    fn test_rename_page_rejects_empty_name() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));

        let create_cmd = CreatePage {
            page_id,
            name: "Home".to_string(),
        };
        doc.execute(Box::new(create_cmd)).expect("create");

        let rename_cmd = RenamePage {
            page_id,
            new_name: String::new(),
            old_name: "Home".to_string(),
        };
        assert!(doc.execute(Box::new(rename_cmd)).is_err());
        assert_eq!(doc.pages[0].name, "Home");
    }

    #[test]
    fn test_rename_page_not_found() {
        let mut doc = Document::new("Test".to_string());
        let cmd = RenamePage {
            page_id: PageId::new(make_uuid(99)),
            new_name: "New".to_string(),
            old_name: "Old".to_string(),
        };
        assert!(doc.execute(Box::new(cmd)).is_err());
    }

    #[test]
    fn test_rename_page_rejects_control_chars() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        let create_cmd = CreatePage {
            page_id,
            name: "Home".to_string(),
        };
        doc.execute(Box::new(create_cmd)).expect("create");

        let rename_cmd = RenamePage {
            page_id,
            new_name: "foo\tbar".to_string(),
            old_name: "Home".to_string(),
        };
        assert!(doc.execute(Box::new(rename_cmd)).is_err());
        assert_eq!(doc.pages[0].name, "Home");
    }
}
