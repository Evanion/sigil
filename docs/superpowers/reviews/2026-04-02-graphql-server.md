# Review: GraphQL Server (PR #18, Plan 02d)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE, Logic, Compliance, Data Scientist, DevOps (7 agents)
**Branch:** `feature/graphql-server`

## Findings

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Sec, BE, DevOps | No query depth/complexity limits. | resolved — limit_depth(10) + limit_complexity(500) |
| RF-002 | Arch, Sec, Compliance, DevOps | /graphql/ws no Origin validation. | resolved — custom handler with is_allowed_origin |
| RF-003 | Arch, Compliance, DevOps | Mutations don't broadcast to WS clients. | resolved — publish_ws_document_changed after mutations |
| RF-004 | Sec, BE, DevOps | GraphiQL unconditionally exposed. | resolved — gated behind SIGIL_DEV_CORS |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-005 | Arch, BE, Logic, DataSci | TOCTOU double-lock pattern. | resolved — build response inside first lock scope |
| RF-006 | Arch, BE | String event_type. | resolved — DocumentEventType enum |
| RF-007 | Arch, BE, Logic, DataSci | unwrap_or_default swallows errors. | resolved — error propagation |
| RF-008 | Arch, Compliance | No sender-exclusion on subscriptions. | resolved — sender_id field added, documented TODO |
| RF-009 | Sec | initial_transform not validated. | resolved — validate_transform call in CreateNode::apply |
| RF-010 | DataSci | pages query holds mutex during serialization. | resolved — clone under lock, serialize outside |
| RF-011 | Sec, DevOps | No WS message size on /graphql/ws. | resolved — TODO documented, size via GraphQLWebSocket |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-012 | Arch, BE, DataSci | Duplicated node-to-GQL. | resolved — shared node_to_gql in types.rs |
| RF-013 | Sec, BE | data_unchecked in subscription. | resolved — ctx.data()? |
| RF-014 | Arch, BE | NodeId::new(0,0) placeholder. | resolved — documented with comment |
| RF-015 | BE | No HTTP integration tests. | deferred — Plan 02e |
| RF-016 | DataSci | DocumentEvent clones Value per subscriber. | deferred — optimize if needed |
