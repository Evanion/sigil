# Review: Advanced Commands (PR #10, Plan 01f)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE
**Branch:** `feature/advanced-commands`

## New Findings (introduced by this PR)

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, BE | `add_component` silently replaces existing component. | resolved — duplicate ID check + restore_component for undo |
| RF-002 | Arch, Sec, BE | `add_transition` does not reject duplicate IDs. | resolved — duplicate ID check + restore_transition for undo |
| RF-003 | Arch, Sec | `UpdateToken::apply` doesn't verify old token exists. | resolved — existence check added |
| RF-004 | Arch | `UpdateTransition` doesn't validate ID consistency. | resolved — cross-field check in apply and undo |
| RF-005 | Arch | `SetOverride::undo` silently ignores missing override. | resolved — checks remove result |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-006 | Arch | No integration tests through execute/undo/redo. | resolved — 6 round-trip tests added |
| RF-007 | Arch, BE | Transitions use generic ValidationError. | resolved — added TransitionNotFound(Uuid) variant |
| RF-008 | Sec | Enforcement test name convention. | resolved — renamed |

## Pre-existing (tracked for future hardening PR)

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-P01 | Sec | Transition types derive Deserialize (GOV-010). | deferred — hardening PR |
| RF-P02 | Sec | OverrideValue derives Deserialize (GOV-010). | deferred — hardening PR |
| RF-P03 | Sec | DocumentMetadata/Page derive Deserialize (GOV-010). | deferred — hardening PR |
| RF-P04 | Sec | ShadowValue/TypographyValue derive Deserialize (GOV-010). | deferred — hardening PR |
