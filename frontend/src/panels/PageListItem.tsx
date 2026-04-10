/**
 * A single page row in the PagesPanel list.
 *
 * Displays a drag handle, thumbnail, page name (editable on double-click/F2),
 * and active indicator. Supports keyboard navigation via roving tabindex.
 */

import { createSignal, createEffect, onMount, Show, splitProps, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { useDraggable, useDroppable } from "dnd-kit-solid";
import { GripVertical } from "lucide-solid";
import type { Page } from "../types/document";
import type { PageDragData } from "../dnd/types";
import { MAX_PAGE_NAME_LENGTH } from "../store/document-store-solid";
import "./PageListItem.css";

export interface PageListItemProps {
  readonly page: Page;
  readonly isActive: boolean;
  readonly onSelect: (pageId: string) => void;
  readonly onRename: (pageId: string, newName: string) => void;
  readonly onDelete: (pageId: string) => void;
  readonly thumbnailCanvas: HTMLCanvasElement | null;
  readonly isFocused: boolean;
  readonly tabIndex: number;
  /** When true, immediately enters rename mode (RF-007: replaces synthetic dblclick). */
  readonly requestRename?: boolean;
  /** Called after rename mode is entered from requestRename, to reset the signal. */
  readonly onRenameStarted?: () => void;
}

export const PageListItem: Component<PageListItemProps> = (rawProps) => {
  const [props] = splitProps(rawProps, [
    "page",
    "isActive",
    "onSelect",
    "onRename",
    "onDelete",
    "thumbnailCanvas",
    "isFocused",
    "tabIndex",
    "requestRename",
    "onRenameStarted",
  ]);

  const [t] = useTransContext();
  const [isRenaming, setIsRenaming] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let thumbnailRef: HTMLDivElement | undefined;

  // RF-002: DnD — draggable via the drag handle.
  const dragData: PageDragData = { type: "page", pageId: props.page.id };
  const { isDragging, ref: dragRef } = useDraggable({
    id: `page-drag-${props.page.id}`,
    data: dragData,
  });

  // RF-002: DnD — droppable on the entire row for reorder targeting.
  const { isDropTarget, ref: dropRef } = useDroppable({
    id: `page-drop-${props.page.id}`,
    data: dragData,
  });

  // Mount the thumbnail canvas element when available.
  onMount(() => {
    updateThumbnail();
  });

  function updateThumbnail(): void {
    if (!thumbnailRef) return;
    // Clear existing children.
    while (thumbnailRef.firstChild) {
      thumbnailRef.removeChild(thumbnailRef.firstChild);
    }
    if (props.thumbnailCanvas) {
      thumbnailRef.appendChild(props.thumbnailCanvas);
    }
  }

  // Re-mount thumbnail when the parent passes a new canvas element (RF-003).
  createEffect(() => {
    // Track the thumbnailCanvas prop reactively.
    const _canvas = props.thumbnailCanvas;
    void _canvas;
    updateThumbnail();
  });

  // RF-007: Enter rename mode when parent requests it via prop (replaces synthetic dblclick).
  createEffect(() => {
    if (props.requestRename) {
      startRename();
      props.onRenameStarted?.();
    }
  });

  function handleClick(): void {
    props.onSelect(props.page.id);
  }

  function handleDoubleClick(e: MouseEvent): void {
    e.preventDefault();
    startRename();
  }

  function startRename(): void {
    setIsRenaming(true);
    requestAnimationFrame(() => {
      inputRef?.focus();
      inputRef?.select();
    });
  }

  function commitRename(): void {
    const value = inputRef?.value.trim();
    if (value && value !== props.page.name) {
      props.onRename(props.page.id, value);
    }
    setIsRenaming(false);
  }

  function handleRenameKeyDown(e: KeyboardEvent): void {
    // Stop propagation to prevent document-level shortcut handlers
    // from acting during overlay edit mode (CLAUDE.md: overlay-mode keyboard handlers).
    e.stopPropagation();

    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsRenaming(false);
    }
  }

  function handleItemKeyDown(e: KeyboardEvent): void {
    if (isRenaming()) return;

    if (e.key === "F2") {
      e.preventDefault();
      startRename();
    } else if (e.key === "Delete") {
      e.preventDefault();
      props.onDelete(props.page.id);
    }
  }

  return (
    <div
      ref={(el) => dropRef(el)}
      class="sigil-page-list-item"
      classList={{
        "sigil-page-list-item--active": props.isActive,
        "sigil-page-list-item--focused": props.isFocused,
        "sigil-page-list-item--dragging": isDragging(),
        "sigil-page-list-item--drop-target": isDropTarget(),
      }}
      role="option"
      aria-selected={props.isActive}
      tabindex={props.tabIndex}
      data-page-id={props.page.id}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
      onKeyDown={handleItemKeyDown}
    >
      {/* Drag handle (RF-002: wired to useDraggable) */}
      <button
        ref={(el) => dragRef(el)}
        class="sigil-page-list-item__handle"
        aria-label={t("panels:pages.dragPage", { name: props.page.name })}
        tabindex={-1}
      >
        <GripVertical size={14} />
      </button>

      {/* Thumbnail */}
      <div
        ref={(el) => {
          thumbnailRef = el;
          updateThumbnail();
        }}
        class="sigil-page-list-item__thumbnail"
        aria-hidden="true"
      />

      {/* Page name */}
      <Show
        when={!isRenaming()}
        fallback={
          <input
            ref={(el) => {
              inputRef = el;
            }}
            class="sigil-page-list-item__name-input"
            aria-label={t("panels:pages.renamePage", { name: props.page.name })}
            value={props.page.name}
            maxLength={MAX_PAGE_NAME_LENGTH}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
          />
        }
      >
        <span class="sigil-page-list-item__name">{props.page.name}</span>
      </Show>
    </div>
  );
};
