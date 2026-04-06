/**
 * Tests for the TreeNode component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { TreeNode } from "../TreeNode";
import { DocumentProvider } from "../../store/document-context";
import { AnnounceProvider } from "../../shell/AnnounceProvider";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";
import type { DocumentNode } from "../../types/document";

// ── Mock dnd-kit-solid ───────────────────────────────────────────────────────
// TreeNode uses useDraggable and useDroppable from dnd-kit-solid.
// In jsdom there is no real DnD context, so we replace the hooks with no-ops
// that return the signals the component expects.

vi.mock("dnd-kit-solid", () => ({
  useDraggable: () => ({
    isDragging: () => false,
    isDropping: () => false,
    isDragSource: () => false,
    handleRef: vi.fn(),
    ref: vi.fn(),
    draggable: {},
  }),
  useDroppable: () => ({
    isDropTarget: () => false,
    ref: vi.fn(),
    droppable: {},
  }),
  useDragDropMonitor: vi.fn(),
  DragDropProvider: (props: { children: unknown }) => props.children,
}));

// ── Helper types ─────────────────────────────────────────────────────────────

type MutableDocumentNode = DocumentNode & {
  parentUuid: string | null;
  childrenUuids: readonly string[];
};

// ── Mock store factory ────────────────────────────────────────────────────────

function createMockStore(overrides?: Partial<DocumentStoreAPI>): DocumentStoreAPI {
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
      pages: [],
      nodes: {},
    },
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds: () => {
      const id = selectedNodeId();
      return id ? [id] : [];
    },
    setSelectedNodeIds: vi.fn(),
    activeTool,
    setActiveTool,
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
    reparentNode: vi.fn(),
    reorderChildren: vi.fn(),
    setOpacity: vi.fn(),
    setBlendMode: vi.fn(),
    setFills: vi.fn(),
    setStrokes: vi.fn(),
    setEffects: vi.fn(),
    setCornerRadii: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  } as DocumentStoreAPI;
}

// ── Sample node fixture ───────────────────────────────────────────────────────

function makeNode(overrides?: Partial<MutableDocumentNode>): MutableDocumentNode {
  return {
    id: { index: 0, generation: 0 },
    uuid: "11111111-1111-1111-1111-111111111111",
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: "Rectangle 1",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
    parentUuid: null,
    childrenUuids: [],
    ...overrides,
  };
}

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderTreeNodeOptions {
  node?: MutableDocumentNode;
  depth?: number;
  isExpanded?: boolean;
  hasChildren?: boolean;
  store?: DocumentStoreAPI;
}

function renderTreeNode({
  node = makeNode(),
  depth = 0,
  isExpanded = false,
  hasChildren = false,
  store = createMockStore(),
}: RenderTreeNodeOptions = {}) {
  const onToggleExpand = vi.fn();
  const announce = vi.fn();

  return {
    onToggleExpand,
    announce,
    store,
    ...render(() => (
      <DocumentProvider store={store}>
        <AnnounceProvider announce={announce}>
          <TreeNode
            node={node}
            depth={depth}
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
            hasChildren={hasChildren}
          />
        </AnnounceProvider>
      </DocumentProvider>
    )),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TreeNode", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render the node name", () => {
    const node = makeNode({ name: "My Rectangle" });
    renderTreeNode({ node });
    expect(screen.getByText("My Rectangle")).toBeTruthy();
  });

  it("should show selected style when selectedNodeId matches node uuid", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    const node = makeNode({ uuid });
    const store = createMockStore();
    store.setSelectedNodeId(uuid);

    renderTreeNode({ node, store });

    const treeItem = screen.getByRole("treeitem");
    expect(treeItem.classList.contains("sigil-tree-node--selected")).toBe(true);
  });

  it("should not show selected style when a different node is selected", () => {
    const node = makeNode({ uuid: "11111111-1111-1111-1111-111111111111" });
    const store = createMockStore();
    store.setSelectedNodeId("22222222-2222-2222-2222-222222222222");

    renderTreeNode({ node, store });

    const treeItem = screen.getByRole("treeitem");
    expect(treeItem.classList.contains("sigil-tree-node--selected")).toBe(false);
  });

  it("should apply hidden style when node.visible is false", () => {
    const node = makeNode({ visible: false });
    renderTreeNode({ node });

    const treeItem = screen.getByRole("treeitem");
    expect(treeItem.classList.contains("sigil-tree-node--hidden")).toBe(true);
  });

  it("should not apply hidden style when node.visible is true", () => {
    const node = makeNode({ visible: true });
    renderTreeNode({ node });

    const treeItem = screen.getByRole("treeitem");
    expect(treeItem.classList.contains("sigil-tree-node--hidden")).toBe(false);
  });

  it("should call setSelectedNodeId with the node uuid when clicked", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    const node = makeNode({ uuid });
    const setSelectedNodeId = vi.fn();
    const store = createMockStore({ setSelectedNodeId });

    renderTreeNode({ node, store });

    fireEvent.click(screen.getByRole("treeitem"));
    expect(setSelectedNodeId).toHaveBeenCalledWith(uuid);
  });

  it("should call setVisible when the visibility toggle button is clicked", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    const node = makeNode({ uuid, visible: true });
    const setVisible = vi.fn();
    const store = createMockStore({ setVisible });

    renderTreeNode({ node, store });

    const hideBtn = screen.getByLabelText("Hide");
    fireEvent.click(hideBtn);
    expect(setVisible).toHaveBeenCalledWith(uuid, false);
  });

  it("should call setVisible with true when node is hidden and toggle is clicked", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    const node = makeNode({ uuid, visible: false });
    const setVisible = vi.fn();
    const store = createMockStore({ setVisible });

    renderTreeNode({ node, store });

    const showBtn = screen.getByLabelText("Show");
    fireEvent.click(showBtn);
    expect(setVisible).toHaveBeenCalledWith(uuid, true);
  });

  it("should call setLocked when the lock toggle button is clicked", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    const node = makeNode({ uuid, locked: false });
    const setLocked = vi.fn();
    const store = createMockStore({ setLocked });

    renderTreeNode({ node, store });

    const lockBtn = screen.getByLabelText("Lock");
    fireEvent.click(lockBtn);
    expect(setLocked).toHaveBeenCalledWith(uuid, true);
  });

  it("should call setLocked with false when node is locked and toggle is clicked", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    const node = makeNode({ uuid, locked: true });
    const setLocked = vi.fn();
    const store = createMockStore({ setLocked });

    renderTreeNode({ node, store });

    const unlockBtn = screen.getByLabelText("Unlock");
    fireEvent.click(unlockBtn);
    expect(setLocked).toHaveBeenCalledWith(uuid, false);
  });

  it("should have role treeitem with aria-level equal to depth + 1", () => {
    const node = makeNode();
    renderTreeNode({ node, depth: 2 });

    const treeItem = screen.getByRole("treeitem");
    expect(treeItem.getAttribute("aria-level")).toBe("3");
  });

  it("should have aria-level 1 at depth 0", () => {
    const node = makeNode();
    renderTreeNode({ node, depth: 0 });

    const treeItem = screen.getByRole("treeitem");
    expect(treeItem.getAttribute("aria-level")).toBe("1");
  });

  it("should show expand button when hasChildren is true", () => {
    const node = makeNode();
    renderTreeNode({ node, hasChildren: true, isExpanded: false });

    const expandBtn = screen.getByLabelText("Expand");
    expect(expandBtn).toBeTruthy();
  });

  it("should show collapse label when hasChildren is true and isExpanded is true", () => {
    const node = makeNode();
    renderTreeNode({ node, hasChildren: true, isExpanded: true });

    const collapseBtn = screen.getByLabelText("Collapse");
    expect(collapseBtn).toBeTruthy();
  });

  it("should call onToggleExpand when expand button is clicked", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    const node = makeNode({ uuid });
    const onToggleExpand = vi.fn();

    const announce = vi.fn();
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <AnnounceProvider announce={announce}>
          <TreeNode
            node={node}
            depth={0}
            isExpanded={false}
            onToggleExpand={onToggleExpand}
            hasChildren={true}
          />
        </AnnounceProvider>
      </DocumentProvider>
    ));

    const expandBtn = screen.getByLabelText("Expand");
    fireEvent.click(expandBtn);
    expect(onToggleExpand).toHaveBeenCalledWith(uuid);
  });

  it("should announce node selection when clicked", () => {
    const node = makeNode({ name: "Frame 1" });
    const announce = vi.fn();
    const store = createMockStore();

    render(() => (
      <DocumentProvider store={store}>
        <AnnounceProvider announce={announce}>
          <TreeNode
            node={node}
            depth={0}
            isExpanded={false}
            onToggleExpand={vi.fn()}
            hasChildren={false}
          />
        </AnnounceProvider>
      </DocumentProvider>
    ));

    fireEvent.click(screen.getByRole("treeitem"));
    expect(announce).toHaveBeenCalledWith("Frame 1 selected");
  });
});
