/**
 * Pages panel — lists all pages in the document, with DnD reorder,
 * inline rename, keyboard navigation, and thumbnail previews.
 *
 * A11y audit of replaced PlaceholderPanel:
 * - No aria-live regions (placeholder was static text).
 * - No focus management calls.
 * - No keyboard event handlers.
 * All are intentionally absent in the placeholder; this implementation
 * adds them as new behavior.
 */

import { createSignal, createEffect, onCleanup, Index, Show, type Component } from "solid-js";
import { Plus } from "lucide-solid";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "../shell/AnnounceProvider";
import { PageListItem } from "./PageListItem";
import { renderPageThumbnail } from "./page-thumbnail";
import { drawNodeForThumbnail } from "./page-thumbnail-draw";
import "./PagesPanel.css";

/** Debounce delay for thumbnail re-rendering (ms). */
const THUMBNAIL_DEBOUNCE_MS = 300;

export const PagesPanel: Component = () => {
  const store = useDocument();
  const announce = useAnnounce();
  const [focusedPageId, setFocusedPageId] = createSignal<string | null>(null);
  const [thumbnails, setThumbnails] = createSignal<Record<string, HTMLCanvasElement>>({});
  let listRef: HTMLDivElement | undefined;
  let thumbnailTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Thumbnail rendering ─────────────────────────────────────────────

  function renderThumbnails(): void {
    const pages = store.state.pages;
    const nodes = store.state.nodes;
    const result: Record<string, HTMLCanvasElement> = {};

    for (const page of pages) {
      // Collect root node UUIDs for this page.
      // Root nodes are nodes whose parentUuid is null.
      const rootUuids: string[] = [];
      for (const uuid of Object.keys(nodes)) {
        const node = nodes[uuid];
        if (node && node.parentUuid === null) {
          rootUuids.push(uuid);
        }
      }

      // Cast nodes to the shape expected by renderPageThumbnail.
      // The store nodes include extra fields (parentUuid, childrenUuids)
      // but are structurally compatible with DocumentNode.
      const canvas = renderPageThumbnail(
        nodes as Parameters<typeof renderPageThumbnail>[0],
        rootUuids,
        drawNodeForThumbnail,
      );
      result[page.id] = canvas;
    }

    setThumbnails(result);
  }

  // Debounced thumbnail rendering effect.
  createEffect(() => {
    // Track dependencies: pages and nodes.
    const _pages = store.state.pages;
    const _nodes = store.state.nodes;
    // Suppress unused-variable lint: dependency tracking only.
    void _pages;
    void _nodes;

    if (thumbnailTimer !== undefined) {
      clearTimeout(thumbnailTimer);
    }
    thumbnailTimer = setTimeout(() => {
      renderThumbnails();
      thumbnailTimer = undefined;
    }, THUMBNAIL_DEBOUNCE_MS);
  });

  // Cleanup timer on unmount (CLAUDE.md: timers must be cleared on teardown).
  onCleanup(() => {
    if (thumbnailTimer !== undefined) {
      clearTimeout(thumbnailTimer);
      thumbnailTimer = undefined;
    }
  });

  // ── Page mutations ──────────────────────────────────────────────────

  function handleCreatePage(): void {
    const pageCount = store.state.pages.length;
    const name = `Page ${pageCount + 1}`;
    store.createPage(name);
    announce(`Created ${name}`);
  }

  function handleSelectPage(pageId: string): void {
    store.setActivePage(pageId);
    setFocusedPageId(pageId);
    const page = store.state.pages.find((p) => p.id === pageId);
    if (page) {
      announce(`${page.name} selected`);
    }
  }

  function handleRenamePage(pageId: string, newName: string): void {
    store.renamePage(pageId, newName);
    announce(`Renamed to ${newName}`);
  }

  function handleDeletePage(pageId: string): void {
    const pages = store.state.pages;
    if (pages.length <= 1) {
      announce("Cannot delete the last page");
      return;
    }
    const page = pages.find((p) => p.id === pageId);
    const pageName = page?.name ?? "Page";

    // Compute next focus target before deletion.
    const pageIndex = pages.findIndex((p) => p.id === pageId);
    let nextFocusId: string | null = null;
    if (pageIndex !== -1 && pages.length > 1) {
      const nextIdx = pageIndex < pages.length - 1 ? pageIndex + 1 : pageIndex - 1;
      const nextPage = pages[nextIdx];
      if (nextPage) {
        nextFocusId = nextPage.id;
      }
    }

    store.deletePage(pageId);
    announce(`${pageName} deleted`);
    if (nextFocusId) {
      setFocusedPageId(nextFocusId);
    }
  }

  // ── Keyboard navigation ─────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent): void {
    const pages = store.state.pages;
    if (pages.length === 0) return;

    const currentFocused = focusedPageId();
    const currentIndex = currentFocused ? pages.findIndex((p) => p.id === currentFocused) : -1;

    switch (e.key) {
      case "ArrowDown": {
        if (e.altKey) {
          // Alt+ArrowDown: move page down (WCAG 2.1.1 keyboard equivalent for DnD reorder).
          e.preventDefault();
          if (currentIndex === -1 || currentIndex >= pages.length - 1) break;
          const page = pages[currentIndex];
          if (page) {
            store.reorderPages(page.id, currentIndex + 1);
            announce(`${page.name} moved down`);
          }
          break;
        }
        e.preventDefault();
        if (currentIndex >= pages.length - 1) break;
        const nextIdx = currentIndex + 1;
        const nextPage = pages[nextIdx];
        if (nextPage) {
          setFocusedPageId(nextPage.id);
          focusPage(nextPage.id);
        }
        break;
      }

      case "ArrowUp": {
        if (e.altKey) {
          // Alt+ArrowUp: move page up (WCAG 2.1.1 keyboard equivalent for DnD reorder).
          e.preventDefault();
          if (currentIndex <= 0) break;
          const page = pages[currentIndex];
          if (page) {
            store.reorderPages(page.id, currentIndex - 1);
            announce(`${page.name} moved up`);
          }
          break;
        }
        e.preventDefault();
        if (currentIndex <= 0) break;
        const prevIdx = currentIndex - 1;
        const prevPage = pages[prevIdx];
        if (prevPage) {
          setFocusedPageId(prevPage.id);
          focusPage(prevPage.id);
        }
        break;
      }

      case "Enter": {
        e.preventDefault();
        if (currentFocused) {
          handleSelectPage(currentFocused);
        }
        break;
      }

      case "F2": {
        e.preventDefault();
        if (currentFocused) {
          // Trigger rename via the PageListItem's internal mechanism.
          const el = listRef?.querySelector(`[data-page-id="${CSS.escape(currentFocused)}"]`);
          if (el) {
            el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
          }
        }
        break;
      }

      case "Delete": {
        e.preventDefault();
        if (currentFocused) {
          handleDeletePage(currentFocused);
        }
        break;
      }

      default:
        break;
    }
  }

  /** Ensure at least one page has tabindex=0 for keyboard entry. */
  function getTabIndex(pageId: string): number {
    const focused = focusedPageId();
    if (focused) return focused === pageId ? 0 : -1;
    // Default: first page gets tabindex 0.
    const firstPage = store.state.pages[0];
    return firstPage?.id === pageId ? 0 : -1;
  }

  /** Scroll to a page item and move DOM focus to it (roving tabindex). */
  function focusPage(pageId: string): void {
    requestAnimationFrame(() => {
      const el = listRef?.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "nearest" });
        el.focus();
      }
    });
  }

  return (
    <div class="sigil-pages-panel" role="region" aria-label="Pages">
      <div class="sigil-pages-panel__header">
        <h3 class="sigil-pages-panel__title">Pages</h3>
        <button
          class="sigil-pages-panel__add-button"
          aria-label="Add page"
          onClick={handleCreatePage}
        >
          <Plus size={16} />
        </button>
      </div>
      <div
        ref={(el) => {
          listRef = el;
        }}
        class="sigil-pages-panel__list"
        role="listbox"
        aria-label="Page list"
        onKeyDown={handleKeyDown}
      >
        <Index each={store.state.pages}>
          {(page) => (
            <PageListItem
              page={page()}
              isActive={store.activePageId() === page().id}
              onSelect={handleSelectPage}
              onRename={handleRenamePage}
              onDelete={handleDeletePage}
              thumbnailCanvas={thumbnails()[page().id] ?? null}
              isFocused={(focusedPageId() ?? store.state.pages[0]?.id) === page().id}
              tabIndex={getTabIndex(page().id)}
            />
          )}
        </Index>
        <Show when={store.state.pages.length === 0}>
          <div class="sigil-pages-panel__empty" role="status">
            No pages
          </div>
        </Show>
      </div>
    </div>
  );
};
