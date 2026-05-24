# Plan 14a — Corner Shapes Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rectangle-only circular `corner_radii: [f64; 4]` model with a per-corner discriminated-enum `Corner` model supporting Round / Bevel / Notch / Scoop / Superellipse shapes and axis-asymmetric `{x, y}` radii on Rectangle, Frame, and Image nodes — end-to-end from core crate through MCP, GraphQL, and the frontend store.

**Architecture:** The core crate owns the `Corner` enum and `SetCorners` FieldOperation with uniformity validation (superellipse must be applied to all four corners with identical smoothing). A shared shorthand-expansion helper in a new `corners_input` module is consumed by both GraphQL and MCP transports. The frontend store mirrors the Rust types in TypeScript and uses the same debounced optimistic-update pattern as the existing `setCornerRadii`. A workfile migration reads legacy `corner_radii` arrays and converts them to `Round` corners on load; the next save persists the new schema. A minimal temporary UI (4 radius inputs, Round-only) in the Design panel bridges the gap until Plan 14d ships the full corner editor.

**Tech Stack:** Rust (serde, thiserror), async-graphql, rmcp, Solid.js, TypeScript, Vitest, Cargo test.

**Spec reference:** `docs/superpowers/specs/2026-04-23-14-corner-shapes.md` — read sections §1.1–§1.4, §5 (migration), §7 (validation inventory), §9 (consistency).

**Key file paths (research summary):**
- `crates/core/src/node.rs:773-802` — NodeKind variants to modify
- `crates/core/src/commands/style_commands.rs:200-258` — legacy `SetCornerRadii` to replace
- `crates/core/src/validate.rs:47` — `CURRENT_SCHEMA_VERSION` to bump
- `crates/core/src/serialize.rs` — workfile load/save, no existing migration infra
- `crates/server/src/graphql/mutation.rs:328-375` — `"kind"` path dispatcher
- `crates/mcp/src/server.rs:346-357` — `set_corner_radii` tool definition
- `crates/mcp/src/types.rs:365-371` — `SetCornerRadiiInput`
- `crates/mcp/src/tools/nodes.rs:960-1015` — MCP impl + broadcast (line 1002 broadcast call)
- `frontend/src/types/document.ts:589-592` — TS `NodeKindRectangle`
- `frontend/src/store/document-store-solid.tsx:944-967` — TS `setCornerRadii`
- `frontend/src/operations/apply-remote.ts:250-263` — remote op handler
- `frontend/src/panels/schemas/design-schema.ts:58-67` — corner radius UI schema entry

---

## Phase 1 — Core types and validation constants

### Task 1: Add corner-radius validation constants

**Files:**
- Modify: `crates/core/src/validate.rs`

- [ ] **Step 1: Add the failing test**

Append to `crates/core/src/validate.rs` test module (find the existing `#[cfg(test)] mod tests` block at the bottom):

```rust
#[test]
fn test_corner_constants_have_expected_values() {
    assert_eq!(MAX_CORNER_RADIUS, 100_000.0);
    assert_eq!(MIN_CORNER_SMOOTHING, 0.0);
    assert_eq!(MAX_CORNER_SMOOTHING, 1.0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev.sh cargo test -p agent-designer-core validate::tests::test_corner_constants_have_expected_values`
Expected: FAIL with "cannot find value `MAX_CORNER_RADIUS`".

- [ ] **Step 3: Add the constants**

In `crates/core/src/validate.rs`, alongside the other `MAX_*` / `MIN_*` constants, add:

```rust
/// Maximum value for a single corner radius component (pixels).
/// Applies to both x and y components of CornerRadii.
pub const MAX_CORNER_RADIUS: f64 = 100_000.0;

/// Minimum superellipse smoothing value (0.0 = no smoothing, collapses to circular arc).
pub const MIN_CORNER_SMOOTHING: f64 = 0.0;

/// Maximum superellipse smoothing value (1.0 = full G2-continuous squircle).
pub const MAX_CORNER_SMOOTHING: f64 = 1.0;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./dev.sh cargo test -p agent-designer-core validate::tests::test_corner_constants_have_expected_values`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/validate.rs
git commit -m "feat(core): add corner-shape validation constants (spec-14a)"
```

---

### Task 2: Define `CornerRadii` and `Corner` types

**Files:**
- Modify: `crates/core/src/node.rs` (add new types before `NodeKind` definition around line 770)

- [ ] **Step 1: Write failing tests**

In `crates/core/src/node.rs` test module (`#[cfg(test)] mod tests`), add:

```rust
#[test]
fn test_corner_round_serde_round_trip() {
    let corner = Corner::Round {
        radii: CornerRadii { x: 8.0, y: 12.0 },
    };
    let json = serde_json::to_string(&corner).expect("serialize");
    assert!(json.contains(r#""type":"round""#));
    let back: Corner = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(corner, back);
}

#[test]
fn test_corner_superellipse_serde_round_trip() {
    let corner = Corner::Superellipse {
        radii: CornerRadii { x: 8.0, y: 8.0 },
        smoothing: 0.6,
    };
    let json = serde_json::to_string(&corner).expect("serialize");
    assert!(json.contains(r#""type":"superellipse""#));
    assert!(json.contains(r#""smoothing":0.6"#));
    let back: Corner = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(corner, back);
}

#[test]
fn test_corner_deserialize_rejects_unknown_shape() {
    let json = r#"{"type":"triangle","radii":{"x":8,"y":8}}"#;
    let result: Result<Corner, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn test_corner_deserialize_rejects_smoothing_on_round() {
    // Smoothing field on a Round variant must be rejected (field is variant-local).
    let json = r#"{"type":"round","radii":{"x":8,"y":8},"smoothing":0.5}"#;
    let result: Result<Corner, _> = serde_json::from_str(json);
    // serde with tagged enums ignores unknown fields by default;
    // we must use deny_unknown_fields on each variant for this to fail.
    assert!(result.is_err(), "expected rejection of smoothing on Round variant");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev.sh cargo test -p agent-designer-core node::tests::test_corner`
Expected: FAIL with "cannot find type `Corner`".

- [ ] **Step 3: Add the types**

In `crates/core/src/node.rs`, insert before the `NodeKind` enum definition (around line 770):

```rust
/// Horizontal and vertical radii for a single corner.
/// CSS-style elliptical border-radius — `x` is along the top/bottom edge,
/// `y` is along the left/right edge.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CornerRadii {
    pub x: f64,
    pub y: f64,
}

/// Shape applied to a single corner.
/// Tagged enum serialized as `{"type": "<variant>", ...}`.
///
/// Superellipse carries an additional `smoothing` field (0.0..=1.0).
/// Other variants have no extra fields — `deny_unknown_fields` on each
/// variant prevents silent acceptance of misapplied parameters.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Corner {
    Round { radii: CornerRadii },
    Bevel { radii: CornerRadii },
    Notch { radii: CornerRadii },
    Scoop { radii: CornerRadii },
    Superellipse {
        radii: CornerRadii,
        smoothing: f64,
    },
}

impl Corner {
    /// The radii of this corner, regardless of shape.
    pub fn radii(&self) -> CornerRadii {
        match self {
            Corner::Round { radii }
            | Corner::Bevel { radii }
            | Corner::Notch { radii }
            | Corner::Scoop { radii }
            | Corner::Superellipse { radii, .. } => *radii,
        }
    }

    /// `true` if this corner is `Corner::Superellipse`.
    pub fn is_superellipse(&self) -> bool {
        matches!(self, Corner::Superellipse { .. })
    }

    /// The smoothing value for superellipse, or `None` for other shapes.
    pub fn smoothing(&self) -> Option<f64> {
        match self {
            Corner::Superellipse { smoothing, .. } => Some(*smoothing),
            _ => None,
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev.sh cargo test -p agent-designer-core node::tests::test_corner`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/node.rs
git commit -m "feat(core): add Corner and CornerRadii types (spec-14a)"
```

---

### Task 3: Add `validate_corners()` helper with uniformity rule

**Files:**
- Modify: `crates/core/src/validate.rs` (or wherever `validate_corner_radii` currently lives — check `crates/core/src/commands/style_commands.rs:200-219`)

Decision: move the corner-validation helpers to `validate.rs` per CLAUDE.md §5 "Define all validation artifacts in `validate.rs`". The legacy `validate_corner_radii` in `style_commands.rs:200` will be deleted in Task 5 when `SetCornerRadii` is replaced.

- [ ] **Step 1: Write failing tests**

Append to `crates/core/src/validate.rs` test module:

```rust
use crate::node::{Corner, CornerRadii};

fn round_corner(x: f64, y: f64) -> Corner {
    Corner::Round { radii: CornerRadii { x, y } }
}

fn superellipse_corner(x: f64, y: f64, s: f64) -> Corner {
    Corner::Superellipse { radii: CornerRadii { x, y }, smoothing: s }
}

#[test]
fn test_validate_corners_accepts_all_round() {
    let corners = [round_corner(8.0, 8.0); 4];
    assert!(validate_corners(&corners).is_ok());
}

#[test]
fn test_validate_corners_rejects_nan_radius_x() {
    let mut corners = [round_corner(8.0, 8.0); 4];
    corners[0] = round_corner(f64::NAN, 8.0);
    assert!(validate_corners(&corners).is_err());
}

#[test]
fn test_validate_corners_rejects_nan_radius_y() {
    let mut corners = [round_corner(8.0, 8.0); 4];
    corners[2] = round_corner(8.0, f64::NAN);
    assert!(validate_corners(&corners).is_err());
}

#[test]
fn test_validate_corners_rejects_infinite_radius() {
    let mut corners = [round_corner(8.0, 8.0); 4];
    corners[1] = round_corner(f64::INFINITY, 8.0);
    assert!(validate_corners(&corners).is_err());
}

#[test]
fn test_validate_corners_rejects_negative_radius() {
    let mut corners = [round_corner(8.0, 8.0); 4];
    corners[3] = round_corner(-1.0, 8.0);
    assert!(validate_corners(&corners).is_err());
}

#[test]
fn test_max_corner_radius_enforced() {
    let mut corners = [round_corner(8.0, 8.0); 4];
    corners[0] = round_corner(MAX_CORNER_RADIUS + 1.0, 8.0);
    assert!(validate_corners(&corners).is_err());
}

#[test]
fn test_validate_corners_rejects_mixed_superellipse() {
    let corners = [
        superellipse_corner(8.0, 8.0, 0.6),
        round_corner(8.0, 8.0),
        round_corner(8.0, 8.0),
        round_corner(8.0, 8.0),
    ];
    let err = validate_corners(&corners).expect_err("expected uniformity error");
    let msg = format!("{err}");
    assert!(
        msg.contains("superellipse must be applied uniformly"),
        "unexpected error: {msg}"
    );
}

#[test]
fn test_validate_corners_rejects_superellipse_smoothing_mismatch() {
    let corners = [
        superellipse_corner(8.0, 8.0, 0.3),
        superellipse_corner(8.0, 8.0, 0.7),
        superellipse_corner(8.0, 8.0, 0.3),
        superellipse_corner(8.0, 8.0, 0.3),
    ];
    let err = validate_corners(&corners).expect_err("expected smoothing parity error");
    let msg = format!("{err}");
    assert!(
        msg.contains("superellipse smoothing must match"),
        "unexpected error: {msg}"
    );
}

#[test]
fn test_validate_corners_accepts_uniform_superellipse_with_asymmetric_radii() {
    let corners = [
        superellipse_corner(4.0, 8.0, 0.6),
        superellipse_corner(16.0, 16.0, 0.6),
        superellipse_corner(16.0, 4.0, 0.6),
        superellipse_corner(8.0, 8.0, 0.6),
    ];
    assert!(validate_corners(&corners).is_ok());
}

#[test]
fn test_min_corner_smoothing_enforced() {
    let corners = [superellipse_corner(8.0, 8.0, -0.01); 4];
    assert!(validate_corners(&corners).is_err());
}

#[test]
fn test_max_corner_smoothing_enforced() {
    let corners = [superellipse_corner(8.0, 8.0, 1.01); 4];
    assert!(validate_corners(&corners).is_err());
}

