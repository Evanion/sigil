//! Page operation tools — list, create, rename, delete.
//!
//! Write `_impl`s are pure functions over `&mut Document`; the session-scoped
//! envelope in `crate::server` holds the session store write lock, runs the
//! `_impl`, builds the broadcast `value` from post-mutation state, and publishes
//! on the session's broadcast channel. Read `_impl`s take `&Document`.

use sigil_core::FieldOperation;
use sigil_core::PageId;
use sigil_core::commands::page_commands::{CreatePage, DeletePage, RenamePage, ReorderPage};

use crate::error::McpToolError;
use crate::types::{MutationResult, PageInfo};

/// Lists all pages in the document.
///
/// Returns page IDs, names, and the UUIDs of all root-level nodes on each page.
/// Pure read over `&Document`; the caller holds the session store read lock.
#[must_use]
pub fn list_pages_impl(doc: &sigil_core::Document) -> Vec<PageInfo> {
    doc.pages
        .iter()
        .map(|page| {
            let root_uuids: Vec<String> = page
                .root_nodes
                .iter()
                .filter_map(|&nid| doc.arena.uuid_of(nid).ok().map(|u| u.to_string()))
                .collect();
            PageInfo {
                id: page.id.uuid().to_string(),
                name: page.name.clone(),
                root_nodes: root_uuids,
            }
        })
        .collect()
}

/// Creates a new page with the given name and adds it to the document.
///
/// # Errors
///
/// Returns `McpToolError::CoreError` if validation fails or the document
/// has reached its maximum page count.
pub fn create_page_impl(
    doc: &mut sigil_core::Document,
    name: &str,
) -> Result<PageInfo, McpToolError> {
    let page_uuid = uuid::Uuid::new_v4();
    let page_id = PageId::new(page_uuid);

    let cmd = CreatePage {
        page_id,
        name: name.to_string(),
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    Ok(PageInfo {
        id: page_uuid.to_string(),
        name: name.to_string(),
        root_nodes: vec![],
    })
}

/// Deletes a page by UUID.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `page_uuid_str` is not a valid UUID.
/// - `McpToolError::PageNotFound` if no page with the given UUID exists.
pub fn delete_page_impl(
    doc: &mut sigil_core::Document,
    page_uuid_str: &str,
) -> Result<MutationResult, McpToolError> {
    let page_uuid: uuid::Uuid = page_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(page_uuid_str.to_string()))?;
    let page_id = PageId::new(page_uuid);

    // Verify page exists before deleting.
    doc.pages
        .iter()
        .find(|p| p.id == page_id)
        .ok_or_else(|| McpToolError::PageNotFound(page_uuid_str.to_string()))?;

    let cmd = DeletePage { page_id };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    Ok(MutationResult {
        success: true,
        message: format!("Page {page_uuid_str} deleted"),
    })
}

/// Renames a page identified by UUID.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `page_uuid_str` is not a valid UUID.
/// - `McpToolError::PageNotFound` if no page with the given UUID exists.
/// - `McpToolError::CoreError` if the new name fails validation.
pub fn rename_page_impl(
    doc: &mut sigil_core::Document,
    page_uuid_str: &str,
    new_name: &str,
) -> Result<PageInfo, McpToolError> {
    let page_uuid: uuid::Uuid = page_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(page_uuid_str.to_string()))?;
    let page_id = PageId::new(page_uuid);

    let page = doc
        .page(page_id)
        .map_err(|_| McpToolError::PageNotFound(page_uuid_str.to_string()))?;
    let root_node_ids: Vec<sigil_core::NodeId> = page.root_nodes.clone();

    let cmd = RenamePage {
        page_id,
        new_name: new_name.to_string(),
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    // Resolve NodeIds to UUIDs.
    let root_uuids = root_node_ids
        .iter()
        .filter_map(|&nid| doc.arena.uuid_of(nid).ok().map(|u| u.to_string()))
        .collect::<Vec<_>>();

    Ok(PageInfo {
        id: page_uuid_str.to_string(),
        name: new_name.to_string(),
        root_nodes: root_uuids,
    })
}

