# Review Findings: PR #39 — Server Simplification (Plan 15d)

**Date:** 2026-04-08
**Reviewers:** 7 agents (Architect, Security, BE, Logic, Compliance, DataSci, DevOps)
**Total findings:** 24 (5 Critical, 6 High, 6 Medium, 3 Minor, 1 Low, 1 Info)

## Critical

### RF-001 — group_nodes missing bounding box and transform adjustment
- **Source:** Logic
- **Issue:** Old `GroupNodes` computed union bounding box and adjusted child transforms to group-relative. New code creates group with default (0,0) transform and children keep absolute coords. Grouping is visually broken.
- **Fix:** Replicate bounding box computation and coordinate adjustment from old GroupNodes.
- **Status:** `open`

### RF-002 — group_nodes leaves stale page root_nodes entries
- **Source:** Logic
- **Issue:** After reparenting children under the group, they remain in `page.root_nodes`. Page root list becomes corrupted.
- **Fix:** Remove children from `page.root_nodes` after reparenting under group.
- **Status:** `open`

### RF-003 — ungroup_nodes orphans children when group is page root
- **Source:** Logic
- **Issue:** When group has no parent (is page root), children are not reparented anywhere. After group deletion, children have dangling parent references.
- **Fix:** When group_parent is None, add children to page.root_nodes and clear their parent.
- **Status:** `open`

### RF-004 — ungroup_nodes missing transform adjustment
- **Source:** Logic
- **Issue:** Old UngroupNodes converted group-relative coords back to absolute. New code doesn't adjust transforms, causing visual displacement.
- **Fix:** Add group transform offset to each child's transform before reparenting.
- **Status:** `open`

### RF-005 — Dockerfile uses floating tag
- **Source:** DevOps
- **Issue:** `.devcontainer/Dockerfile` uses `1-bookworm` which is a rolling tag. Violates CLAUDE.md reproducibility rule.
- **Fix:** Pin to specific version or digest.
- **Status:** `open`

## High

### RF-006 — batch_set_transform no rollback on partial failure
- **Source:** Security, DataSci
- **Issue:** If transform K fails, transforms 0..K-1 are already applied with no rollback.
- **Fix:** Track original transforms; restore on failure.
- **Status:** `open`

### RF-007 — group/ungroup no rollback on partial reparent failure
- **Source:** Security
- **Issue:** Multi-step mutations (create+reparent N children) have no rollback path.
- **Fix:** Track completed reparents; reverse on failure.
- **Status:** `open`

### RF-008 — group_nodes panics on empty input
- **Source:** Security, Logic
- **Issue:** `node_ids[0]` unchecked access panics on empty input. No MIN_GROUP_MEMBERS validation.
- **Fix:** Guard `uuids.len() >= MIN_GROUP_MEMBERS` at top.
- **Status:** `open`

### RF-009 — MCP broadcast uses legacy publish_event not publish_transaction
- **Source:** Architect
- **Issue:** MCP tools use `publish_event()` without TransactionPayload. Violates broadcast symmetry rule.
- **Fix:** Deferred — requires MCP tools to construct TransactionPayload. Document as known limitation.
- **Status:** `open`

### RF-010 — pnpm@latest in Dockerfile is unpinned
- **Source:** DevOps
- **Issue:** `corepack prepare pnpm@latest` is a floating reference. Pre-existing but file is being modified.
- **Fix:** Pin pnpm version.
- **Status:** `open`

### RF-011 — Node version not pinned
- **Source:** DevOps
- **Issue:** `.node-version` contains `lts/*`, no single source of truth for Node version.
- **Fix:** Pin to exact version.
- **Status:** `open`

## Medium

### RF-012 — CLAUDE.md references deleted execute/undo/redo
- **Source:** Architect
- **Issue:** Testing standards require execute/undo/redo cycle tests which no longer exist. "Every operation must have undo/redo support" is now a frontend concern.
- **Fix:** Update CLAUDE.md to reflect FieldOperation model.
- **Status:** `open`

### RF-013 — Dual seq counters (Document.seq dead, AppState.seq_counter live)
- **Source:** Architect, DataSci
- **Issue:** Document.seq is never called outside tests. Creates confusion about which counter is authoritative.
- **Fix:** Remove Document.seq and next_seq().
- **Status:** `open`

### RF-014 — ungroup_nodes places children at position 0 instead of group's position
- **Source:** Logic
- **Issue:** Old code used `group_index + i`, new code uses `i`. Children end up at beginning of parent's children list.
- **Fix:** Capture group's index in parent, use `group_index + i`.
- **Status:** `open`

### RF-015 — NaN/Infinity not validated for NodeKind float fields
- **Source:** Security
- **Issue:** `corner_radii`, `arc_start`, `arc_end` in NodeKind not validated at deserialization boundary.
- **Fix:** Add float validation for NodeKind fields in CreateNode::validate.
- **Status:** `open`

### RF-016 — GraphQL set_fills/strokes/effects missing float validation
- **Source:** Security
- **Issue:** MCP validates floats in fills/strokes/effects, GraphQL does not. Asymmetry.
- **Fix:** Add `validate_floats_in_value` before deserialization in GraphQL resolvers.
- **Status:** `open`

### RF-017 — All command structs have pub fields
- **Source:** Architect, BE, Security
- **Issue:** Violates "Validated Types Must Have Private Fields" rule.
- **Fix:** Defer with documented rule relaxation — FieldOperation structs are pure data carriers with validate() at the trait level.
- **Status:** `open`

### RF-018 — CreateNode::node_id always ignored by arena
- **Source:** BE
- **Issue:** Every caller passes NodeId::new(0,0). Field is misleading.
- **Fix:** Remove node_id from CreateNode, use constant inside apply().
- **Status:** `open`

### RF-019 — Production Dockerfile Rust version hardcoded
- **Source:** DevOps
- **Issue:** Not derived from rust-toolchain.toml. Can drift.
- **Fix:** Document as known limitation. Single-file approach is simpler for now.
- **Status:** `open`

## Minor

### RF-020 — Dead code: restore_component/restore_transition
- **Source:** Architect, BE
- **Issue:** Only existed for undo paths which are deleted.
- **Fix:** Delete both methods.
- **Status:** `open`

### RF-021 — Stale comments referencing deleted types
- **Source:** Compliance, BE
- **Issue:** path.rs, nodes.rs, tokens.rs, document.rs reference Command/CompoundCommand/undo/History.
- **Fix:** Update or remove stale comments.
- **Status:** `open`

### RF-022 — Page derives Deserialize with validating constructor (pre-existing)
- **Source:** Security
- **Issue:** Pre-existing violation of "No Derive Deserialize on Validated Types".
- **Fix:** Out of scope for this PR. Track separately.
- **Status:** `wont-fix` — Pre-existing, not introduced by this PR.

## Low

### RF-023 — batch_set_transform redundant UUID re-resolution
- **Source:** DataSci
- **Issue:** Response loop re-resolves UUID→NodeId already resolved in validate loop.
- **Fix:** Reuse resolved NodeIds from first pass.
- **Status:** `open`

## Info

### RF-024 — No tests for apply() without prior validate()
- **Source:** BE
- **Issue:** Test coverage gap — no proof apply() is self-protecting.
- **Fix:** Add a few direct-apply tests on invalid state.
- **Status:** `open`
