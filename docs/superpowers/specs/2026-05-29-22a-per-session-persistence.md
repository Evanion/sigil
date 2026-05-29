# Spec 22a — Per-session persistence

**Status:** brainstormed 2026-05-29.

**Parent track.** RF-014 (PR #74 review) — "remove the legacy `AppState` single-document mirror; make `session.store` the single source of truth across all transports." RF-014 is too large for one PR because the entire MCP path (read and write) still runs on the legacy `AppState`, and the persistence task reads `legacy.document` — so the legacy field cannot be removed until persistence is per-session. RF-014 is therefore decomposed:

- **22a (this spec)** — per-session persistence. Each disk-backed session persists its own `session.store`. Foundation for the rest.
- **22b** — MCP session-native read+write tools (resolve the sync-`_impl`/`acquire_document_lock` vs. async `session.store` `RwLock` locking-model mismatch). Its own brainstorm → spec → plan → PR.
- **22c** — drop the `legacy` field, the `Deref`/`DerefMut` on `App`, the GraphQL legacy mirror, and the dual broadcast. Its own cycle.

**Goal.** Give every disk-backed session its own debounced persistence task so `session.store` — not `legacy.document` — is the thing written to disk. Replace the single app-global persistence task with one task per session.

---

## 1. Motivation

Today persistence is single-document:

- `persistence.rs::spawn_persistence_task_with_migration_flag(Arc<Mutex<SendDocument>>, workfile_path, MigrationFlag)` runs **one** task tied to the legacy `AppState.document`.
- The startup `--workfile` document is loaded into the legacy store; GraphQL `apply_operations` writes `session.store` then **mirrors** the post-apply state into `legacy.document` (mutation.rs:1439–1448) so the legacy persistence task still sees the authoritative document.
- Sessions opened at runtime via the GraphQL `openSession` mutation get a `DocumentSession` with its own `store`, but **no persistence task**.

**Consequence (latent bug 22a fixes):** any workfile opened via `openSession` is never written back to disk. Edits are lost on close. Worse — if `openSession` loads a v1 workfile, `load_workfile` migrates it in memory and returns `migrated_from = Some(1)`, but with no persistence task the migration is never written and the `.backup-v1/` is never created. This silently violates the CLAUDE.md **Schema Migration Persistence Contract** for every `openSession`-opened legacy workfile.

22a makes persistence a property of each session, closing this gap and removing the dependency on `legacy.document` as the persistence source.

---

## 2. Scope

**In scope (22a):**

- A per-session persistence task in `sigil-server` that reads `session.store` and writes `session.workfile_path`.
- A server-side `SessionPersistence` manager owning task lifecycle (spawn at open, flush+join at close, flush-all at shutdown), kept in lockstep with the `Sessions` registry.
- Per-session migration-flag handling (`migrated_from` flows from `load_workfile` to the session's persistence task; first save force-persists + backs up).
- Swapping the startup default session off the legacy persistence task onto a per-session task.

**Explicitly out of scope (deferred):**

- Removing the `legacy` field, `Deref`/`DerefMut`, the GraphQL legacy mirror (mutation.rs:1439–1448), `state.app.signal_dirty()`/`next_seq()`, or the dual broadcast (mutation.rs:1486–1488). → **22c**.
- Migrating MCP read/write tools off `AppState`; resolving the sync/async locking-model mismatch. → **22b**.
- Any change to the GraphQL or MCP wire surface, or to `frontend/`.

During 22a the legacy mirror **stays**: MCP writes still run against `legacy.document` then `mirror_to_session` clones into `session.store` and forwards to `session.broadcast`. Because the per-session task is driven by `session.broadcast`, MCP writes are persisted via the mirror — 22a is correct end-to-end before MCP migrates.

---

## 3. Architecture

### 3.1 Dirty signal — the session broadcast channel

The per-session task does **not** introduce a new dirty channel. It subscribes to the session's existing `broadcast: broadcast::Sender<SessionEvent>`:

- `SessionEvent::DocumentEvent(_)` → dirty → (re)arm debounce.
- `RecvError::Lagged(_)` → dirty (a burst overflowed the channel; the store already contains all mutations, so we read latest state and save — no data loss).
- `SessionEvent::SessionFatal { .. }` → the session is `Errored`; stop arming new saves (a final flush of last-good state may still run on shutdown/close).
- `RecvError::Closed` → unreachable while the task runs: the task holds a strong `Arc<DocumentSession>` (§3.2), which keeps the broadcast `Sender` alive, so the receiver never closes. Shutdown is therefore driven exclusively by the explicit `oneshot` (§3.3). The `Closed` arm is still matched (it must be, to satisfy the `Result` match) and does a final `do_save` + exit as a belt-and-suspenders guard, but it is not a path the design relies on.

**Why broadcast-as-dirty-signal.** `apply_operations` already fires `SessionEvent::DocumentEvent` on `session.broadcast` (mutation.rs:1479–1481), and `mirror_to_session` forwards MCP-origin events onto `session.broadcast` too. Persistence becomes "just another subscriber": every correctly-broadcasting mutation is automatically persisted, and it is structurally impossible to broadcast a mutation without persisting it. This *strengthens* the CLAUDE.md MCP invariant "must trigger both persistence AND broadcast" by collapsing the two obligations into one edge. No new field on `DocumentSession`; no second signal path to keep in sync.

Saving always reads `session.store.read().await` at flush time, so coalescing K broadcast events into one debounced save captures the final post-K state — never a stale intermediate.

### 3.2 Topology — one task per session

Each disk-backed session owns one persistence task, holding a strong `Arc<DocumentSession>` (so the store stays readable for the final flush), a `broadcast::Receiver<SessionEvent>`, the session's `MigrationFlag`, and a shutdown receiver.

```
SessionPersistence::register(session: Arc<DocumentSession>, migrated_from: Option<u32>)
  └─ tokio::spawn(persist_loop):
       let mut rx = session.broadcast.subscribe();
       loop {
         select! {
           _ = &mut shutdown_rx  => { do_save().await; break; }   // explicit close/shutdown
           ev = rx.recv()        => match ev {
             Ok(DocumentEvent)   => arm_debounce(),
             Err(Lagged(_))      => arm_debounce(),
             Ok(SessionFatal)    => stop_arming(),
             Err(Closed)         => { do_save().await; break; }   // unreachable in practice (§3.1); kept as a guard
           }
           _ = debounce_elapsed  => do_save().await,
         }
       }
```

`do_save()` reuses the existing two-phase pattern from `persistence.rs::do_save`: acquire the store read lock, `workfile::prepare_save`, **drop the lock**, then async `workfile::write_prepared_save` (atomic temp+rename with a UUID suffix, already implemented). The only change is the lock type — `tokio::sync::RwLock::read().await` on `session.store` instead of `std::sync::Mutex::lock()` on the legacy doc — which is strictly nicer (no sync lock held across scheduling).

**Rejected alternative — single drainer task** reading a registry-wide `mpsc<SessionId>` dirty queue: one task total, but it must (a) maintain per-`SessionId` debounce state, (b) look the session up by id at flush time, and (c) handle the session being closed mid-debounce — a real lost-final-write hazard. One-task-per-session owns its store `Arc`, so the close race cannot occur and the lifecycle is RAII-clean. Parked tokio tasks are nearly free; `MAX_SESSIONS = 256` bounds the worst case. Per the §1 Design Decision Criteria, the per-session design wins on correctness and robustness; it is also simpler in code paths (no id resolution, no None handling, no shared-queue debounce map) despite spawning more tasks.

### 3.3 Lifecycle & the single-registry invariant

A server-side `SessionPersistence` manager holds `HashMap<SessionId, PersistenceHandle>` where `PersistenceHandle { shutdown: oneshot::Sender<()>, join: JoinHandle<()> }`.

- **Open.** The server's session-open path performs `app.open_session_with(...)` (or startup `register`) and `SessionPersistence::register(...)` **in the same function, in sequence** — there is no code path that creates a disk-backed session without registering persistence. Memory (`memory://`) sessions are skipped (no disk path).
- **Invariant.** *A `SessionPersistence` entry exists iff a disk-backed session exists in `Sessions`.* This deliberately avoids the RF-007 failure mode (a second registry that drifts from `Sessions`). The manager is strictly subordinate: entries are added right after `Sessions::open` and removed right before `Sessions::close`.
- **Close.** `close_session(id)`: take the handle out of the map → fire `shutdown` → the task does a final `do_save` (session still alive — `Sessions::close` has not run yet) → task exits → `await` the join (bounded) → then `Sessions::close(id)`. Ordering matters: flush before the session `Arc` is dropped.
- **Graceful shutdown.** Drain the manager: fire `shutdown` on every handle, then `await` all joins inside one bounded total timeout (reusing the existing `PERSISTENCE_SHUTDOWN_TIMEOUT` budget). Workfiles are independent, so order is irrelevant. A task that exceeds the budget is abandoned (logged), matching today's single-task shutdown behavior.

Because the task holds a strong `Arc<DocumentSession>`, the broadcast channel never closes underneath it, so `RecvError::Closed` is unreachable in practice — the `oneshot` is the sole shutdown trigger. The `Closed` match arm exists only to satisfy exhaustiveness and as a belt-and-suspenders flush; the design does not rely on it.

### 3.4 Startup swap

`main.rs` startup changes from "load into legacy store + `spawn_persistence_task(legacy.document, …)`" to:

1. `load_workfile` → `LoadedWorkfile { document, migrated_from }` (unchanged).
2. Register the startup session (existing `open_session_with` path used for the default session) — its `session.store` holds the loaded document.
3. `SessionPersistence::register(startup_session, migrated_from)` — the per-session task now owns persistence for the startup workfile.
4. The legacy `spawn_persistence_task` / app-global `dirty_tx` / `take_persistence_handle()` wiring for the document is **removed** (the legacy mirror itself stays until 22c, but it is no longer a persistence source).

For a server started without `--workfile` (in-memory `memory://` session): no persistence task, exactly as today.

### 3.5 Per-session migration flag

`load_workfile` returns `migrated_from: Option<u32>`. `Sessions::open`'s `loader: FnOnce(&Path) -> Result<Document, E>` returns only `Document`, so `migrated_from` is captured out-of-band via the loader closure (a `Cell`/`Option` the closure writes and the caller reads after `open` returns) and passed to `SessionPersistence::register`. Each task seeds its own `MigrationFlag = Arc<Mutex<Option<u32>>>` from that value; the first `do_save` consumes it, force-persists, and writes `.backup-v(N-1)/` exactly as `persistence.rs::do_save` does today — now correctly applied to `openSession`-migrated workfiles, not only the startup one.

---

## 4. Consistency Guarantees

- **Atomic per-workfile write.** Each save uses `write_prepared_save` (write to `*.json.tmp.<uuid>` in the same dir, then `rename`). Unchanged; already satisfies the CLAUDE.md atomic-write + unique-tmp-suffix rule. A concurrency test spawns N concurrent writers against one session's path and asserts the on-disk content equals exactly one input (no partial bytes, no ENOENT).
- **Registry lockstep.** Persistence entries are created/destroyed in lockstep with `Sessions` in a single server-side function. Tests: (a) after open, a persistence entry exists for a disk-backed session; (b) after open of a `memory://` session, none exists; (c) after close, the entry is gone; (d) entry count equals disk-backed session count across an open/open/close sequence.
- **Flush-before-close.** `close_session` flushes and joins the task before `Sessions::close`. Test: mutate, close, assert the workfile on disk reflects the mutation without waiting for the debounce window.
- **Migration force-persist + backup.** Test: open a v1 fixture via the session path, assert (i) post-open a v2 file lands on disk after one debounce/flush, (ii) `.backup-v1/` exists with the original fixtures, (iii) the migration flag is consumed once (a second save does not re-back-up). This is the §3 CLAUDE.md CI smoke-test obligation, now exercised through the per-session path.
- **Idempotent recovery.** Firing `shutdown` twice (or `shutdown` after `Closed`) does not double-write or panic — the task has already exited; the second take from the map yields `None`.
- **Atomicity of a mutation batch** is unchanged — owned by `apply_operations` snapshot rollback (mutation.rs). 22a does not alter mutation atomicity; it only observes the broadcast that a successful batch emits.

---

## 5. Input Validation

No new external input type, deserialization boundary, or user-facing parameter is introduced. Workfile paths are validated by `Sessions::open` (must be an existing `.sigil/` directory; canonicalized). The persistence task consumes only in-process artifacts (`Arc<DocumentSession>`, a `broadcast::Receiver`, an `Option<u32>` migration version). **No validation needed** — justification: all inputs are server-internal and already validated upstream at the session-open boundary.

---

## 6. WASM Compatibility

No `crates/core` changes. All work is in `sigil-server` (an I/O crate, never compiled to WASM). `sigil-state` is touched only if a non-I/O read accessor is required, and any such addition adds no dependency and no `Send`/`Sync`/`'static` bound beyond what `DocumentSession` already carries. **No WASM risk.**

---

## 7. Transport Boundary Inventory

22a changes **no** shared wire-format type. No GraphQL schema field, MCP tool signature, WebSocket payload, `apply-remote.ts` handler, or persisted JSON shape changes. The `.sigil/` on-disk format is byte-identical (same `prepare_save`/`write_prepared_save`).

**Receipt (no-change claim).** The PR description will quote and run:

```
rg -n 'op_type|applyRemoteOperation' frontend/src/operations/apply-remote.ts   # unchanged
rg -n 'spawn_persistence_task' crates/                                          # call sites all in server, removed/replaced
```

and assert no diff to `frontend/`, no diff to any `*.graphql`/schema, and no diff to MCP tool definitions. The change is confined to `crates/server/src/{persistence.rs,main.rs,graphql/mutation.rs(open/close resolvers only)}` plus a new `session_persistence` module.

---

## 8. PDR Traceability

- **Implements:** the persistence half of the multi-session architecture (Spec 20) — durable per-workfile state for every open session, including runtime-opened ones.
- **Defers:** single-source-of-truth across transports (legacy removal) → 22c; MCP session-native tools → 22b. Both are tracked in the RF-014 decomposition above.
- No MVP PDR capability is newly skipped by this spec; it hardens an existing capability (persistence) that was incomplete for `openSession`-opened files.

---

## 9. Files (anticipated)

- **New:** `crates/server/src/session_persistence.rs` — `SessionPersistence` manager + `persist_loop`.
- **Modify:** `crates/server/src/persistence.rs` — factor `do_save` to read a `tokio::sync::RwLock<SendDocument>` (or extract the prepare/write helpers for reuse); the legacy `spawn_persistence_task` variants are removed once `main.rs` no longer calls them.
- **Modify:** `crates/server/src/main.rs` — startup registers the default session with `SessionPersistence`; remove legacy persistence-task wiring; graceful-shutdown drains the manager.
- **Modify:** `crates/server/src/graphql/mutation.rs` — `open_session` registers persistence; add a `close_session` flush+join path (if not already routed through a shared helper). No change to `apply_operations`' mutation/broadcast logic.
- **Modify (if needed):** `crates/state/src/sessions.rs` — only a non-I/O accessor if the server needs one; no persistence logic enters `sigil-state`.

---

## 10. Open questions

None blocking. The locking-model mismatch that complicates MCP is **not** triggered here: GraphQL already writes `session.store` via async `.write().await`, and the persistence task only ever `.read().await`s it — both async, no sync/async bridge needed. The mismatch is 22b's problem.
