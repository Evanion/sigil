# Toolchain & Project Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the complete development environment, Rust workspace, TypeScript frontend project, CI pipeline, dev container, and project conventions so all crates compile, all test runners execute, and the Dockerfile builds.

**Architecture:** Rust workspace with three crates (`core`, `server`, `mcp`) plus a TypeScript Vite SPA (`frontend/`), token binding scaffolds (`bindings/`), and a CLI scaffold (`cli/`). Dev container provides the reproducible environment. GitHub Actions CI validates everything on push/PR.

**Tech Stack:** Rust 1.94.1 (edition 2024), Axum 0.8, Tokio 1.50, rmcp 1.3, Vite 8, TypeScript 6, pnpm, Vitest 4, ESLint 10, Prettier 3.8

---

### Task 1: Initialize Git Repository and Dev Container

**Files:**
- Create: `.devcontainer/devcontainer.json`
- Create: `.devcontainer/Dockerfile`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
# Rust
target/
Cargo.lock

# Node
node_modules/
dist/
.vite/

# OS
.DS_Store
Thumbs.db

# IDE
.idea/
*.swp
*.swo

# Environment
.env
.env.local
```

- [ ] **Step 2: Create dev container Dockerfile**

```dockerfile
# .devcontainer/Dockerfile
FROM mcr.microsoft.com/devcontainers/rust:1.94.1-bookworm

# Install Node.js 22 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Rust components
RUN rustup component add clippy rustfmt rust-analyzer

# Install wasm target for future use
RUN rustup target add wasm32-unknown-unknown

# Install cargo-watch for development
RUN cargo install cargo-watch
```

- [ ] **Step 3: Create devcontainer.json**

```json
{
  "name": "Agent Designer",
  "build": {
    "dockerfile": "Dockerfile"
  },
  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:2": {}
  },
  "customizations": {
    "vscode": {
      "extensions": [
        "rust-lang.rust-analyzer",
        "tamasfe.even-better-toml",
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "bradlc.vscode-tailwindcss",
        "fill-labs.dependi"
      ],
      "settings": {
        "rust-analyzer.check.command": "clippy",
        "editor.formatOnSave": true,
        "[rust]": {
          "editor.defaultFormatter": "rust-lang.rust-analyzer"
        },
        "[typescript]": {
          "editor.defaultFormatter": "esbenp.prettier-vscode"
        },
        "[typescriptreact]": {
          "editor.defaultFormatter": "esbenp.prettier-vscode"
        },
        "[json]": {
          "editor.defaultFormatter": "esbenp.prettier-vscode"
        }
      }
    }
  },
  "forwardPorts": [4680],
  "postCreateCommand": "cargo build --workspace && cd frontend && pnpm install"
}
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore .devcontainer/
git commit -m "chore: add dev container and gitignore"
```

---

### Task 2: Rust Workspace Setup

**Files:**
- Create: `rust-toolchain.toml`
- Create: `Cargo.toml` (workspace root)
- Create: `crates/core/Cargo.toml`
- Create: `crates/core/src/lib.rs`
- Create: `crates/server/Cargo.toml`
- Create: `crates/server/src/main.rs`
- Create: `crates/mcp/Cargo.toml`
- Create: `crates/mcp/src/lib.rs`
- Create: `cli/Cargo.toml`
- Create: `cli/src/main.rs`

- [ ] **Step 1: Create `rust-toolchain.toml`**

```toml
[toolchain]
channel = "1.94.1"
components = ["clippy", "rustfmt", "rust-analyzer"]
targets = ["wasm32-unknown-unknown"]
```

- [ ] **Step 2: Create workspace `Cargo.toml`**

```toml
[workspace]
resolver = "3"
members = [
    "crates/core",
    "crates/server",
    "crates/mcp",
    "cli",
]

[workspace.package]
version = "0.1.0"
edition = "2024"
license = "MIT"
repository = "https://github.com/user/agent-designer"

[workspace.dependencies]
# Core
serde = { version = "1.0.228", features = ["derive"] }
serde_json = "1.0.149"
uuid = { version = "1.23.0", features = ["v4", "serde"] }

# Async runtime
tokio = { version = "1.50.0", features = ["full"] }

# Web framework
axum = { version = "0.8.8", features = ["ws"] }
tower = "0.5.3"
tower-http = { version = "0.6.8", features = ["fs", "cors"] }

