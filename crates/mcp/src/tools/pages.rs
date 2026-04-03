//! Page operation tools — list, create, rename, delete.
//!
//! All mutations follow the pattern:
//!   lock -> capture old state -> construct command ->
//!   `doc.execute(Box::new(cmd))` -> build response -> drop lock -> `signal_dirty`

use agent_designer_core::PageId;
use agent_designer_core::commands::page_commands::{CreatePage, DeletePage, RenamePage};
use agent_designer_state::{AppState, MutationEvent, MutationEventKind};

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
/// Routes through `Document::execute` so the operation participates in
/// undo/redo history.
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
        doc.execute(Box::new(cmd))?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::PageCreated,
        uuid: Some(page_uuid.to_string()),
        data: None,
    });

    Ok(PageInfo {
        id: page_uuid.to_string(),
        name: name.to_string(),
        root_nodes: vec![],
    })
}

/// Deletes a page by UUID.
///
/// Captures the page snapshot before deletion so undo can restore it at
/// the correct position.
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

        // Capture snapshot and position before deletion for undo support.
        let pos = doc
            .pages
            .iter()
            .position(|p| p.id == page_id)
            .ok_or_else(|| McpToolError::PageNotFound(page_uuid_str.to_string()))?;
        let snapshot = doc.pages[pos].clone();

        let cmd = DeletePage {
            page_id,
            snapshot: Some(snapshot),
            page_index: Some(pos),
        };
        doc.execute(Box::new(cmd))?;
    }

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::PageDeleted,
        uuid: Some(page_uuid_str.to_string()),
        data: None,
    });

    Ok(MutationResult {
        success: true,
        message: format!("Page {page_uuid_str} deleted"),
    })
}

/// Renames a page identified by UUID.
///
/// Captures the old name before rename so undo can restore it.
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

        // Capture old name for undo.
        let page = doc
            .page(page_id)
            .map_err(|_| McpToolError::PageNotFound(page_uuid_str.to_string()))?;
        let old_name = page.name.clone();
        let root_node_ids: Vec<agent_designer_core::NodeId> = page.root_nodes.clone();

        let cmd = RenamePage {
            page_id,
            new_name: new_name.to_string(),
            old_name,
        };
        doc.execute(Box::new(cmd))?;

        // Resolve NodeIds to UUIDs.
        root_node_ids
            .iter()
            .filter_map(|&nid| doc.arena.uuid_of(nid).ok().map(|u| u.to_string()))
            .collect::<Vec<_>>()
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::PageUpdated,
        uuid: Some(page_uuid_str.to_string()),
        data: Some(serde_json::json!({"field": "name"})),
    });

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
    fn test_create_page_participates_in_undo() {
        let state = AppState::new();
        create_page_impl(&state, "Home").expect("create");
        {
            let doc = acquire_document_lock(&state);
            assert!(doc.can_undo());
        }
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
    fn test_delete_page_participates_in_undo() {
        let state = AppState::new();
        let page = create_page_impl(&state, "Temp").unwrap();
        delete_page_impl(&state, &page.id).expect("delete");
        {
            let doc = acquire_document_lock(&state);
            assert!(doc.can_undo());
        }
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
    fn test_rename_page_participates_in_undo() {
        let state = AppState::new();
        let page = create_page_impl(&state, "Home").unwrap();
        rename_page_impl(&state, &page.id, "New Name").expect("rename");
        {
            let doc = acquire_document_lock(&state);
            assert!(doc.can_undo());
        }
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
}
