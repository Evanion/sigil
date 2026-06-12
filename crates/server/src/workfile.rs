//! Workfile I/O — reading and writing `.sigil/` directory structures.
//!
//! A workfile is a directory with the `.sigil/` suffix containing:
//! - `manifest.json` — document metadata and page ordering
//! - `pages/*.json` — individual page files (serialized via core's serialize API)
//! - `fonts/*.ttf` — embedded custom font binaries, keyed by asset UUID
//!
//! The save path is split into two phases to avoid holding a `std::sync::Mutex`
//! across async `.await` points:
//!
//! 1. [`prepare_save`] — synchronous, runs under the document lock, produces
//!    a [`PreparedSave`] containing all serialized JSON strings.
//! 2. [`write_prepared_save`] — async, writes the prepared data to disk.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sigil_core::serialize::{
    SerializedPage, deserialize_page_with_version_and_fonts, page_to_serialized, serialize_page,
};
use sigil_core::{
    DEFAULT_FONT_ENTRY_ID, Document, FontEntry, FontSource, Node, NodeId, Page, PageId,
    build_system_reference_entry,
};
use uuid::Uuid;

/// Maximum manifest file size (1 MiB).
const MAX_MANIFEST_SIZE: u64 = 1_048_576;

/// Maximum page file size (50 MiB — matches core's `MAX_FILE_SIZE`).
const MAX_PAGE_FILE_SIZE: u64 = 52_428_800;

/// Maximum manifest name length.
const MAX_MANIFEST_NAME_LEN: usize = 512;

/// The workfile manifest — stored as `manifest.json` in the `.sigil/` root.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: u32,
    pub name: String,
    pub page_order: Vec<Uuid>,
    /// Asset UUIDs of embedded custom fonts stored in `fonts/<uuid>.ttf`.
    ///
    /// This is a co-computed **denormalized index** derived from [`Self::fonts`]:
    /// it contains only the UUIDs of `Custom`-sourced entries that have on-disk
    /// bytes. It exists for fast disk↔manifest validation at load time (checking
    /// which `.ttf` files are expected) without iterating the full `fonts` array.
    ///
    /// `#[serde(default)]` ensures manifests written before this field existed
    /// (pre-fonts-1) still deserialize without error — backward compatible.
    ///
    /// **Invariant:** `font_assets` and `fonts` are always computed together in
    /// [`prepare_save`] so they cannot diverge — `font_assets` is exactly the
    /// set of asset UUIDs for `Custom`-sourced entries in `fonts` whose bytes
    /// were available in the byte store at save time.
    #[serde(default)]
    pub font_assets: Vec<Uuid>,
    /// Full font-table records for all entries in the document's font table,
    /// **excluding** the bundled default entry (`DEFAULT_FONT_ENTRY_ID`).
    ///
    /// The default entry is seeded by [`Document::new`] on every load, so
    /// persisting it would cause a duplicate-id error during reconstruction.
    /// All other entries — both `SystemReference` and `Custom` — are persisted
    /// here so that they survive a save→load round-trip, including entries that
    /// have no on-disk bytes (e.g., `SystemReference` fonts, or `Custom` fonts
    /// uploaded in this session but not yet flushed to `fonts/<uuid>.ttf`).
    ///
    /// `#[serde(default)]` ensures older manifests (before this field was added)
    /// deserialize without error — the table starts with only the default entry
    /// on load from a legacy workfile.
    #[serde(default)]
    pub fonts: Vec<FontEntry>,
}

impl Manifest {
    /// Creates a manifest from the current document state.
    ///
    /// `font_assets` is left empty here; [`prepare_save`] populates it from
    /// the byte map after consulting `doc.font_table()`.
    ///
    /// `fonts` is populated with every font-table entry **except** the bundled
    /// default (`DEFAULT_FONT_ENTRY_ID`). The default is seeded by
    /// [`Document::new`] on load, so persisting it would cause a duplicate-id
    /// error during reconstruction (see [`load_workfile`]).
    #[must_use]
    pub fn from_document(doc: &Document) -> Self {
        // Collect all non-default font entries in a single pass.
        // `font_assets` is populated later by `prepare_save` after the byte map
        // is consulted, but `fonts` is already complete at this point.
        let fonts: Vec<FontEntry> = doc
            .font_table()
            .iter()
            .filter(|e| e.id() != DEFAULT_FONT_ENTRY_ID)
            .cloned()
            .collect();

        Self {
            schema_version: sigil_core::CURRENT_SCHEMA_VERSION,
            name: doc.metadata.name.clone(),
            page_order: doc.pages.iter().map(|p| p.id.uuid()).collect(),
            font_assets: Vec::new(),
            fonts,
        }
    }

    /// Validates manifest fields after deserialization.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - `name` exceeds [`MAX_MANIFEST_NAME_LEN`] bytes
    /// - `page_order` exceeds [`MAX_PAGES_PER_DOCUMENT`](sigil_core::MAX_PAGES_PER_DOCUMENT)
    /// - `page_order` contains duplicate UUIDs
    /// - `font_assets` exceeds [`MAX_FONTS_PER_DOCUMENT`](sigil_core::MAX_FONTS_PER_DOCUMENT)
    /// - `font_assets` contains duplicate UUIDs
    /// - `fonts` has `MAX_FONTS_PER_DOCUMENT` or more entries (the default entry
    ///   occupies one slot and is not stored in `fonts`, so the manifest can hold
    ///   at most `MAX_FONTS_PER_DOCUMENT - 1` non-default entries)
    /// - `fonts` contains entries with duplicate IDs
    pub fn validate(&self) -> Result<()> {
        if self.name.len() > MAX_MANIFEST_NAME_LEN {
            bail!(
                "manifest name exceeds maximum length ({} > {MAX_MANIFEST_NAME_LEN})",
                self.name.len()
            );
        }

        if self.page_order.len() > sigil_core::MAX_PAGES_PER_DOCUMENT {
            bail!(
                "manifest page_order exceeds maximum pages ({} > {})",
                self.page_order.len(),
                sigil_core::MAX_PAGES_PER_DOCUMENT
            );
        }

        let mut seen = HashSet::with_capacity(self.page_order.len());
        for uuid in &self.page_order {
            if !seen.insert(uuid) {
                bail!("duplicate UUID in manifest page_order: {uuid}");
            }
        }

        // `font_assets` ⊆ `fonts` (Custom entries only), so its count is bounded
        // by the same cap. The `>= MAX` bound matches the `fonts` check below:
        // a non-default entry count of MAX would overflow the document table
        // once the bundled default entry is added on load.
        if self.font_assets.len() >= sigil_core::MAX_FONTS_PER_DOCUMENT {
            bail!(
                "manifest font_assets exceeds maximum fonts ({} >= {})",
                self.font_assets.len(),
                sigil_core::MAX_FONTS_PER_DOCUMENT
            );
        }

        let mut seen_font_assets = HashSet::with_capacity(self.font_assets.len());
        for uuid in &self.font_assets {
            if !seen_font_assets.insert(uuid) {
                bail!("duplicate UUID in manifest font_assets: {uuid}");
            }
        }

        // `fonts` carries the full FontEntry records; validate cap and uniqueness.
        //
        // `Document::new` always seeds one bundled default entry
        // (`DEFAULT_FONT_ENTRY_ID`) which is NOT stored in `fonts` but IS
        // present in the live document after load. On load we call
        // `FontTable::add` once for each entry in `fonts`, which enforces the
        // `MAX_FONTS_PER_DOCUMENT` cap across the full table (default + manifest
        // entries). If `fonts.len() == MAX_FONTS_PER_DOCUMENT`, the `add` for
        // the first entry would succeed (capacity = 1 + 0 ≤ cap), but the table
        // would already hold the default, making total = 1 + MAX, which exceeds
        // the cap. Reject at `>= MAX_FONTS_PER_DOCUMENT` so the manifest can
        // carry at most `MAX_FONTS_PER_DOCUMENT - 1` non-default entries
        // (1 default + MAX-1 manifest = MAX = cap, exactly at limit).
        if self.fonts.len() >= sigil_core::MAX_FONTS_PER_DOCUMENT {
            bail!(
                "manifest fonts exceeds maximum fonts ({} >= {}); \
                 the bundled default entry occupies one slot, so at most {} \
                 non-default entries are allowed",
                self.fonts.len(),
                sigil_core::MAX_FONTS_PER_DOCUMENT,
                sigil_core::MAX_FONTS_PER_DOCUMENT - 1,
            );
        }

        let mut seen_font_ids = HashSet::with_capacity(self.fonts.len());
        for entry in &self.fonts {
            if !seen_font_ids.insert(entry.id()) {
                bail!("duplicate id in manifest fonts: {}", entry.id());
            }
        }

        Ok(())
    }
}

/// Pre-serialized document data ready to be written to disk.
///
/// Created synchronously under the document lock so that the async file
/// writes happen *after* the lock is released.
#[derive(Debug)]
pub struct PreparedSave {
    /// Serialized `manifest.json` content.
    pub manifest_json: String,
    /// Pairs of `(filename, serialized_page_json)` for each page.
    pub pages: Vec<(String, String)>,
    /// Embedded custom font bytes to write: `(asset_uuid, raw_bytes)`.
    ///
    /// Each entry is written to `fonts/<uuid>.ttf` via [`atomic_write_bytes`].
    /// The UUIDs here are the same set as `manifest.font_assets` — they are
    /// derived together in [`prepare_save`] to guarantee consistency.
    pub font_assets: Vec<(Uuid, Vec<u8>)>,
    /// When `Some(v)`, this save is the first persisted write after a v→current
    /// schema migration on load. Set by the persistence task from the migration
    /// flag (RF-009) so writers can apply migration-specific behavior on the
    /// first save. Cleared by the persistence task once the save completes.
    pub migrated_from: Option<u32>,
}

/// Result of loading a workfile from disk.
///
/// Carries the in-memory [`Document`] along with a flag indicating whether
/// the on-disk files required a schema migration. When migration occurred,
/// the server signals the persistence task that the document is dirty so the
/// migrated form is written back to disk (RF-009).
#[derive(Debug)]
pub struct LoadedWorkfile {
    /// The document reconstructed from the workfile.
    pub document: Document,
    /// Embedded custom font bytes read from `fonts/<uuid>.ttf` on disk.
    ///
    /// Keyed by asset UUID. Only fonts whose UUID is present in
    /// `manifest.font_assets` AND whose on-disk file passes size validation
    /// are loaded. Orphan files (on disk but absent from the manifest) and
    /// oversized files are skipped with `tracing::warn!`.
    ///
    /// Callers (server's `load_workfile_into_state`) must move this map into
    /// `DocumentSession.font_bytes` after opening the session.
    pub font_bytes: HashMap<Uuid, Vec<u8>>,
    /// `Some(v)` if any page on disk was at schema version `v < CURRENT_SCHEMA_VERSION`
    /// and required migration. `None` if all pages were already at the current version.
    pub migrated_from: Option<u32>,
}

/// Synchronously serializes the document into a [`PreparedSave`].
///
/// `font_bytes` supplies the raw bytes for any `Custom`-sourced fonts in the
/// document's font table. The function iterates `doc.font_table()` and for
/// each entry whose source is `FontSource::Custom { asset_uuid }`:
/// - If `font_bytes` contains an entry for that UUID, the bytes are included in
///   both the manifest's `font_assets` list and `PreparedSave.font_assets`.
/// - If the bytes are absent, a warning is logged and the entry is skipped
///   (degraded but non-fatal — font will not be embedded on this save).
///
/// The `manifest.font_assets` and `PreparedSave.font_assets` UUID sets are
/// always derived together, guaranteeing they refer to exactly the same files.
///
/// This function does no I/O and is safe to call while holding a
/// `std::sync::Mutex` guard.
///
/// # Errors
///
/// Returns an error if JSON serialization of the manifest or any page fails.
pub fn prepare_save<S: std::hash::BuildHasher>(
    doc: &Document,
    font_bytes: &HashMap<Uuid, Vec<u8>, S>,
) -> Result<PreparedSave> {
    let mut manifest = Manifest::from_document(doc);

    // Build the embedded-font list in a single pass over the font table.
    // Both the manifest's `font_assets` id list and the PreparedSave pairs list
    // are populated here to guarantee they are always the same set.
    let mut font_asset_ids: Vec<Uuid> = Vec::new();
    let mut font_asset_pairs: Vec<(Uuid, Vec<u8>)> = Vec::new();

    for entry in doc.font_table().iter() {
        if let FontSource::Custom { asset_uuid } = entry.source() {
            match font_bytes.get(asset_uuid) {
                Some(bytes) => {
                    font_asset_ids.push(*asset_uuid);
                    font_asset_pairs.push((*asset_uuid, bytes.clone()));
                }
                None => {
                    // Degraded, non-fatal: log and skip. The font will not be
                    // written to disk on this save. Task 11 threads the session
                    // byte store through this path; until then this is expected
                    // for any Custom entries added before that task ships.
                    tracing::warn!(
                        "embedded Custom font '{}' ({}) has no bytes in the byte store; \
                         skipping — not persisted on this save",
                        entry.family(),
                        entry.id()
                    );
                }
            }
        }
    }

    // Assign after from_document so the field is populated from the byte map.
    manifest.font_assets = font_asset_ids;

    let manifest_json = serde_json::to_string_pretty(&manifest)?;

    let mut pages = Vec::with_capacity(doc.pages.len());
    for page in &doc.pages {
        let serialized = page_to_serialized(page, &doc.arena, &doc.transitions)
            .map_err(|e| anyhow::anyhow!("failed to serialize page '{}': {e}", page.name))?;
        let json = serialize_page(&serialized)
            .map_err(|e| anyhow::anyhow!("failed to serialize page '{}': {e}", page.name))?;
        let filename = page.id.uuid().to_string();
        pages.push((filename, json));
    }

    Ok(PreparedSave {
        manifest_json,
        pages,
        font_assets: font_asset_pairs,
        migrated_from: None,
    })
}

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
        return Err(e)
            .with_context(|| format!("failed to rename temp file to: {}", path.display()));
    }
    Ok(())
}

