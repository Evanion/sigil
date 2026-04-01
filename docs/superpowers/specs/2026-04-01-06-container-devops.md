# Spec 06: Container & DevOps

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

Production Dockerfile, container configuration, and deployment concerns for Tier 1 (local/dev container).

## Dockerfile

Multi-stage build:
- **Build stage:** compile Rust workspace + build frontend assets
- **Runtime stage:** minimal image (distroless or alpine), copy binary + frontend assets
- Optimize for image size and build caching

## Runtime Configuration

- `PORT` env var or `--port` CLI flag (default: 4680)
- Volume mount for the project directory containing `.sigil/` workfiles
- User may run multiple instances simultaneously on different ports for different projects

## Dev Container Support

- `.devcontainer/` configuration for VS Code dev containers
- Works as part of a dev container stack alongside other services

## Health Check

- `/health` endpoint for container orchestration

## Depends On

- Spec 02 (Server)
- Spec 04 (Frontend — built assets)

## Depended On By

- Nothing (leaf node)
