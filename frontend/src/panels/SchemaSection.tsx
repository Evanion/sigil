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
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }
  return current;
}

export const SchemaSection: Component<SchemaSectionProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal(props.section.collapsed ?? false);

  return (
    <div class="sigil-schema-section">
      <div class="sigil-schema-section__header">
        <button
          class="sigil-schema-section__toggle"
          aria-expanded={!collapsed()}
          aria-label={`${collapsed() ? "Expand" : "Collapse"} ${props.section.name}`}
          onClick={() => setCollapsed(!collapsed())}
        >
          <h3 class="sigil-schema-section__name">{props.section.name}</h3>
          <span class="sigil-schema-section__chevron">{collapsed() ? "\u25B8" : "\u25BE"}</span>
        </button>
      </div>
      <Show when={!collapsed()}>
        <div class="sigil-schema-section__fields">
          <For each={props.section.fields}>
            {(field) => (
              <div
                class={`sigil-schema-field ${field.span === 2 ? "sigil-schema-field--span-2" : ""}`}
              >
                {/* For number/text/slider fields, the label is rendered as a
                    prefix inside the input (Figma-style). For toggle and select
                    fields, the label is rendered as a separate span since those
                    components don't support prefix. */}
                <Show when={field.type === "toggle" || field.type === "select"}>
                  <span class="sigil-schema-field__label">{field.label}</span>
                </Show>
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
