// crates/core/src/commands/style_commands.rs
#![allow(clippy::unnecessary_literal_bound)]

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::{BlendMode, Constraints, Effect, Fill, Stroke, StyleValue, Transform};
use crate::validate::{MAX_EFFECTS_PER_STYLE, MAX_FILLS_PER_STYLE, MAX_STROKES_PER_STYLE};

fn validate_transform(t: &Transform) -> Result<(), CoreError> {
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
    /// The previous transform (for undo).
    pub old_transform: Transform,
}

impl Command for SetTransform {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_transform(&self.new_transform)?;
        doc.arena.get_mut(self.node_id)?.transform = self.new_transform;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.transform = self.old_transform;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set transform"
    }
}

/// Replaces a node's entire fills array.
#[derive(Debug)]
pub struct SetFills {
    /// The target node.
    pub node_id: NodeId,
    /// The new fills to apply.
    pub new_fills: Vec<Fill>,
    /// The previous fills (for undo).
    pub old_fills: Vec<Fill>,
}

impl Command for SetFills {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.new_fills.len() > MAX_FILLS_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many fills: {} (max {MAX_FILLS_PER_STYLE})",
                self.new_fills.len()
            )));
        }
        doc.arena
            .get_mut(self.node_id)?
            .style
            .fills
            .clone_from(&self.new_fills);
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena
            .get_mut(self.node_id)?
            .style
            .fills
            .clone_from(&self.old_fills);
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set fills"
    }
}

/// Replaces a node's entire strokes array.
#[derive(Debug)]
pub struct SetStrokes {
    /// The target node.
    pub node_id: NodeId,
    /// The new strokes to apply.
    pub new_strokes: Vec<Stroke>,
    /// The previous strokes (for undo).
    pub old_strokes: Vec<Stroke>,
}

impl Command for SetStrokes {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.new_strokes.len() > MAX_STROKES_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many strokes: {} (max {MAX_STROKES_PER_STYLE})",
                self.new_strokes.len()
            )));
        }
        doc.arena
            .get_mut(self.node_id)?
            .style
            .strokes
            .clone_from(&self.new_strokes);
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena
            .get_mut(self.node_id)?
            .style
            .strokes
            .clone_from(&self.old_strokes);
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set strokes"
    }
}

/// Sets a node's opacity.
#[derive(Debug)]
pub struct SetOpacity {
    /// The target node.
    pub node_id: NodeId,
    /// The new opacity value.
    pub new_opacity: StyleValue<f64>,
    /// The previous opacity value (for undo).
    pub old_opacity: StyleValue<f64>,
}

impl Command for SetOpacity {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if let StyleValue::Literal { value } = &self.new_opacity
            && (!value.is_finite() || *value < 0.0 || *value > 1.0)
        {
            return Err(CoreError::ValidationError(format!(
                "opacity must be in [0.0, 1.0], got {value}"
            )));
        }
        doc.arena.get_mut(self.node_id)?.style.opacity = self.new_opacity.clone();
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.opacity = self.old_opacity.clone();
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set opacity"
    }
}

/// Sets a node's blend mode.
#[derive(Debug)]
pub struct SetBlendMode {
    /// The target node.
    pub node_id: NodeId,
    /// The new blend mode.
    pub new_blend_mode: BlendMode,
    /// The previous blend mode (for undo).
    pub old_blend_mode: BlendMode,
}

impl Command for SetBlendMode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.blend_mode = self.new_blend_mode;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.blend_mode = self.old_blend_mode;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set blend mode"
    }
}

/// Replaces a node's entire effects array.
#[derive(Debug)]
pub struct SetEffects {
    /// The target node.
    pub node_id: NodeId,
    /// The new effects to apply.
    pub new_effects: Vec<Effect>,
    /// The previous effects (for undo).
    pub old_effects: Vec<Effect>,
}

impl Command for SetEffects {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.new_effects.len() > MAX_EFFECTS_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many effects: {} (max {MAX_EFFECTS_PER_STYLE})",
                self.new_effects.len()
            )));
        }
        doc.arena
            .get_mut(self.node_id)?
            .style
            .effects
            .clone_from(&self.new_effects);
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena
            .get_mut(self.node_id)?
            .style
            .effects
            .clone_from(&self.old_effects);
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set effects"
    }
}

/// Sets a node's constraints.
#[derive(Debug)]
pub struct SetConstraints {
    /// The target node.
    pub node_id: NodeId,
    /// The new constraints.
    pub new_constraints: Constraints,
    /// The previous constraints (for undo).
    pub old_constraints: Constraints,
}

impl Command for SetConstraints {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.constraints = self.new_constraints;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.constraints = self.old_constraints;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set constraints"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::id::NodeId;
    use crate::node::{Color, Node, NodeKind, PinConstraint};
    use uuid::Uuid;

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
    fn test_set_transform_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let old = doc.arena.get(node_id).unwrap().transform;
        let new = Transform {
            x: 50.0,
            y: 100.0,
            width: 200.0,
            height: 300.0,
            rotation: 45.0,
            scale_x: 2.0,
            scale_y: 2.0,
        };

