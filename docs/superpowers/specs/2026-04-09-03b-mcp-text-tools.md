# Spec 03b — MCP Broadcast Parity + Text Tools

## Overview

Adds text content and text style mutation tools to the MCP server, migrates all existing MCP mutation tools from the legacy `publish_event` broadcast to `publish_transaction` (operation-level payloads), and extends the core `TextStyle` type with `text_shadow`. Removes the legacy `publish_event` API.

**Depends on:** Spec 03 (MCP server), Spec 11b (text tool — TextStyle, SetTextStyleField)

---

## 1. Broadcast Migration

### 1.1 Problem

All 13+ mutating MCP tools currently use `state.publish_event(MutationEvent { ... })` which sends a generic event with no operation payload. Frontend clients receiving these events must refetch the entire document to see changes — they cannot apply the mutation locally. The GraphQL server already uses `state.publish_transaction(...)` which includes `OperationPayload` structs that clients apply directly to their local store.

CLAUDE.md §4 states: "The broadcast obligation for MCP is identical to the obligation for server-originated mutations." This is violated — MCP broadcasts carry less information than GraphQL broadcasts.

### 1.2 Migration

Every mutating MCP tool switches from:

```rust
state.publish_event(MutationEvent {
    kind: MutationEventKind::NodeUpdated,
    uuid: Some(uuid.to_string()),
    data: Some(serde_json::json!({"field": "name"})),
    transaction: None,
});
```

To:

```rust
state.publish_transaction(
    MutationEventKind::NodeUpdated,
    Some(uuid.to_string()),
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: MCP_USER_ID.to_string(),
        seq: 0, // assigned by publish_transaction
        operations: vec![OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: uuid.to_string(),
            op_type: "set_field".to_string(),
            path: "name".to_string(),
            value: Some(serde_json::json!("New Name")),
        }],
    },
);
```

### 1.3 MCP User ID

MCP tools use a static user ID constant:

```rust
const MCP_USER_ID: &str = "mcp-agent";
```

This allows frontend clients to identify MCP-originated mutations in the subscription stream. Proper multi-agent identity (per-session agent IDs) is a future concern.

### 1.4 Remove Legacy API

After migrating all MCP tools, remove `publish_event` from `AppState`. All callers must use `publish_transaction`. If the GraphQL server also has legacy `publish_event` calls, migrate those in the same PR.

Search for all `publish_event` call sites across the entire workspace and remove them. The `MutationEvent` struct remains if it's used by `publish_transaction` internally, but the public `publish_event` method is deleted.

### 1.5 Affected Tools

All mutating MCP tools need migration:

**Node mutations:** `create_node`, `delete_node`, `rename_node`, `set_visible`, `set_locked`, `set_transform`, `reparent_node`, `reorder_children`

**Style mutations:** `set_opacity`, `set_blend_mode`, `set_fills`, `set_strokes`, `set_effects`, `set_corner_radii`

**Page mutations:** `create_page`, `rename_page`, `delete_page`

**Token mutations:** `create_token`, `update_token`, `delete_token`

**New text mutations (this spec):** `set_text_content`, `set_text_style`

Each tool must construct the appropriate `OperationPayload` with the correct `op_type` and `path` values that match what the GraphQL server sends for the same operation. The frontend subscription handler must be able to process MCP-originated and GraphQL-originated payloads identically.

---

## 2. Text Tools

### 2.1 `set_text_content`

Sets the text content of a text node.

**Input:**
```rust
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SetTextContentInput {
    /// UUID of the text node
    pub uuid: String,
    /// New text content (UTF-8, max 1,000,000 bytes)
    pub content: String,
}
```

**Behavior:**
1. Validate `content.len() <= MAX_TEXT_CONTENT_LEN` before lock
2. Acquire lock, resolve UUID → NodeId
3. Construct `SetTextContent { node_id, new_content: content }`
4. `validate()` then `apply()`
5. Drop lock
6. `signal_dirty()` + `publish_transaction()` with `op_type: "set_field"`, `path: "kind.content"`

**Output:** `NodeInfo` (same as other mutation tools)

### 2.2 `set_text_style`

Sets one or more text style fields on a text node using a partial style object. Only provided fields are updated — omitted fields are unchanged.

**Input:**
```rust
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SetTextStyleInput {
    /// UUID of the text node
    pub uuid: String,
    /// Partial text style — only provided fields are updated
    pub style: PartialTextStyle,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct PartialTextStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<StyleValueInput<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_style: Option<String>,  // "normal" | "italic"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<StyleValueInput<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<StyleValueInput<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,  // "left" | "center" | "right" | "justify"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_decoration: Option<String>,  // "none" | "underline" | "strikethrough"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color: Option<StyleValueInput<ColorInput>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_shadow: Option<TextShadowInput>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct TextShadowInput {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur_radius: f64,
    pub color: StyleValueInput<ColorInput>,
}
```

