use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use agent_designer_core::serialize::page_to_serialized;

use crate::state::AppState;

#[derive(Serialize)]
pub struct DocumentInfo {
    pub name: String,
    pub page_count: usize,
    pub node_count: usize,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// A page entry in the full document response.
#[derive(Serialize)]
pub struct FullPageEntry {
    pub id: String,
    pub name: String,
    pub nodes: Vec<agent_designer_core::SerializedNode>,
    pub transitions: Vec<agent_designer_core::SerializedTransition>,
}

/// Response shape for `GET /api/document/full`.
#[derive(Serialize)]
pub struct FullDocumentResponse {
    pub info: DocumentInfo,
    pub pages: Vec<FullPageEntry>,
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
        name: doc_guard.metadata.name.clone(),
        page_count: doc_guard.pages.len(),
        node_count: doc_guard.arena.len(),
        can_undo: doc_guard.can_undo(),
        can_redo: doc_guard.can_redo(),
    };
    drop(doc_guard);
    (StatusCode::OK, Json(info)).into_response()
}

/// Returns the full document state: info + all pages with serialized nodes
/// and transitions.
///
/// Acquires the document lock, iterates all pages, and serializes each page's
/// nodes using core's `page_to_serialized`. Returns HTTP 500 if serialization
/// fails or the mutex is poisoned.
pub async fn get_document_full(State(state): State<AppState>) -> Response {
    let doc_guard = match state.document.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::error!("document mutex poisoned in get_document_full, recovering");
            poisoned.into_inner()
        }
    };

    let info = DocumentInfo {
        name: doc_guard.metadata.name.clone(),
        page_count: doc_guard.pages.len(),
        node_count: doc_guard.arena.len(),
        can_undo: doc_guard.can_undo(),
        can_redo: doc_guard.can_redo(),
    };

    let mut pages = Vec::with_capacity(doc_guard.pages.len());
    for page in &doc_guard.pages {
        match page_to_serialized(page, &doc_guard.arena, &doc_guard.transitions) {
            Ok(serialized) => {
                pages.push(FullPageEntry {
                    id: serialized.id.to_string(),
                    name: serialized.name,
                    nodes: serialized.nodes,
                    transitions: serialized.transitions,
                });
            }
            Err(e) => {
                drop(doc_guard);
                tracing::error!("failed to serialize page: {e}");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("serialization failed: {e}") })),
                )
                    .into_response();
            }
        }
    }

    drop(doc_guard);
    (StatusCode::OK, Json(FullDocumentResponse { info, pages })).into_response()
}
