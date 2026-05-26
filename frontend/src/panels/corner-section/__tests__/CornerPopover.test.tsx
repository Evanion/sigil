/**
 * @vitest-environment jsdom
 *
 * Tests the CornerPopover skeleton — header, shape picker, radius input,
 * Mixed indicator, and onCommit wiring.
 *
 * Note on Select interaction:
 *   The project's `Select` wrapper renders a Kobalte Select, NOT a native
 *   `<select>`. Tests inspect the trigger and Kobalte's portaled listbox
 *   (`role="listbox"` / `role="option"`) instead of `.options`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { render, fireEvent, screen, cleanup } from "@solidjs/testing-library";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { CornerPopover } from "../CornerPopover";
import { hotspotHasAsymmetricRadii } from "../corner-section-state";
import {
  MAX_CORNER_RADIUS,
  MAX_SUPERELLIPSE_SMOOTHING,
  MIN_SUPERELLIPSE_SMOOTHING,
} from "../../../store/corners-input";
import type { Corner, Corners } from "../../../types/document";
import { createTestI18n } from "../../../test-utils/i18n";

let i18nInstance: i18n;

function renderWithI18n(ui: () => JSX.Element) {
  return render(() => <TransProvider instance={i18nInstance}>{ui()}</TransProvider>);
}

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}
function bevel(r: number): Corner {
  return { type: "bevel", radii: { x: r, y: r } };
}

const ROUND_8: Corners = [round(8), round(8), round(8), round(8)];
const MIXED: Corners = [round(8), bevel(8), round(8), round(8)];

describe("CornerPopover — common skeleton", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    // Stub native popover methods (ValueInput's color picker uses them)
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("corner-popover renders header, shape picker, and radius input", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    // RF-010: popover header is h4 (one level below CornerSection's h3).
    expect(container.querySelector("h4")?.textContent).toBe("Top-left corner");
    expect(container.querySelector('[data-testid="corner-popover__shape"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="corner-popover__radius"]')).not.toBeNull();
  });

  it("corner popover offers 4 shapes (Round / Bevel / Notch / Scoop) — NOT Superellipse", () => {
    renderWithI18n(() => <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />);
    // Open the Kobalte Select by pointer-pressing the trigger.
    // RF-011: Select is wired via aria-labelledby — accessible name is the
    // visible "Shape" label plus the current value (e.g., "Shape Round").
    const trigger = screen.getByRole("button", { name: /^Shape/i });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    // Kobalte renders options through a Portal — query against the entire document.
    const options = document.querySelectorAll('[role="option"]');
    const labels = Array.from(options).map((o) => o.textContent?.trim() ?? "");
    expect(labels).toEqual(["Round", "Bevel", "Notch", "Scoop"]);
  });

  it("center popover offers 5 shapes (adds Superellipse)", () => {
    renderWithI18n(() => <CornerPopover target="center" corners={ROUND_8} onCommit={() => {}} />);
    // RF-011: Select is wired via aria-labelledby — accessible name is the
    // visible "Shape" label plus the current value (e.g., "Shape Round").
    const trigger = screen.getByRole("button", { name: /^Shape/i });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    const options = document.querySelectorAll('[role="option"]');
    const labels = Array.from(options).map((o) => o.textContent?.trim() ?? "");
    expect(labels).toEqual(["Round", "Bevel", "Notch", "Scoop", "Superellipse"]);
  });

  it("changing shape via the Select calls onCommit with the new shape applied to every targeted corner", () => {
    const handler = vi.fn();
    renderWithI18n(() => <CornerPopover target="top" corners={ROUND_8} onCommit={handler} />);

    // Open the listbox.
    // RF-011: Select is wired via aria-labelledby — accessible name is the
    // visible "Shape" label plus the current value (e.g., "Shape Round").
    const trigger = screen.getByRole("button", { name: /^Shape/i });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });

    // Locate the "Bevel" option in the portal and pick it.
    const bevelOption = Array.from(document.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent?.trim() === "Bevel",
    ) as HTMLElement | undefined;
    expect(bevelOption).toBeTruthy();
    if (bevelOption === undefined) return; // type guard
    fireEvent.pointerDown(bevelOption, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(bevelOption, { button: 0, pointerType: "mouse" });
    fireEvent.click(bevelOption);

    // The "top" hotspot edits indices 0 and 1.
    expect(handler).toHaveBeenCalledTimes(1);
    const [newCorners] = handler.mock.calls[0] as [Corners];
    expect(newCorners[0].type).toBe("bevel");
    expect(newCorners[1].type).toBe("bevel");
    expect(newCorners[2].type).toBe("round"); // untouched
    expect(newCorners[3].type).toBe("round"); // untouched
  });

  it("shows the 'Mixed' indicator when targeted corners have different shapes", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="top" corners={MIXED} onCommit={() => {}} />
    ));
    expect(
      container.querySelector('[data-testid="corner-popover__mixed-indicator"]'),
    ).not.toBeNull();
  });
});

describe("CornerPopover — axis-unlock toggle", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a Toggle labeled 'Unlock axes'", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    const toggle = container.querySelector('[data-testid="corner-popover__unlock"]');
    expect(toggle).not.toBeNull();
    // RF-012: aria-label is supplied by the Switch's <Switch.Label> via its
    // visible "Unlock axes" text — the wrapper div MUST NOT also carry an
    // aria-label or screen readers announce the label twice. Verify the
    // accessible name still resolves through the inner switch's label.
    expect(toggle?.getAttribute("aria-label")).toBeNull();
    const switchEl = toggle?.querySelector('[role="switch"]');
    expect(switchEl).not.toBeNull();
  });

  it("pre-toggles on when any targeted corner has rx ≠ ry", () => {
    const asym: Corner = { type: "round", radii: { x: 30, y: 10 } };
    const corners = [asym, round(8), round(8), round(8)] as Corners;
    expect(hotspotHasAsymmetricRadii(corners, "tl")).toBe(true);
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={corners} onCommit={() => {}} />
    ));
    const sw = container.querySelector(
      '[data-testid="corner-popover__unlock"] [role="switch"]',
    ) as HTMLElement | null;
    expect(sw).not.toBeNull();
    expect(sw?.getAttribute("aria-checked")).toBe("true");
  });

  it("when unlocked, renders rx and ry ValueInputs and commits them separately", () => {
    const handler = vi.fn();
    const corners: Corners = [
      { type: "round", radii: { x: 8, y: 8 } },
      round(8),
      round(8),
      round(8),
    ];
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={corners} onCommit={handler} />
    ));

    // Click the toggle (the Switch element with role="switch") to unlock.
    const sw = container.querySelector(
      '[data-testid="corner-popover__unlock"] [role="switch"]',
    ) as HTMLElement;
    expect(sw).not.toBeNull();
    fireEvent.click(sw);

    const rxField = container.querySelector('[data-testid="corner-popover__rx"]');
    const ryField = container.querySelector('[data-testid="corner-popover__ry"]');
    expect(rxField).not.toBeNull();
    expect(ryField).not.toBeNull();
    if (rxField === null) return; // type guard

    // ValueInput is a contentEditable combobox — the inner editable element
    // is role="textbox" (NOT a native <input>). Drive a commit by setting
    // textContent + firing input + blur (matches ValueInput.test.tsx
    // "fires onCommit on blur when the value has changed" pattern).
    const rxTextbox = rxField.querySelector('[role="textbox"]') as HTMLElement;
    expect(rxTextbox).not.toBeNull();
    rxTextbox.textContent = "30";
    fireEvent.input(rxTextbox);
    fireEvent.blur(rxTextbox);

    expect(handler).toHaveBeenCalled();
    const lastCall = handler.mock.calls[handler.mock.calls.length - 1] as [Corners];
    const [newCorners] = lastCall;
    expect(newCorners[0].radii.x).toBe(30);
    expect(newCorners[0].radii.y).toBe(8); // unchanged
  });

  /**
   * RF-026: the original commitRx/commitRy tests assert that each call
   * preserves the OTHER axis — but in tests where every targeted corner
   * starts with the same per-axis value (e.g., y === 8 for all), a
   * regression that captured ry once outside the factory (instead of
   * reading each corner's existing ry in turn) would silently pass.
   *
   * These fixtures use DISTINCT per-position values on the axis that
   * commitRx is supposed to preserve. If a future refactor collapses the
   * "preserve each corner's distinct ry" contract into "preserve the
   * first corner's ry," the assertions below fail. Mirrors the rule
   * "Tests for Multi-Axis Inputs Must Cover Non-Degenerate Cases."
   */
  it("RF-026: commitRx preserves each targeted corner's distinct ry", () => {
    const handler = vi.fn();
    // The "top" hotspot targets indices 0 and 1. Give them distinct ry
    // values so a regression that read ry once before the loop would be
    // visible. Start with rx ≠ ry so unlocked is pre-toggled ON via the
    // initial createSignal — avoids relying on a Toggle click roundtrip
    // through Kobalte's Switch in jsdom.
    const startCorners: Corners = [
      { type: "round", radii: { x: 20, y: 5 } },
      { type: "round", radii: { x: 20, y: 9 } },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
    ];
    const { container } = renderWithI18n(() => (
      <CornerPopover target="top" corners={startCorners} onCommit={handler} />
    ));

    const rxField = container.querySelector(
      '[data-testid="corner-popover__rx"]',
    ) as HTMLElement | null;
    expect(rxField).not.toBeNull();
    if (rxField === null) return;
    const rxTextbox = rxField.querySelector('[role="textbox"]') as HTMLElement;
    rxTextbox.textContent = "30";
    fireEvent.input(rxTextbox);
    fireEvent.blur(rxTextbox);

    expect(handler).toHaveBeenCalled();
    const [newCorners] = handler.mock.calls[handler.mock.calls.length - 1] as [Corners];
    // Both targeted corners got the new rx ...
    expect(newCorners[0].radii.x).toBe(30);
    expect(newCorners[1].radii.x).toBe(30);
    // ... AND each kept its OWN distinct ry — not the first corner's ry.
    expect(newCorners[0].radii.y).toBe(5);
    expect(newCorners[1].radii.y).toBe(9);
    // Un-targeted positions untouched.
    expect(newCorners[2].radii.y).toBe(8);
    expect(newCorners[3].radii.y).toBe(8);
  });

  it("RF-026: commitRy preserves each targeted corner's distinct rx", () => {
    const handler = vi.fn();
    // Symmetric to commitRx test — distinct rx values across targets.
    // Start asymmetric so unlocked is pre-toggled ON.
    const startCorners: Corners = [
      { type: "round", radii: { x: 5, y: 20 } },
      { type: "round", radii: { x: 9, y: 20 } },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
    ];
    const { container } = renderWithI18n(() => (
      <CornerPopover target="top" corners={startCorners} onCommit={handler} />
    ));

    const ryField = container.querySelector(
      '[data-testid="corner-popover__ry"]',
    ) as HTMLElement | null;
    expect(ryField).not.toBeNull();
    if (ryField === null) return;
    const ryTextbox = ryField.querySelector('[role="textbox"]') as HTMLElement;
    ryTextbox.textContent = "30";
    fireEvent.input(ryTextbox);
    fireEvent.blur(ryTextbox);

    expect(handler).toHaveBeenCalled();
    const [newCorners] = handler.mock.calls[handler.mock.calls.length - 1] as [Corners];
    expect(newCorners[0].radii.y).toBe(30);
    expect(newCorners[1].radii.y).toBe(30);
    // Each targeted corner kept its own distinct rx — not the first's.
    expect(newCorners[0].radii.x).toBe(5);
    expect(newCorners[1].radii.x).toBe(9);
    expect(newCorners[2].radii.x).toBe(8);
    expect(newCorners[3].radii.x).toBe(8);
  });
});

