// crates/core/src/commands/text_style_commands.rs

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::{Color, FontStyle, NodeKind, StyleValue, TextAlign, TextDecoration, TextShadow};
use crate::validate::{
    FONT_FAMILY_FORBIDDEN_CHARS, MAX_FONT_FAMILY_LEN, MAX_FONT_SIZE, MAX_FONT_WEIGHT,
    MAX_TEXT_SHADOW_BLUR, MIN_FONT_SIZE, MIN_FONT_WEIGHT, validate_finite,
    validate_style_value_expression, validate_token_name,
};

/// Which field of `TextStyle` to update.
#[derive(Debug, Clone)]
pub enum TextStyleField {
    /// The font family name (e.g., `"Inter"`, `"Roboto"`).
    FontFamily(String),
    /// The font size in pixels.
    FontSize(StyleValue<f64>),
    /// The CSS font weight (1–1000).
    FontWeight(u16),
    /// Normal or italic.
    FontStyle(FontStyle),
    /// Line height multiplier or absolute pixel value.
    LineHeight(StyleValue<f64>),
    /// Letter spacing in pixels.
    LetterSpacing(StyleValue<f64>),
    /// Horizontal text alignment.
    TextAlign(TextAlign),
    /// Text decoration (none, underline, strikethrough).
    TextDecoration(TextDecoration),
    /// The foreground text colour.
    TextColor(StyleValue<Color>),
    /// A CSS `text-shadow` effect. `None` removes any existing shadow; `Some` sets it.
    TextShadow(Option<TextShadow>),
}

/// Updates a single field of a text node's `TextStyle`.
#[derive(Debug)]
pub struct SetTextStyleField {
    /// The target node (must be `NodeKind::Text`).
    pub node_id: NodeId,
    /// The field to update and its new value.
    pub field: TextStyleField,
}

/// Defense-in-depth validation for a `TextShadow` value.
///
/// `TextShadow::new` already validates these invariants at construction time, but
/// callers in the server and MCP crates construct `SetTextStyleField` directly via
/// struct literals, so re-validating here ensures the `FieldOperation` contract is
/// self-contained.
fn validate_shadow(shadow: &TextShadow) -> Result<(), CoreError> {
    validate_finite("text_shadow.offset_x", shadow.offset_x())?;
    validate_finite("text_shadow.offset_y", shadow.offset_y())?;
    validate_finite("text_shadow.blur_radius", shadow.blur_radius())?;
    if shadow.blur_radius() < 0.0 {
        return Err(CoreError::ValidationError(format!(
            "text_shadow.blur_radius must be >= 0, got {}",
            shadow.blur_radius()
        )));
    }
    if shadow.blur_radius() > MAX_TEXT_SHADOW_BLUR {
        return Err(CoreError::ValidationError(format!(
            "text_shadow.blur_radius must be <= {MAX_TEXT_SHADOW_BLUR}, got {}",
            shadow.blur_radius()
        )));
    }
    // Expression variants defer semantic validation to evaluation time.
    match shadow.color() {
        StyleValue::Literal { value } => match value {
            Color::Srgb { r, g, b, a } | Color::DisplayP3 { r, g, b, a } => {
                validate_finite("text_shadow.color.r", *r)?;
                validate_finite("text_shadow.color.g", *g)?;
                validate_finite("text_shadow.color.b", *b)?;
                validate_finite("text_shadow.color.a", *a)?;
            }
            Color::Oklch { l, c, h, a } => {
                validate_finite("text_shadow.color.l", *l)?;
                validate_finite("text_shadow.color.c", *c)?;
                validate_finite("text_shadow.color.h", *h)?;
                validate_finite("text_shadow.color.a", *a)?;
            }
            Color::Oklab { l, a, b, alpha } => {
                validate_finite("text_shadow.color.l", *l)?;
                validate_finite("text_shadow.color.a", *a)?;
                validate_finite("text_shadow.color.b", *b)?;
                validate_finite("text_shadow.color.alpha", *alpha)?;
            }
        },
        StyleValue::TokenRef { name } => validate_token_name(name)?,
        StyleValue::Expression { expr } => validate_style_value_expression(expr)?,
    }
    Ok(())
}

