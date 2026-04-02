# Review: Independent Types (PR #7, Plan 01c)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE/Logic
**Branch:** `feature/independent-types`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, BE | **Transition serializes `NodeId` (arena indices) into file format** — not stable across sessions. | resolved — added `SerializedTransition` with UUID fields |
| RF-002 | Sec, BE | **Serde `Deserialize` bypasses constructors; `MAX_TRANSITIONS_PER_DOCUMENT` unenforced.** | resolved — added collection limit checks in `validate_deserialized_page`, path data limits, custom Deserialize for SubPath/PathData |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | Sec, BE | **No f64 validation at deserialization boundary** — NaN/infinity accepted from files. | resolved — added `validate_floats_in_value` walker, called on transform/style/kind |
| RF-004 | Arch, Sec, BE | **`MAX_GRID_TRACKS` and `validate_grid_track` defined but never enforced.** | resolved — added `validate_grid_layout_limits` in deserialization, Node::new validates grid layouts |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-005 | Sec | `SubPath`/`PathData` pub fields bypass constructors. | resolved — made fields private, added accessors, custom Deserialize impls |
| RF-006 | Sec | `Node::new` skips validation for Text, Rectangle, Ellipse, layout f64 fields. | resolved — added `validate_node_kind` with per-variant validation |
| RF-007 | Sec, BE | `SetTextContent::undo` and `SetTransform::undo` skip validation (asymmetric). | resolved — added symmetric validation in undo paths |
| RF-008 | BE | `CompoundCommand::undo` fails fast without rollback. | resolved — mirrors apply's rollback pattern, re-applies on failure |
| RF-009 | BE | No semantic validation of path segment ordering. | resolved — `SubPath::validate_structure` ensures non-empty paths start with MoveTo |
| RF-010 | BE | `validate_asset_ref` is lexical-only — no docs about blind spots. | resolved — added caveat doc comment |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-011 | Arch | `Smooth`/`Mirrored` CornerMode semantics swapped vs industry convention. | resolved — swapped doc comments |
| RF-012 | BE | Missing boundary tests. | resolved — added 3 boundary tests |
| RF-013 | BE | `OverrideMap` stub comment references wrong plan number. | resolved — updated to Plan 01d |
| RF-014 | BE | `GridSpan::LineToLine` with start >= end not documented. | resolved — added doc comment about negative indices |
| RF-015 | BE | File-level clippy allow without justification. | resolved — added explanatory comments |
