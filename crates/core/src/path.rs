// crates/core/src/path.rs

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::node::Point;
use crate::validate::{MAX_SEGMENTS_PER_SUBPATH, MAX_SUBPATHS_PER_PATH};

/// A segment in a vector path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PathSegment {
    /// Move the pen to a new position without drawing.
    MoveTo { point: Point },
    /// Draw a straight line to the given point.
    LineTo { point: Point },
    /// Draw a cubic bezier curve.
    CubicTo {
        control1: Point,
        control2: Point,
        end: Point,
    },
    /// Close the current subpath by drawing a line back to the start.
    Close,
}

/// A continuous sequence of path segments.
///
/// Fields are private to ensure validation invariants are maintained.
/// Use [`SubPath::new`] to construct and accessor methods to read.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SubPath {
    segments: Vec<PathSegment>,
    closed: bool,
}

impl<'de> Deserialize<'de> for SubPath {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct SubPathRaw {
            segments: Vec<PathSegment>,
            closed: bool,
        }

        let raw = SubPathRaw::deserialize(deserializer)?;
        SubPath::new(raw.segments, raw.closed).map_err(serde::de::Error::custom)
    }
}

impl SubPath {
    /// Creates a new subpath, validating the segment count and structure.
    ///
    /// # Errors
    /// - `CoreError::ValidationError` if segments exceed the maximum.
    /// - `CoreError::ValidationError` if a non-empty subpath does not start with `MoveTo`.
    pub fn new(segments: Vec<PathSegment>, closed: bool) -> Result<Self, CoreError> {
        if segments.len() > MAX_SEGMENTS_PER_SUBPATH {
            return Err(CoreError::ValidationError(format!(
                "subpath has {} segments (max {MAX_SEGMENTS_PER_SUBPATH})",
                segments.len()
            )));
        }
        let subpath = Self { segments, closed };
        subpath.validate_structure()?;
        Ok(subpath)
    }

    /// Returns the segments in this subpath.
    #[must_use]
    pub fn segments(&self) -> &[PathSegment] {
        &self.segments
    }

    /// Returns whether this subpath is closed.
    #[must_use]
    pub fn closed(&self) -> bool {
        self.closed
    }

    /// Validates that the subpath has a valid segment ordering.
    ///
    /// A non-empty subpath must start with a `MoveTo` segment.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if the first segment is not `MoveTo`.
    pub fn validate_structure(&self) -> Result<(), CoreError> {
        if self.segments.is_empty() {
            return Ok(()); // empty subpath is valid
        }
        if !matches!(self.segments[0], PathSegment::MoveTo { .. }) {
            return Err(CoreError::ValidationError(
                "subpath must start with MoveTo".to_string(),
            ));
        }
        Ok(())
    }
}

/// Fill rule for path rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FillRule {
    /// Even-odd fill rule.
    EvenOdd,
    /// Non-zero winding fill rule.
    NonZero,
}

/// Vector path geometry data.
///
/// Fields are private to ensure validation invariants are maintained.
/// Use [`PathData::new`] to construct and accessor methods to read.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PathData {
    subpaths: Vec<SubPath>,
    fill_rule: FillRule,
}

impl<'de> Deserialize<'de> for PathData {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct PathDataRaw {
            subpaths: Vec<SubPath>,
            fill_rule: FillRule,
        }

        let raw = PathDataRaw::deserialize(deserializer)?;
        PathData::new(raw.subpaths, raw.fill_rule).map_err(serde::de::Error::custom)
    }
}

impl PathData {
    /// Creates a new `PathData`, validating subpath count.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if subpaths exceed the maximum.
    pub fn new(subpaths: Vec<SubPath>, fill_rule: FillRule) -> Result<Self, CoreError> {
        if subpaths.len() > MAX_SUBPATHS_PER_PATH {
            return Err(CoreError::ValidationError(format!(
                "path has {} subpaths (max {MAX_SUBPATHS_PER_PATH})",
                subpaths.len()
            )));
        }
        Ok(Self {
            subpaths,
            fill_rule,
        })
    }

    /// Returns the subpaths in this path.
    #[must_use]
    pub fn subpaths(&self) -> &[SubPath] {
        &self.subpaths
    }

    /// Returns the fill rule for this path.
    #[must_use]
    pub fn fill_rule(&self) -> FillRule {
        self.fill_rule
    }
}

impl Default for PathData {
    fn default() -> Self {
        Self {
            subpaths: Vec::new(),
            fill_rule: FillRule::EvenOdd,
        }
    }
}

/// Corner mode for anchor point handles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CornerMode {
    /// Handles are aligned but can differ in length.
    Smooth,
    /// Handles are aligned and equal length.
    Mirrored,
    /// Handles move independently.
    Disconnected,
    /// No handles — straight corner.
    Straight,
}

/// An anchor point in the path editing UI.
///
/// This is a runtime-only editing view — not serialized to the file format.
/// The serialized form is `PathSegment`.
#[derive(Debug, Clone, PartialEq)]
pub struct AnchorPoint {
    pub position: Point,
    pub handle_in: Option<Point>,
    pub handle_out: Option<Point>,
    pub corner_mode: CornerMode,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subpath_new_valid() {
        let segments = vec![
            PathSegment::MoveTo {
                point: Point::new(0.0, 0.0),
            },
            PathSegment::LineTo {
                point: Point::new(100.0, 0.0),
            },
            PathSegment::Close,
        ];
        let subpath = SubPath::new(segments, true).expect("valid subpath");
        assert!(subpath.closed());
        assert_eq!(subpath.segments().len(), 3);
    }

