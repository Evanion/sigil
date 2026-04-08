# Review Findings: PR #39 v2 — Server Simplification + Transparent Undo (Plans 15d+15e)

**Date:** 2026-04-08
**Reviewers:** 8 agents (Architect, Security, BE, Logic, Compliance, DataSci, FE, DevOps)
**Total findings:** 31 (4 Critical, 9 High, 12 Medium, 4 Minor, 1 Low)

## Critical

### RF-001 — applyOperations batch NOT atomic on partial failure
- **Source:** Logic, BE, Arch, Security, DataSci, Compliance (6 agents)
- **Status:** `open`

### RF-002 — sendOps missing rollback on server error
- **Source:** FE, Arch, Security
- **Status:** `open`

### RF-003 — canUndo/canRedo signals never sync after interceptor.set()
- **Source:** FE
- **Status:** `open`

### RF-004 — groupNodes records stale parentUuid in undo tracking
- **Source:** Logic, FE
- **Status:** `open`

## High

### RF-005 — ungroupNodes sends empty string parent UUID for root groups
- **Source:** Logic
- **Status:** `open`

### RF-006 — groupNodes doesn't adjust child transforms to group-relative
- **Source:** Logic
- **Status:** `open`

### RF-007 — Broadcast always NodeUpdated regardless of op types
- **Source:** BE, Arch
- **Status:** `open`

### RF-008 — MAX_OPERATIONS_PER_TRANSACTION never enforced
- **Source:** DataSci
- **Status:** `open`

### RF-009 — Devcontainer floating tag
- **Source:** DevOps
- **Status:** `open`

### RF-010 — GitHub Actions not pinned to SHAs
- **Source:** DevOps
- **Status:** `open`

### RF-011 — pnpm version in 3 places, CI floating
- **Source:** DevOps
- **Status:** `open`

### RF-012 — isUndoing flag not exception-safe
- **Source:** Security
- **Status:** `open`

### RF-013 — DeleteNode doesn't clean up children
- **Source:** BE
- **Status:** `open`

## Medium

### RF-014 — validate_floats_in_value unbounded stack
- **Source:** Security
- **Status:** `open`

### RF-015 — user_id unvalidated
- **Source:** Security
- **Status:** `open`

### RF-016 — No byte-length limit on JSON values
- **Source:** Security
- **Status:** `open`

### RF-017 — Interceptor buffer no size limit
- **Source:** DataSci
- **Status:** `open`

### RF-018 — Coalesce needs max-age safety valve
- **Source:** DataSci
- **Status:** `open`

### RF-019 — _context property not type-safe
- **Source:** FE
- **Status:** `open`

### RF-020 — Duplicated writeStorePath logic
- **Source:** FE, Arch
- **Status:** `open`

### RF-021 — Silent clamping in reparent/reorder
- **Source:** FE
- **Status:** `open`

### RF-022 — Validation asymmetry: MCP validates array sizes, GraphQL doesn't
- **Source:** Compliance
- **Status:** `open`

### RF-023 — Page/Transition derive Deserialize (pre-existing)
- **Source:** Compliance
- **Status:** `wont-fix` — Pre-existing, tracked separately.

### RF-024 — Frontend CI filter missing .node-version
- **Source:** DevOps
- **Status:** `open`

### RF-025 — pin-check doesn't validate Action SHAs
- **Source:** DevOps
- **Status:** `open`

### RF-026 — Server sync per-mutation not per-coalesce
- **Source:** Arch
- **Status:** `open`

## Minor

### RF-027 — redo() doesn't restore side-effect context
- **Source:** Logic
- **Status:** `open`

### RF-028 — Duplicated deepClone
- **Source:** FE
- **Status:** `open`

### RF-029 — No test for _context round-trip
- **Source:** FE
- **Status:** `open`

### RF-030 — Redundant UUID parsing in parse_set_field
- **Source:** BE
- **Status:** `open`

## Low

### RF-031 — CreateNode::apply doesn't validate NodeKind floats
- **Source:** BE
- **Status:** `open`
