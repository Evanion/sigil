//! Persist + restore the open-session workfile list across cold launches.
//!
//! Writes the union of currently-open workfile paths to `sessions.json` in
//! the app-data directory whenever a window opens or closes. On the next
//! launch, Task 18's welcome window reads this file to offer a "restore
//! previous session" affordance.
//!
//! Writes use the write-to-temp-then-rename atomic pattern required by
//! CLAUDE.md §4 — a torn write to `sessions.json` on power loss would
//! cause the welcome window to fail-open instead of fail-soft.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

const SESSIONS_FILE: &str = "sessions.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedSessions {
    pub workfiles: Vec<PathBuf>,
}

pub fn path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SESSIONS_FILE)
}

/// Load the persisted session list, pruning entries whose paths no longer
/// exist on disk. Returns an empty list when the file is missing (first
/// launch) or unparseable (logs the parse error so the diagnostic isn't
/// lost). Returning `Default` on parse error is intentional — a corrupt
/// `sessions.json` should not block app launch.
pub fn load(app_data_dir: &Path) -> PersistedSessions {
    let p = path(app_data_dir);
    if !p.exists() {
        return PersistedSessions::default();
    }
    match fs::read_to_string(&p) {
        Ok(s) => match serde_json::from_str::<PersistedSessions>(&s) {
            Ok(parsed) => PersistedSessions {
                workfiles: parsed
                    .workfiles
                    .into_iter()
                    .filter(|p| p.exists())
                    .collect(),
            },
            Err(e) => {
                tracing::warn!("sessions.json parse error: {e}");
                PersistedSessions::default()
            }
        },
        Err(e) => {
            tracing::warn!("sessions.json read error: {e}");
            PersistedSessions::default()
        }
    }
}

/// Persist the session list atomically. Writes to a `.tmp` sibling in the
/// same directory and renames into place — guarantees same-filesystem rename
/// and avoids partial writes on crash or power loss.
///
/// The tmp file uses a unique per-call suffix (UUID) so two concurrent saves
/// cannot clobber each other's tmp content. Without the unique suffix, A's
/// write would be overwritten by B's write before A's rename runs, and B's
/// rename would then fail with ENOENT (RF-003).
pub fn save(app_data_dir: &Path, sessions: &PersistedSessions) -> Result<()> {
    fs::create_dir_all(app_data_dir)
        .with_context(|| format!("create {}", app_data_dir.display()))?;
    let p = path(app_data_dir);
    let tmp = p.with_extension(format!("json.tmp.{}", uuid::Uuid::new_v4().simple()));
    let raw = serde_json::to_string_pretty(sessions)?;
    fs::write(&tmp, raw).with_context(|| format!("write {}", tmp.display()))?;
    // Best-effort cleanup of the tmp on rename failure so we don't leak files
    // when the parent's filesystem rejects the rename (rare; e.g. crossing
    // mount boundaries when app_data_dir is a symlink).
    if let Err(e) =
        fs::rename(&tmp, &p).with_context(|| format!("rename {} -> {}", tmp.display(), p.display()))
    {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn load_empty_when_missing() {
        let tmp = TempDir::new().unwrap();
        assert!(load(tmp.path()).workfiles.is_empty());
    }

    #[test]
    fn save_load_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let wf = tmp.path().join("foo.sigil");
        fs::create_dir(&wf).unwrap();
        save(
            tmp.path(),
            &PersistedSessions {
                workfiles: vec![wf.clone()],
            },
        )
        .unwrap();
        let loaded = load(tmp.path());
        assert_eq!(loaded.workfiles, vec![wf]);
    }

    #[test]
    fn concurrent_saves_do_not_clobber_tmp() {
        // RF-003: tmp file uses a unique per-call suffix so two concurrent
        // saves cannot race on `sessions.json.tmp`. We verify by spawning N
        // threads that each save and asserting all of them succeed (i.e.
        // none returns the "rename ENOENT" error from a clobbered tmp).
        let tmp = TempDir::new().unwrap();
        let wf = tmp.path().join("foo.sigil");
        fs::create_dir(&wf).unwrap();
        let tmp_path = tmp.path().to_path_buf();
        let mut handles = Vec::new();
        for i in 0..10 {
            let dir = tmp_path.clone();
            let workfile = wf.clone();
            handles.push(std::thread::spawn(move || {
                save(
                    &dir,
                    &PersistedSessions {
                        workfiles: vec![workfile],
                    },
                )
                .unwrap_or_else(|e| panic!("thread {i} save failed: {e}"));
            }));
        }
        for h in handles {
            h.join().expect("thread panicked");
        }
        // The final file is well-formed.
        let loaded = load(tmp.path());
        assert_eq!(loaded.workfiles, vec![wf]);
        // No tmp files leaked.
        let leftover_tmps = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("sessions.json.tmp.")
            })
            .count();
        assert_eq!(leftover_tmps, 0, "tmp files leaked after concurrent saves");
    }

    #[test]
    fn load_prunes_missing_paths() {
        let tmp = TempDir::new().unwrap();
        let wf = tmp.path().join("ghost.sigil");
        fs::create_dir(&wf).unwrap();
        save(
            tmp.path(),
            &PersistedSessions {
                workfiles: vec![wf.clone()],
            },
        )
        .unwrap();
        fs::remove_dir_all(&wf).unwrap();
        assert!(load(tmp.path()).workfiles.is_empty());
    }
}
