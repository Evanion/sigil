# Code Review

Run a comprehensive multi-agent code review on the current branch, a specific PR, or a spec directory.

## Mode Detection

Determine review mode from `$ARGUMENTS`:

- **PR number** (e.g. `123`) → Code review mode: `gh pr view 123` + `gh pr diff 123`
- **Directory path** (e.g. `docs/superpowers/specs/`) → Spec review mode: read all `.md` files in that directory
- **No args, not on main** → Code review mode: `git diff main...HEAD` + `git log main...HEAD --oneline`
- **No args, on main** → `gh pr list` and prompt user to pick

## Phase 1: Review

1. Obtain the diff (from `gh pr diff <number>` or `git diff main...HEAD`)
2. Extract the list of changed files from the diff
3. Read the full system prompt from each applicable agent file (`Read .claude/agents/<name>.md`), strip the YAML frontmatter (lines between `---` delimiters), and use the body as the agent's system prompt
4. Launch all applicable reviewer agents **in parallel**, passing: (a) the full diff, (b) the changed file list, (c) the agent's system prompt body from the `.md` file

   **Always launch (minimum 6 reviewers for any code change):**
   - **Architect** — `.claude/agents/architect.md` — subagent_type: `Architect` — Architectural boundaries, interface design, WASM compatibility
   - **Security** — `.claude/agents/security.md` — subagent_type: `Security Reviewer` — Input validation, resource limits, deserialization safety
   - **BE** — `.claude/agents/be.md` — subagent_type: `Backend Engineer` — Rust code quality, error handling, test coverage
   - **Logic** — `.claude/agents/be.md` — subagent_type: `Backend Engineer` — Dedicated logic reviewer. Prompt MUST include: "Focus ONLY on logic errors and correctness bugs. Trace through execution paths step by step. Do NOT report code quality, style, or architecture issues — other reviewers handle those."
   - **Compliance** — `.claude/agents/compliance.md` — subagent_type: `Backend Engineer` — CLAUDE.md rule compliance check. Pass the diff and instruct to check ALL sections of CLAUDE.md.
   - **Data Scientist** — `.claude/agents/data-scientist.md` — subagent_type: `Backend Engineer` — Data modeling, collection sizing, performance characteristics, serialization efficiency

   **Conditionally launch (check changed file paths):**
   - **FE** — `.claude/agents/fe.md` — subagent_type: `Frontend Engineer` — if any file in `frontend/**`
   - **A11y** — `.claude/agents/a11y.md` — subagent_type: `Accessibility Reviewer` — if any file in `frontend/**`
   - **UX** — `.claude/agents/ux.md` — subagent_type: `UX Reviewer` — if any file in `frontend/**`
   - **DevOps** — `.claude/agents/devops.md` — subagent_type: `DevOps Engineer` — if any file in `Dockerfile`, `.github/**`, `.devcontainer/**`, OR any file in `crates/server/**` (server config, ports, binding addresses are DevOps concerns)

5. Collect all findings from dispatched agents
6. Present a unified review summary grouped by severity (Critical > High > Major > Medium > Minor > Low > Info)
7. If any Critical or High findings exist, flag them clearly and halt until addressed

## Spec Review Mode

When the argument is a spec directory:
1. Read all `.md` files in the specified directory
2. Launch **all** reviewer agents in parallel (no conditional filtering — specs touch all domains)
3. Add to each agent's prompt: "You are reviewing specification documents (not code). Apply your checklist to what will be built — flag requirements that would lead to violations if implemented as written, missing constraints, and underspecified requirements."

## Phase 1 Output Format

Present findings in a unified table grouped by severity, with deduplication across agents. Each finding must include:
- Finding ID (RF-001, RF-002, ...)
- Source agent(s)
- Severity (Critical, High, Major, Medium, Minor, Low, Info)
- Description with file location
- Recommended fix

## Phase 2: Persist Findings

After presenting the review, **always** persist findings before remediation:

1. For **spec reviews**: append a `## Review Findings` section to the spec file
2. For **code reviews**: write to `docs/superpowers/reviews/YYYY-MM-DD-<topic>.md`
3. Every finding includes: ID, source, severity, description, recommended fix, status (`open`)
4. Commit: `docs: persist review findings for <branch/PR>`
5. Tell the user: "Findings persisted. Ready to remediate?"

## Phase 3: Remediate

If the user confirms:

1. Work through every issue in severity order (Critical → Low)
2. For each issue:
   - Apply the fix
   - Update finding status to `resolved` with what was done
   - For out-of-scope items: mark `wont-fix` with rationale
3. After all fixes, run the full quality gate:
   ```bash
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   cargo fmt --check
   ```
4. Commit fixes referencing finding IDs
5. Update and commit the findings file

## Phase 4: Governance

After remediation, **always** run governance:

1. Launch the **Governance Updater** agent (`.claude/agents/governance.md`, subagent_type: `Governance Updater`), passing:
   - The full review findings (from the persisted file)
   - The remediation summary (what was fixed, what patterns emerged)
2. Present governance proposals to the user
3. If approved, apply and commit

## Notes

- Each reviewer only reports issues with confidence ≥ 80 — no nitpicks
- Pre-existing issues on lines not in the diff should be noted but not counted as blocking
- Deduplicate overlapping findings across agents before presenting
- Always use the project-specific `subagent_type` values listed above — NEVER use generic agent types like `feature-dev:code-reviewer`

$ARGUMENTS
