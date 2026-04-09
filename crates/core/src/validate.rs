// crates/core/src/validate.rs

use crate::error::CoreError;

// ── Constants ──────────────────────────────────────────────────────────

/// Maximum length of a node name.
pub const MAX_NODE_NAME_LEN: usize = 512;

/// Maximum length of text content in a Text node.
pub const MAX_TEXT_CONTENT_LEN: usize = 1_000_000;

/// Maximum length of a token name.
pub const MAX_TOKEN_NAME_LEN: usize = 256;

/// Maximum length of an asset reference path.
pub const MAX_ASSET_REF_LEN: usize = 256;

/// Maximum children per node.
pub const MAX_CHILDREN_PER_NODE: usize = 10_000;

/// Maximum fills per style.
pub const MAX_FILLS_PER_STYLE: usize = 32;

/// Maximum strokes per style.
pub const MAX_STROKES_PER_STYLE: usize = 32;

/// Maximum effects per style.
pub const MAX_EFFECTS_PER_STYLE: usize = 32;

/// Maximum segments per subpath.
pub const MAX_SEGMENTS_PER_SUBPATH: usize = 100_000;

/// Maximum subpaths per path.
pub const MAX_SUBPATHS_PER_PATH: usize = 1_000;

/// Maximum JSON nesting depth for deserialization.
pub const MAX_JSON_NESTING_DEPTH: usize = 128;

/// Maximum file size for deserialization (50 MB).
pub const MAX_FILE_SIZE: usize = 50 * 1024 * 1024;

/// Default maximum nodes in the arena.
pub const DEFAULT_MAX_NODES: usize = 100_000;

/// Current schema version for serialization.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Maximum alias chain depth for token resolution.
pub const MAX_ALIAS_CHAIN_DEPTH: usize = 16;

/// Maximum gradient stops per gradient definition.
pub const MAX_GRADIENT_STOPS: usize = 256;

/// Maximum length of a font family name.
pub const MAX_FONT_FAMILY_LEN: usize = 256;

/// Maximum length of a page name.
pub const MAX_PAGE_NAME_LEN: usize = 256;

/// Maximum pages per document.
pub const MAX_PAGES_PER_DOCUMENT: usize = 100;

/// Maximum number of tokens per document.
pub const MAX_TOKENS_PER_CONTEXT: usize = 50_000;

/// Maximum description length for a token.
pub const MAX_TOKEN_DESCRIPTION_LEN: usize = 1_024;

/// Maximum number of font families in a `FontFamily` token.
pub const MAX_TOKEN_FONT_FAMILIES: usize = 32;

/// Maximum root nodes per page.
pub const MAX_ROOT_NODES_PER_PAGE: usize = 10_000;

/// Maximum variants per component definition.
pub const MAX_VARIANTS_PER_COMPONENT: usize = 100;

/// Maximum properties per component definition.
pub const MAX_PROPERTIES_PER_COMPONENT: usize = 100;

/// Maximum overrides per component instance.
pub const MAX_OVERRIDES_PER_INSTANCE: usize = 10_000;

/// Maximum components per document.
pub const MAX_COMPONENTS_PER_DOCUMENT: usize = 10_000;

/// Maximum number of points in a polyline approximation for boolean operations.
pub const MAX_BOOLEAN_OP_POINTS: usize = 1_000_000;

/// Number of segments to approximate a cubic bezier curve for boolean operations.
pub const BEZIER_APPROXIMATION_SEGMENTS: usize = 16;

/// Maximum grid tracks (columns or rows) per grid layout.
pub const MAX_GRID_TRACKS: usize = 1_000;

/// Maximum transition duration in seconds.
pub const MAX_TRANSITION_DURATION: f64 = 300.0;

/// Maximum transitions per document.
pub const MAX_TRANSITIONS_PER_DOCUMENT: usize = 10_000;

/// Maximum number of entries in a batch transform operation.
pub const MAX_BATCH_SIZE: usize = 256;

