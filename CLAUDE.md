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
- CI builds must be fully reproducible — pin all tool versions to exact, immutable references (commit SHAs for Actions, version files for toolchains). No `latest` tags.

### Testing Standards

- TDD is the default — write the failing test first, then implement.
- Test names describe behavior: `test_adding_child_to_frame_updates_parent_bounds`.
- Core crate: unit tests for every public function.
- Server crate: integration tests for HTTP/WebSocket endpoints.
- Frontend: Vitest for unit tests.
- Tests verify behavior, not implementation — no mocking internal details.
- If you can't write a test for it, the interface needs redesign.
- Every command added to `crates/core/` MUST have at least one integration test that exercises the full `execute -> undo -> redo` cycle through `Document::execute`, `Document::undo`, and `Document::redo` (not just direct calls to `apply`/`undo` on the command struct). The test must verify: (1) state after execute matches expectations, (2) state after undo matches the original state, (3) state after redo matches post-execute state. Test naming convention: `test_<command_name>_execute_undo_redo_cycle`.

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

#### Network Security Defaults

- CORS must use an explicit allowlist of origins — never `*` or a permissive default. In development, allow `localhost` origins only; gate permissive mode behind an env var.
- WebSocket upgrade handlers must validate the `Origin` header against the CORS allowlist before accepting the connection.
- WebSocket connections must enforce a maximum message size (define as a named constant). Reject oversized frames before buffering.

#### Broadcast Semantics

- WebSocket broadcasts must exclude the originating client. The originator already applied the mutation locally; echoing it causes duplicate application.
- All state-mutating operations (execute, undo, redo) must broadcast to non-originating clients. If execute broadcasts, undo and redo must also broadcast — asymmetric broadcasting desynchronizes clients.
- The frontend subscription handler must ignore events that originated from the local client. Until the server provides a sender ID for filtering, the client must use a correlation mechanism (e.g., matching mutation IDs against incoming subscription events) to suppress self-echoed updates. Without this, clients double-apply their own mutations.

#### Graceful Shutdown

- The server must handle SIGTERM/SIGINT: stop accepting new connections, drain existing WebSocket connections, shut down within a bounded timeout. Required for container orchestration. The drain timeout must be a named constant.

#### File Persistence Safety

- All file writes must be atomic: write to a temporary file in the same directory, then rename. Never write directly to the target path — interrupted writes produce corrupt files.
- Before loading a workfile directory, validate the manifest against the actual files on disk. Stale files (present on disk but absent from the manifest) must be ignored or deleted, never silently loaded. Orphaned manifest entries (referenced but missing on disk) must produce a warning.
- File names derived from user input (page names, component names) must use deterministic collision-free identifiers (e.g., UUID) rather than sanitized user strings.
- On graceful shutdown, flush all dirty documents to disk before exiting.

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
- Always run `cargo fmt` after any code change before committing. Formatting is checked in CI; unformatted code will fail the pipeline.
- Avoid Rust reserved keywords as identifiers — check against both current and future editions (e.g., `gen` is reserved in Edition 2024). Use `generation`, `gen_value`, or similar alternatives.
- Define all validation limit constants (`MAX_*`, `LIMIT_*`, `MIN_*`) in `validate.rs`, not scattered across type definition files. Co-locating limits makes audit and enforcement traceable.
- Every `unsafe impl Send` or `unsafe impl Sync` must include a `// SAFETY:` comment explaining why the implementation is sound, naming the specific invariant. Apply unsafe impls to the narrowest possible type (a newtype wrapper, not the enclosing struct). Blanket unsafe Send/Sync on types containing non-Send/Sync fields is a bug.

### TypeScript

- Strict mode enabled.
- No `any` types.
- ESLint strict config.
- Prettier for formatting.
- Every frontend view must include ARIA landmark roles (`role="toolbar"`, `role="complementary"`, `role="main"`, `role="status"`). Interactive elements must be keyboard-navigable with `tabindex`. The `<canvas>` element must have `aria-label`. Accessibility is part of "done", not optional polish.
- Never override Kobalte trigger or interactive primitives with non-interactive elements (`as="span"`, `as="div"`, `as="p"`). Kobalte renders triggers as `<button>` by default, which provides keyboard focus, Enter/Space activation, and ARIA semantics. Overriding with a non-interactive element removes all of these. If you need custom styling, use CSS on the default element or use `as="button"` explicitly.

