# ADR-002: WASM Plugin System for Community Extensibility

**Status:** Accepted
**Date:** 2026-04-13

## Context

Sigil is designed to be an extensible platform, not a closed application. Designers and developers in the community should be able to extend Sigil with new capabilities — linting rules, import/export formats, custom panels, integrations with external services, additional MCP tools for agent workflows — without needing access to the source code or recompiling the app.

This requires a plugin system that is:

- **Runtime-installable** — non-technical users can install plugins into a pre-built app.
- **Hot-swappable** — plugins load and unload without restarting.
- **Sandboxed** — plugins cannot compromise the host app or the user's system.
- **Cross-platform** — a single plugin package works on macOS, Windows, and Linux.
- **Full-stack** — a plugin can include both backend logic and frontend UI.

## Decision

### Plugin runtime: WASM (backend) + JS (frontend)

Plugins execute in a sandboxed WASM runtime on the backend and as JavaScript bundles on the frontend.

- **WASM backend** — sandboxed, cross-platform, language-agnostic. Plugin authors can use Rust, C, Go, AssemblyScript, or any WASM-targeting language.
- **JS frontend** — pragmatic choice. UI development in WASM is immature. JS gives plugin developers access to the DOM and web ecosystem. Frontend plugins run in a restricted context with access to a Sigil API object — not raw DOM access to the host app.

The backend WASM runtime is Wasmtime (mature, Rust-native, maintained by the Bytecode Alliance). Each plugin instance runs in its own sandboxed WASM store.

### Plugin package format

A plugin is distributed as a `.sigil-plugin` archive:

```
my-plugin.sigil-plugin
├── manifest.json
├── backend.wasm           # Optional — plugins can be frontend-only
├── frontend.js            # Optional — plugins can be backend-only
├── assets/
│   ├── icon.svg
│   └── locales/
│       ├── en.json
│       └── fr.json
└── README.md
```

### Manifest schema

```json
{
  "name": "design-linter",
  "version": "1.0.0",
  "author": "community-dev",
  "license": "MIT",
  "sigil_api": "^1.0",
  "entry": {
    "backend": "backend.wasm",
    "frontend": "frontend.js"
  },
  "permissions": [
    "document:read",
    "document:subscribe",
    "ui:panel",
    "mcp:tools"
  ],
  "contributes": {
    "panels": [
      {
        "id": "design-linter",
        "title": "Design Linter",
        "icon": "assets/icon.svg",
        "position": "right"
      }
    ],
    "mcp_tools": [
      {
        "name": "lint_document",
        "description": "Run design lint rules on the current document"
      }
    ]
  }
}
```

The `sigil_api` field declares compatibility with the host API version, enabling the host to reject incompatible plugins at load time.

### Permission model

Plugins declare required permissions in their manifest. Users see the permission list at install time and can accept or reject.

| Permission | Grants |
|-----------|--------|
| `document:read` | Read nodes, pages, styles, tokens |
| `document:write` | Apply operations, create/delete nodes |
| `document:subscribe` | Receive real-time mutation events |
| `ui:panel` | Register sidebar panels |
| `ui:toolbar` | Add toolbar buttons |
| `ui:canvas-overlay` | Render layers on top of the canvas |
| `ui:context-menu` | Add items to context menus |
| `mcp:tools` | Register MCP tools (agents can use the plugin) |
| `network:fetch` | Make HTTP requests (URL allowlist in manifest) |
| `storage` | Plugin-scoped persistent key-value store |

Permissions are enforced by the WASM host — the plugin physically cannot call functions it lacks permission for. This is a capability system, not a trust system.

### New crate: `plugin-api`

```
sigil/
├── crates/
│   ├── core/
│   ├── state/
│   ├── server/
│   ├── mcp/
│   └── plugin-api/     # Plugin trait definitions + host runtime
```

This crate owns:

