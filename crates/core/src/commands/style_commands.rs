// crates/core/src/commands/style_commands.rs

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::{BlendMode, Constraints, Effect, Fill, NodeKind, Stroke, StyleValue, Transform};
use crate::validate::{
    MAX_EFFECTS_PER_STYLE, MAX_FILLS_PER_STYLE, MAX_STROKES_PER_STYLE,
    validate_style_value_expression, validate_token_name,
};

/// Validates a `StyleValue<f64>` field: either literal finite, token ref valid name, or expression.
fn validate_style_value_f64(field: &str, sv: &StyleValue<f64>) -> Result<(), CoreError> {
    match sv {
        StyleValue::Literal { value } => {
            if !value.is_finite() {
                return Err(CoreError::ValidationError(format!(
                    "{field} must be finite (no NaN or infinity)"
                )));
            }
        }
        StyleValue::TokenRef { name } => validate_token_name(name)?,
        StyleValue::Expression { expr } => validate_style_value_expression(expr)?,
    }
    Ok(())
}

/// Validates a `StyleValue<Color>` field: either literal color channels finite, token ref, or expression.
fn validate_style_value_color(
    field: &str,
    sv: &StyleValue<crate::node::Color>,
) -> Result<(), CoreError> {
    use crate::node::Color;
    match sv {
        StyleValue::Literal { value } => match value {
            Color::Srgb { r, g, b, a } | Color::DisplayP3 { r, g, b, a } => {
                if !r.is_finite() || !g.is_finite() || !b.is_finite() || !a.is_finite() {
                    return Err(CoreError::ValidationError(format!(
                        "{field} color channels must be finite"
                    )));
                }
            }
            Color::Oklch { l, c, h, a } => {
                if !l.is_finite() || !c.is_finite() || !h.is_finite() || !a.is_finite() {
                    return Err(CoreError::ValidationError(format!(
                        "{field} color channels must be finite"
                    )));
                }
            }
            Color::Oklab { l, a, b, alpha } => {
                if !l.is_finite() || !a.is_finite() || !b.is_finite() || !alpha.is_finite() {
                    return Err(CoreError::ValidationError(format!(
                        "{field} color channels must be finite"
                    )));
                }
            }
        },
        StyleValue::TokenRef { name } => validate_token_name(name)?,
        StyleValue::Expression { expr } => validate_style_value_expression(expr)?,
    }
    Ok(())
}

/// Validates the `StyleValue` fields inside a single `Fill`.
fn validate_fill(fill: &Fill) -> Result<(), CoreError> {
    match fill {
        Fill::Solid { color } => validate_style_value_color("fill.color", color),
        Fill::LinearGradient { gradient } | Fill::RadialGradient { gradient } => {
            for (i, stop) in gradient.stops.iter().enumerate() {
                validate_style_value_color(
                    &format!("fill.gradient.stops[{i}].color"),
                    &stop.color,
                )?;
            }
            Ok(())
        }
        Fill::ConicGradient { gradient } => {
            for (i, stop) in gradient.stops.iter().enumerate() {
                validate_style_value_color(
                    &format!("fill.conic_gradient.stops[{i}].color"),
                    &stop.color,
                )?;
            }
            Ok(())
        }
        Fill::Image { .. } => Ok(()),
    }
}

/// Validates the `StyleValue` fields inside a single `Stroke`.
fn validate_stroke(stroke: &Stroke) -> Result<(), CoreError> {
    validate_style_value_color("stroke.color", &stroke.color)?;
    validate_style_value_f64("stroke.width", &stroke.width)?;
    Ok(())
}

