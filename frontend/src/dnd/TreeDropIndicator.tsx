import { Show, type Component } from "solid-js";
import type { TreeDropTarget } from "./types";
import { INDENT_WIDTH } from "./types";
import "./TreeDropIndicator.css";

interface TreeDropIndicatorProps {
  /** The computed drop target, or null if not showing. */
  readonly target: TreeDropTarget | null;
  /** Height of a single tree row in pixels. */
  readonly rowHeight: number;
  /**
   * Y offset of the target row from the top of the tree container.
   * Used to position the indicator absolutely.
   */
  readonly rowTop: number;
}

export const TreeDropIndicator: Component<TreeDropIndicatorProps> = (props) => {
  return (
    <Show when={props.target}>
      {(target) => {
        const isInside = () => target().position === "inside";
        const indentPx = () => target().depth * INDENT_WIDTH;

        const style = () => {
          if (isInside()) {
            return {
              top: `${props.rowTop}px`,
              left: `${indentPx()}px`,
              height: `${props.rowHeight}px`,
            };
          }

          const y = target().position === "before" ? props.rowTop : props.rowTop + props.rowHeight;

          return {
            top: `${y - 1}px`,
            left: `${indentPx()}px`,
          };
        };

        return (
          <div
            class={`sigil-drop-indicator ${isInside() ? "sigil-drop-indicator--inside" : ""}`}
            style={style()}
            aria-hidden="true"
          />
        );
      }}
    </Show>
  );
};
