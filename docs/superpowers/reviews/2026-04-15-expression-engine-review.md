# Expression Engine Review Findings (Spec 13d)

**Date:** 2026-04-15
**Reviewers:** Architect, Security, Backend, Logic, Compliance, Data Scientist, Frontend
**Branch:** feature/expression-engine

## Critical

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-001 | BE, Security, Compliance | `#[derive(Deserialize)]` on `TokenExpression`/`ExprLiteral` bypasses parser validation (depth, args, NaN) | `expression.rs` | open |
| RF-002 | Arch, Logic, Data, FE | Frontend `rem()`/`em()`/`px()` inverted vs Rust (multiply vs divide) | `expression-eval.ts` | open |
| RF-003 | Arch, Logic, Data, FE | Frontend `contrast()` arity 2 + ratio; Rust arity 1 + black/white | `expression-eval.ts` | open |

## High

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-004 | BE, Security, Logic | Binary arithmetic result not checked for NaN/Infinity | `evaluator.rs` | open |
| RF-005 | Logic, Arch, Data, FE | Frontend channel setters/adjusters 0-1 scale; Rust 0-255/0-100 | `expression-eval.ts` | open |
| RF-006 | Logic, Arch | Frontend blend mode names underscores; Rust hyphens | `expression-eval.ts` | open |
| RF-007 | FE | `requireColor` error check unsafe `as` casts | `expression-eval.ts` | open |

## Major

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-008 | Arch, BE, Security | `evaluate_token_ref` ignores `_depth` parameter | `evaluator.rs` | open |
| RF-009 | Arch, BE | Error mapping via string `contains()` — fragile | `evaluator.rs` | open |
| RF-010 | Arch, Data, Logic | `color_to_srgb` maps Oklch/Oklab as sRGB — nonsensical | `color_convert.rs` | open |
| RF-011 | Security, Compliance | Parser `factor()` unary neg recursion has no depth guard | `parser.rs` | open |
| RF-012 | Arch | `f64::midpoint` requires Rust 1.85+ — MSRV concern | `color_convert.rs` | open |
| RF-013 | Arch | `pub mod color_convert` exposes internals | `tokens/mod.rs` | open |
| RF-014 | BE, Arch, Data | `require_number`/`require_color`/`check_arity` duplicated 4x | `functions/*.rs` | open |
| RF-015 | Arch, Data, FE | Frontend channel extractors return 0-1; Rust 0-255/0-100 | `expression-eval.ts` | open |
| RF-016 | Logic | Frontend blend alpha compositing differs from Rust | `expression-eval.ts` | open |

## Medium

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-017 | Security | `evaluate_literal()` doesn't validate f64 for NaN/Infinity | `evaluator.rs` | open |
| RF-018 | FE | `srgbToHsl`/`hslToSrgb` lack Number.isFinite() guards | `expression-eval.ts` | open |
| RF-019 | FE | Token op value types use `unknown` instead of `TokenValue` | `operations/types.ts` | open |
| RF-020 | FE | Undo rollback doesn't remove undo entry (pre-existing RF-009) | `document-store-solid.tsx` | deferred-followup |
| RF-021 | BE | Hue normalization fragile — should use rem_euclid | `color_convert.rs` | open |
| RF-022 | Arch | TS parser allows `-` in bare token refs; Rust does not | `expression-eval.ts` | open |
| RF-023 | BE | Percentage doc comment says "stored as 10.0" but parser stores 0.1 | `expression.rs` | open |

## Minor/Low

| ID | Source | Description | File | Status |
|---|---|---|---|---|
| RF-024 | Data | 1389-line expression-eval.ts should be split | `expression-eval.ts` | open |
| RF-025 | Data | No AST caching — re-parsed every evaluation | `expression-eval.ts` | deferred-followup |
| RF-026 | BE | `contrast()` luminance non-linearized sRGB | `color.rs` | open |
| RF-027 | Logic | Soft-light uses Photoshop formula, docs claim W3C | `blend.rs` | open |
| RF-028 | FE | Duplicate `isParseResultError` type guard | `expression-eval.ts` | open |
