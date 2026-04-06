# Review Findings: PR #33 — Viewport Interactions Backend (Plan 11a-a)

**Date:** 2026-04-06
**Reviewers:** Architect, Security, BE, Logic, Compliance, Data Science, FE, DevOps (8 agents)
**Total findings:** 22 (7 High, 10 Medium, 5 Low)

---

## High

### RF-001 — GroupNodes::undo doesn't preserve child ordering
- **Source:** Logic, DataSci, BE, Architect, Compliance
- **File:** `crates/core/src/commands/group_commands.rs` (GroupNodes::undo)
- **Issue:** Uses `tree::add_child` (append) instead of `tree::rearrange` at original index. Undo reorders siblings, breaking z-order.
- **Fix:** Record each child's original index during apply. Use `tree::rearrange` in undo to restore position.
- **Status:** `open`

### RF-002 — BatchSetTransform::apply not truly atomic
- **Source:** Logic, DataSci, BE, Architect, DevOps, FE
- **File:** `crates/core/src/commands/batch_commands.rs` (apply)
- **Issue:** Validation loop checks transforms but not node existence. Mutation loop can fail mid-way on get_mut, leaving partial mutations.
- **Fix:** Add `doc.arena.get(*node_id)?` in the validation loop before any mutations begin.
- **Status:** `open`

### RF-003 — UngroupNodes snapshots caller-dependent
- **Source:** Logic, Security, BE, Architect, DevOps
- **File:** `crates/core/src/commands/group_commands.rs` (UngroupNodes)
- **Issue:** `group_snapshots` must be populated externally. If forgotten, apply succeeds but undo fails permanently. No type-system enforcement.
- **Fix:** Use interior mutability (RefCell) to capture snapshots inside apply, or require snapshots in constructor.
- **Status:** `open`

### RF-004 — GraphQL field selection on scalar return type
- **Source:** FE
- **File:** `frontend/src/graphql/mutations.ts`
- **Issue:** GROUP_NODES_MUTATION queries `{ uuid name kind transform }` but server returns String. UNGROUP_NODES_MUTATION queries `{ uuid }` but server returns Vec<String>. Both will fail at runtime.
- **Fix:** Either change server to return NodeGql objects, or remove field selection from mutation strings.
- **Status:** `open`

### RF-005 — groupNodes/ungroupNodes not optimistic
- **Source:** Compliance, FE, BE, Architect, Security, DataSci
- **File:** `frontend/src/store/document-store-solid.tsx`
- **Issue:** Both wait for server round-trip. Violates CLAUDE.md §11 optimistic update rule.
- **Fix:** Implement optimistic local state changes with rollback on error. Document deferral if complexity justifies it.
- **Status:** `open`

### RF-006 — Public fields on validated types
- **Source:** Security, BE, Compliance
- **File:** `batch_commands.rs`, `group_commands.rs`
- **Issue:** BatchSetTransform, GroupNodes, UngroupNodes all have pub fields allowing direct construction bypassing validation.
- **Fix:** Make fields private. Add validating constructors. Update server callers to use constructors.
- **Status:** `open`

### RF-007 — No rollback on partial reparenting failure
- **Source:** DevOps, Security
- **File:** `crates/core/src/commands/group_commands.rs` (GroupNodes::apply, UngroupNodes::apply)
- **Issue:** Reparenting loop uses `?` without rolling back already-moved children on failure.
- **Fix:** Pre-validate all operations before mutating, or implement rollback on partial failure.
- **Status:** `open`

---

## Medium

### RF-008 — MIN_GROUP_MEMBERS not in validate.rs
- **Source:** Security, Compliance, BE, Architect
- **Fix:** Move to validate.rs.
- **Status:** `open`

### RF-009 — No early MAX_BATCH_SIZE check at GraphQL layer
- **Source:** Security, DevOps
- **Fix:** Add early size check before parsing loop.
- **Status:** `open`

### RF-010 — Missing visible error notifications
- **Source:** FE, Compliance
- **Fix:** Add user-visible notification on error (deferred until toast system exists — document deferral).
- **Status:** `open`

### RF-011 — Transform derives Deserialize (pre-existing)
- **Source:** Security, DevOps
- **Fix:** Add validate_transform() after deserialization in server handler. Custom Deserialize is follow-up.
- **Status:** `open`

### RF-012 — UngroupNodes .unwrap_or(0) silent fallback
- **Source:** Security
- **Fix:** Return CoreError instead.
- **Status:** `open`

### RF-013 — Missing entries/old_transforms length validation
- **Source:** BE
- **Fix:** Validate len equality in apply.
- **Status:** `open`

### RF-014 — batchSetTransform discards server response on success
- **Source:** FE
- **Fix:** Reconcile with server-returned transforms.
- **Status:** `open`

### RF-015 — No duplicate NodeId detection in batch
- **Source:** Security, DataSci
- **Fix:** Check for duplicates in validation loop.
- **Status:** `open`

### RF-016 — deepClone missing required comment
- **Source:** FE
- **Fix:** Add `// JSON clone: Solid proxy not structuredClone-safe` comment.
- **Status:** `open`

### RF-017 — Missing symmetric transform validation in undo
- **Source:** Architect
- **Fix:** Add validate_transform() calls in GroupNodes::undo and UngroupNodes::apply for restored transforms.
- **Status:** `open`

---

## Low

### RF-018 — MAX_BATCH_SIZE not enforced in undo path
- **Fix:** Add size check in undo.
- **Status:** `open`

### RF-019 — Batch broadcast omits node UUIDs
- **Fix:** Include affected UUIDs in event data.
- **Status:** `open`

### RF-020 — GroupNodes parentless edge case
- **Fix:** Reject or handle nodes with no parent.
- **Status:** `open`

### RF-021 — Unnecessary reactive updates from setSelectedNodeIds
- **Fix:** Compare array contents before setting.
- **Status:** `open`

### RF-022 — UngroupNodes test doesn't exercise real usage
- **Fix:** Add integration test chaining GroupNodes → UngroupNodes.
- **Status:** `open`
