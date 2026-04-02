/**
 * TypeScript types mirroring the Rust core crate's wire format commands.
 *
 * `SerializableCommand`: full state for undo/redo persistence (sent client -> server).
 * `BroadcastCommand`: forward-only state for WebSocket broadcast (received server -> client).
 *
 * Both use `#[serde(tag = "type", rename_all = "snake_case")]` discriminated unions.
 *
 * Source: crates/core/src/wire.rs
 */

import type {
  BlendMode,
  ComponentDef,
  ComponentId,
  Constraints,
  DocumentNode,
  Effect,
  Fill,
  NodeId,
  NodeKind,
  OverrideKey,
  OverrideSource,
  OverrideValue,
  PageId,
  Stroke,
  StyleValue,
  Token,
  Transform,
  Transition,
} from "./document";

// ── SerializableCommand (client -> server, full undo state) ───────────

export type SerializableCommand =
  // Node commands
  | {
      readonly type: "create_node";
      readonly node_id: NodeId;
      readonly uuid: string;
      readonly kind: NodeKind;
      readonly name: string;
      readonly page_id: PageId | null;
    }
  | {
      readonly type: "delete_node";
      readonly node_id: NodeId;
      readonly snapshot: DocumentNode | null;
      readonly page_id: PageId | null;
      readonly page_root_index: number | null;
      readonly parent_id: NodeId | null;
      readonly parent_child_index: number | null;
    }
  | {
      readonly type: "rename_node";
      readonly node_id: NodeId;
      readonly new_name: string;
      readonly old_name: string;
    }
  | {
      readonly type: "set_visible";
      readonly node_id: NodeId;
      readonly new_visible: boolean;
      readonly old_visible: boolean;
    }
  | {
      readonly type: "set_locked";
      readonly node_id: NodeId;
      readonly new_locked: boolean;
      readonly old_locked: boolean;
    }
  | {
      readonly type: "set_text_content";
      readonly node_id: NodeId;
      readonly new_content: string;
      readonly old_content: string;
    }
  // Style commands
  | {
      readonly type: "set_transform";
      readonly node_id: NodeId;
      readonly new_transform: Transform;
      readonly old_transform: Transform;
    }
  | {
      readonly type: "set_fills";
      readonly node_id: NodeId;
      readonly new_fills: readonly Fill[];
      readonly old_fills: readonly Fill[];
    }
  | {
      readonly type: "set_strokes";
      readonly node_id: NodeId;
      readonly new_strokes: readonly Stroke[];
      readonly old_strokes: readonly Stroke[];
    }
  | {
      readonly type: "set_opacity";
      readonly node_id: NodeId;
      readonly new_opacity: StyleValue<number>;
      readonly old_opacity: StyleValue<number>;
    }
  | {
      readonly type: "set_blend_mode";
      readonly node_id: NodeId;
      readonly new_blend_mode: BlendMode;
      readonly old_blend_mode: BlendMode;
    }
  | {
      readonly type: "set_effects";
      readonly node_id: NodeId;
      readonly new_effects: readonly Effect[];
      readonly old_effects: readonly Effect[];
    }
  | {
      readonly type: "set_constraints";
      readonly node_id: NodeId;
      readonly new_constraints: Constraints;
      readonly old_constraints: Constraints;
    }
  // Tree commands
  | {
      readonly type: "reparent_node";
      readonly node_id: NodeId;
      readonly new_parent_id: NodeId;
      readonly new_position: number;
      readonly old_parent_id: NodeId | null;
      readonly old_position: number | null;
    }
  | {
      readonly type: "reorder_children";
      readonly node_id: NodeId;
      readonly new_position: number;
      readonly old_position: number;
    }
  // Transition commands
  | {
      readonly type: "add_transition";
      readonly transition: Transition;
    }
  | {
      readonly type: "remove_transition";
      readonly transition_id: string;
      readonly snapshot: Transition;
    }
  | {
      readonly type: "update_transition";
      readonly transition_id: string;
      readonly new_transition: Transition;
      readonly old_transition: Transition;
    }
  // Token commands
  | {
      readonly type: "add_token";
      readonly token: Token;
    }
  | {
      readonly type: "remove_token";
      readonly token_name: string;
      readonly snapshot: Token;
    }
  | {
      readonly type: "update_token";
      readonly new_token: Token;
      readonly old_token: Token;
    }
  // Component commands
  | {
      readonly type: "add_component";
      readonly component: ComponentDef;
    }
  | {
      readonly type: "remove_component";
      readonly component_id: ComponentId;
      readonly snapshot: ComponentDef;
    }
  | {
      readonly type: "set_override";
      readonly node_id: NodeId;
      readonly key: OverrideKey;
      readonly new_value: OverrideValue;
      readonly new_source: OverrideSource;
      readonly old_entry: readonly [OverrideValue, OverrideSource] | null;
    }
  | {
      readonly type: "remove_override";
      readonly node_id: NodeId;
      readonly key: OverrideKey;
      readonly old_entry: readonly [OverrideValue, OverrideSource];
    };

// ── BroadcastCommand (server -> client, forward-only) ─────────────────

