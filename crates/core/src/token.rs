// crates/core/src/token.rs

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::id::TokenId;
use crate::node::{Color, GradientDef, Point};
use crate::validate::{
    MAX_FONT_FAMILY_LEN, MAX_TOKEN_DESCRIPTION_LEN, MAX_TOKEN_FONT_FAMILIES,
    MAX_TOKENS_PER_CONTEXT, validate_token_name,
};

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
    Gradient { gradient: GradientDef },
    Typography { value: TypographyValue },
    Alias { name: String },
}

/// A design token.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[allow(clippy::struct_field_names)]
pub struct Token {
    id: TokenId,
    name: String,
    value: TokenValue,
    token_type: TokenType,
    description: Option<String>,
}

impl<'de> Deserialize<'de> for Token {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct TokenRaw {
            id: TokenId,
            name: String,
            value: TokenValue,
            token_type: TokenType,
            description: Option<String>,
        }
        let raw = TokenRaw::deserialize(deserializer)?;
        Token::new(raw.id, raw.name, raw.value, raw.token_type, raw.description)
            .map_err(serde::de::Error::custom)
    }
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
        if let Some(ref desc) = description
            && desc.len() > MAX_TOKEN_DESCRIPTION_LEN
        {
            return Err(CoreError::ValidationError(format!(
                "token description too long: {} (max {MAX_TOKEN_DESCRIPTION_LEN})",
                desc.len()
            )));
        }
        if !token_type_matches_value(token_type, &value) {
            return Err(CoreError::ValidationError(format!(
                "token type {token_type:?} does not match value variant"
            )));
        }
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

/// Returns `true` if the token type is compatible with the value variant.
///
/// Aliases are compatible with any declared type.
fn token_type_matches_value(token_type: TokenType, value: &TokenValue) -> bool {
    matches!(
        (token_type, value),
        (TokenType::Color, TokenValue::Color { .. })
            | (TokenType::Dimension, TokenValue::Dimension { .. })
            | (TokenType::FontFamily, TokenValue::FontFamily { .. })
            | (TokenType::FontWeight, TokenValue::FontWeight { .. })
            | (TokenType::Duration, TokenValue::Duration { .. })
            | (TokenType::CubicBezier, TokenValue::CubicBezier { .. })
            | (TokenType::Number, TokenValue::Number { .. })
            | (TokenType::Shadow, TokenValue::Shadow { .. })
            | (TokenType::Gradient, TokenValue::Gradient { .. })
            | (TokenType::Typography, TokenValue::Typography { .. })
            | (_, TokenValue::Alias { .. }) // Aliases can have any declared type
    )
}

/// Validates Color channel fields are all finite.
fn validate_color_channels(color: &Color) -> Result<(), CoreError> {
    match color {
        Color::Srgb { r, g, b, a } | Color::DisplayP3 { r, g, b, a } => {
            crate::validate::validate_finite("color r", *r)?;
            crate::validate::validate_finite("color g", *g)?;
            crate::validate::validate_finite("color b", *b)?;
            crate::validate::validate_finite("color a", *a)?;
        }
        Color::Oklch { l, c, h, a } => {
            crate::validate::validate_finite("color l", *l)?;
            crate::validate::validate_finite("color c", *c)?;
            crate::validate::validate_finite("color h", *h)?;
            crate::validate::validate_finite("color a", *a)?;
        }
        Color::Oklab { l, a, b, alpha } => {
            crate::validate::validate_finite("color l", *l)?;
            crate::validate::validate_finite("color a", *a)?;
            crate::validate::validate_finite("color b", *b)?;
            crate::validate::validate_finite("color alpha", *alpha)?;
        }
    }
    Ok(())
}

