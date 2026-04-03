//! MCP resource definitions for Sigil.
//!
//! Three static resources expose read-only views of the document state:
//!
//! | URI                            | Contents                            |
//! |--------------------------------|-------------------------------------|
//! | `sigil://document/tree`        | Full document tree (JSON)           |
//! | `sigil://document/tokens`      | All design tokens (JSON)            |
//! | `sigil://document/components`  | Component library (JSON)            |
//!
//! These resources are read-only — agents must use tools for mutations.

use rmcp::ErrorData;
use rmcp::model::{AnnotateAble as _, RawResource, Resource, ResourceContents};

use agent_designer_state::AppState;

use crate::types::{ComponentListResult, TokenListResult};

// ── URI constants ─────────────────────────────────────────────────────────────

/// URI for the full document tree resource.
pub const URI_DOCUMENT_TREE: &str = "sigil://document/tree";
/// URI for the design tokens resource.
pub const URI_DOCUMENT_TOKENS: &str = "sigil://document/tokens";
/// URI for the component library resource.
pub const URI_DOCUMENT_COMPONENTS: &str = "sigil://document/components";

// ── Resource listing ──────────────────────────────────────────────────────────

/// Returns the three static Sigil resources that MCP clients can discover.
#[must_use]
pub fn list_resources() -> Vec<Resource> {
    vec![
        RawResource::new(URI_DOCUMENT_TREE, "document_tree")
            .with_description(
                "Full document tree: all pages with their node hierarchies. \
                 Read-only. Use tools to mutate.",
            )
            .with_mime_type("application/json")
            .no_annotation(),
        RawResource::new(URI_DOCUMENT_TOKENS, "document_tokens")
            .with_description(
                "All design tokens in the document, sorted by name. \
                 Read-only. Use tools to mutate.",
            )
            .with_mime_type("application/json")
            .no_annotation(),
        RawResource::new(URI_DOCUMENT_COMPONENTS, "document_components")
            .with_description(
                "Component library: all component definitions in the document, \
                 sorted by name. Read-only. Use tools to mutate.",
            )
            .with_mime_type("application/json")
            .no_annotation(),
    ]
}

// ── Resource reading ──────────────────────────────────────────────────────────

