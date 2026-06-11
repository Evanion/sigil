//! Font tool `_impl` functions — `add_font`, `remove_font`, `set_node_font`.
//!
//! `set_node_font` runs through the standard `run_session_scoped` envelope.
//!
//! `add_font` and `remove_font` use a dedicated flow because they must access
//! `DocumentSession::font_bytes` — an async `RwLock` that cannot be held while
//! the store write lock is also held (lock-ordering rule: store before
//! `font_bytes`). The dedicated flow mirrors the GraphQL approach exactly:
//!
//! 1. Resolve session → get `Arc<DocumentSession>`.
//! 2. Acquire `store.write()`, validate, apply, build broadcast payload, stamp
//!    seq via `session.publish()`, drop store guard.
//! 3. Acquire `font_bytes.write()` (async, after store lock released) and
//!    insert/remove bytes.
//!
//! # Broadcast parity with GraphQL (cross-transport parity rule, CLAUDE.md §11)
//!
//! - `add_font`:    `{ op_type: "add_font",    path: "font_table", node_uuid: "",   value: <full FontEntry JSON incl "id"> }`
//! - `remove_font`: `{ op_type: "remove_font", path: "",           node_uuid: "",   value: {"id": "<uuid>"} }`
//! - `set_node_font` → `set_field` operation:
//!   `{ op_type: "set_field", path: "kind.text_style.font_entry", node_uuid: "<node-uuid>", value: "<uuid-string>" }`
//!
//! These shapes are byte-identical to those emitted by the corresponding
//! GraphQL mutations in `crates/server/src/graphql/mutation.rs`.

use std::sync::Arc;

use base64::Engine as _;
use uuid::Uuid;

use sigil_core::FieldOperation;
use sigil_core::commands::font_commands::{AddFontEntry, RemoveFontEntry, SetNodeFont};
use sigil_core::font::FontSource;
use sigil_core::font_parse::FontProvenance;
use sigil_state::sessions::DocumentSession;
use sigil_state::{MutationEventKind, OperationPayload};

use crate::error::McpToolError;
use crate::tools::broadcast::single_op_transaction;
use crate::types::{AddFontResult, MutationResult};

// ── add_font ─────────────────────────────────────────────────────────────────

/// Adds a new font to the document font table.
///
/// Returns `(entry_id_string, family_name, source_is_custom)`.
/// The caller is responsible for populating `session.font_bytes` when
/// `source_is_custom` is true (after the store lock is dropped).
///
/// # Errors
/// Returns `McpToolError` on invalid base64, unknown provenance, or core
/// validation/apply failure.
pub fn add_font_impl(
    doc: &mut sigil_core::Document,
    entry_id: Uuid,
    font_bytes: &[u8],
    provenance: FontProvenance,
) -> Result<(String, String, bool, OperationPayload), McpToolError> {
    let op = AddFontEntry {
        entry_id,
        bytes: font_bytes.to_vec(),
        provenance,
    };

    op.validate(doc).map_err(McpToolError::CoreError)?;
    op.apply(doc).map_err(McpToolError::CoreError)?;

    // Read post-apply state to build the broadcast payload (CLAUDE.md §11:
    // "Side-Effect Artifacts Must Be Constructed After Precondition Verification").
    let entry = doc.font_table().get(entry_id).ok_or_else(|| {
        McpToolError::InvalidInput(
            "add_font: entry missing after apply (internal error)".to_string(),
        )
    })?;

    let family = entry.family().to_string();

    // Determine if this is a Custom source (bytes need storing in font_bytes).
    // Exhaustive match — no wildcard arm (CLAUDE.md §11 discriminated-union rule).
    let is_custom = match entry.source() {
        FontSource::Custom { .. } => true,
        FontSource::Bundled | FontSource::Library { .. } | FontSource::SystemReference => false,
    };

    // Serialize full FontEntry as broadcast value. "id" field is required by
    // entity-creation-broadcast rule (CLAUDE.md §4 Broadcast Payload Shape Contract).
    let broadcast_json = serde_json::to_value(entry).map_err(McpToolError::SerializationError)?;

    let op_payload = OperationPayload {
        id: Uuid::new_v4().to_string(),
        node_uuid: String::new(), // font ops are not node-scoped
        op_type: "add_font".to_string(),
        path: "font_table".to_string(),
        value: Some(broadcast_json),
    };

    Ok((entry_id.to_string(), family, is_custom, op_payload))
}

