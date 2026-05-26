// crates/core/src/tokens/color_convert.rs

//! sRGB <-> HSL color conversion helpers for the expression engine.
//!
//! Color functions (lighten, darken, saturate, etc.) need to convert between
//! sRGB and HSL color spaces. These helpers provide that conversion.
//!
//! All functions guard against NaN/Infinity inputs by replacing non-finite
//! values with 0.0. Channel clamping on *output* is acceptable here because
//! these are internal conversion functions producing computed results, not
//! user-input validation boundaries.

use crate::color_matrix::{
    DISPLAY_P3_TO_XYZ_D65, SRGB_TO_XYZ_D65, XYZ_TO_DISPLAY_P3_D65, XYZ_TO_SRGB_D65,
    multiply_matrix_vec3, srgb_eotf, srgb_oetf,
};
use crate::node::Color;
use crate::tokens::errors::ExprError;

/// Replace non-finite f64 values with 0.0.
///
/// This is used internally to guard every input against NaN/Infinity.
fn finite_or_zero(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

/// Clamp a value to \[0.0, 1.0\].
fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// Convert sRGB channels (0-1) to HSL.
///
/// Returns `(h, s, l)` where h is in \[0, 360), s in \[0, 1\], l in \[0, 1\].
///
/// Non-finite inputs are treated as 0.0.
#[must_use]
#[allow(clippy::many_single_char_names)] // r, g, b, h, s, l are standard color math names
pub fn srgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let r = finite_or_zero(r);
    let g = finite_or_zero(g);
    let b = finite_or_zero(b);

    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    #[allow(clippy::manual_midpoint)] // RF-012: explicit for clarity; values in 0-1 range
    let l = (max + min) / 2.0;
    let delta = max - min;

    if delta < f64::EPSILON {
        // Achromatic (gray) — hue is undefined, set to 0.
        return (0.0, 0.0, l);
    }

    let s = if l <= 0.5 {
        delta / (max + min)
    } else {
        delta / (2.0 - max - min)
    };

    let mut h = if (max - r).abs() < f64::EPSILON {
        (g - b) / delta + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    };

    h *= 60.0;

    // Ensure h is in [0, 360)
    h = h.rem_euclid(360.0);

    (h, s, l)
}

/// Convert HSL to sRGB channels (0-1).
///
/// `h` is in degrees \[0, 360), `s` and `l` are in \[0, 1\].
///
/// Non-finite inputs are treated as 0.0.
#[must_use]
#[allow(clippy::many_single_char_names)] // h, s, l, r, g, b are standard color math names
pub fn hsl_to_srgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    let h = finite_or_zero(h);
    let s = finite_or_zero(s);
    let l = finite_or_zero(l);

    if s < f64::EPSILON {
        // Achromatic
        return (l, l, l);
    }

    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;

    // Normalize hue to [0, 1]
    let h_norm = h.rem_euclid(360.0) / 360.0;

    let r = hue_to_rgb(p, q, h_norm + 1.0 / 3.0);
    let g = hue_to_rgb(p, q, h_norm);
    let b = hue_to_rgb(p, q, h_norm - 1.0 / 3.0);

    (r, g, b)
}

/// Helper: convert a hue sector to an RGB channel value.
fn hue_to_rgb(p: f64, q: f64, mut t: f64) -> f64 {
    if t < 0.0 {
        t += 1.0;
    }
    if t > 1.0 {
        t -= 1.0;
    }
    if t < 1.0 / 6.0 {
        return p + (q - p) * 6.0 * t;
    }
    if t < 1.0 / 2.0 {
        return q;
    }
    if t < 2.0 / 3.0 {
        return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    }
    p
}

/// Display-P3 → sRGB through CIE XYZ (D65). Both legs use the sRGB transfer
/// function pair. Output channels are unclamped — values outside `[0, 1]`
/// signal that the source P3 color is out of sRGB gamut.
#[must_use]
pub fn display_p3_to_srgb(r: f64, g: f64, b: f64) -> [f64; 3] {
    let linear_p3 = [srgb_eotf(r), srgb_eotf(g), srgb_eotf(b)];
    let xyz = multiply_matrix_vec3(&DISPLAY_P3_TO_XYZ_D65, linear_p3);
    let linear_srgb = multiply_matrix_vec3(&XYZ_TO_SRGB_D65, xyz);
    [
        srgb_oetf(linear_srgb[0]),
        srgb_oetf(linear_srgb[1]),
        srgb_oetf(linear_srgb[2]),
    ]
}