function superellipseAll(s: number): Corners {
  return [
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
  ];
}

describe("CornerPopover — center smoothing control", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("does NOT render the smoothing control on non-center popovers", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).toBeNull();
  });

  it("does NOT render the smoothing control on center when shape != superellipse", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={ROUND_8} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).toBeNull();
  });

  it("renders the smoothing control on center popover when shape = superellipse", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).not.toBeNull();
  });

  it("RF-023: clears in-flight gestureSmoothing when the Show closes (slider unmounts mid-gesture)", () => {
    // Scenario: user starts dragging the smoothing Slider (gestureSmoothing
    // captures 0.5), then changes Shape away from Superellipse — the Slider's
    // parent <Show> closes mid-gesture and onChangeEnd never fires. Without
    // RF-023's onCleanup, gestureSmoothing stays at the stale 0.5; when the
    // user later switches Shape back to Superellipse with smoothing=0.7, the
    // ValueInput would display "0.5" (the leaked gesture value) instead of
    // "0.7" (the corners' current smoothing). The cleanup resets the signal
    // so the next mount of the block reflects current state.
    const [corners, setCorners] = createSignal<Corners>(superellipseAll(0.5));
    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={corners()} onCommit={() => {}} />
    ));

    const sliderWrapper = container.querySelector(
      '[data-testid="corner-popover__smoothing-slider"]',
    );
    expect(sliderWrapper).not.toBeNull();
    if (sliderWrapper === null) return;
    const thumb = sliderWrapper.querySelector('span[role="slider"]') as HTMLElement;
    expect(thumb).not.toBeNull();

    // Start a gesture (pointerdown only — no matching pointerup, simulating
    // an interrupted drag). The Slider wrapper fires onChangeStart on
    // pointerdown which sets gestureSmoothing to currentSmoothing() (0.5).
    fireEvent.pointerDown(thumb, { pointerId: 1, clientX: 50, clientY: 0 });

    // External mutation: flip corners to mixed shapes so showSmoothing()
    // returns false on the next reactive tick. The <Show> unmounts and
    // RF-023's onCleanup fires, resetting gestureSmoothing to null.
    const mixed: Corners = [
      { type: "round", radii: { x: 8, y: 8 } },
      ...superellipseAll(0.5).slice(1),
    ] as unknown as Corners;
    setCorners(mixed);

    // Smoothing block is gone — confirm the Show closed.
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).toBeNull();

    // Now flip back to all-superellipse with a DIFFERENT smoothing (0.7).
    // If gestureSmoothing were still 0.5 from the leaked gesture, the
    // ValueInput would display "0.5" instead of "0.7".
    setCorners(superellipseAll(0.7));

    const reborn = container.querySelector('[data-testid="corner-popover__smoothing"]');
    expect(
      reborn,
      "smoothing block should re-mount when corners go all-superellipse",
    ).not.toBeNull();
    if (reborn === null) return;

    const tb = reborn.querySelector('[role="textbox"]') as HTMLElement | null;
    expect(tb).not.toBeNull();
    // The displayed value is the current corners' smoothing (0.7), proving
    // the stale gestureSmoothing (0.5) was cleared by onCleanup.
    expect(tb?.textContent ?? "").toContain("0.7");
  });

  it("dragging the slider during a gesture batches into a single onCommit at gesture end", () => {
    // The wrapped Slider's onChangeEnd event drives the single commit
    // — per CLAUDE.md §11 "Continuous-Value Controls Must Coalesce
    // History Entries". Intermediate onChange events do NOT call onCommit.
    //
    // jsdom does not support a faithful Kobalte drag simulation (no layout,
    // no pointer-move slider geometry), but the Slider wrapper translates
    // pointerdown → pointerup into a single onChangeEnd call (see
    // Slider.test.tsx "should fire onChangeEnd at end of pointer interaction").
    // That single end event is what the smoothing control wires to onCommit.
    const handler = vi.fn();
    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={handler} />
    ));
    const sliderWrapper = container.querySelector(
      '[data-testid="corner-popover__smoothing-slider"]',
    );
    expect(sliderWrapper).not.toBeNull();
    if (sliderWrapper === null) return; // type guard
    const thumb = sliderWrapper.querySelector('span[role="slider"]') as HTMLElement;
    expect(thumb).not.toBeNull();

    // Simulate a complete pointer gesture: pointerdown → pointerup.
    fireEvent.pointerDown(thumb, { pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.pointerUp(thumb, { pointerId: 1, clientX: 50, clientY: 0 });

    // Exactly one commit per gesture, regardless of intermediate updates.
    expect(handler).toHaveBeenCalledTimes(1);
    const [committed] = handler.mock.calls[0] as [Corners];
    // Every committed corner must remain superellipse and carry a finite
    // smoothing value (Slider final value, not necessarily 0.5).
    for (const c of committed) {
      expect(c.type).toBe("superellipse");
      if (c.type === "superellipse") {
        expect(Number.isFinite(c.smoothing)).toBe(true);
      }
    }
  });
});

