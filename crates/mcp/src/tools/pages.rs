//! Page operation tools — list, create, rename, delete.

use agent_designer_core::{Page, PageId};
use agent_designer_state::AppState;

use crate::error::McpToolError;
use crate::server::acquire_document_lock;
use crate::types::{MutationResult, PageInfo};

/// Lists all pages in the document.
///
/// Returns page IDs, names, and the UUIDs of all root-level nodes on each page.
#[must_use]
pub fn list_pages_impl(state: &AppState) -> Vec<PageInfo> {
    let doc = acquire_document_lock(state);
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
/// Generates a fresh UUID for the page, signals the persistence layer, and
/// returns a `PageInfo` describing the newly created page.
///
/// # Errors
///
/// Returns `McpToolError::CoreError` if the document has reached its maximum
/// page count.
pub fn create_page_impl(state: &AppState, name: &str) -> Result<PageInfo, McpToolError> {
    let page_uuid = uuid::Uuid::new_v4();
    let page_id = PageId::new(page_uuid);
    let page = Page::new(page_id, name.to_string());

    {
        let mut doc = acquire_document_lock(state);
        doc.add_page(page)?;
    }

    state.signal_dirty();

    Ok(PageInfo {
        id: page_uuid.to_string(),
        name: name.to_string(),
        root_nodes: vec![],
    })
}

/// Deletes a page by UUID.
///
/// Finds the page by its UUID string, removes it from the document's page
/// list, and signals persistence.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `page_uuid_str` is not a valid UUID.
/// - `McpToolError::PageNotFound` if no page with the given UUID exists.
pub fn delete_page_impl(
    state: &AppState,
    page_uuid_str: &str,
) -> Result<MutationResult, McpToolError> {
    let page_uuid: uuid::Uuid = page_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(page_uuid_str.to_string()))?;
    let page_id = PageId::new(page_uuid);

    {
        let mut doc = acquire_document_lock(state);
        let pos = doc
            .pages
            .iter()
            .position(|p| p.id == page_id)
            .ok_or_else(|| McpToolError::PageNotFound(page_uuid_str.to_string()))?;
        doc.pages.remove(pos);
    }

    state.signal_dirty();

    Ok(MutationResult {
        success: true,
        message: format!("Page {page_uuid_str} deleted"),
    })
}

/// Renames a page identified by UUID.
///
/// Finds the page, updates its name in-place, and returns a `PageInfo`
/// reflecting the new state.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `page_uuid_str` is not a valid UUID.
/// - `McpToolError::PageNotFound` if no page with the given UUID exists.
pub fn rename_page_impl(
    state: &AppState,
    page_uuid_str: &str,
    new_name: &str,
) -> Result<PageInfo, McpToolError> {
    let page_uuid: uuid::Uuid = page_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(page_uuid_str.to_string()))?;
    let page_id = PageId::new(page_uuid);

    // Collect root node IDs before taking the mutable borrow so we can call
    // `arena.uuid_of` without holding two borrows on `doc` simultaneously.
    let root_uuids = {
        let mut doc = acquire_document_lock(state);

        // Verify page exists and update its name.
        let root_node_ids: Vec<agent_designer_core::NodeId> = {
            let page = doc
                .page_mut(page_id)
                .map_err(|_| McpToolError::PageNotFound(page_uuid_str.to_string()))?;
            page.name = new_name.to_string();
            page.root_nodes.clone()
        };

        // Now that the mutable borrow on `page` is released, resolve NodeIds
        // to UUIDs through the arena.
        root_node_ids
            .iter()
            .filter_map(|&nid| doc.arena.uuid_of(nid).ok().map(|u| u.to_string()))
            .collect::<Vec<_>>()
    };

    state.signal_dirty();

    Ok(PageInfo {
        id: page_uuid_str.to_string(),
        name: new_name.to_string(),
        root_nodes: root_uuids,
    })
}

#[cfg(test)]
mod tests {
    use agent_designer_state::AppState;

    use super::*;

    #[test]
    fn test_list_pages_empty_document() {
        let state = AppState::new();
        let pages = list_pages_impl(&state);
        assert!(pages.is_empty());
    }

    #[test]
    fn test_create_page_adds_page() {
        let state = AppState::new();
        let result = create_page_impl(&state, "Home");
        assert!(result.is_ok());
        let pages = list_pages_impl(&state);
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].name, "Home");
    }

    #[test]
    fn test_delete_page_removes_page() {
        let state = AppState::new();
        let page = create_page_impl(&state, "Temp").unwrap();
        let result = delete_page_impl(&state, &page.id);
        assert!(result.is_ok());
        assert!(list_pages_impl(&state).is_empty());
    }

    #[test]
    fn test_delete_nonexistent_page_returns_error() {
        let state = AppState::new();
        let result = delete_page_impl(&state, &uuid::Uuid::new_v4().to_string());
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::PageNotFound(_)));
    }

    #[test]
    fn test_rename_page_updates_name() {
        let state = AppState::new();
        let page = create_page_impl(&state, "Old Name").unwrap();
        let renamed = rename_page_impl(&state, &page.id, "New Name").unwrap();
        assert_eq!(renamed.name, "New Name");
        assert_eq!(renamed.id, page.id);
        // Verify the document state was actually updated.
        let pages = list_pages_impl(&state);
        assert_eq!(pages[0].name, "New Name");
    }
}
