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

use std::collections::HashMap;
use std::path::Path;

use agent_designer_core::serialize::{
    SerializedPage, deserialize_page, page_to_serialized, serialize_page,
};
use agent_designer_core::{Document, Node, NodeId, Page, PageId};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
            schema_version: agent_designer_core::CURRENT_SCHEMA_VERSION,
            name: doc.metadata.name.clone(),
            page_order: doc.pages.iter().map(|p| p.id.uuid()).collect(),
        }
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
        let filename = sanitize_filename(&page.name);
        pages.push((filename, json));
    }

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

/// Loads a workfile from a `.sigil/` directory into a [`Document`].
///
/// Reads `manifest.json` for metadata, then loads each page from `pages/`.
/// Pages are reordered to match the manifest's `page_order`.
///
/// # Errors
///
/// Returns an error if the directory doesn't exist, the manifest is invalid,
/// or any page file fails to parse.
pub async fn load_workfile(workfile_path: &Path) -> Result<Document> {
    let meta = tokio::fs::metadata(workfile_path)
        .await
        .with_context(|| format!("workfile path not found: {}", workfile_path.display()))?;
    if !meta.is_dir() {
        bail!(
            "workfile path is not a directory: {}",
            workfile_path.display()
        );
    }

    // Read manifest
    let manifest_path = workfile_path.join("manifest.json");
    let manifest_json = tokio::fs::read_to_string(&manifest_path)
        .await
        .context("failed to read manifest.json")?;
    let manifest: Manifest =
        serde_json::from_str(&manifest_json).context("failed to parse manifest.json")?;

    let mut doc = Document::new(manifest.name.clone());

    // Load pages from the pages/ directory
    let pages_dir = workfile_path.join("pages");
    if tokio::fs::metadata(&pages_dir).await.is_ok() {
        let mut entries = tokio::fs::read_dir(&pages_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                let json = tokio::fs::read_to_string(&path)
                    .await
                    .with_context(|| format!("failed to read page: {}", path.display()))?;
                let serialized_page = deserialize_page(&json).map_err(|e| {
                    anyhow::anyhow!("failed to deserialize {}: {e}", path.display())
                })?;
                load_page_into_document(&mut doc, &serialized_page)?;
            }
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

    Ok(doc)
}

/// Reconstructs a page and its nodes from a [`SerializedPage`] into the document.
///
/// Nodes are deserialized through `Node`'s custom `Deserialize` impl (which
/// validates on construction). Parent-child relationships and page root nodes
/// are reconstructed from the UUID references in the serialized data.
fn load_page_into_document(doc: &mut Document, serialized: &SerializedPage) -> Result<()> {
    let page_id = PageId::new(serialized.id);
    let page = Page::new(page_id, serialized.name.clone());
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
            agent_designer_core::tree::add_child(&mut doc.arena, parent_id, node_id)
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
    for st in &serialized.transitions {
        let Some(&source_id) = uuid_to_id.get(&st.source_node) else {
            continue; // Source not in this page — skip
        };

        let transition = agent_designer_core::Transition {
            id: st.id,
            source_node: source_id,
            target_page: PageId::new(st.target_page),
            target_node: st
                .target_node
                .and_then(|uuid| uuid_to_id.get(&uuid).copied()),
            trigger: st.trigger.clone(),
            animation: st.animation.clone(),
        };
        doc.add_transition(transition)
            .map_err(|e| anyhow::anyhow!("failed to add transition: {e}"))?;
    }

    Ok(())
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

/// Sanitizes a string for use as a filename.
///
/// Replaces any character that is not alphanumeric, `-`, or `_` with `_`,
/// then lowercases the result.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_designer_core::NodeKind;

    #[test]
    fn test_manifest_from_document_captures_name_and_version() {
        let doc = Document::new("Test Project".to_string());
        let manifest = Manifest::from_document(&doc);
        assert_eq!(manifest.name, "Test Project");
        assert!(manifest.page_order.is_empty());
        assert_eq!(
            manifest.schema_version,
            agent_designer_core::CURRENT_SCHEMA_VERSION
        );
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

    #[test]
    fn test_sanitize_filename_replaces_unsafe_chars() {
        assert_eq!(sanitize_filename("Home Page"), "home_page");
        assert_eq!(sanitize_filename("my-page_1"), "my-page_1");
        assert_eq!(sanitize_filename("../../etc"), "______etc");
        assert_eq!(sanitize_filename("Page/With\\Slashes"), "page_with_slashes");
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

        let loaded = load_workfile(&workfile_path).await.expect("load workfile");
        assert_eq!(loaded.metadata.name, "Empty Project");
        assert!(loaded.pages.is_empty());
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
        doc.add_page(Page::new(page_id, "Home".to_string()))
            .expect("add page");

        // Add a frame node
        let node = Node::new(
            NodeId::new(0, 0),
            Uuid::new_v4(),
            NodeKind::Frame { layout: None },
            "Frame 1".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert node");
        doc.add_root_node_to_page(page_id, node_id)
            .expect("add root node");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let loaded = load_workfile(&workfile_path).await.expect("load workfile");
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
        doc.add_page(Page::new(page_a_id, "Alpha".to_string()))
            .expect("add page A");
        doc.add_page(Page::new(page_b_id, "Beta".to_string()))
            .expect("add page B");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let loaded = load_workfile(&workfile_path).await.expect("load workfile");
        assert_eq!(loaded.pages.len(), 2);
        assert_eq!(loaded.pages[0].name, "Alpha");
        assert_eq!(loaded.pages[1].name, "Beta");
    }

    #[test]
    fn test_prepare_save_serializes_pages() {
        let mut doc = Document::new("Prepared".to_string());
        let page_id = PageId::new(Uuid::new_v4());
        doc.add_page(Page::new(page_id, "Page One".to_string()))
            .expect("add page");

        let prepared = prepare_save(&doc).expect("prepare save");
        assert_eq!(prepared.pages.len(), 1);
        assert_eq!(prepared.pages[0].0, "page_one"); // sanitized filename
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
        doc.add_page(Page::new(page_id, "Main".to_string()))
            .expect("add page");

        // Create parent frame
        let parent = Node::new(
            NodeId::new(0, 0),
            Uuid::new_v4(),
            NodeKind::Frame { layout: None },
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
                corner_radii: [0.0; 4],
            },
            "Child".to_string(),
        )
        .expect("create child");
        let child_id = doc.arena.insert(child).expect("insert child");
        agent_designer_core::tree::add_child(&mut doc.arena, parent_id, child_id)
            .expect("add child");

        save_workfile(&doc, &workfile_path)
            .await
            .expect("save workfile");

        let loaded = load_workfile(&workfile_path).await.expect("load workfile");

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
}
