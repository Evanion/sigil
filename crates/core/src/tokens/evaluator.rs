// crates/core/src/tokens/evaluator.rs

//! Expression evaluator for the design token expression engine.
//!
//! Walks a `TokenExpression` AST and produces an `EvalValue`.
//! Token references are resolved via a `TokenContext`, with depth
//! tracking for cycle prevention.

use crate::error::CoreError;
use crate::node::Color;
use crate::validate::MAX_ALIAS_CHAIN_DEPTH;

use super::errors::ExprError;
use super::expression::{BinaryOperator, ExprLiteral, TokenExpression};
use super::types::{TokenContext, TokenValue};

/// Result of evaluating a token expression.
#[derive(Debug, Clone, PartialEq)]
pub enum EvalValue {
    /// A numeric value.
    Number(f64),
    /// A color value.
    Color(Color),
    /// A string value.
    Str(String),
}

impl EvalValue {
    /// Returns a human-readable type name for error messages.
    pub(crate) fn type_name(&self) -> &'static str {
        match self {
            Self::Number(_) => "number",
            Self::Color(_) => "color",
            Self::Str(_) => "string",
        }
    }
}

/// Evaluate a token expression against a token context.
///
/// `depth` tracks resolution depth for cycle/recursion prevention.
/// Callers should pass `0` for top-level evaluation.
///
/// # Errors
///
/// Returns `ExprError` for type mismatches, missing references,
/// division by zero, unknown functions, or depth exceeded.
pub fn evaluate(
    expr: &TokenExpression,
    context: &TokenContext,
    depth: usize,
) -> Result<EvalValue, ExprError> {
    if depth >= MAX_ALIAS_CHAIN_DEPTH {
        return Err(ExprError::DepthExceeded);
    }

    match expr {
        TokenExpression::Literal(lit) => evaluate_literal(lit),
        TokenExpression::TokenRef(name) => evaluate_token_ref(name, context, depth),
        TokenExpression::BinaryOp { left, op, right } => {
            evaluate_binary_op(left, *op, right, context, depth)
        }
        TokenExpression::UnaryNeg(inner) => evaluate_unary_neg(inner, context, depth),
        TokenExpression::FunctionCall { name, args } => {
            let mut evaluated_args = Vec::with_capacity(args.len());
            for arg in args {
                evaluated_args.push(evaluate(arg, context, depth + 1)?);
            }
            crate::tokens::functions::call_function(name, &evaluated_args)
        }
    }
}

/// Evaluate a literal expression node.
fn evaluate_literal(lit: &ExprLiteral) -> Result<EvalValue, ExprError> {
    match lit {
        ExprLiteral::Number(n) => {
            if !n.is_finite() {
                return Err(ExprError::DomainError(
                    "non-finite number literal".to_string(),
                ));
            }
            Ok(EvalValue::Number(*n))
        }
        ExprLiteral::Percentage(n) => {
            if !n.is_finite() {
                return Err(ExprError::DomainError(
                    "non-finite percentage literal".to_string(),
                ));
            }
            Ok(EvalValue::Number(*n))
        }
        ExprLiteral::Color(c) => Ok(EvalValue::Color(*c)),
        ExprLiteral::Str(s) => Ok(EvalValue::Str(s.clone())),
    }
}

/// Resolve a token reference and convert to `EvalValue`.
///
/// `depth` is accepted for future use: `context.resolve()` has its own
/// depth tracking for alias chains, so the evaluator depth is currently
/// not forwarded. If expression-valued tokens are added, the depth must
/// be integrated.
fn evaluate_token_ref(
    name: &str,
    context: &TokenContext,
    depth: usize,
) -> Result<EvalValue, ExprError> {
    // `depth` reserved for future expression-valued token support.
    let _ = depth;

    let resolved = context.resolve(name).map_err(|e| match e {
        CoreError::TokenNotFound(token_name) => ExprError::ReferenceNotFound(token_name),
        CoreError::TokenCycleDetected(token_name) => ExprError::CycleDetected(token_name),
        other => ExprError::ReferenceNotFound(format!("{other}")),
    })?;

    token_value_to_eval(resolved, name)
}

