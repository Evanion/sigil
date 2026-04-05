# Properties Panel Backend — Style Mutations (Plan 09a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `SetCornerRadii` core command, 6 new GraphQL mutations (setOpacity, setBlendMode, setFills, setStrokes, setEffects, setCornerRadii), corresponding MCP tools, frontend GraphQL mutation strings, and store methods with optimistic updates — unblocking all Spec 09 frontend panel work.

**Architecture:** Follow the existing mutation pattern: core command with undo/redo → GraphQL resolver (lock scope, execute, broadcast) → MCP tool impl (same pattern) → frontend store method (optimistic update + rollback). The `setOpacity`, `setBlendMode`, `setFills`, `setStrokes`, `setEffects` core commands already exist — only `SetCornerRadii` is new.

**Tech Stack:** Rust (core, server, mcp crates), TypeScript (frontend store + GraphQL strings)

---

## Scope

**In scope:**
- `SetCornerRadii` core command (apply/undo/redo cycle, validation)
- GraphQL mutations: `setOpacity`, `setBlendMode`, `setFills`, `setStrokes`, `setEffects`, `setCornerRadii`
- MCP tools: `set_opacity`, `set_blend_mode`, `set_fills`, `set_strokes`, `set_effects`, `set_corner_radii`
- Frontend: GraphQL mutation strings + store methods with optimistic updates

**Deferred:**
- Frontend UI panels (Plan 09c)
- Color picker component (Plan 09b)
- Token binding UI (Plan 09d)

---

## Task 1: Add `SetCornerRadii` core command

**Files:**
- Modify: `crates/core/src/commands/style_commands.rs`
- Modify: `crates/core/src/node.rs` (if needed for accessor)

- [ ] **Step 1: Write the failing test**

Add to the bottom of `crates/core/src/commands/style_commands.rs`, inside the existing `#[cfg(test)] mod tests` block (read the file first to find it):

```rust
#[test]
fn test_set_corner_radii_execute_undo_redo_cycle() {
    let mut doc = Document::new("Test".to_string());
    let node = insert_rect(&mut doc, 1, "Rect");

    let old_radii = [0.0, 0.0, 0.0, 0.0];
    let new_radii = [8.0, 12.0, 4.0, 16.0];

    let cmd = SetCornerRadii {
        node_id: node,
        new_radii,
        old_radii,
    };

    // Execute
    doc.execute(Box::new(cmd)).expect("execute");
    match &doc.arena.get(node).expect("get").kind {
        NodeKind::Rectangle { corner_radii } => {
            assert_eq!(*corner_radii, new_radii, "state after execute");
        }
        other => panic!("expected rectangle, got {other:?}"),
    }

    // Undo
    doc.undo().expect("undo");
    match &doc.arena.get(node).expect("get").kind {
        NodeKind::Rectangle { corner_radii } => {
            assert_eq!(*corner_radii, old_radii, "state after undo");
        }
        other => panic!("expected rectangle, got {other:?}"),
    }

    // Redo
    doc.redo().expect("redo");
    match &doc.arena.get(node).expect("get").kind {
        NodeKind::Rectangle { corner_radii } => {
            assert_eq!(*corner_radii, new_radii, "state after redo");
        }
        other => panic!("expected rectangle, got {other:?}"),
    }
}

#[test]
fn test_set_corner_radii_rejects_nan() {
    let mut doc = Document::new("Test".to_string());
    let node = insert_rect(&mut doc, 1, "Rect");

    let cmd = SetCornerRadii {
        node_id: node,
        new_radii: [f64::NAN, 0.0, 0.0, 0.0],
        old_radii: [0.0, 0.0, 0.0, 0.0],
    };
    assert!(doc.execute(Box::new(cmd)).is_err());
}

#[test]
fn test_set_corner_radii_rejects_negative() {
    let mut doc = Document::new("Test".to_string());
    let node = insert_rect(&mut doc, 1, "Rect");

    let cmd = SetCornerRadii {
        node_id: node,
        new_radii: [-1.0, 0.0, 0.0, 0.0],
        old_radii: [0.0, 0.0, 0.0, 0.0],
    };
    assert!(doc.execute(Box::new(cmd)).is_err());
}

#[test]
fn test_set_corner_radii_on_non_rectangle_fails() {
    let mut doc = Document::new("Test".to_string());
    let node = insert_frame(&mut doc, 1, "Frame");

    let cmd = SetCornerRadii {
        node_id: node,
        new_radii: [8.0, 8.0, 8.0, 8.0],
        old_radii: [0.0, 0.0, 0.0, 0.0],
    };
    assert!(doc.execute(Box::new(cmd)).is_err());
}
```

