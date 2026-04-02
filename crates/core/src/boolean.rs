// crates/core/src/boolean.rs

use i_overlay::core::fill_rule::FillRule as IFillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::overlay::FloatOverlay;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::node::Point;
use crate::path::{FillRule, PathData, PathSegment, SubPath};
use crate::validate::{BEZIER_APPROXIMATION_SEGMENTS, MAX_BOOLEAN_OP_POINTS};

/// Boolean operation type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BooleanOp {
    /// Combine both shapes.
    Union,
    /// Subtract the second shape from the first.
    Subtract,
    /// Keep only the overlapping area.
    Intersect,
    /// Keep everything except the overlapping area.
    Exclude,
}

/// Performs a boolean operation on two paths.
///
/// Pipeline: bezier curves -> polyline approximation -> `i_overlay` boolean op -> polyline result.
/// The result contains only `MoveTo`/`LineTo`/`Close` segments (no `CubicTo` -- bezier refitting
/// is deferred to a future enhancement).
///
/// # Errors
/// - `CoreError::BooleanOpFailed` if the operation produces no valid geometry.
/// - `CoreError::ValidationError` if input paths exceed safety limits.
pub fn boolean_op(a: &PathData, b: &PathData, op: BooleanOp) -> Result<PathData, CoreError> {
    // RF-002: fill rules must match
    if a.fill_rule() != b.fill_rule() {
        return Err(CoreError::ValidationError(
            "boolean_op: paths must have the same fill rule".to_string(),
        ));
    }

    // Convert PathData to i_overlay polygon format
    // RF-003: track cumulative point counts across both paths
    let (polys_a, points_a) = path_data_to_polygons(a)?;
    let (polys_b, points_b) = path_data_to_polygons(b)?;
    if points_a + points_b > MAX_BOOLEAN_OP_POINTS {
        return Err(CoreError::ValidationError(format!(
            "boolean op total points {} exceeds {MAX_BOOLEAN_OP_POINTS}",
            points_a + points_b
        )));
    }

    if polys_a.is_empty() || polys_b.is_empty() {
        return Err(CoreError::BooleanOpFailed(
            "one or both paths have no geometry".to_string(),
        ));
    }

    // Map our FillRule to i_overlay's
    let fill_rule = match a.fill_rule() {
        FillRule::EvenOdd => IFillRule::EvenOdd,
        FillRule::NonZero => IFillRule::NonZero,
    };

    // Map our BooleanOp to i_overlay's OverlayRule
    let rule = match op {
        BooleanOp::Union => OverlayRule::Union,
        BooleanOp::Subtract => OverlayRule::Difference,
        BooleanOp::Intersect => OverlayRule::Intersect,
        BooleanOp::Exclude => OverlayRule::Xor,
    };

    // Build overlay and execute
    // i_overlay v4 API: contours are Vec<Vec<[f64; 2]>> (subject/clip)
    let mut overlay = FloatOverlay::with_subj_and_clip(&polys_a, &polys_b);
    let result_shapes = overlay.overlay(rule, fill_rule);

    if result_shapes.is_empty() {
        return Err(CoreError::BooleanOpFailed(
            "boolean operation produced empty result".to_string(),
        ));
    }

    // Convert result back to PathData
    polygons_to_path_data(&result_shapes, a.fill_rule())
}

/// A polygon represented as a list of `[x, y]` coordinate pairs.
type Polygon = Vec<[f64; 2]>;

