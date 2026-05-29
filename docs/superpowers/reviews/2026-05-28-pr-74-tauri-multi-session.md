# PR #74 Review Findings — Tauri Desktop + Multi-Session Server (Spec 20)

**PR:** https://github.com/Evanion/sigil/pull/74
**Branch:** `feature/desktop-multi-session`
**Reviewers dispatched:** Architect, Security, BE, Logic, Compliance, Data Scientist, FE, A11y, UX, DevOps (10 reviewers).
**Reviewer status:** All 10 reviewers stalled at the 10-minute watchdog because the 21,570-line diff exceeded their stream-rate budget. Findings below were extracted from each reviewer's last captured thoughts at watchdog timeout, supplemented with direct CI-failure analysis by the controller.

---

## Findings

| ID | Source | Severity | Description | Recommended Fix | Status |
|----|--------|----------|-------------|-----------------|--------|
| RF-001 | UX | Critical | `installMenuListener` from `frontend/src/transport/menu-events.ts` has no consumer wired into the main editor App (`frontend/src/App.tsx` or equivalent). Native menubar emits `menu-action` events; the dispatcher exists but nothing routes those actions to the store's undo/redo or any handler. Edit→Undo (Cmd+Z) via menubar produces no effect. | Wire `installMenuListener({onUndo, onRedo, onNewWorkfile, onOpenWorkfile, onCloseWindow, …})` from inside the editor's root component (likely `frontend/src/App.tsx` or `document-store-solid.tsx`) and route handlers to the existing store API. Add a smoke test that emits a Tauri event and asserts the handler ran. | open |
| RF-002 | CI / Controller | Critical | `cargo test --no-run` with `RUSTFLAGS=-D warnings` failed: 6 sites discarded the `#[must_use]` return of `Sessions::register_in_memory` in `crates/mcp/src/session_resolver.rs` tests. CI escalated to compile errors. | Fixed in commit `65c1f84` — bound each return value to `let _ =`. Also tightened two `iter().any(|n| *n == "X")` → `contains(&"X")` checks in `crates/mcp/src/http.rs`. | resolved |
| RF-003 | Logic | High | `sessions.json` atomic-write race in `src-tauri/src/sessions_persist.rs::save`. Tmp file path is fixed `<dir>/sessions.json.tmp`. Two concurrent saves interleave: A writes tmp, B overwrites tmp, A renames (gets B's content), B renames (ENOENT — tmp gone). Result: A's content is silently lost; B logs an error. Trigger: window-create racing window-close, or two open-intents racing. | Use a unique tmp suffix per call: `path.with_extension(format!("json.tmp.{}", uuid::Uuid::new_v4().simple()))`. Same pattern applies to `recent_files.rs` (verify) and any other persist path. | open |
| RF-004 | Logic / Architect | High | Heartbeat supervisor can fire `CrashDetected` twice in rapid succession. After firing, the supervisor resets `failures = 0` but keeps ticking. If the new server hasn't bound the port within 5s, the next tick fails, and after 3 more failures (15s) a second `CrashDetected` fires while `handle_crash` is still mid-recovery. Two `handle_crash` runs in parallel double-respawn the server. | Add an in-flight guard: after sending `CrashDetected`, supervisor enters a "draining" state until the consumer signals recovery complete (e.g. via a `RecoveryComplete` mpsc message back, or via shared `AtomicBool`). Alternatively: serialize the consumer with a `tokio::sync::Mutex` around `handle_crash`. | open |
| RF-005 | Compliance | High | Spec §10 "Cross-Stack Type Extension Inventory" commits to creating `frontend/src/types/session.ts` mirroring `SessionInfo`. The PR ships GraphQL `GqlSessionInfo` + `GqlSessionState` but never creates the TS mirror. Per the "Staged Feature Delivery Contract" (CLAUDE.md §10), the PR description MUST include a "Deferred-to-later-plan inventory" enumerating deferred items — present for some items, missing for this one. | Either ship the TS type now (consumed only by the welcome window if it later displays SessionState badges) OR amend the PR description with an explicit "Deferred: frontend/src/types/session.ts — owner: follow-up PR; rationale: no current consumer". | open |
| RF-006 | Security / Data Scientist | Major | No `MAX_SESSIONS` constant. An abusive caller (runaway agent, hostile script via MCP — bound to localhost) can call `openSession` in a loop until OOM. Spec §8 Input Validation Inventory does not enumerate a session-count limit. | Add `MAX_SESSIONS = 256` (or similar) as a constant in `crates/state/src/sessions.rs`. Enforce in `Sessions::open`. Add `test_max_sessions_enforced` per CLAUDE.md §11 "Constant Enforcement Tests". | open |
| RF-007 | Architect | Major | In-memory default session created at server startup is not displaced when the user opens a real workfile via `openSession`. The synthetic `memory://<uuid>` session stays in the registry, and `default_session_id` keeps pointing at it. Header-less MCP/GraphQL calls route there instead of to the workfile. Desktop windows always inject `__SIGIL_SESSION_ID__` so they're unaffected; the bug surfaces only for header-less MCP tool calls under "rule 2: single open session." | When `openSession` first succeeds for a real workfile, replace `default_session_id` with the new SessionId AND close the synthetic in-memory session if no client subscribed to it. Alternatively: skip in-memory session creation entirely when CLI args don't request `--workfile` — let the registry start empty. | open |
| RF-008 | FE | Major | i18n keys using `{{count}}` interpolation (e.g. `reopenPrompt`, `reopening`) lack `_one` / `_other` plural variants. en/es/fr all default to the base key, producing "Reopen 1 previous workfiles?" — grammatically wrong. | Add plural variants per locale (`reopenPrompt_one: "Reopen 1 previous workfile?"`, `reopenPrompt_other: "Reopen {{count}} previous workfiles?"`) for en, and equivalents for es/fr. | open |
| RF-009 | FE | Major | No `Welcome.test.tsx`. Per `.claude/rules/frontend-defensive.md` §"Reactive Pipelines Must Be Verified End-to-End", "every new reactive connection must have at least one integration or component test that asserts the consumer receives and acts on the value." The recent-click → `invoke("open_workfile_path")` pipeline, the reopen banner → loop-invoke pipeline, and the onMount → setRecents pipelines are all untested. | Add `Welcome.test.tsx` with at least: (1) clicking a recent entry invokes `open_workfile_path` with the entry's path; (2) clicking Reopen invokes `open_workfile_path` once per restorable entry; (3) clicking Skip invokes `clear_restorable_workfiles`. | open |
| RF-010 | DevOps | Major | `tauri-build.yml` not covered by `ci.yml`'s `pin-check` job (line 188 hardcodes `.github/workflows/ci.yml` as the only file scanned). Drift risk — future changes to `tauri-build.yml` could introduce floating-tag actions without CI noticing. | Extend the pin-check job to loop over `.github/workflows/*.yml`. Add a violation-fires sentinel test per CLAUDE.md §11 "CI Guards Must Ship With a Violation-Fires Test". | open |
| RF-011 | A11y | Major | `Welcome.tsx::onReopen` awaits each `invoke("open_workfile_path")` in a loop. If one path fails to open (file deleted, permissions changed), the failure is `console.error`'d but the status region still announces success on completion. Per CLAUDE.md §11 "Handlers Must Surface Validation Failures to the User", the user must see which entries failed. | Collect failures in a `Vec<{path, error}>` during the loop; if non-empty, announce via the status region "Reopened N of M; failed: …" with the offending paths, OR show inline error indicators next to the failed entries. | open |
| RF-012 | Logic / Task 16 implementer's flagged concern | Medium | `handle_crash` snapshot → respawn → openSession-per-path → emit. If the user closes a window during the await, the label is in the snapshot but no longer in `state.windows`. The re-insert at the end inserts a `WindowBinding` for a closed window — leaked entry, never cleaned. | Inside the replay loop, BEFORE `state.windows.insert(label, ...)`, call `app.get_webview_window(&label)` and skip the insert if `None`. The webview-gone case can also call `state.gql.close_session(new_id)` to avoid a server-side orphan. | open |
| RF-013 | Architect / Logic | Medium | 500ms post-respawn sleep before retrying `openSession` is a magic number. On slow machines or under load, the new sigil-server may not have bound port 4680 yet; the first replay attempt fails. | Replace with a heartbeat poll loop: every 100ms, GET `/heartbeat`; succeed when 200 OK; fail (and report) after 5s total. Re-use `supervision::Supervisor`'s client logic. | open |
| RF-014 | Data Scientist / PR description | Medium | Legacy `state.app.legacy.document` mirror in `apply_operations` doubles every mutation's write+broadcast cost. Each mutation: acquire legacy mutex → write → acquire session.store RwLock → write → broadcast on both legacy.event_tx and session.broadcast. PR description names this as transitional, scheduled for cleanup once MCP read tools migrate. | Track follow-up: in a sibling PR, migrate the 5 read-only MCP tools (`get_document_info`, `get_document_tree`, `list_pages`, `list_tokens`, `list_components`) to read from session.store, then drop `legacy.document` and the dual broadcast. | wont-fix-this-pr |
| RF-015 | A11y | Medium | `<button title={entry.path}>` on Welcome's recent list is shown only on mouse hover. Keyboard users navigating via Tab do not see the full path — only the basename. Screen readers may or may not announce `title` depending on implementation. | Make the full path visible on focus: add a `:focus-within` sibling reveal, OR use `aria-describedby` pointing at a visually-hidden `<span>` containing the path, OR include the path text in the button's accessible name (e.g. `<button aria-label={`Open ${basename}, ${path}`}>`). | open |
| RF-016 | Data Scientist / Architect | Low | `mpsc::channel(16)` between supervisor and consumer. If `handle_crash` takes >80s, supervisor blocks on send. Realistic? Unlikely (recovery should be sub-second), but possible under sustained CPU starvation. | Switch `Healthy` events to `tokio::sync::watch` (overwrites on send, no buffer pressure) and keep `CrashDetected` on `mpsc(1)` with an in-flight guard. | open |
| RF-017 | Data Scientist | Low | `windows.iter().find(...)` linear scan in `AppState::first_window_for_path`. For realistic window count (<10), trivial. Flag if multi-workfile UI (deferred to follow-up spec) explodes the count. | Add a reverse `HashMap<PathBuf, Vec<String>>` index alongside `windows` IF the future multi-workfile UI brings >100 windows. Not required now. | wont-fix |
| RF-018 | FE / PR description | Low | `installSessionEventListeners` registers three Tauri listeners but the store's `destroy()` is never called from the editor's root component. Listeners leak for the document lifetime. Acceptable for a singleton-store SPA but flagged. | When the editor's root component is unmounted (e.g. on HMR or test teardown), call `store.destroy()` to drop the listeners. | open |
| RF-019 | DevOps | Low | `tauri-build.yml` lacks a `concurrency:` block to cancel in-progress builds on new pushes. Standard pattern in modern workflows; reduces CI cost. | Add `concurrency: { group: "tauri-build-${{ github.ref }}", cancel-in-progress: true }`. | open |
| RF-020 | Architect | Low | rmcp's transport-level "session" (Mcp-Session-Id header) and Sigil's per-workfile "session" share the name. Future reader may conflate. | Add a one-paragraph note to spec §2.3 disambiguating the two concepts. | open |
| RF-021 | CI / Frontend | Info | Pre-existing flake: `src/store/__tests__/document-store-corners.test.ts` produces an `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` during teardown when run with `--coverage`. Tests still pass (2131/2131) but the unhandled rejection trips vitest's exit-1. Task 18 implementer noted this exists on `HEAD~1`. | Investigate the test's cleanup: likely a `setTimeout`/`onCleanup` race during teardown. Separate from this PR. File as a follow-up issue. | open |
| RF-022 | Architect / PR description | Info | `window.location.reload()` on `session-replaced` event is the recovery mechanism. Documented as DONE_WITH_CONCERNS in PR description. Loses transient UI state (zoom level, selected element) but workfile content is on disk. Acceptable trade-off for a crash-recovery event the user is already notified about. | In a follow-up: implement in-place urql client rebuild that preserves transient UI state. Out of scope for v1. | wont-fix-this-pr |
| RF-023 | BE | Info | PR has 21 commits all labeled `feat(...)`. Task 3 (`b063e88`) is App-wrapper + Sessions registration — the per-CLAUDE.md §6 "feat" label is correct (new capability: Sessions registry). Task 5 (`9454411`) is "X-Sigil-Session middleware + GraphQL migration" — mixes new capability (middleware) with behavior-preserving migration (apply_operations refactor). `feat` is defensible because the public surface gains the header semantic. | Document the labeling judgment in a comment if anyone re-reviews. No action required. | wont-fix |

---

## Summary

- **Critical:** 2 (1 user-facing menubar dead — RF-001; 1 CI compile error — RF-002 resolved).
- **High:** 3 (sessions.json race, supervisor double-recovery, missing TS type).
- **Major:** 6 (MAX_SESSIONS, in-memory session displacement, i18n plurals, Welcome tests, tauri-build.yml pin coverage, onReopen failure surfacing).
- **Medium:** 4 (crash recovery binding leak, heartbeat-poll-instead-of-sleep, legacy mirror cleanup, recent file tooltip a11y).
- **Low:** 5 (mpsc backpressure, windows linear scan, listener cleanup, workflow concurrency, rmcp/Sigil "session" naming).
- **Info:** 3 (vitest teardown flake, reload-vs-rebuild trade-off, commit labels).

Critical RF-001 (menubar disconnected) blocks the user-facing claim "menubar works." Critical RF-002 (CI compile) resolved in `65c1f84`.

## Status legend

- `open` — needs remediation in this PR.
- `resolved` — fixed in a remediation commit on this branch.
- `wont-fix-this-pr` — explicit deferral; documented for follow-up.
- `wont-fix` — judged out of scope or non-issue.

## Remediation status (post Phase 3)

Commit `65c1f84` resolved RF-002 (CI compile). Commit `e880b31` resolved the
remaining Critical, all High, all Major, three of four Medium, and two of
five Low. Final status by ID:

| ID | Status | Where |
|----|--------|-------|
| RF-001 | resolved | App.tsx wires `installMenuListener` + `onCleanup` |
| RF-002 | resolved | session_resolver.rs + http.rs (commit 65c1f84) |
| RF-003 | resolved | sessions_persist.rs UUID tmp suffix + concurrency test |
| RF-004 | resolved | supervision.rs `draining` state |
| RF-005 | resolved | frontend/src/types/session.ts + .test-d.ts sentinel |
| RF-006 | resolved | sessions.rs MAX_SESSIONS + TooManySessions + test |
| RF-007 | resolved | mutation.rs open_session_with + close_synthetic_sessions; integration test updated |
| RF-008 | resolved | welcome.json _one/_other variants in en/es/fr |
| RF-009 | resolved | Welcome.test.tsx (13 tests) + test-utils/i18n.tsx welcome namespace |
| RF-010 | resolved | ci.yml pin-check loops `.github/workflows/*.yml` |
| RF-011 | resolved | Welcome.tsx onReopen partial-failure status |
| RF-012 | resolved | windows.rs replay loop skips closed-window labels and closes orphan session |
| RF-013 | resolved | windows.rs wait_for_server_ready polls /heartbeat |
| RF-014 | wont-fix-this-pr | legacy mirror cleanup planned for follow-up PR after MCP read tools migrate |
| RF-015 | resolved | Welcome.tsx aria-label includes full path via i18n key |
| RF-016 | wont-fix-this-pr | mpsc(16)→watch refactor; unlikely under realistic recovery times |
| RF-017 | wont-fix | reverse path index unnecessary at realistic window count |
| RF-018 | resolved | App.tsx onCleanup → store.destroy() |
| RF-019 | resolved | tauri-build.yml concurrency block (tag-build exempt) |
| RF-020 | wont-fix-this-pr | spec doc update is a docs PR, not implementation |
| RF-021 | wont-fix-this-pr | pre-existing vitest teardown flake; separate cleanup |
| RF-022 | wont-fix-this-pr | reload→in-place rebuild is the v2 follow-up per PR description |
| RF-023 | wont-fix | commit-label labeling judgment confirmed acceptable |

Net: 17 resolved this branch; 0 open; 6 explicitly deferred or judged out of scope.