fn validate_font_family(family: &str) -> Result<(), CoreError> {
    if family.is_empty() {
        return Err(CoreError::ValidationError(
            "font_family must not be empty".to_string(),
        ));
    }
    if family.len() > MAX_FONT_FAMILY_LEN {
        return Err(CoreError::ValidationError(format!(
            "font_family exceeds max length of {MAX_FONT_FAMILY_LEN} (got {})",
            family.len()
        )));
    }
    if let Some(pos) = family.find(|c: char| c.is_control()) {
        return Err(CoreError::ValidationError(format!(
            "font_family contains control character at byte position {pos}"
        )));
    }
    if let Some(pos) = family.find(|c: char| FONT_FAMILY_FORBIDDEN_CHARS.contains(&c)) {
        return Err(CoreError::ValidationError(format!(
            "font_family contains forbidden character at byte position {pos}"
        )));
    }
    Ok(())
}

/// Expression variants defer semantic validation to evaluation time.
fn validate_font_size_field(sv: &StyleValue<f64>) -> Result<(), CoreError> {
    match sv {
        StyleValue::Literal { value } => {
            validate_finite("font_size", *value)?;
            if *value < MIN_FONT_SIZE || *value > MAX_FONT_SIZE {
                return Err(CoreError::ValidationError(format!(
                    "font_size {value} out of range [{MIN_FONT_SIZE}, {MAX_FONT_SIZE}]"
                )));
            }
            Ok(())
        }
        StyleValue::TokenRef { name } => validate_token_name(name),
        StyleValue::Expression { expr } => validate_style_value_expression(expr),
    }
}

/// Expression variants defer semantic validation to evaluation time.
fn validate_line_height_field(sv: &StyleValue<f64>) -> Result<(), CoreError> {
    match sv {
        StyleValue::Literal { value } => {
            validate_finite("line_height", *value)?;
            if *value <= 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "line_height must be > 0, got {value}"
                )));
            }
            Ok(())
        }
        StyleValue::TokenRef { name } => validate_token_name(name),
        StyleValue::Expression { expr } => validate_style_value_expression(expr),
    }
}

/// Expression variants defer semantic validation to evaluation time.
fn validate_letter_spacing_field(sv: &StyleValue<f64>) -> Result<(), CoreError> {
    match sv {
        StyleValue::Literal { value } => validate_finite("letter_spacing", *value),
        StyleValue::TokenRef { name } => validate_token_name(name),
        StyleValue::Expression { expr } => validate_style_value_expression(expr),
    }
}

/// Expression variants defer semantic validation to evaluation time.
fn validate_text_color_field(sv: &StyleValue<Color>) -> Result<(), CoreError> {
    match sv {
        StyleValue::Literal { value } => match value {
            Color::Srgb { r, g, b, a } | Color::DisplayP3 { r, g, b, a } => {
                validate_finite("text_color.r", *r)?;
                validate_finite("text_color.g", *g)?;
                validate_finite("text_color.b", *b)?;
                validate_finite("text_color.a", *a)?;
                Ok(())
            }
            Color::Oklch { l, c, h, a } => {
                validate_finite("text_color.l", *l)?;
                validate_finite("text_color.c", *c)?;
                validate_finite("text_color.h", *h)?;
                validate_finite("text_color.a", *a)?;
                Ok(())
            }
            Color::Oklab { l, a, b, alpha } => {
                validate_finite("text_color.l", *l)?;
                validate_finite("text_color.a", *a)?;
                validate_finite("text_color.b", *b)?;
                validate_finite("text_color.alpha", *alpha)?;
                Ok(())
            }
        },
        StyleValue::TokenRef { name } => validate_token_name(name),
        StyleValue::Expression { expr } => validate_style_value_expression(expr),
    }
}