---

## 6. Commit Messages

Format: `type(scope): description`

Types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `test`

Scopes: `core`, `server`, `mcp`, `frontend`, `cli`, `bindings`, `devops`

Keep descriptions concise and lowercase. Reference spec numbers when implementing features: `feat(core): add node tree operations (spec-01)`.

---

## 7. Pull Request Process

Every PR MUST go through the full `/review` command after opening, including all 4 phases:

1. **Review** — dispatch specialized agents (Architect, Security, BE, FE, etc.) based on changed files
2. **Persist** — write all findings to the spec or a review file, commit them
3. **Remediate** — fix all findings in severity order (Critical/High first), update finding status
4. **Governance** — dispatch governance agent to check for patterns and propose rule updates

A PR is not ready to merge until:
- All 4 review phases have completed
- All Critical and High findings are resolved
- All Medium findings are resolved or explicitly deferred with rationale
- Governance recommendations have been reviewed and applied (or rejected with rationale)
- CI Gate passes

---

## 8. Design File Format

Workfiles use `.sigil/` directory suffix. The core crate owns serialization logic — other crates must use core's API to read/write workfiles.

---

## 9. Subagent Roles

When dispatching subagents for this project, use these specialized roles:

- **FE** — TypeScript, canvas, UI work in `frontend/`
- **BE** — Rust crates, server, MCP in `crates/`
- **DevOps** — Dockerfile, CI/CD, container config
- **Security** — security review of code and architecture
- **A11y** — accessibility review of the frontend editor
- **UX** — design and usability review
- **Architect** — system design, cross-cutting concerns
- **Governance** — reviews findings, proposes updates to rules/conventions

---

## 10. Spec Authoring Requirements

Every sub-spec MUST include the following sections before it is considered ready for review:

### WASM Compatibility Checklist (for core crate specs)

Any spec that adds types, traits, or dependencies to `crates/core/` must include a section titled **"WASM Compatibility"** that addresses:
- Every new external dependency: does it compile to `wasm32-unknown-unknown`? Link to evidence.
- Every trait bound: no `Send`, `Sync`, or `'static` bounds unless justified with a WASM workaround.
- Every source of randomness or system calls: must use a WASM-safe alternative.
- If compatibility is unknown for a dependency, the spec must flag it as a risk with a mitigation plan.

### Input Validation Inventory

Every spec that introduces a new data type, deserialization boundary, or user-facing parameter must include a section titled **"Input Validation"** that enumerates:
- Maximum sizes / capacity limits for collections (arenas, vectors, maps).
- Depth limits for nested or recursive structures.
- String validation rules (allowed characters, max length) for all name/identifier fields.
- Path validation rules for any field that references files or assets.
- Cycle detection requirements for any graph or reference structure.
- Deserialization safety limits (max document size, max nesting depth).

If a data type has no validation requirements, explicitly state "No validation needed" with a justification.

### PDR Cross-Reference

Every sub-spec must include a section titled **"PDR Traceability"** containing:
- A list of PDR features this spec implements.
- A list of PDR features this spec explicitly defers (with rationale).
- If the PDR mentions a capability in MVP scope that this spec does not address, the spec must either implement it or explain which other spec owns it.

### Atomicity and Consistency

Every spec that introduces mutation operations must include a section titled **"Consistency Guarantees"** that addresses:
- Which operations must be atomic (all-or-nothing)?
- What invariants must hold before and after each operation?
- What happens on partial failure (rollback, cleanup)?
- For compound/batch operations: is the batch atomic or are individual operations independent?
- For history/undo: what are the eviction and capacity policies?

### Recursion Inventory

Every spec that introduces recursive data structures or recursive algorithms must include a section titled **"Recursion Safety"** that enumerates:
- Every recursive function or traversal, with its maximum depth limit.
- The named constant for each depth limit.
- What error is returned when the depth limit is exceeded.
- Whether an iterative alternative was considered and why recursion was chosen.

---

