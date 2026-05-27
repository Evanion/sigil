// Type-level exhaustiveness sentinel for OperationType (Spec 19 governance).
//
// If this file fails `tsc --noEmit`, a new variant of OperationType was added
// without updating every dispatch site. Find the missing arm in:
//   - applyRemoteOperation (apply-remote.ts)
//   - applyOperationToStore (apply-to-store.ts)
//   - inverseType / createInverse (operation-helpers.ts)
//
// The exhaustive switch below produces a `never` sentinel in the default arm.
// Adding a new OperationType variant without adding a case here will surface
// as a compile-time `Type 'string' is not assignable to type 'never'` error.

import type { OperationType, Operation } from "../types";

function _operationTypeExhaustive(op: Operation): string {
  switch (op.type) {
    case "set_field":
      return "set_field";
    case "create_node":
      return "create_node";
    case "delete_node":
      return "delete_node";
    case "delete_nodes":
      return "delete_nodes";
    case "reparent":
      return "reparent";
    case "reorder":
      return "reorder";
    case "create_page":
      return "create_page";
    case "delete_page":
      return "delete_page";
    case "rename_page":
      return "rename_page";
    case "reorder_page":
      return "reorder_page";
    case "create_token":
      return "create_token";
    case "update_token":
      return "update_token";
    case "delete_token":
      return "delete_token";
    case "rename_token":
      return "rename_token";
    default: {
      const _exhaustive: never = op.type;
      return _exhaustive;
    }
  }
}

// Reference the function to satisfy unused-symbol lints.
export const _operationTypeExhaustive_ref: typeof _operationTypeExhaustive =
  _operationTypeExhaustive;

// Compile-time assertion that OperationType still includes "delete_nodes".
// Adding this as an explicit `Extract<…>` narrowing guards against any
// future refactor that accidentally removes the variant.
const _hasDeleteNodes: Extract<OperationType, "delete_nodes"> = "delete_nodes";
export const _hasDeleteNodes_ref: typeof _hasDeleteNodes = _hasDeleteNodes;