**Behavior:**
1. For each `Some` field in the partial style, construct a `SetTextStyleField` operation
2. Validate floats before lock (NaN/Infinity, range checks)
3. Acquire lock, resolve UUID → NodeId
4. For each field: `validate()` then `apply()`. If field K fails, roll back fields 0..K-1 before returning error (CLAUDE.md §11 multi-item rollback)
5. Drop lock
6. `signal_dirty()` + `publish_transaction()` with one `OperationPayload` per applied field

**Output:** `NodeInfo`

**Empty style rejection:** If all fields in `PartialTextStyle` are `None`, return an error. An agent sending an empty style update is a bug — don't create a ghost broadcast.

---

## 3. Core Type Extension — TextShadow

### 3.1 Type Definition

In `crates/core/src/node.rs`:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct TextShadow {
    offset_x: f64,
    offset_y: f64,
    blur_radius: f64,
    color: StyleValue<Color>,
}

impl TextShadow {
    pub fn new(offset_x: f64, offset_y: f64, blur_radius: f64, color: StyleValue<Color>) -> Result<Self, CoreError> {
        validate_finite("offset_x", offset_x)?;
        validate_finite("offset_y", offset_y)?;
        validate_finite("blur_radius", blur_radius)?;
        if blur_radius < 0.0 {
            return Err(CoreError::ValidationError("blur_radius must be >= 0".into()));
        }
        if blur_radius > MAX_TEXT_SHADOW_BLUR {
            return Err(CoreError::ValidationError(format!("blur_radius exceeds {MAX_TEXT_SHADOW_BLUR}")));
        }
        // Validate color channels if literal
        if let StyleValue::Literal { value: ref c } = color {
            validate_color_channels(c)?;
        }
        Ok(Self { offset_x, offset_y, blur_radius, color })
    }