## 11. Defensive Coding Rules

These rules address recurring bug patterns. They apply to ALL implementation work.

### Constants Must Be Enforced

Every validation constant (e.g., `MAX_FILE_SIZE`, `MAX_NESTING_DEPTH`, `MAX_NAME_LENGTH`) MUST have a corresponding enforcement point. A constant without enforcement is worse than no constant — it gives false confidence. When you define a limit:
1. Add the enforcement check at every relevant boundary (constructor, deserialization, insertion).
2. Add a test that verifies the limit is enforced (attempts to exceed it and expects an error).
3. If a constant exists but is not enforced, treat it as a bug.

### Recursive Functions Require Depth Guards

Every recursive function MUST accept a depth parameter or use an explicit stack with a maximum depth limit. This applies to:
- Tree traversal (e.g., `collect_subtree`, `is_ancestor`, `ancestors`)
- JSON processing (e.g., `sort_json_keys`)
- Any function that calls itself or walks a graph

The depth limit must be a named constant, not a magic number. Use `>=` (not `>`) when comparing depth to the limit constant — depth is zero-indexed, so `depth >= MAX` allows exactly MAX levels (0 through MAX-1). An off-by-one here silently permits one extra recursion level.

### Constructors Must Validate

Every public constructor (`new`, `from_*`, `try_from_*`) must call all applicable validation functions. If `validate.rs` defines rules for a field, the constructor for any type containing that field must enforce those rules. "Validation exists but isn't called" is a bug.

### Deserialization Boundaries Must Match Validation Rules

When validation rules are added or changed in `validate.rs` (or equivalent), the deserialization entry points MUST be updated in the same commit to enforce the new rules. A checklist:
- Every field validated in `validate.rs` must also be validated during deserialization.
- When adding a new validation rule, search for all `deserialize_*` and `from_json` functions and update them.

Custom `Deserialize` implementations MUST reject duplicate keys in map/struct inputs. Serde's default behavior silently resolves duplicates via last-writer-wins, which can mask data corruption. When implementing custom deserializers that collect into maps, track seen keys and return an error on the first duplicate.

### Arena Operations Must Preserve Identity on Undo

When using generational arenas, removing and re-inserting an entity produces a NEW key. Any operation that needs to restore a previous state (undo, rollback) MUST use `reinsert(key, value)` or equivalent to preserve the original key. Never use `insert()` in an undo path for arena-managed entities — this silently breaks all external references to that entity.

### Restore State Before Propagating Errors

When an item is removed from a collection (popped from a stack, removed from a vec, taken from a map) and a subsequent operation on that item may fail, the item MUST be restored to its original position before returning the error. Pattern: pop, attempt operation, push back on failure. Using `?` after a destructive removal without restoration loses the item permanently.

### No Silent Error Suppression in Rollback Paths

Never use `let _ = fallible_call()` in rollback or cleanup code paths. Suppressed errors in rollback can leave the document in a corrupted state with no diagnostic trail. Instead: collect errors into a `Vec<Error>` and return a compound error (e.g., `RollbackFailed { original_error, rollback_errors }`). The only acceptable use of `let _ =` is for non-fallible return values.

### Ordered Collection Mutations Must Preserve Position

When removing an element from an ordered collection (Vec, VecDeque) for a reversible operation, record the element's index at the time of removal. The undo path must use `insert(index, element)`, not `push(element)`. Pushing to the end silently changes ordering, which violates undo semantics.

### Floating-Point Validation

Every `f32`/`f64` field arriving from external input (deserialization, API parameter, MCP tool input) MUST be validated to reject NaN and infinity. For fields with domain constraints (e.g., opacity 0.0..=1.0, positive dimensions), validate the range in the same check. In TypeScript, every numeric value received from a third-party component callback (e.g., Kobalte NumberInput `onChange`), parsed from user input (`parseFloat`, `Number()`), or received from an external API must be guarded with `Number.isFinite()` before use. Do not rely on downstream code to handle non-finite floats — IEEE 754 NaN propagation corrupts calculations silently.

### CSS Animations Must Respect Reduced Motion

