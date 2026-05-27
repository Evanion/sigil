//! `sigil-cli migrate` — runs the v1 → v2 workfile migration against an
//! on-disk `.sigil/` directory and reports per-page success/error.
//!
//! See `docs/superpowers/specs/2026-04-23-14-corner-shapes.md` §5 for the
//! v1 → v2 schema change this command exercises.
//!
//! # Flow
//!
//! 1. Validate that `<path>` is an existing directory containing
//!    `manifest.json`. Return an error otherwise.
//! 2. Read `manifest.json`. If `schema_version` already matches
//!    [`sigil_core::CURRENT_SCHEMA_VERSION`], print "already at vN"
//!    and return success without touching disk.
//! 3. Walk `<path>/pages/*.json`, parse each as `serde_json::Value`, and
//!    invoke [`sigil_core::migrations::migrate_to_v2`].
//!    - In **default** mode: before any overwrite, copy v1 originals to
//!      `<path>/.backup-v1/` (skipped if the backup directory already
//!      exists, mirroring the server's RF-010 one-shot pattern). Migrated
//!      content is then written back via the atomic
//!      write-to-temp-then-rename pattern.
//!    - In **check** mode: only report whether migration succeeds. No
//!      writes occur, no backup is created.
//! 4. After all pages migrate successfully (default mode only), update the
//!    manifest's `schema_version` to the current value and atomically
//!    rewrite `manifest.json`.
//! 5. On any per-page failure: do not update the manifest, leave whatever
//!    backup was already created in place, and return a non-zero result.
//!
//! # Backup layout
//!
//! ```text
//! <path>/
//! ├── manifest.json          # v1, then v2 after migration
//! ├── pages/                 # v1, then v2 after migration
//! │   └── <uuid>.json
//! └── .backup-v1/            # immutable v1 snapshot, written once
//!     ├── manifest.json
//!     └── pages/<uuid>.json
//! ```
//!
//! # Exit-code contract
//!
//! - `0` — all pages migrated successfully (or workfile was already at the
//!   current schema). In `--check` mode this means migration would succeed
//!   without writing anything.
//! - non-zero — at least one page failed to migrate, or the workfile is not
//!   a valid `.sigil/` directory. The binary maps any non-`Ok` return from
//!   [`run`] to a non-zero process exit.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use serde_json::Value;

/// Filename of the workfile manifest, mirrored from `crates/server/src/workfile.rs`.
const MANIFEST_FILENAME: &str = "manifest.json";

/// Subdirectory holding migrated pages, mirrored from `crates/server/src/workfile.rs`.
const PAGES_DIRNAME: &str = "pages";

/// Subdirectory used to snapshot pre-migration (v1) files, matching the
/// server's RF-010 one-shot backup convention.
const BACKUP_DIR_NAME: &str = ".backup-v1";

/// Outcome of a single `run` invocation.
///
/// The CLI binary uses [`Self::had_failures`] to decide its process exit
/// code; tests inspect the per-page counters directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MigrateOutcome {
    /// Number of pages that migrated successfully (0 if already at the
    /// current schema, or in `--check` mode when no writes are performed).
    pub migrated: usize,
    /// Number of pages that failed to migrate.
    pub failed: usize,
    /// True if the workfile was already at the current schema version.
    pub already_current: bool,
}

impl MigrateOutcome {
    /// Returns true if any per-page migration failed. Drives the CLI exit
    /// code.
    #[must_use]
    pub fn had_failures(&self) -> bool {
        self.failed > 0
    }
}

