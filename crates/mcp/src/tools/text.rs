//! Text tool implementations — `set_text_content` and `set_text_style`.
//!
//! All mutations follow the pattern:
//!   validate input → lock → resolve UUID → construct operation →
//!   `op.validate(&doc)?; op.apply(&mut doc)?;` → build response → drop lock → broadcast

use agent_designer_core::{
    Color, FieldOperation, FontStyle, NodeKind, StyleValue, TextAlign, TextDecoration, TextShadow,
    commands::node_commands::SetTextContent,
    commands::text_style_commands::{SetTextStyleField, TextStyleField},
};
use agent_designer_state::{AppState, MutationEventKind, OperationPayload};
use uuid::Uuid;

use crate::error::McpToolError;
use crate::server::acquire_document_lock;
use crate::tools::nodes::build_node_info;
use crate::types::{
    ColorInput, MutationResult, NodeInfo, PartialTextStyle, StyleValueInput, TextShadowInput,
};

// ── Conversion helpers ───────────────────────────────────────────────────────

/// Converts a `StyleValueInput<f64>` to a core `StyleValue<f64>`, validating
/// finite floats before conversion.
fn convert_style_value_f64(
    field_name: &str,
    input: &StyleValueInput<f64>,
) -> Result<StyleValue<f64>, McpToolError> {
    match input {
        StyleValueInput::Literal { value } => {
            if !value.is_finite() {
                return Err(McpToolError::InvalidInput(format!(
                    "{field_name} must be finite (no NaN or infinity)"
                )));
            }
            Ok(StyleValue::Literal { value: *value })
        }
        StyleValueInput::TokenRef { name } => Ok(StyleValue::TokenRef { name: name.clone() }),
    }
}

/// Validates that a float is finite.
fn validate_float(field_name: &str, value: f64) -> Result<(), McpToolError> {
    if !value.is_finite() {
        return Err(McpToolError::InvalidInput(format!(
            "{field_name} must be finite (no NaN or infinity)"
        )));
    }
    Ok(())
}

/// Converts a `ColorInput` to a core `Color`, validating finite floats.
fn convert_color(input: &ColorInput) -> Result<Color, McpToolError> {
    match input {
        ColorInput::Srgb { r, g, b, a } => {
            validate_float("color.r", *r)?;
            validate_float("color.g", *g)?;
            validate_float("color.b", *b)?;
            validate_float("color.a", *a)?;
            Ok(Color::Srgb {
                r: *r,
                g: *g,
                b: *b,
                a: *a,
            })
        }
        ColorInput::DisplayP3 { r, g, b, a } => {
            validate_float("color.r", *r)?;
            validate_float("color.g", *g)?;
            validate_float("color.b", *b)?;
            validate_float("color.a", *a)?;
            Ok(Color::DisplayP3 {
                r: *r,
                g: *g,
                b: *b,
                a: *a,
            })
        }
        ColorInput::Oklch { l, c, h, a } => {
            validate_float("color.l", *l)?;
            validate_float("color.c", *c)?;
            validate_float("color.h", *h)?;
            validate_float("color.a", *a)?;
            Ok(Color::Oklch {
                l: *l,
                c: *c,
                h: *h,
                a: *a,
            })
        }
        ColorInput::Oklab { l, a, b, alpha } => {
            validate_float("color.l", *l)?;
            validate_float("color.a", *a)?;
            validate_float("color.b", *b)?;
            validate_float("color.alpha", *alpha)?;
            Ok(Color::Oklab {
                l: *l,
                a: *a,
                b: *b,
                alpha: *alpha,
            })
        }
    }
}

/// Converts a `StyleValueInput<ColorInput>` to a core `StyleValue<Color>`.
fn convert_style_value_color(
    input: &StyleValueInput<ColorInput>,
) -> Result<StyleValue<Color>, McpToolError> {
    match input {
        StyleValueInput::Literal { value } => {
            let color = convert_color(value)?;
            Ok(StyleValue::Literal { value: color })
        }
        StyleValueInput::TokenRef { name } => Ok(StyleValue::TokenRef { name: name.clone() }),
    }
}