# MCP
rmcp = { version = "1.3.0", features = ["server"] }

# Error handling
thiserror = "2"
anyhow = "1"

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# Testing
assert_matches = "1"
```

- [ ] **Step 3: Create `crates/core/Cargo.toml`**

```toml
[package]
name = "agent-designer-core"
version.workspace = true
edition.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
uuid = { workspace = true }
thiserror = { workspace = true }

[dev-dependencies]
assert_matches = { workspace = true }
```

- [ ] **Step 4: Create `crates/core/src/lib.rs`**

```rust
#![warn(clippy::all, clippy::pedantic)]

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!version().is_empty());
    }
}
```

- [ ] **Step 5: Create `crates/server/Cargo.toml`**

```toml
[package]
name = "agent-designer-server"
version.workspace = true
edition.workspace = true

[dependencies]
agent-designer-core = { path = "../core" }
axum = { workspace = true }
tokio = { workspace = true }
tower = { workspace = true }
tower-http = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
anyhow = { workspace = true }

[dev-dependencies]
assert_matches = { workspace = true }
```

- [ ] **Step 6: Create `crates/server/src/main.rs`**

```rust
#![warn(clippy::all, clippy::pedantic)]

use axum::{Router, routing::get};
use tower_http::services::ServeDir;
use tracing_subscriber::EnvFilter;

async fn health() -> &'static str {
    "ok"
}

async fn index() -> &'static str {
    "agent-designer is running"
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "4680".to_string())
        .parse::<u16>()?;

    let app = Router::new()
        .route("/", get(index))
        .route("/health", get(health));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("listening on port {port}");
    axum::serve(listener, app).await?;

    Ok(())
}
```

- [ ] **Step 7: Create `crates/mcp/Cargo.toml`**

```toml
[package]
name = "agent-designer-mcp"
version.workspace = true
edition.workspace = true

[dependencies]
agent-designer-core = { path = "../core" }
rmcp = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true }
thiserror = { workspace = true }
tracing = { workspace = true }

[dev-dependencies]
assert_matches = { workspace = true }
```

- [ ] **Step 8: Create `crates/mcp/src/lib.rs`**

```rust
#![warn(clippy::all, clippy::pedantic)]

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!version().is_empty());
    }
}
```

- [ ] **Step 9: Create `cli/Cargo.toml`**

```toml
[package]
name = "sigil-cli"
version.workspace = true
edition.workspace = true

[dependencies]
agent-designer-core = { path = "../crates/core" }
serde = { workspace = true }
serde_json = { workspace = true }
anyhow = { workspace = true }
```

- [ ] **Step 10: Create `cli/src/main.rs`**

```rust
#![warn(clippy::all, clippy::pedantic)]

fn main() {
    println!("sigil-cli v{}", agent_designer_core::version());
}
```

- [ ] **Step 11: Verify workspace builds**

Run: `cargo build --workspace`
Expected: compiles successfully with no errors

- [ ] **Step 12: Verify tests pass**

Run: `cargo test --workspace`
Expected: 2 tests pass (core::version_is_set, mcp::version_is_set)

- [ ] **Step 13: Verify clippy passes**

Run: `cargo clippy --workspace -- -D warnings`
Expected: no warnings or errors

- [ ] **Step 14: Verify formatting**

Run: `cargo fmt --check`
Expected: no formatting issues

- [ ] **Step 15: Commit**

```bash
git add rust-toolchain.toml Cargo.toml crates/ cli/
git commit -m "chore: scaffold Rust workspace with core, server, mcp, and cli crates"
```

---

### Task 3: Frontend Project Setup

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.ts`
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/.prettierrc`
- Create: `frontend/eslint.config.js`

- [ ] **Step 1: Initialize frontend project**

Run: `cd frontend && pnpm init`

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd frontend && pnpm add -D vite@latest typescript@latest vitest@latest eslint@latest @eslint/js@latest prettier@latest @types/node@latest globals@latest typescript-eslint@latest
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:4680",
      "/ws": {
        target: "ws://localhost:4680",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
```

- [ ] **Step 5: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Designer</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `frontend/src/main.ts`**

```typescript
const app = document.getElementById("app");
if (app) {
  app.textContent = "agent-designer is running";
}
```

- [ ] **Step 7: Create `frontend/src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 8: Create `frontend/eslint.config.js`**

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    ignores: ["dist/"],
  },
);
```