Note: Check the existing test module for `insert_rect` and `insert_frame` helpers. If `insert_rect` doesn't exist, create one following the `insert_frame` pattern but using `NodeKind::Rectangle { corner_radii: [0.0; 4] }`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test --workspace -p agent-designer-core -- test_set_corner_radii
```

Expected: FAIL — `SetCornerRadii` not found.

- [ ] **Step 3: Implement `SetCornerRadii` command**

Add to `crates/core/src/commands/style_commands.rs`, after the `SetConstraints` impl and before the test module. Import `NodeKind` at the top.

```rust
/// Sets a rectangle node's corner radii.
///
/// Each radius must be a finite, non-negative f64. Returns an error if
/// the target node is not a rectangle.
#[derive(Debug)]
pub struct SetCornerRadii {
    /// The target node (must be a rectangle).
    pub node_id: NodeId,
    /// The new corner radii [top-left, top-right, bottom-right, bottom-left].
    pub new_radii: [f64; 4],
    /// The previous corner radii (for undo).
    pub old_radii: [f64; 4],
}

/// Validates that all corner radii are finite and non-negative.
fn validate_corner_radii(radii: &[f64; 4]) -> Result<(), CoreError> {
    for (i, &r) in radii.iter().enumerate() {
        if !r.is_finite() {
            return Err(CoreError::ValidationError(format!(
                "corner radius[{i}] must be finite, got {r}"
            )));
        }
        if r < 0.0 {
            return Err(CoreError::ValidationError(format!(
                "corner radius[{i}] must be non-negative, got {r}"
            )));
        }
    }
    Ok(())
}

impl Command for SetCornerRadii {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_corner_radii(&self.new_radii)?;
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Rectangle { corner_radii } => {
                *corner_radii = self.new_radii;
                Ok(vec![])
            }
            _ => Err(CoreError::ValidationError(
                "setCornerRadii requires a rectangle node".to_string(),
            )),
        }
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_corner_radii(&self.old_radii)?;
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Rectangle { corner_radii } => {
                *corner_radii = self.old_radii;
                Ok(vec![])
            }
            _ => Err(CoreError::ValidationError(
                "setCornerRadii requires a rectangle node".to_string(),
            )),
        }
    }

    fn description(&self) -> &str {
        "Set corner radii"
    }
}
```

Also add `SetCornerRadii` to the re-export in `crates/core/src/commands/style_commands.rs` if there's a `pub use` block, and ensure `NodeKind` is imported.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --workspace -p agent-designer-core -- test_set_corner_radii
```

Expected: 4 tests PASS.

- [ ] **Step 5: Run full workspace checks**

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --check
```

- [ ] **Step 6: Commit**

```bash
git add crates/core/
git commit -m "feat(core): add SetCornerRadii command with validation (Spec 09, Plan 09a Task 1)"
```

---

## Task 2: Add 6 GraphQL mutations for style properties

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs`

Read the existing mutation file first. Follow the exact pattern used by `set_visible` and `set_locked`: parse UUID → acquire lock → look up node → capture old value → construct command → execute → build response → release lock → signal dirty + publish event.

- [ ] **Step 1: Add `setOpacity` mutation**

