import type { PropertySchema } from "../schema/types";

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
        {
          key: "transform.x",
          label: "X",
          type: "number",
          step: 1,
        },
        {
          key: "transform.y",
          label: "Y",
          type: "number",
          step: 1,
        },
        {
          key: "transform.width",
          label: "W",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "transform.height",
          label: "H",
          type: "number",
          step: 1,
          min: 0,
        },
        {
          key: "transform.rotation",
          label: "R",
          type: "number",
          step: 0.1,
          suffix: "deg",
        },
      ],
    },
    {
      name: "Corner Radius",
      when: "rectangle",
      fields: [
        { key: "kind.corner_radii.0", label: "Top Left", type: "number", step: 1, min: 0 },
        { key: "kind.corner_radii.1", label: "Top Right", type: "number", step: 1, min: 0 },
        { key: "kind.corner_radii.2", label: "Bottom Right", type: "number", step: 1, min: 0 },
        { key: "kind.corner_radii.3", label: "Bottom Left", type: "number", step: 1, min: 0 },
      ],
    },
    {
      name: "Constraints",
      fields: [
        {
          key: "constraints.horizontal",
          label: "Horizontal",
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
          label: "Vertical",
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
