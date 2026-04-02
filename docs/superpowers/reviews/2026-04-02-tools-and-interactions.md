# Review: Tools & Interactions (PR #15, Plan 04b)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, FE, Logic, UX, A11y, Compliance, Data Scientist, DevOps (10 agents)
**Branch:** `feature/tools-and-interactions`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Logic | Created node never appears on originating client — no optimistic insert. | open |
| RF-002 | Logic, Arch | All drag commands use placeholder NodeId(0,0) — targets wrong node. | open |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | All | Two undo entries for one create — CreateNode + SetTransform separate. | open |
| RF-004 | All | Broadcast omits SetTransform — other clients see node at (0,0). | open |
| RF-005 | All | Every pointermove sends a command — floods undo stack. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-006 | Sec, BE, DevOps | No rollback on partial failure in CreateNodeRequest. | open |
| RF-007 | Sec | Error messages leak internal details. | open |
| RF-008 | Arch, DataSci, DevOps | Full doc endpoint holds mutex during serialization. | open |
| RF-009 | UX | Shape tools don't select node after creation. | open |
| RF-010 | UX | No hover cursor on select tool. | open |
| RF-011 | A11y | Active tool not communicated (no aria-pressed). | open |
| RF-012 | A11y | Toolbar lacks roving tabindex. | open |
| RF-013 | A11y | Tool/selection changes not announced to screen readers. | open |

### Minor (tracked for follow-up)

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-014 | Arch | Hit test AABB inaccurate for rotated nodes. | deferred |
| RF-015 | FE, DataSci | Hit test array copy + reverse per click. | deferred |
| RF-016 | UX | Ellipse preview shows rectangle outline. | deferred |
| RF-017 | UX | No shift-constrain for proportions. | deferred |
| RF-018 | UX | Selection handles non-interactive (no resize). | deferred |
| RF-019 | UX | Keyboard zoom toward origin not center. | deferred |
| RF-020 | A11y | Contrast still borderline on headings. | deferred |
| RF-021 | A11y | Canvas container not focusable. | deferred |
