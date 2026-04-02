use axum::Json;
use axum::extract::State;
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct DocumentInfo {
    pub name: String,
    pub page_count: usize,
    pub node_count: usize,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Returns basic info about the current document.
pub async fn get_document_info(State(state): State<AppState>) -> Json<DocumentInfo> {
    let doc = state.document.lock().expect("document lock poisoned");
    Json(DocumentInfo {
        name: doc.metadata.name.clone(),
        page_count: doc.pages.len(),
        node_count: doc.arena.len(),
        can_undo: doc.can_undo(),
        can_redo: doc.can_redo(),
    })
}
