//! Recent-workfile-paths persistence.
//!
//! Persists a small JSON list (`recent.json`) of recently opened workfile
//! paths in Tauri's app-data directory. The list is capped at
//! `MAX_RECENT_ENTRIES`, deduplicated by path on insert (most-recent-first),
//! and pruned of missing paths at load time so stale references don't leak
//! into the UI.
//!
//! Writes go through a write-to-temp-then-rename atomic pattern (matches
//! CLAUDE.md §4 for the server crate — the same safety rationale applies
//! here: a torn write to `recent.json` on power loss would leave the menu
//! UI parsing garbage on next launch).

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

const MAX_RECENT_ENTRIES: usize = 10;
const RECENT_FILENAME: &str = "recent.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentEntry {
    pub path: PathBuf,
    /// Opaque ordering hint; format is `@<unix-seconds>`. Not RFC3339 — a
    /// future task may upgrade if the UI starts displaying timestamps.
    pub opened_at: String,
}

/// Load the recent-workfiles list, pruning entries whose paths no longer
/// exist on disk. Returns an empty `Vec` when the file is missing (first
/// launch). Surfaces parse / IO errors so callers can decide whether to
/// fall back to empty (the Tauri command does).
pub fn load(app_data_dir: &Path) -> Result<Vec<RecentEntry>> {
    let path = app_data_dir.join(RECENT_FILENAME);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let entries: Vec<RecentEntry> =
        serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    Ok(entries.into_iter().filter(|e| e.path.exists()).collect())
}

/// Record `workfile` as the most-recent entry. Creates `app_data_dir` if
/// it does not exist, dedupes any prior entry for the same path, truncates
/// to `MAX_RECENT_ENTRIES`, and persists atomically (write-to-temp + rename
/// in the same directory).
pub fn add(app_data_dir: &Path, workfile: &Path) -> Result<()> {
    fs::create_dir_all(app_data_dir)
        .with_context(|| format!("create {}", app_data_dir.display()))?;

    let mut entries = load(app_data_dir).unwrap_or_default();
    entries.retain(|e| e.path != workfile);
    entries.insert(
        0,
        RecentEntry {
            path: workfile.to_path_buf(),
            opened_at: timestamp_now(),
        },
    );
    entries.truncate(MAX_RECENT_ENTRIES);

    let final_path = app_data_dir.join(RECENT_FILENAME);
    let tmp_path = app_data_dir.join(format!("{RECENT_FILENAME}.tmp"));
    let raw = serde_json::to_string_pretty(&entries)?;
    fs::write(&tmp_path, raw).with_context(|| format!("write {}", tmp_path.display()))?;
    fs::rename(&tmp_path, &final_path)
        .with_context(|| format!("rename {} -> {}", tmp_path.display(), final_path.display()))?;
    Ok(())
}

fn timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("@{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_empty_when_file_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load(tmp.path()).unwrap().is_empty());
    }

    #[test]
    fn test_add_creates_file_and_persists() {
        let tmp = tempfile::tempdir().unwrap();
        let workfile = tmp.path().join("foo.sigil");
        fs::create_dir_all(&workfile).unwrap();
        add(tmp.path(), &workfile).unwrap();
        let entries = load(tmp.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, workfile);
    }

    #[test]
    fn test_add_dedups_same_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workfile = tmp.path().join("foo.sigil");
        fs::create_dir_all(&workfile).unwrap();
        add(tmp.path(), &workfile).unwrap();
        add(tmp.path(), &workfile).unwrap();
        assert_eq!(load(tmp.path()).unwrap().len(), 1);
    }

    #[test]
    fn test_add_truncates_to_max() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..15 {
            let workfile = tmp.path().join(format!("foo-{i}.sigil"));
            fs::create_dir_all(&workfile).unwrap();
            add(tmp.path(), &workfile).unwrap();
        }
        assert_eq!(load(tmp.path()).unwrap().len(), MAX_RECENT_ENTRIES);
    }

    #[test]
    fn test_load_prunes_missing_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let workfile = tmp.path().join("ghost.sigil");
        fs::create_dir_all(&workfile).unwrap();
        add(tmp.path(), &workfile).unwrap();
        fs::remove_dir_all(&workfile).unwrap();
        assert!(load(tmp.path()).unwrap().is_empty());
    }
}
