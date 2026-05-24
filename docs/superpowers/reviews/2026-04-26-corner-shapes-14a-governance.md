# Governance Proposal — `feature/corner-shapes-14a`

**Branch:** `feature/corner-shapes-14a`
**Date:** 2026-04-26
**Source review:** `docs/superpowers/reviews/2026-04-26-corner-shapes-14a.md` (41 findings)
**Scope:** Plan 14a — Corner shapes data layer (`Corner` enum, v1→v2 migration, shorthand parsers, schema-panel handler).

This document proposes new and modified governance rules based on recurring patterns across the 41 findings. **No rule files were edited.** Each proposal includes the exact rule text, target file, and rationale. The summary table at the end lists status (NEW / MODIFY / NO CHANGE) for each pattern reviewed.

The proposals deliberately exclude one-off domain bugs (e.g., specific ARIA omissions, a single duplicated cast) where no class-of-bugs pattern recurred.

---

## Pattern 1 — Broadcast payloads constructed from raw input rather than post-mutation canonical state

**Findings:** RF-001 (GraphQL `setField` broadcasts shorthand `{shape,radius}` instead of canonical 4-element array), RF-004 (broadcast payload constructed before lock/precondition verification across all 28 `parse_set_field` paths).

**Existing coverage:**

CLAUDE.md §4 has the **MCP Broadcast Payload Shape Contract**:
> `value` shape must match what the frontend handler for that `op_type` destructures (e.g., `reparent` expects `{parentUuid, position}` — not a bare string).

`rust-defensive.md` has **Side-Effect Artifacts Must Be Constructed After Precondition Verification**:
> all side-effect artifacts (broadcast payloads, response objects, audit log entries) MUST be constructed AFTER the lock is acquired and AFTER preconditions (entity exists, fields valid) are confirmed.

Both rules existed and were violated. The MCP contract is scoped to MCP only — RF-001 was on the GraphQL path. The "after precondition" rule was followed for layout but not for **content**: the broadcast `value` was sourced from raw user input rather than post-mutation document state, even though it was emitted at the correct time.

**Proposal — MODIFY:** Extend the MCP Broadcast Payload Shape Contract in CLAUDE.md §4 to cover GraphQL and to mandate canonical post-mutation sourcing.

Target: CLAUDE.md §4, inside the "MCP Broadcast Payload Shape Contract" section. Rename the section to **"Broadcast Payload Shape Contract (MCP and GraphQL)"** and add this rule to the bulleted list:

> - **Broadcast `value` must be sourced from post-mutation document state, not from the raw API input.** When an API accepts shorthand or polymorphic input forms (e.g., scalar-as-shorthand, partial-object-as-shorthand), the server-side handler MUST canonicalize the broadcast `value` by reading the post-apply state from the document — not by forwarding the request's input JSON. Forwarding raw input breaks shorthand-to-canonical contracts: connected frontends decode only the canonical form, and silently drop the shorthand. This rule applies symmetrically to GraphQL mutations, MCP tool calls, and any future transport that broadcasts.

**Why:** RF-001 was a Critical defect. GraphQL `setField(kind, {shape:"round",radius:8})` broadcast the shorthand verbatim; the frontend dispatcher (`apply-remote.ts case "kind"`) only handles the canonical 4-element array form, so connected clients silently missed every GraphQL-originated corner change. The MCP path was correct because it happened to serialize from `node.kind` post-apply. Without this rule, every future shorthand-accepting field will reproduce the same bug.

---

## Pattern 2 — Silent data coercion / silent no-op on invalid or partial input

**Findings:** RF-005 (migration coerces malformed v1 `corner_radii` to `[0,0,0,0]`), RF-008 (single-axis edit silently overwrites pre-existing y radius), RF-015 (`setCorners` silent no-op on parse failure), RF-030 (apply-remote silent early returns), RF-037 (`?? DEFAULT_SMOOTHING` masks invariant violation).

**Existing coverage:**

