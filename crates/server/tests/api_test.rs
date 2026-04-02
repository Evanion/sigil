//! Integration tests for the server HTTP and WebSocket endpoints.

use std::net::SocketAddr;

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