/// Runs the migrate subcommand against `path`.
///
/// When `check` is true, no files on disk are modified — the function only
/// reports whether each page would migrate successfully. When `check` is
/// false, successful page migrations are persisted (with a one-shot
/// `.backup-v1/` snapshot of the originals) and the manifest's
/// `schema_version` is bumped after all pages succeed.
///
/// # Errors
///
/// Returns an error if:
/// - `path` is not an existing directory.
/// - `path/manifest.json` is missing or unreadable.
/// - The manifest cannot be parsed as JSON.
/// - The manifest's `schema_version` is newer than this build supports.
/// - Reading the `pages/` directory fails.
///
/// Per-page parse and migration failures are *not* returned as errors —
/// they are reported on the writer and counted in the returned
/// [`MigrateOutcome`]. Callers detect them via
/// [`MigrateOutcome::had_failures`].
pub fn run<W: std::io::Write>(path: &Path, check: bool, mut out: W) -> Result<MigrateOutcome> {
    let target_version = sigil_core::CURRENT_SCHEMA_VERSION;
    let LoadedManifest {
        manifest_path,
        mut manifest,
        manifest_text,
        current_version,
    } = load_manifest(path, target_version)?;

    if current_version == u64::from(target_version) {
        writeln!(out, "Already at v{target_version}; no migration needed.")?;
        return Ok(MigrateOutcome {
            migrated: 0,
            failed: 0,
            already_current: true,
        });
    }

    let pages_dir = path.join(PAGES_DIRNAME);
    let page_files = collect_page_files(&pages_dir)?;

    let MigrationPass {
        migrated_files,
        migrated_count,
        failed_count,
    } = migrate_pages(&page_files, target_version, &mut out)?;

    if check {
        writeln!(
            out,
            "Check mode: {migrated_count} pages would migrate, {failed_count} failures. No files written."
        )?;
        return Ok(MigrateOutcome {
            migrated: 0,
            failed: failed_count,
            already_current: false,
        });
    }

    if failed_count > 0 {
        writeln!(
            out,
            "Aborted: {failed_count} page(s) failed to migrate; manifest left at v{current_version}."
        )?;
        return Ok(MigrateOutcome {
            migrated: 0,
            failed: failed_count,
            already_current: false,
        });
    }

    // All pages migrated cleanly — back up originals once, then write
    // migrated content and bump the manifest.
    commit_migration(
        path,
        &manifest_path,
        &mut manifest,
        &manifest_text,
        &page_files,
        &migrated_files,
        target_version,
    )?;

    writeln!(
        out,
        "Migrated {migrated_count} pages, {failed_count} failures. Manifest updated to v{target_version}."
    )?;

    Ok(MigrateOutcome {
        migrated: migrated_count,
        failed: failed_count,
        already_current: false,
    })
}

/// Result of [`load_manifest`]: validated manifest contents plus its
/// originating path.
struct LoadedManifest {
    manifest_path: PathBuf,
    manifest: Value,
    manifest_text: String,
    current_version: u64,
}

/// Reads, parses, and validates the workfile manifest. Errors out when the
/// path is not a directory, the manifest is missing or malformed, or the
/// on-disk `schema_version` is newer than this build supports.
fn load_manifest(path: &Path, target_version: u32) -> Result<LoadedManifest> {
    if !path.is_dir() {
        bail!(
            "workfile path is not a directory: {path}",
            path = path.display()
        );
    }
    let manifest_path = path.join(MANIFEST_FILENAME);
    if !manifest_path.is_file() {
        bail!(
            "missing manifest.json under workfile path: {path}",
            path = path.display()
        );
    }
    let manifest_text = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    let manifest: Value = serde_json::from_str(&manifest_text)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    let current_version = manifest
        .get("schema_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            anyhow!(
                "manifest at {} is missing a numeric `schema_version` field",
                manifest_path.display()
            )
        })?;
    if current_version > u64::from(target_version) {
        bail!(
            "workfile schema_version {current_version} is newer than this build's CURRENT_SCHEMA_VERSION {target_version}; refusing to downgrade"
        );
    }
    Ok(LoadedManifest {
        manifest_path,
        manifest,
        manifest_text,
        current_version,
    })
}

/// Result of [`migrate_pages`]: in-memory migrated bytes plus per-page counters.
struct MigrationPass {
    migrated_files: Vec<(PathBuf, String)>,
    migrated_count: usize,
    failed_count: usize,
}

/// First pass: parse and migrate each page in memory. The migrated bytes
/// are accumulated so that, in default mode, the backup + write phase only
/// runs after every page has migrated successfully. This preserves the
/// "all pages succeed before the manifest is bumped" contract — a failure
/// in page K must not leave pages 0..K rewritten while the manifest still
/// claims v1.
fn migrate_pages<W: std::io::Write>(
    page_files: &[PathBuf],
    target_version: u32,
    out: &mut W,
) -> Result<MigrationPass> {
    let mut migrated_files: Vec<(PathBuf, String)> = Vec::with_capacity(page_files.len());
    let mut migrated_count = 0usize;
    let mut failed_count = 0usize;
    for page_path in page_files {
        let filename = page_path.file_name().map_or_else(
            || page_path.display().to_string(),
            |s| s.to_string_lossy().into_owned(),
        );
        match migrate_page_file(page_path) {
            Ok(json) => {
                writeln!(out, "  ok  {filename} migrated (v1 -> v{target_version})")?;
                migrated_files.push((page_path.clone(), json));
                migrated_count += 1;
            }
            Err(err) => {
                writeln!(out, "  err {filename} failed: {err:#}")?;
                failed_count += 1;
            }
        }
    }
    Ok(MigrationPass {
        migrated_files,
        migrated_count,
        failed_count,
    })
}

