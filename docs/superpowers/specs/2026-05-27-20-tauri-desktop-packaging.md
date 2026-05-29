# Spec 20 — Tauri desktop packaging with multi-session server

**Status:** brainstormed 2026-05-27, supersedes the 2026-05-27 first draft of Spec 20 (single-document, per-window sidecars). Absorbs the originally-deferred Spec 21 (multi-workfile) — tabs are re-deferred to a future UI redesign spec.

**Goal.** Ship Sigil as a Tauri 2.x desktop app for macOS / Windows / Linux. Users and AI agents work side-by-side on the same document, at the same time, via a singleton `sigil-server` that tracks open workfiles as named sessions.

## 1. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Tauri shell                          │
│  - Spawns + supervises sigil-server (port 4680)          │
│  - Owns windows + native menubar + file-open intents     │
│  - window<->session map (Tauri-side, replayed on restart)│
└──────────┬───────────────────────────┬───────────────────┘
           │ spawn/SIGTERM             │ HTTP+WS
           ▼                           ▼
┌──────────────────────────────────────────────────────────┐
│         sigil-server (singleton, port 4680)              │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Sessions: HashMap<SessionId, Arc<DocumentSession>> │  │
│  │  - keyed by canonical workfile path                │  │
│  │  - per-session broadcast channel                   │  │
│  │  - per-session apply in tokio::spawn + catch_unwind│  │
│  └────────────────────────────────────────────────────┘  │
│  /graphql  /graphql/ws  /mcp        /heartbeat           │
└──────────────────────────────────────────────────────────┘
           ▲
           │ HTTP (localhost:4680/mcp)
           │
    ┌──────┴───────┐
    │ MCP client   │
    │ (Claude /    │
    │  Cursor /    │
    │  ChatGPT)    │
    └──────────────┘
```

**Invariants.**

1. **One `sigil-server` per Tauri instance.** Fixed port 4680. Collision at launch → actionable fatal error, shell exits. `tauri-plugin-single-instance` prevents multi-launch of the shell itself.
2. **One session per canonical workfile path.** Opening an already-open file returns the existing SessionId; a second window joins the live session.
3. **Sessions die when their last window closes.** The shell tracks `window_label → workfile_path` (the SessionId is a runtime cache, never persisted) and calls GraphQL `closeSession` when no window is mapped to the session anymore.
4. **Server lifetime = Tauri lifetime.** SIGTERM on Tauri quit, 5s drain, SIGKILL fallback. `kill_on_drop(true)` + PID lockfile + heartbeat cover crashed-Tauri-orphan cases.
5. **All session-aware GraphQL operations carry the session in an `X-Sigil-Session` request header** (HTTP) or WS `connection_params` (subscriptions). MCP tools take an optional `session_id` parameter with smart defaults.
6. **No authentication.** Server binds `127.0.0.1` only — trust boundary is "anything on this machine." Auth becomes a separate spec when remote/cloud lands.

## 2. Components

### 2.1 `sigil-state` — Sessions refactor

Replace today's single `DocumentStore` with a `Sessions` registry:

```rust
pub struct Sessions {
    by_id: RwLock<HashMap<SessionId, Arc<DocumentSession>>>,
    by_path: RwLock<HashMap<PathBuf, SessionId>>,
}

pub struct DocumentSession {
    pub id: SessionId,
    pub workfile_path: PathBuf,
    pub store: RwLock<DocumentStore>,
    pub broadcast: tokio::sync::broadcast::Sender<Event>,
    pub state: AtomicSessionState, // Live | Errored
}

impl Sessions {
    pub fn open(&self, path: &Path) -> Result<SessionId>;
    pub fn close(&self, id: SessionId) -> Result<()>;
    pub fn list(&self) -> Vec<SessionInfo>;
    pub fn with_session<R>(&self, id: SessionId, f: impl FnOnce(&DocumentSession) -> R) -> Option<R>;
}

