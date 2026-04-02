# Review: Frontend Foundation (PR #14, Plan 04a)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, FE, Logic, Compliance, Data Scientist, UX, A11y, (9 agents)
**Branch:** `feature/frontend-foundation`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | A11y | No ARIA landmark roles on layout regions. | open |
| RF-002 | A11y | Panels/toolbar not keyboard-navigable. | open |
| RF-003 | A11y | Canvas has no accessible name or fallback. | open |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-004 | Arch, FE, Logic, UX, DataSci | HiDPI rendering broken — DPR not composed into viewport transform. | open |
| RF-005 | Arch | NodeId u64 generation → JS number precision loss beyond 2^53. | open |
| RF-006 | Arch, Logic | Store never populates nodes — getAllNodes() always empty (scaffold). | open |
| RF-007 | Arch, Sec, FE | Unchecked JSON.parse in WS onmessage crashes on malformed data. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-008 | Arch, UX | Shift+Click for pan conflicts with multi-select convention. | open |
| RF-009 | A11y | Panel headings fail WCAG contrast (2.8:1 to 3.9:1). | open |
| RF-010 | A11y | Connection status not announced via ARIA live region. | open |
| RF-011 | A11y | Headings use div not semantic heading elements. | open |
| RF-012 | Arch, FE | delete_node snapshot typed as unknown, RemoveComponent missing snapshot. | open |
| RF-013 | Sec, FE | getAllNodes/getPages leak mutable internal state. | open |
| RF-014 | UX | No zoom percentage display in status bar. | open |
| RF-015 | UX | No zoom-to-fit/zoom-to-100% keyboard shortcuts. | open |
| RF-016 | DataSci | HTTP re-fetch on every broadcast — no debouncing. | open |
| RF-017 | Logic | Reconnect doesn't re-fetch document state. | open |

### Minor (tracked)

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-018 | FE | No renderer/app-shell tests. | deferred — Plan 04b |
| RF-019 | Arch, FE | unload event unreliable. | open |
| RF-020 | A11y | Connection indicator relies on color alone. | open |
| RF-021 | A11y | No reduced motion foundation. | open |
| RF-022 | A11y | No visible focus styles. | open |
| RF-023 | A11y | Page title doesn't update. | open |
| RF-024 | DataSci | No viewport culling. | deferred — Plan 04b optimization |
| RF-025 | DataSci | Array materialization per frame. | deferred — Plan 04b optimization |