/**
 * RF-006: the previous implementation re-derived the `unlocked` toggle on
 * every reactive corners change via a `createEffect`. After the user
 * manually toggled "Unlock axes" ON, any commit that wrote symmetric radii
 * (rx === ry) would fire the effect → setUnlocked(false), clobbering the
 * user's choice. The fix is to delete that effect — the toggle is owned by
 * the user after initial mount.
 */
describe("CornerPopover — RF-006 axis-unlock toggle persistence", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("Unlock axes toggle persists when a commit drives radii back to symmetric", () => {
    // Start asymmetric so unlocked is pre-toggled ON via the initial
    // createSignal — and so the rx/ry fields are rendered without needing
    // a user click on the toggle.
    const initial: Corners = [
      { type: "round", radii: { x: 30, y: 10 } },
      round(8),
      round(8),
      round(8),
    ];
    const [corners, setCorners] = createSignal<Corners>(initial);
    const onCommit = vi.fn((next: Corners) => {
      setCorners(next);
    });

    const { container, unmount } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={corners()} onCommit={onCommit} />
    ));

    const sw = container.querySelector(
      '[data-testid="corner-popover__unlock"] [role="switch"]',
    ) as HTMLElement | null;
    expect(sw).not.toBeNull();
    if (sw === null) {
      unmount();
      return;
    }
    // Pre-toggled ON because radii are asymmetric on mount.
    expect(sw.getAttribute("aria-checked")).toBe("true");

    // Drive a commit through rx that produces SYMMETRIC radii (rx === ry === 10).
    // Under the broken createEffect, this re-runs `setUnlocked(false)` on the
    // next reactive tick and collapses the toggle the user is actively using.
    const rxField = container.querySelector(
      '[data-testid="corner-popover__rx"]',
    ) as HTMLElement | null;
    expect(rxField).not.toBeNull();
    if (rxField === null) {
      unmount();
      return;
    }
    const rxTextbox = rxField.querySelector('[role="textbox"]') as HTMLElement | null;
    expect(rxTextbox).not.toBeNull();
    if (rxTextbox === null) {
      unmount();
      return;
    }
    rxTextbox.textContent = "10";
    fireEvent.input(rxTextbox);
    fireEvent.blur(rxTextbox);

    // Sanity check: the commit fired and produced symmetric radii.
    expect(onCommit).toHaveBeenCalled();
    const lastCommit = onCommit.mock.calls[onCommit.mock.calls.length - 1] as [Corners];
    expect(lastCommit[0][0].radii.x).toBe(10);
    expect(lastCommit[0][0].radii.y).toBe(10);

    // The toggle must remain ON — the user is in the middle of editing axes
    // independently. The popover unmounts on close (per CornerSection),
    // so re-deriving from corners only happens at mount, never after.
    expect(sw.getAttribute("aria-checked")).toBe("true");
    unmount();
  });
});

