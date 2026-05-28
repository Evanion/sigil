//! Multi-session registry types for sigil-state.
//!
//! Sessions are keyed by canonical workfile path. Each session owns its own
//! `DocumentStore` and broadcast channel. Mutations route through `with_session`,
//! which provides panic isolation via `std::panic::catch_unwind`.
//!
//! This module contains only the foundational types — `SessionId`,
//! `SessionState`, and `SessionInfo`. The registry that uses these types
//! is introduced in Task 2 of plan-20.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Opaque session identifier. Wraps `UUIDv4`. Not persisted; safe to expose
/// to clients (frontend, MCP agents).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub Uuid);

impl SessionId {
    /// Generates a new random `SessionId` backed by `UUIDv4`.
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl std::str::FromStr for SessionId {
    type Err = uuid::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

/// Lifecycle state of a session. Mutations are rejected when state ==
/// [`SessionState::Errored`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    /// Session is healthy and accepts mutations.
    Live,
    /// Session encountered an unrecoverable error (e.g. apply-loop panic) and
    /// rejects further mutations until explicitly recovered or closed.
    Errored,
}

/// Lightweight metadata about a session, safe to serialize across the wire.
///
/// Used by Tauri commands, GraphQL queries, and MCP tools to expose session
/// state to clients without leaking the underlying `DocumentStore`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    /// Opaque session identifier.
    pub id: SessionId,
    /// Canonical absolute path to the `.sigil/` workfile directory.
    pub workfile_path: PathBuf,
    /// Human-readable title (defaults to workfile directory name).
    pub title: String,
    /// ISO-8601 timestamp captured when the session was opened.
    ///
    /// Stored as a string so this module remains free of clock dependencies
    /// (the caller in `sigil-server` is responsible for sourcing the time).
    pub opened_at: String,
    /// Current lifecycle state.
    pub state: SessionState,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_id_new_is_unique() {
        let a = SessionId::new();
        let b = SessionId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn test_session_id_roundtrip_display_parse() {
        let id = SessionId::new();
        let s = id.to_string();
        let back: SessionId = s.parse().expect("display output must round-trip");
        assert_eq!(id, back);
    }

    #[test]
    fn test_session_id_parse_rejects_garbage() {
        let result: Result<SessionId, _> = "not-a-uuid".parse();
        assert!(result.is_err());
    }

    #[test]
    fn test_session_state_serialization() {
        let live = serde_json::to_string(&SessionState::Live).expect("serialize Live");
        let errored = serde_json::to_string(&SessionState::Errored).expect("serialize Errored");
        assert_eq!(live, "\"Live\"");
        assert_eq!(errored, "\"Errored\"");
    }
}
