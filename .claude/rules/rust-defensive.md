# Rust Defensive Coding Rules

These rules apply to all Rust code in `crates/` — core crate validation, serialization, arena management, lock handling, and FieldOperation design. They are extracted from CLAUDE.md Section 11 and carry the same enforcement weight.

---

### Constructors Must Validate

Every public constructor (`new`, `from_*`, `try_from_*`) must call all applicable validation functions. If `validate.rs` defines rules for a field, the constructor for any type containing that field must enforce those rules. "Validation exists but isn't called" is a bug.

### Deserialization Boundaries Must Match Validation Rules

When validation rules are added or changed in `validate.rs` (or equivalent), the deserialization entry points MUST be updated in the same commit to enforce the new rules. A checklist:
- Every field validated in `validate.rs` must also be validated during deserialization.
- When adding a new validation rule, search for all `deserialize_*` and `from_json` functions and update them.

Custom `Deserialize` implementations MUST reject duplicate keys in map/struct inputs. Serde's default behavior silently resolves duplicates via last-writer-wins, which can mask data corruption. When implementing custom deserializers that collect into maps, track seen keys and return an error on the first duplicate.

### Arena Operations Must Preserve Identity on Undo

When using generational arenas, removing and re-inserting an entity produces a NEW key. Any operation that needs to restore a previous state (undo, rollback) MUST use `reinsert(key, value)` or equivalent to preserve the original key. Never use `insert()` in an undo path for arena-managed entities — this silently breaks all external references to that entity.

### Restore State Before Propagating Errors

When an item is removed from a collection (popped from a stack, removed from a vec, taken from a map) and a subsequent operation on that item may fail, the item MUST be restored to its original position before returning the error. Pattern: pop, attempt operation, push back on failure. Using `?` after a destructive removal without restoration loses the item permanently.

### Multi-Item Mutations Must Roll Back on Partial Failure

When a mutation function loops over multiple items (reparenting N children, removing N nodes from a group, applying N property changes), the loop MUST track which items have been successfully modified. If item K fails, the method must reverse modifications to items 0 through K-1 before returning the error. Pattern: maintain a `completed: Vec<ReverseInfo>` alongside the loop; on failure, iterate `completed` in reverse order and undo each. This applies to loops within any single mutation function — whether a `FieldOperation`'s `apply()`, a GraphQL resolver, or an MCP tool handler. A loop that modifies 5 of 10 items and then returns an error has corrupted the document.

### Ordered Collection Mutations Must Preserve Position

When removing an element from an ordered collection (Vec, VecDeque) for a reversible operation, record the element's index at the time of removal. The undo path must use `insert(index, element)`, not `push(element)`. Pushing to the end silently changes ordering, which violates undo semantics.

### Cross-Field Invariant Validation

When a type has fields that must be mutually consistent (e.g., a discriminant enum and a value enum, a unit field and a numeric field), the constructor and deserialization path MUST validate the relationship between them. Single-field validation is not sufficient — add an explicit cross-field check and a test for each invalid combination.

### No Derive Deserialize on Validated Types

Any type in `crates/core/` that has validation logic in its constructor MUST NOT use `#[derive(Deserialize)]`. Instead, implement `Deserialize` manually (or via a helper) that routes through the validating constructor. Fields on validated types MUST be private to prevent direct construction. This prevents `#[derive(Deserialize)]` from creating an invisible second construction path that bypasses all validation.

### Validated Types Must Have Private Fields

Every type in `crates/core/` whose constructor (`new`, `from_*`, `try_from_*`) performs validation or computes derived state MUST have all fields private (`pub(crate)` at most). This applies to value objects and any type with invariants — not only deserialized types. Public fields allow callers to construct instances via struct literal syntax, bypassing the constructor entirely. They also allow mutation of internal state (e.g., pre-populated snapshots) between construction and use. If external code needs to read a field, add an accessor method. **Exception:** `FieldOperation` structs (forward-only operations with a `validate()` method on the trait) may have public fields. These are pure data carriers where validation happens at the trait level via `validate()` before `apply()`, not in a constructor. The server and MCP crates construct them via struct literal syntax, which is the intended pattern.

