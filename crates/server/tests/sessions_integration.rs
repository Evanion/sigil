//! Integration tests for Spec 20 §2.2 — GraphQL session operations.
//!
//! Exercises `openSession`, `closeSession`, and `sessions` against a real
//! Axum stack (router, middleware, schema). The three operations MUST be
//! callable WITHOUT the `X-Sigil-Session` request header — they are the
//! bootstrap surface clients use to discover and create sessions before
//! issuing header-gated mutations.
//!
//! Tests use the multi-threaded tokio runtime because
//! `load_workfile_sync` (the loader bridge plugged into `Sessions::open`)
//! relies on `tokio::task::block_in_place`, which panics on the
//! single-threaded runtime.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sigil_core::CURRENT_SCHEMA_VERSION;
use sigil_server::{build_app, state::ServerState};

/// Starts a test server on a random port and returns its address.
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

/// POSTs a GraphQL request without the `X-Sigil-Session` header.
///
/// All three operations in this test file MUST succeed under this
/// header-absent path per spec 20 §2.2.
async fn post_graphql(addr: SocketAddr, body: Value) -> Value {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/graphql"))
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .expect("POST /graphql");
    assert_eq!(
        resp.status(),
        200,
        "GraphQL endpoint must accept this request"
    );
    resp.json().await.expect("body json")
}

/// Writes a minimal v(N) workfile (manifest + zero pages) so
/// `load_workfile_sync` accepts it.
///
/// We synthesize the manifest directly rather than using the pub(crate)
/// `save_workfile` helper to avoid widening the API surface.
async fn write_minimal_workfile(workfile_path: &Path, name: &str) {
    tokio::fs::create_dir_all(workfile_path)
        .await
        .expect("create workfile dir");
    tokio::fs::create_dir_all(workfile_path.join("pages"))
        .await
        .expect("create pages dir");
    let manifest = json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "name": name,
        "page_order": [],
    });
    tokio::fs::write(
        workfile_path.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
    )
    .await
    .expect("write manifest");
}

/// `Mutation.openSession` returns a populated [`GqlSessionInfo`] when the
/// path resolves to a valid v(N) workfile.
#[tokio::test(flavor = "multi_thread")]
async fn open_session_returns_session_info() {
    let addr = start_test_server().await;
    let dir = tempfile::tempdir().expect("temp dir");
    let workfile_path: PathBuf = dir.path().join("foo.sigil");
    write_minimal_workfile(&workfile_path, "Foo").await;

    let body = json!({
        "query": "mutation($p: String!) { openSession(path: $p) { id workfilePath title state openedAt } }",
        "variables": { "p": workfile_path.to_str().unwrap() }
    });
    let resp = post_graphql(addr, body).await;
    assert!(
        resp.pointer("/errors").is_none() || resp["errors"].as_array().is_none_or(Vec::is_empty),
        "no errors expected, got: {resp}"
    );
    let info = resp
        .pointer("/data/openSession")
        .expect("data.openSession present");
    let id = info
        .pointer("/id")
        .and_then(Value::as_str)
        .expect("id field");
    assert!(!id.is_empty(), "id must be non-empty");
    // Path may be canonicalized — assert the basename round-trips.
    let path_str = info
        .pointer("/workfilePath")
        .and_then(Value::as_str)
        .expect("workfilePath");
    assert!(
        path_str.ends_with("foo.sigil"),
        "workfile_path should end with .sigil dir name, got {path_str}"
    );
    assert_eq!(
        info.pointer("/title").and_then(Value::as_str),
        Some("foo"),
        "title should be derived from file stem"
    );
    assert_eq!(
        info.pointer("/state").and_then(Value::as_str),
        Some("LIVE"),
        "newly opened session must be LIVE"
    );
    // Task 17 will populate openedAt; for now the GraphQL contract is
    // "non-null empty string".
    assert_eq!(
        info.pointer("/openedAt").and_then(Value::as_str),
        Some(""),
        "openedAt is intentionally empty until Task 17"
    );
}

