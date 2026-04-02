import { ContextMenu as KobalteContextMenu } from "@kobalte/core/context-menu";
import { type JSX, For } from "solid-js";
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
  const className = () => {
    const classes = ["sigil-context-menu"];
    if (props.class) classes.push(props.class);
    return classes.join(" ");
  };

  return (
    <KobalteContextMenu>
      <KobalteContextMenu.Trigger as="div" class="sigil-context-menu__trigger">
        {props.children}
      </KobalteContextMenu.Trigger>
      <KobalteContextMenu.Portal>
        <KobalteContextMenu.Content class={className()} role="menu">
          <For each={props.items}>
            {(item) => (
              <KobalteContextMenu.Item
                class="sigil-context-menu__item"
                disabled={item.disabled}
                onSelect={() => props.onSelect(item.key)}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span class="sigil-context-menu__shortcut">
                    {item.shortcut}
                  </span>
                )}
              </KobalteContextMenu.Item>
            )}
          </For>
        </KobalteContextMenu.Content>
      </KobalteContextMenu.Portal>
    </KobalteContextMenu>
  );
}
