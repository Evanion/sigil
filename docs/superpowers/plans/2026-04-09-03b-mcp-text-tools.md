# MCP Broadcast Parity + Text Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add text content/style MCP tools, migrate all MCP broadcast from legacy `publish_event` to `publish_transaction`, add `TextShadow` to the core type system, and remove the legacy broadcast API.

**Architecture:** Three phases — (1) extend core types with TextShadow + validation, (2) migrate all MCP tools to `publish_transaction` and remove `publish_event`, (3) add `set_text_content` + `set_text_style` MCP tools with partial-object input. Each phase produces independently testable code.

**Tech Stack:** Rust Edition 2024 (core, state, mcp, server crates), TypeScript/Solid.js (frontend types + rendering + panel), rmcp (MCP framework), schemars (JSON Schema generation)

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `crates/mcp/src/tools/text.rs` | `set_text_content_impl`, `set_text_style_impl` |
| `crates/mcp/src/tools/broadcast.rs` | Shared `build_transaction` helper for all MCP tools |

### Major modifications
| File | Changes |
|------|---------|
| `crates/core/src/node.rs` | Add `TextShadow` struct with private fields + validating constructor, add `text_shadow: Option<TextShadow>` to `TextStyle` |
| `crates/core/src/validate.rs` | Add `MAX_TEXT_SHADOW_BLUR` constant, extend `validate_text_style()` for shadow fields |
| `crates/core/src/commands/text_style_commands.rs` | Add `TextShadow(Option<TextShadow>)` variant to `TextStyleField` |
| `crates/core/src/lib.rs` | Re-export `TextShadow` |
| `crates/state/src/lib.rs` | Remove `publish_event()` method |
| `crates/mcp/src/server.rs` | Register `set_text_content` + `set_text_style` tools |
| `crates/mcp/src/types.rs` | Add `SetTextContentInput`, `SetTextStyleInput`, `PartialTextStyle`, `TextShadowInput` |
| `crates/mcp/src/tools/nodes.rs` | Migrate all `publish_event` → `publish_transaction` via broadcast helper |
| `crates/mcp/src/tools/mod.rs` | Add `pub mod text;` and `pub mod broadcast;` |
| `crates/server/src/graphql/mutation.rs` | Add `kind.text_style.text_shadow` path, migrate any remaining `publish_event` calls |
| `frontend/src/types/document.ts` | Add `TextShadow` type, update `TextStyle` |
| `frontend/src/canvas/renderer.ts` | Render text shadow via Canvas 2D shadow API |
| `frontend/src/panels/TypographySection.tsx` | Add shadow toggle + offset/blur/color controls |
| `frontend/src/store/document-store-solid.tsx` | Wire `text_shadow` through `TextStylePatch` |
| `frontend/src/store/document-store-types.ts` | Add `text_shadow` to `TextStylePatch` union |

---

## Task 1: Add TextShadow to core types

**Files:**
- Modify: `crates/core/src/node.rs`
- Modify: `crates/core/src/validate.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] **Step 1: Add MAX_TEXT_SHADOW_BLUR constant to validate.rs**

In `crates/core/src/validate.rs`, add after the font size constants:

```rust
pub const MAX_TEXT_SHADOW_BLUR: f64 = 1000.0;
```

- [ ] **Step 2: Add TextShadow struct to node.rs**

After the `TextDecoration` enum, add:

```rust
/// Text shadow with private fields — constructed via `TextShadow::new()` which validates.
/// `Deserialize` is NOT derived; deserialization goes through the validating constructor.
#[derive(Debug, Clone, PartialEq)]
pub struct TextShadow {
    offset_x: f64,
    offset_y: f64,
    blur_radius: f64,
    color: StyleValue<Color>,
}

impl TextShadow {
    /// Create a new `TextShadow`, validating all fields.
    ///
    /// # Errors
    /// Returns `CoreError::ValidationError` if any float is NaN/Infinity,
    /// blur_radius is negative or exceeds `MAX_TEXT_SHADOW_BLUR`,
    /// or color channels are non-finite.
    pub fn new(
        offset_x: f64,
        offset_y: f64,
        blur_radius: f64,
        color: StyleValue<Color>,
    ) -> Result<Self, CoreError> {
        validate_finite("text_shadow.offset_x", offset_x)?;
        validate_finite("text_shadow.offset_y", offset_y)?;
        validate_finite("text_shadow.blur_radius", blur_radius)?;
        if blur_radius < 0.0 {
            return Err(CoreError::ValidationError(
                "text_shadow.blur_radius must be >= 0".into(),
            ));
        }
        if blur_radius > MAX_TEXT_SHADOW_BLUR {
            return Err(CoreError::ValidationError(format!(
                "text_shadow.blur_radius {blur_radius} exceeds max {MAX_TEXT_SHADOW_BLUR}"
            )));
        }
        if let StyleValue::Literal { value: ref c } = color {
            validate_color_finite(c)?;
        }
        Ok(Self { offset_x, offset_y, blur_radius, color })
    }

