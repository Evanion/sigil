import { type Component } from "solid-js";
import { DocumentProvider } from "./store/document-context";
import { createDocumentStoreSolid } from "./store/document-store-solid";
import { Toolbar } from "./shell/Toolbar";
import { StatusBar } from "./shell/StatusBar";
import "./App.css";

// Temporary placeholder until Task 5 (Solid Canvas wrapper)
const CanvasPlaceholder: Component = () => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "#11111b",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      color: "#585b70",
    }}
  >
    Canvas (pending)
  </div>
);

const App: Component = () => {
  const store = createDocumentStoreSolid();

  return (
    <DocumentProvider store={store}>
      <div class="app-shell">
        <Toolbar />
        <div class="app-shell__left" role="complementary" aria-label="Left panel">
          <div class="placeholder-panel">
            <h2 class="placeholder-panel__heading">Layers</h2>
          </div>
        </div>
        <div class="app-shell__canvas">
          <CanvasPlaceholder />
        </div>
        <div class="app-shell__right" role="complementary" aria-label="Right panel">
          <div class="placeholder-panel">
            <h2 class="placeholder-panel__heading">Properties</h2>
          </div>
        </div>
        <StatusBar />
      </div>
    </DocumentProvider>
  );
};

export default App;
