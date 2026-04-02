# Spec 04: Frontend Editor

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Revision History

- **v2 (2026-04-02):** Adopted Solid.js as UI framework, urql as GraphQL client, Open Props for design tokens. Communication migrated from raw WebSocket to GraphQL over WebSocket. Canvas stays vanilla.
- **v1 (2026-04-01):** Initial spec — vanilla TypeScript SPA with raw WebSocket communication.

## Overview

The human interface — a Solid.js SPA with a canvas-based vector editor. Panel UI is built with Solid components (from Spec 07 Component Library). The canvas is a vanilla Canvas 2D imperative island. Communication with the server uses GraphQL over a persistent WebSocket connection via urql.

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | Solid.js 1.9 |
| Headless components | Kobalte (`@kobalte/core`) — via Spec 07 |
| Icons | Lucide (`lucide-solid`) |
| GraphQL client | urql (`@urql/solid`) with `graphql-ws` transport |
| Styling | Open Props + CSS custom properties (dark theme) |
| Canvas | HTML5 Canvas 2D (vanilla, not managed by Solid) |
| Build | Vite 8 + `vite-plugin-solid` |
| Tests | Vitest |
| Keyboard | tinykeys |

## Architecture

### Component-Store-GraphQL Layers

```
Solid Components (panels, toolbar, dialogs)
        │
        ▼
   DocumentStore (abstract interface)
        │
        ▼
   urql GraphQL client (queries, mutations, subscriptions)
        │
        ▼
   WebSocket (graphql-ws protocol) → Server
```

Components never import urql directly — they use the store interface. This enables the future WASM migration: the store implementation swaps from "urql over WebSocket" to "local WASM calls + CRDT sync" without changing components.

### Canvas Island

The canvas is an imperative rendering island outside Solid's reactive system:

```
Solid App
├── <Toolbar />         ← Solid component
├── <LayersPanel />     ← Solid component
├── <CanvasWrapper />   ← Solid component that owns:
│   └── <canvas>        ← vanilla HTML element
│       └── renderer.ts ← requestAnimationFrame loop, direct ctx calls
│       └── viewport.ts ← pan/zoom math
│       └── tools/      ← tool state machine
├── <PropertiesPanel /> ← Solid component
└── <StatusBar />       ← Solid component
```

Solid manages the canvas element's lifecycle (mount/unmount, resize observer) but does not touch the rendering. The `CanvasWrapper` component bridges: it reads selection/tool state from Solid signals and passes them to the vanilla renderer.

## Data Layer

### Store Interface

The `DocumentStore` provides the same interface as before — components consume it via Solid context:

```typescript
interface DocumentStore {
  // Reactive getters (Solid signals)
  info(): DocumentInfo | null;
  pages(): readonly Page[];
  nodes(): ReadonlyMap<string, DocumentNode>;
  selectedNodeId(): string | null;
  activePage(): Page | undefined;
  isConnected(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;

  // Actions (fire GraphQL mutations)
  createNode(kind: NodeKind, name: string, transform: Transform): string;
  deleteNode(uuid: string): void;
  renameNode(uuid: string, newName: string): void;
  setTransform(uuid: string, transform: Transform): void;
  select(uuid: string | null): void;
  undo(): void;
  redo(): void;
}
```

### urql Implementation

The store implementation uses urql:
- **Queries** (`documentFull`, `page`, `node`) populate reactive signals
- **Mutations** (`createNode`, `setTransform`, etc.) send commands and optimistically update local state
- **Subscriptions** (`documentChanged`, `nodeCreated`, `nodeUpdated`, `nodeDeleted`) apply deltas from other clients
- Full re-fetch only on initial connection and reconnect

### Optimistic Updates

For responsiveness, mutations update the local store immediately before the server responds. If the server rejects the mutation, the optimistic update is rolled back. This eliminates the perceived latency for local operations.

## Canvas Engine

HTML5 Canvas 2D for MVP. Upgrade path to WebGL, eventually replaced by WASM core engine (Approach C migration).

The canvas renderer:
- Runs at 60fps via `requestAnimationFrame`
- Accounts for `devicePixelRatio` in all transforms
- Draws nodes by kind (frame, rectangle, ellipse, text, path, image, group, component instance)
- Draws selection handles and tool previews
- Uses viewport culling to skip off-screen nodes

## UI Structure

All panels are Solid components consuming the `DocumentStore` via context. Interactive primitives come from Spec 07 (Component Library).

- **Toolbar** — tool selection: select (V), frame (F), rectangle (R), ellipse (O), path/pen (P), text (T), image, hand/zoom
- **Layer panel** — TreeView of node hierarchy, drag to reorder, visibility/lock toggles
- **Properties panel** — context-sensitive inspector: transform, style, constraints, token bindings, component variant selector, component property editor
- **Component library panel** — browse local + inherited components, drag to instantiate
- **Token panel** — view/edit design tokens, inheritance chain, promote/demote
- **Pages panel** — page list, navigation
- **Prototype panel** — interaction/transition editor (MVP: click-through linking)
- **Asset panel** — manage imported images, fonts
- **Inspect panel** — developer handoff mode (see below)

## Inspect Mode

Toggle via toolbar button or keyboard shortcut (I). Canvas becomes read-only, right panel switches to Inspect panel.

### Inspect Panel Contents

- **Properties** — exact values for position, size, rotation, opacity, border radius
- **Spacing** — red-line measurements between elements on hover
- **CSS output** — generated CSS including flex/grid layout
- **Token references** — which tokens are used, with resolved values
- **Color values** — all supported color spaces
- **Typography** — font family, size, weight, line height, letter spacing
- **Assets** — export options (PNG, SVG, WebP)
- **Component info** — component, variant, overrides
- **Layout details** — auto-layout/grid configuration, constraints

## Responsive Breakpoints

Breakpoints defined per page with per-node layout overrides.

Default breakpoints: Mobile (375px), Tablet (768px), Desktop (1440px).

Per-breakpoint overrides: layout mode switch, visibility, spacing, size. Stored as `breakpoint_overrides: HashMap<String, BreakpointOverride>`.

UI: breakpoint bar above canvas, responsive preview, breakpoint indicator.

## Key Interactions

- Standard design tool keyboard shortcuts (via tinykeys)
- Undo/redo via GraphQL mutations (`undo`, `redo`)
- Multi-select, grouping, alignment, distribution
- Zoom/pan (scroll, ctrl+scroll, space+drag, middle-click)
- Copy/paste within and across pages
- Pen tool for bezier path creation and editing
- Layout controls — flex and grid
- Component variant picker, property editor
- Inspect mode toggle (I)

## Accessibility

Per CLAUDE.md and GOV-023:
- ARIA landmark roles on all layout regions
- Keyboard-navigable panels and toolbar (roving tabindex)
- Canvas has `aria-label`, selection announced via `aria-live`
- WCAG 2.2 AA contrast ratios
- `:focus-visible` styles, `prefers-reduced-motion` support

## Communication

GraphQL over WebSocket (`graphql-ws` protocol) to the server. Single persistent connection. Queries for data, mutations for commands, subscriptions for real-time updates.

## Depends On

- Spec 00 (Toolchain)
- Spec 02 (Server — GraphQL API)
- Spec 07 (Component Library)

## Depended On By

- Nothing (leaf node)
