# Agent Designer — Product Design Record

> Working name. Final name TBD (Sigil is a candidate — used as `.sigil/` suffix throughout).

## Overview

A local-first design tool for creating UX designs and prototypes — similar to Figma or Penpot, but runs in a container on the user's workstation or as part of a dev container stack. Both humans and AI agents are equal partners: either can create designs from scratch, and both can hand off to the other seamlessly.

Design files are persisted to the project's git repository. No database required.

## Goals

- **Performance in constrained environments** — must run well inside containers with limited resources
- **Agent-native interaction** — AI agents interact via MCP, not by scripting APIs
- **Git-native persistence** — text-based, diffable file format stored alongside the code it designs for
- **Platform-agnostic output** — design tokens and assets export to any client platform via standalone bindings
- **Human-quality editor** — a full vector canvas with component system, on par with existing design tools

## Architecture

### Overview

Rust workspace with three crates and a TypeScript frontend. Designed as Approach A (Rust backend + TypeScript frontend) with a migration path to Approach C (Rust core compiled to WASM in the browser).

```
agent-designer/
├── crates/
│   ├── core/          # Design engine (WASM-compatible)
│   ├── server/        # HTTP, WebSocket, file I/O
│   └── mcp/           # MCP server for agent interaction
├── frontend/          # TypeScript + Canvas editor (SPA)
├── bindings/          # Token export packages
│   ├── css/
│   └── tailwind/
├── cli/               # CLI tool for token export
├── docs/
├── Dockerfile
└── Cargo.toml         # Workspace root
```

### Core Crate (`crates/core`)

The design engine. Pure logic, no I/O, no system dependencies. Must compile to both native and WASM without changes.

Responsibilities:
- **Document model** — design tree, layers, components, styles
- **Tree operations** — add, remove, rearrange, transform nodes
- **Constraint/layout engine** — flex-based auto-layout, pinning constraints for absolute positioning
- **Diffing and patching** — for undo/redo, and future collaboration (CRDT/OT)
- **Design token model** — token definitions, inheritance resolution
- **Serialization** — to/from the git-diffable file format
- **Pen tool geometry** — bezier path creation, editing, boolean operations

This crate is kept I/O-free so it can be compiled to WASM for the Approach C migration, where it runs directly in the browser.

### Server Crate (`crates/server`)

The application shell. Depends on `core`.

Responsibilities:
- Serving the frontend SPA
- WebSocket connection to the frontend for real-time state sync
- File I/O — reading/writing workfiles to disk (the git-mounted volume)
- Asset management (images, fonts)
- Workfile discovery — scanning the directory tree for `.sigil/` directories and resolving the inheritance hierarchy

### MCP Crate (`crates/mcp`)

The agent interface. Depends on `core`. Runs as part of the same process as the server, sharing in-memory document state.

Responsibilities:
- MCP tools for creating, querying, and modifying designs
- MCP resources for reading design state
- Snapshot rendering for visual verification by agents

### Frontend (`frontend/`)

TypeScript single-page application.

- **Canvas engine:** HTML5 Canvas 2D for MVP, upgrade path to WebGL, eventually replaced by WASM core
- **UI panels:** toolbar, layer panel, properties panel, component library, token panel, pages panel, prototype panel, asset panel
- **Communication:** WebSocket to server, sending intent-based operations (not raw state)
- **Shortcuts:** standard design tool keybindings (V select, F frame, R rect, T text, P pen, etc.)

### State Sync Model

Human and agent edits flow through the same pipeline:
1. Frontend sends operations via WebSocket; MCP tools invoke operations directly on core
2. Server applies operations through the core engine
3. Server broadcasts updated state to all connected clients (frontend + MCP)

This means a human and an agent editing the same document see each other's changes in real time.

## Document Model & File Format

### Workfile Structure

Each design project is a directory with a `.sigil/` suffix containing JSON files:

```
my-project.sigil/
├── manifest.json          # Metadata, page order, token sync config
├── pages/
│   ├── home.json          # One file per page
│   └── settings.json
├── components/
│   ├── button.json        # One file per component definition
│   └── card.json
├── tokens/
│   ├── colors.json        # Design tokens, grouped by category
│   ├── typography.json
│   └── spacing.json
└── assets/
    ├── manifest.json      # Asset metadata (name, hash, type)
    └── images/            # Actual asset files
```

