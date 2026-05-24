// crates/core/src/tokens/errors.rs

//! Error types for the token expression engine.

use thiserror::Error;

/// Errors that can occur during expression parsing, evaluation, or resolution.
#[derive(Debug, Error, Clone, PartialEq)]
pub enum ExprError {
    /// The expression string could not be parsed.
    #[error("parse error: {0}")]
    Parse(String),

    /// A function name used in the expression is not registered.
    #[error("unknown function: {0}")]
    UnknownFunction(String),

    /// A function was called with the wrong number of arguments.
    #[error("function {name} expects {expected} args, got {got}")]
    ArityError {
        /// The function name.
        name: String,
        /// Expected argument count.
        expected: usize,
        /// Actual argument count.
        got: usize,
    },

    /// An operand or argument has an incompatible type.
    #[error("type error: expected {expected}, got {got}")]
    TypeError {
        /// The expected type description.
        expected: String,
        /// The actual type description.
        got: String,
    },

    /// A cycle was detected while resolving token references.
    #[error("cycle detected resolving token: {0}")]
    CycleDetected(String),

    /// The maximum token resolution depth was exceeded.
    #[error("max resolution depth exceeded")]
    DepthExceeded,

    /// A referenced token does not exist.
    #[error("token not found: {0}")]
    ReferenceNotFound(String),

    /// A mathematical operation produced an invalid result
    /// (e.g., square root of a negative number).
    #[error("domain error: {0}")]
    DomainError(String),

    /// A division by zero was attempted.
    #[error("division by zero")]
    DivisionByZero,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expr_error_display_parse() {
        let err = ExprError::Parse("unexpected token '!'".to_string());
        assert_eq!(err.to_string(), "parse error: unexpected token '!'");
    }

    #[test]
    fn test_expr_error_display_unknown_function() {
        let err = ExprError::UnknownFunction("frobnicate".to_string());
        assert_eq!(err.to_string(), "unknown function: frobnicate");
    }

    #[test]
    fn test_expr_error_display_arity_error() {
        let err = ExprError::ArityError {
            name: "darken".to_string(),
            expected: 2,
            got: 3,
        };
        assert_eq!(err.to_string(), "function darken expects 2 args, got 3");
    }

    #[test]
    fn test_expr_error_display_type_error() {
        let err = ExprError::TypeError {
            expected: "number".to_string(),
            got: "color".to_string(),
        };
        assert_eq!(err.to_string(), "type error: expected number, got color");
    }

    #[test]
    fn test_expr_error_display_cycle_detected() {
        let err = ExprError::CycleDetected("color.primary".to_string());
        assert_eq!(
            err.to_string(),
            "cycle detected resolving token: color.primary"
        );
    }

    #[test]
    fn test_expr_error_display_depth_exceeded() {
        let err = ExprError::DepthExceeded;
        assert_eq!(err.to_string(), "max resolution depth exceeded");
    }

    #[test]
    fn test_expr_error_display_reference_not_found() {
        let err = ExprError::ReferenceNotFound("color.missing".to_string());
        assert_eq!(err.to_string(), "token not found: color.missing");
    }

    #[test]
    fn test_expr_error_display_domain_error() {
        let err = ExprError::DomainError("sqrt of negative number".to_string());
        assert_eq!(err.to_string(), "domain error: sqrt of negative number");
    }

    #[test]
    fn test_expr_error_display_division_by_zero() {
        let err = ExprError::DivisionByZero;
        assert_eq!(err.to_string(), "division by zero");
    }

    #[test]
    fn test_expr_error_clone_and_eq() {
        let err1 = ExprError::Parse("test".to_string());
        let err2 = err1.clone();
        assert_eq!(err1, err2);
    }
}
