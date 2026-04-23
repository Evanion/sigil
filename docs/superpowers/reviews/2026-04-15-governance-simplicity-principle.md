# Governance Proposal: Design Decision Tiebreaker Principle

**Date:** 2026-04-15
**Reviewer:** Governance Agent
**Trigger:** Token expression syntax decision in Spec 13e — chose `lighten({brand.primary}, 20%)` over `{lighten(brand.primary, 20%)}` because it produces simpler parsing, simpler highlighting, and a clearer autocomplete trigger, despite deviating from external tool conventions (Tokens Studio).

---

## Gap Analysis

### Current State

The Constitution (Section 1) contains a tension between two principles that currently have equal weight and no tiebreaker:

1. **Code Quality** says "Prefer small, focused files with clear interfaces" — implies a preference for simplicity, but does not explicitly address design-level decisions where external convention and internal simplicity conflict.

2. **User Experience Consistency** says "The editor must feel like Figma/Penpot — follow established design tool conventions" — implies conformance to external tools as a default.

Neither principle addresses what to do when they conflict. The token expression syntax decision is a concrete example: Tokens Studio uses outer-brace wrapping (`{lighten(brand.primary, 20%)}`), but inner-brace references (`lighten({brand.primary}, 20%)`) produce a simpler tokenizer, a simpler highlighter, a clearer autocomplete trigger, and fewer edge cases. The team chose internal simplicity, but the Constitution does not document why that was the right call or when this tradeoff applies.

### Why This Is Systemic

This is not a one-off decision. The project will face this pattern repeatedly:

- **Keyboard shortcuts:** Figma uses `O` for ellipse; some tools use `E`. Which do we follow when conventions differ?
- **Layer panel behavior:** Figma collapses groups on single click; Penpot requires double-click. Both are "established conventions."
- **Token format:** W3C Design Token Community Group has a draft spec with specific JSON shapes. Our internal format may be simpler but incompatible.
- **Export syntax:** CSS custom properties vs. Tailwind theme config vs. SCSS variables — external expectations differ per ecosystem.

Every time two valid external conventions conflict, or an external convention produces unnecessarily complex internal code, the team needs a decision framework. Without one, each decision is ad hoc and the reasoning is lost.

### What This Is Not

This is NOT a license to ignore established UX patterns. The existing rule "The editor must feel like Figma/Penpot" remains the default for user-facing interaction patterns (keyboard shortcuts, selection behavior, tool switching, layer management). The proposed principle applies to **internal design decisions** (data formats, expression syntax, wire protocols, internal APIs) where the user impact is equivalent but the implementation complexity differs.

---

## Proposed Change

Add a new subsection to Section 1 (Constitution) titled **"Design Decision Criteria"**, placed after "Code Quality" and before "Testing Standards". This positioning reflects that it is a meta-principle about how to make design choices, not a specific quality requirement.

### Proposed Text

```markdown
### Design Decision Criteria

When a design choice has multiple valid options — particularly when external convention and internal simplicity point in different directions — apply these criteria in order:

1. **Correctness** — does the design produce correct behavior in all cases? Reject options with known edge-case failures regardless of convention or simplicity.
2. **Robustness** — does the design minimize the surface area for bugs? Fewer code paths, fewer special cases, and fewer states mean fewer failure modes. Prefer the option that is hardest to use incorrectly.
3. **Simplicity** — does the design produce simpler code? Simpler parsing, simpler validation, simpler testing. Code that is easier to understand is easier to maintain and easier to verify.
4. **Convention** — does the design follow established external conventions? Convention reduces surprise for users and contributors. But convention is the tiebreaker, not the primary criterion — it applies only when the options above do not distinguish the candidates.

When a design deviates from an external convention, the deviation MUST be documented in the spec or ADR with: (a) what the convention is and who uses it, (b) why the chosen design scores higher on correctness, robustness, or simplicity, and (c) what user-facing impact the deviation has (if any). A deviation without documentation is an unforced error — future contributors will "fix" it back to the convention without understanding why it was changed.

This principle does NOT apply to user-facing interaction patterns (keyboard shortcuts, selection behavior, tool switching) where the user's muscle memory is the dominant concern. For interaction patterns, "follow Figma/Penpot conventions" remains the default — override only with strong usability evidence.
```

---

## Rationale

### Why this belongs in the Constitution

The Constitution defines "the governing rules of this project" and "explain[s] the _why_ behind every convention." A decision-making framework is exactly this — it explains why specific technical choices are made and provides a repeatable process for future decisions. Without it, the Constitution contains a contradiction (simplicity vs. convention) with no resolution mechanism.

### Why a ranked list, not a blanket "simplicity wins"

A blanket "prefer simplicity" principle would be too broad. It could be misapplied to justify ignoring important conventions (like WCAG accessibility patterns, or W3C specs that enable interoperability). The ranked list makes the criteria explicit and ordered: correctness first, then robustness, then simplicity, with convention as the tiebreaker. This means convention wins when the options are otherwise equivalent — which is the common case for most UX decisions.

### Why the documentation requirement

The biggest risk of a "simplicity over convention" principle is that it becomes a rationalization for laziness — "I didn't implement it the standard way because it was simpler" without actually analyzing whether the simpler approach is correct and robust. The documentation requirement forces the decision-maker to articulate the tradeoff explicitly. It also creates a record that future contributors can reference when they encounter the deviation and wonder why.

### Why interaction patterns are excluded

Keyboard shortcuts, selection behavior, and tool switching are cases where user muscle memory dominates. A user who has spent years in Figma expects `V` for select and `R` for rectangle. Internal code simplicity is irrelevant here — the user's experience is determined by whether the tool feels familiar. The UX Consistency principle already covers this correctly.

---

## Impact on Existing Rules

### Rules That Remain Unchanged

- "The editor must feel like Figma/Penpot" — still the default for interaction patterns. The new principle explicitly carves out interaction patterns as exempt.
- "Prefer small, focused files" — this is a code organization rule, not a design decision criterion. No conflict.
- All defensive coding rules — these are enforcement mechanisms, not decision frameworks. No conflict.

### Potential Future Application

This principle would have been useful in prior decisions that were made ad hoc:

- **GraphQL over REST** (Spec 08) — chosen for type safety and reduced round trips, deviating from the simpler REST convention. Would score higher on robustness and simplicity under this framework.
- **Solid.js over React** — chosen for fine-grained reactivity without virtual DOM, deviating from the most popular convention. Would score higher on performance (a form of robustness) under this framework.
- **Native popover/dialog over Kobalte** (PR #54) — chosen because the native implementation avoids Kobalte's portal context chain bugs. Would score higher on correctness and robustness under this framework.

---

## Agent Prompt Updates

No agent prompt updates are needed for this change. The principle operates at the spec and design level, not at the code review level. Agents already check for correctness, robustness, and convention compliance — this principle just codifies how to resolve conflicts between those checks.

---

## CI Check Proposals

None. Design decision criteria are not mechanically enforceable. The documentation requirement could theoretically be checked by verifying that specs with "deviates from" or "differs from" language include the required (a), (b), (c) documentation, but this would produce too many false positives to be useful.

---

## Summary

| Change | Target | Rationale | Priority |
|---|---|---|---|
| New subsection: "Design Decision Criteria" | CLAUDE.md Section 1 (Constitution), after "Code Quality" | Resolves the implicit tension between simplicity and convention; provides a repeatable decision framework with documentation requirements | Medium |

**Status:** PROPOSE — pending user review. This should be applied to CLAUDE.md only after explicit approval. The principle is foundational (Constitution-level) and affects how all future design decisions are evaluated.