- [ ] **Step 9: Create `frontend/.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 10: Update `frontend/package.json` scripts**

Add these scripts to `frontend/package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "format": "prettier --write 'src/**/*.{ts,tsx,json,css}'",
    "format:check": "prettier --check 'src/**/*.{ts,tsx,json,css}'"
  }
}
```

- [ ] **Step 11: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: compiles successfully, outputs to `frontend/dist/`

- [ ] **Step 12: Verify lint passes**

Run: `cd frontend && pnpm lint`
Expected: no errors

- [ ] **Step 13: Verify format check passes**

Run: `cd frontend && pnpm format:check`
Expected: all files formatted correctly

- [ ] **Step 14: Verify test runner works**

Run: `cd frontend && pnpm test`
Expected: test runner executes (0 tests is fine, no errors)

- [ ] **Step 15: Commit**

```bash
git add frontend/
git commit -m "chore: scaffold frontend with Vite, TypeScript, ESLint, and Prettier"
```

---

### Task 4: Binding Scaffolds

**Files:**
- Create: `bindings/css/package.json`
- Create: `bindings/css/src/index.ts`
- Create: `bindings/css/tsconfig.json`
- Create: `bindings/tailwind/package.json`
- Create: `bindings/tailwind/src/index.ts`
- Create: `bindings/tailwind/tsconfig.json`

- [ ] **Step 1: Create `bindings/css/package.json`**

```json
{
  "name": "@sigil/css",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "echo 'no tests yet'"
  }
}
```

- [ ] **Step 2: Create `bindings/css/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `bindings/css/src/index.ts`**

```typescript
export function generateCssCustomProperties(_tokens: Record<string, unknown>): string {
  // Scaffold — implementation in Spec 05
  return ":root {}";
}
```

- [ ] **Step 4: Create `bindings/tailwind/package.json`**

```json
{
  "name": "@sigil/tailwind",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "echo 'no tests yet'"
  }
}
```

- [ ] **Step 5: Create `bindings/tailwind/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create `bindings/tailwind/src/index.ts`**

```typescript
export function generateTailwindConfig(_tokens: Record<string, unknown>): string {
  // Scaffold — implementation in Spec 05
  return "export default {}";
}
```

- [ ] **Step 7: Install TypeScript in binding packages**

Run:
```bash
cd bindings/css && pnpm add -D typescript@latest && cd ../tailwind && pnpm add -D typescript@latest
```

The `package.json` files from steps 1 and 4 are already in place — pnpm will add to them.

- [ ] **Step 8: Verify both binding packages build**

Run: `cd bindings/css && pnpm build && cd ../tailwind && pnpm build`
Expected: both compile successfully

- [ ] **Step 9: Commit**

```bash
git add bindings/
git commit -m "chore: scaffold CSS and Tailwind token binding packages"
```

---

### Task 5: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```dockerignore
target/
node_modules/
dist/
.git/
.devcontainer/
docs/
*.md
.env
.env.local
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# Stage 1: Build frontend
FROM node:22-bookworm-slim AS frontend-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build

# Stage 2: Build Rust
FROM rust:1.94.1-bookworm AS rust-builder
WORKDIR /app
COPY Cargo.toml rust-toolchain.toml ./
COPY crates/ crates/
COPY cli/ cli/
RUN cargo build --release --bin agent-designer-server

# Stage 3: Runtime
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=rust-builder /app/target/release/agent-designer-server /usr/local/bin/
COPY --from=frontend-builder /app/frontend/dist /usr/local/share/agent-designer/frontend

ENV PORT=4680
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD curl -f http://localhost:${PORT}/health || exit 1