    pub fn offset_x(&self) -> f64 { self.offset_x }
    pub fn offset_y(&self) -> f64 { self.offset_y }
    pub fn blur_radius(&self) -> f64 { self.blur_radius }
    pub fn color(&self) -> &StyleValue<Color> { &self.color }
}
```

`TextShadow` has private fields with a validating constructor per CLAUDE.md §11. `Deserialize` is implemented manually via `TextShadow::new`, not derived.

### 3.2 TextStyle Extension

Add to `TextStyle`:

```rust
pub struct TextStyle {
    // ... existing 9 fields ...
    pub text_shadow: Option<TextShadow>,
}
```

Default: `text_shadow: None` (no shadow).

### 3.3 Validation

In `validate.rs`, extend `validate_text_style()`:
- `offset_x`: must be finite
- `offset_y`: must be finite
- `blur_radius`: must be finite, >= 0
- `color` (if literal): all channels must be finite

Add constants:
```rust
pub const MAX_TEXT_SHADOW_BLUR: f64 = 1000.0;
```

### 3.4 SetTextStyleField Extension

Add a new variant to `TextStyleField`:

```rust
pub enum TextStyleField {
    // ... existing 9 variants ...
    TextShadow(Option<TextShadow>),
}
```

`Option<TextShadow>` allows setting shadow (`Some(...)`) or removing it (`None`).

Validation in `SetTextStyleField::validate`:
- If `Some(shadow)`: validate all 4 fields per §3.3
- If `None`: always valid (removing shadow)

### 3.5 Server GraphQL Path

Add `kind.text_style.text_shadow` path to `parse_set_field` in `mutation.rs`, following the existing text style path pattern.

### 3.6 Frontend Types

In `frontend/src/types/document.ts`:

```typescript
export interface TextShadow {
  offset_x: number;
  offset_y: number;
  blur_radius: number;
  color: StyleValue<Color>;
}
```

Update `TextStyle` to include `text_shadow?: TextShadow | null`.

### 3.7 Canvas Rendering

In `renderer.ts`, when rendering text nodes, if `text_style.text_shadow` is present:

```typescript
if (ts.text_shadow) {
  ctx.shadowOffsetX = ts.text_shadow.offset_x;
  ctx.shadowOffsetY = ts.text_shadow.offset_y;
  ctx.shadowBlur = ts.text_shadow.blur_radius;
  ctx.shadowColor = resolveColorToCss(ts.text_shadow.color);
}
// ... draw text ...
// Reset shadow after drawing
ctx.shadowOffsetX = 0;
ctx.shadowOffsetY = 0;
ctx.shadowBlur = 0;
ctx.shadowColor = "transparent";
```

### 3.8 Typography Panel

Add a text-shadow control to `TypographySection.tsx`:
- Toggle to enable/disable shadow (sets `None` vs `Some`)
- When enabled: offset X/Y NumberInputs, blur radius NumberInput, color swatch
- Grouped visually under a "Shadow" sub-heading

---

## 4. Input Validation

- **Text content:** Max `MAX_TEXT_CONTENT_LEN` (1,000,000 bytes). Validated before lock.
- **Font family:** Non-empty, max `MAX_FONT_FAMILY_LEN`, no CSS-significant chars. Validated before lock.
- **Font size:** Finite, in `[MIN_FONT_SIZE, MAX_FONT_SIZE]`. Validated before lock.
- **Font weight:** In `[MIN_FONT_WEIGHT, MAX_FONT_WEIGHT]`. Validated before lock.
- **Line height:** Finite, > 0 (if literal). Validated before lock.
- **Letter spacing:** Finite (if literal). Validated before lock.
- **Text shadow offset_x/offset_y:** Finite. Validated before lock.
- **Text shadow blur_radius:** Finite, >= 0, <= `MAX_TEXT_SHADOW_BLUR`. Validated before lock.
- **Text shadow color:** All f64 channels finite (if literal). Validated before lock.
- **PartialTextStyle:** At least one field must be `Some`. Empty updates rejected.

---

## 5. Consistency Guarantees

- **`set_text_style` atomicity:** All provided fields are applied together under a single lock acquisition. If field K fails validation, fields 0..K-1 are rolled back before the error is returned. The operation is all-or-nothing.
- **Broadcast consistency:** Each applied field produces one `OperationPayload` in the transaction. Frontend clients apply each operation independently (same as GraphQL).
- **`publish_event` removal:** After migration, any code that tries to call `publish_event` will fail at compile time — the method is deleted, not deprecated.

---

## 6. WASM Compatibility

`TextShadow` is a plain struct with `f64` fields and `StyleValue<Color>`. No new dependencies, no I/O, no `Send`/`Sync` bounds. Fully WASM-compatible.

---

## 7. Recursion Safety

No recursive algorithms introduced. MCP tool handlers are flat request-response functions.

---

## 8. PDR Traceability

**Implements:**
- PDR §3.4 "MCP interface" — extends MCP tools to cover text editing operations
- PDR §4.8 "Text tool" — MCP parity for text content and style mutations

**Defers:**
- Full CSS text property model (overflow, word-wrap, writing-mode, text-transform) — separate spec
- Multi-agent identity for MCP — static `"mcp-agent"` user ID for now
- MCP style tool consolidation (merging set_opacity, set_blend_mode, etc. into fewer tools) — tracked in project backlog

---

## 9. Tool Lifecycle

Not applicable — MCP tools are stateless request-response, not canvas interaction tools.

---

## 10. File Structure

### New files
| File | Responsibility |
|------|---------------|
| `crates/mcp/src/tools/text.rs` | `set_text_content_impl`, `set_text_style_impl` |

### Major modifications
| File | Changes |
|------|---------|
| `crates/core/src/node.rs` | Add `TextShadow` struct, `text_shadow` field on `TextStyle` |
| `crates/core/src/validate.rs` | Add `MAX_TEXT_SHADOW_BLUR`, extend `validate_text_style` |
| `crates/core/src/commands/text_style_commands.rs` | Add `TextShadow` variant to `TextStyleField` |
| `crates/mcp/src/server.rs` | Register `set_text_content` + `set_text_style` tools |
| `crates/mcp/src/types.rs` | Add `SetTextContentInput`, `SetTextStyleInput`, `PartialTextStyle`, `TextShadowInput` |
| `crates/mcp/src/tools/nodes.rs` | Migrate all existing tools from `publish_event` → `publish_transaction` |
| `crates/state/src/lib.rs` | Remove `publish_event` method |
| `crates/server/src/graphql/mutation.rs` | Add `kind.text_style.text_shadow` path |
| `frontend/src/types/document.ts` | Add `TextShadow` type, update `TextStyle` |
| `frontend/src/canvas/renderer.ts` | Render text shadow via Canvas 2D shadow API |
| `frontend/src/panels/TypographySection.tsx` | Add shadow toggle + controls |
| `frontend/src/store/document-store-solid.tsx` | Wire `text_shadow` through `setTextStyle` |
