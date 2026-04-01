# Core Engine Foundation — Implementation Plan (01a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the core data model, arena, node types, tree operations, document struct, and JSON serialization for the Sigil design engine.

**Architecture:** Arena-based node storage with generational IDs, hierarchical tree with cycle detection, JSON serialization with schema versioning and validation limits. Pure logic, no I/O, WASM-compatible.

**Tech Stack:** Rust 1.94.1 (edition 2024), serde, serde_json, uuid (no v4), thiserror

---

## Task 1: Update Cargo.toml dependencies

**Files:**
- Modify: `/Volumes/projects/Personal/agent-designer/crates/core/Cargo.toml`

The workspace `uuid` dependency includes `v4` which pulls in `getrandom` — incompatible with `wasm32-unknown-unknown`. The core crate must override this to use only the `serde` feature.

- [ ] 1. Update `crates/core/Cargo.toml` to override the workspace uuid dependency:

```toml
[package]
name = "agent-designer-core"
version.workspace = true
edition.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
uuid = { version = "1.23.0", default-features = false, features = ["serde"] }
thiserror = { workspace = true }

[dev-dependencies]
assert_matches = { workspace = true }
```

- [ ] 2. Verify it compiles:

```bash
./dev.sh cargo build -p agent-designer-core
```

Expected: compiles with no errors.

- [ ] 3. Run existing tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: `version_is_set` test passes.

- [ ] 4. Commit:

```bash
git add crates/core/Cargo.toml
git commit -m "feat(core): override uuid dep to exclude v4 for WASM compat (spec-01)"
```

---

## Task 2: Error types (`error.rs`)

**Files:**
- Create: `crates/core/src/error.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Write tests first in `error.rs`:

```rust
// crates/core/src/error.rs

use std::fmt;
use uuid::Uuid;

/// Generational arena index for internal node references.
/// Defined here to break circular dependency — `id.rs` will re-export and extend.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId {
    pub(crate) index: u32,
    pub(crate) generation: u64,
}

impl fmt::Debug for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NodeId({}:gen{})", self.index, self.generation)
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NodeId({}:gen{})", self.index, self.generation)
    }
}

/// Unique identifier for a component definition.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct ComponentId(pub(crate) Uuid);

impl fmt::Debug for ComponentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ComponentId({})", self.0)
    }
}

impl fmt::Display for ComponentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Unique identifier for a design token.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct TokenId(pub(crate) Uuid);

impl fmt::Debug for TokenId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "TokenId({})", self.0)
    }
}

impl fmt::Display for TokenId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Unique identifier for a page.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct PageId(pub(crate) Uuid);

impl fmt::Debug for PageId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "PageId({})", self.0)
    }
}

impl fmt::Display for PageId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("node not found: {0}")]
    NodeNotFound(NodeId),

    #[error("stale node reference: {0}")]
    StaleNodeId(NodeId),

    #[error("arena capacity exceeded (max {0} nodes)")]
    CapacityExceeded(usize),

    #[error("component not found: {0:?}")]
    ComponentNotFound(ComponentId),

    #[error("token not found: {0}")]
    TokenNotFound(String),

    #[error("token alias cycle detected: {0}")]
    TokenCycleDetected(String),

    #[error("invalid token name: {0}")]
    InvalidTokenName(String),

    #[error("invalid parent: {0} cannot be a parent")]
    InvalidParent(NodeId),

    #[error("cycle detected: cannot make {0} a child of {1}")]
    CycleDetected(NodeId, NodeId),

    #[error("name conflict: {0} already exists in target")]
    NameConflict(String),

    #[error("boolean operation failed: {0}")]
    BooleanOpFailed(String),

    #[error("serialization error: {0}")]
    SerializationError(String),

    #[error("unsupported schema version: {0} (max supported: {1})")]
    UnsupportedSchemaVersion(u32, u32),

    #[error("validation error: {0}")]
    ValidationError(String),

    #[error("input too large: {0}")]
    InputTooLarge(String),

    #[error("duplicate uuid: {0}")]
    DuplicateUuid(Uuid),

    #[error("page not found: {0:?}")]
    PageNotFound(PageId),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_not_found_error_displays_id() {
        let id = NodeId { index: 42, generation: 7 };
        let err = CoreError::NodeNotFound(id);
        let msg = format!("{err}");
        assert!(msg.contains("42"), "expected index in message: {msg}");
        assert!(msg.contains("node not found"), "expected prefix: {msg}");
    }

    #[test]
    fn test_stale_node_id_error_displays_id() {
        let id = NodeId { index: 3, generation: 99 };
        let err = CoreError::StaleNodeId(id);
        let msg = format!("{err}");
        assert!(msg.contains("stale node reference"), "expected prefix: {msg}");
    }

    #[test]
    fn test_capacity_exceeded_error_displays_max() {
        let err = CoreError::CapacityExceeded(100_000);
        let msg = format!("{err}");
        assert!(msg.contains("100000"), "expected max in message: {msg}");
    }

    #[test]
    fn test_unsupported_schema_version_displays_versions() {
        let err = CoreError::UnsupportedSchemaVersion(5, 1);
        let msg = format!("{err}");
        assert!(msg.contains('5'), "expected file version: {msg}");
        assert!(msg.contains('1'), "expected max version: {msg}");
    }

    #[test]
    fn test_cycle_detected_displays_both_nodes() {
        let parent = NodeId { index: 1, generation: 0 };
        let child = NodeId { index: 2, generation: 0 };
        let err = CoreError::CycleDetected(parent, child);
        let msg = format!("{err}");
        assert!(msg.contains("cycle detected"), "expected prefix: {msg}");
    }

    #[test]
    fn test_validation_error_displays_message() {
        let err = CoreError::ValidationError("name too long".to_string());
        let msg = format!("{err}");
        assert!(msg.contains("name too long"), "expected detail: {msg}");
    }

    #[test]
    fn test_duplicate_uuid_displays_uuid() {
        let uuid = Uuid::nil();
        let err = CoreError::DuplicateUuid(uuid);
        let msg = format!("{err}");
        assert!(msg.contains("duplicate uuid"), "expected prefix: {msg}");
    }

    #[test]
    fn test_page_not_found_displays_id() {
        let id = PageId(Uuid::nil());
        let err = CoreError::PageNotFound(id);
        let msg = format!("{err}");
        assert!(msg.contains("page not found"), "expected prefix: {msg}");
    }

    #[test]
    fn test_error_is_send_not_required() {
        // CoreError intentionally does NOT require Send — WASM compat
        fn assert_debug<T: std::fmt::Debug>() {}
        assert_debug::<CoreError>();
    }

    #[test]
    fn test_node_id_equality() {
        let a = NodeId { index: 1, generation: 5 };
        let b = NodeId { index: 1, generation: 5 };
        let c = NodeId { index: 1, generation: 6 };
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn test_node_id_copy() {
        let a = NodeId { index: 1, generation: 0 };
        let b = a;
        assert_eq!(a, b); // a is still usable — Copy
    }

    #[test]
    fn test_component_id_debug() {
        let id = ComponentId(Uuid::nil());
        let debug = format!("{id:?}");
        assert!(debug.contains("ComponentId"), "expected wrapper: {debug}");
    }

    #[test]
    fn test_token_id_display() {
        let id = TokenId(Uuid::nil());
        let display = format!("{id}");
        assert!(display.contains("00000000"), "expected uuid: {display}");
    }

    #[test]
    fn test_page_id_debug() {
        let id = PageId(Uuid::nil());
        let debug = format!("{id:?}");
        assert!(debug.contains("PageId"), "expected wrapper: {debug}");
    }
}
```

- [ ] 2. Add the module to `lib.rs`:

```rust
// crates/core/src/lib.rs
#![warn(clippy::all, clippy::pedantic)]

pub mod error;

pub use error::{ComponentId, CoreError, NodeId, PageId, TokenId};

#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!version().is_empty());
    }
}
```

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 4. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 5. Commit:

```bash
git add crates/core/src/error.rs crates/core/src/lib.rs
git commit -m "feat(core): add error types and ID newtypes (spec-01)"
```

---

## Task 3: Validation constants and functions (`validate.rs`)

**Files:**
- Create: `crates/core/src/validate.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Create `crates/core/src/validate.rs` with tests first, then implementation:

```rust
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

/// Default maximum history size (undo/redo).
pub const DEFAULT_MAX_HISTORY: usize = 500;

// ── Validation Functions ───────────────────────────────────────────────

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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(validate_collection_size("children", MAX_CHILDREN_PER_NODE, MAX_CHILDREN_PER_NODE).is_ok());
    }

    #[test]
    fn test_validate_collection_size_exceeds_limit() {
        assert!(validate_collection_size("children", MAX_CHILDREN_PER_NODE + 1, MAX_CHILDREN_PER_NODE).is_err());
    }

    #[test]
    fn test_validate_collection_size_zero() {
        assert!(validate_collection_size("fills", 0, MAX_FILLS_PER_STYLE).is_ok());
    }
}
```

- [ ] 2. Add the module to `lib.rs`. Add this line after `pub mod error;`:

```rust
pub mod validate;
```

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 4. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 5. Commit:

```bash
git add crates/core/src/validate.rs crates/core/src/lib.rs
git commit -m "feat(core): add validation constants and functions (spec-01)"
```

---

## Task 4: ID types (`id.rs`)

**Files:**
- Create: `crates/core/src/id.rs`
- Modify: `crates/core/src/error.rs`
- Modify: `crates/core/src/lib.rs`

The `NodeId` struct is defined in `error.rs` to avoid circular deps. `id.rs` re-exports it and adds the other ID types with serde support. `ComponentId`, `TokenId`, and `PageId` are also in `error.rs` for the same reason. `id.rs` provides serde impls and convenience constructors.

- [ ] 1. Create `crates/core/src/id.rs`:

```rust
// crates/core/src/id.rs

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::error::{ComponentId, NodeId, PageId, TokenId};

// ── Serde for NodeId ───────────────────────────────────────────────────

impl Serialize for NodeId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("NodeId", 2)?;
        state.serialize_field("index", &self.index)?;
        state.serialize_field("generation", &self.generation)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for NodeId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct NodeIdHelper {
            index: u32,
            generation: u64,
        }
        let helper = NodeIdHelper::deserialize(deserializer)?;
        Ok(Self {
            index: helper.index,
            generation: helper.generation,
        })
    }
}

// ── Serde for ComponentId ──────────────────────────────────────────────

impl Serialize for ComponentId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ComponentId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let uuid = Uuid::deserialize(deserializer)?;
        Ok(Self(uuid))
    }
}

// ── Serde for TokenId ──────────────────────────────────────────────────

impl Serialize for TokenId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TokenId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let uuid = Uuid::deserialize(deserializer)?;
        Ok(Self(uuid))
    }
}

// ── Serde for PageId ───────────────────────────────────────────────────

impl Serialize for PageId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for PageId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let uuid = Uuid::deserialize(deserializer)?;
        Ok(Self(uuid))
    }
}

// ── Convenience constructors ───────────────────────────────────────────

impl NodeId {
    /// Creates a new `NodeId`. Used by the arena when allocating nodes.
    #[must_use]
    pub fn new(index: u32, generation: u64) -> Self {
        Self { index, generation }
    }

    /// Returns the arena index.
    #[must_use]
    pub fn index(self) -> u32 {
        self.index
    }

    /// Returns the generation counter.
    #[must_use]
    pub fn generation(self) -> u64 {
        self.generation
    }
}

impl ComponentId {
    /// Creates a new `ComponentId` from a UUID.
    #[must_use]
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }

    /// Returns the inner UUID.
    #[must_use]
    pub fn uuid(self) -> Uuid {
        self.0
    }
}

impl TokenId {
    /// Creates a new `TokenId` from a UUID.
    #[must_use]
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }

    /// Returns the inner UUID.
    #[must_use]
    pub fn uuid(self) -> Uuid {
        self.0
    }
}

impl PageId {
    /// Creates a new `PageId` from a UUID.
    #[must_use]
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }

    /// Returns the inner UUID.
    #[must_use]
    pub fn uuid(self) -> Uuid {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_id_new_and_accessors() {
        let id = NodeId::new(42, 7);
        assert_eq!(id.index(), 42);
        assert_eq!(id.generation(), 7);
    }

    #[test]
    fn test_node_id_serde_round_trip() {
        let id = NodeId::new(10, 99);
        let json = serde_json::to_string(&id).expect("serialize");
        let deserialized: NodeId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, deserialized);
    }

    #[test]
    fn test_component_id_new_and_uuid() {
        let uuid = Uuid::nil();
        let id = ComponentId::new(uuid);
        assert_eq!(id.uuid(), uuid);
    }

    #[test]
    fn test_component_id_serde_round_trip() {
        let id = ComponentId::new(Uuid::nil());
        let json = serde_json::to_string(&id).expect("serialize");
        let deserialized: ComponentId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, deserialized);
    }

    #[test]
    fn test_token_id_new_and_uuid() {
        let uuid = Uuid::nil();
        let id = TokenId::new(uuid);
        assert_eq!(id.uuid(), uuid);
    }

    #[test]
    fn test_token_id_serde_round_trip() {
        let id = TokenId::new(Uuid::nil());
        let json = serde_json::to_string(&id).expect("serialize");
        let deserialized: TokenId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, deserialized);
    }

    #[test]
    fn test_page_id_new_and_uuid() {
        let uuid = Uuid::nil();
        let id = PageId::new(uuid);
        assert_eq!(id.uuid(), uuid);
    }

    #[test]
    fn test_page_id_serde_round_trip() {
        let id = PageId::new(Uuid::nil());
        let json = serde_json::to_string(&id).expect("serialize");
        let deserialized: PageId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, deserialized);
    }

    #[test]
    fn test_node_id_hash_works() {
        use std::collections::HashMap;
        let mut map = HashMap::new();
        let id = NodeId::new(1, 0);
        map.insert(id, "node");
        assert_eq!(map.get(&id), Some(&"node"));
    }

    #[test]
    fn test_component_id_hash_works() {
        use std::collections::HashMap;
        let mut map = HashMap::new();
        let id = ComponentId::new(Uuid::nil());
        map.insert(id, "component");
        assert_eq!(map.get(&id), Some(&"component"));
    }
}
```