/// sRGB → Display-P3 through CIE XYZ (D65). Inverse of `display_p3_to_srgb`.
///
/// Introduced in Plan 18 Task 5 alongside `display_p3_to_srgb` so the pair
/// is in place for later Plan 18 tasks (`HexInput` P3 badge — Task 10,
/// `colorToCss` — Task 11, wide-gamut canvas helpers — Task 12). Exercised
/// by `test_srgb_to_display_p3_red_matches_w3c_reference` below.
#[must_use]
#[allow(dead_code)] // consumed by Plan 18 Tasks 10, 11, 12
pub fn srgb_to_display_p3(r: f64, g: f64, b: f64) -> [f64; 3] {
    let linear_srgb = [srgb_eotf(r), srgb_eotf(g), srgb_eotf(b)];
    let xyz = multiply_matrix_vec3(&SRGB_TO_XYZ_D65, linear_srgb);
    let linear_p3 = multiply_matrix_vec3(&XYZ_TO_DISPLAY_P3_D65, xyz);
    [
        srgb_oetf(linear_p3[0]),
        srgb_oetf(linear_p3[1]),
        srgb_oetf(linear_p3[2]),
    ]
}

/// Return `true` if any sRGB channel would fall outside `[0, 1]` (with a
/// small floating-point epsilon) when the color is converted to sRGB.
///
/// Introduced in Plan 18 Task 5 for use by the `HexInput` P3 badge (Task 10)
/// and the wide-gamut canvas plumbing (Task 12). Exercised by
/// `test_is_out_of_srgb_gamut_p3_red` / `test_is_out_of_srgb_gamut_p3_gray`.
#[must_use]
#[allow(dead_code)] // consumed by Plan 18 Tasks 10, 12
pub fn is_out_of_srgb_gamut(color: &Color) -> bool {
    const EPS: f64 = 1e-7;
    let in_range = -EPS..=1.0 + EPS;
    match color {
        Color::Srgb { r, g, b, .. } => {
            !in_range.contains(r) || !in_range.contains(g) || !in_range.contains(b)
        }
        Color::DisplayP3 { r, g, b, .. } => {
            let [rs, gs, bs] =
                display_p3_to_srgb(finite_or_zero(*r), finite_or_zero(*g), finite_or_zero(*b));
            !in_range.contains(&rs) || !in_range.contains(&gs) || !in_range.contains(&bs)
        }
        Color::Oklch { .. } | Color::Oklab { .. } => false,
    }
}

/// Extract sRGB channels from a `Color` enum, applying proper Display-P3 →
/// sRGB matrix conversion when needed.
///
/// Output channels for `DisplayP3` colors are unclamped — values outside
/// `[0, 1]` signal that the source P3 color is out of sRGB gamut.
///
/// Returns `Ok((r, g, b, a))` with NaN/Infinity values normalized to 0.0.
///
/// # Errors
///
/// Returns `ExprError::DomainError` for `Oklch` and `Oklab` color spaces;
/// those conversions are still deferred.
pub fn color_to_srgb(color: &Color) -> Result<(f64, f64, f64, f64), ExprError> {
    match color {
        Color::Srgb { r, g, b, a } => Ok((
            finite_or_zero(*r),
            finite_or_zero(*g),
            finite_or_zero(*b),
            finite_or_zero(*a),
        )),
        Color::DisplayP3 { r, g, b, a } => {
            let [rs, gs, bs] =
                display_p3_to_srgb(finite_or_zero(*r), finite_or_zero(*g), finite_or_zero(*b));
            Ok((rs, gs, bs, finite_or_zero(*a)))
        }
        Color::Oklch { .. } => Err(ExprError::DomainError(
            "color function requires sRGB color; Oklch conversion not yet implemented".to_string(),
        )),
        Color::Oklab { .. } => Err(ExprError::DomainError(
            "color function requires sRGB color; Oklab conversion not yet implemented".to_string(),
        )),
    }
}