- The `Plugin` trait and lifecycle callbacks.
- The `PluginContext` struct (registration APIs).
- The WASM host runtime (Wasmtime embedding, sandboxing, instance management).
- The plugin loader (reads `.sigil-plugin` archives, validates manifests, instantiates WASM modules).
- The permission enforcement layer.

### Plugin trait (Rust-side host API)

```rust
pub trait Plugin: Send + Sync {
    fn name(&self) -> &str;
    fn on_init(&self, ctx: &mut PluginContext) -> Result<()>;
    fn on_shutdown(&self) -> Result<()>;
}
```

### PluginContext (what plugins can register)

```rust
impl PluginContext {
    /// Add middleware to the HTTP stack
    pub fn add_middleware(&mut self, middleware: impl Middleware);

    /// Register additional HTTP routes
    pub fn add_routes(&mut self, router: Router);

    /// Register additional MCP tools
    pub fn add_mcp_tools(&mut self, tools: Vec<ToolDefinition>);

    /// Register a document store implementation (overrides default)
    pub fn set_document_store(&mut self, store: impl DocumentStore);

    /// Subscribe to document lifecycle events
    pub fn subscribe_events(&mut self, handler: impl EventHandler);

    /// Register a frontend UI extension
    pub fn register_ui_extension(&mut self, ext: UiExtension);
}
```

These registration APIs are generically useful. A design linter uses event subscriptions + MCP tools + UI panels. A Figma importer uses routes + MCP tools. An analytics plugin uses middleware + event subscriptions. The APIs serve all extension scenarios without being shaped for any specific one.

### WASM host API (what plugin code can call)

The WASM host exposes these functions as imports to plugin modules:

```
// Document access (requires document:read)
sigil_document_get_node(node_id) -> NodeData
sigil_document_list_nodes() -> Vec<NodeSummary>
sigil_document_get_page(page_id) -> PageData

// Document mutation (requires document:write)
sigil_document_apply_operation(op) -> Result<()>

// Event subscription (requires document:subscribe)
sigil_events_subscribe(event_type, callback_id)

// MCP tool registration (requires mcp:tools)
sigil_mcp_register_tool(definition, handler_id)

// Plugin ↔ frontend communication
sigil_ui_send_message(msg)
sigil_ui_on_message(callback_id)

// Plugin-scoped storage (requires storage)
sigil_storage_get(key) -> Option<Vec<u8>>
sigil_storage_set(key, value)
```

### Frontend plugin API (JavaScript)

```typescript
declare const sigil: {
  document: {
    getNode(id: string): NodeData | null;
    listNodes(): NodeSummary[];
    onMutation(handler: (event: MutationEvent) => void): Unsubscribe;
    applyOperation(op: Operation): Promise<Result>;
  };
  ui: {
    registerPanel(config: PanelConfig, render: () => HTMLElement): void;
    registerToolbarItem(config: ToolbarConfig, render: () => HTMLElement): void;
    registerCanvasOverlay(config: OverlayConfig, render: (ctx: CanvasRenderingContext2D) => void): void;
    registerContextMenuItem(config: MenuItemConfig): void;
  };
  backend: {
    sendMessage(msg: unknown): void;
    onMessage(handler: (msg: unknown) => void): Unsubscribe;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
};
```

Frontend plugins render into designated slots (panel containers, toolbar regions, canvas overlay layers). They do not have access to the host app's DOM tree or Solid.js reactive graph.

### Hot-swap lifecycle

1. **Install:** User downloads `.sigil-plugin` → app copies to `~/.sigil/plugins/`
2. **Load:** App reads manifest → validates permissions → user approves → instantiates WASM module → registers contributed panels/tools/routes → notifies frontend to mount UI extensions
3. **Unload:** App calls plugin's `shutdown()` export → drops WASM instance → unregisters all contributions → notifies frontend to unmount UI extensions
4. **Update:** Unload old version → load new version. Plugin-scoped `storage` persists across versions.
5. **Disable:** Plugin remains installed but unloaded. Re-enabling triggers step 2.

