import { Show, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import "./StatusBar.css";

export const StatusBar: Component = () => {
  const store = useDocument();

  const zoomPercent = () => Math.round(store.viewport().zoom * 100);

  return (
    <div class="status-bar" role="status" aria-live="polite">
      <div class="status-bar__left">
        <div
          class={`status-bar__indicator ${
            store.connected()
              ? "status-bar__indicator--connected"
              : "status-bar__indicator--disconnected"
          }`}
          aria-label={store.connected() ? "Connected" : "Disconnected"}
        />
        <span>{store.connected() ? "Connected" : "Disconnected"}</span>
      </div>
      <div class="status-bar__right">
        <Show when={store.state.info.name}>
          <span>{store.state.info.name}</span>
        </Show>
        <span>{store.state.info.node_count} nodes</span>
        <span>{store.state.info.page_count} pages</span>
        <span>{zoomPercent()}%</span>
      </div>
    </div>
  );
};
