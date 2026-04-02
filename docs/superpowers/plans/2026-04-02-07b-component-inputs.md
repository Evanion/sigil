# Component Library: Input Controls — Implementation Plan (07b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the input control components (ToggleButton, TextInput, NumberInput, Select, Toggle, Divider) — the building blocks for the properties panel and toolbar.

**Architecture:** Each component wraps a Kobalte headless primitive, styled with CSS custom properties from `styles/theme.css`. Every component gets 4 files: `.tsx` (component), `.css` (styles), `.stories.tsx` (Storybook), `.test.tsx` (Vitest). Components follow the established pattern from Button/IconButton/Tooltip — `splitProps` for prop separation, `sigil-` prefixed class names, focus-visible styles, reduced-motion support.

**Tech Stack:** Solid.js 1.9, Kobalte 0.13, Open Props, Lucide-Solid, Storybook 10, Vitest 4

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. TypeScript strict, no `any`. No innerHTML. All styling via CSS custom properties. Every interactive element must be keyboard-navigable. Every component must have `aria-label` support where applicable. Follow the exact pattern established by `frontend/src/components/button/` — read ALL 4 files in that directory before writing any code.

---

## File Structure

```
frontend/src/components/
├── toggle-button/
│   ├── ToggleButton.tsx
│   ├── ToggleButton.css
│   ├── ToggleButton.stories.tsx
│   └── ToggleButton.test.tsx
├── text-input/
│   ├── TextInput.tsx
│   ├── TextInput.css
│   ├── TextInput.stories.tsx
│   └── TextInput.test.tsx
├── number-input/
│   ├── NumberInput.tsx
│   ├── NumberInput.css
│   ├── NumberInput.stories.tsx
│   └── NumberInput.test.tsx
├── select/
│   ├── Select.tsx
│   ├── Select.css
│   ├── Select.stories.tsx
│   └── Select.test.tsx
├── toggle/
│   ├── Toggle.tsx
│   ├── Toggle.css
│   ├── Toggle.stories.tsx
│   └── Toggle.test.tsx
├── divider/
│   ├── Divider.tsx
│   ├── Divider.css
│   ├── Divider.stories.tsx
│   └── Divider.test.tsx
```

Also adds theme variables for new component tokens to `frontend/src/styles/theme.css`.

---

## Task 1: Add theme tokens for input controls

**Files:**
- Modify: `frontend/src/styles/theme.css`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Read the existing theme file at `frontend/src/styles/theme.css` and the existing component files:
  - `frontend/src/components/button/Button.tsx`
  - `frontend/src/components/button/Button.css`
  - `frontend/src/components/button/Button.test.tsx`
  - `frontend/src/components/button/Button.stories.tsx`
  - `frontend/src/components/icon-button/IconButton.tsx`
  - `frontend/src/components/tooltip/Tooltip.tsx`

- [ ] 3. Add new component tokens to `frontend/src/styles/theme.css` inside the existing `:root` block, after the existing `--focus-offset` line:

```css
  /* Toggle button */
  --toggle-button-radius: var(--radius-2);

  /* Input controls */
  --input-height: 28px;
  --input-padding-x: var(--size-2);
  --input-bg: var(--surface-4);
  --input-border: var(--border-1);
  --input-border-focus: var(--accent);

  /* Select */
  --select-trigger-radius: var(--radius-2);
  --select-content-radius: var(--radius-2);

  /* Toggle / Switch */
  --toggle-track-width: 32px;
  --toggle-track-height: 18px;
  --toggle-thumb-size: 14px;

  /* Divider */
  --divider-color: var(--border-1);
```

- [ ] 4. Verify build: `cd frontend && pnpm build && pnpm test`

- [ ] 5. Commit: `feat(frontend): add theme tokens for input control components (spec-07)`

---

## Task 2: ToggleButton component

**Files:**
- Create: `frontend/src/components/toggle-button/ToggleButton.tsx`
- Create: `frontend/src/components/toggle-button/ToggleButton.css`
- Create: `frontend/src/components/toggle-button/ToggleButton.stories.tsx`
- Create: `frontend/src/components/toggle-button/ToggleButton.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Read the existing component pattern files listed in Task 1, step 2.

- [ ] 3. Write the test file `frontend/src/components/toggle-button/ToggleButton.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { ToggleButton } from "./ToggleButton";