ENTRYPOINT ["agent-designer-server"]
```

- [ ] **Step 3: Verify Docker build**

Run: `docker build -t agent-designer:dev .`
Expected: builds successfully

- [ ] **Step 4: Verify Docker run**

Run: `docker run --rm -p 4680:4680 agent-designer:dev &`
Then: `curl http://localhost:4680/health`
Expected: responds with `ok`
Cleanup: `docker stop $(docker ps -q --filter ancestor=agent-designer:dev)`

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "chore: add multi-stage Dockerfile with health check"
```

---

### Task 6: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  CARGO_TERM_COLOR: always
  RUSTFLAGS: "-D warnings"

jobs:
  rust:
    name: Rust
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: "1.94.1"
          components: clippy, rustfmt

      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/bin/
            ~/.cargo/registry/
            ~/.cargo/git/
            target/
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}

      - name: Check
        run: cargo check --workspace

      - name: Clippy
        run: cargo clippy --workspace -- -D warnings

      - name: Format
        run: cargo fmt --check

      - name: Test
        run: cargo test --workspace

  frontend:
    name: Frontend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest

      - name: Install Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install dependencies
        run: cd frontend && pnpm install --frozen-lockfile

      - name: Lint
        run: cd frontend && pnpm lint

      - name: Format check
        run: cd frontend && pnpm format:check

      - name: Test
        run: cd frontend && pnpm test

      - name: Build
        run: cd frontend && pnpm build

  docker:
    name: Docker Build
    runs-on: ubuntu-latest
    needs: [rust, frontend]
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t agent-designer:ci .
```

- [ ] **Step 2: Commit**

```bash
git add .github/
git commit -m "ci: add GitHub Actions workflow for Rust, frontend, and Docker"
```

---

### Task 7: CLAUDE.md Project Conventions

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create `CLAUDE.md`**

```markdown
# Agent Designer — Project Conventions

## Project Structure

```
agent-designer/
├── crates/
│   ├── core/          # Design engine — pure logic, no I/O, WASM-compatible
│   ├── server/        # Axum HTTP server, WebSocket, file I/O
│   └── mcp/           # MCP server for agent interaction
├── frontend/          # TypeScript + Vite SPA (Canvas editor)
├── bindings/
│   ├── css/           # @sigil/css — CSS custom properties export
│   └── tailwind/      # @sigil/tailwind — Tailwind config export
├── cli/               # sigil-cli — token export CLI
├── docs/
│   └── superpowers/
│       ├── specs/     # Product design records
│       └── plans/     # Implementation plans
└── .devcontainer/     # Dev container configuration
```

## Running Commands

All build/test/lint commands run inside the dev container. Use `./dev.sh` as a prefix when running from the host — it routes commands into the container automatically. If you're already inside the container, commands run directly.

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
- Build: `docker build -t agent-designer:dev .`
- Run: `docker run --rm -p 4680:4680 -v $(pwd):/workspace agent-designer:dev`

## Crate Responsibilities

### `agent-designer-core`
- MUST have zero I/O dependencies (no filesystem, no networking)
- MUST compile to both native and `wasm32-unknown-unknown`
- All operations must be deterministic and side-effect-free
- This is the foundation — everything else depends on it

### `agent-designer-server`
- Owns HTTP serving, WebSocket, file I/O
- All document mutations go through the core engine
- Never mutate document state directly — always through core operations

### `agent-designer-mcp`
- Owns the MCP tool/resource definitions
- Shares in-memory state with the server (same process)
- Keep tool interfaces token-efficient for agent consumption

## Code Style

### Rust
- Edition 2024, clippy pedantic warnings enabled
- Use `thiserror` for library errors, `anyhow` for application errors (server/cli only)
- Prefer `impl` returns over `Box<dyn>` where possible
- Core crate: no `unwrap()` or `expect()` — return `Result` types

### TypeScript
- Strict mode enabled
- No `any` types
- ESLint strict config
- Prettier for formatting

## Testing

- TDD: write failing test first, then implement
- Core crate: unit tests for every public function
- Server: integration tests for HTTP/WebSocket endpoints
- Frontend: Vitest for unit tests
- Test names describe behavior: `test_adding_child_to_frame_updates_parent_bounds`

## Commit Messages

Format: `type: description`

Types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `test`

Keep descriptions concise and lowercase. Reference spec numbers when implementing features: `feat(core): add node tree operations (spec-01)`

## Design File Format

Workfiles use `.sigil/` directory suffix. See specs for full format documentation. The core crate owns serialization logic — other crates must use core's API to read/write workfiles.

## Subagent Roles

When dispatching subagents for this project, use these specialized roles:
- **FE** — TypeScript, canvas, UI work in `frontend/`
- **BE** — Rust crates, server, MCP in `crates/`
- **DevOps** — Dockerfile, CI/CD, container config
- **Security** — security review of code and architecture
- **A11y** — accessibility review of the frontend editor
- **UX** — design and usability review
- **Architect** — system design, cross-cutting concerns
- **Governance** — reviews findings, proposes updates to rules/conventions
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with project conventions and build commands"
```