- [ ] 2. Update `lib.rs` to add the `id` module and update re-exports:

```rust
// crates/core/src/lib.rs
#![warn(clippy::all, clippy::pedantic)]

pub mod error;
pub mod id;
pub mod validate;

pub use error::CoreError;
pub use id::{ComponentId, NodeId, PageId, TokenId};

#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!version().is_empty());
    }
}
```

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 4. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 5. Commit:

```bash
git add crates/core/src/id.rs crates/core/src/lib.rs
git commit -m "feat(core): add ID types with serde support (spec-01)"
```

---

## Task 5: Node model (`node.rs`)

**Files:**
- Create: `crates/core/src/node.rs`
- Modify: `crates/core/src/lib.rs`

This task implements the full Node struct, NodeKind, Transform, Style, Color, Fill, Stroke, Effect, BlendMode, StyleValue, Constraints, and all supporting types. `ComponentInstance` uses a stub `OverrideMap` (empty HashMap). `PathData` is stubbed.

- [ ] 1. Create `crates/core/src/node.rs`:

```rust
// crates/core/src/node.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::{ComponentId, NodeId};

// ── Forward declarations / stubs for Plan 01c types ────────────────────

/// Stub for the override map used in component instances.
/// Plan 01c will replace this with a full implementation.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OverrideMap {
    pub entries: HashMap<String, serde_json::Value>,
}

/// Stub for path geometry data.
/// Plan 01c will replace this with SubPath, PathSegment, FillRule, etc.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PathData {
    pub subpaths: Vec<serde_json::Value>,
    pub fill_rule: FillRule,
}

impl Default for PathData {
    fn default() -> Self {
        Self {
            subpaths: Vec::new(),
            fill_rule: FillRule::EvenOdd,
        }
    }
}

/// Fill rule for path rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FillRule {
    EvenOdd,
    NonZero,
}

/// Stub for auto-layout configuration.
/// Plan 01b will replace this with a full implementation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoLayout {
    pub direction: LayoutDirection,
    pub gap: f64,
    pub padding: Padding,
    pub align_items: AlignItems,
    pub justify_content: JustifyContent,
    pub wrap: bool,
}

impl Default for AutoLayout {
    fn default() -> Self {
        Self {
            direction: LayoutDirection::Row,
            gap: 0.0,
            padding: Padding::default(),
            align_items: AlignItems::Start,
            justify_content: JustifyContent::Start,
            wrap: false,
        }
    }
}

/// Direction for auto-layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayoutDirection {
    Row,
    Column,
}

/// Padding for auto-layout.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Padding {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

impl Default for Padding {
    fn default() -> Self {
        Self {
            top: 0.0,
            right: 0.0,
            bottom: 0.0,
            left: 0.0,
        }
    }
}

/// Alignment for auto-layout children.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlignItems {
    Start,
    Center,
    End,
    Stretch,
}

/// Justify content for auto-layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JustifyContent {
    Start,
    Center,
    End,
    SpaceBetween,
    SpaceAround,
    SpaceEvenly,
}

// ── Text Style ─────────────────────────────────────────────────────────

/// Text styling properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: StyleValue<f64>,
    pub font_weight: u16,
    pub line_height: StyleValue<f64>,
    pub letter_spacing: StyleValue<f64>,
    pub text_align: TextAlign,
    pub text_color: StyleValue<Color>,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "Inter".to_string(),
            font_size: StyleValue::Literal(16.0),
            font_weight: 400,
            line_height: StyleValue::Literal(1.5),
            letter_spacing: StyleValue::Literal(0.0),
            text_align: TextAlign::Left,
            text_color: StyleValue::Literal(Color::Srgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            }),
        }
    }
}

/// Text alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextAlign {
    Left,
    Center,
    Right,
    Justify,
}

// ── Core Node Types ────────────────────────────────────────────────────

/// A 2D point.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    #[must_use]
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    #[must_use]
    pub fn zero() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

/// A style value that can be either a literal or a token reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StyleValue<T> {
    Literal(T),
    TokenRef(String),
}

impl<T: Default> Default for StyleValue<T> {
    fn default() -> Self {
        Self::Literal(T::default())
    }
}

/// Multi-color-space color representation.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "space", rename_all = "snake_case")]
pub enum Color {
    Srgb { r: f64, g: f64, b: f64, a: f64 },
    #[serde(rename = "display_p3")]
    DisplayP3 { r: f64, g: f64, b: f64, a: f64 },
    Oklch { l: f64, c: f64, h: f64, a: f64 },
    Oklab { l: f64, a: f64, b: f64, alpha: f64 },
}

impl Default for Color {
    fn default() -> Self {
        Self::Srgb {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        }
    }
}

/// Gradient stop point.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientStop {
    pub position: f64,
    pub color: StyleValue<Color>,
}

/// Gradient definition shared between linear and radial gradients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientDef {
    pub stops: Vec<GradientStop>,
    pub start: Point,
    pub end: Point,
}

/// Scale mode for image fills.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScaleMode {
    Fill,
    Fit,
    Tile,
    Stretch,
}

/// Fill types for a node's style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Fill {
    Solid { color: StyleValue<Color> },
    LinearGradient { gradient: GradientDef },
    RadialGradient { gradient: GradientDef },
    Image { asset_ref: String, scale_mode: ScaleMode },
}

/// Stroke alignment relative to the path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokeAlignment {
    Inside,
    Outside,
    Center,
}

/// Stroke cap style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokeCap {
    Butt,
    Round,
    Square,
}

/// Stroke join style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokeJoin {
    Miter,
    Round,
    Bevel,
}

/// Stroke definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub color: StyleValue<Color>,
    pub width: StyleValue<f64>,
    pub alignment: StrokeAlignment,
    pub cap: StrokeCap,
    pub join: StrokeJoin,
}

impl Default for Stroke {
    fn default() -> Self {
        Self {
            color: StyleValue::Literal(Color::Srgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            }),
            width: StyleValue::Literal(1.0),
            alignment: StrokeAlignment::Center,
            cap: StrokeCap::Butt,
            join: StrokeJoin::Miter,
        }
    }
}

/// Visual effects applied to a node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Effect {
    DropShadow {
        color: StyleValue<Color>,
        offset: Point,
        blur: StyleValue<f64>,
        spread: StyleValue<f64>,
    },
    InnerShadow {
        color: StyleValue<Color>,
        offset: Point,
        blur: StyleValue<f64>,
        spread: StyleValue<f64>,
    },
    LayerBlur {
        radius: StyleValue<f64>,
    },
    BackgroundBlur {
        radius: StyleValue<f64>,
    },
}

/// Blend mode for compositing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

impl Default for BlendMode {
    fn default() -> Self {
        Self::Normal
    }
}

/// Visual style properties for a node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Style {
    pub fills: Vec<Fill>,
    pub strokes: Vec<Stroke>,
    pub opacity: StyleValue<f64>,
    pub blend_mode: BlendMode,
    pub effects: Vec<Effect>,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            fills: Vec::new(),
            strokes: Vec::new(),
            opacity: StyleValue::Literal(1.0),
            blend_mode: BlendMode::Normal,
            effects: Vec::new(),
        }
    }
}

/// Spatial transform for a node.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        }
    }
}

/// Pin constraint for positioning within a parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PinConstraint {
    Start,
    End,
    StartAndEnd,
    Center,
    Scale,
}

impl Default for PinConstraint {
    fn default() -> Self {
        Self::Start
    }
}

/// Positioning constraints for a node within its parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Constraints {
    pub horizontal: PinConstraint,
    pub vertical: PinConstraint,
}

impl Default for Constraints {
    fn default() -> Self {
        Self {
            horizontal: PinConstraint::Start,
            vertical: PinConstraint::Start,
        }
    }
}

/// The kind of a node, determining its specific properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeKind {
    Frame {
        auto_layout: Option<AutoLayout>,
    },
    Rectangle {
        corner_radii: [f64; 4],
    },
    Ellipse {
        arc_start: f64,
        arc_end: f64,
    },
    Path {
        path_data: PathData,
    },
    Text {
        content: String,
        text_style: TextStyle,
    },
    Image {
        asset_ref: String,
    },
    Group,
    ComponentInstance {
        component_id: ComponentId,
        overrides: OverrideMap,
    },
}

/// A node in the design document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub uuid: Uuid,
    pub kind: NodeKind,
    pub name: String,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub transform: Transform,
    pub style: Style,
    pub constraints: Constraints,
    pub visible: bool,
    pub locked: bool,
}

impl Node {
    /// Creates a new node with the given id, uuid, kind, and name.
    /// All other fields are set to defaults.
    ///
    /// # Note
    /// The `name` is NOT validated here — callers must validate before creating nodes.
    /// This keeps the constructor infallible for internal use (e.g., deserialization).
    #[must_use]
    pub fn new(id: NodeId, uuid: Uuid, kind: NodeKind, name: String) -> Self {
        Self {
            id,
            uuid,
            kind,
            name,
            parent: None,
            children: Vec::new(),
            transform: Transform::default(),
            style: Style::default(),
            constraints: Constraints::default(),
            visible: true,
            locked: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Node construction ──────────────────────────────────────────────

    #[test]
    fn test_new_node_has_defaults() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(id, uuid, NodeKind::Group, "Group 1".to_string());
        assert_eq!(node.id, id);
        assert_eq!(node.uuid, uuid);
        assert_eq!(node.name, "Group 1");
        assert!(node.parent.is_none());
        assert!(node.children.is_empty());
        assert!(node.visible);
        assert!(!node.locked);
    }

    #[test]
    fn test_new_frame_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Frame { auto_layout: None },
            "Frame 1".to_string(),
        );
        match &node.kind {
            NodeKind::Frame { auto_layout } => assert!(auto_layout.is_none()),
            other => panic!("expected Frame, got {other:?}"),
        }
    }

    #[test]
    fn test_new_rectangle_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Rectangle { corner_radii: [4.0, 4.0, 4.0, 4.0] },
            "Rect 1".to_string(),
        );
        match &node.kind {
            NodeKind::Rectangle { corner_radii } => {
                assert_eq!(*corner_radii, [4.0, 4.0, 4.0, 4.0]);
            }
            other => panic!("expected Rectangle, got {other:?}"),
        }
    }

    #[test]
    fn test_new_ellipse_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Ellipse { arc_start: 0.0, arc_end: 360.0 },
            "Ellipse 1".to_string(),
        );
        match &node.kind {
            NodeKind::Ellipse { arc_start, arc_end } => {
                assert!((arc_start - 0.0).abs() < f64::EPSILON);
                assert!((arc_end - 360.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Ellipse, got {other:?}"),
        }
    }

    #[test]
    fn test_new_text_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle::default(),
            },
            "Text 1".to_string(),
        );
        match &node.kind {
            NodeKind::Text { content, .. } => assert_eq!(content, "Hello"),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[test]
    fn test_new_image_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Image { asset_ref: "images/logo.png".to_string() },
            "Image 1".to_string(),
        );
        match &node.kind {
            NodeKind::Image { asset_ref } => assert_eq!(asset_ref, "images/logo.png"),
            other => panic!("expected Image, got {other:?}"),
        }
    }

    #[test]
    fn test_new_path_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let node = Node::new(
            id,
            uuid,
            NodeKind::Path { path_data: PathData::default() },
            "Path 1".to_string(),
        );
        match &node.kind {
            NodeKind::Path { path_data } => {
                assert!(path_data.subpaths.is_empty());
                assert_eq!(path_data.fill_rule, FillRule::EvenOdd);
            }
            other => panic!("expected Path, got {other:?}"),
        }
    }

    #[test]
    fn test_new_component_instance_node() {
        let id = NodeId::new(0, 0);
        let uuid = Uuid::nil();
        let component_id = ComponentId::new(Uuid::nil());
        let node = Node::new(
            id,
            uuid,
            NodeKind::ComponentInstance {
                component_id,
                overrides: OverrideMap::default(),
            },
            "Instance 1".to_string(),
        );
        match &node.kind {
            NodeKind::ComponentInstance { component_id: cid, overrides } => {
                assert_eq!(*cid, component_id);
                assert!(overrides.entries.is_empty());
            }
            other => panic!("expected ComponentInstance, got {other:?}"),
        }
    }

    // ── Transform ──────────────────────────────────────────────────────

    #[test]
    fn test_transform_default() {
        let t = Transform::default();
        assert!((t.x - 0.0).abs() < f64::EPSILON);
        assert!((t.y - 0.0).abs() < f64::EPSILON);
        assert!((t.width - 100.0).abs() < f64::EPSILON);
        assert!((t.height - 100.0).abs() < f64::EPSILON);
        assert!((t.rotation - 0.0).abs() < f64::EPSILON);
        assert!((t.scale_x - 1.0).abs() < f64::EPSILON);
        assert!((t.scale_y - 1.0).abs() < f64::EPSILON);
    }

    // ── Style ──────────────────────────────────────────────────────────

    #[test]
    fn test_style_default() {
        let s = Style::default();
        assert!(s.fills.is_empty());
        assert!(s.strokes.is_empty());
        assert_eq!(s.opacity, StyleValue::Literal(1.0));
        assert_eq!(s.blend_mode, BlendMode::Normal);
        assert!(s.effects.is_empty());
    }

    // ── Color ──────────────────────────────────────────────────────────

    #[test]
    fn test_color_srgb_default() {
        let c = Color::default();
        match c {
            Color::Srgb { r, g, b, a } => {
                assert!((r - 0.0).abs() < f64::EPSILON);
                assert!((g - 0.0).abs() < f64::EPSILON);
                assert!((b - 0.0).abs() < f64::EPSILON);
                assert!((a - 1.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Srgb, got {other:?}"),
        }
    }

    #[test]
    fn test_color_display_p3() {
        let c = Color::DisplayP3 { r: 1.0, g: 0.0, b: 0.5, a: 0.8 };
        match c {
            Color::DisplayP3 { r, g, b, a } => {
                assert!((r - 1.0).abs() < f64::EPSILON);
                assert!((g - 0.0).abs() < f64::EPSILON);
                assert!((b - 0.5).abs() < f64::EPSILON);
                assert!((a - 0.8).abs() < f64::EPSILON);
            }
            other => panic!("expected DisplayP3, got {other:?}"),
        }
    }

    #[test]
    fn test_color_oklch() {
        let c = Color::Oklch { l: 0.7, c: 0.15, h: 180.0, a: 1.0 };
        match c {
            Color::Oklch { l, c, h, a } => {
                assert!((l - 0.7).abs() < f64::EPSILON);
                assert!((c - 0.15).abs() < f64::EPSILON);
                assert!((h - 180.0).abs() < f64::EPSILON);
                assert!((a - 1.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Oklch, got {other:?}"),
        }
    }

    #[test]
    fn test_color_oklab() {
        let c = Color::Oklab { l: 0.5, a: -0.1, b: 0.2, alpha: 1.0 };
        match c {
            Color::Oklab { l, a, b, alpha } => {
                assert!((l - 0.5).abs() < f64::EPSILON);
                assert!((a - (-0.1)).abs() < f64::EPSILON);
                assert!((b - 0.2).abs() < f64::EPSILON);
                assert!((alpha - 1.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Oklab, got {other:?}"),
        }
    }

    // ── StyleValue ─────────────────────────────────────────────────────

    #[test]
    fn test_style_value_literal() {
        let sv: StyleValue<f64> = StyleValue::Literal(0.5);
        match sv {
            StyleValue::Literal(v) => assert!((v - 0.5).abs() < f64::EPSILON),
            StyleValue::TokenRef(_) => panic!("expected Literal"),
        }
    }

    #[test]
    fn test_style_value_token_ref() {
        let sv: StyleValue<f64> = StyleValue::TokenRef("opacity.primary".to_string());
        match sv {
            StyleValue::TokenRef(name) => assert_eq!(name, "opacity.primary"),
            StyleValue::Literal(_) => panic!("expected TokenRef"),
        }
    }

    #[test]
    fn test_style_value_default() {
        let sv: StyleValue<f64> = StyleValue::default();
        assert_eq!(sv, StyleValue::Literal(0.0));
    }

    // ── Fill ───────────────────────────────────────────────────────────

    #[test]
    fn test_fill_solid() {
        let fill = Fill::Solid {
            color: StyleValue::Literal(Color::Srgb { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }),
        };
        match &fill {
            Fill::Solid { color } => {
                assert_eq!(
                    *color,
                    StyleValue::Literal(Color::Srgb { r: 1.0, g: 0.0, b: 0.0, a: 1.0 })
                );
            }
            other => panic!("expected Solid, got {other:?}"),
        }
    }

    #[test]
    fn test_fill_solid_with_token_ref() {
        let fill = Fill::Solid {
            color: StyleValue::TokenRef("color.primary.500".to_string()),
        };
        match &fill {
            Fill::Solid { color } => {
                assert_eq!(*color, StyleValue::TokenRef("color.primary.500".to_string()));
            }
            other => panic!("expected Solid, got {other:?}"),
        }
    }

    #[test]
    fn test_fill_image() {
        let fill = Fill::Image {
            asset_ref: "images/bg.png".to_string(),
            scale_mode: ScaleMode::Fill,
        };
        match &fill {
            Fill::Image { asset_ref, scale_mode } => {
                assert_eq!(asset_ref, "images/bg.png");
                assert_eq!(*scale_mode, ScaleMode::Fill);
            }
            other => panic!("expected Image, got {other:?}"),
        }
    }

    // ── Stroke ─────────────────────────────────────────────────────────

    #[test]
    fn test_stroke_default() {
        let s = Stroke::default();
        assert_eq!(s.alignment, StrokeAlignment::Center);
        assert_eq!(s.cap, StrokeCap::Butt);
        assert_eq!(s.join, StrokeJoin::Miter);
        assert_eq!(s.width, StyleValue::Literal(1.0));
    }

    // ── Effect ─────────────────────────────────────────────────────────

    #[test]
    fn test_effect_drop_shadow() {
        let effect = Effect::DropShadow {
            color: StyleValue::Literal(Color::Srgb { r: 0.0, g: 0.0, b: 0.0, a: 0.25 }),
            offset: Point::new(0.0, 4.0),
            blur: StyleValue::Literal(8.0),
            spread: StyleValue::Literal(0.0),
        };
        match &effect {
            Effect::DropShadow { offset, .. } => {
                assert!((offset.y - 4.0).abs() < f64::EPSILON);
            }
            other => panic!("expected DropShadow, got {other:?}"),
        }
    }

    #[test]
    fn test_effect_layer_blur() {
        let effect = Effect::LayerBlur {
            radius: StyleValue::Literal(10.0),
        };
        match &effect {
            Effect::LayerBlur { radius } => {
                assert_eq!(*radius, StyleValue::Literal(10.0));
            }
            other => panic!("expected LayerBlur, got {other:?}"),
        }
    }

    #[test]
    fn test_effect_background_blur() {
        let effect = Effect::BackgroundBlur {
            radius: StyleValue::TokenRef("blur.background".to_string()),
        };
        match &effect {
            Effect::BackgroundBlur { radius } => {
                assert_eq!(*radius, StyleValue::TokenRef("blur.background".to_string()));
            }
            other => panic!("expected BackgroundBlur, got {other:?}"),
        }
    }

    // ── BlendMode ──────────────────────────────────────────────────────

    #[test]
    fn test_blend_mode_default() {
        assert_eq!(BlendMode::default(), BlendMode::Normal);
    }

    // ── Constraints ────────────────────────────────────────────────────

    #[test]
    fn test_constraints_default() {
        let c = Constraints::default();
        assert_eq!(c.horizontal, PinConstraint::Start);
        assert_eq!(c.vertical, PinConstraint::Start);
    }

    // ── Point ──────────────────────────────────────────────────────────

    #[test]
    fn test_point_new() {
        let p = Point::new(3.0, 4.0);
        assert!((p.x - 3.0).abs() < f64::EPSILON);
        assert!((p.y - 4.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_point_zero() {
        let p = Point::zero();
        assert!((p.x - 0.0).abs() < f64::EPSILON);
        assert!((p.y - 0.0).abs() < f64::EPSILON);
    }

    // ── Serde round-trip for key types ─────────────────────────────────

    #[test]
    fn test_color_srgb_serde_round_trip() {
        let c = Color::Srgb { r: 0.5, g: 0.6, b: 0.7, a: 0.8 };
        let json = serde_json::to_string(&c).expect("serialize");
        let deserialized: Color = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(c, deserialized);
    }

    #[test]
    fn test_color_display_p3_serde_round_trip() {
        let c = Color::DisplayP3 { r: 1.0, g: 0.0, b: 0.5, a: 1.0 };
        let json = serde_json::to_string(&c).expect("serialize");
        let deserialized: Color = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(c, deserialized);
    }

    #[test]
    fn test_node_kind_frame_serde_round_trip() {
        let kind = NodeKind::Frame { auto_layout: None };
        let json = serde_json::to_string(&kind).expect("serialize");
        let deserialized: NodeKind = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(kind, deserialized);
    }

    #[test]
    fn test_node_kind_rectangle_serde_round_trip() {
        let kind = NodeKind::Rectangle { corner_radii: [1.0, 2.0, 3.0, 4.0] };
        let json = serde_json::to_string(&kind).expect("serialize");
        let deserialized: NodeKind = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(kind, deserialized);
    }

    #[test]
    fn test_blend_mode_serde_round_trip() {
        let modes = [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
            BlendMode::ColorDodge,
            BlendMode::ColorBurn,
            BlendMode::HardLight,
            BlendMode::SoftLight,
            BlendMode::Difference,
            BlendMode::Exclusion,
            BlendMode::Hue,
            BlendMode::Saturation,
            BlendMode::Color,
            BlendMode::Luminosity,
        ];
        for mode in &modes {
            let json = serde_json::to_string(mode).expect("serialize");
            let deserialized: BlendMode = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(*mode, deserialized);
        }
    }

    #[test]
    fn test_fill_solid_serde_round_trip() {
        let fill = Fill::Solid {
            color: StyleValue::Literal(Color::Srgb { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }),
        };
        let json = serde_json::to_string(&fill).expect("serialize");
        let deserialized: Fill = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(fill, deserialized);
    }

    #[test]
    fn test_effect_serde_round_trip() {
        let effect = Effect::DropShadow {
            color: StyleValue::Literal(Color::Srgb { r: 0.0, g: 0.0, b: 0.0, a: 0.5 }),
            offset: Point::new(2.0, 4.0),
            blur: StyleValue::Literal(8.0),
            spread: StyleValue::Literal(0.0),
        };
        let json = serde_json::to_string(&effect).expect("serialize");
        let deserialized: Effect = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(effect, deserialized);
    }

    #[test]
    fn test_style_value_serde_literal_round_trip() {
        let sv: StyleValue<f64> = StyleValue::Literal(0.75);
        let json = serde_json::to_string(&sv).expect("serialize");
        let deserialized: StyleValue<f64> = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(sv, deserialized);
    }

    #[test]
    fn test_style_value_serde_token_ref_round_trip() {
        let sv: StyleValue<f64> = StyleValue::TokenRef("opacity.hover".to_string());
        let json = serde_json::to_string(&sv).expect("serialize");
        let deserialized: StyleValue<f64> = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(sv, deserialized);
    }

    #[test]
    fn test_full_node_serde_round_trip() {
        let id = NodeId::new(5, 12);
        let uuid = Uuid::nil();
        let node = Node {
            id,
            uuid,
            kind: NodeKind::Frame { auto_layout: None },
            name: "Test Frame".to_string(),
            parent: None,
            children: vec![NodeId::new(6, 12)],
            transform: Transform {
                x: 10.0,
                y: 20.0,
                width: 200.0,
                height: 150.0,
                rotation: 45.0,
                scale_x: 1.0,
                scale_y: 1.0,
            },
            style: Style {
                fills: vec![Fill::Solid {
                    color: StyleValue::Literal(Color::Srgb { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }),
                }],
                strokes: vec![],
                opacity: StyleValue::Literal(0.9),
                blend_mode: BlendMode::Normal,
                effects: vec![],
            },
            constraints: Constraints {
                horizontal: PinConstraint::StartAndEnd,
                vertical: PinConstraint::Start,
            },
            visible: true,
            locked: false,
        };
        let json = serde_json::to_string_pretty(&node).expect("serialize");
        let deserialized: Node = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(node, deserialized);
    }

    #[test]
    fn test_auto_layout_default() {
        let al = AutoLayout::default();
        assert_eq!(al.direction, LayoutDirection::Row);
        assert!((al.gap - 0.0).abs() < f64::EPSILON);
        assert!(!al.wrap);
    }

    #[test]
    fn test_node_kind_group_serde_round_trip() {
        let kind = NodeKind::Group;
        let json = serde_json::to_string(&kind).expect("serialize");
        let deserialized: NodeKind = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(kind, deserialized);
    }

    #[test]
    fn test_node_kind_text_serde_round_trip() {
        let kind = NodeKind::Text {
            content: "Hello World".to_string(),
            text_style: TextStyle::default(),
        };
        let json = serde_json::to_string(&kind).expect("serialize");
        let deserialized: NodeKind = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(kind, deserialized);
    }

    #[test]
    fn test_constraints_serde_round_trip() {
        let c = Constraints {
            horizontal: PinConstraint::Center,
            vertical: PinConstraint::Scale,
        };
        let json = serde_json::to_string(&c).expect("serialize");
        let deserialized: Constraints = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(c, deserialized);
    }
}
```