/// Moves a page to a new position in the document's page list.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `page_uuid_str` is not a valid UUID.
/// - `McpToolError::PageNotFound` if no page with the given UUID exists.
/// - `McpToolError::CoreError` if `new_position` is out of range.
pub fn reorder_page_impl(
    doc: &mut sigil_core::Document,
    page_uuid_str: &str,
    new_position: u32,
) -> Result<PageInfo, McpToolError> {
    let page_uuid: uuid::Uuid = page_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(page_uuid_str.to_string()))?;
    let page_id = PageId::new(page_uuid);

    let page = doc
        .page(page_id)
        .map_err(|_| McpToolError::PageNotFound(page_uuid_str.to_string()))?;
    let root_node_ids: Vec<sigil_core::NodeId> = page.root_nodes.clone();
    let page_name = page.name.clone();

    let cmd = ReorderPage {
        page_id,
        new_position: new_position as usize,
    };
    cmd.validate(doc)?;
    cmd.apply(doc)?;

    // Resolve NodeIds to UUIDs after the mutation.
    let root_node_uuids = root_node_ids
        .iter()
        .filter_map(|&nid| doc.arena.uuid_of(nid).ok().map(|u| u.to_string()))
        .collect::<Vec<_>>();

    Ok(PageInfo {
        id: page_uuid_str.to_string(),
        name: page_name,
        root_nodes: root_node_uuids,
    })
}

#[cfg(test)]
mod tests {
    use sigil_core::Document;

    use super::*;

    fn new_doc() -> Document {
        Document::new("Untitled".to_string())
    }

    #[test]
    fn test_list_pages_empty_document() {
        let doc = new_doc();
        let pages = list_pages_impl(&doc);
        assert!(pages.is_empty());
    }

    #[test]
    fn test_create_page_adds_page() {
        let mut doc = new_doc();
        let result = create_page_impl(&mut doc, "Home");
        assert!(result.is_ok());
        let pages = list_pages_impl(&doc);
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].name, "Home");
    }

    #[test]
    fn test_create_page_rejects_empty_name() {
        let mut doc = new_doc();
        let result = create_page_impl(&mut doc, "");
        assert!(result.is_err());
        assert!(list_pages_impl(&doc).is_empty());
    }

    #[test]
    fn test_delete_page_removes_page() {
        let mut doc = new_doc();
        let _keeper = create_page_impl(&mut doc, "Keeper").unwrap();
        let page = create_page_impl(&mut doc, "Temp").unwrap();
        let result = delete_page_impl(&mut doc, &page.id);
        assert!(result.is_ok());
        let pages = list_pages_impl(&doc);
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].name, "Keeper");
    }

    #[test]
    fn test_delete_nonexistent_page_returns_error() {
        let mut doc = new_doc();
        let result = delete_page_impl(&mut doc, &uuid::Uuid::new_v4().to_string());
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::PageNotFound(_)));
    }

    #[test]
    fn test_rename_page_updates_name() {
        let mut doc = new_doc();
        let page = create_page_impl(&mut doc, "Old Name").unwrap();
        let renamed = rename_page_impl(&mut doc, &page.id, "New Name").unwrap();
        assert_eq!(renamed.name, "New Name");
        assert_eq!(renamed.id, page.id);
        // Verify the document state was actually updated.
        let pages = list_pages_impl(&doc);
        assert_eq!(pages[0].name, "New Name");
    }

    #[test]
    fn test_rename_page_rejects_empty_name() {
        let mut doc = new_doc();
        let page = create_page_impl(&mut doc, "Home").unwrap();
        let result = rename_page_impl(&mut doc, &page.id, "");
        assert!(result.is_err());
        // Original name should be preserved.
        let pages = list_pages_impl(&doc);
        assert_eq!(pages[0].name, "Home");
    }

    #[test]
    fn test_reorder_page_moves_page_to_new_position() {
        let mut doc = new_doc();
        let page_a = create_page_impl(&mut doc, "Page A").unwrap();
        let page_b = create_page_impl(&mut doc, "Page B").unwrap();
        let page_c = create_page_impl(&mut doc, "Page C").unwrap();

        // Move "Page A" (currently at index 0) to index 2.
        let result = reorder_page_impl(&mut doc, &page_a.id, 2);
        assert!(result.is_ok(), "reorder should succeed");

        let pages = list_pages_impl(&doc);
        assert_eq!(pages.len(), 3);
        assert_eq!(pages[0].id, page_b.id);
        assert_eq!(pages[1].id, page_c.id);
        assert_eq!(pages[2].id, page_a.id);
    }

    #[test]
    fn test_reorder_page_invalid_uuid_returns_error() {
        let mut doc = new_doc();
        let result = reorder_page_impl(&mut doc, "not-a-uuid", 0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidUuid(_)));
    }

    #[test]
    fn test_reorder_page_nonexistent_page_returns_error() {
        let mut doc = new_doc();
        let result = reorder_page_impl(&mut doc, &uuid::Uuid::new_v4().to_string(), 0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::PageNotFound(_)));
    }

    #[test]
    fn test_reorder_page_out_of_range_position_returns_error() {
        let mut doc = new_doc();
        let page = create_page_impl(&mut doc, "Only Page").unwrap();
        // Position 1 is out of range for a single-page document (valid: 0 only).
        let result = reorder_page_impl(&mut doc, &page.id, 1);
        assert!(result.is_err());
    }
}
