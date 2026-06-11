// crates/core/src/font.rs
//
// Core font type definitions for the Sigil design engine.
//
// `FontSource`, `EmbedDecision`, and `FontAxis` are simple data carriers that
// derive `Serialize`/`Deserialize` (no invariants to protect). `FontMetrics` is a
// validated type — it has private fields, a validating constructor, manual
// `Serialize` and `Deserialize` impls (the latter routes through `new()` and
// rejects duplicate keys), and no `#[derive(Deserialize)]`. This follows the
// canonical pattern established by `TextShadow` in `node.rs`.

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::validate::validate_finite;

// ── FontEntryId ────────────────────────────────────────────────────────

/// Stable, globally-unique identity for a font entry in the font catalogue.
///
/// Uses `uuid::Uuid` rather than an arena-local index so IDs survive
/// serialization round-trips (CLAUDE.md §11 "Arena-Local IDs Must Not Be
/// Serialized").
pub type FontEntryId = uuid::Uuid;

// ── FontSource ─────────────────────────────────────────────────────────

/// Describes where a font's data originates.
///
/// Simple enum with no validated invariants — derives `Deserialize` directly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum FontSource {
    /// A font that ships bundled with the Sigil application.
    Bundled,
    /// A font from the Sigil cloud font library, identified by a catalogue ID.
    Library { catalog_id: String },
    /// A custom font uploaded by the user, referenced by its asset UUID.
    Custom { asset_uuid: uuid::Uuid },
    /// A font that exists on the host OS but is not embedded in the document.
    SystemReference,
}

// ── EmbedDecision ─────────────────────────────────────────────────────

/// Describes how a font may be embedded in an exported document.
///
/// Derived from the font's OS/2 `fsType` embedding bits (OpenType spec §5.8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbedDecision {
    /// Font may be embedded and used permanently in the exported document.
    Embed,
    /// Font may be referenced but not embedded; export produces an external ref.
    ReferenceRestricted,
    /// System font — reference by PostScript name in PDF/SVG; do not embed.
    ReferenceSystem,
    /// Font lacks an OS/2 table; treat conservatively as reference-only.
    ReferenceNoOs2,
    /// Font may be embedded for preview/print but not for editing.
    ReferencePreviewPrint,
}

// ── FontAxis ───────────────────────────────────────────────────────────

/// A single variable-font axis (e.g., Weight `wght`, Width `wdth`).
///
/// Plain data carrier; field ranges are not validated here because valid ranges
/// are defined by the font file and callers are expected to clamp before
/// constructing a `FontAxis`. This type is used for metadata display, not for
/// producing CSS `font-variation-settings` values (which are validated at the
/// point of use).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FontAxis {
    /// 4-byte OpenType axis tag (e.g., `b"wght"`, `b"wdth"`).
    pub tag: [u8; 4],
    /// Minimum value for this axis as reported by the font.
    pub min: f32,
    /// Default (upright/regular) value for this axis.
    pub default: f32,
    /// Maximum value for this axis as reported by the font.
    pub max: f32,
}

// ── FontMetrics ────────────────────────────────────────────────────────

/// Font-level metrics extracted from a font file's OS/2 and `hhea` tables.
///
/// # Validation
///
/// All `f32` fields are validated to be finite (no NaN or infinity) via
/// `validate_finite`. `units_per_em` must be > 0 — a zero UPM value would
/// produce division-by-zero in every downstream layout computation.
///
/// Follows the "No Derive Deserialize on Validated Types" rule (CLAUDE.md §11,
/// `rust-defensive.md`): fields are private, `Deserialize` is implemented
/// manually and routes through `FontMetrics::new`, and duplicate JSON keys
/// are rejected with `de::Error::duplicate_field`.
#[derive(Debug, Clone, PartialEq)]
pub struct FontMetrics {
    units_per_em: u16,
    ascent: f32,
    descent: f32,
    line_gap: f32,
    cap_height: f32,
    x_height: f32,
    italic_angle: f32,
    avg_advance: f32,
    panose: [u8; 10],
    is_serif: bool,
}

