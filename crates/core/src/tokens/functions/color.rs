// crates/core/src/tokens/functions/color.rs

//! Color manipulation functions for the token expression engine.
//!
//! Provides 27 color functions: manipulation (9), channel setters (6),
//! channel adjusters (6), and channel extractors (6).

use crate::tokens::color_convert::{color_to_srgb, hsl_to_srgb, srgb_to_color, srgb_to_hsl};
use crate::tokens::errors::ExprError;
use crate::tokens::evaluator::EvalValue;
use crate::tokens::functions::helpers::{check_arity, require_color, require_number};

/// Dispatch a color function call by name.
///
/// # Errors
///
/// Returns `ExprError::UnknownFunction` if the name does not match.
pub fn dispatch_color(name: &str, args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    match name {
        // Manipulation
        "lighten" => fn_lighten(args),
        "darken" => fn_darken(args),
        "saturate" => fn_saturate(args),
        "desaturate" => fn_desaturate(args),
        "alpha" => fn_alpha(args),
        "mix" => fn_mix(args),
        "contrast" => fn_contrast(args),
        "complement" => fn_complement(args),
        "hue" => fn_hue(args),
        // Channel setters
        "setRed" => fn_set_red(args),
        "setGreen" => fn_set_green(args),
        "setBlue" => fn_set_blue(args),
        "setHue" => fn_set_hue(args),
        "setSaturation" => fn_set_saturation(args),
        "setLightness" => fn_set_lightness(args),
        // Channel adjusters
        "adjustRed" => fn_adjust_red(args),
        "adjustGreen" => fn_adjust_green(args),
        "adjustBlue" => fn_adjust_blue(args),
        "adjustHue" => fn_adjust_hue(args),
        "adjustSaturation" => fn_adjust_saturation(args),
        "adjustLightness" => fn_adjust_lightness(args),
        // Channel extractors
        "red" => fn_red(args),
        "green" => fn_green(args),
        "blue" => fn_blue(args),
        "hueOf" => fn_hue_of(args),
        "saturationOf" => fn_saturation_of(args),
        "lightnessOf" => fn_lightness_of(args),
        _ => Err(ExprError::UnknownFunction(name.to_string())),
    }
}

// ── Color manipulation (9) ──────────────────────────────────────────

/// `lighten(color, amount)` -- increase lightness by amount (0-1).
fn fn_lighten(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "lighten")?;
    let color = require_color(args, 0, "lighten")?;
    let amount = require_number(args, 1, "lighten")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, l) = srgb_to_hsl(r, g, b);
    let new_l = (l + amount).clamp(0.0, 1.0);
    let (nr, ng, nb) = hsl_to_srgb(h, s, new_l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `darken(color, amount)` -- decrease lightness by amount (0-1).
fn fn_darken(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "darken")?;
    let color = require_color(args, 0, "darken")?;
    let amount = require_number(args, 1, "darken")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, l) = srgb_to_hsl(r, g, b);
    let new_l = (l - amount).clamp(0.0, 1.0);
    let (nr, ng, nb) = hsl_to_srgb(h, s, new_l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `saturate(color, amount)` -- increase saturation by amount (0-1).
fn fn_saturate(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "saturate")?;
    let color = require_color(args, 0, "saturate")?;
    let amount = require_number(args, 1, "saturate")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, l) = srgb_to_hsl(r, g, b);
    let new_s = (s + amount).clamp(0.0, 1.0);
    let (nr, ng, nb) = hsl_to_srgb(h, new_s, l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `desaturate(color, amount)` -- decrease saturation by amount (0-1).
fn fn_desaturate(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "desaturate")?;
    let color = require_color(args, 0, "desaturate")?;
    let amount = require_number(args, 1, "desaturate")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, l) = srgb_to_hsl(r, g, b);
    let new_s = (s - amount).clamp(0.0, 1.0);
    let (nr, ng, nb) = hsl_to_srgb(h, new_s, l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `alpha(color, amount)` -- set the alpha channel directly (0-1).
fn fn_alpha(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "alpha")?;
    let color = require_color(args, 0, "alpha")?;
    let amount = require_number(args, 1, "alpha")?;
    let (r, g, b, _) = color_to_srgb(&color)?;
    Ok(EvalValue::Color(srgb_to_color(r, g, b, amount)))
}