- [ ] 2. Add the module to `lib.rs`. Add after the existing modules:

```rust
pub mod node;
```

And add re-exports:

```rust
pub use node::{
    AlignItems, AutoLayout, BlendMode, Color, Constraints, Effect, Fill, FillRule, GradientDef,
    GradientStop, JustifyContent, LayoutDirection, Node, NodeKind, OverrideMap, Padding, PathData,
    PinConstraint, Point, ScaleMode, Stroke, StrokeAlignment, StrokeCap, StrokeJoin, Style,
    StyleValue, TextAlign, TextStyle, Transform,
};
```

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 4. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 5. Commit:

```bash
git add crates/core/src/node.rs crates/core/src/lib.rs
git commit -m "feat(core): add node model with all style types (spec-01)"
```

---

## Task 6: Arena (`arena.rs`)

**Files:**
- Create: `crates/core/src/arena.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Create `crates/core/src/arena.rs`:

```rust
// crates/core/src/arena.rs

use std::collections::HashMap;
use uuid::Uuid;

use crate::error::{CoreError, NodeId};
use crate::node::Node;
use crate::validate::DEFAULT_MAX_NODES;

/// Generational arena for node storage.
///
/// Nodes are stored in a flat `Vec` indexed by `NodeId.index`. Each slot
/// has a generation counter; stale references (wrong generation) are rejected.
/// A free list enables slot reuse without shifting indices.
#[derive(Debug, Clone)]
pub struct Arena {
    nodes: Vec<Option<Node>>,
    free_list: Vec<u32>,
    uuid_to_id: HashMap<Uuid, NodeId>,
    uuids: Vec<Option<Uuid>>,
    generation: Vec<u64>,
    max_nodes: usize,
}