---

### Task 8: Custom Agent Prompts

**Files:**
- Create: `.claude/agents/fe.md`
- Create: `.claude/agents/be.md`
- Create: `.claude/agents/devops.md`
- Create: `.claude/agents/security.md`
- Create: `.claude/agents/a11y.md`
- Create: `.claude/agents/ux.md`
- Create: `.claude/agents/architect.md`
- Create: `.claude/agents/governance.md`

- [ ] **Step 1: Create `.claude/agents/fe.md`**

```markdown
---
name: Frontend Engineer
description: TypeScript, Canvas, UI work in frontend/
---

You are a senior frontend engineer specializing in HTML5 Canvas, TypeScript, and interactive design tools.

## Scope

You work exclusively in `frontend/`. You do not modify Rust crates.

## Responsibilities

- Canvas rendering and interaction (selection, transforms, drawing)
- UI panels (layers, properties, components, tokens, pages, prototypes, assets)
- WebSocket communication with the server
- Keyboard shortcuts and input handling
- Frontend state management

## Standards

- TypeScript strict mode, no `any` types
- TDD with Vitest — write failing test first
- ESLint strict + Prettier formatting
- Follow existing component patterns in the codebase
- Keep files focused — one component/module per file
- Test names describe behavior: `it("should update selection when clicking a node")`

## Before You Start

1. Read `CLAUDE.md` for project conventions
2. Read the relevant spec in `docs/superpowers/specs/`
3. Read the implementation plan task you've been assigned
4. Run `./dev.sh pnpm --prefix frontend test` to verify the test suite passes before making changes
```

- [ ] **Step 2: Create `.claude/agents/be.md`**

```markdown
---
name: Backend Engineer
description: Rust crates — core engine, server, MCP
---

You are a senior Rust engineer specializing in systems programming, async I/O, and protocol design.

## Scope

You work in `crates/core/`, `crates/server/`, `crates/mcp/`, and `cli/`. You do not modify frontend code.

## Responsibilities

- Core design engine (document model, tree operations, layout, serialization)
- Axum HTTP server and WebSocket handling
- MCP tool/resource implementation
- CLI token export tool
- File I/O and workfile discovery

## Standards

- Rust edition 2024, clippy pedantic enabled
- `thiserror` for library errors (`core`, `mcp`), `anyhow` for app errors (`server`, `cli`)
- Core crate: zero I/O, must compile to WASM, no `unwrap()`/`expect()` — always return `Result`
- TDD — write failing test first
- Test names describe behavior: `test_adding_child_to_frame_updates_parent_bounds`

## Before You Start

1. Read `CLAUDE.md` for project conventions
2. Read the relevant spec in `docs/superpowers/specs/`
3. Read the implementation plan task you've been assigned
4. Run `./dev.sh cargo test --workspace` to verify tests pass before making changes
```

- [ ] **Step 3: Create `.claude/agents/devops.md`**

```markdown
---
name: DevOps Engineer
description: Dockerfile, CI/CD, container configuration
---

You are a senior DevOps engineer specializing in containerization, CI/CD pipelines, and developer tooling.

## Scope

You work on `Dockerfile`, `.dockerignore`, `.devcontainer/`, `.github/workflows/`, and deployment configuration.

## Responsibilities

- Multi-stage Docker builds optimized for size and caching
- GitHub Actions CI/CD pipeline
- Dev container configuration
- Port configuration and container networking
- Health checks and readiness probes

## Standards

- Docker images must be minimal (distroless or slim base)
- CI jobs run in parallel where possible
- All builds must be reproducible
- Container must support configurable PORT (default 4680)
- Test container builds locally before committing

## Before You Start

1. Read `CLAUDE.md` for project conventions
2. Read the relevant spec in `docs/superpowers/specs/`
3. Verify `docker build .` works before making changes
4. Use `./dev.sh` prefix for all commands — it routes to the dev container from the host
```

- [ ] **Step 4: Create `.claude/agents/security.md`**

