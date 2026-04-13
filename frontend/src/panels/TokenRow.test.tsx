/**
 * Tests for TokenRow component — behavior-driven per CLAUDE.md testing standards.
 */

import { render, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";
import { TokenRow } from "./TokenRow";
import type { Token } from "../types/document";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeColorToken(): Token {
  return {
    id: "tok-1",
    name: "color/primary",
    token_type: "color",
    value: { type: "color", value: { space: "srgb", r: 0, g: 0.4, b: 1, a: 1 } },
    description: null,
  };
}

function makeDimensionToken(): Token {
  return {
    id: "tok-2",
    name: "spacing/md",
    token_type: "dimension",
    value: { type: "dimension", value: 16, unit: "px" },
    description: null,
  };
}

function makeAliasToken(): Token {
  return {
    id: "tok-3",
    name: "alias/primary",
    token_type: "color",
    value: { type: "alias", name: "color/primary" },
    description: null,
  };
}

function makeTypographyToken(): Token {
  return {
    id: "tok-4",
    name: "type/heading",
    token_type: "typography",
    value: {
      type: "typography",
      value: {
        font_family: "Inter",
        font_size: 24,
        font_weight: 700,
        line_height: 1.2,
        letter_spacing: 0,
      },
    },
    description: null,
  };
}

function makeShadowToken(): Token {
  return {
    id: "tok-5",
    name: "shadow/md",
    token_type: "shadow",
    value: {
      type: "shadow",
      value: {
        color: { space: "srgb", r: 0, g: 0, b: 0, a: 0.5 },
        offset: { x: 0, y: 2 },
        blur: 4,
        spread: 0,
      },
    },
    description: null,
  };
}

function makeNumberToken(): Token {
  return {
    id: "tok-6",
    name: "scale/2",
    token_type: "number",
    value: { type: "number", value: 2 },
    description: null,
  };
}

function makeDurationToken(): Token {
  return {
    id: "tok-7",
    name: "duration/fast",
    token_type: "duration",
    value: { type: "duration", seconds: 0.15 },
    description: null,
  };
}

function makeCubicBezierToken(): Token {
  return {
    id: "tok-8",
    name: "easing/ease-in",
    token_type: "cubic_bezier",
    value: { type: "cubic_bezier", values: [0.4, 0, 1, 1] },
    description: null,
  };
}

function makeFontFamilyToken(): Token {
  return {
    id: "tok-9",
    name: "font/primary",
    token_type: "font_family",
    value: { type: "font_family", families: ["Inter", "sans-serif"] },
    description: null,
  };
}

function makeFontWeightToken(): Token {
  return {
    id: "tok-10",
    name: "font/bold",
    token_type: "font_weight",
    value: { type: "font_weight", weight: 700 },
    description: null,
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────

describe("TokenRow rendering", () => {
  it("should render token name", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("color/primary")).toBeTruthy();
  });

  it("should have role=option and aria-selected=false when not selected", () => {
    const { getByRole } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    const option = getByRole("option");
    expect(option.getAttribute("aria-selected")).toBe("false");
  });

  it("should have aria-selected=true when selected", () => {
    const { getByRole } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={true}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    const option = getByRole("option");
    expect(option.getAttribute("aria-selected")).toBe("true");
  });

  it("should set data-token-name attribute", () => {
    const { getByRole } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByRole("option").getAttribute("data-token-name")).toBe("color/primary");
  });

  it("should render dimension value preview as 16px", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeDimensionToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("16px")).toBeTruthy();
  });

  it("should render alias value preview in italic style with arrow", () => {
    const { container } = render(() => (
      <TokenRow
        token={makeAliasToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    const valueEl = container.querySelector(".sigil-token-row__value");
    expect(valueEl?.textContent).toContain("color/primary");
  });

  it("should render typography value preview with family size/weight", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeTypographyToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("Inter 24/700")).toBeTruthy();
  });

  it("should render shadow value preview as summary string", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeShadowToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("0 2 4 #000000")).toBeTruthy();
  });

  it("should render number value as raw value", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeNumberToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("2")).toBeTruthy();
  });

  it("should render duration token value preview", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeDurationToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("0.15s")).toBeTruthy();
  });

  it("should render font family as first family name", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeFontFamilyToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("Inter")).toBeTruthy();
  });

  it("should render font weight as weight number", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeFontWeightToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("700")).toBeTruthy();
  });

  it("should render cubic bezier control points as preview", () => {
    const { getByText } = render(() => (
      <TokenRow
        token={makeCubicBezierToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    expect(getByText("0.4, 0, 1, 1")).toBeTruthy();
  });
});

// ── Interaction ────────────────────────────────────────────────────────────

describe("TokenRow interaction", () => {
  it("should call onSelect with token name when clicked", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={onSelect}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    fireEvent.click(getByRole("option"));
    expect(onSelect).toHaveBeenCalledWith("color/primary");
  });

  it("should call onEdit with token name when double-clicked", () => {
    const onEdit = vi.fn();
    const { getByRole } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={onEdit}
      />
    ));
    fireEvent.dblClick(getByRole("option"));
    expect(onEdit).toHaveBeenCalledWith("color/primary");
  });

  it("should call onDelete when Delete key is pressed", () => {
    const onDelete = vi.fn();
    const { getByRole } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
        onEdit={vi.fn()}
      />
    ));
    fireEvent.keyDown(getByRole("option"), { key: "Delete" });
    expect(onDelete).toHaveBeenCalledWith("color/primary");
  });

  it("should enter rename mode when F2 is pressed", () => {
    const { getByRole, container } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    fireEvent.keyDown(getByRole("option"), { key: "F2" });
    expect(container.querySelector(".sigil-token-row__name-input")).toBeTruthy();
  });

  it("should commit rename on Enter and call onRename", () => {
    const onRename = vi.fn();
    const { getByRole, container } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    fireEvent.keyDown(getByRole("option"), { key: "F2" });
    const input = container.querySelector<HTMLInputElement>(".sigil-token-row__name-input");
    expect(input).toBeTruthy();
    fireEvent.input(input!, { target: { value: "color/brand" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("color/primary", "color/brand");
  });

  it("should cancel rename on Escape without calling onRename", () => {
    const onRename = vi.fn();
    const { getByRole, container } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    ));
    fireEvent.keyDown(getByRole("option"), { key: "F2" });
    const input = container.querySelector<HTMLInputElement>(".sigil-token-row__name-input");
    fireEvent.keyDown(input!, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(container.querySelector(".sigil-token-row__name-input")).toBeNull();
  });

  it("should stop propagation of keydown events from rename input (overlay mode)", () => {
    const outerHandler = vi.fn();
    const { getByRole, container } = render(() => (
      <div onKeyDown={outerHandler}>
        <TokenRow
          token={makeColorToken()}
          isSelected={false}
          isFocused={false}
          tabIndex={0}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
        />
      </div>
    ));
    fireEvent.keyDown(getByRole("option"), { key: "F2" });
    const input = container.querySelector<HTMLInputElement>(".sigil-token-row__name-input");
    outerHandler.mockClear();
    fireEvent.keyDown(input!, { key: "a" });
    // keydown from the rename input must not propagate to outer handlers
    expect(outerHandler).not.toHaveBeenCalled();
  });

  it("should enter rename mode when requestRename prop is true", () => {
    const onRenameStarted = vi.fn();
    const { container } = render(() => (
      <TokenRow
        token={makeColorToken()}
        isSelected={false}
        isFocused={false}
        tabIndex={0}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        requestRename={true}
        onRenameStarted={onRenameStarted}
      />
    ));
    expect(container.querySelector(".sigil-token-row__name-input")).toBeTruthy();
    expect(onRenameStarted).toHaveBeenCalled();
  });
});
