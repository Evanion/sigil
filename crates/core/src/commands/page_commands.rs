// crates/core/src/commands/page_commands.rs
//
// Commands for page mutations: create, delete, rename.

use crate::command::FieldOperation;
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
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let pos = doc
            .pages
            .iter()
            .position(|p| p.id == self.page_id)
            .ok_or(CoreError::PageNotFound(self.page_id))?;
        doc.pages.remove(pos);
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

        let create_op = CreatePage {
            page_id,
            name: "Home".to_string(),
        };
        create_op.apply(&mut doc).expect("create page");
        assert_eq!(doc.pages.len(), 1);

        let delete_op = DeletePage { page_id };
        delete_op.validate(&doc).expect("validate");
        delete_op.apply(&mut doc).expect("apply");
        assert!(doc.pages.is_empty());
    }

    #[test]
    fn test_delete_page_not_found() {
        let doc = Document::new("Test".to_string());
        let op = DeletePage {
            page_id: PageId::new(make_uuid(99)),
        };
        assert!(op.validate(&doc).is_err());
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