/// Convert a resolved `TokenValue` to an `EvalValue`.
fn token_value_to_eval(value: &TokenValue, name: &str) -> Result<EvalValue, ExprError> {
    match value {
        TokenValue::Number { value } | TokenValue::Dimension { value, .. } => {
            Ok(EvalValue::Number(*value))
        }
        TokenValue::Color { value } => Ok(EvalValue::Color(*value)),
        TokenValue::FontWeight { weight } => Ok(EvalValue::Number(f64::from(*weight))),
        TokenValue::Duration { seconds } => Ok(EvalValue::Number(*seconds)),
        TokenValue::FontFamily { families } => Ok(EvalValue::Str(families.join(", "))),
        // Alias should not appear after resolve() -- it follows aliases.
        TokenValue::Alias { .. } => Err(ExprError::TypeError {
            expected: "resolved value".to_string(),
            got: format!("unresolved alias for token '{name}'"),
        }),
        // Types that cannot be represented as EvalValue
        TokenValue::Shadow { .. }
        | TokenValue::Gradient { .. }
        | TokenValue::Typography { .. }
        | TokenValue::CubicBezier { .. } => Err(ExprError::TypeError {
            expected: "number, color, or string".to_string(),
            got: format!("composite type for token '{name}'"),
        }),
    }
}

/// Evaluate a binary arithmetic operation.
fn evaluate_binary_op(
    left: &TokenExpression,
    op: BinaryOperator,
    right: &TokenExpression,
    context: &TokenContext,
    depth: usize,
) -> Result<EvalValue, ExprError> {
    let left_val = evaluate(left, context, depth + 1)?;
    let right_val = evaluate(right, context, depth + 1)?;

    let EvalValue::Number(lhs) = left_val else {
        return Err(ExprError::TypeError {
            expected: "number".to_string(),
            got: left_val.type_name().to_string(),
        });
    };

    let EvalValue::Number(rhs) = right_val else {
        return Err(ExprError::TypeError {
            expected: "number".to_string(),
            got: right_val.type_name().to_string(),
        });
    };

    let result = match op {
        BinaryOperator::Add => lhs + rhs,
        BinaryOperator::Sub => lhs - rhs,
        BinaryOperator::Mul => lhs * rhs,
        BinaryOperator::Div => {
            if rhs == 0.0 {
                return Err(ExprError::DivisionByZero);
            }
            lhs / rhs
        }
    };

    if !result.is_finite() {
        return Err(ExprError::DomainError(
            "arithmetic produced non-finite result".to_string(),
        ));
    }

    Ok(EvalValue::Number(result))
}

