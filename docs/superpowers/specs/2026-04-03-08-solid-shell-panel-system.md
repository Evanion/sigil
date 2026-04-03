# Spec 08: Solid Shell Migration + Panel System

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

Migrate the frontend editor shell from vanilla TypeScript DOM construction to Solid.js, replace the manual pub/sub document store with `@urql/solid` + Solid signals, and introduce a schema-driven panel system with Figma-style tabbed regions.

This is the foundation for all subsequent frontend feature work (properties panel, layers panel, pages panel, canvas interactions). Nothing beyond the panel *system* ships in this spec — individual panel content (properties, layers, etc.) is deferred to Specs 09–10.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Panel rendering | Schema-driven | TypeScript schemas define fields → generic renderer produces UI. Adding a property means adding a schema entry, not writing a component. |
| Panel layout | Figma-style tabbed regions | Left region (Layers, Pages tabs), Right region (Design, Inspect tabs + contextual tabs). Matches user expectations from Figma/Penpot. |
| Store architecture | Full Solid migration | Replace manual pub/sub + urql vanilla with `@urql/solid` + `createStore`/`createSignal`. One reactivity system, no bridge layer. |
| GraphQL client | `@urql/solid` | Existing urql operations stay, just swap to Solid-native bindings (`createQuery`, `createMutation`, `createSubscription`). |
| Canvas integration | Solid effect trigger | Canvas rendering stays imperative. A `createEffect` reads Solid signals and calls `renderer.render()`. Guarantees no stale renders — if a signal changed, the canvas re-draws. |

## Architecture

### Component Tree

```
<App>
├── <Toolbar />              # Tool buttons, logo
├── <TabRegion region="left">
│   ├── Tab: "Layers"  →  <LayersPanel />     (Spec 10, placeholder here)
│   └── Tab: "Pages"   →  <PagesPanel />      (Spec 10, placeholder here)
├── <Canvas />                # Imperative canvas wrapped in Solid component
├── <TabRegion region="right">
│   ├── Tab: "Design"  →  <SchemaPanel />      (Spec 09 populates, scaffold here)
│   ├── Tab: "Inspect"  → <InspectPanel />     (future, placeholder here)
│   └── Tab: "Component" → <ComponentPanel />  (contextual, visible when component selected)
└── <StatusBar />             # Connection, doc info, zoom
```

### Data Flow

```
                    ┌──────────────┐
                    │  GraphQL API │
                    └──────┬───────┘
                           │ @urql/solid
                    ┌──────▼───────┐
                    │ Solid Store  │  createStore() for document state
                    │              │  createSignal() for UI state
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
        <TabRegion>    <Canvas>    <StatusBar>
              │            │
              ▼            ▼
        <SchemaPanel>  createEffect →
              │        renderer.render()
              ▼
        Field editors
        (NumberInput, ColorPicker, Select, etc.)
```

## Document Store (Solid)

### State Shape

```typescript
// Document state — populated from GraphQL
const [documentState, setDocumentState] = createStore<DocumentState>({
  info: { name: "", pageCount: 0, nodeCount: 0, canUndo: false, canRedo: false },
  pages: [],
  // Plain object instead of Map — Solid's createStore tracks property access
  // on plain objects but not on Map/Set. Use Record<uuid, DocumentNode>.
  nodes: {} as Record<string, DocumentNode>,
});

// UI state — local only
const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
const [activeTool, setActiveTool] = createSignal<ToolType>("select");
const [viewport, setViewport] = createSignal<Viewport>({ x: 0, y: 0, zoom: 1 });
const [connected, setConnected] = createSignal(false);
```

### GraphQL Integration

```typescript
// Queries — @urql/solid createQuery
const [pagesResult] = createQuery({ query: PAGES_QUERY });

// Mutations — @urql/solid createMutation
const [, createNode] = createMutation(CREATE_NODE_MUTATION);
const [, setTransform] = createMutation(SET_TRANSFORM_MUTATION);
// ... etc for all mutations

// Subscriptions — @urql/solid createSubscription
createSubscription({ query: DOCUMENT_CHANGED_SUBSCRIPTION }, (prev, data) => {
  // Re-fetch pages on any change (existing pattern)
  refetchPages();
  return data;
});
```

### Store Context

The store is provided via Solid context so any component in the tree can access it:

```typescript
const DocumentContext = createContext<DocumentStore>();

function useDocument() {
  const ctx = useContext(DocumentContext);
  if (!ctx) throw new Error("useDocument must be used within DocumentProvider");
  return ctx;
}
```

## Panel System

### Panel Registration

