import { type Component } from "solid-js";

interface PlaceholderPanelProps {
  readonly title: string;
  readonly message?: string;
}

export const PlaceholderPanel: Component<PlaceholderPanelProps> = (props) => {
  return (
    <div class="sigil-schema-panel__empty" role="status">
      <p>{props.message ?? `${props.title} -- coming soon`}</p>
    </div>
  );
};
