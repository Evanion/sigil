# Review: Frontend GraphQL Migration (PR #19, Plan 02e)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, FE, Logic, Compliance, DevOps (7 agents)
**Branch:** `feature/frontend-graphql`

## Findings

### Critical

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | FE, Logic, Arch | UUID mismatch in `createNode` — client generates UUID locally for optimistic insert, but server generates different UUID. Optimistic node stored under wrong key, never cleaned up. | open |

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-002 | FE, Arch, UX | No optimistic update for `setTransform` — mutations fire-and-forget with no local state change. Dragged nodes snap back until subscription re-fetch. | open |

### Major

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | Arch, FE, Logic | No sender filtering on subscription events — client re-fetches on its own mutations, unnecessary traffic and flicker. | open |
| RF-006 | FE, Logic | urql exchange ordering broken — `subscriptionExchange` after `fetchExchange`. Subscriptions consumed by fetch via HTTP, never reach WS. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-004 | FE, Security | Silent mutation error handling — all mutation calls discard errors, no user feedback on failures. | open |
| RF-005 | Logic, BE | Parent/children data discarded in `node` query — returns `parent: None, children: vec![]`. | open |
| RF-007 | FE, Arch | No WebSocket reconnection — if WS drops, subscriptions stop permanently. | open |
| RF-008 | Logic, FE | Double fetch on undo/redo — direct `fetchPages()` call AND subscription handler both trigger re-fetch. | open |
| RF-009 | Compliance | Vite proxy still references dead `/api` and `/ws` routes. | open |
| RF-010 | BE, DevOps | `SendDocument` Send/Sync assertion tests deleted with `dispatch.rs` — need relocation. | open |
| RF-011 | FE, Compliance | Dead frontend types — `commands.ts` and wire format types in `document.ts` still present. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-012 | Security | No query depth/complexity limit on frontend client side. | open |
| RF-013 | Compliance | Missing defensive JSON parsing (GOV-024) on GraphQL responses. | open |