/// Atomically writes binary content to a file by writing to a uniquely-named
/// temp sibling first, then renaming into place.
///
/// Mirrors [`atomic_write`] but accepts `&[u8]` instead of `&str` so that
/// binary font assets can be written without lossy UTF-8 conversion.
///
/// The temp filename carries a per-call UUID suffix so concurrent writers to
/// the same target never collide on the temp path (rust-defensive
/// "Filesystem Writes Must Be Atomic"). The rename is the atomic commit point.
///
/// # Errors
///
/// Returns an error if the write or rename fails. On rename failure the temp
/// file is best-effort removed so a failed write does not leak temp files.
async fn atomic_write_bytes(path: &Path, content: &[u8]) -> Result<()> {
    let tmp_path = path.with_extension(format!("ttf.tmp.{}", Uuid::new_v4().simple()));
    tokio::fs::write(&tmp_path, content)
        .await
        .with_context(|| format!("failed to write temp file: {}", tmp_path.display()))?;
    if let Err(e) = tokio::fs::rename(&tmp_path, path).await {
        // Best-effort cleanup: leaving a stray .tmp.<uuid> is a leak. We log at
        // debug because the rename error below is the actionable failure.
        if let Err(rm) = tokio::fs::remove_file(&tmp_path).await {
            tracing::debug!("failed to clean up temp file {}: {rm}", tmp_path.display());
        }
        return Err(e)
            .with_context(|| format!("failed to rename temp file to: {}", path.display()));
    }
    Ok(())
}

/// Backs up the current `manifest.json` and `pages/*.json` files to
/// `.backup-v{original_version}/` before they are overwritten by a migrated
/// save (RF-010, CLAUDE.md §4 "Schema Migration Persistence Contract").
///
/// The backup directory name is derived dynamically from the source schema
/// version so that v1→v3 produces `.backup-v1` and v2→v3 produces `.backup-v2`.
///
/// This is a one-shot operation: the function is a no-op if the backup directory
/// already exists, ensuring we never overwrite the original pre-migration
/// snapshot. Each file is copied via the atomic write-to-temp-then-rename
/// pattern to prevent partially-written backups on crash.
///
/// # Errors
///
/// Returns an error if reading the source files fails or writing the backup
/// fails. Errors from this function abort the save so the migration flag stays
/// armed for the next attempt.
async fn backup_pre_migration_files(workfile_path: &Path, original_version: u32) -> Result<()> {
    let backup_dir_name = format!(".backup-v{original_version}");
    let backup_root = workfile_path.join(&backup_dir_name);

    // Idempotent: if a previous backup exists, leave it alone.
    if tokio::fs::metadata(&backup_root).await.is_ok() {
        tracing::debug!(
            "backup directory already exists, skipping: {}",
            backup_root.display()
        );
        return Ok(());
    }

    let backup_pages_dir = backup_root.join("pages");
    tokio::fs::create_dir_all(&backup_pages_dir)
        .await
        .with_context(|| {
            format!(
                "failed to create backup directory: {}",
                backup_pages_dir.display()
            )
        })?;

    // Back up manifest.json if it exists.
    let manifest_src = workfile_path.join("manifest.json");
    if tokio::fs::metadata(&manifest_src).await.is_ok() {
        let manifest_content = tokio::fs::read_to_string(&manifest_src)
            .await
            .with_context(|| {
                format!(
                    "failed to read manifest for backup: {}",
                    manifest_src.display()
                )
            })?;
        atomic_write(&backup_root.join("manifest.json"), &manifest_content).await?;
    }

    // Back up each existing page file.
    let pages_src_dir = workfile_path.join("pages");
    if tokio::fs::metadata(&pages_src_dir).await.is_ok() {
        let mut entries = tokio::fs::read_dir(&pages_src_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json")
                && let Some(name) = path.file_name().and_then(|n| n.to_str())
            {
                let content = tokio::fs::read_to_string(&path).await.with_context(|| {
                    format!("failed to read page for backup: {}", path.display())
                })?;
                atomic_write(&backup_pages_dir.join(name), &content).await?;
            }
        }
    }

    tracing::info!(
        "backed up v{original_version} workfile to {} before first migrated save",
        backup_root.display()
    );

    Ok(())
}

/// Writes a [`PreparedSave`] to the `.sigil/` directory on disk.
///
/// This is the async half of the save pipeline. Call [`prepare_save`] first
/// (under the document lock), then call this function after releasing the lock.
///
/// Pages are written first, then stale page files are removed, and the manifest
/// is written last. The manifest acts as the commit point: if the process crashes
/// mid-save, the manifest still points to a consistent set of page files.
///
/// All file writes use atomic write-to-temp-then-rename to prevent partial writes.
///
/// If `prepared.migrated_from` is `Some(v)`, the function first copies the
/// existing on-disk files to `.backup-v{v}/` (RF-010) so the original
/// pre-migration state is preserved (e.g. `.backup-v1` or `.backup-v2`).
/// The backup is one-shot: subsequent saves skip the copy if the backup
/// directory already exists.
///
/// # Errors
///
/// Returns an error if directory creation or file writes fail.
pub async fn write_prepared_save(prepared: &PreparedSave, workfile_path: &Path) -> Result<()> {
    // RF-010: back up the original pre-migration files before the first
    // migrated write. The backup directory is named `.backup-v{N}` where N is
    // the original (pre-migration) schema version (e.g. `.backup-v1` or
    // `.backup-v2`).
    if let Some(original_version) = prepared.migrated_from {
        backup_pre_migration_files(workfile_path, original_version).await?;
    }

    let pages_dir = workfile_path.join("pages");
    tokio::fs::create_dir_all(&pages_dir).await?;

    // Build the set of current page filenames for stale-file detection
    let current_filenames: HashSet<String> = prepared
        .pages
        .iter()
        .map(|(filename, _)| format!("{filename}.json"))
        .collect();

    // Write each page first (before manifest)
    for (filename, json) in &prepared.pages {
        atomic_write(&pages_dir.join(format!("{filename}.json")), json).await?;
    }

    // Remove stale page files that are no longer in the current save set
    let mut entries = tokio::fs::read_dir(&pages_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json")
            && let Some(name) = path.file_name().and_then(|n| n.to_str())
            && !current_filenames.contains(name)
        {
            tokio::fs::remove_file(&path)
                .await
                .with_context(|| format!("failed to remove stale page file: {}", path.display()))?;
        }
    }

    // Write embedded font files before the manifest so the commit point
    // (manifest rename) is only reached after all font bytes are on disk.
    //
    // The write pass is gated on having fonts to write — it creates `fonts/`
    // only when needed. The stale-cleanup pass runs unconditionally whenever
    // `fonts/` already exists on disk: this ensures that when a document sheds
    // ALL its custom fonts (next save has `font_assets == []`), any previously
    // written `.ttf` files are removed. Without this separation, a document that
    // drops from N fonts to 0 would leave orphaned bytes on disk indefinitely.
    let fonts_dir = workfile_path.join("fonts");

    if !prepared.font_assets.is_empty() {
        tokio::fs::create_dir_all(&fonts_dir).await?;

        // Write each font binary atomically.
        for (uuid, bytes) in &prepared.font_assets {
            atomic_write_bytes(&fonts_dir.join(format!("{uuid}.ttf")), bytes).await?;
        }
    }

    // Build the set of current font filenames (may be empty when no fonts remain).
    // Run the stale-cleanup pass unconditionally whenever fonts/ exists on disk.
    if tokio::fs::metadata(&fonts_dir).await.is_ok() {
        let current_font_uuids: HashSet<String> = prepared
            .font_assets
            .iter()
            .map(|(uuid, _)| format!("{uuid}.ttf"))
            .collect();

        // Remove stale font files whose UUID is no longer in the current save set.
        let mut font_entries = tokio::fs::read_dir(&fonts_dir).await?;
        while let Some(entry) = font_entries.next_entry().await? {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "ttf")
                && let Some(name) = path.file_name().and_then(|n| n.to_str())
                && !current_font_uuids.contains(name)
            {
                tokio::fs::remove_file(&path).await.with_context(|| {
                    format!("failed to remove stale font file: {}", path.display())
                })?;
            }
        }
    }

    // Write manifest LAST — this is the commit point
    atomic_write(
        &workfile_path.join("manifest.json"),
        &prepared.manifest_json,
    )
    .await?;

    Ok(())
}

/// Convenience wrapper: serialize + write in one call.
///
/// **Caller must NOT hold a `std::sync::Mutex` when calling this** — it is
/// async and will hold the borrow across await points.
///
/// Passes an empty font-byte map — no custom fonts are embedded. Tests that
/// need to exercise font embedding should call [`prepare_save`] directly with
/// a populated map.
///
/// # Errors
///
/// Returns an error if serialization or file writes fail.
#[cfg(test)]
pub(crate) async fn save_workfile(doc: &Document, workfile_path: &Path) -> Result<()> {
    let prepared = prepare_save(doc, &HashMap::new())?;
    write_prepared_save(&prepared, workfile_path).await
}

/// Loads a workfile from a `.sigil/` directory into a [`LoadedWorkfile`].
///
/// Reads `manifest.json` for metadata, then loads each page from `pages/`.
/// Pages are reordered to match the manifest's `page_order`. Pages on disk
/// whose UUID is not in `page_order` are discarded with a warning.
///
/// After all pages are loaded, a fixup pass resolves cross-page transition
/// `target_node` UUIDs using the global arena.
///
/// The returned [`LoadedWorkfile`] includes a `migrated_from` flag that is
/// `Some(v)` if any page on disk required migration from a lower schema version.
/// The server uses this to flush the migrated form back to disk (RF-009).
///
/// # Errors
///
/// Returns an error if the directory doesn't exist, is a symlink, the manifest
/// is invalid, file sizes exceed limits, or any page file fails to parse.
/// Validates the workfile path and reads the manifest from disk.
///
/// Centralizes the symlink check, size check, and manifest validation so
/// [`load_workfile`] stays under the per-function line limit.
async fn read_and_validate_manifest(workfile_path: &Path) -> Result<Manifest> {
    // RF-010: use symlink_metadata to detect symlinks — reject symlinked workfile dirs
    let meta = tokio::fs::symlink_metadata(workfile_path)
        .await
        .with_context(|| format!("workfile path not found: {}", workfile_path.display()))?;
    if meta.is_symlink() {
        bail!(
            "workfile path is a symlink (rejected for safety): {}",
            workfile_path.display()
        );
    }
    if !meta.is_dir() {
        bail!(
            "workfile path is not a directory: {}",
            workfile_path.display()
        );
    }

    // RF-006: check manifest file size before reading
    let manifest_path = workfile_path.join("manifest.json");
    let manifest_meta = tokio::fs::metadata(&manifest_path)
        .await
        .context("failed to stat manifest.json")?;
    if manifest_meta.len() > MAX_MANIFEST_SIZE {
        bail!(
            "manifest.json exceeds maximum size ({} > {MAX_MANIFEST_SIZE})",
            manifest_meta.len()
        );
    }

    let manifest_json = tokio::fs::read_to_string(&manifest_path)
        .await
        .context("failed to read manifest.json")?;
    let manifest: Manifest =
        serde_json::from_str(&manifest_json).context("failed to parse manifest.json")?;

    manifest.validate()?;

    if manifest.schema_version > sigil_core::CURRENT_SCHEMA_VERSION {
        bail!(
            "workfile schema version {} is newer than supported version {}",
            manifest.schema_version,
            sigil_core::CURRENT_SCHEMA_VERSION
        );
    }

    Ok(manifest)
}