impl Arena {
    /// Creates a new arena with the given capacity limit.
    #[must_use]
    pub fn new(max_nodes: usize) -> Self {
        Self {
            nodes: Vec::new(),
            free_list: Vec::new(),
            uuid_to_id: HashMap::new(),
            uuids: Vec::new(),
            generation: Vec::new(),
            max_nodes,
        }
    }

    /// Returns the number of live nodes in the arena.
    #[must_use]
    pub fn len(&self) -> usize {
        self.uuid_to_id.len()
    }

    /// Returns true if the arena contains no live nodes.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.uuid_to_id.is_empty()
    }

    /// Returns the maximum number of nodes allowed.
    #[must_use]
    pub fn max_nodes(&self) -> usize {
        self.max_nodes
    }

    /// Inserts a node into the arena, assigning it a `NodeId`.
    ///
    /// The node's `id` field is updated to match the assigned `NodeId`.
    /// The node's `uuid` must not already exist in the arena.
    ///
    /// # Errors
    /// - `CoreError::CapacityExceeded` if the arena is at capacity.
    /// - `CoreError::DuplicateUuid` if the node's UUID is already in use.
    pub fn insert(&mut self, mut node: Node) -> Result<NodeId, CoreError> {
        if self.len() >= self.max_nodes {
            return Err(CoreError::CapacityExceeded(self.max_nodes));
        }

        if self.uuid_to_id.contains_key(&node.uuid) {
            return Err(CoreError::DuplicateUuid(node.uuid));
        }

        let id = if let Some(index) = self.free_list.pop() {
            let idx = index as usize;
            self.generation[idx] += 1;
            let gen = self.generation[idx];
            let id = NodeId::new(index, gen);
            node.id = id;
            self.nodes[idx] = Some(node.clone());
            self.uuids[idx] = Some(node.uuid);
            id
        } else {
            let index = u32::try_from(self.nodes.len()).map_err(|_| {
                CoreError::CapacityExceeded(self.max_nodes)
            })?;
            let id = NodeId::new(index, 0);
            node.id = id;
            self.nodes.push(Some(node.clone()));
            self.uuids.push(Some(node.uuid));
            self.generation.push(0);
            id
        };

        self.uuid_to_id.insert(node.uuid, id);
        Ok(id)
    }

    /// Removes a node from the arena by its `NodeId`.
    ///
    /// The slot is added to the free list for reuse.
    ///
    /// # Errors
    /// - `CoreError::NodeNotFound` if the slot is empty.
    /// - `CoreError::StaleNodeId` if the generation does not match.
    pub fn remove(&mut self, id: NodeId) -> Result<Node, CoreError> {
        self.validate_id(id)?;
        let idx = id.index() as usize;
        let node = self.nodes[idx]
            .take()
            .ok_or(CoreError::NodeNotFound(id))?;
        let uuid = self.uuids[idx].take();
        if let Some(uuid) = uuid {
            self.uuid_to_id.remove(&uuid);
        }
        self.free_list.push(id.index());
        Ok(node)
    }

    /// Returns a shared reference to the node with the given `NodeId`.
    ///
    /// # Errors
    /// - `CoreError::NodeNotFound` if the slot is empty.
    /// - `CoreError::StaleNodeId` if the generation does not match.
    pub fn get(&self, id: NodeId) -> Result<&Node, CoreError> {
        self.validate_id(id)?;
        let idx = id.index() as usize;
        self.nodes[idx].as_ref().ok_or(CoreError::NodeNotFound(id))
    }

    /// Returns a mutable reference to the node with the given `NodeId`.
    ///
    /// # Errors
    /// - `CoreError::NodeNotFound` if the slot is empty.
    /// - `CoreError::StaleNodeId` if the generation does not match.
    pub fn get_mut(&mut self, id: NodeId) -> Result<&mut Node, CoreError> {
        self.validate_id(id)?;
        let idx = id.index() as usize;
        self.nodes[idx].as_mut().ok_or(CoreError::NodeNotFound(id))
    }

    /// Looks up a `NodeId` by UUID.
    ///
    /// # Errors
    /// Returns `CoreError::NodeNotFound` with a sentinel NodeId if the UUID is not found.
    pub fn id_by_uuid(&self, uuid: &Uuid) -> Result<NodeId, CoreError> {
        self.uuid_to_id
            .get(uuid)
            .copied()
            .ok_or_else(|| CoreError::NodeNotFound(NodeId::new(u32::MAX, 0)))
    }

    /// Returns the UUID for a given `NodeId`.
    ///
    /// # Errors
    /// - `CoreError::StaleNodeId` if the generation does not match.
    /// - `CoreError::NodeNotFound` if the slot is empty or has no UUID.
    pub fn uuid_of(&self, id: NodeId) -> Result<Uuid, CoreError> {
        self.validate_id(id)?;
        let idx = id.index() as usize;
        self.uuids[idx].ok_or(CoreError::NodeNotFound(id))
    }

    /// Deep-clones a subtree rooted at `root`, assigning fresh UUIDs via the provided generator.
    ///
    /// Returns the list of cloned nodes. The caller is responsible for inserting them into the arena
    /// and setting up parent/child relationships.
    ///
    /// # Errors
    /// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` if any node in the subtree is invalid.
    pub fn clone_subtree(
        &self,
        root: NodeId,
        uuid_generator: &mut dyn FnMut() -> Uuid,
    ) -> Result<Vec<Node>, CoreError> {
        let mut result = Vec::new();
        let mut stack = vec![root];

        while let Some(current_id) = stack.pop() {
            let node = self.get(current_id)?;
            let mut cloned = node.clone();
            cloned.uuid = uuid_generator();
            cloned.parent = None;
            cloned.children = Vec::new();
            // id will be reassigned when inserted into the arena
            result.push(cloned);

            // Push children in reverse so they come out in order
            for child_id in node.children.iter().rev() {
                stack.push(*child_id);
            }
        }

        Ok(result)
    }

    /// Returns an iterator over all live nodes in the arena.
    pub fn iter(&self) -> impl Iterator<Item = &Node> {
        self.nodes.iter().filter_map(Option::as_ref)
    }

    /// Validates that a `NodeId` refers to a valid, live slot.
    fn validate_id(&self, id: NodeId) -> Result<(), CoreError> {
        let idx = id.index() as usize;
        if idx >= self.generation.len() {
            return Err(CoreError::NodeNotFound(id));
        }
        if self.generation[idx] != id.generation() {
            return Err(CoreError::StaleNodeId(id));
        }
        Ok(())
    }
}

