import { registerPanel } from "./registry";
import { LayersPanel } from "./LayersPanel";
import { PagesPanel } from "./PagesPanel";
import { DesignPanel } from "./DesignPanel";
import { InspectPanel } from "./InspectPanel";
import { ComponentPanel } from "./ComponentPanel";
import type { DocumentStoreAPI } from "../store/document-store-solid";

/** Register all default panels. Call once at app startup. */
export function registerDefaultPanels(store: DocumentStoreAPI): void {
  registerPanel({
    id: "layers",
    label: "Layers",
    region: "left",
    order: 0,
    component: LayersPanel,
    default: true,
  });

  registerPanel({
    id: "pages",
    label: "Pages",
    region: "left",
    order: 1,
    component: PagesPanel,
  });

  registerPanel({
    id: "design",
    label: "Design",
    region: "right",
    order: 0,
    component: DesignPanel,
    default: true,
  });

  registerPanel({
    id: "inspect",
    label: "Inspect",
    region: "right",
    order: 1,
    component: InspectPanel,
  });

  registerPanel({
    id: "component",
    label: "Component",
    region: "right",
    order: 2,
    component: ComponentPanel,
    visible: () => {
      const id = store.selectedNodeId();
      if (!id) return false;
      const node = store.state.nodes[id];
      return node?.kind?.type === "component_instance";
    },
  });
}
