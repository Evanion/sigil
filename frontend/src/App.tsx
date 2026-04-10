import { createSignal, type Component } from "solid-js";
import { TransProvider, useTransContext } from "@mbarzda/solid-i18next";
import { DragDropProvider } from "dnd-kit-solid";
import { i18nInstance } from "./i18n";
import { DocumentProvider } from "./store/document-context";
import { createDocumentStoreSolid } from "./store/document-store-solid";
import { Toolbar } from "./shell/Toolbar";
import { Canvas } from "./shell/Canvas";
import { StatusBar } from "./shell/StatusBar";
import { AnnounceProvider } from "./shell/AnnounceProvider";
import { TabRegion } from "./panels/TabRegion";
import { registerDefaultPanels } from "./panels/register-panels";
import "./App.css";

/**
 * Inner shell component — rendered inside TransProvider so useTransContext is available.
 */
const AppShell: Component = () => {
  const [t] = useTransContext();
  const store = createDocumentStoreSolid();
  registerDefaultPanels(store);
  const [announcement, setAnnouncement] = createSignal("");

  /** Push a message into the ARIA live region for screen readers. */
  function announce(message: string): void {
    // Clear then set to ensure the same message is re-announced if repeated.
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(message));
  }

  return (
    <DocumentProvider store={store}>
      <AnnounceProvider announce={announce}>
        {/* DnD announcements handled by useDragDropMonitor in LayersTree (WCAG 2.1 SC 4.1.3). */}
        <DragDropProvider>
          <div class="app-shell">
            {/* RF-018: Wrap Toolbar in grid-placed div */}
            <div class="app-shell__toolbar">
              <Toolbar />
            </div>
            <div
              class="app-shell__left"
              role="complementary"
              aria-label={t("panels:regions.leftPanel")}
            >
              <TabRegion region="left" />
            </div>
            {/* RF-006: role="main" on the canvas wrapper, not the canvas element */}
            <div class="app-shell__canvas" role="main">
              <Canvas />
            </div>
            <div
              class="app-shell__right"
              role="complementary"
              aria-label={t("panels:regions.rightPanel")}
            >
              <TabRegion region="right" />
            </div>
            {/* RF-018: Wrap StatusBar in grid-placed div */}
            <div class="app-shell__status">
              <StatusBar />
            </div>
            {/* RF-001: Visually-hidden ARIA live region for screen reader announcements */}
            <div aria-live="polite" role="log" class="sr-only">
              {announcement()}
            </div>
          </div>
        </DragDropProvider>
      </AnnounceProvider>
    </DocumentProvider>
  );
};

const App: Component = () => {
  return (
    <TransProvider instance={i18nInstance}>
      <AppShell />
    </TransProvider>
  );
};

export default App;
