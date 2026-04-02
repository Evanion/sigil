import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { TextInput } from "./TextInput";

const meta: Meta<typeof TextInput> = {
  title: "Components/TextInput",
  component: TextInput,
  tags: ["autodocs"],
  argTypes: {
    value: { control: "text" },
    label: { control: "text" },
    placeholder: { control: "text" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof TextInput>;

export const Default: Story = {
  args: {
    value: "",
    onValueChange: () => {},
    placeholder: "Enter text...",
    "aria-label": "Default text input",
  },
};

export const WithLabel: Story = {
  args: {
    value: "",
    onValueChange: () => {},
    label: "Node name",
    placeholder: "Enter node name...",
  },
};

export const WithValue: Story = {
  args: {
    value: "Rectangle 1",
    onValueChange: () => {},
    label: "Layer name",
  },
};

export const Disabled: Story = {
  args: {
    value: "Locked value",
    onValueChange: () => {},
    label: "Read-only field",
    disabled: true,
  },
};

export const Interactive: Story = {
  render: () => {
    const [value, setValue] = createSignal("");
    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <TextInput
          value={value()}
          onValueChange={setValue}
          label="Interactive"
          placeholder="Type something..."
        />
        <span style={{ color: "var(--text-2)", "font-size": "12px" }}>
          Current value: {value()}
        </span>
      </div>
    );
  },
};
