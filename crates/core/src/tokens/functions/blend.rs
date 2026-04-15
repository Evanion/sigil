// crates/core/src/tokens/functions/blend.rs

//! Blend mode function for the token expression engine.
//!
//! Provides: `blend(c1, c2, mode_string)` with 11 blend modes.

use crate::tokens::color_convert::{color_to_srgb, srgb_to_color};
use crate::tokens::errors::ExprError;
use crate::tokens::evaluator::EvalValue;
use crate::tokens::functions::helpers::{require_color, require_str};

/// `blend(c1, c2, mode)` -- blend two colors using the given mode.
///
/// `c1` is the base (backdrop), `c2` is the source (foreground).
/// `mode` is a string naming one of the 11 supported blend modes.
///
/// Alpha is composited separately using standard alpha compositing.
///
/// # Errors
///
/// Returns `ExprError::ArityError` if not exactly 3 args.
/// Returns `ExprError::TypeError` if arg types are wrong.
/// Returns `ExprError::DomainError` if the mode string is unknown.
pub fn fn_blend(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    if args.len() != 3 {
        return Err(ExprError::ArityError {
            name: "blend".to_string(),
            expected: 3,
            got: args.len(),
        });
    }
    let c1 = require_color(args, 0, "blend")?;
    let c2 = require_color(args, 1, "blend")?;
    let mode = require_str(args, 2, "blend")?;

    let blend_fn = match mode {
        "multiply" => blend_multiply as fn(f64, f64) -> f64,
        "screen" => blend_screen,
        "overlay" => blend_overlay,
        "darken" => blend_darken,
        "lighten" => blend_lighten,
        "color-dodge" => blend_color_dodge,
        "color-burn" => blend_color_burn,
        "hard-light" => blend_hard_light,
        "soft-light" => blend_soft_light,
        "difference" => blend_difference,
        "exclusion" => blend_exclusion,
        _ => {
            return Err(ExprError::DomainError(format!(
                "blend: unknown mode '{mode}'"
            )));
        }
    };

    let (r1, g1, b1, a1) = color_to_srgb(&c1)?;
    let (r2, g2, b2, a2) = color_to_srgb(&c2)?;

    // Apply per-channel blend
    let br = blend_fn(r1, r2);
    let bg = blend_fn(g1, g2);
    let bb = blend_fn(b1, b2);

    // Standard alpha compositing: out_a = a2 + a1*(1-a2)
    let out_a = a2 + a1 * (1.0 - a2);

    // Composite the blended RGB with alpha
    let (out_r, out_g, out_b) = if out_a < f64::EPSILON {
        (0.0, 0.0, 0.0)
    } else {
        // out_rgb = (a2 * blend_rgb + a1 * (1-a2) * base_rgb) / out_a
        (
            (a2 * br + a1 * (1.0 - a2) * r1) / out_a,
            (a2 * bg + a1 * (1.0 - a2) * g1) / out_a,
            (a2 * bb + a1 * (1.0 - a2) * b1) / out_a,
        )
    };

    Ok(EvalValue::Color(srgb_to_color(out_r, out_g, out_b, out_a)))
}

// ── Blend mode implementations ──────────────────────────────────────

/// `multiply`: a * b
fn blend_multiply(a: f64, b: f64) -> f64 {
    a * b
}

/// `screen`: 1 - (1-a)(1-b)
fn blend_screen(a: f64, b: f64) -> f64 {
    1.0 - (1.0 - a) * (1.0 - b)
}

/// `overlay`: if a < 0.5: 2*a*b, else: 1 - 2*(1-a)*(1-b)
fn blend_overlay(a: f64, b: f64) -> f64 {
    if a < 0.5 {
        2.0 * a * b
    } else {
        1.0 - 2.0 * (1.0 - a) * (1.0 - b)
    }
}

/// `darken`: min(a, b)
fn blend_darken(a: f64, b: f64) -> f64 {
    a.min(b)
}

/// `lighten`: max(a, b)
fn blend_lighten(a: f64, b: f64) -> f64 {
    a.max(b)
}

/// `color-dodge`: if b == 1: 1, else: min(1, a / (1-b))
fn blend_color_dodge(a: f64, b: f64) -> f64 {
    if (b - 1.0).abs() < f64::EPSILON {
        1.0
    } else {
        (a / (1.0 - b)).min(1.0)
    }
}

