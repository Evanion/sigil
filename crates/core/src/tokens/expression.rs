// crates/core/src/tokens/expression.rs

//! Expression AST types for the design token expression engine.
//!
//! These types represent the parsed form of token expressions such as
//! `{color.primary}`, `darken({color.bg}, 10%)`, or `{spacing.base} * 2`.

use serde::Serialize;

use crate::node::Color;

/// A parsed token expression.
///
/// Expressions can be literal values, references to other tokens,
/// binary arithmetic operations, unary negation, or function calls.
///
/// These types are only constructed via the parser — `Deserialize` is
/// intentionally omitted to prevent untrusted input from bypassing
/// parser validation.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum TokenExpression {
    /// A literal value (number, percentage, color, or string).
    Literal(ExprLiteral),
    /// A reference to another token by name (e.g., `{color.primary}`).
    TokenRef(String),
    /// A binary arithmetic operation.
    BinaryOp {
        /// Left operand.
        left: Box<TokenExpression>,
        /// The operator.
        op: BinaryOperator,
        /// Right operand.
        right: Box<TokenExpression>,
    },
    /// Unary negation (e.g., `-{spacing.base}`).
    UnaryNeg(Box<TokenExpression>),
    /// A function call (e.g., `darken({color.bg}, 10%)`).
    FunctionCall {
        /// Function name.
        name: String,
        /// Function arguments.
        args: Vec<TokenExpression>,
    },
}

/// A literal value within an expression.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum ExprLiteral {
    /// A numeric literal (e.g., `42`, `3.14`).
    Number(f64),
    /// A percentage literal (e.g., `10%`, stored as 0.1 (the fractional form)).
    Percentage(f64),
    /// A color literal.
    Color(Color),
    /// A string literal.
    Str(String),
}

/// Binary arithmetic operators supported in expressions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum BinaryOperator {
    /// Addition (`+`).
    Add,
    /// Subtraction (`-`).
    Sub,
    /// Multiplication (`*`).
    Mul,
    /// Division (`/`).
    Div,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_expression_literal_number_serializes() {
        let expr = TokenExpression::Literal(ExprLiteral::Number(42.0));
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(json.contains("42"), "JSON should contain the number");
    }

    #[test]
    fn test_token_expression_literal_percentage_serializes() {
        let expr = TokenExpression::Literal(ExprLiteral::Percentage(0.1));
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(
            json.contains("Percentage"),
            "JSON should contain variant name"
        );
    }

    #[test]
    fn test_token_expression_literal_color_serializes() {
        let expr = TokenExpression::Literal(ExprLiteral::Color(Color::default()));
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(!json.is_empty(), "JSON should not be empty");
    }

    #[test]
    fn test_token_expression_literal_str_serializes() {
        let expr = TokenExpression::Literal(ExprLiteral::Str("hello".to_string()));
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(json.contains("hello"), "JSON should contain the string");
    }

    #[test]
    fn test_token_expression_token_ref_serializes() {
        let expr = TokenExpression::TokenRef("color.primary".to_string());
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(
            json.contains("color.primary"),
            "JSON should contain the ref"
        );
    }

    #[test]
    fn test_token_expression_binary_op_serializes() {
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::TokenRef("spacing.base".to_string())),
            op: BinaryOperator::Mul,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
        };
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(json.contains("Mul"), "JSON should contain operator");
    }

    #[test]
    fn test_token_expression_unary_neg_serializes() {
        let expr =
            TokenExpression::UnaryNeg(Box::new(TokenExpression::Literal(ExprLiteral::Number(5.0))));
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(
            json.contains("UnaryNeg"),
            "JSON should contain variant name"
        );
    }

    #[test]
    fn test_token_expression_function_call_serializes() {
        let expr = TokenExpression::FunctionCall {
            name: "darken".to_string(),
            args: vec![
                TokenExpression::TokenRef("color.bg".to_string()),
                TokenExpression::Literal(ExprLiteral::Percentage(0.1)),
            ],
        };
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(json.contains("darken"), "JSON should contain function name");
    }

    #[test]
    fn test_binary_operator_all_variants_serialize() {
        let ops = [
            BinaryOperator::Add,
            BinaryOperator::Sub,
            BinaryOperator::Mul,
            BinaryOperator::Div,
        ];
        for op in ops {
            let json = serde_json::to_string(&op).expect("serialize");
            assert!(!json.is_empty(), "JSON should not be empty for {op:?}");
        }
    }

    #[test]
    fn test_token_expression_nested_binary_op_serializes() {
        // (a + b) * c
        let expr = TokenExpression::BinaryOp {
            left: Box::new(TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::Literal(ExprLiteral::Number(1.0))),
                op: BinaryOperator::Add,
                right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
            }),
            op: BinaryOperator::Mul,
            right: Box::new(TokenExpression::Literal(ExprLiteral::Number(3.0))),
        };
        let json = serde_json::to_string(&expr).expect("serialize");
        assert!(json.contains("BinaryOp"), "JSON should contain variant");
    }
}