/// Minimum number of nodes required to form a group.
pub const MIN_GROUP_MEMBERS: usize = 2;

/// Maximum font weight value (CSS range).
pub const MAX_FONT_WEIGHT: u16 = 1000;

/// Minimum font weight value (CSS range).
pub const MIN_FONT_WEIGHT: u16 = 1;

/// Minimum font size in pixels.
pub const MIN_FONT_SIZE: f64 = 0.1;

/// Maximum font size in pixels.
pub const MAX_FONT_SIZE: f64 = 10_000.0;

/// Maximum number of JSON elements (values) to visit during float validation.
/// Prevents unbounded traversal of adversarially large JSON payloads.
/// Set high enough to accommodate legitimate max-sized paths
/// (`MAX_SEGMENTS_PER_SUBPATH` segments x ~10 fields each).
pub const MAX_JSON_VALIDATION_ELEMENTS: usize = 2_000_000;

/// Maximum byte length of a JSON field value string before parsing (1 MB).
pub const MAX_FIELD_VALUE_SIZE: usize = 1_024 * 1_024;

/// Maximum length of a `user_id` string.
pub const MAX_USER_ID_LEN: usize = 128;

// ── Validation Functions ───────────────────────────────────────────────

/// Validates that a float value is finite (not NaN or infinity).
///
/// # Errors
/// Returns `CoreError::ValidationError` if the value is not finite.
pub fn validate_finite(name: &str, value: f64) -> Result<(), CoreError> {
    if !value.is_finite() {
        return Err(CoreError::ValidationError(format!(
            "{name} must be finite, got {value}"
        )));
    }
    Ok(())
}

/// Recursively walks a JSON value and rejects any Number that converts to NaN or infinity.
///
/// Uses an iterative approach with an explicit stack to prevent stack overflow.
///
/// # Errors
/// Returns `CoreError::ValidationError` if any float value is non-finite.
pub fn validate_floats_in_value(value: &serde_json::Value) -> Result<(), CoreError> {
    let mut stack = vec![value];
    let mut visited: usize = 0;

    while let Some(v) = stack.pop() {
        visited += 1;
        if visited >= MAX_JSON_VALIDATION_ELEMENTS {
            return Err(CoreError::ValidationError(format!(
                "JSON value exceeds maximum of {MAX_JSON_VALIDATION_ELEMENTS} elements"
            )));
        }
        match v {
            serde_json::Value::Number(n) => {
                if let Some(f) = n.as_f64()
                    && !f.is_finite()
                {
                    return Err(CoreError::ValidationError(format!(
                        "non-finite float value: {f}"
                    )));
                }
            }
            serde_json::Value::Array(arr) => {
                for item in arr {
                    stack.push(item);
                }
            }
            serde_json::Value::Object(map) => {
                for child in map.values() {
                    stack.push(child);
                }
            }
            _ => {}
        }
    }

    Ok(())
}

/// Validates a node name: max 512 chars, no control characters (U+0000-U+001F).
///
/// # Errors
/// Returns `CoreError::ValidationError` if the name is empty, too long, or contains control characters.
pub fn validate_node_name(name: &str) -> Result<(), CoreError> {
    if name.is_empty() {
        return Err(CoreError::ValidationError(
            "node name must not be empty".to_string(),
        ));
    }
    if name.len() > MAX_NODE_NAME_LEN {
        return Err(CoreError::ValidationError(format!(
            "node name exceeds max length of {MAX_NODE_NAME_LEN} characters (got {})",
            name.len()
        )));
    }
    if let Some(pos) = name.find(|c: char| c.is_control()) {
        return Err(CoreError::ValidationError(format!(
            "node name contains control character at byte position {pos}"
        )));
    }
    Ok(())
}