pub enum SessionState { Live, Errored }
```

**SessionId** — UUIDv4 wrapped in a newtype. Not persisted, not exposed as an arena index; safe to serialize to clients.

**Path canonicalization.** `Sessions::open` calls `std::fs::canonicalize` (symlinks resolved) before checking `by_path`. Two intents to open `~/foo.sigil` resolve to the same canonical path → same session.

**Panic isolation.** Mutations route through `with_session`, which wraps the closure in `std::panic::catch_unwind(AssertUnwindSafe(...))`. On panic: session's `state` flips to `Errored`, a fatal event broadcasts, the session refuses further mutations until reopened. Other sessions unaffected.

**Per-session broadcast channels.** Each session owns a `tokio::sync::broadcast` channel. Subscribers (WS clients viewing this session, MCP clients explicitly subscribed) receive events for *only that session*. Replaces today's single global channel.

### 2.2 `sigil-server` — transport refactor

Same axum stack, four routes:

| Route | Method | Session source |
|---|---|---|
| `/graphql` | POST | `X-Sigil-Session: <id>` header (extracted in axum middleware → request extension) |
| `/graphql/ws` | WebSocket | `connection_params.sessionId` on `connection_init` (graphql-ws protocol) |
| `/mcp` | POST | Optional per-tool-call `session_id` argument |
| `/heartbeat` | GET | None — liveness check from Tauri shell |

**New GraphQL surface:**

```graphql
type SessionInfo {
  id: ID!
  workfilePath: String!
  title: String!
  openedAt: String!
  state: SessionState!
}

enum SessionState { LIVE, ERRORED }

type Query {
  sessions: [SessionInfo!]!     # header absent
  # existing queries require X-Sigil-Session
}

