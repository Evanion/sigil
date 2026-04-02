//! Workfile I/O — reading and writing `.sigil/` directory structures.
//!
//! This module handles persisting the in-memory `Document` to a `.sigil/`
//! directory on disk. The save path is split into two phases to avoid holding
//! a `std::sync::Mutex` across async `.await` points:
//!
//! 1. [`prepare_save`] — synchronous, runs under the document lock, produces
//!    a [`PreparedSave`] containing all serialized JSON strings.
//! 2. [`write_prepared_save`] — async, writes the prepared data to disk.
//!
//! Task 1 (workfile load/save) will flesh out the full load path and manifest
//! types. This stub provides the minimum surface needed by the persistence task.

use std::path::Path;

use agent_designer_core::Document;
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// The workfile manifest — stored as `manifest.json` in the `.sigil/` root.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: u32,
    pub name: String,
    pub page_order: Vec<uuid::Uuid>,
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
}

/// Synchronously serializes the document into a [`PreparedSave`].
///
/// This function does no I/O and is safe to call while holding a
/// `std::sync::Mutex` guard.
///
/// # Errors
///
/// Returns an error if JSON serialization of the manifest fails.
pub fn prepare_save(doc: &Document) -> Result<PreparedSave> {
    let manifest = Manifest {
        schema_version: doc.metadata.schema_version,
        name: doc.metadata.name.clone(),
        page_order: doc.pages.iter().map(|p| p.id.uuid()).collect(),
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)?;

    // For now, pages serialization is a stub — Task 1 will implement full
    // page serialization via core's serialize_page.
    let pages = Vec::new();

    Ok(PreparedSave {
        manifest_json,
        pages,
    })
}

/// Writes a [`PreparedSave`] to the `.sigil/` directory on disk.
///
/// This is the async half of the save pipeline. Call [`prepare_save`] first
/// (under the document lock), then call this function after releasing the lock.
///
/// # Errors
///
/// Returns an error if directory creation or file writes fail.
pub async fn write_prepared_save(prepared: &PreparedSave, workfile_path: &Path) -> Result<()> {
    let pages_dir = workfile_path.join("pages");
    tokio::fs::create_dir_all(&pages_dir).await?;

    // Write manifest
    tokio::fs::write(workfile_path.join("manifest.json"), &prepared.manifest_json).await?;

    // Write each page
    for (filename, json) in &prepared.pages {
        tokio::fs::write(pages_dir.join(format!("{filename}.json")), json).await?;
    }

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
pub async fn save_workfile(doc: &Document, workfile_path: &Path) -> Result<()> {
    let prepared = prepare_save(doc)?;
    write_prepared_save(&prepared, workfile_path).await
}
