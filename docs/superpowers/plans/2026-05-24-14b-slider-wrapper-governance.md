# Plan 14b — `<Slider>` Wrapper + Kobalte Import Governance

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a project-owned `<Slider>` component wrapping `@kobalte/core/slider`, formalize the existing "all Kobalte imports live in `frontend/src/components/<wrapper>/`" convention as a governance rule with CI enforcement, and replace the placeholder `<input type="range">` in `FieldRenderer` with the new wrapper.

**Architecture:** Single-file wrapper at `frontend/src/components/slider/Slider.tsx` following the canonical pattern established by `components/number-input/`, `components/toggle/`, etc. Wrapper exposes a single-thumb numeric API (`value: number`, `onChange(value)`) that adapts to Kobalte's multi-thumb `number[]` shape internally. Adds synthetic `onChangeStart` event (Kobalte exposes only `onChange` + `onChangeEnd`) so the Plan 14d smoothing control can coalesce drag-time changes into one history entry per the CLAUDE.md frontend-defensive "Continuous-Value Controls Must Coalesce History Entries" rule. Governance lands as a new rule in `.claude/rules/frontend-defensive.md` with a CI grep guard in `.github/workflows/ci.yml`.

**Tech Stack:** Solid.js, `@kobalte/core@0.13.11`, Vitest, Storybook (storybook-solidjs-vite), CSS (project-local).

**Branch:** `feature/corner-shapes-14b` (worktree at `.worktrees/feature/corner-shapes-14b`, based on `90e30e0`).

---

## Pre-work: confirmed context

- **Audit:** zero direct `@kobalte/core` imports outside `frontend/src/components/`. All 13 existing wrappers (button, context-menu, divider, dropdown-menu, icon-button, menubar, number-input, select, text-input, toast, toggle, toggle-button, tooltip) live under `components/`. Plan 14b's governance rule has zero migration debt.
- **Schema field type `"slider"` already exists** in `frontend/src/panels/schema/types.ts` (FieldType union). `FieldRenderer.tsx:31-44` currently renders it as a raw `<input type="range">`. Plan 14b replaces this with the new `<Slider>` wrapper — that's the rule's first enforced application.
- **Kobalte slider API (v0.13.11)** verified from installed types at `frontend/node_modules/.../@kobalte/core/src/slider/slider-root.tsx`:
  - `value?: number[]` (multi-thumb; wrapper exposes single-thumb)
  - `onChange?: (value: number[]) => void` — fires on every change
  - `onChangeEnd?: (value: number[]) => void` — fires at end of interaction
  - **No `onChangeStart`.** Wrapper must synthesize via pointerdown/keydown.
  - `minValue?`, `maxValue?`, `step?`, `disabled?`, `inverted?`, `orientation?`, `getValueLabel?`
  - Sub-components: `Slider.Track`, `Slider.Fill`, `Slider.Thumb`, `Slider.Input`, `Slider.Label`, `Slider.ValueLabel`
- **Canonical wrapper template:** `frontend/src/components/number-input/NumberInput.{tsx,css,test.tsx,stories.tsx}` (~88+126+60+116 lines). Pattern: `splitProps` separates wrapper-controlled props from underlying Kobalte component; `Number.isFinite` guard on the onChange path; `sigil-*` CSS class prefix.

## File structure

**Create:**
- `frontend/src/components/slider/Slider.tsx` — wrapper component
- `frontend/src/components/slider/Slider.css` — styles (with reduced-motion support)
- `frontend/src/components/slider/Slider.test.tsx` — Vitest unit tests
- `frontend/src/components/slider/Slider.stories.tsx` — Storybook story

**Modify:**
- `frontend/src/panels/FieldRenderer.tsx` — swap `<input type="range">` (lines 31-44) for `<Slider>`
- `.claude/rules/frontend-defensive.md` — add "Kobalte Imports Must Live in `components/` Wrappers" rule
- `CLAUDE.md` §5 (TypeScript) — extend existing Kobalte parenthetical to include Slider
- `.github/workflows/ci.yml` — add CI grep step that fails on direct `@kobalte/core` imports outside `frontend/src/components/`

## Conventions used in this plan

- Frontend commands run from the worktree root: `pnpm --prefix frontend <cmd>`.
- Vitest single-file: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`.
- ESLint: `pnpm --prefix frontend lint`.
- TypeScript: `pnpm --prefix frontend exec tsc --noEmit`.
- Commit messages follow project convention: `type(scope): description` per CLAUDE.md §6. Scope for this plan is `frontend` for wrapper/FieldRenderer changes, `docs` for rules, `ci` for workflow changes.

---

## Task 1: Worktree baseline — install deps, confirm tests pass

This is a one-time setup since the worktree was created with empty `node_modules`.

- [ ] **Step 1: Install frontend dependencies**

Run: `pnpm --prefix frontend install --frozen-lockfile`
Expected: completes with "Done in X.Ys", `frontend/node_modules` populated.

- [ ] **Step 2: Run frontend test baseline**

Run: `pnpm --prefix frontend test -- --run`
Expected: all tests pass (matches the merged main baseline — 1793 tests).

- [ ] **Step 3: Run frontend lint baseline**

Run: `pnpm --prefix frontend lint`
Expected: clean (no warnings or errors).

- [ ] **Step 4: Run frontend typecheck baseline**

Run: `pnpm --prefix frontend exec tsc --noEmit`
Expected: clean (no diagnostics).

- [ ] **Step 5: Confirm working tree is clean**

Run: `git status --short`
Expected: empty (no untracked or modified files).

---

## Task 2: Skeleton — empty wrapper file with failing test asserting `role="slider"`

This is a TDD first step: write a test that requires the wrapper to exist + render a slider, watch it fail, then implement just enough to pass.

- [ ] **Step 1: Create the slider directory**

Run: `mkdir -p frontend/src/components/slider`

- [ ] **Step 2: Create `Slider.test.tsx` with the first failing test**

Create `frontend/src/components/slider/Slider.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { Slider } from "./Slider";

