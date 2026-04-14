# PR #54 Governance Review

**Date:** 2026-04-14
**Reviewer:** Governance Agent
**Input:** 36 findings from PR #54 review (14 resolved, 7 deferred to MCP PR, 12 deferred to follow-ups, 2 won't-fix)

---

## Pattern Analysis

### Systemic Patterns Found

**1. Optimistic undo entries not cleaned up on server failure (RF-009)**

The existing rule "Error Recovery Must Not Produce User-Visible Side Effects" (frontend-defensive.md) says the revert mechanism must not *create* undo entries. But it does not address the scenario where an undo entry was already committed during the optimistic update phase, and the subsequent server call fails. The entry was legitimately created (it tracks the optimistic mutation), but if the rollback reverts the store state, the undo entry now points to a mutation that no longer exists -- producing a ghost undo step.

This is the second time undo/rollback interaction has surfaced as an issue (the first was in PR #39's transparent undo work). This warrants a rule update.

**Proposed rule update** -- append to "Error Recovery Must Not Produce User-Visible Side Effects" in `.claude/rules/frontend-defensive.md`:

> This obligation extends to optimistic updates. When a mutation uses the optimistic update pattern (apply locally, then send to server), and the server call fails, the error handler MUST remove the undo entry that was created for the optimistic local change before reverting the store. A rollback that reverts the store but leaves the undo entry produces a ghost undo step -- the user presses Ctrl+Z and the operation appears to succeed (the entry is popped) but nothing changes (the state was already reverted). The rollback API must support entry removal without triggering a new undo/redo cycle.

**Status:** PROPOSE -- pending user review.

---

### One-Off Findings (no rule needed)

**2. Compound operations simulated as sequential mutations (RF-008)**

Token rename implemented as create+delete. This is a design-level issue, not a coding pattern issue. The existing spec authoring requirement "Consistency Guarantees" already mandates that specs identify which operations must be atomic. The fix is a `RenameToken` FieldOperation in the core crate (tracked for Spec 13d). No new rule needed -- the spec requirement just needs to be followed.

**3. Asymmetric validation between frontend and Rust (RF-004)**

Frontend regex allowed `/` in token names; Rust rejected it. This is a violation of the existing rule "Validation Must Be Symmetric Across All Transports." The rule is correct and was already specific enough to catch this. The issue was that the implementer did not follow the rule. No update needed.

**4. MCP broadcast payload mismatches (RF-001/002/003/015/016)**

These are violations of the existing "MCP Broadcast Payload Shape Contract" rules. The contract is clear and specific. The violations are pre-existing (from Spec 13a) and were not caught because that PR predated the contract rules. Now that the rules exist, any future MCP tool implementation should follow them. No update needed.

**5. Duplicated type conversion logic (RF-024/026)**

RF-024 resolved by extracting to `token-helpers.ts`. RF-026 (Rust side) is a one-off in MCP code. The existing Rust consolidation rule covers validation artifacts but not general type conversion helpers. However, one occurrence in MCP code does not warrant broadening the rule -- the MCP parity PR will clean this up.

**6. ARIA role conflicts on semantic elements (RF-021/028)**

`<span role="link">` and `<h3 role="button">` are standard HTML semantics errors, not a project-specific pattern. One resolved, one deferred. The existing a11y rules cover ARIA slider semantics and landmark roles, but ARIA role conflicts on semantic elements are basic HTML knowledge that does not need a project rule.

---

## Existing Rules Audit

No existing rules need removal or modification (beyond the RF-009 extension proposed above). All rules referenced during this review remain relevant and correctly scoped.

### Rules Validated by This Review

The following rules were directly exercised by PR #54 findings and confirmed to be correctly specified:
- "Validation Must Be Symmetric Across All Transports" (caught RF-004)
- "MCP Broadcast Payload Shape Contract" (caught RF-001/002/003)
- "Side-Effect Artifacts Must Be Constructed After Precondition Verification" (caught RF-016)
- "Constants Must Be Enforced" / "Constant Enforcement Tests" (caught RF-027)
- "CSS-Rendered String Fields Must Reject CSS-Significant Characters" (caught RF-023)

---

## Agent Prompt Updates

No agent prompt updates are proposed. The findings mapped cleanly to existing review agent responsibilities.

---

## CI Check Proposals

None. The proposed rule extension (RF-009) is not mechanically enforceable via CI -- it requires human/agent review to verify that error handlers clean up undo entries.

---

## Summary

| Category | Count | Action |
|---|---|---|
| New rules proposed | 0 | -- |
| Rule updates proposed | 1 | Extend "Error Recovery" rule for optimistic undo cleanup |
| Rules confirmed correct | 5 | No changes |
| Rules to remove | 0 | -- |
| Agent prompt updates | 0 | -- |
| CI check proposals | 0 | -- |
