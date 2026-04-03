import { createMemo, For, Show, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import type { DocumentStoreAPI } from "../store/document-store-solid";
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

/** Whitelist of valid transform sub-fields to prevent dynamic key injection. */
const VALID_TRANSFORM_FIELDS = new Set([
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "scale_x",
  "scale_y",
]);

type MutationHandler = (
  store: DocumentStoreAPI,
  uuid: string,
  key: string,
  value: unknown,
  node: DocumentNode,
) => void;

/**
 * Maps field key prefixes to their corresponding store mutation.
 * Extensible: add new entries for style.opacity, style.fills, etc.
 */
const MUTATION_MAP: ReadonlyArray<{ prefix: string; handler: MutationHandler }> = [
  {
    prefix: "transform.",
    handler: (store, uuid, key, value, node) => {
      const field = key.slice("transform.".length);
      if (!VALID_TRANSFORM_FIELDS.has(field)) return;
      store.setTransform(uuid, { ...node.transform, [field]: value as number });
    },
  },
  {
    prefix: "name",
    handler: (store, uuid, _key, value) => {
      if (typeof value === "string") store.renameNode(uuid, value);
    },
  },
  {
    prefix: "visible",
    handler: (store, uuid, _key, value) => {
      if (typeof value === "boolean") store.setVisible(uuid, value);
    },
  },
  {
    prefix: "locked",
    handler: (store, uuid, _key, value) => {
      if (typeof value === "boolean") store.setLocked(uuid, value);
    },
  },
  // Future: style.opacity, style.fills, style.blend_mode, etc.
];

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

    const entry = MUTATION_MAP.find((e) => key === e.prefix || key.startsWith(e.prefix));
    if (entry) entry.handler(store, uuid, key, value, node);
  }

  return (
    <div class="sigil-schema-panel">
      <Show
        when={selectedNode()}
        fallback={
          <div class="sigil-schema-panel__empty" role="status">
            Select a layer to view its properties
          </div>
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
