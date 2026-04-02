/**
 * Tests for the Popover component.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@solidjs/testing-library";
import { Popover } from "./Popover";

afterEach(() => {
  cleanup();
});

describe("Popover", () => {
  it("should render the trigger element", () => {
    render(() => (
      <Popover trigger={<button>Open</button>}>
        <p>Popover content</p>
      </Popover>
    ));
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("should show content when trigger is clicked", async () => {
    render(() => (
      <Popover trigger={<button>Toggle</button>}>
        <p>Revealed content</p>
      </Popover>
    ));
    expect(screen.queryByText("Revealed content")).toBeNull();
    fireEvent.click(screen.getByText("Toggle"));
    await waitFor(() => {
      expect(screen.getByText("Revealed content")).toBeTruthy();
    });
  });

  it("should apply the sigil-popover class to the content element", async () => {
    render(() => (
      <Popover trigger={<button>Style trigger</button>}>
        <p>Styled content</p>
      </Popover>
    ));
    fireEvent.click(screen.getByText("Style trigger"));
    await waitFor(() => {
      const content = screen.getByText("Styled content");
      expect(content.closest(".sigil-popover")).toBeTruthy();
    });
  });

  it("should render children inside the popover content", async () => {
    render(() => (
      <Popover trigger={<button>Children trigger</button>}>
        <span>Child A</span>
        <span>Child B</span>
      </Popover>
    ));
    fireEvent.click(screen.getByText("Children trigger"));
    await waitFor(() => {
      expect(screen.getByText("Child A")).toBeTruthy();
      expect(screen.getByText("Child B")).toBeTruthy();
    });
  });

  it("should append custom class names alongside the base class", async () => {
    render(() => (
      <Popover trigger={<button>Custom trigger</button>} class="my-custom">
        <p>Custom content</p>
      </Popover>
    ));
    fireEvent.click(screen.getByText("Custom trigger"));
    await waitFor(() => {
      const content = screen.getByText("Custom content").closest(".sigil-popover");
      expect(content).toBeTruthy();
      expect(content?.classList.contains("my-custom")).toBe(true);
    });
  });
});