/// Reads a resource by URI and returns its serialized JSON content.
///
/// Returns an `rmcp::ErrorData` if the URI is not recognised or serialization
/// fails. All three supported resources are read-only snapshots of the current
/// in-memory document state — no file I/O is performed.
///
/// # Errors
///
/// - `INVALID_PARAMS` if `uri` does not match any known Sigil resource URI.
/// - `INTERNAL_ERROR` if JSON serialization of the document state fails.
pub fn read_resource(state: &AppState, uri: &str) -> Result<Vec<ResourceContents>, ErrorData> {
    match uri {
        URI_DOCUMENT_TREE => {
            let tree = crate::tools::document::get_document_tree_impl(state);
            let json = serde_json::to_string(&tree).map_err(|e| {
                ErrorData::new(
                    rmcp::model::ErrorCode::INTERNAL_ERROR,
                    format!("serialization error: {e}"),
                    None,
                )
            })?;
            Ok(vec![
                ResourceContents::text(json, uri).with_mime_type("application/json"),
            ])
        }
        URI_DOCUMENT_TOKENS => {
            let tokens = crate::tools::tokens::list_tokens_impl(state);
            let result = TokenListResult { tokens };
            let json = serde_json::to_string(&result).map_err(|e| {
                ErrorData::new(
                    rmcp::model::ErrorCode::INTERNAL_ERROR,
                    format!("serialization error: {e}"),
                    None,
                )
            })?;
            Ok(vec![
                ResourceContents::text(json, uri).with_mime_type("application/json"),
            ])
        }
        URI_DOCUMENT_COMPONENTS => {
            let components = crate::tools::components::list_components_impl(state);
            let result = ComponentListResult { components };
            let json = serde_json::to_string(&result).map_err(|e| {
                ErrorData::new(
                    rmcp::model::ErrorCode::INTERNAL_ERROR,
                    format!("serialization error: {e}"),
                    None,
                )
            })?;
            Ok(vec![
                ResourceContents::text(json, uri).with_mime_type("application/json"),
            ])
        }
        _ => Err(ErrorData::new(
            rmcp::model::ErrorCode::INVALID_PARAMS,
            format!("unknown resource URI: {uri}"),
            None,
        )),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use agent_designer_state::AppState;

    use super::*;

    #[test]
    fn test_list_resources_returns_three_static_resources() {
        let resources = list_resources();
        assert_eq!(resources.len(), 3, "expected exactly 3 resources");
        let uris: Vec<&str> = resources.iter().map(|r| r.uri.as_str()).collect();
        assert!(
            uris.contains(&URI_DOCUMENT_TREE),
            "missing sigil://document/tree"
        );
        assert!(
            uris.contains(&URI_DOCUMENT_TOKENS),
            "missing sigil://document/tokens"
        );
        assert!(
            uris.contains(&URI_DOCUMENT_COMPONENTS),
            "missing sigil://document/components"
        );
    }

    #[test]
    fn test_list_resources_all_have_json_mime_type() {
        let resources = list_resources();
        for resource in &resources {
            assert_eq!(
                resource.mime_type.as_deref(),
                Some("application/json"),
                "resource {} missing application/json mime type",
                resource.uri
            );
        }
    }

    #[test]
    fn test_read_resource_tree_returns_json() {
        let state = AppState::new();
        let result = read_resource(&state, URI_DOCUMENT_TREE);
        assert!(result.is_ok(), "expected Ok, got: {result:?}");
        let contents = result.unwrap();
        assert_eq!(contents.len(), 1);
        // Verify content is parseable JSON
        if let ResourceContents::TextResourceContents { text, .. } = &contents[0] {
            let parsed: serde_json::Value =
                serde_json::from_str(text).expect("document tree should be valid JSON");
            assert!(parsed.is_object(), "document tree JSON should be an object");
        } else {
            panic!("expected TextResourceContents");
        }
    }

    #[test]
    fn test_read_resource_tokens_returns_json() {
        let state = AppState::new();
        let result = read_resource(&state, URI_DOCUMENT_TOKENS);
        assert!(result.is_ok(), "expected Ok, got: {result:?}");
        let contents = result.unwrap();
        assert_eq!(contents.len(), 1);
        if let ResourceContents::TextResourceContents { text, .. } = &contents[0] {
            let parsed: serde_json::Value =
                serde_json::from_str(text).expect("tokens should be valid JSON");
            assert!(parsed.is_object(), "tokens JSON should be an object");
            assert!(
                parsed.get("tokens").is_some(),
                "tokens JSON must have a 'tokens' key"
            );
        } else {
            panic!("expected TextResourceContents");
        }
    }

    #[test]
    fn test_read_resource_components_returns_json() {
        let state = AppState::new();
        let result = read_resource(&state, URI_DOCUMENT_COMPONENTS);
        assert!(result.is_ok(), "expected Ok, got: {result:?}");
        let contents = result.unwrap();
        assert_eq!(contents.len(), 1);
        if let ResourceContents::TextResourceContents { text, .. } = &contents[0] {
            let parsed: serde_json::Value =
                serde_json::from_str(text).expect("components should be valid JSON");
            assert!(parsed.is_object(), "components JSON should be an object");
            assert!(
                parsed.get("components").is_some(),
                "components JSON must have a 'components' key"
            );
        } else {
            panic!("expected TextResourceContents");
        }
    }

    #[test]
    fn test_read_resource_unknown_uri_returns_invalid_params_error() {
        let state = AppState::new();
        let result = read_resource(&state, "sigil://document/unknown");
        assert!(result.is_err(), "expected Err for unknown URI");
        let err = result.unwrap_err();
        assert_eq!(
            err.code,
            rmcp::model::ErrorCode::INVALID_PARAMS,
            "expected INVALID_PARAMS error code"
        );
    }

    #[test]
    fn test_read_resource_uri_matches_listed_uris() {
        // All listed resource URIs must be readable without error.
        let state = AppState::new();
        for resource in list_resources() {
            let result = read_resource(&state, &resource.uri);
            assert!(
                result.is_ok(),
                "read_resource({}) failed: {:?}",
                resource.uri,
                result.err()
            );
        }
    }
}
