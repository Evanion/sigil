# Expression Engine Review Findings (Spec 13d)

**Date:** 2026-04-15
**Reviewers:** Architect, Security, Backend, Logic, Compliance, Data Scientist, Frontend
**Branch:** feature/expression-engine

## Critical

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-001 | BE, Security, Compliance | `#[derive(Deserialize)]` on AST types bypasses validation | `expression.rs` | resolved — removed Deserialize |
| RF-002 | Arch, Logic, Data, FE | Frontend `rem()`/`em()`/`px()` inverted vs Rust | `expression-eval.ts` | resolved — aligned with Rust |
| RF-003 | Arch, Logic, Data, FE | Frontend `contrast()` arity/semantics mismatch | `expression-eval.ts` | resolved — 1-arg black/white matching Rust |

## High

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-004 | BE, Security, Logic | Binary arithmetic NaN/Infinity not checked | `evaluator.rs` | resolved — finite check added |
| RF-005 | Logic, Arch, Data, FE | Channel setters/adjusters scale mismatch | `expression-eval.ts` | resolved — 0-255/0-100 matching Rust |
| RF-006 | Logic, Arch | Blend mode names underscores vs hyphens | `expression-eval.ts` | resolved — hyphens matching Rust |
| RF-007 | FE | `requireColor` unsafe `as` casts | `expression-eval.ts` | resolved — proper `isColorError` guard |

## Major

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-008 | Arch, BE, Security | `evaluate_token_ref` ignores depth | `evaluator.rs` | resolved — documented, unused prefix removed |
| RF-009 | Arch, BE | Error mapping via string matching | `evaluator.rs` | resolved — direct CoreError variant matching |
| RF-010 | Arch, Data, Logic | Oklch/Oklab as sRGB nonsensical | `color_convert.rs` | resolved — returns error for non-sRGB |
| RF-011 | Security, Compliance | Parser `factor()` no depth guard | `parser.rs` | resolved — enter_depth/leave_depth added |
| RF-012 | Arch | `f64::midpoint` MSRV concern | `color_convert.rs` | resolved — replaced with (a+b)/2.0 |
| RF-013 | Arch | `pub mod color_convert` exposes internals | `tokens/mod.rs` | resolved — changed to pub(crate) |
| RF-014 | BE, Arch, Data | Duplicated function helpers | `functions/*.rs` | resolved — extracted to helpers.rs |
| RF-015 | Arch, Data, FE | Channel extractors 0-1 vs 0-255 | `expression-eval.ts` | resolved — 0-255/0-100 matching Rust |
| RF-016 | Logic | Blend alpha compositing mismatch | `expression-eval.ts` | resolved — proper alpha compositing |

## Medium

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-017 | Security | `evaluate_literal` no NaN/Infinity check | `evaluator.rs` | resolved — finite check added |
| RF-018 | FE | Color conversion missing isFinite guards | `expression-eval.ts` | resolved — guards added |
| RF-019 | FE | Op types use `unknown` | `operations/types.ts` | resolved — TODO comment added |
| RF-020 | FE | Undo rollback doesn't remove entry | `document-store-solid.tsx` | deferred-followup |
| RF-021 | BE | Hue normalization fragile | `color_convert.rs` | resolved — rem_euclid |
| RF-022 | Arch | TS parser allows `-` in bare refs | `expression-eval.ts` | resolved — removed from charset |
| RF-023 | BE | Percentage doc comment wrong | `expression.rs` | resolved — corrected |

## Minor/Low

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-024 | Data | Large file should be split | `expression-eval.ts` | resolved — TODO comment added |
| RF-025 | Data | No AST caching | `expression-eval.ts` | deferred-followup |
| RF-026 | BE | Contrast luminance not linearized | `color.rs` | resolved — sRGB linearization added |
| RF-027 | Logic | Soft-light doc claims W3C | `blend.rs` | resolved — doc corrected |
| RF-028 | FE | Duplicate isParseResultError guard | `expression-eval.ts` | resolved — unified into isEvalError |

## Resolution Summary

- **Resolved:** 26 findings
- **Deferred:** 2 findings (RF-020 undo rollback — pre-existing, RF-025 AST caching — optimization)
