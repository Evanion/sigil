# Code Review

Dispatch specialized review agents against the current branch's changes.

## Process

1. Run `git diff main...HEAD --stat` to identify which areas of the codebase changed
2. Based on changed files, dispatch the appropriate review agents **in parallel**:

| Files Changed | Agent | Prompt |
|---|---|---|
| `crates/**` | `.claude/agents/architect.md` | Review architectural boundaries and interface design in the changed crates |
| `crates/**` | `.claude/agents/security.md` | Security review of changed Rust code |
| `crates/**` | `.claude/agents/be.md` | Review Rust code quality, error handling, test coverage |
| `frontend/**` | `.claude/agents/fe.md` | Review TypeScript code quality, component design, test coverage |
| `frontend/**` | `.claude/agents/a11y.md` | Accessibility review of changed frontend code |
| `frontend/**` | `.claude/agents/ux.md` | UX review of changed frontend interactions |
| `Dockerfile`, `.github/**`, `.devcontainer/**` | `.claude/agents/devops.md` | Review infrastructure changes |

3. Collect all findings from dispatched agents
4. Present a unified review summary grouped by severity (Critical → Info)
5. If any Critical or High findings exist, flag them clearly
6. Dispatch `.claude/agents/governance.md` with all findings to check if conventions need updating

## Arguments

- `$ARGUMENTS` — optional: specific files or directories to review instead of full diff
