//! Integration test verifying that the GraphQL `applyOperations` resolver
//! emits a canonical (post-apply) `NodeKind` JSON in the broadcast payload
//! when called with the `path = "kind"` shorthand corners input.
//!
//! Background (RF-001 / RF-004):
//!
//! The frontend `applyRemoteOperation` dispatcher (in
//! `frontend/src/operations/apply-remote.ts`, case `"kind"`) requires the
//! canonical 4-element `corners` array form. If the GraphQL broadcast
//! forwards the raw shorthand (`{shape:"round", radius:N}`), the dispatcher
//! silently rejects it via its 4-element-array guard. Connected clients
//! never see the change.
//!
//! Per `.claude/rules/rust-defensive.md` "Side-Effect Artifacts Must Be
//! Constructed After Precondition Verification": the broadcast payload for
//! the `"kind"` path MUST be built from the verified post-apply
//! `node.kind` — mirroring `set_corners_impl` in `crates/mcp/src/tools/nodes.rs`.
//!
//! See also: `crates/mcp/tests/integration_set_corners.rs` for the MCP-side
//! contract that this test parallels.

use async_graphql::{EmptySubscription, Schema};
use sigil_core::FieldOperation;
use sigil_core::commands::node_commands::CreateNode;
use sigil_core::commands::page_commands::CreatePage;
use sigil_core::id::PageId;
use sigil_core::node::NodeKind;
use sigil_server::graphql::mutation::MutationRoot;
use sigil_server::graphql::query::QueryRoot;
use sigil_server::session_header::RequestSession;
use sigil_server::state::ServerState;
use sigil_state::MutationEventKind;
use sigil_state::sessions::SessionEvent;
use tokio::sync::broadcast;

/// Builds a `ServerState` whose default session broadcast channel we
/// subscribe to, plus a receiver to assert against. Returns
/// `(state, rx, rect_uuid)`.
///
/// Spec 22b: `apply_operations` mutates `session.store` directly and
/// broadcasts on `session.broadcast` only (no legacy mirror, no second
/// broadcast). The seed below writes to the default session's store so the
/// mutation can find the node.
fn make_state_with_rect() -> (ServerState, broadcast::Receiver<SessionEvent>, String) {
    let state = ServerState::new();

    let page_id = PageId::new(uuid::Uuid::new_v4());
    let rect_uuid = uuid::Uuid::new_v4();

    let session_id = state
        .app
        .default_session_id()
        .expect("default session id registered by ServerState::new()");
    let session = state
        .app
        .sessions
        .get(session_id)
        .expect("default session present");

    // Subscribe to the session broadcast channel that the production
    // resolver publishes on.
    let rx = session.broadcast.subscribe();

    {
        let mut session_doc = session.store.try_write().expect("uncontested test lock");
        let doc = &mut session_doc.0;

        let create_page = CreatePage {
            page_id,
            name: "Page 1".to_string(),
        };
        create_page.validate(doc).expect("create_page validate");
        create_page.apply(doc).expect("create_page apply");

        let create_rect = CreateNode {
            uuid: rect_uuid,
            kind: NodeKind::Rectangle {
                corners: sigil_core::node::default_corners(),
            },
            name: "Rect".to_string(),
            page_id: None, // defaults to current page
            initial_transform: None,
        };
        create_rect.validate(doc).expect("create_node validate");
        create_rect.apply(doc).expect("create_node apply");
    }

    (state, rx, rect_uuid.to_string())
}

fn test_schema(state: ServerState) -> Schema<QueryRoot, MutationRoot, EmptySubscription> {
    // Inject `RequestSession(None)` so resolvers fall back to the default
    // session id (set by `ServerState::new()`).
    Schema::build(QueryRoot, MutationRoot, EmptySubscription)
        .data(state)
        .data(RequestSession(None))
        .finish()
}

/// RF-001 / RF-004: when GraphQL `applyOperations` receives a `setField`
/// op with `path = "kind"` and a shorthand corners value, the broadcast
/// payload's `value` must be the canonical post-apply `NodeKind` JSON
/// (4-element corners array), NOT the raw shorthand.
#[tokio::test]
async fn test_apply_operations_set_field_kind_broadcasts_canonical_corners() {
    let (state, mut rx, rect_uuid) = make_state_with_rect();
    let schema = test_schema(state);

    // Shorthand input: { "type": "rectangle", "corners": { "shape": "round", "radius": 12 } }
    // The GraphQL `value` field is itself a JSON string, so we serialise the
    // outer JSON to a string and then escape its quotes for embedding inside
    // the GraphQL string literal.
    let kind_value = serde_json::json!({
        "type": "rectangle",
        "corners": { "shape": "round", "radius": 12.0 }
    });
    let kind_value_str = kind_value.to_string();
    let kind_value_escaped = kind_value_str.replace('"', "\\\"");

    let query = format!(
        r#"mutation {{
            applyOperations(
                operations: [
                    {{ setField: {{ nodeUuid: "{rect_uuid}", path: "kind", value: "{kind_value_escaped}" }} }}
                ],
                userId: "test-user"
            ) {{
                seq
            }}
        }}"#
    );

    let res = schema.execute(&query).await;
    assert!(
        res.errors.is_empty(),
        "applyOperations errors: {:?}",
        res.errors
    );

    let event = match rx.try_recv().expect("should receive a broadcast event") {
        SessionEvent::DocumentEvent(me) => me,
        SessionEvent::SessionFatal { reason } => {
            panic!("expected DocumentEvent, got SessionFatal: {reason}")
        }
    };
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

    // Canonical post-apply shape — this is what apply-remote.ts case "kind" expects.
    assert_eq!(
        value["type"], "rectangle",
        "kind discriminator must be 'rectangle'"
    );

    let corners = value["corners"]
        .as_array()
        .expect("corners must be a JSON array (canonical 4-element form), not shorthand");
    assert_eq!(
        corners.len(),
        4,
        "corners array must have exactly 4 elements (canonical form)"
    );

    for (i, corner) in corners.iter().enumerate() {
        assert_eq!(corner["type"], "round", "corner {i} type must be 'round'");
        assert_eq!(
            corner["radii"]["x"], 12.0,
            "corner {i} radii.x must be 12.0"
        );
        assert_eq!(
            corner["radii"]["y"], 12.0,
            "corner {i} radii.y must be 12.0"
        );
    }
}