type Mutation {
  openSession(path: String!): SessionInfo!  # header optional
  closeSession(id: ID!): Boolean!           # header optional
  # existing mutations require X-Sigil-Session
}
```

**Header policy.**
- `openSession`, `closeSession`, `sessions` — header MAY be absent.
- All other operations — header REQUIRED. Missing header → typed error `SESSION_REQUIRED` with hint to call `sessions` query.

**Existing mutations.** Today's resolvers call `state.app.execute(...)` directly. After refactor they call `sessions.with_session(extract_session(ctx)?, |s| s.store.execute(...))`. One additional `HashMap` lookup per mutation — measured negligible.

### 2.3 `sigil-mcp` — Streamable HTTP

Add `axum_router(sessions: Arc<Sessions>) -> axum::Router` alongside existing `start_stdio`. Mounted at `/mcp` in `sigil-server`. Single endpoint, JSON-RPC over HTTP; long-running tools may upgrade to SSE per the Streamable HTTP spec.

**Tool surface changes.**

- Two new unconditional tools (no `session_id` needed):
  - `list_open_sessions` → `[{id, workfile_path, title, opened_at}]`
  - `get_active_workfiles` — alias for discoverability
- Every existing mutation tool gains an *optional* `session_id` parameter.
- Resolution order:
  1. Explicit `session_id` → look it up. If not found, return typed error with `open_sessions` list.
  2. No `session_id` AND exactly one session is open → use it.
  3. No `session_id` AND zero/many sessions → typed error with `open_sessions` list and a hint.

**Existing stdio MCP unchanged.** `MCP_STDIO=1 sigil-server` still wires the stdio path. Sessions API is shared, so the same multi-session logic applies if a stdio client opens multiple workfiles via the new `open_session` MCP path (which is user-only in v1 — stdio agents are out-of-scope for v1 multi-session, but the path doesn't actively break either).

**Broadcasting.** Agent mutations go through the same `Sessions::with_session` → broadcast path as GraphQL mutations. Subscribers (frontend WS clients + any MCP clients subscribed to the session) see the change in real time. No special MCP-broadcast code.

### 2.4 `sigil-shell` (Tauri, `src-tauri/`)

```rust
struct AppState {
    server_proc: Mutex<Option<SidecarProcess>>,
    windows: Mutex<HashMap<String /*window_label*/, PathBuf /*workfile*/>>,
    graphql_client: GraphQLClient,
}
```

**Server supervision:**
- Spawn `sigil-server --port 4680` at shell startup.
- Port collision → fatal `ServerPortInUse` error with actionable message (mentions: existing Sigil instance, or other process on 4680). Shell exits.
- Heartbeat: shell sends `GET /heartbeat` every 5s. Three consecutive failures → treat as crash.
- Server self-shutdown: if no heartbeat received for 15s, exit (catches crashed-shell case).
- PID lockfile at `app_data_dir/server.pid`. On shell launch: if file exists AND PID is alive AND port responds → defensive single-instance violation (shouldn't happen). If PID dead or port silent → unlink and spawn.
- `kill_on_drop(true)` on `tokio::process::Child` — OS reaps server if shell dies abruptly.

**Window-create flow** (single canonical path for all open-intents):

1. Trigger fires (File → Open dialog, OS double-click, drag onto dock, single-instance argv from second launch, "Reopen" from launcher).
2. Shell calls `mutation { openSession(path) { id, title } }` on the server.
3. Server canonicalizes path, deduplicates, returns SessionId.
4. Shell checks: any existing window already viewing this session? If yes → `set_focus` it, return.
5. If no → create new Tauri window via `WebviewWindowBuilder` with `initialization_script: "window.__SIGIL_SESSION_ID__='<id>'; window.__SIGIL_SERVER_PORT__=4680;"`.
6. Shell records `windows[window_label] = workfile_path` (the PathBuf, not the SessionId — see crash recovery).

**Window-close flow:**

1. `CloseRequested` fires.
2. Shell removes the entry from `windows`.
3. Shell checks: any other window still mapped to this `workfile_path`? If yes → just close. If no → call `closeSession(id)` GraphQL mutation (the shell can re-query SessionId from path via `openSession`-is-idempotent semantics, but simpler: cache the runtime SessionId alongside path in `windows`).
4. Empty-windows policy: if `windows` becomes empty AND the platform is non-macOS → quit the app (Win/Linux idiom). On macOS, leave the app in the dock with no windows.

**Crash recovery (policy C from brainstorming Q5):**

1. Tauri shell detects server death via: dead child process exit OR 3 consecutive heartbeat failures OR all-WS-disconnect.
2. Shows non-modal toast: *"Sigil's engine restarted. Reopening your workfiles…"*
3. Respawns `sigil-server --port 4680`.
4. For each entry in `windows: HashMap<window_label, PathBuf>`:
   - Call `openSession(path)` on the new server, get fresh SessionId.
   - Send a custom Tauri event `session-replaced { window_label, new_session_id }` to that window.
   - Frontend handler: re-subscribes WS with the new SessionId.
5. Recovery completes when all windows have re-subscribed. Toast dismisses.

**Restore-on-launch:**
- `app_data_dir/sessions.json` is the persisted list of currently-open workfile paths. Written atomically (temp + rename) on every `windows` map mutation.
- On cold shell launch: if `sessions.json` exists with N > 0 paths → open one empty "Welcome" window with a non-modal banner: *"Reopen 3 workfiles? [Reopen] [Skip]"*.
- If user clicks Reopen → walk through each path, open a window for each.
- If user clicks Skip → discard the list, fresh start.

**Empty welcome window:** when shell has no windows (e.g., user closed everything on macOS, or fresh launch with Skip clicked), show a launcher window with:
- "Open Workfile…" button
- Recent Files list (from `recent_files.rs` — survives from PR #73)
- "New Workfile…" button — opens save dialog → create skeleton on disk → `openSession`
- Reopen-banner if `sessions.json` is non-empty

**Native menubar:** essentially carries over from PR #73. Menu IDs are session-agnostic; the frontend dispatcher routes `edit.undo` etc. to the store's undo/redo, which are now scoped to the current window's session via the injected globals.

**Single-instance plugin callback:** parses argv via `file_assoc::extract_workfile_path`. If a `.sigil` path is present → call `openSession(path)` → focus existing window or create new one (window-create flow). If no path → focus an arbitrary existing window or show the launcher.

### 2.5 Frontend

**Globals at window startup:**
- `window.__SIGIL_SESSION_ID__: string` — injected by shell
- `window.__SIGIL_SERVER_PORT__: number` — injected by shell (always 4680 for v1, kept as a global for future per-instance flexibility)

**URL construction** (the `sidecar-url.ts` helper from PR #73 simplifies):
- HTTP: `http://localhost:${__SIGIL_SERVER_PORT__}/graphql`
- WS: `ws://localhost:${__SIGIL_SERVER_PORT__}/graphql/ws`
- All HTTP requests inject `X-Sigil-Session: ${__SIGIL_SESSION_ID__}` header in the urql client's `fetchOptions`.
- WS `connection_params.sessionId` set at client construction.

**Session-replaced handler.** Listen for the Tauri event `session-replaced`. On fire: update the injected global, tear down the urql client, recreate it with the new session, re-subscribe. Frontend signals the user a brief "reconnecting…" status; data re-arrives within seconds.

