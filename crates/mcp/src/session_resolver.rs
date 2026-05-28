//! Resolve which session a mutation tool call targets.
//!
//! Spec 20 / Task 10 introduces an optional `session_id` parameter on every
//! mutation tool. The resolver applies a three-rule priority order:
//!
//! 1. **Explicit `session_id` wins.** The caller named the session it wants;
//!    if that id is not registered, return [`SessionResolveError::NotFound`].
//! 2. **No explicit id, exactly one session open.** Use the only session.
//!    Single-session deployments (the historical sigil-server default, or a
//!    Tauri desktop window with one workfile open) keep working without any
//!    agent-side changes.
//! 3. **No explicit id, zero or many sessions.** Return
//!    [`SessionResolveError::NoSessions`] or
//!    [`SessionResolveError::Ambiguous`] respectively. The agent must call
//!    `list_open_sessions` and pass an explicit id.
//!
//! ## Why this is a helper, not inlined per-tool
//!
//! Every mutation tool needs the same three-rule resolution. Centralising the
//! logic here means:
//! - the rules cannot drift between tools,
//! - the error payload shape (`code` + `message` + `open_sessions`) is
//!   identical for every tool, and
//! - tests for the rules live in a single place rather than being scattered
//!   across N integration tests.
//!
//! ## Error payload
//!
//! [`SessionResolveError::to_mcp_error_payload`] renders each variant as a
//! JSON object suitable for embedding in an MCP `CallToolResult` error
//! response. The shape (`{ code, message, open_sessions }`) is what the
//! Tauri desktop frontend and the rmcp Streamable HTTP transport both expect.

use std::sync::Arc;

use serde_json::Value;
use sigil_state::Sessions;
use sigil_state::sessions::{DocumentSession, SessionId};
use std::str::FromStr;

/// Errors returned by [`resolve_session`].
///
/// Each variant carries enough information for the agent to either retry with
/// a corrected `session_id` (`NotFound`, `Ambiguous`) or to inform the human
/// that no workfile is open (`NoSessions`).
/// [`SessionResolveError::to_mcp_error_payload`] renders the variant as a JSON
/// object suitable for the MCP error envelope.
#[derive(Debug, thiserror::Error)]
pub enum SessionResolveError {
    /// Multiple sessions are open and the caller did not specify which one to
    /// target. The agent must call `list_open_sessions` and resend with an
    /// explicit `session_id`. The `open_sessions` field carries the same
    /// payload `list_open_sessions` would have returned so the agent can
    /// resolve in one round trip.
    #[error("session_id required: multiple sessions open and none specified")]
    Ambiguous {
        /// Per-session summary so the agent can pick one without an extra
        /// `list_open_sessions` call.
        open_sessions: Vec<Value>,
    },
    /// The caller passed a `session_id` that no registered session matches.
    /// Includes the bad id and the open-sessions list so the agent can correct
    /// itself.
    #[error("session not found: {id}")]
    NotFound {
        /// The id the caller passed that did not resolve.
        id: String,
        /// Per-session summary for recovery.
        open_sessions: Vec<Value>,
    },
    /// No sessions are open. The user must open a workfile in the desktop app
    /// (or via `--workfile` on the CLI) before any mutation tool can run.
    #[error("no sessions open — open a workfile in the desktop app first")]
    NoSessions,
    /// The provided `session_id` was not a valid UUID. Distinct from
    /// `NotFound` because the failure mode is different: a malformed id means
    /// the agent constructed the string wrong, not that the session has been
    /// closed.
    #[error("invalid session_id format: {0}")]
    InvalidFormat(String),
}

/// Resolve the target session for a mutation tool call.
///
/// See the module docs for the three-rule priority order.
///
/// # Errors
///
/// Returns one of the four [`SessionResolveError`] variants. Callers in the
/// rmcp tool layer should map the error via
/// [`SessionResolveError::to_mcp_error_payload`] into the
/// `CallToolResult::error(...)` envelope.
pub fn resolve_session(
    sessions: &Arc<Sessions>,
    explicit: Option<&str>,
) -> Result<SessionId, SessionResolveError> {
    let list = sessions.list();

    if let Some(s) = explicit {
        // Trim because callers (including some MCP client SDKs) may pass
        // whitespace-padded ids; rejecting on whitespace would surprise.
        let trimmed = s.trim();
        if trimmed.is_empty() {
            // An empty string is treated as "no explicit id" so it falls
            // through to the single-session / ambiguous resolution below.
            // This matches what `Option::None` would have done if the caller
            // had omitted the field; treating empty as "no id" is friendlier
            // than rejecting with InvalidFormat.
        } else {
            let id = SessionId::from_str(trimmed)
                .map_err(|_| SessionResolveError::InvalidFormat(s.to_string()))?;
            if sessions.get(id).is_none() {
                return Err(SessionResolveError::NotFound {
                    id: s.to_string(),
                    open_sessions: sessions_payload(&list),
                });
            }
            return Ok(id);
        }
    }

    if list.len() == 1 {
        return Ok(list[0].id);
    }

    if list.is_empty() {
        Err(SessionResolveError::NoSessions)
    } else {
        Err(SessionResolveError::Ambiguous {
            open_sessions: sessions_payload(&list),
        })
    }
}