### FieldOperations Must Be Self-Contained

A `FieldOperation` struct's `apply()` method must be callable immediately after construction and `validate()` without the caller performing any additional setup. The struct receives the operation's parameters (what to do); `validate()` checks preconditions against the document; `apply()` performs the mutation. Callers MUST call `validate()` before `apply()`. The caller (server/MCP) is responsible for rollback on partial failure in multi-step operations — `FieldOperation` structs are forward-only and do not capture undo state.

### Arena-Local IDs Must Not Be Serialized

Types that represent arena indices or generational IDs (e.g., `NodeId`) MUST NOT appear in serialized or persisted data formats. Serialized document formats MUST use stable, globally-unique identifiers (UUIDs). Arena-keyed types must be mapped to their stable ID at the serialization boundary. Arena indices are meaningless outside a running session — serializing them produces corrupt references on reload.

### Uniqueness Constraints on Named Collections

When a collection contains entities with a name or identifier field that must be unique within that collection (e.g., component names in a document, property names in a component, variant names in a component), the insertion point MUST reject duplicates with a typed error. Do not rely on the collection type (HashMap vs Vec) to enforce this implicitly — validate explicitly and return an error that identifies the conflicting name.

### Placeholder Registry Entries Must Be Displaced by the First Real Entry

When a registry (`Sessions`, document store, connection pool, etc.) is initialized with a placeholder, synthetic, or "default" entry to keep header-less or pre-configuration callers functional, the first real entry inserted into that registry MUST atomically:
1. Replace the registry's "default" pointer (e.g., `default_session_id`) with the real entry's id.
2. Close, drop, or otherwise reclaim the placeholder — UNLESS a live subscriber holds a reference to it (in which case track the subscriber and reclaim on its drop).

A placeholder that lingers after a real entry exists is a silent routing bug: header-less callers continue to route to the placeholder while header-bearing callers see the real entry. The two populations of clients diverge with no error, and the divergence is invisible until a third party (an MCP agent, a debugger, a log query) observes mismatched state.

The registry's public API documentation MUST name the displacement contract explicitly, and the registry's test suite MUST cover: (a) placeholder visible before first real insert, (b) placeholder absent / pointer flipped after first real insert, (c) header-less call after first real insert routes to the real entry, not the placeholder. A test that only asserts the real entry exists does not prove displacement.

Alternative design: do not create the placeholder at all when the absence of configuration (`--workfile` CLI flag, initial connection handshake) indicates no consumer needs it. An empty registry is unambiguous; a registry with a placeholder is a routing hazard.

Precedent: PR #74 (RF-007) — `sigil-server` registered a synthetic `memory://<uuid>` session at startup so header-less MCP calls had somewhere to land. When the desktop shell later called `openSession` for a real workfile, the synthetic session remained registered and `default_session_id` kept pointing at it. Header-less MCP under "rule 2: single open session" routed to the synthetic session instead of the workfile. Desktop windows always inject `__SIGIL_SESSION_ID__`, so the bug surfaced only for header-less MCP — the most common agent path. The fix added `open_session_with` displacement + `close_synthetic_sessions` and an integration test.

### Filesystem Writes Must Be Atomic

Every file write in the server crate must use the write-to-temp-then-rename pattern. Write the full content to a temporary file in the SAME directory as the target (to ensure same-filesystem rename), then `fs::rename()` to the final path. This prevents partial writes on crash or power loss. Direct `fs::write()` to the final path is a bug in the server crate.

The tmp filename MUST include a unique-per-call suffix (UUID, PID+nanos, or `std::process::id()`+`SystemTime::now()`). A fixed suffix (e.g., `<name>.json.tmp`) is a race: two concurrent writers both write the same tmp path, the second overwrites the first's bytes before rename, and at most one rename succeeds while the other returns ENOENT. The losing write is silently lost — and the winning write's content may belong to the wrong writer. The race surfaces whenever two code paths can persist the same file concurrently (window-create racing window-close, two open-intents from menu vs. keyboard, supervisor recovery racing a user save).

