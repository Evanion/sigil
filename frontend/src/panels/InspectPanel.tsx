import { type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { PlaceholderPanel } from "./PlaceholderPanel";

export const InspectPanel: Component = () => {
  const [t] = useTransContext();
  return (
    <PlaceholderPanel
      title={t("panels:tabs.inspect")}
      message={t("panels:placeholder.inspectMessage")}
    />
  );
};
