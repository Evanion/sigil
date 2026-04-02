import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { Select, type SelectOption } from "./Select";

const testOptions: readonly SelectOption[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

describe("Select", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render a trigger button with listbox popup", () => {
    render(() => (
      <Select options={testOptions} value="left" onValueChange={() => {}} aria-label="Align" />
    ));
    const trigger = screen.getByRole("button", { name: /Align/i });
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("should display the label of the currently selected value", () => {
    render(() => (
      <Select options={testOptions} value="center" onValueChange={() => {}} aria-label="Align" />
    ));
    expect(screen.getByText("Center")).toBeTruthy();
  });

  it("should apply the base sigil-select class on root", () => {
    render(() => (
      <Select options={testOptions} value="left" onValueChange={() => {}} aria-label="Align" />
    ));
    const trigger = screen.getByRole("button", { name: /Align/i });
    const root = trigger.closest(".sigil-select");
    expect(root).toBeTruthy();
  });

  it("should render a visible label when label prop is provided", () => {
    render(() => (
      <Select options={testOptions} value="left" onValueChange={() => {}} label="Text align" />
    ));
    const label = screen.getByText("Text align");
    expect(label).toBeTruthy();
    expect(label.classList.contains("sigil-select__label")).toBe(true);
  });

  it("should expand the trigger when clicked to open the listbox", async () => {
    render(() => (
      <Select options={testOptions} value="left" onValueChange={() => {}} aria-label="Align" />
    ));
    const trigger = screen.getByRole("button", { name: /Align/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("should disable the trigger when disabled prop is true", () => {
    render(() => (
      <Select
        options={testOptions}
        value="left"
        onValueChange={() => {}}
        disabled
        aria-label="Align"
      />
    ));
    const trigger = screen.getByRole("button", { name: /Align/i });
    expect(
      trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });

  it("should append custom class names alongside component classes", () => {
    render(() => (
      <Select
        options={testOptions}
        value="left"
        onValueChange={() => {}}
        class="my-custom"
        aria-label="Align"
      />
    ));
    const trigger = screen.getByRole("button", { name: /Align/i });
    const root = trigger.closest(".sigil-select");
    expect(root).toBeTruthy();
    expect(root?.classList.contains("my-custom")).toBe(true);
    expect(root?.classList.contains("sigil-select")).toBe(true);
  });

  it("should show placeholder text when no value is selected", () => {
    render(() => (
      <Select
        options={testOptions}
        value=""
        onValueChange={() => {}}
        placeholder="Choose..."
        aria-label="Align"
      />
    ));
    expect(screen.getByText("Choose...")).toBeTruthy();
  });
});
