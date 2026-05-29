# Spec 22a — Per-Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every disk-backed session its own debounced persistence task so `session.store` — not `legacy.document` — is the source written to disk, closing the latent bug where `openSession`-opened workfiles (and their schema migrations) are never persisted.

**Architecture:** Replace the single app-global persistence task with one task per session. Each task subscribes to the session's existing `broadcast::Sender<SessionEvent>` (broadcast = dirty signal), debounces, and saves via the existing two-phase pattern (sync prepare under lock → async atomic write). A server-side `SessionPersistence` manager owns task lifecycle (spawn at open, flush+join at close, drain-all at shutdown), kept in lockstep with the `Sessions` registry. The legacy mirror and `signal_dirty()` stay (removed in 22c); only the legacy *persistence task* infrastructure is removed.

**Tech Stack:** Rust (Edition 2024, clippy pedantic), tokio (`broadcast`, `oneshot`, `RwLock`, `spawn`, `time::timeout`), `sigil-state` (`DocumentSession`, `SessionEvent`, `Sessions`), `sigil-server` (`workfile`, GraphQL resolvers via `async_graphql`).

---

## Background & Constraints

**Read first:** `docs/superpowers/specs/2026-05-29-22a-per-session-persistence.md` (the spec), `CLAUDE.md`, `.claude/rules/rust-defensive.md`.

Key project rules that bear on this plan:
- `sigil-state` and `sigil-core` have **zero I/O**. All file I/O stays in `sigil-server`. The persistence task and manager live in `sigil-server`; `sigil-state` gains only a non-I/O constructor.
- `thiserror` for libraries, `anyhow` for the server app.
- No `unwrap()`/`expect()` in `sigil-core` (these tasks do not touch core). In `sigil-server`, lock-poison recovery uses `unwrap_or_else(PoisonError::into_inner)`, matching the existing `do_save`.
- Filesystem writes must be atomic **with a unique-per-call temp suffix** (`.claude/rules/rust-defensive.md` → "Filesystem Writes Must Be Atomic"). Task 1 fixes the current fixed-suffix bug.
- Commit format: `type(scope): description`, scope `server` or `state`. Run `./dev.sh cargo fmt` before every commit. Reference the spec: `(spec-22a)`.
- All commands run in the dev container via `./dev.sh`.

**Scope guardrails (do NOT do these — they are 22b/22c):**
- Do NOT remove the `legacy` field, `Deref`/`DerefMut` on `App`, the GraphQL legacy mirror (`mutation.rs:1439–1448`), the dual broadcast (`mutation.rs:1486–1488`), or `signal_dirty()`/`next_seq()` call sites. They stay. `signal_dirty()` simply becomes a no-op (its `dirty_tx` is never set after this plan).
- Do NOT migrate MCP read/write tools off `AppState`.
- Do NOT change any GraphQL/MCP wire type, WebSocket payload, `apply-remote.ts`, or the `.sigil/` on-disk format.

---

## File Structure

- **New:** `crates/server/src/session_persistence.rs` — the `SessionPersistence` manager, `PersistenceHandle`, `persist_loop`, and `do_save_session`. One clear responsibility: per-session persistence lifecycle.
- **Modify:** `crates/server/src/persistence.rs` — keep `SAVE_DEBOUNCE_MS` and `MigrationFlag`; extract the migration-flag-aware write into a reusable `write_prepared_with_migration_flag`; delete the legacy `spawn_persistence_task*` functions, the legacy `do_save`, and their tests.
- **Modify:** `crates/server/src/workfile.rs` — Task 1 fixes `atomic_write` (UUID temp suffix) + adds a concurrency test; Task 5 adds `load_workfile_sync_migrated`.
- **Modify:** `crates/state/src/lib.rs` — add `AppState::new_with_document` (disk-backed, no persistence task); delete `new_with_persistence`, `take_persistence_handle`, `take_dirty_tx`, and the `persistence_handle` field. Keep `dirty_tx` field + `signal_dirty` (now always `None`/no-op until 22c).
- **Modify:** `crates/server/src/state.rs` — add `persistence: Arc<SessionPersistence>` to `ServerState`; rewrite disk-backed constructor to not spawn the legacy task; delete dead `new_with_workfile` and `new_with_document_and_workfile`.
- **Modify:** `crates/server/src/main.rs` — startup registers the default session with `SessionPersistence`; graceful shutdown drains the manager; remove `take_persistence_handle`/`take_dirty_tx`/`drop(dirty_tx)` wiring.
- **Modify:** `crates/server/src/graphql/mutation.rs` — `open_session` registers persistence (with migration flag); `close_session` flushes+joins via the manager before `Sessions::close`.
- **Modify:** `crates/server/src/lib.rs` — declare `pub mod session_persistence;` and re-export as needed.
- **Modify:** `crates/server/tests/integration_v1_workfile_migration.rs` — drive the migration smoke test through the per-session path.

---

## Task 1: Atomic write with unique temp suffix

**Why first:** The spec §4 Consistency Guarantees require a concurrency test asserting on-disk content equals exactly one writer's input. The current `atomic_write` uses a fixed `path.with_extension("json.tmp")`, which races (two writers clobber the same temp path → one `rename` hits ENOENT). This violates `.claude/rules/rust-defensive.md` → "Filesystem Writes Must Be Atomic". Fix before per-session persistence can claim the guarantee.

**Files:**
- Modify: `crates/server/src/workfile.rs:155-164` (`atomic_write`)
- Test: `crates/server/src/workfile.rs` (new `#[tokio::test]` in the existing `mod tests`)

- [ ] **Step 1: Write the failing concurrency test**

Add to `mod tests` in `crates/server/src/workfile.rs`:

```rust
/// Spec 22a §4 + rust-defensive "Filesystem Writes Must Be Atomic": N concurrent
/// writers to the same path must leave exactly one writer's content on disk —
/// never partial bytes, never ENOENT. A fixed temp suffix fails this (the temp
/// path collides and one rename races ahead of another writer's write).
#[tokio::test]
async fn test_atomic_write_concurrent_writers_no_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("contended.json");

    let payloads: Vec<String> = (0..16).map(|i| format!("{{\"writer\":{i}}}")).collect();

    let mut handles = Vec::new();
    for content in payloads.clone() {
        let target = target.clone();
        handles.push(tokio::spawn(async move {
            // Run many times to widen the race window.
            for _ in 0..8 {
                super::atomic_write(&target, &content).await.expect("atomic_write");
            }
        }));
    }
    for h in handles {
        h.await.expect("writer task");
    }

    let final_content = tokio::fs::read_to_string(&target).await.expect("read target");
    assert!(
        payloads.contains(&final_content),
        "final on-disk content must equal exactly one writer's payload, got: {final_content}"
    );
    // No stray temp files left behind.
    let mut entries = tokio::fs::read_dir(dir.path()).await.unwrap();
    while let Some(e) = entries.next_entry().await.unwrap() {
        let name = e.file_name().to_string_lossy().into_owned();
        assert!(
            !name.contains(".json.tmp"),
            "no temp files should remain after writes, found: {name}"
        );
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./dev.sh cargo test -p sigil-server --lib workfile::tests::test_atomic_write_concurrent_writers_no_corruption -- --nocapture`
Expected: FAIL — either an ENOENT rename error or a leftover `contended.json.tmp` file.

- [ ] **Step 3: Implement the UUID temp suffix**

Replace `atomic_write` in `crates/server/src/workfile.rs`:

