// crates/core/src/token.rs

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::id::TokenId;
use crate::node::{Color, GradientDef, Point};
use crate::validate::{MAX_FONT_FAMILY_LEN, validate_token_name};

/// Dimension units for design tokens (W3C Design Tokens Format).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DimensionUnit {
    Px,
    Rem,
    Em,
    Percent,
}

/// Shadow token value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShadowValue {
    pub color: Color,
    pub offset: Point,
    pub blur: f64,
    pub spread: f64,
}

/// Gradient token value -- wraps the existing `GradientDef`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientValue {
    pub gradient: GradientDef,
}

/// Typography composite token value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TypographyValue {
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u16,
    pub line_height: f64,
    pub letter_spacing: f64,
}

/// Token type categories (W3C Design Tokens Format).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenType {
    Color,
    Dimension,
    FontFamily,
    FontWeight,
    Duration,
    CubicBezier,
    Number,
    Shadow,
    Gradient,
    Typography,
}

/// A token's resolved or literal value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TokenValue {
    Color { value: Color },
    Dimension { value: f64, unit: DimensionUnit },
    FontFamily { families: Vec<String> },
    FontWeight { weight: u16 },
    Duration { seconds: f64 },
    CubicBezier { values: [f64; 4] },
    Number { value: f64 },
    Shadow { value: ShadowValue },
    Gradient { value: GradientValue },
    Typography { value: TypographyValue },
    Alias { name: String },
}

/// A design token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[allow(clippy::struct_field_names)]
pub struct Token {
    id: TokenId,
    name: String,
    value: TokenValue,
    token_type: TokenType,
    description: Option<String>,
}

impl Token {
    /// Creates a new token, validating the name and value.
    ///
    /// # Errors
    /// Returns `CoreError::InvalidTokenName` if the name is invalid.
    /// Returns `CoreError::ValidationError` for invalid token values.
    pub fn new(
        id: TokenId,
        name: String,
        value: TokenValue,
        token_type: TokenType,
        description: Option<String>,
    ) -> Result<Self, CoreError> {
        validate_token_name(&name)?;
        validate_token_value(&value)?;
        Ok(Self {
            id,
            name,
            value,
            token_type,
            description,
        })
    }

    /// Returns the token's ID.
    #[must_use]
    pub fn id(&self) -> TokenId {
        self.id
    }

    /// Returns the token's name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns the token's value.
    #[must_use]
    pub fn value(&self) -> &TokenValue {
        &self.value
    }

    /// Returns the token's type category.
    #[must_use]
    pub fn token_type(&self) -> TokenType {
        self.token_type
    }

    /// Returns the token's description.
    #[must_use]
    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }
}

/// Maximum number of tokens per document.
pub const MAX_TOKENS_PER_CONTEXT: usize = 50_000;

/// Maximum description length for a token.
pub const MAX_TOKEN_DESCRIPTION_LEN: usize = 1_024;

/// Maximum number of font families in a `FontFamily` token.
pub const MAX_TOKEN_FONT_FAMILIES: usize = 32;

