#![warn(clippy::all, clippy::pedantic)]

//! Agent Designer server library.
//!
//! Exposes the application router builder and shared state types so that
//! integration tests can spin up test servers without duplicating setup.

pub mod graphql;
pub mod persistence;
pub mod routes;
pub mod state;
pub mod workfile;

use async_graphql::http::{ALL_WEBSOCKET_PROTOCOLS, GraphiQLSource};
use async_graphql_axum::{GraphQL, GraphQLProtocol, GraphQLWebSocket};
use axum::Extension;
use axum::Router;
use axum::extract::WebSocketUpgrade;
use axum::http::{HeaderMap, HeaderValue, Method};
use axum::response::{Html, IntoResponse};
use axum::routing::{get, get_service};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::graphql::SigilSchema;
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

    let mut app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/graphql/ws", get(graphql_ws_handler));

    // GraphQL endpoint accepts both GET (query params) and POST (JSON body).
    // GET is required because urql's fetchExchange sends queries as GET by default.
    let graphql_service = GraphQL::new(schema.clone());
    if std::env::var("SIGIL_DEV_CORS").is_ok() {
        // RF-004: Also expose GraphiQL IDE in development mode (separate GET handler).
        app = app.route("/graphql", get(graphiql).post_service(graphql_service));
    } else {
        app = app.route(
            "/graphql",
            get_service(graphql_service.clone()).post_service(graphql_service),
        );
    }

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
        .on_upgrade(move |stream| GraphQLWebSocket::new(stream, schema, protocol).serve())
        .into_response()
}