/// `Mutation.openSession` is idempotent — opening the same canonical path
/// twice returns the same SessionId.
///
/// This is the contract the Tauri shell relies on for window-create
/// dedup: opening a path that's already mapped to a window simply focuses
/// the existing window (spec 20 §3.2 window-create flow).
#[tokio::test(flavor = "multi_thread")]
async fn open_session_is_idempotent_for_canonical_path() {
    let addr = start_test_server().await;
    let dir = tempfile::tempdir().expect("temp dir");
    let workfile_path: PathBuf = dir.path().join("bar.sigil");
    write_minimal_workfile(&workfile_path, "Bar").await;

    let body = json!({
        "query": "mutation($p: String!) { openSession(path: $p) { id } }",
        "variables": { "p": workfile_path.to_str().unwrap() }
    });
    let id_a = post_graphql(addr, body.clone())
        .await
        .pointer("/data/openSession/id")
        .and_then(Value::as_str)
        .expect("first id")
        .to_string();
    let id_b = post_graphql(addr, body)
        .await
        .pointer("/data/openSession/id")
        .and_then(Value::as_str)
        .expect("second id")
        .to_string();
    assert_eq!(id_a, id_b, "second open of same path must return same id");
}

/// `Mutation.closeSession` returns `true` and removes the session from the
/// registry; subsequent `Query.sessions` must not include it.
#[tokio::test(flavor = "multi_thread")]
async fn close_session_returns_true_then_removes() {
    let addr = start_test_server().await;
    let dir = tempfile::tempdir().expect("temp dir");
    let workfile_path: PathBuf = dir.path().join("baz.sigil");
    write_minimal_workfile(&workfile_path, "Baz").await;

    let open_body = json!({
        "query": "mutation($p: String!) { openSession(path: $p) { id } }",
        "variables": { "p": workfile_path.to_str().unwrap() }
    });
    let id = post_graphql(addr, open_body)
        .await
        .pointer("/data/openSession/id")
        .and_then(Value::as_str)
        .expect("id")
        .to_string();

    let close_body = json!({
        "query": "mutation($id: ID!) { closeSession(id: $id) }",
        "variables": { "id": id.clone() }
    });
    let close_resp = post_graphql(addr, close_body).await;
    assert_eq!(
        close_resp.pointer("/data/closeSession"),
        Some(&json!(true)),
        "closeSession must return true on success"
    );

    let list_resp = post_graphql(addr, json!({ "query": "{ sessions { id } }" })).await;
    let ids: Vec<String> = list_resp
        .pointer("/data/sessions")
        .and_then(Value::as_array)
        .expect("sessions array")
        .iter()
        .filter_map(|s| s.pointer("/id").and_then(Value::as_str).map(String::from))
        .collect();
    assert!(
        !ids.contains(&id),
        "closed session id must not appear in subsequent sessions list, got: {ids:?}"
    );
}

