# Code Review

Dispatch specialized review agents against changes, persist findings, remediate issues, and update governance.

## Phase 1: Review

1. Identify what's being reviewed:
   - If `$ARGUMENTS` is a file/directory path, review that specific artifact
   - If `$ARGUMENTS` is a PR number, run `gh pr diff <number>`
   - If no arguments, run `git diff main...HEAD --stat` to identify changed areas
2. Based on what changed, dispatch the appropriate review agents **in parallel**:

| Files Changed | Agent | Focus |
|---|---|---|
| `crates/**` | `.claude/agents/architect.md` | Architectural boundaries, interface design, WASM compatibility |
| `crates/**` | `.claude/agents/security.md` | Security review, input validation, resource limits |
| `crates/**` | `.claude/agents/be.md` | Rust code quality, error handling, test coverage |
| `frontend/**` | `.claude/agents/fe.md` | TypeScript quality, component design, test coverage |
| `frontend/**` | `.claude/agents/a11y.md` | Accessibility, WCAG 2.2 AA compliance |
| `frontend/**` | `.claude/agents/ux.md` | UX consistency, interaction patterns |
| `Dockerfile`, `.github/**`, `.devcontainer/**` | `.claude/agents/devops.md` | Infrastructure, container security, CI |
| `docs/superpowers/specs/**` | `.claude/agents/architect.md` + `.claude/agents/security.md` | Spec completeness, gaps, security concerns |

3. Collect all findings from dispatched agents
4. Present a unified review summary grouped by severity (Critical > High > Major > Medium > Minor > Low > Info)
5. If any Critical or High findings exist, flag them clearly and halt until addressed

## Phase 2: Persist

Findings must be persisted before remediation begins — they are the source of truth for what needs fixing.

1. For **spec reviews**: append a `## Review Findings` section to the spec file with all findings, including:
   - Finding ID (sequential: RF-001, RF-002, ...)
   - Source agent (Architect, Security, etc.)
   - Severity
   - Issue description
   - Recommended fix
   - Status: `open` | `resolved` | `wont-fix` (with rationale)
2. For **code reviews**: create or append to a review comment on the PR, or if no PR, write findings to a `docs/superpowers/reviews/YYYY-MM-DD-<topic>.md` file
3. Commit the persisted findings

## Phase 3: Remediate

Address each finding in severity order:

1. **Critical/High** — must be fixed immediately. Apply the recommended fix or propose an alternative.
2. **Major/Medium** — should be fixed. Apply fixes, or if deferring, document the rationale and mark as `wont-fix` with justification.
3. **Minor/Low/Info** — fix if straightforward, otherwise note for future work.

For each finding:
- Apply the fix
- Update the finding status to `resolved` with a brief note of what was done
- Commit the fix referencing the finding ID: `fix: address RF-003 — add arena capacity limit`

## Phase 4: Governance

1. Dispatch `.claude/agents/governance.md` with all findings (especially patterns — recurring issues)
2. Governance agent reviews and proposes updates to:
   - `CLAUDE.md` — new conventions or rules to prevent similar issues
   - `.claude/agents/*.md` — refined agent prompts to catch these issues earlier
   - CI checks — automated enforcement where possible
3. Present governance recommendations for approval before applying
4. If approved, apply changes and commit

## Arguments

- `$ARGUMENTS` — optional: file/directory path, PR number, or specific review scope
