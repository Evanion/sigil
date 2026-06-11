// crates/core/src/font.rs
//
// Core font type definitions for the Sigil design engine.
//
// `FontSource`, `EmbedDecision`, and `FontAxis` are simple data carriers that
// derive `Serialize`/`Deserialize` (no invariants to protect). `FontMetrics` and
// `FontEntry` are validated types — private fields, validating constructors,
// manual `Serialize` and `Deserialize` impls (the latter routes through `new()`
// and rejects duplicate keys). `FontTable` enforces capacity + uniqueness at
// insertion time. Pattern mirrors `TextShadow` in `node.rs`.

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

// ── FontEntry ──────────────────────────────────────────────────────────

/// A single font entry in the document font catalogue.
///
/// # Validation
///
/// - `family` and `postscript_name` must pass `validate_font_family_name`:
///   non-empty, ≤ `MAX_FONT_FAMILY_LEN`, no C0 control chars, no
///   CSS-significant chars. Both fields feed `ctx.font` in the canvas
///   renderer (CLAUDE.md §11 "CSS-Rendered String Fields Must Reject
///   CSS-Significant Characters").
/// - Each axis in `axes` must have `min`, `default`, and `max` all finite,
///   and `min <= default <= max` (cross-field invariant per CLAUDE.md §11).
///
/// Follows the "No Derive Deserialize on Validated Types" rule: fields are
/// private, `Deserialize` routes through `new()`, and duplicate JSON keys
/// are rejected with `de::Error::duplicate_field`.
#[derive(Debug, Clone, PartialEq)]
pub struct FontEntry {
    id: FontEntryId,
    family: String,
    postscript_name: String,
    source: FontSource,
    metrics: FontMetrics,
    fs_type: u16,
    embeddable: EmbedDecision,
    is_variable: bool,
    axes: Vec<FontAxis>,
}

impl FontEntry {
    /// Creates a new `FontEntry`, validating all fields.
    ///
    /// # Errors
    ///
    /// Returns `CoreError::ValidationError` if:
    /// - `family` or `postscript_name` fails `validate_font_family_name`.
    /// - Any axis has a non-finite `min`, `default`, or `max`.
    /// - Any axis violates `min <= default <= max`.
    // 9 arguments is unavoidable for a flat validated struct with 9 fields.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: FontEntryId,
        family: String,
        postscript_name: String,
        source: FontSource,
        metrics: FontMetrics,
        fs_type: u16,
        embeddable: EmbedDecision,
        is_variable: bool,
        axes: Vec<FontAxis>,
    ) -> Result<Self, CoreError> {
        // Both family and postscript_name feed ctx.font — validate both.
        crate::validate::validate_font_family_name(&family)?;
        crate::validate::validate_font_family_name(&postscript_name)?;

        // Validate each axis: all three bounds must be finite, and
        // min <= default <= max (cross-field invariant).
        for (i, axis) in axes.iter().enumerate() {
            validate_finite(&format!("axes[{i}].min"), f64::from(axis.min))?;
            validate_finite(&format!("axes[{i}].default"), f64::from(axis.default))?;
            validate_finite(&format!("axes[{i}].max"), f64::from(axis.max))?;
            if axis.min > axis.default || axis.default > axis.max {
                return Err(CoreError::ValidationError(format!(
                    "axes[{i}]: min ({}) <= default ({}) <= max ({}) must hold",
                    axis.min, axis.default, axis.max
                )));
            }
        }

        Ok(Self {
            id,
            family,
            postscript_name,
            source,
            metrics,
            fs_type,
            embeddable,
            is_variable,
            axes,
        })
    }

    // ── Accessors ────────────────────────────────────────────────────

    /// Stable UUID for this font entry.
    #[must_use]
    pub fn id(&self) -> FontEntryId {
        self.id
    }

    /// CSS-safe font family name (e.g., "Inter").
    #[must_use]
    pub fn family(&self) -> &str {
        &self.family
    }

    /// PostScript name used in PDF/SVG font references (e.g., "Inter-Regular").
    #[must_use]
    pub fn postscript_name(&self) -> &str {
        &self.postscript_name
    }

    /// Where this font's data originates.
    #[must_use]
    pub fn source(&self) -> &FontSource {
        &self.source
    }

    /// Metrics extracted from this font's OS/2 and `hhea` tables.
    #[must_use]
    pub fn metrics(&self) -> &FontMetrics {
        &self.metrics
    }

    /// OS/2 `fsType` embedding bits as a raw `u16`.
    #[must_use]
    pub fn fs_type(&self) -> u16 {
        self.fs_type
    }

    /// How this font may be embedded in an exported document.
    #[must_use]
    pub fn embeddable(&self) -> EmbedDecision {
        self.embeddable
    }

    /// `true` if the font is a variable font with at least one axis.
    #[must_use]
    pub fn is_variable(&self) -> bool {
        self.is_variable
    }

    /// Variable-font axes declared by this font.
    #[must_use]
    pub fn axes(&self) -> &[FontAxis] {
        &self.axes
    }
}