```rust
/// Set a node's opacity (0.0–1.0).
async fn set_opacity(
    &self,
    ctx: &Context<'_>,
    uuid: String,
    opacity: f64,
) -> Result<NodeGql> {
    let state = ctx.data::<ServerState>()?;
    if !opacity.is_finite() {
        return Err(async_graphql::Error::new("opacity must be finite"));
    }
    let parsed_uuid: uuid::Uuid = uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

    let node_gql = {
        let mut doc_guard = acquire_document_lock(state);
        let node_id = doc_guard
            .arena
            .id_by_uuid(&parsed_uuid)
            .ok_or_else(|| async_graphql::Error::new("node not found"))?;

        let old_opacity = doc_guard
            .arena
            .get(node_id)
            .map_err(|_| async_graphql::Error::new("node lookup failed"))?
            .style
            .opacity
            .clone();

        let cmd = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: opacity },
            old_opacity,
        };

        doc_guard.execute(Box::new(cmd)).map_err(|e| {
            tracing::warn!("setOpacity failed: {e}");
            async_graphql::Error::new("set opacity failed")
        })?;

        node_to_gql(&doc_guard, node_id, parsed_uuid)?
    };

    state.app.signal_dirty();
    state.app.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(parsed_uuid.to_string()),
        data: Some(serde_json::json!({"field": "opacity"})),
    });

    Ok(node_gql)
}
```

- [ ] **Step 2: Add `setBlendMode` mutation**

Follow the same pattern. The blend mode comes as a `String` from GraphQL and must be parsed into the `BlendMode` enum. Add a helper function or use serde deserialization:

```rust
/// Set a node's blend mode.
async fn set_blend_mode(
    &self,
    ctx: &Context<'_>,
    uuid: String,
    blend_mode: String,
) -> Result<NodeGql> {
    let state = ctx.data::<ServerState>()?;
    let parsed_blend: BlendMode = serde_json::from_value(
        serde_json::Value::String(blend_mode.clone()),
    )
    .map_err(|_| async_graphql::Error::new(format!("invalid blend mode: {blend_mode}")))?;

    let parsed_uuid: uuid::Uuid = uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

    let node_gql = {
        let mut doc_guard = acquire_document_lock(state);
        let node_id = doc_guard
            .arena
            .id_by_uuid(&parsed_uuid)
            .ok_or_else(|| async_graphql::Error::new("node not found"))?;

        let old_blend_mode = doc_guard
            .arena
            .get(node_id)
            .map_err(|_| async_graphql::Error::new("node lookup failed"))?
            .style
            .blend_mode;

        let cmd = SetBlendMode {
            node_id,
            new_blend_mode: parsed_blend,
            old_blend_mode,
        };

        doc_guard.execute(Box::new(cmd)).map_err(|e| {
            tracing::warn!("setBlendMode failed: {e}");
            async_graphql::Error::new("set blend mode failed")
        })?;

        node_to_gql(&doc_guard, node_id, parsed_uuid)?
    };

    state.app.signal_dirty();
    state.app.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(parsed_uuid.to_string()),
        data: Some(serde_json::json!({"field": "blend_mode"})),
    });

    Ok(node_gql)
}
```

- [ ] **Step 3: Add `setFills` mutation**

The fills come as a JSON array from GraphQL. Deserialize into `Vec<Fill>`:

```rust
/// Replace a node's fills array.
async fn set_fills(
    &self,
    ctx: &Context<'_>,
    uuid: String,
    fills: async_graphql::Json<Vec<Fill>>,
) -> Result<NodeGql> {
    let state = ctx.data::<ServerState>()?;
    let parsed_uuid: uuid::Uuid = uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

    let node_gql = {
        let mut doc_guard = acquire_document_lock(state);
        let node_id = doc_guard
            .arena
            .id_by_uuid(&parsed_uuid)
            .ok_or_else(|| async_graphql::Error::new("node not found"))?;

        let old_fills = doc_guard
            .arena
            .get(node_id)
            .map_err(|_| async_graphql::Error::new("node lookup failed"))?
            .style
            .fills
            .clone();

        let cmd = SetFills {
            node_id,
            new_fills: fills.0,
            old_fills,
        };

        doc_guard.execute(Box::new(cmd)).map_err(|e| {
            tracing::warn!("setFills failed: {e}");
            async_graphql::Error::new("set fills failed")
        })?;

        node_to_gql(&doc_guard, node_id, parsed_uuid)?
    };

    state.app.signal_dirty();
    state.app.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(parsed_uuid.to_string()),
        data: Some(serde_json::json!({"field": "fills"})),
    });

    Ok(node_gql)
}
```

- [ ] **Step 4: Add `setStrokes` mutation**

Same pattern as `setFills` but with `Vec<Stroke>`:

```rust
/// Replace a node's strokes array.
async fn set_strokes(
    &self,
    ctx: &Context<'_>,
    uuid: String,
    strokes: async_graphql::Json<Vec<Stroke>>,
) -> Result<NodeGql> {
    // Same pattern as set_fills — parse UUID, lock, capture old, execute cmd, broadcast
    // Use SetStrokes { node_id, new_strokes: strokes.0, old_strokes }
    // Broadcast field: "strokes"
}
```

(Full code follows the identical pattern as `set_fills` — substitute `Stroke` for `Fill`, `SetStrokes` for `SetFills`, `strokes` for `fills`.)

- [ ] **Step 5: Add `setEffects` mutation**

Same pattern with `Vec<Effect>`. Use `SetEffects` command.

- [ ] **Step 6: Add `setCornerRadii` mutation**

```rust
/// Set a rectangle node's corner radii.
async fn set_corner_radii(
    &self,
    ctx: &Context<'_>,
    uuid: String,
    radii: Vec<f64>,
) -> Result<NodeGql> {
    let state = ctx.data::<ServerState>()?;

    if radii.len() != 4 {
        return Err(async_graphql::Error::new("radii must have exactly 4 elements"));
    }
    for (i, &r) in radii.iter().enumerate() {
        if !r.is_finite() {
            return Err(async_graphql::Error::new(format!("radii[{i}] must be finite")));
        }
        if r < 0.0 {
            return Err(async_graphql::Error::new(format!("radii[{i}] must be non-negative")));
        }
    }
    let new_radii: [f64; 4] = [radii[0], radii[1], radii[2], radii[3]];

    let parsed_uuid: uuid::Uuid = uuid
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid UUID"))?;

    let node_gql = {
        let mut doc_guard = acquire_document_lock(state);
        let node_id = doc_guard
            .arena
            .id_by_uuid(&parsed_uuid)
            .ok_or_else(|| async_graphql::Error::new("node not found"))?;

        let old_radii = match &doc_guard
            .arena
            .get(node_id)
            .map_err(|_| async_graphql::Error::new("node lookup failed"))?
            .kind
        {
            NodeKind::Rectangle { corner_radii } => *corner_radii,
            _ => return Err(async_graphql::Error::new("node is not a rectangle")),
        };

        let cmd = SetCornerRadii {
            node_id,
            new_radii,
            old_radii,
        };

        doc_guard.execute(Box::new(cmd)).map_err(|e| {
            tracing::warn!("setCornerRadii failed: {e}");
            async_graphql::Error::new("set corner radii failed")
        })?;

        node_to_gql(&doc_guard, node_id, parsed_uuid)?
    };

    state.app.signal_dirty();
    state.app.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(parsed_uuid.to_string()),
        data: Some(serde_json::json!({"field": "corner_radii"})),
    });

    Ok(node_gql)
}
```

- [ ] **Step 7: Add required imports**

At the top of `mutation.rs`, add the new command and type imports:

```rust
use agent_designer_core::commands::style_commands::{
    SetBlendMode, SetCornerRadii, SetEffects, SetFills, SetOpacity, SetStrokes,
};
use agent_designer_core::node::{BlendMode, Effect, Fill, NodeKind, Stroke, StyleValue};
```

Check which imports already exist and only add the missing ones.

- [ ] **Step 8: Write integration tests for each mutation**

Add to the test module at the bottom of `mutation.rs`. Follow the existing test pattern (`test_schema`, `ServerState::new()`, `schema.execute(query)`):

