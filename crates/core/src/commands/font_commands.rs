// crates/core/src/commands/font_commands.rs
//
// Forward-only `FieldOperation` implementations for font catalogue mutations.
//
// `AddFontEntry` parses raw font bytes, classifies the embedding rights, and
// inserts a new `FontEntry` into the document's `FontTable`. Core is I/O-free:
// this command does not write bytes to disk. The server already holds the bytes
// (it constructs this op) and persists them separately (Tasks 11/13).
//
// `RemoveFontEntry` removes an entry from the `FontTable`, subject to
// referential-integrity and default-protection guards.
//
// `SetNodeFont` updates a Text node's `text_style.font_entry` to point at an
// existing `FontTable` entry.

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::font::{DEFAULT_FONT_ENTRY_ID, EmbedDecision, FontEntry, FontEntryId, FontSource};
use crate::font_parse::{FontProvenance, ParsedFont, classify_font};
use crate::id::NodeId;
use crate::node::NodeKind;
use crate::validate::{MAX_FONTS_PER_DOCUMENT, check_embedded_font_size};

/// Adds a new font entry to the document's `FontTable`.
///
/// The caller (server/MCP) constructs this operation via struct literal syntax
/// and calls `validate()` before `apply()`.
///
/// # Note on byte persistence
///
/// Core is I/O-free. `AddFontEntry` does NOT write font bytes anywhere. The
/// server holds the bytes (it constructs this op) and persists them separately
/// in Tasks 11 / 13. The font bytes carried here are used exclusively for
/// parsing/classification in `validate` and `apply`.
///
/// # Double-parse note
///
/// `classify_font` is intentionally called twice (once in `validate`, once in
/// `apply`) because the `FieldOperation` contract requires each method to be
/// independently callable, so the parse result cannot be cached on the struct.
/// This is O(font-size) work duplicated, which is acceptable for a
/// once-per-upload operation.
#[derive(Debug)]
pub struct AddFontEntry {
    /// Stable UUID for the new font entry (must be unique within the document).
    pub entry_id: FontEntryId,
    /// Raw font file bytes (TTF/OTF). Used for parsing; not persisted by core.
    pub bytes: Vec<u8>,
    /// Where the font originated — affects the embedding decision.
    pub provenance: FontProvenance,
}

impl AddFontEntry {
    /// Builds the `FontEntry` that `apply` would insert from an already-parsed
    /// font. Shared by `validate` and `apply` so the two paths cannot diverge.
    ///
    /// `FontEntry::new` rejects an empty/invalid `family` or `postscript_name`
    /// (a font with no Unicode `name` record classifies with an empty
    /// `family` via `unwrap_or_default()`). Routing both `validate` and `apply`
    /// through this function makes `validate` reject EXACTLY what `apply`
    /// rejects (RF-004 — validate/apply symmetry per CLAUDE.md §11
    /// "Symmetric Validation for Reversible Operations" / rust-defensive
    /// "Deserialization Boundaries Must Match Validation Rules").
    ///
    /// # `FontSource` selection
    ///
    /// Only `EmbedDecision::Embed` produces a `Custom` source (the asset UUID
    /// is `self.entry_id`, under which the server stores the bytes on disk).
    /// All reference decisions — `ReferenceRestricted`, `ReferenceSystem`,
    /// `ReferenceNoOs2`, `ReferencePreviewPrint` — produce `SystemReference`
    /// because the bytes are NOT embedded in the document; PDF/SVG output
    /// references the font by PostScript name instead.
    fn build_entry(&self, parsed: ParsedFont) -> Result<FontEntry, CoreError> {
        // Map embed decision → FontSource. The match is exhaustive — no wildcard
        // arm — to ensure a new EmbedDecision variant causes a compile error here
        // (CLAUDE.md §11 "Discriminated-Union Dispatch Must Be Exhaustive").
        let source = match parsed.decision {
            // Embed: store the bytes as a custom asset keyed by this entry's UUID.
            EmbedDecision::Embed => FontSource::Custom {
                asset_uuid: self.entry_id,
            },
            // Reference decisions: bytes are not embedded; reference by PostScript
            // name in PDF/SVG export. The bytes were used for parsing only.
            EmbedDecision::ReferenceRestricted
            | EmbedDecision::ReferenceSystem
            | EmbedDecision::ReferenceNoOs2
            | EmbedDecision::ReferencePreviewPrint => FontSource::SystemReference,
        };

        FontEntry::new(
            self.entry_id,
            parsed.family,
            parsed.postscript_name,
            source,
            parsed.metrics,
            parsed.fs_type,
            parsed.decision,
            parsed.is_variable,
            parsed.axes,
        )
    }
}

