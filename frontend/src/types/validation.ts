// Frontend mirror of crates/core/src/validate.rs validation constants.
// Used by panels, store, remote-operation handlers, and validators per
// CLAUDE.md §11 "Validation Must Be Symmetric Across All Transports" and
// §5 TypeScript "Validation constants ... used by more than one frontend
// module MUST be defined in a single source-of-truth module".

/** Minimum sRGB / Display-P3 channel value (API-level). */
export const MIN_COLOR_CHANNEL = 0.0;

/** Maximum sRGB / Display-P3 channel value (API-level). */
export const MAX_COLOR_CHANNEL = 1.0;

/**
 * Maximum node-tree nesting depth (root through deepest descendant).
 *
 * Mirrors `agent_designer_core::validate::MAX_NODE_TREE_DEPTH = 64`. Used by
 * ancestor walks, descendant walks, and recursive subtree operations in the
 * store, remote-operation handlers, and panel components.
 *
 * Per CLAUDE.md §11 "Recursive Functions Require Depth Guards" — use `>=`
 * comparison, not `>`. Depth is zero-indexed: `depth >= MAX_NODE_TREE_DEPTH`
 * permits exactly `MAX_NODE_TREE_DEPTH` levels (0 through
 * MAX_NODE_TREE_DEPTH - 1).
 */
export const MAX_NODE_TREE_DEPTH = 64;

/**
 * Maximum nodes a single `deleteNodes` operation may target.
 *
 * Mirrors `agent_designer_core::validate::MAX_NODES_PER_DELETE_BATCH = 1_000`.
 * Enforced both server-side (in the core engine) and client-side (in
 * `document-store-solid.tsx::deleteNodes`) per CLAUDE.md §11
 * "Validation Must Be Symmetric Across All Transports".
 */
export const MAX_NODES_PER_DELETE_BATCH = 1_000;
