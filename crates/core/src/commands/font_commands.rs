// crates/core/src/commands/font_commands.rs
//
// Forward-only `FieldOperation` implementations for font catalogue mutations.
//
// `AddFontEntry` parses raw font bytes, classifies the embedding rights, and
// inserts a new `FontEntry` into the document's `FontTable`. Core is I/O-free:
// this command does not write bytes to disk. The server already holds the bytes
// (it constructs this op) and persists them separately (Tasks 11/13).

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::font::{EmbedDecision, FontEntry, FontEntryId, FontSource};
use crate::font_parse::{FontProvenance, classify_font};
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
#[derive(Debug)]
pub struct AddFontEntry {
    /// Stable UUID for the new font entry (must be unique within the document).
    pub entry_id: FontEntryId,
    /// Raw font file bytes (TTF/OTF). Used for parsing; not persisted by core.
    pub bytes: Vec<u8>,
    /// Where the font originated — affects the embedding decision.
    pub provenance: FontProvenance,
}

impl FieldOperation for AddFontEntry {
    /// Validates that the operation can be applied:
    ///
    /// 1. Rejects payloads exceeding `MAX_EMBEDDED_FONT_BYTES`.
    /// 2. Rejects duplicate entry IDs (pre-check for a precise error message;
    ///    `FontTable::add` also enforces this).
    /// 3. Rejects if the table is already at capacity.
    /// 4. Confirms the bytes parse as a valid font (discards the result here;
    ///    `apply` re-runs `classify_font`).
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        // 1. Size cap.
        check_embedded_font_size(self.bytes.len())?;

        // 2. Duplicate-ID check — pre-check for a precise message. FontTable::add
        //    also enforces uniqueness, but checking here surfaces the duplicate
        //    identity explicitly rather than as a generic capacity-or-duplicate error.
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

        // 4. Confirm the bytes parse as a valid font; result is discarded here.
        classify_font(&self.bytes, self.provenance)?;

        Ok(())
    }

    /// Applies the operation: parses the font bytes, selects the appropriate
    /// `FontSource` based on the embedding decision, and inserts the entry into
    /// the document's `FontTable`.
    ///
    /// # `FontSource` selection
    ///
    /// Only `EmbedDecision::Embed` produces a `Custom` source (the asset UUID
    /// is `self.entry_id`, under which the server stores the bytes on disk).
    /// All reference decisions — `ReferenceRestricted`, `ReferenceSystem`,
    /// `ReferenceNoOs2`, `ReferencePreviewPrint` — produce `SystemReference`
    /// because the bytes are NOT embedded in the document; PDF/SVG output
    /// references the font by PostScript name instead.
    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let parsed = classify_font(&self.bytes, self.provenance)?;

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

        let entry = FontEntry::new(
            self.entry_id,
            parsed.family,
            parsed.postscript_name,
            source,
            parsed.metrics,
            parsed.fs_type,
            parsed.decision,
            parsed.is_variable,
            parsed.axes,
        )?;

        doc.font_table_mut().add(entry)?;

        Ok(())
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
    /// has `Embed` decision and a `Custom` source keyed to the entry_id.
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
}
