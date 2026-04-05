/**
 * StrokeRow.stories.tsx — Storybook stories for the StrokeRow component.
 *
 * StrokeRow does not use useDocument() or useAnnounce() — it receives all
 * data via props and emits changes through callbacks. No DocumentProvider needed.
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { StrokeRow } from "./StrokeRow";
import type { Stroke } from "../types/document";

// ── Meta ───────────────────────────────────────────────────────────────

const meta: Meta<typeof StrokeRow> = {
  title: "Panels/StrokeRow",
  component: StrokeRow,
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
type Story = StoryObj<typeof StrokeRow>;

// ── Stories ────────────────────────────────────────────────────────────

/**
 * Default stroke — black 1px inside alignment.
 */
export const DefaultStroke: Story = {
  render: () => {
    const [stroke, setStroke] = createSignal<Stroke>({
      color: { type: "literal", value: { space: "srgb", r: 0.0, g: 0.0, b: 0.0, a: 1.0 } },
      width: { type: "literal", value: 1 },
      alignment: "inside",
      cap: "butt",
      join: "miter",
    });

    return (
      <StrokeRow
        stroke={stroke()}
        index={0}
        onUpdate={(_idx, updated) => setStroke(updated)}
        onRemove={() => {}}
      />
    );
  },
};

/**
 * Thick stroke — white 3px center alignment.
 */
export const ThickStroke: Story = {
  render: () => {
    const [stroke, setStroke] = createSignal<Stroke>({
      color: { type: "literal", value: { space: "srgb", r: 1.0, g: 1.0, b: 1.0, a: 1.0 } },
      width: { type: "literal", value: 3 },
      alignment: "center",
      cap: "round",
      join: "round",
    });

    return (
      <StrokeRow
        stroke={stroke()}
        index={0}
        onUpdate={(_idx, updated) => setStroke(updated)}
        onRemove={() => {}}
      />
    );
  },
};

/**
 * Outside stroke — blue 2px outside alignment with semi-transparency.
 */
export const OutsideStroke: Story = {
  render: () => {
    const [stroke, setStroke] = createSignal<Stroke>({
      color: { type: "literal", value: { space: "srgb", r: 0.2, g: 0.5, b: 1.0, a: 0.8 } },
      width: { type: "literal", value: 2 },
      alignment: "outside",
      cap: "square",
      join: "bevel",
    });

    return (
      <StrokeRow
        stroke={stroke()}
        index={0}
        onUpdate={(_idx, updated) => setStroke(updated)}
        onRemove={() => {}}
      />
    );
  },
};
