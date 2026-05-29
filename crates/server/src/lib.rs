#![warn(clippy::all, clippy::pedantic)]

//! Agent Designer server library.
//!
//! Exposes the application router builder and shared state types so that
//! integration tests can spin up test servers without duplicating setup.

pub mod graphql;
pub mod heartbeat;
pub mod persistence;
pub mod routes;
pub mod session_header;
pub mod session_persistence;
pub mod state;
pub mod test_support;
pub mod workfile;

use async_graphql::http::{ALL_WEBSOCKET_PROTOCOLS, GraphiQLSource};
use async_graphql_axum::{GraphQLProtocol, GraphQLRequest, GraphQLResponse, GraphQLWebSocket};
use axum::Extension;
use axum::Router;
use axum::extract::WebSocketUpgrade;
use axum::http::{HeaderMap, HeaderValue, Method};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::graphql::SigilSchema;
use crate::session_header::RequestSession;
use crate::state::ServerState;

/// Builds the full application router.
///
/// When `static_dir` is `Some`, a SPA fallback is configured to serve
/// static files and fall back to `index.html`. When `None` (e.g., in
/// integration tests), no static file serving is configured.
///
/// CORS policy is controlled by the `SIGIL_DEV_CORS` environment variable:
/// - Set: permissive CORS (for development with separate frontend dev server)
/// - Unset: restrictive CORS allowing only the production origin
///
/// # Panics
///
/// Panics if the hard-coded production origin `"http://localhost:4680"` fails
/// to parse as a `HeaderValue`. This is a compile-time-known string and will
/// never fail in practice.
pub fn build_app(state: ServerState, static_dir: Option<&str>) -> Router {
    let cors = if std::env::var("SIGIL_DEV_CORS").is_ok() {
        CorsLayer::permissive()
    } else {
        CorsLayer::new()
            .allow_origin("http://localhost:4680".parse::<HeaderValue>().unwrap())
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(tower_http::cors::Any)
    };

    let schema = graphql::build_schema(state.clone());

    // Streamable HTTP MCP transport (Spec 20 / Task 8).
    //
    // Mounted as a Tower service so rmcp can own the JSON-RPC dispatch and
    // protocol-version handshake. The service shares the `Sessions` registry
    // with the rest of the server — every MCP tool call therefore sees the
    // same session stores the GraphQL resolvers and WebSocket subscribers
    // see, and the `list_open_sessions` / `get_active_workfiles` tools return
    // the same set of open workfiles that the GraphQL `sessions` query returns.
    //
    // The route is intentionally outside the `session_header::middleware`
    // chain: MCP carries its Sigil session id as a tool argument (Task 10),
    // not as an HTTP header.
    let mcp_service = sigil_mcp::http::mcp_http_service(state.app.sessions.clone());

    let mut app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/heartbeat", get(crate::heartbeat::handler))
        .route("/graphql/ws", get(graphql_ws_handler))
        .nest_service("/mcp", mcp_service);

    // GraphQL endpoint: route through a custom handler that injects the
    // X-Sigil-Session header (extracted by `session_header::middleware`) into
    // the async-graphql request context. We attach the middleware to the
    // `/graphql` route directly so it does not run for `/health` or the WS
    // upgrade path (Task 7 wires session id into WS via connection_params).
    let graphql_route = if std::env::var("SIGIL_DEV_CORS").is_ok() {
        // RF-004: GET serves GraphiQL HTML in dev mode; POST serves GraphQL.
        get(graphiql).post(graphql_post_handler)
    } else {
        // Production: both GET and POST serve GraphQL (some clients use GET
        // for query operations).
        get(graphql_post_handler).post(graphql_post_handler)
    };

    app = app.route(
        "/graphql",
        graphql_route.layer(axum::middleware::from_fn(session_header::middleware)),
    );

    let app = app.layer(Extension(schema)).layer(cors).with_state(state);

    if let Some(dir) = static_dir {
        let spa = ServeDir::new(dir).not_found_service(ServeFile::new(format!("{dir}/index.html")));
        app.fallback_service(spa)
    } else {
        app
    }
}

/// Serves the `GraphiQL` interactive IDE for development.
async fn graphiql() -> Html<String> {
    Html(
        GraphiQLSource::build()
            .endpoint("/graphql")
            .subscription_endpoint("/graphql/ws")
            .finish(),
    )
}

/// GraphQL POST/GET handler that injects [`RequestSession`] (extracted by
/// [`session_header::middleware`]) into the async-graphql request context so
/// resolvers can read `ctx.data::<RequestSession>()`.
///
/// Without this plumbing the middleware would populate the request extension
/// but resolvers would have no way to read it from the async-graphql side.
async fn graphql_post_handler(
    Extension(schema): Extension<SigilSchema>,
    Extension(session): Extension<RequestSession>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let mut request = req.into_inner();
    request = request.data(session);
    schema.execute(request).await.into()
}

/// Returns `true` if the given origin is acceptable for WebSocket connections.
///
/// When `SIGIL_DEV_CORS` is set, all origins are accepted (development mode).
/// Otherwise, only `localhost` origins (any port, http or https) are permitted.
fn is_allowed_origin(origin: &str) -> bool {
    if std::env::var("SIGIL_DEV_CORS").is_ok() {
        return true;
    }
    // Accept http(s)://localhost[:port]
    origin
        .strip_prefix("http://localhost")
        .or_else(|| origin.strip_prefix("https://localhost"))
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(':'))
}

