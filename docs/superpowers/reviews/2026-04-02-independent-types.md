# Review: Independent Types (PR #7, Plan 01c)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE/Logic
**Branch:** `feature/independent-types`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, BE | **Transition serializes `NodeId` (arena indices) into file format** — not stable across sessions. Need `SerializedTransition` with UUID fields. | open |
| RF-002 | Sec, BE | **Serde `Deserialize` bypasses `SubPath::new`/`PathData::new` constructors** — limits unenforced on deserialization. `MAX_TRANSITIONS_PER_DOCUMENT` defined but never enforced. | open |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | Sec, BE | **No f64 validation at deserialization boundary** — Color, GradientStop, Point, FlexLayout, GridLayout gaps all accept NaN/infinity from files. | open |
| RF-004 | Arch, Sec, BE | **`MAX_GRID_TRACKS` and `validate_grid_track` defined but never enforced** at any boundary. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-005 | Sec | `SubPath`/`PathData` pub fields bypass constructors at runtime too. | open |
| RF-006 | Sec | `Node::new` skips validation for Text content, corner_radii, arc angles, layout f64 fields. | open |
| RF-007 | Sec, BE | `SetTextContent::undo` and `SetTransform::undo` skip validation (asymmetric). | open |
| RF-008 | BE | `CompoundCommand::undo` fails fast without attempting full rollback. | open |
| RF-009 | BE | No semantic validation of path segment ordering (LineTo before MoveTo). | open |
| RF-010 | BE | `validate_asset_ref` is lexical-only — no docs about URL-encoding blind spot. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-011 | Arch | `Smooth`/`Mirrored` CornerMode semantics swapped vs industry convention. | open |
| RF-012 | BE | Missing boundary tests (duration at max, zero delay, history eviction at 1). | open |
| RF-013 | BE | `OverrideMap` stub comment references wrong plan number. | open |
| RF-014 | BE | `GridSpan::LineToLine` with start >= end not validated/documented. | open |
| RF-015 | BE | File-level clippy allow without per-item justification. | open |