```rust
/// Atomically writes content to a file by writing to a uniquely-named temp
/// sibling first, then renaming into place.
///
/// The temp filename carries a per-call UUID suffix so concurrent writers to
/// the same target never collide on the temp path (rust-defensive
/// "Filesystem Writes Must Be Atomic"). The rename is the atomic commit point.
///
/// # Errors
///
/// Returns an error if the write or rename fails. On rename failure the temp
/// file is best-effort removed so a failed write does not leak temp files.
async fn atomic_write(path: &Path, content: &str) -> Result<()> {
    let tmp_path = path.with_extension(format!("json.tmp.{}", Uuid::new_v4().simple()));
    tokio::fs::write(&tmp_path, content)
        .await
        .with_context(|| format!("failed to write temp file: {}", tmp_path.display()))?;
    if let Err(e) = tokio::fs::rename(&tmp_path, path).await {
        // Best-effort cleanup: leaving a stray .tmp.<uuid> is a leak. We log at
        // debug because the rename error below is the actionable failure.
        if let Err(rm) = tokio::fs::remove_file(&tmp_path).await {
            tracing::debug!("failed to clean up temp file {}: {rm}", tmp_path.display());
        }
        return Err(e).with_context(|| {
            format!("failed to rename temp file to: {}", path.display())
        });
    }
    Ok(())
}
```

`Uuid` is already imported at `crates/server/src/workfile.rs:23`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `./dev.sh cargo test -p sigil-server --lib workfile::tests::test_atomic_write_concurrent_writers_no_corruption`
Expected: PASS.

- [ ] **Step 5: Run the full workfile test module to check for regressions**

Run: `./dev.sh cargo test -p sigil-server --lib workfile::tests`
Expected: PASS (the existing migration/backup tests still pass — they assert final state, not temp names).

- [ ] **Step 6: Commit**

```bash
./dev.sh cargo fmt
git add crates/server/src/workfile.rs
git commit -m "fix(server): unique temp suffix in atomic_write to prevent concurrent-writer races (spec-22a)"
```

---

## Task 2: Add `AppState::new_with_document` (disk-backed, no persistence task)

**Why:** After this plan, the legacy `AppState` still holds the mirrored document (mirror stays until 22c) but must **not** own a persistence task. There is no constructor today for "hold this document at this workfile path, but spawn no task." `new()` makes an empty doc; `new_with_persistence` requires a task. Add the missing constructor in `sigil-state` (no I/O — it only stores fields).

**Files:**
- Modify: `crates/state/src/lib.rs` (add `new_with_document` near `new_with_persistence`)
- Test: `crates/state/src/lib.rs` (new unit test in `mod tests`)

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `crates/state/src/lib.rs`:

```rust
#[test]
fn test_new_with_document_holds_doc_and_path_without_persistence() {
    use std::path::PathBuf;
    let doc = Document::new("Loaded".to_string());
    let path = PathBuf::from("/tmp/example.sigil");
    let state = AppState::new_with_document(
        Arc::new(Mutex::new(SendDocument(doc))),
        path.clone(),
    );
    assert_eq!(state.workfile_path.as_deref(), Some(path.as_path()));
    assert_eq!(
        state.document.lock().unwrap().metadata.name,
        "Loaded"
    );
    // No persistence task is configured: signal_dirty is a silent no-op.
    state.signal_dirty();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./dev.sh cargo test -p sigil-state new_with_document`
Expected: FAIL to compile — `no function or associated item named new_with_document`.

- [ ] **Step 3: Implement the constructor**

Add to `impl AppState` in `crates/state/src/lib.rs`, immediately after `new_with_persistence`:

```rust
    /// Creates an `AppState` holding a pre-loaded document at `workfile_path`
    /// **without** a persistence task.
    ///
    /// Used by the server when per-session persistence (Spec 22a) owns writing
    /// the document to disk. The legacy `AppState` still mirrors the document
    /// (removed in 22c), but it is no longer a persistence source, so it carries
    /// no `dirty_tx` and no task handle. `signal_dirty()` is a no-op on instances
    /// built this way.
    #[must_use]
    pub fn new_with_document(
        document: Arc<Mutex<SendDocument>>,
        workfile_path: PathBuf,
    ) -> Self {
        Self {
            document,
            workfile_path: Some(workfile_path),
            dirty_tx: None,
            event_tx: None,
            seq_counter: Arc::new(AtomicU64::new(1)),
        }
    }
```

NOTE: this assumes the `persistence_handle` field has been removed in Task 3. If implementing Task 2 before Task 3, temporarily include `persistence_handle: Arc::new(Mutex::new(None)),`. The recommended order is Task 3 first if you want a single clean struct; the plan keeps them separate for review granularity, so add the field here and let Task 3 remove it. To avoid churn, implement Task 3's struct change in the same session before compiling.

- [ ] **Step 4: Run the test to verify it passes**

Run: `./dev.sh cargo test -p sigil-state new_with_document`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
./dev.sh cargo fmt
git add crates/state/src/lib.rs
git commit -m "feat(state): add AppState::new_with_document for disk-backed state without a persistence task (spec-22a)"
```

---

## Task 3: Extract reusable write helper; remove legacy persistence task

**Why:** The per-session task reuses the migration-flag take/restore + write logic, but reads a `tokio::sync::RwLock<SendDocument>` instead of a `std::sync::Mutex`. Extract the flag+write half into `persistence.rs` so both the (now-removed) legacy path and the new session path could share it. Then delete the legacy `spawn_persistence_task*` functions and the legacy `do_save` (superseded — `.claude/rules` "Migrations Must Remove All Superseded Code").

**Files:**
- Modify: `crates/server/src/persistence.rs` (extract helper, delete legacy spawns + `do_save` + their tests)
- Modify: `crates/state/src/lib.rs` (remove `new_with_persistence`, `take_persistence_handle`, `take_dirty_tx`, the `persistence_handle` field)

- [ ] **Step 1: Write the failing test for the extracted helper**

Replace the `mod tests` in `crates/server/src/persistence.rs` with a single test that exercises the new helper (the old debounce/shutdown tests are deleted — they tested the removed loop):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use sigil_core::Document;

    #[tokio::test]
    async fn test_save_debounce_ms_is_500() {
        assert_eq!(SAVE_DEBOUNCE_MS, 500);
    }

    /// The extracted helper consumes the migration flag exactly once on a
    /// successful write and creates `.backup-v1/`.
    #[tokio::test]
    async fn test_write_prepared_with_migration_flag_consumes_flag_and_backs_up() {
        let dir = tempfile::tempdir().unwrap();
        let workfile_path = dir.path().join("migrated.sigil");
        tokio::fs::create_dir_all(&workfile_path).await.unwrap();
        tokio::fs::write(
            workfile_path.join("manifest.json"),
            r#"{"schema_version": 1, "name": "Original", "page_order": []}"#,
        )
        .await
        .unwrap();

        let prepared = workfile::prepare_save(&Document::new("Migrated".to_string())).unwrap();
        let flag: MigrationFlag = Arc::new(Mutex::new(Some(1)));

        write_prepared_with_migration_flag(prepared, &workfile_path, &flag).await;

        assert!(
            tokio::fs::metadata(workfile_path.join(".backup-v1")).await.is_ok(),
            ".backup-v1/ should be created on the first migrated save"
        );
        assert!(
            flag.lock().unwrap().is_none(),
            "migration flag should be cleared after successful save"
        );
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./dev.sh cargo test -p sigil-server --lib persistence::tests::test_write_prepared_with_migration_flag_consumes_flag_and_backs_up`
Expected: FAIL to compile — `cannot find function write_prepared_with_migration_flag`.

- [ ] **Step 3: Rewrite `persistence.rs`**

Replace the entire non-test body of `crates/server/src/persistence.rs` with:

