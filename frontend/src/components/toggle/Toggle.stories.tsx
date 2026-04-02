import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Toggle } from "./Toggle";

const meta: Meta<typeof Toggle> = {
  title: "Components/Toggle",
  component: Toggle,
  tags: ["autodocs"],
  argTypes: {
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
    label: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof Toggle>;

export const Off: Story = {
  args: {
    checked: false,
    onCheckedChange: () => {},
    "aria-label": "Toggle off",
  },
};

export const On: Story = {
  args: {
    checked: true,
    onCheckedChange: () => {},
    "aria-label": "Toggle on",
  },
};

export const WithLabel: Story = {
  args: {
    checked: true,
    onCheckedChange: () => {},
    label: "Dark mode",
  },
};

export const Disabled: Story = {
  args: {
    checked: false,
    onCheckedChange: () => {},
    disabled: true,
    "aria-label": "Disabled toggle",
  },
};

export const Interactive: Story = {
  render: () => {
    const [checked, setChecked] = createSignal(false);
    return (
      <Toggle
        checked={checked()}
        onCheckedChange={setChecked}
        label={checked() ? "On" : "Off"}
      />
    );
  },
};
