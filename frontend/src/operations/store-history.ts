/**
 * Bridge between HistoryManager and the Solid store.
 *
 * Provides composed operations that:
 * 1. Apply operations to the Solid store (instant local feedback)
 * 2. Track them in HistoryManager (for undo/redo)
 *
 * The caller (document-store-solid.tsx) is responsible for sending
 * operations to the server after calling these methods.
 *
 * NOTE: This bridge is a compatibility layer. The interceptor (interceptor.ts)
 * is the preferred mechanism for transparent undo tracking. This bridge will
 * be removed when document-store-solid.tsx migrates to the interceptor.
 */

import { batch } from "solid-js";
import type { HistoryManager } from "./history-manager";
import type { Operation, Transaction } from "./types";
import { createInverseTransaction } from "./operation-helpers";
import {
  applyOperationToStore,
  type StoreStateSetter,
  type StoreStateReader,
} from "./apply-to-store";

export interface StoreHistoryBridge {
  /** Apply a single operation to the store and track it as a discrete undo step. */
  applyAndTrack(op: Operation, description: string): void;

  /**
   * RF-001: Rollback the last optimistic mutation on server error.
   *
   * Pops the last entry from the undo stack WITHOUT pushing to redo,
   * then applies the inverse to the store to revert visually. This prevents
   * ghost entries in the redo stack that would otherwise accumulate from
   * calling undo() in error handlers.
   */
  rollbackLast(): void;

  /** Begin an explicit transaction (multi-operation undo step). */
  beginTransaction(description: string): void;
  /** Apply an operation within the current transaction (applies to store immediately). */
  applyInTransaction(op: Operation): void;
  /** Commit the current transaction as a single undo step. */
  commitTransaction(): void;
  /**
   * Cancel the current transaction.
   *
   * NOTE: Operations already applied to the store remain — the caller is responsible
   * for reverting any store changes if needed (e.g., by re-applying previousValues).
   */
  cancelTransaction(): void;

  /** Begin a drag operation for coalescing. */
  beginDrag(nodeUuid: string, path: string): void;
  /** Update the drag with a new operation (applies to store immediately, coalesces in history). */
  updateDrag(op: Operation): void;
  /**
   * Commit the drag as a single coalesced undo step.
   *
   * Returns null — the caller manages server payload construction separately
   * using the operations they supplied via updateDrag.
   */
  commitDrag(): Operation | null;
  /** Cancel the drag without creating an undo step. */
  cancelDrag(): void;

  /**
   * Undo the most recent transaction.
   * Applies the inverse transaction to the store and returns it for server send.
   * Returns null if nothing to undo.
   */
  undo(): Transaction | null;

  /**
   * Redo the most recently undone transaction.
   * Re-applies the transaction to the store and returns it for server send.
   * Returns null if nothing to redo.
   */
  redo(): Transaction | null;

  /** Whether undo is available. */
  canUndo(): boolean;
  /** Whether redo is available. */
  canRedo(): boolean;
}

/**
 * Create a StoreHistoryBridge that composes a HistoryManager with Solid store mutation.
 *
 * Transaction and drag methods are implemented locally using pushTransaction(),
 * since the HistoryManager no longer provides explicit transaction/drag management.
 *
 * @param historyManager - The HistoryManager instance tracking undo/redo history.
 * @param setState - The Solid store's setState function for applying mutations.
 * @param reader - A reader for looking up current node state (needed for reparent/reorder).
 * @param userId - The user ID for creating transactions.
 */