/// `mix(c1, c2, weight)` -- linear interpolation between two colors.
///
/// `weight` is 0-1: 0 = all c1, 1 = all c2.
fn fn_mix(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 3, "mix")?;
    let c1 = require_color(args, 0, "mix")?;
    let c2 = require_color(args, 1, "mix")?;
    let weight = require_number(args, 2, "mix")?;
    let (r1, g1, b1, a1) = color_to_srgb(&c1)?;
    let (r2, g2, b2, a2) = color_to_srgb(&c2)?;
    let w = weight.clamp(0.0, 1.0);
    let inv = 1.0 - w;
    Ok(EvalValue::Color(srgb_to_color(
        r1 * inv + r2 * w,
        g1 * inv + g2 * w,
        b1 * inv + b2 * w,
        a1 * inv + a2 * w,
    )))
}

/// `contrast(color)` -- return black or white based on relative luminance.
///
/// Uses W3C relative luminance formula with sRGB linearization.
/// Returns black if luminance > 0.179 (W3C threshold for 4.5:1 contrast),
/// white otherwise.
fn fn_contrast(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    // sRGB linearization per W3C WCAG 2.0 relative luminance definition
    fn linearize(c: f64) -> f64 {
        if c <= 0.04045 {
            c / 12.92
        } else {
            // Domain guard: (c + 0.055) / 1.055 is always >= 0 for valid sRGB
            ((c + 0.055) / 1.055).powf(2.4)
        }
    }

    check_arity(args, 1, "contrast")?;
    let color = require_color(args, 0, "contrast")?;
    let (r, g, b, _) = color_to_srgb(&color)?;

    let luminance = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
    if luminance > 0.179 {
        // Light color -> return black for contrast
        Ok(EvalValue::Color(srgb_to_color(0.0, 0.0, 0.0, 1.0)))
    } else {
        // Dark color -> return white for contrast
        Ok(EvalValue::Color(srgb_to_color(1.0, 1.0, 1.0, 1.0)))
    }
}

/// `complement(color)` -- rotate hue by 180 degrees.
fn fn_complement(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "complement")?;
    let color = require_color(args, 0, "complement")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, l) = srgb_to_hsl(r, g, b);
    let new_h = (h + 180.0) % 360.0;
    let (nr, ng, nb) = hsl_to_srgb(new_h, s, l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `hue(color, degrees)` -- set hue to absolute value in degrees.
fn fn_hue(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "hue")?;
    let color = require_color(args, 0, "hue")?;
    let degrees = require_number(args, 1, "hue")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (_, s, l) = srgb_to_hsl(r, g, b);
    let new_h = degrees.rem_euclid(360.0);
    let (nr, ng, nb) = hsl_to_srgb(new_h, s, l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

// ── Channel setters (6) ─────────────────────────────────────────────

/// `setRed(color, value)` -- set red channel (value is 0-255).
fn fn_set_red(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "setRed")?;
    let color = require_color(args, 0, "setRed")?;
    let value = require_number(args, 1, "setRed")?;
    let (_, g, b, a) = color_to_srgb(&color)?;
    Ok(EvalValue::Color(srgb_to_color(value / 255.0, g, b, a)))
}

/// `setGreen(color, value)` -- set green channel (value is 0-255).
fn fn_set_green(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "setGreen")?;
    let color = require_color(args, 0, "setGreen")?;
    let value = require_number(args, 1, "setGreen")?;
    let (r, _, b, a) = color_to_srgb(&color)?;
    Ok(EvalValue::Color(srgb_to_color(r, value / 255.0, b, a)))
}

/// `setBlue(color, value)` -- set blue channel (value is 0-255).
fn fn_set_blue(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "setBlue")?;
    let color = require_color(args, 0, "setBlue")?;
    let value = require_number(args, 1, "setBlue")?;
    let (r, g, _, a) = color_to_srgb(&color)?;
    Ok(EvalValue::Color(srgb_to_color(r, g, value / 255.0, a)))
}