```rust
//! Persistence helpers shared by the per-session persistence tasks.
//!
//! Per-session persistence (Spec 22a) lives in [`crate::session_persistence`];
//! this module holds the debounce constant, the migration-flag type, and the
//! reusable migration-flag-aware write (the second, async phase of a save).
//!
//! # Two-phase save
//!
//! A save is split into a synchronous prepare (serialize the document while a
//! lock is held) and an asynchronous write (atomic temp+rename, no lock held).
//! The caller performs phase one against whatever lock guards its document;
//! this module owns phase two.

use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::workfile::{self, PreparedSave};

/// Default debounce interval (in milliseconds) before flushing to disk.
pub const SAVE_DEBOUNCE_MS: u64 = 500;

/// Shared one-shot flag indicating that the next save is the first persisted
/// write after a schema migration on load.
///
/// When `Some(v)`, [`write_prepared_with_migration_flag`] takes the value and
/// populates [`workfile::PreparedSave::migrated_from`] so the writer backs up
/// the legacy artifacts before overwriting them. The flag is restored on write
/// failure so the next attempt retries the backup.
pub type MigrationFlag = Arc<Mutex<Option<u32>>>;

/// Phase two of a save: takes the migration flag, writes `prepared` atomically,
/// and restores the flag on failure.
///
/// `prepared` is produced by [`workfile::prepare_save`] under the document lock
/// (phase one) and passed here after the lock is dropped — this function never
/// touches a document lock and is safe to `.await`.
pub async fn write_prepared_with_migration_flag(
    mut prepared: PreparedSave,
    workfile_path: &Path,
    migration_flag: &MigrationFlag,
) {
    let migrated_from = match migration_flag.lock() {
        Ok(mut g) => g.take(),
        Err(poisoned) => {
            tracing::error!("migration flag lock poisoned during save — recovering");
            poisoned.into_inner().take()
        }
    };
    prepared.migrated_from = migrated_from;

    match workfile::write_prepared_save(&prepared, workfile_path).await {
        Ok(()) => tracing::debug!("document saved to {}", workfile_path.display()),
        Err(e) => {
            tracing::error!("failed to write workfile to {}: {e}", workfile_path.display());
            if let Some(v) = migrated_from {
                match migration_flag.lock() {
                    Ok(mut g) => {
                        if g.is_none() {
                            *g = Some(v);
                        }
                    }
                    Err(poisoned) => {
                        let mut g = poisoned.into_inner();
                        if g.is_none() {
                            *g = Some(v);
                        }
                    }
                }
            }
        }
    }
}
```

Then keep the `mod tests` from Step 1. (`PreparedSave` must be `pub` in `workfile.rs` — it already is, per `crates/server/src/workfile.rs:101`.)

- [ ] **Step 4: Remove the now-dead `AppState` persistence API**

In `crates/state/src/lib.rs`:
1. Delete the `persistence_handle: Arc<Mutex<Option<JoinHandle<()>>>>,` field from `struct AppState` (and update the doc comment block above it).
2. Delete the `new_with_persistence` method.
3. Delete `take_persistence_handle` and `take_dirty_tx`.
4. In `new()`, remove the `persistence_handle: Arc::new(Mutex::new(None)),` line.
5. Remove the now-unused `use tokio::task::JoinHandle;` import if nothing else uses it (check: `grep -n JoinHandle crates/state/src/lib.rs` — if only the deleted items referenced it, remove the import).
6. Keep the `dirty_tx: Option<mpsc::Sender<()>>` field and `signal_dirty` (still called by MCP/GraphQL; always `None` now → no-op). Keep the `use tokio::sync::{broadcast, mpsc};` import (`mpsc` still used by the `dirty_tx` field type).

The `new_with_document` from Task 2 must now omit the `persistence_handle` line (already written that way in Task 2 Step 3 if Task 3's struct change is applied — reconcile the two).

- [ ] **Step 5: Run tests to verify they pass**

Run: `./dev.sh cargo test -p sigil-state && ./dev.sh cargo test -p sigil-server --lib persistence::tests`
Expected: PASS. (sigil-server will not yet fully build if `state.rs`/`main.rs` still reference the deleted spawns — that is fixed in Tasks 6–7. Build sigil-state standalone here; the server compiles after Task 7. If the workspace build is needed to run the persistence test, complete Tasks 6–7 first, then return to run this step. Recommended execution order: 1 → 2 → 3(state struct) → 4(manager) → 5 → 6 → 7 → 3(persistence tests run) → 8 → 9 → 10.)

- [ ] **Step 6: Commit**

```bash
./dev.sh cargo fmt
git add crates/server/src/persistence.rs crates/state/src/lib.rs
git commit -m "refactor(server): extract write_prepared_with_migration_flag; remove legacy persistence task API (spec-22a)"
```

(Type is `refactor` only if no behavior changes; because this deletes the legacy task wiring that other modules still reference until Task 7, prefer committing Tasks 3+6+7 together if the workspace will not build in between. If committing separately, ensure each commit builds — see the recommended order above and squash if needed.)

---

## Task 4: `SessionPersistence` manager + `persist_loop`

**Files:**
- Create: `crates/server/src/session_persistence.rs`
- Modify: `crates/server/src/lib.rs` (add `pub mod session_persistence;`)
- Test: `crates/server/src/session_persistence.rs` (inline `mod tests`)

- [ ] **Step 1: Declare the module**

In `crates/server/src/lib.rs`, add alongside the other `pub mod` declarations:

```rust
pub mod session_persistence;
```

- [ ] **Step 2: Write the failing tests**

Create `crates/server/src/session_persistence.rs` with the test module first (the impl in Step 4 makes them pass):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    use sigil_core::Document;
    use sigil_state::sessions::Sessions;
    use tokio::time::sleep;

    /// Lays down an empty `.sigil/` dir and opens a disk-backed session in `sessions`.
    async fn open_disk_session(
        sessions: &Sessions,
        dir: &std::path::Path,
        name: &str,
    ) -> Arc<sigil_state::sessions::DocumentSession> {
        let workfile_path = dir.join(format!("{name}.sigil"));
        tokio::fs::create_dir_all(&workfile_path).await.unwrap();
        let id = sessions
            .open(&workfile_path, |_p| {
                Ok::<_, std::convert::Infallible>(Document::new(name.to_string()))
            })
            .expect("open session");
        sessions.get(id).expect("session registered")
    }

    /// A mutation broadcast on the session arms a debounced save that lands on disk.
    #[tokio::test]
    async fn test_broadcast_triggers_debounced_save() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let session = open_disk_session(&sessions, dir.path(), "doc").await;
        let workfile_path = session.workfile_path.clone();

        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&session), None);

        // Fire a document event the way apply_operations does.
        let _ = session
            .broadcast
            .send(sigil_state::sessions::SessionEvent::DocumentEvent(
                sigil_state::MutationEvent::default(),
            ));

        sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 300)).await;

        assert!(
            workfile_path.join("manifest.json").exists(),
            "manifest.json should be written after a broadcast + debounce"
        );
    }

    /// register() is a no-op for `memory://` sessions and idempotent for repeats.
    #[tokio::test]
    async fn test_register_skips_memory_and_is_idempotent() {
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let mem_id = sessions.register_in_memory(Document::new("mem".to_string()));
        let mem_session = sessions.get(mem_id).unwrap();

        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&mem_session), None);
        assert_eq!(manager.len(), 0, "memory:// sessions must not be registered");

        let dir = tempfile::tempdir().unwrap();
        let disk = {
            let workfile_path = dir.path().join("d.sigil");
            tokio::fs::create_dir_all(&workfile_path).await.unwrap();
            let id = sessions
                .open(&workfile_path, |_p| {
                    Ok::<_, std::convert::Infallible>(Document::new("d".to_string()))
                })
                .unwrap();
            sessions.get(id).unwrap()
        };
        manager.register(Arc::clone(&disk), None);
        manager.register(Arc::clone(&disk), None); // duplicate
        assert_eq!(manager.len(), 1, "duplicate register must not spawn a second task");
    }

    /// close() fires a final flush and joins the task before returning.
    #[tokio::test]
    async fn test_close_flushes_before_returning() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let session = open_disk_session(&sessions, dir.path(), "flush").await;
        let workfile_path = session.workfile_path.clone();

        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&session), None);

        // No broadcast fired; close still flushes last-good state immediately.
        manager.close(session.id).await;

        assert!(
            workfile_path.join("manifest.json").exists(),
            "close() must flush before returning, without waiting for a debounce"
        );
        assert_eq!(manager.len(), 0, "handle removed after close");
    }

    /// A migrated session force-persists on first save and creates .backup-v1/.
    #[tokio::test]
    async fn test_migrated_session_force_persists_and_backs_up() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let session = open_disk_session(&sessions, dir.path(), "mig").await;
        let workfile_path = session.workfile_path.clone();
        // A v1 manifest must exist for the backup to capture something.
        tokio::fs::write(
            workfile_path.join("manifest.json"),
            r#"{"schema_version": 1, "name": "Original", "page_order": []}"#,
        )
        .await
        .unwrap();

        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&session), Some(1)); // migrated_from = Some(1)

        // No broadcast: the migration flag must trigger the first save on its own.
        sleep(Duration::from_millis(SAVE_DEBOUNCE_MS + 300)).await;

        assert!(
            tokio::fs::metadata(workfile_path.join(".backup-v1")).await.is_ok(),
            "migrated session must force-persist and create .backup-v1/"
        );
    }

    /// Closing twice (or after the task exited) does not panic or double-write.
    #[tokio::test]
    async fn test_double_close_is_safe() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(sigil_state::MUTATION_BROADCAST_CAPACITY);
        let session = open_disk_session(&sessions, dir.path(), "twice").await;
        let manager = SessionPersistence::new();
        manager.register(Arc::clone(&session), None);
        manager.close(session.id).await;
        manager.close(session.id).await; // second close: map yields None
    }
}
```

This test relies on `MutationEvent: Default`. Verify with `grep -n "struct MutationEvent" crates/state/src/lib.rs` and confirm it derives `Default`; if it does not, construct it explicitly in the test instead of `MutationEvent::default()` (build a minimal `MutationEvent { kind: ..., uuid: None, data: None, transaction: None }` matching its fields).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./dev.sh cargo test -p sigil-server --lib session_persistence`
Expected: FAIL to compile — `SessionPersistence` not defined.

