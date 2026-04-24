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
      when: ["rectangle", "frame", "image"],
      fields: [
        { key: "kind.corners.0.radii.x", label: "TL", type: "number", step: 1, min: 0 },
        { key: "kind.corners.1.radii.x", label: "TR", type: "number", step: 1, min: 0 },
        { key: "kind.corners.2.radii.x", label: "BR", type: "number", step: 1, min: 0 },
        { key: "kind.corners.3.radii.x", label: "BL", type: "number", step: 1, min: 0 },
      ],
    },
    {
      name: "Constraints",
      fields: [
        {
          key: "constraints.horizontal",
          label: "H",
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
