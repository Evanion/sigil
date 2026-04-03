# Panel System Implementation Plan (Plan 08b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the schema-driven panel system with Figma-style tabbed regions, generic SchemaPanel renderer, and field type mapping — completing the Spec 08 panel infrastructure.

**Architecture:** Two `<TabRegion>` components (left/right) render tabs from a panel registry. The right region's "Design" tab renders a `<SchemaPanel>` that reads a `PropertySchema` and auto-generates field editors (NumberInput, Select, Toggle, etc.) from the existing component library. Field changes dispatch mutations through the document store. Left region tabs are placeholders for Spec 10.

**Tech Stack:** Solid.js 1.9, Kobalte (existing component library), TypeScript

---

## Scope

**In scope (this plan):**
- Schema type definitions (`PropertySchema`, `SectionDef`, `FieldDef`, `FieldType`)
- `<TabRegion>` component with tab bar and panel mounting
- Panel registry with visibility predicates
- `<SchemaPanel>` generic renderer
- `<SchemaSection>` section renderer (fields and collapsible headers)
- `<FieldRenderer>` mapping `FieldType` → component
- `<DesignPanel>` with a basic transform schema (X, Y, W, H, rotation, name, visible, locked)
- Placeholder panels for Layers, Pages, Inspect, Component
- Wire into `App.tsx`

**Deferred:**
- Fill/stroke/effect editing (needs color picker component — Spec 09)
- Layers tree view content (Spec 10)
- Pages panel content (Spec 10)

---

## Task 1: Schema type definitions

**Files:**
- Create: `frontend/src/panels/schema/types.ts`

- [ ] **Step 1: Create the schema types**

Create `frontend/src/panels/schema/types.ts`:

```typescript
/** Field editor types supported by the SchemaPanel renderer. */
export type FieldType =
  | "number"
  | "slider"
  | "select"
  | "toggle"
  | "text"
  | "corners"
  | "token-ref";

/** A single editable field definition. */
export interface FieldDef {
  /** Dot-path into the node object (e.g., "transform.x", "style.opacity"). */
  readonly key: string;
  /** Display label. */
  readonly label: string;
  /** Field editor type. */
  readonly type: FieldType;
  /** Layout hint — grid columns this field spans. Default: 1. */
  readonly span?: 1 | 2;
  /** Minimum value (number/slider). */
  readonly min?: number;
  /** Maximum value (number/slider). */
  readonly max?: number;
  /** Step increment (number/slider). */
  readonly step?: number;
  /** Unit suffix displayed after the value (e.g., "°", "px", "%"). */
  readonly suffix?: string;
  /** Options for select fields. */
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}

/** A labeled group of fields within a panel. */
export interface SectionDef {
  /** Section heading (e.g., "Transform", "Fill"). */
  readonly name: string;
  /**
   * Only show this section for specific node kinds.
   * Omit to always show. Use the `type` discriminant from NodeKind.
   */
  readonly when?: string | readonly string[];
  /** Field definitions for this section. */
  readonly fields: readonly FieldDef[];
  /** Whether the section starts collapsed. Default: false. */
  readonly collapsed?: boolean;
}

/** A complete property schema for a panel. */
export interface PropertySchema {
  readonly sections: readonly SectionDef[];
}

/**
 * Returns the string node kind type (e.g., "frame", "rectangle").
 * Used by `when` guards on sections.
 */
export type NodeKindType = string;
```

- [ ] **Step 2: Verify compilation**

```bash
pnpm --prefix frontend exec tsc --noEmit 2>&1 | grep "panels" || echo "No errors in panels"
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/schema/types.ts
git commit -m "feat(frontend): add property schema type definitions (Plan 08b, Task 1)"
```

---

## Task 2: TabRegion component

**Files:**
- Create: `frontend/src/panels/TabRegion.tsx`
- Create: `frontend/src/panels/TabRegion.css`
- Create: `frontend/src/panels/registry.ts`

- [ ] **Step 1: Create the panel registry types and data**

Create `frontend/src/panels/registry.ts`:

