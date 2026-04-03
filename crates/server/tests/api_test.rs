//! Integration tests for the server HTTP endpoints.

use std::net::SocketAddr;

use agent_designer_server::{build_app, state::ServerState};

/// Starts a test server on a random port and returns its address.
///
/// The server runs without static file serving, matching the integration
/// test environment where no frontend build is available.
async fn start_test_server() -> SocketAddr {
    let state = ServerState::new();
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
