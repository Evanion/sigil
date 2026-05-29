# Review Findings — Per-Session Persistence (Spec 22a)

**Branch:** `feature/per-session-persistence-spec-22a`
**Date:** 2026-05-29
**Reviewers:** Architect, Security, Backend Engineer, Logic, Compliance, Data Scientist, DevOps
**Diff scope:** 1,566 lines, 9 files (`crates/server/**`, `crates/state/**`)

This branch implements RF-014 part 22a: a per-session persistence manager driven by the session broadcast channel as a dirty-signal, replacing the legacy single-document persistence task. `session.store` is the persistence source of truth; the legacy `AppState` mirror removal is deferred to 22c.

---

## Findings

### RF-001 — Shutdown budget can exceed Docker grace → data loss
- **Severity:** High
- **Source:** DevOps F1
- **Status:** open
- **Description:** Shutdown runs sequentially: unbounded axum graceful drain, then `MCP_SHUTDOWN_TIMEOUT` (5s), then `PERSISTENCE_SHUTDOWN_TIMEOUT` (5s), with persistence flush **last**. Worst-case wall time exceeds Docker's default 10s `--stop-timeout`, so the orchestrator can SIGKILL the process mid-flush. Dirty session documents are lost. The most important data (unsaved document state) is gated behind the two least-important drains.
- **Recommended fix:** Flush persistence **first** (or run all three drains within a single bounded budget that is provably ≤ the Docker grace period). Bound the axum drain with an explicit timeout. Document the aggregate worst-case shutdown duration and assert it is ≤ the container stop grace.

### RF-002 — Commit `adb9459` mislabeled `refactor`
- **Severity:** Major
- **Source:** Compliance
- **Status:** open
- **Description:** Commit `adb9459` is typed `refactor(server):` but introduces a new function `write_prepared_with_migration_flag` and removes public API surface. Per CLAUDE.md §6 type semantics, a `refactor` MUST NOT introduce new functions or change the public API domain — this is a `feat`. Mislabeling invites lighter review of code that actually changes behavior.
- **Recommended fix:** The commit is unpushed; amend the message to `feat(server):`. If history rewrite is undesirable, document the deviation with rationale.

### RF-003 — `shutdown_all` detaches rather than aborts on timeout; misleading log
- **Severity:** Medium
- **Source:** Architect F1 (= DevOps F5)
- **Status:** open
- **Description:** On shutdown timeout, `shutdown_all` drops the join handles (detach) rather than aborting the still-running tasks, and the log line implies a clean shutdown occurred. Orphaned tasks may still hold the session store read lock during a final save.
- **Recommended fix:** On timeout, `abort()` the stragglers and emit a warning naming the count of sessions that failed to drain within the budget.

### RF-004 — Migration-backup test asserts existence, not contents; startup save timing unasserted
- **Severity:** Medium
- **Source:** BE F5 (+ DevOps F4)
- **Status:** open
- **Description:** The migration test checks that `.backup-v1/` exists but does not assert the backup file bytes equal the original v1 fixture. The forced-initial-save timing (that a migrated doc is persisted within the debounce window on startup) is also not asserted.
- **Recommended fix:** Assert backup file contents byte-for-byte against the v1 fixture; assert the forced initial save produces the v2 on-disk file within the expected window.

### RF-005 — `shutdown_all` post-drain registration race
- **Severity:** Low
- **Source:** BE F2
- **Status:** open
- **Description:** A session registered after `shutdown_all` snapshots its handle map will not be flushed. Acceptable at shutdown (no new sessions are expected once shutdown begins), but undocumented.
- **Recommended fix:** Add a doc comment naming the assumption that no registration occurs after shutdown begins.

### RF-006 — `open_session` resolver skips `register` silently when `sessions.get` returns None
- **Severity:** Low
- **Source:** BE F4 (Security reviewer dismissed as unreachable)
- **Status:** open
- **Description:** After `open_session_with`, if `sessions.get(id)` returns `None`, `persistence.register` is silently skipped with no diagnostic. The path should be unreachable.
- **Recommended fix:** Add an `else` branch logging an error — an unreachable path that becomes reachable should leave a trail.

### RF-007 — Stale comment referencing removed `dirty_tx` / old shutdown ordering
- **Severity:** Low
- **Source:** DevOps F2
- **Status:** open
- **Description:** A comment references the removed `dirty_tx` channel and the old shutdown ordering.
- **Recommended fix:** Delete the stale comment.

### RF-008 — `persist_loop` saves idle (deadline=None) sessions on shutdown
- **Severity:** Low
- **Source:** DevOps F3
- **Status:** open
- **Description:** On shutdown, `persist_loop` performs a final save even for sessions with no armed deadline (not dirty), producing redundant clean-doc writes.
- **Recommended fix:** Skip the final save when no deadline is armed and the document is not dirty.

### RF-009 — `SessionFatal` arm does not clear the armed deadline
- **Severity:** Minor
- **Source:** Architect F2
- **Status:** open
- **Description:** The `SessionFatal` arm leaves an armed deadline in place. Intentional (the session is terminating) but undocumented.
- **Recommended fix:** Add a comment explaining the deadline is moot once the session is fatal.

### RF-010 — close + debounce double-save (verified safe)
- **Severity:** Info
- **Source:** BE F3
- **Status:** open
- **Description:** `close_session` flush plus a pending debounced save can both write. Verified safe: atomic temp+rename with unique suffix, idempotent serialization. Documented for the record.
- **Recommended fix:** No action.

### RF-011 — Dead `signal_dirty()` call (deferred to 22c)
- **Severity:** Info
- **Source:** Security
- **Status:** open
- **Description:** A residual `signal_dirty()` call remains on the legacy path. Removal is deferred to 22c (legacy field removal).
- **Recommended fix:** No action in 22a.

### RF-012 — Debounce starvation under sustained mutation (pre-existing)
- **Severity:** Info
- **Source:** Data Scientist
- **Status:** open
- **Description:** Under sustained high-frequency mutation, the absolute-deadline debounce still bounds the save interval; no unbounded starvation. Behavior-preserving relative to the legacy task.
- **Recommended fix:** No action.
