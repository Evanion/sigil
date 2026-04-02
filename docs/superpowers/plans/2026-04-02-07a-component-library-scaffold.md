# Component Library Scaffold — Implementation Plan (07a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the component library infrastructure — Solid.js, Open Props dark theme, Kobalte, Lucide icons, Storybook — and build the first components (Button, Tooltip, IconButton) as proof of concept.

**Architecture:** Solid.js is added to the existing Vite project via `vite-plugin-solid`. Existing vanilla TS files (canvas, tools, store) continue working alongside new `.tsx` Solid components. Open Props provides the CSS custom property foundation with a dark theme override layer. Kobalte provides headless accessible primitives. Storybook runs independently for component development. The entry point remains vanilla (Solid is adopted incrementally, not as a full rewrite).

**Tech Stack:** Solid.js 1.9, Kobalte 0.13, Open Props 1.7, Lucide-Solid 1.7, Storybook 10, Vite 8, Vitest 4

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. TypeScript strict, no `any`, no innerHTML. Every component must include ARIA landmarks/labels per GOV-023. All styling via CSS custom properties from the theme.

---

## File Structure

```
frontend/
├── .storybook/
│   ├── main.ts              # NEW: Storybook config
│   └── preview.ts           # NEW: Global decorators, theme import
├── postcss.config.js        # NEW: Open Props JIT plugin
├── vite.config.ts           # MODIFY: add vite-plugin-solid
├── tsconfig.json            # MODIFY: add JSX settings for Solid
├── package.json             # MODIFY: add dependencies + scripts
├── src/
│   ├── styles/
│   │   ├── theme.css        # NEW: Dark theme variable overrides
│   │   └── global.css       # MODIFY: import Open Props + theme
│   ├── components/
│   │   ├── button/
│   │   │   ├── Button.tsx         # NEW: Button component
│   │   │   ├── Button.css         # NEW: Button styles
│   │   │   ├── Button.stories.tsx # NEW: Storybook stories
│   │   │   └── Button.test.tsx    # NEW: Vitest tests
│   │   ├── icon-button/
│   │   │   ├── IconButton.tsx
│   │   │   ├── IconButton.css
│   │   │   ├── IconButton.stories.tsx
│   │   │   └── IconButton.test.tsx
│   │   └── tooltip/
│   │       ├── Tooltip.tsx
│   │       ├── Tooltip.css
│   │       ├── Tooltip.stories.tsx
│   │       └── Tooltip.test.tsx
│   └── main.ts              # KEEP: existing entry point (no change yet)
```

---

## Task 1: Add Solid.js to the existing Vite project

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/tsconfig.json`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Install dependencies:

```bash
cd frontend
pnpm add solid-js @kobalte/core lucide-solid open-props
pnpm add -D vite-plugin-solid postcss-jit-props storybook storybook-solidjs storybook-solidjs-vite
```

- [ ] 3. Update `frontend/vite.config.ts` to add the Solid plugin:

```typescript
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
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

- [ ] 4. Update `frontend/tsconfig.json` to add Solid JSX settings:

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
    "sourceMap": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] 5. Add Storybook scripts to `package.json`:

```json
"storybook": "storybook dev -p 6006",
"build-storybook": "storybook build"
```

- [ ] 6. Verify the project still builds with existing code:

```bash
pnpm build
pnpm test
```

The existing `.ts` files should continue working — Solid's plugin only transforms `.tsx` files.

- [ ] 7. Commit:

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/vite.config.ts frontend/tsconfig.json
git commit -m "feat(frontend): add Solid.js, Kobalte, Open Props, Lucide, Storybook dependencies (spec-07)"
```

---

## Task 2: Set up Open Props dark theme

**Files:**
- Create: `frontend/postcss.config.js`
- Create: `frontend/src/styles/theme.css`
- Modify: `frontend/src/styles/global.css`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `frontend/postcss.config.js` for Open Props JIT (tree-shakes unused properties):

```javascript
import postcssJitProps from "postcss-jit-props";
import OpenProps from "open-props";

export default {
  plugins: [postcssJitProps(OpenProps)],
};
```

- [ ] 3. Create `frontend/src/styles/theme.css` with the dark theme variable overrides:

```css
/* Dark theme for Sigil design tool.
 * Overrides Open Props defaults with design-tool-appropriate dark values.
 * All components use these variables — no hardcoded colors. */

