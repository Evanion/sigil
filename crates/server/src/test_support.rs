//! Test-only constructors shared across server unit/integration tests.
//!
//! Spec 22b: with the legacy `AppState` removed, tests can no longer reach a
//! document via `state.app.document.lock()`. This helper returns a
//! `ServerState` with exactly one in-memory session registered (and set as the
//! default), plus the `Arc<DocumentSession>` handle so tests can read or write
//! the session store directly.
//!
//! This module is `pub` (not `#[cfg(test)]`) so that `tests/` integration
//! targets — which compile against the crate externally — can reach it. The
//! `#![allow(dead_code)]` below suppresses the unused-symbol warning under
//! `-D warnings` for the normal (non-test) build, where nothing in the crate
//! links the helper.

#![allow(dead_code)]

use std::sync::Arc;

use sigil_state::sessions::DocumentSession;

use crate::state::ServerState;

/// Build a `ServerState` with one in-memory default session and return both
/// the state and the session handle.
///
/// # Panics
///
/// Panics if `ServerState::new()` does not register a default in-memory
/// session, or if that session is absent from the registry. Both are
/// invariants of `ServerState::new()` (see
/// `test_server_state_registers_default_in_memory_session`); a panic here
/// indicates that invariant was broken, which a test should surface loudly.
#[must_use]
pub fn new_state_with_session() -> (ServerState, Arc<DocumentSession>) {
    let state = ServerState::new();
    let id = state
        .app
        .default_session_id()
        .expect("ServerState::new registers a default in-memory session");
    let session = state
        .app
        .sessions
        .get(id)
        .expect("default session must be present");
    (state, session)
}