/// Evaluate a unary negation.
fn evaluate_unary_neg(
    inner: &TokenExpression,
    context: &TokenContext,
    depth: usize,
) -> Result<EvalValue, ExprError> {
    let val = evaluate(inner, context, depth + 1)?;

    let EvalValue::Number(n) = val else {
        return Err(ExprError::TypeError {
            expected: "number".to_string(),
            got: val.type_name().to_string(),
        });
    };

    Ok(EvalValue::Number(-n))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::TokenId;
    use crate::tokens::types::{Token, TokenType};
    use uuid::Uuid;

    /// Create a deterministic `TokenId` for tests.
    fn make_token_id(n: u8) -> TokenId {
        TokenId::new(Uuid::from_bytes([
            n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]))
    }

    /// Create a test context with common tokens.
    fn test_context() -> TokenContext {
        let mut ctx = TokenContext::new();
        ctx.insert(
            Token::new(
                make_token_id(1),
                "spacing.md".to_string(),
                TokenValue::Number { value: 16.0 },
                TokenType::Number,
                None,
            )
            .expect("valid token"),
        )
        .expect("insert");

        ctx.insert(
            Token::new(
                make_token_id(2),
                "brand.primary".to_string(),
                TokenValue::Color {
                    value: Color::Srgb {
                        r: 1.0,
                        g: 0.0,
                        b: 0.0,
                        a: 1.0,
                    },
                },
                TokenType::Color,
                None,
            )
            .expect("valid token"),
        )
        .expect("insert");

        ctx.insert(
            Token::new(
                make_token_id(3),
                "font.body".to_string(),
                TokenValue::FontFamily {
                    families: vec!["Inter".to_string(), "sans-serif".to_string()],
                },
                TokenType::FontFamily,
                None,
            )
            .expect("valid token"),
        )
        .expect("insert");

        ctx.insert(
            Token::new(
                make_token_id(4),
                "weight.bold".to_string(),
                TokenValue::FontWeight { weight: 700 },
                TokenType::FontWeight,
                None,
            )
            .expect("valid token"),
        )
        .expect("insert");

        ctx.insert(
            Token::new(
                make_token_id(5),
                "timing.fast".to_string(),
                TokenValue::Duration { seconds: 0.2 },
                TokenType::Duration,
                None,
            )
            .expect("valid token"),
        )
        .expect("insert");

        ctx
    }

    #[test]
    fn test_eval_number_literal() {
        let ctx = test_context();
        let expr = TokenExpression::Literal(ExprLiteral::Number(42.0));
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(42.0));
    }

    #[test]
    fn test_eval_percentage_treated_as_number() {
        let ctx = test_context();
        let expr = TokenExpression::Literal(ExprLiteral::Percentage(0.2));
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(0.2));
    }

    #[test]
    fn test_eval_color_literal() {
        let ctx = test_context();
        let color = Color::Srgb {
            r: 0.5,
            g: 0.5,
            b: 0.5,
            a: 1.0,
        };
        let expr = TokenExpression::Literal(ExprLiteral::Color(color.clone()));
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Color(color));
    }

    #[test]
    fn test_eval_string_literal() {
        let ctx = test_context();
        let expr = TokenExpression::Literal(ExprLiteral::Str("hello".to_string()));
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Str("hello".to_string()));
    }

    #[test]
    fn test_eval_token_ref_number() {
        let ctx = test_context();
        let expr = TokenExpression::TokenRef("spacing.md".to_string());
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(16.0));
    }

    #[test]
    fn test_eval_token_ref_color() {
        let ctx = test_context();
        let expr = TokenExpression::TokenRef("brand.primary".to_string());
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(
            result,
            EvalValue::Color(Color::Srgb {
                r: 1.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            })
        );
    }

    #[test]
    fn test_eval_token_ref_font_family_joins_with_comma() {
        let ctx = test_context();
        let expr = TokenExpression::TokenRef("font.body".to_string());
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Str("Inter, sans-serif".to_string()));
    }

    #[test]
    fn test_eval_token_ref_font_weight_as_number() {
        let ctx = test_context();
        let expr = TokenExpression::TokenRef("weight.bold".to_string());
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(700.0));
    }

    #[test]
    fn test_eval_token_ref_duration_as_number() {
        let ctx = test_context();
        let expr = TokenExpression::TokenRef("timing.fast".to_string());
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(0.2));
    }

    #[test]
    fn test_eval_binary_add() {
        let ctx = test_context();
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::Literal(ExprLiteral::Number(1.0))),
            op: BinaryOperator::Add,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
        };
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(3.0));
    }

    #[test]
    fn test_eval_binary_sub() {
        let ctx = test_context();
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::Literal(ExprLiteral::Number(5.0))),
            op: BinaryOperator::Sub,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(3.0))),
        };
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(2.0));
    }

    #[test]
    fn test_eval_binary_mul_with_token_ref() {
        let ctx = test_context();
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::TokenRef("spacing.md".to_string())),
            op: BinaryOperator::Mul,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
        };
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(32.0));
    }

    #[test]
    fn test_eval_binary_div() {
        let ctx = test_context();
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::Literal(ExprLiteral::Number(10.0))),
            op: BinaryOperator::Div,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(4.0))),
        };
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(2.5));
    }

    #[test]
    fn test_eval_division_by_zero_returns_error() {
        let ctx = test_context();
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::Literal(ExprLiteral::Number(1.0))),
            op: BinaryOperator::Div,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(0.0))),
        };
        let result = evaluate(&expr, &ctx, 0);
        assert_eq!(result, Err(ExprError::DivisionByZero));
    }

    #[test]
    fn test_eval_unary_neg_number() {
        let ctx = test_context();
        let expr =
            TokenExpression::UnaryNeg(Box::new(TokenExpression::Literal(ExprLiteral::Number(5.0))));
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(-5.0));
    }

    #[test]
    fn test_eval_unary_neg_token_ref() {
        let ctx = test_context();
        let expr = TokenExpression::UnaryNeg(Box::new(TokenExpression::TokenRef(
            "spacing.md".to_string(),
        )));
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(-16.0));
    }

    #[test]
    fn test_eval_type_error_add_color_and_number() {
        let ctx = test_context();
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::TokenRef("brand.primary".to_string())),
            op: BinaryOperator::Add,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(1.0))),
        };
        let result = evaluate(&expr, &ctx, 0);
        assert!(matches!(result, Err(ExprError::TypeError { .. })));
    }

    #[test]
    fn test_eval_type_error_negate_color() {
        let ctx = test_context();
        let expr = TokenExpression::UnaryNeg(Box::new(TokenExpression::TokenRef(
            "brand.primary".to_string(),
        )));
        let result = evaluate(&expr, &ctx, 0);
        assert!(matches!(result, Err(ExprError::TypeError { .. })));
    }

    #[test]
    fn test_eval_missing_token_returns_reference_not_found() {
        let ctx = test_context();
        let expr = TokenExpression::TokenRef("nonexistent.token".to_string());
        let result = evaluate(&expr, &ctx, 0);
        assert!(matches!(result, Err(ExprError::ReferenceNotFound(_))));
    }

    #[test]
    fn test_eval_unknown_function_returns_error() {
        let ctx = test_context();
        let expr = TokenExpression::FunctionCall {
            name: "foo".to_string(),
            args: vec![],
        };
        let result = evaluate(&expr, &ctx, 0);
        assert_eq!(result, Err(ExprError::UnknownFunction("foo".to_string())));
    }

    #[test]
    fn test_eval_depth_exceeded_returns_error() {
        let ctx = test_context();
        let expr = TokenExpression::Literal(ExprLiteral::Number(1.0));
        let result = evaluate(&expr, &ctx, MAX_ALIAS_CHAIN_DEPTH);
        assert_eq!(result, Err(ExprError::DepthExceeded));
    }

    #[test]
    fn test_max_alias_chain_depth_enforced() {
        // Verify that calling at exactly MAX_ALIAS_CHAIN_DEPTH triggers the error
        let ctx = test_context();
        let expr = TokenExpression::Literal(ExprLiteral::Number(1.0));
        let result = evaluate(&expr, &ctx, MAX_ALIAS_CHAIN_DEPTH);
        assert_eq!(result, Err(ExprError::DepthExceeded));

        // One below the limit should succeed
        let result = evaluate(&expr, &ctx, MAX_ALIAS_CHAIN_DEPTH - 1);
        assert!(result.is_ok());
    }

    #[test]
    fn test_eval_nested_binary_expression() {
        // (1 + 2) * 3 = 9
        let ctx = test_context();
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::Literal(ExprLiteral::Number(1.0))),
                op: BinaryOperator::Add,
                right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
            }),
            op: BinaryOperator::Mul,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(3.0))),
        };
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(9.0));
    }

    #[test]
    fn test_eval_value_type_name() {
        assert_eq!(EvalValue::Number(1.0).type_name(), "number");
        assert_eq!(EvalValue::Color(Color::default()).type_name(), "color");
        assert_eq!(EvalValue::Str("x".to_string()).type_name(), "string");
    }

    #[test]
    fn test_eval_function_call_round() {
        let ctx = test_context();
        let expr = TokenExpression::FunctionCall {
            name: "round".to_string(),
            args: vec![TokenExpression::Literal(ExprLiteral::Number(16.7))],
        };
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(17.0));
    }

    #[test]
    fn test_eval_function_call_with_token_ref_arg() {
        let ctx = test_context();
        // round({spacing.md} + 0.7) = round(16.7) = 17
        let expr = TokenExpression::FunctionCall {
            name: "round".to_string(),
            args: vec![TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::TokenRef("spacing.md".to_string())),
                op: BinaryOperator::Add,
                right: Box::new(TokenExpression::Literal(ExprLiteral::Number(0.7))),
            }],
        };
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(17.0));
    }

    #[test]
    fn test_eval_integration_parse_round() {
        use crate::tokens::parser::parse_expression;
        let ctx = test_context();
        let expr = parse_expression("round(16.7)").expect("should parse");
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(17.0));
    }

    #[test]
    fn test_eval_integration_parse_rem() {
        use crate::tokens::parser::parse_expression;
        let ctx = test_context();
        let expr = parse_expression("rem(32)").expect("should parse");
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(2.0));
    }

    #[test]
    fn test_eval_integration_parse_min_max() {
        use crate::tokens::parser::parse_expression;
        let ctx = test_context();
        let expr = parse_expression("min(10, 20)").expect("should parse");
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(10.0));

        let expr = parse_expression("max(10, 20)").expect("should parse");
        let result = evaluate(&expr, &ctx, 0).expect("should evaluate");
        assert_eq!(result, EvalValue::Number(20.0));
    }

    #[test]
    fn test_eval_literal_nan_returns_domain_error() {
        let ctx = test_context();
        let expr = TokenExpression::Literal(ExprLiteral::Number(f64::NAN));
        let result = evaluate(&expr, &ctx, 0);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }

    #[test]
    fn test_eval_literal_infinity_returns_domain_error() {
        let ctx = test_context();
        let expr = TokenExpression::Literal(ExprLiteral::Number(f64::INFINITY));
        let result = evaluate(&expr, &ctx, 0);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }

    #[test]
    fn test_eval_literal_percentage_nan_returns_domain_error() {
        let ctx = test_context();
        let expr = TokenExpression::Literal(ExprLiteral::Percentage(f64::NAN));
        let result = evaluate(&expr, &ctx, 0);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }

    #[test]
    fn test_eval_binary_arithmetic_producing_non_finite_returns_error() {
        let ctx = test_context();
        // f64::MAX + f64::MAX overflows to infinity
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::Literal(ExprLiteral::Number(f64::MAX))),
            op: BinaryOperator::Add,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(f64::MAX))),
        };
        let result = evaluate(&expr, &ctx, 0);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }
}