```markdown
---
name: Security Reviewer
description: Security review of code and architecture
---

You are a senior security engineer performing code and architecture review.

## Scope

You review all code across the entire repository but do not write implementation code. You produce findings and recommendations.

## Responsibilities

- Review for OWASP Top 10 vulnerabilities
- Input validation and sanitization (especially MCP tool inputs and file paths)
- Path traversal prevention (workfile discovery must not escape mount boundaries)
- WebSocket security (origin validation, message size limits)
- Dependency audit (known CVEs in Rust crates and npm packages)
- Container security (non-root user, minimal attack surface)
- File format security (malicious JSON, deeply nested structures, resource exhaustion)

## Output Format

For each finding, report:
- **Severity:** Critical / High / Medium / Low / Info
- **Location:** exact file and line range
- **Issue:** what the vulnerability is
- **Impact:** what an attacker could achieve
- **Recommendation:** specific fix with code if applicable

## Before You Start

1. Read `CLAUDE.md` for project conventions
2. Read the relevant spec to understand intended behavior
3. Focus on high-confidence findings — do not report speculative or low-probability issues
```

- [ ] **Step 5: Create `.claude/agents/a11y.md`**

```markdown
---
name: Accessibility Reviewer
description: Accessibility review of the frontend editor
---

You are a senior accessibility engineer reviewing the design tool's frontend for WCAG 2.2 AA compliance.

## Scope

You review code in `frontend/` and produce findings and recommendations. You may suggest code changes but focus on the review.

## Responsibilities

- Keyboard navigation (all tools and panels must be keyboard-accessible)
- Screen reader compatibility (ARIA labels, roles, live regions)
- Color contrast (UI chrome, not the user's design canvas)
- Focus management (modals, panel switching, tool selection)
- Reduced motion support
- Canvas accessibility (alternative representations of the design tree for assistive tech)

## Output Format

For each finding, report:
- **WCAG Criterion:** e.g., 2.1.1 Keyboard
- **Severity:** Critical / Major / Minor
- **Location:** exact file and line range
- **Issue:** what the barrier is
- **Recommendation:** specific fix

## Before You Start

1. Read `CLAUDE.md` for project conventions
2. Focus on the UI chrome and panel interactions — the canvas itself has unique accessibility challenges that should be flagged but may require design discussion
```

- [ ] **Step 6: Create `.claude/agents/ux.md`**

```markdown
---
name: UX Reviewer
description: Design and usability review
---

You are a senior UX designer reviewing the design tool's interface and interaction patterns.

## Scope

You review the frontend editor's UI/UX and produce findings and recommendations. You compare against established patterns in Figma, Penpot, and Sketch.

## Responsibilities

- Interaction patterns (do tools behave as designers expect?)
- Panel layout and information hierarchy
- Discoverability of features
- Consistency across the interface
- Error states and feedback
- Onboarding experience
- Agent/human handoff experience (is it clear what the agent changed?)

## Output Format

For each finding, report:
- **Category:** Consistency / Discoverability / Feedback / Efficiency / Learnability
- **Severity:** Critical / Major / Minor / Suggestion
- **Location:** which panel, tool, or interaction
- **Issue:** what the usability problem is
- **Recommendation:** specific improvement with reference to established patterns if applicable

## Before You Start

1. Read `CLAUDE.md` for project conventions
2. Read the PDR overview to understand the product vision
3. Consider both human and agent workflows — the tool serves both equally
```

- [ ] **Step 7: Create `.claude/agents/architect.md`**

```markdown
---
name: Architect
description: System design and cross-cutting concerns
---

You are a senior software architect reviewing system design, cross-cutting concerns, and ensuring the codebase maintains its intended architecture.

## Scope

You review all code across the entire repository. You produce architectural findings and may propose structural changes.

## Responsibilities

- Crate boundary enforcement (core has no I/O, server doesn't bypass core, etc.)
- Interface design between crates (are APIs clean, minimal, well-typed?)
- WASM compatibility of the core crate
- Operation pipeline integrity (all mutations flow through core)
- File format evolution (backward compatibility, migration paths)
- Performance implications of architectural decisions
- Dependency management (are we pulling in too much? Are crate features minimal?)

## Output Format

For each finding, report:
- **Category:** Boundary Violation / Interface Design / Performance / Dependency / Migration
- **Severity:** Critical / Major / Minor
- **Location:** exact files/modules involved
- **Issue:** what the architectural concern is
- **Recommendation:** specific change with rationale

## Before You Start

1. Read `CLAUDE.md` for project conventions
2. Read the relevant specs — architecture decisions are documented there
3. Read the core crate's public API surface before reviewing consuming crates
```

- [ ] **Step 8: Create `.claude/agents/governance.md`**

