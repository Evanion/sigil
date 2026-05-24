// crates/core/src/tokens/functions/helpers.rs

//! Shared helper functions for expression engine function implementations.
//!
//! These helpers extract typed values from `EvalValue` argument slices
//! and check function arity. They are used by `math.rs`, `size.rs`,
//! `color.rs`, and `blend.rs`.

use crate::node::Color;
use crate::tokens::errors::ExprError;
use crate::tokens::evaluator::EvalValue;

/// Extract a finite `f64` from `args[index]`, or return a typed error.
pub(crate) fn require_number(
    args: &[EvalValue],
    index: usize,
    fn_name: &str,
) -> Result<f64, ExprError> {
    match args.get(index) {
        Some(EvalValue::Number(n)) => {
            if n.is_finite() {
                Ok(*n)
            } else {
                Err(ExprError::DomainError(format!(
                    "{fn_name}: argument {index} is non-finite"
                )))
            }
        }
        Some(other) => Err(ExprError::TypeError {
            expected: "number".to_string(),
            got: other.type_name().to_string(),
        }),
        None => Err(ExprError::ArityError {
            name: fn_name.to_string(),
            expected: index + 1,
            got: args.len(),
        }),
    }
}

/// Extract a `Color` from `args[index]`, or return a typed error.
pub(crate) fn require_color(
    args: &[EvalValue],
    index: usize,
    fn_name: &str,
) -> Result<Color, ExprError> {
    match args.get(index) {
        Some(EvalValue::Color(c)) => Ok(*c),
        Some(other) => Err(ExprError::TypeError {
            expected: "color".to_string(),
            got: other.type_name().to_string(),
        }),
        None => Err(ExprError::ArityError {
            name: fn_name.to_string(),
            expected: index + 1,
            got: args.len(),
        }),
    }
}

/// Extract a `&str` from `args[index]`, or return a typed error.
pub(crate) fn require_str<'a>(
    args: &'a [EvalValue],
    index: usize,
    fn_name: &str,
) -> Result<&'a str, ExprError> {
    match args.get(index) {
        Some(EvalValue::Str(s)) => Ok(s.as_str()),
        Some(other) => Err(ExprError::TypeError {
            expected: "string".to_string(),
            got: other.type_name().to_string(),
        }),
        None => Err(ExprError::ArityError {
            name: fn_name.to_string(),
            expected: index + 1,
            got: args.len(),
        }),
    }
}

/// Check that `args` has exactly `expected` elements.
pub(crate) fn check_arity(
    args: &[EvalValue],
    expected: usize,
    fn_name: &str,
) -> Result<(), ExprError> {
    if args.len() == expected {
        Ok(())
    } else {
        Err(ExprError::ArityError {
            name: fn_name.to_string(),
            expected,
            got: args.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_require_number_extracts_finite_number() {
        let args = [EvalValue::Number(42.0)];
        assert_eq!(require_number(&args, 0, "test"), Ok(42.0));
    }

    #[test]
    fn test_require_number_rejects_nan() {
        let args = [EvalValue::Number(f64::NAN)];
        assert!(matches!(
            require_number(&args, 0, "test"),
            Err(ExprError::DomainError(_))
        ));
    }

    #[test]
    fn test_require_number_rejects_wrong_type() {
        let args = [EvalValue::Str("x".to_string())];
        assert!(matches!(
            require_number(&args, 0, "test"),
            Err(ExprError::TypeError { .. })
        ));
    }

    #[test]
    fn test_require_number_rejects_missing_index() {
        let args: [EvalValue; 0] = [];
        assert!(matches!(
            require_number(&args, 0, "test"),
            Err(ExprError::ArityError { .. })
        ));
    }

    #[test]
    fn test_require_color_extracts_color() {
        let c = Color::default();
        let args = [EvalValue::Color(c)];
        assert!(require_color(&args, 0, "test").is_ok());
    }

    #[test]
    fn test_require_str_extracts_string() {
        let args = [EvalValue::Str("hello".to_string())];
        assert_eq!(require_str(&args, 0, "test"), Ok("hello"));
    }

    #[test]
    fn test_check_arity_accepts_correct_count() {
        let args = [EvalValue::Number(1.0), EvalValue::Number(2.0)];
        assert!(check_arity(&args, 2, "test").is_ok());
    }

    #[test]
    fn test_check_arity_rejects_wrong_count() {
        let args = [EvalValue::Number(1.0)];
        assert!(matches!(
            check_arity(&args, 2, "test"),
            Err(ExprError::ArityError { .. })
        ));
    }
}
