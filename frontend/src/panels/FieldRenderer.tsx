import { type Component, Switch, Match } from "solid-js";
import type { FieldDef } from "./schema/types";
import { NumberInput } from "../components/number-input/NumberInput";
import { Slider } from "../components/slider/Slider";
import { TextInput } from "../components/text-input/TextInput";
import { Select } from "../components/select/Select";
import { Toggle } from "../components/toggle/Toggle";

interface FieldRendererProps {
  readonly field: FieldDef;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}

export const FieldRenderer: Component<FieldRendererProps> = (props) => {
  return (
    <Switch fallback={<span>{String(props.value ?? "")}</span>}>
      <Match when={props.field.type === "number"}>
        <NumberInput
          value={typeof props.value === "number" ? props.value : 0}
          onValueChange={(v) => {
            if (Number.isFinite(v)) props.onChange(v);
          }}
          prefix={props.field.label}
          step={props.field.step ?? 1}
          min={props.field.min}
          max={props.field.max}
          suffix={props.field.suffix}
          aria-label={props.field.ariaLabel ?? props.field.label}
        />
      </Match>
      <Match when={props.field.type === "slider"}>
        <Slider
          value={typeof props.value === "number" ? props.value : 0}
          onChange={(v) => props.onChange(v)}
          min={props.field.min ?? 0}
          max={props.field.max ?? 100}
          step={props.field.step ?? 1}
          ariaLabel={props.field.ariaLabel ?? props.field.label}
        />
      </Match>
      <Match when={props.field.type === "text"}>
        <TextInput
          value={typeof props.value === "string" ? props.value : ""}
          onValueChange={(v) => props.onChange(v)}
          prefix={props.field.label}
          aria-label={props.field.ariaLabel ?? props.field.label}
        />
      </Match>
      <Match when={props.field.type === "select" && props.field.options}>
        <Select
          value={String(props.value ?? "")}
          onValueChange={(v) => props.onChange(v)}
          options={
            props.field.options?.map((o) => ({
              value: o.value,
              label: o.label,
            })) ?? []
          }
          aria-label={props.field.ariaLabel ?? props.field.label}
        />
      </Match>
      <Match when={props.field.type === "toggle"}>
        <Toggle
          checked={Boolean(props.value)}
          onCheckedChange={(v) => props.onChange(v)}
          aria-label={props.field.ariaLabel ?? props.field.label}
        />
      </Match>
    </Switch>
  );
};