```typescript
import { type Component } from "solid-js";

/** Registration entry for a panel in the tab system. */
export interface PanelRegistration {
  /** Unique panel identifier. */
  readonly id: string;
  /** Tab label shown in the region. */
  readonly label: string;
  /** Which region this panel appears in. */
  readonly region: "left" | "right";
  /** Sort order within the region (lower = first). */
  readonly order: number;
  /** The Solid component to render as the panel body. */
  readonly component: Component;
  /** Reactive predicate — panel tab is hidden when this returns false. */
  readonly visible?: () => boolean;
  /** If true, this panel is selected by default. */
  readonly default?: boolean;
}

/**
 * The global panel registry.
 *
 * Panels are registered at import time. The `<TabRegion>` component
 * filters this list by region and renders visible panels as tabs.
 */
export const panels: PanelRegistration[] = [];

/** Register a panel. Call at module scope. */
export function registerPanel(reg: PanelRegistration): void {
  panels.push(reg);
}
```

- [ ] **Step 2: Create TabRegion CSS**

Create `frontend/src/panels/TabRegion.css`:

```css
.tab-region {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.tab-region__bar {
  display: flex;
  border-bottom: 1px solid var(--surface-3, #313244);
  flex-shrink: 0;
}

.tab-region__tab {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-2, #a6adc8);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
}

.tab-region__tab:hover {
  color: var(--text-1, #cdd6f4);
}

.tab-region__tab:focus-visible {
  outline: 2px solid var(--accent, #cba6f7);
  outline-offset: -2px;
}

.tab-region__tab[aria-selected="true"] {
  color: var(--text-1, #cdd6f4);
  border-bottom-color: var(--accent, #cba6f7);
}

.tab-region__content {
  flex: 1;
  overflow-y: auto;
}

@media (prefers-reduced-motion: reduce) {
  .tab-region__tab {
    transition: none;
  }
}
```

- [ ] **Step 3: Create TabRegion component**

Create `frontend/src/panels/TabRegion.tsx`:

```tsx
import {
  createMemo,
  createSignal,
  createEffect,
  For,
  Show,
  Dynamic,
  type Component,
} from "solid-js";
import { panels, type PanelRegistration } from "./registry";
import "./TabRegion.css";

interface TabRegionProps {
  readonly region: "left" | "right";
}

export const TabRegion: Component<TabRegionProps> = (props) => {
  const visiblePanels = createMemo(() =>
    panels
      .filter(
        (p) => p.region === props.region && (p.visible?.() ?? true),
      )
      .sort((a, b) => a.order - b.order),
  );

  const defaultTab = createMemo(
    () =>
      visiblePanels().find((p) => p.default)?.id ??
      visiblePanels()[0]?.id ??
      "",
  );

  const [activeTab, setActiveTab] = createSignal(defaultTab());

  // If the active tab becomes invisible, fall back to default
  createEffect(() => {
    const visible = visiblePanels();
    const current = activeTab();
    if (!visible.some((p) => p.id === current)) {
      setActiveTab(defaultTab());
    }
  });

  const activePanel = createMemo(
    () => visiblePanels().find((p) => p.id === activeTab()),
  );

  // Keyboard navigation between tabs
  function handleTabKeyDown(e: KeyboardEvent) {
    const visible = visiblePanels();
    const currentIndex = visible.findIndex((p) => p.id === activeTab());
    let nextIndex = -1;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % visible.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex =
        (currentIndex - 1 + visible.length) % visible.length;
    }

    if (nextIndex >= 0) {
      const next = visible[nextIndex];
      if (next) {
        setActiveTab(next.id);
        // Focus the tab button
        const tabBar = (e.currentTarget as HTMLElement);
        const buttons = tabBar.querySelectorAll<HTMLButtonElement>(
          "[role='tab']",
        );
        buttons[nextIndex]?.focus();
      }
    }
  }

  return (
    <div class="tab-region">
      <div
        class="tab-region__bar"
        role="tablist"
        onKeyDown={handleTabKeyDown}
      >
        <For each={visiblePanels()}>
          {(panel, index) => (
            <button
              class="tab-region__tab"
              role="tab"
              aria-selected={activeTab() === panel.id}
              tabindex={activeTab() === panel.id ? 0 : -1}
              onClick={() => setActiveTab(panel.id)}
            >
              {panel.label}
            </button>
          )}
        </For>
      </div>
      <div class="tab-region__content" role="tabpanel">
        <Show when={activePanel()}>
          {(panel) => <Dynamic component={panel().component} />}
        </Show>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Verify compilation**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/
git commit -m "feat(frontend): add TabRegion component and panel registry (Plan 08b, Task 2)"
```

---

