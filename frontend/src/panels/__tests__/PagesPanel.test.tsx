/**
 * Tests for the PagesPanel component (RF-005).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { PagesPanel } from "../PagesPanel";
import { DocumentProvider } from "../../store/document-context";
import { AnnounceProvider } from "../../shell/AnnounceProvider";
import { createTestI18n } from "../../test-utils/i18n";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";
import type { Page } from "../../types/document";

let i18nInstance: i18n;

beforeAll(async () => {
  i18nInstance = await createTestI18n();
});

// ── Mock dnd-kit-solid ───────────────────────────────────────────────────────
// PagesPanel uses useDragDropMonitor; PageListItem uses useDraggable / useDroppable.
// Replace all three with no-ops that satisfy the API expected by the components.

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

// ── Page fixtures ─────────────────────────────────────────────────────────────

function makePage(id: string, name: string): Page {
  return { id, name, root_nodes: [] };
}

// ── Mock store factory ────────────────────────────────────────────────────────

function createMockStore(
  pages: Page[] = [],
  activeId: string | null = null,
  overrides: Partial<DocumentStoreAPI> = {},
): DocumentStoreAPI {
  const [activeTool] = createSignal<ToolType>("select");
  const [selectedNodeId] = createSignal<string | null>(null);

  return {
    state: {
      info: { name: "", page_count: pages.length, node_count: 0, can_undo: false, can_redo: false },
      pages,
      nodes: {},
      tokens: {},
    },
    selectedNodeId,
    setSelectedNodeId: vi.fn(),
    selectedNodeIds: () => [],
    isNodeSelected: () => false,
    setSelectedNodeIds: vi.fn(),
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
    reparentNode: vi.fn(),
    reorderChildren: vi.fn(),
    setOpacity: vi.fn(),
    setBlendMode: vi.fn(),
    setFills: vi.fn(),
    setStrokes: vi.fn(),
    setEffects: vi.fn(),
    setCornerRadii: vi.fn(),
    setTextContent: vi.fn(),
    setTextStyle: vi.fn(),
    batchSetTransform: vi.fn(),
    groupNodes: vi.fn(),
    ungroupNodes: vi.fn(),
    createPage: vi.fn(),
    deletePage: vi.fn(),
    renamePage: vi.fn(),
    reorderPages: vi.fn(),
    setActivePage: vi.fn(),
    activePageId: () => activeId,
    undo: vi.fn(),
    redo: vi.fn(),
    flushHistory: vi.fn(),
    createToken: vi.fn(),
    updateToken: vi.fn(),
    deleteToken: vi.fn(),
    resolveToken: () => null,
    destroy: vi.fn(),
    ...overrides,
  } as DocumentStoreAPI;
}

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPanel(store: DocumentStoreAPI) {
  const announce = vi.fn();
  return {
    announce,
    ...render(() => (
      <TransProvider instance={i18nInstance}>
        <AnnounceProvider announce={announce}>
          <DocumentProvider store={store}>
            <PagesPanel />
          </DocumentProvider>
        </AnnounceProvider>
      </TransProvider>
    )),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PagesPanel", () => {
  afterEach(() => {
    cleanup();
  });

  // ── 1. Renders page list with correct item count ───────────────────────────

  it("should render all pages as list items", () => {
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2"), makePage("p3", "Page 3")];
    const store = createMockStore(pages);
    renderPanel(store);

    const items = document.querySelectorAll("[role='option']");
    expect(items.length).toBe(3);
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect(screen.getByText("Page 3")).toBeTruthy();
  });

  it("should render an empty state when there are no pages", () => {
    const store = createMockStore([]);
    renderPanel(store);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("No pages")).toBeTruthy();
  });

  // ── 2. Active page has aria-selected="true" ────────────────────────────────

  it("should mark the active page with aria-selected=true", () => {
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p2");
    renderPanel(store);

    const allOptions = document.querySelectorAll("[role='option']");
    const p1 = Array.from(allOptions).find(
      (el) => el.getAttribute("data-page-id") === "p1",
    ) as HTMLElement;
    const p2 = Array.from(allOptions).find(
      (el) => el.getAttribute("data-page-id") === "p2",
    ) as HTMLElement;

    expect(p1.getAttribute("aria-selected")).toBe("false");
    expect(p2.getAttribute("aria-selected")).toBe("true");
  });

  it("should not mark any page as active when activePageId is null", () => {
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, null);
    renderPanel(store);

    const allOptions = document.querySelectorAll("[role='option']");
    for (const el of allOptions) {
      expect(el.getAttribute("aria-selected")).toBe("false");
    }
  });

  // ── 3. Click on a page calls setActivePage ─────────────────────────────────

  it("should call setActivePage with the page id when a page is clicked", () => {
    const setActivePage = vi.fn();
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p1", { setActivePage });
    renderPanel(store);

    const p2Option = document.querySelector('[data-page-id="p2"]') as HTMLElement;
    fireEvent.click(p2Option);

    expect(setActivePage).toHaveBeenCalledWith("p2");
  });

  it("should call setActivePage with the correct page id for each page", () => {
    const setActivePage = vi.fn();
    const pages = [makePage("a", "Alpha"), makePage("b", "Beta")];
    const store = createMockStore(pages, null, { setActivePage });
    renderPanel(store);

    const alphaOption = document.querySelector('[data-page-id="a"]') as HTMLElement;
    fireEvent.click(alphaOption);
    expect(setActivePage).toHaveBeenCalledWith("a");
  });

  // ── 4. Add page button calls createPage ───────────────────────────────────

  it("should call createPage when the Add page button is clicked", () => {
    const createPage = vi.fn();
    const store = createMockStore([], null, { createPage });
    renderPanel(store);

    const addButton = screen.getByRole("button", { name: "Add page" });
    fireEvent.click(addButton);

    expect(createPage).toHaveBeenCalledOnce();
  });

  it("should create page with name 'Page 1' when no pages exist", () => {
    const createPage = vi.fn();
    const store = createMockStore([], null, { createPage });
    renderPanel(store);

    fireEvent.click(screen.getByRole("button", { name: "Add page" }));

    expect(createPage).toHaveBeenCalledWith("Page 1");
  });

  it("should create page with incremented number when pages already exist", () => {
    const createPage = vi.fn();
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, null, { createPage });
    renderPanel(store);

    fireEvent.click(screen.getByRole("button", { name: "Add page" }));

    expect(createPage).toHaveBeenCalledWith("Page 3");
  });

  // ── 5. Delete key calls deletePage ────────────────────────────────────────

  it("should call deletePage when Delete key is pressed on a focused page item", () => {
    const deletePage = vi.fn();
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p1", { deletePage });
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    // Use listbox keydown — PagesPanel handles Delete at the listbox level.
    fireEvent.keyDown(listbox, { key: "Delete" });

    expect(deletePage).toHaveBeenCalledWith("p1");
  });

  // ── 6. Cannot delete when only 1 page ─────────────────────────────────────

  it("should not call deletePage when only 1 page exists and Delete is pressed", () => {
    const deletePage = vi.fn();
    const pages = [makePage("p1", "Page 1")];
    const store = createMockStore(pages, "p1", { deletePage });
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "Delete" });

    expect(deletePage).not.toHaveBeenCalled();
  });

  it("should announce 'Cannot delete the last page' when Delete is pressed with 1 page", () => {
    const deletePage = vi.fn();
    const pages = [makePage("p1", "Page 1")];
    const store = createMockStore(pages, "p1", { deletePage });
    const { announce } = renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "Delete" });

    expect(announce).toHaveBeenCalledWith("Cannot delete the last page");
  });

  // ── 7. ArrowDown moves focus to next page ─────────────────────────────────

  it("should update the focused page id when ArrowDown is pressed", () => {
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p1");
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });

    // After ArrowDown, p2's option should receive tabindex=0 (roving tabindex).
    const p2Option = document.querySelector('[data-page-id="p2"]') as HTMLElement;
    expect(p2Option.getAttribute("tabindex")).toBe("0");
  });

  it("should not move past the last page when ArrowDown is pressed at end of list", () => {
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p1");
    renderPanel(store);

    // Start at p1 (index 0), press ArrowDown twice: should stop at p2 (index 1).
    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });

    const p2Option = document.querySelector('[data-page-id="p2"]') as HTMLElement;
    expect(p2Option.getAttribute("tabindex")).toBe("0");
    const p1Option = document.querySelector('[data-page-id="p1"]') as HTMLElement;
    expect(p1Option.getAttribute("tabindex")).toBe("-1");
  });

  // ── 8. Alt+ArrowDown calls reorderPages ───────────────────────────────────

  it("should call reorderPages when Alt+ArrowDown is pressed on a focused page", () => {
    const reorderPages = vi.fn();
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p1", { reorderPages });
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "ArrowDown", altKey: true });

    expect(reorderPages).toHaveBeenCalledWith("p1", 1);
  });

  it("should not call reorderPages when Alt+ArrowDown is pressed on the last page", () => {
    const reorderPages = vi.fn();
    // Focus starts on p1 (first page). Press ArrowDown to move to p2 (last), then Alt+ArrowDown.
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p2", { reorderPages });
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    // p2 is the active page — the component initialises focusedPageId to pages[0] initially.
    // We need to move focus to p2 first, then attempt Alt+ArrowDown.
    fireEvent.keyDown(listbox, { key: "ArrowDown" }); // focus moves to p2
    fireEvent.keyDown(listbox, { key: "ArrowDown", altKey: true }); // should no-op

    expect(reorderPages).not.toHaveBeenCalled();
  });

  // ── 9. F2 triggers rename mode ────────────────────────────────────────────

  it("should show a rename input when F2 is pressed on a focused page", () => {
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p1");
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "F2" });

    // The rename input should appear for the focused page (p1).
    const renameInput = document.querySelector(
      '[aria-label="Rename Page 1"]',
    ) as HTMLInputElement | null;
    expect(renameInput).toBeTruthy();
  });

  it("should not show a rename input when F2 is pressed with no pages", () => {
    const store = createMockStore([]);
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "F2" });

    // No rename input should appear.
    const renameInput = document.querySelector('input[aria-label^="Rename"]');
    expect(renameInput).toBeNull();
  });

  // ── 10. Enter commits rename and calls renamePage ─────────────────────────

  it("should call renamePage when Enter is pressed after editing the name input", () => {
    const renamePage = vi.fn();
    const pages = [makePage("p1", "Page 1"), makePage("p2", "Page 2")];
    const store = createMockStore(pages, "p1", { renamePage });
    renderPanel(store);

    // Trigger rename mode via F2 on the focused page (p1 is focused by default).
    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "F2" });

    const renameInput = document.querySelector(
      '[aria-label="Rename Page 1"]',
    ) as HTMLInputElement | null;
    expect(renameInput).toBeTruthy();
    if (!renameInput) return;

    // Type a new name into the input and press Enter.
    fireEvent.input(renameInput, { target: { value: "Landing Page" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    expect(renamePage).toHaveBeenCalledWith("p1", "Landing Page");
  });

  it("should not call renamePage when Enter is pressed with unchanged name", () => {
    const renamePage = vi.fn();
    const pages = [makePage("p1", "Page 1")];
    const store = createMockStore(pages, "p1", { renamePage });
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "F2" });

    const renameInput = document.querySelector(
      '[aria-label="Rename Page 1"]',
    ) as HTMLInputElement | null;
    if (!renameInput) return;

    // Press Enter without changing the value — name is still "Page 1".
    fireEvent.keyDown(renameInput, { key: "Enter" });

    expect(renamePage).not.toHaveBeenCalled();
  });

  it("should dismiss the rename input when Escape is pressed without calling renamePage", () => {
    const renamePage = vi.fn();
    const pages = [makePage("p1", "Page 1")];
    const store = createMockStore(pages, "p1", { renamePage });
    renderPanel(store);

    const listbox = screen.getByRole("listbox", { name: "Page list" });
    fireEvent.keyDown(listbox, { key: "F2" });

    const renameInput = document.querySelector(
      '[aria-label="Rename Page 1"]',
    ) as HTMLInputElement | null;
    expect(renameInput).toBeTruthy();
    if (!renameInput) return;

    fireEvent.input(renameInput, { target: { value: "New Name" } });
    fireEvent.keyDown(renameInput, { key: "Escape" });

    expect(renamePage).not.toHaveBeenCalled();
    // Input should be gone after Escape.
    expect(document.querySelector('[aria-label="Rename Page 1"]')).toBeNull();
  });

  // ── Panel structure and ARIA ───────────────────────────────────────────────

  it("should render the panel with ARIA region and label", () => {
    const store = createMockStore([]);
    renderPanel(store);

    expect(screen.getByRole("region", { name: "Pages" })).toBeTruthy();
  });

  it("should render a listbox with the label 'Page list'", () => {
    const store = createMockStore([]);
    renderPanel(store);

    expect(screen.getByRole("listbox", { name: "Page list" })).toBeTruthy();
  });

  it("should render the Add page button with an accessible label", () => {
    const store = createMockStore([]);
    renderPanel(store);

    expect(screen.getByRole("button", { name: "Add page" })).toBeTruthy();
  });
});
