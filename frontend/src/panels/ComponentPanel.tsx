import { type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { PlaceholderPanel } from "./PlaceholderPanel";

export const ComponentPanel: Component = () => {
  const [t] = useTransContext();
  return (
    <PlaceholderPanel
      title={t("panels:tabs.component")}
      message={t("panels:placeholder.componentMessage")}
    />
  );
};