/// Validates a token value's fields.
///
/// # Errors
/// Returns `CoreError::ValidationError` for invalid values.
#[allow(clippy::too_many_lines)]
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
            if shadow.blur < 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "shadow blur must be non-negative, got {}",
                    shadow.blur
                )));
            }
        }
        TokenValue::Typography { value: typo } => {
            crate::validate::validate_finite("font size", typo.font_size)?;
            crate::validate::validate_finite("line height", typo.line_height)?;
            crate::validate::validate_finite("letter spacing", typo.letter_spacing)?;
            if typo.font_size <= 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "font size must be positive, got {}",
                    typo.font_size
                )));
            }
            if typo.line_height <= 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "line height must be positive, got {}",
                    typo.line_height
                )));
            }
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
        TokenValue::Color { value: color } => {
            validate_color_channels(color)?;
        }
        TokenValue::Gradient { gradient: def } => {
            if def.stops.len() > crate::validate::MAX_GRADIENT_STOPS {
                return Err(CoreError::ValidationError(format!(
                    "too many gradient stops: {} (max {})",
                    def.stops.len(),
                    crate::validate::MAX_GRADIENT_STOPS
                )));
            }
            crate::validate::validate_finite("gradient start x", def.start.x)?;
            crate::validate::validate_finite("gradient start y", def.start.y)?;
            crate::validate::validate_finite("gradient end x", def.end.x)?;
            crate::validate::validate_finite("gradient end y", def.end.y)?;
            for (i, stop) in def.stops.iter().enumerate() {
                crate::validate::validate_finite(
                    &format!("gradient stop[{i}] position"),
                    stop.position,
                )?;
                if stop.position < 0.0 || stop.position > 1.0 {
                    return Err(CoreError::ValidationError(format!(
                        "gradient stop[{i}] position must be in [0.0, 1.0], got {}",
                        stop.position
                    )));
                }
            }
        }
    }
    Ok(())
}

/// The document's design token collection.
///
/// Stores tokens keyed by validated name. Supports alias resolution
/// with cycle detection (max depth 16).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TokenContext {
    tokens: HashMap<String, Token>,
}

impl TokenContext {
    /// Creates a new empty token context.
    #[must_use]
    pub fn new() -> Self {
        Self {
            tokens: HashMap::new(),
        }
    }

    /// Adds or replaces a token.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the context is at capacity.
    pub fn insert(&mut self, token: Token) -> Result<(), CoreError> {
        if !self.tokens.contains_key(token.name()) && self.tokens.len() >= MAX_TOKENS_PER_CONTEXT {
            return Err(CoreError::ValidationError(format!(
                "token context already has {MAX_TOKENS_PER_CONTEXT} tokens (maximum)"
            )));
        }
        self.tokens.insert(token.name().to_string(), token);
        Ok(())
    }

    /// Removes a token by name. Returns the removed token if found.
    pub fn remove(&mut self, name: &str) -> Option<Token> {
        self.tokens.remove(name)
    }

    /// Gets a token by name.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&Token> {
        self.tokens.get(name)
    }

    /// Returns the number of tokens.
    #[must_use]
    pub fn len(&self) -> usize {
        self.tokens.len()
    }

    /// Returns true if there are no tokens.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }

    /// Iterates over all tokens.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Token)> {
        self.tokens.iter().map(|(k, v)| (k.as_str(), v))
    }

    /// Resolves a token name to its final non-alias value, following alias chains.
    ///
    /// Uses an iterative loop instead of recursion. Detects cycles via a visited
    /// set and enforces `MAX_ALIAS_CHAIN_DEPTH`.
    ///
    /// # Errors
    /// - `CoreError::TokenNotFound` if a token in the chain doesn't exist.
    /// - `CoreError::TokenCycleDetected` if a cycle or depth limit is hit.
    pub fn resolve(&self, name: &str) -> Result<&TokenValue, CoreError> {
        let mut current = name;
        let mut visited = HashSet::new();
        loop {
            if !visited.insert(current.to_string()) {
                return Err(CoreError::TokenCycleDetected(format!(
                    "cycle detected at token: {current}"
                )));
            }
            if visited.len() > crate::validate::MAX_ALIAS_CHAIN_DEPTH {
                return Err(CoreError::TokenCycleDetected(format!(
                    "alias chain depth exceeded {}: {current}",
                    crate::validate::MAX_ALIAS_CHAIN_DEPTH
                )));
            }
            let token = self
                .tokens
                .get(current)
                .ok_or_else(|| CoreError::TokenNotFound(current.to_string()))?;
            match &token.value {
                TokenValue::Alias { name: target } => current = target,
                other => return Ok(other),
            }
        }
    }
}