## Task 3: SchemaPanel, SchemaSection, and FieldRenderer

**Files:**
- Create: `frontend/src/panels/SchemaPanel.tsx`
- Create: `frontend/src/panels/SchemaPanel.css`
- Create: `frontend/src/panels/SchemaSection.tsx`
- Create: `frontend/src/panels/FieldRenderer.tsx`

- [ ] **Step 1: Create SchemaPanel CSS**

Create `frontend/src/panels/SchemaPanel.css`:

```css
.schema-panel {
  padding: 8px 12px;
}

.schema-panel__empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-2, #a6adc8);
  font-size: 12px;
}

.schema-section {
  margin-bottom: 12px;
}

.schema-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
}

.schema-section__name {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-2, #a6adc8);
  margin: 0;
}

.schema-section__toggle {
  font-size: 10px;
  color: var(--text-2, #a6adc8);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
}

.schema-section__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 4px;
}

.schema-field--span-2 {
  grid-column: span 2;
}

.schema-field {
  display: flex;
  align-items: center;
  gap: 4px;
}

.schema-field__label {
  font-size: 11px;
  color: var(--text-2, #a6adc8);
  min-width: 16px;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Create FieldRenderer**

Create `frontend/src/panels/FieldRenderer.tsx`:

```tsx
import { type Component, Switch, Match } from "solid-js";
import type { FieldDef } from "./schema/types";
import { NumberInput } from "../components/number-input/NumberInput";
import { TextInput } from "../components/text-input/TextInput";
import { Select } from "../components/select/Select";
import { Toggle } from "../components/toggle/Toggle";

interface FieldRendererProps {
  readonly field: FieldDef;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}

export const FieldRenderer: Component<FieldRendererProps> = (props) => {
  return (
    <Switch fallback={<span>{String(props.value ?? "")}</span>}>
      <Match when={props.field.type === "number"}>
        <NumberInput
          value={typeof props.value === "number" ? props.value : 0}
          onChange={(v) => {
            if (Number.isFinite(v)) props.onChange(v);
          }}
          step={props.field.step ?? 1}
          min={props.field.min}
          max={props.field.max}
          aria-label={props.field.label}
        />
      </Match>
      <Match when={props.field.type === "slider"}>
        <input
          type="range"
          value={typeof props.value === "number" ? props.value : 0}
          min={props.field.min ?? 0}
          max={props.field.max ?? 100}
          step={props.field.step ?? 1}
          onInput={(e) => {
            const v = parseFloat(e.currentTarget.value);
            if (Number.isFinite(v)) props.onChange(v);
          }}
          aria-label={props.field.label}
        />
      </Match>
      <Match when={props.field.type === "text"}>
        <TextInput
          value={typeof props.value === "string" ? props.value : ""}
          onChange={(v) => props.onChange(v)}
          aria-label={props.field.label}
        />
      </Match>
      <Match when={props.field.type === "select" && props.field.options}>
        <Select
          value={String(props.value ?? "")}
          onChange={(v) => props.onChange(v)}
          options={
            props.field.options?.map((o) => ({
              value: o.value,
              label: o.label,
            })) ?? []
          }
          aria-label={props.field.label}
        />
      </Match>
      <Match when={props.field.type === "toggle"}>
        <Toggle
          checked={Boolean(props.value)}
          onChange={(v) => props.onChange(v)}
          aria-label={props.field.label}
        />
      </Match>
    </Switch>
  );
};
```

- [ ] **Step 3: Create SchemaSection**

Create `frontend/src/panels/SchemaSection.tsx`:

```tsx
import { createSignal, For, Show, type Component } from "solid-js";
import type { SectionDef } from "./schema/types";
import { FieldRenderer } from "./FieldRenderer";
import type { DocumentNode } from "../types/document";

interface SchemaSectionProps {
  readonly section: SectionDef;
  readonly node: DocumentNode;
  readonly onFieldChange: (key: string, value: unknown) => void;
}

/**
 * Resolves a dot-path like "transform.x" against a node object.
 */
