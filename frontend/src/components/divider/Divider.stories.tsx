import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Divider } from "./Divider";

const meta: Meta<typeof Divider> = {
  title: "Components/Divider",
  component: Divider,
  tags: ["autodocs"],
  argTypes: {
    orientation: {
      control: "select",
      options: ["horizontal", "vertical"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Divider>;

export const Horizontal: Story = {
  args: {
    orientation: "horizontal",
  },
  decorators: [
    (Story) => (
      <div style={{ width: "300px", color: "var(--text-1)" }}>
        <p>Content above</p>
        <Story />
        <p>Content below</p>
      </div>
    ),
  ],
};

export const Vertical: Story = {
  args: {
    orientation: "vertical",
  },
  decorators: [
    (Story) => (
      <div
        style={{
          display: "flex",
          "align-items": "center",
          height: "48px",
          color: "var(--text-1)",
        }}
      >
        <span>Left</span>
        <Story />
        <span>Right</span>
      </div>
    ),
  ],
};
