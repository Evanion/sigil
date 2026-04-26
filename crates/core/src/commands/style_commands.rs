// crates/core/src/commands/style_commands.rs

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::{
    BlendMode, Constraints, Corner, Effect, Fill, NodeKind, Stroke, StyleValue, Transform,
};
use crate::validate::{
    MAX_EFFECTS_PER_STYLE, MAX_FILLS_PER_STYLE, MAX_STROKES_PER_STYLE, validate_corners,
};

/// Validates that all transform fields are finite and dimensions are non-negative.
///
/// # Errors
///
/// Returns [`CoreError::ValidationError`] if any field is NaN/infinity or if
/// width/height is negative.
pub fn validate_transform(t: &Transform) -> Result<(), CoreError> {
    let fields = [
        t.x, t.y, t.width, t.height, t.rotation, t.scale_x, t.scale_y,
    ];
    for f in fields {
        if !f.is_finite() {
            return Err(CoreError::ValidationError(
                "transform fields must be finite (no NaN or infinity)".to_string(),
            ));
        }
    }
    if t.width < 0.0 || t.height < 0.0 {
        return Err(CoreError::ValidationError(format!(
            "transform dimensions must be non-negative, got width={}, height={}",
            t.width, t.height
        )));
    }
    Ok(())
}

/// Sets a node's transform (position, size, rotation, scale).
#[derive(Debug)]
pub struct SetTransform {
    /// The target node.
    pub node_id: NodeId,
    /// The new transform to apply.
    pub new_transform: Transform,
}

impl FieldOperation for SetTransform {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_transform(&self.new_transform)?;
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena.get_mut(self.node_id)?.transform = self.new_transform;
        Ok(())
    }
}

/// Replaces a node's entire fills array.
#[derive(Debug)]
pub struct SetFills {
    /// The target node.
    pub node_id: NodeId,
    /// The new fills to apply.
    pub new_fills: Vec<Fill>,
}

impl FieldOperation for SetFills {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if self.new_fills.len() > MAX_FILLS_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many fills: {} (max {MAX_FILLS_PER_STYLE})",
                self.new_fills.len()
            )));
        }
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena
            .get_mut(self.node_id)?
            .style
            .fills
            .clone_from(&self.new_fills);
        Ok(())
    }
}

/// Replaces a node's entire strokes array.
#[derive(Debug)]
pub struct SetStrokes {
    /// The target node.
    pub node_id: NodeId,
    /// The new strokes to apply.
    pub new_strokes: Vec<Stroke>,
}

impl FieldOperation for SetStrokes {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if self.new_strokes.len() > MAX_STROKES_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many strokes: {} (max {MAX_STROKES_PER_STYLE})",
                self.new_strokes.len()
            )));
        }
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena
            .get_mut(self.node_id)?
            .style
            .strokes
            .clone_from(&self.new_strokes);
        Ok(())
    }
}

/// Sets a node's opacity.
#[derive(Debug)]
pub struct SetOpacity {
    /// The target node.
    pub node_id: NodeId,
    /// The new opacity value.
    pub new_opacity: StyleValue<f64>,
}

impl FieldOperation for SetOpacity {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if let StyleValue::Literal { value } = &self.new_opacity
            && (!value.is_finite() || *value < 0.0 || *value > 1.0)
        {
            return Err(CoreError::ValidationError(format!(
                "opacity must be in [0.0, 1.0], got {value}"
            )));
        }
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena.get_mut(self.node_id)?.style.opacity = self.new_opacity.clone();
        Ok(())
    }
}

/// Sets a node's blend mode.
#[derive(Debug)]
pub struct SetBlendMode {
    /// The target node.
    pub node_id: NodeId,
    /// The new blend mode.
    pub new_blend_mode: BlendMode,
}

impl FieldOperation for SetBlendMode {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena.get_mut(self.node_id)?.style.blend_mode = self.new_blend_mode;
        Ok(())
    }
}

/// Replaces a node's entire effects array.
#[derive(Debug)]
pub struct SetEffects {
    /// The target node.
    pub node_id: NodeId,
    /// The new effects to apply.
    pub new_effects: Vec<Effect>,
}

impl FieldOperation for SetEffects {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if self.new_effects.len() > MAX_EFFECTS_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many effects: {} (max {MAX_EFFECTS_PER_STYLE})",
                self.new_effects.len()
            )));
        }
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena
            .get_mut(self.node_id)?
            .style
            .effects
            .clone_from(&self.new_effects);
        Ok(())
    }
}

