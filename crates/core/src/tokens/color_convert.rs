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

use crate::node::Color;

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
    let l = f64::midpoint(max, min);
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
    if h < 0.0 {
        h += 360.0;
    }
    if h >= 360.0 {
        h -= 360.0;
    }

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
    let h_norm = (h % 360.0) / 360.0;

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

/// Extract sRGB channels from a `Color` enum.
///
/// Non-sRGB color spaces are NOT converted; their channels are returned as-is,
/// treating them as an sRGB approximation.
///
/// Returns `(r, g, b, a)` with all values guarded against NaN/Infinity.
#[must_use]
pub fn color_to_srgb(color: &Color) -> (f64, f64, f64, f64) {
    match color {
        Color::Srgb { r, g, b, a } | Color::DisplayP3 { r, g, b, a } => (
            finite_or_zero(*r),
            finite_or_zero(*g),
            finite_or_zero(*b),
            finite_or_zero(*a),
        ),
        Color::Oklch { l, c, h, a } => {
            // Treat Oklch channels as-is (sRGB approximation)
            (
                finite_or_zero(*l),
                finite_or_zero(*c),
                finite_or_zero(*h),
                finite_or_zero(*a),
            )
        }
        Color::Oklab {
            l,
            a: a_ch,
            b,
            alpha,
        } => {
            // Treat Oklab channels as-is (sRGB approximation)
            (
                finite_or_zero(*l),
                finite_or_zero(*a_ch),
                finite_or_zero(*b),
                finite_or_zero(*alpha),
            )
        }
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
        let (r, g, b, a) = color_to_srgb(&color);
        assert_approx(r, 0.2, "r");
        assert_approx(g, 0.4, "g");
        assert_approx(b, 0.6, "b");
        assert_approx(a, 0.8, "a");
    }

    #[test]
    fn test_color_to_srgb_extracts_display_p3_channels() {
        let color = Color::DisplayP3 {
            r: 0.1,
            g: 0.3,
            b: 0.5,
            a: 1.0,
        };
        let (r, g, b, a) = color_to_srgb(&color);
        assert_approx(r, 0.1, "r");
        assert_approx(g, 0.3, "g");
        assert_approx(b, 0.5, "b");
        assert_approx(a, 1.0, "a");
    }

    #[test]
    fn test_color_to_srgb_guards_nan_channels() {
        let color = Color::Srgb {
            r: f64::NAN,
            g: 0.5,
            b: f64::INFINITY,
            a: 1.0,
        };
        let (r, g, b, a) = color_to_srgb(&color);
        assert_approx(r, 0.0, "NaN r → 0");
        assert_approx(g, 0.5, "g unchanged");
        assert_approx(b, 0.0, "Inf b → 0");
        assert_approx(a, 1.0, "a unchanged");
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
