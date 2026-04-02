# Review: Advanced Commands (PR #10, Plan 01f)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE
**Branch:** `feature/advanced-commands`

## New Findings (introduced by this PR)

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, BE | `add_component` silently replaces existing component (no duplicate ID check). | open |
| RF-002 | Arch, Sec, BE | `add_transition` does not reject duplicate transition IDs. | open |
| RF-003 | Arch, Sec | `UpdateToken::apply` doesn't verify old token exists before overwriting. | open |
| RF-004 | Arch | `UpdateTransition` doesn't validate ID consistency across its three fields. | open |
| RF-005 | Arch | `SetOverride::undo` silently ignores missing override on removal. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-006 | Arch | No integration tests through Document::execute/undo/redo. | open |
| RF-007 | Arch, BE | Transitions use generic ValidationError instead of typed error variant. | open |
| RF-008 | Sec | Enforcement test name doesn't follow convention. | open |

## Pre-existing (tracked for future hardening PR)

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-P01 | Sec | Transition/TransitionTrigger/TransitionAnimation derive Deserialize (GOV-010). | deferred — hardening PR |
| RF-P02 | Sec | OverrideValue derives Deserialize (GOV-010). | deferred — hardening PR |
| RF-P03 | Sec | DocumentMetadata/Page derive Deserialize (GOV-010). | deferred — hardening PR |
| RF-P04 | Sec | ShadowValue/TypographyValue derive Deserialize (GOV-010). | deferred — hardening PR |