The same rule applies to any `*_persist.rs` or `*-store.ts` module that uses tmp+rename, on any platform. Pattern: `path.with_extension(format!("json.tmp.{}", uuid::Uuid::new_v4().simple()))` or equivalent.

Every persist module that uses tmp+rename MUST have a concurrency test that spawns N concurrent writers with distinct payloads and asserts the post-fence on-disk content matches exactly one of the inputs (no partial bytes, no ENOENT). A test that only writes serially does not exercise the race.

Precedent: PR #74 (RF-003) — `sessions_persist.rs::save` used a fixed `<dir>/sessions.json.tmp`. Concurrent saves from window-create + window-close races silently lost the loser's content. The fix added a UUID tmp suffix and a concurrency test; the surrounding pattern recurs anywhere multiple supervisors, agents, or UI events can trigger persistence of the same file.

### Hold Locks for the Full Read-Modify-Write Sequence

Never split a read-then-write into two separate lock acquisitions. Acquiring a read lock, releasing it, and then acquiring a write lock is a TOCTOU race — another thread can mutate the value between the two acquisitions. Any logic of the form "read to check a condition, then write based on that condition" MUST hold a single write lock (or upgradeable read lock) for the entire sequence. This applies to `RwLock`, `Mutex`, and any wrapper around them. If the write lock scope is too coarse, redesign the data structure rather than splitting the lock.

### RAII Guards Do Not Provide Transactional Rollback

Dropping a lock guard (`MutexGuard`, `RwLockWriteGuard`) releases the lock — it does NOT revert mutations made while the lock was held. If a batch of N mutations is applied under a single lock acquisition and mutation K fails, mutations 0 through K-1 remain applied after the guard drops. The lock only serializes access; it provides no undo semantics. When a batch must be atomic (all-or-nothing), the code must implement explicit rollback: track completed mutations, and on failure, reverse them before releasing the lock. This also applies to TypeScript: holding a reference to an object during a sequence of mutations does not provide transactional semantics.

### Event Channels for Long-Running Recovery Must Track In-Flight State

When an event channel (`mpsc`, `broadcast`, `watch`, or a custom signal) is used to notify a consumer that should perform a long-running recovery action (process respawn, reconnect, reload, restart-pool), the producer MUST self-suppress until the consumer signals recovery completion. A heartbeat or watchdog that keeps firing `Failure` events while a previous `Failure` is still being handled will cause the consumer to start the recovery multiple times in parallel — double-respawn, double-reload, or, worst, two concurrent process supervisors fighting for the same port.

Three acceptable patterns:

1. **Self-suppressing producer (preferred).** The producer enters a "draining" or "in-recovery" state after firing a recovery event, and stays there until the consumer signals back via a separate channel (e.g., `RecoveryComplete` over an `mpsc`, or an `AtomicBool` flipped by the consumer). The producer's tick loop MUST check the draining state before re-evaluating health and firing again.

2. **Consumer-side mutex.** The consumer wraps the recovery action in a `tokio::sync::Mutex` (or platform equivalent) and holds the lock for the entire recovery duration. Subsequent events queue behind the lock instead of running in parallel. Acceptable when the recovery is idempotent, but loses information ("which crash am I recovering from?") if the event payload carries unique state.

3. **Watch channel for recoverable signals + mpsc(1) for one-shots.** Convert "is healthy" / "is degraded" notifications to `tokio::sync::watch` (overwrites on send, no buffer pressure) and keep `CrashDetected`-class events on a bounded `mpsc(1)` with an explicit consumer-side de-dup. The watch carries the latest state; the mpsc fires once per recovery cycle.

In all three: every recovery action MUST emit an explicit "started" and "completed" log line so the supervisor's de-dup decisions are auditable. The recovery's idempotency MUST be tested with a fixture that fires the recovery event twice in quick succession and asserts the consumer-visible side effect (process count, file handle count, connection count) is the same as if it had fired once.