/// Validates a token value's fields.
///
/// # Errors
/// Returns `CoreError::ValidationError` for invalid values.
pub fn validate_token_value(value: &TokenValue) -> Result<(), CoreError> {
    match value {
        TokenValue::Dimension { value: v, .. } => {
            crate::validate::validate_finite("dimension value", *v)?;
        }
        TokenValue::FontFamily { families } => {
            if families.is_empty() {
                return Err(CoreError::ValidationError(
                    "font family list must not be empty".to_string(),
                ));
            }
            if families.len() > MAX_TOKEN_FONT_FAMILIES {
                return Err(CoreError::ValidationError(format!(
                    "too many font families: {} (max {MAX_TOKEN_FONT_FAMILIES})",
                    families.len()
                )));
            }
            for family in families {
                if family.len() > MAX_FONT_FAMILY_LEN {
                    return Err(CoreError::ValidationError(format!(
                        "font family name too long: {} (max {MAX_FONT_FAMILY_LEN})",
                        family.len()
                    )));
                }
            }
        }
        TokenValue::FontWeight { weight } => {
            if *weight < crate::validate::MIN_FONT_WEIGHT
                || *weight > crate::validate::MAX_FONT_WEIGHT
            {
                return Err(CoreError::ValidationError(format!(
                    "font weight must be {}-{}, got {weight}",
                    crate::validate::MIN_FONT_WEIGHT,
                    crate::validate::MAX_FONT_WEIGHT
                )));
            }
        }
        TokenValue::Duration { seconds } => {
            crate::validate::validate_finite("duration", *seconds)?;
            if *seconds < 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "duration must be non-negative, got {seconds}"
                )));
            }
        }
        TokenValue::CubicBezier { values } => {
            for (i, v) in values.iter().enumerate() {
                crate::validate::validate_finite(&format!("cubic bezier[{i}]"), *v)?;
            }
            // P1.x and P2.x must be in [0.0, 1.0]
            if values[0] < 0.0 || values[0] > 1.0 {
                return Err(CoreError::ValidationError(format!(
                    "cubic bezier P1.x must be in [0.0, 1.0], got {}",
                    values[0]
                )));
            }
            if values[2] < 0.0 || values[2] > 1.0 {
                return Err(CoreError::ValidationError(format!(
                    "cubic bezier P2.x must be in [0.0, 1.0], got {}",
                    values[2]
                )));
            }
        }
        TokenValue::Number { value: v } => {
            crate::validate::validate_finite("number token", *v)?;
        }
        TokenValue::Shadow { value: shadow } => {
            crate::validate::validate_finite("shadow blur", shadow.blur)?;
            crate::validate::validate_finite("shadow spread", shadow.spread)?;
            crate::validate::validate_finite("shadow offset x", shadow.offset.x)?;
            crate::validate::validate_finite("shadow offset y", shadow.offset.y)?;
        }
        TokenValue::Typography { value: typo } => {
            crate::validate::validate_finite("font size", typo.font_size)?;
            crate::validate::validate_finite("line height", typo.line_height)?;
            crate::validate::validate_finite("letter spacing", typo.letter_spacing)?;
            if typo.font_family.len() > MAX_FONT_FAMILY_LEN {
                return Err(CoreError::ValidationError(format!(
                    "font family name too long: {} (max {MAX_FONT_FAMILY_LEN})",
                    typo.font_family.len()
                )));
            }
            if typo.font_weight < crate::validate::MIN_FONT_WEIGHT
                || typo.font_weight > crate::validate::MAX_FONT_WEIGHT
            {
                return Err(CoreError::ValidationError(format!(
                    "font weight must be {}-{}, got {}",
                    crate::validate::MIN_FONT_WEIGHT,
                    crate::validate::MAX_FONT_WEIGHT,
                    typo.font_weight
                )));
            }
        }
        TokenValue::Alias { name } => {
            validate_token_name(name)?;
        }
        TokenValue::Color { .. } | TokenValue::Gradient { .. } => {
            // Color validation handled by the Color type
            // Gradient validation handled by GradientDef
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_token_id(n: u8) -> TokenId {
        TokenId::new(Uuid::from_bytes([
            n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]))
    }

    fn make_color_token(name: &str) -> Token {
        Token::new(
            make_token_id(1),
            name.to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid token")
    }

    // ── Token construction ──────────────────────────────────────────

    #[test]
    fn test_token_new_valid() {
        let token = make_color_token("color.primary");
        assert_eq!(token.name(), "color.primary");
        assert_eq!(token.token_type(), TokenType::Color);
        assert!(token.description().is_none());
    }

    #[test]
    fn test_token_new_invalid_name() {
        let result = Token::new(
            make_token_id(1),
            "123invalid".to_string(),
            TokenValue::Number { value: 42.0 },
            TokenType::Number,
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_token_with_description() {
        let token = Token::new(
            make_token_id(1),
            "spacing.sm".to_string(),
            TokenValue::Dimension {
                value: 8.0,
                unit: DimensionUnit::Px,
            },
            TokenType::Dimension,
            Some("Small spacing".to_string()),
        )
        .expect("valid token");
        assert_eq!(token.description(), Some("Small spacing"));
    }

    #[test]
    fn test_token_id_accessor() {
        let id = make_token_id(42);
        let token = Token::new(
            id,
            "color.test".to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid token");
        assert_eq!(token.id(), id);
    }

    #[test]
    fn test_token_value_accessor() {
        let token = Token::new(
            make_token_id(1),
            "spacing.md".to_string(),
            TokenValue::Dimension {
                value: 16.0,
                unit: DimensionUnit::Px,
            },
            TokenType::Dimension,
            None,
        )
        .expect("valid token");
        assert!(matches!(
            token.value(),
            TokenValue::Dimension { value, .. } if (*value - 16.0).abs() < f64::EPSILON
        ));
    }

    // ── TokenValue serde round-trips ────────────────────────────────

    #[test]
    fn test_token_value_color_serde() {
        let val = TokenValue::Color {
            value: Color::Srgb {
                r: 1.0,
                g: 0.0,
                b: 0.5,
                a: 1.0,
            },
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_dimension_serde() {
        let val = TokenValue::Dimension {
            value: 16.0,
            unit: DimensionUnit::Rem,
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_font_family_serde() {
        let val = TokenValue::FontFamily {
            families: vec!["Inter".to_string(), "sans-serif".to_string()],
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_font_weight_serde() {
        let val = TokenValue::FontWeight { weight: 700 };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_duration_serde() {
        let val = TokenValue::Duration { seconds: 0.3 };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_cubic_bezier_serde() {
        let val = TokenValue::CubicBezier {
            values: [0.4, 0.0, 0.2, 1.0],
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_number_serde() {
        let val = TokenValue::Number { value: 42.0 };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_shadow_serde() {
        let val = TokenValue::Shadow {
            value: ShadowValue {
                color: Color::default(),
                offset: Point::new(0.0, 4.0),
                blur: 8.0,
                spread: 0.0,
            },
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_gradient_serde() {
        use crate::node::{GradientStop, Point, StyleValue};
        let val = TokenValue::Gradient {
            value: GradientValue {
                gradient: GradientDef {
                    stops: vec![
                        GradientStop {
                            position: 0.0,
                            color: StyleValue::Literal {
                                value: Color::default(),
                            },
                        },
                        GradientStop {
                            position: 1.0,
                            color: StyleValue::Literal {
                                value: Color::Srgb {
                                    r: 1.0,
                                    g: 1.0,
                                    b: 1.0,
                                    a: 1.0,
                                },
                            },
                        },
                    ],
                    start: Point::zero(),
                    end: Point::new(1.0, 1.0),
                },
            },
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_typography_serde() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 400,
                line_height: 1.5,
                letter_spacing: 0.0,
            },
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_token_value_alias_serde() {
        let val = TokenValue::Alias {
            name: "color.primary".to_string(),
        };
        let json = serde_json::to_string(&val).expect("serialize");
        let deserialized: TokenValue = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(val, deserialized);
    }

    // ── Validation ──────────────────────────────────────────────────

    #[test]
    fn test_validate_token_value_nan_dimension() {
        let val = TokenValue::Dimension {
            value: f64::NAN,
            unit: DimensionUnit::Px,
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_infinity_dimension() {
        let val = TokenValue::Dimension {
            value: f64::INFINITY,
            unit: DimensionUnit::Px,
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_negative_duration() {
        let val = TokenValue::Duration { seconds: -1.0 };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_zero_duration_valid() {
        let val = TokenValue::Duration { seconds: 0.0 };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_nan_duration() {
        let val = TokenValue::Duration { seconds: f64::NAN };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_cubic_bezier_p1x_out_of_range() {
        let val = TokenValue::CubicBezier {
            values: [1.5, 0.0, 0.2, 1.0],
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_cubic_bezier_p2x_out_of_range() {
        let val = TokenValue::CubicBezier {
            values: [0.4, 0.0, -0.1, 1.0],
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_cubic_bezier_p1x_negative() {
        let val = TokenValue::CubicBezier {
            values: [-0.1, 0.0, 0.2, 1.0],
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_cubic_bezier_nan() {
        let val = TokenValue::CubicBezier {
            values: [0.4, f64::NAN, 0.2, 1.0],
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_cubic_bezier_valid_boundary() {
        // P1.x=0, P2.x=1 should be valid (boundary values)
        let val = TokenValue::CubicBezier {
            values: [0.0, -2.0, 1.0, 2.0],
        };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_cubic_bezier_p1y_p2y_unbounded() {
        // P1.y and P2.y can be any finite value (they are NOT constrained to [0,1])
        let val = TokenValue::CubicBezier {
            values: [0.5, -100.0, 0.5, 100.0],
        };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_font_weight_too_low() {
        let val = TokenValue::FontWeight { weight: 0 };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_font_weight_too_high() {
        let val = TokenValue::FontWeight { weight: 1001 };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_font_weight_valid_min() {
        let val = TokenValue::FontWeight {
            weight: crate::validate::MIN_FONT_WEIGHT,
        };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_font_weight_valid_max() {
        let val = TokenValue::FontWeight {
            weight: crate::validate::MAX_FONT_WEIGHT,
        };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_empty_font_family() {
        let val = TokenValue::FontFamily { families: vec![] };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_font_family_name_too_long() {
        let val = TokenValue::FontFamily {
            families: vec!["a".repeat(MAX_FONT_FAMILY_LEN + 1)],
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_too_many_font_families() {
        let families: Vec<String> = (0..MAX_TOKEN_FONT_FAMILIES + 1)
            .map(|i| format!("Font{i}"))
            .collect();
        let val = TokenValue::FontFamily { families };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_font_family_valid() {
        let val = TokenValue::FontFamily {
            families: vec!["Inter".to_string()],
        };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_shadow_nan_blur() {
        let val = TokenValue::Shadow {
            value: ShadowValue {
                color: Color::default(),
                offset: Point::zero(),
                blur: f64::NAN,
                spread: 0.0,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_shadow_nan_spread() {
        let val = TokenValue::Shadow {
            value: ShadowValue {
                color: Color::default(),
                offset: Point::zero(),
                blur: 0.0,
                spread: f64::INFINITY,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_shadow_nan_offset_x() {
        let val = TokenValue::Shadow {
            value: ShadowValue {
                color: Color::default(),
                offset: Point::new(f64::NAN, 0.0),
                blur: 0.0,
                spread: 0.0,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_shadow_nan_offset_y() {
        let val = TokenValue::Shadow {
            value: ShadowValue {
                color: Color::default(),
                offset: Point::new(0.0, f64::NAN),
                blur: 0.0,
                spread: 0.0,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_shadow_valid() {
        let val = TokenValue::Shadow {
            value: ShadowValue {
                color: Color::default(),
                offset: Point::new(2.0, 4.0),
                blur: 8.0,
                spread: 1.0,
            },
        };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_typography_nan_font_size() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: f64::NAN,
                font_weight: 400,
                line_height: 1.5,
                letter_spacing: 0.0,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_typography_nan_line_height() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 400,
                line_height: f64::NAN,
                letter_spacing: 0.0,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_typography_nan_letter_spacing() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 400,
                line_height: 1.5,
                letter_spacing: f64::INFINITY,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_typography_font_family_too_long() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "a".repeat(MAX_FONT_FAMILY_LEN + 1),
                font_size: 16.0,
                font_weight: 400,
                line_height: 1.5,
                letter_spacing: 0.0,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_typography_font_weight_out_of_range() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 0,
                line_height: 1.5,
                letter_spacing: 0.0,
            },
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_typography_valid() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 400,
                line_height: 1.5,
                letter_spacing: 0.0,
            },
        };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_alias_invalid_name() {
        let val = TokenValue::Alias {
            name: "123bad".to_string(),
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_alias_valid() {
        let val = TokenValue::Alias {
            name: "color.primary".to_string(),
        };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_nan_number() {
        let val = TokenValue::Number { value: f64::NAN };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_number_valid() {
        let val = TokenValue::Number { value: 42.0 };
        assert!(validate_token_value(&val).is_ok());
    }

    #[test]
    fn test_validate_token_value_color_valid() {
        let val = TokenValue::Color {
            value: Color::default(),
        };
        assert!(validate_token_value(&val).is_ok());
    }

    // ── Token serde round-trip ──────────────────────────────────────

    #[test]
    fn test_token_serde_round_trip() {
        let token = Token::new(
            make_token_id(1),
            "color.primary.500".to_string(),
            TokenValue::Color {
                value: Color::Srgb {
                    r: 0.2,
                    g: 0.4,
                    b: 0.8,
                    a: 1.0,
                },
            },
            TokenType::Color,
            Some("Primary brand color".to_string()),
        )
        .expect("valid token");

        let json = serde_json::to_string(&token).expect("serialize");
        let deserialized: Token = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(token, deserialized);
    }

    #[test]
    fn test_token_serde_round_trip_dimension() {
        let token = Token::new(
            make_token_id(2),
            "spacing.lg".to_string(),
            TokenValue::Dimension {
                value: 24.0,
                unit: DimensionUnit::Px,
            },
            TokenType::Dimension,
            None,
        )
        .expect("valid token");

        let json = serde_json::to_string(&token).expect("serialize");
        let deserialized: Token = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(token, deserialized);
    }

    #[test]
    fn test_token_new_rejects_invalid_value() {
        let result = Token::new(
            make_token_id(1),
            "spacing.bad".to_string(),
            TokenValue::Dimension {
                value: f64::NAN,
                unit: DimensionUnit::Px,
            },
            TokenType::Dimension,
            None,
        );
        assert!(result.is_err());
    }

    // ── DimensionUnit serde ─────────────────────────────────────────

    #[test]
    fn test_dimension_unit_serde_px() {
        let json = serde_json::to_string(&DimensionUnit::Px).expect("serialize");
        assert_eq!(json, "\"px\"");
    }

    #[test]
    fn test_dimension_unit_serde_rem() {
        let json = serde_json::to_string(&DimensionUnit::Rem).expect("serialize");
        assert_eq!(json, "\"rem\"");
    }

    #[test]
    fn test_dimension_unit_serde_em() {
        let json = serde_json::to_string(&DimensionUnit::Em).expect("serialize");
        assert_eq!(json, "\"em\"");
    }

    #[test]
    fn test_dimension_unit_serde_percent() {
        let json = serde_json::to_string(&DimensionUnit::Percent).expect("serialize");
        assert_eq!(json, "\"percent\"");
    }

    // ── TokenType serde ─────────────────────────────────────────────

    #[test]
    fn test_token_type_serde_round_trip() {
        let types = [
            TokenType::Color,
            TokenType::Dimension,
            TokenType::FontFamily,
            TokenType::FontWeight,
            TokenType::Duration,
            TokenType::CubicBezier,
            TokenType::Number,
            TokenType::Shadow,
            TokenType::Gradient,
            TokenType::Typography,
        ];
        for tt in types {
            let json = serde_json::to_string(&tt).expect("serialize");
            let deserialized: TokenType = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(tt, deserialized);
        }
    }
}
