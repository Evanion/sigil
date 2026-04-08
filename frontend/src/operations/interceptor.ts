/**
 * Transparent undo interceptor for Solid stores.
 *
 * Wraps setState to automatically capture before/after values for document
 * state changes (nodes, pages). UI state (info, selection, etc.) is not tracked.
 *
 * Idle coalescing: all changes within a single animation frame are grouped
 * into one undo step. If new writes arrive before the rAF fires, the frame
 * is rescheduled, extending the coalesce window.
 *
 * Structural operations (create/delete/reparent/reorder) must be registered
 * explicitly via trackStructural() — the only concession to transparency.
 */

import { batch } from "solid-js";
import { produce } from "solid-js/store";
import type { Operation, Transaction } from "./types";
import type { HistoryManager } from "./history-manager";
import { createSetFieldOp } from "./operation-helpers";
import {
  applyOperationToStore,
  type StoreStateSetter,
  type StoreStateReader,
} from "./apply-to-store";

/** Buffered change awaiting coalesce commit. */
interface BufferedChange {
  nodeUuid: string;
  path: string;
  beforeValue: unknown;
  afterValue: unknown;
}

/** Side-effect context snapshot (restored on undo/redo). */
interface SideEffectContext {
  selectedNodeIds: string[];
  activeTool: string;
  viewport: { x: number; y: number; zoom: number };
}

export interface SideEffectReaders {
  getSelectedNodeIds: () => string[];
  setSelectedNodeIds: (ids: string[]) => void;
  getActiveTool: () => string;
  setActiveTool: (tool: string) => void;
  getViewport: () => { x: number; y: number; zoom: number };
  setViewport: (vp: { x: number; y: number; zoom: number }) => void;
}

export interface Interceptor {
  /**
   * Set a field on a node. Automatically tracked for undo.
   * The interceptor reads the current value (before), applies via setState,
   * and buffers the change for coalescing.
   */
  set(nodeUuid: string, path: string, value: unknown): void;

  /**
   * Register a structural operation (create/delete/reparent/reorder).
   * Called by the ~4 structural mutations after they modify the store.
   */
  trackStructural(op: Operation): void;

  /** Undo the most recent undo step. Returns the inverse Transaction for server sync. */
  undo(): Transaction | null;

  /** Redo the most recently undone step. Returns the Transaction for server sync. */
  redo(): Transaction | null;

  /** Whether undo is available. */
  canUndo(): boolean;

  /** Whether redo is available. */
  canRedo(): boolean;

  /**
   * Force-flush the pending buffer into a committed undo step.
   * Called externally if needed (e.g., before navigation).
   */
  flush(): void;

  /** Set the side-effect context readers (called once during store init). */
  setSideEffectReaders(readers: SideEffectReaders): void;

  /** Destroy the interceptor, cancelling any pending rAF. */
  destroy(): void;
}

/**
 * Deep clone a value. Uses JSON round-trip because Solid store proxies
 * throw DataCloneError with structuredClone.
 */
function deepClone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  // JSON clone: Solid proxy not structuredClone-safe
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Read a value from the store at the given node+path.
 * Returns a deep clone (safe from Solid proxy issues).
 */
export function readStorePath(
  state: Record<string, unknown>,
  nodeUuid: string,
  path: string,
): unknown {
  const nodes = state["nodes"] as Record<string, Record<string, unknown>> | undefined;
  if (!nodes) return undefined;
  const node = nodes[nodeUuid];
  if (!node) return undefined;

  if (path.startsWith("style.")) {
    const styleProp = path.slice(6);
    const style = node["style"] as Record<string, unknown> | undefined;
    return style ? deepClone(style[styleProp]) : undefined;
  }

  // Top-level field: "name", "transform", "visible", "locked", "kind"
  const value = node[path];
  if (value === undefined || value === null) return value;
  if (typeof value === "object") return deepClone(value);
  return value; // primitive — no clone needed
}

/**
 * Apply a value to the store at the given node+path.
 * Mirrors the logic in apply-to-store.ts for set_field operations.
 */
export function writeStorePath(
  setState: StoreStateSetter,
  nodeUuid: string,
  path: string,
  value: unknown,
): void {
  if (path.startsWith("style.")) {
    const styleProp = path.slice(6);
    // Use produce for nested style fields
    setState(
      produce((s: Record<string, Record<string, Record<string, Record<string, unknown>>>>) => {
        if (s["nodes"][nodeUuid]) {
          s["nodes"][nodeUuid]["style"] = {
            ...s["nodes"][nodeUuid]["style"],
            [styleProp]: value,
          };
        }
      }),
    );
    return;
  }

  // Top-level field
  setState("nodes", nodeUuid, path, value);
}