export type BroadcastCommand =
  // Node commands
  | {
      readonly type: "create_node";
      readonly uuid: string;
      readonly kind: NodeKind;
      readonly name: string;
      readonly page_id: PageId | null;
    }
  | {
      readonly type: "delete_node";
      readonly node_id: NodeId;
    }
  | {
      readonly type: "rename_node";
      readonly node_id: NodeId;
      readonly new_name: string;
    }
  | {
      readonly type: "set_visible";
      readonly node_id: NodeId;
      readonly new_visible: boolean;
    }
  | {
      readonly type: "set_locked";
      readonly node_id: NodeId;
      readonly new_locked: boolean;
    }
  | {
      readonly type: "set_text_content";
      readonly node_id: NodeId;
      readonly new_content: string;
    }
  // Style commands
  | {
      readonly type: "set_transform";
      readonly node_id: NodeId;
      readonly new_transform: Transform;
    }
  | {
      readonly type: "set_fills";
      readonly node_id: NodeId;
      readonly new_fills: readonly Fill[];
    }
  | {
      readonly type: "set_strokes";
      readonly node_id: NodeId;
      readonly new_strokes: readonly Stroke[];
    }
  | {
      readonly type: "set_opacity";
      readonly node_id: NodeId;
      readonly new_opacity: StyleValue<number>;
    }
  | {
      readonly type: "set_blend_mode";
      readonly node_id: NodeId;
      readonly new_blend_mode: BlendMode;
    }
  | {
      readonly type: "set_effects";
      readonly node_id: NodeId;
      readonly new_effects: readonly Effect[];
    }
  | {
      readonly type: "set_constraints";
      readonly node_id: NodeId;
      readonly new_constraints: Constraints;
    }
  // Tree commands
  | {
      readonly type: "reparent_node";
      readonly node_id: NodeId;
      readonly new_parent_id: NodeId;
      readonly new_position: number;
    }
  | {
      readonly type: "reorder_children";
      readonly node_id: NodeId;
      readonly new_position: number;
    }
  // Transition commands
  | {
      readonly type: "add_transition";
      readonly transition: Transition;
    }
  | {
      readonly type: "remove_transition";
      readonly transition_id: string;
    }
  | {
      readonly type: "update_transition";
      readonly transition_id: string;
      readonly new_transition: Transition;
    }
  // Token commands
  | {
      readonly type: "add_token";
      readonly token: Token;
    }
  | {
      readonly type: "remove_token";
      readonly token_name: string;
    }
  | {
      readonly type: "update_token";
      readonly new_token: Token;
    }
  // Component commands
  | {
      readonly type: "add_component";
      readonly component: ComponentDef;
    }
  | {
      readonly type: "remove_component";
      readonly component_id: ComponentId;
    }
  | {
      readonly type: "set_override";
      readonly node_id: NodeId;
      readonly key: OverrideKey;
      readonly new_value: OverrideValue;
      readonly new_source: OverrideSource;
    }
  | {
      readonly type: "remove_override";
      readonly node_id: NodeId;
      readonly key: OverrideKey;
    };

// ── Helper functions for creating common commands ─────────────────────

/** Create a rename_node command. */
export function renameNode(nodeId: NodeId, newName: string, oldName: string): SerializableCommand {
  return {
    type: "rename_node",
    node_id: nodeId,
    new_name: newName,
    old_name: oldName,
  };
}

/** Create a set_visible command. */
export function setVisible(
  nodeId: NodeId,
  newVisible: boolean,
  oldVisible: boolean,
): SerializableCommand {
  return {
    type: "set_visible",
    node_id: nodeId,
    new_visible: newVisible,
    old_visible: oldVisible,
  };
}

/** Create a set_locked command. */
export function setLocked(
  nodeId: NodeId,
  newLocked: boolean,
  oldLocked: boolean,
): SerializableCommand {
  return {
    type: "set_locked",
    node_id: nodeId,
    new_locked: newLocked,
    old_locked: oldLocked,
  };
}

/** Create a set_transform command. */
export function setTransform(
  nodeId: NodeId,
  newTransform: Transform,
  oldTransform: Transform,
): SerializableCommand {
  return {
    type: "set_transform",
    node_id: nodeId,
    new_transform: newTransform,
    old_transform: oldTransform,
  };
}

/** Create a set_fills command. */
export function setFills(
  nodeId: NodeId,
  newFills: readonly Fill[],
  oldFills: readonly Fill[],
): SerializableCommand {
  return {
    type: "set_fills",
    node_id: nodeId,
    new_fills: newFills,
    old_fills: oldFills,
  };
}

/** Create a set_opacity command. */
export function setOpacity(
  nodeId: NodeId,
  newOpacity: StyleValue<number>,
  oldOpacity: StyleValue<number>,
): SerializableCommand {
  return {
    type: "set_opacity",
    node_id: nodeId,
    new_opacity: newOpacity,
    old_opacity: oldOpacity,
  };
}

/** Create a set_text_content command. */
export function setTextContent(
  nodeId: NodeId,
  newContent: string,
  oldContent: string,
): SerializableCommand {
  return {
    type: "set_text_content",
    node_id: nodeId,
    new_content: newContent,
    old_content: oldContent,
  };
}