```rust
#[tokio::test]
async fn test_set_opacity_mutation() {
    let state = ServerState::new();
    let schema = test_schema(state);
    let uuid = create_frame(&schema, "Test").await;

    let query = format!(
        r#"mutation {{ setOpacity(uuid: "{uuid}", opacity: 0.5) {{ uuid }} }}"#,
    );
    let res = schema.execute(&*query).await;
    assert!(res.errors.is_empty(), "errors: {:?}", res.errors);
}

#[tokio::test]
async fn test_set_opacity_rejects_nan() {
    let state = ServerState::new();
    let schema = test_schema(state);
    let uuid = create_frame(&schema, "Test").await;

    let query = format!(
        r#"mutation {{ setOpacity(uuid: "{uuid}", opacity: NaN) {{ uuid }} }}"#,
    );
    // NaN is not valid JSON — GraphQL should reject this at parse time or the resolver should
    // catch it via is_finite(). Verify we get an error either way.
    let res = schema.execute(&*query).await;
    assert!(!res.errors.is_empty());
}

#[tokio::test]
async fn test_set_blend_mode_mutation() {
    let state = ServerState::new();
    let schema = test_schema(state);
    let uuid = create_frame(&schema, "Test").await;

    let query = format!(
        r#"mutation {{ setBlendMode(uuid: "{uuid}", blendMode: "multiply") {{ uuid }} }}"#,
    );
    let res = schema.execute(&*query).await;
    assert!(res.errors.is_empty(), "errors: {:?}", res.errors);
}

#[tokio::test]
async fn test_set_corner_radii_mutation() {
    let state = ServerState::new();
    let schema = test_schema(state);

    // Create a rectangle node (need to pass kind as rectangle)
    let query = r#"mutation { createNode(kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] }, name: "Rect") { uuid node { uuid } } }"#;
    let res = schema.execute(query).await;
    assert!(res.errors.is_empty(), "create errors: {:?}", res.errors);
    let uuid = res.data.into_json().unwrap()["createNode"]["uuid"]
        .as_str()
        .unwrap()
        .to_string();

    let set_query = format!(
        r#"mutation {{ setCornerRadii(uuid: "{uuid}", radii: [8.0, 8.0, 8.0, 8.0]) {{ uuid }} }}"#,
    );
    let set_res = schema.execute(&*set_query).await;
    assert!(set_res.errors.is_empty(), "errors: {:?}", set_res.errors);
}

#[tokio::test]
async fn test_set_corner_radii_on_frame_returns_error() {
    let state = ServerState::new();
    let schema = test_schema(state);
    let uuid = create_frame(&schema, "Frame").await;

    let query = format!(
        r#"mutation {{ setCornerRadii(uuid: "{uuid}", radii: [8.0, 8.0, 8.0, 8.0]) {{ uuid }} }}"#,
    );
    let res = schema.execute(&*query).await;
    assert!(!res.errors.is_empty(), "should fail on non-rectangle");
}
```

- [ ] **Step 9: Run all tests**

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --check
```

- [ ] **Step 10: Commit**

```bash
git add crates/server/
git commit -m "feat(server): add 6 style GraphQL mutations — opacity, blend, fills, strokes, effects, corner radii (Spec 09, Plan 09a Task 2)"
```

---

## Task 3: Add 6 MCP tools for style properties

**Files:**
- Modify: `crates/mcp/src/tools/nodes.rs`
- Modify: `crates/mcp/src/server.rs` (register new tools)
- Modify: `crates/mcp/src/types.rs` (new input types)

Follow the existing MCP tool pattern from `set_visible_impl` / `set_locked_impl`.

- [ ] **Step 1: Add MCP input types**

In `crates/mcp/src/types.rs`, add:

```rust
/// Input for setting a node's opacity.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetOpacityInput {
    /// UUID of the node.
    pub uuid: String,
    /// Opacity value (0.0–1.0).
    pub opacity: f64,
}

/// Input for setting a node's blend mode.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetBlendModeInput {
    /// UUID of the node.
    pub uuid: String,
    /// Blend mode (e.g., "normal", "multiply", "screen").
    pub blend_mode: String,
}

/// Input for replacing a node's fills array.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetFillsInput {
    /// UUID of the node.
    pub uuid: String,
    /// The new fills array (replaces existing fills atomically).
    pub fills: serde_json::Value,
}

/// Input for replacing a node's strokes array.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetStrokesInput {
    /// UUID of the node.
    pub uuid: String,
    /// The new strokes array (replaces existing strokes atomically).
    pub strokes: serde_json::Value,
}

/// Input for replacing a node's effects array.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetEffectsInput {
    /// UUID of the node.
    pub uuid: String,
    /// The new effects array (replaces existing effects atomically).
    pub effects: serde_json::Value,
}

