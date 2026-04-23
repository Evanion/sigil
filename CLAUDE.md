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

### Design Decision Criteria

When a design choice has multiple valid options — particularly when external convention and internal simplicity point in different directions — apply these criteria in order:

1. **Correctness** — does the design produce correct behavior in all cases? Reject options with known edge-case failures regardless of convention or simplicity.
2. **Robustness** — does the design minimize the surface area for bugs? Fewer code paths, fewer special cases, and fewer states mean fewer failure modes. Prefer the option that is hardest to use incorrectly.
3. **Simplicity** — does the design produce simpler code? Simpler parsing, simpler validation, simpler testing. Code that is easier to understand is easier to maintain and easier to verify.
4. **Convention** — does the design follow established external conventions? Convention reduces surprise for users and contributors. But convention is the tiebreaker, not the primary criterion — it applies only when the options above do not distinguish the candidates.

When a design deviates from an external convention, the deviation MUST be documented in the spec or ADR with: (a) what the convention is and who uses it, (b) why the chosen design scores higher on correctness, robustness, or simplicity, and (c) what user-facing impact the deviation has (if any). A deviation without documentation is an unforced error — future contributors will "fix" it back to the convention without understanding why it was changed.

This principle does NOT apply to user-facing interaction patterns (keyboard shortcuts, selection behavior, tool switching) where the user's muscle memory is the dominant concern. For interaction patterns, "follow Figma/Penpot conventions" remains the default — override only with strong usability evidence.

### Testing Standards

- TDD is the default — write the failing test first, then implement.
- Test names describe behavior: `test_adding_child_to_frame_updates_parent_bounds`.
- Core crate: unit tests for every public function.
- Server crate: integration tests for HTTP/WebSocket endpoints.
- Frontend: Vitest for unit tests.
- Tests verify behavior, not implementation — no mocking internal details.
- If you can't write a test for it, the interface needs redesign.
- Every `FieldOperation` added to `crates/core/` MUST have at least one test that exercises the full `validate` → `apply` cycle. The test must verify: (1) `validate` passes on valid input, (2) `apply` changes the document state as expected, (3) `validate` rejects invalid input (missing node, invalid values). Test naming convention: `test_<operation_name>_validate_and_apply`. Undo/redo is handled client-side (Spec 15) — the core crate provides forward-only operations.
- Every new first-class entity type introduced to `crates/core/` (pages, components, layers, tokens, etc.) MUST ship with a complete command set covering at minimum: create, rename, delete, and any reorder or reparent operations the entity supports. A PR that adds an entity type without commands for it is incomplete — the entity is not usable by agents or clients without them.
- Every new first-class entity type that is user-mutatable from the frontend MUST have all of its mutations wired to the client-side HistoryManager in the same PR. A PR that adds entity commands in the core crate but does not register them with the HistoryManager has delivered mutations that cannot be undone — this is incomplete regardless of backend completeness.

### User Experience Consistency

- The editor must feel like Figma/Penpot — follow established design tool conventions.
- Standard keyboard shortcuts (V select, F frame, R rect, T text, P pen, etc.).
- Agents and humans see each other's changes in real time through the same operation pipeline.
- The MCP interface must be token-efficient — agents shouldn't need verbose interactions.
- Every user-facing operation must support undo/redo. Undo is handled client-side by the frontend HistoryManager (Spec 15). The core crate provides forward-only `FieldOperation`s; the frontend captures before/after state for undo.

### Performance Requirements

- The app runs in containers with limited resources — performance is a first-class concern.
- Measure before optimizing, but design for performance from the start.
- The core crate's hot paths must be allocation-conscious.
- Canvas rendering must maintain 60fps for documents with up to 1000 nodes.
- Server startup must be under 1 second.
- WebSocket message latency must be under 50ms for local connections.

---

## 2. Project Structure

When a new crate is added to the workspace, the PR that creates it MUST update this section (§2) to include it in the directory tree and MUST add a §4 entry describing the crate's responsibilities, boundaries, and any non-obvious constraints. A crate present in the workspace but absent from CLAUDE.md is undocumented and will be misused.