```typescript
interface PanelRegistration {
  /** Unique panel identifier. */
  id: string;
  /** Tab label shown in the region. */
  label: string;
  /** Which region this panel appears in. */
  region: "left" | "right";
  /** Sort order within the region (lower = first). */
  order: number;
  /** The Solid component to render as the panel body. */
  component: Component;
  /** Reactive predicate — panel tab is hidden when this returns false. */
  visible?: () => boolean;
  /** If true, this panel is selected by default when the region first renders. */
  default?: boolean;
}
```

Panels register at app startup:

```typescript
const panels: PanelRegistration[] = [
  { id: "layers",    label: "Layers",    region: "left",  order: 0, component: LayersPanel, default: true },
  { id: "pages",     label: "Pages",     region: "left",  order: 1, component: PagesPanel },
  { id: "design",    label: "Design",    region: "right", order: 0, component: DesignPanel, default: true },
  { id: "inspect",   label: "Inspect",   region: "right", order: 1, component: InspectPanel },
  { id: "component", label: "Component", region: "right", order: 2, component: ComponentPanel,
    visible: () => {
      const id = selectedNodeId();
      if (!id) return false;
      const node = documentState.nodes.get(id);
      return node?.kind.type === "component_instance";
    },
  },
];
```

### TabRegion Component

```typescript
function TabRegion(props: { region: "left" | "right" }) {
  const visiblePanels = createMemo(() =>
    panels
      .filter(p => p.region === props.region && (p.visible?.() ?? true))
      .sort((a, b) => a.order - b.order)
  );

  const [activeTab, setActiveTab] = createSignal<string>(
    visiblePanels().find(p => p.default)?.id ?? visiblePanels()[0]?.id ?? ""
  );

  const activePanel = createMemo(() =>
    visiblePanels().find(p => p.id === activeTab())
  );

  return (
    <div class="tab-region" role="complementary">
      <div class="tab-bar" role="tablist">
        <For each={visiblePanels()}>
          {(panel) => (
            <button
              role="tab"
              aria-selected={activeTab() === panel.id}
              onClick={() => setActiveTab(panel.id)}
            >
              {panel.label}
            </button>
          )}
        </For>
      </div>
      <div class="tab-content" role="tabpanel">
        <Show when={activePanel()}>
          {(panel) => <Dynamic component={panel().component} />}
        </Show>
      </div>
    </div>
  );
}
```

### Property Schema Types

```typescript
/** A complete property schema for a panel. */
interface PropertySchema {
  sections: SectionDef[];
}

/** A labeled group of fields. */
interface SectionDef {
  /** Section heading (e.g., "Transform", "Fill"). */
  name: string;
  /** Only show this section for specific node kinds. Omit = always show. */
  when?: NodeKindType | NodeKindType[];
  /** Field definitions. Mutually exclusive with `type: "list"`. */
  fields?: FieldDef[];
  /** For list-type sections (fills, strokes, effects). */
  type?: "list";
  /** Dot-path into the node object for list data. */
  key?: string;
  /** Schema for each item in the list. */
  itemSchema?: FieldDef[];
  /** Whether the section starts collapsed. Default: false. */
  collapsed?: boolean;
}

/** A single editable field. */
interface FieldDef {
  /** Dot-path into the node object (e.g., "transform.x", "style.opacity"). */
  key: string;
  /** Display label. */
  label: string;
  /** Field editor type. */
  type: FieldType;
  /** Layout hint — how many grid columns this field spans. Default: 1. */
  span?: 1 | 2;
  /** Additional type-specific options. */
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  options?: Array<{ value: string; label: string }>;
}

type FieldType =
  | "number"    // NumberInput with step, min, max, suffix
  | "slider"    // Range slider with number display
  | "color"     // Color swatch + picker + hex input
  | "select"    // Dropdown with typed options
  | "toggle"    // Boolean on/off
  | "text"      // Text input
  | "corners"   // 4-corner radius editor (linked/unlinked)
  | "list"      // Repeatable items (fills, strokes, effects)
  | "token-ref" // Value input with token binding picker
  ;
```

### SchemaPanel Component

The generic schema-driven panel renderer:

```typescript
function SchemaPanel(props: { schema: () => PropertySchema }) {
  const store = useDocument();
  const selectedNode = createMemo(() => {
    const id = store.selectedNodeId();
    return id ? store.nodes.get(id) : undefined;
  });

  return (
    <div class="schema-panel">
      <Show when={selectedNode()} fallback={<EmptyState />}>
        {(node) => (
          <For each={props.schema().sections}>
            {(section) => (
              <Show when={matchesNodeKind(node(), section.when)}>
                <SchemaSection section={section} node={node()} />
              </Show>
            )}
          </For>
        )}
      </Show>
    </div>
  );
}
```

Each `SchemaSection` renders its fields using a `FieldRenderer` that maps `FieldType` → Solid component (from the existing component library: `NumberInput`, `Select`, `Toggle`, `TextInput`, etc.).

