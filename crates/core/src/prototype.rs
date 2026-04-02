// crates/core/src/prototype.rs

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::CoreError;
use crate::id::{NodeId, PageId};
use crate::validate::MAX_TRANSITION_DURATION;

/// Direction for slide/push transition animations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlideDirection {
    Left,
    Right,
    Up,
    Down,
}

/// What triggers a transition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransitionTrigger {
    /// Triggered on click/tap.
    OnClick,
    /// Triggered on drag.
    OnDrag,
    /// Triggered on hover.
    OnHover,
    /// Triggered after a delay in seconds.
    AfterDelay { seconds: f64 },
}

/// Animation style for a transition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransitionAnimation {
    /// Instant transition with no animation.
    Instant,
    /// Cross-fade dissolve.
    Dissolve { duration: f64 },
    /// Slide in from a direction.
    SlideIn {
        direction: SlideDirection,
        duration: f64,
    },
    /// Slide out to a direction.
    SlideOut {
        direction: SlideDirection,
        duration: f64,
    },
    /// Push content in a direction.
    Push {
        direction: SlideDirection,
        duration: f64,
    },
}

/// A prototype transition between frames/pages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    /// Unique identifier for this transition.
    pub id: Uuid,
    /// The node that triggers the transition.
    pub source_node: NodeId,
    /// The page to navigate to.
    pub target_page: PageId,
    /// Optional specific node to scroll to on the target page.
    pub target_node: Option<NodeId>,
    /// What triggers the transition.
    pub trigger: TransitionTrigger,
    /// How the transition animates.
    pub animation: TransitionAnimation,
}

/// Validates a transition duration.
///
/// # Errors
/// Returns `CoreError::ValidationError` if duration is negative, NaN, infinity,
/// or exceeds the maximum.
pub fn validate_duration(duration: f64) -> Result<(), CoreError> {
    if !duration.is_finite() || duration < 0.0 {
        return Err(CoreError::ValidationError(format!(
            "duration must be non-negative and finite, got {duration}"
        )));
    }
    if duration > MAX_TRANSITION_DURATION {
        return Err(CoreError::ValidationError(format!(
            "duration {duration}s exceeds maximum {MAX_TRANSITION_DURATION}s"
        )));
    }
    Ok(())
}

/// Validates a transition's timing values.
///
/// # Errors
/// Returns `CoreError::ValidationError` if any duration or delay is invalid.
pub fn validate_transition(transition: &Transition) -> Result<(), CoreError> {
    // Validate trigger
    if let TransitionTrigger::AfterDelay { seconds } = &transition.trigger {
        validate_duration(*seconds)?;
    }

    // Validate animation durations
    match &transition.animation {
        TransitionAnimation::Instant => {}
        TransitionAnimation::Dissolve { duration }
        | TransitionAnimation::SlideIn { duration, .. }
        | TransitionAnimation::SlideOut { duration, .. }
        | TransitionAnimation::Push { duration, .. } => {
            validate_duration(*duration)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_transition() -> Transition {
        Transition {
            id: Uuid::nil(),
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(Uuid::nil()),
            target_node: None,
            trigger: TransitionTrigger::OnClick,
            animation: TransitionAnimation::Instant,
        }
    }

    #[test]
    fn test_transition_basic_construction() {
        let t = make_transition();
        assert_eq!(t.trigger, TransitionTrigger::OnClick);
        assert_eq!(t.animation, TransitionAnimation::Instant);
    }

    #[test]
    fn test_transition_serde_round_trip_instant() {
        let t = make_transition();
        let json = serde_json::to_string(&t).expect("serialize");
        let deserialized: Transition = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(t, deserialized);
    }

    #[test]
    fn test_transition_serde_round_trip_dissolve() {
        let t = Transition {
            animation: TransitionAnimation::Dissolve { duration: 0.3 },
            ..make_transition()
        };
        let json = serde_json::to_string(&t).expect("serialize");
        let deserialized: Transition = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(t, deserialized);
    }

    #[test]
    fn test_transition_serde_round_trip_slide() {
        let t = Transition {
            animation: TransitionAnimation::SlideIn {
                direction: SlideDirection::Right,
                duration: 0.5,
            },
            trigger: TransitionTrigger::AfterDelay { seconds: 2.0 },
            ..make_transition()
        };
        let json = serde_json::to_string(&t).expect("serialize");
        let deserialized: Transition = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(t, deserialized);
    }

    #[test]
    fn test_transition_trigger_serde() {
        let triggers = vec![
            TransitionTrigger::OnClick,
            TransitionTrigger::OnDrag,
            TransitionTrigger::OnHover,
            TransitionTrigger::AfterDelay { seconds: 1.5 },
        ];
        for trigger in triggers {
            let json = serde_json::to_string(&trigger).expect("serialize");
            let deserialized: TransitionTrigger = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(trigger, deserialized);
        }
    }

    #[test]
    fn test_validate_duration_valid() {
        assert!(validate_duration(0.0).is_ok());
        assert!(validate_duration(1.5).is_ok());
        assert!(validate_duration(300.0).is_ok());
    }

    #[test]
    fn test_validate_duration_negative() {
        assert!(validate_duration(-1.0).is_err());
    }

    #[test]
    fn test_validate_duration_nan() {
        assert!(validate_duration(f64::NAN).is_err());
    }

    #[test]
    fn test_validate_duration_infinity() {
        assert!(validate_duration(f64::INFINITY).is_err());
    }

    #[test]
    fn test_validate_duration_exceeds_max() {
        assert!(validate_duration(301.0).is_err());
    }

    #[test]
    fn test_validate_transition_valid() {
        let t = Transition {
            animation: TransitionAnimation::Dissolve { duration: 0.5 },
            trigger: TransitionTrigger::AfterDelay { seconds: 2.0 },
            ..make_transition()
        };
        assert!(validate_transition(&t).is_ok());
    }

    #[test]
    fn test_validate_transition_bad_delay() {
        let t = Transition {
            trigger: TransitionTrigger::AfterDelay { seconds: -1.0 },
            ..make_transition()
        };
        assert!(validate_transition(&t).is_err());
    }

    #[test]
    fn test_validate_transition_bad_animation_duration() {
        let t = Transition {
            animation: TransitionAnimation::Push {
                direction: SlideDirection::Left,
                duration: f64::NAN,
            },
            ..make_transition()
        };
        assert!(validate_transition(&t).is_err());
    }

    #[test]
    fn test_slide_direction_serde() {
        let directions = vec![
            SlideDirection::Left,
            SlideDirection::Right,
            SlideDirection::Up,
            SlideDirection::Down,
        ];
        for dir in directions {
            let json = serde_json::to_string(&dir).expect("serialize");
            let deserialized: SlideDirection = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(dir, deserialized);
        }
    }
}
