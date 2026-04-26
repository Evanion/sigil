//! Shared corner-shorthand parsing used by GraphQL and MCP transports.
//!
//! Accepts three JSON shapes and expands them to the canonical
//! `[Corner; 4]` before handing off to `SetCorners::validate`.

use serde_json::Value;

use crate::CoreError;
use crate::node::{Corner, CornerRadii};
use crate::validate::{validate_radius_value, validate_smoothing};

/// Parses a GraphQL/MCP corners input blob into a canonical `[Corner; 4]`.
///
/// Accepted shapes:
///
/// 1. **Uniform shorthand** (object): `{ "shape": "<shape>", "radius": N }`
///    where `<shape>` is one of `round | bevel | notch | scoop`.
///    `smoothing` must NOT be present.
///
/// 2. **Shape-level superellipse** (object): `{ "shape": "superellipse", "smoothing": N, ... }`
///    with either `"radius": N` (uniform radius) or
///    `"radii": [{x,y}, {x,y}, {x,y}, {x,y}]` (per-corner radii).
///    Smoothing is required.
///
/// 3. **Full per-corner array**: `[{shape, radii: {x,y}}, ...]` with exactly 4 elements.
///    Superellipse is REJECTED in this form — use shape-level (#2) instead.
///
/// Returns the fully-expanded `[Corner; 4]`. Does NOT run cross-field validation
/// (superellipse uniformity, smoothing parity) — callers must invoke
/// `validate_corners` after construction.
///
/// # Errors
/// Returns `CoreError::ValidationError` when the input shape is malformed,
/// a shape name is unknown, or required fields are missing.
pub fn parse_corners_input(input: &Value) -> Result<[Corner; 4], CoreError> {
    match input {
        Value::Array(arr) => parse_per_corner_array(arr),
        Value::Object(_) => parse_shorthand_or_shape_level(input),
        _ => Err(CoreError::ValidationError(
            "corners input must be an object (shorthand) or array (per-corner)".to_string(),
        )),
    }
}

fn parse_shorthand_or_shape_level(obj: &Value) -> Result<[Corner; 4], CoreError> {
    let shape = obj
        .get("shape")
        .and_then(Value::as_str)
        .ok_or_else(|| CoreError::ValidationError("corners input missing 'shape' field".into()))?;

    if shape == "superellipse" {
        let smoothing = obj
            .get("smoothing")
            .and_then(Value::as_f64)
            .ok_or_else(|| {
                CoreError::ValidationError(
                    "superellipse shorthand requires 'smoothing' field".into(),
                )
            })?;
        validate_smoothing(smoothing)?;

        let radii_array = if let Some(r) = obj.get("radius") {
            let scalar = r
                .as_f64()
                .ok_or_else(|| CoreError::ValidationError("'radius' must be a number".into()))?;
            validate_radius_value(scalar, "radius")?;
            [CornerRadii::new(scalar, scalar)?; 4]
        } else if let Some(arr) = obj.get("radii").and_then(Value::as_array) {
            parse_radii_array(arr)?
        } else {
            return Err(CoreError::ValidationError(
                "superellipse shorthand requires either 'radius' or 'radii'".into(),
            ));
        };

        // smoothing already validated by `validate_smoothing` above; the
        // map below cannot fail.
        let mut corners = [Corner::round(CornerRadii::new(0.0, 0.0)?); 4];
        for (i, radii) in radii_array.iter().enumerate() {
            corners[i] = Corner::try_superellipse(*radii, smoothing)?;
        }
        Ok(corners)
    } else {
        if obj.get("smoothing").is_some() {
            return Err(CoreError::ValidationError(format!(
                "'smoothing' is only valid on superellipse shape, not '{shape}'"
            )));
        }
        let radius = obj.get("radius").and_then(Value::as_f64).ok_or_else(|| {
            CoreError::ValidationError("uniform shorthand requires 'radius' field".into())
        })?;
        validate_radius_value(radius, "radius")?;
        let radii = CornerRadii::new(radius, radius)?;
        let corner = build_non_superellipse_corner(shape, radii)?;
        Ok([corner; 4])
    }
}

