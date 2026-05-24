//! Integration tests verifying that `set_corners_impl` produces the correct
//! MCP broadcast payload shape.
//!
//! The frontend `applyRemoteTransaction` dispatcher (in
//! `frontend/src/operations/apply-remote.ts`) consumes events with
//! `op_type = "set_field"`, `path = "kind"`, and `value` shaped as the
//! full serialised `NodeKind`. These tests assert that the Rust broadcast
//! side emits exactly that shape.
//!
//! See also: `frontend/src/__tests__/integration-corners.test.ts` which
//! replays the payload asserted here through the frontend dispatcher.
//! If either side drifts, the MCP Broadcast Payload Shape Contract
//! (CLAUDE.md §4) is broken.

use agent_designer_mcp::tools::nodes::{create_node_impl, set_corners_impl};
use agent_designer_mcp::tools::pages::create_page_impl;
use agent_designer_state::{AppState, MUTATION_BROADCAST_CAPACITY, MutationEventKind};
use serde_json::json;
use tokio::sync::broadcast;

/// Seed state: one page, one rectangle, broadcast channel wired up.
///
/// Drains the two setup events (create_page + create_node) so the first
/// `rx.try_recv()` in the test body receives the event under test.
fn make_state_with_rect() -> (
    AppState,
    broadcast::Receiver<agent_designer_state::MutationEvent>,
    String,
) {
    let mut state = AppState::new();
    let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
    let rx = tx.subscribe();
    state.set_event_tx(tx);

    let page = create_page_impl(&state, "Page 1").expect("create page");
    let rect = create_node_impl(&state, "rectangle", "Rect", Some(&page.id), None, None)
        .expect("create rect");

    // Drain the two setup events so the test body sees only its own event.
    // Bind to named results to satisfy the no-`let _` rule (CLAUDE.md §11);
    // a `TryRecvError::Empty` here would mean the publish was synchronous and
    // already drained, both states are acceptable for setup.
    let mut rx = rx;
    let _page_event = rx.try_recv();
    let _node_event = rx.try_recv();

    (state, rx, rect.uuid)
}

/// Verifies that a uniform-round shorthand broadcast produces:
///   op_type = "set_field", path = "kind",
///   value = { "type": "rectangle", "corners": [4 × {type:"round", radii:{x:16,y:16}}] }
#[test]
fn test_set_corners_uniform_round_broadcasts_full_kind() {
    let (state, mut rx, rect_uuid) = make_state_with_rect();

    set_corners_impl(
        &state,
        &rect_uuid,
        &json!({ "shape": "round", "radius": 16.0 }),
    )
    .expect("set_corners_impl must succeed");

    let event = rx.try_recv().expect("should receive broadcast event");
    assert_eq!(
        event.kind,
        MutationEventKind::NodeUpdated,
        "event kind must be NodeUpdated"
    );

    let tx_payload = event
        .transaction
        .as_ref()
        .expect("event must carry a transaction payload");

    assert_eq!(
        tx_payload.operations.len(),
        1,
        "transaction must contain exactly one operation"
    );

    let op = &tx_payload.operations[0];
    assert_eq!(op.op_type, "set_field", "op_type must be 'set_field'");
    assert_eq!(op.path, "kind", "path must be 'kind'");

    let value = op.value.as_ref().expect("operation must have a value");

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

/// Verifies that a superellipse shape-level shorthand broadcast produces:
///   op_type = "set_field", path = "kind",
///   value = { "type": "rectangle",
///             "corners": [4 × {type:"superellipse", radii:{x:20,y:20}, smoothing:0.7}] }
#[test]
fn test_set_corners_superellipse_broadcasts_shape_level_payload() {
    let (state, mut rx, rect_uuid) = make_state_with_rect();

    set_corners_impl(
        &state,
        &rect_uuid,
        &json!({ "shape": "superellipse", "radius": 20.0, "smoothing": 0.7 }),
    )
    .expect("set_corners_impl must succeed");

    let event = rx.try_recv().expect("should receive broadcast event");
    assert_eq!(
        event.kind,
        MutationEventKind::NodeUpdated,
        "event kind must be NodeUpdated"
    );

    let tx_payload = event
        .transaction
        .as_ref()
        .expect("event must carry a transaction payload");

    assert_eq!(
        tx_payload.operations.len(),
        1,
        "transaction must contain exactly one operation"
    );

    let op = &tx_payload.operations[0];
    assert_eq!(op.op_type, "set_field", "op_type must be 'set_field'");
    assert_eq!(op.path, "kind", "path must be 'kind'");

    let value = op.value.as_ref().expect("operation must have a value");

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
