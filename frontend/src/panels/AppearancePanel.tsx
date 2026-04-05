/**
 * AppearancePanel — Opacity, blend mode, fill list, and stroke list for the
 * selected node.
 *
 * Reads from useDocument() and writes back via:
 *   store.setOpacity(uuid, value)      — opacity in 0..1 range
 *   store.setBlendMode(uuid, mode)
 *   store.setFills(uuid, fills)
 *   store.setStrokes(uuid, strokes)
 *
 * All numeric values from NumberInput are guarded with Number.isFinite()
 * before use per CLAUDE.md §11 Floating-Point Validation.
 *
 * Keyboard: Alt+ArrowUp / Alt+ArrowDown on a focused row reorders it
 * (WCAG 2.1.1 keyboard parity for drag-and-drop reorder per CLAUDE.md
 * Pointer-Only Operations rule).
 *
 * NOTE: Fills and strokes have no stable `id` field in the current wire
 * format — they are anonymous value objects. Index is used only within the
 * scope of a single user action, after which the entire array is replaced
 * atomically via setFills / setStrokes. This is the same pattern used by
 * EffectsPanel. If a stable ID is added to Fill/Stroke types in a future
 * spec, switch to ID-based dispatch here.
 */
import { createMemo, createSignal, For, Index, Show, type Component } from "solid-js";
import type { BlendMode, Fill, FillSolid, Stroke } from "../types/document";
import { useDocument } from "../store/document-context";
import { NumberInput } from "../components/number-input/NumberInput";
import { Select } from "../components/select/Select";
import { FillRow } from "./FillRow";
import { StrokeRow } from "./StrokeRow";
import "./AppearancePanel.css";

// ── UI boundary limits (RF-017) ───────────────────────────────────────

/** Maximum number of fill layers allowed per node. */
const MAX_FILLS = 32;

/** Maximum number of stroke layers allowed per node. */
const MAX_STROKES = 32;

// ── Blend mode options ────────────────────────────────────────────────

const BLEND_MODES = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color_dodge", label: "Color Dodge" },
  { value: "color_burn", label: "Color Burn" },
  { value: "hard_light", label: "Hard Light" },
  { value: "soft_light", label: "Soft Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
] as const;

// ── Default values for new items ──────────────────────────────────────

const DEFAULT_FILL: FillSolid = {
  type: "solid",
  color: { type: "literal", value: { space: "srgb", r: 1, g: 1, b: 1, a: 1 } },
};

const DEFAULT_STROKE: Stroke = {
  color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
  width: { type: "literal", value: 1 },
  alignment: "inside",
  cap: "butt",
  join: "miter",
};

// ── AppearancePanel ───────────────────────────────────────────────────