impl FontMetrics {
    /// Creates a new `FontMetrics`, validating all fields.
    ///
    /// # Errors
    ///
    /// Returns `CoreError::ValidationError` if:
    /// - `units_per_em` is 0 (would cause division-by-zero in layout).
    /// - Any `f32` field is NaN or infinite.
    // 10 arguments is unavoidable for a flat validated struct with 10 fields —
    // a builder pattern would be more complex without adding correctness.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        units_per_em: u16,
        ascent: f32,
        descent: f32,
        line_gap: f32,
        cap_height: f32,
        x_height: f32,
        italic_angle: f32,
        avg_advance: f32,
        panose: [u8; 10],
        is_serif: bool,
    ) -> Result<Self, CoreError> {
        if units_per_em == 0 {
            return Err(CoreError::ValidationError(
                "font_metrics.units_per_em must be > 0".to_string(),
            ));
        }
        // Cast f32 → f64 for validate_finite: the cast is lossless for the
        // NaN/Infinity/finite distinction (IEEE 754 preserves all three).
        validate_finite("font_metrics.ascent", f64::from(ascent))?;
        validate_finite("font_metrics.descent", f64::from(descent))?;
        validate_finite("font_metrics.line_gap", f64::from(line_gap))?;
        validate_finite("font_metrics.cap_height", f64::from(cap_height))?;
        validate_finite("font_metrics.x_height", f64::from(x_height))?;
        validate_finite("font_metrics.italic_angle", f64::from(italic_angle))?;
        validate_finite("font_metrics.avg_advance", f64::from(avg_advance))?;

        // Spec §6: ascent and line_gap must be non-negative.
        // `descent` may be negative (it is below the baseline by convention).
        if ascent < 0.0 {
            return Err(CoreError::ValidationError(
                "font_metrics.ascent must be >= 0".to_string(),
            ));
        }
        if line_gap < 0.0 {
            return Err(CoreError::ValidationError(
                "font_metrics.line_gap must be >= 0".to_string(),
            ));
        }

        Ok(Self {
            units_per_em,
            ascent,
            descent,
            line_gap,
            cap_height,
            x_height,
            italic_angle,
            avg_advance,
            panose,
            is_serif,
        })
    }

    // ── Accessors ────────────────────────────────────────────────────

    /// Design units per em — the grid resolution of this font.
    #[must_use]
    pub fn units_per_em(&self) -> u16 {
        self.units_per_em
    }

    /// Typographic ascender (positive, in design units).
    #[must_use]
    pub fn ascent(&self) -> f32 {
        self.ascent
    }

    /// Typographic descender (negative by convention, in design units).
    #[must_use]
    pub fn descent(&self) -> f32 {
        self.descent
    }

    /// Additional line gap between consecutive baselines (in design units).
    #[must_use]
    pub fn line_gap(&self) -> f32 {
        self.line_gap
    }

    /// Height of a capital letter above the baseline (in design units).
    #[must_use]
    pub fn cap_height(&self) -> f32 {
        self.cap_height
    }

    /// Height of a lowercase 'x' above the baseline (in design units).
    #[must_use]
    pub fn x_height(&self) -> f32 {
        self.x_height
    }

    /// Italic angle in degrees; 0 for upright typefaces.
    #[must_use]
    pub fn italic_angle(&self) -> f32 {
        self.italic_angle
    }

    /// Average advance width of characters (in design units).
    #[must_use]
    pub fn avg_advance(&self) -> f32 {
        self.avg_advance
    }

    /// PANOSE classification bytes from the OS/2 table.
    #[must_use]
    pub fn panose(&self) -> &[u8; 10] {
        &self.panose
    }

    /// `true` if the font is classified as serif by its PANOSE family byte.
    #[must_use]
    pub fn is_serif(&self) -> bool {
        self.is_serif
    }
}

// ── Serialize ─────────────────────────────────────────────────────────

impl Serialize for FontMetrics {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("FontMetrics", 10)?;
        state.serialize_field("units_per_em", &self.units_per_em)?;
        state.serialize_field("ascent", &self.ascent)?;
        state.serialize_field("descent", &self.descent)?;
        state.serialize_field("line_gap", &self.line_gap)?;
        state.serialize_field("cap_height", &self.cap_height)?;
        state.serialize_field("x_height", &self.x_height)?;
        state.serialize_field("italic_angle", &self.italic_angle)?;
        state.serialize_field("avg_advance", &self.avg_advance)?;
        state.serialize_field("panose", &self.panose)?;
        state.serialize_field("is_serif", &self.is_serif)?;
        state.end()
    }
}

// ── Deserialize ───────────────────────────────────────────────────────

impl<'de> Deserialize<'de> for FontMetrics {
    // The 10-field visitor necessarily exceeds the 100-line threshold.
    // Splitting it would obscure the duplicate-key guard pattern.
    #[allow(clippy::too_many_lines)]
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::{self, MapAccess, Visitor};
        use std::fmt;

        struct FontMetricsVisitor;

        /// Field discriminant for duplicate-key detection.
        #[derive(Deserialize)]
        #[serde(field_identifier, rename_all = "snake_case")]
        enum Field {
            UnitsPerEm,
            Ascent,
            Descent,
            LineGap,
            CapHeight,
            XHeight,
            ItalicAngle,
            AvgAdvance,
            Panose,
            IsSerif,
        }

