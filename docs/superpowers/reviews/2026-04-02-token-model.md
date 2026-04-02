# Review: Token Model (PR #8, Plan 01d)

**Date:** 2026-04-02
**Reviewers:** Architect, Security, BE
**Branch:** `feature/token-model`

## Findings

### High

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-001 | Arch, Sec | `Token` derives `Deserialize`, bypassing validation (GOV-010). | resolved — custom Deserialize routes through Token::new |
| RF-002 | BE | Off-by-one in resolve depth guard (`>` should be `>=`). | resolved — changed to `>=`, updated tests |

### Medium

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-003 | Arch, Sec, BE | `MAX_TOKEN_DESCRIPTION_LEN` defined but never enforced. | resolved — validated in Token::new |
| RF-004 | Arch | `TokenType`/`TokenValue` mismatch not validated. | resolved — added token_type_matches_value cross-check |
| RF-005 | BE | Negative shadow blur and zero/negative font size not rejected. | resolved — added domain range checks |
| RF-006 | Sec, BE | `validate_token_value` skipped Color and Gradient validation. | resolved — added validate_color_channels + gradient validation |
| RF-007 | Sec, BE | Token constants in `token.rs` instead of `validate.rs`. | resolved — moved to validate.rs |

### Minor

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| RF-008 | Sec | `resolve_inner` uses recursion. | resolved — converted to iterative loop |
| RF-009 | BE | Missing boundary test at exact MAX_ALIAS_CHAIN_DEPTH. | resolved — added boundary test |
| RF-010 | BE | Serde round-trip test uses shallow equality. | resolved — uses assert_eq! now |
| RF-011 | BE | `GradientValue` wrapper removed, using `GradientDef` directly. | resolved |