/// Converts `PathData` to `i_overlay` polygon format by flattening bezier curves.
///
/// Returns the polygons and the total point count for cumulative limit checking.
fn path_data_to_polygons(path: &PathData) -> Result<(Vec<Polygon>, usize), CoreError> {
    let mut polygons = Vec::new();
    let mut total_points = 0usize;

    for subpath in path.subpaths() {
        let mut points: Vec<[f64; 2]> = Vec::new();
        let mut current = Point::zero();

        for segment in subpath.segments() {
            match segment {
                PathSegment::MoveTo { point } => {
                    // RF-009: filter out degenerate polygons (fewer than 3 points)
                    if points.len() >= 3 {
                        total_points += points.len();
                        if total_points > MAX_BOOLEAN_OP_POINTS {
                            return Err(CoreError::ValidationError(format!(
                                "boolean op input exceeds {MAX_BOOLEAN_OP_POINTS} points"
                            )));
                        }
                        // RF-010: take instead of clone+clear
                        polygons.push(std::mem::take(&mut points));
                    } else {
                        points.clear();
                    }
                    points.push([point.x, point.y]);
                    current = *point;
                }
                PathSegment::LineTo { point } => {
                    points.push([point.x, point.y]);
                    current = *point;
                }
                PathSegment::CubicTo {
                    control1,
                    control2,
                    end,
                } => {
                    // Approximate cubic bezier with line segments
                    for i in 1..=BEZIER_APPROXIMATION_SEGMENTS {
                        #[allow(clippy::cast_precision_loss)]
                        let t = i as f64 / BEZIER_APPROXIMATION_SEGMENTS as f64;
                        let p = cubic_bezier_point(current, *control1, *control2, *end, t);
                        points.push([p.x, p.y]);
                    }
                    current = *end;
                }
                PathSegment::Close => {
                    // Close is implicit in polygon representation
                }
            }
        }

        // RF-009: filter out degenerate polygons (fewer than 3 points)
        if points.len() >= 3 {
            total_points += points.len();
            if total_points > MAX_BOOLEAN_OP_POINTS {
                return Err(CoreError::ValidationError(format!(
                    "boolean op input exceeds {MAX_BOOLEAN_OP_POINTS} points"
                )));
            }
            polygons.push(points);
        }
    }

    Ok((polygons, total_points))
}

/// Converts `i_overlay` result shapes back to `PathData`.
///
/// The result is `Vec<Vec<Vec<[f64; 2]>>>` -- shapes -> contours -> points.
fn polygons_to_path_data(
    shapes: &[Vec<Vec<[f64; 2]>>],
    fill_rule: FillRule,
) -> Result<PathData, CoreError> {
    // RF-006: count total output points before constructing SubPath objects
    let total_output_points: usize = shapes
        .iter()
        .flat_map(|shape| shape.iter())
        .map(Vec::len)
        .sum();
    if total_output_points > MAX_BOOLEAN_OP_POINTS {
        return Err(CoreError::ValidationError(format!(
            "boolean op output has {total_output_points} points, exceeds {MAX_BOOLEAN_OP_POINTS}"
        )));
    }

    let mut subpaths = Vec::new();

    for shape in shapes {
        for polygon in shape {
            if polygon.is_empty() {
                continue;
            }
            let mut segments = Vec::with_capacity(polygon.len() + 2);
            segments.push(PathSegment::MoveTo {
                point: Point::new(polygon[0][0], polygon[0][1]),
            });
            for pt in &polygon[1..] {
                segments.push(PathSegment::LineTo {
                    point: Point::new(pt[0], pt[1]),
                });
            }
            segments.push(PathSegment::Close);
            subpaths.push(SubPath::new(segments, true)?);
        }
    }

    PathData::new(subpaths, fill_rule)
}