fn parse_per_corner_array(arr: &[Value]) -> Result<[Corner; 4], CoreError> {
    if arr.len() != 4 {
        return Err(CoreError::ValidationError(format!(
            "per-corner array requires exactly 4 elements, got {}",
            arr.len()
        )));
    }
    let mut out: [Corner; 4] = [Corner::round(CornerRadii::new(0.0, 0.0)?); 4];
    for (i, entry) in arr.iter().enumerate() {
        let shape = entry.get("shape").and_then(Value::as_str).ok_or_else(|| {
            CoreError::ValidationError(format!("corners[{i}] missing 'shape' field"))
        })?;
        if shape == "superellipse" {
            return Err(CoreError::ValidationError(
                "superellipse cannot be used in the per-corner array form — \
                 use the shape-level form instead: \
                 { \"shape\": \"superellipse\", \"smoothing\": N, \"radii\": [...] }"
                    .into(),
            ));
        }
        // Reject stray `smoothing` on non-superellipse per-corner entries —
        // smoothing only applies to superellipse, and per the spec superellipse
        // must use the shape-level form. Silently dropping the field would mask
        // a malformed input.
        if entry.get("smoothing").is_some() {
            return Err(CoreError::ValidationError(format!(
                "corners[{i}]: 'smoothing' is only valid on superellipse shape, not '{shape}'"
            )));
        }
        let radii_obj = entry.get("radii").ok_or_else(|| {
            CoreError::ValidationError(format!("corners[{i}] missing 'radii' field"))
        })?;
        let radii = parse_single_radii(radii_obj)?;
        out[i] = build_non_superellipse_corner(shape, radii)?;
    }
    Ok(out)
}

fn parse_radii_array(arr: &[Value]) -> Result<[CornerRadii; 4], CoreError> {
    if arr.len() != 4 {
        return Err(CoreError::ValidationError(format!(
            "'radii' array must have exactly 4 entries, got {}",
            arr.len()
        )));
    }
    Ok([
        parse_single_radii(&arr[0])?,
        parse_single_radii(&arr[1])?,
        parse_single_radii(&arr[2])?,
        parse_single_radii(&arr[3])?,
    ])
}

fn parse_single_radii(v: &Value) -> Result<CornerRadii, CoreError> {
    let x = v
        .get("x")
        .and_then(Value::as_f64)
        .ok_or_else(|| CoreError::ValidationError("radii entry missing 'x'".into()))?;
    validate_radius_value(x, "radii.x")?;
    let y = v
        .get("y")
        .and_then(Value::as_f64)
        .ok_or_else(|| CoreError::ValidationError("radii entry missing 'y'".into()))?;
    validate_radius_value(y, "radii.y")?;
    CornerRadii::new(x, y)
}