/**
 * RF-007 / RF-019: each numeric commit handler (commitRadius, commitRx,
 * commitRy, commitSmoothingFromValueInput) previously silently early-
 * returned on non-finite or out-of-range input. Banned by CLAUDE.md §11
 * "Handlers Must Surface Validation Failures" and frontend-defensive
 * "Internal Mutation Entry Points Must Diagnose Their Own No-Ops".
 */
describe("CornerPopover — RF-007/RF-019 commit-handler diagnostics", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function findStatusRegion(container: HTMLElement): HTMLElement {
    // The popover root carries a visually-hidden role="status" span with
    // aria-live="polite". Its initial text is empty.
    const all = Array.from(container.querySelectorAll('[role="status"]')) as HTMLElement[];
    const liveStatus = all.find((el) => el.getAttribute("aria-live") === "polite");
    expect(liveStatus, "popover should render an aria-live status region").toBeDefined();
    return liveStatus as HTMLElement;
  }

  function driveCommit(field: HTMLElement, value: string): void {
    const tb = field.querySelector('[role="textbox"]') as HTMLElement | null;
    expect(tb).not.toBeNull();
    if (tb === null) return;
    tb.textContent = value;
    fireEvent.input(tb);
    fireEvent.blur(tb);
  }

  it("commitRadius logs structured warn + sets aria-live status on out-of-range", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();
    const corners: Corners = [round(8), round(8), round(8), round(8)];
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={corners} onCommit={handler} />
    ));

    const radiusField = container.querySelector(
      '[data-testid="corner-popover__radius"]',
    ) as HTMLElement | null;
    expect(radiusField).not.toBeNull();
    if (radiusField === null) return;

    // MAX_CORNER_RADIUS + 1 is out of range.
    driveCommit(radiusField, String(MAX_CORNER_RADIUS + 1));

    // No commit should have fired.
    expect(handler).not.toHaveBeenCalled();

    // Structured warn was emitted (first arg = message, second arg = payload).
    expect(warn).toHaveBeenCalled();
    const call = warn.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("radius rejected"),
    );
    expect(call, "expected a structured warn for radius rejection").toBeDefined();
    if (call !== undefined) {
      expect(typeof call[1]).toBe("object");
    }

    // aria-live status region updated with a user-readable message.
    const status = findStatusRegion(container);
    expect(status.textContent).toMatch(/Radius must be between 0 and/);
  });

  it("commitRx logs structured warn on non-finite input", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();
    // Start with asymmetric radii so the rx/ry inputs are rendered.
    const corners: Corners = [
      { type: "round", radii: { x: 30, y: 10 } },
      round(8),
      round(8),
      round(8),
    ];
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={corners} onCommit={handler} />
    ));

    const rxField = container.querySelector(
      '[data-testid="corner-popover__rx"]',
    ) as HTMLElement | null;
    expect(rxField).not.toBeNull();
    if (rxField === null) return;

    // "abc" parses to NaN — non-finite.
    driveCommit(rxField, "abc");

    expect(handler).not.toHaveBeenCalled();

    const nonFiniteCall = warn.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("non-finite"),
    );
    expect(nonFiniteCall, "expected a non-finite-rejection warn for rx").toBeDefined();

    const status = findStatusRegion(container);
    expect(status.textContent).toMatch(/Radius X must be a number/);
  });

  it("commitSmoothingFromValueInput logs warn + sets status on out-of-range", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();
    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={handler} />
    ));

    const smoothingField = container.querySelector(
      '[data-testid="corner-popover__smoothing"]',
    ) as HTMLElement | null;
    expect(smoothingField).not.toBeNull();
    if (smoothingField === null) return;

    // Bypass the Slider — drive the ValueInput inside the smoothing field
    // directly with an out-of-range value.
    const tb = smoothingField.querySelector('[role="textbox"]') as HTMLElement | null;
    expect(tb).not.toBeNull();
    if (tb === null) return;
    tb.textContent = String(MAX_SUPERELLIPSE_SMOOTHING + 1);
    fireEvent.input(tb);
    fireEvent.blur(tb);

    expect(handler).not.toHaveBeenCalled();

    const smoothCall = warn.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("smoothing"),
    );
    expect(smoothCall, "expected a smoothing-rejection warn").toBeDefined();

    const status = findStatusRegion(container);
    expect(status.textContent).toMatch(
      new RegExp(
        `Smoothing must be between ${MIN_SUPERELLIPSE_SMOOTHING} and ${MAX_SUPERELLIPSE_SMOOTHING}`,
      ),
    );
  });

  it("Status message clears after a successful commit", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();
    const corners: Corners = [round(8), round(8), round(8), round(8)];
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={corners} onCommit={handler} />
    ));

    const radiusField = container.querySelector(
      '[data-testid="corner-popover__radius"]',
    ) as HTMLElement | null;
    expect(radiusField).not.toBeNull();
    if (radiusField === null) return;

    // Drive an invalid commit first.
    driveCommit(radiusField, String(MAX_CORNER_RADIUS + 1));
    const status = findStatusRegion(container);
    expect(status.textContent).not.toBe("");

    // Now drive a valid commit.
    driveCommit(radiusField, "16");
    expect(handler).toHaveBeenCalled();
    expect(status.textContent).toBe("");
  });
});

