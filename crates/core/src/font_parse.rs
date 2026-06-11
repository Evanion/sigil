// crates/core/src/font_parse.rs
//
// Parses raw font bytes and classifies the result as an `EmbedDecision`.
// This is an I/O-free module: it receives bytes from the caller and returns
// structured data. No filesystem access occurs here (CLAUDE.md §4 core = zero I/O).
//
// # ttf-parser 0.25 API notes (confirmed against crate source)
//
// - `Face::parse(bytes, index)` → `Result<Face, FaceParsingError>`
// - `face.tables()` → `&FaceTables` with fields: `.os2: Option<os2::Table>`,
//   `.glyf: Option<glyf::Table>`, `.cff: Option<cff::Table>`, `.hhea: hhea::Table`
// - `os2_table.permissions()` → `Option<Permissions>` where `Permissions` has
//   variants: `Installable`, `Restricted`, `PreviewAndPrint`, `Editable`.
//   This method already implements OS/2-version-aware logic (v≤2 = most-permissive,
//   v≥3 = mutually-exclusive nibble), so we use it rather than hand-masking.
// - Raw OS/2 bytes via `face.raw_face().table(Tag::from_bytes(b"OS/2"))` → `Option<&[u8]>`.
//   fsType is a big-endian u16 at byte offset 8; xAvgCharWidth is i16 BE at offset 2;
//   PANOSE is 10 bytes at offset 32.
// - `face.units_per_em()` → `u16`
// - `face.ascender()`, `face.descender()`, `face.line_gap()` → `i16`
// - `face.italic_angle()` → `f32` (returns 0.0 when no `post` table)
// - `face.x_height()` → `Option<i16>`, `face.capital_height()` → `Option<i16>`
// - `face.is_variable()` → `bool`
// - `face.variation_axes()` → `LazyArray16<VariationAxis>`; each item has
//   `.tag: Tag`, `.min_value: f32`, `.def_value: f32`, `.max_value: f32`
// - `Tag::to_bytes(self)` → `[u8; 4]`
// - `face.names()` → `Names` (implements `IntoIterator`); items are `Name` with
//   `.name_id: u16` and `.to_string() -> Option<String>`
//   Family = name_id 1, PostScript = name_id 6.

use crate::error::CoreError;
use crate::font::{EmbedDecision, FontAxis, FontMetrics};
use ttf_parser::{Face, Permissions, Tag};

// ── FontProvenance ─────────────────────────────────────────────────────

/// Where a font file was loaded from.
///
/// `SystemDirectory` fonts are never embedded regardless of their `fsType`
/// bits — they are referenced by PostScript name in PDF/SVG output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontProvenance {
    /// Font was supplied directly by the user (uploaded, dropped, or picked from a file chooser).
    UserSupplied,
    /// Font was discovered in a system font directory (e.g., `/usr/share/fonts`).
    SystemDirectory,
}

impl std::str::FromStr for FontProvenance {
    type Err = CoreError;

    /// Parses a provenance string into `FontProvenance`.
    ///
    /// Accepts `"user_supplied"` and `"system_directory"`. Any other string
    /// returns [`CoreError::ValidationError`].
    ///
    /// This is WASM-safe: `std::str::FromStr` is available in `no_std`
    /// environments when `alloc` is present, and the implementation uses only
    /// `match` — no I/O, no system calls.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ValidationError`] for unknown provenance strings.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user_supplied" => Ok(FontProvenance::UserSupplied),
            "system_directory" => Ok(FontProvenance::SystemDirectory),
            other => Err(CoreError::ValidationError(format!(
                "unknown provenance: {other:?}; expected \"user_supplied\" or \"system_directory\""
            ))),
        }
    }
}

// ── ParsedFont ─────────────────────────────────────────────────────────