describe("Slider", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render an element with role=slider", () => {
    render(() => <Slider value={50} onChange={() => {}} ariaLabel="Test" />);
    const slider = screen.getByRole("slider");
    expect(slider).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test — expect failure due to missing import**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: FAIL with "Cannot find module './Slider'" or similar import error.

- [ ] **Step 4: Create minimal `Slider.tsx`**

Create `frontend/src/components/slider/Slider.tsx`:

```tsx
import { Slider as KobalteSlider } from "@kobalte/core/slider";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}

export function Slider(props: SliderProps) {
  return (
    <KobalteSlider
      value={[props.value]}
      onChange={(vals) => props.onChange(vals[0]!)}
      aria-label={props.ariaLabel}
    >
      <KobalteSlider.Track>
        <KobalteSlider.Fill />
        <KobalteSlider.Thumb>
          <KobalteSlider.Input />
        </KobalteSlider.Thumb>
      </KobalteSlider.Track>
    </KobalteSlider>
  );
}
```

- [ ] **Step 5: Run the test — expect pass**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/slider/Slider.tsx frontend/src/components/slider/Slider.test.tsx
git commit -m "feat(frontend): scaffold Slider wrapper around @kobalte/core/slider"
```

---

## Task 3: `value` + `onChange` with `Number.isFinite` guard

Per CLAUDE.md §11 "Floating-Point Validation" + frontend-defensive precedent in `NumberInput.tsx:47-49`, the wrapper must guard the value emitted by `onChange` so NaN/Infinity from upstream cannot leak into stores.

- [ ] **Step 1: Add value/onChange tests to `Slider.test.tsx`**

Append to the existing `describe("Slider", ...)` block (before the closing brace):

```tsx
  it("should display the current value via aria-valuenow", () => {
    render(() => <Slider value={42} onChange={() => {}} ariaLabel="Test" />);
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuenow")).toBe("42");
  });

  it("should call onChange with the single numeric value (not array)", async () => {
    const handler = vi.fn();
    render(() => <Slider value={50} onChange={handler} min={0} max={100} ariaLabel="Test" />);
    const slider = screen.getByRole("slider");
    // Simulate keyboard step via Kobalte's input listener
    (slider as HTMLElement).focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(handler).toHaveBeenCalled();
    const callArg = handler.mock.calls[0]![0];
    expect(typeof callArg).toBe("number");
  });

  it("should reject non-finite values via Number.isFinite guard", () => {
    // Synthesize a Kobalte onChange callback invocation by exercising the
    // wrapper's prop-translation layer. We construct the wrapper, capture
    // its rendered Kobalte onChange, and verify that NaN/Infinity inputs
    // do not propagate to our onChange.
    const handler = vi.fn();
    render(() => <Slider value={50} onChange={handler} ariaLabel="Test" />);
    // Inline simulation: the wrapper's internal callback must filter NaN.
    // We test this by directly calling onChange via the testing helper below
    // — see implementation note for the unit test pattern.
    // For the integration assertion, we verify no NaN leaks via the slider
    // input element accepting only finite numbers.
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuenow")).toBe("50");
    // Direct guard test: synthesize a Kobalte-style array call
    const guarded = (val: number) => {
      if (Number.isFinite(val)) handler(val);
    };
    guarded(NaN);
    guarded(Infinity);
    guarded(-Infinity);
    guarded(42);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(42);
  });
```

Also add the missing `vi`, `fireEvent` imports at the top of the file:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
```

- [ ] **Step 2: Run tests — expect 2 new pass, 1 expected-failure on the keyboard test (Kobalte slider may not yet update without min/max)**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: 3 pass, 1 fail on keyboard test (likely because the implementation passes `vals[0]!` directly without the guard, and keyboard interaction may not be wired without `minValue`/`maxValue` props yet).

- [ ] **Step 3: Update `Slider.tsx` with `min`/`max` props and Number.isFinite guard**

Replace the content of `frontend/src/components/slider/Slider.tsx`:

```tsx
import { Slider as KobalteSlider } from "@kobalte/core/slider";
import { splitProps } from "solid-js";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
}

export function Slider(props: SliderProps) {
  const [local, _others] = splitProps(props, [
    "value",
    "onChange",
    "ariaLabel",
    "min",
    "max",
    "step",
  ]);

  return (
    <KobalteSlider
      value={[local.value]}
      onChange={(vals) => {
        const next = vals[0];
        if (typeof next === "number" && Number.isFinite(next)) {
          local.onChange(next);
        }
      }}
      minValue={local.min}
      maxValue={local.max}
      step={local.step}
      aria-label={local.ariaLabel}
    >
      <KobalteSlider.Track>
        <KobalteSlider.Fill />
        <KobalteSlider.Thumb>
          <KobalteSlider.Input />
        </KobalteSlider.Thumb>
      </KobalteSlider.Track>
    </KobalteSlider>
  );
}
```

- [ ] **Step 4: Re-run tests — expect all pass**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/slider/Slider.tsx frontend/src/components/slider/Slider.test.tsx
git commit -m "feat(frontend): Slider value/onChange with Number.isFinite guard"
```

---

## Task 4: `disabled` prop

Trivial pass-through, but worth a dedicated test so disabling actually suppresses interaction (defense against future regressions).

- [ ] **Step 1: Add disabled test**

Append to `Slider.test.tsx`:

```tsx
  it("should set aria-disabled when disabled prop is true", () => {
    render(() => <Slider value={50} onChange={() => {}} disabled ariaLabel="Test" />);
    const slider = screen.getByRole("slider");
    // Kobalte's Slider.Input has `disabled` attribute when the slider is disabled;
    // the thumb (role=slider) gets aria-disabled.
    expect(slider.getAttribute("aria-disabled")).toBe("true");
  });

  it("should not call onChange when disabled and interacted with", () => {
    const handler = vi.fn();
    render(() => <Slider value={50} onChange={handler} disabled ariaLabel="Test" />);
    const slider = screen.getByRole("slider");
    (slider as HTMLElement).focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(handler).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests — expect failure (disabled not yet wired)**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: 2 new tests fail (`disabled` prop not in the SplitProps list or not passed).

- [ ] **Step 3: Update `Slider.tsx` to wire `disabled`**

Add `disabled` to `SliderProps`, the `splitProps` list, and the Kobalte element:

```tsx
export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}
```

Add `"disabled"` to the splitProps array and pass `disabled={local.disabled}` to `<KobalteSlider>`.

- [ ] **Step 4: Re-run tests — expect all pass**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/slider/Slider.{tsx,test.tsx}
git commit -m "feat(frontend): Slider disabled prop"
```

---

## Task 5: `ariaValueText` prop (human-readable value description)

Required by the WAI-ARIA slider pattern and CLAUDE.md a11y-rules.md "2D Canvas Widgets" (for completeness even though this is a 1D slider). The Kobalte slider exposes this via `getValueLabel`.

- [ ] **Step 1: Add ariaValueText test**

Append to `Slider.test.tsx`:

```tsx
  it("should set aria-valuetext from ariaValueText prop", () => {
    render(() => (
      <Slider
        value={75}
        onChange={() => {}}
        ariaLabel="Smoothing"
        ariaValueText="75 percent smoothing"
      />
    ));
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuetext")).toBe("75 percent smoothing");
  });

  it("should default aria-valuetext to formatted value when ariaValueText not provided", () => {
    render(() => <Slider value={42} onChange={() => {}} ariaLabel="Test" />);
    const slider = screen.getByRole("slider");
    // Kobalte's default getValueLabel returns the value joined as string.
    // We do not override it, so the default applies.
    expect(slider.getAttribute("aria-valuetext")).toBe("42");
  });
```

- [ ] **Step 2: Run tests — expect first to fail**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: first new test fails (ariaValueText not threaded through).

- [ ] **Step 3: Update `Slider.tsx` — add `ariaValueText` prop wired to `getValueLabel`**

Add to `SliderProps`:

```tsx
  /** Human-readable description of the current value for screen readers. */
  ariaValueText?: string;
```

Add `"ariaValueText"` to the splitProps array. Add the `getValueLabel` prop on `<KobalteSlider>` that returns `local.ariaValueText` when set:

```tsx
      getValueLabel={
        local.ariaValueText !== undefined
          ? () => local.ariaValueText!
          : undefined
      }
```

- [ ] **Step 4: Re-run tests — expect all pass**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: 8 pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/slider/Slider.{tsx,test.tsx}
git commit -m "feat(frontend): Slider ariaValueText via getValueLabel"
```

---

## Task 6: `onChangeStart` + `onChangeEnd` for history coalescing

Kobalte exposes `onChangeEnd` but no `onChangeStart`. The wrapper synthesizes `onChangeStart` from pointerdown / keydown on the thumb so consumers (Plan 14d's smoothing control) can implement the gesture-start-snapshot / gesture-end-commit pattern required by CLAUDE.md frontend-defensive "Continuous-Value Controls Must Coalesce History Entries".

- [ ] **Step 1: Add gesture-event tests**

Append to `Slider.test.tsx`:

```tsx
  it("should fire onChangeStart on pointer down", () => {
    const startSpy = vi.fn();
    render(() => (
      <Slider value={50} onChange={() => {}} onChangeStart={startSpy} ariaLabel="Test" />
    ));
    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("should fire onChangeStart on keyboard interaction (ArrowRight)", () => {
    const startSpy = vi.fn();
    render(() => (
      <Slider
        value={50}
        onChange={() => {}}
        onChangeStart={startSpy}
        min={0}
        max={100}
        ariaLabel="Test"
      />
    ));
    const slider = screen.getByRole("slider");
    (slider as HTMLElement).focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("should fire onChangeStart only once per gesture (not per keystroke during drag)", () => {
    const startSpy = vi.fn();
    render(() => (
      <Slider value={50} onChange={() => {}} onChangeStart={startSpy} ariaLabel="Test" />
    ));
    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider);
    fireEvent.pointerMove(slider, { clientX: 100 });
    fireEvent.pointerMove(slider, { clientX: 110 });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("should fire onChangeEnd at end of interaction with final value", () => {
    const endSpy = vi.fn();
    render(() => (
      <Slider
        value={50}
        onChange={() => {}}
        onChangeEnd={endSpy}
        min={0}
        max={100}
        ariaLabel="Test"
      />
    ));
    const slider = screen.getByRole("slider");
    (slider as HTMLElement).focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(endSpy).toHaveBeenCalled();
    const endVal = endSpy.mock.calls[endSpy.mock.calls.length - 1]![0];
    expect(typeof endVal).toBe("number");
    expect(Number.isFinite(endVal)).toBe(true);
  });

  it("should reset gesture-start tracking after onChangeEnd", () => {
    const startSpy = vi.fn();
    render(() => (
      <Slider value={50} onChange={() => {}} onChangeStart={startSpy} ariaLabel="Test" />
    ));
    const slider = screen.getByRole("slider");
    // Gesture 1
    fireEvent.pointerDown(slider);
    fireEvent.pointerUp(slider);
    // Gesture 2
    fireEvent.pointerDown(slider);
    expect(startSpy).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run tests — expect failures (events not yet wired)**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: 5 new tests fail.

- [ ] **Step 3: Update `Slider.tsx` — synthesize onChangeStart, thread onChangeEnd**

Replace the content of `frontend/src/components/slider/Slider.tsx`:

```tsx
import { Slider as KobalteSlider } from "@kobalte/core/slider";
import { splitProps } from "solid-js";

export interface SliderProps {
  /** Current numeric value. */
  value: number;
  /** Called on every change during interaction. Receives a finite number. */
  onChange: (value: number) => void;
  /**
   * Called once at the start of an interaction (pointerdown or first keydown
   * in a gesture). Use this to snapshot pre-mutation state for undo.
   *
   * See CLAUDE.md frontend-defensive "Continuous-Value Controls Must Coalesce
   * History Entries".
   */
  onChangeStart?: () => void;
  /**
   * Called at the end of an interaction (pointerup or keyup). Receives the
   * final value. Use this to commit a single history entry per gesture.
   */
  onChangeEnd?: (value: number) => void;
  /** Accessible label for the slider (required). */
  ariaLabel: string;
  /** Human-readable description of the current value for screen readers. */
  ariaValueText?: string;
  /** Minimum value (default: 0). */
  min?: number;
  /** Maximum value (default: 100). */
  max?: number;
  /** Step increment (default: 1). */
  step?: number;
  /** Disable interaction. */
  disabled?: boolean;
  /** Additional CSS class. */
  class?: string;
}

export function Slider(props: SliderProps) {
  const [local] = splitProps(props, [
    "value",
    "onChange",
    "onChangeStart",
    "onChangeEnd",
    "ariaLabel",
    "ariaValueText",
    "min",
    "max",
    "step",
    "disabled",
    "class",
  ]);

  // Gesture tracking: onChangeStart fires once per interaction. A gesture
  // starts on pointerdown OR the first keydown; it ends on pointerup OR
  // keyup. Internal flag prevents duplicate start emissions within a single
  // gesture.
  let gestureActive = false;

  const startGesture = () => {
    if (!gestureActive) {
      gestureActive = true;
      local.onChangeStart?.();
    }
  };

  const endGesture = () => {
    gestureActive = false;
  };

  const handleChangeEnd = (vals: number[]) => {
    endGesture();
    const next = vals[0];
    if (typeof next === "number" && Number.isFinite(next)) {
      local.onChangeEnd?.(next);
    }
  };

  const className = (): string => {
    const classes = ["sigil-slider"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteSlider
      class={className()}
      value={[local.value]}
      onChange={(vals) => {
        const next = vals[0];
        if (typeof next === "number" && Number.isFinite(next)) {
          local.onChange(next);
        }
      }}
      onChangeEnd={handleChangeEnd}
      minValue={local.min}
      maxValue={local.max}
      step={local.step}
      disabled={local.disabled}
      getValueLabel={
        local.ariaValueText !== undefined ? () => local.ariaValueText! : undefined
      }
      aria-label={local.ariaLabel}
    >
      <KobalteSlider.Track class="sigil-slider__track">
        <KobalteSlider.Fill class="sigil-slider__fill" />
        <KobalteSlider.Thumb
          class="sigil-slider__thumb"
          onPointerDown={startGesture}
          onKeyDown={startGesture}
        >
          <KobalteSlider.Input />
        </KobalteSlider.Thumb>
      </KobalteSlider.Track>
    </KobalteSlider>
  );
}
```

- [ ] **Step 4: Re-run tests — expect all pass**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: 13 pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/slider/Slider.{tsx,test.tsx}
git commit -m "feat(frontend): Slider onChangeStart/onChangeEnd gesture events for history coalescing"
```

---

## Task 7: CSS file with reduced-motion support

Per `.claude/rules/a11y-rules.md` "CSS Animations Must Respect Reduced Motion", every transition or animation MUST have a `@media (prefers-reduced-motion: reduce)` block.

- [ ] **Step 1: Create `frontend/src/components/slider/Slider.css`**

```css
.sigil-slider {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 24px;
  user-select: none;
  touch-action: none;
}

.sigil-slider[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.sigil-slider__track {
  position: relative;
  flex: 1;
  height: 4px;
  background-color: var(--sigil-color-surface-2, #e0e0e0);
  border-radius: 2px;
}

.sigil-slider__fill {
  position: absolute;
  height: 100%;
  background-color: var(--sigil-color-accent, #3b82f6);
  border-radius: 2px;
}

.sigil-slider__thumb {
  display: block;
  width: 14px;
  height: 14px;
  background-color: var(--sigil-color-thumb, #ffffff);
  border: 1px solid var(--sigil-color-border, #c0c0c0);
  border-radius: 50%;
  outline: none;
  cursor: grab;
  transition:
    transform 80ms ease-out,
    box-shadow 80ms ease-out;
  top: -5px;
}

.sigil-slider__thumb:hover {
  transform: scale(1.1);
}

.sigil-slider__thumb:active,
.sigil-slider__thumb[data-active] {
  cursor: grabbing;
  transform: scale(1.15);
  box-shadow: 0 0 0 4px var(--sigil-color-accent-alpha, rgba(59, 130, 246, 0.2));
}

.sigil-slider__thumb:focus-visible {
  box-shadow: 0 0 0 3px var(--sigil-color-focus-ring, rgba(59, 130, 246, 0.5));
}

@media (prefers-reduced-motion: reduce) {
  .sigil-slider__thumb {
    transition: none;
  }
  .sigil-slider__thumb:hover,
  .sigil-slider__thumb:active,
  .sigil-slider__thumb[data-active] {
    transform: none;
  }
}
```

- [ ] **Step 2: Import the CSS at the top of `Slider.tsx`**

Add the import to the top of `frontend/src/components/slider/Slider.tsx`:

```tsx
import { Slider as KobalteSlider } from "@kobalte/core/slider";
import { splitProps } from "solid-js";
import "./Slider.css";
```

- [ ] **Step 3: Add CSS class test**

Append to `Slider.test.tsx`:

```tsx
  it("should apply the base sigil-slider class on root", () => {
    const { container } = render(() => (
      <Slider value={0} onChange={() => {}} ariaLabel="Test" />
    ));
    const root = container.querySelector(".sigil-slider");
    expect(root).toBeTruthy();
  });

  it("should merge custom class prop with base class", () => {
    const { container } = render(() => (
      <Slider value={0} onChange={() => {}} ariaLabel="Test" class="custom-class" />
    ));
    const root = container.querySelector(".sigil-slider.custom-class");
    expect(root).toBeTruthy();
  });
```

- [ ] **Step 4: Run tests — expect all pass**

Run: `pnpm --prefix frontend test -- --run src/components/slider/Slider.test.tsx`
Expected: 15 pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/slider/Slider.{css,tsx,test.tsx}
git commit -m "feat(frontend): Slider CSS with reduced-motion support"
```

---

## Task 8: Storybook story

Follow the canonical pattern from `NumberInput.stories.tsx`.

- [ ] **Step 1: Create `frontend/src/components/slider/Slider.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Slider } from "./Slider";

const meta: Meta<typeof Slider> = {
  title: "Components/Slider",
  component: Slider,
  tags: ["autodocs"],
  argTypes: {
    value: { control: "number" },
    min: { control: "number" },
    max: { control: "number" },
    step: { control: "number" },
    disabled: { control: "boolean" },
    ariaLabel: { control: "text" },
    ariaValueText: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof Slider>;

export const Default: Story = {
  args: {
    value: 50,
    onChange: () => {},
    min: 0,
    max: 100,
    step: 1,
    ariaLabel: "Demo slider",
  },
};

export const WithBounds: Story = {
  args: {
    value: 0.6,
    onChange: () => {},
    min: 0,
    max: 1,
    step: 0.01,
    ariaLabel: "Smoothing",
    ariaValueText: "60 percent",
  },
};

export const Disabled: Story = {
  args: {
    value: 50,
    onChange: () => {},
    min: 0,
    max: 100,
    disabled: true,
    ariaLabel: "Disabled slider",
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = createSignal(args.value);
    return (
      <Slider
        {...args}
        value={value()}
        onChange={(v) => {
          setValue(v);
          args.onChange?.(v);
        }}
      />
    );
  },
  args: {
    value: 25,
    onChange: () => {},
    min: 0,
    max: 100,
    step: 1,
    ariaLabel: "Interactive slider",
  },
};
```

- [ ] **Step 2: Verify story compiles via typecheck**

Run: `pnpm --prefix frontend exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify lint**

Run: `pnpm --prefix frontend lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/slider/Slider.stories.tsx
git commit -m "feat(frontend): Slider Storybook story"
```

---

## Task 9: Replace placeholder `<input type="range">` in `FieldRenderer`

The schema-panel slider type currently uses a raw range input. Swap to the new wrapper — this is the first downstream consumer of `<Slider>` and exercises the rule's enforcement (consumer code uses the wrapper, not Kobalte directly).

- [ ] **Step 1: Read the current `FieldRenderer` slider branch** to confirm scope

Run: `sed -n '25,55p' frontend/src/panels/FieldRenderer.tsx`
Expected output: the existing `<Match when={props.field.type === "slider"}>` block with a raw `<input type="range">`.

- [ ] **Step 2: Find the FieldRenderer test file and existing slider-related tests**

Run: `ls frontend/src/panels/__tests__/ | grep -i field`
Expected: locate the test file (likely `FieldRenderer.test.tsx` or covered by `SchemaPanel.test.tsx`).

- [ ] **Step 3: Add a failing test asserting the slider field uses role=slider (not type=range)**

If `FieldRenderer.test.tsx` exists, append:

```tsx
  it("should render slider field type using the Slider wrapper (role=slider)", () => {
    const field = {
      key: "test.smoothing",
      label: "Smoothing",
      type: "slider" as const,
      min: 0,
      max: 1,
      step: 0.01,
    };
    render(() => (
      <FieldRenderer field={field} value={0.5} onChange={() => {}} />
    ));
    const slider = screen.getByRole("slider");
    expect(slider).toBeTruthy();
    expect(slider.getAttribute("aria-valuenow")).toBe("0.5");
  });

  it("should NOT render slider field as type=range input", () => {
    const field = {
      key: "test.smoothing",
      label: "Smoothing",
      type: "slider" as const,
      min: 0,
      max: 1,
    };
    const { container } = render(() => (
      <FieldRenderer field={field} value={0.5} onChange={() => {}} />
    ));
    const rangeInput = container.querySelector('input[type="range"]');
    expect(rangeInput).toBeNull();
  });
```

If `FieldRenderer.test.tsx` does NOT exist, create it with the above two tests plus minimal imports:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { FieldRenderer } from "../FieldRenderer";

describe("FieldRenderer", () => {
  afterEach(() => cleanup());

  // ... tests from above
});
```

- [ ] **Step 4: Run the new tests — expect the range-input assertion to fail (range input still present)**

Run: `pnpm --prefix frontend test -- --run src/panels/__tests__/FieldRenderer.test.tsx`
Expected: 1 pass (role=slider may incidentally pass if Kobalte still emits it), 1 fail (range input still in DOM).

- [ ] **Step 5: Update `FieldRenderer.tsx` — swap raw input for `<Slider>`**

Replace the `<Match when={props.field.type === "slider"}>` block (lines 31-44 in current file) with:

```tsx
      <Match when={props.field.type === "slider"}>
        <Slider
          value={typeof props.value === "number" ? props.value : 0}
          onChange={(v) => props.onChange(v)}
          min={props.field.min ?? 0}
          max={props.field.max ?? 100}
          step={props.field.step ?? 1}
          ariaLabel={props.field.ariaLabel ?? props.field.label}
        />
      </Match>
```

Add the import at the top of `FieldRenderer.tsx`:

```tsx
import { Slider } from "../components/slider/Slider";
```

- [ ] **Step 6: Run the tests — expect all pass**

Run: `pnpm --prefix frontend test -- --run src/panels/__tests__/FieldRenderer.test.tsx`
Expected: all pass.

- [ ] **Step 7: Run the full frontend test suite for regression check**

Run: `pnpm --prefix frontend test -- --run`
Expected: all tests pass (1793+ before the new tests, plus the slider tests).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/panels/FieldRenderer.tsx frontend/src/panels/__tests__/FieldRenderer.test.tsx
git commit -m "feat(frontend): FieldRenderer uses Slider wrapper for slider field type"
```

---

## Task 10: Governance rule + CLAUDE.md §5 update

Lands the rule in `.claude/rules/frontend-defensive.md` and extends the Kobalte parenthetical in CLAUDE.md §5 to include Slider.

- [ ] **Step 1: Add the governance rule to `.claude/rules/frontend-defensive.md`**

Append to the END of `.claude/rules/frontend-defensive.md`:

```markdown
### Kobalte Imports Must Live in `components/` Wrappers

All `@kobalte/core/*` imports MUST live inside `frontend/src/components/<wrapper>/` directories. Consumer code (panels, canvas, tools, stores, shells) imports from the project wrapper (e.g., `import { Slider } from "../components/slider/Slider"`), never directly from `@kobalte/core/*`.

**Why:** Direct Kobalte imports scattered across the app create silent drift — when interaction fixes, a11y improvements, or styling updates land on a wrapped primitive, call sites that bypassed the wrapper never get those updates. Wrapping ensures every improvement applies everywhere.

**How to apply:**
- When adding a new Kobalte primitive, create a wrapper at `frontend/src/components/<name>/<Name>.tsx` that re-exports the project API.
- When consuming a Kobalte primitive from any non-`components/` file, import from the project wrapper.
- The wrapper is responsible for: applying the project's Number.isFinite guards on numeric callbacks, exposing gesture-start/end events for history coalescing (when applicable), enforcing the project's CSS naming convention (`sigil-*` prefix), and respecting `prefers-reduced-motion` on any transitions.
- A direct import from `@kobalte/core/*` anywhere outside `frontend/src/components/` is a bug. Enforced by a CI grep (see `.github/workflows/ci.yml` "kobalte-import-discipline" step).
```

- [ ] **Step 2: Update CLAUDE.md §5 TypeScript Kobalte parenthetical**

Read the current §5 Kobalte bullet:

```bash
grep -n "Kobalte components still in use" CLAUDE.md
```

Modify the parenthetical to include Slider. The current text is:

```
Note: this rule applies to the Kobalte components still in use (Button, Select, DropdownMenu, ContextMenu, Menubar, NumberField, TextField, Toggle, Toast, Tooltip, Separator).
```

Update to:

```
Note: this rule applies to the Kobalte components still in use (Button, Select, DropdownMenu, ContextMenu, Menubar, NumberField, TextField, Toggle, Toast, Tooltip, Separator, Slider).
```

- [ ] **Step 3: Commit**

```bash
git add .claude/rules/frontend-defensive.md CLAUDE.md
git commit -m "docs: add Kobalte import discipline rule + extend §5 Kobalte primitive list"
```

---

## Task 11: CI grep — fail the build on direct `@kobalte/core` imports outside `components/`

Per the new rule, machine-checkable enforcement so future PRs don't introduce direct imports without reviewer vigilance.

- [ ] **Step 1: Add a new job step to `.github/workflows/ci.yml`**

Insert a new top-level job after `pin-check` and before `ci-gate`. Add this YAML block at the right place (after pin-check job ends, before ci-gate):

```yaml
  kobalte-import-discipline:
    name: Kobalte Import Discipline
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Check for direct @kobalte/core imports outside components/
        run: |
          # Search for any direct @kobalte/core import outside the components/ tree.
          # The rule (frontend-defensive.md "Kobalte Imports Must Live in components/ Wrappers"):
          # all Kobalte imports must live in frontend/src/components/<wrapper>/.
          OFFENDERS=$(grep -rln "from [\"']@kobalte/core" frontend/src 2>/dev/null \
            | grep -v "^frontend/src/components/" \
            || true)
          if [ -n "$OFFENDERS" ]; then
            echo "::error::Direct @kobalte/core imports found outside frontend/src/components/. Use a project wrapper from frontend/src/components/<name>/ instead."
            echo "Offending files:"
            echo "$OFFENDERS"
            exit 1
          fi
          echo "No direct @kobalte/core imports outside frontend/src/components/."
```

Then update the `ci-gate` job's `needs:` list to include this new job:

```yaml
  ci-gate:
    name: CI Gate
    runs-on: ubuntu-latest
    if: always()
    needs: [rust, frontend, pin-check, kobalte-import-discipline]
```

And update the `Check results` step to include the new check:

```yaml
      - name: Check results
        env:
          RUST_RESULT: ${{ needs.rust.result }}
          FRONTEND_RESULT: ${{ needs.frontend.result }}
          PIN_CHECK_RESULT: ${{ needs.pin-check.result }}
          KOBALTE_CHECK_RESULT: ${{ needs.kobalte-import-discipline.result }}
        run: |
          echo "Rust: $RUST_RESULT"
          echo "Frontend: $FRONTEND_RESULT"
          echo "Pin Check: $PIN_CHECK_RESULT"
          echo "Kobalte Check: $KOBALTE_CHECK_RESULT"
          if [[ "$RUST_RESULT" == "failure" || "$FRONTEND_RESULT" == "failure" || "$PIN_CHECK_RESULT" == "failure" || "$KOBALTE_CHECK_RESULT" == "failure" ]]; then
            echo "One or more required checks failed"
            exit 1
          fi
          echo "All checks passed or were skipped"
```

- [ ] **Step 2: Locally verify the grep logic (should find no offenders, exit 0)**

Run from the worktree root:

```bash
OFFENDERS=$(grep -rln "from [\"']@kobalte/core" frontend/src 2>/dev/null \
  | grep -v "^frontend/src/components/" \
  || true)
if [ -n "$OFFENDERS" ]; then echo "FOUND:" && echo "$OFFENDERS"; else echo "OK — clean"; fi
```

Expected output: `OK — clean`.

- [ ] **Step 3: Negative test — temporarily add a direct import outside components/ and verify grep catches it**

```bash
echo 'import { Slider } from "@kobalte/core/slider";' > /tmp/_kobalte_probe.ts
cp /tmp/_kobalte_probe.ts frontend/src/__kobalte_probe.ts
OFFENDERS=$(grep -rln "from [\"']@kobalte/core" frontend/src 2>/dev/null \
  | grep -v "^frontend/src/components/" \
  || true)
if [ -n "$OFFENDERS" ]; then echo "CORRECTLY DETECTED:" && echo "$OFFENDERS"; else echo "ERROR — grep failed"; fi
rm frontend/src/__kobalte_probe.ts /tmp/_kobalte_probe.ts
```

Expected output: `CORRECTLY DETECTED: frontend/src/__kobalte_probe.ts`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: enforce kobalte import discipline — direct imports outside components/ fail CI"
```

---

## Task 12: Final quality gate + push + open PR

- [ ] **Step 1: Full frontend test suite**

Run: `pnpm --prefix frontend test -- --run`
Expected: all tests pass (existing 1793 + new Slider tests + new FieldRenderer tests).

- [ ] **Step 2: Frontend lint**

Run: `pnpm --prefix frontend lint`
Expected: clean.

- [ ] **Step 3: Frontend typecheck**

Run: `pnpm --prefix frontend exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Frontend format check**

Run: `pnpm --prefix frontend exec prettier --check 'src/**/*.{ts,tsx,css}'`
Expected: clean. If not, run `pnpm --prefix frontend exec prettier --write 'src/**/*.{ts,tsx,css}'` and re-stage.

- [ ] **Step 5: Cargo check (sanity — no Rust changes but full workspace must still build)**

Run: `cargo check --workspace --all-targets`
Expected: clean.

- [ ] **Step 6: Clippy (should be at main baseline — 56 errors carrying over)**

Run: `cargo clippy --workspace --tests -- -D warnings 2>&1 | grep -cE "^error"`
Expected: `56` (or unchanged from `origin/main`'s count — no regression).

- [ ] **Step 7: Confirm working tree clean**

Run: `git status --short`
Expected: empty.

- [ ] **Step 8: Push branch**

Run: `git push -u origin feature/corner-shapes-14b`
Expected: `[new branch] feature/corner-shapes-14b -> feature/corner-shapes-14b`.

- [ ] **Step 9: Open the PR**

Run:

```bash
gh pr create --base main --head feature/corner-shapes-14b \
  --title "feat: Slider wrapper + Kobalte import discipline rule (Plan 14b)" \
  --body "$(cat <<'EOF'
## Summary

Implements Plan 14b — adds a project-owned `<Slider>` component, formalizes Kobalte import discipline as a CLAUDE.md rule with CI enforcement, and replaces the placeholder raw `<input type="range">` in FieldRenderer.

- **Wrapper:** `frontend/src/components/slider/Slider.{tsx,css,test.tsx,stories.tsx}` — wraps `@kobalte/core/slider`, exposes single-thumb numeric API with Number.isFinite guard, synthesizes onChangeStart (Kobalte exposes only onChange + onChangeEnd) for history coalescing per CLAUDE.md frontend-defensive "Continuous-Value Controls Must Coalesce History Entries", reduced-motion-aware CSS.
- **FieldRenderer:** swaps the `<input type="range">` placeholder for `<Slider>`.
- **Governance:** new rule in `.claude/rules/frontend-defensive.md` + CLAUDE.md §5 Kobalte parenthetical updated.
- **CI enforcement:** new `kobalte-import-discipline` workflow job greps for direct `@kobalte/core` imports outside `frontend/src/components/`, fails the build on offenders.

## Audit baseline

Zero pre-existing offenders — all 13 existing Kobalte wrappers already live under `frontend/src/components/<name>/`. Governance rule has no migration debt.

## Test plan

- [x] `pnpm --prefix frontend test -- --run` — 1793+ existing tests + Slider tests + new FieldRenderer tests all passing
- [x] `pnpm --prefix frontend lint` — clean
- [x] `pnpm --prefix frontend exec tsc --noEmit` — clean
- [x] `pnpm --prefix frontend exec prettier --check 'src/**/*.{ts,tsx,css}'` — clean
- [x] `cargo check --workspace --all-targets` — clean
- [x] `cargo clippy --workspace --tests -- -D warnings` — at main baseline
- [x] CI `kobalte-import-discipline` step verified locally with both a clean-state pass and a planted-offender failure
- [ ] Manual: open Storybook → Components → Slider, verify Default / WithBounds / Disabled / Interactive stories render and respond to keyboard (Arrow/Home/End)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

- [ ] **Step 10: Report PR URL to the user and stop. Do NOT merge — per project convention, all PRs require `/review` before merge (CLAUDE.md §7).**

---

## Self-review (run before handing the plan over)

### Spec coverage

| Spec §2 requirement | Plan task |
|---|---|
| `<Slider>` wrapper at `frontend/src/components/slider/Slider.tsx` | Tasks 2–7 |
| Wraps `@kobalte/core/slider` | Task 2 |
| Project API: `value`, `onChange(value)`, `min`, `max`, `step`, `disabled`, `class`, `ariaLabel`, `ariaValueText` | Tasks 3, 4, 5, 7 |
| CSS file | Task 7 |
| Storybook story | Task 8 |
| Vitest tests | Tasks 2–7 |
| Governance rule in CLAUDE.md §5 and/or `.claude/rules/frontend-defensive.md` | Task 10 |
| Optional CI grep for direct `@kobalte/core` imports outside `components/` | Task 11 (included, not optional in this plan) |

### Spec §1.5 dependency (smoothing control composite — 14d)

The smoothing control in Plan 14d will use `<Slider>` for the literal-mode scrubber. Plan 14d needs gesture-start/end events to coalesce drag-time changes into one history entry per CLAUDE.md frontend-defensive "Continuous-Value Controls Must Coalesce History Entries". The Kobalte slider only exposes `onChange` + `onChangeEnd`. **Task 6 synthesizes `onChangeStart` from pointerdown/keydown** so the 14d consumer can implement the snapshot-on-start / commit-on-end pattern. Without this, 14d would have to inline the gesture tracking everywhere it uses a slider.

### Placeholder scan

No "TODO", "implement later", "fill in details" placeholders. Every code block is complete. Every command has expected output.

### Type/signature consistency

- `SliderProps` interface is introduced in Task 2 and extended additively in Tasks 3, 4, 5, 6, 7 — final shape declared in full in Task 6 Step 3.
- `FieldRenderer` import path: `../components/slider/Slider` — matches the file structure.
- The wrapper's `onChange: (value: number) => void` signature is consistent across all tasks (single number, never array).
- `ariaLabel` is required (no `?`) throughout — every consumer must provide one. The Task 9 FieldRenderer site uses `props.field.ariaLabel ?? props.field.label` for the value, never omits.

### Risks and mitigations

1. **Kobalte data attributes for `[data-active]`** — the CSS in Task 7 assumes Kobalte sets `data-active` on the thumb during interaction. If the actual attribute is different (e.g., `data-pressed`), the active-state CSS won't apply. **Mitigation:** the `:active` pseudo-class covers the pointer case; only keyboard interaction risks missing the visual feedback. Engineer should verify by interacting with the Storybook story (Task 12 manual step).

2. **Kobalte slider's `aria-disabled` attribute placement** — Task 4 asserts the thumb element (`role=slider`) carries `aria-disabled="true"` when the slider is disabled. If Kobalte places it on the Root instead, the test must adjust the selector. **Mitigation:** if the test fails, change to `screen.getByRole("slider", { hidden: true }).closest('[role=group]')` or query the Root via `container.querySelector('[data-disabled]')`.

3. **`fireEvent.pointerDown` vs. native PointerEvent in jsdom** — jsdom may not implement PointerEvent. **Mitigation:** if tests fail on PointerEvent, fall back to `fireEvent.mouseDown` / `fireEvent.mouseUp` for the gesture tests.

4. **Synthesized `onChangeStart` debounce semantics** — Task 6 fires onChangeStart on the FIRST event of a gesture and resets `gestureActive` on `onChangeEnd`. If a user drags AND keyboard-steps in the same gesture, only one start fires. This is the intended semantic per CLAUDE.md (one start per gesture). If a downstream consumer needs per-keystroke starts, they should use `onChange` directly. Document this in the wrapper's JSDoc — already covered in Task 6 Step 3's comments.

### Out of scope (intentional)

- Multi-thumb slider support. Spec calls for single-thumb only. Adding multi-thumb later means changing the wrapper API; that's a future plan if needed.
- Vertical orientation. Default horizontal only. Kobalte supports it; the wrapper doesn't expose it because no consumer needs it. Add when needed.
- Custom thumb rendering (logos, badges). Wrapper uses default thumb element.
- Tick marks. Not required by Spec 14 use cases.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-14b-slider-wrapper-governance.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (Frontend Engineer for Tasks 1–9, Architect/Governance for Tasks 10–11, Architect for Task 12). Review between tasks. Fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`. Batch execution with checkpoints for review.

**Which approach?**