```
sigil/
├── crates/
│   ├── core/          # Design engine — pure logic, no I/O, WASM-compatible
│   ├── state/         # Shared in-memory state — document store, broadcast channel
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

### `agent-designer-state`

- Owns shared in-memory state: the document store and the broadcast channel that all connected clients subscribe to.
- Depended upon by both `agent-designer-server` and `agent-designer-mcp` — it is the single source of truth for live session state.
- Contains no HTTP, WebSocket, or MCP protocol code — it is transport-agnostic.
- Must remain free of I/O; persistence is the server's responsibility.

### `agent-designer-server`

- Owns HTTP serving, WebSocket, file I/O.
- All document mutations go through the core engine.
- Never mutate document state directly — always through core operations.

#### Network Security Defaults

- CORS must use an explicit allowlist of origins — never `*` or a permissive default. In development, allow `localhost` origins only; gate permissive mode behind an env var.
- WebSocket upgrade handlers must validate the `Origin` header against the CORS allowlist before accepting the connection.
- WebSocket connections must enforce a maximum message size (define as a named constant). Reject oversized frames before buffering.

#### Broadcast Semantics (applies to server and MCP — both must follow these rules)

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
- Shares in-memory state with the server (same process) via `agent-designer-state`.
- Keep tool interfaces token-efficient for agent consumption.
- All state-mutating MCP tool calls MUST trigger both persistence (signal_dirty) AND real-time broadcast to all connected clients. Calling only signal_dirty without broadcasting leaves human clients and other agents desynchronized — they will not see the MCP agent's changes until the next reconnect or poll. The broadcast obligation for MCP is identical to the obligation for server-originated mutations in the Broadcast Semantics section above.
- When running over stdio transport, all diagnostic output MUST go to stderr, never stdout. Writing tracing or log output to stdout corrupts the protocol framing — the MCP client interprets any stdout bytes as protocol messages. Configure the `tracing` subscriber to write exclusively to stderr when the transport is stdio. The transport mode must be detectable at startup (e.g., via a `--stdio` flag or env var) to apply the correct subscriber configuration.

#### MCP Broadcast Payload Shape Contract

Before implementing any MCP tool that broadcasts, the implementer MUST read `frontend/src/operations/apply-remote.ts` and verify that the broadcast payload matches what the frontend dispatcher expects. The fields `op_type`, `path`, and `value` are not free-form — they are consumed by a dispatcher that switches on exact string values. Mismatched values cause the operation to be silently ignored by all connected clients.

Rules:
- `op_type` must exactly match the string the frontend `applyRemoteOperation` dispatcher switches on (e.g., `"create_node"`, `"delete_node"` — not shortened aliases).
- `value` shape must match what the frontend handler for that `op_type` destructures (e.g., `reparent` expects `{parentUuid, position}` — not a bare string).
- When adding a new operation type to an MCP tool, add the corresponding handler in `applyRemoteOperation` in the same PR. A broadcast without a handler is a no-op.
- When changing the frontend handler for an operation type, search all MCP tools for broadcasts of that `op_type` and update them in the same PR.
- Entity-creation broadcasts (`create_node`, `create_page`, `create_component`, etc.) MUST include the entity's stable UUID in the `value` payload under the key `"id"`. The frontend handler cannot create the entity in the local store without its identity — a payload missing `"id"` produces a silent discard. This applies to both MCP and GraphQL broadcast paths.

---

## 5. Code Style

### Rust

- Edition 2024, clippy pedantic warnings enabled.
- Use `thiserror` for library errors, `anyhow` for application errors (server/cli only).
- Prefer `impl` returns over `Box<dyn>` where possible.
- Core crate: no `unwrap()` or `expect()` — return `Result` types.
- Always run `cargo fmt` after any code change before committing. Formatting is checked in CI; unformatted code will fail the pipeline.
- Avoid Rust reserved keywords as identifiers — check against both current and future editions (e.g., `gen` is reserved in Edition 2024). Use `generation`, `gen_value`, or similar alternatives.
- Define all validation artifacts in `validate.rs`: numeric limit constants (`MAX_*`, `LIMIT_*`, `MIN_*`), character denylists (e.g., `FONT_FAMILY_FORBIDDEN_CHARS`), character allowlists, and any other validation predicate or set used in more than one location. Do not inline these in type definition files or command modules — inline copies diverge silently.
- Every `unsafe impl Send` or `unsafe impl Sync` must include a `// SAFETY:` comment explaining why the implementation is sound, naming the specific invariant. Apply unsafe impls to the narrowest possible type (a newtype wrapper, not the enclosing struct). Blanket unsafe Send/Sync on types containing non-Send/Sync fields is a bug.

