/**
 * EffectCard.stories.tsx — Storybook stories for the EffectCard component.
 *
 * EffectCard does not use useDocument() or useAnnounce() — it receives all
 * data via props and emits changes through callbacks. No DocumentProvider needed.
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { EffectCard } from "./EffectCard";
import type { Effect } from "../types/document";

// ── Meta ───────────────────────────────────────────────────────────────

const meta: Meta<typeof EffectCard> = {
  title: "Panels/EffectCard",
  component: EffectCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "280px", background: "var(--surface-2)", padding: "8px" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof EffectCard>;

// ── Stories ────────────────────────────────────────────────────────────

/**
 * Drop shadow — default values: 0,4 offset, 8px blur, 0 spread, black 30% opacity.
 */
export const DropShadow: Story = {
  render: () => {
    const [effect, setEffect] = createSignal<Effect>({
      type: "drop_shadow",
      color: { type: "literal", value: { space: "srgb", r: 0.0, g: 0.0, b: 0.0, a: 0.3 } },
      offset: { x: 0, y: 4 },
      blur: { type: "literal", value: 8 },
      spread: { type: "literal", value: 0 },
    });

    return (
      <EffectCard
        effect={effect()}
        index={0}
        onUpdate={(_idx, updated) => setEffect(updated)}
        onRemove={() => {}}
      />
    );
  },
};

/**
 * Layer blur — radius 12. Shows the single-input blur fields section.
 */
export const LayerBlur: Story = {
  render: () => {
    const [effect, setEffect] = createSignal<Effect>({
      type: "layer_blur",
      radius: { type: "literal", value: 12 },
    });

    return (
      <EffectCard
        effect={effect()}
        index={0}
        onUpdate={(_idx, updated) => setEffect(updated)}
        onRemove={() => {}}
      />
    );
  },
};

/**
 * Inner shadow — darker shadow offset inward, higher spread.
 */
export const InnerShadow: Story = {
  render: () => {
    const [effect, setEffect] = createSignal<Effect>({
      type: "inner_shadow",
      color: { type: "literal", value: { space: "srgb", r: 0.0, g: 0.0, b: 0.0, a: 0.5 } },
      offset: { x: 0, y: 2 },
      blur: { type: "literal", value: 6 },
      spread: { type: "literal", value: 2 },
    });

    return (
      <EffectCard
        effect={effect()}
        index={0}
        onUpdate={(_idx, updated) => setEffect(updated)}
        onRemove={() => {}}
      />
    );
  },
};

/**
 * Background blur — affects layers beneath the selected node.
 */
export const BackgroundBlur: Story = {
  render: () => {
    const [effect, setEffect] = createSignal<Effect>({
      type: "background_blur",
      radius: { type: "literal", value: 20 },
    });

    return (
      <EffectCard
        effect={effect()}
        index={0}
        onUpdate={(_idx, updated) => setEffect(updated)}
        onRemove={() => {}}
      />
    );
  },
};
