# Spec 07: Component Library

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

A shared, documented component library that provides all UI primitives for the Sigil editor. Built on Solid.js + Kobalte, styled with Open Props CSS custom properties, developed and documented in Storybook.

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | Solid.js 1.9 | Reactive rendering |
| Headless primitives | Kobalte (`@kobalte/core`) | Accessible behavior (WAI-ARIA) |
| Icons | Lucide (`lucide-solid`) | Tree-shakeable icon set |
| Design tokens | Open Props | CSS custom property foundation |
| Development | Storybook (`storybook-solidjs-vite`) | Component development, docs, visual testing |
| Testing | Vitest | Unit + interaction tests |

## Design Token System

Open Props provides the scale system (spacing, typography, easing, shadows, z-index). We override the color palette for our dark design tool theme.

### Theme Variables

```css
:root {
  /* Surface hierarchy */
  --surface-1: #1e1e1e;      /* app background */
  --surface-2: #252525;      /* panel background */
  --surface-3: #2c2c2c;      /* toolbar, elevated surfaces */
  --surface-4: #333333;      /* hover states, input backgrounds */

  /* Text hierarchy */
  --text-1: #e0e0e0;         /* primary text */
  --text-2: #a0a0a0;         /* secondary text, labels */
  --text-3: #666666;         /* disabled text */

  /* Accent colors */
  --accent: #0d99ff;         /* selection, focus, primary actions */
  --accent-hover: #38aeff;   /* accent hover state */
  --accent-active: #0077cc;  /* accent pressed state */

  /* Semantic colors */
  --danger: #ef4444;         /* destructive actions */
  --success: #22c55e;        /* success states, connected indicator */
  --warning: #f59e0b;        /* warnings */

  /* Borders */
  --border-1: #3a3a3a;       /* subtle borders */
  --border-2: #4a4a4a;       /* prominent borders */

  /* Inherit Open Props scales */
  /* --size-1 through --size-15 (spacing) */
  /* --font-size-0 through --font-size-8 (typography) */
  /* --ease-1 through --ease-5 (easing) */
  /* --shadow-1 through --shadow-6 (elevation) */
}
```

### Usage Convention

Components use CSS custom properties for all visual values. No hardcoded colors, spacing, or font sizes. This enables theme switching (light theme in future) and ensures consistency.

```css
.panel {
  background: var(--surface-2);
  border-right: 1px solid var(--border-1);
  padding: var(--size-2);
}

.panel__heading {
  color: var(--text-2);
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-6);
}
```

## Component Catalog

### Layout Components

| Component | Description | Kobalte |
|-----------|-------------|---------|
| `Panel` | Resizable sidebar container with header, content area, collapse | — |
| `Toolbar` | Vertical tool strip with icon buttons | — |
| `Divider` | Horizontal/vertical separator line | `Separator` |

### Button Components

| Component | Variants | Kobalte |
|-----------|----------|---------|
| `Button` | primary, secondary, ghost, icon-only, danger | `Button` |
| `IconButton` | Compact square button for toolbar icons | `Button` |
| `ToggleButton` | Pressed/unpressed state (e.g., bold, align) | `ToggleButton` |

### Overlay Components

| Component | Description | Kobalte |
|-----------|-------------|---------|
| `Tooltip` | Hover/focus hint text | `Tooltip` |
| `Popover` | Floating content panel (e.g., color picker) | `Popover` |
| `ContextMenu` | Right-click menu (e.g., layer actions) | `ContextMenu` |
| `DropdownMenu` | Click-triggered menu | `DropdownMenu` |
| `Dialog` | Modal dialog (e.g., export settings) | `Dialog` |

### Input Components

| Component | Description | Kobalte |
|-----------|-------------|---------|
| `TextInput` | Single-line text field | `TextField` |
| `NumberInput` | Numeric input with increment/decrement | `NumberField` |
| `Select` | Dropdown selection | `Select` |
| `Toggle` | On/off switch (e.g., visibility) | `Switch` |

### Navigation Components

| Component | Description | Kobalte |
|-----------|-------------|---------|
| `Tabs` | Tabbed content sections | `Tabs` |

### Data Display Components

| Component | Description | Kobalte |
|-----------|-------------|---------|
| `TreeView` | Hierarchical list (layers panel) | — (custom) |
| `ColorSwatch` | Small color preview square | — |
| `Label` | Form label with optional tooltip | — |

### Feedback Components

| Component | Description | Kobalte |
|-----------|-------------|---------|
| `Toast` | Temporary notification | `Toast` |

## Component Structure

Each component lives in its own directory:

```
frontend/src/components/
├── button/
│   ├── Button.tsx           # Solid component
│   ├── Button.css           # Scoped styles
│   ├── Button.stories.tsx   # Storybook stories
│   └── Button.test.tsx      # Vitest tests
├── tooltip/
│   ├── Tooltip.tsx
│   ├── Tooltip.css
│   ├── Tooltip.stories.tsx
│   └── Tooltip.test.tsx
├── tree-view/
│   ├── TreeView.tsx
│   ├── TreeViewItem.tsx
│   ├── TreeView.css
│   ├── TreeView.stories.tsx
│   └── TreeView.test.tsx
└── ...
```

## Accessibility

Every component inherits Kobalte's WAI-ARIA compliance:

- **Keyboard navigation** — all interactive components are keyboard-operable
- **Focus management** — modals trap focus, menus return focus on close
- **Screen reader** — proper roles, labels, live regions
- **Contrast** — all text meets WCAG 2.2 AA (4.5:1 normal, 3:1 large)
- **Motion** — respect `prefers-reduced-motion`

Custom components (TreeView, ColorSwatch) implement ARIA patterns manually following WAI-ARIA Authoring Practices.

## Storybook

### Configuration

```
.storybook/
├── main.ts         # Framework: storybook-solidjs-vite
├── preview.ts      # Global decorators, Open Props import
└── preview-head.html  # Global CSS imports
```

### Story Convention

Each component has stories covering:
- **Default** — base state
- **Variants** — all visual variants (primary, ghost, etc.)
- **States** — hover, focus, disabled, loading
- **Sizes** — if applicable
- **Dark theme** — verify on dark background
- **Accessibility** — keyboard interaction, screen reader notes

### Running Storybook

```bash
pnpm --prefix frontend storybook dev -p 6006
```

Storybook runs independently — no server needed. Components are developed and tested in isolation.

## Build Order

The component library is built before panels:

1. Set up Solid + Vite plugin + tsconfig
2. Install Open Props, configure theme variables
3. Install Kobalte + Lucide
4. Set up Storybook
5. Build base components (Button, Tooltip, Input, Select, Toggle)
6. Build overlay components (Popover, ContextMenu, Dialog)
7. Build data components (TreeView, Tabs)
8. Build layout components (Panel, Toolbar, Divider)

Each component gets a Storybook story before being used in a panel.

## Depends On

- Spec 00 (Toolchain)

## Depended On By

- Spec 04 (Frontend Editor — panels consume these components)
