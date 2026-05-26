/**
 * Popover body rendered inside the project's native <Popover> wrapper
 * (see frontend/src/components/popover/Popover.tsx). Edits one corner,
 * two corners (edge), or all four (center). Form pre-populates from the
 * current corner state at the hotspot's target indices.
 *
 * Spec 14 §1.5 specifies:
 *  - Corner + edge popovers: shape picker (Round/Bevel/Notch/Scoop) +
 *    radius input + "Unlock axes" toggle. NO Superellipse.
 *  - Center popover: same as above PLUS Superellipse option AND
 *    conditional smoothing control when shape = Superellipse.
 *
 * This task (Task 10) implements the common skeleton + shape picker +
 * radius input. Tasks 11 and 12 add the axis-unlock toggle and the
 * smoothing control respectively.
 */

import type { Component } from "solid-js";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { Corner, Corners, Token } from "../../types/document";
import { Select, type SelectOption } from "../../components/select/Select";
import { Slider } from "../../components/slider/Slider";
import { Toggle } from "../../components/toggle/Toggle";
import ValueInput from "../../components/value-input/ValueInput";
import {
  MAX_CORNER_RADIUS,
  MAX_SUPERELLIPSE_SMOOTHING,
  MIN_SUPERELLIPSE_SMOOTHING,
} from "../../store/corners-input";
import {
  CORNER_POSITION_LABEL,
  cornersAtHotspot,
  hotspotHasAsymmetricRadii,
  hotspotShapeIsMixed,
  hotspotTargetIndices,
  type HotspotId,
} from "./corner-section-state";
import "./CornerPopover.css";

type CornerShape = Corner["type"];

export interface CornerPopoverProps {
  /** Which hotspot this popover belongs to. */
  readonly target: HotspotId;
  /** Current full corners state — used to pre-populate the form. */
  readonly corners: Corners;
  /**
   * Called when the user commits a change. Receives the NEW full Corners
   * array (un-targeted positions are preserved unchanged).
   */
  readonly onCommit: (newCorners: Corners) => void;
  /**
   * Token bag forwarded to ValueInput so the radius field can resolve
   * `{name}` references (planned for Tasks 13+; today the popover only
   * accepts literal numbers). Optional — defaults to an empty record.
   */
  readonly tokens?: Record<string, Token>;
}

/** The four shape options offered by corner + edge popovers (Spec 14 §1.5). */
const CORNER_SHAPE_OPTIONS: readonly SelectOption[] = [
  { value: "round", label: "Round" },
  { value: "bevel", label: "Bevel" },
  { value: "notch", label: "Notch" },
  { value: "scoop", label: "Scoop" },
];

/** Center popover adds Superellipse on top of the four corner shapes. */
const CENTER_SHAPE_OPTIONS: readonly SelectOption[] = [
  ...CORNER_SHAPE_OPTIONS,
  { value: "superellipse", label: "Superellipse" },
];

/** Default smoothing applied when a corner first becomes Superellipse. */
const DEFAULT_SUPERELLIPSE_SMOOTHING = 0.5;

/**
 * Builds the popover header for a given hotspot. Single-corner hotspots
 * label by position (e.g., "Top-left corner"); multi-corner hotspots use
 * the canonical "Top corners" / "All corners" labels.
 */
export function headerLabel(target: HotspotId): string {
  switch (target) {
    case "tl":
    case "tr":
    case "br":
    case "bl": {
      const idx = hotspotTargetIndices(target)[0];
      const pos = CORNER_POSITION_LABEL[idx];
      return pos.charAt(0).toUpperCase() + pos.slice(1) + " corner";
    }
    case "top":
      return "Top corners";
    case "right":
      return "Right corners";
    case "bottom":
      return "Bottom corners";
    case "left":
      return "Left corners";
    case "center":
      return "All corners";
    default: {
      const _exhaustive: never = target;
      throw new Error(`headerLabel: unexpected target ${String(_exhaustive)}`);
    }
  }
}