impl FieldOperation for AddFontEntry {
    /// Validates that the operation can be applied:
    ///
    /// 1. Rejects payloads exceeding `MAX_EMBEDDED_FONT_BYTES`.
    /// 2. Rejects duplicate entry IDs (pre-check for a precise error message;
    ///    `FontTable::add` also enforces this).
    /// 3. Rejects if the table is already at capacity.
    /// 4. Confirms the bytes parse as a valid font AND that the parsed entry
    ///    would construct successfully via `FontEntry::new` — including the
    ///    `family`/`postscript_name` name checks. A font with no Unicode `name`
    ///    record yields an empty `family`, which `FontEntry::new` rejects; this
    ///    step makes `validate` fail on exactly the inputs `apply` would fail on
    ///    (RF-004 — validate/apply symmetry).
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        // 1. Size cap.
        check_embedded_font_size(self.bytes.len())?;

        // 2. Duplicate-ID check — cheap early exit that surfaces the conflicting
        //    `entry_id` explicitly and avoids running `classify_font` only to
        //    have `FontTable::add` reject the duplicate. `FontTable::add` also
        //    enforces uniqueness with its own typed error; this is defense-in-depth
        //    with a more informative message.
        if doc.font_table().get(self.entry_id).is_some() {
            return Err(CoreError::ValidationError(format!(
                "font entry {} already exists",
                self.entry_id
            )));
        }

        // 3. Capacity check.
        if doc.font_table().len() >= MAX_FONTS_PER_DOCUMENT {
            return Err(CoreError::ValidationError(format!(
                "font table is at capacity ({MAX_FONTS_PER_DOCUMENT}); cannot add another entry"
            )));
        }

        // 4. Confirm the bytes parse as a valid font AND that the resulting
        //    entry constructs successfully (family/postscript_name/axes checks).
        //    The constructed entry is discarded here; `apply` re-runs the same
        //    path. This is the symmetry fix: `validate` and `apply` build the
        //    same `FontEntry` via `build_entry`, so they accept/reject the same
        //    inputs.
        let parsed = classify_font(&self.bytes, self.provenance)?;
        self.build_entry(parsed)?;

        Ok(())
    }

    /// Applies the operation: parses the font bytes, builds the `FontEntry`
    /// (selecting `FontSource` from the embedding decision via `build_entry`),
    /// and inserts it into the document's `FontTable`.
    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let parsed = classify_font(&self.bytes, self.provenance)?;
        let entry = self.build_entry(parsed)?;
        doc.font_table_mut().add(entry)?;
        Ok(())
    }
}

/// Removes a font entry from the document's `FontTable`.
///
/// # Invariants enforced by `validate`
///
/// 1. **Default protection** — the bundled default (`DEFAULT_FONT_ENTRY_ID`)
///    may never be removed. `TextStyle::default()` and the v2→v3 migration both
///    reference it; removing it would leave newly-created default text nodes
///    with a dangling font reference. This is the referential-integrity invariant
///    described in rust-defensive "Delete Operations Must Enforce
///    Collection-Level Invariants".
///
/// 2. **Existence** — the entry must be present in the table.
///
/// 3. **No live references** — no `NodeKind::Text` node in the arena may have
///    `text_style.font_entry == self.entry_id`. The scan covers the canonical
///    arena node store; component definitions stored outside the arena are not
///    yet in scope (tracked in the fonts-1 spec deferred items).
#[derive(Debug)]
pub struct RemoveFontEntry {
    /// The ID of the font entry to remove.
    pub entry_id: FontEntryId,
}

