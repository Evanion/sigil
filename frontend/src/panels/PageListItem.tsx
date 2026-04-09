/**
 * A single page row in the PagesPanel list.
 *
 * Displays a drag handle, thumbnail, page name (editable on double-click/F2),
 * and active indicator. Supports keyboard navigation via roving tabindex.
 */

import { createSignal, onMount, Show, splitProps, type Component } from "solid-js";
import { GripVertical } from "lucide-solid";
import type { Page } from "../types/document";
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
  ]);

  const [isRenaming, setIsRenaming] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let thumbnailRef: HTMLDivElement | undefined;

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

  // Re-mount thumbnail when it changes. We use a getter pattern
  // since the parent passes new canvas elements when nodes change.
  // This is called from the parent via effect.

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
      class="sigil-page-list-item"
      classList={{
        "sigil-page-list-item--active": props.isActive,
        "sigil-page-list-item--focused": props.isFocused,
      }}
      role="option"
      aria-selected={props.isActive}
      tabindex={props.tabIndex}
      data-page-id={props.page.id}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
      onKeyDown={handleItemKeyDown}
    >
      {/* Drag handle */}
      <span class="sigil-page-list-item__handle" aria-hidden="true">
        <GripVertical size={14} />
      </span>

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
            aria-label={`Rename ${props.page.name}`}
            value={props.page.name}
            maxLength={256}
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