/**
 * Returns a Corner of `shape` derived from `prev`, preserving the radii
 * (and smoothing where applicable). Newly-converted superellipse corners
 * get a default smoothing of 0.5 (Spec 14 §1.5).
 */
export function makeCornerOfShape(shape: CornerShape, prev: Corner): Corner {
  if (shape === "superellipse") {
    if (prev.type === "superellipse") {
      return { type: "superellipse", radii: { ...prev.radii }, smoothing: prev.smoothing };
    }
    return {
      type: "superellipse",
      radii: { ...prev.radii },
      smoothing: DEFAULT_SUPERELLIPSE_SMOOTHING,
    };
  }
  // Round / Bevel / Notch / Scoop — drop smoothing (only Superellipse owns it).
  return { type: shape, radii: { ...prev.radii } };
}

/**
 * Builds a new Corners tuple by applying `factory` only at positions
 * listed in `targets`. Positions not listed are returned unchanged.
 */
export function writeCorners(
  corners: Corners,
  targets: readonly number[],
  factory: (prev: Corner) => Corner,
): Corners {
  const next = corners.map((c, i) => (targets.includes(i) ? factory(c) : c));
  // Corners is `readonly [Corner, Corner, Corner, Corner]`; we just mapped
  // a 4-tuple in place so the result is still a 4-element array.
  return next as unknown as Corners;
}

/**
 * Default-renders an empty token bag when callers omit `tokens`. Hoisted
 * to module scope so the reference is stable across renders.
 */
const EMPTY_TOKENS: Record<string, Token> = {};

