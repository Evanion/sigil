# Spec 04: Frontend Editor

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

The human interface — a TypeScript SPA with a canvas-based vector editor, served by the Rust backend, communicating via WebSocket.

## Canvas Engine

HTML5 Canvas 2D for MVP. Upgrade path to WebGL, eventually replaced by WASM core engine (Approach C migration).

## UI Structure

- **Toolbar** — tool selection: select (V), frame (F), rectangle (R), ellipse (O), path/pen (P), text (T), image, hand/zoom
- **Layer panel** — tree view of node hierarchy, drag to reorder, visibility/lock toggles
- **Properties panel** — context-sensitive inspector for selected node(s): transform, style, constraints, token bindings
- **Component library panel** — browse local + inherited components, drag to instantiate
- **Token panel** — view/edit design tokens, see inheritance chain, promote/demote
- **Pages panel** — page list, navigation
- **Prototype panel** — interaction/transition editor (MVP: click-through linking)
- **Asset panel** — manage imported images, fonts

## Key Interactions

- Standard design tool keyboard shortcuts
- Undo/redo backed by core engine operation history
- Multi-select, grouping, alignment, distribution
- Zoom/pan with trackpad and keyboard
- Copy/paste within and across pages
- Pen tool for bezier path creation and editing
- Auto-layout controls on frames (direction, gap, padding, alignment)

## Communication

- WebSocket to server, sending intent-based operations (not raw state)
- Receives state updates from server (including changes made by agents via MCP)

## Depends On

- Spec 00 (Toolchain)
- Spec 02 (Server — WebSocket connection)

## Depended On By

- Nothing (leaf node)