### TypeScript

- Strict mode enabled.
- No `any` types.
- ESLint strict config.
- Prettier for formatting.
- Every frontend view must include ARIA landmark roles (`role="toolbar"`, `role="complementary"`, `role="main"`, `role="status"`). Interactive elements must be keyboard-navigable with `tabindex`. The `<canvas>` element must have `aria-label`. Accessibility is part of "done", not optional polish.
- Never override Kobalte trigger or interactive primitives with non-interactive elements (`as="span"`, `as="div"`, `as="p"`). Kobalte renders triggers as `<button>` by default, which provides keyboard focus, Enter/Space activation, and ARIA semantics. Overriding with a non-interactive element removes all of these. If you need custom styling, use CSS on the default element or use `as="button"` explicitly. Note: this rule applies to the Kobalte components still in use (Button, Select, DropdownMenu, ContextMenu, Menubar, NumberField, TextField, Toggle, Toast, Tooltip, Separator). Popover and Dialog do not use Kobalte — see the native popover/dialog rule below.
- Use native HTML `popover` attribute and `<dialog>` element instead of Kobalte (or any library) Popover and Dialog components. Kobalte's Dialog sets `body.style.pointerEvents = "none"` for modal overlay, which breaks any portaled content not registered in its internal DismissableLayer stack. Solid's `<Portal>` breaks the Kobalte context chain, making nested overlays (popover inside dialog) unclickable. The native implementations avoid this: Popover uses `popover="auto"` for light dismiss, `popover="manual"` for programmatic control, with CSS Anchor Positioning (`anchor-name`, `position-anchor`, `position-area`, `position-try-fallbacks`) for viewport-aware placement — do not introduce JS-based positioning libraries (Floating UI, Popper, etc.). Dialog uses `<dialog>` with `showModal()` for browser-native focus trap, Escape handling, `::backdrop`, and top-layer rendering. Both use the browser's top-layer mechanism, which handles stacking correctly without JavaScript layer management. The project's native implementations are at `frontend/src/components/popover/Popover.tsx` and `frontend/src/components/dialog/Dialog.tsx` — use these, do not create alternatives.
- Use `<Index>` (not `<For>`) for Solid.js lists that support reorder, insert, or delete. Solid's `<For>` keyed iteration destroys and recreates DOM nodes when items move positions — this loses focus, breaks CSS transitions, and causes visible flicker during drag-and-drop reorder. `<Index>` preserves DOM elements and updates them in place, which is correct for lists where the user can add, remove, or reorder items (fills, strokes, effects, layers, gradient stops). Reserve `<For>` for read-only lists where the data identity matters more than DOM stability.
- Deep-cloning Solid store data requires `JSON.parse(JSON.stringify())` inside `produce()` callbacks — but `structuredClone` must be used everywhere else. Solid's `createStore` wraps objects in Proxy traps; `structuredClone` throws `DataCloneError` on these proxies. Inside a `produce()` callback (where the argument is a Solid proxy), use `JSON.parse(JSON.stringify(value))` and wrap it in try-catch. Outside `produce()` — when cloning plain objects, snapshots, or function arguments that are not store proxies — use `structuredClone`. Every `JSON.parse(JSON.stringify())` call site must have a comment: `// JSON clone: Solid proxy not structuredClone-safe`.
- Plain class instances are not reactive in Solid.js. Wrapping a method call in an arrow function (`() => myClass.getValue()`) does NOT create a reactive binding — Solid's tracking only works with signals, stores, and memos. When bridging non-reactive state (plain classes, third-party libraries, imperative managers) into Solid's reactive graph, create explicit Solid signals that mirror the external state and update them after every mutation to the external object. Never expose a plain class method as a "reactive accessor" without a backing signal — it will return stale values and the UI will not update. This obligation applies in both directions: (1) reading from the class requires a signal-backed accessor, and (2) every mutation to the class's internal state — including async operations, callbacks, and event handlers — MUST call the corresponding signal setter immediately after the mutation. A mutation without a setter call is invisible to the reactive graph.
- Never call Solid.js `onCleanup` inside a DOM event handler, `setTimeout` callback, `Promise.then`, or any async context. `onCleanup` registers with the reactive owner active at call time — outside a reactive root it silently no-ops, leaving timers alive after component destroy. Store handles at component scope and register cleanup synchronously during setup.
- When the UI assigns stable IDs to list items (UUIDs for gradient stops, layer entries, etc.) for DOM keying and selection tracking, those IDs must be preserved through prop callbacks and store updates until the persistence boundary (GraphQL mutation, server serialization). Stripping IDs before calling a prop callback causes the next render to regenerate new IDs, breaking selection, focus, and CSS transitions. Strip only at the outbound mutation call site.

