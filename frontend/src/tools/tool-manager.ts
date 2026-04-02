/**
 * Tool state machine for the canvas editor.
 *
 * Manages the active tool type and delegates pointer events to the
 * current tool implementation. Tool switching notifies subscribers
 * so the UI can update cursors and toolbar highlights.
 */

/** Available tool types in the editor. */
export type ToolType = "select" | "frame" | "rectangle" | "ellipse";

/** Pointer event data passed to tool handlers, in both world and screen coordinates. */
export interface ToolEvent {
  readonly worldX: number;
  readonly worldY: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** Interface that each tool implementation must satisfy. */
export interface Tool {
  onPointerDown(event: ToolEvent): void;
  onPointerMove(event: ToolEvent): void;
  onPointerUp(event: ToolEvent): void;
  getCursor(): string;
}

/** Manages active tool state, event delegation, and change subscriptions. */
export interface ToolManager {
  getActiveTool(): ToolType;
  setActiveTool(tool: ToolType): void;
  onPointerDown(event: ToolEvent): void;
  onPointerMove(event: ToolEvent): void;
  onPointerUp(event: ToolEvent): void;
  getCursor(): string;
  subscribe(fn: () => void): () => void;
}

/**
 * A no-op tool implementation used as a placeholder when no real tool
 * implementation is registered for a given tool type.
 */
class NoopTool implements Tool {
  onPointerDown(): void {
    /* no-op */
  }
  onPointerMove(): void {
    /* no-op */
  }
  onPointerUp(): void {
    /* no-op */
  }
  getCursor(): string {
    return "default";
  }
}

const NOOP_TOOL = new NoopTool();

/**
 * Create a ToolManager instance.
 *
 * @param toolImplementations - Optional map of tool type to Tool implementation.
 *   Any tool type without a registered implementation uses a no-op placeholder.
 * @param initialTool - The tool to start with. Defaults to "select".
 */
export function createToolManager(
  toolImplementations?: ReadonlyMap<ToolType, Tool>,
  initialTool: ToolType = "select",
): ToolManager {
  let activeToolType: ToolType = initialTool;
  const implementations: ReadonlyMap<ToolType, Tool> = toolImplementations ?? new Map();
  const subscribers = new Set<() => void>();

  function getImpl(): Tool {
    return implementations.get(activeToolType) ?? NOOP_TOOL;
  }

  function notifySubscribers(): void {
    for (const fn of subscribers) {
      fn();
    }
  }

  return {
    getActiveTool(): ToolType {
      return activeToolType;
    },

    setActiveTool(tool: ToolType): void {
      if (tool === activeToolType) {
        return;
      }
      activeToolType = tool;
      notifySubscribers();
    },

    onPointerDown(event: ToolEvent): void {
      getImpl().onPointerDown(event);
    },

    onPointerMove(event: ToolEvent): void {
      getImpl().onPointerMove(event);
    },

    onPointerUp(event: ToolEvent): void {
      getImpl().onPointerUp(event);
    },

    getCursor(): string {
      return getImpl().getCursor();
    },

    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