/// Input for setting a rectangle node's corner radii.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetCornerRadiiInput {
    /// UUID of the node (must be a rectangle).
    pub uuid: String,
    /// Corner radii [top-left, top-right, bottom-right, bottom-left].
    pub radii: Vec<f64>,
}
```

- [ ] **Step 2: Add tool impl functions**

In `crates/mcp/src/tools/nodes.rs`, add `set_opacity_impl`, `set_blend_mode_impl`, `set_fills_impl`, `set_strokes_impl`, `set_effects_impl`, `set_corner_radii_impl`. Each follows the `set_visible_impl` pattern:

```rust
pub fn set_opacity_impl(
    state: &AppState,
    uuid_str: &str,
    opacity: f64,
) -> Result<NodeInfo, McpToolError> {
    if !opacity.is_finite() {
        return Err(McpToolError::InvalidInput("opacity must be finite".to_string()));
    }

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    let node_info = {
        let mut doc = acquire_document_lock(state);
        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let old_opacity = doc
            .arena
            .get(node_id)
            .map_err(|_| McpToolError::NodeNotFound(uuid_str.to_string()))?
            .style
            .opacity
            .clone();

        let cmd = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: opacity },
            old_opacity,
        };
        doc.execute(Box::new(cmd))?;
        build_node_info(&doc, node_id, node_uuid)?
    };

    state.signal_dirty();
    state.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(node_uuid.to_string()),
        data: Some(serde_json::json!({"field": "opacity"})),
    });
    Ok(node_info)
}
```

Implement the remaining 5 tools following the same pattern. For `set_fills_impl`, `set_strokes_impl`, and `set_effects_impl`, deserialize the `serde_json::Value` into the typed vec:

```rust
pub fn set_fills_impl(
    state: &AppState,
    uuid_str: &str,
    fills_json: &serde_json::Value,
) -> Result<NodeInfo, McpToolError> {
    let fills: Vec<Fill> = serde_json::from_value(fills_json.clone())
        .map_err(|e| McpToolError::InvalidInput(format!("invalid fills: {e}")))?;
    // ... rest follows set_opacity_impl pattern with SetFills command
}
```

- [ ] **Step 3: Register tools in server.rs**

In `crates/mcp/src/server.rs`, add the 6 new tool methods following the existing `set_visible` / `set_locked` pattern with `#[tool(...)]` attributes.

- [ ] **Step 4: Write tests**

Add tests for at least `set_opacity_impl`, `set_corner_radii_impl` (happy path + error cases) to the test module in `crates/mcp/src/tools/nodes.rs`.

- [ ] **Step 5: Run all checks**

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --check
```

- [ ] **Step 6: Commit**

```bash
git add crates/mcp/
git commit -m "feat(mcp): add 6 style MCP tools — opacity, blend, fills, strokes, effects, corner radii (Spec 09, Plan 09a Task 3)"
```

---

## Task 4: Add frontend GraphQL mutation strings + store methods

**Files:**
- Modify: `frontend/src/graphql/mutations.ts`
- Modify: `frontend/src/store/document-store-solid.tsx`

- [ ] **Step 1: Add GraphQL mutation strings**

In `frontend/src/graphql/mutations.ts`, add:

```typescript
export const SET_OPACITY_MUTATION = `
  mutation SetOpacity($uuid: String!, $opacity: Float!) {
    setOpacity(uuid: $uuid, opacity: $opacity) { uuid }
  }
`;

export const SET_BLEND_MODE_MUTATION = `
  mutation SetBlendMode($uuid: String!, $blendMode: String!) {
    setBlendMode(uuid: $uuid, blendMode: $blendMode) { uuid }
  }
`;

export const SET_FILLS_MUTATION = `
  mutation SetFills($uuid: String!, $fills: JSON!) {
    setFills(uuid: $uuid, fills: $fills) { uuid style }
  }
`;

export const SET_STROKES_MUTATION = `
  mutation SetStrokes($uuid: String!, $strokes: JSON!) {
    setStrokes(uuid: $uuid, strokes: $strokes) { uuid style }
  }
`;

export const SET_EFFECTS_MUTATION = `
  mutation SetEffects($uuid: String!, $effects: JSON!) {
    setEffects(uuid: $uuid, effects: $effects) { uuid style }
  }
`;