// ── FontEntry Serialize ────────────────────────────────────────────────

impl Serialize for FontEntry {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("FontEntry", 9)?;
        state.serialize_field("id", &self.id)?;
        state.serialize_field("family", &self.family)?;
        state.serialize_field("postscript_name", &self.postscript_name)?;
        state.serialize_field("source", &self.source)?;
        state.serialize_field("metrics", &self.metrics)?;
        state.serialize_field("fs_type", &self.fs_type)?;
        state.serialize_field("embeddable", &self.embeddable)?;
        state.serialize_field("is_variable", &self.is_variable)?;
        state.serialize_field("axes", &self.axes)?;
        state.end()
    }
}

// ── FontEntry Deserialize ──────────────────────────────────────────────

impl<'de> Deserialize<'de> for FontEntry {
    // 9-field visitor — the line count is unavoidable given the duplicate-key
    // guard pattern. Splitting the visitor would hide the per-field guards.
    #[allow(clippy::too_many_lines)]
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::{self, MapAccess, Visitor};
        use std::fmt;

        struct FontEntryVisitor;

        /// Field discriminant for duplicate-key detection.
        #[derive(Deserialize)]
        #[serde(field_identifier, rename_all = "snake_case")]
        enum Field {
            Id,
            Family,
            PostscriptName,
            Source,
            Metrics,
            FsType,
            Embeddable,
            IsVariable,
            Axes,
        }

        impl<'de> Visitor<'de> for FontEntryVisitor {
            type Value = FontEntry;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("struct FontEntry")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut id: Option<FontEntryId> = None;
                let mut family: Option<String> = None;
                let mut postscript_name: Option<String> = None;
                let mut source: Option<FontSource> = None;
                let mut metrics: Option<FontMetrics> = None;
                let mut fs_type: Option<u16> = None;
                let mut embeddable: Option<EmbedDecision> = None;
                let mut is_variable: Option<bool> = None;
                let mut axes: Option<Vec<FontAxis>> = None;

