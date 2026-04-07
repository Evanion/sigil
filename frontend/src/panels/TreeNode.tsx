import { createSignal, Show, type Component } from "solid-js";
import { useDraggable, useDroppable } from "dnd-kit-solid";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "../shell/AnnounceProvider";
import { INDENT_WIDTH, type LayerDragData } from "../dnd/types";
import type { DocumentNode } from "../types/document";
import "./TreeNode.css";

export interface TreeNodeProps {
  readonly node: DocumentNode & {
    readonly parentUuid: string | null;
    readonly childrenUuids: readonly string[];
  };
  readonly depth: number;
  readonly isExpanded: boolean;
  readonly onToggleExpand: (uuid: string) => void;
  readonly hasChildren: boolean;
  /** Whether this node is the keyboard-focused node (roving tabindex). */
  readonly isFocused?: boolean;
  /** Called when this node is clicked/selected (for focus sync). */
  readonly onFocusNode?: (uuid: string) => void;
}

/** Maps node kind discriminant to a short text icon. */
function kindIcon(kind: string): string {
  switch (kind) {
    case "frame":
      return "\u25A2"; // ▢
    case "rectangle":
      return "\u25A0"; // ■
    case "ellipse":
      return "\u25CF"; // ●
    case "text":
      return "T";
    case "group":
      return "\u25EB"; // ◫
    case "path":
      return "\u270E"; // ✎
    case "image":
      return "\u{1F5BC}"; // 🖼
    case "component_instance":
      return "\u25C7"; // ◇
    default:
      return "?";
  }
}

export const TreeNode: Component<TreeNodeProps> = (props) => {
  const store = useDocument();
  const announce = useAnnounce();
  const [isRenaming, setIsRenaming] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  // RF-004: Use O(1) Set lookup instead of O(n) .includes() on the full array.
  const isSelected = () => store.isNodeSelected(props.node.uuid);
  const indentPx = () => props.depth * INDENT_WIDTH;

  // DnD: draggable
  const dragData: LayerDragData = { type: "layer", uuid: props.node.uuid };
  const { isDragging, ref: dragRef } = useDraggable({
    id: `layer-drag-${props.node.uuid}`,
    data: dragData,
  });

  // DnD: droppable
  const { isDropTarget, ref: dropRef } = useDroppable({
    id: `layer-drop-${props.node.uuid}`,
    data: { type: "layer", uuid: props.node.uuid },
  });

  /** Expose startRename so the keyboard handler in LayersTree can trigger it. */
  function startRename(): void {
    setIsRenaming(true);
    requestAnimationFrame(() => {
      inputRef?.focus();
      inputRef?.select();
    });
  }

  function handleClick() {
    store.setSelectedNodeId(props.node.uuid);
    props.onFocusNode?.(props.node.uuid);
    announce(`${props.node.name} selected`);
  }

  function handleDoubleClick() {
    startRename();
  }

  function handleRenameSubmit() {
    const value = inputRef?.value.trim();
    if (value && value !== props.node.name) {
      store.renameNode(props.node.uuid, value);
    }
    setIsRenaming(false);
  }

  function handleRenameKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setIsRenaming(false);
    }
  }

  function handleVisibilityToggle(e: MouseEvent) {
    e.stopPropagation();
    store.setVisible(props.node.uuid, !props.node.visible);
  }

  function handleLockToggle(e: MouseEvent) {
    e.stopPropagation();
    store.setLocked(props.node.uuid, !props.node.locked);
  }

  /**
   * Combined ref setter: assigns the DOM element to both the drag and drop refs.
   * dnd-kit-solid uses Solid setters for ref, so we call both.
   */
  function combinedRef(el: HTMLDivElement) {
    dragRef(el);
    dropRef(el);
  }

  return (
    <div
      ref={combinedRef}
      class="sigil-tree-node"
      classList={{
        "sigil-tree-node--selected": isSelected(),
        "sigil-tree-node--hidden": !props.node.visible,
        "sigil-tree-node--dragging": isDragging(),
        "sigil-tree-node--drop-target": isDropTarget(),
        "sigil-tree-node--focused": props.isFocused ?? false,
      }}
      style={{ "padding-left": `${indentPx()}px` }}
      role="treeitem"
      aria-selected={isSelected()}
      aria-expanded={props.hasChildren ? props.isExpanded : undefined}
      aria-level={props.depth + 1}
      tabindex={props.isFocused ? 0 : -1}
      data-uuid={props.node.uuid}
      data-depth={props.depth}
      data-kind={props.node.kind.type}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
    >
      {/* Expand toggle */}
      <Show when={props.hasChildren}>
        <button
          class="sigil-tree-node__expand"
          aria-label={props.isExpanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleExpand(props.node.uuid);
          }}
        >
          {props.isExpanded ? "\u25BE" : "\u25B8"}
        </button>
      </Show>
      <Show when={!props.hasChildren}>
        <span class="sigil-tree-node__expand-spacer" />
      </Show>

      {/* Kind icon */}
      <span class="sigil-tree-node__icon" aria-hidden="true">
        {kindIcon(props.node.kind.type)}
      </span>

      {/* Name */}
      <Show
        when={!isRenaming()}
        fallback={
          <input
            ref={(el) => {
              inputRef = el;
            }}
            class="sigil-tree-node__name-input"
            aria-label={`Rename ${props.node.name}`}
            value={props.node.name}
            maxLength={1024}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
          />
        }
      >
        <span class="sigil-tree-node__name">{props.node.name}</span>
      </Show>

      {/* Spacer */}
      <span class="sigil-tree-node__spacer" />

      {/* Lock toggle — removed from tab order (use L key on focused node) */}
      <button
        class="sigil-tree-node__toggle"
        classList={{ "sigil-tree-node__toggle--active": props.node.locked }}
        aria-label={props.node.locked ? "Unlock" : "Lock"}
        tabindex={-1}
        onClick={handleLockToggle}
      >
        {props.node.locked ? "\u{1F512}" : "\u{1F513}"}
      </button>

      {/* Visibility toggle — removed from tab order (use H key on focused node) */}
      <button
        class="sigil-tree-node__toggle"
        classList={{ "sigil-tree-node__toggle--active": !props.node.visible }}
        aria-label={props.node.visible ? "Hide" : "Show"}
        tabindex={-1}
        onClick={handleVisibilityToggle}
      >
        {props.node.visible ? "\u{1F441}" : "\u{1F441}\u200D\u{1F5E8}"}
      </button>
    </div>
  );
};

export { kindIcon };
