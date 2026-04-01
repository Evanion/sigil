# Spec 04: Frontend Editor

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

The human interface — a TypeScript SPA with a canvas-based vector editor, served by the Rust backend, communicating via WebSocket.

## Canvas Engine

HTML5 Canvas 2D for MVP. Upgrade path to WebGL, eventually replaced by WASM core engine (Approach C migration).

## UI Structure

- **Toolbar** — tool selection: select (V), frame (F), rectangle (R), ellipse (O), path/pen (P), text (T), image, hand/zoom
- **Layer panel** — tree view of node hierarchy, drag to reorder, visibility/lock toggles
- **Properties panel** — context-sensitive inspector for selected node(s): transform, style, constraints, token bindings, component variant selector, component property editor
- **Component library panel** — browse local + inherited components with variant previews, drag to instantiate
- **Token panel** — view/edit design tokens, see inheritance chain, promote/demote
- **Pages panel** — page list, navigation
- **Prototype panel** — interaction/transition editor (MVP: click-through linking)
- **Asset panel** — manage imported images, fonts
- **Inspect panel** — developer-focused view (see below)

## Inspect Mode

A dedicated mode for developers to examine designs and extract implementation details, similar to Figma's Dev Mode and Penpot's Inspect tab.

### Activation

Toggle via toolbar button or keyboard shortcut (I). When active, the canvas becomes read-only and the right panel switches to the Inspect panel.

### Inspect Panel Contents

- **Properties** — exact values for position, size, rotation, opacity, border radius, etc.
- **Spacing** — visualize margins, padding, and gaps between elements on hover (red-line measurements)
- **CSS output** — generated CSS for the selected node, including layout properties (flex/grid)
- **Token references** — show which design tokens are used, with resolved values
- **Color values** — display in all supported color spaces (sRGB hex, OKLCH, etc.)
- **Typography** — font family, size, weight, line height, letter spacing
- **Assets** — export options for images and icons (PNG, SVG, WebP)
- **Component info** — which component, which variant, which overrides are applied
- **Layout details** — auto-layout (flex) or grid configuration, constraints

### Interaction

- Click a node to inspect it
- Hover between nodes to see spacing measurements
- Click a CSS property to copy it to clipboard
- Click a token name to navigate to the token panel

## Responsive Breakpoints

Support for previewing designs at different viewport sizes, with per-breakpoint layout overrides.

### Breakpoint Model

Breakpoints are defined per page:

```
pub struct Breakpoint {
    pub name: String,          // e.g., "Mobile", "Tablet", "Desktop"
    pub width: f64,            // Viewport width in pixels
    pub is_default: bool,      // The primary design size
}
```

Default breakpoints: Mobile (375px), Tablet (768px), Desktop (1440px). Users can add custom breakpoints.

### Per-Breakpoint Overrides

Nodes can have layout and visibility overrides per breakpoint:

- **Layout mode switch** — a frame might use Grid on Desktop but Flex (column) on Mobile
- **Visibility** — hide/show nodes at specific breakpoints
- **Spacing** — different gap, padding values per breakpoint
- **Size** — different width/height constraints per breakpoint

Overrides are stored as a map on the node: `breakpoint_overrides: HashMap<String, BreakpointOverride>`. Properties not overridden use the default breakpoint's values.

### UI

- **Breakpoint bar** — horizontal bar above the canvas showing defined breakpoints. Click to switch. Drag edges to resize.
- **Responsive preview** — side-by-side or sequential view of all breakpoints
- **Breakpoint indicator** — shows current breakpoint name and width in the canvas header

## Key Interactions

- Standard design tool keyboard shortcuts
- Undo/redo backed by core engine operation history
- Multi-select, grouping, alignment, distribution
- Zoom/pan with trackpad and keyboard
- Copy/paste within and across pages
- Pen tool for bezier path creation and editing
- Layout controls on frames — flex (direction, gap, padding, alignment) and grid (columns, rows, gaps)
- Component variant picker in properties panel
- Component property editor for exposed properties
- Inspect mode toggle (I) for developer handoff

## Communication

- WebSocket to server, sending intent-based operations (not raw state)
- Receives state updates from server (including changes made by agents via MCP)

## Depends On

- Spec 00 (Toolchain)
- Spec 02 (Server — WebSocket connection)

## Depended On By

- Nothing (leaf node)
