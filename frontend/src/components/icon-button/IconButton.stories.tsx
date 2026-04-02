import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MousePointer, Square, Circle, Frame, Type, Pen } from "lucide-solid";
import { IconButton } from "./IconButton";

const meta: Meta<typeof IconButton> = {
  title: "Components/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  argTypes: {
    active: { control: "boolean" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Select: Story = {
  args: { icon: MousePointer, "aria-label": "Select tool" },
};

export const Rectangle: Story = {
  args: { icon: Square, "aria-label": "Rectangle tool" },
};

export const Ellipse: Story = {
  args: { icon: Circle, "aria-label": "Ellipse tool" },
};

export const FrameTool: Story = {
  args: { icon: Frame, "aria-label": "Frame tool" },
};

export const TextTool: Story = {
  args: { icon: Type, "aria-label": "Text tool" },
};

export const PenTool: Story = {
  args: { icon: Pen, "aria-label": "Pen tool" },
};

export const Active: Story = {
  args: { icon: MousePointer, "aria-label": "Select tool", active: true },
};

export const Disabled: Story = {
  args: { icon: Square, "aria-label": "Rectangle tool", disabled: true },
};