impl FieldOperation for RemoveFontEntry {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        // 1. Protect the bundled default. See doc-comment for rationale.
        if self.entry_id == DEFAULT_FONT_ENTRY_ID {
            return Err(CoreError::ValidationError(
                "cannot remove the bundled default font entry (DEFAULT_FONT_ENTRY_ID); \
                 it is referenced by TextStyle::default() and the v2→v3 migration"
                    .to_string(),
            ));
        }

        // 2. Entry must exist.
        if doc.font_table().get(self.entry_id).is_none() {
            return Err(CoreError::ValidationError(format!(
                "font entry {} does not exist in the font table",
                self.entry_id
            )));
        }

        // 3. Referential-integrity scan: reject if any Text node still uses this
        //    entry. The scan covers arena nodes — the canonical node store.
        //    O(n) linear scan over all arena nodes; acceptable for an infrequent
        //    removal op. A reverse FontEntryId→nodes index would be O(1) but
        //    adds persistent state not warranted by this access pattern.
        let referenced = doc.arena.iter().any(|node| {
            matches!(
                &node.kind,
                NodeKind::Text { text_style, .. } if text_style.font_entry == self.entry_id
            )
        });
        if referenced {
            return Err(CoreError::ValidationError(format!(
                "font entry {} is still referenced by one or more Text nodes; \
                 reassign those nodes to a different font before removing this entry",
                self.entry_id
            )));
        }

        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        // `validate` should have caught the missing-entry case, but `apply` is
        // defensive per the FieldOperation contract: never unwrap/expect.
        doc.font_table_mut()
            .remove(self.entry_id)
            .map(|_| ())
            .ok_or_else(|| {
                CoreError::ValidationError(format!(
                    "font entry {} not found during apply (was it removed between validate and apply?)",
                    self.entry_id
                ))
            })
    }
}

/// Updates a Text node's `text_style.font_entry` to reference a different
/// `FontTable` entry.
///
/// This closes the font-entry-existence check deferred in Task 7: the field
/// `TextStyle::font_entry` is validated against the live font table here rather
/// than at `TextStyle` construction time (where the table is not available).
///
/// # Caller contract
///
/// Callers MUST call `validate()` before `apply()`. The operation is
/// forward-only; undo is managed client-side by the frontend `HistoryManager`.
#[derive(Debug)]
pub struct SetNodeFont {
    /// The target node (must be `NodeKind::Text`).
    pub node_id: NodeId,
    /// The font entry to assign. Must exist in the document's `FontTable`.
    pub font_entry: FontEntryId,
}

impl FieldOperation for SetNodeFont {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        // 1. Node must exist (propagates NotFound via `?`).
        let node = doc.arena.get(self.node_id)?;

        // 2. Node must be a Text node.
        if !matches!(node.kind, NodeKind::Text { .. }) {
            return Err(CoreError::ValidationError(format!(
                "SetNodeFont requires a Text node (node {:?} is a different kind)",
                self.node_id
            )));
        }

        // 3. Font entry must exist in the document's font table.
        if doc.font_table().get(self.font_entry).is_none() {
            return Err(CoreError::ValidationError(format!(
                "font entry {} does not exist in the font table",
                self.font_entry
            )));
        }

        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;