export const CornerPopover: Component<CornerPopoverProps> = (props) => {
  const targets = createMemo(() => hotspotTargetIndices(props.target));
  const targeted = createMemo(() => cornersAtHotspot(props.corners, props.target));
  const isMixed = createMemo(() => hotspotShapeIsMixed(props.corners, props.target));
  const isCenter = createMemo(() => props.target === "center");

  /**
   * Show the first targeted corner's shape as the Select value when the
   * hotspot is uniform. When the targeted corners are mixed, fall back
   * to "round" (a stable harmless display value) — the visible "Mixed"
   * badge communicates the actual state to the user, and any committed
   * change writes uniformly to every targeted corner regardless.
   */
  const currentShape = createMemo<CornerShape>(() => {
    if (isMixed()) return "round";
    const first = targeted()[0];
    return first.type;
  });

  /**
   * Show the shared radius as a string for ValueInput when all targeted
   * corners agree (and rx === ry). When radii diverge — either because
   * rx ≠ ry on a single corner or because two targeted corners disagree —
   * show an empty string (Task 11 introduces the rx/ry split UI).
   */
  const currentRadiusDisplay = createMemo<string>(() => {
    const ts = targeted();
    if (ts.length === 0) return "";
    const first = ts[0];
    if (first.radii.x !== first.radii.y) return "";
    if (ts.some((c) => c.radii.x !== first.radii.x || c.radii.y !== first.radii.y)) {
      return "";
    }
    return String(first.radii.x);
  });

  function commitShape(shapeValue: string): void {
    // Guard the string-to-discriminant cast: only accept known shapes.
    if (
      shapeValue !== "round" &&
      shapeValue !== "bevel" &&
      shapeValue !== "notch" &&
      shapeValue !== "scoop" &&
      shapeValue !== "superellipse"
    ) {
      // Diagnose-no-ops rule: log structured rejection so silent drops
      // from a malformed Select option surface in development.
      console.warn("CornerPopover: unknown shape value", { shapeValue, target: props.target });
      return;
    }
    // Center popover is the only flavor that accepts Superellipse.
    if (shapeValue === "superellipse" && !isCenter()) {
      console.warn("CornerPopover: Superellipse rejected on non-center hotspot", {
        target: props.target,
      });
      return;
    }
    const next = writeCorners(props.corners, targets(), (prev) =>
      makeCornerOfShape(shapeValue, prev),
    );
    props.onCommit(next);
  }

  function commitRadius(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return; // empty commit is a no-op (don't reset to 0)
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return;
    if (parsed < 0 || parsed > MAX_CORNER_RADIUS) return;
    const next = writeCorners(props.corners, targets(), (prev) => {
      // Preserve discriminant + smoothing (when superellipse); only edit radii.
      if (prev.type === "superellipse") {
        return { type: "superellipse", radii: { x: parsed, y: parsed }, smoothing: prev.smoothing };
      }
      return { type: prev.type, radii: { x: parsed, y: parsed } };
    });
    props.onCommit(next);
  }

  // --- Axis unlock (Task 11) ----------------------------------------------
  //
  // Spec 14 §1.5 auto-link: the popover opens with "Unlock axes" pre-toggled
  // ON whenever any targeted corner has rx ≠ ry. The user can toggle it
  // OFF to re-link the axes (next radius commit writes rx = ry).
  const [unlocked, setUnlocked] = createSignal(
    hotspotHasAsymmetricRadii(props.corners, props.target),
  );

  // If `corners` or `target` change reactively after mount (e.g., another
  // panel edits the field while this popover is open), reflect that in the
  // local toggle state. Effects re-run when their reactive reads change;
  // here we depend only on the targeted-corner asymmetry predicate.
  createEffect(() => {
    setUnlocked(hotspotHasAsymmetricRadii(props.corners, props.target));
  });

  /**
   * Shared rx across all targeted corners (display value for the rx field
   * when unlocked). Returns null when the targeted corners disagree on rx,
   * which renders an empty input rather than a misleading single value.
   */
  const currentRx = createMemo<number | null>(() => {
    const ts = targeted();
    if (ts.length === 0) return null;
    const first = ts[0];
    if (ts.some((c) => c.radii.x !== first.radii.x)) return null;
    return first.radii.x;
  });

  /**
   * Shared ry across all targeted corners (display value for the ry field
   * when unlocked). Returns null when the targeted corners disagree on ry.
   */
  const currentRy = createMemo<number | null>(() => {
    const ts = targeted();
    if (ts.length === 0) return null;
    const first = ts[0];
    if (ts.some((c) => c.radii.y !== first.radii.y)) return null;
    return first.radii.y;
  });

  /**
   * Commit a new rx value, preserving each targeted corner's existing ry.
   *
   * Per CLAUDE.md §11 "partial updates of multi-field values" — we MUST
   * read each corner's current ry and write it back unchanged, otherwise
   * a later mutation (e.g., MCP, another panel) that set ry to a non-
   * matching value is silently overwritten.
   */
  function commitRx(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return;
    if (parsed < 0 || parsed > MAX_CORNER_RADIUS) return;
    const next = writeCorners(props.corners, targets(), (prev) => {
      if (prev.type === "superellipse") {
        return {
          type: "superellipse",
          radii: { x: parsed, y: prev.radii.y },
          smoothing: prev.smoothing,
        };
      }
      return { type: prev.type, radii: { x: parsed, y: prev.radii.y } };
    });
    props.onCommit(next);
  }

  // --- Center smoothing control (Task 12) ---------------------------------
  //
  // The smoothing control is the Superellipse-only knob from Spec 14 §1.5.
  // It appears ONLY on the center popover AND only when every targeted
  // corner is currently superellipse. The control is a composite of:
  //   - ValueInput (literal/token/expression entry — committed via blur/Enter)
  //   - Slider     (direct scrub — committed as a single history entry per
  //                 gesture per CLAUDE.md §11 "Continuous-Value Controls
  //                 Must Coalesce History Entries").
  //
  // `gestureSmoothing` tracks the in-gesture slider value so the visual
  // updates during drag without committing on every tick. It is captured on
  // pointerdown/keydown via `onChangeStart` and cleared on pointerup/keyup
  // via `onChangeEnd` (which also fires the single commit).
  const [gestureSmoothing, setGestureSmoothing] = createSignal<number | null>(null);

  const showSmoothing = createMemo<boolean>(() => {
    if (props.target !== "center") return false;
    const ts = targeted();
    if (ts.length === 0) return false;
    return ts.every((c) => c.type === "superellipse");
  });

  /**
   * Shared smoothing across all targeted corners (display value for the
   * Slider/ValueInput). When `showSmoothing()` is true every targeted
   * corner is superellipse, so reading `.smoothing` from the first is safe.
   * Falls back to a harmless 0.5 when the control is hidden — callers must
   * gate reads on `showSmoothing()`.
   */
  const currentSmoothing = createMemo<number>(() => {
    const ts = targeted();
    const first = ts[0];
    if (first === undefined || first.type !== "superellipse") {
      return 0.5;
    }
    return first.smoothing;
  });

  /**
   * Commit a new smoothing value to every targeted corner. Validates the
   * value against the named constants per CLAUDE.md §11 "Constants Must Be
   * Enforced" and rejects non-finite values per "Floating-Point Validation".
   *
   * Since this is only called from the center popover under
   * `showSmoothing()` (every targeted corner already superellipse), the
   * factory branch for non-superellipse corners is a defensive fallback —
   * if a corner had divergent type at commit time it would be converted
   * (preserving its radii) rather than silently skipped.
   */
  function commitSmoothing(s: number): void {
    if (!Number.isFinite(s) || s < MIN_SUPERELLIPSE_SMOOTHING || s > MAX_SUPERELLIPSE_SMOOTHING) {
      console.warn("CornerPopover: smoothing value rejected", {
        smoothing: s,
        min: MIN_SUPERELLIPSE_SMOOTHING,
        max: MAX_SUPERELLIPSE_SMOOTHING,
        target: props.target,
      });
      return;
    }
    // Per CLAUDE.md §11 "partial updates of multi-field values": preserve
    // each corner's radii and only update smoothing. Non-superellipse
    // corners are converted to superellipse (defensive — the control is
    // gated by showSmoothing() so this branch is unreachable in practice).
    const next = writeCorners(props.corners, targets(), (prev) => ({
      type: "superellipse",
      radii: { ...prev.radii },
      smoothing: s,
    }));
    props.onCommit(next);
  }

  /**
   * Parse a string from the ValueInput's commit event into a number and
   * route it to `commitSmoothing`. Extracted per frontend-defensive
   * "Business Logic Must Not Live in Inline JSX Handlers".
   */
  function commitSmoothingFromValueInput(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return; // empty commit is a no-op
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return;
    commitSmoothing(parsed);
  }

  /**
   * Commit a new ry value, preserving each targeted corner's existing rx.
   * Symmetric counterpart to `commitRx`; see that function's comment.
   */
  function commitRy(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return;
    if (parsed < 0 || parsed > MAX_CORNER_RADIUS) return;
    const next = writeCorners(props.corners, targets(), (prev) => {
      if (prev.type === "superellipse") {
        return {
          type: "superellipse",
          radii: { x: prev.radii.x, y: parsed },
          smoothing: prev.smoothing,
        };
      }
      return { type: prev.type, radii: { x: prev.radii.x, y: parsed } };
    });
    props.onCommit(next);
  }

  return (
    <div class="sigil-corner-popover" role="group" aria-label={headerLabel(props.target)}>
      <h3 class="sigil-corner-popover__header">{headerLabel(props.target)}</h3>

      <div class="sigil-corner-popover__field" data-testid="corner-popover__shape">
        <label class="sigil-corner-popover__label">Shape</label>
        <Show when={isMixed()}>
          <span
            class="sigil-corner-popover__mixed"
            data-testid="corner-popover__mixed-indicator"
            role="status"
          >
            Mixed
          </span>
        </Show>
        <Select
          options={isCenter() ? CENTER_SHAPE_OPTIONS : CORNER_SHAPE_OPTIONS}
          value={currentShape()}
          onValueChange={commitShape}
          aria-label="Corner shape"
        />
      </div>

      {/*
       * The wrapper div carries the test id AND an `aria-label="Unlock axes"`
       * so reviewers can locate the affordance reliably; the Toggle's visible
       * `label="Unlock axes"` is what screen readers actually announce as the
       * switch's accessible name (Kobalte's <Switch.Label> auto-associates).
       * Omitting `aria-label` on the Toggle itself prevents duplicate
       * announcements per .claude/rules/a11y-rules.md "Label association".
       */}
      <div
        class="sigil-corner-popover__field"
        data-testid="corner-popover__unlock"
        aria-label="Unlock axes"
      >
        <Toggle checked={unlocked()} onCheckedChange={setUnlocked} label="Unlock axes" />
      </div>

      <Show
        when={unlocked()}
        fallback={
          <div class="sigil-corner-popover__field" data-testid="corner-popover__radius">
            <label class="sigil-corner-popover__label">Radius</label>
            <ValueInput
              value={currentRadiusDisplay()}
              onChange={() => {
                /* preview-only; commit happens on blur / Enter / token insert */
              }}
              onCommit={commitRadius}
              tokens={props.tokens ?? EMPTY_TOKENS}
              acceptedTypes={["number", "dimension"]}
              aria-label="Corner radius"
              min={0}
              max={MAX_CORNER_RADIUS}
            />
          </div>
        }
      >
        <div class="sigil-corner-popover__row">
          <div class="sigil-corner-popover__field" data-testid="corner-popover__rx">
            <label class="sigil-corner-popover__label">rx</label>
            <ValueInput
              value={currentRx() === null ? "" : String(currentRx())}
              onChange={() => {
                /* preview-only; commit happens on blur / Enter / token insert */
              }}
              onCommit={commitRx}
              tokens={props.tokens ?? EMPTY_TOKENS}
              acceptedTypes={["number", "dimension"]}
              aria-label="Radius X"
              min={0}
              max={MAX_CORNER_RADIUS}
            />
          </div>
          <div class="sigil-corner-popover__field" data-testid="corner-popover__ry">
            <label class="sigil-corner-popover__label">ry</label>
            <ValueInput
              value={currentRy() === null ? "" : String(currentRy())}
              onChange={() => {
                /* preview-only; commit happens on blur / Enter / token insert */
              }}
              onCommit={commitRy}
              tokens={props.tokens ?? EMPTY_TOKENS}
              acceptedTypes={["number", "dimension"]}
              aria-label="Radius Y"
              min={0}
              max={MAX_CORNER_RADIUS}
            />
          </div>
        </div>
      </Show>

      {/*
       * Center popover only: smoothing control for Superellipse corners.
       * The Slider fires onChangeStart on pointerdown/keydown, onChange on
       * every tick during the gesture (preview-only), and a single
       * onChangeEnd on pointerup/keyup which calls `commitSmoothing` once.
       * This coalesces the entire drag into a single history entry per
       * CLAUDE.md §11 "Continuous-Value Controls Must Coalesce History
       * Entries". `gestureSmoothing` is captured on start and cleared on
       * end so the displayed value reflects in-gesture preview without
       * driving a per-tick commit.
       */}
      <Show when={showSmoothing()}>
        <div class="sigil-corner-popover__field" data-testid="corner-popover__smoothing">
          <label class="sigil-corner-popover__label">Smoothing</label>
          <div class="sigil-corner-popover__row">
            <ValueInput
              value={String(gestureSmoothing() ?? currentSmoothing())}
              onChange={() => {
                /* preview-only; commit happens on blur / Enter / token insert */
              }}
              onCommit={commitSmoothingFromValueInput}
              tokens={props.tokens ?? EMPTY_TOKENS}
              acceptedTypes={["number"]}
              aria-label="Smoothing"
              min={MIN_SUPERELLIPSE_SMOOTHING}
              max={MAX_SUPERELLIPSE_SMOOTHING}
            />
            <div data-testid="corner-popover__smoothing-slider">
              <Slider
                value={gestureSmoothing() ?? currentSmoothing()}
                min={MIN_SUPERELLIPSE_SMOOTHING}
                max={MAX_SUPERELLIPSE_SMOOTHING}
                step={0.01}
                onChangeStart={() => setGestureSmoothing(currentSmoothing())}
                onChange={(v) => setGestureSmoothing(v)}
                onChangeEnd={(v) => {
                  commitSmoothing(v);
                  setGestureSmoothing(null);
                }}
                ariaLabel="Smoothing"
              />
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
