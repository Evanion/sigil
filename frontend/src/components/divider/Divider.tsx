import { Separator } from "@kobalte/core/separator";
import { splitProps } from "solid-js";
import "./Divider.css";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  class?: string;
}

export function Divider(props: DividerProps) {
  const [local, others] = splitProps(props, ["orientation", "class"]);

  const orientation = () => local.orientation ?? "horizontal";

  const className = () => {
    const classes = ["sigil-divider"];
    if (orientation() === "vertical") classes.push("sigil-divider--vertical");
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <Separator
      orientation={orientation()}
      class={className()}
      {...others}
    />
  );
}
