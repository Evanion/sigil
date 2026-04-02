# Review: Server Scaffold (PR #12, Plan 02a)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, Logic, Compliance, Data Scientist, DevOps (7 agents)
**Branch:** `feature/server-scaffold`

## Findings

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Logic | Broadcast echo: originator receives its own broadcast, no client ID filtering. | open |
| RF-002 | Arch, BE, Logic, DataSci | Undo/redo not broadcast to other clients — state diverges. | open |
| RF-003 | Arch, Sec, BE | `unsafe impl Send/Sync for AppState` — no compile-time enforcement. | open |
| RF-004 | DevOps | No graceful shutdown — SIGTERM drops connections. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-005 | Arch | SideEffect return values silently discarded. | open |
| RF-006 | Arch, Sec, BE | `CorsLayer::permissive()` with no env guard. | open |
| RF-007 | Sec | No WebSocket origin validation. | open |
| RF-008 | Arch, Sec, BE | No WebSocket message size limit. | open |
| RF-009 | Arch, Sec, BE, Logic | Mutex `.expect()` cascades on poisoning. | open |
| RF-010 | Arch, Sec, Logic, DataSci | Broadcast lag drops messages, no recovery. | open |
| RF-011 | DataSci | Mutex contention ceiling at high concurrency. | open |
| RF-012 | BE, DataSci | Unnecessary SerializableCommand::clone() in hot path. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-013 | Arch, BE | No integration test for successful command + broadcast. | open |
| RF-014 | Sec | Error messages leak internal details to clients. | open |
| RF-015 | Compliance | `let _ = broadcast_tx.send()` suppresses fallible Result. | open |
| RF-016 | Arch, DevOps, DataSci | Broadcast channel capacity 256 is magic number. | open |
| RF-017 | Sec, DevOps | Bind address hardcoded to 0.0.0.0. | open |