Every CSS `transition`, `animation`, or `@keyframes` rule in component stylesheets MUST have a corresponding `@media (prefers-reduced-motion: reduce)` block that disables or shortens the animation. This applies to all frontend CSS files. Omitting this causes vestibular discomfort for users with motion sensitivity (WCAG 2.3.3). When adding a transition or animation, add the media query in the same file, in the same commit.

### Symmetric Validation for Reversible Operations

For any operation with an apply/undo pair (commands, transactions), both directions MUST validate their inputs. If `apply` validates a field before modifying it, `undo` must validate before reverting. Asymmetric validation means undo can corrupt state when applied to a document that has diverged.

### Cross-Field Invariant Validation

When a type has fields that must be mutually consistent (e.g., a discriminant enum and a value enum, a unit field and a numeric field), the constructor and deserialization path MUST validate the relationship between them. Single-field validation is not sufficient — add an explicit cross-field check and a test for each invalid combination.

### No Derive Deserialize on Validated Types

Any type in `crates/core/` that has validation logic in its constructor MUST NOT use `#[derive(Deserialize)]`. Instead, implement `Deserialize` manually (or via a helper) that routes through the validating constructor. Fields on validated types MUST be private to prevent direct construction. This prevents `#[derive(Deserialize)]` from creating an invisible second construction path that bypasses all validation.

### Constant Enforcement Tests

Every `MAX_*` or `LIMIT_*` constant MUST have at least one test that verifies enforcement. Use the naming convention `test_<constant_name_lowercase>_enforced`. This makes enforcement machine-checkable — a CI grep can verify that every limit constant has a corresponding enforcement test.

### Arena-Local IDs Must Not Be Serialized

Types that represent arena indices or generational IDs (e.g., `NodeId`) MUST NOT appear in serialized or persisted data formats. Serialized document formats MUST use stable, globally-unique identifiers (UUIDs). Arena-keyed types must be mapped to their stable ID at the serialization boundary. Arena indices are meaningless outside a running session — serializing them produces corrupt references on reload.

### Uniqueness Constraints on Named Collections

When a collection contains entities with a name or identifier field that must be unique within that collection (e.g., component names in a document, property names in a component, variant names in a component), the insertion point MUST reject duplicates with a typed error. Do not rely on the collection type (HashMap vs Vec) to enforce this implicitly — validate explicitly and return an error that identifies the conflicting name.

### Defensive Message Parsing

Every `JSON.parse` call on data from an external source (WebSocket, fetch, postMessage, file read) must be wrapped in try-catch. Parse failures must be handled gracefully — log and discard, never crash the application. After parsing, validate the shape of the parsed object before type-casting. This applies to both frontend TypeScript and any future Node.js code.

### Filesystem Writes Must Be Atomic

Every file write in the server crate must use the write-to-temp-then-rename pattern. Write the full content to a temporary file in the SAME directory as the target (to ensure same-filesystem rename), then `fs::rename()` to the final path. This prevents partial writes on crash or power loss. Direct `fs::write()` to the final path is a bug in the server crate.

### No Fire-and-Forget Mutations

Every mutation call (GraphQL mutation, REST POST/PUT/DELETE, WebSocket command) that modifies server state MUST handle the response or rejection. Calling a mutation without awaiting the result or attaching an error handler is a bug — it silently drops failures and leaves the UI in a state that diverges from the server. At minimum: log the error AND revert any optimistic local state change. For user-initiated operations: display a visible error notification. This applies to both frontend TypeScript and any future backend-to-backend calls.

### Migrations Must Remove All Superseded Code

When migrating from one protocol, library, or API to another (e.g., WebSocket to GraphQL, REST to gRPC), the migration PR MUST include deletion of ALL superseded artifacts. Before marking a migration complete, search for:
1. Dead route/proxy configuration (e.g., Vite proxy entries, nginx routes, reverse proxy rules).
2. Dead type definitions that only served the old protocol's wire format.
3. Dead handler/endpoint code that is no longer reachable.
4. Dead test fixtures or mocks for the old protocol.
5. Dead dependencies in package.json/Cargo.toml that were only used by the old code.
A migration that adds the new path without removing the old path is incomplete. Use `grep` for old endpoint paths, old type names, and old import paths to verify full removal.