Files are JSON, one per page/component, so git diffs stay scoped and meaningful.

### Node Tree Model

Every element in the design is a node. Nodes form a tree. Each node has:

- `id` — stable unique identifier
- `type` — frame, rectangle, ellipse, path, text, image, component-instance, group
- `name` — human-readable label
- `transform` — position, rotation, scale
- `style` — fill, stroke, opacity, blend mode, effects (shadows, blur)
- `constraints` — layout constraints (auto-layout/flex, pinning)
- `children` — ordered list of child node IDs

### Components

Components are node subtrees that can be instantiated. An instance references its component definition and stores only its overrides.

### Hierarchical Inheritance

Workfiles inherit from ancestor workfiles found in parent directories, similar to how CLAUDE.md files work:

```
monorepo/
├── design.sigil/                  # Root — shared tokens, base components
│   ├── tokens/
│   └── components/
├── apps/
│   ├── web-app/
│   │   ├── client-portal.sigil/   # Inherits from design.sigil
│   │   └── src/
│   └── admin-app/
│       ├── admin-portal.sigil/    # Inherits from design.sigil
│       └── src/
```

**Inheritance rules:**
- The server walks up from each `.sigil/` directory toward the repo root, collecting all `.sigil/` directories it finds
- Closer ancestors override farther ones (CSS cascade model)
- **Tokens:** inherited by default, can be overridden or extended locally
- **Components:** inherited and available for use; a local component with the same name overrides the inherited one
- **Assets:** inherited, can be overridden locally
- A workfile's `manifest.json` can explicitly `exclude` inherited items

**Promote/demote operations:**
- **Promote:** move a token or component definition from a local workfile to a parent workfile, replacing the local definition with an inherited reference. This is a first-class operation in both the UI and MCP tools.
- **Demote:** pull a shared token/component down into a local workfile as an override (parent definition stays untouched)
- **Conflict handling:** if the target already has an item with the same name, the system warns and offers to merge, rename, or override
- **Provenance tracking:** the manifest tracks where tokens/components originated and whether local versions are overrides or canonical definitions

## Agent Interface (MCP)

Agents interact via MCP tools and resources. The key principle is high-level intent, not low-level drawing commands.

### MCP Tools

**Document operations:**
- Create, open, save, close workfiles
- List workfiles in hierarchy with inheritance info

**Page operations:**
- Create, rename, delete, reorder pages

**Node operations:**
- Create nodes (frame, shape, text, image, group)
- Modify properties (transform, style, constraints, name)
- Delete, rearrange in tree
- Group/ungroup

**Component operations:**
- Create component from node selection
- Instantiate component
- Override instance properties
- Promote/demote in hierarchy

**Token operations:**
- Create, update, delete tokens
- Promote/demote between workfiles
- Apply token to node property
- List resolved tokens (with inheritance)

**Asset operations:**
- Import, replace, delete, list assets

**Selection & query:**
- Find nodes by name, type, or property
- Get document tree structure
- Get computed/resolved styles

**Prototype operations:**
- Link frames with transitions
- Define transition type and duration

**Snapshot:**
- Render a page, frame, or component to an image
- Returns the image so agents can visually verify their work

### MCP Resources

- Document tree structure
- Token definitions (resolved through inheritance)
- Component library (local + inherited)
- Asset manifest

### Abstraction Levels

MVP tools operate at the primitive level: nodes, components, tokens, pages. Higher-level semantic tools (e.g., "create a form with these fields") are deferred until real agent usage patterns emerge — premature abstractions here would likely miss the mark.

## Design Token Bindings

Sigil tokens are the canonical format inside workfiles. Standalone tooling generates platform-specific code from these tokens.

### Binding Packages

Each platform/framework gets its own package:
- `@sigil/css` — CSS custom properties
- `@sigil/tailwind` — Tailwind config
- `@sigil/swift` — Swift asset catalogs
- `@sigil/kotlin` — Android resources
- `@sigil/flutter` — Flutter theme data
- Additional bindings can be contributed independently

### Integration Points

**CLI tool:**
```
sigil export --format css --input ./design.sigil/tokens --output ./src/tokens.css
```

