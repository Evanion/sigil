import {
  createMemo,
  createSignal,
  createEffect,
  For,
  Show,
  Dynamic,
  type Component,
} from "solid-js";
import { panels, type PanelRegistration } from "./registry";
import "./TabRegion.css";

interface TabRegionProps {
  readonly region: "left" | "right";
}

export const TabRegion: Component<TabRegionProps> = (props) => {
  const visiblePanels = createMemo(() =>
    panels
      .filter(
        (p: PanelRegistration) =>
          p.region === props.region && (p.visible?.() ?? true),
      )
      .sort((a: PanelRegistration, b: PanelRegistration) => a.order - b.order),
  );

  const defaultTab = createMemo(
    () =>
      visiblePanels().find((p: PanelRegistration) => p.default)?.id ??
      visiblePanels()[0]?.id ??
      "",
  );

  const [activeTab, setActiveTab] = createSignal(defaultTab());

  // If the active tab becomes invisible, fall back to default
  createEffect(() => {
    const visible = visiblePanels();
    const current = activeTab();
    if (!visible.some((p: PanelRegistration) => p.id === current)) {
      setActiveTab(defaultTab());
    }
  });

  const activePanel = createMemo(() =>
    visiblePanels().find((p: PanelRegistration) => p.id === activeTab()),
  );

  // Keyboard navigation between tabs
  function handleTabKeyDown(e: KeyboardEvent) {
    const visible = visiblePanels();
    const currentIndex = visible.findIndex(
      (p: PanelRegistration) => p.id === activeTab(),
    );
    let nextIndex = -1;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % visible.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + visible.length) % visible.length;
    }

    if (nextIndex >= 0) {
      const next = visible[nextIndex];
      if (next) {
        setActiveTab(next.id);
        // Focus the tab button
        const tabBar = e.currentTarget as HTMLElement;
        const buttons =
          tabBar.querySelectorAll<HTMLButtonElement>("[role='tab']");
        buttons[nextIndex]?.focus();
      }
    }
  }

  return (
    <div class="sigil-tab-region">
      <div
        class="sigil-tab-region__bar"
        role="tablist"
        onKeyDown={handleTabKeyDown}
      >
        <For each={visiblePanels()}>
          {(panel) => (
            <button
              class="sigil-tab-region__tab"
              role="tab"
              aria-selected={activeTab() === panel.id}
              tabindex={activeTab() === panel.id ? 0 : -1}
              onClick={() => setActiveTab(panel.id)}
            >
              {panel.label}
            </button>
          )}
        </For>
      </div>
      <div class="sigil-tab-region__content" role="tabpanel">
        <Show when={activePanel()}>
          {(panel) => <Dynamic component={panel().component} />}
        </Show>
      </div>
    </div>
  );
};