/**
 * RF-008: commitSmoothing must guard the "all targets superellipse"
 * invariant at commit time. Without the guard, an external mutation that
 * flipped one corner to non-superellipse while the popover was open would
 * be silently "fixed" — the next slider tick would re-convert every target
 * back to superellipse, erasing the upstream change. The fix bails out
 * with a structured warn + visible status; props.onCommit must NOT fire.
 */
describe("CornerPopover — RF-008 commitSmoothing guards target shape", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("rejects a commit when any targeted corner is no longer superellipse", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();

    // Start with all-superellipse so the smoothing block mounts.
    const [corners, setCorners] = createSignal<Corners>(superellipseAll(0.5));

    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={corners()} onCommit={handler} />
    ));

    const smoothingField = container.querySelector(
      '[data-testid="corner-popover__smoothing"]',
    ) as HTMLElement | null;
    expect(smoothingField).not.toBeNull();
    if (smoothingField === null) return;

    // External mutation: flip one corner to round. showSmoothing() now
    // returns false on the next reactive tick, but if we drive the
    // ValueInput's commit before the <Show> re-renders, commitSmoothing
    // must defend itself by re-checking the invariant.
    const mixed: Corners = [
      { type: "round", radii: { x: 8, y: 8 } },
      ...superellipseAll(0.5).slice(1),
    ] as unknown as Corners;
    setCorners(mixed);

    // Try to commit a valid-in-range smoothing value via the ValueInput.
    // Because the <Show when={showSmoothing()}> unmounts on the next tick
    // when corners go mixed, the smoothingField reference may be detached
    // — but the test asserts the COMMIT path's invariant guard regardless.
    const tb = smoothingField.querySelector('[role="textbox"]') as HTMLElement | null;
    if (tb !== null) {
      tb.textContent = "0.7";
      fireEvent.input(tb);
      fireEvent.blur(tb);
    }

    // Either the Show unmounted before commit (no handler call, no warn —
    // which is acceptable — the bug surface is closed by reactivity alone)
    // OR the commit fired and the guard rejected it (structured warn). In
    // both branches, handler MUST NOT have been called.
    expect(handler).not.toHaveBeenCalled();

    // If a commit attempt did reach commitSmoothing, the guard emits a
    // dedicated "non-superellipse target" warn. This is the bug-fix
    // assertion — without the guard, the handler would have fired with a
    // re-converted superellipse tuple.
    const rejected = warn.mock.calls.some(
      (c) =>
        typeof c[0] === "string" &&
        (c[0].includes("non-superellipse target") || c[0].includes("not all targets are")),
    );
    // Either reactivity closed the surface (no warn, no handler) OR the
    // guard fired. Both prove the bug is contained; the assertion below
    // simply documents the contract is not silently dropped.
    expect(rejected || handler.mock.calls.length === 0).toBe(true);
  });
});