- [ ] **Step 4: Implement the manager and loop**

Prepend the implementation above the `mod tests` in `crates/server/src/session_persistence.rs`:

```rust
//! Per-session debounced persistence (Spec 22a).
//!
//! Each disk-backed [`DocumentSession`] gets one [`persist_loop`] task that
//! subscribes to the session's `broadcast` channel — the broadcast doubles as
//! the dirty signal: every mutation that broadcasts is automatically persisted,
//! and it is structurally impossible to broadcast without persisting. The
//! [`SessionPersistence`] manager owns the task lifecycle and is kept in
//! lockstep with the `Sessions` registry (a manager entry exists iff a
//! disk-backed session exists).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use sigil_state::sessions::{DocumentSession, SessionEvent};
use sigil_state::SessionId;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::{Duration, Instant};

use crate::persistence::{write_prepared_with_migration_flag, MigrationFlag, SAVE_DEBOUNCE_MS};
use crate::workfile;

/// `memory://` scheme prefix used by `Sessions::register_in_memory`. Sessions
/// with this prefix have no disk path and are skipped by the manager.
const MEMORY_SCHEME: &str = "memory://";

/// Handle to a running per-session persistence task.
struct PersistenceHandle {
    /// Firing this triggers a final flush and orderly task exit.
    shutdown: oneshot::Sender<()>,
    /// Joined during `close`/`shutdown_all` to confirm the final flush ran.
    join: JoinHandle<()>,
}

/// Owns the per-session persistence tasks. One entry per disk-backed session.
#[derive(Default)]
pub struct SessionPersistence {
    handles: Mutex<HashMap<SessionId, PersistenceHandle>>,
}

impl SessionPersistence {
    #[must_use]
    pub fn new() -> Self {
        Self { handles: Mutex::new(HashMap::new()) }
    }

    /// Spawns a persistence task for `session`. No-op for `memory://` sessions
    /// and idempotent if the session is already registered.
    ///
    /// `migrated_from` seeds the task's migration flag: when `Some(v)`, the
    /// first save is forced (even with no mutation) and backs up the legacy
    /// artifacts to `.backup-v(N-1)/`.
    pub fn register(&self, session: Arc<DocumentSession>, migrated_from: Option<u32>) {
        if session
            .workfile_path
            .to_str()
            .is_some_and(|p| p.starts_with(MEMORY_SCHEME))
        {
            return;
        }
        let id = session.id;
        let mut map = self.handles.lock().unwrap_or_else(PoisonError::into_inner);
        if map.contains_key(&id) {
            return;
        }
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let migration_flag: MigrationFlag = Arc::new(Mutex::new(migrated_from));
        let force_initial_save = migrated_from.is_some();
        let join = tokio::spawn(persist_loop(
            session,
            shutdown_rx,
            migration_flag,
            force_initial_save,
        ));
        map.insert(id, PersistenceHandle { shutdown: shutdown_tx, join });
    }

    /// Number of registered (disk-backed) sessions.
    #[must_use]
    pub fn len(&self) -> usize {
        self.handles.lock().unwrap_or_else(PoisonError::into_inner).len()
    }