/// `Query.sessions` is reachable without the `X-Sigil-Session` header and
/// surfaces every currently open session.
///
/// `ServerState::new` registers a default in-memory session at startup, so
/// the list is always non-empty (length 1 at the start of this test). Opening
/// an additional workfile session lifts the count to 2.
#[tokio::test(flavor = "multi_thread")]
async fn sessions_query_works_without_header_and_lists_open_sessions() {
    let addr = start_test_server().await;

    // Initial state: only the default in-memory session.
    let resp = post_graphql(
        addr,
        json!({ "query": "{ sessions { id workfilePath state } }" }),
    )
    .await;
    assert!(
        resp.pointer("/errors").is_none() || resp["errors"].as_array().is_none_or(Vec::is_empty),
        "no errors expected on sessions query, got: {resp}"
    );
    let initial: &Vec<Value> = resp
        .pointer("/data/sessions")
        .and_then(Value::as_array)
        .expect("sessions array");
    assert_eq!(
        initial.len(),
        1,
        "ServerState::new must register exactly one default in-memory session"
    );
    let default_id = initial[0]
        .pointer("/id")
        .and_then(Value::as_str)
        .expect("default id")
        .to_string();

    // Open a real workfile-backed session.
    let dir = tempfile::tempdir().expect("temp dir");
    let workfile_path: PathBuf = dir.path().join("listed.sigil");
    write_minimal_workfile(&workfile_path, "Listed").await;
    let open_body = json!({
        "query": "mutation($p: String!) { openSession(path: $p) { id } }",
        "variables": { "p": workfile_path.to_str().unwrap() }
    });
    let opened_id = post_graphql(addr, open_body)
        .await
        .pointer("/data/openSession/id")
        .and_then(Value::as_str)
        .expect("id")
        .to_string();

    // RF-007: sessions list now contains the newly-opened workfile session
    // ONLY — the synthetic in-memory default was displaced by the first
    // real openSession so it doesn't pollute MCP/header-less defaulting.
    let resp = post_graphql(
        addr,
        json!({ "query": "{ sessions { id workfilePath title state } }" }),
    )
    .await;
    let listed: &Vec<Value> = resp
        .pointer("/data/sessions")
        .and_then(Value::as_array)
        .expect("sessions array");
    let listed_ids: Vec<String> = listed
        .iter()
        .filter_map(|s| s.pointer("/id").and_then(Value::as_str).map(String::from))
        .collect();
    assert!(
        !listed_ids.contains(&default_id),
        "RF-007: synthetic in-memory session must be closed after first openSession, got: {listed_ids:?}",
    );
    assert!(
        listed_ids.contains(&opened_id),
        "opened session must appear in sessions list, got: {listed_ids:?}"
    );
    assert_eq!(
        listed.len(),
        1,
        "only the workfile session should remain after the synthetic default is displaced",
    );
    // Every entry must declare a state (LIVE on a healthy session).
    for s in listed {
        let st = s.pointer("/state").and_then(Value::as_str);
        assert_eq!(
            st,
            Some("LIVE"),
            "every healthy session must report LIVE state, got: {st:?}"
        );
    }
}

/// `Mutation.closeSession` returns a typed `SESSION_NOT_FOUND` error when
/// the id is unknown.
#[tokio::test(flavor = "multi_thread")]
async fn close_session_unknown_id_returns_session_not_found() {
    let addr = start_test_server().await;
    let bogus_id = uuid::Uuid::new_v4().to_string();
    let body = json!({
        "query": "mutation($id: ID!) { closeSession(id: $id) }",
        "variables": { "id": bogus_id }
    });
    let resp = post_graphql(addr, body).await;
    let errors = resp
        .pointer("/errors")
        .and_then(Value::as_array)
        .expect("errors array");
    assert!(!errors.is_empty(), "expected at least one error");
    let code = errors[0]
        .pointer("/extensions/code")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert_eq!(
        code, "SESSION_NOT_FOUND",
        "unknown session id must surface SESSION_NOT_FOUND, got: {code} (full: {errors:?})"
    );
}

/// `Mutation.openSession` returns a typed `INVALID_WORKFILE_PATH` error
/// when the path is malformed (does not end in `.sigil`, does not exist).
#[tokio::test(flavor = "multi_thread")]
async fn open_session_rejects_non_sigil_path() {
    let addr = start_test_server().await;
    let dir = tempfile::tempdir().expect("temp dir");
    // Directory exists but does not end in `.sigil`.
    let bogus_path = dir.path().join("not_a_workfile");
    tokio::fs::create_dir_all(&bogus_path)
        .await
        .expect("create dir");

    let body = json!({
        "query": "mutation($p: String!) { openSession(path: $p) { id } }",
        "variables": { "p": bogus_path.to_str().unwrap() }
    });
    let resp = post_graphql(addr, body).await;
    let errors = resp
        .pointer("/errors")
        .and_then(Value::as_array)
        .expect("errors array");
    assert!(!errors.is_empty(), "expected at least one error");
    let code = errors[0]
        .pointer("/extensions/code")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert_eq!(
        code, "INVALID_WORKFILE_PATH",
        "non-.sigil path must surface INVALID_WORKFILE_PATH, got: {code} (full: {errors:?})"
    );
}
