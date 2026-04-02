import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { ToggleButton } from "./ToggleButton";

describe("ToggleButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render as a button element", () => {
    render(() => (
      <ToggleButton pressed={false} onPressedChange={() => {}}>
        Bold
      </ToggleButton>
    ));
    const btn = screen.getByText("Bold");
    expect(btn.tagName.toLowerCase()).toBe("button");
  });

  it("should always include the base sigil-toggle-button class", () => {
    render(() => (
      <ToggleButton pressed={false} onPressedChange={() => {}}>
        Bold
      </ToggleButton>
    ));
    const btn = screen.getByText("Bold");
    expect(btn.classList.contains("sigil-toggle-button")).toBe(true);
  });

  it("should add the pressed class when pressed is true", () => {
    render(() => (
      <ToggleButton pressed={true} onPressedChange={() => {}}>
        Bold
      </ToggleButton>
    ));
    const btn = screen.getByText("Bold");
    expect(btn.classList.contains("sigil-toggle-button--pressed")).toBe(true);
  });

  it("should not have the pressed class when pressed is false", () => {
    render(() => (
      <ToggleButton pressed={false} onPressedChange={() => {}}>
        Bold
      </ToggleButton>
    ));
    const btn = screen.getByText("Bold");
    expect(btn.classList.contains("sigil-toggle-button--pressed")).toBe(false);
  });

  it("should set aria-pressed to true when pressed", () => {
    render(() => (
      <ToggleButton pressed={true} onPressedChange={() => {}}>
        Bold
      </ToggleButton>
    ));
    const btn = screen.getByText("Bold");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("should set aria-pressed to false when not pressed", () => {
    render(() => (
      <ToggleButton pressed={false} onPressedChange={() => {}}>
        Bold
      </ToggleButton>
    ));
    const btn = screen.getByText("Bold");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("should call onPressedChange when clicked", () => {
    const handler = vi.fn();
    render(() => (
      <ToggleButton pressed={false} onPressedChange={handler}>
        Bold
      </ToggleButton>
    ));
    screen.getByText("Bold").click();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(true);
  });

  it("should set the disabled attribute when disabled prop is true", () => {
    render(() => (
      <ToggleButton pressed={false} onPressedChange={() => {}} disabled>
        Bold
      </ToggleButton>
    ));
    const btn = screen.getByText("Bold");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("should forward aria-label to the underlying element", () => {
    render(() => (
      <ToggleButton
        pressed={false}
        onPressedChange={() => {}}
        aria-label="Toggle bold"
      >
        B
      </ToggleButton>
    ));
    const btn = screen.getByLabelText("Toggle bold");
    expect(btn).toBeTruthy();
  });

  it("should append custom class names alongside component classes", () => {
    render(() => (
      <ToggleButton
        pressed={false}
        onPressedChange={() => {}}
        class="my-custom"
      >
        Bold
      </ToggleButton>
    ));
    const btn = screen.getByText("Bold");
    expect(btn.classList.contains("my-custom")).toBe(true);
    expect(btn.classList.contains("sigil-toggle-button")).toBe(true);
  });
});