/// `color-burn`: if b == 0: 0, else: 1 - min(1, (1-a) / b)
fn blend_color_burn(a: f64, b: f64) -> f64 {
    if b.abs() < f64::EPSILON {
        0.0
    } else {
        1.0 - ((1.0 - a) / b).min(1.0)
    }
}

/// `hard-light`: if b < 0.5: 2*a*b, else: 1 - 2*(1-a)*(1-b)
fn blend_hard_light(a: f64, b: f64) -> f64 {
    if b < 0.5 {
        2.0 * a * b
    } else {
        1.0 - 2.0 * (1.0 - a) * (1.0 - b)
    }
}

/// `soft-light`: Photoshop-compatible soft-light formula (simplified from W3C spec).
///
/// if b <= 0.5: a - (1-2b)*a*(1-a)
/// else: a + (2b-1)*(sqrt(a)-a)
///
/// Domain guard: `sqrt(a)` requires `a >= 0`. If `a < 0` (which should
/// not happen for valid sRGB but could from conversion artifacts), we
/// treat it as 0 to prevent NaN.
fn blend_soft_light(a: f64, b: f64) -> f64 {
    if b <= 0.5 {
        a - (1.0 - 2.0 * b) * a * (1.0 - a)
    } else {
        // Guard: sqrt requires non-negative input
        let sqrt_a = if a >= 0.0 { a.sqrt() } else { 0.0 };
        a + (2.0 * b - 1.0) * (sqrt_a - a)
    }
}

/// `difference`: |a - b|
fn blend_difference(a: f64, b: f64) -> f64 {
    (a - b).abs()
}