    pub fn offset_x(&self) -> f64 { self.offset_x }
    pub fn offset_y(&self) -> f64 { self.offset_y }
    pub fn blur_radius(&self) -> f64 { self.blur_radius }
    pub fn color(&self) -> &StyleValue<Color> { &self.color }
}
```

Note: `validate_color_finite` should already exist from the RF-002 remediation (in `validate_text_style`). If not, extract the color channel validation into a reusable function.

- [ ] **Step 3: Implement Serialize and custom Deserialize for TextShadow**

```rust
impl Serialize for TextShadow {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("TextShadow", 4)?;
        s.serialize_field("offset_x", &self.offset_x)?;
        s.serialize_field("offset_y", &self.offset_y)?;
        s.serialize_field("blur_radius", &self.blur_radius)?;
        s.serialize_field("color", &self.color)?;
        s.end()
    }
}

impl<'de> Deserialize<'de> for TextShadow {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Raw {
            offset_x: f64,
            offset_y: f64,
            blur_radius: f64,
            color: StyleValue<Color>,
        }
        let raw = Raw::deserialize(deserializer)?;
        TextShadow::new(raw.offset_x, raw.offset_y, raw.blur_radius, raw.color)
            .map_err(serde::de::Error::custom)
    }
}
```

- [ ] **Step 4: Add text_shadow field to TextStyle**

```rust
pub struct TextStyle {
    pub font_family: String,
    pub font_size: StyleValue<f64>,
    pub font_weight: u16,
    pub font_style: FontStyle,
    pub line_height: StyleValue<f64>,
    pub letter_spacing: StyleValue<f64>,
    pub text_align: TextAlign,
    pub text_decoration: TextDecoration,
    pub text_color: StyleValue<Color>,
    pub text_shadow: Option<TextShadow>,  // NEW
}
```

Update `Default for TextStyle` to include `text_shadow: None`.

- [ ] **Step 5: Update validate_text_style for text_shadow**

In `validate.rs`, extend `validate_text_style()`:

```rust
if let Some(ref shadow) = ts.text_shadow {
    // TextShadow::new already validated on construction, but workfile
    // deserialization goes through the custom Deserialize which calls new().
    // Re-validate here for defense-in-depth on direct struct construction.
    validate_finite("text_shadow.offset_x", shadow.offset_x())?;
    validate_finite("text_shadow.offset_y", shadow.offset_y())?;
    validate_finite("text_shadow.blur_radius", shadow.blur_radius())?;
    if shadow.blur_radius() < 0.0 || shadow.blur_radius() > MAX_TEXT_SHADOW_BLUR {
        return Err(CoreError::ValidationError(
            format!("text_shadow.blur_radius out of range [0, {MAX_TEXT_SHADOW_BLUR}]")));
    }
    if let StyleValue::Literal { value: ref c } = shadow.color() {
        validate_color_finite(c)?;
    }
}
```

- [ ] **Step 6: Update lib.rs re-exports**

Add `TextShadow` and `MAX_TEXT_SHADOW_BLUR` to the re-exports in `lib.rs`.

- [ ] **Step 7: Fix compilation errors**

Run `cargo check -p agent-designer-core --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/Cargo.toml` and fix any construction sites missing `text_shadow: None`.

- [ ] **Step 8: Add tests**

```rust
#[test]
fn test_text_shadow_new_valid() {
    let shadow = TextShadow::new(2.0, 3.0, 5.0, StyleValue::Literal {
        value: Color::Srgb { r: 0.0, g: 0.0, b: 0.0, a: 0.5 },
    });
    assert!(shadow.is_ok());
    let s = shadow.unwrap();
    assert_eq!(s.offset_x(), 2.0);
    assert_eq!(s.blur_radius(), 5.0);
}

