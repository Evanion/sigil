# Sigil

A local-first design tool for creating UX designs and prototypes. Think Figma or Penpot, but running in your own container — on your workstation or as part of a dev container stack.

Both humans and AI agents are equal partners: either can create designs from scratch, hand off to the other seamlessly, and collaborate in real time.

## Key Features

- **Local-first** — runs in a container, no cloud dependency. Your designs live in your git repo.
- **Agent-native** — AI agents interact via MCP (Model Context Protocol), not by scripting APIs. Token-efficient, structured interaction.
- **Full vector editor** — canvas with pen tool, shapes, text, auto-layout, components, and design tokens. Keyboard-first workflow.
- **Git-diffable** — text-based JSON file format, one file per page/component. Meaningful diffs, clean merge conflicts.
- **Hierarchical workfiles** — `.sigil/` directories inherit tokens and components from parent directories, like CSS cascade. Share a design system across projects in a monorepo.
- **Design token bindings** — export tokens to CSS custom properties, Tailwind config, and more. Sigil is the source of truth; bindings are generated output.
- **Click-through prototyping** — link frames with transitions for interactive walkthroughs.

## Architecture

```
sigil/
├── crates/
│   ├── core/          # Design engine — pure logic, no I/O, WASM-compatible
│   ├── server/        # Axum HTTP server, WebSocket, file I/O
│   └── mcp/           # MCP server for agent interaction
├── frontend/          # TypeScript + Canvas editor (SPA)
├── bindings/          # Token export packages (@sigil/css, @sigil/tailwind)
├── cli/               # sigil-cli — token export CLI
└── Dockerfile
```

**Rust** backend (Axum + Tokio) for performance in constrained container environments. **TypeScript** frontend with HTML5 Canvas for the visual editor. The core design engine is a pure-logic Rust crate with no I/O — designed to compile to WASM for future in-browser execution.

## Quick Start

### Container (recommended)

```bash
docker build -t sigil .
docker run --rm -p 4680:4680 -v $(pwd):/workspace sigil
```

Open `http://localhost:4680` in your browser.

### Development

The project uses a dev container with all tooling pre-configured. Open in VS Code and select "Reopen in Container", or:

```bash
# From host (routes commands into dev container)
./dev.sh cargo build --workspace
./dev.sh cargo test --workspace
./dev.sh pnpm --prefix frontend dev
```

### Agent Access

Connect your AI agent's MCP client to the running Sigil instance. The MCP server exposes tools for document, node, component, token, and prototype operations, plus a snapshot tool for visual verification.

## Workfile Structure

Designs are stored in `.sigil/` directories alongside your code:

```
my-project/
├── design.sigil/              # Shared tokens and components
│   ├── tokens/
│   └── components/
├── apps/
│   └── web-app/
│       ├── client.sigil/      # Inherits from design.sigil
│       │   ├── pages/
│       │   ├── components/
│       │   └── tokens/
│       └── src/
```

Tokens and components inherit from parent `.sigil/` directories automatically. Promote local tokens to a parent workfile when they need to be shared; demote shared tokens when a project needs to diverge.

## Design Token Bindings

Sigil tokens are the canonical format. Generate platform-specific code with the CLI:

```bash
sigil export --format css --input ./design.sigil/tokens --output ./src/tokens.css
sigil export --format tailwind --input ./design.sigil/tokens --output ./tailwind.tokens.js
```

## Deployment Tiers

| Tier | Description | License |
|------|-------------|---------|
| **Local** | Single container, single user + agents | Free (Additional Use Grant) |
| **Team** | Multi-user with real-time collaboration | Commercial license required |
| **Enterprise** | RBAC, built-in git integration, PR workflows | Commercial license required |

## Tech Stack

- **Backend:** Rust 1.94 (edition 2024), Axum, Tokio
- **Frontend:** TypeScript, Vite, HTML5 Canvas
- **Agent Interface:** MCP via rmcp
- **File Format:** JSON (git-diffable)
- **Container:** Docker, dev container support

## License

Licensed under the Business Source License 1.1 (BSL 1.1). See [LICENSE](LICENSE) for details.

**Additional Use Grant:** You may use the Licensed Work for single-user, single-instance use (one user and their AI agents connecting to one running instance).

**Change Date:** Four years from the date each version is publicly distributed.

**Change License:** Apache License, Version 2.0.

Multi-user deployments (Team and Enterprise tiers) require a commercial license. Contact evanion@icloud.com for licensing inquiries.