                while let Some(key) = map.next_key::<Field>()? {
                    match key {
                        Field::Id => {
                            if id.is_some() {
                                return Err(de::Error::duplicate_field("id"));
                            }
                            id = Some(map.next_value()?);
                        }
                        Field::Family => {
                            if family.is_some() {
                                return Err(de::Error::duplicate_field("family"));
                            }
                            family = Some(map.next_value()?);
                        }
                        Field::PostscriptName => {
                            if postscript_name.is_some() {
                                return Err(de::Error::duplicate_field("postscript_name"));
                            }
                            postscript_name = Some(map.next_value()?);
                        }
                        Field::Source => {
                            if source.is_some() {
                                return Err(de::Error::duplicate_field("source"));
                            }
                            source = Some(map.next_value()?);
                        }
                        Field::Metrics => {
                            if metrics.is_some() {
                                return Err(de::Error::duplicate_field("metrics"));
                            }
                            metrics = Some(map.next_value()?);
                        }
                        Field::FsType => {
                            if fs_type.is_some() {
                                return Err(de::Error::duplicate_field("fs_type"));
                            }
                            fs_type = Some(map.next_value()?);
                        }
                        Field::Embeddable => {
                            if embeddable.is_some() {
                                return Err(de::Error::duplicate_field("embeddable"));
                            }
                            embeddable = Some(map.next_value()?);
                        }
                        Field::IsVariable => {
                            if is_variable.is_some() {
                                return Err(de::Error::duplicate_field("is_variable"));
                            }
                            is_variable = Some(map.next_value()?);
                        }
                        Field::Axes => {
                            if axes.is_some() {
                                return Err(de::Error::duplicate_field("axes"));
                            }
                            axes = Some(map.next_value()?);
                        }
                    }
                }

                let id = id.ok_or_else(|| de::Error::missing_field("id"))?;
                let family = family.ok_or_else(|| de::Error::missing_field("family"))?;
                let postscript_name =
                    postscript_name.ok_or_else(|| de::Error::missing_field("postscript_name"))?;
                let source = source.ok_or_else(|| de::Error::missing_field("source"))?;
                let metrics = metrics.ok_or_else(|| de::Error::missing_field("metrics"))?;
                let fs_type = fs_type.ok_or_else(|| de::Error::missing_field("fs_type"))?;
                let embeddable =
                    embeddable.ok_or_else(|| de::Error::missing_field("embeddable"))?;
                let is_variable =
                    is_variable.ok_or_else(|| de::Error::missing_field("is_variable"))?;
                let axes = axes.ok_or_else(|| de::Error::missing_field("axes"))?;

                FontEntry::new(
                    id,
                    family,
                    postscript_name,
                    source,
                    metrics,
                    fs_type,
                    embeddable,
                    is_variable,
                    axes,
                )
                .map_err(de::Error::custom)
            }
        }

        const FIELDS: &[&str] = &[
            "id",
            "family",
            "postscript_name",
            "source",
            "metrics",
            "fs_type",
            "embeddable",
            "is_variable",
            "axes",
        ];
        deserializer.deserialize_struct("FontEntry", FIELDS, FontEntryVisitor)
    }
}

// ── FontTable ──────────────────────────────────────────────────────────

/// Ordered collection of font entries for a document.
///
/// # Invariants
///
/// - Capacity is bounded by `MAX_FONTS_PER_DOCUMENT` (enforced in `add`).
/// - All entry IDs are unique (enforced in `add`).
///
/// The `Deserialize` implementation builds the table via `add()` so that both
/// invariants are enforced at load time, not just at mutation time.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FontTable {
    entries: Vec<FontEntry>,
}

impl FontTable {
    /// Creates an empty `FontTable`.
    #[must_use]
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Adds a font entry to the table.
    ///
    /// # Errors
    ///
    /// Returns `CoreError::ValidationError` if:
    /// - The table already contains `MAX_FONTS_PER_DOCUMENT` entries.
    /// - An entry with the same `id` already exists.
    pub fn add(&mut self, entry: FontEntry) -> Result<(), CoreError> {
        if self.entries.len() >= crate::validate::MAX_FONTS_PER_DOCUMENT {
            return Err(CoreError::ValidationError(format!(
                "font table capacity exhausted: cannot add more than {} fonts per document",
                crate::validate::MAX_FONTS_PER_DOCUMENT
            )));
        }
        if self.entries.iter().any(|e| e.id == entry.id) {
            return Err(CoreError::ValidationError(format!(
                "font table already contains an entry with id {}",
                entry.id
            )));
        }
        self.entries.push(entry);
        Ok(())
    }

    /// Removes and returns the entry with the given `id`, if present.
    pub fn remove(&mut self, id: FontEntryId) -> Option<FontEntry> {
        if let Some(pos) = self.entries.iter().position(|e| e.id == id) {
            Some(self.entries.remove(pos))
        } else {
            None
        }
    }

