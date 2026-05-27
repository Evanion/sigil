// Type-level exhaustiveness sentinel for OperationType (Spec 19 governance).
//
// If this file fails `tsc --noEmit`, a new variant of OperationType was added
// without updating every dispatch site. Find the missing arm in:
//   - applyRemoteOperation (apply-remote.ts)
//   - applyOperationToStore (apply-to-store.ts)
//   - inverseType / createInverse (operation-helpers.ts)
//   - operationToServerOp (document-store-solid.tsx — exhaustive switch with no default)
//
// The exhaustive switches below produce a `never` sentinel in the default arm.
// Adding a new OperationType variant without adding a case here will surface
// as a compile-time `Type 'string' is not assignable to type 'never'` error.
//
// RF-037: This sentinel covers OperationType's direct enumeration. Per the
// frontend-defensive "Discriminated Unions Must Have a Type-Level
// Exhaustiveness Sentinel" rule, every set/map/switch that branches on the
// discriminant should be referenced here. `transactionToServerOps`
// (document-store-solid.tsx) uses a `default:` arm to collect reparent/reorder
// into a structuralOther bucket — that's intentional grouping by category, not
// a missed variant, so it's NOT considered exhaustive in the same way.
// `operationToServerOp` IS exhaustive (no default) and is covered by tsc on
// the production code, not duplicated here.

import type { OperationType, Operation } from "../types";

function _operationTypeExhaustive(op: Operation): string {
  switch (op.type) {
    case "set_field":
      return "set_field";
    case "create_node":
      return "create_node";
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

// Compile-time assertion that OperationType does NOT include the removed
// singular `"delete_node"` literal. If a future refactor mistakenly
// reintroduces it, `Extract<OperationType, "delete_node">` resolves to
// `"delete_node"` instead of `never`, and the conditional `[...] extends
// [never] ? true : false` resolves to `false`, failing the assignment.
// RF-037: cements migration completeness at the type level.
type _NoSingularDeleteNode = [Extract<OperationType, "delete_node">] extends [never]
  ? true
  : false;
const _noSingularDeleteNode: _NoSingularDeleteNode = true;
export const _noSingularDeleteNode_ref: typeof _noSingularDeleteNode = _noSingularDeleteNode;