---

## 6. Commit Messages

Format: `type(scope): description`

Types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `test`

Scopes: `core`, `server`, `mcp`, `frontend`, `cli`, `bindings`, `devops`

Keep descriptions concise and lowercase. Reference spec numbers when implementing features: `feat(core): add node tree operations (spec-01)`.

### Type semantics (enforced)

- **`refactor`** — behavior-preserving rearrangement only. A `refactor` commit MUST NOT: introduce new types, add new fields, add new enum variants, change function signatures in a way that alters input/output domain, add new validation, or add/remove user-visible behavior. If the change does any of these, it is `feat` or `fix`, not `refactor`. Plan tasks labeled "refactor" that then introduce type changes indicate that the plan is mis-scoped — update the plan before opening the PR.
- **`fix`** — corrects a defect in existing behavior. Does not introduce new features.
- **`feat`** — adds new user-visible capability or a new type/field that expands the data model.

This matters during review: reviewers calibrate scrutiny based on the commit type. A mislabeled `refactor` invites lighter review of code that actually changes behavior, which is how regressions slip through.

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

### Tool Lifecycle Contract (for specs adding canvas tools)

Any spec that introduces a new canvas tool MUST include a section titled **"Tool Lifecycle"** that specifies:
- Whether the tool completes in a single gesture (instantaneous: click → `onComplete()` → switch to select) or a continuous gesture (multi-phase: click → enter sub-mode → explicit commit/cancel).
- For continuous-gesture tools: what triggers commit, what triggers cancel, and what happens to the created node on cancel.
- Whether the tool stays active after one use or returns to select.
- How the tool interacts with document-level keyboard handlers during its active phase.

### Cross-Stack Type Extension Inventory

Any spec that extends a shared wire-format type (a type that crosses the Rust↔TypeScript boundary via GraphQL, MCP, WebSocket, or file serialization) MUST include a section titled **"Transport Boundary Inventory"** that enumerates, for each affected type:

- The Rust definition site (file and type name).
- The TypeScript definition site (file and type name).
- Every transport handler that serializes or deserializes the type: GraphQL resolvers, MCP tool handlers, WebSocket broadcast paths, `frontend/src/operations/apply-remote.ts` handlers, persistence paths, canvas renderer paths.
- Every in-code consumer that pattern-matches on the type's discriminant (every `match` in Rust, every `switch` or `if/else` ladder in TypeScript).

For each entry, the spec must state whether this PR updates it, or document why no update is needed. A spec that extends a shared type without this inventory is incomplete — the implementer has no checklist to verify end-to-end parity.

---

## 11. Defensive Coding Rules

These rules address recurring bug patterns. They apply to ALL implementation work.

> **Domain-specific rules** are in separate files to keep this document focused:
> - [Rust defensive rules](.claude/rules/rust-defensive.md) — core crate, validation, serialization, arena, locks
> - [Frontend defensive rules](.claude/rules/frontend-defensive.md) — Solid.js, store, history, optimistic updates
> - [Accessibility rules](.claude/rules/a11y-rules.md) — ARIA, keyboard, screen reader, reduced motion

### Constants Must Be Enforced

Every validation constant (e.g., `MAX_FILE_SIZE`, `MAX_NESTING_DEPTH`, `MAX_NAME_LENGTH`) MUST have a corresponding enforcement point. A constant without enforcement is worse than no constant — it gives false confidence. When you define a limit:
1. Add the enforcement check at every relevant boundary (constructor, deserialization, insertion).
2. Add a test that verifies the limit is enforced (attempts to exceed it and expects an error).
3. If a constant exists but is not enforced, treat it as a bug.
4. Every numeric input control in the frontend (`NumberInput`, `Slider`) MUST have a named constant for its `min` and `max` bounds. Passing a hardcoded literal as the `max` prop, or omitting bounds on a domain-bounded value (pixel offset, opacity, angle), is a bug. The constant must match the corresponding Rust validation value.

### Recursive Functions Require Depth Guards

