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
import type { Operation, Transaction, SideEffectContext } from "./types";
import { MAX_OPERATIONS_PER_TRANSACTION } from "./types";
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

// RF-017: Maximum number of entries in the coalesce buffer before force-flush.
const MAX_BUFFER_ENTRIES = 1000;

// RF-018: Maximum age in ms for the coalesce buffer before force-flush.
const MAX_BUFFER_AGE_MS = 5000;

/**
 * Deep clone a value. Uses JSON round-trip because Solid store proxies
 * throw DataCloneError with structuredClone.
 *
 * RF-028: Exported for shared use across operations modules.
 */
export function deepClone<T>(value: T): T {
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
 *
 * RF-020: Delegates to applyOperationToStore for set_field operations,
 * eliminating duplicated write logic. The synthetic operation is constructed
 * with a dummy id/userId since applyOperationToStore only reads type/nodeUuid/path/value.
 */
export function writeStorePath(
  setState: StoreStateSetter,
  nodeUuid: string,
  path: string,
  value: unknown,
): void {
  const syntheticOp: Operation = {
    id: "",
    userId: "",
    nodeUuid,
    type: "set_field",
    path,
    value,
    previousValue: null,
    seq: 0,
  };
  const reader: StoreStateReader = {
    // writeStorePath callers already verify node exists; provide a pass-through
    // reader that returns a minimal object so applyOperationToStore proceeds.
    getNode: () => ({}) as Record<string, unknown>,
  };
  applyOperationToStore(syntheticOp, setState, reader);
}

export function createInterceptor(
  state: Record<string, unknown>,
  setState: StoreStateSetter,
  historyManager: HistoryManager,
  userId: string,
  onCommit?: () => void,
): Interceptor {
  /** Buffer of changes awaiting coalesce commit. */
  const buffer: Map<string, BufferedChange> = new Map(); // key: "nodeUuid::path"
  /** Structural operations in the current buffer. */
  const structuralBuffer: Operation[] = [];
  /** setTimeout handle for idle detection. */
  let rafHandle: number | null = null;
  /** Flag to suppress tracking during undo/redo application. */
  let isUndoing = false;
  /** Side-effect context before the current buffer started. */
  let contextSnapshot: SideEffectContext | null = null;
  /** Side-effect readers/writers — set during store init. */
  let sideEffectReaders: SideEffectReaders | null = null;
  /** RF-018: Timestamp of the first write in the current buffer window. */
  let bufferStartTime: number | null = null;

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
    sideEffectReaders.setSelectedNodeIds([...ctx.selectedNodeIds]);
    sideEffectReaders.setActiveTool(ctx.activeTool);
    sideEffectReaders.setViewport({ ...ctx.viewport });
  }

  /**
   * Idle coalescing: commit buffer after no writes for ~100ms.
   *
   * Uses setTimeout instead of rAF because rAF fires at the end of each frame,
   * which is too soon for continuous gestures that span multiple frames (color
   * picker drag, canvas drag). The 100ms window groups an entire continuous
   * interaction into one undo step while still feeling responsive for discrete
   * actions (rename, toggle).
   *
   * RF-018: If the buffer has been open longer than MAX_BUFFER_AGE_MS, force-flush
   * immediately instead of rescheduling, to prevent unbounded coalesce windows.
   */
  function scheduleFlush(): void {
    if (rafHandle !== null) {
      clearTimeout(rafHandle);
    }

    // RF-018: Force-flush if the buffer has been open too long
    if (bufferStartTime !== null && Date.now() - bufferStartTime > MAX_BUFFER_AGE_MS) {
      rafHandle = null;
      commitBuffer();
      return;
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

    // RF-008: Enforce MAX_OPERATIONS_PER_TRANSACTION
    if (ops.length > MAX_OPERATIONS_PER_TRANSACTION) {
      console.error(
        `commitBuffer: transaction has ${ops.length} operations, exceeding MAX_OPERATIONS_PER_TRANSACTION (${MAX_OPERATIONS_PER_TRANSACTION}). Truncating to limit.`,
      );
      ops.length = MAX_OPERATIONS_PER_TRANSACTION;
    }

    // RF-019: Create transaction with type-safe sideEffectContext
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId,
      operations: ops,
      description: "",
      timestamp: Date.now(),
      seq: 0,
      sideEffectContext: contextSnapshot ?? undefined,
    };

    historyManager.pushTransaction(tx);

    // Clear buffer
    buffer.clear();
    structuralBuffer.length = 0;
    contextSnapshot = null;
    bufferStartTime = null;

    // RF-003: Notify the store to sync history signals after commit
    if (onCommit) onCommit();
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

      // RF-017: Force-flush if buffer is at capacity before adding
      if (buffer.size >= MAX_BUFFER_ENTRIES && !buffer.has(`${nodeUuid}::${path}`)) {
        forceFlush();
      }

      const key = `${nodeUuid}::${path}`;
      const existing = buffer.get(key);

      if (!existing) {
        // First write to this path — capture before value and context
        if (buffer.size === 0 && structuralBuffer.length === 0) {
          contextSnapshot = captureContext();
          // RF-018: Record when the buffer window started
          bufferStartTime = Date.now();
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
        // RF-018: Record when the buffer window started
        bufferStartTime = Date.now();
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

      // RF-012: Apply inverse to store without triggering interceptor.
      // Wrap in try-finally to ensure isUndoing is always reset.
      isUndoing = true;
      try {
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
        const ctx = originalTx?.sideEffectContext;
        if (ctx) restoreContext(ctx);
      } finally {
        isUndoing = false;
      }

      // RF-003: Sync history signals after undo
      if (onCommit) onCommit();

      return inverseTx;
    },

    redo(): Transaction | null {
      const redoTx = historyManager.redo();
      if (!redoTx) return null;

      // RF-012: Wrap in try-finally to ensure isUndoing is always reset.
      isUndoing = true;
      try {
        const reader: StoreStateReader = {
          getNode: (uuid: string) =>
            (state as { nodes: Record<string, Record<string, unknown>> }).nodes[uuid],
        };
        batch(() => {
          for (const op of redoTx.operations) {
            applyOperationToStore(op, setState, reader);
          }
        });

        // RF-027: Restore side-effect context from the redo transaction.
        // The redo transaction is the original forward transaction that was on the redo stack.
        // Its sideEffectContext captures the state at the time of the original mutation,
        // which should be restored when redoing.
        // Look at the original transaction that was just pushed back to undo stack.
        const originalTx = historyManager.peekUndo();
        const ctx = originalTx?.sideEffectContext;
        if (ctx) restoreContext(ctx);
      } finally {
        isUndoing = false;
      }

      // RF-003: Sync history signals after redo
      if (onCommit) onCommit();

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
