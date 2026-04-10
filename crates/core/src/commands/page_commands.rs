// crates/core/src/commands/page_commands.rs
//
// Commands for page mutations: create, delete, rename.

use crate::command::FieldOperation;
use crate::document::{Document, Page};
use crate::error::CoreError;
use crate::id::PageId;
use crate::validate::{MIN_PAGES_PER_DOCUMENT, validate_page_name};

/// Creates a new page and adds it to the document.
#[derive(Debug)]
pub struct CreatePage {
    /// The ID for the new page.
    pub page_id: PageId,
    /// The name for the new page.
    pub name: String,
}

impl FieldOperation for CreatePage {
    fn validate(&self, _doc: &Document) -> Result<(), CoreError> {
        validate_page_name(&self.name)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        validate_page_name(&self.name)?;
        let page = Page::new(self.page_id, self.name.clone())?;
        doc.add_page(page)?;
        Ok(())
    }
}

/// Deletes a page from the document.
#[derive(Debug)]
pub struct DeletePage {
    /// The ID of the page to delete.
    pub page_id: PageId,
}

impl FieldOperation for DeletePage {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        doc.page(self.page_id)?;
        if doc.pages.len() <= MIN_PAGES_PER_DOCUMENT {
            return Err(CoreError::ValidationError(
                "cannot delete the last page".into(),
            ));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        if doc.pages.len() <= MIN_PAGES_PER_DOCUMENT {
            return Err(CoreError::ValidationError(
                "cannot delete the last page".into(),
            ));
        }
        let pos = doc
            .pages
            .iter()
            .position(|p| p.id == self.page_id)
            .ok_or(CoreError::PageNotFound(self.page_id))?;
        doc.pages.remove(pos);
        Ok(())
    }
}

/// Moves a page to a new position in the document's page list.
#[derive(Debug)]
pub struct ReorderPage {
    /// The ID of the page to move.
    pub page_id: PageId,
    /// The target zero-based index the page should occupy after the operation.
    pub new_position: usize,
}

impl FieldOperation for ReorderPage {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        doc.page(self.page_id)?;
        let max_index = doc.pages.len().saturating_sub(1);
        if self.new_position >= doc.pages.len() {
            return Err(CoreError::ValidationError(format!(
                "new_position {} out of range (0..={max_index})",
                self.new_position,
            )));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let old_pos = doc
            .pages
            .iter()
            .position(|p| p.id == self.page_id)
            .ok_or(CoreError::PageNotFound(self.page_id))?;
        let max_index = doc.pages.len().saturating_sub(1);
        if self.new_position >= doc.pages.len() {
            return Err(CoreError::ValidationError(format!(
                "new_position {} out of range (0..={max_index})",
                self.new_position,
            )));
        }
        let page = doc.pages.remove(old_pos);
        doc.pages.insert(self.new_position, page);
        Ok(())
    }
}

/// Renames a page.
#[derive(Debug)]
pub struct RenamePage {
    /// The ID of the page to rename.
    pub page_id: PageId,
    /// The new name to assign.
    pub new_name: String,
}

