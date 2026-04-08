/**
 * Client-side per-user undo/redo history manager.
 *
 * Manages linear undo/redo stacks of Transactions. The interceptor builds
 * transactions and pushes them via pushTransaction(). The HistoryManager
 * handles undo/redo by inverting transactions.
 *
 * See: Spec 15e.
 */

import type { Transaction } from "./types";
import { MAX_HISTORY_SIZE } from "./types";
import { createInverseTransaction } from "./operation-helpers";

export class HistoryManager {
  private readonly userId: string;
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];

  constructor(userId: string) {
    this.userId = userId;
  }

  // ── apply (single operation, auto-wrapped) ─────────────────────

  /**
   * Apply a single operation, auto-wrapped in a transaction.
   * Pushes to undo stack and clears redo stack.
   */
  apply(op: import("./types").Operation, description: string): void {
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId: this.userId,
      operations: [op],
      description,
      timestamp: Date.now(),
      seq: 0,
    };
    this.pushUndo(tx);
    this.redoStack = [];
  }

  // ── Push pre-built transaction ─────────────────────────────────

  /** Push a pre-built transaction to the undo stack. Clears redo. */
  pushTransaction(tx: Transaction): void {
    this.pushUndo(tx);
    this.redoStack = [];
  }

  // ── Undo / Redo ────────────────────────────────────────────────

  /**
   * Undo the most recent transaction.
   * Returns the inverse transaction to send to the server, or null if nothing to undo.
   */
  undo(): Transaction | null {
    const tx = this.undoStack.pop();
    if (tx === undefined) return null;

    // RF-010: Restore state before propagating errors
    let inverseTx: Transaction;
    try {
      inverseTx = createInverseTransaction(tx);
    } catch {
      // Push tx back — we failed to create the inverse, so undo did not happen
      this.undoStack.push(tx);
      return null;
    }
    this.pushRedo(tx);
    return inverseTx;
  }

  /**
   * Redo the most recently undone transaction.
   * Returns the original transaction (re-applied), or null if nothing to redo.
   */
  redo(): Transaction | null {
    const tx = this.redoStack.pop();
    if (tx === undefined) return null;

    // RF-010: Wrap in try-catch and restore on error
    let redoTx: Transaction;
    try {
      // tx is the original forward transaction. We push it back to the undo stack
      // and return a fresh copy with the same forward-direction operations so the
      // caller can re-apply it.
      redoTx = {
        id: crypto.randomUUID(),
        userId: tx.userId,
        operations: tx.operations.map((op) => ({
          ...op,
          id: crypto.randomUUID(),
          seq: 0,
        })),
        description: `Redo: ${tx.description}`,
        timestamp: Date.now(),
        seq: 0,
      };
    } catch {
      // Push tx back — we failed to create the redo, so redo did not happen
      this.redoStack.push(tx);
      return null;
    }
    this.pushUndo(tx);
    return redoTx;
  }

  /** Whether there are transactions to undo. */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether there are transactions to redo. */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Peek at the top of the redo stack without popping. */
  peekRedo(): Transaction | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : null;
  }

  /**
   * Pop the last undo entry WITHOUT pushing to the redo stack.
   *
   * RF-001: Used by rollbackLast() to revert an optimistic mutation on server
   * error. Unlike undo(), this does not push to redo — the failed mutation
   * should not appear in the redo stack as a "ghost" entry.
   *
   * Returns the popped transaction (for applying its inverse to the store),
   * or null if the undo stack is empty.
   */
  popLastUndo(): Transaction | null {
    const tx = this.undoStack.pop();
    return tx ?? null;
  }

  // ── Clear ──────────────────────────────────────────────────────

  /** Clear both undo and redo stacks. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  // ── Persistence accessors (used by HistoryStore integration) ───

  /** Get the current undo stack (for persistence). */
  getUndoStack(): readonly Transaction[] {
    return this.undoStack;
  }

  /** Get the current redo stack (for persistence). */
  getRedoStack(): readonly Transaction[] {
    return this.redoStack;
  }

  /** Replace the undo and redo stacks (for restore from IndexedDB). */
  restoreStacks(undoStack: Transaction[], redoStack: Transaction[]): void {
    // Enforce MAX_HISTORY_SIZE on restored data
    this.undoStack = undoStack.slice(-MAX_HISTORY_SIZE);
    this.redoStack = redoStack.slice(-MAX_HISTORY_SIZE);
  }

  // ── Internal ───────────────────────────────────────────────────

  private pushUndo(tx: Transaction): void {
    this.undoStack.push(tx);
    // FIFO eviction: remove oldest entry when exceeding max size.
    // Only one eviction per push since we push one at a time.
    // O(n) shift is acceptable for n=MAX_HISTORY_SIZE (500).
    if (this.undoStack.length > MAX_HISTORY_SIZE) {
      this.undoStack.shift();
    }
  }

  private pushRedo(tx: Transaction): void {
    this.redoStack.push(tx);
    // FIFO eviction: same policy as pushUndo.
    // O(n) shift is acceptable for n=MAX_HISTORY_SIZE (500).
    if (this.redoStack.length > MAX_HISTORY_SIZE) {
      this.redoStack.shift();
    }
  }
}