    /// Returns a reference to the entry with the given `id`, if present.
    #[must_use]
    pub fn get(&self, id: FontEntryId) -> Option<&FontEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Iterates over all font entries in insertion order.
    pub fn iter(&self) -> impl Iterator<Item = &FontEntry> {
        self.entries.iter()
    }

    /// Returns the number of entries in the table.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns `true` if the table contains no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ── FontTable Serialize ────────────────────────────────────────────────

impl Serialize for FontTable {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("FontTable", 1)?;
        state.serialize_field("entries", &self.entries)?;
        state.end()
    }
}

// ── FontTable Deserialize ──────────────────────────────────────────────
//
// Builds the table via `add()` so capacity and uniqueness are enforced on
// load — a corrupt workfile with duplicate IDs or too many fonts is rejected
// at deserialize time rather than silently accepted.

impl<'de> Deserialize<'de> for FontTable {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::{self, MapAccess, Visitor};
        use std::fmt;

        struct FontTableVisitor;

        #[derive(Deserialize)]
        #[serde(field_identifier, rename_all = "snake_case")]
        enum Field {
            Entries,
        }

        impl<'de> Visitor<'de> for FontTableVisitor {
            type Value = FontTable;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("struct FontTable")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut entries: Option<Vec<FontEntry>> = None;

                while let Some(key) = map.next_key::<Field>()? {
                    match key {
                        Field::Entries => {
                            if entries.is_some() {
                                return Err(de::Error::duplicate_field("entries"));
                            }
                            entries = Some(map.next_value()?);
                        }
                    }
                }

                let entries = entries.ok_or_else(|| de::Error::missing_field("entries"))?;