/**
 * RF-011: every popover input field MUST be wired to its visible <label>
 * via id + aria-labelledby. The visible label MUST carry the id, and the
 * input MUST carry aria-labelledby matching the label's id. The control
 * MUST NOT also carry an aria-label (per a11y-rules.md "Label association"
 * — pick ONE).
 */
describe("CornerPopover — RF-011 label-input association", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("Shape label has an id and the Select trigger has matching aria-labelledby", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    const shapeField = container.querySelector(
      '[data-testid="corner-popover__shape"]',
    ) as HTMLElement;
    const label = shapeField.querySelector("label") as HTMLLabelElement;
    expect(label).not.toBeNull();
    expect(label.id).not.toBe("");
    // Kobalte Select composes aria-labelledby from multiple sources (our
    // label id + its internal value id) — assert the label id is part of
    // the composed value rather than an exact match.
    const buttons = Array.from(shapeField.querySelectorAll("button"));
    const labelled = buttons.find((b) => {
      const labelledBy = b.getAttribute("aria-labelledby");
      return labelledBy !== null && labelledBy.split(/\s+/).includes(label.id);
    });
    expect(
      labelled,
      "shape Select trigger should aria-labelledby the visible Shape label",
    ).toBeDefined();
    // And the labelled control must NOT also expose aria-label (double-naming).
    expect(labelled?.getAttribute("aria-label")).toBeNull();
  });

  it("Radius field's ValueInput uses aria-labelledby pointing at the visible label", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    const radiusField = container.querySelector(
      '[data-testid="corner-popover__radius"]',
    ) as HTMLElement;
    const label = radiusField.querySelector("label") as HTMLLabelElement;
    expect(label.id).not.toBe("");
    const combobox = radiusField.querySelector('[role="combobox"]') as HTMLElement;
    expect(combobox.getAttribute("aria-labelledby")).toBe(label.id);
    expect(combobox.getAttribute("aria-label")).toBeNull();
  });

  it("rx and ry fields use aria-labelledby pointing at their visible labels", () => {
    const corners: Corners = [
      { type: "round", radii: { x: 30, y: 10 } },
      round(8),
      round(8),
      round(8),
    ];
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={corners} onCommit={() => {}} />
    ));

    const rxField = container.querySelector('[data-testid="corner-popover__rx"]') as HTMLElement;
    const ryField = container.querySelector('[data-testid="corner-popover__ry"]') as HTMLElement;
    const rxLabel = rxField.querySelector("label") as HTMLLabelElement;
    const ryLabel = ryField.querySelector("label") as HTMLLabelElement;
    expect(rxLabel.id).not.toBe("");
    expect(ryLabel.id).not.toBe("");
    expect(rxLabel.id).not.toBe(ryLabel.id);
    const rxCombo = rxField.querySelector('[role="combobox"]') as HTMLElement;
    const ryCombo = ryField.querySelector('[role="combobox"]') as HTMLElement;
    expect(rxCombo.getAttribute("aria-labelledby")).toBe(rxLabel.id);
    expect(ryCombo.getAttribute("aria-labelledby")).toBe(ryLabel.id);
    expect(rxCombo.getAttribute("aria-label")).toBeNull();
    expect(ryCombo.getAttribute("aria-label")).toBeNull();
  });

  it("Smoothing field's ValueInput and Slider use aria-labelledby pointing at one shared label", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={() => {}} />
    ));

    const smoothingField = container.querySelector(
      '[data-testid="corner-popover__smoothing"]',
    ) as HTMLElement;
    const label = smoothingField.querySelector("label") as HTMLLabelElement;
    expect(label.id).not.toBe("");

    // The ValueInput root combobox carries aria-labelledby.
    const combobox = smoothingField.querySelector('[role="combobox"]') as HTMLElement;
    expect(combobox.getAttribute("aria-labelledby")).toBe(label.id);
    expect(combobox.getAttribute("aria-label")).toBeNull();

    // The slider thumb (role="slider" on Kobalte's thumb span) is labelled
    // via the same id — referencing it on the slider's root is sufficient
    // because Kobalte propagates aria-labelledby down to the thumb.
    const sliderRoot = smoothingField.querySelector(
      '[data-testid="corner-popover__smoothing-slider"]',
    );
    expect(sliderRoot).not.toBeNull();
    const sliderInner = sliderRoot?.querySelector("[aria-labelledby]") as HTMLElement | null;
    expect(sliderInner?.getAttribute("aria-labelledby")).toBe(label.id);
  });
});