impl FieldOperation for RenamePage {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_page_name(&self.new_name)?;
        doc.page(self.page_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        validate_page_name(&self.new_name)?;
        let page = doc.page_mut(self.page_id)?;
        page.name.clone_from(&self.new_name);
        Ok(())
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
    fn test_create_page_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));

        let op = CreatePage {
            page_id,
            name: "Home".to_string(),
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].name, "Home");
        assert_eq!(doc.pages[0].id, page_id);
    }

    #[test]
    fn test_create_page_rejects_empty_name() {
        let doc = Document::new("Test".to_string());
        let op = CreatePage {
            page_id: PageId::new(make_uuid(1)),
            name: String::new(),
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_create_page_rejects_control_chars() {
        let doc = Document::new("Test".to_string());
        let op = CreatePage {
            page_id: PageId::new(make_uuid(1)),
            name: "foo\nbar".to_string(),
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_create_page_rejects_name_too_long() {
        let doc = Document::new("Test".to_string());
        let long_name = "a".repeat(crate::validate::MAX_PAGE_NAME_LEN + 1);
        let op = CreatePage {
            page_id: PageId::new(make_uuid(1)),
            name: long_name,
        };
        assert!(op.validate(&doc).is_err());
    }

    // ── DeletePage ────────────────────────────────────────────────────

    #[test]
    fn test_delete_page_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        let page_id_2 = PageId::new(make_uuid(2));

        CreatePage {
            page_id,
            name: "Home".to_string(),
        }
        .apply(&mut doc)
        .expect("create page 1");
        CreatePage {
            page_id: page_id_2,
            name: "About".to_string(),
        }
        .apply(&mut doc)
        .expect("create page 2");
        assert_eq!(doc.pages.len(), 2);

        let delete_op = DeletePage { page_id };
        delete_op.validate(&doc).expect("validate");
        delete_op.apply(&mut doc).expect("apply");
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].id, page_id_2);
    }

    #[test]
    fn test_delete_page_not_found() {
        let mut doc = Document::new("Test".to_string());
        // Need at least one page so the "last page" guard doesn't fire first.
        CreatePage {
            page_id: PageId::new(make_uuid(1)),
            name: "Home".to_string(),
        }
        .apply(&mut doc)
        .expect("create page");
        CreatePage {
            page_id: PageId::new(make_uuid(2)),
            name: "About".to_string(),
        }
        .apply(&mut doc)
        .expect("create page 2");

        let op = DeletePage {
            page_id: PageId::new(make_uuid(99)),
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_delete_last_page_is_rejected() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        CreatePage {
            page_id,
            name: "Only Page".to_string(),
        }
        .apply(&mut doc)
        .expect("create page");
        assert_eq!(doc.pages.len(), 1);

        let delete_op = DeletePage { page_id };
        let result = delete_op.validate(&doc);
        assert!(result.is_err());
        assert!(
            matches!(&result, Err(CoreError::ValidationError(msg)) if msg.contains("last page"))
        );
    }

    #[test]
    fn test_min_pages_per_document_enforced() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        CreatePage {
            page_id,
            name: "Only".to_string(),
        }
        .apply(&mut doc)
        .expect("create");

        // Document has exactly MIN_PAGES_PER_DOCUMENT pages (1).
        // Attempting to delete should fail.
        let delete_op = DeletePage { page_id };
        assert!(delete_op.validate(&doc).is_err());
        assert!(delete_op.apply(&mut doc).is_err());
        // Page must still be present.
        assert_eq!(doc.pages.len(), 1);
    }

    // ── RenamePage ────────────────────────────────────────────────────

    #[test]
    fn test_rename_page_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));

        let create_op = CreatePage {
            page_id,
            name: "Old Name".to_string(),
        };
        create_op.apply(&mut doc).expect("create page");

        let rename_op = RenamePage {
            page_id,
            new_name: "New Name".to_string(),
        };

        rename_op.validate(&doc).expect("validate");
        rename_op.apply(&mut doc).expect("apply");
        assert_eq!(doc.pages[0].name, "New Name");
    }

    #[test]
    fn test_rename_page_rejects_empty_name() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));

        let create_op = CreatePage {
            page_id,
            name: "Home".to_string(),
        };
        create_op.apply(&mut doc).expect("create");

        let rename_op = RenamePage {
            page_id,
            new_name: String::new(),
        };
        assert!(rename_op.validate(&doc).is_err());
    }

    #[test]
    fn test_rename_page_not_found() {
        let doc = Document::new("Test".to_string());
        let op = RenamePage {
            page_id: PageId::new(make_uuid(99)),
            new_name: "New".to_string(),
        };
        assert!(op.validate(&doc).is_err());
    }

    // ── ReorderPage ───────────────────────────────────────────────────

    fn make_doc_with_three_pages() -> (Document, PageId, PageId, PageId) {
        let mut doc = Document::new("Test".to_string());
        let page_a = PageId::new(make_uuid(10));
        let page_b = PageId::new(make_uuid(11));
        let page_c = PageId::new(make_uuid(12));
        CreatePage {
            page_id: page_a,
            name: "Page A".to_string(),
        }
        .apply(&mut doc)
        .expect("create A");
        CreatePage {
            page_id: page_b,
            name: "Page B".to_string(),
        }
        .apply(&mut doc)
        .expect("create B");
        CreatePage {
            page_id: page_c,
            name: "Page C".to_string(),
        }
        .apply(&mut doc)
        .expect("create C");
        (doc, page_a, page_b, page_c)
    }

    #[test]
    fn test_reorder_page_validate_and_apply() {
        let (mut doc, page_a, page_b, page_c) = make_doc_with_three_pages();

        let op = ReorderPage {
            page_id: page_c,
            new_position: 0,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        assert_eq!(doc.pages[0].id, page_c);
        assert_eq!(doc.pages[1].id, page_a);
        assert_eq!(doc.pages[2].id, page_b);
    }

    #[test]
    fn test_reorder_page_move_to_last_position() {
        let (mut doc, page_a, page_b, page_c) = make_doc_with_three_pages();

        let op = ReorderPage {
            page_id: page_a,
            new_position: 2,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        assert_eq!(doc.pages[0].id, page_b);
        assert_eq!(doc.pages[1].id, page_c);
        assert_eq!(doc.pages[2].id, page_a);
    }

    #[test]
    fn test_reorder_page_same_position_is_no_op() {
        let (mut doc, page_a, page_b, page_c) = make_doc_with_three_pages();

        // Moving page_b (index 1) to position 1 is a no-op — should succeed.
        let op = ReorderPage {
            page_id: page_b,
            new_position: 1,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        assert_eq!(doc.pages[0].id, page_a);
        assert_eq!(doc.pages[1].id, page_b);
        assert_eq!(doc.pages[2].id, page_c);
    }

    #[test]
    fn test_reorder_page_not_found() {
        let (doc, _, _, _) = make_doc_with_three_pages();
        let op = ReorderPage {
            page_id: PageId::new(make_uuid(99)),
            new_position: 0,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_reorder_page_position_out_of_range() {
        let (doc, page_a, _, _) = make_doc_with_three_pages();
        // doc has 3 pages (indices 0..2); position 3 is out of range.
        let op = ReorderPage {
            page_id: page_a,
            new_position: 3,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_rename_page_rejects_control_chars() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        let create_op = CreatePage {
            page_id,
            name: "Home".to_string(),
        };
        create_op.apply(&mut doc).expect("create");

        let rename_op = RenamePage {
            page_id,
            new_name: "foo\tbar".to_string(),
        };
        assert!(rename_op.validate(&doc).is_err());
    }
}