function resolveValue(node: DocumentNode, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = node;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export const SchemaSection: Component<SchemaSectionProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal(
    props.section.collapsed ?? false,
  );

  return (
    <div class="schema-section">
      <div
        class="schema-section__header"
        onClick={() => setCollapsed(!collapsed())}
      >
        <h3 class="schema-section__name">{props.section.name}</h3>
        <button
          class="schema-section__toggle"
          aria-expanded={!collapsed()}
          aria-label={`${collapsed() ? "Expand" : "Collapse"} ${props.section.name}`}
        >
          {collapsed() ? "▸" : "▾"}
        </button>
      </div>
      <Show when={!collapsed()}>
        <div class="schema-section__fields">
          <For each={props.section.fields}>
            {(field) => (
              <div
                class={`schema-field ${field.span === 2 ? "schema-field--span-2" : ""}`}
              >
                <span class="schema-field__label">{field.label}</span>
                <FieldRenderer
                  field={field}
                  value={resolveValue(props.node, field.key)}
                  onChange={(v) => props.onFieldChange(field.key, v)}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
```

- [ ] **Step 4: Create SchemaPanel**

Create `frontend/src/panels/SchemaPanel.tsx`:

```tsx
import { createMemo, For, Show, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import type { PropertySchema } from "./schema/types";
import { SchemaSection } from "./SchemaSection";
import type { DocumentNode } from "../types/document";
import "./SchemaPanel.css";

interface SchemaPanelProps {
  readonly schema: PropertySchema;
}

/**
 * Checks whether a section's `when` guard matches the node's kind.
 */
function matchesNodeKind(
  node: DocumentNode,
  when: string | readonly string[] | undefined,
): boolean {
  if (when === undefined) return true;
  const kind = node.kind.type;
  if (typeof when === "string") return kind === when;
  return when.includes(kind);
}

export const SchemaPanel: Component<SchemaPanelProps> = (props) => {
  const store = useDocument();

  const selectedNode = createMemo((): DocumentNode | undefined => {
    const id = store.selectedNodeId();
    if (!id) return undefined;
    return store.state.nodes[id] as DocumentNode | undefined;
  });

  function handleFieldChange(key: string, value: unknown): void {
    const uuid = store.selectedNodeId();
    if (!uuid) return;

    const node = selectedNode();
    if (!node) return;

    // Route field changes to the appropriate store mutation
    if (key.startsWith("transform.")) {
      const field = key.split(".")[1];
      if (!field) return;
      const currentTransform = node.transform;
      store.setTransform(uuid, {
        ...currentTransform,
        [field]: value,
      });
    } else if (key === "name") {
      if (typeof value === "string") store.renameNode(uuid, value);
    } else if (key === "visible") {
      if (typeof value === "boolean") store.setVisible(uuid, value);
    } else if (key === "locked") {
      if (typeof value === "boolean") store.setLocked(uuid, value);
    }
    // Future: style.opacity, style.fills, style.blend_mode, etc.
  }

  return (
    <div class="schema-panel">
      <Show
        when={selectedNode()}
        fallback={
          <div class="schema-panel__empty">
            Select a layer to view its properties
          </div>
        }
      >
        {(node) => (
          <For each={props.schema.sections}>
            {(section) => (
              <Show when={matchesNodeKind(node(), section.when)}>
                <SchemaSection
                  section={section}
                  node={node()}
                  onFieldChange={handleFieldChange}
                />
              </Show>
            )}
          </For>
        )}
      </Show>
    </div>
  );
};
```

- [ ] **Step 5: Verify compilation**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/
git commit -m "feat(frontend): add SchemaPanel, SchemaSection, FieldRenderer (Plan 08b, Task 3)"
```

---

## Task 4: DesignPanel with transform schema + placeholder panels

**Files:**
- Create: `frontend/src/panels/DesignPanel.tsx`
- Create: `frontend/src/panels/schemas/design-schema.ts`
- Create: `frontend/src/panels/LayersPanel.tsx`
- Create: `frontend/src/panels/PagesPanel.tsx`
- Create: `frontend/src/panels/InspectPanel.tsx`
- Create: `frontend/src/panels/ComponentPanel.tsx`
- Create: `frontend/src/panels/PlaceholderPanel.tsx`

- [ ] **Step 1: Create a reusable placeholder panel**

Create `frontend/src/panels/PlaceholderPanel.tsx`:

```tsx
import { type Component } from "solid-js";

interface PlaceholderPanelProps {
  readonly title: string;
  readonly message?: string;
}

export const PlaceholderPanel: Component<PlaceholderPanelProps> = (props) => {
  return (
    <div style={{ padding: "24px 12px", "text-align": "center" }}>
      <p
        style={{
          color: "var(--text-2, #a6adc8)",
          "font-size": "12px",
          margin: "0",
        }}
      >
        {props.message ?? `${props.title} — coming soon`}
      </p>
    </div>
  );
};
```

- [ ] **Step 2: Create the design schema**

Create `frontend/src/panels/schemas/design-schema.ts`:

```typescript
import type { PropertySchema } from "../schema/types";

/**
 * Property schema for the "Design" panel tab.
 *
 * Defines which fields are shown for each node kind. The SchemaPanel
 * renders these definitions into NumberInput/Toggle/Select editors
 * automatically.
 */
export const designSchema: PropertySchema = {
  sections: [
    {
      name: "Node",
      fields: [
        { key: "name", label: "Name", type: "text", span: 2 },
        { key: "visible", label: "Visible", type: "toggle" },
        { key: "locked", label: "Locked", type: "toggle" },
      ],
    },
    {
      name: "Transform",
      fields: [
        {
          key: "transform.x",
          label: "X",
          type: "number",
          step: 1,
        },
        {
          key: "transform.y",
          label: "Y",
          type: "number",
          step: 1,
        },
        {
          key: "transform.width",
          label: "W",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "transform.height",
          label: "H",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "transform.rotation",
          label: "↻",
          type: "number",
          step: 0.1,
          suffix: "°",
        },
      ],
    },
    {
      name: "Corner Radius",
      when: "rectangle",
      fields: [
        {
          key: "kind.corner_radii.0",
          label: "↰",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "kind.corner_radii.1",
          label: "↱",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "kind.corner_radii.2",
          label: "↲",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "kind.corner_radii.3",
          label: "↳",
          type: "number",
          step: 1,
          min: 0,
        },
      ],
    },
  ],
};
```

- [ ] **Step 3: Create DesignPanel**

Create `frontend/src/panels/DesignPanel.tsx`:

```tsx
import { type Component } from "solid-js";
import { SchemaPanel } from "./SchemaPanel";
import { designSchema } from "./schemas/design-schema";

export const DesignPanel: Component = () => {
  return <SchemaPanel schema={designSchema} />;
};
```

- [ ] **Step 4: Create placeholder panels**

Create `frontend/src/panels/LayersPanel.tsx`:

```tsx
import { type Component } from "solid-js";
import { PlaceholderPanel } from "./PlaceholderPanel";

export const LayersPanel: Component = () => (
  <PlaceholderPanel title="Layers" message="Layer tree — Spec 10" />
);
```

Create `frontend/src/panels/PagesPanel.tsx`:

```tsx
import { type Component } from "solid-js";
import { PlaceholderPanel } from "./PlaceholderPanel";

export const PagesPanel: Component = () => (
  <PlaceholderPanel title="Pages" message="Page list — Spec 10" />
);
```

Create `frontend/src/panels/InspectPanel.tsx`:

```tsx
import { type Component } from "solid-js";
import { PlaceholderPanel } from "./PlaceholderPanel";

export const InspectPanel: Component = () => (
  <PlaceholderPanel title="Inspect" message="Inspect mode — future spec" />
);
```

Create `frontend/src/panels/ComponentPanel.tsx`:

```tsx
import { type Component } from "solid-js";
import { PlaceholderPanel } from "./PlaceholderPanel";

export const ComponentPanel: Component = () => (
  <PlaceholderPanel title="Component" message="Component editor — future spec" />
);
```

- [ ] **Step 5: Verify compilation**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/
git commit -m "feat(frontend): add DesignPanel with transform schema + placeholder panels (Plan 08b, Task 4)"
```

---

## Task 5: Register panels and wire into App.tsx

**Files:**
- Create: `frontend/src/panels/register-panels.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create panel registration module**

Create `frontend/src/panels/register-panels.ts`:

```typescript
import { registerPanel } from "./registry";
import { LayersPanel } from "./LayersPanel";
import { PagesPanel } from "./PagesPanel";
import { DesignPanel } from "./DesignPanel";
import { InspectPanel } from "./InspectPanel";
import { ComponentPanel } from "./ComponentPanel";
import { useDocument } from "../store/document-context";

/** Register all default panels. Call once at app startup. */
export function registerDefaultPanels(): void {
  registerPanel({
    id: "layers",
    label: "Layers",
    region: "left",
    order: 0,
    component: LayersPanel,
    default: true,
  });

  registerPanel({
    id: "pages",
    label: "Pages",
    region: "left",
    order: 1,
    component: PagesPanel,
  });

  registerPanel({
    id: "design",
    label: "Design",
    region: "right",
    order: 0,
    component: DesignPanel,
    default: true,
  });

  registerPanel({
    id: "inspect",
    label: "Inspect",
    region: "right",
    order: 1,
    component: InspectPanel,
  });

  registerPanel({
    id: "component",
    label: "Component",
    region: "right",
    order: 2,
    component: ComponentPanel,
    visible: () => {
      try {
        const store = useDocument();
        const id = store.selectedNodeId();
        if (!id) return false;
        const node = store.state.nodes[id];
        return node?.kind?.type === "component_instance";
      } catch {
        return false;
      }
    },
  });
}
```

- [ ] **Step 2: Update App.tsx to use TabRegion**

Read the current `frontend/src/App.tsx` and replace the placeholder panel divs with `<TabRegion>` components. The structure should become:

```tsx
// Add imports at top:
import { TabRegion } from "./panels/TabRegion";
import { registerDefaultPanels } from "./panels/register-panels";

// Call registration before render:
registerDefaultPanels();

// Replace placeholder left panel div content:
<div class="app-shell__left" role="complementary" aria-label="Left panel" tabindex={0}>
  <TabRegion region="left" />
</div>

// Replace placeholder right panel div content:
<div class="app-shell__right" role="complementary" aria-label="Right panel" tabindex={0}>
  <TabRegion region="right" />
</div>
```

Remove the old `<div class="placeholder-panel">` elements.

- [ ] **Step 3: Verify build**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/register-panels.ts frontend/src/App.tsx
git commit -m "feat(frontend): register panels and wire TabRegion into App (Plan 08b, Task 5)"
```

---

## Task 6: Add tests

**Files:**
- Create: `frontend/src/panels/__tests__/TabRegion.test.tsx`
- Create: `frontend/src/panels/__tests__/SchemaPanel.test.tsx`

- [ ] **Step 1: Create TabRegion test**

Create `frontend/src/panels/__tests__/TabRegion.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { TabRegion } from "../TabRegion";
import { panels, registerPanel } from "../registry";
import { type Component } from "solid-js";

const PanelA: Component = () => <div>Panel A content</div>;
const PanelB: Component = () => <div>Panel B content</div>;

describe("TabRegion", () => {
  beforeEach(() => {
    // Clear the global registry between tests
    panels.length = 0;
  });

  it("renders tabs for registered panels", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "right",
      order: 0,
      component: PanelA,
      default: true,
    });
    registerPanel({
      id: "b",
      label: "Beta",
      region: "right",
      order: 1,
      component: PanelB,
    });

    render(() => <TabRegion region="right" />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("renders default panel content", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "left",
      order: 0,
      component: PanelA,
      default: true,
    });

    render(() => <TabRegion region="left" />);
    expect(screen.getByText("Panel A content")).toBeTruthy();
  });

  it("only shows panels for the matching region", () => {
    registerPanel({
      id: "left-panel",
      label: "Left",
      region: "left",
      order: 0,
      component: PanelA,
    });
    registerPanel({
      id: "right-panel",
      label: "Right",
      region: "right",
      order: 0,
      component: PanelB,
    });

    render(() => <TabRegion region="left" />);
    expect(screen.getByText("Left")).toBeTruthy();
    expect(screen.queryByText("Right")).toBeNull();
  });

  it("has tablist role", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "right",
      order: 0,
      component: PanelA,
    });

    render(() => <TabRegion region="right" />);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Create SchemaPanel test**

Create `frontend/src/panels/__tests__/SchemaPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SchemaPanel } from "../SchemaPanel";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";
import type { PropertySchema } from "../schema/types";

const testSchema: PropertySchema = {
  sections: [
    {
      name: "Transform",
      fields: [
        { key: "transform.x", label: "X", type: "number", step: 1 },
        { key: "transform.y", label: "Y", type: "number", step: 1 },
      ],
    },
    {
      name: "Rectangle Only",
      when: "rectangle",
      fields: [
        { key: "kind.corner_radii.0", label: "TL", type: "number" },
      ],
    },
  ],
};

function createMockStore(
  selectedId: string | null = null,
  nodes: Record<string, unknown> = {},
): DocumentStoreAPI {
  const [selectedNodeId] = createSignal(selectedId);
  const [activeTool] = createSignal<ToolType>("select");

  return {
    state: { info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false }, pages: [], nodes },
    selectedNodeId,
    setSelectedNodeId: vi.fn(),
    activeTool,
    setActiveTool: vi.fn(),
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(),
    connected: () => true,
    canUndo: () => false,
    canRedo: () => false,
    createNode: vi.fn(() => ""),
    setTransform: vi.fn(),
    renameNode: vi.fn(),
    deleteNode: vi.fn(),
    setVisible: vi.fn(),
    setLocked: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    destroy: vi.fn(),
  } as DocumentStoreAPI;
}

describe("SchemaPanel", () => {
  it("shows empty state when no node selected", () => {
    const store = createMockStore(null);
    render(() => (
      <DocumentProvider store={store}>
        <SchemaPanel schema={testSchema} />
      </DocumentProvider>
    ));
    expect(screen.getByText(/Select a layer/)).toBeTruthy();
  });

  it("renders section headings when node is selected", () => {
    const node = {
      id: { index: 0, generation: 0 },
      uuid: "test-uuid",
      kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
      name: "Test",
      parent: null,
      children: [],
      transform: { x: 10, y: 20, width: 100, height: 50, rotation: 0, scale_x: 1, scale_y: 1 },
      style: { fills: [], strokes: [], opacity: { type: "literal", value: 1 }, blend_mode: "normal", effects: [] },
      constraints: { horizontal: "start", vertical: "start" },
      grid_placement: null,
      visible: true,
      locked: false,
    };
    const store = createMockStore("test-uuid", { "test-uuid": node });
    render(() => (
      <DocumentProvider store={store}>
        <SchemaPanel schema={testSchema} />
      </DocumentProvider>
    ));
    expect(screen.getByText("Transform")).toBeTruthy();
    expect(screen.getByText("Rectangle Only")).toBeTruthy();
  });

  it("hides sections with non-matching when guard", () => {
    const node = {
      id: { index: 0, generation: 0 },
      uuid: "test-uuid",
      kind: { type: "frame", layout: null },
      name: "Test Frame",
      parent: null,
      children: [],
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
      style: { fills: [], strokes: [], opacity: { type: "literal", value: 1 }, blend_mode: "normal", effects: [] },
      constraints: { horizontal: "start", vertical: "start" },
      grid_placement: null,
      visible: true,
      locked: false,
    };
    const store = createMockStore("test-uuid", { "test-uuid": node });
    render(() => (
      <DocumentProvider store={store}>
        <SchemaPanel schema={testSchema} />
      </DocumentProvider>
    ));
    expect(screen.getByText("Transform")).toBeTruthy();
    expect(screen.queryByText("Rectangle Only")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --prefix frontend test
```

Expected: All tests pass (including new ones).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/__tests__/
git commit -m "test(frontend): add TabRegion and SchemaPanel tests (Plan 08b, Task 6)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run lint**

```bash
pnpm --prefix frontend lint
```

- [ ] **Step 2: Run format**

```bash
pnpm --prefix frontend format
```

- [ ] **Step 3: Run tests**

```bash
pnpm --prefix frontend test
```

- [ ] **Step 4: Run build**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 5: Commit if any fixes**

```bash
git add -A
git commit -m "chore(frontend): lint and format fixes (Plan 08b, Task 7)"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Schema type definitions | `panels/schema/types.ts` |
| 2 | TabRegion + panel registry | `panels/TabRegion.tsx`, `panels/registry.ts` |
| 3 | SchemaPanel + SchemaSection + FieldRenderer | `panels/SchemaPanel.tsx`, `SchemaSection.tsx`, `FieldRenderer.tsx` |
| 4 | DesignPanel + placeholder panels | `panels/DesignPanel.tsx`, `schemas/design-schema.ts`, 4 placeholders |
| 5 | Register panels + wire into App.tsx | `panels/register-panels.ts`, `App.tsx` |
| 6 | Tests | TabRegion + SchemaPanel tests |
| 7 | Final verification | Lint, format, build |

After this plan, selecting a node shows the Design tab with editable transform properties (X, Y, W, H, rotation) plus name/visible/locked fields. The panel system is ready for Spec 09 (fill/stroke/effect editing) and Spec 10 (layers/pages content).