/// `setHue(color, degrees)` -- set hue in HSL space (degrees 0-360).
fn fn_set_hue(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "setHue")?;
    let color = require_color(args, 0, "setHue")?;
    let degrees = require_number(args, 1, "setHue")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (_, s, l) = srgb_to_hsl(r, g, b);
    let new_h = degrees.rem_euclid(360.0);
    let (nr, ng, nb) = hsl_to_srgb(new_h, s, l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `setSaturation(color, pct)` -- set saturation (pct 0-100).
fn fn_set_saturation(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "setSaturation")?;
    let color = require_color(args, 0, "setSaturation")?;
    let pct = require_number(args, 1, "setSaturation")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, _, l) = srgb_to_hsl(r, g, b);
    let new_s = (pct / 100.0).clamp(0.0, 1.0);
    let (nr, ng, nb) = hsl_to_srgb(h, new_s, l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `setLightness(color, pct)` -- set lightness (pct 0-100).
fn fn_set_lightness(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "setLightness")?;
    let color = require_color(args, 0, "setLightness")?;
    let pct = require_number(args, 1, "setLightness")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, _) = srgb_to_hsl(r, g, b);
    let new_l = (pct / 100.0).clamp(0.0, 1.0);
    let (nr, ng, nb) = hsl_to_srgb(h, s, new_l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

// ── Channel adjusters (6) ───────────────────────────────────────────

/// `adjustRed(color, delta)` -- add delta/255 to red channel.
fn fn_adjust_red(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "adjustRed")?;
    let color = require_color(args, 0, "adjustRed")?;
    let delta = require_number(args, 1, "adjustRed")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    Ok(EvalValue::Color(srgb_to_color(r + delta / 255.0, g, b, a)))
}

/// `adjustGreen(color, delta)` -- add delta/255 to green channel.
fn fn_adjust_green(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "adjustGreen")?;
    let color = require_color(args, 0, "adjustGreen")?;
    let delta = require_number(args, 1, "adjustGreen")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    Ok(EvalValue::Color(srgb_to_color(r, g + delta / 255.0, b, a)))
}

/// `adjustBlue(color, delta)` -- add delta/255 to blue channel.
fn fn_adjust_blue(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "adjustBlue")?;
    let color = require_color(args, 0, "adjustBlue")?;
    let delta = require_number(args, 1, "adjustBlue")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    Ok(EvalValue::Color(srgb_to_color(r, g, b + delta / 255.0, a)))
}

/// `adjustHue(color, delta)` -- add delta degrees to hue.
fn fn_adjust_hue(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "adjustHue")?;
    let color = require_color(args, 0, "adjustHue")?;
    let delta = require_number(args, 1, "adjustHue")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, l) = srgb_to_hsl(r, g, b);
    let new_h = (h + delta).rem_euclid(360.0);
    let (nr, ng, nb) = hsl_to_srgb(new_h, s, l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `adjustSaturation(color, delta)` -- add delta/100 to saturation.
fn fn_adjust_saturation(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "adjustSaturation")?;
    let color = require_color(args, 0, "adjustSaturation")?;
    let delta = require_number(args, 1, "adjustSaturation")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, l) = srgb_to_hsl(r, g, b);
    let new_s = (s + delta / 100.0).clamp(0.0, 1.0);
    let (nr, ng, nb) = hsl_to_srgb(h, new_s, l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

/// `adjustLightness(color, delta)` -- add delta/100 to lightness.
fn fn_adjust_lightness(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 2, "adjustLightness")?;
    let color = require_color(args, 0, "adjustLightness")?;
    let delta = require_number(args, 1, "adjustLightness")?;
    let (r, g, b, a) = color_to_srgb(&color)?;
    let (h, s, l) = srgb_to_hsl(r, g, b);
    let new_l = (l + delta / 100.0).clamp(0.0, 1.0);
    let (nr, ng, nb) = hsl_to_srgb(h, s, new_l);
    Ok(EvalValue::Color(srgb_to_color(nr, ng, nb, a)))
}