/// Validates a page name: max 256 chars, non-empty, no control characters (U+0000-U+001F).
///
/// # Errors
/// Returns `CoreError::ValidationError` if the name is empty, too long, or contains control characters.
pub fn validate_page_name(name: &str) -> Result<(), CoreError> {
    if name.is_empty() {
        return Err(CoreError::ValidationError(
            "page name must not be empty".to_string(),
        ));
    }
    if name.len() > MAX_PAGE_NAME_LEN {
        return Err(CoreError::ValidationError(format!(
            "page name exceeds max length of {MAX_PAGE_NAME_LEN} characters (got {})",
            name.len()
        )));
    }
    if let Some(pos) = name.find(|c: char| c.is_control()) {
        return Err(CoreError::ValidationError(format!(
            "page name contains control character at byte position {pos}"
        )));
    }
    Ok(())
}

/// Validates text content: max 1,000,000 chars.
///
/// # Errors
/// Returns `CoreError::InputTooLarge` if the content exceeds the limit.
pub fn validate_text_content(content: &str) -> Result<(), CoreError> {
    if content.len() > MAX_TEXT_CONTENT_LEN {
        return Err(CoreError::InputTooLarge(format!(
            "text content exceeds max length of {MAX_TEXT_CONTENT_LEN} characters (got {})",
            content.len()
        )));
    }
    Ok(())
}

/// Validates a token name: must match `[a-zA-Z][a-zA-Z0-9._-]*`, max 256 chars.
///
/// # Errors
/// Returns `CoreError::InvalidTokenName` if the name does not match the required pattern.
pub fn validate_token_name(name: &str) -> Result<(), CoreError> {
    if name.is_empty() {
        return Err(CoreError::InvalidTokenName(
            "token name must not be empty".to_string(),
        ));
    }
    if name.len() > MAX_TOKEN_NAME_LEN {
        return Err(CoreError::InvalidTokenName(format!(
            "token name exceeds max length of {MAX_TOKEN_NAME_LEN} characters (got {})",
            name.len()
        )));
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => {
            return Err(CoreError::InvalidTokenName(format!(
                "token name must start with an ASCII letter: {name}"
            )));
        }
    }
    for c in chars {
        if !c.is_ascii_alphanumeric() && c != '.' && c != '_' && c != '-' {
            return Err(CoreError::InvalidTokenName(format!(
                "token name contains invalid character '{c}': {name}"
            )));
        }
    }
    Ok(())
}

/// Validates an asset reference: must be a relative path with no `..` components, max 256 chars.
///
/// Note: This performs lexical validation only. It does not handle URL-encoded
/// traversal sequences (e.g., `%2e%2e`) or path canonicalization. The server layer
/// must additionally canonicalize and verify paths resolve within the allowed root.
///
/// # Errors
/// Returns `CoreError::ValidationError` if the path is invalid.
pub fn validate_asset_ref(path: &str) -> Result<(), CoreError> {
    if path.is_empty() {
        return Err(CoreError::ValidationError(
            "asset reference must not be empty".to_string(),
        ));
    }
    if path.len() > MAX_ASSET_REF_LEN {
        return Err(CoreError::ValidationError(format!(
            "asset reference exceeds max length of {MAX_ASSET_REF_LEN} characters (got {})",
            path.len()
        )));
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(CoreError::ValidationError(format!(
            "asset reference must be a relative path, not absolute: {path}"
        )));
    }
    // Check for Windows-style absolute paths like C:\
    if path.len() >= 2 && path.as_bytes()[1] == b':' {
        return Err(CoreError::ValidationError(format!(
            "asset reference must be a relative path, not absolute: {path}"
        )));
    }
    for component in path.split('/') {
        if component == ".." {
            return Err(CoreError::ValidationError(format!(
                "asset reference must not contain '..' components: {path}"
            )));
        }
    }
    for component in path.split('\\') {
        if component == ".." {
            return Err(CoreError::ValidationError(format!(
                "asset reference must not contain '..' components: {path}"
            )));
        }
    }
    Ok(())
}

/// Validates that a collection does not exceed a size limit.
///
/// # Errors
/// Returns `CoreError::ValidationError` if the collection exceeds the limit.
pub fn validate_collection_size(
    collection_name: &str,
    actual: usize,
    max: usize,
) -> Result<(), CoreError> {
    if actual > max {
        return Err(CoreError::ValidationError(format!(
            "{collection_name} exceeds maximum of {max} (got {actual})"
        )));
    }
    Ok(())
}

