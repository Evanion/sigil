/**
 * Tauri native menu-action dispatcher.
 *
 * The Rust side (`src-tauri/src/menus.rs`) emits a `menu-action` event with
 * a stable string ID (e.g. `file.open`, `edit.undo`) on every menu activation.
 * This module installs the listener and routes each ID to the matching
 * handler — the same handlers that respond to keyboard shortcuts.
 *
 * When adding a new menu ID:
 * 1. Add it to `MenuAction` (the union type below).
 * 2. Add a new optional field to `MenuHandlers`.
 * 3. Add the matching `case` to `dispatch`'s switch.
 * 4. The TypeScript exhaustiveness sentinel (`const _exhaustive: never = action`)
 *    in `dispatch`'s default arm forces the type checker to reject any
 *    additions to `MenuAction` that don't have a corresponding case.
 *
 * The `dispatch` function is exported (not just internally used) so unit
 * tests can verify routing without standing up the Tauri runtime.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";

export type MenuAction =
  | "file.new"
  | "file.open"
  | "file.close"
  | "edit.undo"
  | "edit.redo"
  | "view.zoom_in"
  | "view.zoom_out"
  | "view.zoom_reset";

export interface MenuHandlers {
  onNewWorkfile?: () => void;
  onOpenWorkfile?: () => void;
  onCloseWindow?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

/**
 * Installs the Tauri menu-action listener.
 *
 * Returns null in non-Tauri contexts (browser dev mode, vitest jsdom) — the
 * dynamic import of `@tauri-apps/api/event` only fires when running inside
 * the Tauri WebView, so the module is not loaded in browser builds.
 *
 * Caller is responsible for invoking the returned UnlistenFn during teardown
 * to avoid leaking the listener across hot-reloads.
 */
export async function installMenuListener(handlers: MenuHandlers): Promise<UnlistenFn | null> {
  if (typeof window === "undefined") return null;
  if (!("__TAURI_INTERNALS__" in window)) return null;

  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("menu-action", (event) => {
    dispatch(event.payload as MenuAction, handlers);
  });
}

/**
 * Routes a menu action ID to the matching handler.
 *
 * The cast in `installMenuListener` (`event.payload as MenuAction`) is
 * guarded at runtime by the exhaustiveness sentinel below — any string the
 * Rust side emits that is not in the `MenuAction` union falls into the
 * default arm, which logs a `console.warn` and returns without dispatching.
 * The TypeScript type system enforces every variant is handled at compile
 * time via `const _exhaustive: never = action`.
 */
export function dispatch(action: MenuAction, handlers: MenuHandlers): void {
  switch (action) {
    case "file.new":
      handlers.onNewWorkfile?.();
      break;
    case "file.open":
      handlers.onOpenWorkfile?.();
      break;
    case "file.close":
      handlers.onCloseWindow?.();
      break;
    case "edit.undo":
      handlers.onUndo?.();
      break;
    case "edit.redo":
      handlers.onRedo?.();
      break;
    case "view.zoom_in":
      handlers.onZoomIn?.();
      break;
    case "view.zoom_out":
      handlers.onZoomOut?.();
      break;
    case "view.zoom_reset":
      handlers.onZoomReset?.();
      break;
    default: {
      const _exhaustive: never = action;
      console.warn("Unknown menu action:", _exhaustive);
    }
  }
}