### Field Mutation Flow

When a user edits a field:

```
User types "150" in the Width input
  → FieldRenderer calls onChange("transform.width", 150)
  → SchemaPanel resolves the dot-path to a GraphQL mutation
  → e.g., "transform.width" → setTransform({ uuid, transform: { ...current, width: 150 } })
  → Mutation fires via @urql/solid
  → Subscription event arrives → store updates → canvas re-renders
```

The mutation mapping is defined per field key prefix:

```typescript
const MUTATION_MAP: Record<string, (uuid: string, key: string, value: unknown) => void> = {
  "transform": (uuid, key, value) => {
    const field = key.split(".")[1]; // "x", "y", "width", etc.
    setTransform({ uuid, transform: { ...currentTransform(), [field]: value } });
  },
  "style.opacity": (uuid, _, value) => setOpacity({ uuid, opacity: value as number }),
  "style.fills": (uuid, _, value) => setFills({ uuid, fills: value as Fill[] }),
  "style.blend_mode": (uuid, _, value) => setBlendMode({ uuid, blendMode: value as string }),
  "name": (uuid, _, value) => renameNode({ uuid, newName: value as string }),
  "visible": (uuid, _, value) => setVisible({ uuid, visible: value as boolean }),
  "locked": (uuid, _, value) => setLocked({ uuid, locked: value as boolean }),
};
```

## Canvas Integration

### Canvas Component

```typescript
function Canvas() {
  let canvasRef: HTMLCanvasElement;
  const store = useDocument();

  // Imperative setup
  onMount(() => {
    const ctx = canvasRef.getContext("2d")!;
    const renderer = new Renderer();
    const toolManager = new ToolManager(store);

    // Pointer events → tool manager (unchanged from today)
    canvasRef.addEventListener("pointerdown", (e) => toolManager.onPointerDown(e));
    canvasRef.addEventListener("pointermove", (e) => toolManager.onPointerMove(e));
    canvasRef.addEventListener("pointerup", (e) => toolManager.onPointerUp(e));

    // ResizeObserver for canvas sizing
    const observer = new ResizeObserver(([entry]) => {
      canvasRef.width = entry.contentRect.width * devicePixelRatio;
      canvasRef.height = entry.contentRect.height * devicePixelRatio;
    });
    observer.observe(canvasRef);

    // THE KEY: createEffect reads signals → triggers render
    createEffect(() => {
      const nodes = store.documentState.nodes;     // tracked
      const pages = store.documentState.pages;     // tracked
      const selected = store.selectedNodeId();     // tracked
      const vp = store.viewport();                 // tracked
      const tool = store.activeTool();             // tracked
      const previewTransform = toolManager.previewTransform();
      const previewRect = toolManager.previewRect();

      renderer.render(ctx, canvasRef, {
        nodes, pages, selected, viewport: vp,
        previewTransform, previewRect,
      });
    });

    onCleanup(() => observer.disconnect());
  });

  return (
    <canvas
      ref={canvasRef!}
      role="main"
      aria-label="Design canvas"
      tabindex={0}
    />
  );
}
```

The `createEffect` reads all state that affects rendering. If any signal changes, Solid re-runs the effect and the canvas re-renders. No stale state possible — the dependency tracking is automatic.

## Shell Layout

### CSS Grid

```css
.app-shell {
  display: grid;
  grid-template-columns: 48px 240px 1fr 280px;
  grid-template-rows: 1fr auto;
  height: 100vh;
}

.toolbar      { grid-row: 1 / -1; }
.left-region  { grid-row: 1; }
.canvas       { grid-row: 1; }
.right-region { grid-row: 1; }
.status-bar   { grid-column: 2 / -1; grid-row: 2; }
```

Same layout as today — toolbar (48px) | left panel (240px) | canvas (1fr) | right panel (280px) | status bar across bottom.

## Accessibility

All existing accessibility features are preserved and enhanced:

- `role="toolbar"` on toolbar with roving tabindex (existing)
- `role="tablist"` / `role="tab"` / `role="tabpanel"` on tab regions (new)
- `role="main"` on canvas with `aria-label` (existing)
- `role="complementary"` on panel regions (existing)
- `role="status"` on status bar with `aria-live` (existing)
- `aria-selected` on active tab (new)
- Keyboard navigation: Arrow keys between tabs, Enter/Space to activate (new)
- Focus management: tab content receives focus when activated (new)

## Migration Strategy

The migration is incremental — the app remains functional at every step:

