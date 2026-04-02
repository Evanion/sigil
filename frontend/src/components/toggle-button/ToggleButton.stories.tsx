import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { ToggleButton } from "./ToggleButton";

const meta: Meta<typeof ToggleButton> = {
  title: "Components/ToggleButton",
  component: ToggleButton,
  tags: ["autodocs"],
  argTypes: {
    pressed: { control: "boolean" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof ToggleButton>;

export const Default: Story = {
  args: {
    pressed: false,
    onPressedChange: () => {},
    children: "B",
    "aria-label": "Toggle bold",
  },
};

export const Pressed: Story = {
  args: {
    pressed: true,
    onPressedChange: () => {},
    children: "B",
    "aria-label": "Toggle bold",
  },
};

export const Disabled: Story = {
  args: {
    pressed: false,
    onPressedChange: () => {},
    children: "B",
    disabled: true,
    "aria-label": "Toggle bold",
  },
};

export const Interactive: Story = {
  render: () => {
    const [pressed, setPressed] = createSignal(false);
    return (
      <ToggleButton
        pressed={pressed()}
        onPressedChange={setPressed}
        aria-label="Toggle bold"
      >
        B
      </ToggleButton>
    );
  },
};
