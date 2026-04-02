import { Menubar as KobalteMenubar } from "@kobalte/core/menubar";
import { For } from "solid-js";
import "./Menubar.css";

export interface MenubarItem {
  key: string;
  label: string;
  disabled?: boolean;
  shortcut?: string;
}

export interface MenubarMenu {
  label: string;
  items: readonly MenubarItem[];
}

export interface MenubarProps {
  menus: readonly MenubarMenu[];
  onSelect: (menuLabel: string, itemKey: string) => void;
  class?: string;
}

export function Menubar(props: MenubarProps) {
  const className = () => {
    const classes = ["sigil-menubar"];
    if (props.class) classes.push(props.class);
    return classes.join(" ");
  };

  return (
    <KobalteMenubar class={className()}>
      <For each={props.menus}>
        {(menu) => (
          <KobalteMenubar.Menu>
            <KobalteMenubar.Trigger class="sigil-menubar__trigger">
              {menu.label}
            </KobalteMenubar.Trigger>
            <KobalteMenubar.Portal>
              <KobalteMenubar.Content class="sigil-menubar__content">
                <For each={menu.items}>
                  {(item) => (
                    <KobalteMenubar.Item
                      class="sigil-menubar__item"
                      disabled={item.disabled}
                      onSelect={() => props.onSelect(menu.label, item.key)}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span class="sigil-menubar__shortcut">{item.shortcut}</span>
                      )}
                    </KobalteMenubar.Item>
                  )}
                </For>
              </KobalteMenubar.Content>
            </KobalteMenubar.Portal>
          </KobalteMenubar.Menu>
        )}
      </For>
    </KobalteMenubar>
  );
}
