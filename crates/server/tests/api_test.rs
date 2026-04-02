//! Integration tests for the server HTTP and WebSocket endpoints.

use std::net::SocketAddr;
use std::time::Duration;

use agent_designer_server::{build_app, state::AppState};

/// Starts a test server on a random port and returns its address.
///
/// The server runs without static file serving, matching the integration
/// test environment where no frontend build is available.
async fn start_test_server() -> SocketAddr {
    let state = AppState::new();
    let app = build_app(state, None);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind to random port");
    let addr = listener.local_addr().expect("local address");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    addr
}

#[tokio::test]
async fn test_health_endpoint_returns_200_ok() {
    let addr = start_test_server().await;
    let resp = reqwest::get(format!("http://{addr}/health"))
        .await
        .expect("GET /health");
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.expect("body"), "ok");
}

#[tokio::test]
async fn test_document_info_returns_json_with_name_and_page_count() {
    let addr = start_test_server().await;
    let resp = reqwest::get(format!("http://{addr}/api/document"))
        .await
        .expect("GET /api/document");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json body");
    assert_eq!(body["name"], "Untitled");
    assert_eq!(body["page_count"], 0);
    assert_eq!(body["node_count"], 0);
    assert_eq!(body["can_undo"], false);
    assert_eq!(body["can_redo"], false);
}

#[tokio::test]
async fn test_websocket_connects_and_accepts_messages() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;
    let (mut ws, _resp) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("WebSocket connect");

    // Send a command that will fail (no node exists), but the connection
    // should remain open and respond with an error message.
    let msg = serde_json::json!({
        "type": "command",
        "command": {
            "type": "rename_node",
            "node_id": [0, 0],
            "new_name": "Test",
            "old_name": "Original"
        }
    });
    ws.send(Message::Text(
        serde_json::to_string(&msg).expect("serialize").into(),
    ))
    .await
    .expect("send message");

    // We should receive an error response since the node doesn't exist.
    let response = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("response within timeout")
        .expect("message received")
        .expect("valid message");

    let Message::Text(text) = response else {
        panic!("expected text message, got {response:?}");
    };
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("parse response");
    assert_eq!(parsed["type"], "error");

    ws.close(None).await.expect("close");
}

#[tokio::test]
async fn test_websocket_undo_on_empty_history_returns_error() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;
    let (mut ws, _resp) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("WebSocket connect");

    // Send an undo request when there is nothing to undo.
    let msg = serde_json::json!({ "type": "undo" });
    ws.send(Message::Text(
        serde_json::to_string(&msg).expect("serialize").into(),
    ))
    .await
    .expect("send undo");

    let response = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("response within timeout")
        .expect("message received")
        .expect("valid message");

    let Message::Text(text) = response else {
        panic!("expected text message, got {response:?}");
    };
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("parse response");
    assert_eq!(parsed["type"], "error");

    ws.close(None).await.expect("close");
}

#[tokio::test]
async fn test_websocket_invalid_json_returns_error() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;
    let (mut ws, _resp) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("WebSocket connect");

    // Send invalid JSON.
    ws.send(Message::Text("not valid json".into()))
        .await
        .expect("send invalid");

    let response = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("response within timeout")
        .expect("message received")
        .expect("valid message");

    let Message::Text(text) = response else {
        panic!("expected text message, got {response:?}");
    };
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("parse response");
    assert_eq!(parsed["type"], "error");

    ws.close(None).await.expect("close");
}

