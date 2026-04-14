// crates/core/src/tokens/functions/size.rs

//! Size conversion functions for the token expression engine.
//!
//! Provides: `rem(px)`, `em(px)`, `px(rem_or_em)`.
//!
//! All conversions use a base font size of 16px.

use crate::tokens::errors::ExprError;
use crate::tokens::evaluator::EvalValue;

/// Base font size in pixels for rem/em conversions.
const BASE_FONT_SIZE: f64 = 16.0;

/// Extract a finite `f64` from `args[index]`, or return a typed error.
fn require_number(args: &[EvalValue], index: usize, fn_name: &str) -> Result<f64, ExprError> {
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

/// Check that `args` has exactly `expected` elements.
fn check_arity(args: &[EvalValue], expected: usize, fn_name: &str) -> Result<(), ExprError> {
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

/// `rem(px)` -- convert pixels to rem units (px / 16).
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, or `DomainError`.
pub fn fn_rem(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "rem")?;
    let px = require_number(args, 0, "rem")?;
    Ok(EvalValue::Number(px / BASE_FONT_SIZE))
}

/// `em(px)` -- convert pixels to em units (px / 16).
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, or `DomainError`.
pub fn fn_em(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "em")?;
    let px = require_number(args, 0, "em")?;
    Ok(EvalValue::Number(px / BASE_FONT_SIZE))
}

/// `px(rem_or_em)` -- convert rem/em to pixels (value * 16).
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, or `DomainError`.
pub fn fn_px(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "px")?;
    let value = require_number(args, 0, "px")?;
    Ok(EvalValue::Number(value * BASE_FONT_SIZE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::Color;

    // ── rem ─────────────────────────────────────────────────────────

    #[test]
    fn test_rem_converts_pixels_to_rem() {
        assert_eq!(
            fn_rem(&[EvalValue::Number(16.0)]),
            Ok(EvalValue::Number(1.0))
        );
        assert_eq!(
            fn_rem(&[EvalValue::Number(32.0)]),
            Ok(EvalValue::Number(2.0))
        );
        assert_eq!(
            fn_rem(&[EvalValue::Number(8.0)]),
            Ok(EvalValue::Number(0.5))
        );
    }

    #[test]
    fn test_rem_wrong_arity() {
        assert!(matches!(fn_rem(&[]), Err(ExprError::ArityError { .. })));
        assert!(matches!(
            fn_rem(&[EvalValue::Number(1.0), EvalValue::Number(2.0)]),
            Err(ExprError::ArityError { .. })
        ));
    }

    #[test]
    fn test_rem_wrong_type() {
        let color = EvalValue::Color(Color::default());
        assert!(matches!(fn_rem(&[color]), Err(ExprError::TypeError { .. })));
    }

    // ── em ──────────────────────────────────────────────────────────

    #[test]
    fn test_em_converts_pixels_to_em() {
        assert_eq!(
            fn_em(&[EvalValue::Number(16.0)]),
            Ok(EvalValue::Number(1.0))
        );
        assert_eq!(
            fn_em(&[EvalValue::Number(48.0)]),
            Ok(EvalValue::Number(3.0))
        );
    }

    #[test]
    fn test_em_wrong_arity() {
        assert!(matches!(fn_em(&[]), Err(ExprError::ArityError { .. })));
    }

    // ── px ──────────────────────────────────────────────────────────

    #[test]
    fn test_px_converts_rem_to_pixels() {
        assert_eq!(
            fn_px(&[EvalValue::Number(1.0)]),
            Ok(EvalValue::Number(16.0))
        );
        assert_eq!(
            fn_px(&[EvalValue::Number(2.5)]),
            Ok(EvalValue::Number(40.0))
        );
    }

    #[test]
    fn test_px_wrong_arity() {
        assert!(matches!(fn_px(&[]), Err(ExprError::ArityError { .. })));
    }

    #[test]
    fn test_px_wrong_type() {
        assert!(matches!(
            fn_px(&[EvalValue::Str("1rem".into())]),
            Err(ExprError::TypeError { .. })
        ));
    }

    // ── non-finite guards ───────────────────────────────────────────

    #[test]
    fn test_size_functions_reject_nan() {
        assert!(matches!(
            fn_rem(&[EvalValue::Number(f64::NAN)]),
            Err(ExprError::DomainError(_))
        ));
        assert!(matches!(
            fn_em(&[EvalValue::Number(f64::NAN)]),
            Err(ExprError::DomainError(_))
        ));
        assert!(matches!(
            fn_px(&[EvalValue::Number(f64::NAN)]),
            Err(ExprError::DomainError(_))
        ));
    }

    #[test]
    fn test_size_functions_reject_infinity() {
        assert!(matches!(
            fn_rem(&[EvalValue::Number(f64::INFINITY)]),
            Err(ExprError::DomainError(_))
        ));
    }
}
