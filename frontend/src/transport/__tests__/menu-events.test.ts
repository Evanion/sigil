import { describe, it, expect, vi } from "vitest";
import { dispatch, type MenuHandlers } from "../menu-events";

describe("menu-events dispatch", () => {
  it("routes file.open to onOpenWorkfile", () => {
    const onOpenWorkfile = vi.fn();
    const handlers: MenuHandlers = { onOpenWorkfile };
    dispatch("file.open", handlers);
    expect(onOpenWorkfile).toHaveBeenCalledOnce();
  });

  it("routes edit.undo to onUndo", () => {
    const onUndo = vi.fn();
    dispatch("edit.undo", { onUndo });
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("routes edit.redo to onRedo", () => {
    const onRedo = vi.fn();
    dispatch("edit.redo", { onRedo });
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("no-ops when handler is not provided", () => {
    expect(() => dispatch("view.zoom_in", {})).not.toThrow();
  });

  it("routes all view.* events to their respective handlers", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();
    dispatch("view.zoom_in", { onZoomIn });
    dispatch("view.zoom_out", { onZoomOut });
    dispatch("view.zoom_reset", { onZoomReset });
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomReset).toHaveBeenCalledOnce();
  });
});
