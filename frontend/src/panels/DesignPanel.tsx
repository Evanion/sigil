import { createSignal, For, Show, type Component } from "solid-js";
import { SchemaPanel } from "./SchemaPanel";
import { designSchema } from "./schemas/design-schema";
import { AppearancePanel } from "./AppearancePanel";
import { EffectsPanel } from "./EffectsPanel";
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
  const [activeTab, setActiveTab] = createSignal<DesignTab>("layout");

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
        aria-label="Design panel tabs"
        onKeyDown={handleKeyDown}
      >
        <For each={TABS}>
          {(tab) => (
            <button
              class="sigil-design-panel__tab"
              classList={{ "sigil-design-panel__tab--active": activeTab() === tab }}
              role="tab"
              id={`design-tab-${tab}`}
              aria-controls="design-tabpanel"
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
        id="design-tabpanel"
        aria-labelledby={`design-tab-${activeTab()}`}
      >
        <Show when={activeTab() === "layout"}>
          <SchemaPanel schema={designSchema} />
        </Show>
        <Show when={activeTab() === "appearance"}>
          <AppearancePanel />
        </Show>
        <Show when={activeTab() === "effects"}>
          <EffectsPanel />
        </Show>
      </div>
    </div>
  );
};