// ── Channel extractors (6) ──────────────────────────────────────────

/// `red(color)` -- extract red channel as 0-255.
fn fn_red(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "red")?;
    let color = require_color(args, 0, "red")?;
    let (r, _, _, _) = color_to_srgb(&color)?;
    Ok(EvalValue::Number(r * 255.0))
}

/// `green(color)` -- extract green channel as 0-255.
fn fn_green(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "green")?;
    let color = require_color(args, 0, "green")?;
    let (_, g, _, _) = color_to_srgb(&color)?;
    Ok(EvalValue::Number(g * 255.0))
}

/// `blue(color)` -- extract blue channel as 0-255.
fn fn_blue(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "blue")?;
    let color = require_color(args, 0, "blue")?;
    let (_, _, b, _) = color_to_srgb(&color)?;
    Ok(EvalValue::Number(b * 255.0))
}

/// `hueOf(color)` -- extract hue as 0-360.
fn fn_hue_of(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "hueOf")?;
    let color = require_color(args, 0, "hueOf")?;
    let (r, g, b, _) = color_to_srgb(&color)?;
    let (h, _, _) = srgb_to_hsl(r, g, b);
    Ok(EvalValue::Number(h))
}

/// `saturationOf(color)` -- extract saturation as 0-100.
fn fn_saturation_of(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "saturationOf")?;
    let color = require_color(args, 0, "saturationOf")?;
    let (r, g, b, _) = color_to_srgb(&color)?;
    let (_, s, _) = srgb_to_hsl(r, g, b);
    Ok(EvalValue::Number(s * 100.0))
}

