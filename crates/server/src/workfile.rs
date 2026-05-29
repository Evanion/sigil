//! Workfile I/O — reading and writing `.sigil/` directory structures.
//!
//! A workfile is a directory with the `.sigil/` suffix containing:
//! - `manifest.json` — document metadata and page ordering
//! - `pages/*.json` — individual page files (serialized via core's serialize API)
//!
//! The save path is split into two phases to avoid holding a `std::sync::Mutex`
//! across async `.await` points:
//!
//! 1. [`prepare_save`] — synchronous, runs under the document lock, produces
//!    a [`PreparedSave`] containing all serialized JSON strings.
//! 2. [`write_prepared_save`] — async, writes the prepared data to disk.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sigil_core::serialize::{
    SerializedPage, deserialize_page_with_version, page_to_serialized, serialize_page,
};
use sigil_core::{Document, Node, NodeId, Page, PageId};
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
}

impl Manifest {
    /// Creates a manifest from the current document state.
    #[must_use]
    pub fn from_document(doc: &Document) -> Self {
        Self {
            schema_version: sigil_core::CURRENT_SCHEMA_VERSION,
            name: doc.metadata.name.clone(),
            page_order: doc.pages.iter().map(|p| p.id.uuid()).collect(),
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
    /// `Some(v)` if any page on disk was at schema version `v < CURRENT_SCHEMA_VERSION`
    /// and required migration. `None` if all pages were already at the current version.
    pub migrated_from: Option<u32>,
}

/// Synchronously serializes the document into a [`PreparedSave`].
///
/// This function does no I/O and is safe to call while holding a
/// `std::sync::Mutex` guard.
///
/// # Errors
///
/// Returns an error if JSON serialization of the manifest or any page fails.
pub fn prepare_save(doc: &Document) -> Result<PreparedSave> {
    let manifest = Manifest::from_document(doc);
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

/// Subdirectory under the workfile that holds an immutable copy of the original
/// pre-migration files (manifest + pages). Written exactly once on the first
/// save after a v1→current migration on load (RF-010).
const BACKUP_DIR_NAME: &str = ".backup-v1";

/// Backs up the current `manifest.json` and `pages/*.json` files to `.backup-v1/`
/// before they are overwritten by a migrated save (RF-010).
///
/// This is a one-shot operation: the function is a no-op if the backup directory
/// already exists, ensuring we never overwrite the original v1 snapshot. Each
/// file is copied via the atomic write-to-temp-then-rename pattern to prevent
/// partially-written backups on crash.
///
/// # Errors
///
/// Returns an error if reading the source files fails or writing the backup
/// fails. Errors from this function abort the save so the migration flag stays
/// armed for the next attempt.
async fn backup_v1_files(workfile_path: &Path, original_version: u32) -> Result<()> {
    let backup_root = workfile_path.join(BACKUP_DIR_NAME);

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
/// existing on-disk files to `.backup-v1/` (RF-010) so the original pre-migration
/// state is preserved. The backup is one-shot: subsequent saves skip the copy
/// if the backup directory already exists.
///
/// # Errors
///
/// Returns an error if directory creation or file writes fail.
pub async fn write_prepared_save(prepared: &PreparedSave, workfile_path: &Path) -> Result<()> {
    // RF-010: back up the original v1 files before the first migrated write.
    if let Some(original_version) = prepared.migrated_from {
        backup_v1_files(workfile_path, original_version).await?;
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
/// # Errors
///
/// Returns an error if serialization or file writes fail.
#[cfg(test)]
pub(crate) async fn save_workfile(doc: &Document, workfile_path: &Path) -> Result<()> {
    let prepared = prepare_save(doc)?;
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
                let (serialized_page, on_disk_version) = deserialize_page_with_version(&json)
                    .map_err(|e| {
                        anyhow::anyhow!("failed to deserialize {}: {e}", path.display())
                    })?;

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

    tracing::info!(
        "loaded workfile '{}' with {} pages, {} nodes",
        manifest.name,
        doc.pages.len(),
        doc.arena.len()
    );

    if let Some(v) = min_observed_version {
        tracing::info!(
            "workfile contained pages at schema v{v} (current: v{}); document was migrated on load",
            sigil_core::CURRENT_SCHEMA_VERSION
        );
    }

    Ok(LoadedWorkfile {
        document: doc,
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

        let prepared = prepare_save(&doc).expect("prepare save");
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

    /// RF-009: a v2 workfile loads with `migrated_from = None`.
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
        let mut prepared = prepare_save(&doc).expect("prepare save");
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
        let mut prepared = prepare_save(&doc).expect("prepare save");
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
        let prepared = prepare_save(&doc).expect("prepare save");
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
}
