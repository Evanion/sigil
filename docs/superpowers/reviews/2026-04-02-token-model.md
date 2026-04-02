# Review: Token Model (PR #8, Plan 01d)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE
**Branch:** `feature/token-model`

## Findings

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, Sec | `Token` derives `Deserialize`, bypassing `Token::new` validation (GOV-010 violation). | open |
| RF-002 | BE | Off-by-one in `resolve_inner` depth guard — `>` should be `>=`. | open |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | Arch, Sec, BE | `MAX_TOKEN_DESCRIPTION_LEN` defined but never enforced. | open |
| RF-004 | Arch | `TokenType`/`TokenValue` mismatch not validated. | open |
| RF-005 | BE | Negative shadow blur and zero/negative font size not rejected. | open |
| RF-006 | Sec, BE | `validate_token_value` skips Color and Gradient validation. | open |
| RF-007 | Sec, BE | Token constants in `token.rs` instead of `validate.rs`. | open |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-008 | Sec | `resolve_inner` uses recursion — could be iterative. | open |
| RF-009 | BE | Missing boundary test at exact MAX_ALIAS_CHAIN_DEPTH. | open |
| RF-010 | BE | Serde round-trip test uses shallow equality. | open |
| RF-011 | BE | `GradientValue` wrapper adds no value over `GradientDef`. | open |