export function createStoreHistoryBridge(
  historyManager: HistoryManager,
  setState: StoreStateSetter,
  reader: StoreStateReader,
  userId?: string,
): StoreHistoryBridge {
  const txUserId = userId ?? "unknown";
  // Local state for explicit transaction grouping (replaces deleted HistoryManager methods)
  let pendingTxOps: Operation[] | null = null;
  let pendingTxDescription: string | null = null;

  // Local state for drag coalescing (replaces deleted HistoryManager methods)
  let dragNodeUuid: string | null = null;
  let dragPath: string | null = null;
  let dragFirstPreviousValue: unknown = undefined;
  let dragLastValue: unknown = undefined;
  let dragLastOp: Operation | null = null;
  let dragUpdateCount = 0;

  return {
    applyAndTrack(op: Operation, description: string): void {
      applyOperationToStore(op, setState, reader);
      historyManager.apply(op, description);
    },

    rollbackLast(): void {
      // RF-001: Pop from undo stack WITHOUT pushing to redo (no ghost entries).
      const tx = historyManager.popLastUndo();
      if (!tx) return;

      let inverseTx: Transaction;
      try {
        inverseTx = createInverseTransaction(tx);
      } catch {
        // If inverse creation fails, we cannot revert. The undo entry is already
        // removed, so at least we don't have a ghost. Log for diagnostics.
        console.error(
          "rollbackLast: failed to create inverse transaction, store may be inconsistent",
        );
        return;
      }

      batch(() => {
        for (const op of inverseTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });
    },

    beginTransaction(description: string): void {
      if (pendingTxOps !== null) {
        throw new Error("Cannot begin transaction: a transaction is already active");
      }
      if (dragNodeUuid !== null) {
        throw new Error("Cannot begin transaction: a drag is already active");
      }
      pendingTxOps = [];
      pendingTxDescription = description;
    },

    applyInTransaction(op: Operation): void {
      if (pendingTxOps === null) {
        throw new Error(
          "Cannot add operation: no active transaction (call beginTransaction first)",
        );
      }
      applyOperationToStore(op, setState, reader);
      pendingTxOps.push(op);
    },

    commitTransaction(): void {
      if (pendingTxOps === null) {
        throw new Error("Cannot commit: no active transaction");
      }
      if (pendingTxOps.length > 0) {
        const tx: Transaction = {
          id: crypto.randomUUID(),
          userId: txUserId,
          operations: pendingTxOps,
          description: pendingTxDescription ?? "",
          timestamp: Date.now(),
          seq: 0,
        };
        historyManager.pushTransaction(tx);
      }
      pendingTxOps = null;
      pendingTxDescription = null;
    },

    cancelTransaction(): void {
      if (pendingTxOps === null) {
        throw new Error("Cannot cancel transaction: no active transaction");
      }
      pendingTxOps = null;
      pendingTxDescription = null;
    },

    beginDrag(nodeUuid: string, path: string): void {
      if (dragNodeUuid !== null) {
        throw new Error("Cannot begin drag: a drag is already active");
      }
      if (pendingTxOps !== null) {
        throw new Error("Cannot begin drag: a transaction is already active");
      }
      dragNodeUuid = nodeUuid;
      dragPath = path;
      dragFirstPreviousValue = undefined;
      dragLastValue = undefined;
      dragLastOp = null;
      dragUpdateCount = 0;
    },

    updateDrag(op: Operation): void {
      if (dragNodeUuid === null) {
        throw new Error("Cannot update drag: no active drag (call beginDrag first)");
      }
      if (op.nodeUuid !== dragNodeUuid || op.path !== dragPath) {
        throw new Error(
          `Cannot update drag: operation node/path (${op.nodeUuid}/${op.path}) does not match drag (${dragNodeUuid}/${dragPath})`,
        );
      }
      applyOperationToStore(op, setState, reader);
      if (dragUpdateCount === 0) {
        dragFirstPreviousValue = op.previousValue;
      }
      dragLastValue = op.value;
      dragLastOp = op;
      dragUpdateCount++;
    },

    commitDrag(): Operation | null {
      if (dragNodeUuid === null) {
        throw new Error("Cannot commit drag: no active drag");
      }
      if (dragUpdateCount > 0 && dragLastOp !== null) {
        const coalescedOp: Operation = {
          id: crypto.randomUUID(),
          userId: dragLastOp.userId,
          nodeUuid: dragNodeUuid,
          type: dragLastOp.type,
          path: dragPath ?? "",
          value: dragLastValue,
          previousValue: dragFirstPreviousValue,
          seq: 0,
        };
        const tx: Transaction = {
          id: crypto.randomUUID(),
          userId: dragLastOp.userId,
          operations: [coalescedOp],
          description: `Drag ${dragPath}`,
          timestamp: Date.now(),
          seq: 0,
        };
        historyManager.pushTransaction(tx);
      }
      dragNodeUuid = null;
      dragPath = null;
      dragLastOp = null;
      dragUpdateCount = 0;
      return null;
    },

    cancelDrag(): void {
      if (dragNodeUuid === null) {
        throw new Error("Cannot cancel drag: no active drag");
      }
      dragNodeUuid = null;
      dragPath = null;
      dragLastOp = null;
      dragUpdateCount = 0;
    },

    undo(): Transaction | null {
      const inverseTx = historyManager.undo();
      if (!inverseTx) return null;

      // Use batch() to coalesce all Solid reactive updates from multi-op undo
      // into a single re-render pass.
      batch(() => {
        for (const op of inverseTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });

      return inverseTx;
    },

    redo(): Transaction | null {
      const redoTx = historyManager.redo();
      if (!redoTx) return null;

      // Use batch() to coalesce all Solid reactive updates from multi-op redo
      // into a single re-render pass.
      batch(() => {
        for (const op of redoTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });

      return redoTx;
    },

    canUndo(): boolean {
      return historyManager.canUndo();
    },

    canRedo(): boolean {
      return historyManager.canRedo();
    },
  };
}
