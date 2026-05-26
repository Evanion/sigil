import { Select as KobalteSelect } from "@kobalte/core/select";
import { Show, splitProps } from "solid-js";
import { Check, ChevronDown } from "lucide-solid";
import "./Select.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  "aria-label"?: string;
  /**
   * ID of an external element that labels the trigger. When provided, the
   * Trigger button receives `aria-labelledby` so a visible `<label>` becomes
   * the accessible name without duplicating announcement via `aria-label`.
   * Per a11y-rules.md "Label association" — callers must pick ONE of
   * `aria-label` or `aria-labelledby`, never both.
   */
  "aria-labelledby"?: string;
  /**
   * ID(s) of element(s) that describe the trigger (e.g., a "Mixed" badge that
   * communicates non-uniform underlying state). Surfaced via
   * `aria-describedby` on the Trigger button so screen readers announce the
   * description as part of the control's accessible context.
   */
  "aria-describedby"?: string;
}

export function Select(props: SelectProps) {
  const [local, others] = splitProps(props, [
    "options",
    "value",
    "onValueChange",
    "label",
    "placeholder",
    "disabled",
    "class",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
  ]);

  const className = (): string => {
    const classes = ["sigil-select"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  const selectedOption = (): SelectOption | undefined =>
    local.options.find((o) => o.value === local.value);

  return (
    <KobalteSelect<SelectOption>
      class={className()}
      options={[...local.options]}
      optionValue="value"
      optionTextValue="label"
      value={selectedOption()}
      onChange={(option) => {
        if (option) {
          local.onValueChange(option.value);
        }
      }}
      placeholder={local.placeholder}
      disabled={local.disabled}
      itemComponent={(itemProps) => (
        <KobalteSelect.Item item={itemProps.item} class="sigil-select__item">
          <KobalteSelect.ItemLabel>{itemProps.item.rawValue.label}</KobalteSelect.ItemLabel>
          <KobalteSelect.ItemIndicator class="sigil-select__item-indicator">
            <Check size={12} />
          </KobalteSelect.ItemIndicator>
        </KobalteSelect.Item>
      )}
      {...others}
    >
      <Show when={local.label}>
        <KobalteSelect.Label class="sigil-select__label">{local.label}</KobalteSelect.Label>
      </Show>
      <KobalteSelect.Trigger
        class="sigil-select__trigger"
        aria-label={
          local["aria-labelledby"] === undefined && !local.label ? local["aria-label"] : undefined
        }
        aria-labelledby={local["aria-labelledby"]}
        aria-describedby={local["aria-describedby"]}
      >
        <KobalteSelect.Value<SelectOption>>
          {(state) => state.selectedOption()?.label ?? local.placeholder ?? ""}
        </KobalteSelect.Value>
        <KobalteSelect.Icon class="sigil-select__icon">
          <ChevronDown size={14} />
        </KobalteSelect.Icon>
      </KobalteSelect.Trigger>
      <KobalteSelect.Portal>
        <KobalteSelect.Content class="sigil-select__content">
          <KobalteSelect.Listbox class="sigil-select__listbox" />
        </KobalteSelect.Content>
      </KobalteSelect.Portal>
    </KobalteSelect>
  );
}
