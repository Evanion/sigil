/**
 * Operations module — client-side undo/redo system.
 *
 * Standalone module with zero integration to the document store or server.
 * See: Spec 15, Phase 15a.
 */

// Types
export type {
  Operation,
  Transaction,
  OperationType,
  ReparentValue,
  ReorderValue,
  ReorderPreviousValue,
} from "./types";
export { MAX_HISTORY_SIZE } from "./types";

// Helpers
export {
  createSetFieldOp,
  createCreateNodeOp,
  createDeleteNodeOp,
  createReparentOp,
  createReorderOp,
  createInverse,
  createInverseTransaction,
} from "./operation-helpers";

// HistoryManager
export { HistoryManager } from "./history-manager";

// IndexedDB persistence
export { HistoryStore } from "./history-store";
export type { LoadedStacks } from "./history-store";

// Persistent wrapper
export { PersistentHistoryManager } from "./persistent-history-manager";
