// crates/core/src/tokens/functions/mod.rs

//! Function registry for the token expression engine.
//!
//! Dispatches function calls by name to their implementations.
//! The function set is fixed — no runtime registration needed.

pub mod blend;
// Color math uses standard single-char channel names: r, g, b, h, s, l, a.
#[allow(clippy::many_single_char_names)]
pub mod color;
pub(crate) mod helpers;
pub mod math;
pub mod size;

use super::errors::ExprError;
use super::evaluator::EvalValue;

/// Dispatch a function call by name.
///
/// # Errors
///
/// Returns `ExprError::UnknownFunction` if the name does not match any
/// registered function. Individual functions may return `ArityError`,
/// `TypeError`, or `DomainError`.
pub fn call_function(name: &str, args: &[EvalValue]) -> Result<EvalValue, ExprError> {
    match name {
        // Math
        "round" => math::fn_round(args),
        "ceil" => math::fn_ceil(args),
        "floor" => math::fn_floor(args),
        "abs" => math::fn_abs(args),
        "min" => math::fn_min(args),
        "max" => math::fn_max(args),
        "clamp" => math::fn_clamp(args),
        // Size
        "rem" => size::fn_rem(args),
        "em" => size::fn_em(args),
        "px" => size::fn_px(args),
        // Color
        "lighten" | "darken" | "saturate" | "desaturate" | "alpha" | "mix" | "contrast"
        | "complement" | "hue" | "setRed" | "setGreen" | "setBlue" | "setHue" | "setSaturation"
        | "setLightness" | "adjustRed" | "adjustGreen" | "adjustBlue" | "adjustHue"
        | "adjustSaturation" | "adjustLightness" | "red" | "green" | "blue" | "hueOf"
        | "saturationOf" | "lightnessOf" => color::dispatch_color(name, args),
        // Blend
        "blend" => blend::fn_blend(args),
        _ => Err(ExprError::UnknownFunction(name.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_call_function_unknown_returns_error() {
        let result = call_function("nonexistent", &[]);
        assert_eq!(
            result,
            Err(ExprError::UnknownFunction("nonexistent".to_string()))
        );
    }

    #[test]
    fn test_call_function_dispatches_math_round() {
        let result = call_function("round", &[EvalValue::Number(2.7)]);
        assert_eq!(result, Ok(EvalValue::Number(3.0)));
    }

    #[test]
    fn test_call_function_dispatches_size_rem() {
        let result = call_function("rem", &[EvalValue::Number(32.0)]);
        assert_eq!(result, Ok(EvalValue::Number(2.0)));
    }

    #[test]
    fn test_call_function_dispatches_color_function() {
        use crate::node::Color;
        let red = EvalValue::Color(Color::Srgb {
            r: 1.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        });
        let result = call_function("red", &[red]);
        assert_eq!(result, Ok(EvalValue::Number(255.0)));
    }
}
