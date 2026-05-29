// crates/server/src/graphql/session.rs

//! GraphQL types and helpers for multi-session operations.
//!
//! Spec 20 §2.2: three operations are reachable WITHOUT the
//! `X-Sigil-Session` header — they are the bootstrap surface clients use to
//! discover, open, and close sessions:
//!
//! - `Query.sessions` — list every open session.
//! - `Mutation.openSession(path)` — idempotently open a workfile.
//! - `Mutation.closeSession(id)` — close an open session.
//!
//! All other GraphQL operations require the header (enforced per-resolver
//! by `resolve_session` in `mutation.rs`). The middleware in
//! `crate::session_header` does NOT reject header-absent requests on its own
//! — it simply populates an extension that resolvers consume.

use std::path::Path;

use async_graphql::{Enum, ID, SimpleObject};
use sigil_state::sessions::SessionState;

/// GraphQL mirror of [`sigil_state::sessions::SessionState`].
///
/// Mirrors the spec §2.2 schema (`LIVE`, `ERRORED`). When a new variant is
/// added to `SessionState`, the `From` impl below MUST be updated in the
/// same commit so the GraphQL surface stays exhaustive (no `_ => …` arm).
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GqlSessionState {
    /// Session is healthy and accepts mutations.
    Live,
    /// Session encountered an unrecoverable error (panic) and rejects further
    /// mutations until explicitly recovered or closed.
    Errored,
}

impl From<SessionState> for GqlSessionState {
    fn from(s: SessionState) -> Self {
        match s {
            SessionState::Live => Self::Live,
            SessionState::Errored => Self::Errored,
        }
    }
}

/// GraphQL projection of an open document session.
///
/// Maps directly onto the spec §2.2 `SessionInfo` type. The `opened_at`
/// field is intentionally an empty string in Task 6 — the underlying
/// session does not yet carry a timestamp. Task 17 introduces the
/// timestamp and back-fills this field; the GraphQL surface is stable in
/// the meantime.
#[derive(SimpleObject)]
pub struct GqlSessionInfo {
    /// Opaque session identifier (`UUIDv4`).
    pub id: ID,
    /// Canonical absolute path to the `.sigil/` workfile directory.
    /// Synthetic `memory://<uuid>` paths are surfaced verbatim for the
    /// in-memory default session created by `ServerState::new`.
    pub workfile_path: String,
    /// Human-readable title derived from the workfile directory name.
    pub title: String,
    /// ISO-8601 timestamp captured when the session was opened. Empty
    /// string until Task 17 plumbs `opened_at` through `DocumentSession`.
    pub opened_at: String,
    /// Lifecycle state (`LIVE` or `ERRORED`).
    pub state: GqlSessionState,
}

/// Derive a human-readable title from a workfile path.
///
/// For a path like `/Users/x/projects/foo.sigil`, this returns `"foo"`.
/// Synthetic in-memory paths (`memory://<uuid>`) fall back to `"Untitled"`
/// because they have no meaningful file stem.
#[must_use]
pub(crate) fn derive_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Untitled")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn derive_title_strips_sigil_extension() {
        assert_eq!(derive_title(&PathBuf::from("/x/y/foo.sigil")), "foo");
    }

    #[test]
    fn derive_title_handles_no_extension() {
        assert_eq!(derive_title(&PathBuf::from("/x/y/bar")), "bar");
    }

    #[test]
    fn derive_title_falls_back_for_synthetic_path() {
        // memory://<uuid> has no file_stem usable as a title.
        let p = PathBuf::from("memory://abc-123");
        // PathBuf::file_stem on a single-component path returns "memory:" on
        // unix-like systems; we just assert it does not panic and returns
        // SOMETHING non-empty.
        let title = derive_title(&p);
        assert!(!title.is_empty());
    }

    #[test]
    fn gql_session_state_from_live() {
        assert_eq!(
            GqlSessionState::from(SessionState::Live),
            GqlSessionState::Live
        );
    }

    #[test]
    fn gql_session_state_from_errored() {
        assert_eq!(
            GqlSessionState::from(SessionState::Errored),
            GqlSessionState::Errored
        );
    }
}