// Custom Serialize/Deserialize for TokenContext (GOV-010: route through validation)
impl Serialize for TokenContext {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.tokens.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TokenContext {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let tokens: HashMap<String, Token> = HashMap::deserialize(deserializer)?;
        if tokens.len() > MAX_TOKENS_PER_CONTEXT {
            return Err(serde::de::Error::custom(format!(
                "too many tokens: {} (max {MAX_TOKENS_PER_CONTEXT})",
                tokens.len()
            )));
        }
        // Validate all token names
        for name in tokens.keys() {
            validate_token_name(name).map_err(serde::de::Error::custom)?;
        }
        Ok(Self { tokens })
    }
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

    // ── TokenContext ────────────────────────────────────────────────

    #[test]
    fn test_token_context_insert_and_get() {
        let mut ctx = TokenContext::new();
        let token = make_color_token("color.primary");
        ctx.insert(token).expect("insert");
        assert_eq!(ctx.len(), 1);
        assert!(ctx.get("color.primary").is_some());
    }

    #[test]
    fn test_token_context_insert_replaces_existing() {
        let mut ctx = TokenContext::new();
        ctx.insert(make_color_token("color.primary"))
            .expect("insert");

        let replacement = Token::new(
            make_token_id(2),
            "color.primary".to_string(),
            TokenValue::Number { value: 99.0 },
            TokenType::Number,
            None,
        )
        .expect("valid");
        ctx.insert(replacement).expect("insert replacement");

        assert_eq!(ctx.len(), 1);
        assert!(matches!(
            ctx.get("color.primary").expect("get").value(),
            TokenValue::Number { .. }
        ));
    }

    #[test]
    fn test_token_context_remove() {
        let mut ctx = TokenContext::new();
        ctx.insert(make_color_token("color.primary"))
            .expect("insert");
        let removed = ctx.remove("color.primary");
        assert!(removed.is_some());
        assert!(ctx.is_empty());
    }

    #[test]
    fn test_token_context_remove_nonexistent() {
        let mut ctx = TokenContext::new();
        assert!(ctx.remove("nonexistent").is_none());
    }

    #[test]
    fn test_token_context_is_empty() {
        let ctx = TokenContext::new();
        assert!(ctx.is_empty());
        assert_eq!(ctx.len(), 0);
    }