CLAUDE.md §11 has **No Silent Clamping of Invalid Input**:
> Never silently clamp, truncate, or coerce an invalid input value to a valid range (e.g., `position.max(0)`, `name.truncate(MAX_LEN)`). Silent clamping masks bugs in callers...

The rule covers Rust and TypeScript and "all boundaries (API handlers, MCP tools, deserialization, UI callbacks)". Five findings still landed in this PR. Inspecting the failure modes:

1. **RF-005** is silent **coercion of malformed legacy data during a migration** — not strictly clamping; the rule should explicitly enumerate "migrations" as a boundary.
2. **RF-008** is silent **destruction of an orthogonal field** by an incomplete update — not invalid input, but a partial update applied as if it were complete. The existing rule does not name this case.
3. **RF-015** and **RF-030** are silent **early returns** on the receiving end of an internal API (store function, broadcast dispatcher) — not strictly invalid input, but a request to mutate that quietly does nothing.
4. **RF-037** is silent **fallback for missing required fields** on a discriminated-union variant whose variant invariant should guarantee the field exists.

These are all variants of the same disease — "the operation didn't do what the caller requested, and the caller has no signal" — but they don't all read cleanly as "invalid input clamping". The existing rule reads as a Rust-style validate-at-boundary rule and is being mis-applied as "only invalid input rejection".

**Proposal — MODIFY + NEW:**

**(a) MODIFY** CLAUDE.md §11 "No Silent Clamping of Invalid Input" — add a paragraph extending coverage to migrations and partial updates:

> This obligation extends to **migrations** (any function that transforms data between schema versions): a present-but-malformed legacy field (wrong type, NaN, infinity, out-of-arity) MUST produce a typed migration error, not be coerced to a default. A truly absent field MAY default with a comment naming the default. The distinction between "missing" and "malformed" must be made explicit in code.
>
> The obligation also extends to **partial updates of multi-field values**: when a UI control or API edits one field of a composite value (e.g., one axis of a 2D point, one corner of a 4-corner array, one cell of a matrix), the handler MUST preserve every field it did not explicitly edit. Reading the other fields' current values and writing them back unchanged is required; relying on a default value for an un-edited field silently overwrites data set by another path (MCP, another panel, undo redo).

**(b) NEW** rule in `frontend-defensive.md` — **Internal Mutation Entry Points Must Diagnose Their Own No-Ops**.

Target: `.claude/rules/frontend-defensive.md`, new section directly after "Defensive Message Parsing":

> ### Internal Mutation Entry Points Must Diagnose Their Own No-Ops
>
> Every store function or remote-operation handler that can early-return without mutating MUST emit a `console.warn` (for invariant-class no-ops) or `console.error` (for type-system invariant violations) identifying the rejection cause, the target entity, and a structured payload of the relevant context. Examples that require a diagnostic:
>
> - Target node missing from store (e.g., `setCorners` called with stale uuid).
> - Target kind does not accept the field (e.g., `setCorners` on a Text node).
> - Input failed shape parsing (e.g., `parseCornersInput` returns null).
> - Broadcast handler rejects payload after validation (every early-return in `apply-remote.ts`).
> - Discriminated-union narrowing fallback fires (e.g., `??` default for a field the type system says must be present).
>
> "It compiled and ran but did nothing" is the worst diagnostic outcome of a remote-operation pipeline — there is no error trail in production and no test failure in development. The warn/error message MUST be structured (an object payload, not a sentence) so it can be queried and aggregated in logs. Mirrors CLAUDE.md §11 "No Silent Clamping" for the **receiving** side of an internal API.

**Why:** RF-005 was High (silent corruption of migrated data with no operator signal). RF-008 was High (silent data loss for MCP-set elliptical radii). RF-015, RF-030, RF-037 were Medium/Low but all share the same failure mode: a misbehaving caller (server bug, compromised peer, type-narrowing violation) produces no diagnostic trail. Five findings in one PR exceeds the "two-or-more recurring pattern" threshold.

---

## Pattern 3 — Default-state factories return aliased object references

**Findings:** RF-006 (`defaultCorners()` returns `[c, c, c, c]` — same object 4 times), RF-021 indirectly (default-Round Rust emits 4 identical 50-byte objects to JSON — separate issue but same factory shape).