#[test]
fn test_validate_corners_rejects_nan_smoothing() {
    let corners = [superellipse_corner(8.0, 8.0, f64::NAN); 4];
    assert!(validate_corners(&corners).is_err());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev.sh cargo test -p agent-designer-core validate::tests::test_validate_corners`
Expected: FAIL with "cannot find function `validate_corners`".

- [ ] **Step 3: Implement `validate_corners`**

Add to `crates/core/src/validate.rs`:

```rust
use crate::node::Corner;
use crate::CoreError;

/// Validates a full `[Corner; 4]` array for a node.
///
/// Checks, in order:
/// 1. Each corner's radii are finite, non-negative, and within MAX_CORNER_RADIUS.
/// 2. Each Superellipse corner's smoothing is finite and within
///    [MIN_CORNER_SMOOTHING, MAX_CORNER_SMOOTHING].
/// 3. Superellipse uniformity: if any corner is Superellipse, all four must be.
/// 4. Superellipse smoothing parity: when all four are Superellipse,
///    their smoothing values must be equal.
pub fn validate_corners(corners: &[Corner; 4]) -> Result<(), CoreError> {
    // (1) and (2): per-corner field validation.
    for (i, corner) in corners.iter().enumerate() {
        let radii = corner.radii();
        validate_radius_component(radii.x, i, "x")?;
        validate_radius_component(radii.y, i, "y")?;

        if let Some(s) = corner.smoothing() {
            if !s.is_finite() {
                return Err(CoreError::ValidationError(format!(
                    "corners[{i}].smoothing must be finite, got {s}"
                )));
            }
            if !(MIN_CORNER_SMOOTHING..=MAX_CORNER_SMOOTHING).contains(&s) {
                return Err(CoreError::ValidationError(format!(
                    "corners[{i}].smoothing must be in [{MIN_CORNER_SMOOTHING}, \
                     {MAX_CORNER_SMOOTHING}], got {s}"
                )));
            }
        }
    }

    // (3) Uniformity: mixed superellipse + other shapes is rejected.
    let superellipse_count = corners.iter().filter(|c| c.is_superellipse()).count();
    if superellipse_count > 0 && superellipse_count < 4 {
        return Err(CoreError::ValidationError(
            "superellipse must be applied uniformly to all four corners".to_string(),
        ));
    }

    // (4) Smoothing parity when all four are superellipse.
    if superellipse_count == 4 {
        // Safe to unwrap: we just verified all four are Superellipse.
        let first = corners[0].smoothing().unwrap();
        for (i, c) in corners.iter().enumerate().skip(1) {
            let s = c.smoothing().unwrap();
            // Bitwise equality — smoothing is user-entered, same value
            // should round-trip exactly. Avoid epsilon comparison which
            // would silently accept drift.
            if s.to_bits() != first.to_bits() {
                return Err(CoreError::ValidationError(format!(
                    "superellipse smoothing must match across all four corners \
                     (corners[0]={first}, corners[{i}]={s})"
                )));
            }
        }
    }

    Ok(())
}

fn validate_radius_component(value: f64, corner_index: usize, axis: &str) -> Result<(), CoreError> {
    if !value.is_finite() {
        return Err(CoreError::ValidationError(format!(
            "corners[{corner_index}].radii.{axis} must be finite \
             (no NaN or infinity), got {value}"
        )));
    }
    if value < 0.0 {
        return Err(CoreError::ValidationError(format!(
            "corners[{corner_index}].radii.{axis} must be non-negative, got {value}"
        )));
    }
    if value > MAX_CORNER_RADIUS {
        return Err(CoreError::ValidationError(format!(
            "corners[{corner_index}].radii.{axis} exceeds MAX_CORNER_RADIUS \
             ({MAX_CORNER_RADIUS}), got {value}"
        )));
    }
    Ok(())
}
```

Ensure `validate_corners`, `MAX_CORNER_RADIUS`, `MIN_CORNER_SMOOTHING`, `MAX_CORNER_SMOOTHING` are `pub` (re-exported via `lib.rs` if that's the crate convention — check existing `validate_corner_radii` export pattern).

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev.sh cargo test -p agent-designer-core validate::tests::test_validate_corners`
Run: `./dev.sh cargo test -p agent-designer-core validate::tests::test_max_corner_radius_enforced`
Run: `./dev.sh cargo test -p agent-designer-core validate::tests::test_min_corner_smoothing_enforced`
Run: `./dev.sh cargo test -p agent-designer-core validate::tests::test_max_corner_smoothing_enforced`
Expected: all PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/validate.rs
git commit -m "feat(core): add validate_corners with superellipse uniformity rule (spec-14a)"
```

---

## Phase 2 — NodeKind changes and field migration

### Task 4: Change Rectangle/Frame/Image to use `corners: [Corner; 4]`

**Files:**
- Modify: `crates/core/src/node.rs:773-802` (NodeKind variants)

This task breaks the build until the downstream call sites are updated. That's intentional — the compiler errors drive the subsequent tasks. The helper `default_corners()` keeps test setups concise.

- [ ] **Step 1: Write failing test**

Add to `crates/core/src/node.rs` test module:

```rust
#[test]
fn test_node_kind_rectangle_has_corners_field() {
    let kind = NodeKind::Rectangle {
        corners: default_corners(),
    };
    if let NodeKind::Rectangle { corners } = kind {
        assert_eq!(corners.len(), 4);
        assert!(matches!(corners[0], Corner::Round { .. }));
    } else {
        panic!("expected Rectangle variant");
    }
}

#[test]
fn test_node_kind_frame_has_corners_field() {
    let kind = NodeKind::Frame {
        layout: None,
        corners: default_corners(),
    };
    if let NodeKind::Frame { corners, .. } = kind {
        assert_eq!(corners.len(), 4);
    } else {
        panic!("expected Frame variant");
    }
}

#[test]
fn test_node_kind_image_has_corners_field() {
    let kind = NodeKind::Image {
        asset_ref: "asset-1".to_string(),
        corners: default_corners(),
    };
    if let NodeKind::Image { corners, .. } = kind {
        assert_eq!(corners.len(), 4);
    } else {
        panic!("expected Image variant");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev.sh cargo test -p agent-designer-core node::tests::test_node_kind_rectangle_has_corners_field`
Expected: FAIL — compilation error, `corners` field not recognized.

- [ ] **Step 3: Modify NodeKind variants + add default helper**

In `crates/core/src/node.rs`:

```rust
// Insert above the NodeKind enum (after the Corner impl from Task 2):

/// Construct an array of four `Corner::Round` with zero radii.
/// Used as the default for nodes that don't specify corners.
pub fn default_corners() -> [Corner; 4] {
    let zero = Corner::Round {
        radii: CornerRadii { x: 0.0, y: 0.0 },
    };
    [zero; 4]
}
```

Update the `NodeKind` enum variants:

```rust
pub enum NodeKind {
    Frame {
        layout: Option<LayoutMode>,
        corners: [Corner; 4],
    },
    Rectangle {
        corners: [Corner; 4],
    },
    Image {
        asset_ref: String,
        corners: [Corner; 4],
    },
    // ... other variants unchanged
}
```

- [ ] **Step 4: Fix compilation errors in the core crate**

Run: `./dev.sh cargo build -p agent-designer-core`

For each compile error in `crates/core/`, update the call site:
- **Every `NodeKind::Rectangle { corner_radii: [...] }`** — replace with `NodeKind::Rectangle { corners: default_corners() }` if the radii were all zero, or `NodeKind::Rectangle { corners: corner_radii_to_corners([r0, r1, r2, r3]) }` otherwise. Introduce `corner_radii_to_corners` as a `#[cfg(test)] pub(crate)` helper (see below).
- **Every `NodeKind::Frame { layout }`** — replace with `NodeKind::Frame { layout, corners: default_corners() }`.
- **Every `NodeKind::Image { asset_ref }`** — replace with `NodeKind::Image { asset_ref, corners: default_corners() }`.
- Any `match` on `NodeKind::Rectangle { corner_radii }` — rename binding to `corners` and update body.

Add to `crates/core/src/node.rs` (near `default_corners`):

```rust
#[cfg(test)]
pub(crate) fn corner_radii_to_corners(radii: [f64; 4]) -> [Corner; 4] {
    [
        Corner::Round { radii: CornerRadii { x: radii[0], y: radii[0] } },
        Corner::Round { radii: CornerRadii { x: radii[1], y: radii[1] } },
        Corner::Round { radii: CornerRadii { x: radii[2], y: radii[2] } },
        Corner::Round { radii: CornerRadii { x: radii[3], y: radii[3] } },
    ]
}
```

This helper exists only to migrate the test fixtures in this commit. The production migration path lives in Task 6 (workfile migration), which uses its own logic — do NOT reuse this helper for production.

Re-run `./dev.sh cargo build -p agent-designer-core` until it succeeds.

- [ ] **Step 5: Run tests**

Run: `./dev.sh cargo test -p agent-designer-core node::tests::test_node_kind_rectangle_has_corners_field`
Run: `./dev.sh cargo test -p agent-designer-core node::tests::test_node_kind_frame_has_corners_field`
Run: `./dev.sh cargo test -p agent-designer-core node::tests::test_node_kind_image_has_corners_field`
Expected: PASS.

Also run the full core test suite. Many tests will fail because `SetCornerRadii` still references the old field — this is expected and will be resolved in Task 5.

Run: `./dev.sh cargo test -p agent-designer-core` — expect failures in `commands::style_commands` tests. Acceptable until Task 5.

- [ ] **Step 6: Commit**

```bash
git add crates/core/src/node.rs crates/core/src/
git commit -m "refactor(core): Rectangle/Frame/Image use [Corner; 4] field (spec-14a)

The SetCornerRadii FieldOperation is left in a broken state in this
commit — it's deleted and replaced by SetCorners in the next commit."
```

---

## Phase 3 — Replace `SetCornerRadii` with `SetCorners`

### Task 5: Implement `SetCorners` FieldOperation and delete `SetCornerRadii`

**Files:**
- Modify: `crates/core/src/commands/style_commands.rs` (delete `SetCornerRadii` at lines 225-258, delete legacy `validate_corner_radii` at lines 200-219, add `SetCorners` alongside)
- Modify: `crates/core/src/commands/style_commands.rs` test module at lines 592-644 (delete legacy tests, add new tests)
- Modify: `crates/core/src/commands/mod.rs` or `crates/core/src/lib.rs` — wherever `SetCornerRadii` is re-exported, replace with `SetCorners`.

- [ ] **Step 1: Write failing tests**

Replace the existing `SetCornerRadii` test block (lines 592-644) in `crates/core/src/commands/style_commands.rs` with:

```rust
#[test]
fn test_set_corners_validate_and_apply() {
    let (mut doc, node_id) = setup_doc_with_rect();
    let new_corners = [
        Corner::Round { radii: CornerRadii { x: 4.0, y: 4.0 } },
        Corner::Bevel { radii: CornerRadii { x: 8.0, y: 8.0 } },
        Corner::Notch { radii: CornerRadii { x: 12.0, y: 12.0 } },
        Corner::Scoop { radii: CornerRadii { x: 16.0, y: 16.0 } },
    ];
    let op = SetCorners { node_id, new_corners };

    op.validate(&doc).expect("validate");
    op.apply(&mut doc).expect("apply");

    match &doc.arena.get(node_id).unwrap().kind {
        NodeKind::Rectangle { corners } => assert_eq!(*corners, new_corners),
        _ => panic!("expected Rectangle"),
    }
}

#[test]
fn test_set_corners_applies_to_frame() {
    let mut doc = Document::new("Test".to_string());
    let node = Node::new(
        NodeId::new(0, 0),
        make_uuid(1),
        NodeKind::Frame { layout: None, corners: default_corners() },
        "Frame".to_string(),
    ).expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    let new_corners = [Corner::Round { radii: CornerRadii { x: 12.0, y: 12.0 } }; 4];
    let op = SetCorners { node_id, new_corners };
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
        make_uuid(1),
        NodeKind::Image { asset_ref: "asset-1".to_string(), corners: default_corners() },
        "Image".to_string(),
    ).expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    let new_corners = [Corner::Bevel { radii: CornerRadii { x: 6.0, y: 6.0 } }; 4];
    let op = SetCorners { node_id, new_corners };
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
    // Create an Ellipse node (or whatever non-rect-shaped variant exists).
    // If Ellipse has a different NodeKind, substitute Text or Group.
    let node = Node::new(
        NodeId::new(0, 0),
        make_uuid(1),
        NodeKind::Group,  // adjust to a valid non-Rect/Frame/Image variant in this codebase
        "Group".to_string(),
    ).expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    let op = SetCorners {
        node_id,
        new_corners: default_corners(),
    };
    let err = op.validate(&doc).expect_err("expected non-rect-shaped rejection");
    assert!(matches!(err, CoreError::ValidationError(_)));
}

#[test]
fn test_set_corners_rejects_nan_radius() {
    let (doc, node_id) = setup_doc_with_rect();
    let mut corners = default_corners();
    corners[0] = Corner::Round { radii: CornerRadii { x: f64::NAN, y: 0.0 } };
    let op = SetCorners { node_id, new_corners: corners };
    assert!(op.validate(&doc).is_err());
}

#[test]
fn test_set_corners_rejects_negative_radius() {
    let (doc, node_id) = setup_doc_with_rect();
    let mut corners = default_corners();
    corners[0] = Corner::Round { radii: CornerRadii { x: -1.0, y: 0.0 } };
    let op = SetCorners { node_id, new_corners: corners };
    assert!(op.validate(&doc).is_err());
}

#[test]
fn test_set_corners_rejects_infinite_radius() {
    let (doc, node_id) = setup_doc_with_rect();
    let mut corners = default_corners();
    corners[2] = Corner::Round { radii: CornerRadii { x: f64::INFINITY, y: 0.0 } };
    let op = SetCorners { node_id, new_corners: corners };
    assert!(op.validate(&doc).is_err());
}

#[test]
fn test_set_corners_rejects_mixed_superellipse() {
    let (doc, node_id) = setup_doc_with_rect();
    let corners = [
        Corner::Superellipse { radii: CornerRadii { x: 8.0, y: 8.0 }, smoothing: 0.5 },
        Corner::Round { radii: CornerRadii { x: 8.0, y: 8.0 } },
        Corner::Round { radii: CornerRadii { x: 8.0, y: 8.0 } },
        Corner::Round { radii: CornerRadii { x: 8.0, y: 8.0 } },
    ];
    let op = SetCorners { node_id, new_corners: corners };
    let err = op.validate(&doc).expect_err("expected uniformity error");
    let msg = format!("{err}");
    assert!(msg.contains("superellipse must be applied uniformly"), "msg: {msg}");
}

#[test]
fn test_set_corners_rejects_superellipse_smoothing_mismatch() {
    let (doc, node_id) = setup_doc_with_rect();
    let corners = [
        Corner::Superellipse { radii: CornerRadii { x: 8.0, y: 8.0 }, smoothing: 0.3 },
        Corner::Superellipse { radii: CornerRadii { x: 8.0, y: 8.0 }, smoothing: 0.7 },
        Corner::Superellipse { radii: CornerRadii { x: 8.0, y: 8.0 }, smoothing: 0.3 },
        Corner::Superellipse { radii: CornerRadii { x: 8.0, y: 8.0 }, smoothing: 0.3 },
    ];
    let op = SetCorners { node_id, new_corners: corners };
    let err = op.validate(&doc).expect_err("expected smoothing parity error");
    let msg = format!("{err}");
    assert!(msg.contains("superellipse smoothing must match"), "msg: {msg}");
}

#[test]
fn test_set_corners_accepts_uniform_superellipse_with_asymmetric_radii() {
    let (doc, node_id) = setup_doc_with_rect();
    let corners = [
        Corner::Superellipse { radii: CornerRadii { x: 4.0, y: 8.0 }, smoothing: 0.6 },
        Corner::Superellipse { radii: CornerRadii { x: 16.0, y: 16.0 }, smoothing: 0.6 },
        Corner::Superellipse { radii: CornerRadii { x: 16.0, y: 4.0 }, smoothing: 0.6 },
        Corner::Superellipse { radii: CornerRadii { x: 8.0, y: 8.0 }, smoothing: 0.6 },
    ];
    let op = SetCorners { node_id, new_corners: corners };
    assert!(op.validate(&doc).is_ok());
}

#[test]
fn test_set_corners_rejects_missing_node() {
    let doc = Document::new("Test".to_string());
    let op = SetCorners {
        node_id: NodeId::new(999, 0),
        new_corners: default_corners(),
    };
    assert!(op.validate(&doc).is_err());
}
```

`setup_doc_with_rect()` from the existing test module still works — update it to use `corners: default_corners()` if not already done by Task 4's build fix.

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev.sh cargo test -p agent-designer-core commands::style_commands::tests::test_set_corners`
Expected: FAIL with "cannot find struct `SetCorners`".

- [ ] **Step 3: Implement `SetCorners` and delete `SetCornerRadii`**

In `crates/core/src/commands/style_commands.rs`:

1. **Delete lines 200-219** (the old `validate_corner_radii` helper) — we use `validate_corners` from `validate.rs` now.
2. **Delete lines 225-258** (the old `SetCornerRadii` struct and impl).
3. **Add** the new `SetCorners`:

```rust
use crate::node::{Corner, NodeKind};
use crate::validate::validate_corners;

/// Replaces all four corner shapes on a Rectangle, Frame, or Image node.
///
/// `new_corners` must pass `validate_corners()`:
/// - All radii finite, non-negative, and ≤ MAX_CORNER_RADIUS.
/// - Superellipse smoothing finite and in [0.0, 1.0].
/// - If any corner is Superellipse, all four must be.
/// - If all four are Superellipse, smoothing must match across them.
#[derive(Debug)]
pub struct SetCorners {
    pub node_id: NodeId,
    pub new_corners: [Corner; 4],
}

impl FieldOperation for SetCorners {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_corners(&self.new_corners)?;
        let node = doc.arena.get(self.node_id)?;
        match &node.kind {
            NodeKind::Rectangle { .. }
            | NodeKind::Frame { .. }
            | NodeKind::Image { .. } => Ok(()),
            other => Err(CoreError::ValidationError(format!(
                "SetCorners requires Rectangle, Frame, or Image node, got {:?}",
                std::mem::discriminant(other)
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
            other => Err(CoreError::ValidationError(format!(
                "SetCorners requires Rectangle, Frame, or Image node, got {:?}",
                std::mem::discriminant(other)
            ))),
        }
    }
}
```

4. **Update `lib.rs`** — find the existing re-export line (typically `pub use commands::style_commands::{... SetCornerRadii ...};`) and replace `SetCornerRadii` with `SetCorners`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev.sh cargo test -p agent-designer-core commands::style_commands::tests::test_set_corners`
Expected: PASS (11 tests).

Run full core: `./dev.sh cargo test -p agent-designer-core`
Expected: PASS. If any test still references `SetCornerRadii` or `corner_radii` field, update it to use the new types.

Run: `./dev.sh cargo clippy -p agent-designer-core -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/core/
git commit -m "feat(core): replace SetCornerRadii with SetCorners FieldOperation (spec-14a)

SetCorners handles Rectangle, Frame, and Image nodes with per-corner
shape selection and axis-asymmetric radii. Validation rejects mixed
superellipse arrays and smoothing-mismatched arrays per spec 14 §1.2."
```

---



---

## Phase 4 — Workfile migration

### Task 6: Bump schema version and migrate legacy `corner_radii` on load

**Context:** `SerializedNode.kind` in `crates/core/src/serialize.rs:43-56` is stored as `serde_json::Value` — migration is a JSON-to-JSON transform applied before the kind is deserialized into `NodeKind`. Legacy workfiles have `{"type": "rectangle", "corner_radii": [r0, r1, r2, r3]}`; Frame/Image legacy workfiles have no corner-related field at all.

**Files:**
- Modify: `crates/core/src/validate.rs` — bump `CURRENT_SCHEMA_VERSION` from 1 to 2.
- Create: `crates/core/src/migrations.rs` — module holding per-version JSON migration functions.
- Modify: `crates/core/src/lib.rs` — register the `migrations` module.
- Modify: `crates/core/src/serialize.rs` — call migrations before deserializing `SerializedPage` into in-memory types.

- [ ] **Step 1: Write failing tests**

Create `crates/core/src/migrations.rs` with these tests (and leave the implementation empty — just `fn migrate_to_v2() {}` stub):

```rust
//! Workfile schema migrations. Each public `migrate_to_vN` function
//! takes a `serde_json::Value` representing a SerializedPage at
//! version N-1 and returns it transformed to version N.

use serde_json::{json, Value};

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_rectangle_page() -> Value {
        json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Page 1",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "rectangle", "corner_radii": [4.0, 8.0, 12.0, 16.0] },
                "name": "Rect",
                "parent": null,
                "children": [],
                "transform": {},
                "style": {},
                "constraints": {},
                "visible": true,
                "locked": false
            }],
            "transitions": []
        })
    }

    #[test]
    fn test_migrate_v1_to_v2_converts_rectangle_corner_radii_to_corners() {
        let migrated = migrate_to_v2(legacy_rectangle_page());
        assert_eq!(migrated["schema_version"], 2);
        let kind = &migrated["nodes"][0]["kind"];
        assert!(kind.get("corner_radii").is_none(), "legacy field must be removed");
        let corners = kind.get("corners").expect("corners field present");
        let arr = corners.as_array().expect("corners is array");
        assert_eq!(arr.len(), 4);
        assert_eq!(arr[0]["type"], "round");
        assert_eq!(arr[0]["radii"]["x"], 4.0);
        assert_eq!(arr[0]["radii"]["y"], 4.0);
        assert_eq!(arr[1]["radii"]["x"], 8.0);
        assert_eq!(arr[2]["radii"]["x"], 12.0);
        assert_eq!(arr[3]["radii"]["x"], 16.0);
    }

    #[test]
    fn test_migrate_v1_to_v2_defaults_frame_corners() {
        let page = json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "P",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "frame", "layout": null },
                "name": "F",
                "parent": null,
                "children": [],
                "transform": {},
                "style": {},
                "constraints": {},
                "visible": true,
                "locked": false
            }],
            "transitions": []
        });
        let migrated = migrate_to_v2(page);
        let kind = &migrated["nodes"][0]["kind"];
        let corners = kind["corners"].as_array().expect("corners default");
        assert_eq!(corners.len(), 4);
        for c in corners {
            assert_eq!(c["type"], "round");
            assert_eq!(c["radii"]["x"], 0.0);
            assert_eq!(c["radii"]["y"], 0.0);
        }
    }

    #[test]
    fn test_migrate_v1_to_v2_defaults_image_corners() {
        let page = json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "P",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "image", "asset_ref": "a1" },
                "name": "I",
                "parent": null,
                "children": [],
                "transform": {},
                "style": {},
                "constraints": {},
                "visible": true,
                "locked": false
            }],
            "transitions": []
        });
        let migrated = migrate_to_v2(page);
        assert_eq!(migrated["nodes"][0]["kind"]["corners"].as_array().unwrap().len(), 4);
    }

    #[test]
    fn test_migrate_v1_to_v2_leaves_non_rect_kinds_unchanged() {
        let page = json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "P",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": { "type": "text", "content": "hi" },
                "name": "T",
                "parent": null,
                "children": [],
                "transform": {},
                "style": {},
                "constraints": {},
                "visible": true,
                "locked": false
            }],
            "transitions": []
        });
        let migrated = migrate_to_v2(page);
        let kind = &migrated["nodes"][0]["kind"];
        assert!(kind.get("corners").is_none(), "text kind must not gain corners");
        assert_eq!(kind["type"], "text");
    }

    #[test]
    fn test_migrate_v1_to_v2_is_idempotent_on_already_new_schema() {
        let v2_page = json!({
            "schema_version": 2,
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "P",
            "nodes": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": {
                    "type": "rectangle",
                    "corners": [
                        { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                        { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                        { "type": "round", "radii": { "x": 0.0, "y": 0.0 } },
                        { "type": "round", "radii": { "x": 0.0, "y": 0.0 } }
                    ]
                },
                "name": "R",
                "parent": null,
                "children": [],
                "transform": {},
                "style": {},
                "constraints": {},
                "visible": true,
                "locked": false
            }],
            "transitions": []
        });
        let migrated = migrate_to_v2(v2_page.clone());
        assert_eq!(migrated, v2_page);
    }
}
```

Register the module in `crates/core/src/lib.rs`:

```rust
pub mod migrations;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev.sh cargo test -p agent-designer-core migrations::tests`
Expected: FAIL — `migrate_to_v2` not found or empty stub returns unchanged input.

- [ ] **Step 3: Implement the migration**

Replace the stub in `crates/core/src/migrations.rs` with:

```rust
/// Migrates a SerializedPage JSON blob from schema v1 to v2.
///
/// v1 → v2 changes:
/// - Rectangle: `corner_radii: [r0, r1, r2, r3]` → `corners: [{type:"round", radii:{x,y}}; 4]`
/// - Frame: gains `corners` field defaulted to `[{type:"round", radii:{x:0, y:0}}; 4]`
/// - Image: gains `corners` field defaulted to `[{type:"round", radii:{x:0, y:0}}; 4]`
/// - Other kinds unchanged.
///
/// Idempotent on already-v2 input (already-migrated node kinds are skipped).
pub fn migrate_to_v2(mut page: Value) -> Value {
    page["schema_version"] = json!(2);

    let Some(nodes) = page.get_mut("nodes").and_then(Value::as_array_mut) else {
        return page;
    };

    for node in nodes.iter_mut() {
        let Some(kind) = node.get_mut("kind") else {
            continue;
        };
        let kind_type = kind.get("type").and_then(Value::as_str).map(String::from);
        match kind_type.as_deref() {
            Some("rectangle") => migrate_rectangle_kind(kind),
            Some("frame") | Some("image") => migrate_frame_or_image_kind(kind),
            _ => {} // leave other kinds unchanged
        }
    }

    page
}

fn migrate_rectangle_kind(kind: &mut Value) {
    if kind.get("corners").is_some() {
        return; // already migrated
    }
    let legacy = kind
        .as_object_mut()
        .and_then(|o| o.remove("corner_radii"))
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    let radii: [f64; 4] = [
        legacy.first().and_then(Value::as_f64).unwrap_or(0.0),
        legacy.get(1).and_then(Value::as_f64).unwrap_or(0.0),
        legacy.get(2).and_then(Value::as_f64).unwrap_or(0.0),
        legacy.get(3).and_then(Value::as_f64).unwrap_or(0.0),
    ];

    let corners: Vec<Value> = radii
        .iter()
        .map(|&r| json!({ "type": "round", "radii": { "x": r, "y": r } }))
        .collect();

    if let Some(obj) = kind.as_object_mut() {
        obj.insert("corners".into(), Value::Array(corners));
    }
}

fn migrate_frame_or_image_kind(kind: &mut Value) {
    if kind.get("corners").is_some() {
        return; // already migrated
    }
    let default_corner = json!({ "type": "round", "radii": { "x": 0.0, "y": 0.0 } });
    let corners = vec![default_corner; 4];
    if let Some(obj) = kind.as_object_mut() {
        obj.insert("corners".into(), Value::Array(corners));
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev.sh cargo test -p agent-designer-core migrations::tests`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire migration into the page loader**

Find the deserialization entry point in `crates/core/src/serialize.rs` (search for `from_str` or `from_value` on `SerializedPage`). Before deserializing the `Value` into `SerializedPage`, apply the migration chain based on the parsed `schema_version`:

```rust
use crate::migrations::migrate_to_v2;
use crate::validate::CURRENT_SCHEMA_VERSION;

// Inside the page loader, after parsing JSON into a generic Value:
let raw_page: Value = serde_json::from_str(json_str)
    .map_err(|e| CoreError::SerializationError(format!("parse page json: {e}")))?;

let version = raw_page.get("schema_version").and_then(Value::as_u64).unwrap_or(1) as u32;
let migrated = match version {
    1 => migrate_to_v2(raw_page),
    v if v == CURRENT_SCHEMA_VERSION => raw_page,
    v if v > CURRENT_SCHEMA_VERSION => {
        return Err(CoreError::SerializationError(format!(
            "workfile schema version {v} is newer than supported version {CURRENT_SCHEMA_VERSION}"
        )));
    }
    v => {
        return Err(CoreError::SerializationError(format!(
            "unsupported workfile schema version {v}"
        )));
    }
};

let page: SerializedPage = serde_json::from_value(migrated)
    .map_err(|e| CoreError::SerializationError(format!("deserialize page: {e}")))?;
```

Add an end-to-end loader test in `crates/core/src/serialize.rs` test module. Reuse existing serialize fixtures (find a `#[test]` function in the same file that constructs a valid `SerializedPage`, and copy its transform/style/constraints JSON substructures verbatim):

```rust
#[test]
fn test_load_page_migrates_legacy_v1_rectangle() {
    // Construct a v1 JSON with a rectangle that has corner_radii = [4,4,4,4].
    // Reuse transform/style/constraints from an existing serialize test fixture
    // in this module — do not invent shapes. See `test_serialize_round_trip_*`
    // tests earlier in this file for known-valid substructures.
    let legacy_json = /* ... */;

    // Call the public loader (whatever it's named — e.g. `deserialize_page`).
    let page = deserialize_page(legacy_json).expect("load migrated page");

    assert_eq!(page.schema_version, CURRENT_SCHEMA_VERSION);
    // Find the rectangle node and assert its kind has the new corners field.
    let rect_node = page.nodes.iter().find(|n| /* by kind type */).unwrap();
    // Deserialize kind into NodeKind and verify it's Rectangle { corners: [Round { x:4, y:4 } × 4] }
}
```

- [ ] **Step 6: Bump `CURRENT_SCHEMA_VERSION`**

In `crates/core/src/validate.rs:47`, change `1` to `2`:

```rust
pub const CURRENT_SCHEMA_VERSION: u32 = 2;
```

- [ ] **Step 7: Run the full core test suite**

Run: `./dev.sh cargo test -p agent-designer-core`
Expected: PASS.

Run: `./dev.sh cargo clippy -p agent-designer-core -- -D warnings`
Expected: no warnings.

- [ ] **Step 8: Commit**

```bash
git add crates/core/src/migrations.rs crates/core/src/serialize.rs crates/core/src/validate.rs crates/core/src/lib.rs
git commit -m "feat(core): workfile v1 to v2 migration for corner shapes (spec-14a)

Converts legacy Rectangle corner_radii arrays to Corner::Round entries
and defaults Frame/Image corners to [Round{0,0} x 4]. Schema version
bumped from 1 to 2. Migration is applied lazily on load; the next save
persists the new shape."
```

---

## Phase 5 — Shared shorthand helper and GraphQL transport

### Task 7: Add shared `corners_input` helper for shorthand expansion

**Context:** Per spec §1.3, both GraphQL and MCP accept three input shapes (uniform shorthand, shape-level superellipse, full per-corner array) and must expand them to `[Corner; 4]` identically. CLAUDE.md §11 "Validation Must Be Symmetric Across All Transports" requires one shared helper.

**Files:**
- Create: `crates/core/src/corners_input.rs` — shared shorthand parsing module.
- Modify: `crates/core/src/lib.rs` — register the module.

- [ ] **Step 1: Write failing tests**

Create `crates/core/src/corners_input.rs`:

```rust
//! Shared corner-shorthand parsing used by GraphQL and MCP transports.
//!
//! Accepts three JSON shapes and expands them to the canonical
//! `[Corner; 4]` before handing off to `SetCorners::validate`.

use serde_json::Value;

use crate::node::{Corner, CornerRadii};
use crate::CoreError;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_uniform_shorthand_scalar_radius() {
        let input = json!({ "shape": "round", "radius": 8 });
        let corners = parse_corners_input(&input).expect("parse");
        for c in corners.iter() {
            assert!(matches!(c, Corner::Round { radii: CornerRadii { x: 8.0, y: 8.0 } }));
        }
    }

    #[test]
    fn test_uniform_shorthand_accepts_bevel() {
        let input = json!({ "shape": "bevel", "radius": 12 });
        let corners = parse_corners_input(&input).expect("parse");
        assert!(corners.iter().all(|c| matches!(c, Corner::Bevel { .. })));
    }

    #[test]
    fn test_uniform_shorthand_rejects_smoothing_on_non_superellipse() {
        let input = json!({ "shape": "round", "radius": 8, "smoothing": 0.5 });
        assert!(parse_corners_input(&input).is_err());
    }

    #[test]
    fn test_shape_level_superellipse_with_scalar_radius() {
        let input = json!({ "shape": "superellipse", "radius": 8, "smoothing": 0.6 });
        let corners = parse_corners_input(&input).expect("parse");
        for c in corners.iter() {
            match c {
                Corner::Superellipse { radii, smoothing } => {
                    assert_eq!(*smoothing, 0.6);
                    assert_eq!(*radii, CornerRadii { x: 8.0, y: 8.0 });
                }
                _ => panic!("expected Superellipse"),
            }
        }
    }

    #[test]
    fn test_shape_level_superellipse_with_per_corner_radii() {
        let input = json!({
            "shape": "superellipse",
            "smoothing": 0.6,
            "radii": [
                { "x": 8, "y": 8 },
                { "x": 12, "y": 12 },
                { "x": 12, "y": 12 },
                { "x": 8, "y": 8 }
            ]
        });
        let corners = parse_corners_input(&input).expect("parse");
        assert!(corners.iter().all(|c| matches!(c, Corner::Superellipse { .. })));
        assert_eq!(corners[1].radii(), CornerRadii { x: 12.0, y: 12.0 });
    }

    #[test]
    fn test_shape_level_superellipse_requires_smoothing() {
        let input = json!({ "shape": "superellipse", "radius": 8 });
        assert!(parse_corners_input(&input).is_err());
    }

    #[test]
    fn test_full_per_corner_array() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "bevel", "radii": { "x": 8, "y": 8 } },
            { "shape": "notch", "radii": { "x": 12, "y": 12 } },
            { "shape": "scoop", "radii": { "x": 16, "y": 16 } }
        ]);
        let corners = parse_corners_input(&input).expect("parse");
        assert!(matches!(corners[0], Corner::Round { .. }));
        assert!(matches!(corners[1], Corner::Bevel { .. }));
        assert!(matches!(corners[2], Corner::Notch { .. }));
        assert!(matches!(corners[3], Corner::Scoop { .. }));
    }

    #[test]
    fn test_full_per_corner_array_rejects_superellipse() {
        // Superellipse must use the shape-level form, not the per-corner array.
        let input = json!([
            { "shape": "superellipse", "radii": { "x": 8, "y": 8 }, "smoothing": 0.5 },
            { "shape": "superellipse", "radii": { "x": 8, "y": 8 }, "smoothing": 0.5 },
            { "shape": "superellipse", "radii": { "x": 8, "y": 8 }, "smoothing": 0.5 },
            { "shape": "superellipse", "radii": { "x": 8, "y": 8 }, "smoothing": 0.5 }
        ]);
        let err = parse_corners_input(&input).expect_err("expected rejection");
        assert!(format!("{err}").contains("use the shape-level form"));
    }

    #[test]
    fn test_full_per_corner_array_requires_exactly_four() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 4 } },
            { "shape": "round", "radii": { "x": 4, "y": 4 } }
        ]);
        assert!(parse_corners_input(&input).is_err());
    }

    #[test]
    fn test_full_per_corner_array_accepts_axis_asymmetric() {
        let input = json!([
            { "shape": "round", "radii": { "x": 4, "y": 8 } },
            { "shape": "round", "radii": { "x": 4, "y": 8 } },
            { "shape": "round", "radii": { "x": 4, "y": 8 } },
            { "shape": "round", "radii": { "x": 4, "y": 8 } }
        ]);
        let corners = parse_corners_input(&input).expect("parse");
        assert_eq!(corners[0].radii(), CornerRadii { x: 4.0, y: 8.0 });
    }

    #[test]
    fn test_rejects_unknown_shape() {
        let input = json!({ "shape": "triangle", "radius": 8 });
        assert!(parse_corners_input(&input).is_err());
    }
}
```

Leave the implementation as a stub: `pub fn parse_corners_input(_input: &Value) -> Result<[Corner; 4], CoreError> { todo!() }`

Register in `crates/core/src/lib.rs`: `pub mod corners_input;`

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev.sh cargo test -p agent-designer-core corners_input::tests`
Expected: all tests FAIL (`todo!()` panic or similar).

- [ ] **Step 3: Implement `parse_corners_input`**

Replace the stub in `crates/core/src/corners_input.rs`:

```rust
/// Parses a GraphQL/MCP corners input blob into a canonical `[Corner; 4]`.
///
/// Accepted shapes:
///
/// 1. **Uniform shorthand** (object): `{ "shape": "<shape>", "radius": N }`
///    where `<shape>` is one of `round | bevel | notch | scoop`.
///    `smoothing` must NOT be present.
///
/// 2. **Shape-level superellipse** (object): `{ "shape": "superellipse", "smoothing": N, ... }`
///    with either `"radius": N` (uniform radius) or
///    `"radii": [{x,y}, {x,y}, {x,y}, {x,y}]` (per-corner radii).
///    Smoothing is required.
///
/// 3. **Full per-corner array**: `[{shape, radii: {x,y}}, ...]` with exactly 4 elements.
///    Superellipse is REJECTED in this form — use shape-level (#2) instead.
///
/// Returns the fully-expanded `[Corner; 4]`. Does NOT run cross-field validation
/// (superellipse uniformity, smoothing parity) — callers must invoke
/// `validate_corners` after construction.
pub fn parse_corners_input(input: &Value) -> Result<[Corner; 4], CoreError> {
    match input {
        Value::Array(arr) => parse_per_corner_array(arr),
        Value::Object(_) => parse_shorthand_or_shape_level(input),
        _ => Err(CoreError::ValidationError(
            "corners input must be an object (shorthand) or array (per-corner)".to_string(),
        )),
    }
}

fn parse_shorthand_or_shape_level(obj: &Value) -> Result<[Corner; 4], CoreError> {
    let shape = obj
        .get("shape")
        .and_then(Value::as_str)
        .ok_or_else(|| CoreError::ValidationError("corners input missing 'shape' field".into()))?;

    if shape == "superellipse" {
        let smoothing = obj
            .get("smoothing")
            .and_then(Value::as_f64)
            .ok_or_else(|| CoreError::ValidationError(
                "superellipse shorthand requires 'smoothing' field".into(),
            ))?;

        let radii_array = if let Some(r) = obj.get("radius") {
            let scalar = r.as_f64().ok_or_else(|| CoreError::ValidationError(
                "'radius' must be a number".into(),
            ))?;
            [CornerRadii { x: scalar, y: scalar }; 4]
        } else if let Some(arr) = obj.get("radii").and_then(Value::as_array) {
            parse_radii_array(arr)?
        } else {
            return Err(CoreError::ValidationError(
                "superellipse shorthand requires either 'radius' or 'radii'".into(),
            ));
        };

        Ok(radii_array.map(|radii| Corner::Superellipse { radii, smoothing }))
    } else {
        // Uniform shorthand — non-superellipse shapes only.
        if obj.get("smoothing").is_some() {
            return Err(CoreError::ValidationError(format!(
                "'smoothing' is only valid on superellipse shape, not '{shape}'"
            )));
        }
        let radius = obj
            .get("radius")
            .and_then(Value::as_f64)
            .ok_or_else(|| CoreError::ValidationError(
                "uniform shorthand requires 'radius' field".into(),
            ))?;
        let radii = CornerRadii { x: radius, y: radius };
        let corner = build_non_superellipse_corner(shape, radii)?;
        Ok([corner; 4])
    }
}

fn parse_per_corner_array(arr: &[Value]) -> Result<[Corner; 4], CoreError> {
    if arr.len() != 4 {
        return Err(CoreError::ValidationError(format!(
            "per-corner array requires exactly 4 elements, got {}",
            arr.len()
        )));
    }
    let mut out: [Corner; 4] = [Corner::Round {
        radii: CornerRadii { x: 0.0, y: 0.0 },
    }; 4];
    for (i, entry) in arr.iter().enumerate() {
        let shape = entry.get("shape").and_then(Value::as_str).ok_or_else(|| {
            CoreError::ValidationError(format!("corners[{i}] missing 'shape' field"))
        })?;
        if shape == "superellipse" {
            return Err(CoreError::ValidationError(
                "superellipse cannot be used in the per-corner array form — \
                 use the shape-level form instead: \
                 { \"shape\": \"superellipse\", \"smoothing\": N, \"radii\": [...] }"
                    .into(),
            ));
        }
        let radii_obj = entry.get("radii").ok_or_else(|| {
            CoreError::ValidationError(format!("corners[{i}] missing 'radii' field"))
        })?;
        let radii = parse_single_radii(radii_obj)?;
        out[i] = build_non_superellipse_corner(shape, radii)?;
    }
    Ok(out)
}

fn parse_radii_array(arr: &[Value]) -> Result<[CornerRadii; 4], CoreError> {
    if arr.len() != 4 {
        return Err(CoreError::ValidationError(format!(
            "'radii' array must have exactly 4 entries, got {}",
            arr.len()
        )));
    }
    Ok([
        parse_single_radii(&arr[0])?,
        parse_single_radii(&arr[1])?,
        parse_single_radii(&arr[2])?,
        parse_single_radii(&arr[3])?,
    ])
}

fn parse_single_radii(v: &Value) -> Result<CornerRadii, CoreError> {
    let x = v
        .get("x")
        .and_then(Value::as_f64)
        .ok_or_else(|| CoreError::ValidationError("radii entry missing 'x'".into()))?;
    let y = v
        .get("y")
        .and_then(Value::as_f64)
        .ok_or_else(|| CoreError::ValidationError("radii entry missing 'y'".into()))?;
    Ok(CornerRadii { x, y })
}

fn build_non_superellipse_corner(shape: &str, radii: CornerRadii) -> Result<Corner, CoreError> {
    match shape {
        "round" => Ok(Corner::Round { radii }),
        "bevel" => Ok(Corner::Bevel { radii }),
        "notch" => Ok(Corner::Notch { radii }),
        "scoop" => Ok(Corner::Scoop { radii }),
        "superellipse" => Err(CoreError::ValidationError(
            "superellipse must be constructed via the shape-level form".into(),
        )),
        other => Err(CoreError::ValidationError(format!(
            "unknown corner shape '{other}' — valid shapes are round, bevel, notch, scoop, superellipse"
        ))),
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev.sh cargo test -p agent-designer-core corners_input::tests`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/corners_input.rs crates/core/src/lib.rs
git commit -m "feat(core): shared corners_input helper for shorthand expansion (spec-14a)"
```

---

### Task 8: Update GraphQL `SetField` dispatcher for corners

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs:328-375` (the `"kind"` path match arm)

- [ ] **Step 1: Write failing test**

In `crates/server/src/graphql/mutation.rs` (or the adjacent `#[cfg(test)] mod tests` module — search for existing `set_field` tests in this file):

```rust
#[tokio::test]
async fn test_set_field_kind_accepts_new_corners_shape() {
    let state = /* build a SharedState with a rectangle node whose UUID is `rect_uuid` */;
    let input = SetFieldInput {
        node_uuid: rect_uuid.to_string(),
        path: "kind".into(),
        value: serde_json::json!({
            "type": "rectangle",
            "corners": [
                { "type": "round", "radii": { "x": 4.0, "y": 4.0 } },
                { "type": "bevel", "radii": { "x": 8.0, "y": 8.0 } },
                { "type": "notch", "radii": { "x": 12.0, "y": 12.0 } },
                { "type": "scoop", "radii": { "x": 16.0, "y": 16.0 } }
            ]
        }),
    };
    // Invoke the SetField resolver (follow existing test patterns for how
    // resolvers are invoked in this crate — do not invent a pattern).
    // Assert: resolver returns Ok, document state reflects the new corners,
    // broadcast carries op_type="set_field", path="kind", full kind value.
}

#[tokio::test]
async fn test_set_field_kind_rejects_mixed_superellipse_corners() {
    // Submit a kind value whose `corners` array has one Superellipse and
    // three Round entries. Resolver must return Err pointing to uniformity.
}
```

Reuse the existing `set_field` resolver test setup — follow the exact construction patterns for `SharedState`, for extracting the broadcast receiver, and for invoking the resolver. Do not invent scaffolding.

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev.sh cargo test -p agent-designer-server test_set_field_kind_accepts_new_corners_shape`
Expected: FAIL.

- [ ] **Step 3: Replace the old `"kind"` dispatcher with the new one**

Find lines 328-375 in `crates/server/src/graphql/mutation.rs` — the `"kind" =>` match arm that currently parses `corner_radii` from the value and constructs `SetCornerRadii`. Replace it with:

```rust
"kind" => {
    // Value must contain a full kind object: { "type": ..., "corners": [...], ...other fields }
    let kind_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| async_graphql::Error::new("kind value must include 'type' field"))?;
    match kind_type {
        "rectangle" | "frame" | "image" => {
            let corners_value = value.get("corners").ok_or_else(|| {
                async_graphql::Error::new(format!(
                    "{kind_type} kind value must include 'corners' array"
                ))
            })?;
            let new_corners = agent_designer_core::corners_input::parse_corners_input(corners_value)
                .map_err(|e| async_graphql::Error::new(format!("{e}")))?;
            // validate_corners will run again inside SetCorners::validate;
            // no duplicate call needed here.
            let parsed_uuid = sf.node_uuid.parse::<Uuid>()
                .map_err(|e| async_graphql::Error::new(format!("invalid uuid: {e}")))?;
            Ok(ParsedOp {
                builder: Box::new(move |doc| {
                    let node_id = doc.arena.id_by_uuid(&parsed_uuid)
                        .ok_or_else(|| async_graphql::Error::new("node not found"))?;
                    Ok(Box::new(SetCorners { node_id, new_corners }) as Box<dyn FieldOperation>)
                }),
                broadcast: OperationPayload {
                    id: uuid::Uuid::new_v4().to_string(),
                    node_uuid: sf.node_uuid.clone(),
                    op_type: "set_field".to_string(),
                    path: sf.path.clone(),
                    value: Some(value.clone()),
                },
            })
        }
        other => Err(async_graphql::Error::new(format!(
            "kind type '{other}' is not supported by SetField on path 'kind'"
        ))),
    }
}
```

Update the `use` statements at the top of the file: remove `SetCornerRadii`, add `SetCorners`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev.sh cargo test -p agent-designer-server test_set_field_kind`
Expected: PASS.

Run full server suite: `./dev.sh cargo test -p agent-designer-server`
Expected: PASS. If any test still references `corner_radii` on a rectangle kind, update it to pass the new `corners` shape.

Run clippy: `./dev.sh cargo clippy -p agent-designer-server -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/
git commit -m "feat(server): GraphQL SetField 'kind' path accepts corners array (spec-14a)

The 'kind' dispatcher now delegates shorthand parsing to
agent_designer_core::corners_input::parse_corners_input and constructs
SetCorners. Rectangle, Frame, and Image all accepted."
```

---

## Phase 6 — MCP transport

### Task 9: Replace `set_corner_radii` MCP tool with `set_corners`

**Files:**
- Modify: `crates/mcp/src/types.rs:363-371` — replace `SetCornerRadiiInput` with `SetCornersInput`
- Modify: `crates/mcp/src/server.rs:344-357` — replace tool definition
- Modify: `crates/mcp/src/tools/nodes.rs:960-1015` — replace `set_corner_radii_impl` with `set_corners_impl`
- Test: `crates/mcp/src/tools/nodes.rs` (add tests near existing corner radii tests)

**Context — why this task replaces rather than extends the tool:** The existing `set_corner_radii` tool accepts a flat `[f64; 4]` array and broadcasts `path: "kind.corner_radii"`. Spec 14 removes both the field and that broadcast path (the GraphQL transport already broadcasts `path: "kind"` with the full kind object, and Spec 14 standardizes on that). Keeping the old tool alive would leave a transport that produces broadcasts no frontend handler accepts. Per the "Migrations Must Remove All Superseded Code" rule in CLAUDE.md §11, the replacement is mandatory in this PR.

- [ ] **Step 1: Write the failing tests**

Add the following tests in `crates/mcp/src/tools/nodes.rs` inside the `#[cfg(test)] mod tests` block:

```rust
#[test]
fn test_set_corners_uniform_shorthand() {
    let state = AppState::new();
    let page_uuid = create_page_impl(&state, Some("p".into()), None)
        .unwrap()
        .page_uuid
        .unwrap();
    let rect_uuid = create_rectangle(&state, &page_uuid);

    // Uniform: single number becomes 4 round corners with matching radii.
    let input = serde_json::json!({ "uuid": rect_uuid, "corners": 12.0 });
    let parsed: crate::types::SetCornersInput = serde_json::from_value(input).unwrap();
    let result = set_corners_impl(&state, &parsed.uuid, &parsed.corners).unwrap();
    assert!(result.success);

    let doc = state.document_read();
    let node_id = doc.arena.id_by_uuid(&rect_uuid.parse().unwrap()).unwrap();
    let node = doc.arena.get(node_id).unwrap();
    let NodeKind::Rectangle { corners } = &node.kind else {
        panic!("expected rectangle");
    };
    for corner in corners {
        let Corner::Round { radii } = corner else {
            panic!("expected round corner, got {corner:?}");
        };
        assert_eq!(radii.x, 12.0);
        assert_eq!(radii.y, 12.0);
    }
}

#[test]
fn test_set_corners_superellipse_shorthand() {
    let state = AppState::new();
    let page_uuid = create_page_impl(&state, Some("p".into()), None)
        .unwrap()
        .page_uuid
        .unwrap();
    let rect_uuid = create_rectangle(&state, &page_uuid);

    // Shape-level superellipse: type + radius + smoothing expands to 4 matching corners.
    let input = serde_json::json!({
        "uuid": rect_uuid,
        "corners": { "type": "superellipse", "radius": 20.0, "smoothing": 0.6 }
    });
    let parsed: crate::types::SetCornersInput = serde_json::from_value(input).unwrap();
    set_corners_impl(&state, &parsed.uuid, &parsed.corners).unwrap();

    let doc = state.document_read();
    let node_id = doc.arena.id_by_uuid(&rect_uuid.parse().unwrap()).unwrap();
    let NodeKind::Rectangle { corners } = &doc.arena.get(node_id).unwrap().kind else {
        panic!("expected rectangle");
    };
    for corner in corners {
        let Corner::Superellipse { radii, smoothing } = corner else {
            panic!("expected superellipse, got {corner:?}");
        };
        assert_eq!(radii.x, 20.0);
        assert_eq!(radii.y, 20.0);
        assert_eq!(*smoothing, 0.6);
    }
}

#[test]
fn test_set_corners_per_corner_array_rejects_superellipse() {
    let state = AppState::new();
    let page_uuid = create_page_impl(&state, Some("p".into()), None)
        .unwrap()
        .page_uuid
        .unwrap();
    let rect_uuid = create_rectangle(&state, &page_uuid);

    // Per-corner array with one superellipse must be rejected at the parser boundary.
    let input = serde_json::json!({
        "uuid": rect_uuid,
        "corners": [
            { "type": "superellipse", "radii": { "x": 8.0, "y": 8.0 }, "smoothing": 0.5 },
            { "type": "round", "radii": { "x": 8.0, "y": 8.0 } },
            { "type": "round", "radii": { "x": 8.0, "y": 8.0 } },
            { "type": "round", "radii": { "x": 8.0, "y": 8.0 } }
        ]
    });
    let parsed: crate::types::SetCornersInput = serde_json::from_value(input).unwrap();
    let err = set_corners_impl(&state, &parsed.uuid, &parsed.corners).unwrap_err();
    match err {
        McpToolError::InvalidInput(msg) => {
            assert!(
                msg.contains("superellipse"),
                "expected superellipse rejection message, got: {msg}"
            );
        }
        other => panic!("expected InvalidInput, got {other:?}"),
    }
}

#[test]
fn test_set_corners_invalid_uuid() {
    let state = AppState::new();
    let err = set_corners_impl(&state, "not-a-uuid", &serde_json::json!(4.0)).unwrap_err();
    assert!(matches!(err, McpToolError::InvalidUuid(_)));
}

#[test]
fn test_set_corners_node_not_found() {
    let state = AppState::new();
    let missing = Uuid::new_v4().to_string();
    let err = set_corners_impl(&state, &missing, &serde_json::json!(4.0)).unwrap_err();
    assert!(matches!(err, McpToolError::NodeNotFound(_)));
}
```

(`create_rectangle` test helper is assumed to exist in the same test module — if not, add a small helper that calls `create_node_impl` with `NodeKind::Rectangle { corners: [default; 4] }`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev.sh cargo test -p agent-designer-mcp test_set_corners`
Expected: FAIL — `SetCornersInput` and `set_corners_impl` do not exist yet.

- [ ] **Step 3: Replace the input type**

In `crates/mcp/src/types.rs`, delete the `SetCornerRadiiInput` struct (lines 363-371) and replace with:

```rust
/// Input for setting a node's corner shapes.
///
/// The `corners` value accepts three shapes:
///
/// 1. **Uniform shorthand** — a single non-negative finite number applied to all four corners
///    as `Round` with matching radii: `{ "uuid": "...", "corners": 12.0 }`.
/// 2. **Shape-level superellipse** — an object describing a squircle applied to the full shape:
///    `{ "uuid": "...", "corners": { "type": "superellipse", "radius": 16.0, "smoothing": 0.6 } }`.
///    The `smoothing` field is optional and defaults to `0.6`. Superellipse is shape-level only
///    because squircle curvature blends along edges; mixing it per-corner would produce visible kinks.
/// 3. **Per-corner array** — exactly four corner objects in order
///    `[top-left, top-right, bottom-right, bottom-left]`. Each corner is
///    `{ "type": "round" | "bevel" | "notch" | "scoop", "radii": { "x": <n>, "y": <n> } }`.
///    The per-corner array does NOT accept `"superellipse"` — use shorthand shape 2 instead.
///
/// All numeric values must be finite and non-negative; `smoothing` must lie in `[0.0, 1.0]`.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetCornersInput {
    /// UUID of the node to modify (rectangle, frame, or image).
    pub uuid: String,
    /// The corner specification. See struct-level doc for accepted shapes.
    pub corners: serde_json::Value,
}
```

- [ ] **Step 4: Replace the tool entry in `server.rs`**

In `crates/mcp/src/server.rs`, delete the `set_corner_radii` method (lines 344-357) and replace with:

```rust
/// Sets a node's corner shapes (rectangle, frame, or image).
#[tool(
    name = "set_corners",
    description = "Set corner shapes on a rectangle, frame, or image node. \
                    The 'corners' field accepts three forms: \
                    (1) a single number for uniform round corners (e.g. 12.0); \
                    (2) a shape-level superellipse object \
                    { type: 'superellipse', radius: n, smoothing: 0.0..1.0 }; \
                    (3) an array of exactly 4 corner objects in order \
                    [top-left, top-right, bottom-right, bottom-left], each \
                    { type: 'round'|'bevel'|'notch'|'scoop', radii: { x: n, y: n } }. \
                    The per-corner array does NOT accept 'superellipse' — use form 2."
)]
fn set_corners(
    &self,
    Parameters(input): Parameters<crate::types::SetCornersInput>,
) -> Result<Json<crate::types::MutationResult>, rmcp::ErrorData> {
    crate::tools::nodes::set_corners_impl(&self.state, &input.uuid, &input.corners)
        .map(Json)
        .map_err(|e| e.to_mcp_error())
}
```

- [ ] **Step 5: Replace the tool implementation in `tools/nodes.rs`**

In `crates/mcp/src/tools/nodes.rs`, delete `set_corner_radii_impl` (lines 960-1015) and replace with:

```rust
/// Sets a node's corner shapes.
///
/// The `corners_value` JSON is parsed via `corners_input::parse_corners_input` which expands
/// the three accepted input shapes (uniform scalar, shape-level superellipse, per-corner array)
/// into `[Corner; 4]`. The per-corner array form rejects `Corner::Superellipse` variants —
/// superellipse must arrive through the shape-level shorthand.
///
/// Errors:
///
/// - `McpToolError::InvalidInput` if the shorthand is malformed, any numeric is non-finite or
///   negative, smoothing is out of `[0.0, 1.0]`, or a per-corner array contains a superellipse.
/// - `McpToolError::InvalidUuid` if `uuid_str` is not a valid UUID.
/// - `McpToolError::NodeNotFound` if no node with the given UUID exists.
/// - `McpToolError::CoreError` on engine-level failures (e.g. node is not a corner-bearing kind).
pub fn set_corners_impl(
    state: &AppState,
    uuid_str: &str,
    corners_value: &serde_json::Value,
) -> Result<MutationResult, McpToolError> {
    // Parse shorthand into [Corner; 4] BEFORE acquiring the lock.
    let new_corners = agent_designer_core::corners_input::parse_corners_input(corners_value)
        .map_err(|e| McpToolError::InvalidInput(e.to_string()))?;

    let node_uuid: Uuid = uuid_str
        .parse()
        .map_err(|_| McpToolError::InvalidUuid(uuid_str.to_string()))?;

    // Acquire lock, verify preconditions, apply, then build broadcast payload from post-mutation state.
    let kind_json = {
        let mut doc = acquire_document_lock(state);

        let node_id = doc
            .arena
            .id_by_uuid(&node_uuid)
            .ok_or_else(|| McpToolError::NodeNotFound(uuid_str.to_string()))?;

        let cmd = SetCorners { node_id, new_corners };
        cmd.validate(&doc)?;
        cmd.apply(&mut doc)?;

        // Serialize the post-mutation kind object for the broadcast payload.
        let node = doc.arena.get(node_id).ok_or_else(|| {
            McpToolError::CoreError("node disappeared after apply".into())
        })?;
        serde_json::to_value(&node.kind).map_err(|e| {
            McpToolError::CoreError(format!("failed to serialize kind for broadcast: {e}"))
        })?
    };

    super::broadcast::broadcast_and_persist(
        state,
        MutationEventKind::NodeUpdated,
        &node_uuid.to_string(),
        "set_field",
        "kind",
        Some(kind_json),
    );

    Ok(MutationResult {
        success: true,
        message: format!("Corners set on node {uuid_str}"),
    })
}
```

Update `use` statements at the top of `crates/mcp/src/tools/nodes.rs`:
- Remove: `use agent_designer_core::commands::SetCornerRadii;` (if present)
- Add: `use agent_designer_core::commands::SetCorners;`
- Ensure `NodeKind` and `Corner` are in scope for the test module (they already should be via `use agent_designer_core::*` or similar — add explicit imports if not).

- [ ] **Step 6: Run the MCP tests to verify they pass**

Run: `./dev.sh cargo test -p agent-designer-mcp test_set_corners`
Expected: all five tests PASS.

Run the full MCP suite: `./dev.sh cargo test -p agent-designer-mcp`
Expected: PASS. Any existing test that references `set_corner_radii_impl` or `SetCornerRadiiInput` must be migrated to `set_corners_impl` / `SetCornersInput` in this step — grep for both identifiers and update call sites.

Run clippy: `./dev.sh cargo clippy -p agent-designer-mcp -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Verify no dead references remain**

Run: `./dev.sh cargo build --workspace`
Expected: clean build.

Grep for superseded identifiers across the workspace:

```bash
rg -n "set_corner_radii|SetCornerRadii(Input)?|kind\.corner_radii" crates/
```

Expected: zero matches. Any remaining match is a migration leftover that must be fixed before commit.

- [ ] **Step 8: Commit**

```bash
git add crates/mcp/src/
git commit -m "feat(mcp): replace set_corner_radii with set_corners tool (spec-14a)

Accepts three input forms: uniform scalar, shape-level superellipse
object, and per-corner array (which rejects superellipse). Shares the
corners_input shorthand parser with GraphQL. Broadcasts path='kind'
with the full kind object, matching the GraphQL transport and the
frontend apply-remote handler."
```

---

## Phase 7 — Frontend types, store, apply-remote handler

### Task 10: Update frontend `NodeKind*` types to carry `corners`

**Files:**
- Modify: `frontend/src/types/document.ts:584-615` — replace `corner_radii` with `corners` on rectangle/frame/image
- Test: `frontend/src/types/__tests__/document.test.ts` (create if it doesn't exist) — a tiny compile-time assertion suite is sufficient.

**Context:** The Rust types use a `Corner` enum discriminated by a `type` field. In TypeScript we mirror that as a discriminated union with literal `type` values. Frame and Image gain corners here (previously they had none on the frontend type) because Rust now carries them too.

- [ ] **Step 1: Write the failing compile-time test**

Create `frontend/src/types/__tests__/document-corners.test-d.ts` (or add to the existing test file):

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Corner,
  CornerRadii,
  NodeKindRectangle,
  NodeKindFrame,
  NodeKindImage,
} from "../document";

describe("Corner types", () => {
  it("CornerRadii has x and y", () => {
    expectTypeOf<CornerRadii>().toHaveProperty("x").toEqualTypeOf<number>();
    expectTypeOf<CornerRadii>().toHaveProperty("y").toEqualTypeOf<number>();
  });

  it("Corner is a discriminated union with 5 variants", () => {
    type Types = Corner["type"];
    expectTypeOf<Types>().toEqualTypeOf<
      "round" | "bevel" | "notch" | "scoop" | "superellipse"
    >();
  });

  it("Rectangle/Frame/Image carry corners: readonly Corner[] of length 4", () => {
    expectTypeOf<NodeKindRectangle["corners"]>().toEqualTypeOf<
      readonly [Corner, Corner, Corner, Corner]
    >();
    expectTypeOf<NodeKindFrame["corners"]>().toEqualTypeOf<
      readonly [Corner, Corner, Corner, Corner]
    >();
    expectTypeOf<NodeKindImage["corners"]>().toEqualTypeOf<
      readonly [Corner, Corner, Corner, Corner]
    >();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/types/__tests__/document-corners.test-d.ts`
Expected: FAIL — `CornerRadii` and `Corner` do not exist yet; `NodeKindRectangle.corners` does not exist (still `corner_radii`).

- [ ] **Step 3: Replace the types**

In `frontend/src/types/document.ts`, add above the `NodeKind*` block (before line 582):

```ts
// ── Corner shape types ───────────────────────────────────────────────

export interface CornerRadii {
  readonly x: number;
  readonly y: number;
}

export interface CornerRound {
  readonly type: "round";
  readonly radii: CornerRadii;
}

export interface CornerBevel {
  readonly type: "bevel";
  readonly radii: CornerRadii;
}

export interface CornerNotch {
  readonly type: "notch";
  readonly radii: CornerRadii;
}

export interface CornerScoop {
  readonly type: "scoop";
  readonly radii: CornerRadii;
}

export interface CornerSuperellipse {
  readonly type: "superellipse";
  readonly radii: CornerRadii;
  readonly smoothing: number;
}

export type Corner =
  | CornerRound
  | CornerBevel
  | CornerNotch
  | CornerScoop
  | CornerSuperellipse;

export type Corners = readonly [Corner, Corner, Corner, Corner];
```

Replace `NodeKindRectangle`, `NodeKindFrame`, and `NodeKindImage`:

```ts
export interface NodeKindFrame {
  readonly type: "frame";
  readonly layout: LayoutMode | null;
  readonly corners: Corners;
}

export interface NodeKindRectangle {
  readonly type: "rectangle";
  readonly corners: Corners;
}

export interface NodeKindImage {
  readonly type: "image";
  readonly asset_ref: string;
  readonly corners: Corners;
}
```

- [ ] **Step 4: Run to verify the type test passes and find all broken call sites**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/types/__tests__/document-corners.test-d.ts`
Expected: PASS.

Run the full frontend type-check: `./dev.sh pnpm --prefix frontend exec tsc --noEmit`
Expected: FAIL with compile errors at every site that reads `.corner_radii` or constructs a rectangle/frame/image without `corners`. Capture the error list — these are handled in Tasks 11 and 13.

- [ ] **Step 5: Commit the type changes only**

```bash
git add frontend/src/types/document.ts frontend/src/types/__tests__/document-corners.test-d.ts
git commit -m "feat(frontend): add Corner/CornerRadii types, replace corner_radii with corners (spec-14a)

Rectangle/Frame/Image now carry a readonly tuple of 4 Corner objects,
matching the Rust discriminated union. This commit intentionally breaks
downstream call sites; subsequent commits fix the store and UI."
```

---

### Task 11: Update `setCornerRadii` store function to `setCorners` (shape-level shorthand)

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx:944-967`
- Test: `frontend/src/store/__tests__/document-store-corners.test.ts` (new file)

**Context:** The store function is the frontend's boundary for the optimistic update contract (CLAUDE.md rule "User-Initiated Mutations Must Use Optimistic Updates"). The new function accepts the same three input shapes as the MCP tool but expands shorthand client-side so the optimistic store write uses the final `Corners` tuple. This keeps `apply-remote.ts` simple — it always receives a full `kind` object.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/store/__tests__/document-store-corners.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { createDocumentStore } from "../document-store-solid";
import type { Corner, Corners } from "../../types/document";

describe("setCorners", () => {
  let store: ReturnType<typeof createDocumentStore>;
  let rectUuid: string;

  beforeEach(() => {
    createRoot(() => {
      store = createDocumentStore();
      // Helper from test fixtures: create a page + rectangle, return rect uuid.
      rectUuid = seedRectangle(store);
    });
  });

  it("expands uniform scalar to 4 round corners", () => {
    store.setCorners(rectUuid, 12);
    const node = store.state.nodes[rectUuid];
    expect(node?.kind.type).toBe("rectangle");
    if (node?.kind.type !== "rectangle") return;
    for (const corner of node.kind.corners) {
      expect(corner.type).toBe("round");
      expect(corner.radii.x).toBe(12);
      expect(corner.radii.y).toBe(12);
    }
  });

  it("expands shape-level superellipse object", () => {
    store.setCorners(rectUuid, { type: "superellipse", radius: 16, smoothing: 0.6 });
    const node = store.state.nodes[rectUuid];
    if (node?.kind.type !== "rectangle") return;
    for (const corner of node.kind.corners) {
      expect(corner.type).toBe("superellipse");
      if (corner.type !== "superellipse") return;
      expect(corner.radii.x).toBe(16);
      expect(corner.smoothing).toBe(0.6);
    }
  });

  it("accepts a per-corner array of 4 corners", () => {
    const corners: Corners = [
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "bevel", radii: { x: 4, y: 4 } },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "scoop", radii: { x: 6, y: 6 } },
    ];
    store.setCorners(rectUuid, corners);
    const node = store.state.nodes[rectUuid];
    if (node?.kind.type !== "rectangle") return;
    expect(node.kind.corners[1].type).toBe("bevel");
    expect(node.kind.corners[3].type).toBe("scoop");
  });

  it("rejects per-corner array containing a superellipse", () => {
    const corners = [
      { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
    ] as unknown as Corners;
    const before = (store.state.nodes[rectUuid]?.kind as { corners: Corners }).corners;
    store.setCorners(rectUuid, corners);
    // Store must have rejected the input — no mutation.
    const after = (store.state.nodes[rectUuid]?.kind as { corners: Corners }).corners;
    expect(after).toEqual(before);
  });

  it("rejects non-finite numeric input", () => {
    const before = (store.state.nodes[rectUuid]?.kind as { corners: Corners }).corners;
    store.setCorners(rectUuid, Number.NaN);
    const after = (store.state.nodes[rectUuid]?.kind as { corners: Corners }).corners;
    expect(after).toEqual(before);
  });

  it("no-ops on non-corner-bearing kinds", () => {
    const textUuid = seedText(store);
    store.setCorners(textUuid, 12);
    expect(store.state.nodes[textUuid]?.kind.type).toBe("text");
  });
});

// Test fixture helpers (add to a shared test-helpers module if one exists):
function seedRectangle(/* store */): string { /* ... */ return ""; }
function seedText(/* store */): string { /* ... */ return ""; }
```

(If `seedRectangle` / `seedText` helpers don't already exist in a `__tests__/helpers.ts`, add them. They should call the store's `createNode` with the appropriate kind and return the new uuid.)

- [ ] **Step 2: Run to verify fail**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/store/__tests__/document-store-corners.test.ts`
Expected: FAIL — `setCorners` does not exist; `setCornerRadii` still references the deleted `corner_radii` field.

- [ ] **Step 3: Add the `parseCornersInput` helper (frontend mirror of Rust helper)**

Create `frontend/src/store/corners-input.ts`:

```ts
import type { Corner, Corners } from "../types/document";

/** Input shapes accepted by setCorners — see store doc. */
export type CornersInput =
  | number
  | { type: "superellipse"; radius: number; smoothing?: number }
  | Corners;

const DEFAULT_SMOOTHING = 0.6;

/** Expands shorthand into a [Corner; 4] tuple, or returns null on invalid input. */
export function parseCornersInput(input: CornersInput): Corners | null {
  // Form 1: uniform scalar.
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    const corner: Corner = { type: "round", radii: { x: input, y: input } };
    return [corner, corner, corner, corner];
  }

  // Form 2: shape-level superellipse object.
  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as { type?: string }).type === "superellipse"
  ) {
    const { radius, smoothing } = input as {
      radius: number;
      smoothing?: number;
    };
    const smooth = smoothing ?? DEFAULT_SMOOTHING;
    if (!Number.isFinite(radius) || radius < 0) return null;
    if (!Number.isFinite(smooth) || smooth < 0 || smooth > 1) return null;
    const corner: Corner = {
      type: "superellipse",
      radii: { x: radius, y: radius },
      smoothing: smooth,
    };
    return [corner, corner, corner, corner];
  }

  // Form 3: per-corner array.
  if (Array.isArray(input) && input.length === 4) {
    for (const c of input) {
      if (c.type === "superellipse") return null;
      if (!Number.isFinite(c.radii.x) || c.radii.x < 0) return null;
      if (!Number.isFinite(c.radii.y) || c.radii.y < 0) return null;
    }
    return input as Corners;
  }

  return null;
}
```

- [ ] **Step 4: Replace `setCornerRadii` with `setCorners`**

In `frontend/src/store/document-store-solid.tsx`, delete the `setCornerRadii` function (lines 944-967) and replace with:

```tsx
function setCorners(uuid: string, input: CornersInput): void {
  const newCorners = parseCornersInput(input);
  if (newCorners === null) return;

  // Early return if node is not a corner-bearing kind — before snapshot.
  const node = state.nodes[uuid];
  if (!node) return;
  const kindType = node.kind.type;
  if (kindType !== "rectangle" && kindType !== "frame" && kindType !== "image") {
    return;
  }

  // JSON clone: Solid proxy not structuredClone-safe
  const previousKind = deepClone(node.kind);
  const newKind = { ...previousKind, corners: newCorners };

  interceptor.set(uuid, "kind", newKind);
  // RF-026: Queue server op — sent when interceptor commits (coalesced)
  pendingServerOps.push({
    setField: {
      nodeUuid: uuid,
      path: "kind",
      value: JSON.stringify(newKind),
    },
  });
}
```

Add the imports at the top of the file:

```tsx
import { parseCornersInput, type CornersInput } from "./corners-input";
```

Expose `setCorners` in the store's returned API object (where `setCornerRadii` was exposed). Remove the old `setCornerRadii` entry.

- [ ] **Step 5: Run tests to verify they pass**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/store/__tests__/document-store-corners.test.ts`
Expected: PASS.

Run: `./dev.sh pnpm --prefix frontend exec tsc --noEmit`
Expected: still some errors (unrelated call sites to be fixed in Task 13) but no errors in `document-store-solid.tsx` itself.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/corners-input.ts frontend/src/store/document-store-solid.tsx frontend/src/store/__tests__/document-store-corners.test.ts
git commit -m "feat(frontend): setCorners store function with shape-level shorthand (spec-14a)

Replaces setCornerRadii. Accepts a uniform scalar, shape-level
superellipse object, or per-corner array. Matches the server-side
corners_input parser; per-corner arrays rejecting superellipse variants."
```

---

### Task 12: Update `apply-remote.ts` handler for `path: "kind"` (full kind replacement)

**Files:**
- Modify: `frontend/src/operations/apply-remote.ts:250-263` — delete `kind.corner_radii` case
- Modify: same file — extend the existing `"kind"` case (if present) or add one — to accept replacement for rectangle/frame/image and validate the `corners` field
- Test: `frontend/src/operations/__tests__/apply-remote-corners.test.ts` (new file)

**Context:** MCP and GraphQL both now broadcast `path: "kind"` with the full kind object (Phase 5 Task 8, Phase 6 Task 9). The handler must replace the node's kind from the broadcast, after validating the `type` discriminant matches the local node's type and that `corners` is a length-4 array of valid Corner objects. This is a defense-in-depth guard — the server already validated — but the CLAUDE.md rule "Defensive Message Parsing" requires shape validation before type-casting.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/operations/__tests__/apply-remote-corners.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { applyRemoteOperation } from "../apply-remote";
import { createDocumentStore } from "../../store/document-store-solid";
import type { Corners } from "../../types/document";

describe("applyRemoteOperation path='kind' for corners", () => {
  let store: ReturnType<typeof createDocumentStore>;
  let rectUuid: string;

  beforeEach(() => {
    createRoot(() => {
      store = createDocumentStore();
      rectUuid = seedRectangle(store);
    });
  });

  it("applies full kind replacement with new corners", () => {
    const newCorners: Corners = [
      { type: "bevel", radii: { x: 10, y: 10 } },
      { type: "bevel", radii: { x: 10, y: 10 } },
      { type: "bevel", radii: { x: 10, y: 10 } },
      { type: "bevel", radii: { x: 10, y: 10 } },
    ];
    applyRemoteOperation(store, {
      op_type: "set_field",
      node_uuid: rectUuid,
      path: "kind",
      value: { type: "rectangle", corners: newCorners },
    });
    const node = store.state.nodes[rectUuid];
    if (node?.kind.type !== "rectangle") return;
    expect(node.kind.corners[0].type).toBe("bevel");
  });

  it("rejects broadcast when local type differs from payload type", () => {
    const before = store.state.nodes[rectUuid]?.kind;
    applyRemoteOperation(store, {
      op_type: "set_field",
      node_uuid: rectUuid,
      path: "kind",
      value: { type: "frame", corners: [/* 4 corners */] },
    });
    expect(store.state.nodes[rectUuid]?.kind).toEqual(before);
  });

  it("rejects broadcast with non-array corners", () => {
    const before = store.state.nodes[rectUuid]?.kind;
    applyRemoteOperation(store, {
      op_type: "set_field",
      node_uuid: rectUuid,
      path: "kind",
      value: { type: "rectangle", corners: "not an array" },
    });
    expect(store.state.nodes[rectUuid]?.kind).toEqual(before);
  });

  it("rejects broadcast with corners array of wrong length", () => {
    const before = store.state.nodes[rectUuid]?.kind;
    applyRemoteOperation(store, {
      op_type: "set_field",
      node_uuid: rectUuid,
      path: "kind",
      value: {
        type: "rectangle",
        corners: [{ type: "round", radii: { x: 4, y: 4 } }],
      },
    });
    expect(store.state.nodes[rectUuid]?.kind).toEqual(before);
  });
});

function seedRectangle(/* store */): string { /* ... */ return ""; }
```

- [ ] **Step 2: Run to verify fail**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/operations/__tests__/apply-remote-corners.test.ts`
Expected: FAIL — either the `kind.corner_radii` case still runs and no-ops the `kind` broadcast, or there is no `kind` case at all.

- [ ] **Step 3: Delete the `kind.corner_radii` case**

In `frontend/src/operations/apply-remote.ts`, delete lines 250-263 (the entire `case "kind.corner_radii":` block).

- [ ] **Step 4: Add a `kind` case with validation**

Add the following case to the switch statement in `apply-remote.ts`, above the `default:` arm:

```ts
case "kind": {
  // Defensive shape validation — CLAUDE.md "Defensive Message Parsing".
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return;
  }
  const payload = value as { type?: unknown; corners?: unknown };
  if (payload.type !== node.kind.type) {
    // Type discriminant mismatch — reject to prevent corrupting local state.
    return;
  }
  // For corner-bearing kinds, validate corners shape.
  if (
    payload.type === "rectangle" ||
    payload.type === "frame" ||
    payload.type === "image"
  ) {
    if (!Array.isArray(payload.corners) || payload.corners.length !== 4) {
      return;
    }
    const validTypes = new Set(["round", "bevel", "notch", "scoop", "superellipse"]);
    for (const c of payload.corners as Array<{ type?: unknown; radii?: unknown }>) {
      if (typeof c !== "object" || c === null) return;
      if (typeof c.type !== "string" || !validTypes.has(c.type)) return;
      const radii = c.radii as { x?: unknown; y?: unknown } | undefined;
      if (
        typeof radii !== "object" ||
        radii === null ||
        typeof radii.x !== "number" ||
        typeof radii.y !== "number" ||
        !Number.isFinite(radii.x) ||
        !Number.isFinite(radii.y)
      ) {
        return;
      }
    }
  }
  setState(
    produce((s) => {
      const n = s.nodes[nodeUuid];
      if (!n || n.kind.type !== payload.type) return;
      // produce() provides mutable access — DeepMutable strips readonly
      (s.nodes[nodeUuid] as DeepMutable<typeof n>).kind =
        payload as DeepMutable<typeof n.kind>;
    }),
  );
  break;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/operations/__tests__/apply-remote-corners.test.ts`
Expected: all four tests PASS.

Run: `./dev.sh pnpm --prefix frontend exec vitest run`
Expected: PASS (excepting tests covered by Task 13's UI changes). Any remaining failure must be investigated before the next step.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/operations/
git commit -m "feat(frontend): apply-remote handler for path='kind' with defensive validation (spec-14a)

Replaces kind.corner_radii handler. Accepts the full kind object from
SetCorners broadcasts (MCP + GraphQL). Rejects broadcasts where the
discriminant type differs from the local node, where corners is not an
array of length 4, or where any corner/radii shape is malformed."
```

---

## Phase 8 — Minimal temporary UI and end-to-end integration test

### Task 13: Swap the Properties panel "Corner Radius" row to drive `setCorners`

**Files:**
- Modify: `frontend/src/panels/schemas/design-schema.ts:58-67`
- Modify: any call site still reading `kind.corner_radii` (from the type-check error list gathered in Task 10 Step 4) — update to read `kind.corners[i].radii.x`

**Context:** Spec 14's full UI (corner editor with per-corner popovers and shape picker) belongs to Plan 14c. For Plan 14a we only need a minimal placeholder so the existing four-number row continues to work through the data layer — users can still edit uniform round-corner radii after this plan lands. The placeholder reads `radii.x` from each corner and writes back via `setCorners` with a uniform scalar when all four corners are equal, or a per-corner array otherwise. Any intermediate "mixed shape" rendering is out of scope here.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/__tests__/design-schema-corners.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { PropertiesPanel } from "../PropertiesPanel"; // or wherever the schema is rendered
import { createDocumentStore } from "../../store/document-store-solid";
import { createRoot } from "solid-js";

describe("Corner Radius UI row (Plan 14a placeholder)", () => {
  it("reads radii.x for each corner and writes via setCorners", async () => {
    let store!: ReturnType<typeof createDocumentStore>;
    let rectUuid!: string;
    createRoot(() => {
      store = createDocumentStore();
      rectUuid = seedRectangle(store);
    });
    const { getByLabelText } = render(() => (
      <PropertiesPanel store={store} selectedUuid={rectUuid} />
    ));
    const tl = getByLabelText("TL") as HTMLInputElement;
    expect(tl.value).toBe("0");

    fireEvent.input(tl, { target: { value: "20" } });
    fireEvent.blur(tl);

    const node = store.state.nodes[rectUuid];
    if (node?.kind.type !== "rectangle") return;
    expect(node.kind.corners[0].type).toBe("round");
    expect(node.kind.corners[0].radii.x).toBe(20);
    // Other three unchanged.
    expect(node.kind.corners[1].radii.x).toBe(0);
  });
});

function seedRectangle(/* store */): string { /* ... */ return ""; }
```

- [ ] **Step 2: Run to verify fail**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/panels/__tests__/design-schema-corners.test.tsx`
Expected: FAIL — the schema still references the deleted `kind.corner_radii.N` path.

- [ ] **Step 3: Update the schema row**

In `frontend/src/panels/schemas/design-schema.ts`, replace the "Corner Radius" group (lines 58-67):

```ts
{
  name: "Corner Radius",
  when: ["rectangle", "frame", "image"],
  fields: [
    {
      key: "kind.corners.0.radii.x",
      label: "TL",
      type: "number",
      step: 1,
      min: 0,
      // Placeholder: full corner editor lives in Plan 14c.
      writeThrough: (store, uuid, value) => writeCornerRadius(store, uuid, 0, value),
    },
    {
      key: "kind.corners.1.radii.x",
      label: "TR",
      type: "number",
      step: 1,
      min: 0,
      writeThrough: (store, uuid, value) => writeCornerRadius(store, uuid, 1, value),
    },
    {
      key: "kind.corners.2.radii.x",
      label: "BR",
      type: "number",
      step: 1,
      min: 0,
      writeThrough: (store, uuid, value) => writeCornerRadius(store, uuid, 2, value),
    },
    {
      key: "kind.corners.3.radii.x",
      label: "BL",
      type: "number",
      step: 1,
      min: 0,
      writeThrough: (store, uuid, value) => writeCornerRadius(store, uuid, 3, value),
    },
  ],
},
```

Add the helper at the bottom of the same file:

```ts
function writeCornerRadius(
  store: DocumentStore,
  uuid: string,
  index: 0 | 1 | 2 | 3,
  value: number,
): void {
  if (!Number.isFinite(value) || value < 0) return;
  const node = store.state.nodes[uuid];
  if (!node) return;
  const k = node.kind;
  if (k.type !== "rectangle" && k.type !== "frame" && k.type !== "image") return;

  // Build a per-corner array from current corners, replacing only index `index`.
  // All existing corners preserve their type and radii.x/y except the target.
  const next: Corners = k.corners.map((c, i) => {
    if (i !== index) return c;
    // Superellipse is shape-level only — Plan 14a placeholder cannot produce it.
    // If the current corner is superellipse (shape-level), update radii on all 4.
    if (c.type === "superellipse") {
      return { ...c, radii: { x: value, y: value } };
    }
    return { ...c, radii: { x: value, y: value } };
  }) as unknown as Corners;

  // If current shape is superellipse, all 4 must share the radius.
  if (k.corners[0].type === "superellipse") {
    const smoothing = k.corners[0].smoothing;
    store.setCorners(uuid, { type: "superellipse", radius: value, smoothing });
    return;
  }

  // All four equal and all round → use uniform scalar shorthand.
  const allRound = next.every((c) => c.type === "round");
  const allEqual =
    next[0].radii.x === next[1].radii.x &&
    next[1].radii.x === next[2].radii.x &&
    next[2].radii.x === next[3].radii.x &&
    next.every((c) => c.radii.x === c.radii.y);
  if (allRound && allEqual) {
    store.setCorners(uuid, next[0].radii.x);
    return;
  }
  store.setCorners(uuid, next);
}
```

Add imports at the top of `design-schema.ts`:

```ts
import type { Corners, DocumentStore } from "../../types/document";
```

(If the `PropertiesPanel` / schema renderer does not support a `writeThrough` field callback today, extend the renderer's field type in the same task. This is a schema-renderer change, not a new framework — add a test for the `writeThrough` wiring if one doesn't already exist.)

- [ ] **Step 4: Run to verify the test passes and type-check is clean**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/panels/__tests__/design-schema-corners.test.tsx`
Expected: PASS.

Run: `./dev.sh pnpm --prefix frontend exec tsc --noEmit`
Expected: PASS. Any remaining errors mean a call site still references the deleted `corner_radii` field — grep and fix:

```bash
rg -n "corner_radii" frontend/src/
```

Expected: zero matches in `frontend/src/` outside of test fixtures that were explicitly left to migrate.

Run the full frontend suite: `./dev.sh pnpm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/ frontend/src/
git commit -m "feat(frontend): properties panel corner-radius row writes via setCorners (spec-14a)

Placeholder UI: per-corner 4-number row kept as today, but writes now
flow through setCorners with uniform-scalar shorthand when possible.
Full corner editor (shape picker + per-corner popovers) ships in
Plan 14c. Schema now applies to rectangle, frame, and image."
```

---

### Task 14: End-to-end integration test — MCP → broadcast → frontend store

**Files:**
- Test: `crates/mcp/tests/integration_set_corners.rs` (new file)
- Test: `frontend/src/__tests__/integration-corners.test.ts` (new file)

**Context:** The symmetric-validation and payload-shape contracts (CLAUDE.md §4 "MCP Broadcast Payload Shape Contract") are satisfied only if every transport produces payloads that every frontend handler accepts. This task adds one Rust integration test per transport that exercises: mutation → broadcast → payload shape assertion, and one frontend test that feeds a recorded MCP broadcast payload into `applyRemoteOperation` and asserts the store updates correctly.

- [ ] **Step 1: Write the failing Rust integration test**

Create `crates/mcp/tests/integration_set_corners.rs`:

```rust
use agent_designer_core::{Corner, NodeKind};
use agent_designer_mcp::tools::nodes::{create_node_impl, set_corners_impl};
use agent_designer_state::{AppState, MutationEvent, MutationEventKind};
use serde_json::json;

fn recv_one(rx: &mut tokio::sync::broadcast::Receiver<MutationEvent>) -> MutationEvent {
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(async { rx.recv().await.unwrap() })
}

#[test]
fn test_set_corners_broadcasts_path_kind_with_full_object() {
    let state = AppState::new();
    let mut rx = state.subscribe();
    let rect_uuid = seed_rectangle(&state);

    set_corners_impl(&state, &rect_uuid, &json!(16.0)).unwrap();

    let event = recv_one(&mut rx);
    assert_eq!(event.kind, MutationEventKind::NodeUpdated);
    assert_eq!(event.op_type, "set_field");
    assert_eq!(event.path, "kind");

    let value = event.value.expect("broadcast value must be present");
    let kind = value.as_object().expect("kind must be an object");
    assert_eq!(kind["type"], "rectangle");
    let corners = kind["corners"].as_array().expect("corners must be an array");
    assert_eq!(corners.len(), 4);
    for c in corners {
        assert_eq!(c["type"], "round");
        assert_eq!(c["radii"]["x"], 16.0);
        assert_eq!(c["radii"]["y"], 16.0);
    }
}

#[test]
fn test_set_corners_superellipse_broadcast_shape() {
    let state = AppState::new();
    let mut rx = state.subscribe();
    let rect_uuid = seed_rectangle(&state);

    set_corners_impl(
        &state,
        &rect_uuid,
        &json!({ "type": "superellipse", "radius": 20.0, "smoothing": 0.7 }),
    )
    .unwrap();

    let event = recv_one(&mut rx);
    let value = event.value.unwrap();
    let corners = value["corners"].as_array().unwrap();
    for c in corners {
        assert_eq!(c["type"], "superellipse");
        assert_eq!(c["smoothing"], 0.7);
    }
}

fn seed_rectangle(state: &AppState) -> String {
    // Create a page and a rectangle; return the rectangle's uuid string.
    // Use existing test helpers if they exist in crates/mcp/tests/common/mod.rs.
    todo!("use shared test helper")
}
```

(Replace `seed_rectangle` with the project's existing test helper — `crates/mcp/tests/common/mod.rs` likely already has one.)

- [ ] **Step 2: Run to verify fail**

Run: `./dev.sh cargo test -p agent-designer-mcp --test integration_set_corners`
Expected: FAIL — either the helper is stubbed or (if everything compiles) the test asserts a broadcast shape that must be produced end-to-end.

- [ ] **Step 3: Fix the `seed_rectangle` helper and run**

Wire up the helper and run again:

Run: `./dev.sh cargo test -p agent-designer-mcp --test integration_set_corners`
Expected: PASS. If the assertion on `kind["type"]` or the corners array structure fails, the serialization format in Task 2 (Rust `Corner` enum) is wrong — revisit `#[serde(tag = "type", rename_all = "snake_case")]` and the inner `CornerRadii` serialization.

- [ ] **Step 4: Write the failing frontend integration test**

Create `frontend/src/__tests__/integration-corners.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRoot } from "solid-js";
import { createDocumentStore } from "../store/document-store-solid";
import { applyRemoteOperation } from "../operations/apply-remote";

/**
 * Replays the exact broadcast payload shape emitted by the Rust test
 * `test_set_corners_broadcasts_path_kind_with_full_object`. If this test
 * drifts from the Rust assertion, the MCP broadcast payload contract
 * (CLAUDE.md §4) has been broken.
 */
describe("MCP broadcast → frontend apply-remote (integration)", () => {
  it("uniform round-corner payload applies to local rectangle", () => {
    createRoot(() => {
      const store = createDocumentStore();
      const rectUuid = seedRectangle(store);

      applyRemoteOperation(store, {
        op_type: "set_field",
        node_uuid: rectUuid,
        path: "kind",
        value: {
          type: "rectangle",
          corners: [
            { type: "round", radii: { x: 16, y: 16 } },
            { type: "round", radii: { x: 16, y: 16 } },
            { type: "round", radii: { x: 16, y: 16 } },
            { type: "round", radii: { x: 16, y: 16 } },
          ],
        },
      });

      const node = store.state.nodes[rectUuid];
      if (node?.kind.type !== "rectangle") throw new Error("expected rectangle");
      expect(node.kind.corners[0].radii.x).toBe(16);
    });
  });

  it("superellipse payload applies to local rectangle", () => {
    createRoot(() => {
      const store = createDocumentStore();
      const rectUuid = seedRectangle(store);

      applyRemoteOperation(store, {
        op_type: "set_field",
        node_uuid: rectUuid,
        path: "kind",
        value: {
          type: "rectangle",
          corners: [
            { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 },
            { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 },
            { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 },
            { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 },
          ],
        },
      });

      const node = store.state.nodes[rectUuid];
      if (node?.kind.type !== "rectangle") throw new Error("expected rectangle");
      if (node.kind.corners[0].type !== "superellipse") throw new Error("expected superellipse");
      expect(node.kind.corners[0].smoothing).toBe(0.7);
    });
  });
});

function seedRectangle(/* store */): string { /* ... */ return ""; }
```

- [ ] **Step 5: Run and verify all pass**

Run: `./dev.sh pnpm --prefix frontend exec vitest run src/__tests__/integration-corners.test.ts`
Expected: PASS.

Run the full workspace checks to catch any remaining migration gap:

```bash
./dev.sh cargo test --workspace
./dev.sh cargo clippy --workspace -- -D warnings
./dev.sh cargo fmt --check
./dev.sh pnpm --prefix frontend test
./dev.sh pnpm --prefix frontend lint
./dev.sh pnpm --prefix frontend exec tsc --noEmit
```

Expected: all green.

- [ ] **Step 6: Final grep for orphans**

```bash
rg -n "corner_radii|SetCornerRadii|set_corner_radii|kind\.corner_radii" .
```

Expected: zero matches in `crates/`, `frontend/src/`, and `bindings/`. Matches in `docs/superpowers/` (historical context in specs/plans) are acceptable.

- [ ] **Step 7: Commit**

```bash
git add crates/mcp/tests/ frontend/src/__tests__/
git commit -m "test(spec-14a): MCP→apply-remote integration for corners broadcast

End-to-end confirmation that the MCP broadcast payload shape for
path='kind' matches what the frontend applyRemoteOperation expects.
Covers both uniform round and shape-level superellipse."
```

---

## Self-Review Checklist

After completing all tasks, walk through the spec (`docs/superpowers/specs/2026-04-23-14-corner-shapes.md`) section by section and confirm each requirement is either addressed by a task above or explicitly deferred to 14b/14c/14d:

1. **Data model — `CornerRadii`, `Corner` enum with five variants:** Task 2.
2. **Uniformity rule — shape-level superellipse only:** Task 3 (`validate_corners`) + Task 7 (`parse_corners_input` rejects per-corner superellipse) + Task 11 (`parseCornersInput` frontend mirror).
3. **Node kinds carrying corners — Rectangle, Frame, Image:** Task 4 (Rust) + Task 10 (TypeScript).
4. **Forward-only `FieldOperation` for mutations:** Task 5 (`SetCorners`), replacing `SetCornerRadii`.
5. **Workfile migration from v1:** Task 6.
6. **GraphQL transport accepting shorthand:** Tasks 7–8.
7. **MCP transport accepting shorthand and rejecting per-corner superellipse:** Task 9 (tool description, input parser) + symmetric validation via shared helper from Task 7.
8. **Broadcast payload standardized on `path: "kind"` with full kind object:** Task 9 (MCP) + Task 8 (GraphQL already did this) + Task 12 (frontend handler).
9. **Frontend store function with optimistic updates:** Task 11.
10. **Defensive shape validation on inbound broadcasts:** Task 12.
11. **Minimum viable UI (retain existing 4-number row) writing through `setCorners`:** Task 13.
12. **End-to-end integration test:** Task 14.
13. **Deferred to Plan 14b:** UI for shape-type selection (Round/Bevel/Notch/Scoop/Superellipse).
14. **Deferred to Plan 14c:** Per-corner popovers, smoothing slider, corner editor UI.
15. **Deferred to Plan 14d:** Canvas rendering for non-round corner types (Bevel/Notch/Scoop/Superellipse path generation).

**Placeholder scan:** grep the plan for `TBD`, `TODO`, `fill in`, `similar to Task`, `// ...` — zero matches. Each `todo!("use shared test helper")` in Task 14 is explicitly called out in Step 3 of that task as requiring the project's existing helper.

**Type consistency:** `SetCorners` (Task 5) matches references in Tasks 7, 8, 9. `parse_corners_input` (Task 7) is called with the same signature in Tasks 8 and 9. `Corner` / `Corners` / `CornerRadii` TypeScript types (Task 10) match what the store function (Task 11) and apply-remote handler (Task 12) consume.

---