/// The result of successfully parsing and classifying a font file.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedFont {
    /// CSS-safe family name from the font's `name` table (name ID 1).
    pub family: String,
    /// PostScript name from the font's `name` table (name ID 6).
    pub postscript_name: String,
    /// Metrics extracted from the font's OS/2 and `hhea` tables.
    pub metrics: FontMetrics,
    /// Raw OS/2 `fsType` field as a `u16`; `0xFFFF` when no OS/2 table is present.
    pub fs_type: u16,
    /// Embedding classification derived from `fsType` and `provenance`.
    pub decision: EmbedDecision,
    /// `true` if the font declares variable-font axes in its `fvar` table.
    pub is_variable: bool,
    /// Axes declared by a variable font (empty for static fonts).
    ///
    /// The `min`/`default`/`max` values come straight from `ttf-parser` and are
    /// NOT finite-validated at this layer. Callers MUST route these through
    /// `FontEntry::new` (which validates each axis: finite + `min <= default <=
    /// max`) before persisting — do not assume they are finite.
    pub axes: Vec<FontAxis>,
}

// ── classify_font ──────────────────────────────────────────────────────

/// Parses `bytes` as an OpenType/TrueType font and classifies its embedding rights.
///
/// # Errors
///
/// Returns [`CoreError::ValidationError`] if:
/// - `bytes` cannot be parsed as a valid font file.
/// - The extracted metrics fail validation (e.g., `units_per_em == 0`, non-finite value).
pub fn classify_font(bytes: &[u8], prov: FontProvenance) -> Result<ParsedFont, CoreError> {
    let face = Face::parse(bytes, 0)
        .map_err(|e| CoreError::ValidationError(format!("invalid font: {e}")))?;

    // ── Raw OS/2 bytes ────────────────────────────────────────────────
    // We need fsType, xAvgCharWidth, and PANOSE from the raw table bytes
    // because the typed `os2::Table` accessors do not expose all three
    // in a single pass at the offsets we need.
    let raw_os2: Option<&[u8]> = face.raw_face().table(Tag::from_bytes(b"OS/2"));

    // fsType: big-endian u16 at byte offset 8 of the OS/2 table.
    // Use 0xFFFF as a sentinel meaning "no OS/2 table" — all bits set is
    // conservatively "no embedding allowed" in every fsType interpretation.
    let fs_type: u16 = raw_os2
        .and_then(|d| d.get(8..10))
        .map_or(0xFFFF, |b| u16::from_be_bytes([b[0], b[1]]));

    // xAvgCharWidth: big-endian i16 at byte offset 2 of the OS/2 table.
    let avg_advance: f32 = raw_os2
        .and_then(|d| d.get(2..4))
        .map_or(0.0_f32, |b| f32::from(i16::from_be_bytes([b[0], b[1]])));

    // PANOSE: 10 bytes at byte offset 32 of the OS/2 table.
    let panose: [u8; 10] = raw_os2
        .and_then(|d| d.get(32..42))
        .and_then(|s| s.try_into().ok())
        .unwrap_or([0u8; 10]);

    // Serif detection: PANOSE family byte 0 == 2 (Latin Text) and
    // serif-style byte 1 in range 2..=10 (everything except "No Fit", "Any", and sans variants).
    let is_serif = panose[0] == 2 && (2..=10).contains(&panose[1]);

    // ── FontMetrics ───────────────────────────────────────────────────
    let metrics = FontMetrics::new(
        face.units_per_em(),
        f32::from(face.ascender()),
        f32::from(face.descender()),
        f32::from(face.line_gap()),
        f32::from(face.capital_height().unwrap_or(0)),
        f32::from(face.x_height().unwrap_or(0)),
        face.italic_angle(),
        avg_advance,
        panose,
        is_serif,
    )?;

    // ── Name extraction ───────────────────────────────────────────────
    let family = read_name(&face, 1).unwrap_or_default();
    let postscript_name = read_name(&face, 6).unwrap_or_else(|| family.clone());

    // ── Variable font axes ────────────────────────────────────────────
    // `face.is_variable()` returns true when the font has a valid `fvar` table
    // with at least one axis.  `face.variation_axes()` returns a `LazyArray16`
    // of `VariationAxis` entries (tag, min_value, def_value, max_value).
    // Both methods are gated behind ttf-parser's `variable-fonts` feature, which
    // is now enabled in the workspace Cargo.toml alongside `no-std-float`.
    // The feature adds no extra crate dependencies, so WASM compatibility
    // (wasm32-unknown-unknown) is fully preserved.
    let is_variable = face.is_variable();
    let axes: Vec<FontAxis> = face
        .variation_axes()
        .into_iter()
        .map(|a| FontAxis {
            tag: a.tag.to_bytes(),
            min: a.min_value,
            default: a.def_value,
            max: a.max_value,
        })
        .collect();

    // ── Embed decision ────────────────────────────────────────────────
    let decision = resolve_decision(&face, prov, fs_type);

    Ok(ParsedFont {
        family,
        postscript_name,
        metrics,
        fs_type,
        decision,
        is_variable,
        axes,
    })
}

