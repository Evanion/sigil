import { createMemo, For, Show, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import type { PropertySchema } from "./schema/types";
import { SchemaSection } from "./SchemaSection";
import type { DocumentNode } from "../types/document";
import "./SchemaPanel.css";

interface SchemaPanelProps {
  readonly schema: PropertySchema;
}

/**
 * Checks whether a section's `when` guard matches the node's kind.
 */
function matchesNodeKind(
  node: DocumentNode,
  when: string | readonly string[] | undefined,
): boolean {
  if (when === undefined) return true;
  const kind = node.kind.type;
  if (typeof when === "string") return kind === when;
  return when.includes(kind);
}

export const SchemaPanel: Component<SchemaPanelProps> = (props) => {
  const store = useDocument();

  const selectedNode = createMemo((): DocumentNode | undefined => {
    const id = store.selectedNodeId();
    if (!id) return undefined;
    return store.state.nodes[id] as DocumentNode | undefined;
  });

  function handleFieldChange(key: string, value: unknown): void {
    const uuid = store.selectedNodeId();
    if (!uuid) return;

    const node = selectedNode();
    if (!node) return;

    // Route field changes to the appropriate store mutation
    if (key.startsWith("transform.")) {
      const field = key.split(".")[1];
      if (!field) return;
      const currentTransform = node.transform;
      store.setTransform(uuid, {
        ...currentTransform,
        [field]: value,
      });
    } else if (key === "name") {
      if (typeof value === "string") store.renameNode(uuid, value);
    } else if (key === "visible") {
      if (typeof value === "boolean") store.setVisible(uuid, value);
    } else if (key === "locked") {
      if (typeof value === "boolean") store.setLocked(uuid, value);
    }
    // Future: style.opacity, style.fills, style.blend_mode, etc.
  }

  return (
    <div class="sigil-schema-panel">
      <Show
        when={selectedNode()}
        fallback={
          <div class="sigil-schema-panel__empty">Select a layer to view its properties</div>
        }
      >
        {(node) => (
          <For each={props.schema.sections}>
            {(section) => (
              <Show when={matchesNodeKind(node(), section.when)}>
                <SchemaSection section={section} node={node()} onFieldChange={handleFieldChange} />
              </Show>
            )}
          </For>
        )}
      </Show>
    </div>
  );
};