export function createInterceptor(
  state: Record<string, unknown>,
  setState: StoreStateSetter,
  historyManager: HistoryManager,
  userId: string,
): Interceptor {
  /** Buffer of changes awaiting coalesce commit. */
  const buffer: Map<string, BufferedChange> = new Map(); // key: "nodeUuid::path"
  /** Structural operations in the current buffer. */
  const structuralBuffer: Operation[] = [];
  /** rAF handle for idle detection. */
  let rafHandle: number | null = null;
  /** Flag to suppress tracking during undo/redo application. */
  let isUndoing = false;
  /** Side-effect context before the current buffer started. */
  let contextSnapshot: SideEffectContext | null = null;
  /** Side-effect readers/writers — set during store init. */
  let sideEffectReaders: SideEffectReaders | null = null;

  function captureContext(): SideEffectContext {
    if (!sideEffectReaders) {
      return { selectedNodeIds: [], activeTool: "select", viewport: { x: 0, y: 0, zoom: 1 } };
    }
    return {
      selectedNodeIds: [...sideEffectReaders.getSelectedNodeIds()],
      activeTool: sideEffectReaders.getActiveTool(),
      viewport: { ...sideEffectReaders.getViewport() },
    };
  }

  function restoreContext(ctx: SideEffectContext): void {
    if (!sideEffectReaders) return;
    sideEffectReaders.setSelectedNodeIds(ctx.selectedNodeIds);
    sideEffectReaders.setActiveTool(ctx.activeTool);
    sideEffectReaders.setViewport(ctx.viewport);
  }

  /**
   * Idle coalescing: commit buffer after no writes for ~100ms.
   *
   * Uses setTimeout instead of rAF because rAF fires at the end of each frame,
   * which is too soon for continuous gestures that span multiple frames (color
   * picker drag, canvas drag). The 100ms window groups an entire continuous
   * interaction into one undo step while still feeling responsive for discrete
   * actions (rename, toggle).
   */
  function scheduleFlush(): void {
    if (rafHandle !== null) {
      clearTimeout(rafHandle);
    }
    rafHandle = window.setTimeout(() => {
      rafHandle = null;
      commitBuffer();
    }, 100);
  }

  function commitBuffer(): void {
    if (buffer.size === 0 && structuralBuffer.length === 0) return;

    // Build operations from buffered field changes
    const ops: Operation[] = [];
    for (const change of buffer.values()) {
      ops.push(
        createSetFieldOp(
          userId,
          change.nodeUuid,
          change.path,
          change.afterValue,
          change.beforeValue,
        ),
      );
    }
    // Add structural operations
    ops.push(...structuralBuffer);

    if (ops.length === 0) return;

    // Create transaction and push to history
    const tx: Transaction & { _context?: SideEffectContext } = {
      id: crypto.randomUUID(),
      userId,
      operations: ops,
      description: "",
      timestamp: Date.now(),
      seq: 0,
    };

    // Store context snapshot WITH the transaction for undo/redo restoration
    tx._context = contextSnapshot ?? undefined;

    historyManager.pushTransaction(tx);

    // Clear buffer
    buffer.clear();
    structuralBuffer.length = 0;
    contextSnapshot = null;
  }

  function forceFlush(): void {
    if (rafHandle !== null) {
      clearTimeout(rafHandle);
      rafHandle = null;
    }
    commitBuffer();
  }

  const interceptor: Interceptor = {
    set(nodeUuid: string, path: string, value: unknown): void {
      if (isUndoing) return; // ignore writes during undo/redo

      const key = `${nodeUuid}::${path}`;
      const existing = buffer.get(key);

      if (!existing) {
        // First write to this path — capture before value and context
        if (buffer.size === 0 && structuralBuffer.length === 0) {
          contextSnapshot = captureContext();
        }
        const beforeValue = readStorePath(state, nodeUuid, path);
        buffer.set(key, { nodeUuid, path, beforeValue, afterValue: value });
      } else {
        // Subsequent write — only update afterValue (before stays from first write)
        existing.afterValue = value;
      }

      // Apply to store immediately (optimistic)
      writeStorePath(setState, nodeUuid, path, value);

      // Reschedule coalesce
      scheduleFlush();
    },

    trackStructural(op: Operation): void {
      if (isUndoing) return;

      if (buffer.size === 0 && structuralBuffer.length === 0) {
        contextSnapshot = captureContext();
      }
      structuralBuffer.push(op);
      scheduleFlush();
    },

    flush(): void {
      forceFlush();
    },

    undo(): Transaction | null {
      // Force-flush pending buffer first
      if (buffer.size > 0 || structuralBuffer.length > 0) {
        forceFlush();
      }

      const inverseTx = historyManager.undo();
      if (!inverseTx) return null;

      // Apply inverse to store without triggering interceptor
      isUndoing = true;
      const reader: StoreStateReader = {
        getNode: (uuid: string) =>
          (state as { nodes: Record<string, Record<string, unknown>> }).nodes[uuid],
      };
      batch(() => {
        for (const op of inverseTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });

      // Restore side-effect context from the ORIGINAL transaction (now on redo stack)
      const originalTx = historyManager.peekRedo();
      const ctx = (originalTx as (Transaction & { _context?: SideEffectContext }) | null)?._context;
      if (ctx) restoreContext(ctx);

      isUndoing = false;
      return inverseTx;
    },

    redo(): Transaction | null {
      const redoTx = historyManager.redo();
      if (!redoTx) return null;

      isUndoing = true;
      const reader: StoreStateReader = {
        getNode: (uuid: string) =>
          (state as { nodes: Record<string, Record<string, unknown>> }).nodes[uuid],
      };
      batch(() => {
        for (const op of redoTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });
      isUndoing = false;
      return redoTx;
    },

    canUndo(): boolean {
      return historyManager.canUndo();
    },

    canRedo(): boolean {
      return historyManager.canRedo();
    },

    setSideEffectReaders(readers: SideEffectReaders): void {
      sideEffectReaders = readers;
    },

    destroy(): void {
      if (rafHandle !== null) {
        clearTimeout(rafHandle);
        rafHandle = null;
      }
    },
  };

  return interceptor;
}
