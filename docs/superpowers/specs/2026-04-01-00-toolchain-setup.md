# Spec 00: Toolchain & Project Setup

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

Set up the Rust workspace, TypeScript frontend project, development tooling, CI pipeline, and project conventions before any application code is written.

## Goals

- Reproducible development environment from a single clone
- All crates compile, all test runners execute (even with zero tests)
- Linting and formatting enforced from day one
- CLAUDE.md captures project conventions for agentic development
- Dockerfile skeleton that builds and serves a placeholder

## Rust Workspace

- **Edition:** 2024
- **Rust version:** 1.94.1 (enforce via `rust-toolchain.toml`)
- **Workspace members:**
  - `crates/core` — library crate, no I/O dependencies, `#![no_std]`-compatible where feasible, must compile to WASM
  - `crates/server` — binary crate, depends on `core`, uses Axum + Tokio
  - `crates/mcp` — library crate, depends on `core`
- **Shared dependencies managed at workspace level** via `[workspace.dependencies]`
- **Linting:** Clippy with `warn` on `clippy::all` and `clippy::pedantic`
- **Formatting:** rustfmt with default config

## Frontend Project

- **Location:** `frontend/`
- **Tooling:** Vite + TypeScript (strict mode)
- **Package manager:** pnpm
- **Testing:** Vitest
- **Linting:** ESLint (latest flat config)
- **Formatting:** Prettier

## Bindings & CLI

- **Location:** `bindings/css/`, `bindings/tailwind/`
- **CLI location:** `cli/`
- These are empty crate/package scaffolds for now — just enough to compile/build

## CI (GitHub Actions)

Single workflow that runs on push and PR:
- Rust: `cargo check`, `cargo clippy`, `cargo fmt --check`, `cargo test`
- Frontend: `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`
- All jobs run in parallel where possible

## Dockerfile

Skeleton multi-stage Dockerfile:
- **Build stage:** Rust compilation + frontend build
- **Runtime stage:** minimal image, copies binary + frontend assets
- Exposes configurable `PORT` (default 4680)
- Placeholder response on `/` to verify it works

## CLAUDE.md

Project-level conventions file covering:
- Workspace structure and crate responsibilities
- How to build, test, lint, format
- Commit message conventions
- Code style guidelines beyond what linters enforce
- Testing philosophy (TDD, what to test, test naming)
- Subagent roles and when to use them

## Success Criteria

- `cargo build --workspace` succeeds
- `cargo test --workspace` succeeds (zero tests is fine)
- `cargo clippy --workspace` passes clean
- `cargo fmt --check` passes
- `pnpm install && pnpm build` succeeds in `frontend/`
- `pnpm test` and `pnpm lint` succeed
- `docker build .` succeeds
- `docker run -p 4680:4680 <image>` serves the placeholder
- GitHub Actions workflow passes
