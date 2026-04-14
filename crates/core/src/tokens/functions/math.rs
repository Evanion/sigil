// crates/core/src/tokens/functions/math.rs

//! Math functions for the token expression engine.
//!
//! Provides: `round`, `ceil`, `floor`, `abs`, `min`, `max`, `clamp`.

use crate::tokens::errors::ExprError;
use crate::tokens::evaluator::EvalValue;

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

/// `round(n)` -- round to nearest integer.
///
/// # Errors
///
/// Returns `ArityError` if not 1 arg, `TypeError` if not a number,
/// or `DomainError` if the number is non-finite.
pub fn fn_round(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "round")?;
    let n = require_number(args, 0, "round")?;
    Ok(EvalValue::Number(n.round()))
}

/// `ceil(n)` -- round up to nearest integer.
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, or `DomainError`.
pub fn fn_ceil(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "ceil")?;
    let n = require_number(args, 0, "ceil")?;
    Ok(EvalValue::Number(n.ceil()))
}

/// `floor(n)` -- round down to nearest integer.
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, or `DomainError`.
pub fn fn_floor(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "floor")?;
    let n = require_number(args, 0, "floor")?;
    Ok(EvalValue::Number(n.floor()))
}

/// `abs(n)` -- absolute value.
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, or `DomainError`.
pub fn fn_abs(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "abs")?;
    let n = require_number(args, 0, "abs")?;
    Ok(EvalValue::Number(n.abs()))
}

/// `min(a, b)` -- smaller of two numbers.
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, or `DomainError`.
pub fn fn_min(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "min")?;
    let a = require_number(args, 0, "min")?;
    let b = require_number(args, 1, "min")?;
    Ok(EvalValue::Number(a.min(b)))
}

/// `max(a, b)` -- larger of two numbers.
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, or `DomainError`.
pub fn fn_max(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "max")?;
    let a = require_number(args, 0, "max")?;
    let b = require_number(args, 1, "max")?;
    Ok(EvalValue::Number(a.max(b)))
}

