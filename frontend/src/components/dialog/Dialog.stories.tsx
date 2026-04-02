import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Dialog } from "./Dialog";
import { Button } from "../button/Button";

const meta: Meta<typeof Dialog> = {
  title: "Components/Dialog",
  component: Dialog,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <Dialog open={open()} onOpenChange={setOpen} title="Default Dialog">
          <p>This is the dialog body content.</p>
        </Dialog>
      </>
    );
  },
};

export const WithDescription: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open With Description</Button>
        <Dialog
          open={open()}
          onOpenChange={setOpen}
          title="Confirm Action"
          description="This action cannot be undone. Please review before proceeding."
        >
          <p>Are you sure you want to continue?</p>
        </Dialog>
      </>
    );
  },
};

export const WithFormContent: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Form Dialog</Button>
        <Dialog open={open()} onOpenChange={setOpen} title="Create Component">
          <form
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "var(--size-3)",
            }}
          >
            <label style={{ display: "flex", "flex-direction": "column", gap: "var(--size-1)" }}>
              <span>Name</span>
              <input
                type="text"
                placeholder="Component name"
                style={{
                  padding: "var(--size-2)",
                  background: "var(--surface-4)",
                  border: "1px solid var(--border-1)",
                  "border-radius": "var(--radius-2)",
                  color: "var(--text-1)",
                }}
              />
            </label>
            <label style={{ display: "flex", "flex-direction": "column", gap: "var(--size-1)" }}>
              <span>Description</span>
              <textarea
                placeholder="Optional description"
                rows={3}
                style={{
                  padding: "var(--size-2)",
                  background: "var(--surface-4)",
                  border: "1px solid var(--border-1)",
                  "border-radius": "var(--radius-2)",
                  color: "var(--text-1)",
                  resize: "vertical",
                }}
              />
            </label>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Create
            </Button>
          </form>
        </Dialog>
      </>
    );
  },
};