impl Default for Arena {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_NODES)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::NodeKind;

    fn make_node(uuid: Uuid, name: &str) -> Node {
        Node::new(
            NodeId::new(0, 0), // will be overwritten by arena
            uuid,
            NodeKind::Group,
            name.to_string(),
        )
    }

    #[test]
    fn test_arena_new_is_empty() {
        let arena = Arena::new(100);
        assert!(arena.is_empty());
        assert_eq!(arena.len(), 0);
        assert_eq!(arena.max_nodes(), 100);
    }

    #[test]
    fn test_arena_default_max_nodes() {
        let arena = Arena::default();
        assert_eq!(arena.max_nodes(), DEFAULT_MAX_NODES);
    }

    #[test]
    fn test_insert_and_get() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let node = make_node(uuid, "Node 1");
        let id = arena.insert(node).expect("insert");
        let retrieved = arena.get(id).expect("get");
        assert_eq!(retrieved.name, "Node 1");
        assert_eq!(retrieved.uuid, uuid);
        assert_eq!(retrieved.id, id);
    }

    #[test]
    fn test_insert_increments_len() {
        let mut arena = Arena::new(100);
        assert_eq!(arena.len(), 0);
        arena.insert(make_node(Uuid::nil(), "A")).expect("insert");
        assert_eq!(arena.len(), 1);
    }

    #[test]
    fn test_insert_duplicate_uuid_fails() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        arena.insert(make_node(uuid, "A")).expect("insert");
        let result = arena.insert(make_node(uuid, "B"));
        assert!(result.is_err());
    }

    #[test]
    fn test_insert_capacity_exceeded() {
        let mut arena = Arena::new(1);
        arena.insert(make_node(Uuid::nil(), "A")).expect("insert");
        // Need a different UUID for the second insert
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let result = arena.insert(make_node(uuid2, "B"));
        assert!(matches!(result, Err(CoreError::CapacityExceeded(1))));
    }

    #[test]
    fn test_remove_and_reuse_slot() {
        let mut arena = Arena::new(100);
        let uuid1 = Uuid::nil();
        let id1 = arena.insert(make_node(uuid1, "A")).expect("insert");
        let removed = arena.remove(id1).expect("remove");
        assert_eq!(removed.name, "A");
        assert_eq!(arena.len(), 0);

        // Insert again — should reuse the slot with bumped generation
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let id2 = arena.insert(make_node(uuid2, "B")).expect("insert");
        assert_eq!(id2.index(), id1.index()); // same slot
        assert_eq!(id2.generation(), id1.generation() + 1); // bumped generation
    }

    #[test]
    fn test_stale_id_after_remove() {
        let mut arena = Arena::new(100);
        let uuid1 = Uuid::nil();
        let id1 = arena.insert(make_node(uuid1, "A")).expect("insert");
        arena.remove(id1).expect("remove");

        // Old id is now stale
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let _id2 = arena.insert(make_node(uuid2, "B")).expect("insert");
        let result = arena.get(id1);
        assert!(matches!(result, Err(CoreError::StaleNodeId(_))));
    }

    #[test]
    fn test_get_nonexistent_node() {
        let arena = Arena::new(100);
        let id = NodeId::new(0, 0);
        let result = arena.get(id);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_mut() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "A")).expect("insert");
        {
            let node = arena.get_mut(id).expect("get_mut");
            node.name = "B".to_string();
        }
        let node = arena.get(id).expect("get");
        assert_eq!(node.name, "B");
    }

    #[test]
    fn test_id_by_uuid() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "A")).expect("insert");
        let found = arena.id_by_uuid(&uuid).expect("id_by_uuid");
        assert_eq!(found, id);
    }

    #[test]
    fn test_id_by_uuid_not_found() {
        let arena = Arena::new(100);
        let uuid = Uuid::nil();
        let result = arena.id_by_uuid(&uuid);
        assert!(result.is_err());
    }

    #[test]
    fn test_uuid_of() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "A")).expect("insert");
        let found = arena.uuid_of(id).expect("uuid_of");
        assert_eq!(found, uuid);
    }

    #[test]
    fn test_uuid_of_stale() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "A")).expect("insert");
        arena.remove(id).expect("remove");
        let stale_result = arena.uuid_of(id);
        // After remove+reinsert at same slot, old id is stale
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let _id2 = arena.insert(make_node(uuid2, "B")).expect("insert");
        let result = arena.uuid_of(id);
        assert!(stale_result.is_err() || result.is_err());
    }

    #[test]
    fn test_clone_subtree_single_node() {
        let mut arena = Arena::new(100);
        let uuid = Uuid::nil();
        let id = arena.insert(make_node(uuid, "Root")).expect("insert");

        let mut counter: u8 = 1;
        let clones = arena.clone_subtree(id, &mut || {
            let bytes = [counter, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            counter += 1;
            Uuid::from_bytes(bytes)
        }).expect("clone");

        assert_eq!(clones.len(), 1);
        assert_ne!(clones[0].uuid, uuid); // fresh UUID
        assert_eq!(clones[0].name, "Root");
        assert!(clones[0].parent.is_none());
        assert!(clones[0].children.is_empty());
    }

    #[test]
    fn test_clone_subtree_with_children() {
        let mut arena = Arena::new(100);
        let uuid_root = Uuid::nil();
        let uuid_child1 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let uuid_child2 = Uuid::from_bytes([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

        let root_id = arena.insert(make_node(uuid_root, "Root")).expect("insert");
        let child1_id = arena.insert(make_node(uuid_child1, "Child1")).expect("insert");
        let child2_id = arena.insert(make_node(uuid_child2, "Child2")).expect("insert");

        // Manually set up parent/child (normally tree.rs does this)
        arena.get_mut(root_id).expect("get_mut").children = vec![child1_id, child2_id];
        arena.get_mut(child1_id).expect("get_mut").parent = Some(root_id);
        arena.get_mut(child2_id).expect("get_mut").parent = Some(root_id);

        let mut counter: u8 = 10;
        let clones = arena.clone_subtree(root_id, &mut || {
            let bytes = [counter, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            counter += 1;
            Uuid::from_bytes(bytes)
        }).expect("clone");

        assert_eq!(clones.len(), 3);
        // All should have fresh UUIDs and no parent/children
        for c in &clones {
            assert!(c.parent.is_none());
            assert!(c.children.is_empty());
        }
    }

    #[test]
    fn test_clone_subtree_nonexistent_root() {
        let arena = Arena::new(100);
        let id = NodeId::new(99, 0);
        let result = arena.clone_subtree(id, &mut || Uuid::nil());
        assert!(result.is_err());
    }

    #[test]
    fn test_iter_returns_live_nodes() {
        let mut arena = Arena::new(100);
        let uuid1 = Uuid::nil();
        let uuid2 = Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let uuid3 = Uuid::from_bytes([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

        arena.insert(make_node(uuid1, "A")).expect("insert");
        let id2 = arena.insert(make_node(uuid2, "B")).expect("insert");
        arena.insert(make_node(uuid3, "C")).expect("insert");

        arena.remove(id2).expect("remove");

        let names: Vec<&str> = arena.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"A"));
        assert!(names.contains(&"C"));
    }

    #[test]
    fn test_multiple_insert_remove_cycles() {
        let mut arena = Arena::new(100);
        let mut uuids_used = Vec::new();

        for i in 0..10u8 {
            let uuid = Uuid::from_bytes([i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            uuids_used.push(uuid);
            arena.insert(make_node(uuid, &format!("Node {i}"))).expect("insert");
        }
        assert_eq!(arena.len(), 10);

        // Remove all
        for uuid in &uuids_used {
            let id = arena.id_by_uuid(uuid).expect("lookup");
            arena.remove(id).expect("remove");
        }
        assert_eq!(arena.len(), 0);

        // Reinsert — should reuse slots
        for i in 0..10u8 {
            let uuid = Uuid::from_bytes([i + 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            let id = arena.insert(make_node(uuid, &format!("New {i}"))).expect("insert");
            assert_eq!(id.generation(), 1); // all reused, generation bumped once
        }
        assert_eq!(arena.len(), 10);
    }
}
```

- [ ] 2. Add the module to `lib.rs`. Add after existing modules:

```rust
pub mod arena;
```

And add re-export:

```rust
pub use arena::Arena;
```

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 4. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 5. Commit:

```bash
git add crates/core/src/arena.rs crates/core/src/lib.rs
git commit -m "feat(core): add generational arena with capacity limits (spec-01)"
```

---

## Task 7: Tree operations (`tree.rs`)

**Files:**
- Create: `crates/core/src/tree.rs`
- Modify: `crates/core/src/lib.rs`

Tree operations exclusively own the parent/child invariant. No other module modifies `node.parent` or `node.children`.

- [ ] 1. Create `crates/core/src/tree.rs`:

```rust
// crates/core/src/tree.rs

use crate::arena::Arena;
use crate::error::{CoreError, NodeId};
use crate::validate::MAX_CHILDREN_PER_NODE;

/// Adds `child_id` as the last child of `parent_id`.
///
/// Updates both the parent's `children` vec and the child's `parent` field.
/// Validates that adding the child would not create a cycle and would not
/// exceed the maximum children limit.
///
/// # Errors
/// - `CoreError::CycleDetected` if `parent_id` is a descendant of `child_id`.
/// - `CoreError::ValidationError` if the parent would exceed max children.
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn add_child(
    arena: &mut Arena,
    parent_id: NodeId,
    child_id: NodeId,
) -> Result<(), CoreError> {
    // Validate both nodes exist
    arena.get(parent_id)?;
    arena.get(child_id)?;

    // Cannot add a node as its own child
    if parent_id == child_id {
        return Err(CoreError::CycleDetected(child_id, parent_id));
    }

    // Cycle detection: walk up from parent_id; if we reach child_id, it's a cycle
    if is_ancestor(arena, child_id, parent_id)? {
        return Err(CoreError::CycleDetected(child_id, parent_id));
    }

    // Check children limit
    let parent = arena.get(parent_id)?;
    if parent.children.len() >= MAX_CHILDREN_PER_NODE {
        return Err(CoreError::ValidationError(format!(
            "parent node already has {MAX_CHILDREN_PER_NODE} children (maximum)"
        )));
    }

    // Remove from old parent if any
    let old_parent = arena.get(child_id)?.parent;
    if let Some(old_parent_id) = old_parent {
        if old_parent_id != parent_id {
            let old_parent_node = arena.get_mut(old_parent_id)?;
            old_parent_node.children.retain(|id| *id != child_id);
        } else {
            // Already a child of this parent — just return Ok
            let parent_node = arena.get(parent_id)?;
            if parent_node.children.contains(&child_id) {
                return Ok(());
            }
        }
    }

    // Set child's parent
    arena.get_mut(child_id)?.parent = Some(parent_id);

    // Add to parent's children (only if not already there)
    let parent_node = arena.get_mut(parent_id)?;
    if !parent_node.children.contains(&child_id) {
        parent_node.children.push(child_id);
    }

    Ok(())
}

/// Removes `child_id` from its parent's children list and clears its parent field.
///
/// Does nothing if the node has no parent.
///
/// # Errors
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn remove_child(arena: &mut Arena, child_id: NodeId) -> Result<(), CoreError> {
    let parent_id = arena.get(child_id)?.parent;

    if let Some(parent_id) = parent_id {
        let parent = arena.get_mut(parent_id)?;
        parent.children.retain(|id| *id != child_id);
        arena.get_mut(child_id)?.parent = None;
    }

    Ok(())
}

/// Moves `child_id` to a specific position within its current parent's children list,
/// or within a new parent's children list.
///
/// `new_parent_id` — the parent to move under (can be the same parent for reordering).
/// `position` — the index at which to insert. Clamped to `children.len()`.
///
/// # Errors
/// - `CoreError::CycleDetected` if the move would create a cycle.
/// - `CoreError::ValidationError` if the new parent would exceed max children.
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn rearrange(
    arena: &mut Arena,
    child_id: NodeId,
    new_parent_id: NodeId,
    position: usize,
) -> Result<(), CoreError> {
    // Validate
    arena.get(new_parent_id)?;
    arena.get(child_id)?;

    if child_id == new_parent_id {
        return Err(CoreError::CycleDetected(child_id, new_parent_id));
    }

    if is_ancestor(arena, child_id, new_parent_id)? {
        return Err(CoreError::CycleDetected(child_id, new_parent_id));
    }

    let old_parent_id = arena.get(child_id)?.parent;

    // Remove from old parent
    if let Some(old_pid) = old_parent_id {
        let old_parent = arena.get_mut(old_pid)?;
        old_parent.children.retain(|id| *id != child_id);
    }

    // Check children limit (if moving to a new parent)
    let is_same_parent = old_parent_id == Some(new_parent_id);
    if !is_same_parent {
        let new_parent = arena.get(new_parent_id)?;
        if new_parent.children.len() >= MAX_CHILDREN_PER_NODE {
            // Restore old parent if we already removed
            if let Some(old_pid) = old_parent_id {
                arena.get_mut(old_pid)?.children.push(child_id);
            }
            arena.get_mut(child_id)?.parent = old_parent_id;
            return Err(CoreError::ValidationError(format!(
                "parent node already has {MAX_CHILDREN_PER_NODE} children (maximum)"
            )));
        }
    }

    // Set child's new parent
    arena.get_mut(child_id)?.parent = Some(new_parent_id);

    // Insert at position
    let new_parent = arena.get_mut(new_parent_id)?;
    let clamped_pos = position.min(new_parent.children.len());
    new_parent.children.insert(clamped_pos, child_id);

    Ok(())
}

/// Returns `true` if `ancestor_id` is an ancestor of `node_id`.
///
/// Walks up the parent chain from `node_id`. Does NOT consider a node
/// to be its own ancestor.
///
/// # Errors
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn is_ancestor(
    arena: &Arena,
    ancestor_id: NodeId,
    node_id: NodeId,
) -> Result<bool, CoreError> {
    let mut current = arena.get(node_id)?.parent;
    while let Some(pid) = current {
        if pid == ancestor_id {
            return Ok(true);
        }
        current = arena.get(pid)?.parent;
    }
    Ok(false)
}

/// Returns a list of node IDs from root to `node_id` (inclusive).
///
/// # Errors
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn ancestors(arena: &Arena, node_id: NodeId) -> Result<Vec<NodeId>, CoreError> {
    let mut path = vec![node_id];
    let mut current = arena.get(node_id)?.parent;
    while let Some(pid) = current {
        path.push(pid);
        current = arena.get(pid)?.parent;
    }
    path.reverse();
    Ok(path)
}

/// Returns all descendant node IDs of `root_id` in depth-first pre-order.
/// Does NOT include `root_id` itself.
///
/// # Errors
/// - `CoreError::NodeNotFound` / `CoreError::StaleNodeId` for invalid IDs.
pub fn descendants(arena: &Arena, root_id: NodeId) -> Result<Vec<NodeId>, CoreError> {
    let mut result = Vec::new();
    let mut stack: Vec<NodeId> = arena.get(root_id)?.children.iter().rev().copied().collect();

    while let Some(current) = stack.pop() {
        result.push(current);
        let node = arena.get(current)?;
        for child_id in node.children.iter().rev() {
            stack.push(*child_id);
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::{Node, NodeKind};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn insert_group(arena: &mut Arena, uuid: Uuid, name: &str) -> NodeId {
        let node = Node::new(NodeId::new(0, 0), uuid, NodeKind::Group, name.to_string());
        arena.insert(node).expect("insert")
    }

    // ── add_child ──────────────────────────────────────────────────────

    #[test]
    fn test_add_child_sets_parent_and_children() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        add_child(&mut arena, parent, child).expect("add_child");

        assert_eq!(arena.get(child).expect("get").parent, Some(parent));
        assert_eq!(arena.get(parent).expect("get").children, vec![child]);
    }

    #[test]
    fn test_add_child_multiple_children() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child1 = insert_group(&mut arena, make_uuid(2), "Child1");
        let child2 = insert_group(&mut arena, make_uuid(3), "Child2");

        add_child(&mut arena, parent, child1).expect("add_child");
        add_child(&mut arena, parent, child2).expect("add_child");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children, vec![child1, child2]);
    }

    #[test]
    fn test_add_child_reparents_from_old_parent() {
        let mut arena = Arena::new(100);
        let parent1 = insert_group(&mut arena, make_uuid(1), "Parent1");
        let parent2 = insert_group(&mut arena, make_uuid(2), "Parent2");
        let child = insert_group(&mut arena, make_uuid(3), "Child");

        add_child(&mut arena, parent1, child).expect("add_child");
        add_child(&mut arena, parent2, child).expect("add_child");

        assert_eq!(arena.get(child).expect("get").parent, Some(parent2));
        assert!(arena.get(parent1).expect("get").children.is_empty());
        assert_eq!(arena.get(parent2).expect("get").children, vec![child]);
    }

    #[test]
    fn test_add_child_cycle_self() {
        let mut arena = Arena::new(100);
        let node = insert_group(&mut arena, make_uuid(1), "Node");
        let result = add_child(&mut arena, node, node);
        assert!(matches!(result, Err(CoreError::CycleDetected(_, _))));
    }

    #[test]
    fn test_add_child_cycle_indirect() {
        let mut arena = Arena::new(100);
        let a = insert_group(&mut arena, make_uuid(1), "A");
        let b = insert_group(&mut arena, make_uuid(2), "B");
        let c = insert_group(&mut arena, make_uuid(3), "C");

        add_child(&mut arena, a, b).expect("add_child");
        add_child(&mut arena, b, c).expect("add_child");

        // Trying to make A a child of C would create a cycle: C -> A -> B -> C
        let result = add_child(&mut arena, c, a);
        assert!(matches!(result, Err(CoreError::CycleDetected(_, _))));
    }

    #[test]
    fn test_add_child_already_child_is_idempotent() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        add_child(&mut arena, parent, child).expect("add_child");
        add_child(&mut arena, parent, child).expect("add_child again");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children.len(), 1);
    }

    #[test]
    fn test_add_child_nonexistent_parent() {
        let mut arena = Arena::new(100);
        let child = insert_group(&mut arena, make_uuid(1), "Child");
        let fake_parent = NodeId::new(99, 0);
        let result = add_child(&mut arena, fake_parent, child);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_child_nonexistent_child() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let fake_child = NodeId::new(99, 0);
        let result = add_child(&mut arena, parent, fake_child);
        assert!(result.is_err());
    }

    // ── remove_child ───────────────────────────────────────────────────

    #[test]
    fn test_remove_child_clears_parent_and_children() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        add_child(&mut arena, parent, child).expect("add_child");
        remove_child(&mut arena, child).expect("remove_child");

        assert!(arena.get(child).expect("get").parent.is_none());
        assert!(arena.get(parent).expect("get").children.is_empty());
    }

    #[test]
    fn test_remove_child_no_parent_is_noop() {
        let mut arena = Arena::new(100);
        let node = insert_group(&mut arena, make_uuid(1), "Node");
        remove_child(&mut arena, node).expect("remove_child");
        assert!(arena.get(node).expect("get").parent.is_none());
    }

    #[test]
    fn test_remove_child_preserves_siblings() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child1 = insert_group(&mut arena, make_uuid(2), "Child1");
        let child2 = insert_group(&mut arena, make_uuid(3), "Child2");
        let child3 = insert_group(&mut arena, make_uuid(4), "Child3");

        add_child(&mut arena, parent, child1).expect("add_child");
        add_child(&mut arena, parent, child2).expect("add_child");
        add_child(&mut arena, parent, child3).expect("add_child");

        remove_child(&mut arena, child2).expect("remove_child");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children, vec![child1, child3]);
    }

    // ── rearrange ──────────────────────────────────────────────────────

    #[test]
    fn test_rearrange_within_same_parent() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child1 = insert_group(&mut arena, make_uuid(2), "Child1");
        let child2 = insert_group(&mut arena, make_uuid(3), "Child2");
        let child3 = insert_group(&mut arena, make_uuid(4), "Child3");

        add_child(&mut arena, parent, child1).expect("add_child");
        add_child(&mut arena, parent, child2).expect("add_child");
        add_child(&mut arena, parent, child3).expect("add_child");

        // Move child3 to position 0
        rearrange(&mut arena, child3, parent, 0).expect("rearrange");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children, vec![child3, child1, child2]);
    }

    #[test]
    fn test_rearrange_to_different_parent() {
        let mut arena = Arena::new(100);
        let parent1 = insert_group(&mut arena, make_uuid(1), "Parent1");
        let parent2 = insert_group(&mut arena, make_uuid(2), "Parent2");
        let child = insert_group(&mut arena, make_uuid(3), "Child");

        add_child(&mut arena, parent1, child).expect("add_child");
        rearrange(&mut arena, child, parent2, 0).expect("rearrange");

        assert!(arena.get(parent1).expect("get").children.is_empty());
        assert_eq!(arena.get(parent2).expect("get").children, vec![child]);
        assert_eq!(arena.get(child).expect("get").parent, Some(parent2));
    }

    #[test]
    fn test_rearrange_cycle_detection() {
        let mut arena = Arena::new(100);
        let a = insert_group(&mut arena, make_uuid(1), "A");
        let b = insert_group(&mut arena, make_uuid(2), "B");

        add_child(&mut arena, a, b).expect("add_child");

        let result = rearrange(&mut arena, a, b, 0);
        assert!(matches!(result, Err(CoreError::CycleDetected(_, _))));
    }

    #[test]
    fn test_rearrange_position_clamped() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        // Position 999 should be clamped to end
        rearrange(&mut arena, child, parent, 999).expect("rearrange");

        let p = arena.get(parent).expect("get");
        assert_eq!(p.children, vec![child]);
    }

    // ── is_ancestor ────────────────────────────────────────────────────

    #[test]
    fn test_is_ancestor_direct_parent() {
        let mut arena = Arena::new(100);
        let parent = insert_group(&mut arena, make_uuid(1), "Parent");
        let child = insert_group(&mut arena, make_uuid(2), "Child");

        add_child(&mut arena, parent, child).expect("add_child");

        assert!(is_ancestor(&arena, parent, child).expect("is_ancestor"));
    }

    #[test]
    fn test_is_ancestor_grandparent() {
        let mut arena = Arena::new(100);
        let gp = insert_group(&mut arena, make_uuid(1), "GP");
        let parent = insert_group(&mut arena, make_uuid(2), "Parent");
        let child = insert_group(&mut arena, make_uuid(3), "Child");

        add_child(&mut arena, gp, parent).expect("add_child");
        add_child(&mut arena, parent, child).expect("add_child");

        assert!(is_ancestor(&arena, gp, child).expect("is_ancestor"));
    }

    #[test]
    fn test_is_ancestor_not_ancestor() {
        let mut arena = Arena::new(100);
        let a = insert_group(&mut arena, make_uuid(1), "A");
        let b = insert_group(&mut arena, make_uuid(2), "B");

        assert!(!is_ancestor(&arena, a, b).expect("is_ancestor"));
    }

    #[test]
    fn test_is_ancestor_self_is_not_ancestor() {
        let mut arena = Arena::new(100);
        let node = insert_group(&mut arena, make_uuid(1), "Node");

        assert!(!is_ancestor(&arena, node, node).expect("is_ancestor"));
    }

    // ── ancestors ──────────────────────────────────────────────────────

    #[test]
    fn test_ancestors_root_node() {
        let mut arena = Arena::new(100);
        let root = insert_group(&mut arena, make_uuid(1), "Root");

        let path = ancestors(&arena, root).expect("ancestors");
        assert_eq!(path, vec![root]);
    }

    #[test]
    fn test_ancestors_nested() {
        let mut arena = Arena::new(100);
        let a = insert_group(&mut arena, make_uuid(1), "A");
        let b = insert_group(&mut arena, make_uuid(2), "B");
        let c = insert_group(&mut arena, make_uuid(3), "C");

        add_child(&mut arena, a, b).expect("add_child");
        add_child(&mut arena, b, c).expect("add_child");

        let path = ancestors(&arena, c).expect("ancestors");
        assert_eq!(path, vec![a, b, c]);
    }

    // ── descendants ────────────────────────────────────────────────────

    #[test]
    fn test_descendants_leaf() {
        let mut arena = Arena::new(100);
        let leaf = insert_group(&mut arena, make_uuid(1), "Leaf");

        let desc = descendants(&arena, leaf).expect("descendants");
        assert!(desc.is_empty());
    }

    #[test]
    fn test_descendants_tree() {
        let mut arena = Arena::new(100);
        let root = insert_group(&mut arena, make_uuid(1), "Root");
        let a = insert_group(&mut arena, make_uuid(2), "A");
        let b = insert_group(&mut arena, make_uuid(3), "B");
        let c = insert_group(&mut arena, make_uuid(4), "C");

        add_child(&mut arena, root, a).expect("add_child");
        add_child(&mut arena, root, b).expect("add_child");
        add_child(&mut arena, a, c).expect("add_child");

        let desc = descendants(&arena, root).expect("descendants");
        // DFS pre-order: A, C, B
        assert_eq!(desc, vec![a, c, b]);
    }
}
```

- [ ] 2. Add the module to `lib.rs`. Add after existing modules:

```rust
pub mod tree;
```

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 4. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 5. Commit:

```bash
git add crates/core/src/tree.rs crates/core/src/lib.rs
git commit -m "feat(core): add tree operations with cycle detection (spec-01)"
```

---

## Task 8: Document struct (`document.rs`)

**Files:**
- Create: `crates/core/src/document.rs`
- Modify: `crates/core/src/lib.rs`

The Document struct ties everything together. Fields for history, layout_engine, token_context, components, and transitions are stubbed with placeholders for Plans 01b and 01c.

- [ ] 1. Create `crates/core/src/document.rs`:

```rust
// crates/core/src/document.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::arena::Arena;
use crate::error::{ComponentId, CoreError, NodeId, PageId};
use crate::validate::CURRENT_SCHEMA_VERSION;