**Existing coverage:** None. CLAUDE.md and the rule files do not address default-value factories at all.

**Proposal — NEW** rule in `frontend-defensive.md` — **Default-Value Factories for Mutable Containers Must Construct Independent Instances**.

Target: `.claude/rules/frontend-defensive.md`, new section after "Polymorphic Style Setter APIs Must Use Discriminated Unions":

> ### Default-Value Factories for Mutable Containers Must Construct Independent Instances
>
> Any function returning a default instance of a mutable container (array, object with mutable nested objects) MUST construct each element with a fresh allocation. The shorthand `Array(n).fill(x)`, `[x, x, x, x]`, or `Array.from({length: n}, () => x)` where `x` is itself an object produces N references to the SAME object — mutating one element mutates all of them. This is a latent footgun for any future positional in-place mutation, even if today's callers happen to treat the array as immutable.
>
> Pattern: `Array.from({length: n}, () => makeFresh())` where `makeFresh` allocates the nested object too — NOT `Array(n).fill(makeOnce())`. Every default-factory function MUST have a test that asserts `result[i] !== result[j]` for at least one pair of distinct indices AND, for arrays of objects with nested mutable fields, asserts that `result[i].nestedField !== result[j].nestedField`. A docstring claim of "fresh tuple, callers may mutate without aliasing" is not enforcement — the test is.
>
> Applies equally to Rust factory functions returning `[T; N]` of types containing `Box`, `Vec`, or other heap-allocated content (`Vec::clone` on each element is not free but is correct; `[v.clone(); N]` evaluates `v.clone()` once and then bit-copies — incorrect for types containing `Rc`/`Arc` if interior mutability is in play).

**Why:** RF-006 was High. The aliasing was visible from the docstring ("fresh tuple … callers may mutate without aliasing") but the test didn't assert it; one inattentive refactor of any consumer (e.g., a per-corner in-place axis update) would have corrupted all 4 corners. The companion bug in `parseCornersInput` (commit 13d8d1d) shows the same pattern recurs in shorthand parsers, not just default factories — making the rule explicit prevents both classes.

---

## Pattern 4 — Migrations need persistence + backup discipline

**Findings:** RF-009 (v1→v2 in-memory but on-disk stays v1 until next user mutation), RF-010 (migration overwrites v1 with no backup).

**Existing coverage:** None. The "Migrations Must Remove All Superseded Code" rule in CLAUDE.md §11 is about API/library migrations, not schema migrations. CLAUDE.md §4 "File Persistence Safety" covers atomic writes but says nothing about migration semantics.

**Proposal — NEW** rule in CLAUDE.md §4 "File Persistence Safety" (under `agent-designer-server`):

> #### Schema Migration Persistence Contract
>
> When the server loads a workfile that requires a schema version upgrade (v1→v2, etc.), the load path MUST satisfy three obligations before returning success:
>
> 1. **Force persistence.** The loaded document must be marked dirty (or written synchronously at end of load) so the next persistence tick writes the upgraded schema to disk. A migrated document that lives only in memory is a silent migration — server restart re-runs it, and the v1 file lingers indefinitely.
> 2. **Back up the legacy artifacts.** Before the first migrated write overwrites any file in the workfile directory, the original v(N-1) `manifest.json` and `pages/*.json` MUST be copied to a sibling `.backup-v(N-1)/` directory. Migration is one-way; an unintended round-trip mutation must be recoverable. The backup is a one-shot — re-running the server on an already-migrated workfile MUST NOT touch the existing backup.
> 3. **Plumb a `migrated_from` signal end-to-end.** The `LoadedWorkfile` type (or equivalent) MUST carry an `Option<u32>` indicating the source schema version; the persistence task MUST read this signal and trigger the dirty-flag and backup obligations.
>
> A CI smoke test MUST exercise each new migration path against a checked-in legacy fixture and assert: (a) `load_workfile` succeeds, (b) post-load persistence tick produces a v(N) on-disk file, (c) the `.backup-v(N-1)/` directory exists and contains the original fixtures.