Precedent: PR #74 (RF-004) — the heartbeat supervisor reset `failures = 0` after firing `CrashDetected` but kept ticking. If the new server hadn't bound the port within ~15s (3 ticks × 5s), the supervisor fired a second `CrashDetected` while `handle_crash` was still mid-respawn — two `handle_crash` runs in parallel attempted to double-respawn the server, racing on port 4680. The fix added a `draining` state on the supervisor that suppresses re-firing until the consumer signals recovery complete.

### After Respawning a Process, Poll Liveness — Do Not Sleep a Magic Number

When code respawns or restarts a process that must be reachable over a known endpoint (HTTP `/heartbeat`, Unix socket, named pipe, port bind), the caller MUST poll the liveness endpoint with a bounded timeout instead of sleeping a fixed duration before its next interaction. A magic-number sleep (`sleep_ms(500)`) is bug-prone in three ways: (a) it is too short on slow machines or under sustained CPU pressure, producing a failed first interaction; (b) it is too long in the common case, adding perceptible latency to every recovery; (c) the chosen constant has no audit trail explaining why it is the right number.

Required pattern:
- Poll the endpoint every 50-100ms.
- Succeed and proceed as soon as the endpoint responds.
- Fail with a typed error after a bounded total timeout (e.g., 5s) — log the timeout, surface to the user where appropriate, and DO NOT proceed with the next interaction.
- The polling helper MUST be a named function (e.g., `wait_for_server_ready`) so multiple call sites share one implementation and one timeout constant.

Sleeps remain acceptable only when there is no liveness signal to poll — in which case the chosen duration MUST have a `// SAFETY:` or `// RATIONALE:` comment naming the empirical basis (benchmark on the slowest target hardware, vendor docs, etc.).

Precedent: PR #74 (RF-013) — `handle_crash` slept 500ms after respawning sigil-server before issuing the first `openSession` replay call. The first replay failed on slow CI runners because the new server hadn't bound port 4680 yet. The fix added `wait_for_server_ready` that polls `/heartbeat` every 100ms with a 5s timeout.

### Sequential Shutdown Phases Must Fit Within the Container Stop Grace

When graceful shutdown runs multiple phases sequentially (HTTP drain, then MCP drain, then persistence flush, etc.), each phase MUST have a named timeout constant AND the sum of those constants MUST be provably less than the orchestrator's stop grace (Docker's default `--stop-timeout`, the Kubernetes `terminationGracePeriodSeconds`, etc., captured as its own named constant). Enforce the aggregate with a compile-time assertion:

```rust
const DOCKER_STOP_GRACE: Duration = Duration::from_secs(10);
const HTTP_DRAIN_TIMEOUT: Duration = Duration::from_secs(3);
const MCP_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const PERSISTENCE_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const _: () = assert!(
    HTTP_DRAIN_TIMEOUT.as_secs()
        + MCP_SHUTDOWN_TIMEOUT.as_secs()
        + PERSISTENCE_SHUTDOWN_TIMEOUT.as_secs()
        < DOCKER_STOP_GRACE.as_secs(),
    "aggregate shutdown budget must stay under the container stop grace"
);
```

A per-phase bound without an aggregate bound is insufficient: three independently-reasonable 5s phases sum to 15s and exceed a 10s grace, so the orchestrator SIGKILLs the process mid-shutdown. The data-loss-critical phase (the persistence flush) MUST run with its full slice guaranteed — either run it first, or (when ordering forces it last, e.g., persistence must capture a final MCP-originated mutation) ensure the per-phase bounds guarantee it always receives its full timeout regardless of how long earlier phases take. An unbounded phase (e.g., an un-timed `axum` graceful drain) ahead of the flush is a bug: it can consume the entire grace and starve the flush. To bound an `axum` graceful drain, spawn `serve(...)` and time only the post-signal drain (start the timer when the shutdown signal fires, not when serving begins).

A new shutdown phase added in a later PR MUST be added to the aggregate assertion in the same commit. The assertion is the receipt — a phase that is not in the sum is not bounded.