/// Metadata about the document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocumentMetadata {
    pub name: String,
    pub schema_version: u32,
}

impl DocumentMetadata {
    /// Creates new metadata with the current schema version.
    #[must_use]
    pub fn new(name: String) -> Self {
        Self {
            name,
            schema_version: CURRENT_SCHEMA_VERSION,
        }
    }
}

/// A page within the document, containing top-level nodes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page {
    pub id: PageId,
    pub name: String,
    pub root_nodes: Vec<NodeId>,
}

impl Page {
    /// Creates a new empty page.
    #[must_use]
    pub fn new(id: PageId, name: String) -> Self {
        Self {
            id,
            name,
            root_nodes: Vec::new(),
        }
    }
}

/// Stub for component definitions — Plan 01c will fill this in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentDef {
    pub id: ComponentId,
    pub name: String,
    pub root_node: NodeId,
}

/// Stub for transition model — Plan 01c will fill this in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    pub id: Uuid,
}

/// Stub for token context — Plan 01c will fill this in.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TokenContext {
    pub tokens: HashMap<String, serde_json::Value>,
}

/// Stub for history — Plan 01b will fill this in.
#[derive(Debug, Clone)]
pub struct History {
    max_history: usize,
}

impl History {
    #[must_use]
    pub fn new(max_history: usize) -> Self {
        Self { max_history }
    }

    #[must_use]
    pub fn max_history(&self) -> usize {
        self.max_history
    }
}

impl Default for History {
    fn default() -> Self {
        Self::new(crate::validate::DEFAULT_MAX_HISTORY)
    }
}

/// Stub for layout engine — Plan 01b will fill this in.
#[derive(Debug, Clone, Default)]
pub struct LayoutEngine;

/// The top-level design document.
///
/// All mutations go through commands executed on the document (Plan 01b).
/// For Plan 01a, the document provides direct access to the arena and pages.
#[derive(Debug, Clone)]
pub struct Document {
    pub metadata: DocumentMetadata,
    pub arena: Arena,
    pub pages: Vec<Page>,
    pub components: HashMap<ComponentId, ComponentDef>,
    pub transitions: Vec<Transition>,
    pub token_context: TokenContext,
    pub history: History,
    pub layout_engine: LayoutEngine,
}

impl Document {
    /// Creates a new empty document with the given name.
    #[must_use]
    pub fn new(name: String) -> Self {
        Self {
            metadata: DocumentMetadata::new(name),
            arena: Arena::default(),
            pages: Vec::new(),
            components: HashMap::new(),
            transitions: Vec::new(),
            token_context: TokenContext::default(),
            history: History::default(),
            layout_engine: LayoutEngine,
        }
    }

    /// Creates a new document with a custom arena capacity.
    #[must_use]
    pub fn with_capacity(name: String, max_nodes: usize) -> Self {
        Self {
            metadata: DocumentMetadata::new(name),
            arena: Arena::new(max_nodes),
            pages: Vec::new(),
            components: HashMap::new(),
            transitions: Vec::new(),
            token_context: TokenContext::default(),
            history: History::default(),
            layout_engine: LayoutEngine,
        }
    }

    /// Adds a page to the document.
    pub fn add_page(&mut self, page: Page) {
        self.pages.push(page);
    }

    /// Finds a page by its ID.
    ///
    /// # Errors
    /// Returns `CoreError::PageNotFound` if no page has the given ID.
    pub fn page(&self, id: PageId) -> Result<&Page, CoreError> {
        self.pages
            .iter()
            .find(|p| p.id == id)
            .ok_or(CoreError::PageNotFound(id))
    }

    /// Finds a page by its ID (mutable).
    ///
    /// # Errors
    /// Returns `CoreError::PageNotFound` if no page has the given ID.
    pub fn page_mut(&mut self, id: PageId) -> Result<&mut Page, CoreError> {
        self.pages
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or(CoreError::PageNotFound(id))
    }

