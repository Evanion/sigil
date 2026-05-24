import type { PropertySchema } from "../schema/types";
import { MAX_CORNER_RADIUS } from "../../store/corners-input";

/**
 * Property schema for the "Design" panel — Layout sub-tab.
 *
 * Defines which fields are shown for each node kind. The SchemaPanel
 * renders these definitions into NumberInput/Toggle/Select editors
 * automatically.
 */
export const designSchema: PropertySchema = {
  sections: [
    {
      name: "Node",
      fields: [
        { key: "name", label: "Name", type: "text", span: 2 },
        { key: "visible", label: "Visible", type: "toggle" },
        { key: "locked", label: "Locked", type: "toggle" },
      ],
    },
    {
      name: "Transform",
      fields: [
        // RF-024: ariaLabel expands abbreviated labels for screen readers.
        // The visible glyph stays compact (Figma-style); SR users hear the
        // full word.
        {
          key: "transform.x",
          label: "X",
          ariaLabel: "X position",
          type: "number",
          step: 1,
        },
        {
          key: "transform.y",
          label: "Y",
          ariaLabel: "Y position",
          type: "number",
          step: 1,
        },
        {
          key: "transform.width",
          label: "W",
          ariaLabel: "Width",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "transform.height",
          label: "H",
          ariaLabel: "Height",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "transform.rotation",
          label: "R",
          ariaLabel: "Rotation",
          type: "number",
          step: 0.1,
          suffix: "deg",
        },
      ],
    },
    {
      name: "Corner Radius",
      when: ["rectangle", "frame", "image"],
      fields: [
        // `max` is bounded by MAX_CORNER_RADIUS — symmetric with the Rust
        // validate.rs constant. Per CLAUDE.md §11 "Constants Must Be
        // Enforced": every NumberInput max must be a named constant.
        // RF-024: ariaLabel expands the 2-letter compass labels so screen
        // readers announce the full corner name instead of "TL", "TR", etc.
        {
          key: "kind.corners.0.radii.x",
          label: "TL",
          ariaLabel: "Top-left corner radius",
          type: "number",
          step: 1,
          min: 0,
          max: MAX_CORNER_RADIUS,
        },
        {
          key: "kind.corners.1.radii.x",
          label: "TR",
          ariaLabel: "Top-right corner radius",
          type: "number",
          step: 1,
          min: 0,
          max: MAX_CORNER_RADIUS,
        },
        {
          key: "kind.corners.2.radii.x",
          label: "BR",
          ariaLabel: "Bottom-right corner radius",
          type: "number",
          step: 1,
          min: 0,
          max: MAX_CORNER_RADIUS,
        },
        {
          key: "kind.corners.3.radii.x",
          label: "BL",
          ariaLabel: "Bottom-left corner radius",
          type: "number",
          step: 1,
          min: 0,
          max: MAX_CORNER_RADIUS,
        },
      ],
    },
    {
      name: "Constraints",
      fields: [
        {
          key: "constraints.horizontal",
          label: "H",
          ariaLabel: "Horizontal constraint",
          type: "select",
          options: [
            { value: "start", label: "Start" },
            { value: "center", label: "Center" },
            { value: "end", label: "End" },
            { value: "stretch", label: "Stretch" },
          ],
        },
        {
          key: "constraints.vertical",
          label: "V",
          ariaLabel: "Vertical constraint",
          type: "select",
          options: [
            { value: "start", label: "Start" },
            { value: "center", label: "Center" },
            { value: "end", label: "End" },
            { value: "stretch", label: "Stretch" },
          ],
        },
      ],
    },
  ],
};