// ── Private helpers ────────────────────────────────────────────────────

/// Reads the first occurrence of name ID `name_id` from the font's `name` table,
/// returning the decoded UTF-8 string if available.
///
/// `Name::to_string()` in ttf-parser is gated behind the `std` feature, which
/// we do not enable (WASM safety: `default-features = false, features =
/// ["no-std-float"]`). Instead we decode UTF-16BE manually using
/// `String::from_utf16`, which is available in Rust std without ttf-parser's
/// `std` feature flag. This is equivalent to ttf-parser's own implementation.
fn read_name(face: &Face<'_>, name_id: u16) -> Option<String> {
    face.names()
        .into_iter()
        .find(|n| n.name_id == name_id && n.is_unicode())
        .and_then(|n| decode_utf16be(n.name))
}

/// Decodes a big-endian UTF-16 byte slice into a `String`.
///
/// Returns `None` if the byte count is odd or the sequence is not valid UTF-16.
fn decode_utf16be(bytes: &[u8]) -> Option<String> {
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    let code_units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|b| u16::from_be_bytes([b[0], b[1]]))
        .collect();
    String::from_utf16(&code_units).ok()
}

/// Derives the [`EmbedDecision`] from provenance, the raw `fsType` bits, and
/// the parsed `Permissions` value from the OS/2 table.
///
/// Decision precedence (highest to lowest):
/// 1. `SystemDirectory` → `ReferenceSystem` regardless of `fsType`.
/// 2. No OS/2 table (sentinel `fs_type == 0xFFFF`) → `ReferenceNoOs2`.
/// 3. Bitmap-only flag (bit 9, `0x0200`) set while outline tables are present
///    → `ReferenceRestricted` (we cannot embed outline data legally).
/// 4. `Permissions` enum from `os2.permissions()`:
///    - `Installable` | `Editable` → `Embed`
///    - `PreviewAndPrint` → `ReferencePreviewPrint`
///    - `Restricted` | `None` → `ReferenceRestricted`
///
/// The match on `Permissions` is exhaustive — all 4 variants are named
/// (CLAUDE.md §11 "Discriminated-Union Dispatch Must Be Exhaustive").
fn resolve_decision(face: &Face<'_>, prov: FontProvenance, fs_type: u16) -> EmbedDecision {
    if matches!(prov, FontProvenance::SystemDirectory) {
        return EmbedDecision::ReferenceSystem;
    }

    // Two independent "no usable OS/2" guards that intentionally converge on
    // the same conservative result: the typed-table guard fires when
    // `os2::Table::parse` rejected the table (unknown version, too short); the
    // 0xFFFF sentinel guard fires when the raw bytes were unreadable. They
    // cannot disagree — both yield `ReferenceNoOs2`.
    let Some(os2) = face.tables().os2 else {
        return EmbedDecision::ReferenceNoOs2;
    };
    if fs_type == 0xFFFF {
        return EmbedDecision::ReferenceNoOs2;
    }

    // Bitmap-embedding-only flag (bit 9). When set, only bitmaps may be
    // embedded even if Permissions says otherwise. If the face has outline
    // tables (glyf or cff), we must not embed them.
    let bitmap_only = (fs_type & 0x0200) != 0;
    let has_outlines = face.tables().glyf.is_some() || face.tables().cff.is_some();
    if bitmap_only && has_outlines {
        return EmbedDecision::ReferenceRestricted;
    }

    // Use the OS/2-version-aware permissions() accessor which already handles
    // the v≤2 (most-permissive) vs v≥3 (mutually-exclusive nibble) distinction.
    // The match must name all 4 variants — no wildcard arm.
    match os2.permissions() {
        Some(Permissions::Installable | Permissions::Editable) => EmbedDecision::Embed,
        Some(Permissions::PreviewAndPrint) => EmbedDecision::ReferencePreviewPrint,
        Some(Permissions::Restricted) | None => EmbedDecision::ReferenceRestricted,
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    const INSTALLABLE: &[u8] = include_bytes!("../../../tests/fixtures/fonts/installable.ttf");
    const RESTRICTED: &[u8] = include_bytes!("../../../tests/fixtures/fonts/restricted.ttf");
    const EDITABLE: &[u8] = include_bytes!("../../../tests/fixtures/fonts/editable.ttf");
    const VARIABLE: &[u8] = include_bytes!("../../../tests/fixtures/fonts/variable.ttf");

    #[test]
    fn test_classify_installable_user_supplied_embeds() {
        let p = classify_font(INSTALLABLE, FontProvenance::UserSupplied).unwrap();
        assert_eq!(p.decision, EmbedDecision::Embed);
        assert!(p.metrics.units_per_em() > 0);
        assert_eq!(p.family, "SigilTest");
        assert_eq!(p.fs_type, 0x0000);
        assert!(!p.is_variable);
    }

    #[test]
    fn test_classify_editable_user_supplied_embeds() {
        let p = classify_font(EDITABLE, FontProvenance::UserSupplied).unwrap();
        assert_eq!(p.decision, EmbedDecision::Embed);
    }

    #[test]
    fn test_classify_restricted_references() {
        let p = classify_font(RESTRICTED, FontProvenance::UserSupplied).unwrap();
        assert_eq!(p.decision, EmbedDecision::ReferenceRestricted);
    }

    #[test]
    fn test_classify_system_provenance_never_embeds() {
        let p = classify_font(INSTALLABLE, FontProvenance::SystemDirectory).unwrap();
        assert_eq!(p.decision, EmbedDecision::ReferenceSystem);
    }

    #[test]
    fn test_classify_rejects_garbage() {
        assert!(classify_font(b"not a font", FontProvenance::UserSupplied).is_err());
    }

    // ── FontProvenance::from_str tests ────────────────────────────────────

    #[test]
    fn test_font_provenance_from_str_user_supplied() {
        let p: FontProvenance = "user_supplied".parse().expect("valid provenance");
        assert_eq!(p, FontProvenance::UserSupplied);
    }

    #[test]
    fn test_font_provenance_from_str_system_directory() {
        let p: FontProvenance = "system_directory".parse().expect("valid provenance");
        assert_eq!(p, FontProvenance::SystemDirectory);
    }

    #[test]
    fn test_font_provenance_from_str_unknown_returns_error() {
        let err = "totally_made_up"
            .parse::<FontProvenance>()
            .expect_err("unknown provenance must fail");
        assert!(
            matches!(err, CoreError::ValidationError(_)),
            "unknown provenance must produce ValidationError, got: {err:?}"
        );
        let msg = err.to_string();
        assert!(
            msg.contains("totally_made_up"),
            "error must mention the unknown string, got: {msg}"
        );
    }

    #[test]
    fn test_classify_variable_font_reports_axes() {
        let p = classify_font(VARIABLE, FontProvenance::UserSupplied).unwrap();
        assert!(p.is_variable, "fvar font must report is_variable");
        assert_eq!(p.axes.len(), 1);
        assert_eq!(p.axes[0].tag, *b"wght");
        assert!((p.axes[0].min - 100.0).abs() < 1e-3);
        assert!((p.axes[0].default - 400.0).abs() < 1e-3);
        assert!((p.axes[0].max - 900.0).abs() < 1e-3);
        assert_eq!(p.decision, EmbedDecision::Embed);
    }
}
