# Review: Wire Formats & Boolean Ops (PR #11, Plan 01g)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, Logic
**Branch:** `feature/wire-formats-boolean-ops`

## Findings

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, BE, Logic | `SerializableCommand::DeleteNode` missing `snapshot` field — undo impossible. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-002 | Arch, Logic | Fill rule from path B silently ignored. | open |
| RF-003 | Sec, Logic | MAX_BOOLEAN_OP_POINTS checked per-path not cumulative. | open |
| RF-004 | All | `test_max_boolean_op_points_enforced` doesn't test enforcement. | open |
| RF-005 | Arch, BE | No From conversions between commands and wire enums. | open |
| RF-006 | Sec | Boolean op output not size-checked before allocation. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-007 | Logic | NodeId in SerializableCommand — ambiguous persistence scope. | open |
| RF-008 | BE | Wire tests don't cover all 25 variants. | open |
| RF-009 | Logic | Degenerate single-point polygons passed to i_overlay. | open |
| RF-010 | Arch | points.clone() instead of std::mem::take. | open |

## Pre-existing (tracked for hardening PR)

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-P01 | Sec | Wire enums + many core types derive Deserialize (GOV-010). | deferred |
