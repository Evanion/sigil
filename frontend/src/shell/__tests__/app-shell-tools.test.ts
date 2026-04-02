/**
 * Tests for tool wiring in the app shell — keyboard shortcuts,
 * tool buttons, cursor updates, and pointer event delegation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountAppShell } from "../app-shell";
import type { DocumentStore } from "../../store/document-store";

/** Minimal mock store that satisfies the DocumentStore interface. */
function createMockStore(overrides?: Partial<DocumentStore>): DocumentStore {
  return {
    getInfo: vi.fn().mockReturnValue(null),
    getAllNodes: vi.fn().mockReturnValue(new Map()),
    getNodeByUuid: vi.fn().mockReturnValue(undefined),
    getPages: vi.fn().mockReturnValue([]),
    isConnected: vi.fn().mockReturnValue(false),
    canUndo: vi.fn().mockReturnValue(false),
    canRedo: vi.fn().mockReturnValue(false),
    setTransform: vi.fn(),
    renameNode: vi.fn(),
    deleteNode: vi.fn(),
    setVisible: vi.fn(),
    setLocked: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    getSelectedNodeId: vi.fn().mockReturnValue(null),
    select: vi.fn(),
    getActivePage: vi.fn().mockReturnValue(undefined),
    createNode: vi.fn().mockReturnValue("mock-uuid"),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    loadInitialState: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    ...overrides,
  };
}

/**
 * Stub out canvas getContext and ResizeObserver so the shell can mount
 * without a real browser environment.
 */
function setupDomStubs(): void {
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  class StubResizeObserver {
    observe(): void {
      /* noop */
    }
    unobserve(): void {
      /* noop */
    }
    disconnect(): void {
      /* noop */
    }
  }

  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
}

describe("app-shell tool wiring", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let store: DocumentStore;

  beforeEach(() => {
    setupDomStubs();
    root = document.createElement("div");
    document.body.appendChild(root);
    store = createMockStore();
    cleanup = mountAppShell(root, store);

    return () => {
      cleanup();
      document.body.removeChild(root);
    };
  });

  // ── Tool buttons in toolbar ────────────────────────────────────────

  describe("tool buttons", () => {
    it("should render four tool buttons in the toolbar", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      expect(buttons?.length).toBe(4);
    });

    it("should label buttons V, F, R, O", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const labels = Array.from(buttons ?? []).map((b) => b.textContent);
      expect(labels).toEqual(["V", "F", "R", "O"]);
    });

    it("should highlight the select tool button by default", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const activeButtons = Array.from(buttons ?? []).filter((b) =>
        b.classList.contains("toolbar__tool-btn--active"),
      );
      expect(activeButtons.length).toBe(1);
      expect(activeButtons[0]?.textContent).toBe("V");
    });

    it("should have aria-label attributes on tool buttons", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      for (const btn of Array.from(buttons ?? [])) {
        expect(btn.getAttribute("aria-label")).toBeTruthy();
      }
    });

    it("should have tabindex on tool buttons for keyboard navigation (roving tabindex)", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      // RF-012: Only active button gets tabindex=0, others get -1
      expect(buttons?.[0]?.getAttribute("tabindex")).toBe("0"); // select is active
      for (let i = 1; i < (buttons?.length ?? 0); i++) {
        expect(buttons?.[i]?.getAttribute("tabindex")).toBe("-1");
      }
    });
  });

  // ── Keyboard shortcuts for tool switching ──────────────────────────

  describe("keyboard shortcuts for tool switching", () => {
    it("should switch to frame tool when F is pressed", () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const activeButtons = Array.from(buttons ?? []).filter((b) =>
        b.classList.contains("toolbar__tool-btn--active"),
      );
      expect(activeButtons.length).toBe(1);
      expect(activeButtons[0]?.textContent).toBe("F");
    });

    it("should switch to rectangle tool when R is pressed", () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const activeButtons = Array.from(buttons ?? []).filter((b) =>
        b.classList.contains("toolbar__tool-btn--active"),
      );
      expect(activeButtons.length).toBe(1);
      expect(activeButtons[0]?.textContent).toBe("R");
    });

    it("should switch to ellipse tool when O is pressed", () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "o" }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const activeButtons = Array.from(buttons ?? []).filter((b) =>
        b.classList.contains("toolbar__tool-btn--active"),
      );
      expect(activeButtons.length).toBe(1);
      expect(activeButtons[0]?.textContent).toBe("O");
    });

    it("should switch back to select tool when V is pressed", () => {
      // Switch away first
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
      // Switch back
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "v" }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const activeButtons = Array.from(buttons ?? []).filter((b) =>
        b.classList.contains("toolbar__tool-btn--active"),
      );
      expect(activeButtons.length).toBe(1);
      expect(activeButtons[0]?.textContent).toBe("V");
    });

    it("should not switch tools when modifier keys are held", () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const activeButtons = Array.from(buttons ?? []).filter((b) =>
        b.classList.contains("toolbar__tool-btn--active"),
      );
      expect(activeButtons[0]?.textContent).toBe("V");
    });

    it("should not switch tools when target is an input element", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const activeButtons = Array.from(buttons ?? []).filter((b) =>
        b.classList.contains("toolbar__tool-btn--active"),
      );
      expect(activeButtons[0]?.textContent).toBe("V");

      document.body.removeChild(input);
    });

    it("should not switch tools when target is a textarea element", () => {
      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);
      textarea.focus();

      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      const activeButtons = Array.from(buttons ?? []).filter((b) =>
        b.classList.contains("toolbar__tool-btn--active"),
      );
      expect(activeButtons[0]?.textContent).toBe("V");

      document.body.removeChild(textarea);
    });
  });

  // ── Cursor updates ─────────────────────────────────────────────────

  describe("cursor updates", () => {
    it("should set default cursor for select tool", () => {
      const canvasContainer = root.querySelector(".canvas-container") as HTMLElement;
      expect(canvasContainer.style.cursor).toBe("default");
    });

    it("should set crosshair cursor for shape tools", () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));

      const canvasContainer = root.querySelector(".canvas-container") as HTMLElement;
      expect(canvasContainer.style.cursor).toBe("crosshair");
    });
  });
});
