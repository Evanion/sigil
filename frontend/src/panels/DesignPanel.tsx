import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { SchemaPanel } from "./SchemaPanel";
import { designSchema } from "./schemas/design-schema";
import { AppearancePanel } from "./AppearancePanel";
import { EffectsPanel } from "./EffectsPanel";
import { AlignPanel } from "./AlignPanel";
import { TypographySection } from "./TypographySection";
import { CornerSection } from "./corner-section/CornerSection";
import type { DocumentNode } from "../types/document";
import { useDocument } from "../store/document-context";
import "./DesignPanel.css";

type DesignTab = "layout" | "appearance" | "effects";

const TABS: readonly DesignTab[] = ["layout", "appearance", "effects"] as const;

/**
 * DesignPanel renders the right-panel "Design" tab with three sub-tabs:
 * Layout (schema-driven), Appearance (Plan 09c Task 4), Effects (Plan 09c Task 5).
 *
 * Tab navigation follows the WAI-ARIA Tabs pattern with roving tabindex.
 * ArrowLeft/ArrowRight navigate between tabs with wrapping.
 */
export const DesignPanel: Component = () => {
  const [t] = useTransContext();
  const store = useDocument();
  const [activeTab, setActiveTab] = createSignal<DesignTab>("layout");

  const selectedNode = createMemo((): DocumentNode | null => {
    const uuid = store.selectedNodeId();
    if (!uuid) return null;
    return (store.state.nodes[uuid] as DocumentNode | undefined) ?? null;
  });

  const isTextNodeSelected = createMemo((): boolean => {
    const node = selectedNode();
    if (!node) return false;
    return node.kind.type === "text";
  });

  function handleKeyDown(e: KeyboardEvent): void {
    const currentIndex = TABS.indexOf(activeTab());
    let nextIndex = -1;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    }

    if (nextIndex >= 0) {
      const next = TABS[nextIndex];
      if (next !== undefined) {
        setActiveTab(next);
        // Focus the newly-active tab button (roving tabindex pattern)
        const tabBar = e.currentTarget as HTMLElement;
        const buttons = tabBar.querySelectorAll<HTMLButtonElement>("[role='tab']");
        buttons[nextIndex]?.focus();
      }
    }
  }

  return (
    <div class="sigil-design-panel">
      <div
        class="sigil-design-panel__tabs"
        role="tablist"
        aria-label={t("panels:regions.designPanelTabs")}
        onKeyDown={handleKeyDown}
      >
        <For each={TABS}>
          {(tab) => (
            <button
              class="sigil-design-panel__tab"
              classList={{ "sigil-design-panel__tab--active": activeTab() === tab }}
              role="tab"
              id={`design-tab-${tab}`}
              aria-controls={`design-tabpanel-${tab}`}
              aria-selected={activeTab() === tab}
              tabIndex={activeTab() === tab ? 0 : -1}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          )}
        </For>
      </div>
      <div
        class="sigil-design-panel__content"
        role="tabpanel"
        id={`design-tabpanel-${activeTab()}`}
        aria-labelledby={`design-tab-${activeTab()}`}
      >
        <Show when={activeTab() === "layout"}>
          <AlignPanel />
          <SchemaPanel schema={designSchema} />
        </Show>
        <Show when={activeTab() === "appearance"}>
          {/* RF-018: Typography belongs in the Appearance tab alongside fill/stroke/effects */}
          <Show when={isTextNodeSelected()}>
            <TypographySection />
          </Show>
          {/*
           * Plan 14d Task 16: CornerSection replaces the schema-driven
           * Corner Radius 4-input grid in design-schema.ts. CornerSection's
           * `node` prop is non-nullable — gate on selectedNode() so it
           * only renders when a node is selected. RF-038 handles the
           * "not a corner-bearing kind" branch inside the component
           * (disabled placeholder for ellipse/text/group/path).
           */}
          <Show when={selectedNode()}>
            {(node) => (
              <CornerSection
                node={node()}
                onCorners={(corners) => store.setCorners(node().uuid, corners)}
              />
            )}
          </Show>
          <AppearancePanel />
        </Show>
        <Show when={activeTab() === "effects"}>
          <EffectsPanel />
        </Show>
      </div>
    </div>
  );
};
