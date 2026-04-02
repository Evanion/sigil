/**
 * Tests for the Dialog component.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@solidjs/testing-library";
import { Dialog } from "./Dialog";

afterEach(() => {
  cleanup();
});

describe("Dialog", () => {
  it("should render title when open", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Test Title">
        <p>Body content</p>
      </Dialog>
    ));
    expect(screen.getByText("Test Title")).toBeTruthy();
  });

  it("should not render content when closed", () => {
    render(() => (
      <Dialog open={false} onOpenChange={() => {}} title="Hidden Title">
        <p>Hidden content</p>
      </Dialog>
    ));
    expect(screen.queryByText("Hidden Title")).toBeNull();
    expect(screen.queryByText("Hidden content")).toBeNull();
  });

  it("should fire onOpenChange with false when close button is clicked", async () => {
    const handler = vi.fn();
    render(() => (
      <Dialog open={true} onOpenChange={handler} title="Closable">
        <p>Content</p>
      </Dialog>
    ));
    const closeButton = document.querySelector(".sigil-dialog__close");
    expect(closeButton).toBeTruthy();
    if (!closeButton) throw new Error("Close button not found");
    fireEvent.click(closeButton);
    await waitFor(() => {
      expect(handler).toHaveBeenCalledWith(false);
    });
  });

  it("should show description when provided", () => {
    render(() => (
      <Dialog
        open={true}
        onOpenChange={() => {}}
        title="With Desc"
        description="A helpful description"
      >
        <p>Body</p>
      </Dialog>
    ));
    expect(screen.getByText("A helpful description")).toBeTruthy();
  });

  it("should render children in body", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Children Test">
        <p>Child content here</p>
      </Dialog>
    ));
    expect(screen.getByText("Child content here")).toBeTruthy();
    const body = screen
      .getByText("Child content here")
      .closest(".sigil-dialog__body");
    expect(body).toBeTruthy();
  });

  it("should have dialog role", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Role Test">
        <p>Content</p>
      </Dialog>
    ));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("should apply custom class on content", () => {
    render(() => (
      <Dialog
        open={true}
        onOpenChange={() => {}}
        title="Custom Class"
        class="my-custom-dialog"
      >
        <p>Content</p>
      </Dialog>
    ));
    const content = document.querySelector(".sigil-dialog");
    expect(content).toBeTruthy();
    expect(content?.classList.contains("my-custom-dialog")).toBe(true);
  });
});