/// `clamp(val, lo, hi)` -- clamp value to range \[lo, hi\].
///
/// # Errors
///
/// Returns `ArityError`, `TypeError`, `DomainError` (non-finite or lo > hi).
pub fn fn_clamp(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 3, "clamp")?;
    let val = require_number(args, 0, "clamp")?;
    let lo = require_number(args, 1, "clamp")?;
    let hi = require_number(args, 2, "clamp")?;
    if lo > hi {
        return Err(ExprError::DomainError(format!(
            "clamp: min ({lo}) > max ({hi})"
        )));
    }
    Ok(EvalValue::Number(val.clamp(lo, hi)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::Color;

    // ── round ───────────────────────────────────────────────────────

    #[test]
    fn test_round_rounds_to_nearest_integer() {
        assert_eq!(
            fn_round(&[EvalValue::Number(2.3)]),
            Ok(EvalValue::Number(2.0))
        );
        assert_eq!(
            fn_round(&[EvalValue::Number(2.7)]),
            Ok(EvalValue::Number(3.0))
        );
        assert_eq!(
            fn_round(&[EvalValue::Number(-1.5)]),
            Ok(EvalValue::Number(-2.0))
        );
    }

    #[test]
    fn test_round_wrong_arity() {
        assert!(matches!(fn_round(&[]), Err(ExprError::ArityError { .. })));
        assert!(matches!(
            fn_round(&[EvalValue::Number(1.0), EvalValue::Number(2.0)]),
            Err(ExprError::ArityError { .. })
        ));
    }

    #[test]
    fn test_round_wrong_type() {
        let color = EvalValue::Color(Color::default());
        assert!(matches!(
            fn_round(&[color]),
            Err(ExprError::TypeError { .. })
        ));
    }

    // ── ceil ────────────────────────────────────────────────────────

    #[test]
    fn test_ceil_rounds_up() {
        assert_eq!(
            fn_ceil(&[EvalValue::Number(2.1)]),
            Ok(EvalValue::Number(3.0))
        );
        assert_eq!(
            fn_ceil(&[EvalValue::Number(-2.9)]),
            Ok(EvalValue::Number(-2.0))
        );
    }

    #[test]
    fn test_ceil_wrong_arity() {
        assert!(matches!(fn_ceil(&[]), Err(ExprError::ArityError { .. })));
    }

    #[test]
    fn test_ceil_wrong_type() {
        assert!(matches!(
            fn_ceil(&[EvalValue::Str("x".into())]),
            Err(ExprError::TypeError { .. })
        ));
    }

    // ── floor ───────────────────────────────────────────────────────

    #[test]
    fn test_floor_rounds_down() {
        assert_eq!(
            fn_floor(&[EvalValue::Number(2.9)]),
            Ok(EvalValue::Number(2.0))
        );
        assert_eq!(
            fn_floor(&[EvalValue::Number(-2.1)]),
            Ok(EvalValue::Number(-3.0))
        );
    }

    #[test]
    fn test_floor_wrong_arity() {
        assert!(matches!(fn_floor(&[]), Err(ExprError::ArityError { .. })));
    }

    // ── abs ─────────────────────────────────────────────────────────

    #[test]
    fn test_abs_returns_absolute_value() {
        assert_eq!(
            fn_abs(&[EvalValue::Number(-5.0)]),
            Ok(EvalValue::Number(5.0))
        );
        assert_eq!(
            fn_abs(&[EvalValue::Number(3.0)]),
            Ok(EvalValue::Number(3.0))
        );
    }

    #[test]
    fn test_abs_wrong_arity() {
        assert!(matches!(fn_abs(&[]), Err(ExprError::ArityError { .. })));
    }

    // ── min ─────────────────────────────────────────────────────────

    #[test]
    fn test_min_returns_smaller() {
        assert_eq!(
            fn_min(&[EvalValue::Number(3.0), EvalValue::Number(7.0)]),
            Ok(EvalValue::Number(3.0))
        );
        assert_eq!(
            fn_min(&[EvalValue::Number(-1.0), EvalValue::Number(-5.0)]),
            Ok(EvalValue::Number(-5.0))
        );
    }

    #[test]
    fn test_min_wrong_arity() {
        assert!(matches!(
            fn_min(&[EvalValue::Number(1.0)]),
            Err(ExprError::ArityError { .. })
        ));
    }

    #[test]
    fn test_min_wrong_type_second_arg() {
        assert!(matches!(
            fn_min(&[EvalValue::Number(1.0), EvalValue::Str("x".into())]),
            Err(ExprError::TypeError { .. })
        ));
    }

    // ── max ─────────────────────────────────────────────────────────

    #[test]
    fn test_max_returns_larger() {
        assert_eq!(
            fn_max(&[EvalValue::Number(3.0), EvalValue::Number(7.0)]),
            Ok(EvalValue::Number(7.0))
        );
    }

    #[test]
    fn test_max_wrong_arity() {
        assert!(matches!(
            fn_max(&[EvalValue::Number(1.0)]),
            Err(ExprError::ArityError { .. })
        ));
    }

    // ── clamp ───────────────────────────────────────────────────────

    #[test]
    fn test_clamp_clamps_within_range() {
        assert_eq!(
            fn_clamp(&[
                EvalValue::Number(5.0),
                EvalValue::Number(0.0),
                EvalValue::Number(10.0),
            ]),
            Ok(EvalValue::Number(5.0))
        );
        assert_eq!(
            fn_clamp(&[
                EvalValue::Number(-5.0),
                EvalValue::Number(0.0),
                EvalValue::Number(10.0),
            ]),
            Ok(EvalValue::Number(0.0))
        );
        assert_eq!(
            fn_clamp(&[
                EvalValue::Number(15.0),
                EvalValue::Number(0.0),
                EvalValue::Number(10.0),
            ]),
            Ok(EvalValue::Number(10.0))
        );
    }

    #[test]
    fn test_clamp_min_greater_than_max_returns_domain_error() {
        let result = fn_clamp(&[
            EvalValue::Number(5.0),
            EvalValue::Number(10.0),
            EvalValue::Number(0.0),
        ]);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }

    #[test]
    fn test_clamp_wrong_arity() {
        assert!(matches!(
            fn_clamp(&[EvalValue::Number(1.0), EvalValue::Number(2.0)]),
            Err(ExprError::ArityError { .. })
        ));
    }

    // ── non-finite input guard ──────────────────────────────────────

    #[test]
    fn test_require_number_rejects_nan() {
        let result = fn_round(&[EvalValue::Number(f64::NAN)]);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }

    #[test]
    fn test_require_number_rejects_infinity() {
        let result = fn_round(&[EvalValue::Number(f64::INFINITY)]);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }

    #[test]
    fn test_require_number_rejects_neg_infinity() {
        let result = fn_abs(&[EvalValue::Number(f64::NEG_INFINITY)]);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }
}
