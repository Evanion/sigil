/**
 * Client-side per-user undo/redo history manager.
 *
 * Manages linear undo/redo stacks of Transactions. Supports three modes
 * of operation entry:
 * - apply() — auto-wraps a single operation in a transaction
 * - beginTransaction/addOperation/commitTransaction — explicit grouping
 * - beginDrag/updateDrag/commitDrag — coalesces continuous pointer-move ops
 *
 * See: Spec 15, section 4.1.
 */

import type { Operation, Transaction } from "./types";
import { MAX_HISTORY_SIZE, MAX_OPERATIONS_PER_TRANSACTION } from "./types";
import { createInverseTransaction } from "./operation-helpers";

/** State for an in-progress drag coalescing session. */
interface DragState {
  readonly nodeUuid: string;
  readonly path: string;
  firstPreviousValue: unknown;
  lastValue: unknown;
  lastOp: Operation | null;
  updateCount: number;
}

export class HistoryManager {
  private readonly userId: string;
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private pendingTxOps: Operation[] | null = null;
  private pendingTxDescription: string | null = null;
  private dragState: DragState | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  // ── apply (single operation, auto-wrapped) ─────────────────────

  /**
   * Apply a single operation, auto-wrapped in a transaction.
   * Pushes to undo stack and clears redo stack.
   */
  apply(op: Operation, description: string): void {
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

  // ── Explicit transactions ──────────────────────────────────────

  /** Begin an explicit multi-operation transaction. */
  beginTransaction(description: string): void {
    if (this.pendingTxOps !== null) {
      throw new Error("Cannot begin transaction: a transaction is already active");
    }
    if (this.dragState !== null) {
      throw new Error("Cannot begin transaction: a drag is already active");
    }
    this.pendingTxOps = [];
    this.pendingTxDescription = description;
  }

  /** Add an operation to the current transaction. */
  addOperation(op: Operation): void {
    if (this.pendingTxOps === null) {
      throw new Error("Cannot add operation: no active transaction (call beginTransaction first)");
    }
    if (this.pendingTxOps.length >= MAX_OPERATIONS_PER_TRANSACTION) {
      throw new Error(
        `Cannot add operation: transaction already has ${MAX_OPERATIONS_PER_TRANSACTION} operations (MAX_OPERATIONS_PER_TRANSACTION)`,
      );
    }
    this.pendingTxOps.push(op);
  }

  /**
   * Commit the current transaction to the undo stack.
   *
   * If the transaction has zero operations, it is discarded (no undo entry is created),
   * but the redo stack is still cleared to maintain the invariant that any commit
   * (even an empty one) represents a user intent that invalidates the redo history.
   */
  commitTransaction(): void {
    if (this.pendingTxOps === null) {
      throw new Error("Cannot commit: no active transaction");
    }
    // RF-004: Always clear redo on commit, even for empty transactions.
    // An empty commit still represents user intent that invalidates redo history.
    this.redoStack = [];
    if (this.pendingTxOps.length > 0) {
      const tx: Transaction = {
        id: crypto.randomUUID(),
        userId: this.userId,
        operations: this.pendingTxOps,
        description: this.pendingTxDescription ?? "",
        timestamp: Date.now(),
        seq: 0,
      };
      this.pushUndo(tx);
    }
    this.pendingTxOps = null;
    this.pendingTxDescription = null;
  }

  /** Cancel the current transaction, discarding all pending operations. */
  cancelTransaction(): void {
    if (this.pendingTxOps === null) {
      throw new Error("Cannot cancel transaction: no active transaction");
    }
    this.pendingTxOps = null;
    this.pendingTxDescription = null;
  }

  // ── Drag coalescing ────────────────────────────────────────────

  /** Begin a drag coalescing session for a specific node+path. */
  beginDrag(nodeUuid: string, path: string): void {
    if (this.dragState !== null) {
      throw new Error("Cannot begin drag: a drag is already active");
    }
    if (this.pendingTxOps !== null) {
      throw new Error("Cannot begin drag: a transaction is already active");
    }
    this.dragState = {
      nodeUuid,
      path,
      firstPreviousValue: undefined,
      lastValue: undefined,
      lastOp: null,
      updateCount: 0,
    };
  }

  /**
   * Update the current drag with a new operation.
   * Only the first previousValue and the last value are kept.
   */
  updateDrag(op: Operation): void {
    if (this.dragState === null) {
      throw new Error("Cannot update drag: no active drag (call beginDrag first)");
    }
    if (op.nodeUuid !== this.dragState.nodeUuid || op.path !== this.dragState.path) {
      throw new Error(
        `Cannot update drag: operation node/path (${op.nodeUuid}/${op.path}) does not match drag (${this.dragState.nodeUuid}/${this.dragState.path})`,
      );
    }
    if (this.dragState.updateCount === 0) {
      this.dragState.firstPreviousValue = op.previousValue;
    }
    this.dragState.lastValue = op.value;
    this.dragState.lastOp = op;
    this.dragState.updateCount++;
  }

  /** Commit the drag as a single coalesced transaction. */
  commitDrag(): void {
    if (this.dragState === null) {
      throw new Error("Cannot commit drag: no active drag");
    }
    if (this.dragState.updateCount > 0 && this.dragState.lastOp !== null) {
      const coalescedOp: Operation = {
        id: crypto.randomUUID(),
        userId: this.userId,
        nodeUuid: this.dragState.nodeUuid,
        type: this.dragState.lastOp.type,
        path: this.dragState.path,
        value: this.dragState.lastValue,
        previousValue: this.dragState.firstPreviousValue,
        seq: 0,
      };
      const tx: Transaction = {
        id: crypto.randomUUID(),
        userId: this.userId,
        operations: [coalescedOp],
        description: `Drag ${this.dragState.path}`,
        timestamp: Date.now(),
        seq: 0,
      };
      this.pushUndo(tx);
      this.redoStack = [];
    }
    this.dragState = null;
  }

  /** Cancel the drag, discarding all drag operations. */
  cancelDrag(): void {
    if (this.dragState === null) {
      throw new Error("Cannot cancel drag: no active drag");
    }
    this.dragState = null;
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

  // ── Clear ──────────────────────────────────────────────────────

  /** Clear both undo and redo stacks. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingTxOps = null;
    this.pendingTxDescription = null;
    this.dragState = null;
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