#[test]
fn test_text_shadow_rejects_nan_offset() {
    let result = TextShadow::new(f64::NAN, 0.0, 0.0, StyleValue::Literal {
        value: Color::Srgb { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
    });
    assert!(result.is_err());
}

#[test]
fn test_text_shadow_rejects_negative_blur() {
    let result = TextShadow::new(0.0, 0.0, -1.0, StyleValue::Literal {
        value: Color::Srgb { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
    });
    assert!(result.is_err());
}

#[test]
fn test_max_text_shadow_blur_enforced() {
    let result = TextShadow::new(0.0, 0.0, MAX_TEXT_SHADOW_BLUR + 1.0, StyleValue::Literal {
        value: Color::Srgb { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
    });
    assert!(result.is_err());
}

#[test]
fn test_text_shadow_serde_roundtrip() {
    let shadow = TextShadow::new(1.0, 2.0, 3.0, StyleValue::Literal {
        value: Color::Srgb { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
    }).unwrap();
    let json = serde_json::to_string(&shadow).unwrap();
    let deserialized: TextShadow = serde_json::from_str(&json).unwrap();
    assert_eq!(shadow, deserialized);
}

#[test]
fn test_text_shadow_deserialize_rejects_nan() {
    let json = r#"{"offset_x": NaN, "offset_y": 0, "blur_radius": 0, "color": {"type": "literal", "value": {"space": "srgb", "r": 0, "g": 0, "b": 0, "a": 1}}}"#;
    let result: Result<TextShadow, _> = serde_json::from_str(json);
    assert!(result.is_err());
}
```

- [ ] **Step 9: Run tests and commit**

```bash
cargo test --workspace --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/Cargo.toml
cargo clippy --workspace --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/Cargo.toml -- -D warnings
```

```
feat(core): add TextShadow type with validated constructor (Spec 03b, Task 1)
```

---

## Task 2: Add TextShadow variant to SetTextStyleField

**Files:**
- Modify: `crates/core/src/commands/text_style_commands.rs`

- [ ] **Step 1: Write failing test**

```rust
#[test]
fn test_set_text_style_field_text_shadow_validate_and_apply() {
    let mut doc = Document::new("Test".to_string());
    let shadow = TextShadow::new(2.0, 3.0, 5.0, StyleValue::Literal {
        value: Color::Srgb { r: 0.0, g: 0.0, b: 0.0, a: 0.5 },
    }).unwrap();
    let node = Node::new(
        NodeId::new(0, 0), uuid::Uuid::new_v4(),
        NodeKind::Text { content: "Hello".to_string(), text_style: TextStyle::default(), sizing: TextSizing::AutoWidth },
        "Text".to_string(),
    ).unwrap();
    let node_id = doc.arena.insert(node).unwrap();

    let op = SetTextStyleField { node_id, field: TextStyleField::TextShadow(Some(shadow.clone())) };
    op.validate(&doc).unwrap();
    op.apply(&mut doc).unwrap();

    let updated = doc.arena.get(node_id).unwrap();
    if let NodeKind::Text { ref text_style, .. } = updated.kind {
        assert_eq!(text_style.text_shadow, Some(shadow));
    } else { panic!("not text"); }
}

#[test]
fn test_set_text_style_field_text_shadow_remove() {
    // Create node with shadow, then set TextShadow(None) to remove it
    let mut doc = Document::new("Test".to_string());
    let shadow = TextShadow::new(1.0, 1.0, 1.0, StyleValue::Literal {
        value: Color::Srgb { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
    }).unwrap();
    let mut style = TextStyle::default();
    style.text_shadow = Some(shadow);
    let node = Node::new(
        NodeId::new(0, 0), uuid::Uuid::new_v4(),
        NodeKind::Text { content: "Hi".to_string(), text_style: style, sizing: TextSizing::AutoWidth },
        "Text".to_string(),
    ).unwrap();
    let node_id = doc.arena.insert(node).unwrap();

    let op = SetTextStyleField { node_id, field: TextStyleField::TextShadow(None) };
    op.validate(&doc).unwrap();
    op.apply(&mut doc).unwrap();

    let updated = doc.arena.get(node_id).unwrap();
    if let NodeKind::Text { ref text_style, .. } = updated.kind {
        assert!(text_style.text_shadow.is_none());
    } else { panic!("not text"); }
}
```

- [ ] **Step 2: Add TextShadow variant to TextStyleField enum**

```rust
pub enum TextStyleField {
    FontFamily(String),
    FontSize(StyleValue<f64>),
    FontWeight(u16),
    FontStyle(FontStyle),
    LineHeight(StyleValue<f64>),
    LetterSpacing(StyleValue<f64>),
    TextAlign(TextAlign),
    TextDecoration(TextDecoration),
    TextColor(StyleValue<Color>),
    TextShadow(Option<TextShadow>),  // NEW — None removes shadow
}
```

- [ ] **Step 3: Add validate and apply arms**

In `SetTextStyleField::validate`:
```rust
TextStyleField::TextShadow(ref opt_shadow) => {
    // TextShadow::new already validates; None is always valid
    if let Some(ref shadow) = opt_shadow {
        // Defense-in-depth: re-validate in case shadow was constructed
        // without going through TextShadow::new
        validate_finite("text_shadow.offset_x", shadow.offset_x())?;
        validate_finite("text_shadow.offset_y", shadow.offset_y())?;
        validate_finite("text_shadow.blur_radius", shadow.blur_radius())?;
        if shadow.blur_radius() < 0.0 || shadow.blur_radius() > MAX_TEXT_SHADOW_BLUR {
            return Err(CoreError::ValidationError(
                "text_shadow.blur_radius out of range".into()));
        }
    }
}
```

In `SetTextStyleField::apply`:
```rust
TextStyleField::TextShadow(ref v) => text_style.text_shadow = v.clone(),
```

- [ ] **Step 4: Run tests and commit**

```
feat(core): add TextShadow variant to SetTextStyleField (Spec 03b, Task 2)
```

---

## Task 3: Wire text_shadow through server GraphQL

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs`

- [ ] **Step 1: Add `kind.text_style.text_shadow` path to parse_set_field**

Follow the pattern of other text style paths. The value is `Option<TextShadowInput>` — `null` JSON removes the shadow, an object sets it.

```rust
"kind.text_style.text_shadow" => {
    validate_floats_in_value(&value)?;
    // null => remove shadow, object => set shadow
    let opt_shadow: Option<TextShadow> = if value.is_null() {
        None
    } else {
        let raw: TextShadowRaw = serde_json::from_value(value)?;
        Some(TextShadow::new(raw.offset_x, raw.offset_y, raw.blur_radius, raw.color)
            .map_err(|e| async_graphql::Error::new(format!("invalid text_shadow: {e}")))?)
    };
    Ok(ParsedOp {
        builder: Box::new(move |doc| {
            let node_id = doc.arena.id_by_uuid(&parsed_uuid)
                .ok_or_else(|| async_graphql::Error::new("node not found"))?;
            Ok(Box::new(SetTextStyleField {
                node_id,
                field: TextStyleField::TextShadow(opt_shadow),
            }) as Box<dyn FieldOperation>)
        }),
        broadcast,
    })
}
```

Define `TextShadowRaw` as a helper struct:
```rust
#[derive(Deserialize)]
struct TextShadowRaw {
    offset_x: f64,
    offset_y: f64,
    blur_radius: f64,
    color: StyleValue<Color>,
}
```

- [ ] **Step 2: Add test**

```rust
#[tokio::test]
async fn test_apply_operations_set_field_text_shadow() {
    // Create a text node, then set a text shadow, verify it applied
}
```

- [ ] **Step 3: Run tests and commit**

```
feat(server): wire text_shadow path into applyOperations (Spec 03b, Task 3)
```

---

## Task 4: Create broadcast helper and migrate MCP tools

**Files:**
- Create: `crates/mcp/src/tools/broadcast.rs`
- Modify: `crates/mcp/src/tools/mod.rs`
- Modify: `crates/mcp/src/tools/nodes.rs`
- Modify: `crates/mcp/src/tools/pages.rs`
- Modify: `crates/mcp/src/tools/tokens.rs`
- Modify: `crates/state/src/lib.rs`

This is the largest task — migrating all existing MCP tools from `publish_event` to `publish_transaction`.

- [ ] **Step 1: Create broadcast.rs helper module**

Create `crates/mcp/src/tools/broadcast.rs`:

```rust
use agent_designer_state::{
    AppState, MutationEventKind, OperationPayload, TransactionPayload,
};

/// Static user ID for MCP-originated mutations.
pub const MCP_USER_ID: &str = "mcp-agent";

/// Build a `TransactionPayload` for a single-operation mutation.
pub fn single_op_transaction(
    node_uuid: &str,
    op_type: &str,
    path: &str,
    value: Option<serde_json::Value>,
) -> TransactionPayload {
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: MCP_USER_ID.to_string(),
        seq: 0, // assigned by publish_transaction
        operations: vec![OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: node_uuid.to_string(),
            op_type: op_type.to_string(),
            path: path.to_string(),
            value,
        }],
    }
}

/// Build a `TransactionPayload` for a multi-operation mutation.
pub fn multi_op_transaction(
    operations: Vec<OperationPayload>,
) -> TransactionPayload {
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: MCP_USER_ID.to_string(),
        seq: 0,
        operations,
    }
}

/// Broadcast a single-operation transaction and signal dirty.
pub fn broadcast_and_persist(
    state: &AppState,
    kind: MutationEventKind,
    node_uuid: &str,
    op_type: &str,
    path: &str,
    value: Option<serde_json::Value>,
) {
    state.signal_dirty();
    state.publish_transaction(
        kind,
        Some(node_uuid.to_string()),
        single_op_transaction(node_uuid, op_type, path, value),
    );
}
```

- [ ] **Step 2: Add mod declaration**

In `crates/mcp/src/tools/mod.rs`, add:
```rust
pub mod broadcast;
```

- [ ] **Step 3: Migrate nodes.rs — replace every publish_event with broadcast helper**

For each `_impl` function in `nodes.rs`, replace the post-lock block:

**Before (e.g., rename_node_impl):**
```rust
state.signal_dirty();
state.publish_event(MutationEvent {
    kind: MutationEventKind::NodeUpdated,
    uuid: Some(node_uuid.to_string()),
    data: Some(serde_json::json!({"field": "name"})),
    transaction: None,
});
```

**After:**
```rust
broadcast::broadcast_and_persist(
    state,
    MutationEventKind::NodeUpdated,
    &node_uuid.to_string(),
    "set_field",
    "name",
    Some(serde_json::json!(new_name)),
);
```

Apply this pattern to ALL mutation functions in nodes.rs:
- `create_node_impl` → op_type `"create"`, path `"node"`, value = node kind JSON
- `delete_node_impl` → op_type `"delete"`, path `"node"`, value = None
- `rename_node_impl` → op_type `"set_field"`, path `"name"`, value = new name
- `set_transform_impl` → op_type `"set_field"`, path `"transform"`, value = transform JSON
- `set_visible_impl` → op_type `"set_field"`, path `"visible"`, value = bool
- `set_locked_impl` → op_type `"set_field"`, path `"locked"`, value = bool
- `reparent_node_impl` → op_type `"reparent"`, path `"parent"`, value = new parent UUID + position
- `reorder_children_impl` → op_type `"reorder"`, path `"children"`, value = new order
- `set_opacity_impl` → op_type `"set_field"`, path `"style.opacity"`, value = opacity
- `set_blend_mode_impl` → op_type `"set_field"`, path `"style.blend_mode"`, value = blend mode
- `set_fills_impl` → op_type `"set_field"`, path `"style.fills"`, value = fills JSON
- `set_strokes_impl` → op_type `"set_field"`, path `"style.strokes"`, value = strokes JSON
- `set_effects_impl` → op_type `"set_field"`, path `"style.effects"`, value = effects JSON
- `set_corner_radii_impl` → op_type `"set_field"`, path `"kind.corner_radii"`, value = radii JSON

- [ ] **Step 4: Migrate pages.rs and tokens.rs**

Apply the same pattern to page and token mutation functions. Use `MutationEventKind::PageCreated` / `PageDeleted` / `TokenUpdated` etc. as appropriate.

- [ ] **Step 5: Remove publish_event from AppState**

In `crates/state/src/lib.rs`:
1. Make `publish_event` a private method (rename to `broadcast_internal` or similar) — it's still called by `publish_transaction`
2. Remove the `pub` visibility
3. Verify no external callers remain: `grep -r "publish_event" crates/` should return only the internal call in `publish_transaction`

- [ ] **Step 6: Remove MutationEvent import from MCP crate**

Remove `use agent_designer_state::MutationEvent;` from `nodes.rs` and any other MCP files that imported it directly for `publish_event` calls.

- [ ] **Step 7: Run full test suite**

```bash
cargo test --workspace --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/Cargo.toml
cargo clippy --workspace --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/Cargo.toml -- -D warnings
```

- [ ] **Step 8: Commit**

```
refactor(mcp,state): migrate all MCP broadcast to publish_transaction, remove legacy publish_event (Spec 03b, Task 4)
```

---

## Task 5: Add MCP text tools

**Files:**
- Create: `crates/mcp/src/tools/text.rs`
- Modify: `crates/mcp/src/tools/mod.rs`
- Modify: `crates/mcp/src/types.rs`
- Modify: `crates/mcp/src/server.rs`

- [ ] **Step 1: Add input types to types.rs**

```rust
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SetTextContentInput {
    /// UUID of the text node
    pub uuid: String,
    /// New text content (UTF-8, max 1,000,000 bytes)
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SetTextStyleInput {
    /// UUID of the text node
    pub uuid: String,
    /// Partial text style — only provided fields are updated.
    /// At least one field must be set.
    pub style: PartialTextStyle,
}

#[derive(Debug, Default, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PartialTextStyle {
    /// Font family name (e.g., "Inter", "system-ui")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// Font size in pixels
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<StyleValueInput<f64>>,
    /// Font weight (100-900)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    /// Font style: "normal" or "italic"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_style: Option<String>,
    /// Line height multiplier (e.g., 1.5)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<StyleValueInput<f64>>,
    /// Letter spacing in pixels
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<StyleValueInput<f64>>,
    /// Text alignment: "left", "center", "right", "justify"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,
    /// Text decoration: "none", "underline", "strikethrough"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_decoration: Option<String>,
    /// Text color
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color: Option<StyleValueInput<ColorInput>>,
    /// Text shadow (null to remove, object to set)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_shadow: Option<Option<TextShadowInput>>,
}

#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct TextShadowInput {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur_radius: f64,
    pub color: StyleValueInput<ColorInput>,
}
```

Note: Check if `StyleValueInput` and `ColorInput` types already exist in `types.rs`. If not, define them or reuse the core types with schemars derives.

- [ ] **Step 2: Implement set_text_content_impl in text.rs**

Create `crates/mcp/src/tools/text.rs`:

```rust
use agent_designer_core::{
    commands::node_commands::SetTextContent,
    command::FieldOperation,
    validate::MAX_TEXT_CONTENT_LEN,
};
use agent_designer_state::{AppState, MutationEventKind};
use crate::error::McpToolError;
use crate::tools::broadcast;
use crate::tools::nodes::{acquire_document_lock, build_node_info};
use crate::types::NodeInfo;
use uuid::Uuid;

pub fn set_text_content_impl(
    state: &AppState,
    uuid_str: &str,
    content: &str,
) -> Result<NodeInfo, McpToolError> {
    // Validate before lock
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    if content.len() > MAX_TEXT_CONTENT_LEN {
        return Err(McpToolError::InvalidInput(format!(
            "text content exceeds maximum of {MAX_TEXT_CONTENT_LEN} bytes"
        )));
    }

    let node_info = {
        let mut doc = acquire_document_lock(state);
        let node_id = doc.arena.id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetTextContent {
            node_id,
            new_content: content.to_string(),
        };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        build_node_info(&doc, node_id, node_uuid)?
    };

    broadcast::broadcast_and_persist(
        state,
        MutationEventKind::NodeUpdated,
        &node_uuid.to_string(),
        "set_field",
        "kind.content",
        Some(serde_json::json!(content)),
    );

    Ok(node_info)
}
```

- [ ] **Step 3: Implement set_text_style_impl in text.rs**

```rust
use agent_designer_core::{
    commands::text_style_commands::{SetTextStyleField, TextStyleField},
    command::FieldOperation,
    node::*,
    validate::*,
};
use agent_designer_state::OperationPayload;

pub fn set_text_style_impl(
    state: &AppState,
    uuid_str: &str,
    style: &crate::types::PartialTextStyle,
) -> Result<NodeInfo, McpToolError> {
    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    // Build list of TextStyleField operations from partial style
    let fields = parse_partial_text_style(style)?;
    if fields.is_empty() {
        return Err(McpToolError::InvalidInput(
            "at least one text style field must be provided".into()));
    }

    // Validate float inputs before lock
    for (_, field) in &fields {
        validate_text_style_field_input(field)?;
    }

    let node_info = {
        let mut doc = acquire_document_lock(state);
        let node_id = doc.arena.id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        // Validate all, then apply all (with rollback tracking)
        let mut completed: Vec<(TextStyleField, /* previous */ TextStyleField)> = Vec::new();

        for (_, field) in &fields {
            let op = SetTextStyleField { node_id, field: field.clone() };
            op.validate(&doc)?;
        }

        for (_, field) in &fields {
            // Capture previous value for rollback
            let prev = capture_previous_field(&doc, node_id, field)?;
            let op = SetTextStyleField { node_id, field: field.clone() };
            if let Err(e) = op.apply(&mut doc) {
                // Rollback completed fields in reverse
                for (prev_field, _) in completed.iter().rev() {
                    let rollback = SetTextStyleField { node_id, field: prev_field.clone() };
                    let _ = rollback.apply(&mut doc); // Best effort
                }
                return Err(e.into());
            }
            completed.push((prev, field.clone()));
        }

        build_node_info(&doc, node_id, node_uuid)?
    };

    // Build operation payloads for broadcast
    let operations: Vec<OperationPayload> = fields.iter().map(|(path, field)| {
        OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: node_uuid.to_string(),
            op_type: "set_field".to_string(),
            path: format!("kind.text_style.{path}"),
            value: Some(text_style_field_to_json(field)),
        }
    }).collect();

    state.signal_dirty();
    state.publish_transaction(
        MutationEventKind::NodeUpdated,
        Some(node_uuid.to_string()),
        broadcast::multi_op_transaction(operations),
    );

    Ok(node_info)
}

/// Parse PartialTextStyle into (path, TextStyleField) pairs.
fn parse_partial_text_style(
    style: &crate::types::PartialTextStyle,
) -> Result<Vec<(String, TextStyleField)>, McpToolError> {
    let mut fields = Vec::new();

    if let Some(ref v) = style.font_family {
        fields.push(("font_family".to_string(), TextStyleField::FontFamily(v.clone())));
    }
    if let Some(ref v) = style.font_size {
        let sv = parse_style_value_f64(v)?;
        fields.push(("font_size".to_string(), TextStyleField::FontSize(sv)));
    }
    if let Some(v) = style.font_weight {
        fields.push(("font_weight".to_string(), TextStyleField::FontWeight(v)));
    }
    if let Some(ref v) = style.font_style {
        let fs = match v.as_str() {
            "normal" => FontStyle::Normal,
            "italic" => FontStyle::Italic,
            _ => return Err(McpToolError::InvalidInput(
                format!("invalid font_style: {v} (expected 'normal' or 'italic')"))),
        };
        fields.push(("font_style".to_string(), TextStyleField::FontStyle(fs)));
    }
    if let Some(ref v) = style.line_height {
        let sv = parse_style_value_f64(v)?;
        fields.push(("line_height".to_string(), TextStyleField::LineHeight(sv)));
    }
    if let Some(ref v) = style.letter_spacing {
        let sv = parse_style_value_f64(v)?;
        fields.push(("letter_spacing".to_string(), TextStyleField::LetterSpacing(sv)));
    }
    if let Some(ref v) = style.text_align {
        let ta = match v.as_str() {
            "left" => TextAlign::Left,
            "center" => TextAlign::Center,
            "right" => TextAlign::Right,
            "justify" => TextAlign::Justify,
            _ => return Err(McpToolError::InvalidInput(
                format!("invalid text_align: {v}"))),
        };
        fields.push(("text_align".to_string(), TextStyleField::TextAlign(ta)));
    }
    if let Some(ref v) = style.text_decoration {
        let td = match v.as_str() {
            "none" => TextDecoration::None,
            "underline" => TextDecoration::Underline,
            "strikethrough" => TextDecoration::Strikethrough,
            _ => return Err(McpToolError::InvalidInput(
                format!("invalid text_decoration: {v}"))),
        };
        fields.push(("text_decoration".to_string(), TextStyleField::TextDecoration(td)));
    }
    if let Some(ref v) = style.text_color {
        let sv = parse_style_value_color(v)?;
        fields.push(("text_color".to_string(), TextStyleField::TextColor(sv)));
    }
    if let Some(ref opt_shadow) = style.text_shadow {
        let shadow = match opt_shadow {
            None => None,
            Some(ref input) => {
                let color = parse_style_value_color(&input.color)?;
                Some(TextShadow::new(input.offset_x, input.offset_y, input.blur_radius, color)
                    .map_err(|e| McpToolError::InvalidInput(format!("invalid text_shadow: {e}")))?)
            }
        };
        fields.push(("text_shadow".to_string(), TextStyleField::TextShadow(shadow)));
    }

    Ok(fields)
}
```

Note: `parse_style_value_f64`, `parse_style_value_color`, `validate_text_style_field_input`, `capture_previous_field`, and `text_style_field_to_json` are helper functions. Implement them as private functions in `text.rs` following the patterns already established in `nodes.rs` for style parsing.

- [ ] **Step 4: Register tools in server.rs**

Add to the `#[tool_router]` impl block:

```rust
#[tool(
    name = "set_text_content",
    description = "Set the text content of a text node"
)]
fn set_text_content(
    &self,
    Parameters(input): Parameters<crate::types::SetTextContentInput>,
) -> Result<Json<NodeInfo>, rmcp::ErrorData> {
    crate::tools::text::set_text_content_impl(&self.state, &input.uuid, &input.content)
        .map(Json)
        .map_err(|e| e.to_mcp_error())
}

#[tool(
    name = "set_text_style",
    description = "Set text style properties. Pass only the fields to change — omitted fields are unchanged. Fields: font_family, font_size, font_weight, font_style (normal|italic), line_height, letter_spacing, text_align (left|center|right|justify), text_decoration (none|underline|strikethrough), text_color, text_shadow (null to remove)."
)]
fn set_text_style(
    &self,
    Parameters(input): Parameters<crate::types::SetTextStyleInput>,
) -> Result<Json<NodeInfo>, rmcp::ErrorData> {
    crate::tools::text::set_text_style_impl(&self.state, &input.uuid, &input.style)
        .map(Json)
        .map_err(|e| e.to_mcp_error())
}
```

- [ ] **Step 5: Add `pub mod text;` to tools/mod.rs**

- [ ] **Step 6: Run tests and commit**

```
feat(mcp): add set_text_content and set_text_style tools with partial-object input (Spec 03b, Task 5)
```

---

## Task 6: Frontend — TextShadow types + rendering

**Files:**
- Modify: `frontend/src/types/document.ts`
- Modify: `frontend/src/canvas/renderer.ts`

- [ ] **Step 1: Add TextShadow type to document.ts**

```typescript
export interface TextShadow {
  readonly offset_x: number;
  readonly offset_y: number;
  readonly blur_radius: number;
  readonly color: StyleValue<Color>;
}
```

Update `TextStyle`:
```typescript
export interface TextStyle {
  // ... existing 9 fields ...
  readonly text_shadow?: TextShadow | null;
}
```

- [ ] **Step 2: Add text shadow rendering to renderer.ts**

In the text rendering case, before drawing text lines:

```typescript
case "text": {
  const ts = node.kind.text_style;
  // ... existing font/color setup ...

  // Apply text shadow if present
  if (ts.text_shadow) {
    const shadowColor = ts.text_shadow.color.type === "literal"
      ? srgbColorToRgba(ts.text_shadow.color.value) ?? "rgba(0,0,0,0.5)"
      : "rgba(0,0,0,0.5)";
    if (Number.isFinite(ts.text_shadow.offset_x)
      && Number.isFinite(ts.text_shadow.offset_y)
      && Number.isFinite(ts.text_shadow.blur_radius)) {
      ctx.shadowOffsetX = ts.text_shadow.offset_x;
      ctx.shadowOffsetY = ts.text_shadow.offset_y;
      ctx.shadowBlur = ts.text_shadow.blur_radius;
      ctx.shadowColor = shadowColor;
    }
  }

  // ... draw text lines (existing code) ...

  // Reset shadow after drawing text
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  break;
}
```

- [ ] **Step 3: Run tests and commit**

```
feat(frontend): add TextShadow type and canvas rendering (Spec 03b, Task 6)
```

---

## Task 7: Frontend — TypographySection shadow controls

**Files:**
- Modify: `frontend/src/panels/TypographySection.tsx`
- Modify: `frontend/src/panels/TypographySection.css`
- Modify: `frontend/src/store/document-store-types.ts`
- Modify: `frontend/src/store/document-store-solid.tsx`

- [ ] **Step 1: Add text_shadow to TextStylePatch**

In `document-store-types.ts`, add to the `TextStylePatch` union:

```typescript
| { field: "text_shadow"; value: TextShadow | null }
```

- [ ] **Step 2: Wire text_shadow through store**

In `document-store-solid.tsx`, the `setTextStyle` function already handles `TextStylePatch`. The new variant needs to be serialized correctly for the server op. Add handling for `field === "text_shadow"` in the serialization path.

- [ ] **Step 3: Add shadow controls to TypographySection**

Add a "Shadow" sub-section below the existing typography controls:

```tsx
{/* Shadow section */}
<div class="sigil-typography-section__shadow-header">
  <span>Shadow</span>
  <button
    class="sigil-typography-section__shadow-toggle"
    aria-pressed={hasShadow()}
    onClick={toggleShadow}
  >
    {hasShadow() ? "On" : "Off"}
  </button>
</div>
<Show when={hasShadow()}>
  {/* Offset X */}
  <NumberInput label="X" value={shadowOffsetX()} onChange={handleShadowOffsetX} suffix="px" />
  {/* Offset Y */}
  <NumberInput label="Y" value={shadowOffsetY()} onChange={handleShadowOffsetY} suffix="px" />
  {/* Blur */}
  <NumberInput label="Blur" value={shadowBlur()} onChange={handleShadowBlur} suffix="px" min={0} max={1000} />
  {/* Color */}
  <ColorSwatch color={shadowColor()} onChange={handleShadowColor} label="Shadow color" />
</Show>
```

Each handler calls `store.setTextStyle(uuid, { field: "text_shadow", value: { offset_x, offset_y, blur_radius, color } })`.

The toggle sets `value: null` to remove or `value: { offset_x: 0, offset_y: 2, blur_radius: 4, color: defaultBlack }` to add with defaults.

- [ ] **Step 4: Add CSS for shadow section**

```css
.sigil-typography-section__shadow-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--size-1) 0;
}

.sigil-typography-section__shadow-toggle {
  /* toggle button styles */
}
```

- [ ] **Step 5: Run tests and commit**

```
feat(frontend): add text shadow controls to TypographySection (Spec 03b, Task 7)
```

---

## Task 8: Integration verification

- [ ] **Step 1: Run full test suites**

```bash
cargo test --workspace --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/Cargo.toml
cargo clippy --workspace --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/Cargo.toml --check
cd /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/frontend && npx vitest run
cd /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/frontend && npx tsc --noEmit
cd /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/frontend && npx eslint src/
cd /Volumes/projects/Personal/agent-designer/.worktrees/feature/mcp-text-tools/frontend && npx prettier --check 'src/**/*.{ts,tsx,json,css}'
```

- [ ] **Step 2: Verify publish_event is fully removed**

```bash
grep -r "publish_event" crates/ --include="*.rs" | grep -v "// " | grep -v "test"
```

Should return zero results (or only the internal `broadcast_internal` call in state).

- [ ] **Step 3: Commit if needed**

```
test: integration verification for Spec 03b
```

---

## Dependency Graph

```
Task 1 (TextShadow core type)
  → Task 2 (SetTextStyleField variant)
  → Task 3 (Server GraphQL path)
Task 1 + Task 2 → Task 5 (MCP text tools)
Task 4 (Broadcast migration) — independent of Tasks 1-3
Task 5 depends on Task 4 (uses new broadcast helper)
Task 1 → Task 6 (Frontend types + rendering)
Task 6 → Task 7 (Panel controls)
All → Task 8 (Integration)
```

Tasks 1-3 (core + server) and Task 4 (broadcast migration) can be done in parallel.