**Bundler plugins:** Vite, Webpack, Turbopack plugins that auto-generate token files on build.

**Watch mode:** Regenerate on token changes during development.

**CI/CD:** Run export as a build step; optionally fail if generated output is stale.

### One-Way Flow

Tokens flow one direction: Sigil workfiles are the source of truth, generated binding files are output. No bi-directional sync. Generated files can be gitignored or committed — team's choice.

## Frontend Editor

### Canvas Engine

HTML5 Canvas 2D for MVP. Upgrade path to WebGL for performance, eventually replaced by WASM core engine (Approach C migration).

### UI Structure

- **Toolbar** — tool selection: select (V), frame (F), rectangle (R), ellipse (O), path/pen (P), text (T), image, hand/zoom
- **Layer panel** — tree view of node hierarchy, drag to reorder, visibility/lock toggles
- **Properties panel** — context-sensitive inspector for selected node(s): transform, style, constraints, token bindings
- **Component library panel** — browse local + inherited components, drag to instantiate
- **Token panel** — view/edit design tokens, see inheritance chain, promote/demote
- **Pages panel** — page list, navigation
- **Prototype panel** — interaction/transition editor (MVP: click-through linking)
- **Asset panel** — manage imported images, fonts

### Key Interactions

- Standard design tool keyboard shortcuts
- Undo/redo backed by core engine operation history
- Multi-select, grouping, alignment, distribution
- Zoom/pan with trackpad and keyboard
- Copy/paste within and across pages
- Pen tool for bezier path creation and editing
- Auto-layout controls on frames (direction, gap, padding, alignment)

## Deployment Tiers

### Tier 1 — Local (MVP)

- Single container, single user + their agent(s)
- File I/O directly to the mounted project directory
- Save = write to disk; user/agent manages git externally
- No authentication needed
- Dockerfile provided
- Configurable port via `PORT` environment variable or `--port` CLI flag (default: 4680). A user may run multiple instances for different projects simultaneously, each bound to a different port.

### Tier 2 — Team (Post-MVP)

- Single container on a shared machine or dev server
- Multiple users + agents connect via browser/MCP
- CRDT/OT-based conflict resolution in the core engine
- Basic auth (token-based or SSO)
- Still writes to disk, team manages git

### Tier 3 — Enterprise (Future)

- Deployed on internal infrastructure
- Multi-user with role-based access control
- Built-in git integration:
  - Branch management — work on designs in feature branches
  - Commit from UI/MCP with structured commit messages
  - Open PRs to GitHub/GitLab/Bitbucket via their APIs
  - PR review workflow for design changes (visual diffs)
  - Webhook support for CI/CD integration
- Audit logging
- Multiple concurrent workfile sessions

### Architecture Implication

The core engine and server are stateless regarding git from day one — they read/write files, period. Git integration (Tier 3) is a separate layer that wraps around file operations. CRDT/OT (Tier 2) lives in the `core` crate.

## MVP Scope

### Included

- Core engine: document model, node tree, operations, undo/redo, constraint/layout engine
- Pen tool + all vector primitives (frame, rect, ellipse, path, text, image, group)
- Auto-layout (flex-based) + pinning constraints
- Components: create, instantiate, override properties
- Design tokens: create, edit, inheritance, promote/demote
- Click-through prototyping (link frames with transitions)
- Web editor with all panels (toolbar, layers, properties, components, tokens, pages, prototype, assets)
- MCP server: full CRUD on documents, nodes, components, tokens; snapshot tool
- File format: JSON-based, git-diffable, hierarchical workfile inheritance
- CLI tool for token export
- CSS custom properties + Tailwind bindings
- Dockerfile for container deployment

### Deferred

- Stateful prototyping (variables, conditional logic, interactive inputs)
- Full interactive prototyping (animations, micro-interactions, data-driven states)
- Multi-user collaboration / CRDT/OT (Tier 2)
- Git integration in-app (Tier 3)
- Authentication and RBAC (Tier 2/3)
- Additional export bindings (Swift, Kotlin, Flutter, etc.)
- Advanced asset management
- WASM migration (Approach C)
- WebGL canvas renderer
- Bundler plugins (Vite, Webpack, etc.)