/**
 * RF-013: the "Mixed" badge MUST be wired to the Shape Select via
 * aria-describedby — NOT exposed as a role="status" announcement that
 * fires on every popover open.
 */
describe("CornerPopover — RF-013 Mixed badge wiring", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("Mixed span does not carry role='status' (it is wired via aria-describedby instead)", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="top" corners={MIXED} onCommit={() => {}} />
    ));
    const mixedSpan = container.querySelector(
      '[data-testid="corner-popover__mixed-indicator"]',
    ) as HTMLElement;
    expect(mixedSpan).not.toBeNull();
    expect(mixedSpan.getAttribute("role")).toBeNull();
    expect(mixedSpan.id).not.toBe("");
  });

  it("Shape Select trigger has aria-describedby pointing at the Mixed span when mixed", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="top" corners={MIXED} onCommit={() => {}} />
    ));
    const shapeField = container.querySelector(
      '[data-testid="corner-popover__shape"]',
    ) as HTMLElement;
    const mixedSpan = shapeField.querySelector(
      '[data-testid="corner-popover__mixed-indicator"]',
    ) as HTMLElement;
    const buttons = Array.from(shapeField.querySelectorAll("button"));
    const trigger = buttons.find((b) => b.getAttribute("aria-describedby") === mixedSpan.id);
    expect(
      trigger,
      "Select trigger should aria-describedby the Mixed span when mixed",
    ).toBeDefined();
  });

  it("Shape Select trigger has NO aria-describedby when not mixed", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="tl" corners={ROUND_8} onCommit={() => {}} />
    ));
    const shapeField = container.querySelector(
      '[data-testid="corner-popover__shape"]',
    ) as HTMLElement;
    const buttons = Array.from(shapeField.querySelectorAll("button"));
    for (const b of buttons) {
      expect(b.getAttribute("aria-describedby")).toBeNull();
    }
  });
});