        impl<'de> Visitor<'de> for FontMetricsVisitor {
            type Value = FontMetrics;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("struct FontMetrics")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut units_per_em: Option<u16> = None;
                let mut ascent: Option<f32> = None;
                let mut descent: Option<f32> = None;
                let mut line_gap: Option<f32> = None;
                let mut cap_height: Option<f32> = None;
                let mut x_height: Option<f32> = None;
                let mut italic_angle: Option<f32> = None;
                let mut avg_advance: Option<f32> = None;
                let mut panose: Option<[u8; 10]> = None;
                let mut is_serif: Option<bool> = None;

                while let Some(key) = map.next_key::<Field>()? {
                    match key {
                        Field::UnitsPerEm => {
                            if units_per_em.is_some() {
                                return Err(de::Error::duplicate_field("units_per_em"));
                            }
                            units_per_em = Some(map.next_value()?);
                        }
                        Field::Ascent => {
                            if ascent.is_some() {
                                return Err(de::Error::duplicate_field("ascent"));
                            }
                            ascent = Some(map.next_value()?);
                        }
                        Field::Descent => {
                            if descent.is_some() {
                                return Err(de::Error::duplicate_field("descent"));
                            }
                            descent = Some(map.next_value()?);
                        }
                        Field::LineGap => {
                            if line_gap.is_some() {
                                return Err(de::Error::duplicate_field("line_gap"));
                            }
                            line_gap = Some(map.next_value()?);
                        }
                        Field::CapHeight => {
                            if cap_height.is_some() {
                                return Err(de::Error::duplicate_field("cap_height"));
                            }
                            cap_height = Some(map.next_value()?);
                        }
                        Field::XHeight => {
                            if x_height.is_some() {
                                return Err(de::Error::duplicate_field("x_height"));
                            }
                            x_height = Some(map.next_value()?);
                        }
                        Field::ItalicAngle => {
                            if italic_angle.is_some() {
                                return Err(de::Error::duplicate_field("italic_angle"));
                            }
                            italic_angle = Some(map.next_value()?);
                        }
                        Field::AvgAdvance => {
                            if avg_advance.is_some() {
                                return Err(de::Error::duplicate_field("avg_advance"));
                            }
                            avg_advance = Some(map.next_value()?);
                        }
                        Field::Panose => {
                            if panose.is_some() {
                                return Err(de::Error::duplicate_field("panose"));
                            }
                            panose = Some(map.next_value()?);
                        }
                        Field::IsSerif => {
                            if is_serif.is_some() {
                                return Err(de::Error::duplicate_field("is_serif"));
                            }
                            is_serif = Some(map.next_value()?);
                        }
                    }
                }

                let units_per_em =
                    units_per_em.ok_or_else(|| de::Error::missing_field("units_per_em"))?;
                let ascent = ascent.ok_or_else(|| de::Error::missing_field("ascent"))?;
                let descent = descent.ok_or_else(|| de::Error::missing_field("descent"))?;
                let line_gap = line_gap.ok_or_else(|| de::Error::missing_field("line_gap"))?;
                let cap_height =
                    cap_height.ok_or_else(|| de::Error::missing_field("cap_height"))?;
                let x_height = x_height.ok_or_else(|| de::Error::missing_field("x_height"))?;
                let italic_angle =
                    italic_angle.ok_or_else(|| de::Error::missing_field("italic_angle"))?;
                let avg_advance =
                    avg_advance.ok_or_else(|| de::Error::missing_field("avg_advance"))?;
                let panose = panose.ok_or_else(|| de::Error::missing_field("panose"))?;
                let is_serif = is_serif.ok_or_else(|| de::Error::missing_field("is_serif"))?;

