# Review: Tools & Interactions (PR #15, Plan 04b)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, FE, Logic, UX, A11y, Compliance, Data Scientist, DevOps (10 agents)
**Branch:** `feature/tools-and-interactions`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Logic | Created node never appears on originating client. | resolved — optimistic insert in createNode |
| RF-002 | Logic, Arch | Drag commands use placeholder NodeId(0,0). | resolved — UUID-based selection, fresh NodeId lookup on pointerUp |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | All | Two undo entries for one create. | resolved — CompoundCommand wraps CreateNode + SetTransform |
| RF-004 | All | Broadcast omits SetTransform. | resolved — NodeCreatedWithTransform broadcast variant |
| RF-005 | All | Every pointermove sends a command. | resolved — local preview during drag, single command on pointerUp |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-006 | Sec, BE, DevOps | No rollback on partial failure. | resolved — CompoundCommand provides atomic rollback |
| RF-007 | Sec | Error messages leak internals. | resolved — generic client-facing errors |
| RF-008 | Arch, DataSci, DevOps | Full doc endpoint holds mutex. | resolved — clone under lock, serialize outside |
| RF-009 | UX | Shape tools don't auto-select. | resolved — store.select(uuid) after create |
| RF-010 | UX | No hover cursor on select tool. | resolved — TODO comment, deferred |
| RF-011 | A11y | No aria-pressed on tool buttons. | resolved — aria-pressed true/false |
| RF-012 | A11y | No roving tabindex on toolbar. | resolved — roving tabindex + arrow key nav |
| RF-013 | A11y | Tool/selection changes not announced. | resolved — aria-live announcements |

### Minor (deferred)

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-014 | Arch | Hit test AABB for rotated nodes. | deferred |
| RF-015 | FE, DataSci | Hit test array copy per click. | deferred |
| RF-016 | UX | Ellipse preview shows rectangle. | deferred |
| RF-017 | UX | No shift-constrain. | deferred |
| RF-018 | UX | Selection handles non-interactive. | deferred |
| RF-019 | UX | Keyboard zoom toward origin. | deferred |
| RF-020 | A11y | Contrast borderline. | deferred |
| RF-021 | A11y | Canvas container not focusable. | deferred |
