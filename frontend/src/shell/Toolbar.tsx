import {
  For,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js";
import { MousePointer2, Frame, Square, Circle, Type } from "lucide-solid";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "./AnnounceProvider";
import { Tooltip } from "../components/tooltip/Tooltip";
import type { ToolType } from "../store/document-store-solid";
import { tinykeys } from "tinykeys";
import "./Toolbar.css";

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: (props: { size?: number }) => JSX.Element;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", shortcut: "V", icon: (p) => <MousePointer2 size={p.size} /> },
  { id: "frame", label: "Frame", shortcut: "F", icon: (p) => <Frame size={p.size} /> },
  { id: "rectangle", label: "Rectangle", shortcut: "R", icon: (p) => <Square size={p.size} /> },
  { id: "ellipse", label: "Ellipse", shortcut: "O", icon: (p) => <Circle size={p.size} /> },
  { id: "text", label: "Text", shortcut: "T", icon: (p) => <Type size={p.size} /> },
];

export const Toolbar: Component = () => {
  const store = useDocument();
  const announce = useAnnounce();

  const buttonRefs: HTMLButtonElement[] = [];

  // Roving tabindex: only active tool button is tabbable
  const [focusedIndex, setFocusedIndex] = createSignal(0);

  // Keep focusedIndex in sync with activeTool
  createEffect(() => {
    const idx = TOOLS.findIndex((t) => t.id === store.activeTool());
    if (idx >= 0) setFocusedIndex(idx);
  });

  // Announce active tool changes to screen readers
  createEffect(() => {
    const tool = TOOLS.find((t) => t.id === store.activeTool());
    if (tool) {
      announce(`${tool.label} tool active`);
    }
  });

  // Keyboard shortcuts (skip if typing in an input)
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
      t: (e: KeyboardEvent) => {
        if (!isTyping()) {
          e.preventDefault();
          store.setActiveTool("text");
        }
      },
    });

    onCleanup(unsubscribe);
  });

  // Arrow keys move focus within toolbar (roving tabindex)
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
          <Tooltip
            content={`${tool.label} (${tool.shortcut})`}
            placement="right"
            ref={(el) => {
              buttonRefs[index()] = el;
            }}
            triggerClass={`toolbar__btn${store.activeTool() === tool.id ? " toolbar__btn--active" : ""}`}
            aria-pressed={store.activeTool() === tool.id}
            aria-label={`${tool.label} (${tool.shortcut})`}
            tabIndex={focusedIndex() === index() ? 0 : -1}
            onClick={() => store.setActiveTool(tool.id)}
          >
            {tool.icon({ size: 16 })}
          </Tooltip>
        )}
      </For>
    </div>
  );
};
