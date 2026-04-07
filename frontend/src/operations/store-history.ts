/**
 * Bridge between HistoryManager and the Solid store.
 *
 * Provides composed operations that:
 * 1. Apply operations to the Solid store (instant local feedback)
 * 2. Track them in HistoryManager (for undo/redo)
 *
 * The caller (document-store-solid.tsx) is responsible for sending
 * operations to the server after calling these methods.
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
 * @param historyManager - The HistoryManager instance tracking undo/redo history.
 * @param setState - The Solid store's setState function for applying mutations.
 * @param reader - A reader for looking up current node state (needed for reparent/reorder).
 */
export function createStoreHistoryBridge(
  historyManager: HistoryManager,
  setState: StoreStateSetter,
  reader: StoreStateReader,
): StoreHistoryBridge {
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
      historyManager.beginTransaction(description);
    },

    applyInTransaction(op: Operation): void {
      applyOperationToStore(op, setState, reader);
      historyManager.addOperation(op);
    },

    commitTransaction(): void {
      historyManager.commitTransaction();
    },

    cancelTransaction(): void {
      historyManager.cancelTransaction();
    },

    beginDrag(nodeUuid: string, path: string): void {
      historyManager.beginDrag(nodeUuid, path);
    },

    updateDrag(op: Operation): void {
      applyOperationToStore(op, setState, reader);
      historyManager.updateDrag(op);
    },

    commitDrag(): Operation | null {
      historyManager.commitDrag();
      // The coalesced operation is in the last transaction on the undo stack.
      // Caller manages server payload construction separately.
      return null;
    },

    cancelDrag(): void {
      historyManager.cancelDrag();
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