/// Render the open-sessions list into the wire shape embedded in error
/// payloads. Mirrors the `list_open_sessions` tool's `SessionListEntry`
/// shape for `id` and `workfile_path`. We keep the payload terse on purpose:
/// the error response is shown inline in the agent's reasoning trace.
fn sessions_payload(sessions: &[Arc<DocumentSession>]) -> Vec<Value> {
    sessions
        .iter()
        .map(|s| {
            serde_json::json!({
                "id": s.id.to_string(),
                "workfile_path": s.workfile_path.to_string_lossy(),
            })
        })
        .collect()
}

impl SessionResolveError {
    /// Render as an MCP-style structured error suitable for inclusion in a
    /// tool's `CallToolResult::error(...)` response.
    ///
    /// The shape is `{ "code": <string>, "message": <string>,
    /// "open_sessions": <array> }` for every variant. `open_sessions` is the
    /// empty array for variants where it is not meaningful (e.g.
    /// `NoSessions`, `InvalidFormat`), preserving a uniform shape so the
    /// frontend / agent harness can parse without branching on the variant.
    #[must_use]
    pub fn to_mcp_error_payload(&self) -> Value {
        match self {
            Self::Ambiguous { open_sessions } => serde_json::json!({
                "code": "session_id_required",
                "message": "Multiple sessions open. Provide session_id.",
                "open_sessions": open_sessions,
            }),
            Self::NotFound { id, open_sessions } => serde_json::json!({
                "code": "session_not_found",
                "message": format!("Session {id} not found."),
                "open_sessions": open_sessions,
            }),
            Self::NoSessions => serde_json::json!({
                "code": "no_sessions_open",
                "message": "No sessions are open. Open a workfile first.",
                "open_sessions": [],
            }),
            Self::InvalidFormat(s) => serde_json::json!({
                "code": "invalid_session_id",
                "message": format!("session_id is not a valid UUID: {s}"),
                "open_sessions": [],
            }),
        }
    }