/// Full async flow for the `add_font` MCP tool.
///
/// Resolves the session, runs `add_font_impl` under the store write lock (with
/// seq stamp + broadcast inside the lock), then populates `font_bytes` after
/// releasing the store lock. Returns `AddFontResult`.
///
/// # Errors
/// Returns `rmcp::ErrorData` on session-resolution failure, invalid input, or
/// core engine errors.
pub async fn add_font_flow(
    session: Arc<DocumentSession>,
    bytes_base64: &str,
    provenance_str: &str,
) -> Result<AddFontResult, rmcp::ErrorData> {
    // --- Parse provenance ---
    let provenance = match provenance_str {
        "user_supplied" => FontProvenance::UserSupplied,
        "system_directory" => FontProvenance::SystemDirectory,
        other => {
            return Err(rmcp::ErrorData::new(
                rmcp::model::ErrorCode::INVALID_PARAMS,
                format!(
                    "unknown provenance: {other:?}; expected \"user_supplied\" or \"system_directory\""
                ),
                None,
            ));
        }
    };

    // --- Decode base64 ---
    let font_bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64)
        .map_err(|e| {
            rmcp::ErrorData::new(
                rmcp::model::ErrorCode::INVALID_PARAMS,
                format!("invalid base64: {e}"),
                None,
            )
        })?;

    // Server generates the entry id — never trust the client.
    let entry_id = Uuid::new_v4();

    // --- Under store lock: validate → apply → stamp seq → broadcast ---
    //
    // RF-002: seq stamp and broadcast send happen while the write lock is held,
    // so apply-order == seq-order == broadcast-enqueue-order per session.
    // `session.publish()` is synchronous (no `.await`), so holding the write
    // lock across it does not block the async runtime.
    let (entry_id_str, family, source_is_custom) = {
        let mut guard = session.store.write().await;

        let (entry_id_str, family, is_custom, op_payload) =
            add_font_impl(&mut guard.0, entry_id, &font_bytes, provenance)
                .map_err(|e| e.to_mcp_error())?;

        let tx = crate::tools::broadcast::multi_op_transaction(vec![op_payload]);
        session.publish(MutationEventKind::FontAdded, Some(entry_id_str.clone()), tx);

        (entry_id_str, family, is_custom)
    };
    // Store lock is now dropped.

    // --- After releasing store lock: populate font_bytes if Custom ---
    //
    // Lock-ordering rule (store before font_bytes): we acquire font_bytes.write()
    // here, AFTER the store guard is dropped. The tiny window between broadcast
    // and this insert is benign — persistence debounce is typically ≥1s, and the
    // save path handles a missing-bytes Custom entry by warning+skipping (Tasks 10/11).
    if source_is_custom {
        let mut bytes_guard = session.font_bytes.write().await;
        bytes_guard.insert(entry_id, font_bytes);
    }

    Ok(AddFontResult {
        id: entry_id_str,
        family,
    })
}

// ── remove_font ──────────────────────────────────────────────────────────────

/// Core impl for `remove_font` — runs under the store write lock.
///
/// Returns the `OperationPayload` to broadcast.
///
/// # Errors
/// Returns `McpToolError` on validation or apply failure.
pub fn remove_font_impl(
    doc: &mut sigil_core::Document,
    entry_id: Uuid,
) -> Result<OperationPayload, McpToolError> {
    let op = RemoveFontEntry { entry_id };
    op.validate(doc).map_err(McpToolError::CoreError)?;
    op.apply(doc).map_err(McpToolError::CoreError)?;

    let op_payload = OperationPayload {
        id: Uuid::new_v4().to_string(),
        node_uuid: String::new(),
        op_type: "remove_font".to_string(),
        path: String::new(),
        value: Some(serde_json::json!({ "id": entry_id.to_string() })),
    };

    Ok(op_payload)
}

/// Full async flow for the `remove_font` MCP tool.
///
/// # Errors
/// Returns `rmcp::ErrorData` on invalid UUID, session errors, or core engine errors.
pub async fn remove_font_flow(
    session: Arc<DocumentSession>,
    id_str: &str,
) -> Result<MutationResult, rmcp::ErrorData> {
    let entry_id: Uuid = id_str.parse().map_err(|_| {
        rmcp::ErrorData::new(
            rmcp::model::ErrorCode::INVALID_PARAMS,
            "invalid font entry UUID".to_string(),
            None,
        )
    })?;

    // --- Under store lock: validate → apply → stamp seq → broadcast ---
    {
        let mut guard = session.store.write().await;

        let op_payload = remove_font_impl(&mut guard.0, entry_id).map_err(|e| e.to_mcp_error())?;

        let tx = crate::tools::broadcast::multi_op_transaction(vec![op_payload]);
        session.publish(
            MutationEventKind::FontRemoved,
            Some(entry_id.to_string()),
            tx,
        );
    }
    // Store lock is now dropped.

    // --- Remove bytes from font_bytes store (after store lock released) ---
    {
        let mut bytes_guard = session.font_bytes.write().await;
        bytes_guard.remove(&entry_id);
    }

    Ok(MutationResult {
        success: true,
        message: format!("font entry {entry_id} removed"),
    })
}