/// `lightnessOf(color)` -- extract lightness as 0-100.
fn fn_lightness_of(args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    check_arity(args, 1, "lightnessOf")?;
    let color = require_color(args, 0, "lightnessOf")?;
    let (r, g, b, _) = color_to_srgb(&color)?;
    let (_, _, l) = srgb_to_hsl(r, g, b);
    Ok(EvalValue::Number(l * 100.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::Color;

    /// Tolerance for floating-point comparison.
    const EPSILON: f64 = 1e-6;

    fn assert_approx(a: f64, b: f64, label: &str) {
        assert!(
            (a - b).abs() < EPSILON,
            "{label}: expected {b}, got {a} (diff {})",
            (a - b).abs()
        );
    }

    fn srgb(r: f64, g: f64, b: f64) -> Color {
        Color::Srgb { r, g, b, a: 1.0 }
    }

    fn srgba(r: f64, g: f64, b: f64, a: f64) -> Color {
        Color::Srgb { r, g, b, a }
    }

    fn color_val(r: f64, g: f64, b: f64) -> EvalValue {
        EvalValue::Color(srgb(r, g, b))
    }

    fn num(n: f64) -> EvalValue {
        EvalValue::Number(n)
    }

    /// Extract sRGB channels from an `EvalValue::Color`.
    fn unwrap_color(v: &EvalValue) -> (f64, f64, f64, f64) {
        match v {
            EvalValue::Color(c) => color_to_srgb(c).expect("test color should be sRGB"),
            other => panic!("expected Color, got {other:?}"),
        }
    }

    // ── lighten / darken ────────────────────────────────────────────

    #[test]
    fn test_lighten_increases_lightness() {
        // Pure red (HSL 0, 100%, 50%) + 0.5 = (0, 100%, 100%) = white
        let result = fn_lighten(&[color_val(1.0, 0.0, 0.0), num(0.5)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 1.0, "lighten r");
        assert_approx(g, 1.0, "lighten g");
        assert_approx(b, 1.0, "lighten b");
    }

    #[test]
    fn test_darken_to_black() {
        // Pure red + darken by 0.5 = lightness 0 = black
        let result = fn_darken(&[color_val(1.0, 0.0, 0.0), num(0.5)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "darken r");
        assert_approx(g, 0.0, "darken g");
        assert_approx(b, 0.0, "darken b");
    }

    #[test]
    fn test_lighten_wrong_arity() {
        assert!(matches!(
            fn_lighten(&[color_val(1.0, 0.0, 0.0)]),
            Err(ExprError::ArityError { .. })
        ));
    }

    #[test]
    fn test_lighten_wrong_type() {
        assert!(matches!(
            fn_lighten(&[num(1.0), num(0.5)]),
            Err(ExprError::TypeError { .. })
        ));
    }

    // ── saturate / desaturate ───────────────────────────────────────

    #[test]
    fn test_desaturate_fully_produces_gray() {
        // Pure red, desaturate by 1.0 -> gray
        let result = fn_desaturate(&[color_val(1.0, 0.0, 0.0), num(1.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        // Gray at lightness 0.5 means all channels equal 0.5
        assert_approx(r, 0.5, "desat r");
        assert_approx(g, 0.5, "desat g");
        assert_approx(b, 0.5, "desat b");
    }

    #[test]
    fn test_saturate_wrong_arity() {
        assert!(matches!(
            fn_saturate(&[]),
            Err(ExprError::ArityError { .. })
        ));
    }

    // ── alpha ───────────────────────────────────────────────────────

    #[test]
    fn test_alpha_sets_alpha_channel() {
        let result = fn_alpha(&[color_val(1.0, 0.0, 0.0), num(0.5)]).expect("should succeed");
        let (_, _, _, a) = unwrap_color(&result);
        assert_approx(a, 0.5, "alpha");
    }

    // ── mix ─────────────────────────────────────────────────────────

    #[test]
    fn test_mix_weight_zero_returns_first_color() {
        let result = fn_mix(&[color_val(1.0, 0.0, 0.0), color_val(0.0, 0.0, 1.0), num(0.0)])
            .expect("should succeed");
        let (r, _, b, _) = unwrap_color(&result);
        assert_approx(r, 1.0, "mix w=0 r");
        assert_approx(b, 0.0, "mix w=0 b");
    }

    #[test]
    fn test_mix_weight_one_returns_second_color() {
        let result = fn_mix(&[color_val(1.0, 0.0, 0.0), color_val(0.0, 0.0, 1.0), num(1.0)])
            .expect("should succeed");
        let (r, _, b, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "mix w=1 r");
        assert_approx(b, 1.0, "mix w=1 b");
    }

    #[test]
    fn test_mix_weight_half_blends_equally() {
        let result = fn_mix(&[color_val(1.0, 0.0, 0.0), color_val(0.0, 0.0, 1.0), num(0.5)])
            .expect("should succeed");
        let (r, _, b, _) = unwrap_color(&result);
        assert_approx(r, 0.5, "mix w=0.5 r");
        assert_approx(b, 0.5, "mix w=0.5 b");
    }

    #[test]
    fn test_mix_wrong_arity() {
        assert!(matches!(
            fn_mix(&[color_val(1.0, 0.0, 0.0), color_val(0.0, 0.0, 1.0)]),
            Err(ExprError::ArityError { .. })
        ));
    }

    // ── contrast ────────────────────────────────────────────────────

    #[test]
    fn test_contrast_dark_color_returns_white() {
        // Black -> white
        let result = fn_contrast(&[color_val(0.0, 0.0, 0.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 1.0, "contrast dark r");
        assert_approx(g, 1.0, "contrast dark g");
        assert_approx(b, 1.0, "contrast dark b");
    }

    #[test]
    fn test_contrast_light_color_returns_black() {
        // White -> black
        let result = fn_contrast(&[color_val(1.0, 1.0, 1.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "contrast light r");
        assert_approx(g, 0.0, "contrast light g");
        assert_approx(b, 0.0, "contrast light b");
    }

    // ── complement ──────────────────────────────────────────────────

    #[test]
    fn test_complement_red_is_cyan() {
        // Red (hue 0) complement = cyan (hue 180)
        let result = fn_complement(&[color_val(1.0, 0.0, 0.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "complement r");
        assert_approx(g, 1.0, "complement g");
        assert_approx(b, 1.0, "complement b");
    }

    // ── hue ─────────────────────────────────────────────────────────

    #[test]
    fn test_hue_sets_absolute_hue() {
        // Red (hue 0), set to 120 = green
        let result = fn_hue(&[color_val(1.0, 0.0, 0.0), num(120.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "hue r");
        assert_approx(g, 1.0, "hue g");
        assert_approx(b, 0.0, "hue b");
    }

    // ── Channel setters ─────────────────────────────────────────────

    #[test]
    fn test_set_red_sets_channel() {
        let result = fn_set_red(&[color_val(0.0, 0.5, 0.5), num(255.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 1.0, "setRed r");
        assert_approx(g, 0.5, "setRed g");
        assert_approx(b, 0.5, "setRed b");
    }

    #[test]
    fn test_set_green_sets_channel() {
        let result = fn_set_green(&[color_val(0.5, 0.0, 0.5), num(128.0)]).expect("should succeed");
        let (_, g, _, _) = unwrap_color(&result);
        assert_approx(g, 128.0 / 255.0, "setGreen g");
    }

    #[test]
    fn test_set_blue_sets_channel() {
        let result = fn_set_blue(&[color_val(0.5, 0.5, 0.0), num(0.0)]).expect("should succeed");
        let (_, _, b, _) = unwrap_color(&result);
        assert_approx(b, 0.0, "setBlue b");
    }

    #[test]
    fn test_set_hue_sets_hue_in_hsl() {
        // Start with red (hue 0), set to 240 = blue
        let result = fn_set_hue(&[color_val(1.0, 0.0, 0.0), num(240.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "setHue r");
        assert_approx(g, 0.0, "setHue g");
        assert_approx(b, 1.0, "setHue b");
    }

    #[test]
    fn test_set_saturation_sets_saturation_in_hsl() {
        // Pure red (sat 100%), set to 0% -> gray
        let result =
            fn_set_saturation(&[color_val(1.0, 0.0, 0.0), num(0.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.5, "setSat r");
        assert_approx(g, 0.5, "setSat g");
        assert_approx(b, 0.5, "setSat b");
    }

    #[test]
    fn test_set_lightness_sets_lightness_in_hsl() {
        // Pure red (l=50%), set to 100% = white
        let result =
            fn_set_lightness(&[color_val(1.0, 0.0, 0.0), num(100.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 1.0, "setL r");
        assert_approx(g, 1.0, "setL g");
        assert_approx(b, 1.0, "setL b");
    }

    // ── Channel adjusters ───────────────────────────────────────────

    #[test]
    fn test_adjust_red_adds_delta() {
        // r=0.5 + 128/255 ~ 1.0 (clamped)
        let result =
            fn_adjust_red(&[color_val(0.5, 0.0, 0.0), num(128.0)]).expect("should succeed");
        let (r, _, _, _) = unwrap_color(&result);
        assert!(r > 0.5, "adjustRed should increase r");
    }

    #[test]
    fn test_adjust_green_adds_delta() {
        let result =
            fn_adjust_green(&[color_val(0.0, 0.0, 0.0), num(128.0)]).expect("should succeed");
        let (_, g, _, _) = unwrap_color(&result);
        assert_approx(g, 128.0 / 255.0, "adjustGreen g");
    }

    #[test]
    fn test_adjust_blue_adds_delta() {
        let result =
            fn_adjust_blue(&[color_val(0.0, 0.0, 0.0), num(255.0)]).expect("should succeed");
        let (_, _, b, _) = unwrap_color(&result);
        assert_approx(b, 1.0, "adjustBlue b");
    }

    #[test]
    fn test_adjust_hue_rotates_hue() {
        // Red (0 deg) + 120 = green
        let result =
            fn_adjust_hue(&[color_val(1.0, 0.0, 0.0), num(120.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 0.0, "adjustHue r");
        assert_approx(g, 1.0, "adjustHue g");
        assert_approx(b, 0.0, "adjustHue b");
    }

    #[test]
    fn test_adjust_saturation_adds_delta() {
        // Start with a color at 50% saturation, add 50 (percentage points)
        let color = srgb(0.75, 0.5, 0.25);
        let result =
            fn_adjust_saturation(&[EvalValue::Color(color), num(50.0)]).expect("should succeed");
        // Should be more saturated
        let _ = unwrap_color(&result);
    }

    #[test]
    fn test_adjust_lightness_adds_delta() {
        // Pure red at L=50%, add 50 -> L=100% = white
        let result =
            fn_adjust_lightness(&[color_val(1.0, 0.0, 0.0), num(50.0)]).expect("should succeed");
        let (r, g, b, _) = unwrap_color(&result);
        assert_approx(r, 1.0, "adjustL r");
        assert_approx(g, 1.0, "adjustL g");
        assert_approx(b, 1.0, "adjustL b");
    }

    // ── Channel extractors ──────────────────────────────────────────

    #[test]
    fn test_red_extracts_red_channel() {
        assert_eq!(fn_red(&[color_val(1.0, 0.0, 0.0)]), Ok(num(255.0)));
        assert_eq!(fn_red(&[color_val(0.5, 0.0, 0.0)]), Ok(num(127.5)));
    }

    #[test]
    fn test_green_extracts_green_channel() {
        assert_eq!(fn_green(&[color_val(0.0, 1.0, 0.0)]), Ok(num(255.0)));
    }

    #[test]
    fn test_blue_extracts_blue_channel() {
        assert_eq!(fn_blue(&[color_val(0.0, 0.0, 1.0)]), Ok(num(255.0)));
    }

    #[test]
    fn test_hue_of_extracts_hue() {
        // Pure green = 120 degrees
        let result = fn_hue_of(&[color_val(0.0, 1.0, 0.0)]).expect("should succeed");
        if let EvalValue::Number(h) = result {
            assert_approx(h, 120.0, "hueOf green");
        } else {
            panic!("expected number");
        }
    }

    #[test]
    fn test_saturation_of_extracts_saturation() {
        // Pure red = 100% saturation
        let result = fn_saturation_of(&[color_val(1.0, 0.0, 0.0)]).expect("should succeed");
        if let EvalValue::Number(s) = result {
            assert_approx(s, 100.0, "saturationOf red");
        } else {
            panic!("expected number");
        }
    }

    #[test]
    fn test_lightness_of_extracts_lightness() {
        // Pure red = 50% lightness
        let result = fn_lightness_of(&[color_val(1.0, 0.0, 0.0)]).expect("should succeed");
        if let EvalValue::Number(l) = result {
            assert_approx(l, 50.0, "lightnessOf red");
        } else {
            panic!("expected number");
        }
    }

    // ── Error cases for extractors ──────────────────────────────────

    #[test]
    fn test_red_wrong_arity() {
        assert!(matches!(fn_red(&[]), Err(ExprError::ArityError { .. })));
    }

    #[test]
    fn test_red_wrong_type() {
        assert!(matches!(
            fn_red(&[num(42.0)]),
            Err(ExprError::TypeError { .. })
        ));
    }

    // ── dispatch_color ──────────────────────────────────────────────

    #[test]
    fn test_dispatch_color_unknown_returns_error() {
        let result = dispatch_color("nonexistent", &[]);
        assert_eq!(
            result,
            Err(ExprError::UnknownFunction("nonexistent".to_string()))
        );
    }

    // ── alpha preserving ────────────────────────────────────────────

    #[test]
    fn test_lighten_preserves_alpha() {
        let color = EvalValue::Color(srgba(1.0, 0.0, 0.0, 0.5));
        let result = fn_lighten(&[color, num(0.1)]).expect("should succeed");
        let (_, _, _, a) = unwrap_color(&result);
        assert_approx(a, 0.5, "alpha preserved");
    }

    #[test]
    fn test_complement_preserves_alpha() {
        let color = EvalValue::Color(srgba(1.0, 0.0, 0.0, 0.3));
        let result = fn_complement(&[color]).expect("should succeed");
        let (_, _, _, a) = unwrap_color(&result);
        assert_approx(a, 0.3, "alpha preserved");
    }

    // ── non-finite guard ────────────────────────────────────────────

    #[test]
    fn test_color_function_rejects_nan_amount() {
        assert!(matches!(
            fn_lighten(&[color_val(1.0, 0.0, 0.0), num(f64::NAN)]),
            Err(ExprError::DomainError(_))
        ));
    }
}