```markdown
---
name: Governance Updater
description: Reviews findings and proposes updates to rules, CLAUDE.md, and agent prompts
---

You are responsible for the project's governance — reviewing findings from all other agents and updating project conventions to prevent recurring issues.

## Scope

You modify `CLAUDE.md`, files in `.claude/agents/`, and documentation. You do not write application code.

## Responsibilities

- Review findings from Security, A11y, UX, and Architect agents
- Identify patterns — if the same type of issue appears twice, it needs a rule
- Propose updates to `CLAUDE.md` conventions
- Propose updates to agent prompts (add new checks, refine scope)
- Propose updates to CI checks if issues should be caught automatically
- Track which rules were added and why (maintain a changelog in the PR description)

## Process

1. Read all review findings from the current cycle
2. Group by pattern — which issues are one-offs vs systemic?
3. For systemic issues, draft a rule or convention update
4. Present proposed changes with rationale before applying

## Standards

- Rules must be specific and actionable — "be careful with X" is not a rule
- Rules must include the "why" — what went wrong that prompted this
- Prefer linter/CI rules over human-enforced conventions where possible
- Remove rules that are no longer relevant — governance is not append-only

## Before You Start

1. Read current `CLAUDE.md` to avoid duplicating existing rules
2. Read all agent prompts in `.claude/agents/` to understand current guidance
3. Read the review findings you've been given
```

- [ ] **Step 9: Commit**

```bash
git add .claude/agents/
git commit -m "chore: add specialized agent prompts for FE, BE, DevOps, Security, A11y, UX, Architect, and Governance"
```

---

### Task 9: Custom Slash Commands (/review and /implement)

**Files:**
- Create: `.claude/commands/review.md`
- Create: `.claude/commands/implement.md`

- [ ] **Step 1: Create `.claude/commands/review.md`**

```markdown
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
```

- [ ] **Step 2: Create `.claude/commands/implement.md`**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/
git commit -m "chore: add /review and /implement custom slash commands"
```

---

### Task 10: Dev Container Command Bridge (`dev.sh`)

**Files:**
- Create: `dev.sh`

- [ ] **Step 1: Create `dev.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# dev.sh — Run commands inside the dev container from the host.
# If already inside the container, runs commands directly.
# Usage: ./dev.sh cargo test --workspace
#        ./dev.sh pnpm --prefix frontend build

CONTAINER_NAME="agent-designer-dev"

# Detect if we're inside the dev container
if [ -f /.dockerenv ] || grep -q "docker\|containerd" /proc/1/cgroup 2>/dev/null; then
    # Inside container — run directly
    exec "$@"
fi

# Outside container — check if dev container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Dev container '${CONTAINER_NAME}' is not running." >&2
    echo "Start it with: devcontainer up --workspace-folder ." >&2
    echo "Or:            docker compose -f .devcontainer/docker-compose.yml up -d" >&2
    exit 1
fi

# Get the workspace path inside the container
WORKSPACE_DIR="/workspaces/agent-designer"

# Execute command inside the running container
exec docker exec -w "${WORKSPACE_DIR}" -it "${CONTAINER_NAME}" "$@"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x dev.sh`

- [ ] **Step 3: Verify detection logic**

Run (on host, no container running):
```bash
./dev.sh echo "hello"
```
Expected: error message about container not running

- [ ] **Step 4: Commit**

```bash
git add dev.sh
git commit -m "chore: add dev.sh command bridge for host-to-container execution"
```

---

### Task 11: Verify Everything End-to-End

- [ ] **Step 1: Clean build from scratch**

Run:
```bash
cargo clean
rm -rf frontend/node_modules frontend/dist
```

- [ ] **Step 2: Rust workspace**

Run: `cargo build --workspace && cargo test --workspace && cargo clippy --workspace -- -D warnings && cargo fmt --check`
Expected: all pass

- [ ] **Step 3: Frontend**

Run: `cd frontend && pnpm install && pnpm build && pnpm lint && pnpm format:check && pnpm test`
Expected: all pass

- [ ] **Step 4: Docker**

Run: `docker build -t agent-designer:dev .`
Expected: builds successfully

Run: `docker run --rm -d -p 4680:4680 --name ad-test agent-designer:dev`
Then: `curl http://localhost:4680/health`
Expected: `ok`
Cleanup: `docker stop ad-test`

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: fix any issues found during end-to-end verification"
```
