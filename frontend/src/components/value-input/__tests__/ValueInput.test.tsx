/**
 * ValueInput component tests — behavioural coverage for the contentEditable
 * expression editor introduced in Spec 13c (RF-009).
 *
 * jsdom limitations acknowledged:
 *  - Selection API is partially implemented. Cursor/selection manipulation
 *    inside contentEditable is not faithful, so tests that require real
 *    caret placement (e.g. verifying cursor position after autocomplete
 *    insertion) are skipped with a documented rationale.
 *  - The native HTML popover API (`el.togglePopover()`, `popover="auto"`)
 *    is available in recent jsdom but not exercised here — we verify the
 *    swatch DOM semantics, not the popover's visual open state.
 *
 * Pattern: we write plain `textContent` on the contentEditable combobox and
 * fire synthetic key/blur events. This matches the approach used by
 * `AppearancePanel.test.tsx` when validating ValueInput integration.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import ValueInput from "../ValueInput";
import type { Token } from "../../../types/document";

// ── Fixtures ───────────────────────────────────────────────────────────

const COLOR_TOKEN: Token = {
  id: "tok-primary",
  name: "brand.primary",
  token_type: "color",
  description: null,
  value: { type: "color", value: { space: "srgb", r: 0, g: 0.4, b: 1, a: 1 } },
};

const NUMBER_TOKEN: Token = {
  id: "tok-opacity",
  name: "opacity.subtle",
  token_type: "number",
  description: null,
  value: { type: "number", value: 0.5 },
};

const DIMENSION_TOKEN: Token = {
  id: "tok-gap",
  name: "spacing.md",
  token_type: "dimension",
  description: null,
  value: { type: "dimension", value: 16, unit: "px" },
};

const TOKENS: Record<string, Token> = {
  "brand.primary": COLOR_TOKEN,
  "opacity.subtle": NUMBER_TOKEN,
  "spacing.md": DIMENSION_TOKEN,
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("ValueInput — basic rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a contenteditable combobox with the supplied value", () => {
    render(() => (
      <ValueInput value="#ff0000" onChange={vi.fn()} tokens={TOKENS} aria-label="Test input" />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    expect(combobox).toBeTruthy();
    expect(combobox.textContent).toContain("#ff0000");
    expect(combobox.getAttribute("contenteditable")).toBe("true");
  });

  it("surfaces the placeholder via data-placeholder when value is empty", () => {
    render(() => (
      <ValueInput
        value=""
        onChange={vi.fn()}
        tokens={TOKENS}
        placeholder="Custom placeholder"
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    expect(combobox.getAttribute("data-placeholder")).toBe("Custom placeholder");
  });

  it("defaults aria-label to 'Token expression' when no label prop is provided", () => {
    render(() => <ValueInput value="" onChange={vi.fn()} tokens={TOKENS} />);
    const combobox = screen.getByRole("combobox", { name: "Token expression" });
    expect(combobox).toBeTruthy();
  });

  it("renders with aria-haspopup='listbox' and a static aria-autocomplete capability", () => {
    render(() => (
      <ValueInput value="" onChange={vi.fn()} tokens={TOKENS} aria-label="Test input" />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    expect(combobox.getAttribute("aria-haspopup")).toBe("listbox");
    expect(combobox.getAttribute("aria-autocomplete")).toBe("list");
    // aria-expanded must always be present (not toggled on/off with state)
    expect(combobox.getAttribute("aria-expanded")).not.toBeNull();
  });

  it("marks tabIndex=-1 and aria-disabled when disabled", () => {
    render(() => (
      <ValueInput value="42" onChange={vi.fn()} tokens={TOKENS} aria-label="Test input" disabled />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    expect(combobox.getAttribute("tabindex")).toBe("-1");
    expect(combobox.getAttribute("aria-disabled")).toBe("true");
    expect(combobox.getAttribute("contenteditable")).toBe("false");
  });
});

describe("ValueInput — input propagation", () => {
  afterEach(() => {
    cleanup();
  });

  it("fires onChange when the contentEditable receives input (RF-027)", () => {
    const onChange = vi.fn();
    render(() => (
      <ValueInput value="" onChange={onChange} tokens={TOKENS} aria-label="Test input" />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    combobox.textContent = "42";
    fireEvent.input(combobox);
    expect(onChange).toHaveBeenCalledWith("42");
  });
});

describe("ValueInput — commit events", () => {
  afterEach(() => {
    cleanup();
  });

  it("fires onCommit once when Enter is pressed outside autocomplete", () => {
    const onCommit = vi.fn();
    render(() => (
      <ValueInput
        value=""
        onChange={vi.fn()}
        onCommit={onCommit}
        tokens={TOKENS}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    combobox.textContent = "42";
    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("42");
  });

  it("fires onCommit on blur when the value has changed", () => {
    const onCommit = vi.fn();
    render(() => (
      <ValueInput
        value=""
        onChange={vi.fn()}
        onCommit={onCommit}
        tokens={TOKENS}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    // Simulate user typing, which also updates the component's confirmedValue tracking.
    combobox.textContent = "99";
    fireEvent.input(combobox);
    fireEvent.blur(combobox);
    expect(onCommit).toHaveBeenCalledWith("99");
  });

  it("does not fire onCommit on blur when value is unchanged", () => {
    const onCommit = vi.fn();
    render(() => (
      <ValueInput
        value="42"
        onChange={vi.fn()}
        onCommit={onCommit}
        tokens={TOKENS}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    // blur without mutation — onBlur sees text matches confirmedValue and skips commit
    fireEvent.blur(combobox);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("ValueInput — Escape revert", () => {
  afterEach(() => {
    cleanup();
  });

  it("reverts DOM and fires onChange with the confirmed value on Escape", () => {
    const onChange = vi.fn();
    render(() => (
      <ValueInput value="42" onChange={onChange} tokens={TOKENS} aria-label="Test input" />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    // Simulate typing — intermediate onChange fires
    combobox.textContent = "99";
    fireEvent.input(combobox);
    onChange.mockClear();
    // Press Escape — should revert DOM and re-fire onChange with the confirmed value
    fireEvent.keyDown(combobox, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("42");
  });
});

describe("ValueInput — color swatch visibility", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the color swatch button when acceptedTypes includes 'color'", () => {
    render(() => (
      <ValueInput
        value="#ff0000"
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["color"]}
        aria-label="Test input"
      />
    ));
    const swatch = screen.getByRole("button", { name: "Color preview, click to edit" });
    expect(swatch).toBeTruthy();
  });

  it("does not render the swatch when acceptedTypes omits 'color'", () => {
    render(() => (
      <ValueInput
        value="42"
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["number"]}
        aria-label="Test input"
      />
    ));
    expect(screen.queryByRole("button", { name: "Color preview, click to edit" })).toBeNull();
  });

  it("swatch exposes aria-haspopup='dialog' honoured by a role=dialog popover (RF-018)", () => {
    render(() => (
      <ValueInput
        value="#ff0000"
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["color"]}
        aria-label="Test input"
      />
    ));
    const swatch = screen.getByRole("button", { name: "Color preview, click to edit" });
    expect(swatch.getAttribute("aria-haspopup")).toBe("dialog");
    // The controlled popover must exist in the DOM and declare role="dialog"
    // with an accessible name to match the swatch's popup contract.
    const popoverId = swatch.getAttribute("aria-controls");
    expect(popoverId).toBeTruthy();
    const popover = popoverId ? document.getElementById(popoverId) : null;
    expect(popover).toBeTruthy();
    expect(popover?.getAttribute("role")).toBe("dialog");
    expect(popover?.getAttribute("aria-label")).toBe("Color picker");
  });
});

describe("ValueInput — autocomplete", () => {
  afterEach(() => {
    cleanup();
  });

  // Note: the `{` keypress path uses getCursorOffset and setCursorOffset which
  // rely on the Selection API. jsdom supports this minimally — we can assert
  // the autocomplete opens by observing the listbox display style changing.
  it("opens the autocomplete listbox when '{' is pressed with tokens available", () => {
    render(() => (
      <ValueInput
        value=""
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["color"]}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    // Focus the combobox so selection APIs have a target node
    combobox.focus();
    fireEvent.keyDown(combobox, { key: "{" });
    // After pressing `{`, aria-expanded should flip to true on the combobox.
    expect(combobox.getAttribute("aria-expanded")).toBe("true");
    // The listbox must be present and visible
    const listbox = document.querySelector<HTMLElement>("[role='listbox']");
    expect(listbox).toBeTruthy();
    // display is set inline when open with matches; with {, query is "" so all
    // color tokens surface.
    expect(listbox?.style.display).toBe("block");
  });

  it("closes the autocomplete when Escape is pressed with it open", () => {
    render(() => (
      <ValueInput
        value=""
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["color"]}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    combobox.focus();
    // Open autocomplete by pressing `{`
    fireEvent.keyDown(combobox, { key: "{" });
    expect(combobox.getAttribute("aria-expanded")).toBe("true");
    // Pressing Escape while the autocomplete is open should close it
    fireEvent.keyDown(combobox, { key: "Escape" });
    expect(combobox.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ValueInput — RF-020 numeric ARIA exposure", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes aria-valuenow when in literal-number mode and numeric type is accepted", () => {
    render(() => (
      <ValueInput
        value="42"
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["number"]}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    expect(combobox.getAttribute("aria-valuenow")).toBe("42");
  });

  it("exposes aria-valuemin and aria-valuemax when min/max props are provided", () => {
    render(() => (
      <ValueInput
        value="0.5"
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["number"]}
        min={0}
        max={1}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    expect(combobox.getAttribute("aria-valuenow")).toBe("0.5");
    expect(combobox.getAttribute("aria-valuemin")).toBe("0");
    expect(combobox.getAttribute("aria-valuemax")).toBe("1");
  });

  it("omits aria-valuenow when the value is not a literal number (token ref)", () => {
    render(() => (
      <ValueInput
        value="{opacity.subtle}"
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["number"]}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    // The combobox is in reference mode, not literal-number mode — no numeric state.
    expect(combobox.getAttribute("aria-valuenow")).toBeNull();
  });

  it("omits aria-valuenow when the field does not accept numeric values", () => {
    render(() => (
      <ValueInput
        value="42"
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["string"]}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    expect(combobox.getAttribute("aria-valuenow")).toBeNull();
  });
});

describe("ValueInput — RF-008 aria-live discrete-event scoping", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the SR status region empty until a discrete event fires", () => {
    render(() => (
      <ValueInput value="" onChange={vi.fn()} tokens={TOKENS} aria-label="Test input" />
    ));
    const status = document.querySelector<HTMLElement>("[role='status']");
    expect(status).toBeTruthy();
    // Initially empty — committedStatus starts at "".
    expect(status?.textContent ?? "").toBe("");
  });

  it("does NOT announce suggestion count on typing (aria-live flooding guard)", () => {
    render(() => (
      <ValueInput
        value=""
        onChange={vi.fn()}
        tokens={TOKENS}
        acceptedTypes={["color"]}
        aria-label="Test input"
      />
    ));
    const combobox = screen.getByRole("combobox", { name: "Test input" });
    combobox.focus();
    fireEvent.keyDown(combobox, { key: "{" });
    const status = document.querySelector<HTMLElement>("[role='status']");
    // Even though autocomplete is open with suggestions, the SR region is
    // still empty — autocomplete state is conveyed via aria-expanded only.
    expect(status?.textContent ?? "").toBe("");
  });
});