    /// Adds a root node to a page.
    ///
    /// # Errors
    /// - `CoreError::PageNotFound` if the page doesn't exist.
    /// - `CoreError::NodeNotFound` if the node doesn't exist in the arena.
    pub fn add_root_node_to_page(
        &mut self,
        page_id: PageId,
        node_id: NodeId,
    ) -> Result<(), CoreError> {
        // Verify node exists
        self.arena.get(node_id)?;

        let page = self.page_mut(page_id)?;
        if !page.root_nodes.contains(&node_id) {
            page.root_nodes.push(node_id);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::{Node, NodeKind};

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    #[test]
    fn test_document_new() {
        let doc = Document::new("Test".to_string());
        assert_eq!(doc.metadata.name, "Test");
        assert_eq!(doc.metadata.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(doc.arena.is_empty());
        assert!(doc.pages.is_empty());
        assert!(doc.components.is_empty());
        assert!(doc.transitions.is_empty());
    }

    #[test]
    fn test_document_with_capacity() {
        let doc = Document::with_capacity("Test".to_string(), 50);
        assert_eq!(doc.arena.max_nodes(), 50);
    }

    #[test]
    fn test_document_metadata_new() {
        let meta = DocumentMetadata::new("My Doc".to_string());
        assert_eq!(meta.name, "My Doc");
        assert_eq!(meta.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_page_new() {
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string());
        assert_eq!(page.name, "Home");
        assert!(page.root_nodes.is_empty());
    }

    #[test]
    fn test_add_page() {
        let mut doc = Document::new("Test".to_string());
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string());
        doc.add_page(page);
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].name, "Home");
    }

    #[test]
    fn test_find_page_by_id() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string()));

        let page = doc.page(page_id).expect("find page");
        assert_eq!(page.name, "Home");
    }

    #[test]
    fn test_find_page_not_found() {
        let doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(99));
        let result = doc.page(page_id);
        assert!(matches!(result, Err(CoreError::PageNotFound(_))));
    }

    #[test]
    fn test_add_root_node_to_page() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string()));

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(10),
            NodeKind::Frame { auto_layout: None },
            "Frame 1".to_string(),
        );
        let node_id = doc.arena.insert(node).expect("insert");
        doc.add_root_node_to_page(page_id, node_id).expect("add_root");

        let page = doc.page(page_id).expect("find page");
        assert_eq!(page.root_nodes, vec![node_id]);
    }

    #[test]
    fn test_add_root_node_to_page_idempotent() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string()));

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(10),
            NodeKind::Group,
            "Group".to_string(),
        );
        let node_id = doc.arena.insert(node).expect("insert");
        doc.add_root_node_to_page(page_id, node_id).expect("add_root");
        doc.add_root_node_to_page(page_id, node_id).expect("add_root again");

        let page = doc.page(page_id).expect("find page");
        assert_eq!(page.root_nodes.len(), 1);
    }

    #[test]
    fn test_add_root_node_nonexistent_page() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(10),
            NodeKind::Group,
            "Group".to_string(),
        );
        let node_id = doc.arena.insert(node).expect("insert");
        let fake_page = PageId::new(make_uuid(99));
        let result = doc.add_root_node_to_page(fake_page, node_id);
        assert!(matches!(result, Err(CoreError::PageNotFound(_))));
    }

    #[test]
    fn test_add_root_node_nonexistent_node() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(1));
        doc.add_page(Page::new(page_id, "Home".to_string()));
        let fake_node = NodeId::new(99, 0);
        let result = doc.add_root_node_to_page(page_id, fake_node);
        assert!(result.is_err());
    }

    #[test]
    fn test_history_default() {
        let h = History::default();
        assert_eq!(h.max_history(), crate::validate::DEFAULT_MAX_HISTORY);
    }

    #[test]
    fn test_history_custom() {
        let h = History::new(100);
        assert_eq!(h.max_history(), 100);
    }

    #[test]
    fn test_page_serde_round_trip() {
        let page = Page::new(PageId::new(make_uuid(1)), "Home".to_string());
        let json = serde_json::to_string(&page).expect("serialize");
        let deserialized: Page = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(page, deserialized);
    }

    #[test]
    fn test_document_metadata_serde_round_trip() {
        let meta = DocumentMetadata::new("Test Doc".to_string());
        let json = serde_json::to_string(&meta).expect("serialize");
        let deserialized: DocumentMetadata = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(meta, deserialized);
    }
}
```

- [ ] 2. Add the module to `lib.rs`. Add after existing modules:

```rust
pub mod document;
```

And add re-exports:

```rust
pub use document::{
    ComponentDef, Document, DocumentMetadata, History, LayoutEngine, Page, TokenContext,
    Transition,
};
```

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 4. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 5. Commit:

```bash
git add crates/core/src/document.rs crates/core/src/lib.rs
git commit -m "feat(core): add document struct with stubs for future systems (spec-01)"
```

---

## Task 9: Serialization (`serialize.rs`)

**Files:**
- Create: `crates/core/src/serialize.rs`
- Modify: `crates/core/src/lib.rs`

This module provides JSON serialization/deserialization for the document format. Pretty-printed, sorted keys, schema versioning. Round-trip guarantee tested.

Note: The core crate does NOT do file I/O. The 50MB file size limit is documented here but enforced by the server. Core validates collection sizes and string lengths after deserialization.

- [ ] 1. Create `crates/core/src/serialize.rs`:

```rust
// crates/core/src/serialize.rs

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{CoreError, NodeId, PageId};
use crate::node::Node;
use crate::validate::CURRENT_SCHEMA_VERSION;

/// A serializable representation of a page (file format).
///
/// Uses UUIDs exclusively for node identity. Arena indices are not stable
/// across sessions and are NOT included in the file format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SerializedPage {
    pub schema_version: u32,
    pub id: Uuid,
    pub name: String,
    pub nodes: Vec<SerializedNode>,
    pub transitions: Vec<serde_json::Value>,
}

/// A serializable representation of a node (file format).
///
/// Parent and children use UUIDs, not `NodeId`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SerializedNode {
    pub id: Uuid,
    pub kind: serde_json::Value,
    pub name: String,
    pub parent: Option<Uuid>,
    pub children: Vec<Uuid>,
    pub transform: serde_json::Value,
    pub style: serde_json::Value,
    pub constraints: serde_json::Value,
    pub visible: bool,
    pub locked: bool,
}

/// Serializes a page to pretty-printed JSON with sorted keys.
///
/// # Errors
/// Returns `CoreError::SerializationError` if serialization fails.
pub fn serialize_page(page: &SerializedPage) -> Result<String, CoreError> {
    // serde_json's to_string_pretty doesn't sort keys by default.
    // We serialize to a Value first, then output with sorted keys.
    let value = serde_json::to_value(page).map_err(|e| {
        CoreError::SerializationError(format!("failed to serialize page: {e}"))
    })?;
    let sorted = sort_json_keys(&value);
    serde_json::to_string_pretty(&sorted).map_err(|e| {
        CoreError::SerializationError(format!("failed to write JSON: {e}"))
    })
}

/// Deserializes a page from JSON, validating the schema version.
///
/// # Errors
/// - `CoreError::UnsupportedSchemaVersion` if the file version is too new.
/// - `CoreError::SerializationError` if the JSON is malformed.
pub fn deserialize_page(json: &str) -> Result<SerializedPage, CoreError> {
    // Check schema version first (partial parse)
    let raw: serde_json::Value = serde_json::from_str(json).map_err(|e| {
        CoreError::SerializationError(format!("invalid JSON: {e}"))
    })?;

    if let Some(version) = raw.get("schema_version").and_then(serde_json::Value::as_u64) {
        let version = u32::try_from(version).unwrap_or(u32::MAX);
        if version > CURRENT_SCHEMA_VERSION {
            return Err(CoreError::UnsupportedSchemaVersion(
                version,
                CURRENT_SCHEMA_VERSION,
            ));
        }
    }

    let page: SerializedPage = serde_json::from_value(raw).map_err(|e| {
        CoreError::SerializationError(format!("failed to deserialize page: {e}"))
    })?;

    // Validate collection sizes
    validate_deserialized_page(&page)?;

    Ok(page)
}

/// Converts arena nodes into serialized nodes, resolving NodeIds to UUIDs.
///
/// # Errors
/// Returns `CoreError::NodeNotFound` if a node or its parent/child references are invalid.
pub fn nodes_to_serialized(
    nodes: &[&Node],
    arena: &crate::arena::Arena,
) -> Result<Vec<SerializedNode>, CoreError> {
    let mut result = Vec::with_capacity(nodes.len());

    for node in nodes {
        let parent_uuid = match node.parent {
            Some(pid) => Some(arena.uuid_of(pid)?),
            None => None,
        };

        let children_uuids: Result<Vec<Uuid>, CoreError> = node
            .children
            .iter()
            .map(|cid| arena.uuid_of(*cid))
            .collect();
        let children_uuids = children_uuids?;

        let kind_value = serde_json::to_value(&node.kind).map_err(|e| {
            CoreError::SerializationError(format!("failed to serialize node kind: {e}"))
        })?;
        let transform_value = serde_json::to_value(&node.transform).map_err(|e| {
            CoreError::SerializationError(format!("failed to serialize transform: {e}"))
        })?;
        let style_value = serde_json::to_value(&node.style).map_err(|e| {
            CoreError::SerializationError(format!("failed to serialize style: {e}"))
        })?;
        let constraints_value = serde_json::to_value(&node.constraints).map_err(|e| {
            CoreError::SerializationError(format!("failed to serialize constraints: {e}"))
        })?;

        result.push(SerializedNode {
            id: node.uuid,
            kind: kind_value,
            name: node.name.clone(),
            parent: parent_uuid,
            children: children_uuids,
            transform: transform_value,
            style: style_value,
            constraints: constraints_value,
            visible: node.visible,
            locked: node.locked,
        });
    }

    Ok(result)
}

/// Creates a `SerializedPage` from a document page.
///
/// Collects all nodes belonging to the page (root nodes and their descendants).
///
/// # Errors
/// Returns errors if node references are invalid.
pub fn page_to_serialized(
    page: &crate::document::Page,
    arena: &crate::arena::Arena,
) -> Result<SerializedPage, CoreError> {
    let mut all_nodes = Vec::new();

    for root_id in &page.root_nodes {
        collect_subtree(arena, *root_id, &mut all_nodes)?;
    }

    let node_refs: Vec<&Node> = all_nodes.iter().collect();
    let serialized_nodes = nodes_to_serialized(&node_refs, arena)?;

    Ok(SerializedPage {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: page.id.uuid(),
        name: page.name.clone(),
        nodes: serialized_nodes,
        transitions: Vec::new(),
    })
}

/// Recursively sorts all JSON object keys for deterministic output.
fn sort_json_keys(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut sorted: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for key in keys {
                if let Some(v) = map.get(key) {
                    sorted.insert(key.clone(), sort_json_keys(v));
                }
            }
            serde_json::Value::Object(sorted)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(sort_json_keys).collect())
        }
        other => other.clone(),
    }
}

/// Validates a deserialized page against collection size limits.
fn validate_deserialized_page(page: &SerializedPage) -> Result<(), CoreError> {
    use crate::validate::{
        validate_collection_size, validate_node_name, MAX_CHILDREN_PER_NODE,
    };

    for node in &page.nodes {
        validate_node_name(&node.name)?;
        validate_collection_size("children", node.children.len(), MAX_CHILDREN_PER_NODE)?;
    }

    Ok(())
}

