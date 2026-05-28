//! Axum middleware extracting the `X-Sigil-Session` header into a request
//! extension consumed by GraphQL resolvers.
//!
//! Spec 20 (multi-session): every HTTP request that touches the document
//! store must identify its session. Single-document deployments fall back
//! to the registry's default session id (`App::default_session_id`) when
//! the header is absent, so existing clients continue to work unchanged.
//!
//! Malformed headers (non-ASCII bytes, invalid UUID) are rejected with
//! HTTP 400 — silently ignoring them would route the request to the
//! default session and mask a client bug.

use std::str::FromStr;

use axum::{
    body::Body,
    extract::Request,
    http::{Response, StatusCode},
    middleware::Next,
    response::IntoResponse,
};
use sigil_state::sessions::SessionId;

/// HTTP header name carrying the opaque session id.
pub const HEADER: &str = "X-Sigil-Session";

/// Request extension populated by [`middleware`].
///
/// `None` means the request did not include the header — handlers should
/// fall back to the registry default session id, or reject with
/// `SESSION_REQUIRED` if no default exists.
#[derive(Debug, Clone, Copy)]
pub struct RequestSession(pub Option<SessionId>);

/// Axum middleware that extracts and validates the `X-Sigil-Session`
/// header, inserting a [`RequestSession`] extension on the request.
///
/// # Errors
///
/// Returns HTTP 400 if the header is present but malformed:
/// - non-ASCII bytes that fail `to_str()`
/// - not a valid `UUIDv4`
pub async fn middleware(mut req: Request, next: Next) -> Result<Response<Body>, Response<Body>> {
    let session = match req.headers().get(HEADER) {
        None => None,
        Some(value) => {
            let s = value.to_str().map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("{HEADER}: non-ascii bytes"),
                )
                    .into_response()
            })?;
            let id = SessionId::from_str(s).map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("{HEADER}: not a valid UUID: {s}"),
                )
                    .into_response()
            })?;
            Some(id)
        }
    };
    req.extensions_mut().insert(RequestSession(session));
    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request as HttpRequest, StatusCode};
    use axum::middleware::from_fn;
    use axum::routing::get;
    use axum::{Extension, Router};
    use tower::ServiceExt;

    /// Handler used by the middleware tests; echoes whether the extension
    /// was populated with a valid `SessionId`.
    async fn echo(Extension(session): Extension<RequestSession>) -> String {
        match session.0 {
            Some(id) => format!("session={id}"),
            None => "no-session".to_string(),
        }
    }

    fn test_app() -> Router {
        Router::new()
            .route("/", get(echo))
            .layer(from_fn(super::middleware))
    }

    #[tokio::test]
    async fn middleware_inserts_none_when_header_absent() {
        let req = HttpRequest::builder().uri("/").body(Body::empty()).unwrap();
        let resp = test_app().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024)
            .await
            .expect("body");
        assert_eq!(&body[..], b"no-session");
    }

    #[tokio::test]
    async fn middleware_inserts_some_for_valid_uuid() {
        let id = SessionId::new();
        let req = HttpRequest::builder()
            .uri("/")
            .header(HEADER, id.to_string())
            .body(Body::empty())
            .unwrap();
        let resp = test_app().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024)
            .await
            .expect("body");
        assert_eq!(std::str::from_utf8(&body).unwrap(), format!("session={id}"));
    }

    #[tokio::test]
    async fn middleware_rejects_malformed_uuid_with_400() {
        let req = HttpRequest::builder()
            .uri("/")
            .header(HEADER, "not-a-uuid")
            .body(Body::empty())
            .unwrap();
        let resp = test_app().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn middleware_rejects_non_ascii_header_with_400() {
        // 0xff is invalid in UTF-8 and will fail to_str().
        let req = HttpRequest::builder()
            .uri("/")
            .header(
                HEADER,
                axum::http::HeaderValue::from_bytes(&[0xff]).unwrap(),
            )
            .body(Body::empty())
            .unwrap();
        let resp = test_app().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn session_id_parses_uuid_string() {
        let id = SessionId::new();
        let parsed: SessionId = id.to_string().parse().expect("round-trip");
        assert_eq!(parsed, id);
    }

    #[test]
    fn session_id_rejects_garbage() {
        let result: Result<SessionId, _> = "not-a-uuid".parse();
        assert!(result.is_err());
    }
}