**Why:** Both RF-009 and RF-010 were High and both are recurring concerns whenever schema version bumps occur. Without a documented contract, every future migration (v2→v3) re-litigates these decisions. The CLI subcommand (RF-028) and integration test (RF-029) are downstream of this rule — once the contract exists, those become enforcement requirements rather than ad-hoc reviewer catches.

---

## Pattern 5 — Discriminated-union exhaustiveness across cross-cutting dispatch sites

**Findings:** RF-014 (wildcard `other =>` on `NodeKind` in `SetCorners` and GraphQL), RF-033 (no exhaustiveness sentinel for `Corner` TS union), RF-041 (wildcard arm on string-typed kind dispatch in migrations).

**Existing coverage:**

`rust-defensive.md` has **NodeKind Variants Must Have Complete Validation Coverage**:
> A `match` that uses a catch-all (`_ =>`) arm for a `NodeKind` dispatch is a bug — it silently ignores new variants. All `NodeKind` matches in `crates/core/` must be exhaustive with no wildcard arms.

This rule is specific to Rust `NodeKind` and only requires arms in `crates/core/`. It does not cover:

- **GraphQL crate matches on `NodeKind`** (RF-014's second site, in `mutation.rs` outside core).
- **TypeScript discriminated unions** (RF-033 — `Corner` enum in `frontend/src/types/document.ts`).
- **String-typed kind dispatch** (RF-041 — `serde_json::Value` "type" strings in migrations, where Rust exhaustiveness can't help).

**Proposal — MODIFY + NEW:**

**(a) MODIFY** `rust-defensive.md` "NodeKind Variants Must Have Complete Validation Coverage" — broaden from `NodeKind` and `core` to all discriminated unions and all crates:

Replace the section title and the dispatch-sites list with:

> ### Discriminated-Union Dispatch Must Be Exhaustive Across All Crates
>
> When a new variant is added to a discriminated enum used as a dispatch discriminant — `NodeKind`, `Corner`, `Fill`, `Effect`, or any future enum whose variants drive `match` arms in business logic — the same PR MUST add a corresponding arm to **every dispatch site that branches on that enum in the entire workspace**, not just in `crates/core/`. The mandatory sites for a `NodeKind`-class enum are:
>
> 1. The variant's `validate` path (e.g., `CreateNode::validate` for `NodeKind`, `validate_corners` for `Corner`).
> 2. The workfile deserialization path.
> 3. Every `match` on the enum in any crate (`core`, `server`, `mcp`, `state`) — discovered via `cargo clippy --workspace`.
> 4. The frontend's mirror type (`frontend/src/types/document.ts`) and every consumer of the mirror.
>
> A `match` that uses a catch-all (`_ =>`) arm in any crate is a bug. The exception is `serde_json::Value` string matches (where exhaustiveness is impossible) — those MUST list every accepted string explicitly and document the closed set; a wildcard arm in such a match must have a comment naming the closed set it covers (see migrations example).

**(b) NEW** rule in `frontend-defensive.md` — **Discriminated Unions Must Have a Type-Level Exhaustiveness Sentinel**:

Target: `.claude/rules/frontend-defensive.md`, new section directly after "Polymorphic Style Setter APIs Must Use Discriminated Unions":

> ### Discriminated Unions Must Have a Type-Level Exhaustiveness Sentinel
>
> Every TypeScript discriminated union used for runtime dispatch (`Corner`, `Fill`, `Effect`, `NodeKind` mirror, any `type X = A | B | C` with a discriminant field) MUST have a colocated type-level test that exhaustively switches on the discriminant and ends with a `default: const _exhaustive: never = x;` sentinel. The test goes in a `.test-d.ts` file (vitest type-test) so adding a new variant without updating downstream dispatch sites fails `tsc --noEmit` rather than silently shipping a runtime no-op.
>
> Pattern:
>
> ```ts
> function _cornerExhaustive(c: Corner): string {
>   switch (c.type) {
>     case 'round': return 'round';
>     case 'bevel': return 'bevel';
>     case 'notch': return 'notch';
>     case 'scoop': return 'scoop';
>     case 'superellipse': return 'superellipse';
>     default: { const _x: never = c; return _x; }
>   }
> }
> ```
>
> The exhaustiveness sentinel must include every set/map/array that branches on the discriminant — `VALID_CORNER_TYPES`, `CORNER_BEARING_KINDS`, renderer dispatch tables — by referencing them in the test body so a new variant fails the test if any one of them is out of date.

**Why:** Three findings on dispatch exhaustiveness in a single PR. The existing rule was followed in core but not in `server` (RF-014) and was completely absent from TypeScript (RF-033). RF-041 reveals a third case — `serde_json::Value` string-typed dispatch — which is fundamentally inexhaustible and needs its own treatment.

---

## Pattern 6 — Data layer ships ahead of UI without an explicit deferral contract

**Findings:** RF-002 (4 of 5 new corner shapes unreachable from UI), RF-011 (renderer ignores new field — deferred to 14b/c), RF-025 (current corner shape invisible — deferred to 14d), RF-026 (linked-corners rule unobservable — deferred to 14d), RF-027 (Superellipse uniformity constraint not surfaced — deferred to 14d), RF-038 (section disappears silently for unsupported kinds — deferred to 14d).

**Existing coverage:** CLAUDE.md §7 "Pull Request Process" lists deferral as acceptable for Medium findings only ("All Medium findings are resolved or explicitly deferred with rationale"). It does not require deferrals to be **proactively** announced in the PR description or to gate downstream merges. The "Behavioral Inventory Before Deleting Implementation Code" rule comes closest but is about deletion, not staged-feature delivery.

The recurrence of these findings across multiple reviewers (UX flagged 4 separately; Data Scientist and FE flagged the renderer gap) suggests reviewers DO catch them, but only at review time — which is the wrong phase. The cost is repeated re-explanation in finding rationale and risk that a data-layer PR merges while the UX is non-functional.

**Proposal — NEW** rule in CLAUDE.md §10 (Spec Authoring Requirements):

> ### Staged Feature Delivery Contract
>
> When a spec is split into sub-plans (e.g., Spec 14 → Plans 14a/14b/14c/14d) and the first sub-plan ships data-layer changes without the UI, renderer, or visible affordances that consume them, the sub-plan's PR description MUST include a section titled **"Deferred-to-later-plan inventory"** enumerating:
>
> 1. Every user-visible capability introduced by the data layer that is NOT yet reachable from the UI.
> 2. Every existing UI that would visibly degrade (silent rejection, no shape selector, ignored field) until a later plan lands.
> 3. The specific later plan that owns each deferred item, with a one-line justification of why the staged delivery is safe (e.g., "no public release between sub-plans" or "feature flag prevents user exposure").
>
> The same inventory MUST be cross-referenced in the parent spec's deferred-findings table. Reviewers seeing a data-layer PR are explicitly instructed to NOT file new findings for items present in this inventory — they are pre-disclosed deferrals.
>
> When the dependent UI sub-plan is filed, its PR description MUST reference this inventory and confirm each item is now addressed. Merging the data-layer PR without the inventory is incomplete.

**Why:** Six findings across this single PR are all variants of "the data layer works but users can't see it". Reviewers re-derived the same observation independently because there was no agreed-upon disclosure. This rule turns implicit reviewer judgment into explicit PR contract.

---

## Pattern 7 — Frontend validation constants must have a single source of truth, mirroring the Rust §5 rule

**Findings:** RF-031 (`MAX_CORNER_RADIUS` / smoothing limits duplicated module-private in `apply-remote.ts` and `corners-input.ts`).

**Existing coverage:**

CLAUDE.md §5 "Rust" has:
> Define all validation artifacts in `validate.rs`: numeric limit constants (`MAX_*`, `LIMIT_*`, `MIN_*`), character denylists, ... Do not inline these in type definition files or command modules — inline copies diverge silently.

This rule is Rust-only. The same hazard exists in TypeScript and was realized in this PR. RF-034 hit the same pattern on the Rust side (resolved by following §5). One finding alone wouldn't justify a new rule, but the parallel to §5 plus RF-034's existence make it generalizable.

**Proposal — MODIFY** CLAUDE.md §5 "TypeScript" — add a parallel rule.

Target: CLAUDE.md §5, under the TypeScript bullet list, add:

> - Validation constants (`MAX_*`, `MIN_*`, `LIMIT_*`) and validation predicates (regex patterns, allowed-character sets, type-discriminator string sets) that are used by more than one frontend module MUST be defined in a single source-of-truth module (typically `frontend/src/store/<domain>-input.ts` or `frontend/src/types/validation.ts`) and imported by every consumer. Module-private duplicates in `apply-remote.ts`, panel handlers, or schema files are forbidden — they diverge silently. The single source-of-truth module MUST be the same module that exposes the shorthand parser for the same domain (if one exists), so the constants and the parser stay co-located.

**Why:** RF-031 is Low severity but the same divergence in `validate.rs` ↔ `corners_input.rs` (RF-034) was caught at the same time. CLAUDE.md §5 already establishes the principle for Rust; making it symmetric for TypeScript is a small extension with high preventative value.

---

## Pattern 8 — `?? defaultValue` to recover from missing fields on validated discriminated-union variants

**Findings:** RF-037 (`?? DEFAULT_SMOOTHING` on a superellipse Corner whose smoothing field the variant invariant requires).

**Existing coverage:** Pattern 2's existing "No Silent Clamping" rule, and the proposed "Internal Mutation Entry Points Must Diagnose Their Own No-Ops".

**Proposal — NO CHANGE.** Single finding. The class of bugs is covered by the Pattern 2 proposals (specifically the "type-system invariant violations" bullet in the new diagnose-no-ops rule). Adding a dedicated rule about `??` fallbacks would be a one-off; covering the underlying pattern (discriminated-union variant field must always exist if the type-system says so) is already addressed.

---

## Pattern 9 — Asymmetric validation between shorthand and per-corner-array branches of the same parser

**Findings:** RF-016 (per-corner array silently accepts stray `smoothing` on non-superellipse; shorthand rejects it — asymmetric within the same crate, both in Rust `corners_input.rs` and TS `corners-input.ts`).

**Existing coverage:**

CLAUDE.md §11 has **Validation Must Be Symmetric Across All Transports**:
> When a validation check exists at one API boundary (GraphQL resolver, MCP tool handler, REST endpoint), the same check MUST exist at every other boundary that accepts the same input type.

This rule is phrased around **transport boundaries** (GraphQL vs MCP vs frontend store). RF-016 is asymmetric validation between **two parsing branches of a single shorthand parser** — the same function, different code paths. The existing rule's mental model doesn't immediately catch this case.

**Proposal — MODIFY** CLAUDE.md §11 "Validation Must Be Symmetric Across All Transports" — extend to within-parser branches.

Add a paragraph at the end of the existing section:

> Symmetry also applies **within a single parser** that accepts multiple input shapes (shorthand scalar, shorthand object, full per-item array). Every branch of a polymorphic parser MUST apply the same validation rules to the same logical field. If the shorthand branch rejects an out-of-domain field (e.g., `smoothing` on a non-superellipse shape), the per-item-array branch MUST reject it identically — silently dropping the field in one branch and rejecting it in the other is a security and data-integrity inconsistency, even though both branches live in the same function. When adding a validation check to one branch of a polymorphic parser, add it to every other branch in the same commit.

**Why:** RF-016 had to be fixed twice (Rust commit 4139ddf, TS commit ef1c7c0). The existing rule caught the Rust/TS asymmetry but not the shorthand/array asymmetry within each language. One finding alone is borderline, but the bug recurred on both sides of the language boundary — the within-parser asymmetry pattern is real.

---

## Pattern 10 — Existing rules violated rather than missing

These findings represent failures of enforcement, not gaps in the rules. They do NOT need new rules; they may need stronger CI checks or review-checklist callouts.

- **RF-007** (NumberInput `max` missing) — covered by CLAUDE.md §11 "Constants Must Be Enforced" (point 4). Rule existed; reviewer caught it. **NO CHANGE.**
- **RF-012** (`derive(Deserialize)` on `Corner`/`CornerRadii`) — covered by `rust-defensive.md` "No Derive Deserialize on Validated Types" and "Validated Types Must Have Private Fields". Rule existed; reviewer caught it. **NO CHANGE.**
- **RF-013** (`unwrap()` in `validate_corners`) — covered by CLAUDE.md §1 "no `unwrap()` or `expect()` in the core crate". Rule existed; reviewer caught it. **NO CHANGE.**
- **RF-018** (no integration test for SchemaPanel → setCorners → store) — covered by `frontend-defensive.md` "Reactive Pipelines Must Be Verified End-to-End". Rule existed; reviewer caught it. **NO CHANGE.**
- **RF-032** (`@typescript-eslint/no-explicit-any` disabled in test code) — covered by CLAUDE.md §5 "No `any` types" (unqualified). Rule existed; reviewer caught it. **NO CHANGE.**
- **RF-034** (duplicate Rust validation logic between `corners_input.rs` and `validate.rs`) — covered by CLAUDE.md §5 Rust "Define all validation artifacts in `validate.rs`". Rule existed; reviewer caught it. **NO CHANGE.**
- **RF-035** (no direct enforcement test for SetCorners) — covered by CLAUDE.md §11 "Constant Enforcement Tests". Rule existed; reviewer caught it. **NO CHANGE.**

**Optional CI enforcement to consider** (not proposed as governance changes, but flagged for the user's attention):

- A `grep` check failing the build if `crates/core/src/**.rs` contains `.unwrap()` or `.expect(` outside test modules (covers RF-013).
- A `grep` check failing the build if `#[derive(.*Deserialize.*)]` appears in `crates/core/src/node.rs` near a type with `pub fn new` (heuristic for RF-012).
- A `grep` check failing the build if `eslint-disable.*no-explicit-any` appears anywhere in `frontend/src/**.{ts,tsx}` (covers RF-032).

---

## Pattern 11 — A11y duplicate/incomplete labelling and missing `aria-controls` on disclosures

**Findings:** RF-022 (disclosure missing `aria-controls`), RF-023 (duplicate label announcement on NumberInput), RF-024 (abbreviated labels not spoken).

**Existing coverage:** `a11y-rules.md` has the WAI-ARIA slider pattern for 2D widgets and the reduced-motion rule. It does NOT cover the WAI-ARIA disclosure pattern or label-announcement double-up patterns explicitly.

**Proposal — NEW** rule in `a11y-rules.md` — **WAI-ARIA Pattern Compliance for Common Composite Widgets**.

Target: `.claude/rules/a11y-rules.md`, new section after "2D Canvas Widgets Must Have Complete ARIA Slider Semantics":

> ### Composite-Widget ARIA Patterns Must Be Complete
>
> When implementing a UI affordance that maps to a documented WAI-ARIA design pattern (Disclosure, Combobox, Tabs, Tree, Toolbar, Menu), the implementation MUST satisfy every required attribute named in the WAI-ARIA Authoring Practices for that pattern. Partial implementations (the trigger has `aria-expanded` but no `aria-controls`; a custom tab has `role="tab"` but no `aria-selected`) are non-functional for screen readers — the role declares intent but the missing state attribute leaves the user unable to navigate.
>
> For the patterns most common in this codebase:
>
> - **Disclosure** (any expand/collapse toggle): trigger MUST have `aria-expanded` AND `aria-controls={fieldsId}`, and the controlled region MUST have a matching `id`. Generate the id with `createUniqueId()`.
> - **Slider** (numeric input represented as a draggable handle or a canvas region): `role="slider"`, `aria-label`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext`. (Already covered by the 2D Canvas Widgets rule; restated here for completeness.)
> - **Label association**: a visible text node ("TL", "Top-left") and the input it labels MUST NOT both be announced. Pick ONE: either give the visible text `aria-hidden="true"` and the input an `aria-label`, OR give the visible text an `id` and the input an `aria-labelledby` pointing at it. Never both.
> - **Abbreviated labels**: any visible abbreviation (2-3 letter acronym, single-glyph icon) used to label an input MUST have a full-spoken accessible name. Either add a full-text `aria-label` to the input (preferred when the abbreviation is purely visual), or wire `aria-labelledby` to a `<span class="sr-only">` containing the full text adjacent to the abbreviation.
>
> When introducing a new affordance, name the WAI-ARIA pattern in the PR description and link to the relevant Authoring Practices section. Reviewers MUST verify every required attribute named there is present.

**Why:** Three A11y Medium findings in a single PR, all on different composite widgets. The existing a11y rules cover sliders and reduced motion but assume the implementer already knows WAI-ARIA patterns by name. This rule makes the obligation explicit.

---

## Pattern 12 — Migration spec/test infrastructure

**Findings:** RF-028 (no CLI migrate subcommand), RF-029 (no fixture-based integration test).

**Existing coverage:** Addressed by the Pattern 4 proposal (Schema Migration Persistence Contract) — its CI smoke test requirement covers RF-029, and a CLI migrate subcommand is a natural follow-on. **NO ADDITIONAL CHANGE** beyond Pattern 4.

---

## Summary table

| # | Pattern | Target file | Status |
|---|---------|-------------|--------|
| 1 | Broadcast `value` sourced from raw input | CLAUDE.md §4 (MCP Broadcast Payload Shape Contract) | MODIFY |
| 2a | Silent coercion in migrations + partial updates | CLAUDE.md §11 (No Silent Clamping) | MODIFY |
| 2b | Internal mutation entry points must diagnose no-ops | `frontend-defensive.md` | NEW |
| 3 | Default-value factories aliasing | `frontend-defensive.md` | NEW |
| 4 | Schema migration persistence + backup contract | CLAUDE.md §4 (File Persistence Safety) | NEW |
| 5a | Discriminated-union dispatch exhaustive across all crates | `rust-defensive.md` (NodeKind rule, broadened) | MODIFY |
| 5b | TypeScript discriminated union exhaustiveness sentinel | `frontend-defensive.md` | NEW |
| 6 | Staged feature delivery contract | CLAUDE.md §10 (Spec Authoring) | NEW |
| 7 | Frontend validation constants single source of truth | CLAUDE.md §5 (TypeScript) | MODIFY |
| 8 | `??` fallback on variant-required fields | (covered by 2b) | NO CHANGE |
| 9 | Asymmetric validation between shorthand branches | CLAUDE.md §11 (Validation Must Be Symmetric) | MODIFY |
| 10 | Existing rules violated, not missing | (none) | NO CHANGE — flag optional CI greps |
| 11 | WAI-ARIA composite widget patterns | `a11y-rules.md` | NEW |
| 12 | Migration CLI + integration test infra | (covered by 4) | NO CHANGE |

**Proposal counts:** 5 NEW rules, 5 MODIFY existing rules, 4 NO CHANGE (3 covered by other proposals; 1 lists optional CI greps).

---

## Notes on rules NOT proposed

Several findings were considered for new rules but rejected because the underlying pattern did not recur or was already adequately covered:

- **RF-017** (`deepClone` not wrapped in try-catch in `setCorners`): single occurrence, sibling functions already wrap. Asymmetric defensive pattern is a code-review concern, not a rule-class concern.
- **RF-019** (double-cast `as unknown as Corners`): one-off; "no `any`" rule already disallows the underlying problem.
- **RF-020** (memory regression from `[Corner;4]`): accepted with documentation; performance trade-off, not a recurring bug pattern.
- **RF-021** (default-Round 6× JSON growth): same root as RF-020; spec-level performance note rather than a rule.
- **RF-036** (`default_corners` not const fn): micro-optimization, not a bug class.
- **RF-039**, **RF-040**, **RF-041**: each a single info-level item; RF-041's broader class is covered by Pattern 5.