**Menu-event dispatcher** unchanged from PR #73 — routes `edit.undo`/`edit.redo` to the store, which already scopes to its session via injected globals.

## 3. Data flow examples

**User opens `~/foo.sigil` via File → Open:**
```
User → Tauri (file picker) → Shell.openSession(path)
  ↓
GraphQL mutation { openSession(path: "/Users/.../foo.sigil") }
  ↓
sigil-server: canonicalize → check by_path index → create or reuse
  ↓
Return SessionInfo { id, title, … }
  ↓
Shell: WebviewWindowBuilder.initialization_script("window.__SIGIL_SESSION_ID__='abc'…")
  ↓
Frontend reads global → urql client uses session header → renders document
```

**User opens an already-open file:**
```
Same flow, but server's by_path lookup returns existing SessionId.
Shell checks: any window mapped to this path? If yes → focus.
If no → second window opens, shares the session. Both windows subscribe
to the same broadcast channel. Real-time co-edit between them.
```

**Agent connects via Claude Desktop:**
```
User config: { "mcpServers": { "sigil": { "url": "http://localhost:4680/mcp" } } }
  ↓
Claude → POST /mcp { tool: "list_open_sessions" }
  ↓
sigil-server → Sessions::list → returns [{ id: "abc", path: "~/foo.sigil", … }]
  ↓
Claude → POST /mcp { tool: "move_node", node_id: …, position: … }    # no session_id
  ↓
sigil-server: exactly one session → use SessionId "abc" → apply mutation
  ↓
Broadcast on session "abc"'s channel
  ↓
Both Tauri windows (subscribed to "abc") receive the event → re-render
```

**Server panic, single session affected:**
```
Mutation applies → panics inside the with_session closure
  ↓
catch_unwind catches → session.state = Errored
  ↓
Broadcast { type: "session_fatal", error: … } on session's channel
  ↓
Frontend windows on this session: show "this document hit an error — reload?"
  ↓
User clicks reload → frontend triggers shell to call openSession(path) again
  ↓
Server: existing session is Errored, recreate fresh → new SessionId
  ↓
Shell re-injects new SessionId into the window
```

**Server whole-process crash:**
```
Shell heartbeat fails 3x consecutively (15s window)
  ↓
Shell: toast "Sigil's engine restarted. Reopening your workfiles…"
  ↓
Shell respawns sigil-server --port 4680
  ↓
For each (window_label, workfile_path) in shell.windows:
    new_id = openSession(path)
    emit session-replaced { window_label, new_id }
  ↓
Each frontend window re-subscribes WS with the new SessionId
  ↓
Toast dismisses on completion
```

## 4. Error handling

| Failure | Detection | Response |
|---|---|---|
| Per-session panic | `catch_unwind` in `with_session` | Session marked `Errored`, fatal event broadcasts, other sessions unaffected |
| Whole-server panic / OOM | Shell: dead child + heartbeat fail | Auto-restart + replay open-session list (policy C) |
| Tauri shell crash | OS / `kill_on_drop` / server's own 15s no-heartbeat timeout | Server self-terminates; user relaunches Sigil from Dock |
| Port 4680 occupied at launch | `TcpListener::bind` fails | Fatal `ServerPortInUse` error dialog with actionable message; shell exits |
| Stale PID lockfile | PID-alive check + port-responsive check | Unlink stale lockfile, continue |
| Workfile path doesn't exist | `Sessions::open` returns error | GraphQL error surfaces in frontend; window not created; shell logs |
| Workfile path is not a `.sigil/` | Validation in `Sessions::open` | Typed error `INVALID_WORKFILE_PATH`; window not created |
| MCP tool call with bad session_id | `Sessions::with_session` returns `None` | Typed error including `open_sessions: [...]` so agent can retry |
| MCP tool call with no session_id, multiple sessions | Resolution rule 3 | Typed error including `open_sessions: [...]` and `hint: "specify session_id"` |
| WS subscribe with bad session_id | Validation on `connection_init` | Reject with typed error; client may retry |
| Frontend missing injected globals | `__SIGIL_SESSION_ID__` undefined | Show "no session — please reopen from menu" error UI; don't crash |

## 5. Testing