/// Commits a clean migration to disk: backs up originals once, writes
/// every migrated page atomically, then atomically rewrites the manifest
/// with the bumped `schema_version`.
fn commit_migration(
    workfile: &Path,
    manifest_path: &Path,
    manifest: &mut Value,
    manifest_text: &str,
    page_files: &[PathBuf],
    migrated_files: &[(PathBuf, String)],
    target_version: u32,
) -> Result<()> {
    backup_v1_files(workfile, page_files, manifest_text)?;
    for (page_path, json) in migrated_files {
        atomic_write(page_path, json)?;
    }
    let Some(obj) = manifest.as_object_mut() else {
        bail!(
            "manifest at {} is not a JSON object",
            manifest_path.display()
        );
    };
    obj.insert(
        "schema_version".to_string(),
        Value::Number(serde_json::Number::from(target_version)),
    );
    let new_manifest =
        serde_json::to_string_pretty(manifest).context("failed to serialize updated manifest")?;
    atomic_write(manifest_path, &new_manifest)?;
    Ok(())
}

/// Returns the list of page JSON files under `<workfile>/pages/`.
///
/// Non-JSON entries are skipped. Subdirectories are not recursed.
fn collect_page_files(pages_dir: &Path) -> Result<Vec<PathBuf>> {
    if !pages_dir.is_dir() {
        // No pages directory means an empty (but valid) workfile.
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let read = fs::read_dir(pages_dir)
        .with_context(|| format!("failed to read pages dir: {}", pages_dir.display()))?;
    for entry in read {
        let entry = entry
            .with_context(|| format!("failed to enumerate pages dir: {}", pages_dir.display()))?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|e| e == "json") {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

/// Reads, parses, and migrates a single page JSON file.
///
/// Returns the migrated page as pretty-printed JSON ready to be written
/// back to disk. The on-disk file is not modified.
fn migrate_page_file(page_path: &Path) -> Result<String> {
    let text = fs::read_to_string(page_path)
        .with_context(|| format!("failed to read {}", page_path.display()))?;
    let value: Value = serde_json::from_str(&text)
        .with_context(|| format!("failed to parse {}", page_path.display()))?;
    let migrated = sigil_core::migrations::migrate_to_v2(value)
        .with_context(|| format!("migration failed for {}", page_path.display()))?;
    let out =
        serde_json::to_string_pretty(&migrated).context("failed to serialize migrated page")?;
    Ok(out)
}

/// Copies the current manifest and pages into `<path>/.backup-v1/`.
///
/// One-shot: if the backup directory already exists, this function returns
/// `Ok(())` without modifying it (mirrors the server's RF-010 invariant
/// that the v1 snapshot is written exactly once).
fn backup_v1_files(workfile: &Path, page_files: &[PathBuf], manifest_text: &str) -> Result<()> {
    let backup_root = workfile.join(BACKUP_DIR_NAME);
    if backup_root.exists() {
        return Ok(());
    }
    let backup_pages = backup_root.join(PAGES_DIRNAME);
    fs::create_dir_all(&backup_pages).with_context(|| {
        format!(
            "failed to create backup directory: {}",
            backup_pages.display()
        )
    })?;
    atomic_write(&backup_root.join(MANIFEST_FILENAME), manifest_text)?;
    for src in page_files {
        let filename = src
            .file_name()
            .ok_or_else(|| anyhow!("page path has no filename: {}", src.display()))?;
        let original = fs::read_to_string(src)
            .with_context(|| format!("failed to read for backup: {}", src.display()))?;
        atomic_write(&backup_pages.join(filename), &original)?;
    }
    Ok(())
}

/// Atomic write: write to `<target>.tmp` in the same directory, then
/// `rename` into place. Mirrors the server's persistence pattern.
fn atomic_write(target: &Path, content: &str) -> Result<()> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("target path has no parent directory: {}", target.display()))?;
    let tmp = if let Some(stem) = target.file_name() {
        let mut name = stem.to_os_string();
        name.push(".tmp");
        parent.join(name)
    } else {
        bail!("target path has no filename: {}", target.display());
    };
    fs::write(&tmp, content)
        .with_context(|| format!("failed to write temp file: {}", tmp.display()))?;
    fs::rename(&tmp, target)
        .with_context(|| format!("failed to rename {} -> {}", tmp.display(), target.display()))?;
    Ok(())
}
