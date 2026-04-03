import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { useAnnounce } from "../shell/AnnounceProvider";
import { panels, type PanelRegistration } from "./registry";
import "./TabRegion.css";

interface TabRegionProps {
  readonly region: "left" | "right";
}

export const TabRegion: Component<TabRegionProps> = (props) => {
  const announce = useAnnounce();

  const visiblePanels = createMemo(() =>
    panels
      .filter((p: PanelRegistration) => p.region === props.region && (p.visible?.() ?? true))
      .sort((a: PanelRegistration, b: PanelRegistration) => a.order - b.order),
  );

  const defaultTab = createMemo(
    () =>
      visiblePanels().find((p: PanelRegistration) => p.default)?.id ?? visiblePanels()[0]?.id ?? "",
  );

  // RF-003: User-selected tab tracked separately; activeTab memo falls back to defaultTab reactively
  const [_userTab, setUserTab] = createSignal<string | null>(null);
  const activeTab = createMemo(() => {
    const user = _userTab();
    const visible = visiblePanels();
    if (user && visible.some((p: PanelRegistration) => p.id === user)) return user;
    return defaultTab();
  });

  const activePanel = createMemo(() =>
    visiblePanels().find((p: PanelRegistration) => p.id === activeTab()),
  );

  // Keyboard navigation between tabs
  function handleTabKeyDown(e: KeyboardEvent) {
    const visible = visiblePanels();
    const currentIndex = visible.findIndex((p: PanelRegistration) => p.id === activeTab());
    let nextIndex = -1;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % visible.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + visible.length) % visible.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = visible.length - 1;
    }

    if (nextIndex >= 0) {
      const next = visible[nextIndex];
      if (next) {
        setUserTab(next.id);
        announce(`${next.label} panel`);
        // Focus the tab button
        const tabBar = e.currentTarget as HTMLElement;
        const buttons = tabBar.querySelectorAll<HTMLButtonElement>("[role='tab']");
        buttons[nextIndex]?.focus();
      }
    }
  }

  return (
    <div class="sigil-tab-region">
      <div
        class="sigil-tab-region__bar"
        role="tablist"
        aria-label={props.region === "left" ? "Left panel tabs" : "Right panel tabs"}
        onKeyDown={handleTabKeyDown}
      >
        <For each={visiblePanels()}>
          {(panel) => (
            <button
              id={`sigil-tab-${props.region}-${panel.id}`}
              class="sigil-tab-region__tab"
              role="tab"
              aria-selected={activeTab() === panel.id}
              aria-controls={`sigil-tabpanel-${props.region}`}
              tabindex={activeTab() === panel.id ? 0 : -1}
              onClick={() => {
                setUserTab(panel.id);
                announce(`${panel.label} panel`);
              }}
            >
              {panel.label}
            </button>
          )}
        </For>
      </div>
      <div
        id={`sigil-tabpanel-${props.region}`}
        class="sigil-tab-region__content"
        role="tabpanel"
        aria-labelledby={
          activePanel()?.id ? `sigil-tab-${props.region}-${activePanel()?.id ?? ""}` : undefined
        }
      >
        <Show when={activePanel()}>{(panel) => <Dynamic component={panel().component} />}</Show>
      </div>
    </div>
  );
};
