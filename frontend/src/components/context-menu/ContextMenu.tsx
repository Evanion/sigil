import { ContextMenu as KobalteContextMenu } from "@kobalte/core/context-menu";
import { type JSX, For, splitProps } from "solid-js";
import "./ContextMenu.css";

export interface ContextMenuItem {
  key: string;
  label: string;
  disabled?: boolean;
  shortcut?: string;
}

export interface ContextMenuProps {
  /** The element that acts as the right-click trigger area. */
  children: JSX.Element;
  /** Menu items to display in the context menu. */
  items: readonly ContextMenuItem[];
  /** Called when a menu item is selected. Receives the item key. */
  onSelect: (key: string) => void;
  /** Additional CSS class names appended to the content element. */
  class?: string;
}

export function ContextMenu(props: ContextMenuProps) {
  const [local, others] = splitProps(props, ["children", "items", "onSelect", "class"]);

  const className = () => {
    const classes = ["sigil-context-menu"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteContextMenu {...others}>
      <KobalteContextMenu.Trigger class="sigil-context-menu__trigger">
        {local.children}
      </KobalteContextMenu.Trigger>
      <KobalteContextMenu.Portal>
        <KobalteContextMenu.Content class={className()} role="menu">
          <For each={local.items}>
            {(item) => (
              <KobalteContextMenu.Item
                class="sigil-context-menu__item"
                disabled={item.disabled}
                onSelect={() => local.onSelect(item.key)}
              >
                <span>{item.label}</span>
                {item.shortcut && <span class="sigil-context-menu__shortcut">{item.shortcut}</span>}
              </KobalteContextMenu.Item>
            )}
          </For>
        </KobalteContextMenu.Content>
      </KobalteContextMenu.Portal>
    </KobalteContextMenu>
  );
}