/// Parses a font style string into a `FontStyle` enum.
fn parse_font_style(s: &str) -> Result<FontStyle, McpToolError> {
    match s {
        "normal" => Ok(FontStyle::Normal),
        "italic" => Ok(FontStyle::Italic),
        other => Err(McpToolError::InvalidInput(format!(
            "unknown font_style '{other}': expected 'normal' or 'italic'"
        ))),
    }
}

/// Parses a text align string into a `TextAlign` enum.
fn parse_text_align(s: &str) -> Result<TextAlign, McpToolError> {
    match s {
        "left" => Ok(TextAlign::Left),
        "center" => Ok(TextAlign::Center),
        "right" => Ok(TextAlign::Right),
        "justify" => Ok(TextAlign::Justify),
        other => Err(McpToolError::InvalidInput(format!(
            "unknown text_align '{other}': expected 'left', 'center', 'right', or 'justify'"
        ))),
    }
}

/// Parses a text decoration string into a `TextDecoration` enum.
fn parse_text_decoration(s: &str) -> Result<TextDecoration, McpToolError> {
    match s {
        "none" => Ok(TextDecoration::None),
        "underline" => Ok(TextDecoration::Underline),
        "strikethrough" => Ok(TextDecoration::Strikethrough),
        other => Err(McpToolError::InvalidInput(format!(
            "unknown text_decoration '{other}': expected 'none', 'underline', or 'strikethrough'"
        ))),
    }
}

/// Converts a `TextShadowInput` to a core `TextShadow`, validating floats.
fn convert_text_shadow(input: &TextShadowInput) -> Result<TextShadow, McpToolError> {
    validate_float("text_shadow.offset_x", input.offset_x)?;
    validate_float("text_shadow.offset_y", input.offset_y)?;
    validate_float("text_shadow.blur_radius", input.blur_radius)?;

    let color = convert_style_value_color(&input.color)?;
    TextShadow::new(input.offset_x, input.offset_y, input.blur_radius, color)
        .map_err(|e| McpToolError::InvalidInput(e.to_string()))
}

// ── set_text_content ─────────────────────────────────────────────────────────

