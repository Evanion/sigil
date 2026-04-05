/**
 * FillRow.stories.tsx — Storybook stories for the FillRow component.
 *
 * FillRow does not use useDocument() or useAnnounce() — it receives all data
 * via props and emits changes through callbacks. No DocumentProvider is needed.
 *
 * ColorPicker (used internally by solid fills) requires no DragDropProvider.
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { FillRow } from "./FillRow";
import type { Fill } from "../types/document";

// ── Meta ───────────────────────────────────────────────────────────────

const meta: Meta<typeof FillRow> = {
  title: "Panels/FillRow",
  component: FillRow,
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
type Story = StoryObj<typeof FillRow>;

// ── Stories ────────────────────────────────────────────────────────────

/**
 * Solid fill — blue. The color swatch opens a ColorPicker on click.
 */
export const SolidFill: Story = {
  render: () => {
    const [fill, setFill] = createSignal<Fill>({
      type: "solid",
      color: { type: "literal", value: { space: "srgb", r: 0.2, g: 0.6, b: 1.0, a: 1.0 } },
    });

    return (
      <FillRow
        fill={fill()}
        index={0}
        onUpdate={(_idx, updated) => setFill(updated)}
        onRemove={() => {}}
      />
    );
  },
};

/**
 * Solid fill — semi-transparent red. Tests alpha channel rendering on the swatch.
 */
export const SolidFillSemiTransparent: Story = {
  render: () => {
    const [fill, setFill] = createSignal<Fill>({
      type: "solid",
      color: { type: "literal", value: { space: "srgb", r: 1.0, g: 0.2, b: 0.2, a: 0.6 } },
    });

    return (
      <FillRow
        fill={fill()}
        index={0}
        onUpdate={(_idx, updated) => setFill(updated)}
        onRemove={() => {}}
      />
    );
  },
};

/**
 * Linear gradient fill — red to blue. The swatch shows the gradient preview.
 * The swatch is disabled (gradient editing is not yet implemented).
 */
export const GradientFill: Story = {
  render: () => {
    const fill: Fill = {
      type: "linear_gradient",
      gradient: {
        stops: [
          {
            position: 0,
            color: { type: "literal", value: { space: "srgb", r: 1.0, g: 0.2, b: 0.2, a: 1.0 } },
          },
          {
            position: 1,
            color: { type: "literal", value: { space: "srgb", r: 0.2, g: 0.4, b: 1.0, a: 1.0 } },
          },
        ],
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
      },
    };

    return <FillRow fill={fill} index={0} onUpdate={() => {}} onRemove={() => {}} />;
  },
};

/**
 * Radial gradient fill — green center to transparent edge.
 */
export const RadialGradientFill: Story = {
  render: () => {
    const fill: Fill = {
      type: "radial_gradient",
      gradient: {
        stops: [
          {
            position: 0,
            color: { type: "literal", value: { space: "srgb", r: 0.2, g: 0.8, b: 0.4, a: 1.0 } },
          },
          {
            position: 1,
            color: { type: "literal", value: { space: "srgb", r: 0.2, g: 0.8, b: 0.4, a: 0.0 } },
          },
        ],
        start: { x: 0.5, y: 0.5 },
        end: { x: 1.0, y: 0.5 },
      },
    };

    return <FillRow fill={fill} index={0} onUpdate={() => {}} onRemove={() => {}} />;
  },
};