        // Enumerate every non-Text variant explicitly so a new `NodeKind`
        // variant added to core causes a compile error here (CLAUDE.md §11
        // "Discriminated-Union Dispatch Must Be Exhaustive"). No wildcard arm.
        match &mut node.kind {
            NodeKind::Text { text_style, .. } => {
                text_style.font_entry = self.font_entry;
                Ok(())
            }
            NodeKind::Frame { .. }
            | NodeKind::Rectangle { .. }
            | NodeKind::Ellipse { .. }
            | NodeKind::Path { .. }
            | NodeKind::Image { .. }
            | NodeKind::Group
            | NodeKind::ComponentInstance { .. } => Err(CoreError::ValidationError(format!(
                "SetNodeFont requires a Text node (node {:?} is a different kind)",
                self.node_id
            ))),
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use uuid::Uuid;

    // Font fixtures — 4 levels up from commands/font_commands.rs to crate root,
    // then into tests/fixtures/fonts/.
    const INSTALLABLE: &[u8] = include_bytes!("../../../../tests/fixtures/fonts/installable.ttf");
    const RESTRICTED: &[u8] = include_bytes!("../../../../tests/fixtures/fonts/restricted.ttf");

    /// Full validate → apply cycle for an installable font.
    ///
    /// Verifies: (1) validate passes, (2) apply adds the entry, (3) the entry
    /// has `Embed` decision and a `Custom` source keyed to the `entry_id`.
    #[test]
    fn test_add_font_entry_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let entry_id = Uuid::from_u128(1);

        let op = AddFontEntry {
            entry_id,
            bytes: INSTALLABLE.to_vec(),
            provenance: FontProvenance::UserSupplied,
        };

        op.validate(&doc).expect("validate should pass");
        op.apply(&mut doc).expect("apply should succeed");

        assert_eq!(
            doc.font_table().len(),
            2,
            "table must contain the bundled default plus the newly added entry"
        );

        let entry = doc
            .font_table()
            .get(entry_id)
            .expect("entry must be present after apply");

        assert_eq!(
            entry.embeddable(),
            EmbedDecision::Embed,
            "installable font must have Embed decision"
        );
        assert!(
            matches!(entry.source(), FontSource::Custom { asset_uuid } if *asset_uuid == entry_id),
            "Embed decision must produce Custom source keyed to entry_id"
        );
    }

    /// Rejects a payload exceeding `MAX_EMBEDDED_FONT_BYTES`.
    #[test]
    fn test_add_font_entry_rejects_oversize() {
        use crate::validate::MAX_EMBEDDED_FONT_BYTES;

        let doc = Document::new("Test".to_string());
        let op = AddFontEntry {
            entry_id: Uuid::from_u128(2),
            bytes: vec![0u8; MAX_EMBEDDED_FONT_BYTES + 1],
            provenance: FontProvenance::UserSupplied,
        };

        assert!(
            op.validate(&doc).is_err(),
            "payload exceeding MAX_EMBEDDED_FONT_BYTES must be rejected"
        );
    }

    /// Rejects a second `AddFontEntry` with the same `entry_id`.
    #[test]
    fn test_add_font_entry_rejects_duplicate_id() {
        let mut doc = Document::new("Test".to_string());
        let entry_id = Uuid::from_u128(3);

        // First insertion succeeds.
        let op1 = AddFontEntry {
            entry_id,
            bytes: INSTALLABLE.to_vec(),
            provenance: FontProvenance::UserSupplied,
        };
        op1.validate(&doc).expect("first validate must pass");
        op1.apply(&mut doc).expect("first apply must succeed");

        // Second insertion with the same id must be rejected.
        let op2 = AddFontEntry {
            entry_id,
            bytes: INSTALLABLE.to_vec(),
            provenance: FontProvenance::UserSupplied,
        };
        assert!(
            op2.validate(&doc).is_err(),
            "duplicate entry_id must be rejected by validate"
        );
    }

    /// A restricted font produces `ReferenceRestricted` decision and
    /// `SystemReference` source — bytes are NOT embedded.
    #[test]
    fn test_add_font_entry_restricted_references() {
        let mut doc = Document::new("Test".to_string());
        let entry_id = Uuid::from_u128(4);

        let op = AddFontEntry {
            entry_id,
            bytes: RESTRICTED.to_vec(),
            provenance: FontProvenance::UserSupplied,
        };

        op.validate(&doc)
            .expect("validate should pass for restricted font");
        op.apply(&mut doc)
            .expect("apply should succeed for restricted font");

        let entry = doc
            .font_table()
            .get(entry_id)
            .expect("entry must be present after apply");

        assert_eq!(
            entry.embeddable(),
            EmbedDecision::ReferenceRestricted,
            "restricted font must have ReferenceRestricted decision"
        );
        assert_eq!(
            entry.source(),
            &FontSource::SystemReference,
            "reference decision must produce SystemReference source (no bytes embedded)"
        );
    }

