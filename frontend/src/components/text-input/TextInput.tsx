import { TextField } from "@kobalte/core/text-field";
import { Show, splitProps } from "solid-js";
import "./TextInput.css";

export interface TextInputProps {
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  "aria-label"?: string;
}

export function TextInput(props: TextInputProps) {
  const [local, others] = splitProps(props, [
    "value",
    "onValueChange",
    "label",
    "placeholder",
    "disabled",
    "class",
  ]);

  const className = (): string => {
    const classes = ["sigil-text-input"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <TextField
      class={className()}
      value={local.value}
      onChange={local.onValueChange}
      disabled={local.disabled}
      {...others}
    >
      <Show when={local.label}>
        <TextField.Label class="sigil-text-input__label">{local.label}</TextField.Label>
      </Show>
      <TextField.Input class="sigil-text-input__input" placeholder={local.placeholder} />
    </TextField>
  );
}