                let mut table = FontTable::new();
                for entry in entries {
                    table.add(entry).map_err(de::Error::custom)?;
                }
                Ok(table)
            }
        }

        const FIELDS: &[&str] = &["entries"];
        deserializer.deserialize_struct("FontTable", FIELDS, FontTableVisitor)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── FontMetrics ────────────────────────────────────────────────────

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

    // ── FontEntry ──────────────────────────────────────────────────────

    /// Helper that builds a valid `FontMetrics` for tests.
    fn make_metrics() -> FontMetrics {
        FontMetrics::new(
            1000, 800.0, -200.0, 0.0, 700.0, 500.0, 0.0, 500.0, [0; 10], true,
        )
        .unwrap()
    }

    #[test]
    fn test_font_entry_rejects_bad_family() {
        let m = make_metrics();
        assert!(
            FontEntry::new(
                uuid::Uuid::nil(),
                "Bad;Family".into(),
                "BadFamily".into(),
                FontSource::SystemReference,
                m,
                0,
                EmbedDecision::ReferenceSystem,
                false,
                vec![]
            )
            .is_err()
        );
    }

    #[test]
    fn test_font_entry_valid_construct() {
        let m = make_metrics();
        let e = FontEntry::new(
            uuid::Uuid::nil(),
            "Inter".into(),
            "Inter-Regular".into(),
            FontSource::SystemReference,
            m,
            0,
            EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .unwrap();
        assert_eq!(e.embeddable(), EmbedDecision::ReferenceSystem);
        assert_eq!(e.family(), "Inter");
    }

    #[test]
    fn test_font_entry_rejects_bad_axis_range() {
        let m = make_metrics();
        // default < min and max < default — both cross-field invariants violated
        let bad_axis = FontAxis {
            tag: *b"wght",
            min: 700.0,
            default: 100.0,
            max: 400.0,
        };
        assert!(
            FontEntry::new(
                uuid::Uuid::nil(),
                "Inter".into(),
                "Inter".into(),
                FontSource::Custom {
                    asset_uuid: uuid::Uuid::nil()
                },
                m,
                0,
                EmbedDecision::Embed,
                true,
                vec![bad_axis]
            )
            .is_err()
        );
    }

    #[test]
    fn test_font_entry_serde_roundtrip() {
        let m = make_metrics();
        let e = FontEntry::new(
            uuid::Uuid::from_u128(7),
            "Inter".into(),
            "Inter-Regular".into(),
            FontSource::Custom {
                asset_uuid: uuid::Uuid::from_u128(9),
            },
            m,
            8,
            EmbedDecision::Embed,
            false,
            vec![],
        )
        .unwrap();
        let json = serde_json::to_string(&e).unwrap();
        let back: FontEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(e, back);
    }

    #[test]
    fn test_font_entry_rejects_empty_family() {
        let m = make_metrics();
        assert!(
            FontEntry::new(
                uuid::Uuid::nil(),
                String::new(),
                "Inter-Regular".into(),
                FontSource::SystemReference,
                m,
                0,
                EmbedDecision::ReferenceSystem,
                false,
                vec![]
            )
            .is_err()
        );
    }

    #[test]
    fn test_font_entry_rejects_css_char_in_postscript_name() {
        let m = make_metrics();
        // postscript_name containing a double-quote — CSS-significant character
        assert!(
            FontEntry::new(
                uuid::Uuid::nil(),
                "Inter".into(),
                r#"Inter"Regular"#.into(),
                FontSource::SystemReference,
                m,
                0,
                EmbedDecision::ReferenceSystem,
                false,
                vec![]
            )
            .is_err()
        );
    }

    #[test]
    fn test_font_entry_rejects_axis_with_nan_default() {
        let m = make_metrics();
        let bad_axis = FontAxis {
            tag: *b"wdth",
            min: 75.0,
            default: f32::NAN,
            max: 125.0,
        };
        assert!(
            FontEntry::new(
                uuid::Uuid::nil(),
                "VarFont".into(),
                "VarFont-Regular".into(),
                FontSource::Bundled,
                m,
                0,
                EmbedDecision::Embed,
                true,
                vec![bad_axis]
            )
            .is_err()
        );
    }

    #[test]
    fn test_font_entry_accepts_valid_axis() {
        let m = make_metrics();
        let axis = FontAxis {
            tag: *b"wght",
            min: 100.0,
            default: 400.0,
            max: 900.0,
        };
        assert!(
            FontEntry::new(
                uuid::Uuid::nil(),
                "Inter".into(),
                "Inter-Regular".into(),
                FontSource::SystemReference,
                m,
                0,
                EmbedDecision::ReferenceSystem,
                true,
                vec![axis]
            )
            .is_ok()
        );
    }

    #[test]
    fn test_font_entry_deserialize_rejects_duplicate_family_key() {
        // Build a valid FontEntry JSON, then insert a duplicate key.
        let m = make_metrics();
        let e = FontEntry::new(
            uuid::Uuid::from_u128(42),
            "Inter".into(),
            "Inter-Regular".into(),
            FontSource::SystemReference,
            m,
            0,
            EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .unwrap();
        // Serialize to canonical JSON and manually inject a duplicate key.
        let json = serde_json::to_string(&e).unwrap();
        // Insert a second "family" field by replacing the first occurrence.
        let dup_json = json.replacen(
            r#""family":"Inter""#,
            r#""family":"Inter","family":"Roboto""#,
            1,
        );
        let result: Result<FontEntry, _> = serde_json::from_str(&dup_json);
        assert!(
            result.is_err(),
            "duplicate 'family' key must be rejected by FontEntry deserializer"
        );
    }

    // ── FontTable ──────────────────────────────────────────────────────

    #[test]
    fn test_font_table_rejects_duplicate_id() {
        let mut t = FontTable::new();
        let m = make_metrics();
        let mk = |id| {
            FontEntry::new(
                id,
                "Inter".into(),
                "Inter".into(),
                FontSource::SystemReference,
                m.clone(),
                0,
                EmbedDecision::ReferenceSystem,
                false,
                vec![],
            )
            .unwrap()
        };
        t.add(mk(uuid::Uuid::from_u128(1))).unwrap();
        assert!(t.add(mk(uuid::Uuid::from_u128(1))).is_err());
    }

    #[test]
    fn test_font_table_add_and_get() {
        let mut t = FontTable::new();
        let m = make_metrics();
        let id = uuid::Uuid::from_u128(99);
        let e = FontEntry::new(
            id,
            "Roboto".into(),
            "Roboto-Regular".into(),
            FontSource::SystemReference,
            m,
            0,
            EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .unwrap();
        t.add(e).unwrap();
        assert!(t.get(id).is_some());
        assert_eq!(t.get(id).unwrap().family(), "Roboto");
        assert_eq!(t.len(), 1);
        assert!(!t.is_empty());
    }

    #[test]
    fn test_font_table_remove() {
        let mut t = FontTable::new();
        let m = make_metrics();
        let id = uuid::Uuid::from_u128(7);
        let e = FontEntry::new(
            id,
            "Inter".into(),
            "Inter-Regular".into(),
            FontSource::SystemReference,
            m,
            0,
            EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .unwrap();
        t.add(e).unwrap();
        assert_eq!(t.len(), 1);
        let removed = t.remove(id);
        assert!(removed.is_some());
        assert_eq!(t.len(), 0);
        assert!(t.is_empty());
        // Removing again returns None.
        assert!(t.remove(id).is_none());
    }

    #[test]
    fn test_font_table_iter() {
        let mut t = FontTable::new();
        let m = make_metrics();
        for i in 1_u128..=3 {
            let e = FontEntry::new(
                uuid::Uuid::from_u128(i),
                "Inter".into(),
                "Inter-Regular".into(),
                FontSource::SystemReference,
                m.clone(),
                0,
                EmbedDecision::ReferenceSystem,
                false,
                vec![],
            )
            .unwrap();
            t.add(e).unwrap();
        }
        assert_eq!(t.iter().count(), 3);
    }

    #[test]
    fn test_font_table_serde_roundtrip() {
        let mut t = FontTable::new();
        let m = make_metrics();
        for i in 1_u128..=3 {
            let e = FontEntry::new(
                uuid::Uuid::from_u128(i),
                "Inter".into(),
                "Inter-Regular".into(),
                FontSource::SystemReference,
                m.clone(),
                0,
                EmbedDecision::ReferenceSystem,
                false,
                vec![],
            )
            .unwrap();
            t.add(e).unwrap();
        }
        let json = serde_json::to_string(&t).unwrap();
        let back: FontTable = serde_json::from_str(&json).unwrap();
        assert_eq!(t, back);
    }

    #[test]
    fn test_font_table_deserialize_rejects_duplicate_id() {
        let mut t = FontTable::new();
        let m = make_metrics();
        let e = FontEntry::new(
            uuid::Uuid::from_u128(1),
            "Inter".into(),
            "Inter-Regular".into(),
            FontSource::SystemReference,
            m,
            0,
            EmbedDecision::ReferenceSystem,
            false,
            vec![],
        )
        .unwrap();
        t.add(e).unwrap();

        // Manually serialize with a duplicated entry (same id).
        let json = serde_json::to_string(&t).unwrap();
        // Patch: duplicate the single entry by replacing `[{...}]` with `[{...},{...}]`.
        // The serialized entries array contains one object; we duplicate it.
        let patched = {
            // Find the inner array content and duplicate the entry.
            let start = json.find('[').unwrap();
            let end = json.rfind(']').unwrap();
            let inner = &json[start + 1..end];
            format!("{{\"entries\":[{inner},{inner}]}}")
        };
        let result: Result<FontTable, _> = serde_json::from_str(&patched);
        assert!(
            result.is_err(),
            "FontTable deserialize must reject duplicate entry ids"
        );
    }

    #[test]
    fn test_font_table_default_is_empty() {
        let t = FontTable::default();
        assert!(t.is_empty());
        assert_eq!(t.len(), 0);
    }
}