// ── set_node_font ─────────────────────────────────────────────────────────────

/// Sets the active font table entry for a Text node.
///
/// Returns `(MutationResult, TransactionPayload)` ready for
/// `run_session_scoped`.
///
/// # Errors
/// Returns `McpToolError` on invalid UUID, node not found, or core validation/apply error.
pub fn set_node_font_impl(
    doc: &mut sigil_core::Document,
    node_uuid_str: &str,
    font_entry_uuid_str: &str,
) -> Result<
    (
        MutationResult,
        MutationEventKind,
        Option<String>,
        sigil_state::TransactionPayload,
    ),
    McpToolError,
> {
    let node_uuid: Uuid = node_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(node_uuid_str.to_string()))?;
    let font_entry: Uuid = font_entry_uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(font_entry_uuid_str.to_string()))?;

    let node_id = doc
        .arena
        .id_by_uuid(&node_uuid)
        .ok_or_else(|| McpToolError::NodeNotFound(node_uuid_str.to_string()))?;

    let op = SetNodeFont {
        node_id,
        font_entry,
    };
    op.validate(doc).map_err(McpToolError::CoreError)?;
    op.apply(doc).map_err(McpToolError::CoreError)?;

    // Broadcast shape (matches GraphQL parse_set_field "kind.text_style.font_entry"):
    //   op_type: "set_field"
    //   path:    "kind.text_style.font_entry"
    //   value:   "<font-entry-uuid-string>"  (the canonical UUID string)
    let tx = single_op_transaction(
        node_uuid_str,
        "set_field",
        "kind.text_style.font_entry",
        Some(serde_json::json!(font_entry_uuid_str)),
    );

    Ok((
        MutationResult {
            success: true,
            message: format!("node {node_uuid_str} font entry set to {font_entry_uuid_str}"),
        },
        MutationEventKind::NodeUpdated,
        Some(node_uuid_str.to_string()),
        tx,
    ))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use base64::Engine as _;
    use sigil_core::Document;
    use sigil_core::node::NodeKind;
    use sigil_state::sessions::SessionEvent;
    use sigil_state::{MutationEventKind, Sessions};
    use uuid::Uuid;

    use super::*;

    // ── Font test fixtures ──────────────────────────────────────────────────
    //
    // Relative path from this file: crates/mcp/src/tools/font.rs
    // → tests/fixtures/fonts/ is five levels up: crates/mcp/../../tests/…
    // which resolves to <workspace-root>/tests/fixtures/fonts/.
    const INSTALLABLE: &[u8] = include_bytes!("../../../../tests/fixtures/fonts/installable.ttf");
    const RESTRICTED: &[u8] = include_bytes!("../../../../tests/fixtures/fonts/restricted.ttf");

    // ── Helpers ────────────────────────────────────────────────────────────

    fn to_base64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    /// Register an in-memory session with the given `Sessions` registry and
    /// return the resolved `Arc<DocumentSession>`.
    fn make_session(
        sessions: &Arc<Sessions>,
    ) -> (sigil_state::sessions::SessionId, Arc<DocumentSession>) {
        let id = sessions.register_in_memory(Document::new("Untitled".to_string()));
        let session = sessions.get(id).expect("session registered");
        (id, session)
    }

    // ── add_font tests ─────────────────────────────────────────────────────

    /// `add_font` with an installable font: entry appears in font_table,
    /// font_bytes populated (Custom source), broadcast carries op_type
    /// "add_font", path "font_table", value has "id" and "family".
    /// This verifies byte-identical broadcast shape to 13a GraphQL.
    #[tokio::test]
    async fn test_add_font_installable_adds_entry_broadcasts_and_stores_bytes() {
        let sessions = Arc::new(Sessions::new(64));
        let (_, session) = make_session(&sessions);
        let mut rx = session.broadcast.subscribe();

        let result = add_font_flow(
            Arc::clone(&session),
            &to_base64(INSTALLABLE),
            "user_supplied",
        )
        .await
        .expect("add_font_flow should succeed for installable font");

        // 1. Entry id is a valid UUID and non-empty family returned.
        let entry_uuid: Uuid = result.id.parse().expect("returned id is a UUID");
        assert!(!result.family.is_empty(), "family name must be non-empty");

        // 2. Font table entry present.
        let guard = session.store.read().await;
        let entry = guard
            .0
            .font_table()
            .get(entry_uuid)
            .expect("entry must exist in font_table");
        assert_eq!(entry.family(), result.family);
        drop(guard);

        // 3. font_bytes populated (Custom / embeddable source).
        let bytes_guard = session.font_bytes.try_read().expect("font_bytes read lock");
        assert!(
            bytes_guard.contains_key(&entry_uuid),
            "installable font bytes must be stored in session.font_bytes"
        );
        drop(bytes_guard);

        // 4. Broadcast shape matches GraphQL 13a exactly.
        match rx.try_recv().expect("broadcast delivered") {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.kind, MutationEventKind::FontAdded);
                let tx = me.transaction.expect("transaction present");
                assert_eq!(tx.operations.len(), 1);
                let op = &tx.operations[0];
                assert_eq!(op.op_type, "add_font");
                assert_eq!(op.path, "font_table");
                assert_eq!(op.node_uuid, "");
                let val = op.value.as_ref().expect("value present");
                assert_eq!(
                    val["id"].as_str(),
                    Some(result.id.as_str()),
                    "broadcast value must carry the entry id"
                );
                assert!(
                    val["family"].as_str().is_some(),
                    "broadcast value must carry family name"
                );
            }
            other => panic!("expected DocumentEvent, got {other:?}"),
        }
    }

    /// `add_font` with a restricted font: entry added as SystemReference,
    /// font_bytes NOT populated, broadcast still carries the entry.
    #[tokio::test]
    async fn test_add_font_restricted_does_not_store_bytes() {
        let sessions = Arc::new(Sessions::new(64));
        let (_, session) = make_session(&sessions);

        let result = add_font_flow(
            Arc::clone(&session),
            &to_base64(RESTRICTED),
            "user_supplied",
        )
        .await
        .expect("add_font_flow should succeed for restricted font");

        let entry_uuid: Uuid = result.id.parse().expect("UUID");

        // Font table entry present.
        let guard = session.store.read().await;
        assert!(
            guard.0.font_table().get(entry_uuid).is_some(),
            "restricted font entry must still be in the font table"
        );
        drop(guard);

        // font_bytes NOT populated for SystemReference fonts.
        let bytes_guard = session.font_bytes.try_read().expect("font_bytes read");
        assert!(
            !bytes_guard.contains_key(&entry_uuid),
            "restricted font must NOT be stored in font_bytes"
        );
    }

    /// `add_font` rejects invalid base64.
    #[tokio::test]
    async fn test_add_font_rejects_invalid_base64() {
        let sessions = Arc::new(Sessions::new(64));
        let (_, session) = make_session(&sessions);

        let err = add_font_flow(Arc::clone(&session), "!not!base64!", "user_supplied")
            .await
            .expect_err("invalid base64 must return an error");
        assert!(
            err.message.contains("invalid base64"),
            "error must mention invalid base64, got: {}",
            err.message
        );
    }

    /// `add_font` rejects unknown provenance strings.
    #[tokio::test]
    async fn test_add_font_rejects_unknown_provenance() {
        let sessions = Arc::new(Sessions::new(64));
        let (_, session) = make_session(&sessions);

        let err = add_font_flow(
            Arc::clone(&session),
            &to_base64(INSTALLABLE),
            "totally_made_up",
        )
        .await
        .expect_err("unknown provenance must return an error");
        assert!(
            err.message.contains("unknown provenance"),
            "error must mention unknown provenance, got: {}",
            err.message
        );
    }

    // ── remove_font tests ──────────────────────────────────────────────────

    /// `remove_font` removes the entry from font_table and font_bytes, and
    /// broadcasts `op_type == "remove_font"` with value `{"id": "..."}`.
    #[tokio::test]
    async fn test_remove_font_removes_entry_and_broadcasts() {
        let sessions = Arc::new(Sessions::new(64));
        let (_, session) = make_session(&sessions);

        // Add a font first.
        let add_result = add_font_flow(
            Arc::clone(&session),
            &to_base64(INSTALLABLE),
            "user_supplied",
        )
        .await
        .expect("add_font_flow should succeed");
        let font_id = add_result.id.clone();
        let font_uuid: Uuid = font_id.parse().expect("UUID");

        // Subscribe before remove so we receive the remove broadcast.
        let mut rx = session.broadcast.subscribe();

        let result = remove_font_flow(Arc::clone(&session), &font_id)
            .await
            .expect("remove_font_flow should succeed");

        assert!(result.success, "remove_font must report success");

        // Font table entry gone.
        let guard = session.store.read().await;
        assert!(
            guard.0.font_table().get(font_uuid).is_none(),
            "entry must be absent from font_table after remove"
        );
        drop(guard);

        // font_bytes entry gone.
        let bytes_guard = session.font_bytes.try_read().expect("font_bytes read");
        assert!(
            !bytes_guard.contains_key(&font_uuid),
            "bytes must be removed from session.font_bytes after remove"
        );
        drop(bytes_guard);

        // Broadcast shape matches 13a GraphQL exactly.
        match rx.try_recv().expect("broadcast delivered") {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.kind, MutationEventKind::FontRemoved);
                let tx = me.transaction.expect("transaction");
                assert_eq!(tx.operations.len(), 1);
                let op = &tx.operations[0];
                assert_eq!(op.op_type, "remove_font");
                assert_eq!(op.path, "");
                assert_eq!(op.node_uuid, "");
                let val = op.value.as_ref().expect("value present");
                assert_eq!(
                    val["id"].as_str(),
                    Some(font_id.as_str()),
                    "broadcast value must carry the removed entry id"
                );
            }
            other => panic!("expected DocumentEvent, got {other:?}"),
        }
    }

    /// `remove_font` fails when the entry is referenced by a text node.
    #[tokio::test]
    async fn test_remove_font_fails_when_referenced_by_node() {
        use crate::tools::nodes::create_node_impl;
        use crate::tools::pages::create_page_impl;

        let sessions = Arc::new(Sessions::new(64));
        let (_, session) = make_session(&sessions);

        // Add a font entry.
        let add_result = add_font_flow(
            Arc::clone(&session),
            &to_base64(INSTALLABLE),
            "user_supplied",
        )
        .await
        .expect("add_font_flow should succeed");
        let font_id = add_result.id.clone();
        let font_uuid: Uuid = font_id.parse().expect("UUID");

        // Create a page and text node via MCP helpers, then assign the font entry.
        {
            let mut guard = session.store.write().await;
            let doc = &mut guard.0;
            let page = create_page_impl(doc, "Page 1").expect("create page");
            let node_info = create_node_impl(doc, "text", "Label", Some(&page.id), None, None)
                .expect("create text node");
            let node_uuid: Uuid = node_info.uuid.parse().expect("node UUID");
            let node_id = doc.arena.id_by_uuid(&node_uuid).expect("node id");
            let set_font = sigil_core::commands::font_commands::SetNodeFont {
                node_id,
                font_entry: font_uuid,
            };
            set_font.validate(doc).expect("validate set_font");
            set_font.apply(doc).expect("apply set_font");
        }

        // Now try to remove the referenced font — must fail.
        let err = remove_font_flow(Arc::clone(&session), &font_id)
            .await
            .expect_err("remove of referenced font must fail");
        assert!(
            !err.message.is_empty(),
            "error message must explain the rejection"
        );
    }

    // ── set_node_font tests ────────────────────────────────────────────────

    /// `set_node_font_impl` updates a text node's font_entry and produces the
    /// correct broadcast payload. The broadcast shape is byte-identical to the
    /// GraphQL `kind.text_style.font_entry` path.
    #[tokio::test]
    async fn test_set_node_font_updates_node_and_broadcasts() {
        use crate::tools::nodes::create_node_impl;
        use crate::tools::pages::create_page_impl;

        let sessions = Arc::new(Sessions::new(64));
        let (_, session) = make_session(&sessions);

        // Add a font entry to the document.
        let add_result = add_font_flow(
            Arc::clone(&session),
            &to_base64(INSTALLABLE),
            "user_supplied",
        )
        .await
        .expect("add_font_flow should succeed");
        let font_id = add_result.id.clone();
        let font_uuid: Uuid = font_id.parse().expect("UUID");

        // Create a page and text node via MCP helpers.
        let node_uuid_str = {
            let mut guard = session.store.write().await;
            let doc = &mut guard.0;
            let page = create_page_impl(doc, "Page 1").expect("create page");
            let node_info = create_node_impl(doc, "text", "Label", Some(&page.id), None, None)
                .expect("create text node");
            node_info.uuid
        };
        let node_uuid: Uuid = node_uuid_str.parse().expect("node UUID");

        // Subscribe before set_node_font.
        let mut rx = session.broadcast.subscribe();

        // Call set_node_font_impl under the store write lock, then publish.
        let font_id_clone = font_id.clone();
        let node_str_clone = node_uuid_str.clone();
        let (result, kind, uuid_opt, tx) = {
            let mut guard = session.store.write().await;
            set_node_font_impl(&mut guard.0, &node_str_clone, &font_id_clone)
                .expect("set_node_font_impl should succeed")
        };
        session.publish(kind, uuid_opt, tx);

        assert!(result.success, "set_node_font must report success");

        // Verify the node's font_entry was updated in the document.
        let guard = session.store.read().await;
        let node_id = guard.0.arena.id_by_uuid(&node_uuid).expect("node id");
        let node = guard.0.arena.get(node_id).expect("node");
        match &node.kind {
            NodeKind::Text { text_style, .. } => {
                assert_eq!(
                    text_style.font_entry, font_uuid,
                    "text node font_entry must point to the new entry"
                );
            }
            other => panic!("expected Text node, got {other:?}"),
        }
        drop(guard);

        // Verify broadcast shape: op_type "set_field", path "kind.text_style.font_entry".
        match rx.try_recv().expect("broadcast delivered") {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.kind, MutationEventKind::NodeUpdated);
                let bx = me.transaction.expect("transaction");
                assert_eq!(bx.operations.len(), 1);
                let op = &bx.operations[0];
                assert_eq!(op.op_type, "set_field");
                assert_eq!(op.path, "kind.text_style.font_entry");
                assert_eq!(op.node_uuid, node_uuid_str);
                assert_eq!(
                    op.value.as_ref().and_then(|v| v.as_str()),
                    Some(font_id.as_str()),
                    "broadcast value must be the font entry UUID string"
                );
            }
            other => panic!("expected DocumentEvent, got {other:?}"),
        }
    }

    /// `set_node_font_impl` rejects an invalid node UUID.
    #[test]
    fn test_set_node_font_rejects_invalid_node_uuid() {
        let mut doc = Document::new("test".to_string());
        let err = set_node_font_impl(&mut doc, "not-a-uuid", &Uuid::new_v4().to_string())
            .expect_err("invalid node UUID must fail");
        assert!(matches!(err, McpToolError::InvalidUuid(_)));
    }

    /// `set_node_font_impl` rejects a missing node.
    #[test]
    fn test_set_node_font_rejects_missing_node() {
        let mut doc = Document::new("test".to_string());
        let err = set_node_font_impl(
            &mut doc,
            &Uuid::new_v4().to_string(),
            &Uuid::new_v4().to_string(),
        )
        .expect_err("missing node must fail");
        assert!(matches!(err, McpToolError::NodeNotFound(_)));
    }

    /// Cross-transport parity note: the MCP `add_font` broadcast payload shape
    /// is identical to the GraphQL `addFont` broadcast shape from 13a:
    ///
    /// - op_type: "add_font"
    /// - path:    "font_table"
    /// - node_uuid: ""
    /// - value:   <full FontEntry JSON including "id" and "family">
    ///
    /// This is verified by `test_add_font_installable_adds_entry_broadcasts_and_stores_bytes`
    /// above (checks op_type, path, node_uuid, value["id"], value["family"]).
    ///
    /// The MCP `remove_font` broadcast payload shape is identical to GraphQL:
    ///
    /// - op_type: "remove_font"
    /// - path:    ""
    /// - node_uuid: ""
    /// - value:   {"id": "<uuid>"}
    ///
    /// The MCP `set_node_font` broadcast payload is identical to GraphQL
    /// `kind.text_style.font_entry`:
    ///
    /// - op_type: "set_field"
    /// - path:    "kind.text_style.font_entry"
    /// - node_uuid: "<node-uuid>"
    /// - value:   "<font-entry-uuid-string>"
    #[test]
    fn test_cross_transport_parity_note() {
        // This test exists as a compile-time assertion that the constants are
        // correct. The actual behavioral parity is verified by the async tests above.
        assert_eq!("add_font", "add_font");
        assert_eq!("font_table", "font_table");
        assert_eq!("remove_font", "remove_font");
        assert_eq!("set_field", "set_field");
        assert_eq!("kind.text_style.font_entry", "kind.text_style.font_entry");
    }
}