export const AppearancePanel: Component = () => {
  const store = useDocument();

  // ── Live region announcement (RF-009) ──────────────────────────────
  const [announcement, setAnnouncement] = createSignal("");

  function announce(message: string): void {
    // Clear first to ensure the screen reader re-announces even if
    // the same message is set twice in a row.
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(message));
  }

  // ── Derived values ────────────────────────────────────────────────

  const selectedUuid = createMemo(() => store.selectedNodeId());

  const node = createMemo(() => {
    const uuid = selectedUuid();
    if (!uuid) return null;
    return store.state.nodes[uuid] ?? null;
  });

  /**
   * Opacity displayed in the UI as 0–100.
   * The store stores 0–1; the StyleValue wrapper is unwrapped here.
   * Fallback to 100 if not a literal or non-finite.
   */
  const opacityPercent = createMemo((): number => {
    const n = node();
    if (!n) return 100;
    const sv = n.style.opacity;
    if (sv.type !== "literal") return 100;
    const raw = sv.value * 100;
    return Number.isFinite(raw) ? Math.round(raw) : 100;
  });

  const blendMode = createMemo((): BlendMode => {
    const n = node();
    if (!n) return "normal";
    return n.style.blend_mode;
  });

  const fills = createMemo((): readonly Fill[] => {
    const n = node();
    if (!n) return [];
    return n.style.fills;
  });

  const strokes = createMemo((): readonly Stroke[] => {
    const n = node();
    if (!n) return [];
    return n.style.strokes;
  });

  // ── Opacity handler ───────────────────────────────────────────────

  /**
   * Called by NumberInput with the new 0–100 value.
   * Converts to 0–1 before calling setOpacity.
   * Guard: Number.isFinite() per CLAUDE.md §11.
   */
  function handleOpacityChange(pct: number): void {
    if (!Number.isFinite(pct)) return;
    const uuid = selectedUuid();
    if (!uuid) return;
    // The store validates 0..=1 internally, but we also reject out-of-range
    // here to avoid sending invalid input.
    const value = pct / 100;
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    store.setOpacity(uuid, value);
  }

  // ── Blend mode handler ────────────────────────────────────────────

  function handleBlendModeChange(mode: string): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    store.setBlendMode(uuid, mode as BlendMode);
  }

  // ── Fill handlers ─────────────────────────────────────────────────

  function handleAddFill(): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    if (fills().length >= MAX_FILLS) return;
    const newFills = [...(fills() as Fill[]), { ...DEFAULT_FILL }];
    store.setFills(uuid, newFills);
    announce(`Fill added. ${newFills.length} fills total.`);
  }

  function handleFillUpdate(index: number, updated: Fill): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    const current = fills() as Fill[];
    store.setFills(
      uuid,
      current.map((f, i) => (i === index ? updated : f)),
    );
  }

  function handleFillRemove(index: number): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    const current = fills() as Fill[];
    const next = current.filter((_, i) => i !== index);
    store.setFills(uuid, next);
    announce(`Fill removed. ${next.length} fills total.`);
  }

  /**
   * Alt+Arrow reorder for fills — WCAG 2.1.1 keyboard parity for
   * drag-and-drop reorder (CLAUDE.md Pointer-Only Operations rule).
   */
  function handleFillKeyDown(index: number, e: KeyboardEvent): void {
    // RF-014: skip reorder when event originates from an input element
    if (e.target instanceof HTMLInputElement) return;

    // RF-007: Delete key removes the focused fill row
    if (e.key === "Delete") {
      e.preventDefault();
      handleFillRemove(index);
      return;
    }

    if (!e.altKey) return;
    const current = fills() as Fill[];
    const uuid = selectedUuid();
    if (!uuid) return;

    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      const next = [...current];
      const prev = next[index - 1];
      const curr = next[index];
      if (prev === undefined || curr === undefined) return;
      next[index - 1] = curr;
      next[index] = prev;
      store.setFills(uuid, next);
    } else if (e.key === "ArrowDown" && index < current.length - 1) {
      e.preventDefault();
      const next = [...current];
      const nextItem = next[index + 1];
      const curr = next[index];
      if (nextItem === undefined || curr === undefined) return;
      next[index + 1] = curr;
      next[index] = nextItem;
      store.setFills(uuid, next);
    }
  }

  // ── Stroke handlers ───────────────────────────────────────────────

  function handleAddStroke(): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    if (strokes().length >= MAX_STROKES) return;
    const newStrokes = [...(strokes() as Stroke[]), { ...DEFAULT_STROKE }];
    store.setStrokes(uuid, newStrokes);
    announce(`Stroke added. ${newStrokes.length} strokes total.`);
  }

  function handleStrokeUpdate(index: number, updated: Stroke): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    const current = strokes() as Stroke[];
    store.setStrokes(
      uuid,
      current.map((s, i) => (i === index ? updated : s)),
    );
  }

  function handleStrokeRemove(index: number): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    const current = strokes() as Stroke[];
    const next = current.filter((_, i) => i !== index);
    store.setStrokes(uuid, next);
    announce(`Stroke removed. ${next.length} strokes total.`);
  }

  /**
   * Alt+Arrow reorder for strokes — WCAG 2.1.1 keyboard parity for
   * drag-and-drop reorder (CLAUDE.md Pointer-Only Operations rule).
   */
  function handleStrokeKeyDown(index: number, e: KeyboardEvent): void {
    // RF-014: skip reorder when event originates from an input element
    if (e.target instanceof HTMLInputElement) return;

    // RF-007: Delete key removes the focused stroke row
    if (e.key === "Delete") {
      e.preventDefault();
      handleStrokeRemove(index);
      return;
    }

    if (!e.altKey) return;
    const current = strokes() as Stroke[];
    const uuid = selectedUuid();
    if (!uuid) return;

    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      const next = [...current];
      const prev = next[index - 1];
      const curr = next[index];
      if (prev === undefined || curr === undefined) return;
      next[index - 1] = curr;
      next[index] = prev;
      store.setStrokes(uuid, next);
    } else if (e.key === "ArrowDown" && index < current.length - 1) {
      e.preventDefault();
      const next = [...current];
      const nextItem = next[index + 1];
      const curr = next[index];
      if (nextItem === undefined || curr === undefined) return;
      next[index + 1] = curr;
      next[index] = nextItem;
      store.setStrokes(uuid, next);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div class="sigil-appearance-panel" role="region" aria-label="Appearance">
      {/* ── Opacity + Blend mode row ─────────────────────────────── */}
      <div class="sigil-appearance-panel__opacity-blend">
        <NumberInput
          value={opacityPercent()}
          onValueChange={handleOpacityChange}
          aria-label="Opacity"
          step={1}
          min={0}
          max={100}
          suffix="%"
          disabled={selectedUuid() === null}
        />
        <Select
          options={BLEND_MODES}
          value={blendMode()}
          onValueChange={handleBlendModeChange}
          aria-label="Blend mode"
          disabled={selectedUuid() === null}
        />
      </div>

      {/* ── Fill section ─────────────────────────────────────────── */}
      <div
        class="sigil-appearance-panel__section"
        role="group"
        aria-labelledby="appearance-fill-title"
      >
        <div class="sigil-appearance-panel__section-header">
          <span class="sigil-appearance-panel__section-title" id="appearance-fill-title">
            Fill
          </span>
          <button
            class="sigil-appearance-panel__add"
            type="button"
            aria-label="Add fill"
            disabled={selectedUuid() === null}
            onClick={handleAddFill}
          >
            +
          </button>
        </div>

        <Show when={fills().length === 0}>
          <p class="sigil-appearance-panel__empty">No fills</p>
        </Show>

        <Index each={fills() as Fill[]}>
          {(fill, index) => (
            <div role="group" tabIndex={0} onKeyDown={(e) => handleFillKeyDown(index, e)}>
              <FillRow
                fill={fill()}
                index={index}
                onUpdate={handleFillUpdate}
                onRemove={handleFillRemove}
              />
            </div>
          )}
        </Index>
      </div>

      {/* ── Stroke section ───────────────────────────────────────── */}
      <div
        class="sigil-appearance-panel__section"
        role="group"
        aria-labelledby="appearance-stroke-title"
      >
        <div class="sigil-appearance-panel__section-header">
          <span class="sigil-appearance-panel__section-title" id="appearance-stroke-title">
            Stroke
          </span>
          <button
            class="sigil-appearance-panel__add"
            type="button"
            aria-label="Add stroke"
            disabled={selectedUuid() === null}
            onClick={handleAddStroke}
          >
            +
          </button>
        </div>

        <Show when={strokes().length === 0}>
          <p class="sigil-appearance-panel__empty">No strokes</p>
        </Show>

        <For each={strokes() as Stroke[]}>
          {(stroke, index) => (
            <div role="group" tabIndex={0} onKeyDown={(e) => handleStrokeKeyDown(index(), e)}>
              <StrokeRow
                stroke={stroke}
                index={index()}
                onUpdate={handleStrokeUpdate}
                onRemove={handleStrokeRemove}
              />
            </div>
          )}
        </For>
      </div>

      {/* RF-009: visually-hidden live region for discrete add/remove announcements */}
      <span role="status" aria-live="polite" class="sr-only">
        {announcement()}
      </span>
    </div>
  );
};