    /// Convert into an `rmcp::ErrorData` with the structured payload from
    /// [`Self::to_mcp_error_payload`] attached as the `data` field.
    ///
    /// Every variant maps to `INVALID_PARAMS` because each represents a
    /// caller-side mistake (missing/wrong/ambiguous id, no sessions to
    /// target). The structured `data` payload lets the agent recover by
    /// reading `open_sessions` and retrying without an extra round trip to
    /// `list_open_sessions`.
    #[must_use]
    pub fn to_rmcp_error(&self) -> rmcp::ErrorData {
        let payload = self.to_mcp_error_payload();
        rmcp::ErrorData::new(
            rmcp::model::ErrorCode::INVALID_PARAMS,
            self.to_string(),
            Some(payload),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sigil_core::Document;

    fn make_sessions() -> Arc<Sessions> {
        Arc::new(Sessions::new(64))
    }

    #[test]
    fn no_sessions_no_explicit_errors_with_no_sessions() {
        let s = make_sessions();
        let err = resolve_session(&s, None).unwrap_err();
        assert!(matches!(err, SessionResolveError::NoSessions));
    }

    #[test]
    fn invalid_format_errors() {
        let s = make_sessions();
        // Register one session so the resolver wouldn't pick "NoSessions"
        // before noticing the bad id format.
        let _ = s.register_in_memory(Document::new("alpha".into()));
        let err = resolve_session(&s, Some("not-a-uuid")).unwrap_err();
        assert!(matches!(err, SessionResolveError::InvalidFormat(_)));
    }

    #[test]
    fn one_session_no_explicit_picks_only_session() {
        let s = make_sessions();
        let id = s.register_in_memory(Document::new("solo".into()));
        let resolved = resolve_session(&s, None).expect("must resolve to the only session");
        assert_eq!(resolved, id);
    }

    #[test]
    fn one_session_with_matching_explicit_returns_it() {
        let s = make_sessions();
        let id = s.register_in_memory(Document::new("solo".into()));
        let resolved =
            resolve_session(&s, Some(&id.to_string())).expect("explicit id matches sole session");
        assert_eq!(resolved, id);
    }

    #[test]
    fn explicit_id_for_unknown_session_returns_not_found() {
        let s = make_sessions();
        // Keep registry non-empty so the helper does not short-circuit on
        // NoSessions; the explicit-id branch must run first.
        let _ = s.register_in_memory(Document::new("alpha".into()));
        let stray = SessionId::new(); // not registered
        let err = resolve_session(&s, Some(&stray.to_string())).unwrap_err();
        match err {
            SessionResolveError::NotFound { id, open_sessions } => {
                assert_eq!(id, stray.to_string());
                assert_eq!(
                    open_sessions.len(),
                    1,
                    "open_sessions must enumerate the registered sessions to aid recovery"
                );
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn multiple_sessions_no_explicit_returns_ambiguous() {
        let s = make_sessions();
        let _a = s.register_in_memory(Document::new("alpha".into()));
        let _b = s.register_in_memory(Document::new("beta".into()));
        let err = resolve_session(&s, None).unwrap_err();
        match err {
            SessionResolveError::Ambiguous { open_sessions } => {
                assert_eq!(open_sessions.len(), 2);
                for entry in open_sessions {
                    assert!(entry.get("id").and_then(|v| v.as_str()).is_some());
                    assert!(
                        entry
                            .get("workfile_path")
                            .and_then(|v| v.as_str())
                            .is_some()
                    );
                }
            }
            other => panic!("expected Ambiguous, got {other:?}"),
        }
    }

    #[test]
    fn multiple_sessions_with_explicit_picks_named_session() {
        let s = make_sessions();
        let a = s.register_in_memory(Document::new("alpha".into()));
        let b = s.register_in_memory(Document::new("beta".into()));
        // Ask for `b` specifically.
        let resolved =
            resolve_session(&s, Some(&b.to_string())).expect("must resolve to the named session");
        assert_eq!(resolved, b);
        assert_ne!(resolved, a, "must not pick the other session");
    }

    #[test]
    fn empty_string_explicit_falls_through_to_single_session() {
        // Some MCP client SDKs send `""` for omitted optional fields rather
        // than dropping the field. Treating empty-string as "not provided"
        // matches the friendlier Option::None path and avoids InvalidFormat.
        let s = make_sessions();
        let id = s.register_in_memory(Document::new("solo".into()));
        let resolved = resolve_session(&s, Some("")).expect("empty string treated as no id");
        assert_eq!(resolved, id);
    }

    #[test]
    fn whitespace_only_explicit_treated_as_no_id() {
        // Same friendliness rule as the empty-string case.
        let s = make_sessions();
        let id = s.register_in_memory(Document::new("solo".into()));
        let resolved = resolve_session(&s, Some("   ")).expect("whitespace-only treated as no id");
        assert_eq!(resolved, id);
    }

    #[test]
    fn whitespace_padded_uuid_is_accepted() {
        // Trim whitespace around a valid id rather than rejecting with
        // InvalidFormat. The id itself is the same uuid, just padded.
        let s = make_sessions();
        let id = s.register_in_memory(Document::new("solo".into()));
        let padded = format!("  {id}  ");
        let resolved = resolve_session(&s, Some(&padded)).expect("padded id must be accepted");
        assert_eq!(resolved, id);
    }

    #[test]
    fn error_payload_shape_for_ambiguous() {
        let s = make_sessions();
        let _ = s.register_in_memory(Document::new("a".into()));
        let _ = s.register_in_memory(Document::new("b".into()));
        let err = resolve_session(&s, None).unwrap_err();
        let payload = err.to_mcp_error_payload();
        assert_eq!(
            payload.pointer("/code").and_then(|v| v.as_str()),
            Some("session_id_required")
        );
        assert!(
            payload
                .pointer("/message")
                .and_then(|v| v.as_str())
                .is_some()
        );
        assert_eq!(
            payload
                .pointer("/open_sessions")
                .and_then(|v| v.as_array())
                .map(Vec::len),
            Some(2),
        );
    }

    #[test]
    fn error_payload_shape_for_not_found() {
        let s = make_sessions();
        let _ = s.register_in_memory(Document::new("a".into()));
        let stray = SessionId::new();
        let err = resolve_session(&s, Some(&stray.to_string())).unwrap_err();
        let payload = err.to_mcp_error_payload();
        assert_eq!(
            payload.pointer("/code").and_then(|v| v.as_str()),
            Some("session_not_found")
        );
        assert_eq!(
            payload
                .pointer("/open_sessions")
                .and_then(|v| v.as_array())
                .map(Vec::len),
            Some(1),
        );
    }

    #[test]
    fn error_payload_shape_for_no_sessions() {
        let s = make_sessions();
        let err = resolve_session(&s, None).unwrap_err();
        let payload = err.to_mcp_error_payload();
        assert_eq!(
            payload.pointer("/code").and_then(|v| v.as_str()),
            Some("no_sessions_open")
        );
        // open_sessions is always present (uniform shape), even if empty.
        assert_eq!(
            payload
                .pointer("/open_sessions")
                .and_then(|v| v.as_array())
                .map(Vec::len),
            Some(0),
        );
    }

    #[test]
    fn error_payload_shape_for_invalid_format() {
        let s = make_sessions();
        let _ = s.register_in_memory(Document::new("a".into()));
        let err = resolve_session(&s, Some("not-a-uuid")).unwrap_err();
        let payload = err.to_mcp_error_payload();
        assert_eq!(
            payload.pointer("/code").and_then(|v| v.as_str()),
            Some("invalid_session_id")
        );
        assert!(
            payload
                .pointer("/message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .contains("not-a-uuid")
        );
    }
}
