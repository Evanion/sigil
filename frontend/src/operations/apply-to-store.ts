/**
 * Applies a single Operation to the Solid store.
 *
 * This function is the single point of truth for translating an Operation
 * into Solid setState calls. Used by:
 * - Mutation methods (forward application)
 * - Undo/redo (applying inverse operations)
 * - Remote operation application (from broadcast subscription)
 *
 * IMPORTANT: This function ONLY mutates the local Solid store. It does NOT
 * send anything to the server. Server communication is the caller's responsibility.
 */

import { produce } from "solid-js/store";
import type {
  Operation,
  ReparentValue,
  ReorderValue,
  CreatePageValue,
  RenamePageValue,
  ReorderPageValue,
  CreateTokenValue,
  UpdateTokenValue,
  RenameTokenValue,
} from "./types";

/** Minimal setter interface matching Solid's SetStoreFunction signature. */
export type StoreStateSetter = (...args: unknown[]) => void;

/** Minimal reader for looking up current node state. */
export interface StoreStateReader {
  getNode(uuid: string): Record<string, unknown> | undefined;
}

const PLACEHOLDER_NODE_ID = { index: 0, generation: 0 };

/**
 * Apply a single operation to the Solid store.
 *
 * The operation's `value` field contains the new state to apply.
 * For inverse operations (undo), the caller should have already swapped
 * value/previousValue before calling this (createInverse does this).
 */
export function applyOperationToStore(
  op: Operation,
  setState: StoreStateSetter,
  reader: StoreStateReader,
): void {
  switch (op.type) {
    case "set_field":
      applySetField(op, setState, reader);
      break;
    case "create_node":
      applyCreateNode(op, setState, reader);
      break;
    case "delete_nodes":
      applyDeleteNodes(op, setState, reader);
      break;
    case "reparent":
      applyReparent(op, setState, reader);
      break;
    case "reorder":
      applyReorder(op, setState, reader);
      break;
    case "create_page":
      applyCreatePageOp(op, setState);
      break;
    case "delete_page":
      applyDeletePageOp(op, setState);
      break;
    case "rename_page":
      applyRenamePageOp(op, setState);
      break;
    case "reorder_page":
      applyReorderPageOp(op, setState);
      break;
    case "create_token":
      applyCreateTokenOp(op, setState);
      break;
    case "update_token":
      applyUpdateTokenOp(op, setState);
      break;
    case "delete_token":
      applyDeleteTokenOp(op, setState);
      break;
    case "rename_token":
      applyRenameTokenOp(op, setState);
      break;
  }
}

function applySetField(op: Operation, setState: StoreStateSetter, reader: StoreStateReader): void {
  const { nodeUuid, path, value } = op;

  // Guard: skip if node not in store
  const node = reader.getNode(nodeUuid);
  if (!node) {
    console.warn(
      `applySetField: node "${nodeUuid}" not found in store, skipping set_field for path "${path}"`,
    );
    return;
  }

  // Direct top-level fields
  switch (path) {
    case "transform":
      setState("nodes", nodeUuid, "transform", value);
      return;
    case "name":
      setState("nodes", nodeUuid, "name", value);
      return;
    case "visible":
      setState("nodes", nodeUuid, "visible", value);
      return;
    case "locked":
      setState("nodes", nodeUuid, "locked", value);
      return;
    case "kind":
      setState(
        produce((s: Record<string, Record<string, Record<string, unknown>>>) => {
          if (s["nodes"][nodeUuid]) {
            s["nodes"][nodeUuid]["kind"] = value as Record<string, unknown>;
          }
        }),
      );
      return;
  }

  // Nested style fields: "style.fills", "style.strokes", etc.
  if (path.startsWith("style.")) {
    const styleProp = path.slice(6); // "fills", "strokes", "opacity", "blend_mode", "effects"
    setState(
      produce((s: Record<string, Record<string, Record<string, Record<string, unknown>>>>) => {
        if (s["nodes"][nodeUuid]) {
          s["nodes"][nodeUuid]["style"] = {
            ...s["nodes"][nodeUuid]["style"],
            [styleProp]: value,
          };
        }
      }),
    );
    return;
  }

  // Fallback: attempt direct path assignment (for future field additions)
  console.warn(`applySetField: unknown path "${path}", attempting direct set`);
  setState("nodes", nodeUuid, path, value);
}

