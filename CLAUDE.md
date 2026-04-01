# CLAUDE.md — Sigil Project Conventions

## 1. Constitution

These principles are the governing rules of this project. They explain the _why_ behind every convention below. When in doubt, defer to these principles.

### Code Quality

- The core crate has ZERO I/O dependencies and must compile to WASM — this is non-negotiable.
- All document mutations flow through the core engine — server and MCP never mutate state directly.
- Use `thiserror` for library errors (core, mcp), `anyhow` for application errors (server, cli) — never mix these.
- No `unwrap()` or `expect()` in the core crate — always return `Result`.
- Clippy pedantic is enabled — treat warnings as errors.
- Prefer small, focused files with clear interfaces over large files that do too much.

### Testing Standards

- TDD is the default — write the failing test first, then implement.
- Test names describe behavior: `test_adding_child_to_frame_updates_parent_bounds`.
- Core crate: unit tests for every public function.
- Server crate: integration tests for HTTP/WebSocket endpoints.
- Frontend: Vitest for unit tests.
- Tests verify behavior, not implementation — no mocking internal details.
- If you can't write a test for it, the interface needs redesign.

### User Experience Consistency

- The editor must feel like Figma/Penpot — follow established design tool conventions.
- Standard keyboard shortcuts (V select, F frame, R rect, T text, P pen, etc.).
- Agents and humans see each other's changes in real time through the same operation pipeline.
- The MCP interface must be token-efficient — agents shouldn't need verbose interactions.
- Every operation must have undo/redo support — no exceptions.

### Performance Requirements

- The app runs in containers with limited resources — performance is a first-class concern.
- Measure before optimizing, but design for performance from the start.
- The core crate's hot paths must be allocation-conscious.
- Canvas rendering must maintain 60fps for documents with up to 1000 nodes.
- Server startup must be under 1 second.
- WebSocket message latency must be under 50ms for local connections.

---

## 2. Project Structure

```
sigil/
├── crates/
│   ├── core/          # Design engine — pure logic, no I/O, WASM-compatible
│   ├── server/        # Axum HTTP server, WebSocket, file I/O
│   └── mcp/           # MCP server for agent interaction
├── frontend/          # TypeScript + Vite SPA (Canvas editor)
├── bindings/          # Token export packages (@sigil/css, @sigil/tailwind)
│   ├── css/
│   └── tailwind/
├── cli/               # sigil-cli — token export CLI
├── docs/
│   └── superpowers/
│       ├── specs/     # Product design records
│       └── plans/     # Implementation plans
├── .devcontainer/     # Dev container configuration
├── .claude/
│   ├── agents/        # Specialized agent prompts
│   └── commands/      # Custom slash commands (/review, /implement)
└── .agents/skills/    # Project-local skills
```

---

## 3. Running Commands

All build/test/lint commands run inside the dev container. Use `./dev.sh` as a prefix when running from the host. If already inside the container, commands run directly.

### Rust

- Build: `./dev.sh cargo build --workspace`
- Test: `./dev.sh cargo test --workspace`
- Lint: `./dev.sh cargo clippy --workspace -- -D warnings`
- Format: `./dev.sh cargo fmt` (check: `./dev.sh cargo fmt --check`)
- Run server: `./dev.sh cargo run --bin agent-designer-server`

### Frontend

- Install: `./dev.sh pnpm --prefix frontend install`
- Dev: `./dev.sh pnpm --prefix frontend dev`
- Build: `./dev.sh pnpm --prefix frontend build`
- Test: `./dev.sh pnpm --prefix frontend test`
- Lint: `./dev.sh pnpm --prefix frontend lint`
- Format: `./dev.sh pnpm --prefix frontend format` (check: `format:check`)

### Docker (production image)

- Build: `docker build -t sigil:dev .`
- Run: `docker run --rm -p 4680:4680 sigil:dev`

---

## 4. Crate Responsibilities

### `agent-designer-core`

- MUST have zero I/O dependencies (no filesystem, no networking).
- MUST compile to both native and `wasm32-unknown-unknown`.
- All operations must be deterministic and side-effect-free.
- This is the foundation — everything else depends on it.

### `agent-designer-server`

- Owns HTTP serving, WebSocket, file I/O.
- All document mutations go through the core engine.
- Never mutate document state directly — always through core operations.

### `agent-designer-mcp`

- Owns the MCP tool/resource definitions.
- Shares in-memory state with the server (same process).
- Keep tool interfaces token-efficient for agent consumption.

---

## 5. Code Style

### Rust

- Edition 2024, clippy pedantic warnings enabled.
- Use `thiserror` for library errors, `anyhow` for application errors (server/cli only).
- Prefer `impl` returns over `Box<dyn>` where possible.
- Core crate: no `unwrap()` or `expect()` — return `Result` types.

### TypeScript

- Strict mode enabled.
- No `any` types.
- ESLint strict config.
- Prettier for formatting.

---

## 6. Commit Messages

Format: `type(scope): description`

Types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `test`

Scopes: `core`, `server`, `mcp`, `frontend`, `cli`, `bindings`, `devops`

Keep descriptions concise and lowercase. Reference spec numbers when implementing features: `feat(core): add node tree operations (spec-01)`.

---

## 7. Design File Format

Workfiles use `.sigil/` directory suffix. The core crate owns serialization logic — other crates must use core's API to read/write workfiles.

---

## 8. Subagent Roles

When dispatching subagents for this project, use these specialized roles:

- **FE** — TypeScript, canvas, UI work in `frontend/`
- **BE** — Rust crates, server, MCP in `crates/`
- **DevOps** — Dockerfile, CI/CD, container config
- **Security** — security review of code and architecture
- **A11y** — accessibility review of the frontend editor
- **UX** — design and usability review
- **Architect** — system design, cross-cutting concerns
- **Governance** — reviews findings, proposes updates to rules/conventions