/// Handles the GraphQL WebSocket subscription endpoint with origin validation.
///
/// RF-002: Validates the `Origin` header before upgrading the connection.
/// Rejects requests from disallowed origins with HTTP 403.
///
/// Spec 20 (Task 7): extracts `sessionId` from the graphql-ws
/// `connection_init` payload via `on_connection_init` and inserts it into
/// the subscription context as [`RequestSession`]. Subscription resolvers
/// (`document_changed`, `transaction_applied`) read this to attach to the
/// correct per-session broadcast channel.
///
/// Malformed or missing `sessionId` produces `RequestSession(None)`, which
/// `resolve_subscription_session` resolves to the registry's default
/// session — matching the soft-fallback behavior of the HTTP path. A bad
/// session id surfaces as `SESSION_NOT_FOUND` from the resolver, not as a
/// WS-level connection rejection.
async fn graphql_ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    protocol: GraphQLProtocol,
    Extension(schema): Extension<SigilSchema>,
) -> impl IntoResponse {
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok())
        && !is_allowed_origin(origin)
    {
        tracing::warn!(
            origin,
            "rejected GraphQL WebSocket connection from disallowed origin"
        );
        return axum::http::StatusCode::FORBIDDEN.into_response();
    }

    ws.protocols(ALL_WEBSOCKET_PROTOCOLS)
        .on_upgrade(move |stream| {
            GraphQLWebSocket::new(stream, schema, protocol)
                .on_connection_init(extract_session_from_connection_params)
                .serve()
        })
        .into_response()
}

/// `on_connection_init` callback: parses `sessionId` from the graphql-ws
/// `connection_init` payload and inserts a [`RequestSession`] into the
/// subscription data context.
///
/// The payload format is `{ "sessionId": "<uuid-string>" }`. A missing or
/// malformed `sessionId` is tolerated (returns `RequestSession(None)`):
/// subscription resolvers fall back to the registry default. A non-UUID
/// string surfaces as `SESSION_NOT_FOUND` only when a resolver tries to
/// look it up.
async fn extract_session_from_connection_params(
    payload: serde_json::Value,
) -> async_graphql::Result<async_graphql::Data> {
    let session_id = parse_session_id_from_connection_params(&payload);
    let mut data = async_graphql::Data::default();
    data.insert(RequestSession(session_id));
    Ok(data)
}

/// Parses the `sessionId` field out of a graphql-ws `connection_init`
/// payload. Returns `None` when:
///
/// - the payload is not an object,
/// - `sessionId` is missing or not a string,
/// - `sessionId` is present but does not parse as a `UUIDv4`.
///
/// The caller (`extract_session_from_connection_params`) wraps this in a
/// [`RequestSession`] so the soft-fallback to the registry default session
/// happens at the resolver layer.
fn parse_session_id_from_connection_params(
    payload: &serde_json::Value,
) -> Option<sigil_state::sessions::SessionId> {
    payload
        .get("sessionId")
        .and_then(serde_json::Value::as_str)
        .and_then(|s| s.parse::<sigil_state::sessions::SessionId>().ok())
}

#[cfg(test)]
mod ws_connection_init_tests {
    //! Unit tests for the `on_connection_init` payload parsing.
    //!
    //! A full WS round-trip lives in `tests/` (integration); these tests
    //! exercise the payload-parsing logic in isolation so a regression is
    //! caught even when the WS harness is unavailable.

    use super::parse_session_id_from_connection_params;
    use serde_json::json;
    use sigil_state::sessions::SessionId;

    #[test]
    fn extracts_session_id_from_valid_payload() {
        let id = SessionId::new();
        let payload = json!({ "sessionId": id.to_string() });
        assert_eq!(parse_session_id_from_connection_params(&payload), Some(id));
    }

    #[test]
    fn missing_session_id_yields_none() {
        let payload = json!({});
        assert_eq!(
            parse_session_id_from_connection_params(&payload),
            None,
            "missing sessionId must fall through to the default session resolver"
        );
    }

    #[test]
    fn malformed_session_id_yields_none() {
        // A non-UUID string is tolerated here (soft fallback); the
        // resolver surfaces SESSION_NOT_FOUND if/when it tries to look up
        // the resulting `None` against a registry that has no default.
        let payload = json!({ "sessionId": "not-a-uuid" });
        assert_eq!(parse_session_id_from_connection_params(&payload), None);
    }

    #[test]
    fn non_string_session_id_yields_none() {
        let payload = json!({ "sessionId": 42 });
        assert_eq!(parse_session_id_from_connection_params(&payload), None);
    }

    #[test]
    fn null_payload_yields_none() {
        let payload = serde_json::Value::Null;
        assert_eq!(parse_session_id_from_connection_params(&payload), None);
    }

    #[tokio::test]
    async fn extract_callback_round_trips_valid_session_id() {
        // Confirms the async callback (the one actually wired into
        // GraphQLWebSocket) succeeds with a valid payload. Inspecting the
        // returned Data requires plumbing through async-graphql's Context;
        // we settle for Ok-vs-Err here and rely on the field-parse tests
        // above for value correctness.
        let id = SessionId::new();
        let payload = json!({ "sessionId": id.to_string() });
        let result = super::extract_session_from_connection_params(payload).await;
        assert!(result.is_ok(), "valid payload must not error");
    }

    #[tokio::test]
    async fn extract_callback_round_trips_missing_session_id() {
        let payload = json!({});
        let result = super::extract_session_from_connection_params(payload).await;
        assert!(
            result.is_ok(),
            "missing sessionId must not error (soft fallback)"
        );
    }
}
