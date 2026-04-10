import { Show, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { useDocument } from "../store/document-context";
import "./StatusBar.css";

export const StatusBar: Component = () => {
  const store = useDocument();
  const [t] = useTransContext();

  const zoomPercent = () => Math.round(store.viewport().zoom * 100);

  return (
    <div class="status-bar" role="status">
      <div class="status-bar__left">
        {/* RF-009: aria-hidden on indicator dot; adjacent span provides accessible name */}
        <div
          class={`status-bar__indicator ${
            store.connected()
              ? "status-bar__indicator--connected"
              : "status-bar__indicator--disconnected"
          }`}
          aria-hidden="true"
        />
        <span>{store.connected() ? t("common:connected") : t("common:disconnected")}</span>
      </div>
      <div class="status-bar__right">
        <Show when={store.state.info.name}>
          <span>{store.state.info.name}</span>
        </Show>
        <span>{t("a11y:status.nodes", { count: store.state.info.node_count })}</span>
        <span>{t("a11y:status.pages", { count: store.state.info.page_count })}</span>
        <span>{zoomPercent()}%</span>
      </div>
    </div>
  );
};
