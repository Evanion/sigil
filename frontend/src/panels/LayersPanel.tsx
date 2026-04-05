import { type Component } from "solid-js";
import { LayersTree } from "./LayersTree";

/**
 * LayersPanel renders inside a <TabRegion> which already provides
 * role="complementary" as the ARIA landmark. No additional landmark
 * role is needed on this component.
 */
export const LayersPanel: Component = () => {
  return <LayersTree />;
};