1. **Add `@urql/solid` dependency**, keep existing urql setup
2. **Create Solid app root** — `<App>` component with the grid layout, render via `render()` from `solid-js/web`
3. **Migrate document store** — Replace pub/sub with `createStore`/`createSignal`, wrap urql operations with `@urql/solid` hooks
4. **Migrate toolbar** — Solid component consuming `activeTool` signal
5. **Create TabRegion + panel registry** — Generic tab system with placeholder panels
6. **Migrate canvas** — Wrap in Solid component with `createEffect` trigger
7. **Migrate status bar** — Solid component consuming store signals
8. **Delete vanilla shell** — Remove `app-shell.ts` and manual DOM code
9. **Add SchemaPanel scaffold** — Generic renderer with field type mapping (empty schemas — content in Spec 09)

## File Structure

### New files

```
frontend/src/
├── App.tsx                        # Root Solid component
├── store/
│   ├── document-store.tsx         # Solid store + @urql/solid integration
│   └── document-context.tsx       # createContext + useDocument hook
├── shell/
│   ├── Toolbar.tsx                # Tool buttons (migrated from vanilla)
│   ├── TabRegion.tsx              # Generic tabbed region
│   ├── StatusBar.tsx              # Connection + doc info + zoom
│   └── Canvas.tsx                 # Canvas wrapper with createEffect
├── panels/
│   ├── registry.ts                # Panel registration definitions
│   ├── SchemaPanel.tsx            # Generic schema-driven renderer
│   ├── SchemaSection.tsx          # Section renderer (fields or list)
│   ├── FieldRenderer.tsx          # Maps FieldType → component
│   ├── schema/
│   │   └── types.ts               # PropertySchema, SectionDef, FieldDef types
│   ├── DesignPanel.tsx            # Placeholder (populated in Spec 09)
│   ├── LayersPanel.tsx            # Placeholder (populated in Spec 10)
│   ├── PagesPanel.tsx             # Placeholder (populated in Spec 10)
│   ├── InspectPanel.tsx           # Placeholder (future)
│   └── ComponentPanel.tsx         # Placeholder (future)
├── canvas/
│   ├── renderer.ts                # Unchanged — imperative drawing
│   ├── hit-test.ts                # Unchanged
│   └── viewport.ts                # Extracted viewport math
├── tools/
│   ├── tool-manager.ts            # Mostly unchanged, signals for preview state
│   ├── select-tool.ts             # Unchanged internals
│   └── shape-tool.ts              # Unchanged internals
└── graphql/
    └── operations.ts              # Unchanged — query/mutation/subscription strings
```

### Deleted files

```
frontend/src/shell/app-shell.ts    # Replaced by App.tsx + Solid components
frontend/src/store/document-store.ts  # Replaced by Solid store
```

### Modified files

```
frontend/src/main.ts               # render(<App />) instead of createAppShell()
frontend/src/tools/tool-manager.ts  # Use signals for previewTransform/previewRect
```

## Depends On

- Spec 00 (Toolchain)
- Spec 04 (Frontend Editor — canvas, tools, renderer)
- Spec 07 (Component Library — UI components used by panel system)

## Depended On By

- Spec 09 (Properties Panel — populates the Design tab schema)
- Spec 10 (Layers + Pages Panels — populates left region tabs)
- Spec 11 (Canvas Interactions — multi-select, resize)
- All future frontend feature specs

## WASM Compatibility

Not applicable — this spec only modifies `frontend/` (TypeScript). No core crate changes.

## Input Validation

- Schema field definitions are compile-time TypeScript types — no runtime validation needed.
- Panel visibility predicates are pure functions of document state signals — no external input.
- Field mutations go through existing GraphQL mutations which validate server-side.
- The `MUTATION_MAP` resolves dot-paths at registration time — invalid paths are caught by TypeScript's type system.

## PDR Traceability

**Implements:**
- PDR "Frontend is web-based with a canvas editor" — migrates to Solid.js SPA
- PDR "Real-time state sync" — canvas `createEffect` guarantees state consistency
- PDR "Standard design tool conventions" — Figma-style tabbed panel layout

**Defers:**
- Panel *content* (properties, layers, pages) → Specs 09–10
- Inspect mode → future spec
- Responsive breakpoints → future spec

## Consistency Guarantees

- **No stale canvas renders:** `createEffect` dependency tracking guarantees the canvas re-renders whenever any input signal changes. This is enforced by Solid's reactivity system, not manual wiring.
- **Atomic tab visibility:** Panel visibility predicates are computed inside `createMemo`, which batches signal reads. A panel cannot flicker between visible/hidden during a multi-signal update.
- **Mutation ordering:** Mutations flow through `@urql/solid` → server → subscription → store update. The same single-writer pattern as today; no new concurrency concerns.

## Recursion Safety

No recursive data structures or algorithms are introduced. The `<For>` loop over panels/sections/fields is flat iteration, not recursion. The existing tree traversal in `renderer.ts` (for drawing child nodes) is unchanged.