                FontMetrics::new(
                    units_per_em,
                    ascent,
                    descent,
                    line_gap,
                    cap_height,
                    x_height,
                    italic_angle,
                    avg_advance,
                    panose,
                    is_serif,
                )
                .map_err(de::Error::custom)
            }
        }

        const FIELDS: &[&str] = &[
            "units_per_em",
            "ascent",
            "descent",
            "line_gap",
            "cap_height",
            "x_height",
            "italic_angle",
            "avg_advance",
            "panose",
            "is_serif",
        ];
        deserializer.deserialize_struct("FontMetrics", FIELDS, FontMetricsVisitor)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_font_source_variants_construct() {
        let _ = FontSource::Bundled;
        let _ = FontSource::Library {
            catalog_id: "inter".into(),
        };
        let _ = FontSource::Custom {
            asset_uuid: uuid::Uuid::nil(),
        };
        let _ = FontSource::SystemReference;
    }

    #[test]
    fn test_font_metrics_rejects_nan() {
        let bad = FontMetrics::new(
            1000,
            f32::NAN,
            -200.0,
            0.0,
            700.0,
            500.0,
            0.0,
            500.0,
            [0; 10],
            true,
        );
        assert!(bad.is_err());
    }

    #[test]
    fn test_font_metrics_rejects_zero_upem() {
        let bad = FontMetrics::new(
            0, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0; 10], true,
        );
        assert!(bad.is_err());
    }

    #[test]
    fn test_font_metrics_valid() {
        assert!(
            FontMetrics::new(
                1000, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0; 10], true
            )
            .is_ok()
        );
    }

    #[test]
    fn test_font_metrics_rejects_negative_ascent() {
        let bad = FontMetrics::new(
            1000, -1.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0; 10], true,
        );
        assert!(bad.is_err(), "negative ascent must be rejected");
    }

    #[test]
    fn test_font_metrics_rejects_negative_line_gap() {
        let bad = FontMetrics::new(
            1000, 800.0, -200.0, -1.0, 700.0, 500.0, 0.0, 500.0, [0; 10], true,
        );
        assert!(bad.is_err(), "negative line_gap must be rejected");
    }

    #[test]
    fn test_font_metrics_serde_roundtrip() {
        let m = FontMetrics::new(
            1000, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0; 10], true,
        )
        .unwrap();
        let json = serde_json::to_string(&m).unwrap();
        let back: FontMetrics = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
    }

    // ── Additional coverage ────────────────────────────────────────

    #[test]
    fn test_font_metrics_rejects_infinity_in_descent() {
        let bad = FontMetrics::new(
            1000,
            800.0,
            f32::INFINITY,
            0.0,
            700.0,
            500.0,
            0.0,
            500.0,
            [0; 10],
            true,
        );
        assert!(bad.is_err(), "infinity in descent must be rejected");
    }

    #[test]
    fn test_font_metrics_rejects_neg_infinity_in_cap_height() {
        let bad = FontMetrics::new(
            1000,
            800.0,
            -200.0,
            0.0,
            f32::NEG_INFINITY,
            500.0,
            0.0,
            500.0,
            [0; 10],
            false,
        );
        assert!(
            bad.is_err(),
            "negative infinity in cap_height must be rejected"
        );
    }

    #[test]
    fn test_font_metrics_accessors() {
        let m = FontMetrics::new(
            2048, 1600.0, -400.0, 100.0, 1400.0, 900.0, -12.5, 1100.0, [1; 10], true,
        )
        .unwrap();
        assert_eq!(m.units_per_em(), 2048);
        assert_eq!(m.ascent(), 1600.0_f32);
        assert_eq!(m.descent(), -400.0_f32);
        assert_eq!(m.line_gap(), 100.0_f32);
        assert_eq!(m.cap_height(), 1400.0_f32);
        assert_eq!(m.x_height(), 900.0_f32);
        assert_eq!(m.italic_angle(), -12.5_f32);
        assert_eq!(m.avg_advance(), 1100.0_f32);
        assert_eq!(m.panose(), &[1u8; 10]);
        assert!(m.is_serif());
    }

    #[test]
    fn test_font_metrics_deserialize_rejects_duplicate_ascent() {
        let json = r#"{
            "units_per_em": 1000,
            "ascent": 800.0,
            "ascent": 850.0,
            "descent": -200.0,
            "line_gap": 0.0,
            "cap_height": 700.0,
            "x_height": 500.0,
            "italic_angle": 0.0,
            "avg_advance": 500.0,
            "panose": [0,0,0,0,0,0,0,0,0,0],
            "is_serif": true
        }"#;
        let result: Result<FontMetrics, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "duplicate 'ascent' key should be rejected by deserializer"
        );
    }

    #[test]
    fn test_font_source_serde_roundtrip_bundled() {
        let s = FontSource::Bundled;
        let json = serde_json::to_string(&s).unwrap();
        let back: FontSource = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn test_font_source_serde_roundtrip_library() {
        let s = FontSource::Library {
            catalog_id: "inter-v4".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: FontSource = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn test_font_source_serde_roundtrip_custom() {
        let s = FontSource::Custom {
            asset_uuid: uuid::Uuid::nil(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: FontSource = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn test_embed_decision_serde_roundtrip() {
        for decision in [
            EmbedDecision::Embed,
            EmbedDecision::ReferenceRestricted,
            EmbedDecision::ReferenceSystem,
            EmbedDecision::ReferenceNoOs2,
            EmbedDecision::ReferencePreviewPrint,
        ] {
            let json = serde_json::to_string(&decision).unwrap();
            let back: EmbedDecision = serde_json::from_str(&json).unwrap();
            assert_eq!(decision, back);
        }
    }

    #[test]
    fn test_font_axis_serde_roundtrip() {
        let axis = FontAxis {
            tag: *b"wght",
            min: 100.0,
            default: 400.0,
            max: 900.0,
        };
        let json = serde_json::to_string(&axis).unwrap();
        let back: FontAxis = serde_json::from_str(&json).unwrap();
        assert_eq!(axis, back);
    }
}
