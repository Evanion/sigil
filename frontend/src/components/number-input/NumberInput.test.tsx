import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { NumberInput } from "./NumberInput";

describe("NumberInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render an input element", () => {
    render(() => <NumberInput value={10} onValueChange={() => {}} />);
    const input = screen.getByRole("spinbutton");
    expect(input).toBeTruthy();
    expect(input.tagName.toLowerCase()).toBe("input");
  });

  it("should display the current value in the input", () => {
    render(() => <NumberInput value={42} onValueChange={() => {}} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("42");
  });

  it("should apply the base sigil-number-input class on root", () => {
    const { container } = render(() => <NumberInput value={0} onValueChange={() => {}} />);
    const root = container.querySelector(".sigil-number-input");
    expect(root).toBeTruthy();
  });

  it("should render a label when label prop is provided", () => {
    render(() => <NumberInput value={5} onValueChange={() => {}} label="Width" />);
    const label = screen.getByText("Width");
    expect(label).toBeTruthy();
    expect(label.classList.contains("sigil-number-input__label")).toBe(true);
  });

  it("should render increment and decrement buttons", () => {
    render(() => <NumberInput value={0} onValueChange={() => {}} />);
    const increment = screen.getByLabelText("Increment");
    const decrement = screen.getByLabelText("Decrement");
    expect(increment).toBeTruthy();
    expect(decrement).toBeTruthy();
  });

  it("should call onValueChange with value + step when increment is clicked", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={10} onValueChange={handler} step={5} />);
    fireEvent.click(screen.getByLabelText("Increment"));
    expect(handler).toHaveBeenCalledWith(15);
  });

  it("should call onValueChange with value - step when decrement is clicked", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={10} onValueChange={handler} step={5} />);
    fireEvent.click(screen.getByLabelText("Decrement"));
    expect(handler).toHaveBeenCalledWith(5);
  });

  it("should use step of 1 by default", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={10} onValueChange={handler} />);
    fireEvent.click(screen.getByLabelText("Increment"));
    expect(handler).toHaveBeenCalledWith(11);
  });

  it("should respect max constraint when incrementing", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={100} onValueChange={handler} max={100} />);
    fireEvent.click(screen.getByLabelText("Increment"));
    // Kobalte clamps, so the handler should not be called with a value above max
    // or it should be called with the clamped value
    if (handler.mock.calls.length > 0) {
      expect(handler.mock.calls[0][0]).toBeLessThanOrEqual(100);
    }
  });

  it("should respect min constraint when decrementing", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={0} onValueChange={handler} min={0} />);
    fireEvent.click(screen.getByLabelText("Decrement"));
    // Kobalte clamps, so the handler should not be called with a value below min
    if (handler.mock.calls.length > 0) {
      expect(handler.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
    }
  });

  it("should set disabled state when disabled prop is true", () => {
    render(() => <NumberInput value={5} onValueChange={() => {}} disabled />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.disabled || input.hasAttribute("disabled")).toBe(true);
  });

  it("should render suffix text when suffix prop is provided", () => {
    render(() => <NumberInput value={100} onValueChange={() => {}} suffix="px" />);
    const suffix = screen.getByText("px");
    expect(suffix).toBeTruthy();
    expect(suffix.classList.contains("sigil-number-input__suffix")).toBe(true);
  });

  it("should append custom class names alongside component classes", () => {
    const { container } = render(() => (
      <NumberInput value={0} onValueChange={() => {}} class="my-custom" />
    ));
    const root = container.querySelector(".sigil-number-input");
    expect(root?.classList.contains("my-custom")).toBe(true);
    expect(root?.classList.contains("sigil-number-input")).toBe(true);
  });

  it("should forward aria-label to the number field", () => {
    render(() => <NumberInput value={10} onValueChange={() => {}} aria-label="X position" />);
    // The aria-label should be associated with the input
    const input = screen.getByLabelText("X position");
    expect(input).toBeTruthy();
  });
});
