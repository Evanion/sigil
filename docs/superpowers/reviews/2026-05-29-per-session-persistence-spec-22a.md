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
- **Status:** resolved (commit `d16754e`) — Bounded every shutdown phase: `HTTP_DRAIN_TIMEOUT=3s` (new; axum drain spawned + timed from signal-fire via oneshot), `MCP_SHUTDOWN_TIMEOUT=2s` (was 5s), `PERSISTENCE_SHUTDOWN_TIMEOUT=3s` (was 5s). A compile-time `const _: () = assert!(…)` guarantees the 8s aggregate stays under `DOCKER_STOP_GRACE=10s`. MCP→persistence ordering preserved (persistence must capture MCP's final broadcast); the per-phase bound guarantees persistence always gets its full slice, so SIGKILL never interrupts the flush.
- **Description:** Shutdown runs sequentially: unbounded axum graceful drain, then `MCP_SHUTDOWN_TIMEOUT` (5s), then `PERSISTENCE_SHUTDOWN_TIMEOUT` (5s), with persistence flush **last**. Worst-case wall time exceeds Docker's default 10s `--stop-timeout`, so the orchestrator can SIGKILL the process mid-flush. Dirty session documents are lost. The most important data (unsaved document state) is gated behind the two least-important drains.
- **Recommended fix:** Flush persistence **first** (or run all three drains within a single bounded budget that is provably ≤ the Docker grace period). Bound the axum drain with an explicit timeout. Document the aggregate worst-case shutdown duration and assert it is ≤ the container stop grace.

### RF-002 — Commit `adb9459` mislabeled `refactor`
- **Severity:** Major
- **Source:** Compliance
- **Status:** wont-fix (rationale below) — **the squash-merge PR title MUST be `feat(server): …`**
- **Rationale:** This repo squash-merges every PR (main shows one conventional commit per PR with a `(#NN)` suffix, e.g. `feat: Tauri desktop + multi-session server (Spec 20) (#74)`). Individual branch commits — including `adb9459` — never reach main's permanent history; only the squash title does. §6 exists to calibrate review scrutiny by commit type, and that review already happened (Compliance caught this). Rewording `adb9459` would rewrite ~14 unpushed commit SHAs (invalidating the SHA receipts recorded in this file) for no lasting benefit, since the label is erased at squash. The §6 obligation is satisfied by authoring the PR squash title as `feat(server): per-session persistence (Spec 22a)`.
- **Description:** Commit `adb9459` is typed `refactor(server):` but introduces a new function `write_prepared_with_migration_flag` and removes public API surface. Per CLAUDE.md §6 type semantics, a `refactor` MUST NOT introduce new functions or change the public API domain — this is a `feat`. Mislabeling invites lighter review of code that actually changes behavior.
- **Recommended fix:** The commit is unpushed; amend the message to `feat(server):`. If history rewrite is undesirable, document the deviation with rationale.

### RF-003 — `shutdown_all` detaches rather than aborts on timeout; misleading log
- **Severity:** Medium
- **Source:** Architect F1 (= DevOps F5)
- **Status:** resolved (commit `66272c3`) — `shutdown_all` now captures `abort_handle()` for each task before the timeout, aborts stragglers on timeout, and the warn log states unsaved changes may be lost.
- **Description:** On shutdown timeout, `shutdown_all` drops the join handles (detach) rather than aborting the still-running tasks, and the log line implies a clean shutdown occurred. Orphaned tasks may still hold the session store read lock during a final save.
- **Recommended fix:** On timeout, `abort()` the stragglers and emit a warning naming the count of sessions that failed to drain within the budget.

### RF-004 — Migration-backup test asserts existence, not contents; startup save timing unasserted
- **Severity:** Medium
- **Source:** BE F5 (+ DevOps F4)
- **Status:** resolved (commit `66272c3`) — `test_migrated_session_force_persists_and_backs_up` now asserts `.backup-v1/manifest.json` bytes equal the original v1 manifest byte-for-byte AND the live `manifest.json` parses to `CURRENT_SCHEMA_VERSION` (v2).
- **Description:** The migration test checks that `.backup-v1/` exists but does not assert the backup file bytes equal the original v1 fixture. The forced-initial-save timing (that a migrated doc is persisted within the debounce window on startup) is also not asserted.
- **Recommended fix:** Assert backup file contents byte-for-byte against the v1 fixture; assert the forced initial save produces the v2 on-disk file within the expected window.

### RF-005 — `shutdown_all` post-drain registration race
- **Severity:** Low
- **Source:** BE F2
- **Status:** resolved (commit `66272c3`) — Doc comment added on `shutdown_all` naming the no-registration-after-shutdown assumption and why it is safe (shutdown is terminal).
- **Description:** A session registered after `shutdown_all` snapshots its handle map will not be flushed. Acceptable at shutdown (no new sessions are expected once shutdown begins), but undocumented.
- **Recommended fix:** Add a doc comment naming the assumption that no registration occurs after shutdown begins.

### RF-006 — `open_session` resolver skips `register` silently when `sessions.get` returns None
- **Severity:** Low
- **Source:** BE F4 (Security reviewer dismissed as unreachable)
- **Status:** resolved (commit `c26ef34`) — `open_session` resolver now has an `else` branch logging `tracing::error!` with the session id when `sessions.get` returns `None`, mirroring `main.rs::load_workfile_into_state`.
- **Description:** After `open_session_with`, if `sessions.get(id)` returns `None`, `persistence.register` is silently skipped with no diagnostic. The path should be unreachable.
- **Recommended fix:** Add an `else` branch logging an error — an unreachable path that becomes reachable should leave a trail.

### RF-007 — Stale comment referencing removed `dirty_tx` / old shutdown ordering
- **Severity:** Low
- **Source:** DevOps F2
- **Status:** resolved (commit `d16754e`) — Comment rewritten; no longer references the removed `dirty_tx`. Now explains the MCP-before-persistence ordering.
- **Description:** A comment references the removed `dirty_tx` channel and the old shutdown ordering.
- **Recommended fix:** Delete the stale comment.

### RF-008 — `persist_loop` saves idle (deadline=None) sessions on shutdown
- **Severity:** Low
- **Source:** DevOps F3
- **Status:** resolved (commits `66272c3`, `c26ef34`) — The `shutdown_rx` arm now flushes only when `deadline.is_some()` (dirty/pending). **Bonus fix:** doing so surfaced a genuine production data-loss race — `tokio::select!` is unbiased, so a final mutation broadcast and the shutdown signal could both be ready and the shutdown branch win, leaving the buffered mutation unflushed. The shutdown arm now drains buffered broadcast events via `try_recv` (arming the deadline for any pending `DocumentEvent`/`Lagged`) before the flush check. The `close()` contract refined from "always flush" to "flush pending work"; `test_close_flushes_before_returning` rewritten → `test_close_flushes_pending_work_before_returning`, and `test_close_session_flushes_and_deregisters_persistence` updated to arm a deadline before closing.
- **Description:** On shutdown, `persist_loop` performed a final save even for sessions with no armed deadline (not dirty), producing redundant clean-doc writes.

### RF-009 — `SessionFatal` arm does not clear the armed deadline
- **Severity:** Minor
- **Source:** Architect F2
- **Status:** resolved (commit `66272c3`) — Comment added on the `SessionFatal` arm: deadline intentionally preserved so an already-armed save still flushes; only new arming is suppressed.
- **Description:** The `SessionFatal` arm leaves an armed deadline in place. Intentional (the session is terminating) but undocumented.
- **Recommended fix:** Add a comment explaining the deadline is moot once the session is fatal.

### RF-010 — close + debounce double-save (verified safe)
- **Severity:** Info
- **Source:** BE F3
- **Status:** acknowledged — no action (documented for the record)
- **Description:** `close_session` flush plus a pending debounced save can both write. Verified safe: atomic temp+rename with unique suffix, idempotent serialization. Documented for the record.
- **Recommended fix:** No action.

### RF-011 — Dead `signal_dirty()` call (deferred to 22c)
- **Severity:** Info
- **Source:** Security
- **Status:** acknowledged — deferred to 22c by design
- **Description:** A residual `signal_dirty()` call remains on the legacy path. Removal is deferred to 22c (legacy field removal).
- **Recommended fix:** No action in 22a.

### RF-012 — Debounce starvation under sustained mutation (pre-existing)
- **Severity:** Info
- **Source:** Data Scientist
- **Status:** acknowledged — no action (pre-existing, behavior-preserving)
- **Description:** Under sustained high-frequency mutation, the absolute-deadline debounce still bounds the save interval; no unbounded starvation. Behavior-preserving relative to the legacy task.
- **Recommended fix:** No action.

### RF-013 — `persist_loop` shutdown race drops a final buffered mutation
- **Severity:** High (latent data loss) — surfaced during RF-008 remediation
- **Source:** Backend Engineer (remediation)
- **Status:** resolved (commit `66272c3`)
- **Description:** `tokio::select!` is unbiased. When a final mutation broadcast and the shutdown `oneshot` are both ready, the shutdown branch can win and the mutation — sitting unprocessed in the broadcast receiver buffer — is never seen, so its deadline is never armed and the change is lost on flush. Not caught by the original tests (which raced ~11/20 once the flush-when-dirty guard was added).
- **Recommended fix (applied):** The shutdown arm drains the receiver via `try_recv` before the flush decision, arming the deadline for any buffered `DocumentEvent`/`Lagged`. Verified deterministic (30/30, 15/15 across the two affected tests).
