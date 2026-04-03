export const CREATE_NODE_MUTATION = `
  mutation CreateNode($kind: JSON!, $name: String!, $pageId: String, $transform: JSON) {
    createNode(kind: $kind, name: $name, pageId: $pageId, transform: $transform) {
      uuid
      node {
        uuid
        name
        kind
        parent
        children
        transform
        style
        visible
        locked
      }
    }
  }
`;

export const DELETE_NODE_MUTATION = `
  mutation DeleteNode($uuid: String!) {
    deleteNode(uuid: $uuid)
  }
`;

export const RENAME_NODE_MUTATION = `
  mutation RenameNode($uuid: String!, $newName: String!) {
    renameNode(uuid: $uuid, newName: $newName) { uuid name }
  }
`;

export const SET_TRANSFORM_MUTATION = `
  mutation SetTransform($uuid: String!, $transform: JSON!) {
    setTransform(uuid: $uuid, transform: $transform) { uuid transform }
  }
`;

export const SET_VISIBLE_MUTATION = `
  mutation SetVisible($uuid: String!, $visible: Boolean!) {
    setVisible(uuid: $uuid, visible: $visible) { uuid visible }
  }
`;

export const SET_LOCKED_MUTATION = `
  mutation SetLocked($uuid: String!, $locked: Boolean!) {
    setLocked(uuid: $uuid, locked: $locked) { uuid locked }
  }
`;

export const UNDO_MUTATION = `
  mutation Undo { undo { canUndo canRedo } }
`;

export const REDO_MUTATION = `
  mutation Redo { redo { canUndo canRedo } }
`;

export const REPARENT_NODE_MUTATION = `
  mutation ReparentNode($uuid: String!, $newParentUuid: String!, $position: Int!) {
    reparentNode(uuid: $uuid, newParentUuid: $newParentUuid, position: $position) {
      uuid
      name
      kind
      parent
      children
      transform
      style
      visible
      locked
    }
  }
`;

export const REORDER_CHILDREN_MUTATION = `
  mutation ReorderChildren($uuid: String!, $newPosition: Int!) {
    reorderChildren(uuid: $uuid, newPosition: $newPosition) {
      uuid
    }
  }
`;
