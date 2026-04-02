# Review: Command System (PR #6, Plan 01b)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, Logic
**Branch:** `feature/command-system`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, Sec, BE, Logic | **DeleteNode undo is fundamentally broken**: (a) `arena.insert()` assigns new NodeId with bumped generation, breaking all history references; (b) parent's `children` list never updated; (c) children of deleted node orphaned. Fix: add `arena.reinsert(id, node)` that restores at exact slot+generation, call `tree::add_child` to restore parent link, and handle children recursively. | open |
| RF-002 | Logic | **Failed undo/redo permanently drops commands**: `Document::undo()`/`redo()` pop the command then `?` on apply/undo — if it fails, the command is lost. Fix: push command back on failure. | open |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | Arch, Sec, BE, Logic | **CompoundCommand rollback swallows errors**: `let _ = cmd.undo(doc)` discards failures silently. Fix: collect rollback errors and return composite error. | open |
| RF-004 | Logic | **`tree::rearrange` capacity-check rollback uses `push` instead of `insert(original_pos)`**: siblings permanently reordered on failed operation. Fix: record original position before removing, use `insert` in rollback. | open |
| RF-005 | Arch, Sec, BE, Logic | **FIFO eviction uses `Vec::remove(0)` — O(n)**: should be `VecDeque` for O(1) `pop_front`. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-006 | Arch, Sec, BE | `SetOpacity` missing [0.0, 1.0] range validation; accepts NaN/infinity. | open |
| RF-007 | Arch, Sec, BE | `SetTransform` missing NaN/infinity/negative dimension validation. | open |
| RF-008 | Logic | `CreateNode::undo` doesn't call `tree::remove_child` before `arena.remove` — stale NodeId in parent's children during compound rollback. | open |
| RF-009 | Logic, BE | `ReparentNode::undo` uses `unwrap_or(0)` when `old_position` is `None` — silently restores to wrong position. | open |
| RF-010 | Security | `SideEffect` `target_workfile` has no path validation; derives `Deserialize`. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-011 | Arch, BE, Logic | No test for `CompoundCommand` rollback on partial failure. | open |
| RF-012 | Logic | `RenameNode::undo` skips `validate_node_name` — asymmetric validation. | open |
| RF-013 | Security | `CompoundCommand` has no limit on sub-command count. | open |
| RF-014 | BE | Repeated `#[allow(clippy::unnecessary_literal_bound)]` on 12 methods. | open |
| RF-015 | BE | Missing tests for double-apply/double-undo and stale NodeId at command level. | open |
| RF-016 | Security | `History::new(0)` silently disables undo, violating CLAUDE.md. | open |

### Low

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-017 | Security | `CompoundCommand` description has no length limit. | open |
| RF-018 | Security | Page `root_nodes` has no size limit. | open |