    /// RF-004: `validate` and `apply` must reject the same inputs. A font with
    /// no Unicode `name` record classifies with an empty `family` (via
    /// `unwrap_or_default()`), which `FontEntry::new` rejects. Because both
    /// `validate` and `apply` now route through `build_entry`, an empty family
    /// fails in BOTH — there is no "validate passes, apply fails" gap.
    ///
    /// We exercise `build_entry` directly with a synthetic `ParsedFont` carrying
    /// an empty family, since the checked-in fixtures all have Unicode name
    /// records (no no-name fixture exists). This proves the shared construction
    /// path rejects the empty-family case that previously slipped past
    /// `validate` and only failed at `apply`.
    #[test]
    fn test_add_font_entry_validate_apply_symmetric_on_empty_family() {
        use crate::font::{EmbedDecision, FontMetrics};

        let op = AddFontEntry {
            entry_id: Uuid::from_u128(6),
            bytes: INSTALLABLE.to_vec(),
            provenance: FontProvenance::UserSupplied,
        };

        // Synthetic parse result with an empty family (the no-Unicode-name case)
        // but otherwise-valid metrics. `build_entry` must reject it — the same
        // rejection `apply` would surface and that `validate` now surfaces too.
        let parsed = crate::font_parse::ParsedFont {
            family: String::new(),
            postscript_name: "PS-Name".to_string(),
            metrics: FontMetrics::fallback(),
            fs_type: 0,
            decision: EmbedDecision::ReferenceSystem,
            is_variable: false,
            axes: vec![],
        };

        assert!(
            op.build_entry(parsed).is_err(),
            "empty family must be rejected by the shared build_entry path used by \
             both validate and apply"
        );
    }

    /// Garbage bytes (not a valid font) must be rejected by validate.
    #[test]
    fn test_add_font_entry_rejects_garbage() {
        let doc = Document::new("Test".to_string());
        let op = AddFontEntry {
            entry_id: Uuid::from_u128(5),
            bytes: b"not a font".to_vec(),
            provenance: FontProvenance::UserSupplied,
        };

        assert!(
            op.validate(&doc).is_err(),
            "garbage bytes must be rejected by validate"
        );
    }

    /// `AddFontEntry::validate` must reject when the table is already at
    /// `MAX_FONTS_PER_DOCUMENT` capacity (CLAUDE.md §11 Constant-Enforcement
    /// Tests — exercises the command path, not just `FontTable::add` directly).
    ///
    /// The table is filled cheaply via synthetic `FontEntry` objects constructed
    /// directly with `FontEntry::new` — no font-byte parsing required for setup.
    /// The enforcement check fires before `classify_font` is called, so the
    /// test's `bytes` payload only needs to pass the earlier size check.
    #[test]
    fn test_max_fonts_per_document_enforced() {
        use crate::validate::MAX_FONTS_PER_DOCUMENT;

        let mut doc = Document::new("Test".to_string());

        // Build a minimal valid FontMetrics once and reuse its values.
        let metrics = FontMetrics::new(
            1000, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0; 10], false,
        )
        .expect("test FontMetrics must be valid");

        // Document::new already holds 1 entry (the bundled default).
        // Insert MAX_FONTS_PER_DOCUMENT - 1 more synthetic entries to reach capacity.
        for i in 0..(MAX_FONTS_PER_DOCUMENT - 1) {
            let entry = FontEntry::new(
                Uuid::from_u128(100 + i as u128),
                "Inter".into(),
                "Inter-Regular".into(),
                FontSource::SystemReference,
                metrics.clone(),
                0,
                EmbedDecision::ReferenceSystem,
                false,
                vec![],
            )
            .expect("synthetic FontEntry must be valid");
            doc.font_table_mut()
                .add(entry)
                .expect("synthetic insert must succeed under the cap");
        }

        assert_eq!(
            doc.font_table().len(),
            MAX_FONTS_PER_DOCUMENT,
            "table must be exactly at capacity before the capacity test"
        );

