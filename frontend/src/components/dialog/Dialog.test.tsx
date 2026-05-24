/**
 * Tests for the Dialog component (native <dialog> implementation).
 *
 * jsdom provides partial <dialog> support — `showModal()` and `close()`
 * methods exist but don't behave identically to browsers (no focus trap,
 * no Escape handling, no ::backdrop). Tests verify DOM structure, prop
 * wiring, and callback behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { Dialog } from "./Dialog";

afterEach(() => {
  cleanup();
});

// jsdom's HTMLDialogElement may not have showModal/close — stub if needed
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
  }
  if (!HTMLDialogElement.prototype.close) {
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      if (originalClose) {
        try {
          originalClose.call(this);
        } catch {
          // jsdom may throw — ignore
        }
      }
    });
  }
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

  it("should render as a dialog element", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Dialog Element">
        <p>Content</p>
      </Dialog>
    ));
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
  });

  it("should have the sigil-dialog class", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Class Test">
        <p>Content</p>
      </Dialog>
    ));
    const dialog = document.querySelector("dialog.sigil-dialog");
    expect(dialog).toBeTruthy();
  });

  it("should fire onOpenChange with false when close button is clicked", () => {
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
    expect(handler).toHaveBeenCalledWith(false);
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
    const body = screen.getByText("Child content here").closest(".sigil-dialog__body");
    expect(body).toBeTruthy();
  });

  it("should have dialog role", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Role Test">
        <p>Content</p>
      </Dialog>
    ));
    // Native <dialog> has implicit role="dialog"
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("should apply custom class on dialog element", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Custom Class" class="my-custom-dialog">
        <p>Content</p>
      </Dialog>
    ));
    const dialog = document.querySelector("dialog.sigil-dialog");
    expect(dialog).toBeTruthy();
    expect(dialog?.classList.contains("my-custom-dialog")).toBe(true);
  });

  it("should have aria-labelledby pointing to title", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Labeled Dialog">
        <p>Content</p>
      </Dialog>
    ));
    const dialog = document.querySelector("dialog");
    const titleId = dialog?.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    if (!titleId) throw new Error("aria-labelledby not found");
    const titleEl = document.getElementById(titleId);
    expect(titleEl?.textContent).toBe("Labeled Dialog");
  });

  it("should have aria-describedby when description is provided", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="Described" description="Helpful info">
        <p>Content</p>
      </Dialog>
    ));
    const dialog = document.querySelector("dialog");
    const descId = dialog?.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    if (!descId) throw new Error("aria-describedby not found");
    const descEl = document.getElementById(descId);
    expect(descEl?.textContent).toBe("Helpful info");
  });

  it("should not have aria-describedby when no description", () => {
    render(() => (
      <Dialog open={true} onOpenChange={() => {}} title="No Desc">
        <p>Content</p>
      </Dialog>
    ));
    const dialog = document.querySelector("dialog");
    expect(dialog?.getAttribute("aria-describedby")).toBeNull();
  });
});
