# Review: GraphQL Server (PR #18, Plan 02d)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, Logic, Compliance, Data Scientist, DevOps (7 agents)
**Branch:** `feature/graphql-server`

## Findings

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Sec, BE, DevOps | No query depth/complexity limits — DoS vector. | open |
| RF-002 | Arch, Sec, Compliance, DevOps | `/graphql/ws` no Origin validation — CSWSH. | open |
| RF-003 | Arch, Compliance, DevOps | Mutations don't broadcast to existing WS clients — split-brain. | open |
| RF-004 | Sec, BE, DevOps | GraphiQL unconditionally exposed in production. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-005 | Arch, BE, Logic, DataSci | TOCTOU — mutations release and re-acquire lock. | open |
| RF-006 | Arch, BE | DocumentEvent uses String event_type instead of enum. | open |
| RF-007 | Arch, BE, Logic, DataSci | unwrap_or_default swallows serialization errors. | open |
| RF-008 | Arch, Compliance | Subscription has no sender-exclusion. | open |
| RF-009 | Sec | CreateNode::apply doesn't validate initial_transform. | open |
| RF-010 | DataSci | pages query holds mutex during full serialization. | open |
| RF-011 | Sec, DevOps | No WS message size limit on /graphql/ws. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-012 | Arch, BE, DataSci | Duplicated node-to-GQL logic. | open |
| RF-013 | Sec, BE | data_unchecked in subscription. | open |
| RF-014 | Arch, BE | NodeId::new(0,0) placeholder. | open |
| RF-015 | BE | No integration tests for HTTP endpoints. | open |
| RF-016 | DataSci | DocumentEvent clones Value per subscriber. | open |