        // Now attempt to add one more via the command path — must be rejected.
        let op = AddFontEntry {
            entry_id: Uuid::from_u128(999),
            bytes: INSTALLABLE.to_vec(),
            provenance: FontProvenance::UserSupplied,
        };

        assert!(
            op.validate(&doc).is_err(),
            "AddFontEntry::validate must reject when the table is at MAX_FONTS_PER_DOCUMENT capacity"
        );
    }

    // ── Test helpers ───────────────────────────────────────────────────────────

    use crate::font::{EmbedDecision, FontEntry, FontMetrics, FontSource};
    use crate::id::NodeId;
    use crate::node::{Node, NodeKind, TextSizing, TextStyle, default_corners};

    fn make_test_metrics() -> FontMetrics {
        FontMetrics::new(
            1000, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0; 10], false,
        )
        .expect("test FontMetrics must be valid")
    }

    /// Inserts a synthetic `FontEntry` with the given UUID into `doc`'s font
    /// table. Uses distinct UUIDs starting at 200 to avoid collision with
    /// `DEFAULT_FONT_ENTRY_ID` and the UUIDs used in `AddFontEntry` tests.
    fn insert_test_font_entry(doc: &mut Document, id: Uuid) {
        let entry = FontEntry::new(
            id,
            "Roboto".into(),
            "Roboto-Regular".into(),
            FontSource::SystemReference,
            make_test_metrics(),
            0,
            EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .expect("synthetic FontEntry must be valid");
        doc.font_table_mut()
            .add(entry)
            .expect("synthetic FontEntry insert must succeed");
    }

    /// Sets up a `Document` containing a single `Text` node and returns
    /// `(doc, node_id)`.
    fn setup_doc_with_text_node() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            Uuid::from_u128(1000),
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle::default(),
                sizing: TextSizing::AutoWidth,
            },
            "TextNode".to_string(),
        )
        .expect("create text node");
        let node_id = doc.arena.insert(node).expect("insert text node");
        (doc, node_id)
    }

    /// Sets up a `Document` containing a single `Rectangle` node and returns
    /// `(doc, node_id)`.
    fn setup_doc_with_rect_node() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            Uuid::from_u128(1001),
            NodeKind::Rectangle {
                corners: default_corners(),
            },
            "RectNode".to_string(),
        )
        .expect("create rect node");
        let node_id = doc.arena.insert(node).expect("insert rect node");
        (doc, node_id)
    }

    // ── SetNodeFont tests ──────────────────────────────────────────────────────

    /// Full validate → apply cycle: sets a Text node's `font_entry` to a known
    /// entry in the font table, then asserts the field was updated.
    #[test]
    fn test_set_node_font_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text_node();
        let font_id = Uuid::from_u128(200);
        insert_test_font_entry(&mut doc, font_id);

        let op = SetNodeFont {
            node_id,
            font_entry: font_id,
        };

        op.validate(&doc).expect("validate must pass");

        // Assert the node does NOT already have font_id set — so `apply` proves
        // it changed the value rather than being a no-op.
        let before = doc
            .arena
            .get(node_id)
            .expect("node must be present before apply");
        if let NodeKind::Text { text_style, .. } = &before.kind {
            assert_ne!(
                text_style.font_entry, font_id,
                "font_entry must differ before apply so the test proves a real change"
            );
        }

        op.apply(&mut doc).expect("apply must succeed");

        let updated = doc.arena.get(node_id).expect("node must be present");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(
                text_style.font_entry, font_id,
                "font_entry must be updated to the new value"
            );
        } else {
            panic!("expected Text node kind");
        }
    }

    /// `validate` must reject when `font_entry` is not in the font table.
    #[test]
    fn test_set_node_font_rejects_unknown_entry() {
        let (doc, node_id) = setup_doc_with_text_node();
        // UUID 201 was never inserted into the table.
        let op = SetNodeFont {
            node_id,
            font_entry: Uuid::from_u128(201),
        };
        assert!(
            op.validate(&doc).is_err(),
            "SetNodeFont must reject a font_entry not present in the font table"
        );
    }

    /// `validate` must reject when the target node is not a Text node.
    #[test]
    fn test_set_node_font_rejects_non_text_node() {
        let (mut doc, rect_id) = setup_doc_with_rect_node();
        // Add a valid font entry so validation doesn't fail on the font check
        // before reaching the kind check.
        let font_id = Uuid::from_u128(202);
        insert_test_font_entry(&mut doc, font_id);

        let op = SetNodeFont {
            node_id: rect_id,
            font_entry: font_id,
        };
        assert!(
            op.validate(&doc).is_err(),
            "SetNodeFont must reject a non-Text node"
        );
    }

    /// `validate` must reject when the target `node_id` has never been inserted
    /// into the arena (exercises the `doc.arena.get(node_id)?` propagation path).
    #[test]
    fn test_set_node_font_rejects_missing_node() {
        let mut doc = Document::new("Test".to_string());
        // Insert a valid font entry so the font-existence check is not the
        // rejecting condition — we want the node-existence check to fire.
        let font_id = Uuid::from_u128(203);
        insert_test_font_entry(&mut doc, font_id);

        // NodeId(99, 0) was never inserted into the arena.
        let op = SetNodeFont {
            node_id: NodeId::new(99, 0),
            font_entry: font_id,
        };
        assert!(
            op.validate(&doc).is_err(),
            "SetNodeFont must reject a node_id that does not exist in the arena"
        );
    }

    // ── RemoveFontEntry tests ──────────────────────────────────────────────────

    /// Full validate → apply cycle: adds an entry that no node references,
    /// validates ok, applies ok, entry is gone, table length drops by 1.
    #[test]
    fn test_remove_font_entry_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let font_id = Uuid::from_u128(300);
        insert_test_font_entry(&mut doc, font_id);

        let before_len = doc.font_table().len();

        let op = RemoveFontEntry { entry_id: font_id };

        op.validate(&doc)
            .expect("validate must pass for unreferenced entry");
        op.apply(&mut doc).expect("apply must succeed");

        assert!(
            doc.font_table().get(font_id).is_none(),
            "entry must be absent from the table after removal"
        );
        assert_eq!(
            doc.font_table().len(),
            before_len - 1,
            "table length must drop by 1 after removal"
        );
    }

    /// `validate` must reject removal when a Text node still references the entry.
    #[test]
    fn test_remove_font_entry_rejects_referenced() {
        let (mut doc, node_id) = setup_doc_with_text_node();
        let font_id = Uuid::from_u128(301);
        insert_test_font_entry(&mut doc, font_id);

        // Wire the Text node to the new font entry via SetNodeFont.
        let set_op = SetNodeFont {
            node_id,
            font_entry: font_id,
        };
        set_op.validate(&doc).expect("SetNodeFont validate");
        set_op.apply(&mut doc).expect("SetNodeFont apply");

        // Now attempting to remove the entry must fail.
        let remove_op = RemoveFontEntry { entry_id: font_id };
        assert!(
            remove_op.validate(&doc).is_err(),
            "RemoveFontEntry must reject an entry still referenced by a Text node"
        );
    }

    /// `validate` must reject removal of `DEFAULT_FONT_ENTRY_ID`.
    #[test]
    fn test_remove_font_entry_rejects_default() {
        use crate::font::DEFAULT_FONT_ENTRY_ID;

        let doc = Document::new("Test".to_string());
        let op = RemoveFontEntry {
            entry_id: DEFAULT_FONT_ENTRY_ID,
        };
        assert!(
            op.validate(&doc).is_err(),
            "RemoveFontEntry must reject removal of DEFAULT_FONT_ENTRY_ID"
        );
    }

    /// `validate` must reject removal of an entry that is not in the table.
    #[test]
    fn test_remove_font_entry_rejects_missing() {
        let doc = Document::new("Test".to_string());
        // UUID 302 was never inserted.
        let op = RemoveFontEntry {
            entry_id: Uuid::from_u128(302),
        };
        assert!(
            op.validate(&doc).is_err(),
            "RemoveFontEntry must reject an entry that does not exist in the table"
        );
    }
}