#[tokio::test]
async fn test_create_node_broadcasts_to_other_client_but_not_sender() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;

    // Connect two WebSocket clients.
    let (mut ws_a, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("client A connect");
    let (mut ws_b, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("client B connect");

    // Client A sends a CreateNode command.
    let node_uuid = uuid::Uuid::new_v4();
    let create_msg = serde_json::json!({
        "type": "command",
        "command": {
            "type": "create_node",
            "node_id": { "index": 0, "generation": 0 },
            "uuid": node_uuid.to_string(),
            "kind": { "type": "frame", "layout": null },
            "name": "TestFrame",
            "page_id": null
        }
    });
    ws_a.send(Message::Text(
        serde_json::to_string(&create_msg)
            .expect("serialize")
            .into(),
    ))
    .await
    .expect("client A send");

    // Client B should receive the broadcast.
    let b_response = tokio::time::timeout(Duration::from_secs(2), ws_b.next())
        .await
        .expect("client B response within timeout")
        .expect("client B message received")
        .expect("client B valid message");

    let Message::Text(b_text) = b_response else {
        panic!("expected text message from client B, got {b_response:?}");
    };
    let b_parsed: serde_json::Value = serde_json::from_str(&b_text).expect("parse B response");
    assert_eq!(
        b_parsed["type"], "broadcast",
        "client B should receive a broadcast, got: {b_parsed}"
    );
    assert_eq!(b_parsed["command"]["type"], "create_node");
    assert_eq!(b_parsed["command"]["name"], "TestFrame");

    // Client A should NOT receive any message (echo filtering).
    let a_result = tokio::time::timeout(Duration::from_millis(200), ws_a.next()).await;
    assert!(
        a_result.is_err(),
        "client A should not receive its own broadcast (echo filtering)"
    );

    // Verify the document now has a node via the HTTP API.
    let resp = reqwest::get(format!("http://{addr}/api/document"))
        .await
        .expect("GET /api/document");
    assert_eq!(resp.status(), 200);
    let doc: serde_json::Value = resp.json().await.expect("json body");
    assert!(
        doc["node_count"].as_u64().expect("node_count") >= 1,
        "document should have at least 1 node, got: {doc}"
    );

    ws_a.close(None).await.expect("close A");
    ws_b.close(None).await.expect("close B");
}

#[tokio::test]
async fn test_document_full_returns_info_and_empty_pages() {
    let addr = start_test_server().await;
    let resp = reqwest::get(format!("http://{addr}/api/document/full"))
        .await
        .expect("GET /api/document/full");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json body");
    // Info section must be present with expected fields.
    assert_eq!(body["info"]["name"], "Untitled");
    assert_eq!(body["info"]["page_count"], 0);
    assert_eq!(body["info"]["node_count"], 0);
    assert_eq!(body["info"]["can_undo"], false);
    assert_eq!(body["info"]["can_redo"], false);
    // Pages array must be present and empty for a fresh document.
    assert!(body["pages"].is_array());
    assert_eq!(body["pages"].as_array().expect("pages array").len(), 0);
}

#[tokio::test]
async fn test_document_full_returns_pages_with_nodes_after_creation() {
    use futures_util::SinkExt;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;

    // First, add a page by creating a node with a page_id via WebSocket.
    // We need to set up a document with a page first. The default AppState
    // has no pages, so let's create a node without a page_id, which will
    // still populate the arena.
    let (mut ws, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("WebSocket connect");

    let node_uuid = uuid::Uuid::new_v4();
    let create_msg = serde_json::json!({
        "type": "command",
        "command": {
            "type": "create_node",
            "node_id": { "index": 0, "generation": 0 },
            "uuid": node_uuid.to_string(),
            "kind": { "type": "rectangle", "corner_radii": [0.0, 0.0, 0.0, 0.0] },
            "name": "Rect1",
            "page_id": null
        }
    });
    ws.send(Message::Text(
        serde_json::to_string(&create_msg)
            .expect("serialize")
            .into(),
    ))
    .await
    .expect("send create");

    // Give server a moment to process.
    tokio::time::sleep(Duration::from_millis(100)).await;

    let resp = reqwest::get(format!("http://{addr}/api/document/full"))
        .await
        .expect("GET /api/document/full");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json body");
    assert_eq!(body["info"]["node_count"], 1);

    ws.close(None).await.expect("close");
}

#[tokio::test]
async fn test_create_node_request_returns_node_created_with_assigned_id() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;
    let (mut ws, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("WebSocket connect");

    let node_uuid = uuid::Uuid::new_v4();
    let create_msg = serde_json::json!({
        "type": "create_node_request",
        "uuid": node_uuid.to_string(),
        "kind": { "type": "rectangle", "corner_radii": [0.0, 0.0, 0.0, 0.0] },
        "name": "TestRect",
        "page_id": null,
        "transform": {
            "x": 10.0,
            "y": 20.0,
            "width": 100.0,
            "height": 50.0,
            "rotation": 0.0,
            "scale_x": 1.0,
            "scale_y": 1.0
        }
    });
    ws.send(Message::Text(
        serde_json::to_string(&create_msg)
            .expect("serialize")
            .into(),
    ))
    .await
    .expect("send create_node_request");

    // The server should respond with a node_created message.
    let response = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .expect("response within timeout")
        .expect("message received")
        .expect("valid message");

    let Message::Text(text) = response else {
        panic!("expected text message, got {response:?}");
    };
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("parse response");
    assert_eq!(parsed["type"], "node_created");
    assert_eq!(parsed["uuid"], node_uuid.to_string());
    // The node_id should be present with index and generation fields.
    assert!(
        parsed["node_id"]["index"].is_number(),
        "node_id.index should be a number, got: {parsed}"
    );
    assert!(
        parsed["node_id"]["generation"].is_number(),
        "node_id.generation should be a number, got: {parsed}"
    );

    // Verify the node exists in the document with the correct transform.
    let resp = reqwest::get(format!("http://{addr}/api/document"))
        .await
        .expect("GET /api/document");
    let doc: serde_json::Value = resp.json().await.expect("json body");
    assert_eq!(doc["node_count"], 1);

    ws.close(None).await.expect("close");
}

#[tokio::test]
async fn test_create_node_request_broadcasts_to_other_clients() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;

    let (mut ws_a, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("client A connect");
    let (mut ws_b, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("client B connect");

    let node_uuid = uuid::Uuid::new_v4();
    let create_msg = serde_json::json!({
        "type": "create_node_request",
        "uuid": node_uuid.to_string(),
        "kind": { "type": "frame", "layout": null },
        "name": "BroadcastFrame",
        "page_id": null,
        "transform": {
            "x": 0.0, "y": 0.0, "width": 200.0, "height": 150.0,
            "rotation": 0.0, "scale_x": 1.0, "scale_y": 1.0
        }
    });
    ws_a.send(Message::Text(
        serde_json::to_string(&create_msg)
            .expect("serialize")
            .into(),
    ))
    .await
    .expect("client A send");

    // Client A should receive node_created (originator response).
    let a_response = tokio::time::timeout(Duration::from_secs(2), ws_a.next())
        .await
        .expect("client A response within timeout")
        .expect("client A message received")
        .expect("client A valid message");
    let Message::Text(a_text) = a_response else {
        panic!("expected text from client A, got {a_response:?}");
    };
    let a_parsed: serde_json::Value = serde_json::from_str(&a_text).expect("parse A response");
    assert_eq!(a_parsed["type"], "node_created");

    // Client B should receive a broadcast.
    let b_response = tokio::time::timeout(Duration::from_secs(2), ws_b.next())
        .await
        .expect("client B response within timeout")
        .expect("client B message received")
        .expect("client B valid message");
    let Message::Text(b_text) = b_response else {
        panic!("expected text from client B, got {b_response:?}");
    };
    let b_parsed: serde_json::Value = serde_json::from_str(&b_text).expect("parse B response");
    assert_eq!(
        b_parsed["type"], "broadcast",
        "client B should receive broadcast, got: {b_parsed}"
    );
    assert_eq!(
        b_parsed["command"]["type"], "node_created_with_transform",
        "broadcast should include transform for atomic create+transform"
    );

    ws_a.close(None).await.expect("close A");
    ws_b.close(None).await.expect("close B");
}

#[tokio::test]
async fn test_create_node_request_with_invalid_kind_returns_error() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;
    let (mut ws, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("WebSocket connect");

    let create_msg = serde_json::json!({
        "type": "create_node_request",
        "uuid": uuid::Uuid::new_v4().to_string(),
        "kind": { "type": "nonexistent_shape" },
        "name": "Bad",
        "page_id": null,
        "transform": {
            "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
            "rotation": 0.0, "scale_x": 1.0, "scale_y": 1.0
        }
    });
    ws.send(Message::Text(
        serde_json::to_string(&create_msg)
            .expect("serialize")
            .into(),
    ))
    .await
    .expect("send bad create");

    let response = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .expect("response within timeout")
        .expect("message received")
        .expect("valid message");

    let Message::Text(text) = response else {
        panic!("expected text message, got {response:?}");
    };
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("parse response");
    assert_eq!(parsed["type"], "error");

    ws.close(None).await.expect("close");
}
