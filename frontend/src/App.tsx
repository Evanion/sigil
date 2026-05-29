import { createSignal, onCleanup, type Component } from "solid-js";
import type { UnlistenFn } from "@tauri-apps/api/event";
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
import { TokenEditorProvider } from "./panels/token-editor-context";
import { TokenEditor } from "./panels/token-editor/TokenEditor";
import { installMenuListener } from "./transport/menu-events";
import "./App.css";

/**
 * Inner shell component — rendered inside TransProvider so useTransContext is available.
 */
const AppShell: Component = () => {
  const [t] = useTransContext();
  const store = createDocumentStoreSolid();
  registerDefaultPanels(store);
  // RF-018: release the urql/WS client + Tauri event listeners when the
  // editor unmounts (HMR, test teardown). Without this the store leaks its
  // listeners across reloads — fine in production where the SPA lives for
  // the document lifetime, but a correctness gap that test harnesses surface.
  onCleanup(() => store.destroy());
  const [announcement, setAnnouncement] = createSignal("");
  const [tokenEditorOpen, setTokenEditorOpen] = createSignal(false);
  const tokenEditorValue = {
    isOpen: tokenEditorOpen,
    open: () => setTokenEditorOpen(true),
    close: () => setTokenEditorOpen(false),
  };

  /** Push a message into the ARIA live region for screen readers. */
  function announce(message: string): void {
    // Clear then set to ensure the same message is re-announced if repeated.
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(message));
  }

  // RF-001: Wire the native menubar's menu-action events to store handlers.
  // The cleanup handle must be registered synchronously during setup
  // (frontend-defensive.md: "Never call Solid.js onCleanup inside a Promise.then
  // ... onCleanup registers with the reactive owner active at call time").
  const [menuUnlisten, setMenuUnlisten] = createSignal<UnlistenFn | null>(null);
  onCleanup(() => {
    const fn = menuUnlisten();
    if (fn) fn();
  });
  installMenuListener({
    onUndo: () => store.undo(),
    onRedo: () => store.redo(),
    // File/Zoom handlers are owned by the Tauri shell (open/new dialogs invoke
    // Tauri commands; window-close is handled by the OS via Cmd+W; zoom is
    // deferred per spec §6 — needs viewport state exposure to a menu-level
    // handler in a follow-up).
  })
    .then((unlisten) => {
      if (unlisten) setMenuUnlisten(() => unlisten);
    })
    .catch((err) => {
      console.error("installMenuListener failed:", err);
    });

  return (
    <DocumentProvider store={store}>
      <AnnounceProvider announce={announce}>
        <TokenEditorProvider value={tokenEditorValue}>
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
            <TokenEditor isOpen={tokenEditorOpen()} onClose={() => setTokenEditorOpen(false)} />
          </DragDropProvider>
        </TokenEditorProvider>
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
