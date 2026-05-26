/**
 * Storybook stories for CornerSection.
 *
 * Covers Spec 14 §4.4 visual QA points + the lightweight smoothing
 * calibration story per §1.6 calibration commitment.
 *
 * Import note: this project uses `storybook-solidjs-vite` (NOT the
 * deprecated `storybook-solidjs`). See AppearancePanel.stories.tsx for
 * the canonical import pattern.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CornerSection } from "./CornerSection";
import type { Corner, Corners, DocumentNode } from "../../types/document";

function rectWith(corners: Corners, uuid: string = "story-rect"): DocumentNode {
  return {
    id: { index: 1, generation: 0 },
    uuid,
    kind: { type: "rectangle", corners },
    name: "Demo Rect",
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

function ellipseNode(): DocumentNode {
  const base = rectWith(
    [
      { type: "round", radii: { x: 0, y: 0 } },
      { type: "round", radii: { x: 0, y: 0 } },
      { type: "round", radii: { x: 0, y: 0 } },
      { type: "round", radii: { x: 0, y: 0 } },
    ],
    "story-ellipse",
  );
  return {
    ...base,
    kind: { type: "ellipse", arc_start: 0, arc_end: 360 },
  };
}

const meta: Meta<typeof CornerSection> = {
  title: "Panels/CornerSection",
  component: CornerSection,
};
export default meta;
type Story = StoryObj<typeof CornerSection>;

const round = (r: number): Corner => ({ type: "round", radii: { x: r, y: r } });
const bevel = (r: number): Corner => ({ type: "bevel", radii: { x: r, y: r } });
const notch = (r: number): Corner => ({ type: "notch", radii: { x: r, y: r } });
const scoop = (r: number): Corner => ({ type: "scoop", radii: { x: r, y: r } });
const sup = (r: number, s: number): Corner => ({
  type: "superellipse",
  radii: { x: r, y: r },
  smoothing: s,
});

export const AllRoundDefault: Story = {
  args: {
    node: rectWith([round(8), round(8), round(8), round(8)], "story-rect-all-round"),
    onCorners: () => {},
  },
};

export const MixedShapes: Story = {
  args: {
    node: rectWith([round(16), bevel(16), notch(16), scoop(16)], "story-rect-mixed-shapes"),
    onCorners: () => {},
  },
};

export const AxisUnlocked: Story = {
  args: {
    node: rectWith(
      [
        { type: "round", radii: { x: 30, y: 10 } },
        { type: "round", radii: { x: 30, y: 10 } },
        { type: "round", radii: { x: 30, y: 10 } },
        { type: "round", radii: { x: 30, y: 10 } },
      ],
      "story-rect-axis-unlocked",
    ),
    onCorners: () => {},
  },
};

/**
 * Calibration story per spec §1.6: render 5 CornerSections side-by-side,
 * one per smoothing value. Implemented as a custom `render` rather than
 * `args` because the args API is single-node.
 */
export const SuperellipseSmoothingScale: Story = {
  render: () => (
    <div style={{ display: "grid", "grid-template-columns": "repeat(5, 1fr)", gap: "8px" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((s) => (
        <div>
          <h4 style={{ "text-align": "center" }}>s = {s}</h4>
          <CornerSection
            node={rectWith(
              [sup(20, s), sup(20, s), sup(20, s), sup(20, s)],
              `story-rect-smoothing-${s}`,
            )}
            onCorners={() => {}}
          />
        </div>
      ))}
    </div>
  ),
};

export const DisabledForEllipse: Story = {
  args: {
    node: ellipseNode(),
    onCorners: () => {},
  },
};