Every recursive function MUST accept a depth parameter or use an explicit stack with a maximum depth limit. This applies to:
- Tree traversal (e.g., `collect_subtree`, `is_ancestor`, `ancestors`)
- JSON processing (e.g., `sort_json_keys`)
- Any function that calls itself or walks a graph

The depth limit must be a named constant, not a magic number. Use `>=` (not `>`) when comparing depth to the limit constant — depth is zero-indexed, so `depth >= MAX` allows exactly MAX levels (0 through MAX-1). An off-by-one here silently permits one extra recursion level.

### Floating-Point Validation

Every `f32`/`f64` field arriving from external input (deserialization, API parameter, MCP tool input) MUST be validated to reject NaN and infinity. For fields with domain constraints (e.g., opacity 0.0..=1.0, positive dimensions), validate the range in the same check. In TypeScript, every numeric value received from a third-party component callback (e.g., Kobalte NumberInput `onChange`), parsed from user input (`parseFloat`, `Number()`), or received from an external API must be guarded with `Number.isFinite()` before use. Do not rely on downstream code to handle non-finite floats — IEEE 754 NaN propagation corrupts calculations silently. This also applies to CSS string construction: any numeric value interpolated into a CSS property string (e.g., `linear-gradient()`, `rgba()`, `hsl()`, `transform`) must be validated with `Number.isFinite()` before interpolation. NaN or Infinity in a CSS value string produces malformed styles silently — the browser ignores the rule without error. This guard obligation is not limited to external boundaries. Any pure function or reactive memo that operates on a numeric value must guard against NaN and infinity at its own entry point — do not assume an upstream caller already validated. NaN propagates silently through computation chains; a guard at the origin does not protect a function that is later called from a different call site that bypasses the origin.

### No Silent Error Suppression

Never use `let _ = fallible_call()` in rollback or cleanup code paths. Suppressed errors in rollback can leave the document in a corrupted state with no diagnostic trail. Instead: collect errors into a `Vec<Error>` and return a compound error (e.g., `RollbackFailed { original_error, rollback_errors }`). The only acceptable use of `let _ =` is for non-fallible return values.

The prohibition extends beyond rollback paths. Never use `.unwrap_or_default()` on a `Result` where the error represents a real failure (e.g., serialization failure). Prefer `match` with an explicit log branch. "Silent" also includes mapping a specific error to a generic variant — if a rollback error is mapped to `InvalidInput`, the diagnostic trail is corrupted. Create a typed variant (e.g., `RollbackFailed`) instead.

### Handlers Must Surface Validation Failures to the User

Never silently reject, clamp, truncate, or coerce an invalid input value. Four anti-patterns are banned:
1. **Silent clamping** — `position.max(0)`, `name.truncate(MAX_LEN)`.
2. **Silent rejection** — `if (!isValid(input)) return;` with no user feedback.
3. **Silent swallowing** — `try { parse(input); } catch { /* ignore */ }`.
4. **Silent discriminant collapse** — `if (delta > TOLERANCE) { return [0, 0, ...]; }` where the caller loses not just a value but the *identity* of a channel (e.g., hue set to 0 because saturation fell below a threshold). A coarse tolerance masquerading as a division-safety guard is a silent clamp — use the strict numerical guard (`delta > 0`) and document why.

All four mask bugs in callers and leave the user unable to understand why their action had no effect. Instead, at every input boundary (API handler, MCP tool, deserialization, UI callback, panel commit handler):
- Validate the input.
- On failure, surface the error via the appropriate channel for that layer:
  - **Rust API/MCP**: return a typed error identifying the invalid value and acceptable range.
  - **Frontend panel/ValueInput handlers**: write a status message to the component's `aria-live` status region AND, for destructive intent (e.g., committing an invalid value), show a toast or inline error — not both silent paths.
  - **Background parse attempts** (e.g., autocomplete match): fail silently is acceptable ONLY when the user will immediately receive feedback through another channel (the suggestion list didn't open, the swatch didn't appear) AND there is no persistence attempt.