:root {
  /* Surface hierarchy */
  --surface-1: #1e1e1e;
  --surface-2: #252525;
  --surface-3: #2c2c2c;
  --surface-4: #333333;

  /* Text hierarchy */
  --text-1: #e0e0e0;
  --text-2: #a0a0a0;
  --text-3: #666666;

  /* Accent */
  --accent: #0d99ff;
  --accent-hover: #38aeff;
  --accent-active: #0077cc;

  /* Semantic */
  --danger: #ef4444;
  --danger-hover: #f87171;
  --success: #22c55e;
  --warning: #f59e0b;

  /* Borders */
  --border-1: #3a3a3a;
  --border-2: #4a4a4a;

  /* Component-specific */
  --button-radius: var(--radius-2);
  --input-radius: var(--radius-2);
  --panel-radius: 0;
  --tooltip-radius: var(--radius-2);

  /* Focus ring */
  --focus-ring: 2px solid var(--accent);
  --focus-offset: 2px;
}
```

- [ ] 4. Update `frontend/src/styles/global.css` to import Open Props and the theme. Add the imports at the very top (before existing styles), and update existing hardcoded colors to use theme variables:

The global.css currently has hardcoded hex colors for the layout. Replace them with theme variables. Import Open Props and the theme at the top of the file.

- [ ] 5. Verify the app still looks correct:

```bash
pnpm build
```

- [ ] 6. Commit:

```bash
git add frontend/postcss.config.js frontend/src/styles/
git commit -m "feat(frontend): add Open Props dark theme with CSS custom properties (spec-07)"
```

---

## Task 3: Set up Storybook

**Files:**
- Create: `frontend/.storybook/main.ts`
- Create: `frontend/.storybook/preview.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `frontend/.storybook/main.ts`:

```typescript
import type { StorybookConfig } from "storybook-solidjs-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "storybook-solidjs-vite",
  addons: [],
};

export default config;
```

- [ ] 3. Create `frontend/.storybook/preview.ts`:

```typescript
import type { Preview } from "storybook-solidjs";
import "../src/styles/global.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#1e1e1e" },
        { name: "panel", value: "#252525" },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
      },
    },
  },
};

export default preview;
```

This imports the global CSS (including Open Props + theme) so all stories render with the dark theme.

- [ ] 4. Verify Storybook starts:

```bash
cd frontend && pnpm storybook
```

It should open at `http://localhost:6006` with an empty stories list (no stories yet).

- [ ] 5. Commit:

```bash
git add frontend/.storybook/
git commit -m "feat(frontend): set up Storybook with Solid renderer and dark theme (spec-07)"
```

---

## Task 4: Build the Button component

**Files:**
- Create: `frontend/src/components/button/Button.tsx`
- Create: `frontend/src/components/button/Button.css`
- Create: `frontend/src/components/button/Button.stories.tsx`
- Create: `frontend/src/components/button/Button.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full. Components need ARIA labels, keyboard navigation, WCAG contrast.

- [ ] 2. Create `frontend/src/components/button/Button.css`:

```css
.sigil-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-1);
  padding: var(--size-1) var(--size-3);
  border: 1px solid transparent;
  border-radius: var(--button-radius);
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-5);
  cursor: pointer;
  transition: background-color 150ms, border-color 150ms, color 150ms;
  white-space: nowrap;
  user-select: none;
}

/* Primary variant */
.sigil-button--primary {
  background: var(--accent);
  color: #ffffff;
  border-color: var(--accent);
}
.sigil-button--primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.sigil-button--primary:active {
  background: var(--accent-active);
  border-color: var(--accent-active);
}

/* Secondary variant */
.sigil-button--secondary {
  background: var(--surface-3);
  color: var(--text-1);
  border-color: var(--border-1);
}
.sigil-button--secondary:hover {
  background: var(--surface-4);
  border-color: var(--border-2);
}

/* Ghost variant */
.sigil-button--ghost {
  background: transparent;
  color: var(--text-2);
}
.sigil-button--ghost:hover {
  background: var(--surface-4);
  color: var(--text-1);
}

/* Danger variant */
.sigil-button--danger {
  background: var(--danger);
  color: #ffffff;
  border-color: var(--danger);
}
.sigil-button--danger:hover {
  background: var(--danger-hover);
  border-color: var(--danger-hover);
}

/* Disabled */
.sigil-button[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

/* Focus */
.sigil-button:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

/* Sizes */
.sigil-button--sm {
  padding: var(--size-00) var(--size-2);
  font-size: var(--font-size-00);
}
.sigil-button--lg {
  padding: var(--size-2) var(--size-4);
  font-size: var(--font-size-1);
}
```

- [ ] 3. Create `frontend/src/components/button/Button.tsx`:

```tsx
import { Button as KobalteButton } from "@kobalte/core/button";
import { type JSX, splitProps } from "solid-js";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  children: JSX.Element;
  onClick?: () => void;
  class?: string;
  "aria-label"?: string;
}

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, [
    "variant",
    "size",
    "disabled",
    "children",
    "onClick",
    "class",
  ]);

  const variant = () => local.variant ?? "secondary";
  const size = () => local.size ?? "md";

  const className = () => {
    const classes = ["sigil-button", `sigil-button--${variant()}`];
    if (size() !== "md") classes.push(`sigil-button--${size()}`);
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteButton
      class={className()}
      disabled={local.disabled}
      onClick={local.onClick}
      {...others}
    >
      {local.children}
    </KobalteButton>
  );
}
```

- [ ] 4. Create `frontend/src/components/button/Button.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "storybook-solidjs";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: { type: "select" },
      options: ["primary", "secondary", "ghost", "danger"],
    },
    size: {
      control: { type: "select" },
      options: ["sm", "md", "lg"],
    },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: "primary", children: "Primary Button" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Secondary Button" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Ghost Button" },
};