function applyCreateNode(
  op: Operation,
  setState: StoreStateSetter,
  reader: StoreStateReader,
): void {
  const nodeData = op.value as Record<string, unknown>;
  const uuid = nodeData["uuid"] as string;
  if (!uuid) {
    console.warn("applyCreateNode: missing uuid in node data, skipping create_node");
    return;
  }

  setState("nodes", uuid, {
    id: PLACEHOLDER_NODE_ID,
    uuid,
    kind: nodeData["kind"],
    name: nodeData["name"] ?? "",
    parent: null,
    children: [],
    transform: nodeData["transform"],
    style: nodeData["style"] ?? {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: nodeData["constraints"] ?? { horizontal: "start", vertical: "start" },
    grid_placement: nodeData["grid_placement"] ?? null,
    visible: nodeData["visible"] ?? true,
    locked: nodeData["locked"] ?? false,
    parentUuid: (nodeData["parentUuid"] as string) ?? null,
    childrenUuids: (nodeData["childrenUuids"] as string[]) ?? [],
  });

  // Spec 19: when the snapshot carries an originalIndex (undo of
  // delete_nodes), restore the child at its original position instead
  // of appending. Otherwise (normal create flow), append.
  const originalIndex = nodeData["originalIndex"];
  const hasOriginalIndex =
    typeof originalIndex === "number" && Number.isFinite(originalIndex) && originalIndex >= 0;

  // Wire up parent's childrenUuids if parentUuid is provided
  const parentUuid = nodeData["parentUuid"] as string | undefined;
  if (parentUuid) {
    const parent = reader.getNode(parentUuid);
    if (parent) {
      const existingChildren = (parent["childrenUuids"] as string[] | undefined) ?? [];
      // Avoid duplicates in case of re-application
      if (!existingChildren.includes(uuid)) {
        const insertAt = hasOriginalIndex
          ? Math.min(originalIndex as number, existingChildren.length)
          : existingChildren.length;
        const updated = [
          ...existingChildren.slice(0, insertAt),
          uuid,
          ...existingChildren.slice(insertAt),
        ];
        setState("nodes", parentUuid, "childrenUuids", updated);
      }
    }
  }

  // Spec 19 (RF-002): restore page-root membership when the snapshot
  // identifies the node as a page root. A page-root node has parentUuid
  // === null AND a pageId tag in the inverse snapshot. Insert into the
  // page's rootNodeUuids at the original index so the layer order
  // survives the undo round-trip.
  const rawPageId = nodeData["pageId"];
  const pageId = typeof rawPageId === "string" ? rawPageId : null;
  if (pageId !== null && !parentUuid) {
    setState(
      produce((s: Record<string, unknown>) => {
        const pages = s["pages"] as Array<Record<string, unknown>> | undefined;
        if (!pages) return;
        const page = pages.find((p) => p["id"] === pageId);
        if (!page) {
          console.warn("applyCreateNode: pageId provided but page not found in store", {
            uuid,
            pageId,
          });
          return;
        }
        const existingRoots = ((page["rootNodeUuids"] as string[] | undefined) ?? []).slice();
        if (existingRoots.includes(uuid)) return;
        const insertAt = hasOriginalIndex
          ? Math.min(originalIndex as number, existingRoots.length)
          : existingRoots.length;
        existingRoots.splice(insertAt, 0, uuid);
        page["rootNodeUuids"] = existingRoots;
      }),
    );
  }
}

/**
 * Spec 19: Apply a multi-node delete to the local store. Used by both
 * the forward path (local user delete; payload carries only retained
 * roots) and the redo path (replay of the forward op from history).
 *
 * The contract mirrors `apply-remote.ts::applyDeleteNodes`:
 *   - Walk each root's subtree to collect every descendant.
 *   - Strip every removed UUID from every page's rootNodeUuids.
 *   - Validate that every element of node_uuids is a string.
 *   - Apply the mutation in a single produce() block.
 *   - Emit a structured warn when a uuid is not in the store.
 */
function applyDeleteNodes(
  op: Operation,
  setState: StoreStateSetter,
  reader: StoreStateReader,
): void {
  const value = op.value as { node_uuids?: unknown } | null;
  if (!value || !Array.isArray(value.node_uuids)) {
    console.warn("applyOperationToStore: delete_nodes payload malformed", { value });
    return;
  }
  const rawUuids = value.node_uuids;
  // RF-010: defense-in-depth — reject any non-string element.
  if (!rawUuids.every((u): u is string => typeof u === "string")) {
    console.warn("applyOperationToStore: delete_nodes node_uuids contains non-string element", {
      value,
    });
    return;
  }
  const nodeUuids = rawUuids;

  // Walk each UUID's subtree in the current store and collect every
  // descendant. Iterative + explicit depth cap satisfies the recursion
  // depth guard requirement in CLAUDE.md.
  const MAX_SUBTREE_DEPTH = 64;
  const deletedSet = new Set<string>();
  interface WalkFrame {
    uuid: string;
    depth: number;
  }
  const walkStack: WalkFrame[] = [];
  for (const uuid of nodeUuids) {
    const node = reader.getNode(uuid);
    if (!node) {
      // RF-023: structured warn so silent drops are observable.
      console.warn("applyOperationToStore: delete_nodes uuid not in store, skipping", { uuid });
      continue;
    }
    walkStack.push({ uuid, depth: 0 });
  }
  while (walkStack.length > 0) {
    const frame = walkStack.pop();
    if (!frame) break;
    if (frame.depth >= MAX_SUBTREE_DEPTH) {
      console.warn("applyOperationToStore: delete_nodes subtree depth limit reached", {
        uuid: frame.uuid,
        depth: frame.depth,
        MAX_SUBTREE_DEPTH,
      });
      continue;
    }
    if (deletedSet.has(frame.uuid)) continue;
    const node = reader.getNode(frame.uuid);
    if (!node) continue;
    deletedSet.add(frame.uuid);
    const childrenUuids = (node["childrenUuids"] as string[] | undefined) ?? [];
    for (const childUuid of childrenUuids) {
      walkStack.push({ uuid: childUuid, depth: frame.depth + 1 });
    }
  }
  if (deletedSet.size === 0) {
    return;
  }

  // Single produce block — atomic for the reactive graph.
  setState(
    produce((s: Record<string, unknown>) => {
      const nodes = s["nodes"] as Record<string, Record<string, unknown> | undefined>;
      const pages = s["pages"] as Array<Record<string, unknown>> | undefined;
      for (const uuid of deletedSet) {
        const node = nodes[uuid];
        if (node) {
          const parentUuid = node["parentUuid"] as string | null | undefined;
          if (parentUuid) {
            const parent = nodes[parentUuid];
            if (parent) {
              const children = (parent["childrenUuids"] as string[] | undefined) ?? [];
              parent["childrenUuids"] = children.filter((c) => c !== uuid);
            }
          }
        }
        // Strip from every page's rootNodeUuids (defensive iteration).
        if (pages) {
          for (const page of pages) {
            const roots = page["rootNodeUuids"] as string[] | undefined;
            if (roots && roots.includes(uuid)) {
              page["rootNodeUuids"] = roots.filter((id) => id !== uuid);
            }
          }
        }
        Reflect.deleteProperty(nodes, uuid);
      }
    }),
  );
}

function applyReparent(op: Operation, setState: StoreStateSetter, reader: StoreStateReader): void {
  const { nodeUuid } = op;
  const newParent = op.value as ReparentValue;

  const node = reader.getNode(nodeUuid);
  if (!node) {
    console.warn(`applyReparent: node "${nodeUuid}" not found in store, skipping reparent`);
    return;
  }

  const oldParentUuid = node["parentUuid"] as string | null | undefined;

  // Remove from old parent's childrenUuids
  if (oldParentUuid) {
    const oldParent = reader.getNode(oldParentUuid);
    if (oldParent) {
      const oldChildren = (oldParent["childrenUuids"] as string[] | undefined) ?? [];
      setState(
        "nodes",
        oldParentUuid,
        "childrenUuids",
        oldChildren.filter((c) => c !== nodeUuid),
      );
    }
  }

  // Insert into new parent's childrenUuids at specified position
  const newParentNode = reader.getNode(newParent.parentUuid);
  if (newParentNode) {
    const children = ((newParentNode["childrenUuids"] as string[] | undefined) ?? []).filter(
      (c) => c !== nodeUuid,
    );
    const insertAt = Math.min(newParent.position, children.length);
    const updated = [...children];
    updated.splice(insertAt, 0, nodeUuid);
    setState("nodes", newParent.parentUuid, "childrenUuids", updated);
  }

  // Update node's parentUuid reference
  setState("nodes", nodeUuid, "parentUuid", newParent.parentUuid);
}

function applyReorder(op: Operation, setState: StoreStateSetter, reader: StoreStateReader): void {
  const { nodeUuid } = op;
  // RF-002: Use the unified `position` field from ReorderValue.
  const reorder = op.value as ReorderValue;
  const node = reader.getNode(nodeUuid);
  const parentUuid = node?.["parentUuid"] as string | null | undefined;

  if (!parentUuid) {
    console.warn(`applyReorder: node "${nodeUuid}" has no parent, skipping reorder`);
    return;
  }

  const parent = reader.getNode(parentUuid);
  if (!parent) return;

  const children = ((parent["childrenUuids"] as string[] | undefined) ?? []).filter(
    (c) => c !== nodeUuid,
  );
  const insertAt = Math.min(reorder.position, children.length);
  const updated = [...children];
  updated.splice(insertAt, 0, nodeUuid);
  setState("nodes", parentUuid, "childrenUuids", updated);
}

// ── Page operations ────────────────────────────────────────────────────

function applyCreatePageOp(op: Operation, setState: StoreStateSetter): void {
  const pageData = op.value as CreatePageValue;
  if (!pageData || !pageData.id) {
    console.warn("applyCreatePageOp: missing page data");
    return;
  }

  setState(
    produce((s: Record<string, unknown>) => {
      const pages = s["pages"] as Array<Record<string, unknown>>;
      // Guard against duplicates
      if (!pages.some((p) => p["id"] === pageData.id)) {
        pages.push({
          id: pageData.id,
          name: pageData.name,
          root_nodes: [],
          rootNodeUuids: [],
        });
      }
      const info = s["info"] as Record<string, unknown>;
      info["page_count"] = pages.length;
    }),
  );
}

function applyDeletePageOp(op: Operation, setState: StoreStateSetter): void {
  const pageId = op.nodeUuid;
  if (!pageId) {
    console.warn("applyDeletePageOp: missing pageId");
    return;
  }

  setState(
    produce((s: Record<string, unknown>) => {
      const pages = s["pages"] as Array<Record<string, unknown>>;
      const idx = pages.findIndex((p) => p["id"] === pageId);
      if (idx !== -1) {
        pages.splice(idx, 1);
      }
      const info = s["info"] as Record<string, unknown>;
      info["page_count"] = pages.length;
    }),
  );
}

function applyRenamePageOp(op: Operation, setState: StoreStateSetter): void {
  const pageId = op.nodeUuid;
  const renameData = op.value as RenamePageValue;
  if (!pageId || !renameData) {
    console.warn("applyRenamePageOp: missing pageId or name");
    return;
  }

  setState(
    produce((s: Record<string, unknown>) => {
      const pages = s["pages"] as Array<Record<string, unknown>>;
      const page = pages.find((p) => p["id"] === pageId);
      if (page) {
        page["name"] = renameData.name;
      }
    }),
  );
}

function applyReorderPageOp(op: Operation, setState: StoreStateSetter): void {
  const pageId = op.nodeUuid;
  const reorderData = op.value as ReorderPageValue;
  if (!pageId || !reorderData) {
    console.warn("applyReorderPageOp: missing pageId or position");
    return;
  }

  setState(
    produce((s: Record<string, unknown>) => {
      const pages = s["pages"] as Array<Record<string, unknown>>;
      const currentIdx = pages.findIndex((p) => p["id"] === pageId);
      if (currentIdx === -1) return;
      const [page] = pages.splice(currentIdx, 1);
      if (page) {
        pages.splice(reorderData.position, 0, page);
      }
    }),
  );
}

// ── Token operations ────────────────────────────────────────────────────

function applyCreateTokenOp(op: Operation, setState: StoreStateSetter): void {
  const tokenData = op.value as CreateTokenValue;
  if (!tokenData || !tokenData.name) {
    console.warn("applyCreateTokenOp: missing token data");
    return;
  }

  setState(
    produce((s: Record<string, Record<string, unknown>>) => {
      const tokens = s["tokens"] as Record<string, unknown>;
      tokens[tokenData.name] = {
        id: tokenData.id,
        name: tokenData.name,
        token_type: tokenData.token_type,
        value: tokenData.value,
        description: tokenData.description,
      };
    }),
  );
}

function applyUpdateTokenOp(op: Operation, setState: StoreStateSetter): void {
  const updateData = op.value as UpdateTokenValue;
  if (!updateData || !updateData.name) {
    console.warn("applyUpdateTokenOp: missing token update data");
    return;
  }

  setState(
    produce((s: Record<string, Record<string, unknown>>) => {
      const tokens = s["tokens"] as Record<string, unknown>;
      const existing = tokens[updateData.name] as Record<string, unknown> | undefined;
      if (!existing) {
        console.warn(`applyUpdateTokenOp: token "${updateData.name}" not found`);
        return;
      }
      tokens[updateData.name] = {
        ...existing,
        value: updateData.value,
        description: updateData.description,
      };
    }),
  );
}

function applyDeleteTokenOp(op: Operation, setState: StoreStateSetter): void {
  // For delete_token, the nodeUuid holds the token name.
  const tokenName = op.nodeUuid;
  if (!tokenName) {
    console.warn("applyDeleteTokenOp: missing token name");
    return;
  }

  setState(
    produce((s: Record<string, Record<string, unknown>>) => {
      Reflect.deleteProperty(s["tokens"], tokenName);
    }),
  );
}

function applyRenameTokenOp(op: Operation, setState: StoreStateSetter): void {
  const renameData = op.value as RenameTokenValue;
  if (!renameData || !renameData.old_name || !renameData.new_name) {
    console.warn("applyRenameTokenOp: missing rename data");
    return;
  }

  // No-op if names are the same
  if (renameData.old_name === renameData.new_name) {
    return;
  }

  setState(
    produce((s: Record<string, Record<string, unknown>>) => {
      const tokens = s["tokens"] as Record<string, unknown>;
      const existing = tokens[renameData.old_name] as Record<string, unknown> | undefined;
      if (!existing) {
        console.warn(`applyRenameTokenOp: token "${renameData.old_name}" not found`);
        return;
      }
      // Move token to new key with updated name
      tokens[renameData.new_name] = { ...existing, name: renameData.new_name };
      Reflect.deleteProperty(tokens, renameData.old_name);
    }),
  );
}