/// Loads embedded custom font bytes from `workfile_path/fonts/`.
///
/// Scans the `fonts/` subdirectory (if it exists) for `*.ttf` files whose
/// filename stem is a valid UUID. Applies the following rules:
///
/// - Files whose stem is not a valid UUID → `tracing::warn!` + skip.
/// - Files whose UUID is NOT in `manifest_font_assets` (orphan) →
///   `tracing::warn!` + skip (per CLAUDE.md "stale files must be ignored").
/// - Files that exceed [`sigil_core::validate::MAX_EMBEDDED_FONT_BYTES`] →
///   `tracing::warn!` + skip (degrade gracefully; do not abort the load).
/// - Qualifying files are read and inserted into the returned map keyed by UUID.
///
/// After the directory scan, warns for each UUID in `manifest_font_assets` that
/// has no corresponding file on disk (referenced but missing → degraded, no
/// error).
///
/// Returns an empty map if `fonts/` does not exist.
///
/// # Errors
///
/// Returns an error only for hard I/O failures (e.g. `read_dir` fails on an
/// existing directory). Soft issues (skipped files, missing files) are demoted
/// to warnings.
async fn load_font_assets(
    workfile_path: &Path,
    manifest_font_assets: &[Uuid],
) -> Result<HashMap<Uuid, Vec<u8>>> {
    let fonts_dir = workfile_path.join("fonts");

    // Fast-path: no fonts/ directory means nothing to load.
    // Distinguish NotFound (expected: workfile has no custom fonts) from hard
    // errors such as PermissionDenied (unexpected: surface to the caller).
    match tokio::fs::metadata(&fonts_dir).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HashMap::new());
        }
        Err(e) => {
            return Err(e).with_context(|| {
                format!("failed to access fonts/ directory: {}", fonts_dir.display())
            });
        }
    }

    // Build a set of UUIDs that are referenced by the manifest for O(1) lookup.
    let manifest_set: HashSet<Uuid> = manifest_font_assets.iter().copied().collect();

    let mut font_bytes: HashMap<Uuid, Vec<u8>> = HashMap::new();
    // Track UUIDs that were present on disk but skipped (oversize, over-aggregate,
    // etc.) so the post-scan loop can distinguish "missing from disk" from
    // "present but skipped".
    let mut skipped_uuids: HashSet<Uuid> = HashSet::new();
    // RF-001: running sum of all loaded embedded-font bytes. Once adding a font
    // would push the resident total past MAX_TOTAL_EMBEDDED_FONT_BYTES, that
    // font is skipped (degrade, don't fail the whole load) — mirrors the
    // oversize/orphan skip handling above. Note: `read_dir` order is
    // filesystem-defined, so WHICH fonts are skipped under the aggregate cap is
    // not deterministic across platforms; the cap itself (resident memory bound)
    // is what matters, and a degraded workfile that exceeds the aggregate is a
    // corrupt/adversarial input either way.
    let mut running_total: usize = 0;
    let mut entries = tokio::fs::read_dir(&fonts_dir)
        .await
        .with_context(|| format!("failed to read fonts/ directory: {}", fonts_dir.display()))?;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();

        // Only process .ttf files.
        if path.extension().and_then(|e| e.to_str()) != Some("ttf") {
            continue;
        }

        // Parse the stem as a UUID; skip + warn on any non-UUID stem.
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        let Ok(uuid) = Uuid::parse_str(stem) else {
            tracing::warn!(
                "fonts/ contains file with non-UUID stem '{}'; skipping",
                path.display()
            );
            continue;
        };

        // Orphan check: file not referenced in manifest → skip + warn.
        if !manifest_set.contains(&uuid) {
            tracing::warn!(
                "fonts/{}.ttf is present on disk but not referenced by manifest.font_assets; \
                 skipping (orphan)",
                uuid
            );
            continue;
        }

        // Size check: reject files that exceed the embedded-font byte limit.
        // Compare meta.len() (u64) against the constant cast to u64 to avoid a
        // u64→usize truncation on 32-bit targets (clippy::cast_possible_truncation).
        let meta = tokio::fs::metadata(&path)
            .await
            .with_context(|| format!("failed to stat font file: {}", path.display()))?;
        let max_bytes = sigil_core::validate::MAX_EMBEDDED_FONT_BYTES as u64;
        if meta.len() > max_bytes {
            tracing::warn!(
                "fonts/{uuid}.ttf exceeds MAX_EMBEDDED_FONT_BYTES \
                 ({} > {}); skipping — document will degrade",
                meta.len(),
                sigil_core::validate::MAX_EMBEDDED_FONT_BYTES
            );
            skipped_uuids.insert(uuid);
            continue;
        }

        // Read the font bytes.
        let bytes = tokio::fs::read(&path)
            .await
            .with_context(|| format!("failed to read font file: {}", path.display()))?;

        // Defense-in-depth: re-check size after read (stat→read TOCTOU race).
        // A file could grow between the metadata check above and the read.
        if bytes.len() > sigil_core::validate::MAX_EMBEDDED_FONT_BYTES {
            tracing::warn!(
                "fonts/{uuid}.ttf exceeds MAX_EMBEDDED_FONT_BYTES after read \
                 ({} > {}); skipping — document will degrade",
                bytes.len(),
                sigil_core::validate::MAX_EMBEDDED_FONT_BYTES
            );
            skipped_uuids.insert(uuid);
            continue;
        }

        // RF-001: aggregate cap. Skip (degrade) any font that would push the
        // resident total over MAX_TOTAL_EMBEDDED_FONT_BYTES. `checked_add`
        // guards against an overflow wrapping the running total on pathological
        // input; `None` (overflow) and `Some(t > cap)` both trigger the skip.
        match running_total.checked_add(bytes.len()) {
            Some(new_total) if new_total <= sigil_core::validate::MAX_TOTAL_EMBEDDED_FONT_BYTES => {
                running_total = new_total;
            }
            _ => {
                tracing::warn!(
                    "fonts/{uuid}.ttf would exceed MAX_TOTAL_EMBEDDED_FONT_BYTES \
                     (running total {} + {} > {}); skipping — document will degrade",
                    running_total,
                    bytes.len(),
                    sigil_core::validate::MAX_TOTAL_EMBEDDED_FONT_BYTES
                );
                skipped_uuids.insert(uuid);
                continue;
            }
        }

        font_bytes.insert(uuid, bytes);
    }

    // Warn for any manifest-referenced UUIDs that were neither loaded nor
    // present-but-skipped. Files in `skipped_uuids` ARE on disk — calling
    // them "missing" would be misleading.
    for uuid in manifest_font_assets {
        if !font_bytes.contains_key(uuid) && !skipped_uuids.contains(uuid) {
            tracing::warn!(
                "manifest.font_assets references {uuid} but fonts/{uuid}.ttf is missing \
                 from disk; document will degrade (font unavailable)"
            );
        }
    }

    Ok(font_bytes)
}

/// Loads a workfile from a `.sigil/` directory into a [`LoadedWorkfile`].
///
/// Reads `manifest.json` for metadata, then loads each page from `pages/`.
/// Pages are reordered to match the manifest's `page_order`. Pages on disk
/// whose UUID is not in `page_order` are discarded with a warning.
///
/// After all pages are loaded, a fixup pass resolves cross-page transition
/// `target_node` UUIDs using the global arena.
///
/// The returned [`LoadedWorkfile`] includes a `migrated_from` flag that is
/// `Some(v)` if any page on disk required migration from a lower schema version.
/// The server uses this to flush the migrated form back to disk (RF-009).
///
/// # Errors
///
/// Returns an error if the directory doesn't exist, is a symlink, the manifest
/// is invalid, file sizes exceed limits, or any page file fails to parse.
pub async fn load_workfile(workfile_path: &Path) -> Result<LoadedWorkfile> {
    load_workfile_impl(workfile_path).await
}

/// Populates a document's font table from the entries in `manifest_fonts` and
/// the `migrated_fonts` map produced by the v2→v3 migration pass.
///
/// Manifest entries are loaded first. The default entry (already seeded by
/// `Document::new`) is skipped defensively. Migration entries are added next,
/// skipping any UUID already in the table to avoid conflicts on partially-migrated
/// workfiles that had both `manifest.fonts` and residual `font_family` fields.
///
/// # Errors
///
/// Returns an error if a manifest font entry or a migrated font family cannot be
/// inserted into the document's font table (e.g., invalid family name, duplicate
/// UUID, or font table capacity exceeded).
fn populate_font_table_from_load(
    doc: &mut Document,
    manifest_fonts: Vec<FontEntry>,
    migrated_fonts: BTreeMap<Uuid, String>,
) -> Result<()> {
    for entry in manifest_fonts {
        if entry.id() == DEFAULT_FONT_ENTRY_ID {
            tracing::warn!(
                "manifest.fonts contained DEFAULT_FONT_ENTRY_ID ({DEFAULT_FONT_ENTRY_ID}); \
                 skipping — it is already seeded by Document::new"
            );
            continue;
        }
        doc.font_table_mut().add(entry).map_err(|e| {
            anyhow::anyhow!("failed to reconstruct font table from manifest.fonts: {e}")
        })?;
    }
    for (uuid, family) in migrated_fonts {
        if doc.font_table().get(uuid).is_none() {
            let entry = build_system_reference_entry(uuid, family.clone()).map_err(|e| {
                anyhow::anyhow!(
                    "v2→v3 migration: family '{family}' is not a valid font family name: {e}"
                )
            })?;
            doc.font_table_mut().add(entry).map_err(|e| {
                anyhow::anyhow!("v2→v3 migration: failed to add '{family}' to font table: {e}")
            })?;
        }
    }
    Ok(())
}

async fn load_workfile_impl(workfile_path: &Path) -> Result<LoadedWorkfile> {
    let manifest = read_and_validate_manifest(workfile_path).await?;

    let mut doc = Document::new(manifest.name.clone());

    // RF-015: build set of expected page UUIDs from manifest for filtering
    let expected_pages: HashSet<Uuid> = manifest.page_order.iter().copied().collect();

    // Collect unresolved cross-page transition target_node UUIDs for RF-008 fixup
    let mut unresolved_targets: Vec<(usize, Uuid)> = Vec::new();

    // RF-009: track the lowest on-disk schema version observed across all
    // page files. If any page is below CURRENT_SCHEMA_VERSION, the document was
    // migrated on load and the persistence layer must flush the migrated form
    // back to disk so the on-disk files match the in-memory document.
    let mut min_observed_version: Option<u32> = None;

    // v2→v3: accumulate (FontEntryId → family) pairs discovered during font-
    // table migration. After the page loop, these are used to populate the
    // document font table with SystemReference entries for all migrated families.
    let mut migrated_fonts: BTreeMap<Uuid, String> = BTreeMap::new();

    // Load pages from the pages/ directory
    let pages_dir = workfile_path.join("pages");
    if tokio::fs::metadata(&pages_dir).await.is_ok() {
        let mut entries = tokio::fs::read_dir(&pages_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                // RF-006: check page file size before reading
                let page_meta = tokio::fs::metadata(&path)
                    .await
                    .with_context(|| format!("failed to stat page: {}", path.display()))?;
                if page_meta.len() > MAX_PAGE_FILE_SIZE {
                    bail!(
                        "page file exceeds maximum size ({} > {MAX_PAGE_FILE_SIZE}): {}",
                        page_meta.len(),
                        path.display()
                    );
                }

                let json = tokio::fs::read_to_string(&path)
                    .await
                    .with_context(|| format!("failed to read page: {}", path.display()))?;
                let (serialized_page, on_disk_version, page_fonts) =
                    deserialize_page_with_version_and_fonts(&json).map_err(|e| {
                        anyhow::anyhow!("failed to deserialize {}: {e}", path.display())
                    })?;
                // Accumulate font-family pairs from v2→v3 migration. Families that
                // appear in multiple pages produce the same deterministic UUID so
                // the BTreeMap simply overwrites duplicates with identical values.
                migrated_fonts.extend(page_fonts);

                // Track the lowest on-disk version so the persistence layer can
                // detect migration and back up original files before overwriting.
                if on_disk_version < sigil_core::CURRENT_SCHEMA_VERSION {
                    min_observed_version = Some(
                        min_observed_version.map_or(on_disk_version, |v| v.min(on_disk_version)),
                    );
                }

                // RF-015: only load pages whose UUID is in manifest.page_order
                if !expected_pages.contains(&serialized_page.id) {
                    tracing::warn!(
                        "ignoring page file not in manifest page_order: {} (uuid={})",
                        path.display(),
                        serialized_page.id
                    );
                    continue;
                }

                let page_unresolved = load_page_into_document(&mut doc, &serialized_page)?;
                unresolved_targets.extend(page_unresolved);
            }
        }
    }

    // RF-008: cross-page fixup pass — resolve target_node UUIDs using global arena
    for (transition_idx, target_uuid) in &unresolved_targets {
        if let Some(node_id) = doc.arena.id_by_uuid(target_uuid) {
            doc.transitions[*transition_idx].target_node = Some(node_id);
        } else {
            tracing::warn!(
                "transition target_node UUID {target_uuid} not found in any page — leaving unresolved"
            );
        }
    }

    // Reorder pages to match manifest ordering
    reorder_pages(&mut doc, &manifest.page_order);

    // Reconstruct the font table from manifest entries and any families
    // discovered during the v2→v3 migration pass.
    populate_font_table_from_load(&mut doc, manifest.fonts, migrated_fonts)?;

    // Load embedded font bytes from fonts/ (if present). Must run after
    // page-load so the doc is already in its final state when we return.
    let font_bytes = load_font_assets(workfile_path, &manifest.font_assets).await?;

    // RF-014: warn for any Custom font entry whose bytes did not load. A
    // `FontSource::Custom { asset_uuid }` entry renders from embedded bytes; if
    // `asset_uuid` is absent from `font_bytes` (file missing, oversized,
    // over-aggregate, or orphaned), the entry will render as a missing custom
    // font. `load_font_assets` already warns per-UUID for entries listed in
    // `manifest.font_assets`, but a Custom entry whose `asset_uuid` was never
    // listed there (corrupt/hand-edited manifest where `fonts` and
    // `font_assets` diverged) would otherwise warn nowhere — this loop catches
    // exactly that gap.
    for entry in doc.font_table().iter() {
        if let FontSource::Custom { asset_uuid } = entry.source()
            && !font_bytes.contains_key(asset_uuid)
        {
            tracing::warn!(
                "font entry {} ('{}') is Custom but its bytes ({asset_uuid}) are not \
                 present after load; it will render as a missing custom font",
                entry.id(),
                entry.family()
            );
        }
    }

    tracing::info!(
        "loaded workfile '{}' with {} pages, {} nodes, {} embedded fonts",
        manifest.name,
        doc.pages.len(),
        doc.arena.len(),
        font_bytes.len(),
    );

    if let Some(v) = min_observed_version {
        tracing::info!(
            "workfile contained pages at schema v{v} (current: v{}); document was migrated on load",
            sigil_core::CURRENT_SCHEMA_VERSION
        );
    }

    Ok(LoadedWorkfile {
        document: doc,
        font_bytes,
        migrated_from: min_observed_version,
    })
}

