import { TextField } from "@kobalte/core/text-field";
import { Show, splitProps } from "solid-js";
import "./TextInput.css";

export interface TextInputProps {
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  /** Short text rendered inside the input as a prefix (e.g., "Name"). */
  prefix?: string;
  /** Short text rendered inside the input as a suffix. */
  suffix?: string;
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
    "prefix",
    "suffix",
    "placeholder",
    "disabled",
    "class",
    "aria-label",
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
      <div class="sigil-text-input__group">
        <Show when={local.prefix}>
          <span class="sigil-text-input__prefix">{local.prefix}</span>
        </Show>
        <TextField.Input
          class="sigil-text-input__input"
          placeholder={local.placeholder}
          aria-label={!local.label ? local["aria-label"] : undefined}
        />
        <Show when={local.suffix}>
          <span class="sigil-text-input__suffix">{local.suffix}</span>
        </Show>
      </div>
    </TextField>
  );
}
