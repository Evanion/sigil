# Review: Wire Formats & Boolean Ops (PR #11, Plan 01g)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, Logic
**Branch:** `feature/wire-formats-boolean-ops`

## Findings

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, BE, Logic | `SerializableCommand::DeleteNode` missing snapshot field. | resolved — added `snapshot: Option<Box<Node>>` |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-002 | Arch, Logic | Fill rule from path B silently ignored. | resolved — reject mismatched fill rules |
| RF-003 | Sec, Logic | MAX_BOOLEAN_OP_POINTS per-path not cumulative. | resolved — cumulative check across both paths |
| RF-004 | All | Enforcement test doesn't test enforcement. | resolved — proper test with CubicTo expansion |
| RF-005 | Arch, BE | No From conversions between commands and wire enums. | resolved — documented as deferred to server crate |
| RF-006 | Sec | Boolean op output not size-checked. | resolved — output validation added |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-007 | Logic | NodeId in SerializableCommand — ambiguous scope. | resolved — doc comment clarifying in-session only |
| RF-008 | BE | Wire tests don't cover all variants. | resolved — comprehensive tests for all 25 variants |
| RF-009 | Logic | Degenerate polygons passed to i_overlay. | resolved — filter < 3 points |
| RF-010 | Arch | points.clone() instead of mem::take. | resolved — zero-copy move |