fn build_non_superellipse_corner(shape: &str, radii: CornerRadii) -> Result<Corner, CoreError> {
    match shape {
        "round" => Ok(Corner::round(radii)),
        "bevel" => Ok(Corner::bevel(radii)),
        "notch" => Ok(Corner::notch(radii)),
        "scoop" => Ok(Corner::scoop(radii)),
        "superellipse" => Err(CoreError::ValidationError(
            "superellipse must be constructed via the shape-level form".into(),
        )),
        other => Err(CoreError::ValidationError(format!(
            "unknown corner shape '{other}' — valid shapes are round, bevel, notch, scoop, superellipse"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_uniform_shorthand_scalar_radius() {
        let input = json!({ "shape": "round", "radius": 8 });
        let corners = parse_corners_input(&input).expect("parse");
        for c in corners.iter() {
            assert!(matches!(
                c,
                Corner::Round {
                    radii: CornerRadii { x: 8.0, y: 8.0 }
                }
            ));
        }
    }

    #[test]
    fn test_uniform_shorthand_accepts_bevel() {
        let input = json!({ "shape": "bevel", "radius": 12 });
        let corners = parse_corners_input(&input).expect("parse");
        assert!(corners.iter().all(|c| matches!(c, Corner::Bevel { .. })));
    }

    #[test]
    fn test_uniform_shorthand_rejects_smoothing_on_non_superellipse() {
        let input = json!({ "shape": "round", "radius": 8, "smoothing": 0.5 });
        assert!(parse_corners_input(&input).is_err());
    }

    #[test]
    fn test_shape_level_superellipse_with_scalar_radius() {
        let input = json!({ "shape": "superellipse", "radius": 8, "smoothing": 0.6 });
        let corners = parse_corners_input(&input).expect("parse");
        for c in corners.iter() {
            match c {
                Corner::Superellipse { radii, smoothing } => {
                    assert_eq!(*smoothing, 0.6);
                    assert_eq!(*radii, CornerRadii { x: 8.0, y: 8.0 });
                }
                _ => panic!("expected Superellipse"),
            }
        }
    }

    #[test]
    fn test_shape_level_superellipse_with_per_corner_radii() {
        let input = json!({
            "shape": "superellipse",
            "smoothing": 0.6,
            "radii": [
                { "x": 8, "y": 8 },
                { "x": 12, "y": 12 },
                { "x": 12, "y": 12 },
                { "x": 8, "y": 8 }
            ]
        });
        let corners = parse_corners_input(&input).expect("parse");
        assert!(
            corners
                .iter()
                .all(|c| matches!(c, Corner::Superellipse { .. }))
        );
        assert_eq!(corners[1].radii(), CornerRadii { x: 12.0, y: 12.0 });
    }

    #[test]
    fn test_shape_level_superellipse_requires_smoothing() {
        let input = json!({ "shape": "superellipse", "radius": 8 });
        assert!(parse_corners_input(&input).is_err());
    }

    #[test]
    fn test_full_per_corner_array() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "bevel", "radii": { "x": 8, "y": 8 } },
            { "shape": "notch", "radii": { "x": 12, "y": 12 } },
            { "shape": "scoop", "radii": { "x": 16, "y": 16 } }
        ]);
        let corners = parse_corners_input(&input).expect("parse");
        assert!(matches!(corners[0], Corner::Round { .. }));
        assert!(matches!(corners[1], Corner::Bevel { .. }));
        assert!(matches!(corners[2], Corner::Notch { .. }));
        assert!(matches!(corners[3], Corner::Scoop { .. }));
    }

    #[test]
    fn test_full_per_corner_array_rejects_superellipse() {
        let input = json!([
            { "shape": "superellipse", "radii": { "x": 8, "y": 8 }, "smoothing": 0.5 },
            { "shape": "superellipse", "radii": { "x": 8, "y": 8 }, "smoothing": 0.5 },
            { "shape": "superellipse", "radii": { "x": 8, "y": 8 }, "smoothing": 0.5 },
            { "shape": "superellipse", "radii": { "x": 8, "y": 8 }, "smoothing": 0.5 }
        ]);
        let err = parse_corners_input(&input).expect_err("expected rejection");
        assert!(format!("{err}").contains("use the shape-level form"));
    }

    #[test]
    fn test_full_per_corner_array_requires_exactly_four() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "round", "radii": { "x": 4, "y": 4 } }
        ]);
        assert!(parse_corners_input(&input).is_err());
    }

    #[test]
    fn test_full_per_corner_array_accepts_axis_asymmetric() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 8 } },
            { "shape": "round", "radii": { "x": 4, "y": 8 } },
            { "shape": "round", "radii": { "x": 4, "y": 8 } },
            { "shape": "round", "radii": { "x": 4, "y": 8 } }
        ]);
        let corners = parse_corners_input(&input).expect("parse");
        assert_eq!(corners[0].radii(), CornerRadii { x: 4.0, y: 8.0 });
    }

    #[test]
    fn test_rejects_unknown_shape() {
        let input = json!({ "shape": "triangle", "radius": 8 });
        assert!(parse_corners_input(&input).is_err());
    }

    // ── Parser-boundary radius guards (M2) ────────────────────────────
    //
    // Note on NaN/Infinity in serde_json: The `json!` macro serializes Rust
    // `f64::NAN` and `f64::INFINITY` to JSON `null` (since they are not valid
    // JSON numbers). `as_f64()` returns `None` for null, so the `ok_or_else`
    // path fires with a "missing field" error — not the `validate_radius_value`
    // "finite" error. To test `validate_radius_value` directly with NaN/Infinity
    // we construct `serde_json::Value` objects manually using
    // `serde_json::Number::from_f64` which returns `None` for non-finite
    // values; therefore we inject them through `Value::from(f64)` via the
    // arbitrary_precision feature path or simply call `validate_radius_value`
    // directly in a unit test. The integration tests below use values that
    // exercise the actual boundary conditions reachable from JSON input.

    #[test]
    fn test_parse_corners_input_rejects_nan_radius() {
        // serde_json::Number cannot represent NaN, so we test validate_radius_value
        // directly for the NaN case.
        let err = crate::validate::validate_radius_value(f64::NAN, "radii.x")
            .expect_err("expected rejection for NaN radius");
        assert!(
            format!("{err}").contains("finite"),
            "error message must mention 'finite', got: {err}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_infinity_radius() {
        // Verify validate_radius_value rejects Infinity directly.
        let err = crate::validate::validate_radius_value(f64::INFINITY, "radius")
            .expect_err("expected rejection for Infinity radius");
        assert!(
            format!("{err}").contains("finite"),
            "error message must mention 'finite', got: {err}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_negative_radius() {
        // Uniform shorthand form — scalar radius is negative.
        let input = json!({ "shape": "round", "radius": -1.0 });
        let err = parse_corners_input(&input).expect_err("expected rejection for negative radius");
        assert!(
            format!("{err}").contains("non-negative"),
            "error message must mention 'non-negative', got: {err}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_radius_above_max() {
        // Uniform shorthand form — scalar radius above MAX_CORNER_RADIUS.
        let input = json!({ "shape": "bevel", "radius": 100_001.0 });
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for radius above MAX_CORNER_RADIUS");
        assert!(
            format!("{err}").contains("MAX_CORNER_RADIUS") || format!("{err}").contains("100000"),
            "error message must reference the limit, got: {err}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_nan_smoothing() {
        // serde_json::Number cannot represent NaN, so test validate_smoothing
        // directly for the NaN case.
        let err = crate::validate::validate_smoothing(f64::NAN)
            .expect_err("expected rejection for NaN smoothing");
        assert!(
            format!("{err}").contains("finite"),
            "error message must mention 'finite', got: {err}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_smoothing_below_min() {
        // Shape-level superellipse form — smoothing is below MIN_CORNER_SMOOTHING.
        let input = json!({ "shape": "superellipse", "radius": 8.0, "smoothing": -0.1 });
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for smoothing below MIN_CORNER_SMOOTHING");
        assert!(
            format!("{err}").contains("smoothing"),
            "error message must mention 'smoothing', got: {err}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_smoothing_above_max() {
        // Shape-level superellipse form — smoothing is above MAX_CORNER_SMOOTHING.
        let input = json!({ "shape": "superellipse", "radius": 8.0, "smoothing": 1.1 });
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for smoothing above MAX_CORNER_SMOOTHING");
        assert!(
            format!("{err}").contains("smoothing"),
            "error message must mention 'smoothing', got: {err}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_negative_radius_in_per_corner_array() {
        // Per-corner array form — one radii component is negative.
        let input = json!([
            { "shape": "round", "radii": { "x": -1.0, "y": 8.0 } },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } }
        ]);
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for negative radius in per-corner array");
        assert!(
            format!("{err}").contains("non-negative"),
            "error message must mention 'non-negative', got: {err}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_radius_above_max_in_per_corner_y() {
        // Per-corner array form — radii.y exceeds MAX_CORNER_RADIUS.
        let input = json!([
            { "shape": "round", "radii": { "x": 8.0, "y": 100_001.0 } },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } },
            { "shape": "round", "radii": { "x": 8.0, "y": 8.0 } }
        ]);
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for radius.y above MAX_CORNER_RADIUS");
        assert!(
            format!("{err}").contains("MAX_CORNER_RADIUS") || format!("{err}").contains("100000"),
            "error message must reference the limit, got: {err}"
        );
    }

    // ── RF-016: per-corner array must reject stray smoothing on non-superellipse ──

    #[test]
    fn test_per_corner_array_rejects_smoothing_on_round() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 4 }, "smoothing": 0.5 },
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "round", "radii": { "x": 4, "y": 4 } }
        ]);
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for stray smoothing on round corner");
        let msg = format!("{err}");
        assert!(
            msg.contains("smoothing") && msg.contains("round"),
            "error must reference smoothing and shape, got: {msg}"
        );
    }

    #[test]
    fn test_per_corner_array_rejects_smoothing_on_bevel() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "bevel", "radii": { "x": 4, "y": 4 }, "smoothing": 0.5 },
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "round", "radii": { "x": 4, "y": 4 } }
        ]);
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for stray smoothing on bevel corner");
        let msg = format!("{err}");
        assert!(
            msg.contains("smoothing") && msg.contains("bevel"),
            "error must reference smoothing and shape, got: {msg}"
        );
    }

    #[test]
    fn test_per_corner_array_rejects_smoothing_on_notch() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "notch", "radii": { "x": 4, "y": 4 }, "smoothing": 0.5 },
            { "shape": "round", "radii": { "x": 4, "y": 4 } }
        ]);
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for stray smoothing on notch corner");
        let msg = format!("{err}");
        assert!(
            msg.contains("smoothing") && msg.contains("notch"),
            "error must reference smoothing and shape, got: {msg}"
        );
    }

    #[test]
    fn test_per_corner_array_rejects_smoothing_on_scoop() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "scoop", "radii": { "x": 4, "y": 4 }, "smoothing": 0.5 }
        ]);
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for stray smoothing on scoop corner");
        let msg = format!("{err}");
        assert!(
            msg.contains("smoothing") && msg.contains("scoop"),
            "error must reference smoothing and shape, got: {msg}"
        );
    }

    #[test]
    fn test_parse_corners_input_rejects_negative_radius_in_superellipse_radii_array() {
        // Shape-level superellipse with per-corner radii array — one entry is negative.
        let input = json!({
            "shape": "superellipse",
            "smoothing": 0.5,
            "radii": [
                { "x": 8.0, "y": -1.0 },
                { "x": 8.0, "y": 8.0 },
                { "x": 8.0, "y": 8.0 },
                { "x": 8.0, "y": 8.0 }
            ]
        });
        let err = parse_corners_input(&input)
            .expect_err("expected rejection for negative radius in superellipse radii array");
        assert!(
            format!("{err}").contains("non-negative"),
            "error message must mention 'non-negative', got: {err}"
        );
    }
}
