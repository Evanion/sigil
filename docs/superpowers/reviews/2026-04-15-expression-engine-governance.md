# Governance Review: Expression Engine (Spec 13d)

**Date:** 2026-04-15
**Reviewer:** Governance Agent
**Input:** `docs/superpowers/reviews/2026-04-15-expression-engine-review.md` (28 findings, 26 resolved, 2 deferred)

---

## Pattern Analysis

### Pattern 1: Parallel Implementation Parity Drift (SYSTEMIC -- NEW RULE PROPOSED)

**Findings:** RF-002, RF-003, RF-005, RF-006, RF-015, RF-016 (6 findings, 3 Critical + 3 High)

**What happened:** The frontend TypeScript expression evaluator was written independently from the Rust evaluator. Both implement the same logical operations (size unit conversion, color channel extraction/mutation, blend modes, contrast calculation) but diverged on semantics:
- `rem()` and `em()` were inverted (TS returned the input divided by base, Rust returned multiplied)
- `contrast()` took 2 args in TS, 1 arg in Rust
- Channel scales differed (0-1 vs 0-255 for RGB, 0-1 vs 0-100 for saturation/lightness)
- Blend mode names used underscores in TS, hyphens in Rust
- Alpha compositing was missing from the TS blend implementation

**Why this is systemic:** This project has a Rust core with a TypeScript frontend. Any feature that requires computation in both environments (expression evaluation, color math, layout constraints, validation) will produce this same drift unless explicitly guarded against. The existing "Validation Must Be Symmetric Across All Transports" rule covers validation checks but not behavioral semantics of parallel implementations.

**Proposed rule (CLAUDE.md Section 11):**

> ### Parallel Implementations Must Have Parity Tests
>
> When the same algorithm, function set, or computation is implemented in both Rust (`crates/core/`) and TypeScript (`frontend/`), the PR that introduces the second implementation MUST include cross-language parity tests. For each function or behavior implemented in both languages:
> 1. Define a shared test vector file (JSON) in `tests/fixtures/parity/` containing input-output pairs.
> 2. The Rust test suite must load the vectors and assert the Rust implementation produces the expected outputs.
> 3. The TypeScript test suite must load the same vectors and assert the TypeScript implementation produces the expected outputs.
>
> Test vectors must cover: (a) normal inputs, (b) boundary values (0, 1, max), (c) the specific semantics that are most likely to diverge (scale/range of numeric values, argument order, naming conventions, edge case behavior). If a function intentionally differs between Rust and TypeScript (e.g., because the frontend uses a simplified approximation), document the divergence in a comment in both implementations and exclude it from parity vectors with a rationale.
>
> This rule exists because PR #XX (Spec 13d) shipped 6 Critical/High bugs where the TypeScript expression evaluator diverged from the Rust evaluator on function semantics -- inverted size functions, different channel scales, different blend mode naming, and missing alpha compositing.

**Agent prompt update (Architect):** Add a mandatory check:

> ### Cross-Language Parity Check
> When a PR implements the same computation in both Rust and TypeScript:
> 1. Verify shared test vectors exist in `tests/fixtures/parity/`.
> 2. Verify both test suites load and assert against the same vectors.
> 3. If no parity vectors exist, report as High -- "parallel implementation without parity tests."

**Agent prompt update (FE):** Add to Standards section:

> ### Cross-Language Parity
> When implementing a function or algorithm that also exists in the Rust core crate, you MUST verify your implementation matches the Rust semantics exactly. Read the Rust source before writing TypeScript. Create shared test vectors (see CLAUDE.md Section 11 "Parallel Implementations Must Have Parity Tests"). Do not assume naming conventions, value scales, or argument orders -- verify each one against the Rust implementation.

**Agent prompt update (BE):** Add to Defensive Coding section:

> - When implementing an algorithm in `crates/core/` that will also be implemented in the frontend (expression evaluation, color math, layout), create a JSON test vector file in `tests/fixtures/parity/` alongside the Rust tests. The frontend implementer needs this to verify parity.

**CI enforcement potential:** A CI check could verify that for every file in `tests/fixtures/parity/`, both a Rust test and a TypeScript test reference it. This is automatable but not urgent -- the rule and agent checks should catch most cases during review.

