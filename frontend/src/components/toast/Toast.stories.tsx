import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../button/Button";
import { ToastRegion, showToast } from "./Toast";

function ToastDemo(props: { variant: "info" | "success" | "error" | "warning" }) {
  return (
    <div>
      <Button
        variant={props.variant === "error" ? "danger" : "secondary"}
        onClick={() =>
          showToast({
            title: `${props.variant.charAt(0).toUpperCase() + props.variant.slice(1)} toast`,
            variant: props.variant,
          })
        }
      >
        Show {props.variant}
      </Button>
      <ToastRegion />
    </div>
  );
}

const meta: Meta<typeof ToastDemo> = {
  title: "Components/Toast",
  component: ToastDemo,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: { type: "select" },
      options: ["info", "success", "error", "warning"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof ToastDemo>;

export const Info: Story = {
  args: { variant: "info" },
};

export const Success: Story = {
  args: { variant: "success" },
};

export const Error: Story = {
  args: { variant: "error" },
};

export const Warning: Story = {
  args: { variant: "warning" },
};

function WithDescriptionDemo() {
  return (
    <div>
      <Button
        variant="primary"
        onClick={() =>
          showToast({
            title: "File saved",
            description: "Your changes have been saved successfully.",
            variant: "success",
          })
        }
      >
        Show toast with description
      </Button>
      <ToastRegion />
    </div>
  );
}

export const WithDescription: StoryObj<typeof WithDescriptionDemo> = {
  render: () => <WithDescriptionDemo />,
};
