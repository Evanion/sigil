# Token Model — Implementation Plan (01d)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the design token model with typed values, alias resolution with cycle detection, and a `TokenContext` that replaces the current untyped stub.

**Architecture:** A new `token.rs` module contains `Token`, `TokenValue`, `TokenType`, and value sub-types (`DimensionUnit`, `ShadowValue`, `GradientValue`, `TypographyValue`). `TokenContext` owns a `HashMap<String, Token>` with validated keys, provides `resolve()` for alias chain resolution with cycle detection (max depth 16), and enforces collection limits. All types use custom `Deserialize` impls or private fields per GOV-010.

**Tech Stack:** Rust 1.94.1 (edition 2024), serde, serde_json, uuid (no v4), thiserror

**Scope:** This plan covers token type definitions, `TokenContext` with resolution, validation, and tests. Token-related commands (`RenameToken`, `PromoteToken`, `DemoteToken`) and serialization to W3C Design Tokens Format are deferred to Plan 01f.

---

## File Structure

```
crates/core/src/
├── token.rs             # NEW: Token, TokenValue, TokenType, DimensionUnit, ShadowValue, GradientValue, TypographyValue, TokenContext
├── document.rs          # MODIFY: remove TokenContext stub, import from token.rs
├── validate.rs          # MODIFY: add token-specific validation constants
├── lib.rs               # MODIFY: add token module and re-exports
```

---

## Task 1: Create token module with core types

**Files:**
- Create: `crates/core/src/token.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Create `crates/core/src/token.rs` with the foundational types and tests:

```rust
// crates/core/src/token.rs

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::id::TokenId;
use crate::node::{Color, GradientDef, Point};
use crate::validate::{validate_token_name, MAX_FONT_FAMILY_LEN};

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

/// Gradient token value — wraps the existing GradientDef.
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
pub struct Token {
    id: TokenId,
    name: String,
    value: TokenValue,
    token_type: TokenType,
    description: Option<String>,
}