/// Sets the text content of a text node.
///
/// # Errors
///
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` if the node is not a text node or validation fails.
pub fn set_text_content_impl(
    state: &AppState,
    uuid_str: &str,
    content: &str,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_info = {
        let mut doc = acquire_document_lock(state);
        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetTextContent {
            node_id,
            new_content: content.to_string(),
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    super::broadcast::broadcast_and_persist(
        state,
        MutationEventKind::NodeUpdated,
        &node_uuid.to_string(),
        "set_field",
        "kind.content",
        Some(serde_json::json!(content)),
    );

    Ok(node_info)
}

// ── set_text_style ───────────────────────────────────────────────────────────

/// Collects `(TextStyleField, broadcast_path, broadcast_value)` tuples from a
/// `PartialTextStyle`, validating all floats before returning.
///
/// Returns an error if all fields are `None` (empty update).
fn collect_style_fields(
    style: &PartialTextStyle,
) -> Result<Vec<(TextStyleField, &'static str, serde_json::Value)>, McpToolError> {
    let mut fields: Vec<(TextStyleField, &'static str, serde_json::Value)> = Vec::new();

    if let Some(ref family) = style.font_family {
        fields.push((
            TextStyleField::FontFamily(family.clone()),
            "kind.text_style.font_family",
            serde_json::json!(family),
        ));
    }

    if let Some(ref font_size) = style.font_size {
        let sv = convert_style_value_f64("font_size", font_size)?;
        fields.push((
            TextStyleField::FontSize(sv),
            "kind.text_style.font_size",
            serde_json::to_value(font_size).map_err(McpToolError::SerializationError)?,
        ));
    }

    if let Some(weight) = style.font_weight {
        fields.push((
            TextStyleField::FontWeight(weight),
            "kind.text_style.font_weight",
            serde_json::json!(weight),
        ));
    }

    if let Some(ref font_style_str) = style.font_style {
        let fs = parse_font_style(font_style_str)?;
        fields.push((
            TextStyleField::FontStyle(fs),
            "kind.text_style.font_style",
            serde_json::json!(font_style_str),
        ));
    }

    if let Some(ref line_height) = style.line_height {
        let sv = convert_style_value_f64("line_height", line_height)?;
        fields.push((
            TextStyleField::LineHeight(sv),
            "kind.text_style.line_height",
            serde_json::to_value(line_height).map_err(McpToolError::SerializationError)?,
        ));
    }

    if let Some(ref letter_spacing) = style.letter_spacing {
        let sv = convert_style_value_f64("letter_spacing", letter_spacing)?;
        fields.push((
            TextStyleField::LetterSpacing(sv),
            "kind.text_style.letter_spacing",
            serde_json::to_value(letter_spacing).map_err(McpToolError::SerializationError)?,
        ));
    }

    if let Some(ref text_align_str) = style.text_align {
        let ta = parse_text_align(text_align_str)?;
        fields.push((
            TextStyleField::TextAlign(ta),
            "kind.text_style.text_align",
            serde_json::json!(text_align_str),
        ));
    }

    if let Some(ref text_decoration_str) = style.text_decoration {
        let td = parse_text_decoration(text_decoration_str)?;
        fields.push((
            TextStyleField::TextDecoration(td),
            "kind.text_style.text_decoration",
            serde_json::json!(text_decoration_str),
        ));
    }

    if let Some(ref text_color) = style.text_color {
        let sv = convert_style_value_color(text_color)?;
        fields.push((
            TextStyleField::TextColor(sv),
            "kind.text_style.text_color",
            serde_json::to_value(text_color).map_err(McpToolError::SerializationError)?,
        ));
    }

    if let Some(ref shadow_opt) = style.text_shadow {
        let core_shadow = match shadow_opt {
            Some(shadow_input) => Some(convert_text_shadow(shadow_input)?),
            None => None,
        };
        let json_val = match shadow_opt {
            Some(s) => serde_json::to_value(s).map_err(McpToolError::SerializationError)?,
            None => serde_json::Value::Null,
        };
        fields.push((
            TextStyleField::TextShadow(core_shadow),
            "kind.text_style.text_shadow",
            json_val,
        ));
    }

    if fields.is_empty() {
        return Err(McpToolError::InvalidInput(
            "set_text_style requires at least one style field to be set".to_string(),
        ));
    }

    Ok(fields)
}

/// Captures the previous value of a text style field for rollback.
///
/// Returns the old `TextStyleField` value so it can be re-applied on failure.
fn capture_old_field(
    doc: &agent_designer_core::Document,
    node_id: agent_designer_core::NodeId,
    field: &TextStyleField,
) -> Result<TextStyleField, McpToolError> {
    let node = doc
        .arena
        .get(node_id)
        .map_err(|_| McpToolError::NodeNotFound(format!("{node_id:?}")))?;

    let NodeKind::Text { text_style, .. } = &node.kind else {
        return Err(McpToolError::InvalidInput(
            "node is not a text node".to_string(),
        ));
    };

    let old = match field {
        TextStyleField::FontFamily(_) => TextStyleField::FontFamily(text_style.font_family.clone()),
        TextStyleField::FontSize(_) => TextStyleField::FontSize(text_style.font_size.clone()),
        TextStyleField::FontWeight(_) => TextStyleField::FontWeight(text_style.font_weight),
        TextStyleField::FontStyle(_) => TextStyleField::FontStyle(text_style.font_style),
        TextStyleField::LineHeight(_) => TextStyleField::LineHeight(text_style.line_height.clone()),
        TextStyleField::LetterSpacing(_) => {
            TextStyleField::LetterSpacing(text_style.letter_spacing.clone())
        }
        TextStyleField::TextAlign(_) => TextStyleField::TextAlign(text_style.text_align),
        TextStyleField::TextDecoration(_) => {
            TextStyleField::TextDecoration(text_style.text_decoration)
        }
        TextStyleField::TextColor(_) => TextStyleField::TextColor(text_style.text_color.clone()),
        TextStyleField::TextShadow(_) => TextStyleField::TextShadow(text_style.text_shadow.clone()),
    };
    Ok(old)
}

/// Sets one or more text style properties on a text node.
///
/// # Errors
///
/// - `McpToolError::InvalidInput` if the style is empty or contains invalid values.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` if the node is not a text node or validation fails.
pub fn set_text_style_impl(
    state: &AppState,
    uuid_str: &str,
    style: &PartialTextStyle,
) -> Result<MutationResult, McpToolError> {
    // Parse and validate all fields before acquiring the lock.
    let fields = collect_style_fields(style)?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    // Build broadcast operation payloads from the parsed fields.
    let broadcast_ops: Vec<OperationPayload> = fields
        .iter()
        .map(|(_, path, value)| OperationPayload {
            id: Uuid::new_v4().to_string(),
            node_uuid: node_uuid.to_string(),
            op_type: "set_field".to_string(),
            path: (*path).to_string(),
            value: Some(value.clone()),
        })
        .collect();

    {
        let mut doc = acquire_document_lock(state);
        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        // Validate ALL fields first, then apply ALL.
        // Per CLAUDE.md section 11: multi-item mutations must roll back on partial failure.
        for (field, _, _) in &fields {
            let cmd = SetTextStyleField {
                node_id,
                field: field.clone(),
            };
            cmd.validate(&doc)?;
        }

        // Capture ALL old values in a single pass before any mutations.
        // Per CLAUDE.md: capture snapshots before mutations, not after.
        let old_fields: Vec<TextStyleField> = fields
            .iter()
            .map(|(field, _, _)| capture_old_field(&doc, node_id, field))
            .collect::<Result<Vec<_>, _>>()?;

        // Apply with rollback tracking.
        let mut applied: Vec<TextStyleField> = Vec::with_capacity(fields.len());

        for (i, (field, _, _)) in fields.iter().enumerate() {
            let cmd = SetTextStyleField {
                node_id,
                field: field.clone(),
            };
            if let Err(apply_err) = cmd.apply(&mut doc) {
                // Roll back all previously applied fields in reverse order.
                let mut rollback_errors: Vec<String> = Vec::new();
                for old in applied.into_iter().rev() {
                    let rollback_cmd = SetTextStyleField {
                        node_id,
                        field: old,
                    };
                    if let Err(rb_err) = rollback_cmd.apply(&mut doc) {
                        rollback_errors.push(rb_err.to_string());
                    }
                }

                if rollback_errors.is_empty() {
                    return Err(McpToolError::CoreError(apply_err));
                }
                return Err(McpToolError::InvalidInput(format!(
                    "apply failed ({apply_err}) and rollback also failed: {}",
                    rollback_errors.join("; ")
                )));
            }
            // old_fields[i] is safe — old_fields has the same length as fields.
            applied.push(old_fields[i].clone());
        }
    }

    // Broadcast all operations as a single transaction.
    state.signal_dirty();
    state.publish_transaction(
        MutationEventKind::NodeUpdated,
        Some(node_uuid.to_string()),
        super::broadcast::multi_op_transaction(broadcast_ops),
    );

    Ok(MutationResult {
        success: true,
        message: format!(
            "updated {} text style field(s) on node {uuid_str}",
            fields.len()
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── PartialTextStyle parsing ──────────────────────────────────────────

    #[test]
    fn test_collect_style_fields_rejects_empty_style() {
        let style = PartialTextStyle::default();
        let result = collect_style_fields(&style);
        assert!(result.is_err(), "empty PartialTextStyle must be rejected");
    }

    #[test]
    fn test_collect_style_fields_accepts_single_field() {
        let style = PartialTextStyle {
            font_family: Some("Inter".to_string()),
            ..Default::default()
        };
        let result = collect_style_fields(&style);
        assert!(result.is_ok());
        assert_eq!(result.expect("ok").len(), 1);
    }

    #[test]
    fn test_collect_style_fields_accepts_multiple_fields() {
        let style = PartialTextStyle {
            font_family: Some("Inter".to_string()),
            font_weight: Some(700),
            text_align: Some("center".to_string()),
            ..Default::default()
        };
        let result = collect_style_fields(&style);
        assert!(result.is_ok());
        assert_eq!(result.expect("ok").len(), 3);
    }

    // ── Float validation ──────────────────────────────────────────────────

    #[test]
    fn test_collect_style_fields_rejects_nan_font_size() {
        let style = PartialTextStyle {
            font_size: Some(StyleValueInput::Literal { value: f64::NAN }),
            ..Default::default()
        };
        assert!(collect_style_fields(&style).is_err());
    }

    #[test]
    fn test_collect_style_fields_rejects_infinity_line_height() {
        let style = PartialTextStyle {
            line_height: Some(StyleValueInput::Literal {
                value: f64::INFINITY,
            }),
            ..Default::default()
        };
        assert!(collect_style_fields(&style).is_err());
    }

    #[test]
    fn test_collect_style_fields_rejects_nan_letter_spacing() {
        let style = PartialTextStyle {
            letter_spacing: Some(StyleValueInput::Literal { value: f64::NAN }),
            ..Default::default()
        };
        assert!(collect_style_fields(&style).is_err());
    }

    // ── String enum parsing ───────────────────────────────────────────────

    #[test]
    fn test_parse_font_style_valid() {
        assert_eq!(parse_font_style("normal").expect("ok"), FontStyle::Normal);
        assert_eq!(parse_font_style("italic").expect("ok"), FontStyle::Italic);
    }

    #[test]
    fn test_parse_font_style_rejects_unknown() {
        assert!(parse_font_style("oblique").is_err());
    }

    #[test]
    fn test_parse_text_align_valid() {
        assert_eq!(parse_text_align("left").expect("ok"), TextAlign::Left);
        assert_eq!(parse_text_align("center").expect("ok"), TextAlign::Center);
        assert_eq!(parse_text_align("right").expect("ok"), TextAlign::Right);
        assert_eq!(parse_text_align("justify").expect("ok"), TextAlign::Justify);
    }

    #[test]
    fn test_parse_text_align_rejects_unknown() {
        assert!(parse_text_align("start").is_err());
    }

    #[test]
    fn test_parse_text_decoration_valid() {
        assert_eq!(
            parse_text_decoration("none").expect("ok"),
            TextDecoration::None
        );
        assert_eq!(
            parse_text_decoration("underline").expect("ok"),
            TextDecoration::Underline
        );
        assert_eq!(
            parse_text_decoration("strikethrough").expect("ok"),
            TextDecoration::Strikethrough
        );
    }

    #[test]
    fn test_parse_text_decoration_rejects_unknown() {
        assert!(parse_text_decoration("line-through").is_err());
    }

    // ── Color conversion ──────────────────────────────────────────────────

    #[test]
    fn test_convert_color_srgb_valid() {
        let input = ColorInput::Srgb {
            r: 1.0,
            g: 0.5,
            b: 0.0,
            a: 1.0,
        };
        let result = convert_color(&input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_convert_color_rejects_nan() {
        let input = ColorInput::Srgb {
            r: f64::NAN,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        };
        assert!(convert_color(&input).is_err());
    }

    #[test]
    fn test_convert_color_oklch_valid() {
        let input = ColorInput::Oklch {
            l: 0.5,
            c: 0.3,
            h: 180.0,
            a: 1.0,
        };
        assert!(convert_color(&input).is_ok());
    }

    #[test]
    fn test_convert_color_oklab_valid() {
        let input = ColorInput::Oklab {
            l: 0.5,
            a: 0.1,
            b: -0.1,
            alpha: 1.0,
        };
        assert!(convert_color(&input).is_ok());
    }

    #[test]
    fn test_convert_color_display_p3_valid() {
        let input = ColorInput::DisplayP3 {
            r: 0.8,
            g: 0.2,
            b: 0.5,
            a: 0.9,
        };
        assert!(convert_color(&input).is_ok());
    }

    // ── TextShadow conversion ─────────────────────────────────────────────

    #[test]
    fn test_convert_text_shadow_valid() {
        let input = TextShadowInput {
            offset_x: 2.0,
            offset_y: 4.0,
            blur_radius: 8.0,
            color: StyleValueInput::Literal {
                value: ColorInput::Srgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
        };
        assert!(convert_text_shadow(&input).is_ok());
    }

    #[test]
    fn test_convert_text_shadow_rejects_nan_offset() {
        let input = TextShadowInput {
            offset_x: f64::NAN,
            offset_y: 0.0,
            blur_radius: 0.0,
            color: StyleValueInput::Literal {
                value: ColorInput::Srgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
        };
        assert!(convert_text_shadow(&input).is_err());
    }

    #[test]
    fn test_convert_text_shadow_rejects_negative_blur() {
        let input = TextShadowInput {
            offset_x: 0.0,
            offset_y: 0.0,
            blur_radius: -1.0,
            color: StyleValueInput::Literal {
                value: ColorInput::Srgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
        };
        assert!(convert_text_shadow(&input).is_err());
    }

    #[test]
    fn test_convert_text_shadow_with_token_ref_color() {
        let input = TextShadowInput {
            offset_x: 1.0,
            offset_y: 1.0,
            blur_radius: 2.0,
            color: StyleValueInput::TokenRef {
                name: "color.shadow".to_string(),
            },
        };
        assert!(convert_text_shadow(&input).is_ok());
    }

    // ── StyleValueInput with token ref ────────────────────────────────────

    #[test]
    fn test_collect_style_fields_font_size_token_ref() {
        let style = PartialTextStyle {
            font_size: Some(StyleValueInput::TokenRef {
                name: "font.size.lg".to_string(),
            }),
            ..Default::default()
        };
        let result = collect_style_fields(&style);
        assert!(result.is_ok());
    }

    // ── text_shadow field: None removes shadow ────────────────────────────

    #[test]
    fn test_collect_style_fields_text_shadow_none_removes() {
        let style = PartialTextStyle {
            text_shadow: Some(None),
            ..Default::default()
        };
        let result = collect_style_fields(&style).expect("should be valid");
        assert_eq!(result.len(), 1);
        match &result[0].0 {
            TextStyleField::TextShadow(None) => {}
            other => panic!("expected TextShadow(None), got {other:?}"),
        }
    }

    // ── Invalid enum strings ──────────────────────────────────────────────

    #[test]
    fn test_collect_style_fields_rejects_invalid_font_style() {
        let style = PartialTextStyle {
            font_style: Some("oblique".to_string()),
            ..Default::default()
        };
        assert!(collect_style_fields(&style).is_err());
    }

    #[test]
    fn test_collect_style_fields_rejects_invalid_text_align() {
        let style = PartialTextStyle {
            text_align: Some("start".to_string()),
            ..Default::default()
        };
        assert!(collect_style_fields(&style).is_err());
    }

    #[test]
    fn test_collect_style_fields_rejects_invalid_text_decoration() {
        let style = PartialTextStyle {
            text_decoration: Some("overline".to_string()),
            ..Default::default()
        };
        assert!(collect_style_fields(&style).is_err());
    }
}