export const SET_CORNER_RADII_MUTATION = `
  mutation SetCornerRadii($uuid: String!, $radii: [Float!]!) {
    setCornerRadii(uuid: $uuid, radii: $radii) { uuid kind }
  }
`;
```

- [ ] **Step 2: Add store methods**

In `frontend/src/store/document-store-solid.tsx`:

1. Import the new mutation strings at the top.
2. Add the 6 new methods to the `DocumentStoreAPI` interface.
3. Implement each method following the optimistic update pattern (like `reparentNode`).

For `setOpacity`:

```typescript
function setOpacity(uuid: string, opacity: number): void {
    if (!Number.isFinite(opacity)) return;

    const previousOpacity = state.nodes[uuid]?.style?.opacity;
    setState("nodes", uuid, "style", "opacity", { type: "literal", value: opacity });

    client
      .mutation(gql(SET_OPACITY_MUTATION), { uuid, opacity })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setOpacity error:", r.error.message);
          if (previousOpacity !== undefined && state.nodes[uuid]) {
            setState("nodes", uuid, "style", "opacity", previousOpacity);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setOpacity exception:", err);
        if (previousOpacity !== undefined && state.nodes[uuid]) {
          setState("nodes", uuid, "style", "opacity", previousOpacity);
        }
      });
  }
```

For `setFills` (replaces the entire array):

```typescript
function setFills(uuid: string, fills: Fill[]): void {
    const previousFills = state.nodes[uuid]?.style?.fills
      ? [...state.nodes[uuid].style.fills]
      : undefined;

    setState("nodes", uuid, "style", "fills", fills);

    client
      .mutation(gql(SET_FILLS_MUTATION), { uuid, fills: structuredClone(fills) })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setFills error:", r.error.message);
          if (previousFills !== undefined && state.nodes[uuid]) {
            setState("nodes", uuid, "style", "fills", previousFills);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setFills exception:", err);
        if (previousFills !== undefined && state.nodes[uuid]) {
          setState("nodes", uuid, "style", "fills", previousFills);
        }
      });
  }
```

Follow the same pattern for `setBlendMode`, `setStrokes`, `setEffects`, `setCornerRadii`.

For `setCornerRadii`, the optimistic update modifies `node.kind.corner_radii`:

```typescript
function setCornerRadii(uuid: string, radii: [number, number, number, number]): void {
    for (const r of radii) {
      if (!Number.isFinite(r) || r < 0) return;
    }

    const node = state.nodes[uuid];
    if (!node || node.kind.type !== "rectangle") return;

    const previousRadii = [...(node.kind.corner_radii as number[])];
    setState("nodes", uuid, "kind", "corner_radii", radii);

    client
      .mutation(gql(SET_CORNER_RADII_MUTATION), { uuid, radii: [...radii] })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setCornerRadii error:", r.error.message);
          if (state.nodes[uuid]) {
            setState("nodes", uuid, "kind", "corner_radii", previousRadii);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setCornerRadii exception:", err);
        if (state.nodes[uuid]) {
          setState("nodes", uuid, "kind", "corner_radii", previousRadii);
        }
      });
  }
```

4. Add all 6 methods to the return object.

- [ ] **Step 3: Update mock stores in tests**

Search for `createMockStore` in test files and add the 6 new methods as `vi.fn()` stubs.

- [ ] **Step 4: Run frontend checks**

```bash
pnpm --prefix frontend test
pnpm --prefix frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/graphql/mutations.ts frontend/src/store/document-store-solid.tsx frontend/src/panels/__tests__/
git commit -m "feat(frontend): add 6 style mutations + store methods with optimistic updates (Spec 09, Plan 09a Task 4)"
```

---

## Summary

| Task | Description | Scope |
|------|-------------|-------|
| 1 | `SetCornerRadii` core command + validation + undo/redo tests | Core (Rust) |
| 2 | 6 GraphQL mutations for style properties + integration tests | Server (Rust) |
| 3 | 6 MCP tools mirroring GraphQL mutations + tests | MCP (Rust) |
| 4 | Frontend GraphQL strings + store methods with optimistic updates | Frontend (TypeScript) |

After this plan, all style property mutations are available via GraphQL and MCP, with optimistic frontend store methods. The frontend panel UI (Plans 09b–09d) can call these store methods directly.