impl Token {
    /// Creates a new token, validating the name.
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

/// Maximum number of font families in a FontFamily token.
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
            for family in families {
                if family.len() > MAX_FONT_FAMILY_LEN {
                    return Err(CoreError::ValidationError(format!(
                        "font family name too long: {} (max {MAX_FONT_FAMILY_LEN})",
                        family.len()
                    )));
                }
            }
            if families.len() > MAX_TOKEN_FONT_FAMILIES {
                return Err(CoreError::ValidationError(format!(
                    "too many font families: {} (max {MAX_TOKEN_FONT_FAMILIES})",
                    families.len()
                )));
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

    // ── TokenValue variants ─────────────────────────────────────────

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
    fn test_token_value_cubic_bezier_serde() {
        let val = TokenValue::CubicBezier {
            values: [0.4, 0.0, 0.2, 1.0],
        };
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
    fn test_validate_token_value_negative_duration() {
        let val = TokenValue::Duration { seconds: -1.0 };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_cubic_bezier_out_of_range() {
        let val = TokenValue::CubicBezier {
            values: [1.5, 0.0, 0.2, 1.0],
        };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_font_weight_out_of_range() {
        let val = TokenValue::FontWeight { weight: 0 };
        assert!(validate_token_value(&val).is_err());

        let val = TokenValue::FontWeight { weight: 1001 };
        assert!(validate_token_value(&val).is_err());
    }

    #[test]
    fn test_validate_token_value_empty_font_family() {
        let val = TokenValue::FontFamily {
            families: vec![],
        };
        assert!(validate_token_value(&val).is_err());
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
    fn test_validate_token_value_alias_invalid_name() {
        let val = TokenValue::Alias {
            name: "123bad".to_string(),
        };
        assert!(validate_token_value(&val).is_err());
    }

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
}
```

- [ ] 2. Add `pub mod token;` to `crates/core/src/lib.rs` after `pub mod tree;`:

```rust
pub mod token;
```

Add re-exports:
```rust
// ── Re-exports: Token ────────────────────────────────────────────────
pub use token::{
    DimensionUnit, GradientValue, ShadowValue, Token, TokenContext, TokenType, TokenValue,
    TypographyValue, validate_token_value,
};
```

Note: `TokenContext` re-export will be added in Task 2 after it's implemented.

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core token::tests
./dev.sh cargo test -p agent-designer-core
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 4. Commit:

```bash
git add crates/core/src/token.rs crates/core/src/lib.rs
git commit -m "feat(core): add Token, TokenValue, TokenType with validation (spec-01)"
```

---

## Task 2: Implement TokenContext with alias resolution

**Files:**
- Modify: `crates/core/src/token.rs`
- Modify: `crates/core/src/document.rs` (remove TokenContext stub)

- [ ] 1. Add `TokenContext` to `crates/core/src/token.rs`, above the `#[cfg(test)]` block:

```rust
use std::collections::{HashMap, HashSet};

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
    /// # Errors
    /// - `CoreError::TokenNotFound` if a token in the chain doesn't exist.
    /// - `CoreError::TokenCycleDetected` if a cycle or depth limit is hit.
    pub fn resolve(&self, name: &str) -> Result<&TokenValue, CoreError> {
        let mut visited = HashSet::new();
        self.resolve_inner(name, &mut visited, 0)
    }

    fn resolve_inner<'a>(
        &'a self,
        name: &str,
        visited: &mut HashSet<String>,
        depth: usize,
    ) -> Result<&'a TokenValue, CoreError> {
        if depth > crate::validate::MAX_ALIAS_CHAIN_DEPTH {
            return Err(CoreError::TokenCycleDetected(format!(
                "alias chain depth exceeded {}: {}",
                crate::validate::MAX_ALIAS_CHAIN_DEPTH,
                name
            )));
        }

        if !visited.insert(name.to_string()) {
            return Err(CoreError::TokenCycleDetected(format!(
                "cycle detected at token: {name}"
            )));
        }

        let token = self
            .tokens
            .get(name)
            .ok_or_else(|| CoreError::TokenNotFound(name.to_string()))?;

        match &token.value {
            TokenValue::Alias { name: alias_target } => {
                self.resolve_inner(alias_target, visited, depth + 1)
            }
            other => Ok(other),
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
```

- [ ] 2. Remove the `TokenContext` stub from `crates/core/src/document.rs`. Replace with import and re-export:

```rust
use crate::token::TokenContext;
pub use crate::token::TokenContext;
```

Remove the old `TokenContext` struct, its `Default` impl, and update the `HashMap` import if it's no longer needed.

- [ ] 3. Update `lib.rs` re-exports — `TokenContext` is now re-exported from both `token` and `document` (document re-exports for backwards compat). Add `TokenContext` to the token re-exports line.

- [ ] 4. Add `TokenContext` tests to `token.rs`:

```rust
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
fn test_token_context_remove() {
    let mut ctx = TokenContext::new();
    ctx.insert(make_color_token("color.primary")).expect("insert");
    let removed = ctx.remove("color.primary");
    assert!(removed.is_some());
    assert!(ctx.is_empty());
}

#[test]
fn test_token_context_resolve_literal() {
    let mut ctx = TokenContext::new();
    ctx.insert(make_color_token("color.primary")).expect("insert");
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
fn test_token_context_resolve_not_found() {
    let ctx = TokenContext::new();
    let result = ctx.resolve("nonexistent");
    assert!(matches!(result, Err(CoreError::TokenNotFound(_))));
}

#[test]
fn test_token_context_resolve_deep_alias_chain() {
    let mut ctx = TokenContext::new();

    // Create a chain of 16 aliases
    for i in 0..16u8 {
        let name = format!("t{i}");
        let target = if i < 15 {
            TokenValue::Alias {
                name: format!("t{}", i + 1),
            }
        } else {
            TokenValue::Number { value: 42.0 }
        };
        let token = Token::new(
            make_token_id(i + 1),
            name,
            target,
            TokenType::Number,
            None,
        )
        .expect("valid");
        ctx.insert(token).expect("insert");
    }

    // Should resolve through all 16 levels
    let resolved = ctx.resolve("t0").expect("resolve");
    assert!(matches!(resolved, TokenValue::Number { value } if (*value - 42.0).abs() < f64::EPSILON));
}

#[test]
fn test_token_context_resolve_exceeds_max_depth() {
    let mut ctx = TokenContext::new();

    // Create a chain of 18 aliases (exceeds MAX_ALIAS_CHAIN_DEPTH=16)
    for i in 0..18u8 {
        let name = format!("t{i}");
        let target = if i < 17 {
            TokenValue::Alias {
                name: format!("t{}", i + 1),
            }
        } else {
            TokenValue::Number { value: 42.0 }
        };
        let token = Token::new(
            make_token_id(i + 1),
            name,
            target,
            TokenType::Number,
            None,
        )
        .expect("valid");
        ctx.insert(token).expect("insert");
    }

    let result = ctx.resolve("t0");
    assert!(matches!(result, Err(CoreError::TokenCycleDetected(_))));
}

#[test]
fn test_token_context_serde_round_trip() {
    let mut ctx = TokenContext::new();
    ctx.insert(make_color_token("color.primary")).expect("insert");
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
    assert_eq!(ctx.len(), deserialized.len());
    assert!(deserialized.get("color.primary").is_some());
    assert!(deserialized.get("spacing.sm").is_some());
}
```

- [ ] 5. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core token
./dev.sh cargo test -p agent-designer-core
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
./dev.sh cargo fmt -p agent-designer-core
```

- [ ] 6. Commit:

```bash
git add crates/core/src/token.rs crates/core/src/document.rs crates/core/src/lib.rs
git commit -m "feat(core): add TokenContext with alias resolution and cycle detection (spec-01)"
```

---

## Task 3: Run full workspace verification

**Files:** None (verification only)

- [ ] 1. Run full workspace tests:

```bash
./dev.sh cargo test --workspace
```

Expected: all tests pass.

- [ ] 2. Run clippy on workspace:

```bash
./dev.sh cargo clippy --workspace -- -D warnings
```

Expected: no warnings.

- [ ] 3. Run format check:

```bash
./dev.sh cargo fmt --check
```

Expected: clean.

- [ ] 4. If any issues, fix and commit.

---

## Deferred Items

### Plan 01e: Component Model

- `PropertyPath`, `OverrideValue`, `OverrideSource` enums
- `OverrideMap` with `(Uuid, PropertyPath)` composite keys (replaces stub)
- `Variant`, `ComponentProperty`, `ComponentPropertyType`
- `ComponentDef` full implementation (replaces stub)
- `NodeKind::ComponentInstance` updated with `variant` and `property_values`

### Plan 01f: Advanced Commands + Wire Formats

- Token commands: `RenameToken`, `PromoteToken`, `DemoteToken`
- Component commands: create/delete/override
- Transition commands: `AddTransition`, `RemoveTransition`, `UpdateTransition`
- `SerializableCommand` / `BroadcastCommand` tagged enums
- Token serialization to W3C Design Tokens Format
- Boolean path operations (`boolean_op`)