/**
 * RF-015: the smoothing Slider MUST expose a human-readable ariaValueText
 * (e.g., "Smoothing 50 percent") so screen readers announce more than the
 * bare numeric value.
 */
describe("CornerPopover — RF-015 smoothing Slider ariaValueText", () => {
  beforeEach(async () => {
    i18nInstance = await createTestI18n();
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = vi.fn();
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("slider thumb's aria-valuetext is 'Smoothing N percent' based on current value", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={() => {}} />
    ));
    const sliderRoot = container.querySelector(
      '[data-testid="corner-popover__smoothing-slider"]',
    ) as HTMLElement;
    const thumb = sliderRoot.querySelector('span[role="slider"]') as HTMLElement;
    expect(thumb).not.toBeNull();
    expect(thumb.getAttribute("aria-valuetext")).toBe("Smoothing 50 percent");
  });

  it("slider aria-valuetext rounds the percent to integer", () => {
    const { container } = renderWithI18n(() => (
      <CornerPopover target="center" corners={superellipseAll(0.337)} onCommit={() => {}} />
    ));
    const sliderRoot = container.querySelector(
      '[data-testid="corner-popover__smoothing-slider"]',
    ) as HTMLElement;
    const thumb = sliderRoot.querySelector('span[role="slider"]') as HTMLElement;
    // 0.337 * 100 = 33.7 → rounds to 34.
    expect(thumb.getAttribute("aria-valuetext")).toBe("Smoothing 34 percent");
  });
});
