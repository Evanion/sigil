import { type Component } from "solid-js";
import { SchemaPanel } from "./SchemaPanel";
import { designSchema } from "./schemas/design-schema";

export const DesignPanel: Component = () => {
  return <SchemaPanel schema={designSchema} />;
};
