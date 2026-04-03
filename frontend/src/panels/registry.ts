import { type Component } from "solid-js";

/** Registration entry for a panel in the tab system. */
export interface PanelRegistration {
  /** Unique panel identifier. */
  readonly id: string;
  /** Tab label shown in the region. */
  readonly label: string;
  /** Which region this panel appears in. */
  readonly region: "left" | "right";
  /** Sort order within the region (lower = first). */
  readonly order: number;
  /** The Solid component to render as the panel body. */
  readonly component: Component;
  /** Reactive predicate — panel tab is hidden when this returns false. */
  readonly visible?: () => boolean;
  /** If true, this panel is selected by default. */
  readonly default?: boolean;
}

/**
 * The global panel registry.
 *
 * Panels are registered at import time. The `<TabRegion>` component
 * filters this list by region and renders visible panels as tabs.
 */
export const panels: PanelRegistration[] = [];

/** Register a panel. Call at module scope. */
export function registerPanel(reg: PanelRegistration): void {
  if (panels.some((p) => p.id === reg.id)) return;
  panels.push(reg);
}