export const Danger: Story = {
  args: { variant: "danger", children: "Delete" },
};

export const Small: Story = {
  args: { variant: "secondary", size: "sm", children: "Small" },
};

export const Large: Story = {
  args: { variant: "primary", size: "lg", children: "Large Button" },
};

export const Disabled: Story = {
  args: { variant: "primary", disabled: true, children: "Disabled" },
};
```

- [ ] 5. Create `frontend/src/components/button/Button.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(() => <Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeTruthy();
  });

  it("applies variant class", () => {
    render(() => <Button variant="primary">Primary</Button>);
    const btn = screen.getByText("Primary");
    expect(btn.classList.contains("sigil-button--primary")).toBe(true);
  });

  it("applies size class", () => {
    render(() => <Button size="sm">Small</Button>);
    const btn = screen.getByText("Small");
    expect(btn.classList.contains("sigil-button--sm")).toBe(true);
  });

  it("does not add size class for md (default)", () => {
    render(() => <Button>Default</Button>);
    const btn = screen.getByText("Default");
    expect(btn.classList.contains("sigil-button--md")).toBe(false);
  });

  it("fires onClick", () => {
    const handler = vi.fn();
    render(() => <Button onClick={handler}>Click</Button>);
    screen.getByText("Click").click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("is disabled when prop is set", () => {
    render(() => <Button disabled>Disabled</Button>);
    expect(screen.getByText("Disabled").hasAttribute("disabled")).toBe(true);
  });

  it("defaults to secondary variant", () => {
    render(() => <Button>Default</Button>);
    const btn = screen.getByText("Default");
    expect(btn.classList.contains("sigil-button--secondary")).toBe(true);
  });
});
```

Note: This requires `@solidjs/testing-library`. Add it as a dev dependency:

```bash
pnpm add -D @solidjs/testing-library
```

- [ ] 6. Run tests and verify Storybook:

```bash
pnpm test
pnpm storybook  # visually verify the Button stories render with dark theme
```

- [ ] 7. Commit:

```bash
git add frontend/src/components/button/
git commit -m "feat(frontend): add Button component with Kobalte, stories, and tests (spec-07)"
```

---

## Task 5: Build the IconButton component

**Files:**
- Create: `frontend/src/components/icon-button/IconButton.tsx`
- Create: `frontend/src/components/icon-button/IconButton.css`
- Create: `frontend/src/components/icon-button/IconButton.stories.tsx`
- Create: `frontend/src/components/icon-button/IconButton.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create the IconButton — a compact square button for toolbar icons. Uses Lucide icons. Must have `aria-label` since it has no visible text.

The component wraps Button with icon-specific styling (square aspect ratio, centered icon) and requires `aria-label` for accessibility.

Stories should showcase with various Lucide icons (MousePointer, Square, Circle, Frame, Type, Pen).

Tests should verify: renders icon, requires aria-label, applies active state, correct size.

- [ ] 3. Run tests and verify in Storybook.

- [ ] 4. Commit: `feat(frontend): add IconButton component with Lucide icons (spec-07)`

---

## Task 6: Build the Tooltip component

**Files:**
- Create: `frontend/src/components/tooltip/Tooltip.tsx`
- Create: `frontend/src/components/tooltip/Tooltip.css`
- Create: `frontend/src/components/tooltip/Tooltip.stories.tsx`
- Create: `frontend/src/components/tooltip/Tooltip.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create the Tooltip — wraps Kobalte's `Tooltip` primitive with dark theme styling. Appears on hover/focus after a short delay.

Props: `content` (string), `placement` (top/bottom/left/right), `children` (trigger element).

Styled with dark background (`var(--surface-4)`), light text (`var(--text-1)`), subtle shadow, small font size.

Stories: all 4 placements, with Button trigger, with IconButton trigger, long content.

Tests: renders trigger, shows content on interaction (may need async/waitFor).

- [ ] 3. Run tests and verify in Storybook.

- [ ] 4. Commit: `feat(frontend): add Tooltip component with Kobalte (spec-07)`

---

## Task 7: Verify full pipeline

- [ ] 1. Run all frontend tests: `pnpm test`
- [ ] 2. Run lint: `pnpm lint`
- [ ] 3. Run format check: `pnpm format:check`
- [ ] 4. Build the app: `pnpm build`
- [ ] 5. Start Storybook: `pnpm storybook` — verify all stories render correctly with dark theme
- [ ] 6. Fix any issues, commit.

---

## Deferred Items

### Plan 07b: Remaining Components

- Overlays: Popover, ContextMenu, DropdownMenu, Dialog
- Inputs: TextInput, NumberInput, Select, Toggle
- Navigation: Tabs
- Data: TreeView, ColorSwatch, Label
- Feedback: Toast
- Layout: Panel, Toolbar, Divider
