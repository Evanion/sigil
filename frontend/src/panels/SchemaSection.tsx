import { createSignal, For, Show, type Component } from "solid-js";
import type { SectionDef } from "./schema/types";
import { FieldRenderer } from "./FieldRenderer";
import type { DocumentNode } from "../types/document";

interface SchemaSectionProps {
  readonly section: SectionDef;
  readonly node: DocumentNode;
  readonly onFieldChange: (key: string, value: unknown) => void;
}

/** Maximum depth for dot-path resolution to prevent runaway traversal. */
const MAX_RESOLVE_DEPTH = 10;

/**
 * Resolves a dot-path like "transform.x" against a node object.
 * Uses an iterative approach with a depth guard.
 */
function resolveValue(node: DocumentNode, key: string): unknown {
  const parts = key.split(".");
  if (parts.length >= MAX_RESOLVE_DEPTH) return undefined;

  let current: unknown = node;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export const SchemaSection: Component<SchemaSectionProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal(props.section.collapsed ?? false);

  return (
    <div class="sigil-schema-section">
      <div class="sigil-schema-section__header" onClick={() => setCollapsed(!collapsed())}>
        <h3 class="sigil-schema-section__name">{props.section.name}</h3>
        <button
          class="sigil-schema-section__toggle"
          aria-expanded={!collapsed()}
          aria-label={`${collapsed() ? "Expand" : "Collapse"} ${props.section.name}`}
        >
          {collapsed() ? "\u25B8" : "\u25BE"}
        </button>
      </div>
      <Show when={!collapsed()}>
        <div class="sigil-schema-section__fields">
          <For each={props.section.fields}>
            {(field) => (
              <div
                class={`sigil-schema-field ${field.span === 2 ? "sigil-schema-field--span-2" : ""}`}
              >
                <span class="sigil-schema-field__label">{field.label}</span>
                <FieldRenderer
                  field={field}
                  value={resolveValue(props.node, field.key)}
                  onChange={(v) => props.onFieldChange(field.key, v)}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
