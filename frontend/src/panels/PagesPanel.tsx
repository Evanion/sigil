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
import { useTransContext } from "@mbarzda/solid-i18next";
import { useDragDropMonitor } from "dnd-kit-solid";
import { Plus } from "lucide-solid";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "../shell/AnnounceProvider";
import { PageListItem } from "./PageListItem";
import { renderPageThumbnail } from "./page-thumbnail";
import { drawNodeForThumbnail } from "./page-thumbnail-draw";
import type { PageDragData } from "../dnd/types";
import "./PagesPanel.css";

/** Debounce delay for thumbnail re-rendering (ms). */
const THUMBNAIL_DEBOUNCE_MS = 300;

export const PagesPanel: Component = () => {
  const store = useDocument();
  const announce = useAnnounce();
  const [t] = useTransContext();
  const [focusedPageId, setFocusedPageId] = createSignal<string | null>(null);
  const [thumbnails, setThumbnails] = createSignal<Record<string, HTMLCanvasElement>>({});
  /** RF-007: Page ID that should enter rename mode (replaces synthetic dblclick). */
  const [renameRequestId, setRenameRequestId] = createSignal<string | null>(null);
  let listRef: HTMLDivElement | undefined;
  let thumbnailTimer: ReturnType<typeof setTimeout> | undefined;
  /** rAF handle for focusPage — must be cancelled in onCleanup (RF-006). */
  let focusRafHandle: number | undefined;

  // ── Thumbnail rendering ─────────────────────────────────────────────

  function renderThumbnails(): void {
    const pages = store.state.pages;
    const nodes = store.state.nodes;
    const result: Record<string, HTMLCanvasElement> = {};

    for (const page of pages) {
      // Use per-page root node UUIDs if available (populated during parsePagesResponse).
      // Falls back to all root nodes if rootNodeUuids is not populated (e.g., remotely created pages).
      const pageWithUuids = page as typeof page & { rootNodeUuids?: string[] };
      let rootUuids: string[];
      if (pageWithUuids.rootNodeUuids && pageWithUuids.rootNodeUuids.length > 0) {
        rootUuids = pageWithUuids.rootNodeUuids;
      } else {
        // Fallback: collect all root nodes (parentUuid === null).
        // Known limitation: when multiple pages exist and rootNodeUuids is not populated,
        // all pages will show the same thumbnail. This will be resolved when the server
        // provides explicit page-to-node mapping.
        rootUuids = [];
        for (const uuid of Object.keys(nodes)) {
          const node = nodes[uuid];
          if (node && node.parentUuid === null) {
            rootUuids.push(uuid);
          }
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

  // RF-017: Initialize focusedPageId to the first page when pages load,
  // so isFocused never falls back to positional pages[0].
  createEffect(() => {
    const pages = store.state.pages;
    if (pages.length > 0 && focusedPageId() === null) {
      setFocusedPageId(pages[0].id);
    }
  });

  // Cleanup timer and rAF on unmount (CLAUDE.md: timers must be cleared on teardown).
  onCleanup(() => {
    if (thumbnailTimer !== undefined) {
      clearTimeout(thumbnailTimer);
      thumbnailTimer = undefined;
    }
    if (focusRafHandle !== undefined) {
      cancelAnimationFrame(focusRafHandle);
      focusRafHandle = undefined;
    }
  });

  // ── DnD reorder (RF-002) ────────────────────────────────────────────

  /** Index where a drop indicator should be shown, or null if no drag in progress. */
  const [dropIndicatorIndex, setDropIndicatorIndex] = createSignal<number | null>(null);

  /** Height of a single page row in pixels (used for drop index calculation). */
  const PAGE_ROW_HEIGHT = 56;

  useDragDropMonitor({
    onDragStart(event) {
      const source = event.operation.source;
      if (!source) return;
      const data = source.data as PageDragData | undefined;
      if (data?.type !== "page") return;
      const page = store.state.pages.find((p) => p.id === data.pageId);
      if (page) {
        announce(t("a11y:page.grabbed", { name: page.name }));
      }
    },

    onDragOver(event) {
      const source = event.operation.source;
      const target = event.operation.target;
      if (!source || !target) {
        setDropIndicatorIndex(null);
        return;
      }

      const sourceData = source.data as PageDragData | undefined;
      const targetData = target.data as PageDragData | undefined;
      if (sourceData?.type !== "page" || targetData?.type !== "page") {
        setDropIndicatorIndex(null);
        return;
      }

      const pages = store.state.pages;
      const targetIndex = pages.findIndex((p) => p.id === targetData.pageId);
      if (targetIndex === -1) {
        setDropIndicatorIndex(null);
        return;
      }

      // Compute whether cursor is in the top or bottom half of the target row.
      const targetEl = target.element;
      if (!targetEl) {
        setDropIndicatorIndex(targetIndex);
        return;
      }
      const rect = targetEl.getBoundingClientRect();
      // Access cursor Y from the native event if available.
      const nativeEvent = (event as unknown as { nativeEvent?: PointerEvent }).nativeEvent;
      const cursorY = nativeEvent?.clientY ?? rect.top + rect.height / 2;
      const midY = rect.top + rect.height / 2;
      const insertIndex = cursorY < midY ? targetIndex : targetIndex + 1;

      setDropIndicatorIndex(insertIndex);
    },

    onDragEnd(event) {
      const insertIndex = dropIndicatorIndex();
      setDropIndicatorIndex(null);

      const source = event.operation.source;
      if (!source) return;
      const sourceData = source.data as PageDragData | undefined;
      if (sourceData?.type !== "page") return;
      if (insertIndex === null) return;

      const pages = store.state.pages;
      const sourceIndex = pages.findIndex((p) => p.id === sourceData.pageId);
      if (sourceIndex === -1) return;

      // Adjust target index since removal shifts positions.
      const adjustedTarget = insertIndex > sourceIndex ? insertIndex - 1 : insertIndex;
      if (adjustedTarget !== sourceIndex && adjustedTarget >= 0 && adjustedTarget < pages.length) {
        store.reorderPages(sourceData.pageId, adjustedTarget);
        const page = pages.find((p) => p.id === sourceData.pageId);
        if (page) {
          announce(
            t("a11y:page.movedToPosition", {
              name: page.name,
              position: String(adjustedTarget + 1),
            }),
          );
        }
      }
    },
  });

  // ── Page mutations ──────────────────────────────────────────────────

  function handleCreatePage(): void {
    // RF-020: Extract existing page numbers and use max+1 to avoid duplicates.
    const pages = store.state.pages;
    const pageNumberPattern = /^Page\s+(\d+)$/;
    let maxNumber = 0;
    for (const p of pages) {
      const match = pageNumberPattern.exec(p.name);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (Number.isFinite(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }
    const name = `Page ${maxNumber + 1}`;
    store.createPage(name);
    announce(t("a11y:page.created", { name }));
  }

  function handleSelectPage(pageId: string): void {
    store.setActivePage(pageId);
    setFocusedPageId(pageId);
    const page = store.state.pages.find((p) => p.id === pageId);
    if (page) {
      announce(t("a11y:page.selected", { name: page.name }));
    }
  }

  function handleRenamePage(pageId: string, newName: string): void {
    store.renamePage(pageId, newName);
    announce(t("a11y:page.renamed", { name: newName }));
  }

  function handleDeletePage(pageId: string): void {
    const pages = store.state.pages;
    if (pages.length <= 1) {
      announce(t("panels:pages.cannotDeleteLast"));
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
    announce(t("a11y:page.deleted", { name: pageName }));
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
            announce(t("a11y:page.movedDown", { name: page.name }));
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
            announce(t("a11y:page.movedUp", { name: page.name }));
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
          // RF-007: Use signal to trigger rename mode instead of synthetic dblclick.
          setRenameRequestId(currentFocused);
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
    // Cancel any pending focus rAF before scheduling a new one (RF-006).
    if (focusRafHandle !== undefined) {
      cancelAnimationFrame(focusRafHandle);
    }
    focusRafHandle = requestAnimationFrame(() => {
      focusRafHandle = undefined;
      const el = listRef?.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "nearest" });
        el.focus();
      }
    });
  }

  return (
    <div class="sigil-pages-panel" role="region" aria-label={t("panels:pages.title")}>
      <div class="sigil-pages-panel__header">
        <h3 class="sigil-pages-panel__title">{t("panels:pages.title")}</h3>
        <button
          class="sigil-pages-panel__add-button"
          aria-label={t("panels:pages.addPage")}
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
        aria-label={t("panels:pages.pageList")}
        onKeyDown={handleKeyDown}
        style={{ position: "relative" }}
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
              isFocused={focusedPageId() === page().id}
              tabIndex={getTabIndex(page().id)}
              requestRename={renameRequestId() === page().id}
              onRenameStarted={() => setRenameRequestId(null)}
            />
          )}
        </Index>
        {/* RF-002: Drop indicator line for DnD reorder */}
        <Show when={dropIndicatorIndex() !== null}>
          <div
            class="sigil-pages-panel__drop-indicator"
            style={{ top: `${(dropIndicatorIndex() ?? 0) * PAGE_ROW_HEIGHT}px` }}
            aria-hidden="true"
          />
        </Show>
        <Show when={store.state.pages.length === 0}>
          <div class="sigil-pages-panel__empty" role="status">
            {t("panels:pages.noPages")}
          </div>
        </Show>
      </div>
    </div>
  );
};