/// Replaces all four corner shapes on a `Rectangle`, `Frame`, or `Image` node.
///
/// `new_corners` must pass [`validate_corners`]:
/// - All radii finite, non-negative, and ≤ `MAX_CORNER_RADIUS`.
/// - Superellipse smoothing finite and in `[0.0, 1.0]`.
/// - If any corner is `Superellipse`, all four must be.
/// - If all four are `Superellipse`, smoothing must match across them.
#[derive(Debug)]
pub struct SetCorners {
    /// The target node (must be `Rectangle`, `Frame`, or `Image`).
    pub node_id: NodeId,
    /// The new corners to apply (top-left, top-right, bottom-right, bottom-left).
    pub new_corners: [Corner; 4],
}

impl FieldOperation for SetCorners {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_corners(&self.new_corners)?;
        let node = doc.arena.get(self.node_id)?;
        // Explicitly enumerate every NodeKind variant — adding a new variant
        // in core forces a compile error here so the validator stays in sync
        // (rust-defensive "NodeKind Variants Must Have Complete Validation
        // Coverage", RF-014). No wildcard arm.
        match &node.kind {
            NodeKind::Rectangle { .. } | NodeKind::Frame { .. } | NodeKind::Image { .. } => Ok(()),
            non_corner @ (NodeKind::Ellipse { .. }
            | NodeKind::Path { .. }
            | NodeKind::Text { .. }
            | NodeKind::Group
            | NodeKind::ComponentInstance { .. }) => Err(CoreError::ValidationError(format!(
                "SetCorners requires Rectangle, Frame, or Image node, got {:?}",
                std::mem::discriminant(non_corner)
            ))),
        }
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Rectangle { corners }
            | NodeKind::Frame { corners, .. }
            | NodeKind::Image { corners, .. } => {
                *corners = self.new_corners;
                Ok(())
            }
            non_corner @ (NodeKind::Ellipse { .. }
            | NodeKind::Path { .. }
            | NodeKind::Text { .. }
            | NodeKind::Group
            | NodeKind::ComponentInstance { .. }) => Err(CoreError::ValidationError(format!(
                "SetCorners requires Rectangle, Frame, or Image node, got {:?}",
                std::mem::discriminant(non_corner)
            ))),
        }
    }
}

/// Sets a node's constraints.
#[derive(Debug)]
pub struct SetConstraints {
    /// The target node.
    pub node_id: NodeId,
    /// The new constraints.
    pub new_constraints: Constraints,
}

impl FieldOperation for SetConstraints {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        doc.arena.get(self.node_id)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena.get_mut(self.node_id)?.constraints = self.new_constraints;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::id::NodeId;
    use crate::node::{Color, Node, NodeKind, PinConstraint};
    use uuid::Uuid;

    fn setup_doc_with_frame() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(2),
            NodeKind::Frame {
                layout: None,
                corners: crate::node::default_corners(),
            },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn setup_doc_with_rect() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Rectangle {
                corners: crate::node::default_corners(),
            },
            "Rect".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    // ── SetTransform ────────────────────────────────────────────────

    #[test]
    fn test_set_transform_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new = Transform {
            x: 50.0,
            y: 100.0,
            width: 200.0,
            height: 300.0,
            rotation: 45.0,
            scale_x: 2.0,
            scale_y: 2.0,
        };

