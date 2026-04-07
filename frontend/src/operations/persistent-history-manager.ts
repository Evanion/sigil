/**
 * PersistentHistoryManager wraps HistoryManager with IndexedDB persistence.
 *
 * All HistoryManager operations are delegated to the inner manager.
 * After each state-changing operation, persistAsync() can be called
 * to fire-and-forget save to IndexedDB.
 *
 * See: Spec 15, sections 4.1 and 4.2.
 */

import type { Operation, Transaction } from "./types";
import { HistoryManager } from "./history-manager";
import { HistoryStore } from "./history-store";

/** Debounce delay for persistAsync in milliseconds. */
const PERSIST_DEBOUNCE_MS = 500;

export class PersistentHistoryManager {
  private readonly manager: HistoryManager;
  private readonly store: HistoryStore;
  private readonly userId: string;
  private persistTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor(userId: string) {
    this.userId = userId;
    this.manager = new HistoryManager(userId);
    this.store = new HistoryStore();
  }

  /** Open the IndexedDB database. Must be called before use. */
  async init(): Promise<void> {
    await this.store.open();
  }

  /** Close the IndexedDB database and clear pending timers. */
  dispose(): void {
    if (this.persistTimerId !== null) {
      clearTimeout(this.persistTimerId);
      this.persistTimerId = null;
    }
    this.store.close();
  }

  // ── Delegated HistoryManager methods ───────────────────────────

  apply(op: Operation, description: string): void {
    this.manager.apply(op, description);
  }

  beginTransaction(description: string): void {
    this.manager.beginTransaction(description);
  }

  addOperation(op: Operation): void {
    this.manager.addOperation(op);
  }

  commitTransaction(): void {
    this.manager.commitTransaction();
  }

  cancelTransaction(): void {
    this.manager.cancelTransaction();
  }

  beginDrag(nodeUuid: string, path: string): void {
    this.manager.beginDrag(nodeUuid, path);
  }

  updateDrag(op: Operation): void {
    this.manager.updateDrag(op);
  }

  commitDrag(): void {
    this.manager.commitDrag();
  }

  cancelDrag(): void {
    this.manager.cancelDrag();
  }

  undo(): Transaction | null {
    return this.manager.undo();
  }

  redo(): Transaction | null {
    return this.manager.redo();
  }

  canUndo(): boolean {
    return this.manager.canUndo();
  }

  canRedo(): boolean {
    return this.manager.canRedo();
  }

  clear(): void {
    this.manager.clear();
  }

  // ── Persistence ────────────────────────────────────────────────

  /**
   * Persist current stacks to IndexedDB (blocking/await).
   * Used when you need to guarantee the save completes.
   */
  async persist(documentId: string): Promise<void> {
    await this.store.saveStack(
      documentId,
      this.userId,
      this.manager.getUndoStack(),
      this.manager.getRedoStack(),
    );
  }

  /**
   * Debounced fire-and-forget persist. Logs errors to console.error.
   * Uses a 500ms trailing debounce to avoid serializing the full stack
   * on every mutation. Called after every state-changing operation for
   * non-blocking persistence.
   */
  persistAsync(documentId: string): void {
    if (this.persistTimerId !== null) {
      clearTimeout(this.persistTimerId);
    }
    this.persistTimerId = setTimeout(() => {
      this.persistTimerId = null;
      this.persist(documentId).catch((err: unknown) => {
        console.error("Failed to persist history to IndexedDB:", err);
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Restore stacks from IndexedDB for a given document.
   */
  async restore(documentId: string): Promise<void> {
    const loaded = await this.store.loadStack(documentId, this.userId);
    if (loaded !== null) {
      this.manager.restoreStacks(loaded.undoStack, loaded.redoStack);
    }
  }

  /**
   * Clear persisted data for a document from IndexedDB and reset in-memory stacks.
   */
  async clearPersisted(documentId: string): Promise<void> {
    this.manager.clear();
    await this.store.clearStack(documentId, this.userId);
  }
}