/// Synchronous bridge to [`load_workfile`] for callers that cannot `await`.
///
/// This exists to plug into [`sigil_state::Sessions::open`], which accepts a
/// synchronous loader closure (sigil-state is transport-agnostic and cannot
/// depend on a specific async runtime). Inside a `#[tokio::main]` deployment
/// running on the multi-threaded runtime, [`tokio::task::block_in_place`]
/// safely yields the current worker thread back to the runtime so other tasks
/// keep making progress while the load blocks.
///
/// The returned [`Document`] is the deserialized workfile; the
/// `migrated_from` flag from [`LoadedWorkfile`] is intentionally dropped at
/// the sync boundary because [`sigil_state::Sessions::open`] consumes only
/// `Document`. Callers that need `migrated_from` should continue to use
/// [`load_workfile`] directly on the legacy `--workfile` startup path.
///
/// # Panics
///
/// Panics if called outside a Tokio runtime, or from a current-thread
/// runtime where [`tokio::task::block_in_place`] is not supported.
/// Production deployments use `#[tokio::main]` which defaults to the
/// multi-threaded runtime; integration tests that need the sync bridge must
/// opt into `#[tokio::test(flavor = "multi_thread")]`.
///
/// # Errors
///
/// Propagates any error from [`load_workfile`] (workfile validation,
/// manifest parse failure, page deserialization, schema-version mismatch).
pub fn load_workfile_sync(path: &Path) -> Result<Document> {
    let loaded = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(load_workfile(path))
    })?;
    Ok(loaded.document)
}

/// Synchronous variant of [`load_workfile`] that returns the full
/// [`LoadedWorkfile`] — document, embedded font bytes, and migration flag.
///
/// Used by callers that drive a synchronous loader closure (e.g. the GraphQL
/// `openSession` resolver) but still need `migrated_from` for persistence
/// registration and `font_bytes` for session population.
///
/// Like [`load_workfile_sync`], requires the multi-threaded tokio runtime
/// because it uses [`tokio::task::block_in_place`].
///
/// # Errors
///
/// Returns an error if the workfile cannot be loaded (see [`load_workfile`]).
pub fn load_workfile_sync_migrated(path: &Path) -> Result<LoadedWorkfile> {
    tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(load_workfile(path)))
}

/// Reconstructs a page and its nodes from a [`SerializedPage`] into the document.
///
/// Nodes are deserialized through `Node`'s custom `Deserialize` impl (which
/// validates on construction). Parent-child relationships and page root nodes
/// are reconstructed from the UUID references in the serialized data.
///
/// Returns a list of `(transition_index, target_node_uuid)` pairs for transitions
/// whose `target_node` UUID could not be resolved within this page's local node map.
/// These are resolved in a cross-page fixup pass after all pages are loaded.
fn load_page_into_document(
    doc: &mut Document,
    serialized: &SerializedPage,
) -> Result<Vec<(usize, Uuid)>> {
    let page_id = PageId::new(serialized.id);
    let page = Page::new(page_id, serialized.name.clone())
        .map_err(|e| anyhow::anyhow!("failed to create page '{}': {e}", serialized.name))?;
    doc.add_page(page)
        .map_err(|e| anyhow::anyhow!("failed to add page '{}': {e}", serialized.name))?;

    // Map from serialized UUIDs to arena-assigned NodeIds
    let mut uuid_to_id: HashMap<Uuid, NodeId> = HashMap::new();

    // First pass: insert all nodes into the arena.
    //
    // SerializedNode stores kind/transform/style/constraints as serde_json::Value.
    // Node has a custom Deserialize impl that expects typed fields and validates
    // on construction. We build a full JSON object and deserialize it through
    // Node's Deserialize, letting it handle all validation.
    //
    // The id field is set to [0,0] — Arena::insert overwrites it with the
    // actual assigned NodeId. Parent and children are set to null/[] for now;
    // relationships are reconstructed in the second pass.
    for snode in &serialized.nodes {
        let node_json = serde_json::json!({
            "id": [0, 0],
            "uuid": snode.id.to_string(),
            "kind": snode.kind,
            "name": snode.name,
            "parent": null,
            "children": [],
            "transform": snode.transform,
            "style": snode.style,
            "constraints": snode.constraints,
            "grid_placement": snode.grid_placement,
            "visible": snode.visible,
            "locked": snode.locked,
        });

        let node: Node = serde_json::from_value(node_json)
            .map_err(|e| anyhow::anyhow!("failed to deserialize node '{}': {e}", snode.name))?;

        let node_id = doc
            .arena
            .insert(node)
            .map_err(|e| anyhow::anyhow!("failed to insert node '{}': {e}", snode.name))?;
        uuid_to_id.insert(snode.id, node_id);
    }

    // Second pass: reconstruct parent-child relationships via core's tree API.
    for snode in &serialized.nodes {
        if let Some(parent_uuid) = snode.parent {
            let node_id = uuid_to_id
                .get(&snode.id)
                .copied()
                .ok_or_else(|| anyhow::anyhow!("node UUID {} not found in map", snode.id))?;
            let parent_id = uuid_to_id.get(&parent_uuid).copied().ok_or_else(|| {
                anyhow::anyhow!(
                    "parent UUID {} not found for node '{}'",
                    parent_uuid,
                    snode.name
                )
            })?;
            sigil_core::tree::add_child(&mut doc.arena, parent_id, node_id)
                .map_err(|e| anyhow::anyhow!("failed to add child '{}': {e}", snode.name))?;
        }
    }

    // Third pass: register root nodes (those without parents) on the page.
    for snode in &serialized.nodes {
        if snode.parent.is_none() {
            let node_id = uuid_to_id
                .get(&snode.id)
                .copied()
                .ok_or_else(|| anyhow::anyhow!("root node UUID {} not found in map", snode.id))?;
            doc.add_root_node_to_page(page_id, node_id)
                .map_err(|e| anyhow::anyhow!("failed to add root node '{}': {e}", snode.name))?;
        }
    }

    // Load transitions whose source node belongs to this page.
    // Track unresolved target_node UUIDs for cross-page fixup (RF-008).
    let mut unresolved = Vec::new();
    for st in &serialized.transitions {
        let Some(&source_id) = uuid_to_id.get(&st.source_node) else {
            continue; // Source not in this page — skip
        };

        // Try to resolve target_node within the page-local map first
        let resolved_target = st
            .target_node
            .and_then(|uuid| uuid_to_id.get(&uuid).copied());

        let transition = sigil_core::Transition {
            id: st.id,
            source_node: source_id,
            target_page: PageId::new(st.target_page),
            target_node: resolved_target,
            trigger: st.trigger.clone(),
            animation: st.animation.clone(),
        };
        doc.add_transition(transition)
            .map_err(|e| anyhow::anyhow!("failed to add transition: {e}"))?;

        // If there was a target_node UUID but we couldn't resolve it locally,
        // record it for cross-page fixup.
        if let Some(target_uuid) = st.target_node
            && resolved_target.is_none()
        {
            let idx = doc.transitions.len() - 1;
            unresolved.push((idx, target_uuid));
        }
    }

    Ok(unresolved)
}

/// Reorders pages to match the manifest's `page_order`.
///
/// Pages whose UUID is not in the order list sort to the end.
fn reorder_pages(doc: &mut Document, page_order: &[Uuid]) {
    let order_map: HashMap<Uuid, usize> = page_order
        .iter()
        .enumerate()
        .map(|(i, uuid)| (*uuid, i))
        .collect();

    doc.pages
        .sort_by_key(|p| order_map.get(&p.id.uuid()).copied().unwrap_or(usize::MAX));
}

#[cfg(test)]
mod tests {
    use super::*;
    use sigil_core::NodeKind;

    #[test]
    fn test_manifest_from_document_captures_name_and_version() {
        let doc = Document::new("Test Project".to_string());
        let manifest = Manifest::from_document(&doc);
        assert_eq!(manifest.name, "Test Project");
        assert!(manifest.page_order.is_empty());
        assert_eq!(manifest.schema_version, sigil_core::CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_manifest_serde_round_trip() {
        let manifest = Manifest {
            schema_version: 1,
            name: "Test".to_string(),
            page_order: vec![Uuid::nil()],
            font_assets: Vec::new(),
            fonts: Vec::new(),
        };
        let json = serde_json::to_string(&manifest).expect("serialize manifest");
        let deserialized: Manifest = serde_json::from_str(&json).expect("deserialize manifest");
        assert_eq!(manifest.name, deserialized.name);
        assert_eq!(manifest.schema_version, deserialized.schema_version);
        assert_eq!(manifest.page_order, deserialized.page_order);
    }

    #[tokio::test]
    async fn test_save_and_load_empty_workfile() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let doc = Document::new("Empty Project".to_string());
        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load workfile")
            .document;
        assert_eq!(loaded.metadata.name, "Empty Project");
        assert!(loaded.pages.is_empty());
    }

    /// Verifies the sync bridge that lets `sigil_state::Sessions::open`
    /// invoke the async `load_workfile` from a synchronous loader closure.
    /// Requires the multi-threaded tokio runtime so `block_in_place` works.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_load_workfile_sync_round_trip() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("sync.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let doc = Document::new("Sync Bridge".to_string());
        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        // `load_workfile_sync` uses `block_in_place` + `block_on`; this is
        // the canonical pattern for invoking an async API from a sync
        // boundary on a multi-thread runtime worker thread.
        let loaded = super::load_workfile_sync(&workfile_path).expect("load_workfile_sync");
        assert_eq!(loaded.metadata.name, "Sync Bridge");
    }

    /// Verifies that the sync bridge composes with `sigil_state::Sessions::open`
    /// — the actual integration this helper exists for. The loader closure runs
    /// synchronously inside `Sessions::open` and is bridged to the async
    /// `load_workfile` by `load_workfile_sync`.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_load_workfile_sync_composes_with_sessions_open() {
        use sigil_state::Sessions;

        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("compose.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let doc = Document::new("Compose".to_string());
        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let sessions = Sessions::new(64);
        let id = sessions
            .open(&workfile_path, super::load_workfile_sync)
            .expect("session opens via sync bridge");
        let session = sessions.get(id).expect("registered session");
        let stored = session.store.read().await;
        assert_eq!(stored.metadata.name, "Compose");
    }

