# ADR-001: Desktop-First Deployment with Tauri and MCP Discovery

**Status:** Accepted
**Date:** 2026-04-13

## Context

The original Product Design Record assumed deployment as a Docker image. This was based on an initial understanding that MCP servers needed a containerized environment to function alongside the HTTP server.

After deeper analysis, MCP's transport model works better in a native desktop context than inside containers. The stdio transport — the most widely supported MCP transport — requires the AI tool to spawn the MCP server as a local subprocess. Inside Docker, this creates friction: the AI tool on the host must either shell into the container, proxy through HTTP transport, or run a separate binary outside the container.

Additionally, the target user (a designer using AI tools) benefits from a native app experience — system tray, file associations, OS integration — that Docker cannot provide.

## Decision

### Primary deployment: Tauri desktop application

Sigil ships as a Tauri app. The Rust backend (core engine, state management, HTTP server, MCP server) runs natively. The frontend runs in a system webview.

### Secondary deployment: Docker (headless)

The Docker image remains for headless use cases: CI pipelines, agent-only batch processing, design linting, token export. In this mode, there is no frontend — the container exposes the MCP server (via Streamable HTTP transport) and the GraphQL API.

### MCP operates in three modes

| Mode | Transport | When |
|------|-----------|------|
| Sidecar (stdio) | stdin/stdout | AI tool spawns the MCP binary directly. App may or may not be running. |
| In-app (HTTP) | Streamable HTTP on localhost | App is running, agent connects to its local endpoint. |
| Headless (HTTP) | Streamable HTTP on container port | Docker deployment, no UI. |

### Single binary, multiple entry points

The Sigil binary serves double duty:

- **Launched by user:** Starts the Tauri window + embedded HTTP server + MCP HTTP endpoint.
- **Spawned by AI tool:** Runs as a stdio MCP server (no window, no HTTP). Communicates with a running Sigil instance via IPC if one exists, or operates on design files directly if not.

The entry point is determined by a flag:

```
sigil                    → desktop app
sigil --mcp-stdio        → stdio MCP server (sidecar mode)
sigil --headless         → HTTP server only (Docker mode)
```

## MCP Discovery

### Level 1: Installer-driven registration (ship at launch)

When Sigil is installed, the installer or first-run wizard writes MCP server configuration into known locations for supported AI tools:

- Claude Code: `~/.claude/settings.json` or project `.mcp.json`
- Cursor: workspace MCP settings
- VS Code: user/workspace settings

The configuration points to the installed Sigil binary with the `--mcp-stdio` flag. This is a one-time setup that makes Sigil immediately available to AI agents.

### Level 2: Well-known manifest (ship at launch, forward-looking)

The app writes a machine-readable manifest to a well-known path:

```
~/.mcp/servers/sigil.json
```

```json
{
  "name": "sigil",
  "version": "1.0.0",
  "description": "AI-native design tool",
  "transport": {
    "stdio": {
      "command": "/Applications/Sigil.app/Contents/MacOS/sigil",
      "args": ["--mcp-stdio"]
    },
    "http": {
      "url": "http://localhost:4680/mcp",
      "requires_app_running": true
    }
  },
  "capabilities": ["tools", "resources"]
}
```

No AI tool reads this path today, but this positions Sigil for when the MCP ecosystem standardizes discovery. The manifest format is simple and self-describing — other tools can adopt it independently.

## Architectural Impact

### What changes

| Concern | Docker (current) | Tauri (new primary) |
|---------|------------------|---------------------|
| Frontend serving | Axum serves static files | Tauri webview loads from bundle |
| File access | Volumes, container paths | Direct filesystem |
| MCP transport | HTTP only (port mapping) | stdio (native) + HTTP (localhost) |
| OS integration | None | System tray, file associations, native dialogs |
| Auto-update | Pull new image | Tauri updater (built-in) |
| Process model | Single container | App process + optional sidecar |

### What does NOT change

- `agent-designer-core`: unchanged (pure logic, no I/O)
- `agent-designer-state`: unchanged (in-memory state, transport-agnostic)
- `agent-designer-mcp`: unchanged (tool definitions are transport-agnostic)
- `agent-designer-server`: HTTP routes and GraphQL schema unchanged
- `frontend/`: SPA code unchanged (runs in webview instead of browser tab)
- File format: `.sigil/` workfiles unchanged
- MCP tool interface: unchanged

The core architecture is already transport-agnostic. The Tauri migration is primarily a new shell around the same components.

### New crate

A `sigil-desktop` or `sigil-app` crate owns the Tauri shell:

```
sigil/
├── crates/
│   ├── core/
│   ├── state/
│   ├── server/
│   ├── mcp/
│   └── app/           # Tauri shell, entry point routing, IPC bridge
├── frontend/
└── src-tauri/          # Tauri configuration (Cargo workspace member)
```

### IPC between sidecar and running app

When an AI tool spawns `sigil --mcp-stdio` and a Sigil desktop instance is already running with a document open, the sidecar should connect to the running instance rather than operating on files independently. This ensures the agent and human see the same live state.

The IPC mechanism (Unix domain socket, localhost TCP, or platform-specific IPC) is an implementation detail to be decided when building the Tauri shell. The important constraint: the MCP tool definitions remain identical regardless of whether the sidecar proxies to a running instance or operates standalone.

## Consequences

### Positive

- AI agents get the best MCP experience: native stdio, zero container overhead.
- Users get a real desktop app with OS integration.
- The app can work offline (no container runtime dependency).
- Tauri's built-in updater handles distribution and updates.
- The Docker image becomes simpler (headless only, no frontend serving complexity).

### Negative

- Cross-platform builds are more complex than a single Docker image.
- Tauri depends on system webview (WebKitGTK on Linux, WebView2 on Windows, WKWebView on macOS) — rendering differences possible.
- Two distribution channels to maintain (desktop + Docker).
- IPC between sidecar and running app adds complexity.

### Risks

- Tauri's system webview dependency may cause issues on older Linux distributions.
- The sidecar ↔ running app IPC protocol needs careful design to avoid state conflicts.

## Related Decisions

- ADR-002 (Plugin System) addresses how community extensibility interacts with this architecture.
- The Spec 06 (Container & DevOps) scope narrows to headless-only deployment.
- A future ADR will address the Tauri auto-update and distribution strategy.