        let op = SetTransform {
            node_id,
            new_transform: new,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().transform.x, 50.0);
        assert_eq!(doc.arena.get(node_id).unwrap().transform.rotation, 45.0);
    }

    #[test]
    fn test_set_transform_validate_rejects_missing_node() {
        let doc = Document::new("Test".to_string());
        let op = SetTransform {
            node_id: NodeId::new(99, 0),
            new_transform: Transform::default(),
        };
        assert!(op.validate(&doc).is_err());
    }

    // ── SetFills ────────────────────────────────────────────────────

    #[test]
    fn test_set_fills_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_fills = vec![Fill::Solid {
            color: StyleValue::Literal {
                value: Color::Srgb {
                    r: 1.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
        }];

        let op = SetFills {
            node_id,
            new_fills: new_fills.clone(),
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.fills.len(), 1);
    }

    #[test]
    fn test_set_fills_validates_max() {
        let (doc, node_id) = setup_doc_with_rect();
        let too_many: Vec<Fill> = (0..MAX_FILLS_PER_STYLE + 1)
            .map(|_| Fill::Solid {
                color: StyleValue::Literal {
                    value: Color::default(),
                },
            })
            .collect();

        let op = SetFills {
            node_id,
            new_fills: too_many,
        };

        assert!(op.validate(&doc).is_err());
    }

    // ── SetStrokes ──────────────────────────────────────────────────

    #[test]
    fn test_set_strokes_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_strokes = vec![Stroke::default()];

        let op = SetStrokes {
            node_id,
            new_strokes: new_strokes.clone(),
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.strokes.len(), 1);
    }

    // ── SetOpacity ──────────────────────────────────────────────────

    #[test]
    fn test_set_opacity_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();

        let op = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: 0.5 },
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.opacity,
            StyleValue::Literal { value: 0.5 }
        );
    }

    // ── SetBlendMode ────────────────────────────────────────────────

    #[test]
    fn test_set_blend_mode_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();

        let op = SetBlendMode {
            node_id,
            new_blend_mode: BlendMode::Multiply,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.blend_mode,
            BlendMode::Multiply
        );
    }

    // ── SetEffects ──────────────────────────────────────────────────

    #[test]
    fn test_set_effects_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_effects = vec![Effect::LayerBlur {
            radius: StyleValue::Literal { value: 10.0 },
        }];

        let op = SetEffects {
            node_id,
            new_effects: new_effects.clone(),
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.effects.len(), 1);
    }

    #[test]
    fn test_set_effects_validates_max() {
        let (doc, node_id) = setup_doc_with_rect();
        let too_many: Vec<Effect> = (0..MAX_EFFECTS_PER_STYLE + 1)
            .map(|_| Effect::LayerBlur {
                radius: StyleValue::Literal { value: 1.0 },
            })
            .collect();

        let op = SetEffects {
            node_id,
            new_effects: too_many,
        };

        assert!(op.validate(&doc).is_err());
    }

    // ── SetConstraints ──────────────────────────────────────────────

    #[test]
    fn test_set_constraints_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new = Constraints {
            horizontal: PinConstraint::Center,
            vertical: PinConstraint::Scale,
        };

        let op = SetConstraints {
            node_id,
            new_constraints: new,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().constraints.horizontal,
            PinConstraint::Center
        );
    }

    // ── SetOpacity validation ──────────────────────────────────────

    #[test]
    fn test_set_opacity_validates_range() {
        let (doc, node_id) = setup_doc_with_rect();

        let op = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: 1.5 },
        };
        assert!(op.validate(&doc).is_err());

        let op_neg = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: -0.1 },
        };
        assert!(op_neg.validate(&doc).is_err());
    }

    #[test]
    fn test_set_opacity_rejects_nan() {
        let (doc, node_id) = setup_doc_with_rect();

        let op = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: f64::NAN },
        };
        assert!(op.validate(&doc).is_err());
    }

    // ── SetTransform validation ────────────────────────────────────

    #[test]
    fn test_set_transform_rejects_nan() {
        let (doc, node_id) = setup_doc_with_rect();
        let old = doc.arena.get(node_id).unwrap().transform;

        let mut bad = old;
        bad.x = f64::NAN;
        let op = SetTransform {
            node_id,
            new_transform: bad,
        };
        assert!(op.validate(&doc).is_err());

        let mut bad_inf = old;
        bad_inf.y = f64::INFINITY;
        let op_inf = SetTransform {
            node_id,
            new_transform: bad_inf,
        };
        assert!(op_inf.validate(&doc).is_err());
    }

    #[test]
    fn test_set_transform_rejects_negative_dimensions() {
        let (doc, node_id) = setup_doc_with_rect();
        let old = doc.arena.get(node_id).unwrap().transform;

        let mut bad = old;
        bad.width = -10.0;
        let op = SetTransform {
            node_id,
            new_transform: bad,
        };
        assert!(op.validate(&doc).is_err());

        let mut bad_h = old;
        bad_h.height = -1.0;
        let op_h = SetTransform {
            node_id,
            new_transform: bad_h,
        };
        assert!(op_h.validate(&doc).is_err());
    }

    // ── SetCorners ────────────────────────────────────────────────────

    #[test]
    fn test_set_corners_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_corners = [
            Corner::Round {
                radii: crate::node::CornerRadii { x: 4.0, y: 4.0 },
            },
            Corner::Bevel {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
            },
            Corner::Notch {
                radii: crate::node::CornerRadii { x: 12.0, y: 12.0 },
            },
            Corner::Scoop {
                radii: crate::node::CornerRadii { x: 16.0, y: 16.0 },
            },
        ];
        let op = SetCorners {
            node_id,
            new_corners,
        };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        match &doc.arena.get(node_id).unwrap().kind {
            NodeKind::Rectangle { corners } => assert_eq!(*corners, new_corners),
            _ => panic!("expected Rectangle"),
        }
    }

    #[test]
    fn test_set_corners_applies_to_frame() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let new_corners = [Corner::Round {
            radii: crate::node::CornerRadii { x: 12.0, y: 12.0 },
        }; 4];
        let op = SetCorners {
            node_id,
            new_corners,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        match &doc.arena.get(node_id).unwrap().kind {
            NodeKind::Frame { corners, .. } => assert_eq!(*corners, new_corners),
            _ => panic!("expected Frame"),
        }
    }

    #[test]
    fn test_set_corners_applies_to_image() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(3),
            NodeKind::Image {
                asset_ref: "asset-1".to_string(),
                corners: crate::node::default_corners(),
            },
            "Image".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        let new_corners = [Corner::Bevel {
            radii: crate::node::CornerRadii { x: 6.0, y: 6.0 },
        }; 4];
        let op = SetCorners {
            node_id,
            new_corners,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");

        match &doc.arena.get(node_id).unwrap().kind {
            NodeKind::Image { corners, .. } => assert_eq!(*corners, new_corners),
            _ => panic!("expected Image"),
        }
    }

    #[test]
    fn test_set_corners_rejects_non_rect_shaped_node() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(4),
            NodeKind::Group,
            "Group".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");

        let op = SetCorners {
            node_id,
            new_corners: crate::node::default_corners(),
        };
        let err = op
            .validate(&doc)
            .expect_err("expected non-rect-shaped rejection");
        assert!(matches!(err, crate::error::CoreError::ValidationError(_)));
    }

    #[test]
    fn test_set_corners_rejects_nan_radius() {
        let (doc, node_id) = setup_doc_with_rect();
        let mut corners = crate::node::default_corners();
        corners[0] = Corner::Round {
            radii: crate::node::CornerRadii {
                x: f64::NAN,
                y: 0.0,
            },
        };
        let op = SetCorners {
            node_id,
            new_corners: corners,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_set_corners_rejects_negative_radius() {
        let (doc, node_id) = setup_doc_with_rect();
        let mut corners = crate::node::default_corners();
        corners[0] = Corner::Round {
            radii: crate::node::CornerRadii { x: -1.0, y: 0.0 },
        };
        let op = SetCorners {
            node_id,
            new_corners: corners,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_set_corners_rejects_infinite_radius() {
        let (doc, node_id) = setup_doc_with_rect();
        let mut corners = crate::node::default_corners();
        corners[2] = Corner::Round {
            radii: crate::node::CornerRadii {
                x: f64::INFINITY,
                y: 0.0,
            },
        };
        let op = SetCorners {
            node_id,
            new_corners: corners,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_set_corners_rejects_mixed_superellipse() {
        let (doc, node_id) = setup_doc_with_rect();
        let corners = [
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
                smoothing: 0.5,
            },
            Corner::Round {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
            },
            Corner::Round {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
            },
            Corner::Round {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
            },
        ];
        let op = SetCorners {
            node_id,
            new_corners: corners,
        };
        let err = op.validate(&doc).expect_err("expected uniformity error");
        let msg = format!("{err}");
        assert!(
            msg.contains("superellipse must be applied uniformly"),
            "msg: {msg}"
        );
    }

    #[test]
    fn test_set_corners_rejects_superellipse_smoothing_mismatch() {
        let (doc, node_id) = setup_doc_with_rect();
        let corners = [
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
                smoothing: 0.3,
            },
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
                smoothing: 0.7,
            },
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
                smoothing: 0.3,
            },
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
                smoothing: 0.3,
            },
        ];
        let op = SetCorners {
            node_id,
            new_corners: corners,
        };
        let err = op
            .validate(&doc)
            .expect_err("expected smoothing parity error");
        let msg = format!("{err}");
        assert!(
            msg.contains("superellipse smoothing must match"),
            "msg: {msg}"
        );
    }

    #[test]
    fn test_set_corners_accepts_uniform_superellipse_with_asymmetric_radii() {
        let (doc, node_id) = setup_doc_with_rect();
        let corners = [
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 4.0, y: 8.0 },
                smoothing: 0.6,
            },
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 16.0, y: 16.0 },
                smoothing: 0.6,
            },
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 16.0, y: 4.0 },
                smoothing: 0.6,
            },
            Corner::Superellipse {
                radii: crate::node::CornerRadii { x: 8.0, y: 8.0 },
                smoothing: 0.6,
            },
        ];
        let op = SetCorners {
            node_id,
            new_corners: corners,
        };
        assert!(op.validate(&doc).is_ok());
    }

    #[test]
    fn test_set_corners_rejects_missing_node() {
        let doc = Document::new("Test".to_string());
        let op = SetCorners {
            node_id: NodeId::new(999, 0),
            new_corners: crate::node::default_corners(),
        };
        assert!(op.validate(&doc).is_err());
    }
}
