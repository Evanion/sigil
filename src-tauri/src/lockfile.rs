//! PID lockfile management at app_data_dir/server.pid.
//!
//! Used to detect orphan sigil-server processes from previous crashed shells.

// Plan-20 staged delivery: this module is introduced in Task 13 but not wired
// into `run()` until Task 16 (window-close + crash recovery). The allow keeps
// the crate compiling with `-D warnings` until that task lands; remove this
// attribute when the lockfile is read/written from the supervisor path.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};

const LOCKFILE: &str = "server.pid";

pub fn lockfile_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOCKFILE)
}

/// Write `pid` to the lockfile atomically (tmp file + rename in the same dir).
pub fn write(app_data_dir: &Path, pid: u32) -> Result<()> {
    fs::create_dir_all(app_data_dir)
        .with_context(|| format!("create {}", app_data_dir.display()))?;
    let path = lockfile_path(app_data_dir);
    let tmp = path.with_extension("pid.tmp");
    fs::write(&tmp, pid.to_string())
        .with_context(|| format!("write tmp lockfile {}", tmp.display()))?;
    fs::rename(&tmp, &path)
        .with_context(|| format!("rename {} -> {}", tmp.display(), path.display()))?;
    Ok(())
}

/// Read the PID from the lockfile. Returns `None` if the file is missing,
/// unreadable, or contains non-numeric content.
pub fn read(app_data_dir: &Path) -> Option<u32> {
    fs::read_to_string(lockfile_path(app_data_dir))
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Remove the lockfile. Returns `Ok(())` if the file does not exist.
pub fn remove(app_data_dir: &Path) -> Result<()> {
    let path = lockfile_path(app_data_dir);
    if path.exists() {
        fs::remove_file(&path).with_context(|| format!("remove {}", path.display()))?;
    }
    Ok(())
}

/// Check whether a process with the given PID is currently alive.
///
/// On Unix this sends signal 0, which does not deliver a signal and simply
/// checks deliverability (i.e., process existence + permission to signal).
#[cfg(unix)]
pub fn is_pid_alive(pid: u32) -> bool {
    // SAFETY: `libc::kill` with signal 0 has no side effects — it only
    // probes whether the process exists and the caller has permission to
    // signal it. The u32 -> i32 cast is sound because POSIX pids fit in
    // i32 (positive `pid_t`). Return value 0 indicates success; -1 + errno
    // indicates the process does not exist or is unreachable.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

/// Check whether a process with the given PID is currently alive.
///
/// On Windows this shells out to `tasklist /FI "PID eq <pid>"` and inspects
/// the output. This avoids pulling in the `winapi`/`windows` crates for one
/// liveness check.
#[cfg(windows)]
pub fn is_pid_alive(pid: u32) -> bool {
    use std::process::Command;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}")])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_and_read_roundtrip() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), 12_345).unwrap();
        assert_eq!(read(tmp.path()), Some(12_345));
    }

    #[test]
    fn read_missing_returns_none() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(read(tmp.path()), None);
    }

    #[test]
    fn remove_idempotent() {
        let tmp = TempDir::new().unwrap();
        // Missing file: not an error.
        remove(tmp.path()).unwrap();
        write(tmp.path(), 999).unwrap();
        remove(tmp.path()).unwrap();
        assert_eq!(read(tmp.path()), None);
    }

    #[test]
    fn write_overwrites_existing_lockfile() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), 111).unwrap();
        write(tmp.path(), 222).unwrap();
        assert_eq!(read(tmp.path()), Some(222));
    }

    #[test]
    fn read_garbage_returns_none() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path()).unwrap();
        fs::write(lockfile_path(tmp.path()), "not-a-number\n").unwrap();
        assert_eq!(read(tmp.path()), None);
    }

    #[test]
    fn is_pid_alive_for_current_process() {
        let pid = std::process::id();
        assert!(is_pid_alive(pid));
    }

    #[test]
    fn is_pid_alive_for_definitely_dead_pid() {
        // 999_999 is very unlikely to be a live PID on any test machine.
        assert!(!is_pid_alive(999_999));
    }
}
