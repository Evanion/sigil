import type { PropertySchema } from "../schema/types";

/**
 * Property schema for the "Design" panel — Layout sub-tab.
 *
 * Defines which fields are shown for each node kind. The SchemaPanel
 * renders these definitions into NumberInput/Toggle/Select editors
 * automatically.
 *
 * Note: Corner Radius was previously a schema-driven 4-input grid in
 * this file. Plan 14d (Spec 14 corner editor UI) replaced it with the
 * dedicated <CornerSection /> component rendered in DesignPanel's
 * Appearance tab. Corner editing no longer flows through this schema.
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
