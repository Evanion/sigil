//! Page operation tools — list, create, rename, delete.
//!
//! All mutations follow the pattern:
//!   lock → construct operation →
//!   `op.validate(&doc)?; op.apply(&mut doc)?;` → build response → drop lock → `signal_dirty`

use agent_designer_core::FieldOperation;
use agent_designer_core::PageId;
use agent_designer_core::commands::page_commands::{
    CreatePage, DeletePage, RenamePage, ReorderPage,
};
use agent_designer_state::{AppState, MutationEventKind};

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
/// # Errors
///
/// Returns `McpToolError::CoreError` if validation fails or the document
/// has reached its maximum page count.
pub fn create_page_impl(state: &AppState, name: &str) -> Result<PageInfo, McpToolError> {
    let page_uuid = uuid::Uuid::new_v4();
    let page_id = PageId::new(page_uuid);

    {
        let mut doc = acquire_document_lock(state);
        let cmd = CreatePage {
            page_id,
            name: name.to_string(),
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    super::broadcast::broadcast_and_persist(
        state,
        MutationEventKind::PageCreated,
        &page_uuid.to_string(),
        "create",
        "page",
        Some(serde_json::json!({"name": name})),
    );

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
    state: &AppState,
    page_uuid_str: &str,
) -> Result<MutationResult, McpToolError> {
    let page_uuid: uuid::Uuid = page_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(page_uuid_str.to_string()))?;
    let page_id = PageId::new(page_uuid);

    {
        let mut doc = acquire_document_lock(state);

        // Verify page exists before deleting.
        doc.pages
            .iter()
            .find(|p| p.id == page_id)
            .ok_or_else(|| McpToolError::PageNotFound(page_uuid_str.to_string()))?;

        let cmd = DeletePage { page_id };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;
    }

    super::broadcast::broadcast_and_persist(
        state,
        MutationEventKind::PageDeleted,
        page_uuid_str,
        "delete",
        "page",
        None,
    );

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
    state: &AppState,
    page_uuid_str: &str,
    new_name: &str,
) -> Result<PageInfo, McpToolError> {
    let page_uuid: uuid::Uuid = page_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(page_uuid_str.to_string()))?;
    let page_id = PageId::new(page_uuid);

    let root_uuids = {
        let mut doc = acquire_document_lock(state);

        let page = doc
            .page(page_id)
            .map_err(|_| McpToolError::PageNotFound(page_uuid_str.to_string()))?;
        let root_node_ids: Vec<agent_designer_core::NodeId> = page.root_nodes.clone();

        let cmd = RenamePage {
            page_id,
            new_name: new_name.to_string(),
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        // Resolve NodeIds to UUIDs.
        root_node_ids
            .iter()
            .filter_map(|&nid| doc.arena.uuid_of(nid).ok().map(|u| u.to_string()))
            .collect::<Vec<_>>()
    };

    super::broadcast::broadcast_and_persist(
        state,
        MutationEventKind::PageUpdated,
        page_uuid_str,
        "set_field",
        "name",
        Some(serde_json::json!(new_name)),
    );

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
    state: &AppState,
    page_uuid_str: &str,
    new_position: u32,
) -> Result<PageInfo, McpToolError> {
    let page_uuid: uuid::Uuid = page_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(page_uuid_str.to_string()))?;
    let page_id = PageId::new(page_uuid);

    let root_uuids = {
        let mut doc = acquire_document_lock(state);

        let page = doc
            .page(page_id)
            .map_err(|_| McpToolError::PageNotFound(page_uuid_str.to_string()))?;
        let root_node_ids: Vec<agent_designer_core::NodeId> = page.root_nodes.clone();
        let page_name = page.name.clone();

        let cmd = ReorderPage {
            page_id,
            new_position: new_position as usize,
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        // Resolve NodeIds to UUIDs after the mutation.
        let resolved = root_node_ids
            .iter()
            .filter_map(|&nid| doc.arena.uuid_of(nid).ok().map(|u| u.to_string()))
            .collect::<Vec<_>>();

        (resolved, page_name)
    };

    let (root_node_uuids, name) = root_uuids;

    super::broadcast::broadcast_and_persist(
        state,
        MutationEventKind::PageUpdated,
        page_uuid_str,
        "reorder_page",
        "position",
        Some(serde_json::json!({ "newPosition": new_position })),
    );

    Ok(PageInfo {
        id: page_uuid_str.to_string(),
        name,
        root_nodes: root_node_uuids,
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
    fn test_create_page_rejects_empty_name() {
        let state = AppState::new();
        let result = create_page_impl(&state, "");
        assert!(result.is_err());
        assert!(list_pages_impl(&state).is_empty());
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

    #[test]
    fn test_rename_page_rejects_empty_name() {
        let state = AppState::new();
        let page = create_page_impl(&state, "Home").unwrap();
        let result = rename_page_impl(&state, &page.id, "");
        assert!(result.is_err());
        // Original name should be preserved.
        let pages = list_pages_impl(&state);
        assert_eq!(pages[0].name, "Home");
    }

    #[test]
    fn test_reorder_page_moves_page_to_new_position() {
        let state = AppState::new();
        let page_a = create_page_impl(&state, "Page A").unwrap();
        let page_b = create_page_impl(&state, "Page B").unwrap();
        let page_c = create_page_impl(&state, "Page C").unwrap();

        // Move "Page A" (currently at index 0) to index 2.
        let result = reorder_page_impl(&state, &page_a.id, 2);
        assert!(result.is_ok(), "reorder should succeed");

        let pages = list_pages_impl(&state);
        assert_eq!(pages.len(), 3);
        assert_eq!(pages[0].id, page_b.id);
        assert_eq!(pages[1].id, page_c.id);
        assert_eq!(pages[2].id, page_a.id);
    }

    #[test]
    fn test_reorder_page_invalid_uuid_returns_error() {
        let state = AppState::new();
        let result = reorder_page_impl(&state, "not-a-uuid", 0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::InvalidUuid(_)));
    }

    #[test]
    fn test_reorder_page_nonexistent_page_returns_error() {
        let state = AppState::new();
        let result = reorder_page_impl(&state, &uuid::Uuid::new_v4().to_string(), 0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpToolError::PageNotFound(_)));
    }

    #[test]
    fn test_reorder_page_out_of_range_position_returns_error() {
        let state = AppState::new();
        let page = create_page_impl(&state, "Only Page").unwrap();
        // Position 1 is out of range for a single-page document (valid: 0 only).
        let result = reorder_page_impl(&state, &page.id, 1);
        assert!(result.is_err());
    }
}