/// Validates the `StyleValue` fields inside a single `Effect`.
fn validate_effect(effect: &Effect) -> Result<(), CoreError> {
    match effect {
        Effect::DropShadow {
            color,
            blur,
            spread,
            ..
        }
        | Effect::InnerShadow {
            color,
            blur,
            spread,
            ..
        } => {
            validate_style_value_color("effect.color", color)?;
            validate_style_value_f64("effect.blur", blur)?;
            validate_style_value_f64("effect.spread", spread)?;
            Ok(())
        }
        Effect::LayerBlur { radius } | Effect::BackgroundBlur { radius } => {
            validate_style_value_f64("effect.radius", radius)
        }
    }
}

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
        for fill in &self.new_fills {
            validate_fill(fill)?;
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
        for stroke in &self.new_strokes {
            validate_stroke(stroke)?;
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
        // Expression variants defer semantic validation to evaluation time.
        match &self.new_opacity {
            StyleValue::Literal { value } => {
                if !value.is_finite() || *value < 0.0 || *value > 1.0 {
                    return Err(CoreError::ValidationError(format!(
                        "opacity must be in [0.0, 1.0], got {value}"
                    )));
                }
            }
            StyleValue::TokenRef { name } => validate_token_name(name)?,
            StyleValue::Expression { expr } => validate_style_value_expression(expr)?,
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
        for effect in &self.new_effects {
            validate_effect(effect)?;
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

/// Validates that all four corner radii are finite and non-negative.
///
/// # Errors
///
/// Returns [`CoreError::ValidationError`] if any radius is NaN, infinity, or negative.
fn validate_corner_radii(radii: &[f64; 4]) -> Result<(), CoreError> {
    for (i, &r) in radii.iter().enumerate() {
        if !r.is_finite() {
            return Err(CoreError::ValidationError(format!(
                "corner_radii[{i}] must be finite (no NaN or infinity), got {r}"
            )));
        }
        if r < 0.0 {
            return Err(CoreError::ValidationError(format!(
                "corner_radii[{i}] must be non-negative, got {r}"
            )));
        }
    }
    Ok(())
}

/// Sets the corner radii on a rectangle node.
///
/// Fails if the target node is not a `NodeKind::Rectangle`.
#[derive(Debug)]
pub struct SetCornerRadii {
    /// The target node (must be a rectangle).
    pub node_id: NodeId,
    /// The new corner radii to apply (top-left, top-right, bottom-right, bottom-left).
    pub new_radii: [f64; 4],
}

impl FieldOperation for SetCornerRadii {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_corner_radii(&self.new_radii)?;
        let node = doc.arena.get(self.node_id)?;
        if !matches!(node.kind, NodeKind::Rectangle { .. }) {
            return Err(CoreError::ValidationError(format!(
                "SetCornerRadii requires a Rectangle node, got a different kind (node {:?})",
                self.node_id
            )));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Rectangle { corner_radii } => {
                *corner_radii = self.new_radii;
                Ok(())
            }
            _ => Err(CoreError::ValidationError(format!(
                "SetCornerRadii requires a Rectangle node, got a different kind (node {:?})",
                self.node_id
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
            NodeKind::Frame { layout: None },
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
                corner_radii: [0.0; 4],
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

    // ── SetCornerRadii ────────────────────────────────────────────────

    #[test]
    fn test_set_corner_radii_validate_and_apply() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_radii = [4.0, 8.0, 4.0, 8.0];

        let op = SetCornerRadii { node_id, new_radii };

        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        let after = match &doc.arena.get(node_id).expect("get").kind {
            NodeKind::Rectangle { corner_radii } => *corner_radii,
            _ => panic!("expected Rectangle"),
        };
        assert_eq!(after, new_radii);
    }

    #[test]
    fn test_set_corner_radii_rejects_nan() {
        let (doc, node_id) = setup_doc_with_rect();
        let op = SetCornerRadii {
            node_id,
            new_radii: [f64::NAN, 0.0, 0.0, 0.0],
        };
        assert!(op.validate(&doc).is_err());

        let op2 = SetCornerRadii {
            node_id,
            new_radii: [0.0, 0.0, 0.0, f64::NAN],
        };
        assert!(op2.validate(&doc).is_err());
    }

    #[test]
    fn test_set_corner_radii_rejects_negative() {
        let (doc, node_id) = setup_doc_with_rect();
        let op = SetCornerRadii {
            node_id,
            new_radii: [4.0, -1.0, 4.0, 4.0],
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_set_corner_radii_on_non_rectangle_fails() {
        let (doc, frame_id) = setup_doc_with_frame();
        let op = SetCornerRadii {
            node_id: frame_id,
            new_radii: [4.0; 4],
        };
        assert!(op.validate(&doc).is_err());
    }
}