    #[tokio::test]
    async fn test_save_and_load_workfile_with_page_and_node() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let mut doc = Document::new("With Page".to_string());
        let page_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_id, "Home".to_string()).expect("create page"))
            .expect("add page");

        // Add a frame node
        let node = Node::new(
            NodeId::new(0, 0),
            Uuid::new_v4(),
            NodeKind::Frame {
                layout: None,
                corners: sigil_core::node::default_corners(),
            },
            "Frame 1".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert node");
        doc.add_root_node_to_page(page_id, node_id)
            .expect("add root node");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load workfile")
            .document;
        assert_eq!(loaded.metadata.name, "With Page");
        assert_eq!(loaded.pages.len(), 1);
        assert_eq!(loaded.pages[0].name, "Home");
        assert_eq!(loaded.arena.len(), 1);
    }

    #[tokio::test]
    async fn test_load_workfile_missing_directory_returns_error() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("nonexistent.sigil");
        let result = load_workfile(&workfile_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_save_and_load_preserves_page_order() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let mut doc = Document::new("Multi Page".to_string());
        let page_a_id = PageId::new(Uuid::new_v4());
        let page_b_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_a_id, "Alpha".to_string()).expect("create page"))
            .expect("add page A");
        doc.add_page(Page::new(page_b_id, "Beta".to_string()).expect("create page"))
            .expect("add page B");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load workfile")
            .document;
        assert_eq!(loaded.pages.len(), 2);
        assert_eq!(loaded.pages[0].name, "Alpha");
        assert_eq!(loaded.pages[1].name, "Beta");
    }

    #[test]
    fn test_prepare_save_uses_uuid_filenames() {
        let mut doc = Document::new("Prepared".to_string());
        let page_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_id, "Page One".to_string()).expect("create page"))
            .expect("add page");

        let prepared = prepare_save(&doc, &HashMap::new()).expect("prepare save");
        assert_eq!(prepared.pages.len(), 1);
        assert_eq!(prepared.pages[0].0, page_id.uuid().to_string()); // UUID filename
        assert!(prepared.pages[0].1.contains("Page One")); // JSON contains page name
    }

    #[tokio::test]
    async fn test_save_and_load_workfile_with_parent_child_nodes() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let mut doc = Document::new("Hierarchy".to_string());
        let page_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_id, "Main".to_string()).expect("create page"))
            .expect("add page");

        // Create parent frame
        let parent = Node::new(
            NodeId::new(0, 0),
            Uuid::new_v4(),
            NodeKind::Frame {
                layout: None,
                corners: sigil_core::node::default_corners(),
            },
            "Parent".to_string(),
        )
        .expect("create parent");
        let parent_id = doc.arena.insert(parent).expect("insert parent");
        doc.add_root_node_to_page(page_id, parent_id)
            .expect("add root");

        // Create child rectangle
        let child = Node::new(
            NodeId::new(0, 0),
            Uuid::new_v4(),
            NodeKind::Rectangle {
                corners: sigil_core::node::default_corners(),
            },
            "Child".to_string(),
        )
        .expect("create child");
        let child_id = doc.arena.insert(child).expect("insert child");
        sigil_core::tree::add_child(&mut doc.arena, parent_id, child_id).expect("add child");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load workfile")
            .document;

        assert_eq!(loaded.arena.len(), 2);
        assert_eq!(loaded.pages.len(), 1);
        // The page should have exactly one root node (the parent)
        assert_eq!(loaded.pages[0].root_nodes.len(), 1);

        // Verify parent-child relationship is preserved
        let loaded_parent_id = loaded.pages[0].root_nodes[0];
        let loaded_parent = loaded.arena.get(loaded_parent_id).expect("get parent");
        assert_eq!(loaded_parent.name, "Parent");
        assert_eq!(loaded_parent.children.len(), 1);

        let loaded_child_id = loaded_parent.children[0];
        let loaded_child = loaded.arena.get(loaded_child_id).expect("get child");
        assert_eq!(loaded_child.name, "Child");
        assert_eq!(loaded_child.parent, Some(loaded_parent_id));
    }

    #[tokio::test]
    async fn test_write_prepared_save_removes_stale_page_files() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        // Save a document with two pages
        let mut doc = Document::new("Stale Test".to_string());
        let page_a_id = PageId::new(Uuid::new_v4());
        let page_b_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_a_id, "Alpha".to_string()).expect("create page"))
            .expect("add page A");
        doc.add_page(Page::new(page_b_id, "Beta".to_string()).expect("create page"))
            .expect("add page B");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("first save");

        // Verify both page files exist
        let pages_dir = workfile_path.join("pages");
        let alpha_path = pages_dir.join(format!("{}.json", page_a_id.uuid()));
        let beta_path = pages_dir.join(format!("{}.json", page_b_id.uuid()));
        assert!(tokio::fs::metadata(&alpha_path).await.is_ok());
        assert!(tokio::fs::metadata(&beta_path).await.is_ok());

        // Remove page B from the document and save again
        doc.pages.retain(|p| p.id != page_b_id);
        save_workfile(&doc, &workfile_path)
            .await
            .expect("second save");

        // Alpha should still exist, Beta should be cleaned up
        assert!(tokio::fs::metadata(&alpha_path).await.is_ok());
        assert!(
            tokio::fs::metadata(&beta_path).await.is_err(),
            "stale page file should have been removed"
        );
    }

    #[tokio::test]
    async fn test_load_workfile_rejects_newer_schema_version() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(workfile_path.join("pages"))
            .await
            .expect("create dirs");

        let manifest = Manifest {
            schema_version: sigil_core::CURRENT_SCHEMA_VERSION + 1,
            name: "Future Doc".to_string(),
            page_order: vec![],
            font_assets: Vec::new(),
            fonts: Vec::new(),
        };
        let manifest_json = serde_json::to_string_pretty(&manifest).expect("serialize");
        tokio::fs::write(workfile_path.join("manifest.json"), manifest_json)
            .await
            .expect("write manifest");

        let result = load_workfile(&workfile_path).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("newer than supported"),
            "expected schema version error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn test_atomic_write_produces_final_file_not_tmp() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let file_path = dir.path().join("test.json");

        atomic_write(&file_path, r#"{"test": true}"#)
            .await
            .expect("atomic write");

        // Final file should exist
        let content = tokio::fs::read_to_string(&file_path)
            .await
            .expect("read final");
        assert_eq!(content, r#"{"test": true}"#);

        // Temp file should NOT exist
        let tmp_path = file_path.with_extension("json.tmp");
        assert!(
            tokio::fs::metadata(&tmp_path).await.is_err(),
            "temp file should not remain after atomic write"
        );
    }

    #[tokio::test]
    async fn test_save_writes_uuid_named_page_files() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let mut doc = Document::new("UUID Names".to_string());
        let page_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_id, "My Page!".to_string()).expect("create page"))
            .expect("add page");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        // Page file should be named by UUID, not sanitized page name
        let expected_path = workfile_path
            .join("pages")
            .join(format!("{}.json", page_id.uuid()));
        assert!(
            tokio::fs::metadata(&expected_path).await.is_ok(),
            "page file should be named by UUID"
        );
    }

    #[test]
    fn test_manifest_validate_rejects_name_exceeding_max_length() {
        let manifest = Manifest {
            schema_version: 1,
            name: "x".repeat(MAX_MANIFEST_NAME_LEN + 1),
            page_order: vec![],
            font_assets: Vec::new(),
            fonts: Vec::new(),
        };
        let err = manifest.validate().unwrap_err();
        assert!(
            err.to_string().contains("exceeds maximum length"),
            "expected name length error, got: {err}"
        );
    }

    #[test]
    fn test_manifest_validate_rejects_too_many_pages() {
        let manifest = Manifest {
            schema_version: 1,
            name: "Test".to_string(),
            page_order: (0..=sigil_core::MAX_PAGES_PER_DOCUMENT)
                .map(|_| Uuid::new_v4())
                .collect(),
            font_assets: Vec::new(),
            fonts: Vec::new(),
        };
        let err = manifest.validate().unwrap_err();
        assert!(
            err.to_string().contains("exceeds maximum pages"),
            "expected page count error, got: {err}"
        );
    }

    #[test]
    fn test_manifest_validate_rejects_duplicate_uuids() {
        let dup = Uuid::new_v4();
        let manifest = Manifest {
            schema_version: 1,
            name: "Test".to_string(),
            page_order: vec![dup, Uuid::new_v4(), dup],
            font_assets: Vec::new(),
            fonts: Vec::new(),
        };
        let err = manifest.validate().unwrap_err();
        assert!(
            err.to_string().contains("duplicate UUID"),
            "expected duplicate UUID error, got: {err}"
        );
    }

    #[test]
    fn test_manifest_validate_accepts_valid_manifest() {
        let manifest = Manifest {
            schema_version: 1,
            name: "Valid".to_string(),
            page_order: vec![Uuid::new_v4(), Uuid::new_v4()],
            font_assets: Vec::new(),
            fonts: Vec::new(),
        };
        manifest.validate().expect("valid manifest should pass");
    }

    #[tokio::test]
    async fn test_load_workfile_rejects_symlinked_directory() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let real_path = dir.path().join("real.sigil");
        let link_path = dir.path().join("link.sigil");
        tokio::fs::create_dir_all(&real_path)
            .await
            .expect("create real dir");

        // Create a symlink pointing to the real directory
        #[cfg(unix)]
        {
            tokio::fs::symlink(&real_path, &link_path)
                .await
                .expect("create symlink");

            let result = load_workfile(&link_path).await;
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("symlink"),
                "expected symlink error, got: {err}"
            );
        }
    }

    #[tokio::test]
    async fn test_load_workfile_rejects_oversized_manifest() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("big.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        // Write an oversized manifest
        let big_manifest = "x".repeat((MAX_MANIFEST_SIZE + 1) as usize);
        tokio::fs::write(workfile_path.join("manifest.json"), &big_manifest)
            .await
            .expect("write big manifest");

        let result = load_workfile(&workfile_path).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("exceeds maximum size"),
            "expected size error, got: {err}"
        );
    }

    #[tokio::test]
    async fn test_load_workfile_ignores_pages_not_in_manifest() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("test.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        // Save a document with one page
        let mut doc = Document::new("Filter Test".to_string());
        let page_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_id, "Kept".to_string()).expect("create page"))
            .expect("add page");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        // Manually add an orphan page file not in manifest
        let pages_dir = workfile_path.join("pages");
        let orphan_uuid = Uuid::new_v4();
        let orphan_json = serde_json::json!({
            "schema_version": 1,
            "id": orphan_uuid.to_string(),
            "name": "Orphan",
            "nodes": [],
            "transitions": []
        });
        tokio::fs::write(
            pages_dir.join(format!("{orphan_uuid}.json")),
            orphan_json.to_string(),
        )
        .await
        .expect("write orphan page");

        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load workfile")
            .document;
        assert_eq!(loaded.pages.len(), 1);
        assert_eq!(loaded.pages[0].name, "Kept");
    }

    /// RF-009: a current-version workfile loads with `migrated_from = None`.
    #[tokio::test]
    async fn test_load_workfile_returns_no_migration_flag_for_current_schema() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("current.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let mut doc = Document::new("Current".to_string());
        let page_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_id, "Page".to_string()).expect("page"))
            .expect("add page");
        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let loaded = load_workfile(&workfile_path).await.expect("load workfile");
        assert_eq!(
            loaded.migrated_from, None,
            "current-version workfile should not signal migration"
        );
    }

    /// RF-009: a workfile containing a v1 page reports `migrated_from = Some(1)`.
    /// This is the signal `main.rs` uses to mark the document dirty so the
    /// migrated form is flushed back to disk.
    #[tokio::test]
    async fn test_load_workfile_returns_migration_flag_for_v1_page() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("v1.sigil");
        let pages_dir = workfile_path.join("pages");
        tokio::fs::create_dir_all(&pages_dir)
            .await
            .expect("create dirs");

        let page_uuid = Uuid::new_v4();

        // Hand-write a manifest pointing to the v1 page.
        let manifest = Manifest {
            schema_version: 1,
            name: "Legacy Doc".to_string(),
            page_order: vec![page_uuid],
            font_assets: Vec::new(),
            fonts: Vec::new(),
        };
        let manifest_json = serde_json::to_string_pretty(&manifest).expect("serialize");
        tokio::fs::write(workfile_path.join("manifest.json"), manifest_json)
            .await
            .expect("write manifest");

        // Hand-write a v1 page (no `corners`, uses legacy `corner_radii`).
        let page_json = serde_json::json!({
            "schema_version": 1,
            "id": page_uuid.to_string(),
            "name": "Legacy Page",
            "nodes": [],
            "transitions": []
        });
        tokio::fs::write(
            pages_dir.join(format!("{page_uuid}.json")),
            page_json.to_string(),
        )
        .await
        .expect("write page");

        let loaded = load_workfile(&workfile_path).await.expect("load workfile");
        assert_eq!(
            loaded.migrated_from,
            Some(1),
            "v1 page should produce migrated_from = Some(1)"
        );
        assert_eq!(loaded.document.metadata.name, "Legacy Doc");
    }

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

        let loaded = load_workfile_sync_migrated(&workfile_path).unwrap();
        assert_eq!(
            loaded.migrated_from,
            Some(1),
            "v1 workfile must report migrated_from = Some(1)"
        );
        assert_eq!(loaded.document.pages.len(), 1);
    }

    /// RF-010: when `prepared.migrated_from` is set, the writer copies the
    /// existing `manifest.json` and `pages/*.json` files to `.backup-v1/`
    /// before overwriting them.
    #[tokio::test]
    async fn test_write_prepared_save_creates_backup_when_migrated() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("backup.sigil");
        let pages_dir = workfile_path.join("pages");
        tokio::fs::create_dir_all(&pages_dir)
            .await
            .expect("create dirs");

        // Lay down a synthetic v1 manifest + page on disk.
        tokio::fs::write(
            workfile_path.join("manifest.json"),
            r#"{"schema_version": 1, "name": "Original", "page_order": []}"#,
        )
        .await
        .expect("write original manifest");
        let original_page_uuid = Uuid::new_v4();
        tokio::fs::write(
            pages_dir.join(format!("{original_page_uuid}.json")),
            r#"{"schema_version": 1, "id": "00000000-0000-0000-0000-000000000099", "name": "Old", "nodes": [], "transitions": []}"#,
        )
        .await
        .expect("write original page");

        // Build a PreparedSave with migrated_from set.
        let doc = Document::new("Migrated".to_string());
        let mut prepared = prepare_save(&doc, &HashMap::new()).expect("prepare save");
        prepared.migrated_from = Some(1);

        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write prepared save");

        // Verify backup directory exists.
        let backup_root = workfile_path.join(".backup-v1");
        assert!(
            tokio::fs::metadata(&backup_root).await.is_ok(),
            ".backup-v1/ should exist after migrated save"
        );

        // Verify backup contains the original manifest with v1 contents.
        let backup_manifest = tokio::fs::read_to_string(backup_root.join("manifest.json"))
            .await
            .expect("read backup manifest");
        assert!(
            backup_manifest.contains("\"schema_version\": 1"),
            "backup should preserve original v1 manifest, got: {backup_manifest}"
        );
        assert!(
            backup_manifest.contains("Original"),
            "backup should preserve original manifest contents"
        );

        // Verify backup contains the original page file.
        let backup_page = backup_root
            .join("pages")
            .join(format!("{original_page_uuid}.json"));
        assert!(
            tokio::fs::metadata(&backup_page).await.is_ok(),
            "backup should preserve original page file"
        );

        // Verify the live manifest was overwritten with the new v2 form.
        let live_manifest = tokio::fs::read_to_string(workfile_path.join("manifest.json"))
            .await
            .expect("read live manifest");
        assert!(
            live_manifest.contains("Migrated"),
            "live manifest should reflect new document"
        );
    }

    /// RF-010: a second migrated save must not overwrite the existing backup —
    /// the backup is a one-shot snapshot of the original v1 state.
    #[tokio::test]
    async fn test_write_prepared_save_does_not_overwrite_existing_backup() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("idempotent.sigil");
        let backup_root = workfile_path.join(".backup-v1");
        tokio::fs::create_dir_all(&backup_root)
            .await
            .expect("create dirs");

        // Pre-existing backup with sentinel content.
        tokio::fs::write(backup_root.join("manifest.json"), "ORIGINAL_BACKUP")
            .await
            .expect("write sentinel");

        let doc = Document::new("Doc".to_string());
        let mut prepared = prepare_save(&doc, &HashMap::new()).expect("prepare save");
        prepared.migrated_from = Some(1);

        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write prepared save");

        let backup_manifest = tokio::fs::read_to_string(backup_root.join("manifest.json"))
            .await
            .expect("read backup");
        assert_eq!(
            backup_manifest, "ORIGINAL_BACKUP",
            "existing backup must not be overwritten"
        );
    }

    /// Spec 22a §4 + rust-defensive "Filesystem Writes Must Be Atomic": N concurrent
    /// writers to the same path must leave exactly one writer's content on disk —
    /// never partial bytes, never ENOENT. A fixed temp suffix fails this (the temp
    /// path collides and one rename races ahead of another writer's write).
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
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
                    super::atomic_write(&target, &content)
                        .await
                        .expect("atomic_write");
                }
            }));
        }
        for h in handles {
            h.await.expect("writer task");
        }

        let final_content = tokio::fs::read_to_string(&target)
            .await
            .expect("read target");
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

    /// RF-010: when `migrated_from` is `None`, the writer must NOT create a
    /// `.backup-v1/` directory — backups only happen on the first migrated save.
    #[tokio::test]
    async fn test_write_prepared_save_does_not_create_backup_when_not_migrated() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("normal.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create dir");

        let doc = Document::new("Normal".to_string());
        let prepared = prepare_save(&doc, &HashMap::new()).expect("prepare save");
        // migrated_from defaults to None.

        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write prepared save");

        let backup_root = workfile_path.join(".backup-v1");
        assert!(
            tokio::fs::metadata(&backup_root).await.is_err(),
            ".backup-v1/ should not be created for non-migrated saves"
        );
    }

    // ── fonts/ storage tests (Task 10) ────────────────────────────────────

    /// rust-defensive "Filesystem Writes Must Be Atomic" — concurrency test for
    /// `atomic_write_bytes`. Spawns ≥8 concurrent writers to the SAME target path,
    /// each with a DISTINCT 4096-byte payload. After all writers finish, the
    /// on-disk file must contain exactly one writer's full payload — no partial
    /// bytes, no ENOENT.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_atomic_write_bytes_concurrent_writers_no_partial() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let target = dir.path().join(format!("{}.ttf", Uuid::new_v4()));

        const N: u8 = 8;
        const PAYLOAD_SIZE: usize = 4096;

        // Build N distinct payloads: payload i is a 4096-byte vec of all i's.
        let payloads: Vec<Vec<u8>> = (0..N).map(|i| vec![i; PAYLOAD_SIZE]).collect();

        let mut set = tokio::task::JoinSet::new();
        for payload in payloads.clone() {
            let t = target.clone();
            set.spawn(async move {
                // Run several times per task to widen the race window.
                for _ in 0..8_u32 {
                    atomic_write_bytes(&t, &payload)
                        .await
                        .expect("atomic_write_bytes");
                }
            });
        }
        while let Some(res) = set.join_next().await {
            res.expect("writer task panicked");
        }

        let final_bytes = tokio::fs::read(&target).await.expect("read target");
        assert_eq!(
            final_bytes.len(),
            PAYLOAD_SIZE,
            "final file must be exactly {PAYLOAD_SIZE} bytes, not a partial write"
        );
        // The content must be all one value — proving it came from a single writer.
        let first = final_bytes[0];
        assert!(
            payloads.contains(&final_bytes),
            "final on-disk content ({first:#x} × {PAYLOAD_SIZE}) must equal exactly \
             one writer's full payload"
        );

        // No stray temp files should remain.
        let mut entries = tokio::fs::read_dir(dir.path()).await.unwrap();
        while let Some(e) = entries.next_entry().await.unwrap() {
            let name = e.file_name().to_string_lossy().into_owned();
            assert!(
                !name.contains(".ttf.tmp"),
                "no temp files should remain after writes, found: {name}"
            );
        }
    }

    /// Build a helper `FontMetrics` for use in font-storage tests.
    fn test_font_metrics() -> sigil_core::FontMetrics {
        sigil_core::FontMetrics::new(
            2048,                           // units_per_em
            1984.0,                         // ascent
            -494.0,                         // descent (may be negative)
            0.0,                            // line_gap
            1456.0,                         // cap_height
            1118.0,                         // x_height
            0.0,                            // italic_angle
            1024.0,                         // avg_advance
            [2, 0, 0, 0, 0, 0, 0, 0, 0, 0], // panose
            false,                          // is_serif
        )
        .expect("test FontMetrics are valid")
    }

    /// `prepare_save` for a document with one `Custom` font entry whose bytes are
    /// present in `font_bytes` must: populate `prepared.font_assets` with the
    /// `(uuid, bytes)` pair, and populate `manifest.font_assets` with the UUID.
    #[test]
    fn test_prepare_save_includes_custom_font_assets() {
        let mut doc = Document::new("FontTest".to_string());
        let id = Uuid::from_u128(500);
        let entry = sigil_core::FontEntry::new(
            id,
            "Inter".to_string(),
            "Inter-Regular".to_string(),
            sigil_core::FontSource::Custom { asset_uuid: id },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry is valid");
        doc.font_table_mut().add(entry).expect("add font entry");

        let font_bytes = HashMap::from([(id, vec![1u8, 2, 3, 4])]);
        let prepared = prepare_save(&doc, &font_bytes).expect("prepare_save");

        assert_eq!(
            prepared.font_assets,
            vec![(id, vec![1u8, 2, 3, 4])],
            "font_assets pairs must contain the custom font bytes"
        );

        let manifest: Manifest =
            serde_json::from_str(&prepared.manifest_json).expect("deserialize manifest_json");
        assert_eq!(
            manifest.font_assets,
            vec![id],
            "manifest.font_assets must list the custom font UUID"
        );
    }

    /// `write_prepared_save` must write `fonts/<uuid>.ttf` and include the UUID
    /// in the on-disk `manifest.json`.
    #[tokio::test]
    async fn test_write_prepared_save_writes_font_file() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("fonts.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let mut doc = Document::new("FontWrite".to_string());
        let id = Uuid::from_u128(600);
        let entry = sigil_core::FontEntry::new(
            id,
            "Inter".to_string(),
            "Inter-Regular".to_string(),
            sigil_core::FontSource::Custom { asset_uuid: id },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry is valid");
        doc.font_table_mut().add(entry).expect("add font entry");

        let font_bytes = HashMap::from([(id, vec![1u8, 2, 3, 4])]);
        let prepared = prepare_save(&doc, &font_bytes).expect("prepare_save");

        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write_prepared_save");

        // fonts/<uuid>.ttf must exist with the correct bytes.
        let font_path = workfile_path.join("fonts").join(format!("{id}.ttf"));
        let on_disk = tokio::fs::read(&font_path).await.expect("read font file");
        assert_eq!(on_disk, vec![1u8, 2, 3, 4], "font file bytes must match");

        // manifest.json must include the UUID in font_assets.
        let manifest_json = tokio::fs::read_to_string(workfile_path.join("manifest.json"))
            .await
            .expect("read manifest");
        let manifest: Manifest =
            serde_json::from_str(&manifest_json).expect("deserialize manifest");
        assert_eq!(
            manifest.font_assets,
            vec![id],
            "manifest.font_assets must list the written font UUID"
        );
    }

    /// When a document has a `Custom` font entry but no bytes are provided in
    /// `font_bytes`, `prepare_save` must skip the entry (warn-and-skip path) and
    /// produce empty `font_assets` in both the `PreparedSave` and the manifest.
    #[test]
    fn test_prepare_save_skips_custom_font_without_bytes() {
        let mut doc = Document::new("SkipFont".to_string());
        let id = Uuid::from_u128(700);
        let entry = sigil_core::FontEntry::new(
            id,
            "Inter".to_string(),
            "Inter-Regular".to_string(),
            sigil_core::FontSource::Custom { asset_uuid: id },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry is valid");
        doc.font_table_mut().add(entry).expect("add font entry");

        // Empty byte map — no bytes available for this font.
        let prepared = prepare_save(&doc, &HashMap::new()).expect("prepare_save");

        assert!(
            prepared.font_assets.is_empty(),
            "font_assets must be empty when bytes are missing"
        );

        let manifest: Manifest =
            serde_json::from_str(&prepared.manifest_json).expect("deserialize manifest_json");
        assert!(
            manifest.font_assets.is_empty(),
            "manifest.font_assets must be empty when bytes are missing"
        );
    }

    /// `Manifest::validate` must reject a `font_assets` list of length
    /// `>= MAX_FONTS_PER_DOCUMENT` (the bundled default entry occupies one
    /// slot, so at most `MAX - 1` non-default entries are allowed).
    #[test]
    fn test_manifest_validate_rejects_too_many_font_assets() {
        // BOUNDARY: exactly MAX_FONTS_PER_DOCUMENT entries → Err (>= check).
        let at_max = Manifest {
            schema_version: 1,
            name: "AtMax".to_string(),
            page_order: vec![],
            font_assets: (0..(sigil_core::MAX_FONTS_PER_DOCUMENT as u128))
                .map(Uuid::from_u128)
                .collect(),
            fonts: Vec::new(),
        };
        let err = at_max.validate().unwrap_err();
        assert!(
            err.to_string().contains("exceeds maximum fonts"),
            "expected font count error at boundary (==MAX), got: {err}"
        );

        // BOUNDARY: exactly MAX_FONTS_PER_DOCUMENT - 1 entries → Ok.
        let at_max_minus_one = Manifest {
            schema_version: 1,
            name: "AtMaxMinusOne".to_string(),
            page_order: vec![],
            font_assets: (0..((sigil_core::MAX_FONTS_PER_DOCUMENT - 1) as u128))
                .map(Uuid::from_u128)
                .collect(),
            fonts: Vec::new(),
        };
        at_max_minus_one
            .validate()
            .expect("MAX-1 font_assets should be accepted (leaves room for bundled default)");
    }

    /// `Manifest::validate` must reject a `font_assets` list containing duplicate
    /// UUIDs.
    #[test]
    fn test_manifest_validate_rejects_duplicate_font_assets() {
        let dup = Uuid::from_u128(1);
        let manifest = Manifest {
            schema_version: 1,
            name: "DupFonts".to_string(),
            page_order: vec![],
            font_assets: vec![dup, dup],
            fonts: Vec::new(),
        };
        let err = manifest.validate().unwrap_err();
        assert!(
            err.to_string()
                .contains("duplicate UUID in manifest font_assets"),
            "expected duplicate font UUID error, got: {err}"
        );
    }

    /// When a subsequent save replaces one custom font with a different one,
    /// `write_prepared_save` must: write the new `<uuid_new>.ttf` AND remove
    /// the stale `<uuid_old>.ttf`.
    #[tokio::test]
    async fn test_write_prepared_save_removes_stale_font_files() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("stale_fonts.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let uuid_old = Uuid::from_u128(8001);
        let uuid_new = Uuid::from_u128(8002);

        // ── First save: write uuid_old ────────────────────────────────────
        let mut doc1 = Document::new("FontStale".to_string());
        let entry_old = sigil_core::FontEntry::new(
            uuid_old,
            "OldFamily".to_string(),
            "OldFamily-Regular".to_string(),
            sigil_core::FontSource::Custom {
                asset_uuid: uuid_old,
            },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry old is valid");
        doc1.font_table_mut().add(entry_old).expect("add old entry");

        let font_bytes_old = HashMap::from([(uuid_old, vec![0xAAu8; 16])]);
        let prepared_old = prepare_save(&doc1, &font_bytes_old).expect("prepare_save old");
        write_prepared_save(&prepared_old, &workfile_path)
            .await
            .expect("write_prepared_save old");

        // Verify uuid_old.ttf is present after the first save.
        let fonts_dir = workfile_path.join("fonts");
        let old_path = fonts_dir.join(format!("{uuid_old}.ttf"));
        assert!(
            tokio::fs::metadata(&old_path).await.is_ok(),
            "uuid_old.ttf must exist after first save"
        );

        // ── Second save: replace with uuid_new ───────────────────────────
        let mut doc2 = Document::new("FontStale".to_string());
        let entry_new = sigil_core::FontEntry::new(
            uuid_new,
            "NewFamily".to_string(),
            "NewFamily-Regular".to_string(),
            sigil_core::FontSource::Custom {
                asset_uuid: uuid_new,
            },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry new is valid");
        doc2.font_table_mut().add(entry_new).expect("add new entry");

        let font_bytes_new = HashMap::from([(uuid_new, vec![0xBBu8; 16])]);
        let prepared_new = prepare_save(&doc2, &font_bytes_new).expect("prepare_save new");
        write_prepared_save(&prepared_new, &workfile_path)
            .await
            .expect("write_prepared_save new");

        let new_path = fonts_dir.join(format!("{uuid_new}.ttf"));
        assert!(
            tokio::fs::metadata(&new_path).await.is_ok(),
            "uuid_new.ttf must exist after second save"
        );
        assert!(
            tokio::fs::metadata(&old_path).await.is_err(),
            "uuid_old.ttf must be removed as a stale font after second save"
        );
    }

    /// When a document sheds ALL its custom fonts, `write_prepared_save` must
    /// remove every `.ttf` file from the `fonts/` directory, even though
    /// `prepared.font_assets` is empty. This directly exercises the bug fixed
    /// in Finding 1: the stale-cleanup pass must run unconditionally when
    /// `fonts/` exists on disk, regardless of whether the current save has fonts.
    #[tokio::test]
    async fn test_write_prepared_save_removes_all_fonts_when_none_remain() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("all_fonts_removed.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let uuid_orphan = Uuid::from_u128(9001);

        // ── First save: establish a font on disk ─────────────────────────
        let mut doc_with_font = Document::new("ShedAll".to_string());
        let entry = sigil_core::FontEntry::new(
            uuid_orphan,
            "OrphanFamily".to_string(),
            "OrphanFamily-Regular".to_string(),
            sigil_core::FontSource::Custom {
                asset_uuid: uuid_orphan,
            },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry is valid");
        doc_with_font
            .font_table_mut()
            .add(entry)
            .expect("add entry");

        let font_bytes = HashMap::from([(uuid_orphan, vec![0xCCu8; 8])]);
        let prepared_with_font =
            prepare_save(&doc_with_font, &font_bytes).expect("prepare_save with font");
        write_prepared_save(&prepared_with_font, &workfile_path)
            .await
            .expect("write_prepared_save with font");

        // Verify the font is on disk before the second save.
        let fonts_dir = workfile_path.join("fonts");
        let orphan_path = fonts_dir.join(format!("{uuid_orphan}.ttf"));
        assert!(
            tokio::fs::metadata(&orphan_path).await.is_ok(),
            "orphan.ttf must exist before the second save"
        );

        // ── Second save: document has NO fonts (font_assets == []) ───────
        let doc_no_fonts = Document::new("ShedAll".to_string());
        let prepared_no_fonts =
            prepare_save(&doc_no_fonts, &HashMap::new()).expect("prepare_save no fonts");
        assert!(
            prepared_no_fonts.font_assets.is_empty(),
            "PreparedSave.font_assets must be empty when document has no fonts"
        );

        write_prepared_save(&prepared_no_fonts, &workfile_path)
            .await
            .expect("write_prepared_save no fonts");

        // The orphaned .ttf must now be gone.
        assert!(
            tokio::fs::metadata(&orphan_path).await.is_err(),
            "orphaned uuid_orphan.ttf must be removed when document has no fonts on second save"
        );

        // Confirm no .ttf files remain in fonts/.
        let mut entries = tokio::fs::read_dir(&fonts_dir)
            .await
            .expect("read fonts dir");
        while let Some(e) = entries.next_entry().await.expect("next entry") {
            let name = e.file_name().to_string_lossy().into_owned();
            assert!(
                !name.ends_with(".ttf"),
                "no .ttf files should remain after all-fonts-removed save, found: {name}"
            );
        }
    }

    // ── Part A: load_font_assets tests ────────────────────────────────────────

    /// A workfile with a `Custom` FontEntry whose bytes are persisted in
    /// `fonts/<uuid>.ttf` must round-trip: after `prepare_save` + `write` + `load`,
    /// `loaded.font_bytes` contains exactly the original bytes, and the FontEntry
    /// is still in the document's font table.
    #[tokio::test]
    async fn test_load_workfile_round_trips_embedded_font_bytes() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("fontroundtrip.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let id = Uuid::from_u128(700);
        let font_data = vec![9u8, 8, 7, 6, 5];

        // Build a document with one Custom font entry.
        let mut doc = Document::new("FontRoundTrip".to_string());
        let entry = sigil_core::FontEntry::new(
            id,
            "TestFont".to_string(),
            "TestFont-Regular".to_string(),
            sigil_core::FontSource::Custom { asset_uuid: id },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry is valid");
        doc.font_table_mut().add(entry).expect("add font entry");

        // Save the document with font bytes.
        let font_bytes_map = HashMap::from([(id, font_data.clone())]);
        let prepared = prepare_save(&doc, &font_bytes_map).expect("prepare_save");
        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write_prepared_save");

        // Reload — font bytes must survive; font table persistence is in Task 12.
        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load_workfile round-trip");

        assert_eq!(
            loaded.font_bytes.get(&id),
            Some(&font_data),
            "loaded.font_bytes must contain the exact original bytes"
        );
    }

    /// A `.ttf` file whose UUID is NOT listed in `manifest.font_assets` is an
    /// orphan. `load_workfile` must succeed and NOT include the orphan in
    /// `loaded.font_bytes`.
    #[tokio::test]
    async fn test_load_workfile_ignores_orphan_font_file() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("orphan.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        // Save an empty document (no fonts in manifest).
        let doc = Document::new("Orphan".to_string());
        let prepared = prepare_save(&doc, &HashMap::new()).expect("prepare_save");
        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write_prepared_save");

        // Manually plant an orphan font file that is NOT referenced in the manifest.
        let orphan_uuid = Uuid::from_u128(999_999);
        let fonts_dir = workfile_path.join("fonts");
        tokio::fs::create_dir_all(&fonts_dir)
            .await
            .expect("create fonts dir");
        tokio::fs::write(
            fonts_dir.join(format!("{orphan_uuid}.ttf")),
            b"orphan bytes",
        )
        .await
        .expect("write orphan ttf");

        // Load must succeed, and the orphan must NOT appear in font_bytes.
        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load_workfile must succeed even with orphan");

        assert!(
            !loaded.font_bytes.contains_key(&orphan_uuid),
            "orphan .ttf not in manifest must be excluded from loaded.font_bytes"
        );
    }

    /// A `.ttf` file in `fonts/` whose stem is NOT a valid UUID must be skipped
    /// gracefully (warned + ignored). `load_workfile` must succeed and
    /// `loaded.font_bytes` must be empty.
    #[tokio::test]
    async fn test_load_workfile_ignores_non_uuid_font_file() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("non_uuid.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        // Save an empty document (no fonts in manifest).
        let doc = Document::new("NonUuid".to_string());
        let prepared = prepare_save(&doc, &HashMap::new()).expect("prepare_save");
        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write_prepared_save");

        // Plant a .ttf file with a non-UUID stem in the fonts/ directory.
        let fonts_dir = workfile_path.join("fonts");
        tokio::fs::create_dir_all(&fonts_dir)
            .await
            .expect("create fonts dir");
        tokio::fs::write(fonts_dir.join("not-a-uuid.ttf"), b"some font bytes")
            .await
            .expect("write non-uuid ttf");

        // Load must succeed; no UUID-keyed entries must appear in font_bytes.
        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load_workfile must succeed even with non-UUID font filename");

        assert!(
            loaded.font_bytes.is_empty(),
            "non-UUID font filename must be skipped; loaded.font_bytes must be empty"
        );
    }

    /// When `manifest.font_assets` lists a UUID but the corresponding
    /// `fonts/<uuid>.ttf` file does not exist, `load_workfile` must succeed
    /// (degraded but non-fatal) and that UUID must be absent from
    /// `loaded.font_bytes`.
    #[tokio::test]
    async fn test_load_workfile_tolerates_missing_referenced_font() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("missing.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let missing_uuid = Uuid::from_u128(888_888);

        // Build a document with a Custom font entry and save it — this writes
        // fonts/<uuid>.ttf and references it in the manifest.
        let mut doc = Document::new("MissingFont".to_string());
        let entry = sigil_core::FontEntry::new(
            missing_uuid,
            "Missing".to_string(),
            "Missing-Regular".to_string(),
            sigil_core::FontSource::Custom {
                asset_uuid: missing_uuid,
            },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry is valid");
        doc.font_table_mut().add(entry).expect("add font entry");

        let font_bytes_map = HashMap::from([(missing_uuid, vec![0xAAu8; 4])]);
        let prepared = prepare_save(&doc, &font_bytes_map).expect("prepare_save");
        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write_prepared_save");

        // Now delete the font file to simulate a missing-on-disk scenario.
        tokio::fs::remove_file(
            workfile_path
                .join("fonts")
                .join(format!("{missing_uuid}.ttf")),
        )
        .await
        .expect("remove font file");

        // Load must succeed; the missing UUID must NOT be in font_bytes (degraded).
        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load_workfile must succeed when referenced font is missing");

        assert!(
            !loaded.font_bytes.contains_key(&missing_uuid),
            "missing font file must be absent from loaded.font_bytes (degraded, not fatal)"
        );
    }

    /// A font file that exceeds `MAX_EMBEDDED_FONT_BYTES` must be skipped
    /// gracefully. `load_workfile` must succeed and that UUID must be absent
    /// from `loaded.font_bytes`.
    #[tokio::test]
    async fn test_load_workfile_skips_oversize_font_file() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("oversize.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        let fat_uuid = Uuid::from_u128(777_777);

        // Build the manifest manually so it references the fat UUID.
        // We do this by saving via prepare_save with a 1-byte payload first
        // (so the manifest lists the UUID in font_assets), then overwriting
        // the file with an oversized payload before loading.
        let mut doc = Document::new("Oversize".to_string());
        let entry = sigil_core::FontEntry::new(
            fat_uuid,
            "BigFont".to_string(),
            "BigFont-Regular".to_string(),
            sigil_core::FontSource::Custom {
                asset_uuid: fat_uuid,
            },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("FontEntry is valid");
        doc.font_table_mut().add(entry).expect("add font entry");

        // Save with a tiny payload so the manifest lists the UUID.
        let font_bytes_map = HashMap::from([(fat_uuid, vec![0u8; 4])]);
        let prepared = prepare_save(&doc, &font_bytes_map).expect("prepare_save");
        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write_prepared_save");

        // Overwrite the font file with a sparse file whose length exceeds the
        // limit — this avoids allocating 32 MiB in the test runner while still
        // making the metadata size-check (and the post-read guard) fire.
        let fat_path = workfile_path.join("fonts").join(format!("{fat_uuid}.ttf"));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&fat_path)
            .expect("open font file for sparse write");
        file.set_len(sigil_core::validate::MAX_EMBEDDED_FONT_BYTES as u64 + 1)
            .expect("set_len to create sparse oversize file");

        // Load must succeed; the oversized UUID must be absent from font_bytes.
        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load_workfile must succeed even with oversized font");

        assert!(
            !loaded.font_bytes.contains_key(&fat_uuid),
            "oversized font file must be excluded from loaded.font_bytes"
        );
    }

    /// RF-001: `load_font_assets` enforces `MAX_TOTAL_EMBEDDED_FONT_BYTES` as a
    /// running sum. We plant enough per-font-cap-sized sparse font files that
    /// their total exceeds the aggregate cap; `load_workfile` must succeed
    /// (degrade, not fail) while loading no more than the cap allows — at least
    /// one font is skipped and the loaded total never exceeds the aggregate cap.
    ///
    /// Sparse files (`set_len`) keep on-disk allocation cheap; each loaded font's
    /// bytes are read into a real zeroed Vec, so peak retained memory is bounded
    /// by the aggregate cap itself (~256 MiB). This mirrors the existing
    /// oversize-skip test's sparse-file technique.
    #[tokio::test]
    async fn test_max_total_embedded_font_bytes_enforced() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("aggregate.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        // Each file is exactly the per-font cap, so each passes the per-font
        // check; the number of files makes the SUM exceed the aggregate cap.
        let per_file = sigil_core::validate::MAX_EMBEDDED_FONT_BYTES;
        let n_files = sigil_core::MAX_TOTAL_EMBEDDED_FONT_BYTES / per_file + 1; // strictly over the cap

        let mut doc = Document::new("Aggregate".to_string());
        let mut uuids = Vec::with_capacity(n_files);
        let mut font_bytes_map: HashMap<Uuid, Vec<u8>> = HashMap::new();
        for i in 0..n_files {
            let id = Uuid::from_u128(900_000 + i as u128);
            uuids.push(id);
            let entry = sigil_core::FontEntry::new(
                id,
                format!("Font{i}"),
                format!("Font{i}-Regular"),
                sigil_core::FontSource::Custom { asset_uuid: id },
                test_font_metrics(),
                0,
                sigil_core::EmbedDecision::Embed,
                false,
                vec![],
            )
            .expect("FontEntry is valid");
            doc.font_table_mut().add(entry).expect("add font entry");
            // Tiny payload so the manifest lists every UUID in font_assets.
            font_bytes_map.insert(id, vec![0u8; 4]);
        }

        let prepared = prepare_save(&doc, &font_bytes_map).expect("prepare_save");
        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write_prepared_save");

        // Sparse-resize every font file to the per-font cap.
        for id in &uuids {
            let path = workfile_path.join("fonts").join(format!("{id}.ttf"));
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .expect("open font file for sparse write");
            file.set_len(per_file as u64)
                .expect("set_len to per-font cap");
        }

        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load_workfile must succeed (degrade) under the aggregate cap");

        let loaded_total: usize = loaded.font_bytes.values().map(Vec::len).sum();
        assert!(
            loaded_total <= sigil_core::MAX_TOTAL_EMBEDDED_FONT_BYTES,
            "loaded embedded-font total {loaded_total} must not exceed the aggregate cap {}",
            sigil_core::MAX_TOTAL_EMBEDDED_FONT_BYTES
        );
        assert!(
            loaded.font_bytes.len() < n_files,
            "at least one over-aggregate font must be skipped (loaded {} of {n_files})",
            loaded.font_bytes.len()
        );
    }

    // ── Task 12 Part 1: font-table record persistence tests ──────────────────

    /// `Manifest::from_document` must exclude the bundled default entry from
    /// `manifest.fonts` — the default is re-seeded by `Document::new` on every
    /// load, so persisting it would cause a duplicate-id add on reconstruction.
    #[test]
    fn test_from_document_excludes_default_font_entry() {
        // A fresh document contains only the default entry.
        let doc = Document::new("ExcludeDefault".to_string());
        let manifest = Manifest::from_document(&doc);
        assert!(
            manifest.fonts.is_empty(),
            "manifest.fonts must be empty for a document with only the default entry; \
             the default must be excluded to prevent duplicate-id on load reconstruction"
        );
    }

    /// A full save→load round-trip must preserve font-table records for both
    /// `SystemReference` and `Custom` entries, while the bundled default entry
    /// remains present (re-seeded by `Document::new`) and is not duplicated.
    #[tokio::test]
    async fn test_manifest_round_trips_font_table_records() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("fonttable_roundtrip.sigil");
        tokio::fs::create_dir_all(&workfile_path)
            .await
            .expect("create workfile dir");

        // IDs chosen to be deterministic and distinct from all other tests.
        let sys_uuid = Uuid::from_u128(600);
        let custom_uuid = Uuid::from_u128(700);
        let font_data = vec![1u8, 2, 3, 4];

        let mut doc = Document::new("FontTableRoundTrip".to_string());

        // Add a SystemReference entry (no embedded bytes).
        let sys_entry = sigil_core::FontEntry::new(
            sys_uuid,
            "Roboto".to_string(),
            "Roboto-Regular".to_string(),
            sigil_core::FontSource::SystemReference,
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .expect("SystemReference FontEntry is valid");
        doc.font_table_mut()
            .add(sys_entry)
            .expect("add Roboto entry");

        // Add a Custom entry (has embedded bytes).
        let custom_entry = sigil_core::FontEntry::new(
            custom_uuid,
            "MyFont".to_string(),
            "MyFont-Regular".to_string(),
            sigil_core::FontSource::Custom {
                asset_uuid: custom_uuid,
            },
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::Embed,
            false,
            vec![],
        )
        .expect("Custom FontEntry is valid");
        doc.font_table_mut()
            .add(custom_entry)
            .expect("add MyFont entry");

        // Save with the Custom entry's bytes provided.
        let font_bytes = HashMap::from([(custom_uuid, font_data.clone())]);
        let prepared = prepare_save(&doc, &font_bytes).expect("prepare_save");
        write_prepared_save(&prepared, &workfile_path)
            .await
            .expect("write_prepared_save");

        // Reload the workfile.
        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load_workfile round-trip");

        let loaded_doc = &loaded.document;

        // The SystemReference entry must be present with correct fields.
        let roboto = loaded_doc
            .font_table()
            .get(sys_uuid)
            .expect("Roboto SystemReference entry must be present after round-trip");
        assert_eq!(roboto.family(), "Roboto", "Roboto family must be preserved");
        assert_eq!(
            roboto.source(),
            &sigil_core::FontSource::SystemReference,
            "Roboto source must be SystemReference"
        );

        // The Custom entry must be present with correct fields.
        let myfont = loaded_doc
            .font_table()
            .get(custom_uuid)
            .expect("MyFont Custom entry must be present after round-trip");
        assert_eq!(myfont.family(), "MyFont", "MyFont family must be preserved");
        assert_eq!(
            myfont.source(),
            &sigil_core::FontSource::Custom {
                asset_uuid: custom_uuid
            },
            "MyFont source must be Custom with correct asset_uuid"
        );

        // The bundled default must still be present (3 total: default + Roboto + MyFont).
        assert_eq!(
            loaded_doc.font_table().len(),
            3,
            "font table must have 3 entries: default + Roboto + MyFont"
        );

        // The Custom entry's bytes must have survived the round-trip.
        assert_eq!(
            loaded.font_bytes.get(&custom_uuid),
            Some(&font_data),
            "Custom font bytes must survive the save→load round-trip"
        );
    }

    /// When a manifest's `fonts` list contains an entry with `DEFAULT_FONT_ENTRY_ID`,
    /// `load_workfile` must skip it (not error) — the default is already seeded
    /// by `Document::new` and must not be added again.
    #[tokio::test]
    async fn test_load_workfile_skips_default_in_manifest_fonts() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let workfile_path = dir.path().join("default_in_fonts.sigil");
        let pages_dir = workfile_path.join("pages");
        tokio::fs::create_dir_all(&pages_dir)
            .await
            .expect("create dirs");

        // Build a manifest that manually includes the default entry in `fonts`.
        // This represents a corrupt or hand-crafted manifest; load must recover.
        let default_entry = sigil_core::FontEntry::new(
            DEFAULT_FONT_ENTRY_ID,
            "Inter".to_string(), // family for a "default-shaped" entry
            "Inter-Regular".to_string(),
            sigil_core::FontSource::SystemReference,
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .expect("default-id entry is constructable (validate checks id separately)");

        let manifest = Manifest {
            schema_version: sigil_core::CURRENT_SCHEMA_VERSION,
            name: "DefaultInFonts".to_string(),
            page_order: vec![],
            font_assets: Vec::new(),
            fonts: vec![default_entry],
        };
        let manifest_json = serde_json::to_string_pretty(&manifest).expect("serialize manifest");
        tokio::fs::write(workfile_path.join("manifest.json"), &manifest_json)
            .await
            .expect("write manifest");

        // Load must succeed — the default entry in fonts is skipped, not errored.
        let loaded = load_workfile(&workfile_path)
            .await
            .expect("load must succeed even when fonts contains DEFAULT_FONT_ENTRY_ID");

        // The default must be present exactly once (seeded by Document::new,
        // not re-added from the manifest).
        assert_eq!(
            loaded.document.font_table().len(),
            1,
            "font table must have exactly 1 entry (the default, not double-counted)"
        );
        assert!(
            loaded
                .document
                .font_table()
                .get(DEFAULT_FONT_ENTRY_ID)
                .is_some(),
            "DEFAULT_FONT_ENTRY_ID must be present in the table"
        );
    }

    /// `Manifest::validate` must reject a `fonts` list of length
    /// `>= MAX_FONTS_PER_DOCUMENT` (the bundled default entry takes one slot,
    /// so at most `MAX - 1` non-default entries are allowed). It must also
    /// accept exactly `MAX - 1` entries (the maximum allowed), and reject
    /// duplicate IDs.
    #[test]
    fn test_manifest_validate_rejects_invalid_fonts_field() {
        // ── BOUNDARY: exactly MAX entries → Err (>= check) ──────────────────
        let make_entry = |i: u128| {
            sigil_core::FontEntry::new(
                Uuid::from_u128(i + 10_000),
                format!("Family{i}"),
                format!("Family{i}-Regular"),
                sigil_core::FontSource::SystemReference,
                test_font_metrics(),
                0,
                sigil_core::EmbedDecision::ReferenceSystem,
                false,
                vec![],
            )
            .expect("entry is valid")
        };

        let at_max: Vec<sigil_core::FontEntry> = (0..(sigil_core::MAX_FONTS_PER_DOCUMENT as u128))
            .map(make_entry)
            .collect();
        let manifest_at_max = Manifest {
            schema_version: 1,
            name: "AtMaxFonts".to_string(),
            page_order: vec![],
            font_assets: Vec::new(),
            fonts: at_max,
        };
        let err = manifest_at_max.validate().unwrap_err();
        assert!(
            err.to_string().contains("exceeds maximum fonts"),
            "expected exceeds-maximum error for fonts at boundary (==MAX), got: {err}"
        );

        // ── BOUNDARY: exactly MAX - 1 entries → Ok ──────────────────────────
        let at_max_minus_one: Vec<sigil_core::FontEntry> = (0
            ..((sigil_core::MAX_FONTS_PER_DOCUMENT - 1) as u128))
            .map(make_entry)
            .collect();
        let manifest_max_minus_one = Manifest {
            schema_version: 1,
            name: "MaxMinusOneFonts".to_string(),
            page_order: vec![],
            font_assets: Vec::new(),
            fonts: at_max_minus_one,
        };
        manifest_max_minus_one
            .validate()
            .expect("MAX-1 fonts entries should be accepted (leaves room for bundled default)");

        // ── Duplicate IDs ────────────────────────────────────────────────────
        let dup_id = Uuid::from_u128(99_001);
        let dup_entry_a = sigil_core::FontEntry::new(
            dup_id,
            "DupA".to_string(),
            "DupA-Regular".to_string(),
            sigil_core::FontSource::SystemReference,
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .expect("entry A is valid");
        let dup_entry_b = sigil_core::FontEntry::new(
            dup_id,
            "DupB".to_string(),
            "DupB-Regular".to_string(),
            sigil_core::FontSource::SystemReference,
            test_font_metrics(),
            0,
            sigil_core::EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .expect("entry B is valid");
        let manifest_dup = Manifest {
            schema_version: 1,
            name: "DupIds".to_string(),
            page_order: vec![],
            font_assets: Vec::new(),
            fonts: vec![dup_entry_a, dup_entry_b],
        };
        let err = manifest_dup.validate().unwrap_err();
        assert!(
            err.to_string().contains("duplicate id in manifest fonts"),
            "expected duplicate-id error for fonts, got: {err}"
        );
    }
}
