import { type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";

interface PlaceholderPanelProps {
  readonly title: string;
  readonly message?: string;
}

export const PlaceholderPanel: Component<PlaceholderPanelProps> = (props) => {
  const [t] = useTransContext();
  return (
    <div class="sigil-schema-panel__empty" role="status">
      <p>{props.message ?? t("panels:placeholder.comingSoon", { title: props.title })}</p>
    </div>
  );
};