fn validate_font_weight_field(w: u16) -> Result<(), CoreError> {
    if !(MIN_FONT_WEIGHT..=MAX_FONT_WEIGHT).contains(&w) {
        return Err(CoreError::ValidationError(format!(
            "font_weight {w} out of range [{MIN_FONT_WEIGHT}, {MAX_FONT_WEIGHT}]"
        )));
    }
    Ok(())
}

impl FieldOperation for SetTextStyleField {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        let node = doc.arena.get(self.node_id)?;
        if !matches!(node.kind, NodeKind::Text { .. }) {
            return Err(CoreError::ValidationError(format!(
                "SetTextStyleField requires a Text node (node {:?} is a different kind)",
                self.node_id
            )));
        }
        match &self.field {
            TextStyleField::FontFamily(family) => validate_font_family(family)?,
            TextStyleField::FontSize(sv) => validate_font_size_field(sv)?,
            TextStyleField::FontWeight(w) => validate_font_weight_field(*w)?,
            TextStyleField::LineHeight(sv) => validate_line_height_field(sv)?,
            TextStyleField::LetterSpacing(sv) => validate_letter_spacing_field(sv)?,
            TextStyleField::TextColor(sv) => validate_text_color_field(sv)?,
            TextStyleField::TextShadow(Some(shadow)) => validate_shadow(shadow)?,
            // None removes the shadow; enum variants are always structurally valid.
            TextStyleField::TextShadow(None)
            | TextStyleField::FontStyle(_)
            | TextStyleField::TextAlign(_)
            | TextStyleField::TextDecoration(_) => {}
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Text { text_style, .. } => {
                match &self.field {
                    TextStyleField::FontFamily(v) => text_style.font_family.clone_from(v),
                    TextStyleField::FontSize(v) => text_style.font_size = v.clone(),
                    TextStyleField::FontWeight(v) => text_style.font_weight = *v,
                    TextStyleField::FontStyle(v) => text_style.font_style = *v,
                    TextStyleField::LineHeight(v) => text_style.line_height = v.clone(),
                    TextStyleField::LetterSpacing(v) => text_style.letter_spacing = v.clone(),
                    TextStyleField::TextAlign(v) => text_style.text_align = *v,
                    TextStyleField::TextDecoration(v) => text_style.text_decoration = *v,
                    TextStyleField::TextColor(v) => text_style.text_color = v.clone(),
                    TextStyleField::TextShadow(v) => text_style.text_shadow.clone_from(v),
                }
                Ok(())
            }
            _ => Err(CoreError::ValidationError(format!(
                "SetTextStyleField requires a Text node (node {:?} is a different kind)",
                self.node_id
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::id::NodeId;
    use crate::node::{Node, NodeKind, TextSizing, TextStyle};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn setup_doc_with_text() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle::default(),
                sizing: TextSizing::AutoWidth,
            },
            "Text".to_string(),
        )
        .expect("create text node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    fn setup_doc_with_frame() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create frame node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    // ── FontSize ─────────────────────────────────────────────────────────────

    #[test]
    fn test_set_text_style_field_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();

        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal { value: 24.0 }),
        };

        op.validate(&doc).expect("validate should pass");
        op.apply(&mut doc).expect("apply should succeed");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(
                text_style.font_size,
                StyleValue::Literal { value: 24.0 },
                "font_size should be updated to 24.0"
            );
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_font_size_rejects_nan() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal { value: f64::NAN }),
        };
        assert!(op.validate(&doc).is_err(), "NaN font_size must be rejected");
    }

    #[test]
    fn test_set_text_style_field_font_size_rejects_infinity() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal {
                value: f64::INFINITY,
            }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "infinite font_size must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_font_size_rejects_below_min() {
        let (doc, node_id) = setup_doc_with_text();
        // MIN_FONT_SIZE is 0.1; 0.0 is below it
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal { value: 0.0 }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_size below MIN_FONT_SIZE must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_font_size_rejects_above_max() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal {
                value: MAX_FONT_SIZE + 1.0,
            }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_size above MAX_FONT_SIZE must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_font_size_at_min_boundary() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal {
                value: MIN_FONT_SIZE,
            }),
        };
        op.validate(&doc).expect("MIN_FONT_SIZE is valid");
        op.apply(&mut doc).expect("apply at MIN_FONT_SIZE");
    }

    #[test]
    fn test_set_text_style_field_font_size_at_max_boundary() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal {
                value: MAX_FONT_SIZE,
            }),
        };
        op.validate(&doc).expect("MAX_FONT_SIZE is valid");
        op.apply(&mut doc).expect("apply at MAX_FONT_SIZE");
    }

    // ── FontWeight ────────────────────────────────────────────────────────────

    #[test]
    fn test_set_text_style_field_font_weight_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(700),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(text_style.font_weight, 700);
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_font_weight_rejects_zero() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(0),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_weight 0 is below MIN_FONT_WEIGHT"
        );
    }

    #[test]
    fn test_set_text_style_field_font_weight_rejects_above_max() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(MAX_FONT_WEIGHT + 1),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_weight above MAX_FONT_WEIGHT must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_font_weight_at_min_boundary() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(MIN_FONT_WEIGHT),
        };
        op.validate(&doc).expect("MIN_FONT_WEIGHT is valid");
        op.apply(&mut doc).expect("apply at MIN_FONT_WEIGHT");
    }

    #[test]
    fn test_set_text_style_field_font_weight_at_max_boundary() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(MAX_FONT_WEIGHT),
        };
        op.validate(&doc).expect("MAX_FONT_WEIGHT is valid");
        op.apply(&mut doc).expect("apply at MAX_FONT_WEIGHT");
    }

    // ── FontFamily ────────────────────────────────────────────────────────────

    #[test]
    fn test_set_text_style_field_font_family_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontFamily("Roboto".to_string()),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(text_style.font_family, "Roboto");
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_font_family_rejects_empty() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontFamily(String::new()),
        };
        assert!(
            op.validate(&doc).is_err(),
            "empty font_family must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_font_family_rejects_too_long() {
        let (doc, node_id) = setup_doc_with_text();
        let long_name = "x".repeat(MAX_FONT_FAMILY_LEN + 1);
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontFamily(long_name),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_family exceeding MAX_FONT_FAMILY_LEN must be rejected"
        );
    }

    // ── LineHeight ────────────────────────────────────────────────────────────

    #[test]
    fn test_set_text_style_field_line_height_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::LineHeight(StyleValue::Literal { value: 2.0 }),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(text_style.line_height, StyleValue::Literal { value: 2.0 });
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_line_height_rejects_zero() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::LineHeight(StyleValue::Literal { value: 0.0 }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "line_height of 0 must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_line_height_rejects_negative() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::LineHeight(StyleValue::Literal { value: -1.5 }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "negative line_height must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_line_height_rejects_nan() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::LineHeight(StyleValue::Literal { value: f64::NAN }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "NaN line_height must be rejected"
        );
    }

    // ── LetterSpacing ─────────────────────────────────────────────────────────

    #[test]
    fn test_set_text_style_field_letter_spacing_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::LetterSpacing(StyleValue::Literal { value: 1.5 }),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(
                text_style.letter_spacing,
                StyleValue::Literal { value: 1.5 }
            );
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_letter_spacing_rejects_nan() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::LetterSpacing(StyleValue::Literal { value: f64::NAN }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "NaN letter_spacing must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_letter_spacing_allows_negative() {
        let (mut doc, node_id) = setup_doc_with_text();
        // Negative letter spacing is valid (tighter tracking)
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::LetterSpacing(StyleValue::Literal { value: -0.5 }),
        };
        op.validate(&doc).expect("negative letter_spacing is valid");
        op.apply(&mut doc).expect("apply");
    }

    // ── Enum variants ─────────────────────────────────────────────────────────

    #[test]
    fn test_set_text_style_field_font_style_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontStyle(FontStyle::Italic),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(text_style.font_style, FontStyle::Italic);
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_text_align_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::TextAlign(TextAlign::Center),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(text_style.text_align, TextAlign::Center);
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_text_decoration_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::TextDecoration(TextDecoration::Underline),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(text_style.text_decoration, TextDecoration::Underline);
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_text_color_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_text();
        let new_color = StyleValue::Literal {
            value: Color::Srgb {
                r: 1.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        };
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::TextColor(new_color.clone()),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(text_style.text_color, new_color);
        } else {
            panic!("expected Text node kind");
        }
    }

    // ── Wrong node kind ────────────────────────────────────────────────────────

    #[test]
    fn test_set_text_style_field_rejects_non_text_node() {
        let (doc, frame_id) = setup_doc_with_frame();
        let op = SetTextStyleField {
            node_id: frame_id,
            field: TextStyleField::FontSize(StyleValue::Literal { value: 16.0 }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "SetTextStyleField must reject non-text nodes"
        );
    }

    #[test]
    fn test_set_text_style_field_rejects_missing_node() {
        let doc = Document::new("Test".to_string());
        let op = SetTextStyleField {
            node_id: NodeId::new(99, 0),
            field: TextStyleField::FontSize(StyleValue::Literal { value: 16.0 }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "SetTextStyleField must reject missing nodes"
        );
    }

    // ── TextShadow ────────────────────────────────────────────────────────────

    fn make_black_color() -> StyleValue<Color> {
        StyleValue::Literal {
            value: Color::Srgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        }
    }

    #[test]
    fn test_set_text_style_field_text_shadow_validate_and_apply() {
        use crate::node::TextShadow;

        let (mut doc, node_id) = setup_doc_with_text();
        let shadow = TextShadow::new(2.0, 4.0, 8.0, make_black_color()).expect("valid shadow");
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::TextShadow(Some(shadow.clone())),
        };

        op.validate(&doc)
            .expect("validate should pass for valid shadow");
        op.apply(&mut doc).expect("apply should succeed");

        let updated = doc.arena.get(node_id).expect("get node");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(
                text_style.text_shadow,
                Some(shadow),
                "text_shadow should be updated to the provided value"
            );
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_text_shadow_remove() {
        use crate::node::TextShadow;

        let (mut doc, node_id) = setup_doc_with_text();

        // First apply a shadow so there is something to remove.
        let shadow = TextShadow::new(1.0, 2.0, 3.0, make_black_color()).expect("valid shadow");
        let set_op = SetTextStyleField {
            node_id,
            field: TextStyleField::TextShadow(Some(shadow)),
        };
        set_op.validate(&doc).expect("validate set");
        set_op.apply(&mut doc).expect("apply set");

        // Verify shadow is present.
        {
            let node = doc.arena.get(node_id).expect("get node");
            if let NodeKind::Text { text_style, .. } = &node.kind {
                assert!(
                    text_style.text_shadow.is_some(),
                    "shadow must be present before removal"
                );
            } else {
                panic!("expected Text node kind");
            }
        }

        // Now remove the shadow.
        let remove_op = SetTextStyleField {
            node_id,
            field: TextStyleField::TextShadow(None),
        };
        remove_op.validate(&doc).expect("validate remove");
        remove_op.apply(&mut doc).expect("apply remove");

        let updated = doc.arena.get(node_id).expect("get node after remove");
        if let NodeKind::Text { text_style, .. } = &updated.kind {
            assert_eq!(
                text_style.text_shadow, None,
                "text_shadow should be None after removal"
            );
        } else {
            panic!("expected Text node kind");
        }
    }

    #[test]
    fn test_set_text_style_field_text_shadow_rejects_nan_offset() {
        // TextShadow::new validates at construction time — attempting to build
        // a shadow with NaN offset should fail before we can even create the op.
        // This test verifies the constructor-level guard catches it.
        use crate::node::TextShadow;
        let result = TextShadow::new(f64::NAN, 0.0, 8.0, make_black_color());
        assert!(
            result.is_err(),
            "TextShadow with NaN offset_x must be rejected"
        );
    }

    #[test]
    fn test_set_text_style_field_text_shadow_none_is_always_valid() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::TextShadow(None),
        };
        assert!(
            op.validate(&doc).is_ok(),
            "TextShadow(None) must always pass validation"
        );
    }

    // ── Token reference pass-through ───────────────────────────────────────────

    #[test]
    fn test_set_text_style_field_font_size_token_ref_skips_range_check() {
        let (mut doc, node_id) = setup_doc_with_text();
        // Token references are not literal values — range validation is skipped.
        // A token ref with name "color.primary" would normally be an invalid font_size
        // literal, but as a token ref it must pass validate() because the value is
        // resolved at render time.
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::TokenRef {
                name: "font.size.lg".to_string(),
            }),
        };
        op.validate(&doc).expect("token refs must pass validation");
        op.apply(&mut doc).expect("apply");
    }

    // ── Constant enforcement tests ────────────────────────────────────────────

    #[test]
    fn test_min_font_size_enforced() {
        let (doc, node_id) = setup_doc_with_text();
        // Just below MIN_FONT_SIZE
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal {
                value: MIN_FONT_SIZE - 0.01,
            }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_size below MIN_FONT_SIZE must be rejected"
        );

        // At MIN_FONT_SIZE — should pass
        let op_at = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal {
                value: MIN_FONT_SIZE,
            }),
        };
        assert!(
            op_at.validate(&doc).is_ok(),
            "font_size at MIN_FONT_SIZE must be accepted"
        );
    }

    #[test]
    fn test_max_font_size_enforced() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal {
                value: MAX_FONT_SIZE + 1.0,
            }),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_size above MAX_FONT_SIZE must be rejected"
        );

        // At MAX_FONT_SIZE — should pass
        let op_at = SetTextStyleField {
            node_id,
            field: TextStyleField::FontSize(StyleValue::Literal {
                value: MAX_FONT_SIZE,
            }),
        };
        assert!(
            op_at.validate(&doc).is_ok(),
            "font_size at MAX_FONT_SIZE must be accepted"
        );
    }

    #[test]
    fn test_min_font_weight_enforced() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(MIN_FONT_WEIGHT.saturating_sub(1)),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_weight below MIN_FONT_WEIGHT must be rejected"
        );

        let op_at = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(MIN_FONT_WEIGHT),
        };
        assert!(
            op_at.validate(&doc).is_ok(),
            "font_weight at MIN_FONT_WEIGHT must be accepted"
        );
    }

    #[test]
    fn test_max_font_weight_enforced() {
        let (doc, node_id) = setup_doc_with_text();
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(MAX_FONT_WEIGHT + 1),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_weight above MAX_FONT_WEIGHT must be rejected"
        );

        let op_at = SetTextStyleField {
            node_id,
            field: TextStyleField::FontWeight(MAX_FONT_WEIGHT),
        };
        assert!(
            op_at.validate(&doc).is_ok(),
            "font_weight at MAX_FONT_WEIGHT must be accepted"
        );
    }

    #[test]
    fn test_max_font_family_len_enforced() {
        let (doc, node_id) = setup_doc_with_text();
        let long_name = "x".repeat(MAX_FONT_FAMILY_LEN + 1);
        let op = SetTextStyleField {
            node_id,
            field: TextStyleField::FontFamily(long_name),
        };
        assert!(
            op.validate(&doc).is_err(),
            "font_family exceeding MAX_FONT_FAMILY_LEN must be rejected"
        );

        let at_limit = "x".repeat(MAX_FONT_FAMILY_LEN);
        let op_at = SetTextStyleField {
            node_id,
            field: TextStyleField::FontFamily(at_limit),
        };
        assert!(
            op_at.validate(&doc).is_ok(),
            "font_family at MAX_FONT_FAMILY_LEN must be accepted"
        );
    }
}