/// Validates a grid track value.
///
/// # Errors
/// Returns `CoreError::ValidationError` if values are non-finite, negative,
/// or `MinMax` has min > max.
pub fn validate_grid_track(track: &crate::node::GridTrack) -> Result<(), CoreError> {
    use crate::node::GridTrack;
    match track {
        GridTrack::Fixed { size } => {
            if !size.is_finite() || *size < 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "grid track fixed size must be non-negative and finite, got {size}"
                )));
            }
        }
        GridTrack::Fractional { fraction } => {
            if !fraction.is_finite() || *fraction < 0.0 {
                return Err(CoreError::ValidationError(format!(
                    "grid track fraction must be non-negative and finite, got {fraction}"
                )));
            }
        }
        GridTrack::Auto => {}
        GridTrack::MinMax { min, max } => {
            if !min.is_finite() || !max.is_finite() || *min < 0.0 || *max < 0.0 {
                return Err(CoreError::ValidationError(
                    "grid track min/max must be non-negative and finite".to_string(),
                ));
            }
            if min > max {
                return Err(CoreError::ValidationError(format!(
                    "grid track min ({min}) must be <= max ({max})"
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Page name validation ───────────────────────────────────────────

    #[test]
    fn test_validate_page_name_valid() {
        assert!(validate_page_name("Home").is_ok());
    }

    #[test]
    fn test_validate_page_name_empty() {
        assert!(validate_page_name("").is_err());
    }

    #[test]
    fn test_validate_page_name_max_length() {
        let name = "a".repeat(MAX_PAGE_NAME_LEN);
        assert!(validate_page_name(&name).is_ok());
    }

    #[test]
    fn test_validate_page_name_too_long() {
        let name = "a".repeat(MAX_PAGE_NAME_LEN + 1);
        assert!(validate_page_name(&name).is_err());
    }

    #[test]
    fn test_validate_page_name_control_char() {
        assert!(validate_page_name("foo\0bar").is_err());
    }

    #[test]
    fn test_validate_page_name_newline() {
        assert!(validate_page_name("foo\nbar").is_err());
    }

    #[test]
    fn test_max_page_name_len_enforced() {
        let at_limit = "a".repeat(MAX_PAGE_NAME_LEN);
        assert!(validate_page_name(&at_limit).is_ok());
        let over_limit = "a".repeat(MAX_PAGE_NAME_LEN + 1);
        assert!(validate_page_name(&over_limit).is_err());
    }

    // ── Node name validation ───────────────────────────────────────────

    #[test]
    fn test_validate_node_name_valid() {
        assert!(validate_node_name("Frame 1").is_ok());
    }

    #[test]
    fn test_validate_node_name_valid_unicode() {
        assert!(validate_node_name("Button").is_ok());
    }

    #[test]
    fn test_validate_node_name_max_length() {
        let name = "a".repeat(MAX_NODE_NAME_LEN);
        assert!(validate_node_name(&name).is_ok());
    }

    #[test]
    fn test_validate_node_name_too_long() {
        let name = "a".repeat(MAX_NODE_NAME_LEN + 1);
        assert!(validate_node_name(&name).is_err());
    }

    #[test]
    fn test_validate_node_name_empty() {
        assert!(validate_node_name("").is_err());
    }

    #[test]
    fn test_validate_node_name_control_char_null() {
        assert!(validate_node_name("foo\0bar").is_err());
    }

    #[test]
    fn test_validate_node_name_control_char_newline() {
        assert!(validate_node_name("foo\nbar").is_err());
    }

    #[test]
    fn test_validate_node_name_control_char_tab() {
        assert!(validate_node_name("foo\tbar").is_err());
    }

    #[test]
    fn test_validate_node_name_control_char_escape() {
        assert!(validate_node_name("foo\x1bbar").is_err());
    }

    // ── Text content validation ────────────────────────────────────────

    #[test]
    fn test_validate_text_content_valid() {
        assert!(validate_text_content("Hello, world!").is_ok());
    }

    #[test]
    fn test_validate_text_content_empty() {
        assert!(validate_text_content("").is_ok());
    }

    #[test]
    fn test_validate_text_content_max_length() {
        let text = "a".repeat(MAX_TEXT_CONTENT_LEN);
        assert!(validate_text_content(&text).is_ok());
    }

    #[test]
    fn test_validate_text_content_too_long() {
        let text = "a".repeat(MAX_TEXT_CONTENT_LEN + 1);
        assert!(validate_text_content(&text).is_err());
    }

    // ── Token name validation ──────────────────────────────────────────

    #[test]
    fn test_validate_token_name_valid_simple() {
        assert!(validate_token_name("color").is_ok());
    }

    #[test]
    fn test_validate_token_name_valid_dotted() {
        assert!(validate_token_name("color.primary.500").is_ok());
    }

    #[test]
    fn test_validate_token_name_valid_with_hyphens() {
        assert!(validate_token_name("font-size-lg").is_ok());
    }

    #[test]
    fn test_validate_token_name_valid_with_underscores() {
        assert!(validate_token_name("spacing_4x").is_ok());
    }

    #[test]
    fn test_validate_token_name_valid_mixed() {
        assert!(validate_token_name("color.brand-primary_500").is_ok());
    }

    #[test]
    fn test_validate_token_name_empty() {
        assert!(validate_token_name("").is_err());
    }

    #[test]
    fn test_validate_token_name_starts_with_digit() {
        assert!(validate_token_name("123color").is_err());
    }

    #[test]
    fn test_validate_token_name_starts_with_dot() {
        assert!(validate_token_name(".color").is_err());
    }

    #[test]
    fn test_validate_token_name_starts_with_hyphen() {
        assert!(validate_token_name("-color").is_err());
    }

    #[test]
    fn test_validate_token_name_contains_space() {
        assert!(validate_token_name("color primary").is_err());
    }

    #[test]
    fn test_validate_token_name_contains_slash() {
        assert!(validate_token_name("color/primary").is_err());
    }

    #[test]
    fn test_validate_token_name_max_length() {
        let name = format!("a{}", "b".repeat(MAX_TOKEN_NAME_LEN - 1));
        assert!(validate_token_name(&name).is_ok());
    }

    #[test]
    fn test_validate_token_name_too_long() {
        let name = format!("a{}", "b".repeat(MAX_TOKEN_NAME_LEN));
        assert!(validate_token_name(&name).is_err());
    }

    // ── Asset ref validation ───────────────────────────────────────────

    #[test]
    fn test_validate_asset_ref_valid_simple() {
        assert!(validate_asset_ref("images/logo.png").is_ok());
    }

    #[test]
    fn test_validate_asset_ref_valid_nested() {
        assert!(validate_asset_ref("assets/icons/check.svg").is_ok());
    }

    #[test]
    fn test_validate_asset_ref_valid_single_file() {
        assert!(validate_asset_ref("photo.jpg").is_ok());
    }

    #[test]
    fn test_validate_asset_ref_empty() {
        assert!(validate_asset_ref("").is_err());
    }

    #[test]
    fn test_validate_asset_ref_absolute_unix() {
        assert!(validate_asset_ref("/etc/passwd").is_err());
    }

    #[test]
    fn test_validate_asset_ref_absolute_windows() {
        assert!(validate_asset_ref("C:\\Windows\\system32").is_err());
    }

    #[test]
    fn test_validate_asset_ref_parent_traversal() {
        assert!(validate_asset_ref("../../../etc/passwd").is_err());
    }

    #[test]
    fn test_validate_asset_ref_parent_traversal_middle() {
        assert!(validate_asset_ref("images/../../../etc/passwd").is_err());
    }

    #[test]
    fn test_validate_asset_ref_backslash_parent_traversal() {
        assert!(validate_asset_ref("images\\..\\..\\secret").is_err());
    }

    #[test]
    fn test_validate_asset_ref_too_long() {
        let path = "a".repeat(MAX_ASSET_REF_LEN + 1);
        assert!(validate_asset_ref(&path).is_err());
    }

    #[test]
    fn test_validate_asset_ref_max_length() {
        let path = "a".repeat(MAX_ASSET_REF_LEN);
        assert!(validate_asset_ref(&path).is_ok());
    }

    // ── Collection size validation ─────────────────────────────────────

    #[test]
    fn test_validate_collection_size_within_limit() {
        assert!(validate_collection_size("children", 100, MAX_CHILDREN_PER_NODE).is_ok());
    }

    #[test]
    fn test_validate_collection_size_at_limit() {
        assert!(
            validate_collection_size("children", MAX_CHILDREN_PER_NODE, MAX_CHILDREN_PER_NODE)
                .is_ok()
        );
    }

    #[test]
    fn test_validate_collection_size_exceeds_limit() {
        assert!(
            validate_collection_size("children", MAX_CHILDREN_PER_NODE + 1, MAX_CHILDREN_PER_NODE)
                .is_err()
        );
    }

    #[test]
    fn test_validate_collection_size_zero() {
        assert!(validate_collection_size("fills", 0, MAX_FILLS_PER_STYLE).is_ok());
    }

    // ── Grid track validation ─────────────────────────────────────────

    #[test]
    fn test_validate_grid_track_fixed_valid() {
        use crate::node::GridTrack;
        assert!(validate_grid_track(&GridTrack::Fixed { size: 100.0 }).is_ok());
    }

    #[test]
    fn test_validate_grid_track_fixed_negative() {
        use crate::node::GridTrack;
        assert!(validate_grid_track(&GridTrack::Fixed { size: -1.0 }).is_err());
    }

    #[test]
    fn test_validate_grid_track_fixed_nan() {
        use crate::node::GridTrack;
        assert!(validate_grid_track(&GridTrack::Fixed { size: f64::NAN }).is_err());
    }

    #[test]
    fn test_validate_grid_track_fractional_valid() {
        use crate::node::GridTrack;
        assert!(validate_grid_track(&GridTrack::Fractional { fraction: 1.0 }).is_ok());
    }

    #[test]
    fn test_validate_grid_track_fractional_negative() {
        use crate::node::GridTrack;
        assert!(validate_grid_track(&GridTrack::Fractional { fraction: -0.5 }).is_err());
    }

    #[test]
    fn test_validate_grid_track_fractional_infinity() {
        use crate::node::GridTrack;
        assert!(
            validate_grid_track(&GridTrack::Fractional {
                fraction: f64::INFINITY
            })
            .is_err()
        );
    }

    #[test]
    fn test_validate_grid_track_minmax_valid() {
        use crate::node::GridTrack;
        assert!(
            validate_grid_track(&GridTrack::MinMax {
                min: 50.0,
                max: 200.0,
            })
            .is_ok()
        );
    }

    #[test]
    fn test_validate_grid_track_minmax_inverted() {
        use crate::node::GridTrack;
        assert!(
            validate_grid_track(&GridTrack::MinMax {
                min: 200.0,
                max: 50.0,
            })
            .is_err()
        );
    }

    #[test]
    fn test_validate_grid_track_minmax_nan() {
        use crate::node::GridTrack;
        assert!(
            validate_grid_track(&GridTrack::MinMax {
                min: f64::NAN,
                max: 100.0,
            })
            .is_err()
        );
    }

    #[test]
    fn test_validate_grid_track_minmax_negative() {
        use crate::node::GridTrack;
        assert!(
            validate_grid_track(&GridTrack::MinMax {
                min: -10.0,
                max: 100.0,
            })
            .is_err()
        );
    }

    #[test]
    fn test_validate_grid_track_auto() {
        use crate::node::GridTrack;
        assert!(validate_grid_track(&GridTrack::Auto).is_ok());
    }

    // ── Float validation ─────────────────────────────────────────────

    #[test]
    fn test_validate_finite_accepts_normal_float() {
        assert!(validate_finite("x", 42.0).is_ok());
    }

    #[test]
    fn test_validate_finite_accepts_zero() {
        assert!(validate_finite("x", 0.0).is_ok());
    }

    #[test]
    fn test_validate_finite_accepts_negative() {
        assert!(validate_finite("x", -1.0).is_ok());
    }

    #[test]
    fn test_validate_finite_rejects_nan() {
        assert!(validate_finite("x", f64::NAN).is_err());
    }

    #[test]
    fn test_validate_finite_rejects_positive_infinity() {
        assert!(validate_finite("x", f64::INFINITY).is_err());
    }

    #[test]
    fn test_validate_finite_rejects_negative_infinity() {
        assert!(validate_finite("x", f64::NEG_INFINITY).is_err());
    }

    #[test]
    fn test_validate_floats_in_value_accepts_integer() {
        let v = serde_json::json!(42);
        assert!(validate_floats_in_value(&v).is_ok());
    }

    #[test]
    fn test_validate_floats_in_value_accepts_normal_float() {
        let v = serde_json::json!(3.14);
        assert!(validate_floats_in_value(&v).is_ok());
    }

    #[test]
    fn test_validate_floats_in_value_accepts_string() {
        let v = serde_json::json!("hello");
        assert!(validate_floats_in_value(&v).is_ok());
    }

    #[test]
    fn test_validate_floats_in_value_accepts_nested_object() {
        let v = serde_json::json!({"a": {"b": 1.0, "c": [2.0, 3.0]}});
        assert!(validate_floats_in_value(&v).is_ok());
    }

    #[test]
    fn test_validate_floats_in_value_accepts_null() {
        let v = serde_json::json!(null);
        assert!(validate_floats_in_value(&v).is_ok());
    }

    #[test]
    fn test_validate_floats_in_value_accepts_bool() {
        let v = serde_json::json!(true);
        assert!(validate_floats_in_value(&v).is_ok());
    }

    // ── RF-014: iteration limit enforcement ─────────────────────────

    #[test]
    fn test_max_json_validation_elements_enforced() {
        // Build a JSON array with more elements than the limit.
        // Use a nested structure to keep memory manageable while exceeding
        // the element count: 2001 arrays of 1000 elements each = 2,001,000 + 2001 containers.
        let inner: Vec<serde_json::Value> = (0..1000).map(|i| serde_json::json!(i)).collect();
        let outers: Vec<serde_json::Value> = (0..=MAX_JSON_VALIDATION_ELEMENTS / 1000)
            .map(|_| serde_json::Value::Array(inner.clone()))
            .collect();
        let v = serde_json::Value::Array(outers);
        let result = validate_floats_in_value(&v);
        assert!(
            result.is_err(),
            "should reject JSON exceeding element limit"
        );
    }

    #[test]
    fn test_validate_floats_in_value_within_limit_accepted() {
        // A modest-sized JSON should be fine
        let elements: Vec<serde_json::Value> = (0..100).map(|i| serde_json::json!(i)).collect();
        let v = serde_json::Value::Array(elements);
        assert!(validate_floats_in_value(&v).is_ok());
    }

    // ── MIN_FONT_SIZE / MAX_FONT_SIZE constant definitions ────────────
    // Enforcement is tested in node.rs via Node::new validation.
    // These tests verify the constant values are within sensible ranges.

    #[test]
    fn test_min_font_size_value() {
        assert!(
            MIN_FONT_SIZE > 0.0,
            "MIN_FONT_SIZE must be positive, got {MIN_FONT_SIZE}"
        );
    }

    #[test]
    fn test_max_font_size_value() {
        assert!(
            MAX_FONT_SIZE > MIN_FONT_SIZE,
            "MAX_FONT_SIZE must be greater than MIN_FONT_SIZE"
        );
    }
}
