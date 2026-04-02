import { DropdownMenu as KobalteDropdownMenu } from "@kobalte/core/dropdown-menu";
import { type JSX, For } from "solid-js";
import "./DropdownMenu.css";

export interface DropdownMenuItem {
  key: string;
  label: string;
  disabled?: boolean;
  shortcut?: string;
}

export interface DropdownMenuProps {
  /** The element that acts as the click trigger. */
  trigger: JSX.Element;
  /** Menu items to display in the dropdown menu. */
  items: readonly DropdownMenuItem[];
  /** Called when a menu item is selected. Receives the item key. */
  onSelect: (key: string) => void;
  /** Additional CSS class names appended to the content element. */
  class?: string;
}

export function DropdownMenu(props: DropdownMenuProps) {
  const className = () => {
    const classes = ["sigil-dropdown-menu"];
    if (props.class) classes.push(props.class);
    return classes.join(" ");
  };

  return (
    <KobalteDropdownMenu>
      <KobalteDropdownMenu.Trigger as="div" class="sigil-dropdown-menu__trigger">
        {props.trigger}
      </KobalteDropdownMenu.Trigger>
      <KobalteDropdownMenu.Portal>
        <KobalteDropdownMenu.Content class={className()} role="menu">
          <For each={props.items}>
            {(item) => (
              <KobalteDropdownMenu.Item
                class="sigil-dropdown-menu__item"
                disabled={item.disabled}
                onSelect={() => props.onSelect(item.key)}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span class="sigil-dropdown-menu__shortcut">{item.shortcut}</span>
                )}
              </KobalteDropdownMenu.Item>
            )}
          </For>
        </KobalteDropdownMenu.Content>
      </KobalteDropdownMenu.Portal>
    </KobalteDropdownMenu>
  );
}