/// `exclusion`: a + b - 2*a*b
fn blend_exclusion(a: f64, b: f64) -> f64 {
    a + b - 2.0 * a * b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::Color;

    /// Tolerance for floating-point comparison.
    const EPSILON: f64 = 1e-6;

    fn assert_approx(actual: f64, expected: f64, label: &str) {
        assert!(
            (actual - expected).abs() < EPSILON,
            "{label}: expected {expected}, got {actual} (diff {})",
            (actual - expected).abs()
        );
    }

    fn srgb_color(r: f64, g: f64, b: f64) -> EvalValue {
        EvalValue::Color(Color::Srgb { r, g, b, a: 1.0 })
    }

    fn mode(s: &str) -> EvalValue {
        EvalValue::Str(s.to_string())
    }

    fn unwrap_color(v: &EvalValue) -> (f64, f64, f64, f64) {
        match v {
            EvalValue::Color(c) => color_to_srgb(c).expect("test color should be sRGB"),
            other => panic!("expected Color, got {other:?}"),
        }
    }

    // ── Individual blend modes ──────────────────────────────────────

    #[test]
    fn test_blend_multiply() {
        // 0.5 * 0.4 = 0.2
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.4, 0.4, 0.4),
            mode("multiply"),
        ])
        .expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.2, "multiply r");
        assert_approx(g, 0.2, "multiply g");
        assert_approx(b, 0.2, "multiply b");
    }

    #[test]
    fn test_blend_screen() {
        // 1 - (1-0.5)(1-0.5) = 1 - 0.25 = 0.75
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.5, 0.5, 0.5),
            mode("screen"),
        ])
        .expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert_approx(r, 0.75, "screen r");
    }

    #[test]
    fn test_blend_overlay() {
        // a=0.3 < 0.5: 2*0.3*0.5 = 0.3
        let result = fn_blend(&[
            srgb_color(0.3, 0.3, 0.3),
            srgb_color(0.5, 0.5, 0.5),
            mode("overlay"),
        ])
        .expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert_approx(r, 0.3, "overlay r (a<0.5)");
    }

    #[test]
    fn test_blend_darken() {
        let result = fn_blend(&[
            srgb_color(0.8, 0.2, 0.5),
            srgb_color(0.3, 0.9, 0.5),
            mode("darken"),
        ])
        .expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.3, "darken r");
        assert_approx(g, 0.2, "darken g");
        assert_approx(b, 0.5, "darken b");
    }

    #[test]
    fn test_blend_lighten() {
        let result = fn_blend(&[
            srgb_color(0.8, 0.2, 0.5),
            srgb_color(0.3, 0.9, 0.5),
            mode("lighten"),
        ])
        .expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.8, "lighten r");
        assert_approx(g, 0.9, "lighten g");
        assert_approx(b, 0.5, "lighten b");
    }

    #[test]
    fn test_blend_color_dodge() {
        // a=0.5, b=0.5: min(1, 0.5/0.5) = 1.0
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.5, 0.5, 0.5),
            mode("color-dodge"),
        ])
        .expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert_approx(r, 1.0, "color-dodge r");
    }

    #[test]
    fn test_blend_color_burn() {
        // a=0.5, b=0.5: 1 - min(1, 0.5/0.5) = 1 - 1 = 0
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.5, 0.5, 0.5),
            mode("color-burn"),
        ])
        .expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "color-burn r");
    }

    #[test]
    fn test_blend_hard_light() {
        // b=0.3 < 0.5: 2*0.5*0.3 = 0.3
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.3, 0.3, 0.3),
            mode("hard-light"),
        ])
        .expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert_approx(r, 0.3, "hard-light r");
    }

    #[test]
    fn test_blend_soft_light() {
        // Soft light is more complex; just verify finite output
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.7, 0.7, 0.7),
            mode("soft-light"),
        ])
        .expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert!(r.is_finite(), "soft-light should produce finite result");
        assert!(r >= 0.0 && r <= 1.0, "soft-light should be in [0,1]");
    }

    #[test]
    fn test_blend_difference() {
        // |0.8 - 0.3| = 0.5
        let result = fn_blend(&[
            srgb_color(0.8, 0.8, 0.8),
            srgb_color(0.3, 0.3, 0.3),
            mode("difference"),
        ])
        .expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert_approx(r, 0.5, "difference r");
    }

    #[test]
    fn test_blend_exclusion() {
        // 0.5 + 0.5 - 2*0.5*0.5 = 0.5
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.5, 0.5, 0.5),
            mode("exclusion"),
        ])
        .expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert_approx(r, 0.5, "exclusion r");
    }

    // ── Error cases ─────────────────────────────────────────────────

    #[test]
    fn test_blend_unknown_mode_returns_domain_error() {
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.5, 0.5, 0.5),
            mode("invalid-mode"),
        ]);
        assert!(matches!(result, Err(ExprError::DomainError(_))));
    }

    #[test]
    fn test_blend_wrong_arity() {
        assert!(matches!(
            fn_blend(&[srgb_color(0.5, 0.5, 0.5)]),
            Err(ExprError::ArityError { .. })
        ));
    }

    #[test]
    fn test_blend_wrong_type_first_arg() {
        assert!(matches!(
            fn_blend(&[
                EvalValue::Number(1.0),
                srgb_color(0.5, 0.5, 0.5),
                mode("multiply"),
            ]),
            Err(ExprError::TypeError { .. })
        ));
    }

    #[test]
    fn test_blend_wrong_type_third_arg() {
        assert!(matches!(
            fn_blend(&[
                srgb_color(0.5, 0.5, 0.5),
                srgb_color(0.5, 0.5, 0.5),
                EvalValue::Number(1.0),
            ]),
            Err(ExprError::TypeError { .. })
        ));
    }

    // ── Identity / edge cases ───────────────────────────────────────

    #[test]
    fn test_blend_multiply_with_white_is_identity() {
        // color * white(1,1,1) = color
        let result = fn_blend(&[
            srgb_color(0.3, 0.6, 0.9),
            srgb_color(1.0, 1.0, 1.0),
            mode("multiply"),
        ])
        .expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.3, "multiply white r");
        assert_approx(g, 0.6, "multiply white g");
        assert_approx(b, 0.9, "multiply white b");
    }

    #[test]
    fn test_blend_screen_with_black_is_identity() {
        // screen(color, black) = color
        let result = fn_blend(&[
            srgb_color(0.3, 0.6, 0.9),
            srgb_color(0.0, 0.0, 0.0),
            mode("screen"),
        ])
        .expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.3, "screen black r");
        assert_approx(g, 0.6, "screen black g");
        assert_approx(b, 0.9, "screen black b");
    }

    #[test]
    fn test_blend_difference_same_color_is_black() {
        let result = fn_blend(&[
            srgb_color(0.5, 0.5, 0.5),
            srgb_color(0.5, 0.5, 0.5),
            mode("difference"),
        ])
        .expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "diff same r");
        assert_approx(g, 0.0, "diff same g");
        assert_approx(b, 0.0, "diff same b");
    }
}
