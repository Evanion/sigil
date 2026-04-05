/**
 * EffectsPanel — list manager for effects on the selected node.
 *
 * Reads effects from the document store via useDocument() and renders
 * an EffectCard for each. Provides add, update, remove and Alt+Arrow
 * reorder keyboard operations.
 *
 * Add button is disabled when no node is selected.
 *
 * Keyboard: Alt+ArrowUp / Alt+ArrowDown on a focused EffectCard reorders it.
 */
import { createMemo, For, Show, type Component } from "solid-js";
import type { Effect, EffectDropShadow } from "../types/document";
import { useDocument } from "../store/document-context";
import { EffectCard } from "./EffectCard";
import "./EffectsPanel.css";

// ── Default effect for the add button ─────────────────────────────────────

const DEFAULT_EFFECT: EffectDropShadow = {
  type: "drop_shadow",
  color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 0.3 } },
  offset: { x: 0, y: 4 },
  blur: { type: "literal", value: 8 },
  spread: { type: "literal", value: 0 },
};

// ── EffectsPanel component ────────────────────────────────────────────────

export const EffectsPanel: Component = () => {
  const store = useDocument();

  // Derive selected node UUID
  const selectedUuid = createMemo(() => store.selectedNodeId());

  // Derive current effects array from the selected node
  const effects = createMemo((): readonly Effect[] => {
    const uuid = selectedUuid();
    if (!uuid) return [];
    const node = store.state.nodes[uuid];
    if (!node) return [];
    return node.style.effects;
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  function handleAdd(): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    const current = effects();
    store.setEffects(uuid, [...(current as Effect[]), { ...DEFAULT_EFFECT }]);
  }

  function handleUpdate(index: number, updated: Effect): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    const current = effects() as Effect[];
    const next = current.map((e, i) => (i === index ? updated : e));
    store.setEffects(uuid, next);
  }

  function handleRemove(index: number): void {
    const uuid = selectedUuid();
    if (!uuid) return;
    const current = effects() as Effect[];
    const next = current.filter((_, i) => i !== index);
    store.setEffects(uuid, next);
  }

  /**
   * Alt+Arrow reorder for keyboard accessibility (WCAG 2.1.1 keyboard parity
   * for drag-and-drop reorder, per CLAUDE.md Pointer-Only Operations rule).
   */
  function handleCardKeyDown(index: number, e: KeyboardEvent): void {
    if (!e.altKey) return;

    const current = effects() as Effect[];
    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      const uuid = selectedUuid();
      if (!uuid) return;
      const next = [...current];
      const prevItem = next[index - 1];
      const currItem = next[index];
      if (prevItem === undefined || currItem === undefined) return;
      next[index - 1] = currItem;
      next[index] = prevItem;
      store.setEffects(uuid, next);
    } else if (e.key === "ArrowDown" && index < current.length - 1) {
      e.preventDefault();
      const uuid = selectedUuid();
      if (!uuid) return;
      const next = [...current];
      const nextItem = next[index + 1];
      const currItem = next[index];
      if (nextItem === undefined || currItem === undefined) return;
      next[index + 1] = currItem;
      next[index] = nextItem;
      store.setEffects(uuid, next);
    }
  }

  return (
    <div class="sigil-effects-panel" role="region" aria-label="Effects">
      <div class="sigil-effects-panel__header">
        <span class="sigil-effects-panel__title">Effects</span>
        <button
          class="sigil-effects-panel__add"
          type="button"
          aria-label="Add effect"
          disabled={selectedUuid() === null}
          onClick={handleAdd}
        >
          +
        </button>
      </div>

      <Show when={selectedUuid() === null}>
        <p class="sigil-effects-panel__empty">Select a layer to edit effects.</p>
      </Show>

      <For each={effects() as Effect[]}>
        {(effect, index) => (
          <div onKeyDown={(e) => handleCardKeyDown(index(), e)}>
            <EffectCard
              effect={effect}
              index={index()}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
            />
          </div>
        )}
      </For>
    </div>
  );
};