When a phase drains a set of background tasks under its timeout, on timeout it MUST `abort()` (or otherwise reclaim) every straggler rather than dropping their join handles. Dropping a `JoinHandle` detaches the task — it keeps running unsupervised and may still hold a lock (e.g., a session store read lock during a final save), corrupting or deadlocking the very flush the shutdown is trying to complete. Capture the `abort_handle()` for each task before moving the joins into the timeout future. The timeout log line MUST state that work was abandoned and name the count (e.g., "aborted N task(s) that did not flush in time; their unsaved changes may be lost") — never a message that implies a clean drain.

Precedent: spec-22a (RF-001, RF-003) — shutdown ran an unbounded axum drain, then `MCP_SHUTDOWN_TIMEOUT` (5s), then `PERSISTENCE_SHUTDOWN_TIMEOUT` (5s), flush last. Worst-case exceeded Docker's 10s grace; the orchestrator could SIGKILL mid-flush and lose dirty session documents — the most important data gated behind the two least-important drains. The fix bounded every phase (3s+2s+3s=8s) and added the compile-time aggregate assertion above. Separately (RF-003), `shutdown_all` dropped its join handles on timeout (detach) and logged a clean-shutdown message; the fix captures `abort_handle()` per task, aborts stragglers on timeout, and the warn log names the count of sessions that may have lost unsaved changes.

### `select!` Cancellation Arms Must Drain Data-Carrying Channels Before Exiting

`tokio::select!` is unbiased: when two arms are simultaneously ready, it picks one at random. When a `select!` races a shutdown/cancellation signal (a `oneshot`, a `watch` flip, a `CancellationToken`) against a data-carrying channel (`broadcast`, `mpsc`, `watch` of work items), the cancellation arm can win while an item sits unprocessed in the channel buffer. If that item would have triggered a final action (arm a flush deadline, enqueue a last write, ack a request), the action is silently lost.

The cancellation arm MUST drain the data channel via a `try_recv` loop and account for every buffered item before it makes its terminating decision. Treat a buffered data event — and a `Lagged`/overflow indicator — as pending work.

Pattern:
```rust
tokio::select! {
    _ = &mut shutdown_rx => {
        // Unbiased select! may have skipped a ready data event. Drain it.
        loop {
            match rx.try_recv() {
                Ok(DataEvent(_)) | Err(TryRecvError::Lagged(_)) => mark_pending(),
                Err(TryRecvError::Empty | TryRecvError::Closed) => break,
                Ok(Terminal { .. }) => break,
            }
        }
        if pending { do_final_flush().await; }
        break;
    }
    ev = rx.recv() => { /* normal path */ }
}
```
Anti-pattern: a shutdown arm that decides whether to flush based only on state accumulated before the `select!`, ignoring items still in the receiver buffer.

A test for this race MUST be deterministic: make both arms ready (push a data event AND fire the shutdown signal) and assert the buffered item's effect survived, repeated enough times to prove determinism (the project standard is 30/30). A test that passes intermittently (e.g., 11/20) has not proven the fix — it has observed the lucky branch.

Precedent: spec-22a (RF-013) — `persist_loop`'s `select!` raced the shutdown `oneshot` against the session `broadcast`. When both were ready, the shutdown branch could win and a final mutation — unprocessed in the broadcast buffer, so its deadline was never armed — was lost on the final flush. The fix drains the receiver via `try_recv` (arming the deadline for any buffered `DocumentEvent`/`Lagged`) before the flush decision; verified 30/30.

### Discriminated-Union Dispatch Must Be Exhaustive Across All Crates

When a new variant is added to a discriminated enum used as a dispatch discriminant — `NodeKind`, `Corner`, `Fill`, `Effect`, or any future enum whose variants drive `match` arms in business logic — the same PR MUST add a corresponding arm to **every dispatch site that branches on that enum in the entire workspace**, not just in `crates/core/`. The mandatory sites for a `NodeKind`-class enum are:

1. The variant's `validate` path (e.g., `CreateNode::validate` for `NodeKind`, `validate_corners` for `Corner`).
2. The workfile deserialization path.
3. Every `match` on the enum in any crate (`core`, `server`, `mcp`, `state`) — discoverable via `cargo clippy --workspace`.
4. The frontend's mirror type (`frontend/src/types/document.ts`) and every consumer of the mirror.

A `match` that uses a catch-all (`_ =>`) arm in any crate is a bug. The exception is `serde_json::Value` string matches (where exhaustiveness is impossible) — those MUST list every accepted string explicitly and document the closed set; a wildcard arm in such a match must have a comment naming the closed set it covers (see the v1 workfile migration kind dispatch for the canonical example).

### CSS-Rendered String Fields Must Reject CSS-Significant Characters

Any string field in `crates/core/` or the frontend that is used to produce a CSS property value or Canvas 2D context property (e.g., `ctx.font`, `ctx.fillStyle`) MUST be validated to reject CSS-significant characters. Denylist: single quote, double quote, semicolon, curly braces, backslash, and C0 control characters (bytes 0x00–0x1F). Apply in `validate.rs` (Rust) and a shared validation helper (TypeScript). Examples: `font_family`, variable font axis names, CSS custom property names.

This validation obligation applies at two boundaries, both mandatory: (1) input arrival — validate at the API/deserialization boundary before storing; (2) output use — any function that constructs a Canvas 2D context property (`ctx.font`, `ctx.fillStyle`) or a CSS property string by interpolating a user-controlled field MUST call the CSS character validation helper immediately before interpolation, even if the value was already validated at input. Defense in depth: values may travel through code paths that bypass input validation.

### Side-Effect Artifacts Must Be Constructed After Precondition Verification

When implementing a mutation that requires lock acquisition and entity existence verification, all side-effect artifacts (broadcast payloads, response objects, audit log entries) MUST be constructed AFTER the lock is acquired and AFTER preconditions (entity exists, fields valid) are confirmed. Pre-building these artifacts before verification wastes allocation on error paths and risks constructing a payload from stale pre-lock state. Pattern: acquire lock, verify preconditions, apply mutation, construct broadcast payload from verified post-mutation state, release lock, send broadcast.

### Delete Operations Must Enforce Collection-Level Invariants

Any `FieldOperation` that removes an entity from a bounded collection MUST validate both (1) that the entity exists, AND (2) that removing it will not violate a minimum-cardinality invariant. If a document must always contain at least one page, `DeletePage::validate` must check `page_count > MIN_PAGES_PER_DOCUMENT`. The minimum MUST be defined as a `MIN_*` constant in `validate.rs`. Do not rely on the frontend to enforce this — frontend guards are bypassable via GraphQL and MCP.

### Tests for Multi-Axis Inputs Must Cover Non-Degenerate Cases

When a function accepts an input value with N independent axes that can take different values (`Vec2 { x, y }`, `Size { width, height }`, `Point`, `RadiusPair`, per-channel color, any `[f64; N]` where entries are independent), at least one test fixture MUST exercise the case where the axes differ from each other. A test suite where every fixture sets `x == y` (or `width == height`, etc.) is biased toward the degenerate subset of the input domain, and bugs in axis selection — picking the wrong axis based on role rather than identity — are invisible to it.

Required coverage when a type permits axis-independent values:
1. At least one fixture where each pair/tuple of independent axes has **distinct** values (e.g., `RadiusPair { x: 30.0, y: 10.0 }`).
2. At least one fixture where the axis assignment is **swapped** relative to (1).
3. The test must assert axis-specific output, not just "the function returned `Ok(_)`."

Mirrors the corresponding TypeScript rule in `frontend-defensive.md`. Precedent: PR #64 (Plan 14c, frontend) — three corner helpers (Bevel, Notch, Superellipse) shipped wrong geometry for asymmetric radii because every fixture used `{x: r, y: r}`. Equivalent Rust types (e.g., `[f64; 2]` for corner radii in `crates/core`) carry the same risk.
