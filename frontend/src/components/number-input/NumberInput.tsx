import { NumberField } from "@kobalte/core/number-field";
import { Show, splitProps } from "solid-js";
import { ChevronUp, ChevronDown } from "lucide-solid";
import "./NumberInput.css";

export interface NumberInputProps {
  value: number;
  onValueChange: (value: number) => void;
  label?: string;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  class?: string;
  "aria-label"?: string;
}

export function NumberInput(props: NumberInputProps) {
  const [local, others] = splitProps(props, [
    "value",
    "onValueChange",
    "label",
    "step",
    "min",
    "max",
    "suffix",
    "disabled",
    "class",
    "aria-label",
  ]);

  const step = (): number => local.step ?? 1;

  const className = (): string => {
    const classes = ["sigil-number-input"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <NumberField
      class={className()}
      rawValue={local.value}
      onRawValueChange={local.onValueChange}
      step={step()}
      minValue={local.min}
      maxValue={local.max}
      disabled={local.disabled}
      aria-label={local["aria-label"]}
      {...others}
    >
      <Show when={local.label}>
        <NumberField.Label class="sigil-number-input__label">{local.label}</NumberField.Label>
      </Show>
      <div class="sigil-number-input__group">
        <NumberField.Input class="sigil-number-input__input" />
        <Show when={local.suffix}>
          <span class="sigil-number-input__suffix">{local.suffix}</span>
        </Show>
        <div class="sigil-number-input__buttons">
          <NumberField.IncrementTrigger aria-label="Increment" class="sigil-number-input__btn">
            <ChevronUp size={12} />
          </NumberField.IncrementTrigger>
          <NumberField.DecrementTrigger aria-label="Decrement" class="sigil-number-input__btn">
            <ChevronDown size={12} />
          </NumberField.DecrementTrigger>
        </div>
      </div>
    </NumberField>
  );
}