        let cmd = SetTransform {
            node_id,
            new_transform: new,
            old_transform: old,
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().transform.x, 50.0);
        assert_eq!(doc.arena.get(node_id).unwrap().transform.rotation, 45.0);

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.arena.get(node_id).unwrap().transform.x, old.x);
    }

    // ── SetFills ────────────────────────────────────────────────────

    #[test]
    fn test_set_fills_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let old_fills = doc.arena.get(node_id).unwrap().style.fills.clone();
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

        let cmd = SetFills {
            node_id,
            new_fills: new_fills.clone(),
            old_fills: old_fills.clone(),
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.fills.len(), 1);

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.arena.get(node_id).unwrap().style.fills, old_fills);
    }

    #[test]
    fn test_set_fills_validates_max() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let too_many: Vec<Fill> = (0..MAX_FILLS_PER_STYLE + 1)
            .map(|_| Fill::Solid {
                color: StyleValue::Literal {
                    value: Color::default(),
                },
            })
            .collect();

        let cmd = SetFills {
            node_id,
            new_fills: too_many,
            old_fills: vec![],
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── SetStrokes ──────────────────────────────────────────────────

    #[test]
    fn test_set_strokes_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_strokes = vec![Stroke::default()];

        let cmd = SetStrokes {
            node_id,
            new_strokes: new_strokes.clone(),
            old_strokes: vec![],
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.strokes.len(), 1);

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.arena.get(node_id).unwrap().style.strokes.is_empty());
    }

    // ── SetOpacity ──────────────────────────────────────────────────

    #[test]
    fn test_set_opacity_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();

        let cmd = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: 0.5 },
            old_opacity: StyleValue::Literal { value: 1.0 },
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.opacity,
            StyleValue::Literal { value: 0.5 }
        );

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.opacity,
            StyleValue::Literal { value: 1.0 }
        );
    }

    // ── SetBlendMode ────────────────────────────────────────────────

    #[test]
    fn test_set_blend_mode_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();

        let cmd = SetBlendMode {
            node_id,
            new_blend_mode: BlendMode::Multiply,
            old_blend_mode: BlendMode::Normal,
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.blend_mode,
            BlendMode::Multiply
        );

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.blend_mode,
            BlendMode::Normal
        );
    }

    // ── SetEffects ──────────────────────────────────────────────────

    #[test]
    fn test_set_effects_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_effects = vec![Effect::LayerBlur {
            radius: StyleValue::Literal { value: 10.0 },
        }];

        let cmd = SetEffects {
            node_id,
            new_effects: new_effects.clone(),
            old_effects: vec![],
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.effects.len(), 1);

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.arena.get(node_id).unwrap().style.effects.is_empty());
    }

    #[test]
    fn test_set_effects_validates_max() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let too_many: Vec<Effect> = (0..MAX_EFFECTS_PER_STYLE + 1)
            .map(|_| Effect::LayerBlur {
                radius: StyleValue::Literal { value: 1.0 },
            })
            .collect();

        let cmd = SetEffects {
            node_id,
            new_effects: too_many,
            old_effects: vec![],
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── SetConstraints ──────────────────────────────────────────────

    #[test]
    fn test_set_constraints_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let old = doc.arena.get(node_id).unwrap().constraints;
        let new = Constraints {
            horizontal: PinConstraint::Center,
            vertical: PinConstraint::Scale,
        };

        let cmd = SetConstraints {
            node_id,
            new_constraints: new,
            old_constraints: old,
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().constraints.horizontal,
            PinConstraint::Center
        );

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(
            doc.arena.get(node_id).unwrap().constraints.horizontal,
            PinConstraint::Start
        );
    }

    // ── SetOpacity validation ──────────────────────────────────────

    #[test]
    fn test_set_opacity_validates_range() {
        let (mut doc, node_id) = setup_doc_with_rect();

        let cmd = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: 1.5 },
            old_opacity: StyleValue::Literal { value: 1.0 },
        };
        assert!(cmd.apply(&mut doc).is_err());

        let cmd_neg = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: -0.1 },
            old_opacity: StyleValue::Literal { value: 1.0 },
        };
        assert!(cmd_neg.apply(&mut doc).is_err());
    }

    #[test]
    fn test_set_opacity_rejects_nan() {
        let (mut doc, node_id) = setup_doc_with_rect();

        let cmd = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: f64::NAN },
            old_opacity: StyleValue::Literal { value: 1.0 },
        };
        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── SetTransform validation ────────────────────────────────────

    #[test]
    fn test_set_transform_rejects_nan() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let old = doc.arena.get(node_id).unwrap().transform;

        let mut bad = old;
        bad.x = f64::NAN;
        let cmd = SetTransform {
            node_id,
            new_transform: bad,
            old_transform: old,
        };
        assert!(cmd.apply(&mut doc).is_err());

        let mut bad_inf = old;
        bad_inf.y = f64::INFINITY;
        let cmd_inf = SetTransform {
            node_id,
            new_transform: bad_inf,
            old_transform: old,
        };
        assert!(cmd_inf.apply(&mut doc).is_err());
    }

    #[test]
    fn test_set_transform_rejects_negative_dimensions() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let old = doc.arena.get(node_id).unwrap().transform;

        let mut bad = old;
        bad.width = -10.0;
        let cmd = SetTransform {
            node_id,
            new_transform: bad,
            old_transform: old,
        };
        assert!(cmd.apply(&mut doc).is_err());

        let mut bad_h = old;
        bad_h.height = -1.0;
        let cmd_h = SetTransform {
            node_id,
            new_transform: bad_h,
            old_transform: old,
        };
        assert!(cmd_h.apply(&mut doc).is_err());
    }
}