No app restart required for any of these operations.

### Plugin storage

Each plugin gets an isolated key-value store scoped to `~/.sigil/plugins/<plugin-name>/data/`. Plugins cannot access each other's storage or the host app's storage. The storage API is synchronous from the plugin's perspective (the host handles I/O).

### Plugin communication

Plugins can communicate with their own frontend component via `sigil_ui_send_message` / `sigil.backend.sendMessage`. Cross-plugin communication is not supported in v1 — plugins are isolated from each other. A future version may introduce a message bus for plugin interop if community demand warrants it.

### Example plugin scenarios

| Plugin | Permissions | Backend | Frontend |
|--------|------------|---------|----------|
| Design linter | `document:read`, `document:subscribe`, `ui:panel`, `mcp:tools` | Lint rules engine, MCP tool handler | Results panel with issue list |
| Figma importer | `document:write`, `network:fetch`, `mcp:tools` | Figma API client, format converter | Import dialog |
| Color contrast checker | `document:read`, `ui:canvas-overlay` | WCAG contrast calculation | Overlay highlighting failing pairs |
| Asset manager | `document:write`, `network:fetch`, `ui:panel`, `storage` | CDN upload, metadata cache | Asset browser panel |
| Custom export | `document:read`, `mcp:tools` | Template engine, format converter | None (backend-only, agent-driven) |
| Theme switcher | `document:read`, `ui:toolbar` | None | Toolbar button + style injection |

## Consequences

### Positive

- Community developers can build, package, and distribute plugins without access to Sigil's source.
- Non-technical designers can install plugins without rebuilding the app.
- WASM sandboxing provides strong security boundaries for untrusted code.
- Hot-swap enables plugin development without app restarts.
- The `mcp:tools` permission means plugins automatically extend the agent interface — agents discover plugin capabilities through the standard MCP tool list.
- Cross-platform by default — one `.sigil-plugin` works everywhere.

### Negative

- WASM host embedding (Wasmtime) adds binary size and complexity.
- The WASM host API is a stability contract — breaking changes require major version bumps and migration support.
- Plugin developers must compile to WASM for backend logic, which adds toolchain friction.
- Frontend plugins running as JS in a restricted context cannot deeply integrate with Solid.js reactivity — they render into slots, not the component tree.
- Cross-plugin communication is deferred, limiting plugin composability in v1.

### Risks

- The host API may need iteration before it's sufficient for complex plugins. Mitigation: build several first-party example plugins as stress tests before freezing the API.
- WASM component model maturity — the WASM ecosystem is evolving rapidly. The host API should use stable WASM features (WASI preview 1) and avoid bleeding-edge proposals until they stabilize.
- Plugin security — even with WASM sandboxing, plugins with `network:fetch` permission could exfiltrate document data. Mitigation: URL allowlists and making `network:fetch` a high-visibility permission at install time.
- Plugin quality — no review process means users may install buggy or malicious plugins. A future ADR should address plugin signing, a review process, and a distribution channel.

## Sequencing

| Phase | When | What |
|-------|------|------|
| Foundation | Now | Keep crate boundaries clean. Keep `core` WASM-compatible. Keep MCP tool registration data-driven. Keep server startup composable (builder pattern). |
| Plugin API design | Before community plugins | Define and stabilize the host API. Build the WASM runtime integration. Define the package format. Build the plugin loader. Ship example plugins. |
| Plugin SDK | Alongside API | Publish a plugin development kit: project template, build tooling, local testing harness. |
| Distribution | After SDK | Plugin signing, marketplace or registry, version compatibility checks. |

## Related Decisions

- ADR-001 (Deployment and MCP) defines the desktop/Docker deployment split that plugins must work within.
- The `plugin-api` crate will need its own CLAUDE.md entry (Section 4) when created.
- Plugin distribution (marketplace, signing, versioning) is deferred to a future ADR.
