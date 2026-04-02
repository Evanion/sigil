import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: { type: "select" },
      options: ["primary", "secondary", "ghost", "danger"],
    },
    size: {
      control: { type: "select" },
      options: ["sm", "md", "lg"],
    },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: "primary", children: "Primary Button" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Secondary Button" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Ghost Button" },
};

export const Danger: Story = {
  args: { variant: "danger", children: "Delete" },
};

export const Small: Story = {
  args: { variant: "secondary", size: "sm", children: "Small" },
};

export const Large: Story = {
  args: { variant: "primary", size: "lg", children: "Large Button" },
};

export const Disabled: Story = {
  args: { variant: "primary", disabled: true, children: "Disabled" },
};