/// Collects a node and all its descendants into the output vec.
fn collect_subtree(
    arena: &crate::arena::Arena,
    root_id: NodeId,
    output: &mut Vec<Node>,
) -> Result<(), CoreError> {
    let node = arena.get(root_id)?;
    output.push(node.clone());

    for child_id in node.children.clone() {
        collect_subtree(arena, child_id, output)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arena::Arena;
    use crate::document::Page;
    use crate::node::{Node, NodeKind, Style, Transform};

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn insert_frame(arena: &mut Arena, uuid: Uuid, name: &str) -> NodeId {
        let node = Node::new(
            NodeId::new(0, 0),
            uuid,
            NodeKind::Frame { auto_layout: None },
            name.to_string(),
        );
        arena.insert(node).expect("insert")
    }

    // ── serialize_page / deserialize_page round-trip ───────────────────

    #[test]
    fn test_serialize_deserialize_empty_page() {
        let page = SerializedPage {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: make_uuid(1),
            name: "Empty Page".to_string(),
            nodes: Vec::new(),
            transitions: Vec::new(),
        };

        let json = serialize_page(&page).expect("serialize");
        let deserialized = deserialize_page(&json).expect("deserialize");
        assert_eq!(page, deserialized);
    }

    #[test]
    fn test_serialize_produces_pretty_json() {
        let page = SerializedPage {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: make_uuid(1),
            name: "Test".to_string(),
            nodes: Vec::new(),
            transitions: Vec::new(),
        };

        let json = serialize_page(&page).expect("serialize");
        assert!(json.contains('\n'), "expected pretty-printed JSON");
    }

    #[test]
    fn test_serialize_produces_sorted_keys() {
        let page = SerializedPage {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: make_uuid(1),
            name: "Test".to_string(),
            nodes: Vec::new(),
            transitions: Vec::new(),
        };

        let json = serialize_page(&page).expect("serialize");
        // "id" should come before "name", "name" before "nodes", etc.
        let id_pos = json.find("\"id\"").expect("id field");
        let name_pos = json.find("\"name\"").expect("name field");
        let nodes_pos = json.find("\"nodes\"").expect("nodes field");
        let schema_pos = json.find("\"schema_version\"").expect("schema_version field");

        assert!(id_pos < name_pos, "id should come before name");
        assert!(name_pos < nodes_pos, "name should come before nodes");
        assert!(nodes_pos < schema_pos, "nodes should come before schema_version");
    }

    #[test]
    fn test_deserialize_rejects_future_schema_version() {
        let json = r#"{"schema_version": 999, "id": "00000000-0000-0000-0000-000000000001", "name": "Future", "nodes": [], "transitions": []}"#;
        let result = deserialize_page(json);
        assert!(matches!(
            result,
            Err(CoreError::UnsupportedSchemaVersion(999, _))
        ));
    }

    #[test]
    fn test_deserialize_accepts_current_schema_version() {
        let json = format!(
            r#"{{"schema_version": {}, "id": "00000000-0000-0000-0000-000000000001", "name": "Current", "nodes": [], "transitions": []}}"#,
            CURRENT_SCHEMA_VERSION
        );
        let result = deserialize_page(&json);
        assert!(result.is_ok());
    }

    #[test]
    fn test_deserialize_invalid_json() {
        let result = deserialize_page("not json at all");
        assert!(matches!(result, Err(CoreError::SerializationError(_))));
    }

    #[test]
    fn test_deserialize_rejects_invalid_node_name() {
        let json = r#"{
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": {"type": "group"},
                "name": "bad\u0000name",
                "parent": null,
                "children": [],
                "transform": {"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1},
                "style": {"fills":[],"strokes":[],"opacity":1.0,"blend_mode":"normal","effects":[]},
                "constraints": {"horizontal":"start","vertical":"start"},
                "visible": true,
                "locked": false
            }],
            "transitions": []
        }"#;
        let result = deserialize_page(json);
        assert!(matches!(result, Err(CoreError::ValidationError(_))));
    }

    // ── page_to_serialized ────────────────────────────────────────────

    #[test]
    fn test_page_to_serialized_empty_page() {
        let arena = Arena::new(100);
        let page = Page::new(PageId::new(make_uuid(1)), "Empty".to_string());

        let serialized = page_to_serialized(&page, &arena).expect("serialize");
        assert_eq!(serialized.name, "Empty");
        assert!(serialized.nodes.is_empty());
        assert_eq!(serialized.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_page_to_serialized_with_nodes() {
        let mut arena = Arena::new(100);
        let root_uuid = make_uuid(10);
        let child_uuid = make_uuid(11);

        let root_id = insert_frame(&mut arena, root_uuid, "Root");
        let child_id = insert_frame(&mut arena, child_uuid, "Child");

        // Set up tree
        crate::tree::add_child(&mut arena, root_id, child_id).expect("add_child");

        let page_id = PageId::new(make_uuid(1));
        let mut page = Page::new(page_id, "Home".to_string());
        page.root_nodes.push(root_id);

        let serialized = page_to_serialized(&page, &arena).expect("serialize");
        assert_eq!(serialized.nodes.len(), 2);
        assert_eq!(serialized.nodes[0].id, root_uuid);
        assert_eq!(serialized.nodes[1].id, child_uuid);
        assert!(serialized.nodes[0].parent.is_none());
        assert_eq!(serialized.nodes[1].parent, Some(root_uuid));
        assert_eq!(serialized.nodes[0].children, vec![child_uuid]);
    }

    // ── Full round-trip: document -> serialized -> JSON -> deserialized ──

    #[test]
    fn test_full_round_trip_with_nodes() {
        let mut arena = Arena::new(100);
        let root_uuid = make_uuid(10);
        let child_uuid = make_uuid(11);

        let root_id = insert_frame(&mut arena, root_uuid, "Root Frame");
        let child_id = {
            let node = Node::new(
                NodeId::new(0, 0),
                child_uuid,
                NodeKind::Rectangle { corner_radii: [8.0, 8.0, 8.0, 8.0] },
                "Rounded Rect".to_string(),
            );
            arena.insert(node).expect("insert")
        };

        crate::tree::add_child(&mut arena, root_id, child_id).expect("add_child");

        let page_id = PageId::new(make_uuid(1));
        let mut page = Page::new(page_id, "Home".to_string());
        page.root_nodes.push(root_id);

        // Serialize
        let serialized = page_to_serialized(&page, &arena).expect("page_to_serialized");
        let json = serialize_page(&serialized).expect("serialize_page");

        // Deserialize
        let deserialized = deserialize_page(&json).expect("deserialize_page");

        // Verify round-trip
        assert_eq!(serialized.schema_version, deserialized.schema_version);
        assert_eq!(serialized.id, deserialized.id);
        assert_eq!(serialized.name, deserialized.name);
        assert_eq!(serialized.nodes.len(), deserialized.nodes.len());

        for (orig, deser) in serialized.nodes.iter().zip(deserialized.nodes.iter()) {
            assert_eq!(orig.id, deser.id);
            assert_eq!(orig.name, deser.name);
            assert_eq!(orig.parent, deser.parent);
            assert_eq!(orig.children, deser.children);
            assert_eq!(orig.visible, deser.visible);
            assert_eq!(orig.locked, deser.locked);
        }
    }

    // ── sort_json_keys ─────────────────────────────────────────────────

    #[test]
    fn test_sort_json_keys_simple_object() {
        let input: serde_json::Value =
            serde_json::from_str(r#"{"z": 1, "a": 2, "m": 3}"#).expect("parse");
        let sorted = sort_json_keys(&input);
        let output = serde_json::to_string(&sorted).expect("serialize");
        assert_eq!(output, r#"{"a":2,"m":3,"z":1}"#);
    }

    #[test]
    fn test_sort_json_keys_nested() {
        let input: serde_json::Value =
            serde_json::from_str(r#"{"b": {"z": 1, "a": 2}, "a": 3}"#).expect("parse");
        let sorted = sort_json_keys(&input);
        let output = serde_json::to_string(&sorted).expect("serialize");
        assert_eq!(output, r#"{"a":3,"b":{"a":2,"z":1}}"#);
    }

    #[test]
    fn test_sort_json_keys_array() {
        let input: serde_json::Value =
            serde_json::from_str(r#"[{"b": 1, "a": 2}]"#).expect("parse");
        let sorted = sort_json_keys(&input);
        let output = serde_json::to_string(&sorted).expect("serialize");
        assert_eq!(output, r#"[{"a":2,"b":1}]"#);
    }

    #[test]
    fn test_sort_json_keys_primitive() {
        let input = serde_json::Value::Number(serde_json::Number::from(42));
        let sorted = sort_json_keys(&input);
        assert_eq!(sorted, input);
    }

    // ── nodes_to_serialized ────────────────────────────────────────────

    #[test]
    fn test_nodes_to_serialized_single_root() {
        let mut arena = Arena::new(100);
        let uuid = make_uuid(1);
        let id = insert_frame(&mut arena, uuid, "Frame");

        let node = arena.get(id).expect("get");
        let serialized = nodes_to_serialized(&[node], &arena).expect("serialize");

        assert_eq!(serialized.len(), 1);
        assert_eq!(serialized[0].id, uuid);
        assert_eq!(serialized[0].name, "Frame");
        assert!(serialized[0].parent.is_none());
        assert!(serialized[0].children.is_empty());
    }

    #[test]
    fn test_nodes_to_serialized_with_parent_child() {
        let mut arena = Arena::new(100);
        let parent_uuid = make_uuid(1);
        let child_uuid = make_uuid(2);

        let parent_id = insert_frame(&mut arena, parent_uuid, "Parent");
        let child_id = insert_frame(&mut arena, child_uuid, "Child");

        crate::tree::add_child(&mut arena, parent_id, child_id).expect("add_child");

        let parent_node = arena.get(parent_id).expect("get");
        let child_node = arena.get(child_id).expect("get");
        let serialized =
            nodes_to_serialized(&[parent_node, child_node], &arena).expect("serialize");

        assert_eq!(serialized[0].children, vec![child_uuid]);
        assert_eq!(serialized[1].parent, Some(parent_uuid));
    }
}
```

- [ ] 2. Add the module to `lib.rs`. Add after existing modules:

```rust
pub mod serialize;
```

And add re-exports:

```rust
pub use serialize::{
    SerializedNode, SerializedPage, deserialize_page, nodes_to_serialized, page_to_serialized,
    serialize_page,
};
```

- [ ] 3. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 4. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 5. Commit:

```bash
git add crates/core/src/serialize.rs crates/core/src/lib.rs
git commit -m "feat(core): add JSON serialization with schema versioning (spec-01)"
```

---

## Task 10: Finalize `lib.rs` public API

**Files:**
- Modify: `crates/core/src/lib.rs`

Ensure the full public API is cleanly re-exported from `lib.rs`.

- [ ] 1. Update `crates/core/src/lib.rs` to its final form:

```rust
// crates/core/src/lib.rs
#![warn(clippy::all, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod arena;
pub mod document;
pub mod error;
pub mod id;
pub mod node;
pub mod serialize;
pub mod tree;
pub mod validate;

// ── Re-exports: Error ──────────────────────────────────────────────────
pub use error::CoreError;

// ── Re-exports: IDs ────────────────────────────────────────────────────
pub use id::{ComponentId, NodeId, PageId, TokenId};

// ── Re-exports: Node model ────────────────────────────────────────────
pub use node::{
    AlignItems, AutoLayout, BlendMode, Color, Constraints, Effect, Fill, FillRule, GradientDef,
    GradientStop, JustifyContent, LayoutDirection, Node, NodeKind, OverrideMap, Padding, PathData,
    PinConstraint, Point, ScaleMode, Stroke, StrokeAlignment, StrokeCap, StrokeJoin, Style,
    StyleValue, TextAlign, TextStyle, Transform,
};

// ── Re-exports: Arena ──────────────────────────────────────────────────
pub use arena::Arena;

// ── Re-exports: Document ───────────────────────────────────────────────
pub use document::{
    ComponentDef, Document, DocumentMetadata, History, LayoutEngine, Page, TokenContext,
    Transition,
};

// ── Re-exports: Serialization ──────────────────────────────────────────
pub use serialize::{
    SerializedNode, SerializedPage, deserialize_page, nodes_to_serialized, page_to_serialized,
    serialize_page,
};

// ── Re-exports: Validation ─────────────────────────────────────────────
pub use validate::{
    CURRENT_SCHEMA_VERSION, DEFAULT_MAX_HISTORY, DEFAULT_MAX_NODES, MAX_ALIAS_CHAIN_DEPTH,
    MAX_ASSET_REF_LEN, MAX_CHILDREN_PER_NODE, MAX_EFFECTS_PER_STYLE, MAX_FILE_SIZE,
    MAX_FILLS_PER_STYLE, MAX_JSON_NESTING_DEPTH, MAX_NODE_NAME_LEN, MAX_SEGMENTS_PER_SUBPATH,
    MAX_STROKES_PER_STYLE, MAX_SUBPATHS_PER_PATH, MAX_TEXT_CONTENT_LEN, MAX_TOKEN_NAME_LEN,
    validate_asset_ref, validate_collection_size, validate_node_name, validate_text_content,
    validate_token_name,
};

#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!version().is_empty());
    }
}
```

- [ ] 2. Run tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass.

- [ ] 3. Run clippy:

```bash
./dev.sh cargo clippy -p agent-designer-core -- -D warnings
```

Expected: no warnings.

- [ ] 4. Verify the full workspace builds:

```bash
./dev.sh cargo build --workspace
```

Expected: compiles with no errors.

- [ ] 5. Commit:

```bash
git add crates/core/src/lib.rs
git commit -m "feat(core): finalize lib.rs public API re-exports (spec-01)"
```

---

## Summary

| Task | Module | Est. Time |
|------|--------|-----------|
| 1 | Cargo.toml | 5 min |
| 2 | error.rs | 15 min |
| 3 | validate.rs | 15 min |
| 4 | id.rs | 15 min |
| 5 | node.rs | 30 min |
| 6 | arena.rs | 25 min |
| 7 | tree.rs | 25 min |
| 8 | document.rs | 20 min |
| 9 | serialize.rs | 25 min |
| 10 | lib.rs (final) | 10 min |
| **Total** | | **~3 hours** |

**Dependency order:** Tasks 1-4 must be done first (in order). Tasks 5-9 each depend on tasks 1-4 but are mostly independent of each other (though tree.rs uses arena.rs, serialize.rs uses everything). Task 10 is last.

**What's ready after Plan 01a:**
- All core data types are defined and tested
- Arena can store, retrieve, and remove nodes
- Tree operations maintain parent/child invariants with cycle detection
- Documents can hold pages, nodes, and metadata
- Pages can be serialized to/from JSON with round-trip guarantee
- Validation functions enforce all input limits from the spec

**What's deferred:**
- Plan 01b: Command trait, History (undo/redo), Layout engine (Taffy), CompoundCommand
- Plan 01c: Component system, OverrideMap, Design tokens, Path geometry, Boolean ops, Prototypes
