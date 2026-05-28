//! Streamable HTTP transport adapter for `sigil-mcp`.
//!
//! Exposes the same MCP tool surface as the stdio transport, served over a
//! single HTTP endpoint at `/mcp`. The transport implements the MCP Streamable
//! HTTP spec (2025-06-18) in stateful mode (the rmcp default):
//!
//! - The first `initialize` POST establishes a session; the server returns the
//!   session id in the `Mcp-Session-Id` response header.
//! - All subsequent `tools/list`, `tools/call`, and `resources/*` requests
//!   carry that header. The session persists across requests so the rmcp tool
//!   dispatcher stays "initialized" between calls — which is what Claude
//!   Desktop, Cursor, and Claude Code expect.
//! - Tool responses are returned as a single-message `text/event-stream` (SSE)
//!   per the spec; clients consume the first message and close.
//!
//! Stateless JSON-response mode was evaluated and rejected: rmcp's stateless
//! path spins up a fresh `Service` per POST, so the `initialize` handshake on
//! one request is invisible to the next, and every `tools/list` call returns
//! an empty list. Stateful mode is the only configuration that works with
//! real MCP clients today.
//!
//! Sigil's *own* per-document session id (Spec 20 / Task 10) lives in tool
//! arguments and is orthogonal to the rmcp transport session above.
//!
//! ## Mounting
//!
//! The `sigil-server` binary nests this service under `/mcp`:
//!
//! ```rust,ignore
//! use sigil_mcp::http::mcp_http_service;
//! let router = axum::Router::new()
//!     .nest_service("/mcp", mcp_http_service(app_state));
//! ```
//!
//! The endpoint MUST NOT sit behind the `X-Sigil-Session` middleware — MCP
//! carries its session id as a tool argument, not as an HTTP header.

use std::sync::Arc;

use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::{StreamableHttpServerConfig, StreamableHttpService};
use sigil_state::AppState;

use crate::server::SigilMcpServer;