/// Create an sRGB `Color` from channels.
///
/// Clamps all channels to \[0.0, 1.0\]. Non-finite inputs are treated as 0.0.
#[must_use]
pub fn srgb_to_color(r: f64, g: f64, b: f64, a: f64) -> Color {
    Color::Srgb {
        r: clamp01(finite_or_zero(r)),
        g: clamp01(finite_or_zero(g)),
        b: clamp01(finite_or_zero(b)),
        a: clamp01(finite_or_zero(a)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tolerance for floating-point comparison in round-trip tests.
    const EPSILON: f64 = 1e-10;

    fn assert_approx(a: f64, b: f64, label: &str) {
        assert!(
            (a - b).abs() < EPSILON,
            "{label}: expected {b}, got {a} (diff {})",
            (a - b).abs()
        );
    }

    // ── Round-trip tests ──────────────────────────────────────────────

    #[test]
    fn test_srgb_to_hsl_round_trip_pure_red() {
        let (h, s, l) = srgb_to_hsl(1.0, 0.0, 0.0);
        let (r, g, b) = hsl_to_srgb(h, s, l);
        assert_approx(r, 1.0, "red r");
        assert_approx(g, 0.0, "red g");
        assert_approx(b, 0.0, "red b");
    }

    #[test]
    fn test_srgb_to_hsl_round_trip_pure_green() {
        let (h, s, l) = srgb_to_hsl(0.0, 1.0, 0.0);
        let (r, g, b) = hsl_to_srgb(h, s, l);
        assert_approx(r, 0.0, "green r");
        assert_approx(g, 1.0, "green g");
        assert_approx(b, 0.0, "green b");
    }

    #[test]
    fn test_srgb_to_hsl_round_trip_pure_blue() {
        let (h, s, l) = srgb_to_hsl(0.0, 0.0, 1.0);
        let (r, g, b) = hsl_to_srgb(h, s, l);
        assert_approx(r, 0.0, "blue r");
        assert_approx(g, 0.0, "blue g");
        assert_approx(b, 1.0, "blue b");
    }

    #[test]
    fn test_srgb_to_hsl_round_trip_arbitrary_color() {
        let (h, s, l) = srgb_to_hsl(0.3, 0.6, 0.9);
        let (r, g, b) = hsl_to_srgb(h, s, l);
        assert_approx(r, 0.3, "arb r");
        assert_approx(g, 0.6, "arb g");
        assert_approx(b, 0.9, "arb b");
    }

    // ── Known values ─────────────────────────────────────────────────

    #[test]
    fn test_srgb_to_hsl_red_is_zero_degrees() {
        let (h, s, l) = srgb_to_hsl(1.0, 0.0, 0.0);
        assert_approx(h, 0.0, "red hue");
        assert_approx(s, 1.0, "red saturation");
        assert_approx(l, 0.5, "red lightness");
    }

    #[test]
    fn test_srgb_to_hsl_green_is_120_degrees() {
        let (h, s, l) = srgb_to_hsl(0.0, 1.0, 0.0);
        assert_approx(h, 120.0, "green hue");
        assert_approx(s, 1.0, "green saturation");
        assert_approx(l, 0.5, "green lightness");
    }

    #[test]
    fn test_srgb_to_hsl_blue_is_240_degrees() {
        let (h, s, l) = srgb_to_hsl(0.0, 0.0, 1.0);
        assert_approx(h, 240.0, "blue hue");
        assert_approx(s, 1.0, "blue saturation");
        assert_approx(l, 0.5, "blue lightness");
    }

    #[test]
    fn test_srgb_to_hsl_yellow_is_60_degrees() {
        let (h, s, l) = srgb_to_hsl(1.0, 1.0, 0.0);
        assert_approx(h, 60.0, "yellow hue");
        assert_approx(s, 1.0, "yellow saturation");
        assert_approx(l, 0.5, "yellow lightness");
    }

    #[test]
    fn test_srgb_to_hsl_cyan_is_180_degrees() {
        let (h, s, l) = srgb_to_hsl(0.0, 1.0, 1.0);
        assert_approx(h, 180.0, "cyan hue");
        assert_approx(s, 1.0, "cyan saturation");
        assert_approx(l, 0.5, "cyan lightness");
    }

    #[test]
    fn test_srgb_to_hsl_magenta_is_300_degrees() {
        let (h, s, l) = srgb_to_hsl(1.0, 0.0, 1.0);
        assert_approx(h, 300.0, "magenta hue");
        assert_approx(s, 1.0, "magenta saturation");
        assert_approx(l, 0.5, "magenta lightness");
    }

    // ── Edge cases ───────────────────────────────────────────────────

    #[test]
    fn test_srgb_to_hsl_black_has_zero_lightness() {
        let (h, s, l) = srgb_to_hsl(0.0, 0.0, 0.0);
        assert_approx(h, 0.0, "black hue");
        assert_approx(s, 0.0, "black saturation");
        assert_approx(l, 0.0, "black lightness");
    }

    #[test]
    fn test_srgb_to_hsl_white_has_full_lightness() {
        let (h, s, l) = srgb_to_hsl(1.0, 1.0, 1.0);
        assert_approx(h, 0.0, "white hue");
        assert_approx(s, 0.0, "white saturation");
        assert_approx(l, 1.0, "white lightness");
    }

    #[test]
    fn test_srgb_to_hsl_gray_has_zero_saturation() {
        let (h, s, l) = srgb_to_hsl(0.5, 0.5, 0.5);
        assert_approx(h, 0.0, "gray hue");
        assert_approx(s, 0.0, "gray saturation");
        assert_approx(l, 0.5, "gray lightness");
    }

    #[test]
    fn test_hsl_to_srgb_achromatic_gray() {
        let (r, g, b) = hsl_to_srgb(0.0, 0.0, 0.5);
        assert_approx(r, 0.5, "gray r");
        assert_approx(g, 0.5, "gray g");
        assert_approx(b, 0.5, "gray b");
    }

    // ── NaN/Infinity guard tests ─────────────────────────────────────

    #[test]
    fn test_srgb_to_hsl_nan_input_produces_finite_output() {
        let (h, s, l) = srgb_to_hsl(f64::NAN, f64::NAN, f64::NAN);
        assert!(h.is_finite(), "h should be finite");
        assert!(s.is_finite(), "s should be finite");
        assert!(l.is_finite(), "l should be finite");
    }

    #[test]
    fn test_hsl_to_srgb_nan_input_produces_finite_output() {
        let (r, g, b) = hsl_to_srgb(f64::NAN, f64::NAN, f64::NAN);
        assert!(r.is_finite(), "r should be finite");
        assert!(g.is_finite(), "g should be finite");
        assert!(b.is_finite(), "b should be finite");
    }

    #[test]
    fn test_srgb_to_hsl_infinity_input_produces_finite_output() {
        let (h, s, l) = srgb_to_hsl(f64::INFINITY, f64::NEG_INFINITY, 0.5);
        assert!(h.is_finite(), "h should be finite");
        assert!(s.is_finite(), "s should be finite");
        assert!(l.is_finite(), "l should be finite");
    }

    #[test]
    fn test_hsl_to_srgb_infinity_input_produces_finite_output() {
        let (r, g, b) = hsl_to_srgb(f64::INFINITY, 0.5, 0.5);
        assert!(r.is_finite(), "r should be finite");
        assert!(g.is_finite(), "g should be finite");
        assert!(b.is_finite(), "b should be finite");
    }

    // ── color_to_srgb tests ──────────────────────────────────────────

    #[test]
    fn test_color_to_srgb_extracts_srgb_channels() {
        let color = Color::Srgb {
            r: 0.2,
            g: 0.4,
            b: 0.6,
            a: 0.8,
        };
        let (r, g, b, a) = color_to_srgb(&color).expect("sRGB should succeed");
        assert_approx(r, 0.2, "r");
        assert_approx(g, 0.4, "g");
        assert_approx(b, 0.6, "b");
        assert_approx(a, 0.8, "a");
    }

    #[test]
    fn test_color_to_srgb_display_p3_red_matrix_converts() {
        // Replaces the passthrough test — P3 conversion now uses matrices.
        let color = Color::DisplayP3 {
            r: 1.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        };
        let (r, g, b, a) = color_to_srgb(&color).expect("DisplayP3 should succeed");
        assert!(
            r > 1.0,
            "P3 red should map to sRGB R > 1.0 (out of gamut), got {r}"
        );
        assert!(g < 0.0, "P3 red should map to sRGB G < 0.0, got {g}");
        assert!(b < 0.0, "P3 red should map to sRGB B < 0.0, got {b}");
        assert!((a - 1.0).abs() < 1e-12);
    }

    // ── Display-P3 conversion (spec-18) ─────────────────────────────────

    #[test]
    fn test_color_to_srgb_display_p3_red_matches_w3c_reference() {
        let p3_red = Color::DisplayP3 {
            r: 1.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        };
        let (r, g, b, _a) = color_to_srgb(&p3_red).expect("P3 conversion succeeds");
        assert!(
            r > 1.0,
            "P3 red R should be > 1.0 (out of sRGB gamut), got {r}"
        );
        assert!(g < 0.0, "P3 red G should be < 0.0, got {g}");
        assert!(b < 0.0, "P3 red B should be < 0.0, got {b}");
    }

    #[test]
    fn test_color_to_srgb_display_p3_gray_in_gamut() {
        let p3_gray = Color::DisplayP3 {
            r: 0.5,
            g: 0.5,
            b: 0.5,
            a: 1.0,
        };
        let (r, g, b, _a) = color_to_srgb(&p3_gray).expect("P3 gray conversion succeeds");
        assert!((r - 0.5).abs() < 1e-6, "expected r≈0.5, got {r}");
        assert!((g - 0.5).abs() < 1e-6, "expected g≈0.5, got {g}");
        assert!((b - 0.5).abs() < 1e-6, "expected b≈0.5, got {b}");
    }

    #[test]
    fn test_srgb_to_display_p3_red_matches_w3c_reference() {
        let [r, g, b] = srgb_to_display_p3(1.0, 0.0, 0.0);
        assert!(r > 0.9 && r < 1.0, "expected P3 R in (0.9, 1.0), got {r}");
        assert!(g > 0.1, "expected P3 G > 0.1, got {g}");
        assert!(b > 0.1, "expected P3 B > 0.1, got {b}");
    }

    #[test]
    fn test_is_out_of_srgb_gamut_p3_red() {
        let p3_red = Color::DisplayP3 {
            r: 1.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        };
        assert!(is_out_of_srgb_gamut(&p3_red));
    }

    #[test]
    fn test_is_out_of_srgb_gamut_p3_gray() {
        let p3_gray = Color::DisplayP3 {
            r: 0.5,
            g: 0.5,
            b: 0.5,
            a: 1.0,
        };
        assert!(!is_out_of_srgb_gamut(&p3_gray));
    }

    #[test]
    fn test_color_to_srgb_guards_nan_channels() {
        let color = Color::Srgb {
            r: f64::NAN,
            g: 0.5,
            b: f64::INFINITY,
            a: 1.0,
        };
        let (r, g, b, a) = color_to_srgb(&color).expect("sRGB should succeed");
        assert_approx(r, 0.0, "NaN r -> 0");
        assert_approx(g, 0.5, "g unchanged");
        assert_approx(b, 0.0, "Inf b -> 0");
        assert_approx(a, 1.0, "a unchanged");
    }

    #[test]
    fn test_color_to_srgb_rejects_oklch() {
        let color = Color::Oklch {
            l: 0.5,
            c: 0.1,
            h: 120.0,
            a: 1.0,
        };
        let result = color_to_srgb(&color);
        assert!(result.is_err(), "Oklch should be rejected");
    }

    #[test]
    fn test_color_to_srgb_rejects_oklab() {
        let color = Color::Oklab {
            l: 0.5,
            a: 0.1,
            b: 0.2,
            alpha: 1.0,
        };
        let result = color_to_srgb(&color);
        assert!(result.is_err(), "Oklab should be rejected");
    }

    // ── srgb_to_color tests ──────────────────────────────────────────

    #[test]
    fn test_srgb_to_color_creates_valid_srgb_color() {
        let color = srgb_to_color(0.2, 0.4, 0.6, 0.8);
        assert_eq!(
            color,
            Color::Srgb {
                r: 0.2,
                g: 0.4,
                b: 0.6,
                a: 0.8,
            }
        );
    }

    #[test]
    fn test_srgb_to_color_clamps_out_of_range_channels() {
        let color = srgb_to_color(1.5, -0.3, 0.5, 2.0);
        assert_eq!(
            color,
            Color::Srgb {
                r: 1.0,
                g: 0.0,
                b: 0.5,
                a: 1.0,
            }
        );
    }

    #[test]
    fn test_srgb_to_color_handles_nan_input() {
        let color = srgb_to_color(f64::NAN, 0.5, f64::INFINITY, f64::NEG_INFINITY);
        assert_eq!(
            color,
            Color::Srgb {
                r: 0.0,
                g: 0.5,
                b: 0.0,
                a: 0.0,
            }
        );
    }
}
