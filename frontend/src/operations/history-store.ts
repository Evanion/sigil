/**
 * IndexedDB persistence layer for undo/redo stacks.
 *
 * Stores Transaction arrays keyed by [documentId, userId].
 * Uses the raw IndexedDB API (no external library).
 *
 * Database: sigil-history
 *   Object store: stacks
 *     keyPath: key (compound string "documentId::userId")
 *     Value: { key, undoStack, redoStack }
 *
 * See: Spec 15, section 4.2.
 */

import type { Transaction } from "./types";

/** Database name. */
const DB_NAME = "sigil-history";

/** Database version. */
const DB_VERSION = 1;

/** Object store name for stack data. */
const STACKS_STORE = "stacks";

/** Result of loading a saved stack from IndexedDB. */
export interface LoadedStacks {
  readonly undoStack: Transaction[];
  readonly redoStack: Transaction[];
}

/** Internal record shape stored in IndexedDB. */
interface StackRecord {
  key: string;
  undoStack: Transaction[];
  redoStack: Transaction[];
}

/** Build the compound key string from document and user IDs. */
function makeKey(documentId: string, userId: string): string {
  return `${documentId}::${userId}`;
}

export class HistoryStore {
  private db: IDBDatabase | null = null;

  /**
   * Open the IndexedDB database. Must be called before any other method.
   */
  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STACKS_STORE)) {
          db.createObjectStore(STACKS_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        reject(
          new Error(
            `Failed to open IndexedDB "${DB_NAME}": ${String(request.error)}`,
          ),
        );
      };
    });
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Save undo and redo stacks for a document+user pair.
   * Overwrites any existing data for the same key.
   */
  async saveStack(
    documentId: string,
    userId: string,
    undoStack: readonly Transaction[],
    redoStack: readonly Transaction[],
  ): Promise<void> {
    const db = this.requireDb();
    const key = makeKey(documentId, userId);

    const record: StackRecord = {
      key,
      undoStack: [...undoStack],
      redoStack: [...redoStack],
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STACKS_STORE, "readwrite");
      const objectStore = tx.objectStore(STACKS_STORE);
      const request = objectStore.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to save stack: ${String(request.error)}`));
    });
  }

  /**
   * Load undo and redo stacks for a document+user pair.
   * Returns null if no data exists for the given key.
   */
  async loadStack(
    documentId: string,
    userId: string,
  ): Promise<LoadedStacks | null> {
    const db = this.requireDb();
    const key = makeKey(documentId, userId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STACKS_STORE, "readonly");
      const objectStore = tx.objectStore(STACKS_STORE);
      const request = objectStore.get(key);

      request.onsuccess = () => {
        const result = request.result as StackRecord | undefined;
        if (result === undefined) {
          resolve(null);
        } else {
          resolve({
            undoStack: result.undoStack,
            redoStack: result.redoStack,
          });
        }
      };

      request.onerror = () =>
        reject(new Error(`Failed to load stack: ${String(request.error)}`));
    });
  }

  /**
   * Clear all stored data for a document+user pair.
   */
  async clearStack(documentId: string, userId: string): Promise<void> {
    const db = this.requireDb();
    const key = makeKey(documentId, userId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STACKS_STORE, "readwrite");
      const objectStore = tx.objectStore(STACKS_STORE);
      const request = objectStore.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to clear stack: ${String(request.error)}`));
    });
  }

  /** Ensure the database is open, throw if not. */
  private requireDb(): IDBDatabase {
    if (this.db === null) {
      throw new Error("HistoryStore is not open. Call open() first.");
    }
    return this.db;
  }
}