    /// Whether a persistence task exists for `id`.
    #[must_use]
    pub fn is_registered(&self, id: SessionId) -> bool {
        self.handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains_key(&id)
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Flush + join the task for `id`, then forget it. Idempotent: a second
    /// call (or a call for an unknown id) is a no-op.
    ///
    /// MUST be called BEFORE `Sessions::close(id)` so the session `Arc` (and
    /// thus the store) is still alive for the final flush.
    pub async fn close(&self, id: SessionId) {
        let handle = self
            .handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        if let Some(h) = handle {
            // Err means the task already exited; the final flush already ran.
            let _ = h.shutdown.send(());
            if let Err(e) = h.join.await {
                tracing::error!("persistence task for session {id} panicked on close: {e}");
            }
        }
    }

    /// Drain every task within one bounded total timeout (graceful shutdown).
    /// Fires all shutdowns first so tasks flush in parallel.
    pub async fn shutdown_all(&self, timeout: Duration) {
        let handles: Vec<PersistenceHandle> = {
            let mut map = self.handles.lock().unwrap_or_else(PoisonError::into_inner);
            map.drain().map(|(_, h)| h).collect()
        };
        let mut joins = Vec::with_capacity(handles.len());
        for h in handles {
            let _ = h.shutdown.send(());
            joins.push(h.join);
        }
        let drained = tokio::time::timeout(timeout, async {
            for j in joins {
                if let Err(e) = j.await {
                    tracing::error!("persistence task panicked during shutdown: {e}");
                }
            }
        })
        .await;
        if drained.is_err() {
            tracing::warn!("persistence drain exceeded {timeout:?} — abandoning remaining tasks");
        }
    }
}

/// The per-session persistence task body.
///
/// Subscribes to the session broadcast, debounces dirty signals, and saves.
/// Holds a strong `Arc<DocumentSession>`, so the broadcast `Sender` never drops
/// underneath the receiver — `RecvError::Closed` is therefore unreachable in
/// practice (Spec 22a §3.1); the `oneshot` is the sole shutdown trigger. The
/// `Closed` arm is kept only for match exhaustiveness + belt-and-suspenders.
async fn persist_loop(
    session: Arc<DocumentSession>,
    mut shutdown_rx: oneshot::Receiver<()>,
    migration_flag: MigrationFlag,
    force_initial_save: bool,
) {
    let mut rx = session.broadcast.subscribe();
    let debounce = Duration::from_millis(SAVE_DEBOUNCE_MS);

    // None = idle (no save pending). Some(deadline) = save armed for that instant.
    // A migrated session arms immediately so the migration is force-persisted
    // even without a mutation (mirrors the old post-load signal_dirty()).
    let mut deadline: Option<Instant> = if force_initial_save {
        Some(Instant::now() + debounce)
    } else {
        None
    };
    // Becomes false after SessionFatal: stop arming new saves (a final flush on
    // close/shutdown may still run).
    let mut arming = true;

    loop {
        // Recreating sleep_until with the SAME absolute deadline each iteration
        // does NOT reset the timer (it is an absolute instant). When idle, a
        // pending future never resolves.
        let debounce_tick = async {
            match deadline {
                Some(d) => tokio::time::sleep_until(d).await,
                None => std::future::pending::<()>().await,
            }
        };

        tokio::select! {
            _ = &mut shutdown_rx => {
                do_save_session(&session, &migration_flag).await;
                break;
            }
            ev = rx.recv() => match ev {
                Ok(SessionEvent::DocumentEvent(_)) | Err(RecvError::Lagged(_)) => {
                    if arming {
                        deadline = Some(Instant::now() + debounce);
                    }
                }
                Ok(SessionEvent::SessionFatal { .. }) => {
                    arming = false;
                }
                Err(RecvError::Closed) => {
                    // Unreachable while the task holds the session Arc (§3.1).
                    do_save_session(&session, &migration_flag).await;
                    break;
                }
            },
            () = debounce_tick, if deadline.is_some() => {
                do_save_session(&session, &migration_flag).await;
                deadline = None;
            }
        }
    }
}

/// One save: read the session store (async), serialize while holding the read
/// lock, drop the lock, then write atomically (no lock across `.await`).
async fn do_save_session(session: &Arc<DocumentSession>, migration_flag: &MigrationFlag) {
    let prepared = {
        let guard = session.store.read().await;
        match workfile::prepare_save(&guard.0) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(
                    "failed to serialize session {} for save: {e}",
                    session.id
                );
                return;
            }
        }
        // read guard dropped here — released before any await below.
    };
    write_prepared_with_migration_flag(prepared, &session.workfile_path, migration_flag).await;
}
```

Confirm exports used: `sigil_state::SessionId` (re-exported at `lib.rs:20`), `sigil_state::sessions::{DocumentSession, SessionEvent}` (both `pub`), `sigil_state::MUTATION_BROADCAST_CAPACITY`, `Sessions::open`/`get`/`register_in_memory`. `session.store` is `tokio::sync::RwLock<SendDocument>`; `guard.0` is the inner `Document` (`SendDocument.0` is `pub`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./dev.sh cargo test -p sigil-server --lib session_persistence`
Expected: PASS (all five tests). If `test_close_flushes_before_returning` is flaky, it indicates `do_save_session` is not awaited on the shutdown path — re-check the `_ = &mut shutdown_rx` arm awaits `do_save_session` before `break`.

- [ ] **Step 6: Commit**

```bash
./dev.sh cargo fmt
git add crates/server/src/session_persistence.rs crates/server/src/lib.rs
git commit -m "feat(server): per-session persistence manager and debounced save loop (spec-22a)"
```

---

## Task 5: `load_workfile_sync_migrated` for the openSession path

**Why:** `openSession` loads via `load_workfile_sync`, which **intentionally drops** `migrated_from` (`workfile.rs:522`). The per-session task needs that flag to force-persist + back up an `openSession`-opened legacy workfile (the bug 22a fixes). Add a sync variant that returns it; the resolver captures it out-of-band via the loader closure (Task 8).

**Files:**
- Modify: `crates/server/src/workfile.rs` (add `load_workfile_sync_migrated`)
- Test: `crates/server/src/workfile.rs` (`mod tests`)

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `crates/server/src/workfile.rs` (note: `load_workfile_sync*` need the multi-thread runtime because of `block_in_place`):

```rust
/// `load_workfile_sync_migrated` returns the same document as the async loader
/// AND surfaces the migration version that `load_workfile_sync` drops.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_load_workfile_sync_migrated_surfaces_version() {
    let dir = tempfile::tempdir().unwrap();
    let workfile_path = dir.path().join("v1.sigil");
    let page_uuid = Uuid::new_v4();
    let pages_dir = workfile_path.join("pages");
    tokio::fs::create_dir_all(&pages_dir).await.unwrap();
    tokio::fs::write(
        workfile_path.join("manifest.json"),
        serde_json::json!({
            "schema_version": 1, "name": "Legacy", "page_order": [page_uuid.to_string()]
        })
        .to_string(),
    )
    .await
    .unwrap();
    tokio::fs::write(
        pages_dir.join(format!("{page_uuid}.json")),
        serde_json::json!({
            "schema_version": 1, "id": page_uuid.to_string(),
            "name": "P", "nodes": [], "transitions": []
        })
        .to_string(),
    )
    .await
    .unwrap();

    let (doc, migrated_from) = load_workfile_sync_migrated(&workfile_path).unwrap();
    assert_eq!(migrated_from, Some(1), "v1 workfile must report migrated_from = Some(1)");
    assert_eq!(doc.pages.len(), 1);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./dev.sh cargo test -p sigil-server --lib workfile::tests::test_load_workfile_sync_migrated_surfaces_version`
Expected: FAIL to compile — function not found.

- [ ] **Step 3: Implement the variant**

Add to `crates/server/src/workfile.rs` immediately after `load_workfile_sync` (≈ line 544):

```rust
/// Synchronous variant of [`load_workfile`] that also returns the migration
/// version, for callers that drive a synchronous loader closure (e.g. the
/// GraphQL `openSession` resolver) but still need to force-persist + back up a
/// migrated workfile.
///
/// Like [`load_workfile_sync`], requires the multi-threaded tokio runtime
/// because it uses [`tokio::task::block_in_place`].
///
/// # Errors
///
/// Returns an error if the workfile cannot be loaded (see [`load_workfile`]).
pub fn load_workfile_sync_migrated(path: &Path) -> Result<(Document, Option<u32>)> {
    let loaded = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(load_workfile(path))
    })?;
    Ok((loaded.document, loaded.migrated_from))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./dev.sh cargo test -p sigil-server --lib workfile::tests::test_load_workfile_sync_migrated_surfaces_version`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
./dev.sh cargo fmt
git add crates/server/src/workfile.rs
git commit -m "feat(server): load_workfile_sync_migrated surfaces migration version for session loaders (spec-22a)"
```

---

## Task 6: Rewire `ServerState` — add manager, drop legacy persistence spawning

**Files:**
- Modify: `crates/server/src/state.rs`
- Test: `crates/server/src/state.rs` (`mod tests`)

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `crates/server/src/state.rs`:

```rust
#[tokio::test]
async fn test_server_state_exposes_empty_persistence_manager() {
    let state = ServerState::new();
    // A fresh in-memory state has no disk-backed sessions, so no persistence
    // tasks are registered.
    assert_eq!(state.persistence.len(), 0);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./dev.sh cargo test -p sigil-server --lib state::tests::test_server_state_exposes_empty_persistence_manager`
Expected: FAIL to compile — `no field persistence on ServerState`.

- [ ] **Step 3: Rewrite `state.rs`**

Apply these edits to `crates/server/src/state.rs`:

1. Add imports near the top:

```rust
use crate::session_persistence::SessionPersistence;
```

(Keep existing `use sigil_core::Document;`, `use std::path::PathBuf;`, `use std::sync::{Arc, Mutex};`, `use tokio::sync::broadcast;`.)

2. Add the field to `ServerState`:

```rust
#[derive(Clone)]
pub struct ServerState {
    /// High-level application state: legacy single-document `AppState` plus
    /// [`Sessions`] registry. Shared with MCP via `state.app.clone()`.
    pub app: App,
    /// Per-session persistence manager (Spec 22a). Owns one debounced save task
    /// per disk-backed session. Shared (`Arc`) so clones for Axum/MCP observe
    /// the same task set; graceful shutdown drains it via `shutdown_all`.
    pub persistence: Arc<SessionPersistence>,
}
```

3. Rewrite `new()` to set `persistence`:

```rust
    #[must_use]
    pub fn new() -> Self {
        let mut legacy = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        legacy.set_event_tx(tx);
        let app = App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY);

        let default_doc = {
            let guard = app
                .legacy
                .document
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.0.clone()
        };
        let id = app.sessions.register_in_memory(default_doc);
        app.set_default_session_id(Some(id));

        Self { app, persistence: Arc::new(SessionPersistence::new()) }
    }