describe("ToggleButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render children text content", () => {
    render(() => <ToggleButton pressed={false} onPressedChange={() => {}}>Bold</ToggleButton>);
    expect(screen.getByText("Bold")).toBeTruthy();
  });

  it("should render as a button element for keyboard accessibility", () => {
    render(() => <ToggleButton pressed={false} onPressedChange={() => {}}>B</ToggleButton>);
    const btn = screen.getByText("B");
    expect(btn.tagName.toLowerCase()).toBe("button");
  });

  it("should apply the base sigil-toggle-button class", () => {
    render(() => <ToggleButton pressed={false} onPressedChange={() => {}}>B</ToggleButton>);
    const btn = screen.getByText("B");
    expect(btn.classList.contains("sigil-toggle-button")).toBe(true);
  });

  it("should apply the pressed class when pressed is true", () => {
    render(() => <ToggleButton pressed={true} onPressedChange={() => {}}>B</ToggleButton>);
    const btn = screen.getByText("B");
    expect(btn.classList.contains("sigil-toggle-button--pressed")).toBe(true);
  });

  it("should not apply the pressed class when pressed is false", () => {
    render(() => <ToggleButton pressed={false} onPressedChange={() => {}}>B</ToggleButton>);
    const btn = screen.getByText("B");
    expect(btn.classList.contains("sigil-toggle-button--pressed")).toBe(false);
  });

  it("should fire onPressedChange with toggled value when clicked", () => {
    const handler = vi.fn();
    render(() => <ToggleButton pressed={false} onPressedChange={handler}>B</ToggleButton>);
    screen.getByText("B").click();
    expect(handler).toHaveBeenCalledWith(true);
  });

  it("should set aria-pressed attribute reflecting pressed state", () => {
    render(() => <ToggleButton pressed={true} onPressedChange={() => {}}>Bold</ToggleButton>);
    const btn = screen.getByText("Bold");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("should set the disabled attribute when disabled prop is true", () => {
    render(() => <ToggleButton pressed={false} onPressedChange={() => {}} disabled>B</ToggleButton>);
    expect(screen.getByText("B").hasAttribute("disabled")).toBe(true);
  });

  it("should forward aria-label to the underlying element", () => {
    render(() => <ToggleButton pressed={false} onPressedChange={() => {}} aria-label="Toggle bold">B</ToggleButton>);
    expect(screen.getByLabelText("Toggle bold")).toBeTruthy();
  });

  it("should append custom class names alongside component classes", () => {
    render(() => <ToggleButton pressed={false} onPressedChange={() => {}} class="my-custom">B</ToggleButton>);
    const btn = screen.getByText("B");
    expect(btn.classList.contains("my-custom")).toBe(true);
    expect(btn.classList.contains("sigil-toggle-button")).toBe(true);
  });
});
```

- [ ] 4. Run tests to verify they fail: `cd frontend && pnpm test`

- [ ] 5. Write the component `frontend/src/components/toggle-button/ToggleButton.tsx`:

```tsx
import { ToggleButton as KobalteToggleButton } from "@kobalte/core/toggle-button";
import { type JSX, splitProps } from "solid-js";
import "./ToggleButton.css";

export interface ToggleButtonProps {
  /** Whether the toggle is currently pressed/active. */
  pressed: boolean;
  /** Callback when the pressed state changes. */
  onPressedChange: (pressed: boolean) => void;
  /** Content inside the button (text or icon). */
  children: JSX.Element;
  /** Whether the button is disabled. */
  disabled?: boolean;
  /** Additional CSS class. */
  class?: string;
  /** Accessible label. */
  "aria-label"?: string;
}

export function ToggleButton(props: ToggleButtonProps) {
  const [local, others] = splitProps(props, [
    "pressed",
    "onPressedChange",
    "children",
    "disabled",
    "class",
  ]);

  const className = () => {
    const classes = ["sigil-toggle-button"];
    if (local.pressed) classes.push("sigil-toggle-button--pressed");
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteToggleButton
      class={className()}
      pressed={local.pressed}
      onChange={local.onPressedChange}
      disabled={local.disabled}
      {...others}
    >
      {local.children}
    </KobalteToggleButton>
  );
}
```

- [ ] 6. Write the styles `frontend/src/components/toggle-button/ToggleButton.css`:

```css
.sigil-toggle-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--toggle-button-radius);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition:
    background-color 150ms,
    color 150ms;
  user-select: none;
}

.sigil-toggle-button:hover {
  background: var(--surface-4);
  color: var(--text-1);
}

.sigil-toggle-button--pressed {
  background: var(--accent);
  color: #ffffff;
}

.sigil-toggle-button--pressed:hover {
  background: var(--accent-hover);
}

