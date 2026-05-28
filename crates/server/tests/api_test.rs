//! Integration tests for the server HTTP endpoints.

use std::net::SocketAddr;

use sigil_server::{build_app, state::ServerState};
use sigil_state::SessionId;

/// Starts a test server on a random port and returns its address along with
/// the registered default session id (from the in-memory default session).
async fn start_test_server() -> (SocketAddr, SessionId) {
    let state = ServerState::new();
    let default_id = state
        .app
        .default_session_id()
        .expect("ServerState::new() must register a default session");
    let app = build_app(state, None);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind to random port");
    let addr = listener.local_addr().expect("local address");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    (addr, default_id)
}

#[tokio::test]
async fn test_health_endpoint_returns_200_ok() {
    let (addr, _) = start_test_server().await;
    let resp = reqwest::get(format!("http://{addr}/health"))
        .await
        .expect("GET /health");
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.expect("body"), "ok");
}

/// Spec 20: GraphQL endpoint accepts a request without the
/// `X-Sigil-Session` header and falls back to the registry default session.
#[tokio::test]
async fn test_graphql_without_session_header_uses_default_session() {
    let (addr, _default_id) = start_test_server().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/graphql"))
        .header("Content-Type", "application/json")
        .body(r#"{"query":"{ document { name } }"}"#)
        .send()
        .await
        .expect("POST /graphql");

    assert_eq!(
        resp.status(),
        200,
        "GraphQL endpoint must be reachable without the X-Sigil-Session header"
    );
    let body: serde_json::Value = resp.json().await.expect("body json");
    assert!(
        body.get("errors").is_none() || body["errors"].as_array().is_none_or(Vec::is_empty),
        "no errors expected, got: {body}"
    );
    assert_eq!(body["data"]["document"]["name"], "Untitled");
}

/// Spec 20: GraphQL endpoint accepts a valid `X-Sigil-Session` header
/// matching the registered default session.
#[tokio::test]
async fn test_graphql_with_default_session_header_succeeds() {
    let (addr, default_id) = start_test_server().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/graphql"))
        .header("Content-Type", "application/json")
        .header("X-Sigil-Session", default_id.to_string())
        .body(r#"{"query":"{ document { name } }"}"#)
        .send()
        .await
        .expect("POST /graphql with header");

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("body json");
    assert_eq!(body["data"]["document"]["name"], "Untitled");
}

/// Spec 20: GraphQL endpoint rejects a malformed `X-Sigil-Session` header
/// at the middleware layer (HTTP 400, before async-graphql runs).
#[tokio::test]
async fn test_graphql_with_invalid_session_header_returns_400() {
    let (addr, _) = start_test_server().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/graphql"))
        .header("Content-Type", "application/json")
        .header("X-Sigil-Session", "not-a-uuid")
        .body(r#"{"query":"{ document { name } }"}"#)
        .send()
        .await
        .expect("POST /graphql with invalid header");

    assert_eq!(
        resp.status(),
        400,
        "malformed X-Sigil-Session must be rejected at the middleware (HTTP 400)"
    );
}

/// Spec 20: GraphQL endpoint accepts the header syntactically but a
/// mutation referencing a non-existent session returns a typed
/// `SESSION_NOT_FOUND` error from the resolver.
#[tokio::test]
async fn test_graphql_mutation_unknown_session_returns_session_not_found() {
    let (addr, _) = start_test_server().await;
    let unknown_id = SessionId::new();
    let client = reqwest::Client::new();

    // Use a mutation rather than a query: only mutations enforce session
    // resolution against the registry. (Queries today still read from the
    // legacy store — they migrate when the legacy store is dropped.)
    let mutation_body = serde_json::json!({
        "query": r#"mutation { applyOperations(operations: [{ setField: { nodeUuid: "00000000-0000-0000-0000-000000000000", path: "name", value: "\"x\"" } }], userId: "test") { seq } }"#
    });
    let resp = client
        .post(format!("http://{addr}/graphql"))
        .header("Content-Type", "application/json")
        .header("X-Sigil-Session", unknown_id.to_string())
        .body(mutation_body.to_string())
        .send()
        .await
        .expect("POST /graphql with unknown session");

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("body json");
    let err_msg = body["errors"][0]["message"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        err_msg.starts_with("SESSION_NOT_FOUND"),
        "expected SESSION_NOT_FOUND error, got: {err_msg}"
    );
}

/// Spec 20 §3.3 (Task 7): `/heartbeat` returns 200 OK.
///
/// The Tauri supervision task uses this endpoint as a liveness probe; the
/// status code is the only thing it checks.
#[tokio::test]
async fn test_heartbeat_endpoint_returns_200_ok() {
    let (addr, _) = start_test_server().await;
    let resp = reqwest::get(format!("http://{addr}/heartbeat"))
        .await
        .expect("GET /heartbeat");
    assert_eq!(resp.status(), 200);
}

/// Spec 20 §3.3 (Task 7): `/heartbeat` MUST NOT require the
/// `X-Sigil-Session` header.
///
/// The supervision task has no session bound when it first probes
/// liveness; routing the heartbeat through the session middleware would
/// force the shell to invent an unused session id and would couple
/// liveness checks to session registry state. This test asserts the
/// route bypasses the middleware: a request with no header (and a
/// request with a deliberately malformed header) both receive 200.
#[tokio::test]
async fn test_heartbeat_does_not_require_session_header() {
    let (addr, _) = start_test_server().await;
    let client = reqwest::Client::new();

    // No header at all.
    let resp = client
        .get(format!("http://{addr}/heartbeat"))
        .send()
        .await
        .expect("GET /heartbeat without header");
    assert_eq!(
        resp.status(),
        200,
        "heartbeat must succeed without X-Sigil-Session"
    );

    // Malformed header (would 400 on /graphql) is still accepted on
    // /heartbeat — proves the middleware isn't on this route.
    let resp = client
        .get(format!("http://{addr}/heartbeat"))
        .header("X-Sigil-Session", "not-a-uuid")
        .send()
        .await
        .expect("GET /heartbeat with malformed header");
    assert_eq!(
        resp.status(),
        200,
        "heartbeat must not validate X-Sigil-Session (middleware must be /graphql-scoped)"
    );
}