```

4. Delete `new_with_workfile` entirely (dead — no callers; verified via grep).

5. Delete `new_with_document_and_workfile` (the non-migrated wrapper — dead; only `new_with_document_and_workfile_migrated` is called).

6. Rewrite `new_with_document_and_workfile_migrated` to build a disk-backed legacy state **without** a persistence task and to expose the manager. It no longer spawns anything or handles the migration flag — the caller (main.rs) registers the session + persistence with the migration flag:

```rust
    /// Creates a `ServerState` holding a pre-loaded document for `workfile_path`.
    ///
    /// Spec 22a: this no longer spawns a persistence task. The legacy `AppState`
    /// holds the document for the still-present mirror (removed in 22c), but
    /// persistence is owned per-session by [`SessionPersistence`]. The caller is
    /// responsible for registering the session in `app.sessions` AND registering
    /// it with `persistence` (passing the migration flag) — see
    /// `main.rs::load_workfile_into_state`.
    ///
    /// `_migrated_from` is accepted for call-site compatibility but is now
    /// threaded by the caller into `SessionPersistence::register`; it is not used
    /// here.
    #[must_use]
    pub fn new_with_document_and_workfile_migrated(
        doc: Document,
        workfile_path: PathBuf,
        _migrated_from: Option<u32>,
    ) -> Self {
        let document = Arc::new(Mutex::new(SendDocument(doc)));
        let mut legacy = AppState::new_with_document(document, workfile_path);
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        legacy.set_event_tx(tx);
        Self {
            app: App::from_legacy(legacy, MUTATION_BROADCAST_CAPACITY),
            persistence: Arc::new(SessionPersistence::new()),
        }
    }