| Layer | Tests |
|---|---|
| `sigil-state::Sessions` | Open/close/dedup, list, with_session returns None on bad id, panic isolation (verify other sessions still work), state flips to Errored on panic, by_path canonicalization |
| `sigil-server` GraphQL | Header-required mutations reject without `X-Sigil-Session`, `openSession` returns same ID for canonicalized paths, WS subscriptions scope to their session's channel, header-absent mutations (openSession etc.) succeed without header |
| `sigil-server` MCP | `list_open_sessions` shape, single-session defaulting, multi-session error returns `open_sessions` list, broadcast on correct per-session channel, mutation with bad `session_id` returns helpful error |
| `sigil-shell` Rust | `argv` parsing (carries from PR #73), recent_files (carries), window↔path mapping correctness, crash recovery replay (mock server-restart, assert `openSession` called for each known path) |
| Frontend | Reading injected globals, urql client adds `X-Sigil-Session` header, `session-replaced` event triggers reconnect, missing-global error UI |
| Manual smoke (Task 15 of plan) | Launch Sigil → open foo.sigil → second window → Claude Code MCP connects → agent edits → both windows see → kill -9 server → toast + recovery |

## 6. Out of scope

Explicit deferrals — reviewers and future contributors should NOT file findings against PR #73's successor for items in this list:

- Code signing (Apple Developer ID, Windows EV cert) — Spec 22+
- Auto-update — Spec 22+
- Crash reporting (Sentry / similar) — Spec 22+
- Tabs / multi-workfile-in-window — future UI redesign spec (was the original Spec 21, now absorbed-and-redeferred)
- Cloud hosting / remote sessions / authentication — Spec 22+
- Agent-initiated `open_session`/`close_session` — v2 of this spec
- HTTP+SSE MCP transport — add when an actual client requires it (Streamable HTTP is the current standard)
- Production-quality icons — Spec 16 (visual identity)
- View → Zoom menu wiring — needs viewport state exposed to menu handlers (separate follow-up)
- Stdio↔HTTP MCP bridge binary — add only if a real stdio-only client appears

## 7. PDR Traceability

This spec implements the following PDR (product design record) features:

- "Local-first desktop application that runs on macOS / Windows / Linux"
- "User and AI agent collaborate on the same document in real time"
- "Multiple instances for different projects"
- "Filesystem-backed workfiles (`.sigil/` directory bundles)"
- "Real-time WebSocket synchronization between clients"

Explicitly defers (with PDR alignment):
- Cloud hosting (PDR notes "may be hosted online" — undecided; this spec is local-only)
- Multi-window UI evolution into tabs (PDR mentions "panels and tabs" as UX vocabulary; v1 ships separate windows, future UI redesign spec covers tabs)

## 8. Input Validation Inventory

Per CLAUDE.md §10.

| New input | Validation |
|---|---|
| `openSession(path: String)` — GraphQL/MCP | Path canonicalization MUST succeed (`std::fs::canonicalize`). Path MUST end in `.sigil` extension. Path MUST be a directory. Path MUST be readable (validate via opening the manifest). Failures return typed `INVALID_WORKFILE_PATH` error. |
| `closeSession(id: SessionId)` — GraphQL/MCP | SessionId MUST exist in `by_id`. Otherwise typed `SESSION_NOT_FOUND` error. |
| `X-Sigil-Session` header value | MUST be a valid UUIDv4 string. MUST resolve in `by_id` for header-required operations. Bad format → `INVALID_SESSION_HEADER`. Unknown id → `SESSION_NOT_FOUND`. |
| WS `connection_params.sessionId` | Same rules as the header. |
| MCP `session_id` argument | Same rules; in addition: when omitted, resolution falls through to the smart-default rules (see §2.3). |
| `--port` CLI on `sigil-server` (carries from PR #73) | Already validated. |
| `--workfile` CLI on `sigil-server` (carries from PR #73) | Already validated. |
| `sessions.json` on shell startup | Parse failure → log warning, treat as empty list (don't refuse to launch). |

No new validation in `sigil-core` — this spec doesn't touch core types.

## 9. Consistency Guarantees

Per CLAUDE.md §10.

- **Session open is atomic.** `Sessions::open` either returns a SessionId (new or existing) or fails entirely. No half-created sessions: if canonicalization succeeds but `DocumentStore::load` fails, no entry is left in `by_id` or `by_path`.
- **Session close is atomic.** `Sessions::close` removes from both indexes in a single critical section (write-locked both maps). Persistence flush is best-effort and runs *after* the entry is removed from the index.
- **Per-session mutations remain atomic.** No change to existing FieldOperation atomicity — `with_session` just adds a HashMap lookup before delegating to the existing `store.execute(...)` path.
- **`sessions.json` write is atomic.** Write-to-temp-then-rename (same pattern as workfile persistence). Concurrent shell writes are serialized through the shell's `windows` Mutex.
- **No batch session ops.** No multi-session compound operations in v1. Closing all sessions on Tauri quit happens via N independent `closeSession` calls, each atomic.
- **Crash recovery is best-effort.** If `openSession(path)` fails during recovery (file deleted between sessions), the affected window shows an error UI and stays open (so the user can see what was lost). Other windows recover normally.

## 10. Cross-Stack Type Extension Inventory

`SessionInfo` is a new shared wire-format type crossing Rust↔TypeScript via GraphQL and MCP.

| Site | Action this PR |
|---|---|
| Rust: `sigil-state::SessionInfo` struct | Create |
| GraphQL schema (server-side): `type SessionInfo` | Create |
| TypeScript: `frontend/src/types/session.ts` interface | Create |
| GraphQL resolvers for `Query.sessions`, `Mutation.openSession`, `Mutation.closeSession` | Create |
| MCP tool handlers for `list_open_sessions`, `get_active_workfiles`, and the `session_id` extension on existing mutation tools | Update each existing tool (~10 tools) |
| Frontend urql client: send `X-Sigil-Session` header | Update document-store-solid.tsx |
| `apply-remote.ts` (frontend GraphQL subscription handler) | No change — already operates within a session-scoped subscription; broadcast payloads are session-scoped by routing |

`SessionState` enum (`Live` / `Errored`) is also a new shared type but only appears in `SessionInfo`. Same checklist applies — created in Rust, mirrored in GraphQL schema and TypeScript.

Exhaustiveness sentinels per `frontend-defensive.md`:
- TS `SessionState` is a string union → add `.test-d.ts` sentinel that exhaustively switches.
- Rust `SessionState` enum is non-dispatch (no `match` arms in business logic — UI just renders a status label) → no exhaustiveness rule applies until/unless a dispatch site is added.

## 11. Migration from PR #73

PR #73 is closed without merging. Surviving commits are cherry-picked into a fresh branch for this spec's implementation.

| Commit | Action |
|---|---|
| `feat(server): --port and --workfile CLI args` | Keep |
| `fix(server): error on malformed PORT env var` | Keep |
| `feat(frontend): sidecar-url helper` | Discard (replaced by direct localhost:4680 — no helper) |
| `feat(server): pick_free_port helper` | Discard (fixed port) |
| `feat(shell): scaffold src-tauri/` | Keep |
| `feat(shell): sidecar spawn + graceful shutdown` | Keep with edits (single sidecar, not per-window) |
| `feat(shell): argv parsing + single-instance plugin` | Keep |
| `feat(shell): native menubar + frontend dispatcher` | Keep |
| `feat(shell): per-window sidecar lifecycle + multi-window` | Discard entirely |
| `feat(shell): File → Open/New dialogs + new-window spawn` | Keep with edits (spawn → openSession + new window) |
| `feat(shell): recent-files persistence` | Keep |
| `feat(shell): icons + .sigil file associations` | Keep |
| `feat(frontend): Vite config TAURI_DEV_HOST` | Keep |
| `ci: cross-platform Tauri build matrix` | Keep |
| `docs: CLAUDE.md updates` | Keep with edits (crate description for sigil-shell) |

Net: ~9 of 15 commits survive. The big new work is `sigil-state` Sessions, GraphQL/WS session plumbing, MCP-over-Streamable-HTTP, shell crash recovery, restore-on-launch.

## 12. Visible-impact summary

After this spec ships:

- Users double-click `.sigil/` in Finder → Sigil opens it in a new window.
- Two windows on the same workfile sync in real time.
- An MCP-configured agent in Claude Code / Cursor / Claude Desktop connects to `http://localhost:4680/mcp` and edits alongside the user.
- Server panics in one document don't take down other open documents.
- The whole engine crashing → engine restarts, all open workfiles reopen automatically.
- Cold launch → "Reopen N workfiles?" banner.
- Closing all windows on macOS leaves Sigil in the dock (with a launcher window if the user clicks the icon).
- Closing all windows on Win/Linux quits the app.