    #[test]
    fn test_token_context_iter() {
        let mut ctx = TokenContext::new();
        ctx.insert(make_color_token("color.primary"))
            .expect("insert");
        ctx.insert(
            Token::new(
                make_token_id(2),
                "spacing.sm".to_string(),
                TokenValue::Dimension {
                    value: 8.0,
                    unit: DimensionUnit::Px,
                },
                TokenType::Dimension,
                None,
            )
            .expect("valid"),
        )
        .expect("insert");

        let names: Vec<&str> = ctx.iter().map(|(k, _)| k).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"color.primary"));
        assert!(names.contains(&"spacing.sm"));
    }

    #[test]
    fn test_token_context_resolve_literal() {
        let mut ctx = TokenContext::new();
        ctx.insert(make_color_token("color.primary"))
            .expect("insert");
        let resolved = ctx.resolve("color.primary").expect("resolve");
        assert!(matches!(resolved, TokenValue::Color { .. }));
    }

    #[test]
    fn test_token_context_resolve_alias_chain() {
        let mut ctx = TokenContext::new();
        ctx.insert(make_color_token("color.brand")).expect("insert");

        let alias = Token::new(
            make_token_id(2),
            "color.primary".to_string(),
            TokenValue::Alias {
                name: "color.brand".to_string(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid alias");
        ctx.insert(alias).expect("insert alias");

        let resolved = ctx.resolve("color.primary").expect("resolve");
        assert!(matches!(resolved, TokenValue::Color { .. }));
    }

    #[test]
    fn test_token_context_resolve_multi_hop_alias() {
        let mut ctx = TokenContext::new();
        ctx.insert(make_color_token("color.base")).expect("insert");

        let alias1 = Token::new(
            make_token_id(2),
            "color.brand".to_string(),
            TokenValue::Alias {
                name: "color.base".to_string(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid");
        ctx.insert(alias1).expect("insert");

        let alias2 = Token::new(
            make_token_id(3),
            "color.primary".to_string(),
            TokenValue::Alias {
                name: "color.brand".to_string(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid");
        ctx.insert(alias2).expect("insert");

        let resolved = ctx.resolve("color.primary").expect("resolve");
        assert!(matches!(resolved, TokenValue::Color { .. }));
    }

    #[test]
    fn test_token_context_resolve_cycle_detected() {
        let mut ctx = TokenContext::new();

        let a = Token::new(
            make_token_id(1),
            "a".to_string(),
            TokenValue::Alias {
                name: "b".to_string(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid");
        let b = Token::new(
            make_token_id(2),
            "b".to_string(),
            TokenValue::Alias {
                name: "a".to_string(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid");

        ctx.insert(a).expect("insert");
        ctx.insert(b).expect("insert");

        let result = ctx.resolve("a");
        assert!(matches!(result, Err(CoreError::TokenCycleDetected(_))));
    }

    #[test]
    fn test_token_context_resolve_self_cycle() {
        let mut ctx = TokenContext::new();

        let self_ref = Token::new(
            make_token_id(1),
            "a".to_string(),
            TokenValue::Alias {
                name: "a".to_string(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid");
        ctx.insert(self_ref).expect("insert");

        let result = ctx.resolve("a");
        assert!(matches!(result, Err(CoreError::TokenCycleDetected(_))));
    }

    #[test]
    fn test_token_context_resolve_not_found() {
        let ctx = TokenContext::new();
        let result = ctx.resolve("nonexistent");
        assert!(matches!(result, Err(CoreError::TokenNotFound(_))));
    }

    #[test]
    fn test_token_context_resolve_alias_target_not_found() {
        let mut ctx = TokenContext::new();
        let alias = Token::new(
            make_token_id(1),
            "color.primary".to_string(),
            TokenValue::Alias {
                name: "color.missing".to_string(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid");
        ctx.insert(alias).expect("insert");

        let result = ctx.resolve("color.primary");
        assert!(matches!(result, Err(CoreError::TokenNotFound(ref s)) if s == "color.missing"));
    }

    #[test]
    fn test_token_context_resolve_deep_alias_chain() {
        let mut ctx = TokenContext::new();

        // Create a chain of 15 tokens (t0..t13 are aliases, t14 is literal = 14 hops)
        // With >= guard, visited.len() reaches 15 which is < MAX_ALIAS_CHAIN_DEPTH (16)
        for i in 0..15u8 {
            let name = format!("t{i}");
            let target = if i < 14 {
                TokenValue::Alias {
                    name: format!("t{}", i + 1),
                }
            } else {
                TokenValue::Number { value: 42.0 }
            };
            let token = Token::new(make_token_id(i + 1), name, target, TokenType::Number, None)
                .expect("valid");
            ctx.insert(token).expect("insert");
        }

        // Should resolve through all 15 levels
        let resolved = ctx.resolve("t0").expect("resolve");
        assert!(
            matches!(resolved, TokenValue::Number { value } if (*value - 42.0).abs() < f64::EPSILON)
        );
    }

    #[test]
    fn test_token_context_resolve_exceeds_max_depth() {
        let mut ctx = TokenContext::new();

        // Create a chain of 17 tokens (t0..t15 are aliases, t16 is literal = 16 hops)
        // With >= guard, visited.len() reaches 16 == MAX_ALIAS_CHAIN_DEPTH, triggering error
        for i in 0..17u8 {
            let name = format!("t{i}");
            let target = if i < 16 {
                TokenValue::Alias {
                    name: format!("t{}", i + 1),
                }
            } else {
                TokenValue::Number { value: 42.0 }
            };
            let token = Token::new(make_token_id(i + 1), name, target, TokenType::Number, None)
                .expect("valid");
            ctx.insert(token).expect("insert");
        }

        let result = ctx.resolve("t0");
        assert!(matches!(result, Err(CoreError::TokenCycleDetected(_))));
    }

    #[test]
    fn test_token_context_resolve_at_exact_depth_boundary() {
        use crate::validate::MAX_ALIAS_CHAIN_DEPTH;

        // Chain of exactly MAX_ALIAS_CHAIN_DEPTH aliases should fail:
        // t0 -> t1 -> ... -> t{MAX-1} -> t{MAX} (literal)
        // After inserting t{MAX} into visited, visited.len() == MAX+1 > MAX.
        {
            let mut ctx = TokenContext::new();
            for i in 0..=MAX_ALIAS_CHAIN_DEPTH {
                let name = format!("t{i}");
                let value = if i < MAX_ALIAS_CHAIN_DEPTH {
                    TokenValue::Alias {
                        name: format!("t{}", i + 1),
                    }
                } else {
                    TokenValue::Number { value: 1.0 }
                };
                let id = u8::try_from(i + 1).expect("test index fits u8");
                let token = Token::new(make_token_id(id), name, value, TokenType::Number, None)
                    .expect("valid");
                ctx.insert(token).expect("insert");
            }
            let result = ctx.resolve("t0");
            assert!(
                matches!(result, Err(CoreError::TokenCycleDetected(_))),
                "chain of exactly MAX_ALIAS_CHAIN_DEPTH aliases should fail"
            );
        }

        // Chain of MAX_ALIAS_CHAIN_DEPTH - 2 aliases should succeed:
        // t0 -> t1 -> ... -> t{MAX-3} -> t{MAX-2} (literal)
        // visited.len() reaches MAX-1 which is < MAX (>= guard).
        {
            let mut ctx = TokenContext::new();
            let alias_count = MAX_ALIAS_CHAIN_DEPTH - 2;
            for i in 0..=alias_count {
                let name = format!("t{i}");
                let value = if i < alias_count {
                    TokenValue::Alias {
                        name: format!("t{}", i + 1),
                    }
                } else {
                    TokenValue::Number { value: 42.0 }
                };
                let id = u8::try_from(i + 1).expect("test index fits u8");
                let token = Token::new(make_token_id(id), name, value, TokenType::Number, None)
                    .expect("valid");
                ctx.insert(token).expect("insert");
            }
            let resolved = ctx.resolve("t0").expect("should succeed");
            assert!(
                matches!(resolved, TokenValue::Number { value } if (*value - 42.0).abs() < f64::EPSILON),
                "chain of MAX_ALIAS_CHAIN_DEPTH - 2 aliases should resolve"
            );
        }
    }

    #[test]
    fn test_token_context_serde_round_trip() {
        let mut ctx = TokenContext::new();
        ctx.insert(make_color_token("color.primary"))
            .expect("insert");
        ctx.insert(
            Token::new(
                make_token_id(2),
                "spacing.sm".to_string(),
                TokenValue::Dimension {
                    value: 8.0,
                    unit: DimensionUnit::Px,
                },
                TokenType::Dimension,
                None,
            )
            .expect("valid"),
        )
        .expect("insert");

        let json = serde_json::to_string(&ctx).expect("serialize");
        let deserialized: TokenContext = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(ctx, deserialized);
    }

    #[test]
    fn test_token_context_serde_empty_round_trip() {
        let ctx = TokenContext::new();
        let json = serde_json::to_string(&ctx).expect("serialize");
        let deserialized: TokenContext = serde_json::from_str(&json).expect("deserialize");
        assert!(deserialized.is_empty());
    }

    #[test]
    fn test_token_context_deserialize_rejects_invalid_name() {
        // A map with a key that starts with a digit (invalid token name)
        let json = r#"{"123bad":{"id":"00000001-0000-0000-0000-000000000000","name":"123bad","value":{"type":"number","value":1.0},"token_type":"number","description":null}}"#;
        let result: Result<TokenContext, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_token_context_default_is_empty() {
        let ctx = TokenContext::default();
        assert!(ctx.is_empty());
        assert_eq!(ctx.len(), 0);
    }

    // ── RF-001: Token deserialization routes through validation ─────

    #[test]
    fn test_token_deserialize_rejects_invalid_name() {
        let json = r#"{"id":"00000001-0000-0000-0000-000000000000","name":"123bad","value":{"type":"number","value":1.0},"token_type":"number","description":null}"#;
        let result: Result<Token, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "deserializing a Token with invalid name should fail"
        );
    }

    #[test]
    fn test_token_deserialize_rejects_invalid_value() {
        // NaN dimension should be rejected during deserialization
        let json = r#"{"id":"00000001-0000-0000-0000-000000000000","name":"spacing.bad","value":{"type":"dimension","value":null,"unit":"px"},"token_type":"dimension","description":null}"#;
        let result: Result<Token, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "deserializing a Token with invalid value should fail"
        );
    }

    // ── RF-003: Description length validation ──────────────────────

    #[test]
    fn test_token_description_too_long() {
        let long_desc = "x".repeat(MAX_TOKEN_DESCRIPTION_LEN + 1);
        let result = Token::new(
            make_token_id(1),
            "color.test".to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            Some(long_desc),
        );
        assert!(
            result.is_err(),
            "description exceeding MAX_TOKEN_DESCRIPTION_LEN should be rejected"
        );
    }

    #[test]
    fn test_token_description_at_max_length_is_valid() {
        let desc = "x".repeat(MAX_TOKEN_DESCRIPTION_LEN);
        let result = Token::new(
            make_token_id(1),
            "color.test".to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            Some(desc),
        );
        assert!(
            result.is_ok(),
            "description at exactly MAX_TOKEN_DESCRIPTION_LEN should be accepted"
        );
    }

    // ── RF-004: Type/value cross-validation ────────────────────────

    #[test]
    fn test_token_type_value_mismatch_rejected() {
        let result = Token::new(
            make_token_id(1),
            "color.wrong".to_string(),
            TokenValue::Number { value: 42.0 },
            TokenType::Color,
            None,
        );
        assert!(
            result.is_err(),
            "token type/value mismatch should be rejected"
        );
    }

    #[test]
    fn test_token_alias_value_accepted_with_any_type() {
        let result = Token::new(
            make_token_id(1),
            "color.alias".to_string(),
            TokenValue::Alias {
                name: "color.primary".to_string(),
            },
            TokenType::Color,
            None,
        );
        assert!(
            result.is_ok(),
            "alias value should be accepted with any token type"
        );
    }

    // ── RF-005: Shadow blur and typography positivity ──────────────

    #[test]
    fn test_validate_token_value_shadow_negative_blur() {
        let val = TokenValue::Shadow {
            value: ShadowValue {
                color: Color::default(),
                offset: Point::zero(),
                blur: -1.0,
                spread: 0.0,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "negative shadow blur should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_typography_zero_font_size() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: 0.0,
                font_weight: 400,
                line_height: 1.5,
                letter_spacing: 0.0,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "zero font size should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_typography_negative_font_size() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: -16.0,
                font_weight: 400,
                line_height: 1.5,
                letter_spacing: 0.0,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "negative font size should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_typography_zero_line_height() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 400,
                line_height: 0.0,
                letter_spacing: 0.0,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "zero line height should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_typography_negative_line_height() {
        let val = TokenValue::Typography {
            value: TypographyValue {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 400,
                line_height: -1.5,
                letter_spacing: 0.0,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "negative line height should be rejected"
        );
    }

    // ── RF-006: Color channel and gradient validation ──────────────

    #[test]
    fn test_validate_token_value_color_nan_channel() {
        let val = TokenValue::Color {
            value: Color::Srgb {
                r: f64::NAN,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "NaN color channel should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_color_infinity_channel() {
        let val = TokenValue::Color {
            value: Color::DisplayP3 {
                r: 0.0,
                g: f64::INFINITY,
                b: 0.0,
                a: 1.0,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "infinite color channel should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_color_oklch_nan() {
        let val = TokenValue::Color {
            value: Color::Oklch {
                l: 0.5,
                c: 0.1,
                h: f64::NAN,
                a: 1.0,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "NaN in Oklch should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_color_oklab_nan() {
        let val = TokenValue::Color {
            value: Color::Oklab {
                l: 0.5,
                a: 0.0,
                b: 0.0,
                alpha: f64::NAN,
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "NaN in Oklab should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_gradient_too_many_stops() {
        use crate::node::{GradientStop, StyleValue};
        let stops: Vec<GradientStop> = (0..=crate::validate::MAX_GRADIENT_STOPS)
            .map(|i| GradientStop {
                position: i as f64 / crate::validate::MAX_GRADIENT_STOPS as f64,
                color: StyleValue::Literal {
                    value: Color::default(),
                },
            })
            .collect();
        let val = TokenValue::Gradient {
            gradient: GradientDef {
                stops,
                start: Point::zero(),
                end: Point::new(1.0, 1.0),
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "too many gradient stops should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_gradient_nan_start_point() {
        use crate::node::{GradientStop, StyleValue};
        let val = TokenValue::Gradient {
            gradient: GradientDef {
                stops: vec![GradientStop {
                    position: 0.0,
                    color: StyleValue::Literal {
                        value: Color::default(),
                    },
                }],
                start: Point::new(f64::NAN, 0.0),
                end: Point::new(1.0, 1.0),
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "NaN gradient start should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_gradient_nan_end_point() {
        use crate::node::{GradientStop, StyleValue};
        let val = TokenValue::Gradient {
            gradient: GradientDef {
                stops: vec![GradientStop {
                    position: 0.0,
                    color: StyleValue::Literal {
                        value: Color::default(),
                    },
                }],
                start: Point::zero(),
                end: Point::new(1.0, f64::INFINITY),
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "infinite gradient end should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_gradient_stop_position_out_of_range() {
        use crate::node::{GradientStop, StyleValue};
        let val = TokenValue::Gradient {
            gradient: GradientDef {
                stops: vec![GradientStop {
                    position: 1.5,
                    color: StyleValue::Literal {
                        value: Color::default(),
                    },
                }],
                start: Point::zero(),
                end: Point::new(1.0, 1.0),
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "gradient stop position > 1.0 should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_gradient_stop_position_negative() {
        use crate::node::{GradientStop, StyleValue};
        let val = TokenValue::Gradient {
            gradient: GradientDef {
                stops: vec![GradientStop {
                    position: -0.1,
                    color: StyleValue::Literal {
                        value: Color::default(),
                    },
                }],
                start: Point::zero(),
                end: Point::new(1.0, 1.0),
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "gradient stop position < 0.0 should be rejected"
        );
    }

    #[test]
    fn test_validate_token_value_gradient_stop_position_nan() {
        use crate::node::{GradientStop, StyleValue};
        let val = TokenValue::Gradient {
            gradient: GradientDef {
                stops: vec![GradientStop {
                    position: f64::NAN,
                    color: StyleValue::Literal {
                        value: Color::default(),
                    },
                }],
                start: Point::zero(),
                end: Point::new(1.0, 1.0),
            },
        };
        assert!(
            validate_token_value(&val).is_err(),
            "NaN gradient stop position should be rejected"
        );
    }
}
