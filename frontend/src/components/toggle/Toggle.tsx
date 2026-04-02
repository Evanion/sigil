import { Switch } from "@kobalte/core/switch";
import { Show, splitProps } from "solid-js";
import "./Toggle.css";

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  class?: string;
  "aria-label"?: string;
}

export function Toggle(props: ToggleProps) {
  const [local, others] = splitProps(props, [
    "checked",
    "onCheckedChange",
    "label",
    "disabled",
    "class",
  ]);

  const className = () => {
    const classes = ["sigil-toggle"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <Switch
      class={className()}
      checked={local.checked}
      onChange={local.onCheckedChange}
      disabled={local.disabled}
      {...others}
    >
      <Switch.Input />
      <Switch.Control class="sigil-toggle__track">
        <Switch.Thumb class="sigil-toggle__thumb" />
      </Switch.Control>
      <Show when={local.label}>
        <Switch.Label class="sigil-toggle__label">{local.label}</Switch.Label>
      </Show>
    </Switch>
  );
}