---

### Pattern 2: Derive Deserialize Bypassing Validation (ONE-OFF)

**Finding:** RF-001 (Critical)

**Assessment:** The existing rule "No Derive Deserialize on Validated Types" in `rust-defensive.md` already covers this exactly. The BE agent prompt also includes "Never `#[derive(Deserialize)]` on types with validating constructors." This was a miss during implementation, not a rule gap. No rule change needed.

**Recommendation:** No action required. The rule exists and is well-documented. The implementation agent failed to apply it. This is within the expected error rate for a single occurrence.

---

### Pattern 3: Duplicated Helper Functions (ONE-OFF)

**Finding:** RF-014 (Major)

**Assessment:** Covered by the existing Rust rule "Define all validation artifacts in `validate.rs`" and the frontend rule "Business Logic Must Not Live in Inline JSX Handlers" (which prohibits duplication). One-off miss during implementation. No rule change needed.

---

### Pattern 4: Silent Garbage on Unsupported Type Variant (BORDERLINE -- MONITOR)

**Finding:** RF-010 (Major)

**What happened:** Color functions received Oklch/Oklab color values and silently treated their channels as sRGB, producing nonsensical results. The fix was to return an error for unsupported color spaces.

**Assessment:** This is a specific instance of a more general pattern: a function receives a typed value whose variant it cannot meaningfully handle, and instead of failing, it reinterprets the data under wrong assumptions. The existing "No Silent Clamping" rule covers range violations but not type/variant mismatches. The existing "NodeKind Variants Must Have Complete Validation Coverage" rule covers exhaustive matching but is specific to NodeKind.

**Decision: Monitor, do not add a rule yet.** This is one occurrence. If a second instance appears (e.g., a layout function receiving a node type it doesn't understand and producing wrong geometry, or a serializer receiving a format variant it doesn't support and writing garbage), then generalize to a rule like "Functions Must Reject Unrecognized Type Variants Explicitly." For now, the Rust compiler's exhaustive match checking provides some protection, and the specific fix is in place.

---

## Deferred Findings

Two findings were deferred from this review cycle. Both need to be added to the deferred findings tracker.

### RF-020: Undo Rollback Does Not Remove History Entry

**Severity:** Medium
**Description:** When a server mutation fails after an optimistic update, the error handler reverts the store state but does not remove the undo history entry that was created for the optimistic change. This produces a "ghost" undo step.
**Assessment:** This is a pre-existing issue, not introduced by the expression engine. It is already tracked as RF-009 in the deferred findings tracker under "Frontend Store / Undo" with the same description. No new entry needed -- it is a duplicate of an already-tracked finding.

### RF-025: No AST Caching for Expression Evaluation

**Severity:** Minor (deferred as optimization)
**Description:** The TypeScript expression evaluator re-parses expression strings on every evaluation. For frequently-evaluated expressions (e.g., in a render loop), this is wasteful.
**Assessment:** This is a performance optimization, not a correctness issue. It should be tracked but is low priority.

---

## Summary of Proposed Changes

| Change | Target | Rationale | Priority |
|---|---|---|---|
| New rule: "Parallel Implementations Must Have Parity Tests" | CLAUDE.md Section 11 | 6 Critical/High findings from parity drift | High |
| New mandatory check: "Cross-Language Parity Check" | `.claude/agents/architect.md` | Architect should catch missing parity tests during review | High |
| New section: "Cross-Language Parity" | `.claude/agents/fe.md` | FE agent must verify against Rust implementation | High |
| New bullet: parity test vectors | `.claude/agents/be.md` | BE agent must create vectors for frontend to verify against | Medium |
| Add RF-025 to deferred tracker | `docs/superpowers/plans/deferred-findings.md` | Track optimization deferral | Low |
| RF-020 is a duplicate of existing RF-009 | N/A -- already tracked | No action needed | N/A |

## Decision Record

- **Pattern 4 (silent garbage on unsupported variant):** Decided to monitor rather than add a rule. One occurrence is not enough to justify a new convention. Will revisit if a second instance appears.
- **Patterns 2 and 3:** Existing rules are sufficient. No governance changes needed for one-off implementation misses.
- **No rules removed:** All existing rules remain relevant to this review cycle.
