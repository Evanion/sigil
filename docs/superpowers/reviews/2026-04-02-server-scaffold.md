# Review: Server Scaffold (PR #12, Plan 02a)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, Logic, Compliance, Data Scientist, DevOps (7 agents)
**Branch:** `feature/server-scaffold`

## Findings

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Logic | Broadcast echo: originator receives its own broadcast. | resolved — client ID counter + BroadcastEnvelope with sender filtering |
| RF-002 | Arch, BE, Logic, DataSci | Undo/redo not broadcast to other clients. | resolved — DocumentChanged broadcast after undo/redo |
| RF-003 | Arch, Sec, BE | `unsafe impl Send/Sync for AppState`. | resolved — narrowed to SendDocument newtype + compile-time assertions |
| RF-004 | DevOps | No graceful shutdown. | resolved — with_graceful_shutdown + ctrl_c signal handler |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-005 | Arch | SideEffect return values discarded. | resolved — logged at warn + TODO for plan-02b |
| RF-006 | Arch, Sec, BE | `CorsLayer::permissive()` no env guard. | resolved — conditional on SIGIL_DEV_CORS |
| RF-007 | Sec | No WebSocket origin validation. | resolved — origin check, rejects non-localhost unless dev mode |
| RF-008 | Arch, Sec, BE | No WS message size limit. | resolved — MAX_WS_MESSAGE_SIZE = 1 MiB |
| RF-009 | Arch, Sec, BE, Logic | Mutex expect cascades on poisoning. | resolved — graceful recovery via into_inner or error response |
| RF-010 | Arch, Sec, Logic, DataSci | Broadcast lag drops messages silently. | resolved — disconnect lagged clients with error message |
| RF-011 | DataSci | Mutex contention ceiling. | resolved — documented limitation + future sharding path |
| RF-012 | BE, DataSci | Unnecessary clone in hot path. | resolved — reordered: broadcast conversion first, then move |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-013 | Arch, BE | No integration test for command + broadcast. | resolved — test_create_node_broadcasts_to_other_client |
| RF-014 | Sec | Error messages leak internal details. | resolved — sanitized client-facing errors |
| RF-015 | Compliance | `let _ =` suppresses fallible Result. | resolved — explicit is_err check with debug log |
| RF-016 | Arch, DevOps, DataSci | Broadcast capacity is magic number. | resolved — BROADCAST_CHANNEL_CAPACITY constant |
| RF-017 | Sec, DevOps | Bind address hardcoded. | resolved — HOST env var configurable |