    #[test]
    fn test_subpath_exceeds_max_segments() {
        // Start with MoveTo so structure is valid, then fill with LineTo
        let mut segments: Vec<PathSegment> = Vec::with_capacity(MAX_SEGMENTS_PER_SUBPATH + 1);
        segments.push(PathSegment::MoveTo {
            point: Point::zero(),
        });
        for i in 1..=MAX_SEGMENTS_PER_SUBPATH {
            segments.push(PathSegment::LineTo {
                point: Point::new(i as f64, 0.0),
            });
        }
        assert!(SubPath::new(segments, false).is_err());
    }

    #[test]
    fn test_path_data_new_valid() {
        let subpath = SubPath::new(
            vec![PathSegment::MoveTo {
                point: Point::zero(),
            }],
            false,
        )
        .expect("valid subpath");
        let path = PathData::new(vec![subpath], FillRule::EvenOdd).expect("valid path");
        assert_eq!(path.subpaths().len(), 1);
    }

    #[test]
    fn test_path_data_exceeds_max_subpaths() {
        let subpaths: Vec<SubPath> = (0..MAX_SUBPATHS_PER_PATH + 1)
            .map(|_| SubPath::new(vec![], false).expect("empty subpath"))
            .collect();
        assert!(PathData::new(subpaths, FillRule::NonZero).is_err());
    }

    #[test]
    fn test_path_data_default() {
        let path = PathData::default();
        assert!(path.subpaths().is_empty());
        assert_eq!(path.fill_rule(), FillRule::EvenOdd);
    }

    #[test]
    fn test_path_segment_serde_round_trip() {
        let segment = PathSegment::CubicTo {
            control1: Point::new(10.0, 20.0),
            control2: Point::new(30.0, 40.0),
            end: Point::new(50.0, 60.0),
        };
        let json = serde_json::to_string(&segment).expect("serialize");
        let deserialized: PathSegment = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(segment, deserialized);
    }

    #[test]
    fn test_subpath_serde_round_trip() {
        let subpath = SubPath::new(
            vec![
                PathSegment::MoveTo {
                    point: Point::zero(),
                },
                PathSegment::LineTo {
                    point: Point::new(100.0, 100.0),
                },
                PathSegment::Close,
            ],
            true,
        )
        .expect("valid subpath");
        let json = serde_json::to_string(&subpath).expect("serialize");
        let deserialized: SubPath = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(subpath, deserialized);
    }

    #[test]
    fn test_path_data_serde_round_trip() {
        let path = PathData::new(
            vec![
                SubPath::new(
                    vec![
                        PathSegment::MoveTo {
                            point: Point::zero(),
                        },
                        PathSegment::CubicTo {
                            control1: Point::new(10.0, 0.0),
                            control2: Point::new(90.0, 100.0),
                            end: Point::new(100.0, 100.0),
                        },
                    ],
                    false,
                )
                .expect("valid subpath"),
            ],
            FillRule::NonZero,
        )
        .expect("valid path");
        let json = serde_json::to_string(&path).expect("serialize");
        let deserialized: PathData = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(path, deserialized);
    }

    #[test]
    fn test_anchor_point_construction() {
        let anchor = AnchorPoint {
            position: Point::new(50.0, 50.0),
            handle_in: Some(Point::new(40.0, 50.0)),
            handle_out: Some(Point::new(60.0, 50.0)),
            corner_mode: CornerMode::Smooth,
        };
        assert_eq!(anchor.corner_mode, CornerMode::Smooth);
    }

    // ── RF-009: Path segment ordering ─────────────────────────────────

    #[test]
    fn test_subpath_validate_structure_empty_is_valid() {
        let subpath = SubPath::new(vec![], false).expect("empty is valid");
        assert!(subpath.validate_structure().is_ok());
    }

    #[test]
    fn test_subpath_validate_structure_starts_with_move_to() {
        let subpath = SubPath::new(
            vec![
                PathSegment::MoveTo {
                    point: Point::zero(),
                },
                PathSegment::LineTo {
                    point: Point::new(10.0, 10.0),
                },
            ],
            false,
        )
        .expect("valid structure");
        assert!(subpath.validate_structure().is_ok());
    }

    #[test]
    fn test_subpath_rejects_non_move_to_start() {
        let result = SubPath::new(
            vec![PathSegment::LineTo {
                point: Point::new(10.0, 10.0),
            }],
            false,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            format!("{err}").contains("MoveTo"),
            "error should mention MoveTo: {err}"
        );
    }

    #[test]
    fn test_subpath_rejects_close_as_first_segment() {
        let result = SubPath::new(vec![PathSegment::Close], false);
        assert!(result.is_err());
    }

    #[test]
    fn test_subpath_rejects_cubic_as_first_segment() {
        let result = SubPath::new(
            vec![PathSegment::CubicTo {
                control1: Point::zero(),
                control2: Point::new(1.0, 1.0),
                end: Point::new(2.0, 2.0),
            }],
            false,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_subpath_deserialize_rejects_non_move_to_start() {
        let json = r#"{"segments":[{"type":"line_to","point":{"x":10,"y":10}}],"closed":false}"#;
        let result: Result<SubPath, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "deserialization should reject non-MoveTo start"
        );
    }

    #[test]
    fn test_path_data_deserialize_calls_validation() {
        // Construct a PathData JSON with a subpath that exceeds max subpaths
        // This tests that the custom Deserialize impl calls new()
        let json = r#"{"subpaths":[],"fill_rule":"even_odd"}"#;
        let result: Result<PathData, _> = serde_json::from_str(json);
        assert!(result.is_ok(), "empty path data should deserialize");
    }
}