/// Builds the Streamable HTTP service for the MCP transport.
///
/// Returns a Tower service that can be mounted with
/// [`axum::Router::nest_service`] at `/mcp`. The service shares `state` with
/// the rest of the server, so MCP tools see the same document mutations as
/// GraphQL clients.
///
/// The factory closure clones `state` on every incoming request — `AppState`
/// is internally `Arc`-backed (document mutex, persistence channel, event
/// broadcaster) so this is cheap.
#[must_use]
pub fn mcp_http_service(
    state: AppState,
) -> StreamableHttpService<SigilMcpServer, LocalSessionManager> {
    // `StreamableHttpServerConfig` is `#[non_exhaustive]`; the builder methods
    // are the only public way to construct a custom configuration.
    //
    // We run in **stateful mode** (the rmcp default). Stateless mode treats
    // each POST as an isolated service instance, which makes the initialize ->
    // tools/list -> tools/call sequence unusable: the tool dispatcher only
    // becomes active after a successful `initialize` handshake, and that
    // handshake state is gone by the time the next POST arrives. Stateful
    // mode preserves the session across calls via the `Mcp-Session-Id`
    // response header — the way Claude Desktop, Cursor, and Claude Code all
    // drive Streamable HTTP servers.
    //
    // Sigil's *own* per-document session id (Spec 20 / Task 10) is carried
    // in tool arguments and is orthogonal to the rmcp transport session.
    let config = StreamableHttpServerConfig::default();

    StreamableHttpService::new(
        move || Ok(SigilMcpServer::new(state.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use sigil_state::AppState;
    use tokio::net::TcpListener;

    /// End-to-end smoke test: mount the MCP HTTP service in an Axum router,
    /// POST a JSON-RPC `initialize`, then `tools/list` carrying the returned
    /// `Mcp-Session-Id` header. Verifies:
    ///
    /// 1. The HTTP transport is wired to the rmcp `ServerHandler` impl on
    ///    `SigilMcpServer`.
    /// 2. Session continuity works: `tools/list` after `initialize` returns
    ///    a non-empty tool catalogue, proving the dispatcher stayed
    ///    initialized between requests.
    ///
    /// Stateful Streamable HTTP returns SSE and keeps the stream open after
    /// the response (for server-initiated notifications). The helper
    /// `read_first_sse_payload` consumes the body chunk-by-chunk and stops
    /// at the first non-empty `data:` event, mirroring what a real MCP
    /// client does after seeing its response id.
    #[tokio::test]
    async fn mcp_http_endpoint_initialize_then_tools_list_returns_tools() {
        let state = AppState::new();
        let router = Router::new().nest_service("/mcp", mcp_http_service(state));

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        let client = reqwest::Client::new();
        let url = format!("http://{addr}/mcp");

        // --- step 1: initialize ---
        let init_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "sigil-test", "version": "0.0.0" }
            }
        });
        let init_response = client
            .post(&url)
            .header("Accept", "application/json, text/event-stream")
            .header("Content-Type", "application/json")
            .json(&init_body)
            .send()
            .await
            .expect("send initialize");

        assert_eq!(init_response.status(), 200, "initialize should succeed");
        let session_id = init_response
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .expect("server must return Mcp-Session-Id on successful initialize")
            .to_owned();
        let init_payload = read_first_sse_payload(init_response)
            .await
            .expect("init SSE payload");
        assert_eq!(
            init_payload.get("jsonrpc").and_then(|v| v.as_str()),
            Some("2.0"),
        );
        assert!(
            init_payload.get("result").is_some(),
            "initialize must succeed, got: {init_payload}",
        );

        // --- step 2: notifications/initialized ---
        // Per MCP spec, the client signals it is ready by sending this
        // notification after a successful initialize. rmcp won't expose tools
        // until it sees this.
        let initialized_notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        let initialized_response = client
            .post(&url)
            .header("Accept", "application/json, text/event-stream")
            .header("Content-Type", "application/json")
            .header("Mcp-Session-Id", &session_id)
            .json(&initialized_notif)
            .send()
            .await
            .expect("send notifications/initialized");
        assert_eq!(initialized_response.status(), 202);
        drop(initialized_response);

        // --- step 3: tools/list using the session ---
        let list_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        });
        let list_response = client
            .post(&url)
            .header("Accept", "application/json, text/event-stream")
            .header("Content-Type", "application/json")
            .header("Mcp-Session-Id", &session_id)
            .json(&list_body)
            .send()
            .await
            .expect("send tools/list");
        assert_eq!(list_response.status(), 200);
        let list_payload = read_first_sse_payload(list_response)
            .await
            .expect("list SSE payload");
        let tools = list_payload
            .get("result")
            .and_then(|r| r.get("tools"))
            .and_then(|t| t.as_array())
            .expect("tools/list result must contain tools array");
        assert!(
            !tools.is_empty(),
            "Sigil exposes many MCP tools — list must be non-empty, got: {list_payload}",
        );
    }

    /// Consumes an SSE response body chunk-by-chunk and returns the first
    /// non-empty `data:` event payload parsed as JSON.
    ///
    /// rmcp's Streamable HTTP transport in stateful mode keeps the response
    /// stream open after sending the JSON-RPC reply (the spec allows the
    /// server to push notifications down the same channel). A naive
    /// `response.text().await` therefore blocks until the server closes the
    /// stream, which it does not do for synchronous tool calls. This helper
    /// stops reading as soon as the first useful event has been parsed,
    /// then drops the response (closing the connection from the client side).
    ///
    /// SSE event structure (per the rmcp emitter):
    ///
    /// ```text
    /// data:
    /// id: 0
    /// retry: 3000
    ///
    /// data: {"jsonrpc":"2.0",...}
    /// ```
    ///
    /// The empty priming `data:` line is skipped — it carries only the
    /// retry interval, not a JSON-RPC payload.
    async fn read_first_sse_payload(mut response: reqwest::Response) -> Option<serde_json::Value> {
        let mut buffer = String::new();
        while let Ok(Some(chunk)) = response.chunk().await {
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            for line in buffer.lines() {
                if let Some(rest) = line.strip_prefix("data:") {
                    let trimmed = rest.trim_start();
                    if trimmed.is_empty() {
                        // Skip priming `data:` events with empty payloads.
                        continue;
                    }
                    if let Ok(value) = serde_json::from_str(trimmed) {
                        return Some(value);
                    }
                }
            }
        }
        None
    }
}
