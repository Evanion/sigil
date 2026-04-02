use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
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
///
/// RF-009: Returns HTTP 500 if the document mutex is poisoned instead of
/// panicking, allowing the server to continue serving other requests.
pub async fn get_document_info(State(state): State<AppState>) -> Response {
    let doc_guard = match state.document.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::error!("document mutex poisoned in get_document_info, recovering");
            poisoned.into_inner()
        }
    };
    let info = DocumentInfo {
        name: doc_guard.0.metadata.name.clone(),
        page_count: doc_guard.0.pages.len(),
        node_count: doc_guard.0.arena.len(),
        can_undo: doc_guard.0.can_undo(),
        can_redo: doc_guard.0.can_redo(),
    };
    drop(doc_guard);
    (StatusCode::OK, Json(info)).into_response()
}