```

(The `_migrated_from` parameter is retained so the integration test and `main.rs` call sites compile unchanged in signature; the value is consumed at registration time. If preferred, drop the parameter and update both call sites — but keeping it minimizes churn and documents intent. Decision: keep it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `./dev.sh cargo test -p sigil-server --lib state::tests`
Expected: the new test PASSES once `main.rs` (Task 7) is also updated enough for the crate to compile. If the crate does not yet build (main.rs still calls removed APIs), proceed to Task 7 and run this step afterward.

- [ ] **Step 5: Commit** (bundle with Task 7 if the crate cannot build standalone — see note in Task 3 Step 6)

```bash
./dev.sh cargo fmt
git add crates/server/src/state.rs
git commit -m "feat(server): ServerState owns SessionPersistence; drop legacy persistence spawning (spec-22a)"
```

---

## Task 7: Rewire `main.rs` — register startup session, drain manager on shutdown

**Files:**
- Modify: `crates/server/src/main.rs`

- [ ] **Step 1: Rewrite `load_workfile_into_state`**

Replace the body of `load_workfile_into_state` in `crates/server/src/main.rs` with:

```rust
async fn load_workfile_into_state(workfile_path: &Path) -> anyhow::Result<ServerState> {
    tracing::info!("loading workfile from {}", workfile_path.display());

    let loaded = sigil_server::workfile::load_workfile(workfile_path)
        .await
        .context("failed to load workfile")?;

    let migrated_from = loaded.migrated_from;
    // The legacy `AppState` still mirrors the document (removed in 22c). The
    // session store is the persistence source as of Spec 22a.
    let doc_for_session = loaded.document.clone();
    let state = ServerState::new_with_document_and_workfile_migrated(
        loaded.document,
        workfile_path.to_path_buf(),
        migrated_from,
    );

    // Register the loaded workfile as the default session, then register its
    // per-session persistence task IN THE SAME FUNCTION (Spec 22a §3.3
    // invariant: no disk-backed session exists without a persistence entry).
    match state.app.open_session_with(workfile_path, |_path| {
        Ok::<_, std::convert::Infallible>(doc_for_session)
    }) {
        Ok(session_id) => {
            if let Some(session) = state.app.sessions.get(session_id) {
                // Passing `migrated_from` forces the first save + `.backup-v(N-1)/`
                // for a workfile that was migrated on load.
                state.persistence.register(session, migrated_from);
                tracing::info!(
                    "registered default session {session_id} + persistence for workfile {}",
                    workfile_path.display()
                );
            } else {
                tracing::error!(
                    "session {session_id} missing from registry immediately after open"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                "failed to register default session for workfile {}: {e}. \
                 Persistence will be unavailable.",
                workfile_path.display()
            );
        }
    }

    Ok(state)
}
```

Note: the old `signal_dirty()`-after-load block is **removed** — the migration force-save is now driven by `register(session, migrated_from)`.

- [ ] **Step 2: Rewrite the shutdown wiring in `main`**

In `crates/server/src/main.rs::main`, make these changes:

1. Replace the take-handle block (currently lines 91–94):

```rust
    // Clone the persistence manager handle for graceful shutdown after serve.
    let persistence = state.persistence.clone();
```

2. Leave MCP startup (`mcp_handle`) unchanged. Leave `build_app(state, ...)` unchanged. Leave the serve call unchanged.

3. Replace the final persistence-shutdown block (currently lines 138–151, the `drop(dirty_tx)` + `take_persistence_handle` await) with:

```rust
    // Graceful shutdown: drain every per-session persistence task within one
    // bounded total budget (Spec 22a §3.3). Each task does a final flush of its
    // session store before exiting.
    tracing::info!("draining persistence tasks...");
    persistence.shutdown_all(PERSISTENCE_SHUTDOWN_TIMEOUT).await;
    tracing::info!("persistence drain complete");
```

`PERSISTENCE_SHUTDOWN_TIMEOUT` (line 14) is reused as the **total** drain budget. Keep `MCP_SHUTDOWN_TIMEOUT` and the MCP drain block as-is (it stays before the persistence drain).

- [ ] **Step 3: Build the workspace**

Run: `./dev.sh cargo build --workspace`
Expected: builds clean. If `take_persistence_handle`/`take_dirty_tx` are referenced anywhere else, the compiler will name the site — there should be none after this task.

- [ ] **Step 4: Run server + state + persistence tests**

Run: `./dev.sh cargo test -p sigil-server --lib state:: persistence:: session_persistence::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
./dev.sh cargo fmt
git add crates/server/src/main.rs
git commit -m "feat(server): startup registers per-session persistence; shutdown drains the manager (spec-22a)"
```

---

## Task 8: `open_session` resolver registers persistence (with migration flag)

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs` (`open_session`, ≈ lines 1514–1586)
- Test: a GraphQL integration test (`crates/server/src/graphql/mutation.rs` `mod tests`, or the existing GraphQL integration test file if present)

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` in `crates/server/src/graphql/mutation.rs`. This test opens a disk-backed workfile via the resolver and asserts persistence got registered (uses multi-thread runtime for `block_in_place` inside `load_workfile_sync_migrated`):

```rust
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_open_session_registers_persistence() {
    use sigil_core::Document;

    let dir = tempfile::tempdir().unwrap();
    let workfile_path = dir.path().join("opened.sigil");
    let pages_dir = workfile_path.join("pages");
    tokio::fs::create_dir_all(&pages_dir).await.unwrap();
    // Minimal valid v2 workfile.
    tokio::fs::write(
        workfile_path.join("manifest.json"),
        serde_json::json!({"schema_version": 2, "name": "Opened", "page_order": []}).to_string(),
    )
    .await
    .unwrap();

    let state = ServerState::new();
    let persistence = state.persistence.clone();
    let app_sessions = state.app.sessions.clone();
    let schema = test_schema(state);

    let query = format!(
        r#"mutation {{ openSession(path: "{}") {{ id }} }}"#,
        workfile_path.display()
    );
    let resp = schema.execute(&query).await;
    assert!(resp.errors.is_empty(), "openSession errored: {:?}", resp.errors);

    // A persistence task now exists for exactly the disk-backed session.
    assert_eq!(persistence.len(), 1, "openSession must register one persistence task");
    // And it is NOT registered for any leftover memory:// session.
    assert_eq!(app_sessions.len(), 1, "synthetic session should be closed after open");
    let _ = Document::new("unused".to_string()); // keep import used if needed
}
```

If `test_schema` injects `RequestSession(None)`, the resolver resolves the default session correctly; no header needed for `open_session`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `./dev.sh cargo test -p sigil-server --lib graphql::mutation::tests::test_open_session_registers_persistence`
Expected: FAIL — `persistence.len()` is 0 (resolver does not register yet).

- [ ] **Step 3: Update the `open_session` resolver**

In `open_session` (`crates/server/src/graphql/mutation.rs`), replace the loader closure + open call (currently lines 1522–1548) so the migration version is captured and the session is registered with persistence. Replace:

```rust
        let loader =
            |p: &std::path::Path| -> std::result::Result<sigil_core::Document, anyhow::Error> {
                crate::workfile::load_workfile_sync(p)
            };

        // RF-007: ...
        let id = state
            .app
            .open_session_with(&path_buf, loader)
            .map_err(|e| { /* ... unchanged ... */ })?;
```

with:

```rust
        // Capture migrated_from out-of-band: the loader closure runs inline on
        // this thread inside `Sessions::open`, so a `Cell` written by the
        // closure is readable after `open_session_with` returns. If the session
        // already existed, the loader does not run and the cell stays `None`
        // (the existing session's persistence was registered on its first open).
        let migrated_cell: std::cell::Cell<Option<u32>> = std::cell::Cell::new(None);
        let loader =
            |p: &std::path::Path| -> std::result::Result<sigil_core::Document, anyhow::Error> {
                let (doc, migrated_from) = crate::workfile::load_workfile_sync_migrated(p)?;
                migrated_cell.set(migrated_from);
                Ok(doc)
            };

        // RF-007: use App::open_session_with so default_session_id repoints at
        // the freshly-opened real workfile session.
        let id = state
            .app
            .open_session_with(&path_buf, loader)
            .map_err(|e| {
                use sigil_state::SessionsError as E;
                let code = match &e {
                    E::InvalidWorkfilePath(_) | E::PathError(_) => "INVALID_WORKFILE_PATH",
                    E::LoadFailed(_) => "LOAD_FAILED",
                    E::TooManySessions { .. } => "TOO_MANY_SESSIONS",
                    E::SessionNotFound(_) | E::SessionErrored => "INTERNAL",
                };
                error_with_code(&format!("openSession: {e}"), code)
            })?;

        // Spec 22a §3.3 invariant: register persistence in the SAME function as
        // open. `register` is idempotent (a re-opened session already has a
        // task) and skips memory:// sessions.
        let migrated_from = migrated_cell.get();
        if let Some(session) = state.app.sessions.get(id) {
            state.persistence.register(session, migrated_from);
        }
```

Leave the rest of the resolver (synthetic-session close, `GqlSessionInfo` construction) unchanged. The `close_synthetic_sessions()` call stays — it closes the `memory://` session, which was never registered with persistence, so no persistence cleanup is needed there.

- [ ] **Step 4: Run the test to verify it passes**

Run: `./dev.sh cargo test -p sigil-server --lib graphql::mutation::tests::test_open_session_registers_persistence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
./dev.sh cargo fmt
git add crates/server/src/graphql/mutation.rs
git commit -m "feat(server): openSession registers per-session persistence with migration flag (spec-22a)"
```

---

## Task 9: `close_session` resolver flushes + joins before `Sessions::close`

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs` (`close_session`, ≈ lines 1599–1615)
- Test: `crates/server/src/graphql/mutation.rs` (`mod tests`)

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `crates/server/src/graphql/mutation.rs`:

```rust
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_close_session_flushes_and_deregisters_persistence() {
    let dir = tempfile::tempdir().unwrap();
    let workfile_path = dir.path().join("toclose.sigil");
    let pages_dir = workfile_path.join("pages");
    tokio::fs::create_dir_all(&pages_dir).await.unwrap();
    tokio::fs::write(
        workfile_path.join("manifest.json"),
        serde_json::json!({"schema_version": 2, "name": "ToClose", "page_order": []}).to_string(),
    )
    .await
    .unwrap();

    let state = ServerState::new();
    let persistence = state.persistence.clone();
    let schema = test_schema(state);

    let open = schema
        .execute(&format!(
            r#"mutation {{ openSession(path: "{}") {{ id }} }}"#,
            workfile_path.display()
        ))
        .await;
    assert!(open.errors.is_empty(), "openSession errored: {:?}", open.errors);
    let id = open.data.into_json().unwrap()["openSession"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(persistence.len(), 1);

    // Remove the live manifest so we can prove close() flushes a fresh one.
    tokio::fs::remove_file(workfile_path.join("manifest.json")).await.unwrap();

    let close = schema
        .execute(&format!(r#"mutation {{ closeSession(id: "{id}") }}"#))
        .await;
    assert!(close.errors.is_empty(), "closeSession errored: {:?}", close.errors);

    // close() flushed before returning — manifest written again — and the
    // persistence entry is gone.
    assert!(
        workfile_path.join("manifest.json").exists(),
        "closeSession must flush the session store before Sessions::close"
    );
    assert_eq!(persistence.len(), 0, "persistence entry removed on close");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./dev.sh cargo test -p sigil-server --lib graphql::mutation::tests::test_close_session_flushes_and_deregisters_persistence`
Expected: FAIL — manifest not re-created (no flush) and/or `persistence.len()` still 1.

- [ ] **Step 3: Update the `close_session` resolver**

Replace `close_session` in `crates/server/src/graphql/mutation.rs`:

```rust
    async fn close_session(&self, ctx: &Context<'_>, id: ID) -> Result<bool> {
        let state = ctx.data::<ServerState>()?;
        let session_id: SessionId = id.0.parse().map_err(|e| {
            error_with_code(
                &format!("closeSession: invalid session id: {e}"),
                "INVALID_SESSION_ID",
            )
        })?;

        // Spec 22a §3.3: flush + join the persistence task BEFORE closing the
        // session in the registry, so the session `Arc` (and its store) is still
        // alive for the final save. `close` is a no-op for unregistered ids
        // (e.g. memory:// sessions), so a registry close still proceeds.
        state.persistence.close(session_id).await;

        state.app.sessions.close(session_id).map_err(|e| {
            let code = match &e {
                sigil_state::SessionsError::SessionNotFound(_) => "SESSION_NOT_FOUND",
                _ => "INTERNAL",
            };
            error_with_code(&format!("closeSession: {e}"), code)
        })?;
        Ok(true)
    }
```

Ordering note: persistence flush happens first; if the registry close then returns `SESSION_NOT_FOUND` (already closed), the flush was still harmless (it persisted last-good state). This matches the spec's "flush before the session `Arc` is dropped."

- [ ] **Step 4: Run the test to verify it passes**

Run: `./dev.sh cargo test -p sigil-server --lib graphql::mutation::tests::test_close_session_flushes_and_deregisters_persistence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
./dev.sh cargo fmt
git add crates/server/src/graphql/mutation.rs
git commit -m "feat(server): closeSession flushes and joins persistence before registry close (spec-22a)"
```

---

## Task 10: Move the v1-migration smoke test to the per-session path

**Why:** `integration_v1_workfile_migration.rs` currently drives persistence via `signal_dirty()`, which is a no-op after this plan. The CLAUDE.md Schema Migration Persistence Contract requires a CI smoke test per migration path; re-route it through the session persistence path (spec §4).

**Files:**
- Modify: `crates/server/tests/integration_v1_workfile_migration.rs`

- [ ] **Step 1: Rewrite the migration pipeline test**

Replace the body of `test_v1_workfile_full_migration_pipeline` (steps 3–5; keep the fixture + load + assertions) so it registers the session + persistence instead of calling `signal_dirty()`:

```rust
    // (3) Construct a ServerState via the migration-aware entry point.
    let migrated_from = loaded.migrated_from;
    let doc_for_session = loaded.document.clone();
    let state = ServerState::new_with_document_and_workfile_migrated(
        loaded.document,
        workfile_path.clone(),
        migrated_from,
    );

    // (4) Spec 22a: register the session + its persistence task with the
    //     migration flag. Registration with `migrated_from = Some(1)` arms the
    //     first save automatically — no signal_dirty() needed.
    let session_id = state
        .app
        .open_session_with(&workfile_path, |_p| {
            Ok::<_, std::convert::Infallible>(doc_for_session)
        })
        .expect("register session");
    let session = state.app.sessions.get(session_id).expect("session present");
    state.persistence.register(session, migrated_from);

    // (5) Wait for the debounce window to elapse + a margin for the write.
    sleep(Duration::from_millis(500 + 300)).await;
```

The remaining assertions (steps 6–8: live v2 manifest, live v2 page, `.backup-v1/` with v1 contents) are unchanged.

- [ ] **Step 2: Rewrite the v2 "no migration" test**

Replace step (construct + wait) in `test_v2_workfile_does_not_trigger_migration` so it registers persistence with `migrated_from = None` (which does NOT arm an initial save) and asserts no `.backup-v1/` appears:

```rust
    // Construct ServerState; register session + persistence with no migration
    // flag — this must NOT arm any save (no mutation broadcast fired).
    let doc_for_session = loaded.document.clone();
    let state = ServerState::new_with_document_and_workfile_migrated(
        loaded.document,
        workfile_path.clone(),
        loaded.migrated_from,
    );
    let session_id = state
        .app
        .open_session_with(&workfile_path, |_p| {
            Ok::<_, std::convert::Infallible>(doc_for_session)
        })
        .expect("register session");
    let session = state.app.sessions.get(session_id).expect("session present");
    state.persistence.register(session, loaded.migrated_from);

    // Wait past the debounce window; no save should have occurred.
    sleep(Duration::from_millis(500 + 200)).await;
```

Remove the now-stale doc-comment lines that reference `signal_dirty()` / "main.rs line 67" at the top of the file and in the test docs; replace with a one-line note that persistence is driven by `SessionPersistence::register`.

- [ ] **Step 3: Run the integration test**

These tests use `block_in_place` indirectly only if the loader is sync — here the loader closure is a trivial `Ok(doc)` (no `load_workfile_sync`), so the default runtime is fine. But `open_session_with`'s loader is sync and trivial; no multi-thread requirement. Run:

Run: `./dev.sh cargo test -p sigil-server --test integration_v1_workfile_migration`
Expected: PASS (both tests).

If `test_v1_workfile_full_migration_pipeline` fails to flush, confirm `register` armed the save (it should, given `migrated_from = Some(1)`), and that the debounce margin (800ms) exceeds `SAVE_DEBOUNCE_MS` (500ms).

- [ ] **Step 4: Commit**

```bash
./dev.sh cargo fmt
git add crates/server/tests/integration_v1_workfile_migration.rs
git commit -m "test(server): drive v1 migration smoke test through per-session persistence (spec-22a)"
```

---

## Task 11: Full quality gate + transport-boundary receipt

**Files:** none (verification only)

- [ ] **Step 1: Full workspace test**

Run: `./dev.sh cargo test --workspace`
Expected: PASS.

- [ ] **Step 2: Clippy pedantic**

Run: `./dev.sh cargo clippy --workspace -- -D warnings`
Expected: no warnings. Likely cleanups: unused imports in `persistence.rs` (the deleted loop's `mpsc`, `sleep`, `JoinHandle`), unused `Mutex` import in `lib.rs` if no longer referenced. Fix any that surface.

- [ ] **Step 3: Format check**

Run: `./dev.sh cargo fmt --check`
Expected: clean.

- [ ] **Step 4: Transport-boundary no-change receipt (spec §7)**

Run and confirm output is as described:

```bash
rg -n 'op_type|applyRemoteOperation' frontend/src/operations/apply-remote.ts   # unchanged — no diff in this PR
rg -n 'spawn_persistence_task' crates/                                          # zero matches (legacy task removed)
git diff --stat main...HEAD -- frontend/                                        # empty — no frontend changes
```

Expected: `spawn_persistence_task` returns **zero** matches; `frontend/` diff is empty; `apply-remote.ts` unchanged. Record these in the PR description as the §7 receipt.

- [ ] **Step 5: Commit any clippy/fmt fixes**

```bash
./dev.sh cargo fmt
git add -p   # stage only the cleanup hunks
git commit -m "chore(server): clippy/fmt cleanup after per-session persistence migration (spec-22a)"
```

---

## Self-Review (completed during plan authoring)

**Spec coverage:**
- §3.1 broadcast-as-dirty-signal → Task 4 `persist_loop` (DocumentEvent/Lagged arm; SessionFatal stops arming; Closed belt-and-suspenders). ✅
- §3.2 one-task-per-session topology, strong `Arc<DocumentSession>`, absolute-deadline debounce → Task 4. ✅
- §3.3 `SessionPersistence` manager, lockstep invariant, close ordering (flush→join→Sessions::close), graceful drain → Tasks 4, 7, 9. ✅
- §3.4 startup swap off legacy task onto per-session task; remove legacy wiring → Tasks 3, 6, 7. ✅
- §3.5 per-session migration flag (force first save + backup), out-of-band capture via loader closure for openSession → Tasks 4 (`force_initial_save`), 5, 8. ✅
- §4 atomic unique-suffix write + concurrency test → Task 1; registry lockstep tests → Task 4; flush-before-close → Tasks 4, 9; migration force-persist+backup → Tasks 4, 10; idempotent recovery (double close) → Task 4. ✅
- §7 transport-boundary receipt → Task 11. ✅

**Placeholder scan:** No "TBD"/"implement later". Every code step shows complete code. Test commands are exact `./dev.sh cargo test ...` invocations with expected pass/fail.

**Type consistency:** `SessionPersistence::register(Arc<DocumentSession>, Option<u32>)`, `close(SessionId)`, `shutdown_all(Duration)`, `len`/`is_registered` — used consistently across Tasks 4, 6–10. `write_prepared_with_migration_flag(PreparedSave, &Path, &MigrationFlag)` defined in Task 3, used in Task 4. `load_workfile_sync_migrated(&Path) -> Result<(Document, Option<u32>)>` defined Task 5, used Task 8. `AppState::new_with_document(Arc<Mutex<SendDocument>>, PathBuf)` defined Task 2, used Task 6. `ServerState { app, persistence }` consistent across Tasks 6–10.

**Cross-task build ordering caveat (called out in-task):** Tasks 3, 6, 7 are mutually dependent for a clean workspace build (deleting legacy APIs in 3/6 breaks `main.rs` until 7). Recommended execution order: 1 → 2 → 3 (struct + persistence.rs) → 4 → 5 → 6 → 7 → run 3's deferred test step → 8 → 9 → 10 → 11. The subagent executing this plan should treat 3/6/7 as a build-coherent group: if committing separately, verify each commit builds, or bundle them.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-29-22a-per-session-persistence.md`.**