.sigil-toggle-button[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.sigil-toggle-button:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
```

- [ ] 7. Write the stories `frontend/src/components/toggle-button/ToggleButton.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { ToggleButton } from "./ToggleButton";

const meta: Meta<typeof ToggleButton> = {
  title: "Components/ToggleButton",
  component: ToggleButton,
  tags: ["autodocs"],
  argTypes: {
    pressed: { control: "boolean" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof ToggleButton>;

export const Default: Story = {
  args: { pressed: false, children: "B" },
};

export const Pressed: Story = {
  args: { pressed: true, children: "B" },
};

export const Disabled: Story = {
  args: { pressed: false, disabled: true, children: "B" },
};

export const Interactive: Story = {
  render: () => {
    const [pressed, setPressed] = createSignal(false);
    return (
      <ToggleButton pressed={pressed()} onPressedChange={setPressed}>
        B
      </ToggleButton>
    );
  },
};
```

- [ ] 8. Run tests and lint: `cd frontend && pnpm test && pnpm lint && pnpm build`

- [ ] 9. Commit: `feat(frontend): add ToggleButton component with Kobalte (spec-07)`

---

## Task 3: TextInput component

**Files:**
- Create: `frontend/src/components/text-input/TextInput.tsx`
- Create: `frontend/src/components/text-input/TextInput.css`
- Create: `frontend/src/components/text-input/TextInput.stories.tsx`
- Create: `frontend/src/components/text-input/TextInput.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Read the existing component pattern files listed in Task 1, step 2.

- [ ] 3. Write the test file `frontend/src/components/text-input/TextInput.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TextInput } from "./TextInput";

describe("TextInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render an input element", () => {
    render(() => <TextInput value="" onValueChange={() => {}} aria-label="Name" />);
    const input = screen.getByLabelText("Name");
    expect(input.tagName.toLowerCase()).toBe("input");
  });

  it("should display the current value", () => {
    render(() => <TextInput value="hello" onValueChange={() => {}} aria-label="Name" />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("hello");
  });

  it("should fire onValueChange when the user types", async () => {
    const handler = vi.fn();
    render(() => <TextInput value="" onValueChange={handler} aria-label="Name" />);
    const input = screen.getByLabelText("Name");
    await fireEvent.input(input, { target: { value: "test" } });
    expect(handler).toHaveBeenCalledWith("test");
  });

  it("should apply the base sigil-text-input class to the root", () => {
    render(() => <TextInput value="" onValueChange={() => {}} aria-label="Name" />);
    const root = screen.getByLabelText("Name").closest(".sigil-text-input");
    expect(root).toBeTruthy();
  });

  it("should render a label when label prop is provided", () => {
    render(() => <TextInput value="" onValueChange={() => {}} label="Username" />);
    expect(screen.getByText("Username")).toBeTruthy();
  });

  it("should render a placeholder when provided", () => {
    render(() => <TextInput value="" onValueChange={() => {}} placeholder="Type here..." aria-label="Input" />);
    const input = screen.getByPlaceholderText("Type here...");
    expect(input).toBeTruthy();
  });

  it("should set the disabled attribute when disabled prop is true", () => {
    render(() => <TextInput value="" onValueChange={() => {}} disabled aria-label="Name" />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("should append custom class names alongside component classes", () => {
    render(() => <TextInput value="" onValueChange={() => {}} class="my-custom" aria-label="Name" />);
    const root = screen.getByLabelText("Name").closest(".sigil-text-input");
    expect(root?.classList.contains("my-custom")).toBe(true);
  });
});
```

- [ ] 4. Run tests to verify they fail: `cd frontend && pnpm test`

- [ ] 5. Write the component `frontend/src/components/text-input/TextInput.tsx`:

```tsx
import { TextField as KobalteTextField } from "@kobalte/core/text-field";
import { splitProps } from "solid-js";
import "./TextInput.css";

export interface TextInputProps {
  /** Current value of the input. */
  value: string;
  /** Callback when the value changes. */
  onValueChange: (value: string) => void;
  /** Visible label rendered above the input. */
  label?: string;
  /** Placeholder text inside the input. */
  placeholder?: string;
  /** Whether the input is disabled. */
  disabled?: boolean;
  /** Additional CSS class on the root element. */
  class?: string;
  /** Accessible label (required if no visible label). */
  "aria-label"?: string;
}

export function TextInput(props: TextInputProps) {
  const [local, others] = splitProps(props, [
    "value",
    "onValueChange",
    "label",
    "placeholder",
    "disabled",
    "class",
  ]);

  const className = () => {
    const classes = ["sigil-text-input"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteTextField
      class={className()}
      value={local.value}
      onChange={local.onValueChange}
      disabled={local.disabled}
      {...others}
    >
      {local.label && <KobalteTextField.Label class="sigil-text-input__label">{local.label}</KobalteTextField.Label>}
      <KobalteTextField.Input
        class="sigil-text-input__input"
        placeholder={local.placeholder}
      />
    </KobalteTextField>
  );
}
```

- [ ] 6. Write the styles `frontend/src/components/text-input/TextInput.css`:

```css
.sigil-text-input {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}

.sigil-text-input__label {
  font-size: var(--font-size-00);
  font-weight: var(--font-weight-5);
  color: var(--text-2);
  user-select: none;
}

.sigil-text-input__input {
  height: var(--input-height);
  padding: 0 var(--input-padding-x);
  border: 1px solid var(--input-border);
  border-radius: var(--input-radius);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: var(--font-size-0);
  font-family: inherit;
  outline: none;
  transition:
    border-color 150ms,
    background-color 150ms;
}

.sigil-text-input__input::placeholder {
  color: var(--text-3);
}

.sigil-text-input__input:hover {
  border-color: var(--border-2);
}

.sigil-text-input__input:focus-visible {
  border-color: var(--input-border-focus);
  outline: none;
}

.sigil-text-input__input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] 7. Write the stories `frontend/src/components/text-input/TextInput.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { TextInput } from "./TextInput";

const meta: Meta<typeof TextInput> = {
  title: "Components/TextInput",
  component: TextInput,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof TextInput>;

export const Default: Story = {
  args: { value: "", placeholder: "Enter text...", "aria-label": "Text input" },
};

export const WithLabel: Story = {
  args: { value: "", label: "Node name", placeholder: "Untitled" },
};

export const WithValue: Story = {
  args: { value: "Rectangle 1", label: "Name" },
};

export const Disabled: Story = {
  args: { value: "Locked", label: "Name", disabled: true },
};

export const Interactive: Story = {
  render: () => {
    const [value, setValue] = createSignal("");
    return <TextInput value={value()} onValueChange={setValue} label="Name" placeholder="Type here..." />;
  },
};
```

- [ ] 8. Run tests and lint: `cd frontend && pnpm test && pnpm lint && pnpm build`

- [ ] 9. Commit: `feat(frontend): add TextInput component with Kobalte TextField (spec-07)`

---

## Task 4: NumberInput component

**Files:**
- Create: `frontend/src/components/number-input/NumberInput.tsx`
- Create: `frontend/src/components/number-input/NumberInput.css`
- Create: `frontend/src/components/number-input/NumberInput.stories.tsx`
- Create: `frontend/src/components/number-input/NumberInput.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Read the existing component pattern files listed in Task 1, step 2.

- [ ] 3. Write the test file `frontend/src/components/number-input/NumberInput.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { NumberInput } from "./NumberInput";

describe("NumberInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render an input element", () => {
    render(() => <NumberInput value={0} onValueChange={() => {}} aria-label="X" />);
    const input = screen.getByLabelText("X");
    expect(input.tagName.toLowerCase()).toBe("input");
  });

  it("should display the current value", () => {
    render(() => <NumberInput value={42} onValueChange={() => {}} aria-label="X" />);
    const input = screen.getByLabelText("X") as HTMLInputElement;
    expect(input.value).toBe("42");
  });

  it("should apply the base sigil-number-input class to the root", () => {
    render(() => <NumberInput value={0} onValueChange={() => {}} aria-label="X" />);
    const root = screen.getByLabelText("X").closest(".sigil-number-input");
    expect(root).toBeTruthy();
  });

  it("should render a label when label prop is provided", () => {
    render(() => <NumberInput value={0} onValueChange={() => {}} label="Width" />);
    expect(screen.getByText("Width")).toBeTruthy();
  });

  it("should render increment and decrement buttons", () => {
    render(() => <NumberInput value={0} onValueChange={() => {}} aria-label="X" />);
    expect(screen.getByLabelText("Increment")).toBeTruthy();
    expect(screen.getByLabelText("Decrement")).toBeTruthy();
  });

  it("should call onValueChange with incremented value when increment is clicked", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={10} onValueChange={handler} step={1} aria-label="X" />);
    screen.getByLabelText("Increment").click();
    expect(handler).toHaveBeenCalledWith(11);
  });

  it("should call onValueChange with decremented value when decrement is clicked", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={10} onValueChange={handler} step={1} aria-label="X" />);
    screen.getByLabelText("Decrement").click();
    expect(handler).toHaveBeenCalledWith(9);
  });

  it("should respect min constraint", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={0} onValueChange={handler} min={0} step={1} aria-label="X" />);
    screen.getByLabelText("Decrement").click();
    expect(handler).not.toHaveBeenCalled();
  });

  it("should respect max constraint", () => {
    const handler = vi.fn();
    render(() => <NumberInput value={100} onValueChange={handler} max={100} step={1} aria-label="X" />);
    screen.getByLabelText("Increment").click();
    expect(handler).not.toHaveBeenCalled();
  });

  it("should set the disabled attribute when disabled prop is true", () => {
    render(() => <NumberInput value={0} onValueChange={() => {}} disabled aria-label="X" />);
    const input = screen.getByLabelText("X") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("should render a suffix when provided", () => {
    render(() => <NumberInput value={0} onValueChange={() => {}} suffix="px" aria-label="X" />);
    expect(screen.getByText("px")).toBeTruthy();
  });
});
```

- [ ] 4. Run tests to verify they fail: `cd frontend && pnpm test`

- [ ] 5. Write the component `frontend/src/components/number-input/NumberInput.tsx`:

```tsx
import { NumberField as KobalteNumberField } from "@kobalte/core/number-field";
import { splitProps } from "solid-js";
import { ChevronUp, ChevronDown } from "lucide-solid";
import "./NumberInput.css";

export interface NumberInputProps {
  /** Current numeric value. */
  value: number;
  /** Callback when the value changes. */
  onValueChange: (value: number) => void;
  /** Visible label rendered above the input. */
  label?: string;
  /** Step size for increment/decrement. Defaults to 1. */
  step?: number;
  /** Minimum allowed value. */
  min?: number;
  /** Maximum allowed value. */
  max?: number;
  /** Unit suffix displayed after the input (e.g., "px", "°"). */
  suffix?: string;
  /** Whether the input is disabled. */
  disabled?: boolean;
  /** Additional CSS class on the root element. */
  class?: string;
  /** Accessible label (required if no visible label). */
  "aria-label"?: string;
}

export function NumberInput(props: NumberInputProps) {
  const [local, others] = splitProps(props, [
    "value",
    "onValueChange",
    "label",
    "step",
    "min",
    "max",
    "suffix",
    "disabled",
    "class",
  ]);

  const className = () => {
    const classes = ["sigil-number-input"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteNumberField
      class={className()}
      rawValue={local.value}
      onRawValueChange={local.onValueChange}
      step={local.step ?? 1}
      minValue={local.min}
      maxValue={local.max}
      disabled={local.disabled}
      {...others}
    >
      {local.label && (
        <KobalteNumberField.Label class="sigil-number-input__label">
          {local.label}
        </KobalteNumberField.Label>
      )}
      <div class="sigil-number-input__group">
        <KobalteNumberField.Input class="sigil-number-input__input" />
        {local.suffix && <span class="sigil-number-input__suffix">{local.suffix}</span>}
        <div class="sigil-number-input__buttons">
          <KobalteNumberField.IncrementTrigger class="sigil-number-input__btn" aria-label="Increment">
            <ChevronUp size={12} />
          </KobalteNumberField.IncrementTrigger>
          <KobalteNumberField.DecrementTrigger class="sigil-number-input__btn" aria-label="Decrement">
            <ChevronDown size={12} />
          </KobalteNumberField.DecrementTrigger>
        </div>
      </div>
    </KobalteNumberField>
  );
}
```

- [ ] 6. Write the styles `frontend/src/components/number-input/NumberInput.css`:

```css
.sigil-number-input {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}

.sigil-number-input__label {
  font-size: var(--font-size-00);
  font-weight: var(--font-weight-5);
  color: var(--text-2);
  user-select: none;
}

.sigil-number-input__group {
  display: flex;
  align-items: center;
  height: var(--input-height);
  border: 1px solid var(--input-border);
  border-radius: var(--input-radius);
  background: var(--input-bg);
  overflow: hidden;
  transition: border-color 150ms;
}

.sigil-number-input__group:hover {
  border-color: var(--border-2);
}

.sigil-number-input__group:focus-within {
  border-color: var(--input-border-focus);
}

.sigil-number-input__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 var(--input-padding-x);
  border: none;
  background: transparent;
  color: var(--text-1);
  font-size: var(--font-size-0);
  font-family: inherit;
  outline: none;
}

.sigil-number-input__input::placeholder {
  color: var(--text-3);
}

.sigil-number-input__suffix {
  font-size: var(--font-size-00);
  color: var(--text-3);
  padding-right: var(--size-1);
  user-select: none;
}

.sigil-number-input__buttons {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--input-border);
}

.sigil-number-input__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 13px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.sigil-number-input__btn:hover {
  background: var(--surface-3);
  color: var(--text-1);
}

.sigil-number-input__btn[disabled] {
  opacity: 0.3;
  cursor: not-allowed;
}

.sigil-number-input[data-disabled] {
  opacity: 0.5;
  pointer-events: none;
}
```

- [ ] 7. Write the stories `frontend/src/components/number-input/NumberInput.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { NumberInput } from "./NumberInput";

const meta: Meta<typeof NumberInput> = {
  title: "Components/NumberInput",
  component: NumberInput,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Default: Story = {
  args: { value: 0, "aria-label": "Value" },
};

export const WithLabel: Story = {
  args: { value: 100, label: "Width" },
};

export const WithSuffix: Story = {
  args: { value: 42, label: "X", suffix: "px" },
};

export const WithMinMax: Story = {
  args: { value: 50, label: "Opacity", min: 0, max: 100, suffix: "%" },
};

export const Disabled: Story = {
  args: { value: 0, label: "Width", disabled: true },
};

export const Interactive: Story = {
  render: () => {
    const [value, setValue] = createSignal(100);
    return <NumberInput value={value()} onValueChange={setValue} label="Width" suffix="px" min={0} max={1000} />;
  },
};
```

- [ ] 8. Run tests and lint: `cd frontend && pnpm test && pnpm lint && pnpm build`

- [ ] 9. Commit: `feat(frontend): add NumberInput component with Kobalte NumberField (spec-07)`

---

## Task 5: Select component

**Files:**
- Create: `frontend/src/components/select/Select.tsx`
- Create: `frontend/src/components/select/Select.css`
- Create: `frontend/src/components/select/Select.stories.tsx`
- Create: `frontend/src/components/select/Select.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Read the existing component pattern files listed in Task 1, step 2.

- [ ] 3. Write the test file `frontend/src/components/select/Select.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { Select } from "./Select";

const OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

describe("Select", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render a trigger button", () => {
    render(() => <Select options={OPTIONS} value="left" onValueChange={() => {}} aria-label="Align" />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeTruthy();
  });

  it("should display the selected option label in the trigger", () => {
    render(() => <Select options={OPTIONS} value="center" onValueChange={() => {}} aria-label="Align" />);
    expect(screen.getByText("Center")).toBeTruthy();
  });

  it("should apply the base sigil-select class", () => {
    render(() => <Select options={OPTIONS} value="left" onValueChange={() => {}} aria-label="Align" />);
    const root = screen.getByRole("combobox").closest(".sigil-select");
    expect(root).toBeTruthy();
  });

  it("should render a label when label prop is provided", () => {
    render(() => <Select options={OPTIONS} value="left" onValueChange={() => {}} label="Text Align" />);
    expect(screen.getByText("Text Align")).toBeTruthy();
  });

  it("should open a listbox when the trigger is clicked", async () => {
    render(() => <Select options={OPTIONS} value="left" onValueChange={() => {}} aria-label="Align" />);
    await fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("should set the disabled state when disabled prop is true", () => {
    render(() => <Select options={OPTIONS} value="left" onValueChange={() => {}} disabled aria-label="Align" />);
    const trigger = screen.getByRole("combobox");
    expect(trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("should append custom class names alongside component classes", () => {
    render(() => <Select options={OPTIONS} value="left" onValueChange={() => {}} class="my-custom" aria-label="Align" />);
    const root = screen.getByRole("combobox").closest(".sigil-select");
    expect(root?.classList.contains("my-custom")).toBe(true);
  });

  it("should render a placeholder when no value is selected", () => {
    render(() => <Select options={OPTIONS} value="" onValueChange={() => {}} placeholder="Choose..." aria-label="Align" />);
    expect(screen.getByText("Choose...")).toBeTruthy();
  });
});
```

- [ ] 4. Run tests to verify they fail: `cd frontend && pnpm test`

- [ ] 5. Write the component `frontend/src/components/select/Select.tsx`:

```tsx
import { Select as KobalteSelect } from "@kobalte/core/select";
import { splitProps, For } from "solid-js";
import { ChevronDown, Check } from "lucide-solid";
import "./Select.css";

export interface SelectOption {
  /** The value used for selection. */
  value: string;
  /** The display label shown to the user. */
  label: string;
}

export interface SelectProps {
  /** Available options. */
  options: readonly SelectOption[];
  /** Currently selected value. */
  value: string;
  /** Callback when selection changes. */
  onValueChange: (value: string) => void;
  /** Visible label rendered above the select. */
  label?: string;
  /** Placeholder text when no value is selected. */
  placeholder?: string;
  /** Whether the select is disabled. */
  disabled?: boolean;
  /** Additional CSS class on the root element. */
  class?: string;
  /** Accessible label (required if no visible label). */
  "aria-label"?: string;
}

export function Select(props: SelectProps) {
  const [local, others] = splitProps(props, [
    "options",
    "value",
    "onValueChange",
    "label",
    "placeholder",
    "disabled",
    "class",
  ]);

  const className = () => {
    const classes = ["sigil-select"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  const selectedOption = () => local.options.find((o) => o.value === local.value);

  return (
    <KobalteSelect<SelectOption>
      class={className()}
      options={[...local.options]}
      optionValue="value"
      optionTextValue="label"
      value={selectedOption()}
      onChange={(option) => {
        if (option) local.onValueChange(option.value);
      }}
      disabled={local.disabled}
      placeholder={local.placeholder}
      itemComponent={(itemProps) => (
        <KobalteSelect.Item item={itemProps.item} class="sigil-select__item">
          <KobalteSelect.ItemLabel>{itemProps.item.rawValue.label}</KobalteSelect.ItemLabel>
          <KobalteSelect.ItemIndicator class="sigil-select__item-indicator">
            <Check size={12} />
          </KobalteSelect.ItemIndicator>
        </KobalteSelect.Item>
      )}
      {...others}
    >
      {local.label && (
        <KobalteSelect.Label class="sigil-select__label">{local.label}</KobalteSelect.Label>
      )}
      <KobalteSelect.Trigger class="sigil-select__trigger">
        <KobalteSelect.Value<SelectOption>>
          {(state) => state.selectedOption()?.label ?? local.placeholder ?? ""}
        </KobalteSelect.Value>
        <KobalteSelect.Icon class="sigil-select__icon">
          <ChevronDown size={14} />
        </KobalteSelect.Icon>
      </KobalteSelect.Trigger>
      <KobalteSelect.Portal>
        <KobalteSelect.Content class="sigil-select__content">
          <KobalteSelect.Listbox class="sigil-select__listbox" />
        </KobalteSelect.Content>
      </KobalteSelect.Portal>
    </KobalteSelect>
  );
}
```

- [ ] 6. Write the styles `frontend/src/components/select/Select.css`:

```css
.sigil-select {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}

.sigil-select__label {
  font-size: var(--font-size-00);
  font-weight: var(--font-weight-5);
  color: var(--text-2);
  user-select: none;
}

.sigil-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--input-height);
  padding: 0 var(--input-padding-x);
  border: 1px solid var(--input-border);
  border-radius: var(--select-trigger-radius);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: var(--font-size-0);
  font-family: inherit;
  cursor: pointer;
  transition:
    border-color 150ms,
    background-color 150ms;
  user-select: none;
}

.sigil-select__trigger:hover {
  border-color: var(--border-2);
}

.sigil-select__trigger:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

.sigil-select__trigger[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.sigil-select__icon {
  color: var(--text-3);
  flex-shrink: 0;
}

.sigil-select__content {
  background: var(--surface-3);
  border: 1px solid var(--border-2);
  border-radius: var(--select-content-radius);
  padding: var(--size-1) 0;
  box-shadow: var(--shadow-3);
  z-index: 50;
}

.sigil-select__listbox {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sigil-select__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--size-1) var(--size-3);
  font-size: var(--font-size-0);
  color: var(--text-1);
  cursor: pointer;
  outline: none;
  user-select: none;
}

.sigil-select__item:hover,
.sigil-select__item[data-highlighted] {
  background: var(--surface-4);
}

.sigil-select__item[data-selected] {
  color: var(--accent);
}

.sigil-select__item-indicator {
  color: var(--accent);
}
```

- [ ] 7. Write the stories `frontend/src/components/select/Select.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Select } from "./Select";

const ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

const BLEND_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
];

const meta: Meta<typeof Select> = {
  title: "Components/Select",
  component: Select,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: { options: ALIGN_OPTIONS, value: "left", "aria-label": "Text align" },
};

export const WithLabel: Story = {
  args: { options: ALIGN_OPTIONS, value: "center", label: "Text Align" },
};

export const WithPlaceholder: Story = {
  args: { options: BLEND_OPTIONS, value: "", placeholder: "Choose blend mode...", label: "Blend Mode" },
};

export const Disabled: Story = {
  args: { options: ALIGN_OPTIONS, value: "left", label: "Text Align", disabled: true },
};

export const Interactive: Story = {
  render: () => {
    const [value, setValue] = createSignal("normal");
    return <Select options={BLEND_OPTIONS} value={value()} onValueChange={setValue} label="Blend Mode" />;
  },
};
```

- [ ] 8. Run tests and lint: `cd frontend && pnpm test && pnpm lint && pnpm build`

- [ ] 9. Commit: `feat(frontend): add Select component with Kobalte Select (spec-07)`

---

## Task 6: Toggle (Switch) component

**Files:**
- Create: `frontend/src/components/toggle/Toggle.tsx`
- Create: `frontend/src/components/toggle/Toggle.css`
- Create: `frontend/src/components/toggle/Toggle.stories.tsx`
- Create: `frontend/src/components/toggle/Toggle.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Read the existing component pattern files listed in Task 1, step 2.

- [ ] 3. Write the test file `frontend/src/components/toggle/Toggle.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render a switch element with the correct role", () => {
    render(() => <Toggle checked={false} onCheckedChange={() => {}} aria-label="Visible" />);
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("should apply the base sigil-toggle class", () => {
    render(() => <Toggle checked={false} onCheckedChange={() => {}} aria-label="Visible" />);
    const root = screen.getByRole("switch").closest(".sigil-toggle");
    expect(root).toBeTruthy();
  });

  it("should reflect checked state via aria-checked", () => {
    render(() => <Toggle checked={true} onCheckedChange={() => {}} aria-label="Visible" />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("should fire onCheckedChange when clicked", () => {
    const handler = vi.fn();
    render(() => <Toggle checked={false} onCheckedChange={handler} aria-label="Visible" />);
    screen.getByRole("switch").click();
    expect(handler).toHaveBeenCalledWith(true);
  });

  it("should render a label when label prop is provided", () => {
    render(() => <Toggle checked={false} onCheckedChange={() => {}} label="Visible" />);
    expect(screen.getByText("Visible")).toBeTruthy();
  });

  it("should set the disabled state when disabled prop is true", () => {
    render(() => <Toggle checked={false} onCheckedChange={() => {}} disabled aria-label="Visible" />);
    const sw = screen.getByRole("switch");
    expect(sw.hasAttribute("disabled") || sw.getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("should append custom class names alongside component classes", () => {
    render(() => <Toggle checked={false} onCheckedChange={() => {}} class="my-custom" aria-label="Visible" />);
    const root = screen.getByRole("switch").closest(".sigil-toggle");
    expect(root?.classList.contains("my-custom")).toBe(true);
  });
});
```

- [ ] 4. Run tests to verify they fail: `cd frontend && pnpm test`

- [ ] 5. Write the component `frontend/src/components/toggle/Toggle.tsx`:

```tsx
import { Switch as KobalteSwitch } from "@kobalte/core/switch";
import { splitProps } from "solid-js";
import "./Toggle.css";

export interface ToggleProps {
  /** Whether the toggle is on. */
  checked: boolean;
  /** Callback when the checked state changes. */
  onCheckedChange: (checked: boolean) => void;
  /** Visible label rendered next to the toggle. */
  label?: string;
  /** Whether the toggle is disabled. */
  disabled?: boolean;
  /** Additional CSS class on the root element. */
  class?: string;
  /** Accessible label (required if no visible label). */
  "aria-label"?: string;
}

export function Toggle(props: ToggleProps) {
  const [local, others] = splitProps(props, [
    "checked",
    "onCheckedChange",
    "label",
    "disabled",
    "class",
  ]);

  const className = () => {
    const classes = ["sigil-toggle"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteSwitch
      class={className()}
      checked={local.checked}
      onChange={local.onCheckedChange}
      disabled={local.disabled}
      {...others}
    >
      <KobalteSwitch.Input />
      <KobalteSwitch.Control class="sigil-toggle__track">
        <KobalteSwitch.Thumb class="sigil-toggle__thumb" />
      </KobalteSwitch.Control>
      {local.label && (
        <KobalteSwitch.Label class="sigil-toggle__label">{local.label}</KobalteSwitch.Label>
      )}
    </KobalteSwitch>
  );
}
```

- [ ] 6. Write the styles `frontend/src/components/toggle/Toggle.css`:

```css
.sigil-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2);
}

.sigil-toggle__track {
  position: relative;
  width: var(--toggle-track-width);
  height: var(--toggle-track-height);
  border-radius: calc(var(--toggle-track-height) / 2);
  background: var(--surface-4);
  border: 1px solid var(--border-1);
  cursor: pointer;
  transition:
    background-color 150ms,
    border-color 150ms;
}

.sigil-toggle__track:hover {
  border-color: var(--border-2);
}

.sigil-toggle[data-checked] .sigil-toggle__track {
  background: var(--accent);
  border-color: var(--accent);
}

.sigil-toggle__thumb {
  position: absolute;
  top: 50%;
  left: 2px;
  transform: translateY(-50%);
  width: var(--toggle-thumb-size);
  height: var(--toggle-thumb-size);
  border-radius: 50%;
  background: #ffffff;
  transition: left 150ms;
}

.sigil-toggle[data-checked] .sigil-toggle__thumb {
  left: calc(var(--toggle-track-width) - var(--toggle-thumb-size) - 2px);
}

.sigil-toggle__label {
  font-size: var(--font-size-0);
  color: var(--text-1);
  user-select: none;
}

.sigil-toggle[data-disabled] {
  opacity: 0.5;
  pointer-events: none;
}

.sigil-toggle__track:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

@media (prefers-reduced-motion: reduce) {
  .sigil-toggle__thumb {
    transition: none;
  }
}
```

- [ ] 7. Write the stories `frontend/src/components/toggle/Toggle.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Toggle } from "./Toggle";

const meta: Meta<typeof Toggle> = {
  title: "Components/Toggle",
  component: Toggle,
  tags: ["autodocs"],
  argTypes: {
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Toggle>;

export const Off: Story = {
  args: { checked: false, "aria-label": "Toggle" },
};

export const On: Story = {
  args: { checked: true, "aria-label": "Toggle" },
};

export const WithLabel: Story = {
  args: { checked: true, label: "Visible" },
};

export const Disabled: Story = {
  args: { checked: false, label: "Locked", disabled: true },
};

export const Interactive: Story = {
  render: () => {
    const [checked, setChecked] = createSignal(false);
    return <Toggle checked={checked()} onCheckedChange={setChecked} label="Show grid" />;
  },
};
```

- [ ] 8. Run tests and lint: `cd frontend && pnpm test && pnpm lint && pnpm build`

- [ ] 9. Commit: `feat(frontend): add Toggle (Switch) component with Kobalte (spec-07)`

---

## Task 7: Divider component

**Files:**
- Create: `frontend/src/components/divider/Divider.tsx`
- Create: `frontend/src/components/divider/Divider.css`
- Create: `frontend/src/components/divider/Divider.stories.tsx`
- Create: `frontend/src/components/divider/Divider.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Read the existing component pattern files listed in Task 1, step 2.

- [ ] 3. Write the test file `frontend/src/components/divider/Divider.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { Divider } from "./Divider";

describe("Divider", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render a separator element", () => {
    render(() => <Divider />);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("should apply the base sigil-divider class", () => {
    render(() => <Divider />);
    expect(screen.getByRole("separator").classList.contains("sigil-divider")).toBe(true);
  });

  it("should default to horizontal orientation", () => {
    render(() => <Divider />);
    const separator = screen.getByRole("separator");
    expect(separator.getAttribute("aria-orientation")).not.toBe("vertical");
    expect(separator.classList.contains("sigil-divider--vertical")).toBe(false);
  });

  it("should apply vertical class when orientation is vertical", () => {
    render(() => <Divider orientation="vertical" />);
    const separator = screen.getByRole("separator");
    expect(separator.classList.contains("sigil-divider--vertical")).toBe(true);
  });

  it("should append custom class names alongside component classes", () => {
    render(() => <Divider class="my-custom" />);
    const separator = screen.getByRole("separator");
    expect(separator.classList.contains("my-custom")).toBe(true);
    expect(separator.classList.contains("sigil-divider")).toBe(true);
  });
});
```

- [ ] 4. Run tests to verify they fail: `cd frontend && pnpm test`

- [ ] 5. Write the component `frontend/src/components/divider/Divider.tsx`:

```tsx
import { Separator as KobalteSeparator } from "@kobalte/core/separator";
import { splitProps } from "solid-js";
import "./Divider.css";

export type DividerOrientation = "horizontal" | "vertical";

export interface DividerProps {
  /** Whether the divider is horizontal or vertical. Defaults to "horizontal". */
  orientation?: DividerOrientation;
  /** Additional CSS class. */
  class?: string;
}

export function Divider(props: DividerProps) {
  const [local, others] = splitProps(props, ["orientation", "class"]);

  const className = () => {
    const classes = ["sigil-divider"];
    if (local.orientation === "vertical") classes.push("sigil-divider--vertical");
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteSeparator
      class={className()}
      orientation={local.orientation ?? "horizontal"}
      {...others}
    />
  );
}
```

- [ ] 6. Write the styles `frontend/src/components/divider/Divider.css`:

```css
.sigil-divider {
  border: none;
  background: var(--divider-color);
  flex-shrink: 0;
}

.sigil-divider:not(.sigil-divider--vertical) {
  height: 1px;
  width: 100%;
  margin: var(--size-1) 0;
}

.sigil-divider--vertical {
  width: 1px;
  height: 100%;
  margin: 0 var(--size-1);
}
```

- [ ] 7. Write the stories `frontend/src/components/divider/Divider.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Divider } from "./Divider";

const meta: Meta<typeof Divider> = {
  title: "Components/Divider",
  component: Divider,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Divider>;

export const Horizontal: Story = {
  args: {},
  decorators: [
    (Story) => (
      <div style={{ width: "200px", padding: "16px", background: "var(--surface-2)" }}>
        <p style={{ color: "var(--text-1)" }}>Above</p>
        <Story />
        <p style={{ color: "var(--text-1)" }}>Below</p>
      </div>
    ),
  ],
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", height: "40px", "align-items": "center", padding: "16px", background: "var(--surface-2)" }}>
        <span style={{ color: "var(--text-1)" }}>Left</span>
        <Story />
        <span style={{ color: "var(--text-1)" }}>Right</span>
      </div>
    ),
  ],
};
```

- [ ] 8. Run tests and lint: `cd frontend && pnpm test && pnpm lint && pnpm build`

- [ ] 9. Commit: `feat(frontend): add Divider component with Kobalte Separator (spec-07)`

---

## Task 8: Full verification

- [ ] 1. Frontend tests: `cd frontend && pnpm test`
- [ ] 2. Frontend lint: `cd frontend && pnpm lint`
- [ ] 3. Frontend build: `cd frontend && pnpm build`
- [ ] 4. Frontend format: `cd frontend && pnpm format`
- [ ] 5. Verify Storybook: `cd frontend && pnpm build-storybook` (compile check — stories must not error)
- [ ] 6. Fix any issues, commit.

---

## Deferred Items

### Plan 07c: Overlay & Feedback Components
- Popover, ContextMenu, DropdownMenu, Dialog, Toast

### Plan 07d: Data Display & Layout Components
- Tabs, TreeView, ColorSwatch, Label, Panel, Toolbar