A handler that short-circuits on `parsed.type !== "literal"`, `value < 0`, or similar without updating a visible status region is a bug. If the input type legitimately cannot be represented (e.g., token ref to a field that doesn't support bindings), the status message must explain *why* — "Font family token binding not yet supported", "Stroke width must be ≥ 0", etc.

The exception is explicit user-facing affordances (a slider that visually constrains its range) where clamping IS the intended UX.

### No Fire-and-Forget Mutations

Every mutation call (GraphQL mutation, REST POST/PUT/DELETE, WebSocket command) that modifies server state MUST handle the response or rejection. Calling a mutation without awaiting the result or attaching an error handler is a bug — it silently drops failures and leaves the UI in a state that diverges from the server. At minimum: log the error AND revert any optimistic local state change. For user-initiated operations: display a visible error notification. This applies to both frontend TypeScript and any future backend-to-backend calls.

### Capture Snapshots Before Mutations, Not After

When an operation needs to record the previous value of a field for undo, rollback, or logging, read the field BEFORE applying the mutation. Do not read it after calling `produce()`, `setState()`, `applyOperation()`, or any other state-modifying function — the value has already changed. This is a TOCTOU error specific to reactive and mutable-state systems. Pattern: `const before = store.field; produce(s => { s.field = newValue; }); trackUndo(before);`. Anti-pattern: `produce(s => { s.field = newValue; }); trackUndo(store.field); // BUG: reads the new value`.

### Temporary State Flags Must Use try-finally

When a boolean or enum flag is set to temporarily change system behavior (suppress history recording, suppress broadcasts, mark undo-in-progress, enable batch mode), the flag MUST be reset in a `finally` block (TypeScript) or via an RAII guard (Rust). If the guarded operation throws or returns an error, the flag stays set permanently, breaking all subsequent operations that check it. Pattern: `flag = true; try { riskyOperation(); } finally { flag = false; }`. Anti-pattern: `flag = true; riskyOperation(); flag = false;` — if riskyOperation throws, the flag is never reset.

### Constant Enforcement Tests

Every `MAX_*`, `MIN_*`, or `LIMIT_*` constant MUST have at least one test that verifies enforcement. Use the naming convention `test_<constant_name_lowercase>_enforced`. This makes enforcement machine-checkable — a CI grep can verify that every limit constant has a corresponding enforcement test. This applies equally to lower bounds — a `MIN_PAGES_PER_DOCUMENT` constant without a test that attempts to delete below the minimum is an unenforced limit. In TypeScript, "expects an error" includes asserting that a guard function returns `false`, that a validation helper returns an error object, or that a store function rejects the input. A test that only reads the constant's value (e.g., `expect(MAX_STOPS).toBe(32)`) does not prove enforcement and does not satisfy this requirement.

### Behavioral Inventory Before Deleting or Rewriting Implementation Code

When a PR either (a) deletes a module, trait, struct, or function carrying non-trivial logic, OR (b) rewrites a frontend component such that net line delta exceeds ±30% or the implementation is substantially different (new internal architecture, new state model, extracted/combined helpers), the PR MUST include a behavioral inventory before the diff.

The scope obligation is independent of how the PR is labeled. Plan-task labels such as "rename", "move", "refactor", or "extract" do NOT exempt the change from inventory if the actual diff meets the criteria above. The inventory is keyed on the diff, not the intent.

The inventory enumerates:
1. Every side effect and computation the outgoing code performs beyond simple CRUD — validation rules, min/max bounds, prefix/suffix labels, formatting, keyboard handlers, focus management, aria-live regions, autocomplete state, cursor preservation, CSS class contracts, event emission ordering.
2. For each item: (a) preserved in the replacement, (b) moved to a different location (specify where), or (c) intentionally removed (with rationale).

"The new code replaces the old code" is not sufficient — the replacement must be shown to cover the same behavioral surface. For frontend component rewrites, the inventory additionally satisfies the "Accessibility Behavior Must Be Audited During UI Rewrites" rule in `a11y-rules.md` — both items are enumerated in the same document.

This rule exists because PR #39 deleted Command structs containing bounding box / transform / child ordering logic whose omission produced four Critical regressions, and because PR #57 rewrote EnhancedTokenInput → ValueInput without inventory and lost: min validation on line-height/letter-spacing (RF-005), prefix labels on shadow X/Y/Blur/Spread (RF-013), spinbutton semantics (RF-020), and aria-live discipline (RF-008).

### Validation Must Be Symmetric Across All Transports

When a validation check exists at one API boundary (GraphQL resolver, MCP tool handler, REST endpoint), the same check MUST exist at every other boundary that accepts the same input type. When adding or modifying a validation rule, search all transport layers for the same input type and update them in the same PR. Asymmetric validation means one transport silently accepts input that another rejects, which is a security inconsistency.

The frontend store layer (functions in `document-store-solid.tsx` that call GraphQL mutations) is also a transport boundary — it must validate inputs against the same constants as the server before making the network call.

### Migrations Must Remove All Superseded Code

When migrating from one protocol, library, or API to another (e.g., WebSocket to GraphQL, REST to gRPC), the migration PR MUST include deletion of ALL superseded artifacts. Before marking a migration complete, search for:
1. Dead route/proxy configuration (e.g., Vite proxy entries, nginx routes, reverse proxy rules).
2. Dead type definitions that only served the old protocol's wire format, and over-wide interfaces carried forward from the old implementation that expose more surface area than the new code requires — trim to the actually-used subset.
3. Dead handler/endpoint code that is no longer reachable.
4. Dead test fixtures or mocks for the old protocol.
5. Dead dependencies in package.json/Cargo.toml that were only used by the old code.
A migration that adds the new path without removing the old path is incomplete. Use `grep` for old endpoint paths, old type names, and old import paths to verify full removal.

### Do Not Use Positional Index as Item Identity in Dynamic Lists

When a list can be mutated (items added, removed, or reordered), the array index MUST NOT be used as the stable identity of an item for selection, dispatch, or key generation. Array indices shift when items are inserted or removed — code that selects "stop at index 2" breaks silently when a stop is inserted before it. Instead: assign a stable `id` (UUID or incrementing counter) to each item at creation time, and use that `id` for selection and dispatch. This applies to: gradient stops, layer lists, token groups, component variants, field sets, and any other UI or data list whose membership changes at runtime. Using index as identity is a bug — it produces incorrect behavior on any mutation that changes list order or length.

### Math Helpers Must Guard Their Domain

Any function that wraps a standard math operation with a constrained domain (`Math.pow`, `Math.sqrt`, `Math.log`, `Math.asin`, `Math.acos`) MUST validate that its input falls within the function's valid domain before calling it. Do not rely on callers to have pre-validated inputs — a helper function receives values from multiple call sites, and one caller passing an out-of-range value produces NaN that propagates silently through the entire computation chain. Required guards: `Math.sqrt(x)` requires `x >= 0`; `Math.pow(x, p)` with a fractional exponent requires `x >= 0`; `Math.log(x)` requires `x > 0`; `Math.asin(x)` and `Math.acos(x)` require `-1 <= x <= 1`. Return 0, clamp to the valid range, or throw — but do not allow NaN to escape the function. Document the choice in a comment.

### Parallel Implementations Must Have Parity Tests

When the same algorithm, function set, or computation is implemented in both Rust (`crates/core/`) and TypeScript (`frontend/`), the PR that introduces the second implementation MUST include cross-language parity tests. For each function or behavior implemented in both languages:
1. Define a shared test vector file (JSON) in `tests/fixtures/parity/` containing input-output pairs.
2. The Rust test suite must load the vectors and assert the Rust implementation produces the expected outputs.
3. The TypeScript test suite must load the same vectors and assert the TypeScript implementation produces the expected outputs.

Test vectors must cover: (a) normal inputs, (b) boundary values (0, 1, max), (c) the specific semantics most likely to diverge (scale/range of numeric values, argument order, naming conventions, edge case behavior). If a function intentionally differs between Rust and TypeScript (e.g., because the frontend uses a simplified approximation), document the divergence in a comment in both implementations and exclude it from parity vectors with a rationale.

This rule exists because PR #55 (Spec 13d) shipped 6 Critical/High bugs where the TypeScript expression evaluator diverged from the Rust evaluator on function semantics — inverted size functions, different channel scales, different blend mode naming, and missing alpha compositing.

This rule applies to **shared wire-format types**, not only algorithms. When a type that crosses the Rust↔TypeScript boundary (enums, discriminated unions, structs serialized via GraphQL/MCP/WebSocket) gains a new variant or field on one side, the same PR MUST: (1) add the variant on both sides, (2) add a parity fixture in `tests/fixtures/parity/` with one entry per variant covering the full encoding, (3) update every transport handler (GraphQL resolver, MCP tool, WebSocket broadcast, `apply-remote.ts`) to handle the new variant. A type whose Rust and TypeScript definitions have diverged variant sets is a bug regardless of whether an algorithm exists — deserialization will fail at runtime on the side missing the variant.
