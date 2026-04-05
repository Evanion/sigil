import { For, createSignal, createEffect, onMount, onCleanup, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "./AnnounceProvider";
import type { ToolType } from "../store/document-store-solid";
import { tinykeys } from "tinykeys";
import "./Toolbar.css";

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: string;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", shortcut: "V", icon: "V" },
  { id: "frame", label: "Frame", shortcut: "F", icon: "F" },
  { id: "rectangle", label: "Rectangle", shortcut: "R", icon: "R" },
  { id: "ellipse", label: "Ellipse", shortcut: "O", icon: "O" },
];

export const Toolbar: Component = () => {
  const store = useDocument();
  const announce = useAnnounce();

  // RF-023: Use a refs array instead of fragile DOM child index
  const buttonRefs: HTMLButtonElement[] = [];

  // Roving tabindex: only active tool button is tabbable
  const [focusedIndex, setFocusedIndex] = createSignal(0);

  // Keep focusedIndex in sync with activeTool
  createEffect(() => {
    const idx = TOOLS.findIndex((t) => t.id === store.activeTool());
    if (idx >= 0) setFocusedIndex(idx);
  });

  // RF-001: Announce active tool changes to screen readers
  createEffect(() => {
    const tool = TOOLS.find((t) => t.id === store.activeTool());
    if (tool) {
      announce(`${tool.label} tool active`);
    }
  });

  // Keyboard shortcuts for tool selection (skip if user is typing in an input)
  onMount(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    };

    const unsubscribe = tinykeys(window, {
      v: (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          store.setActiveTool("select");
        }
      },
      f: (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          store.setActiveTool("frame");
        }
      },
      r: (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          store.setActiveTool("rectangle");
        }
      },
      o: (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          store.setActiveTool("ellipse");
        }
      },
    });

    onCleanup(unsubscribe);
  });

  // RF-007: Arrow keys only move focus, do not activate tool
  function handleToolbarKeydown(e: KeyboardEvent) {
    const len = TOOLS.length;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = (focusedIndex() + 1) % len;
      setFocusedIndex(next);
      buttonRefs[next]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = (focusedIndex() - 1 + len) % len;
      setFocusedIndex(prev);
      buttonRefs[prev]?.focus();
    }
  }

  return (
    <div
      class="toolbar"
      role="toolbar"
      aria-label="Design tools"
      aria-orientation="vertical"
      onKeyDown={handleToolbarKeydown}
    >
      <div class="toolbar__logo" aria-hidden="true">
        SIGIL
      </div>
      <For each={TOOLS}>
        {(tool, index) => (
          <button
            ref={(el) => {
              buttonRefs[index()] = el;
            }}
            class="toolbar__btn"
            aria-pressed={store.activeTool() === tool.id}
            aria-label={`${tool.label} (${tool.shortcut})`}
            tabindex={focusedIndex() === index() ? 0 : -1}
            onClick={() => store.setActiveTool(tool.id)}
          >
            {tool.icon}
          </button>
        )}
      </For>
    </div>
  );
};
