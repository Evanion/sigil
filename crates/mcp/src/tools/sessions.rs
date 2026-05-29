//! Session-discovery tools.
//!
//! These tools take **no** `session_id` argument — they are how an agent
//! discovers which sessions exist in the running Sigil server before calling
//! any session-scoped mutation tool (see Task 10).
//!
//! ## Tools
//!
//! - `list_open_sessions` — primary name.
//! - `get_active_workfiles` — alias with the same return shape; some agent
//!   prompts find this name more discoverable.
//!
//! Both return a `SessionListResult` containing every session currently
//! registered in the [`Sessions`] registry.
//!
//! ## Broadcast obligations
//!
//! These tools are **read-only** — they do not mutate any session store and do not
//! broadcast a `SessionEvent`. The CLAUDE.md §4 "all state-mutating MCP tool
//! calls MUST trigger persistence AND broadcast" obligation does not apply.

use std::sync::Arc;

use sigil_state::Sessions;
use sigil_state::sessions::DocumentSession;

use crate::types::{SessionListEntry, SessionListResult};

/// Returns a snapshot of the currently-open sessions in the registry.
///
/// Equivalent to `Sessions::list()` followed by mapping each session to its
/// MCP-wire shape. The order is unspecified — the registry uses a `HashMap`
/// internally — so callers must not rely on a stable order between calls.
///
/// This is a free function (not bound to `SigilMcpServer`) so it can be
/// reused by both the rmcp tool handler and by tests that exercise the
/// transformation in isolation.
#[must_use]
pub fn list_open_sessions_impl(sessions: &Arc<Sessions>) -> SessionListResult {
    let entries: Vec<SessionListEntry> = sessions.list().iter().map(session_to_entry).collect();
    SessionListResult { sessions: entries }
}

/// Convert a `DocumentSession` into its MCP-wire `SessionListEntry`.
///
/// Extracted from the mapping above for direct testability and so the
/// state-snapshot logic (mutex acquisition with poison recovery) lives in
/// a single place.
fn session_to_entry(session: &Arc<DocumentSession>) -> SessionListEntry {
    // `to_string_lossy` is correct here: the wire shape is JSON, and we want
    // a best-effort UTF-8 rendering rather than an error. Paths registered
    // by `Sessions::open` are canonicalized real filesystem paths; the
    // synthetic `memory://<uuid>` path used by `register_in_memory` is also
    // UTF-8. Lossy conversion is therefore a no-op in practice but tolerant
    // of future paths that may include non-UTF-8 components.
    let workfile_path = session.workfile_path.to_string_lossy().into_owned();

    // Title is the workfile filename without extension. For the synthetic
    // `memory://<uuid>` path this yields the uuid; for `/abs/foo.sigil`
    // it yields `foo`. Falling back to "Untitled" handles the edge case of
    // a path with no file stem (e.g. `/`).
    let title = session
        .workfile_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();

    // The state mutex is short-held and never crosses an `.await` point.
    // Recover from poisoning (a panic in a session mutator) by reading the
    // last-known state — the session is already `Errored` in that case, so
    // the recovered value reflects reality.
    let state = match session.state.lock() {
        Ok(guard) => *guard,
        Err(poisoned) => *poisoned.into_inner(),
    };

    SessionListEntry {
        id: session.id.to_string(),
        workfile_path,
        title,
        state: format!("{state:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sigil_core::Document;
    use sigil_state::Sessions;
    use sigil_state::sessions::SessionState;
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    /// In-memory loader used by tests. The real loader lives in `sigil-server`.
    #[allow(clippy::unnecessary_wraps)]
    fn stub_loader(_path: &Path) -> Result<Document, std::convert::Infallible> {
        Ok(Document::new("test".to_string()))
    }

    /// Create a minimal `.sigil/` directory for tests.
    fn make_workfile(tmp: &TempDir, name: &str) -> PathBuf {
        let path = tmp.path().join(format!("{name}.sigil"));
        std::fs::create_dir(&path).expect("create .sigil dir");
        path
    }

    #[test]
    fn list_open_sessions_returns_empty_for_empty_registry() {
        let sessions = Arc::new(Sessions::new(64));
        let result = list_open_sessions_impl(&sessions);
        assert!(
            result.sessions.is_empty(),
            "empty registry must yield empty list"
        );
    }

    #[test]
    fn list_open_sessions_returns_each_open_session() {
        let tmp = TempDir::new().expect("tempdir");
        let path_a = make_workfile(&tmp, "alpha");
        let path_b = make_workfile(&tmp, "beta");
        let sessions = Arc::new(Sessions::new(64));
        let id_a = sessions.open(&path_a, stub_loader).expect("open a");
        let id_b = sessions.open(&path_b, stub_loader).expect("open b");

        let result = list_open_sessions_impl(&sessions);
        assert_eq!(result.sessions.len(), 2);

        // Order is unspecified — assert by id membership.
        let ids: Vec<&str> = result.sessions.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&id_a.to_string().as_str()));
        assert!(ids.contains(&id_b.to_string().as_str()));

        // Every entry carries a non-empty workfile_path and title.
        for entry in &result.sessions {
            assert!(!entry.workfile_path.is_empty());
            assert!(!entry.title.is_empty());
            // State is always one of the two SessionState variants
            // (Debug-formatted).
            assert!(matches!(entry.state.as_str(), "Live" | "Errored"));
        }
    }

    #[test]
    fn list_open_sessions_derives_title_from_file_stem() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "my-doc");
        let sessions = Arc::new(Sessions::new(64));
        sessions.open(&path, stub_loader).expect("open");

        let result = list_open_sessions_impl(&sessions);
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.sessions[0].title, "my-doc");
    }

    #[test]
    fn list_open_sessions_reports_live_state_for_healthy_session() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "live");
        let sessions = Arc::new(Sessions::new(64));
        sessions.open(&path, stub_loader).expect("open");

        let result = list_open_sessions_impl(&sessions);
        assert_eq!(result.sessions[0].state, "Live");
    }

    #[test]
    fn list_open_sessions_reports_errored_state_after_panic() {
        let tmp = TempDir::new().expect("tempdir");
        let path = make_workfile(&tmp, "panic");
        let sessions = Arc::new(Sessions::new(64));
        let id = sessions.open(&path, stub_loader).expect("open");

        // Trigger panic isolation: with_session catches the panic and marks
        // the session Errored.
        let _: Option<Result<(), String>> = sessions.with_session(id, |_| panic!("intentional"));

        // Sanity: the session is now Errored.
        let session = sessions.get(id).expect("session still registered");
        let state = *session.state.lock().expect("state lock");
        assert_eq!(state, SessionState::Errored);

        let result = list_open_sessions_impl(&sessions);
        assert_eq!(result.sessions.len(), 1, "errored session still listed");
        assert_eq!(result.sessions[0].state, "Errored");
    }

    #[test]
    fn list_open_sessions_includes_in_memory_registered_session() {
        let sessions = Arc::new(Sessions::new(64));
        let _id = sessions.register_in_memory(Document::new("ram".into()));

        let result = list_open_sessions_impl(&sessions);
        assert_eq!(result.sessions.len(), 1);
        // The synthetic `memory://<uuid>` path has no `.` extension and no
        // directory separator, so `file_stem` returns the whole "memory:" path
        // segment. Just assert title is non-empty (defensive contract).
        assert!(!result.sessions[0].title.is_empty());
    }
}
