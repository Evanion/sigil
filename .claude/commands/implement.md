# Implement Plan

Execute an implementation plan using specialized subagents.

## Process

1. If `$ARGUMENTS` is provided, use it as the path to the plan file. Otherwise, list available plans in `docs/superpowers/plans/` and ask which to execute.
2. Read the plan file
3. For each task in the plan:
   a. Determine the appropriate agent based on the files involved:
      - `crates/**` → `.claude/agents/be.md`
      - `frontend/**` → `.claude/agents/fe.md`
      - `Dockerfile`, `.github/**`, `.devcontainer/**` → `.claude/agents/devops.md`
      - `CLAUDE.md`, `.claude/**` → execute directly (governance)
   b. Dispatch the agent with the task details, the relevant spec, and CLAUDE.md conventions
   c. After the agent completes, verify the task's success criteria (run tests, build checks)
   d. If verification fails, send the agent the failure output and ask it to fix
   e. Mark the task as complete and commit
4. After all tasks complete, run `/review` to validate the full implementation

## Arguments

- `$ARGUMENTS` — optional: path to a specific plan file (e.g., `docs/superpowers/plans/2026-04-01-00-toolchain-setup.md`)
