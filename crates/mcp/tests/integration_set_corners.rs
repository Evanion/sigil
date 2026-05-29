//! Integration tests verifying that `set_corners_impl` produces the correct
//! MCP broadcast `value` shape.
//!
//! Spec 22b: `set_corners_impl` is a pure mutation over `&mut Document` that
//! returns the canonical post-mutation `NodeKind` JSON. The session-scoped
//! envelope (`SigilMcpServer::run_session_scoped`) wraps that JSON as the
//! broadcast `value` with `op_type = "set_field"`, `path = "kind"`.
//!
//! The frontend `applyRemoteTransaction` dispatcher (in
//! `frontend/src/operations/apply-remote.ts`) consumes events with
//! `op_type = "set_field"`, `path = "kind"`, and `value` shaped as the full
//! serialised `NodeKind`. These tests assert that the `value` the Rust side
//! produces (the `kind_json` returned by `set_corners_impl`) is exactly that
//! shape, sourced from post-mutation document state.
//!
//! See also: `frontend/src/__tests__/integration-corners.test.ts` which
//! replays the payload asserted here through the frontend dispatcher.
//! If either side drifts, the MCP Broadcast Payload Shape Contract
//! (CLAUDE.md §4) is broken.

use serde_json::json;
use sigil_core::Document;
use sigil_mcp::tools::nodes::{create_node_impl, set_corners_impl};
use sigil_mcp::tools::pages::create_page_impl;

/// Seed a bare document with one page and one rectangle; return the doc and the
/// rectangle's UUID.
fn make_doc_with_rect() -> (Document, String) {
    let mut doc = Document::new("Untitled".to_string());
    let page = create_page_impl(&mut doc, "Page 1").expect("create page");
    let rect = create_node_impl(&mut doc, "rectangle", "Rect", Some(&page.id), None, None)
        .expect("create rect");
    (doc, rect.uuid)
}

/// Verifies that a uniform-round shorthand produces the post-mutation broadcast
/// `value`:
///   value = { "type": "rectangle", "corners": [4 × {type:"round", radii:{x:16,y:16}}] }
#[test]
fn test_set_corners_uniform_round_broadcasts_full_kind() {
    let (mut doc, rect_uuid) = make_doc_with_rect();

    let (_result, value) = set_corners_impl(
        &mut doc,
        &rect_uuid,
        &json!({ "shape": "round", "radius": 16.0 }),
    )
    .expect("set_corners_impl must succeed");

    assert_eq!(
        value["type"], "rectangle",
        "kind discriminator must be 'rectangle'"
    );

    let corners = value["corners"]
        .as_array()
        .expect("corners must be a JSON array");
    assert_eq!(
        corners.len(),
        4,
        "corners array must have exactly 4 elements"
    );

    for (i, corner) in corners.iter().enumerate() {
        assert_eq!(corner["type"], "round", "corner {i} type must be 'round'");
        assert_eq!(
            corner["radii"]["x"], 16.0,
            "corner {i} radii.x must be 16.0"
        );
        assert_eq!(
            corner["radii"]["y"], 16.0,
            "corner {i} radii.y must be 16.0"
        );
    }
}

/// Verifies that a superellipse shape-level shorthand produces the
/// post-mutation broadcast `value`:
///   value = { "type": "rectangle",
///             "corners": [4 × {type:"superellipse", radii:{x:20,y:20}, smoothing:0.7}] }
#[test]
fn test_set_corners_superellipse_broadcasts_shape_level_payload() {
    let (mut doc, rect_uuid) = make_doc_with_rect();

    let (_result, value) = set_corners_impl(
        &mut doc,
        &rect_uuid,
        &json!({ "shape": "superellipse", "radius": 20.0, "smoothing": 0.7 }),
    )
    .expect("set_corners_impl must succeed");

    assert_eq!(
        value["type"], "rectangle",
        "kind discriminator must be 'rectangle'"
    );

    let corners = value["corners"]
        .as_array()
        .expect("corners must be a JSON array");
    assert_eq!(
        corners.len(),
        4,
        "corners array must have exactly 4 elements"
    );

    for (i, corner) in corners.iter().enumerate() {
        assert_eq!(
            corner["type"], "superellipse",
            "corner {i} type must be 'superellipse'"
        );
        assert_eq!(
            corner["radii"]["x"], 20.0,
            "corner {i} radii.x must be 20.0"
        );
        assert_eq!(
            corner["radii"]["y"], 20.0,
            "corner {i} radii.y must be 20.0"
        );
        assert_eq!(corner["smoothing"], 0.7, "corner {i} smoothing must be 0.7");
    }
}
