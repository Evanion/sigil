/**
 * @vitest-environment jsdom
 *
 * End-to-end reactive pipeline test per CLAUDE.md §11 "Reactive
 * Pipelines Must Be Verified End-to-End": shape picker click → store
 * mutation → next render reflects the new shape AND the preview SVG's
 * aria-label updates accordingly.
 *
 * Uses a minimal harness: a real Solid `createStore` wired to a
 * CornerSection for a single rectangle node. We click the TL hotspot,
 * pick "Bevel" in the shape Select, and assert two things:
 *   1. `doc.node.kind.corners[0].type === "bevel"`  (store mutated)
 *   2. the SVG aria-label on the next render contains "bevel"
 *      (downstream consumer received the value).
 *
 * Notes on jsdom limitations:
 *   - `HTMLElement.showPopover` / `hidePopover` are not implemented in
 *     jsdom — we stub them and dispatch a synthetic `toggle` event to
 *     unblock the Popover wrapper's `<Show when={isOpen()}>` gate.
 *     Mirrors the helper in `CornerSection.test.tsx`.
 *   - The Select wrapper renders a Kobalte Select (not a native
 *     `<select>`). We drive the listbox via pointerDown on the trigger
 *     then click the "Bevel" option in the portal — same pattern as
 *     `CornerPopover.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JSX } from "solid-js";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { createStore } from "solid-js/store";
import { CornerSection } from "../CornerSection";
import type { Corners, DocumentNode } from "../../../types/document";
import { createTestI18n } from "../../../test-utils/i18n";

let i18nInstance: i18n;

function renderWithI18n(ui: () => JSX.Element) {
  return render(() => <TransProvider instance={i18nInstance}>{ui()}</TransProvider>);
}

function rectNode(corners: Corners): DocumentNode {
  return {
    id: { index: 1, generation: 0 },
    uuid: "pipeline-rect",
    kind: { type: "rectangle", corners },
    name: "Pipeline Rect",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 80, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
  };
}

/**
 * jsdom does NOT fire the native `toggle` event when `showPopover()` is
 * stubbed — the Popover wrapper's `isOpen` signal stays false and the
 * `<Show when={isOpen()}>` gate keeps content unmounted. Dispatch a
 * synthetic toggle so the popover body actually renders.
 */
function simulatePopoverToggle(open: boolean): void {
  const popoverEl = document.querySelector(".sigil-popover");
  if (popoverEl === null) return;
  const ev = new Event("toggle") as Event & { newState: string; oldState: string };
  Object.defineProperty(ev, "newState", { value: open ? "open" : "closed" });
  Object.defineProperty(ev, "oldState", { value: open ? "closed" : "open" });
  popoverEl.dispatchEvent(ev);
}

describe("CornerSection pipeline — UI → store → re-render", () => {
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

  it("shape picker change updates the store and the next render reflects the new shape", () => {
    const initial: Corners = [
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
    ];
    const [doc, setDoc] = createStore<{ node: DocumentNode }>({ node: rectNode(initial) });

    function setCorners(uuid: string, corners: Corners): void {
      if (doc.node.uuid !== uuid) return;
      // Replace the whole node — the `kind` field is `readonly` in the
      // shared type, which prevents path-based `setDoc("node", "kind", …)`
      // from typechecking. Replacing the node at the top level is simpler
      // and keeps the assertion below valid (the store-proxied `doc.node`
      // reads the new value after the setter completes).
      setDoc("node", { ...doc.node, kind: { type: "rectangle", corners } });
    }

    const { container } = renderWithI18n(() => (
      <CornerSection node={doc.node} onCorners={(c) => setCorners(doc.node.uuid, c)} />
    ));

    // 1. Click the TL hotspot to open the popover.
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    expect(tl).not.toBeNull();
    fireEvent.click(tl);
    simulatePopoverToggle(true);

    // 2. Open the Kobalte Select trigger inside the shape field.
    // RF-011: the trigger is wired via aria-labelledby (visible label is
    // the accessible name); Kobalte composes that attribute from our label
    // id + an internal value id, so we match by id membership.
    const shapeField = document.querySelector(
      '[data-testid="corner-popover__shape"]',
    ) as HTMLElement;
    expect(shapeField).not.toBeNull();
    const labelEl = shapeField.querySelector("label") as HTMLLabelElement;
    const trigger = (Array.from(shapeField.querySelectorAll("button")).find((b) => {
      const lb = b.getAttribute("aria-labelledby");
      return lb !== null && lb.split(/\s+/).includes(labelEl.id);
    }) ?? null) as HTMLElement | null;
    expect(trigger).not.toBeNull();
    if (trigger === null) return; // type guard
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });

    // 3. Click the "Bevel" option in the portal.
    const bevelOption = Array.from(document.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent?.trim() === "Bevel",
    ) as HTMLElement | undefined;
    expect(bevelOption).toBeTruthy();
    if (bevelOption === undefined) return; // type guard
    fireEvent.pointerDown(bevelOption, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(bevelOption, { button: 0, pointerType: "mouse" });
    fireEvent.click(bevelOption);

    // 4. Verify the store mutated.
    expect(doc.node.kind.type === "rectangle" && doc.node.kind.corners[0].type).toBe("bevel");

    // 5. Verify the preview SVG aria-label reflects the new state. The
    //    aria-label is generated by `summarizeCornersForAria` — for a TL
    //    bevel + 3 round corners the summary degrades to the per-corner
    //    form, which includes the word "bevel". This is the
    //    end-to-end check: store mutated → memo recomputed → renderer
    //    output reflects the change.
    const svg = container.querySelector("svg[role='img']") as SVGElement;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("aria-label")).toContain("bevel");
  });
});