/// Evaluates a cubic bezier curve at parameter t.
fn cubic_bezier_point(p0: Point, p1: Point, p2: Point, p3: Point, t: f64) -> Point {
    let t2 = t * t;
    let t3 = t2 * t;
    let mt = 1.0 - t;
    let mt2 = mt * mt;
    let mt3 = mt2 * mt;

    Point::new(
        mt3.mul_add(
            p0.x,
            (3.0 * mt2 * t).mul_add(p1.x, (3.0 * mt * t2).mul_add(p2.x, t3 * p3.x)),
        ),
        mt3.mul_add(
            p0.y,
            (3.0 * mt2 * t).mul_add(p1.y, (3.0 * mt * t2).mul_add(p2.y, t3 * p3.y)),
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a simple rectangular path.
    fn make_rect(x: f64, y: f64, w: f64, h: f64) -> PathData {
        let segments = vec![
            PathSegment::MoveTo {
                point: Point::new(x, y),
            },
            PathSegment::LineTo {
                point: Point::new(x + w, y),
            },
            PathSegment::LineTo {
                point: Point::new(x + w, y + h),
            },
            PathSegment::LineTo {
                point: Point::new(x, y + h),
            },
            PathSegment::Close,
        ];
        let subpath = SubPath::new(segments, true).expect("valid rect");
        PathData::new(vec![subpath], FillRule::EvenOdd).expect("valid path")
    }

    #[test]
    fn test_boolean_op_union_produces_non_empty_result() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0);
        let b = make_rect(5.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Union).expect("union");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_subtract_produces_non_empty_result() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0);
        let b = make_rect(5.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Subtract).expect("subtract");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_intersect_produces_non_empty_result() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0);
        let b = make_rect(5.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Intersect).expect("intersect");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_exclude_produces_non_empty_result() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0);
        let b = make_rect(5.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Exclude).expect("exclude");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_subtract_non_overlapping_returns_original_shape() {
        let a = make_rect(0.0, 0.0, 5.0, 5.0);
        let b = make_rect(10.0, 10.0, 5.0, 5.0);
        // Subtracting a non-overlapping shape should return the original shape
        let result = boolean_op(&a, &b, BooleanOp::Subtract).expect("subtract no overlap");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_boolean_op_intersect_non_overlapping_returns_empty() {
        let a = make_rect(0.0, 0.0, 5.0, 5.0);
        let b = make_rect(10.0, 10.0, 5.0, 5.0);
        // Intersecting non-overlapping shapes should produce empty result
        let result = boolean_op(&a, &b, BooleanOp::Intersect);
        assert!(result.is_err()); // Empty result returns BooleanOpFailed
    }

    #[test]
    fn test_boolean_op_rejects_empty_path() {
        let a = PathData::default(); // empty
        let b = make_rect(0.0, 0.0, 10.0, 10.0);
        let result = boolean_op(&a, &b, BooleanOp::Union);
        assert!(result.is_err());
    }

    #[test]
    fn test_boolean_op_serde_round_trip() {
        let op = BooleanOp::Exclude;
        let json = serde_json::to_string(&op).expect("serialize");
        let deserialized: BooleanOp = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(op, deserialized);
    }

    #[test]
    fn test_boolean_op_with_curves_approximates_and_processes() {
        // Test that paths containing CubicTo segments are approximated and processed
        let segments = vec![
            PathSegment::MoveTo {
                point: Point::new(0.0, 0.0),
            },
            PathSegment::CubicTo {
                control1: Point::new(5.0, 10.0),
                control2: Point::new(10.0, 10.0),
                end: Point::new(15.0, 0.0),
            },
            PathSegment::LineTo {
                point: Point::new(15.0, -5.0),
            },
            PathSegment::LineTo {
                point: Point::new(0.0, -5.0),
            },
            PathSegment::Close,
        ];
        let subpath = SubPath::new(segments, true).expect("valid");
        let a = PathData::new(vec![subpath], FillRule::EvenOdd).expect("valid");
        let b = make_rect(5.0, -5.0, 10.0, 10.0);

        let result = boolean_op(&a, &b, BooleanOp::Intersect).expect("intersect with curves");
        assert!(!result.subpaths().is_empty());
    }

    #[test]
    fn test_cubic_bezier_point_at_start_equals_p0() {
        let p0 = Point::new(0.0, 0.0);
        let p1 = Point::new(1.0, 2.0);
        let p2 = Point::new(3.0, 2.0);
        let p3 = Point::new(4.0, 0.0);

        let start = cubic_bezier_point(p0, p1, p2, p3, 0.0);
        assert!((start.x - p0.x).abs() < 1e-10);
        assert!((start.y - p0.y).abs() < 1e-10);
    }

    #[test]
    fn test_cubic_bezier_point_at_end_equals_p3() {
        let p0 = Point::new(0.0, 0.0);
        let p1 = Point::new(1.0, 2.0);
        let p2 = Point::new(3.0, 2.0);
        let p3 = Point::new(4.0, 0.0);

        let end = cubic_bezier_point(p0, p1, p2, p3, 1.0);
        assert!((end.x - p3.x).abs() < 1e-10);
        assert!((end.y - p3.y).abs() < 1e-10);
    }

    #[test]
    fn test_boolean_op_mismatched_fill_rules() {
        let a = make_rect(0.0, 0.0, 10.0, 10.0); // EvenOdd (default)
        let segments = vec![
            PathSegment::MoveTo {
                point: Point::new(5.0, 0.0),
            },
            PathSegment::LineTo {
                point: Point::new(15.0, 0.0),
            },
            PathSegment::LineTo {
                point: Point::new(15.0, 10.0),
            },
            PathSegment::LineTo {
                point: Point::new(5.0, 10.0),
            },
            PathSegment::Close,
        ];
        let subpath = SubPath::new(segments, true).expect("valid rect");
        let b = PathData::new(vec![subpath], FillRule::NonZero).expect("valid path");

        let result = boolean_op(&a, &b, BooleanOp::Union);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("same fill rule"),
            "expected fill rule mismatch error, got: {err_msg}"
        );
    }

    #[test]
    fn test_max_boolean_op_points_enforced() {
        // RF-004: Two paths that each individually stay under MAX_BOOLEAN_OP_POINTS
        // but cumulatively exceed it. Each CubicTo expands to BEZIER_APPROXIMATION_SEGMENTS
        // (16) points. We use multiple subpaths per path to stay within
        // MAX_SEGMENTS_PER_SUBPATH (100,000) per subpath.
        //
        // Strategy: each path has 10 subpaths, each with 4,000 CubicTo segments.
        // Points per path: 10 * 4,000 * 16 = 640,000 (under 1M).
        // Cumulative: 640,000 + 640,000 = 1,280,000 (over 1M).
        fn make_heavy_path() -> PathData {
            let mut subpaths = Vec::new();
            for sp_idx in 0..10 {
                #[allow(clippy::cast_precision_loss)]
                let offset = sp_idx as f64 * 1000.0;
                let mut segments = Vec::with_capacity(4_002);
                segments.push(PathSegment::MoveTo {
                    point: Point::new(offset, 0.0),
                });
                for i in 0..4_000 {
                    #[allow(clippy::cast_precision_loss)]
                    let x = offset + i as f64;
                    segments.push(PathSegment::CubicTo {
                        control1: Point::new(x + 0.25, 1.0),
                        control2: Point::new(x + 0.75, 1.0),
                        end: Point::new(x + 1.0, 0.0),
                    });
                }
                segments.push(PathSegment::Close);
                subpaths.push(SubPath::new(segments, true).expect("valid heavy subpath"));
            }
            PathData::new(subpaths, FillRule::EvenOdd).expect("valid heavy path")
        }

        let a = make_heavy_path();
        let b = make_heavy_path();

        let result = boolean_op(&a, &b, BooleanOp::Union);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("total points") && err_msg.contains("exceeds"),
            "expected cumulative point limit error, got: {err_msg}"
        );
    }

    #[test]
    fn test_bezier_approximation_segments_constant() {
        assert_eq!(BEZIER_APPROXIMATION_SEGMENTS, 16);
    }

    #[test]
    fn test_boolean_op_all_variants_serialize() {
        let ops = [
            BooleanOp::Union,
            BooleanOp::Subtract,
            BooleanOp::Intersect,
            BooleanOp::Exclude,
        ];
        for op in &ops {
            let json = serde_json::to_string(op).expect("serialize");
            let deserialized: BooleanOp = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(*op, deserialized);
        }
    }
}
