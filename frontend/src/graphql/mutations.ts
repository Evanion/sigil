export const CREATE_NODE_MUTATION = `
  mutation CreateNode($kind: JSON!, $name: String!, $pageId: String, $transform: JSON, $userId: String) {
    createNode(kind: $kind, name: $name, pageId: $pageId, transform: $transform, userId: $userId) {
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
  mutation DeleteNode($uuid: String!, $userId: String) {
    deleteNode(uuid: $uuid, userId: $userId)
  }
`;

export const RENAME_NODE_MUTATION = `
  mutation RenameNode($uuid: String!, $newName: String!, $userId: String) {
    renameNode(uuid: $uuid, newName: $newName, userId: $userId) { uuid name }
  }
`;

export const SET_TRANSFORM_MUTATION = `
  mutation SetTransform($uuid: String!, $transform: JSON!, $userId: String) {
    setTransform(uuid: $uuid, transform: $transform, userId: $userId) { uuid transform }
  }
`;

export const SET_VISIBLE_MUTATION = `
  mutation SetVisible($uuid: String!, $visible: Boolean!, $userId: String) {
    setVisible(uuid: $uuid, visible: $visible, userId: $userId) { uuid visible }
  }
`;

export const SET_LOCKED_MUTATION = `
  mutation SetLocked($uuid: String!, $locked: Boolean!, $userId: String) {
    setLocked(uuid: $uuid, locked: $locked, userId: $userId) { uuid locked }
  }
`;

export const UNDO_MUTATION = `
  mutation Undo($userId: String) { undo(userId: $userId) { canUndo canRedo } }
`;

export const REDO_MUTATION = `
  mutation Redo($userId: String) { redo(userId: $userId) { canUndo canRedo } }
`;

export const REPARENT_NODE_MUTATION = `
  mutation ReparentNode($uuid: String!, $newParentUuid: String!, $position: Int!, $userId: String) {
    reparentNode(uuid: $uuid, newParentUuid: $newParentUuid, position: $position, userId: $userId) {
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
  mutation ReorderChildren($uuid: String!, $newPosition: Int!, $userId: String) {
    reorderChildren(uuid: $uuid, newPosition: $newPosition, userId: $userId) {
      uuid
    }
  }
`;

export const SET_OPACITY_MUTATION = `
  mutation SetOpacity($uuid: String!, $opacity: Float!, $userId: String) {
    setOpacity(uuid: $uuid, opacity: $opacity, userId: $userId) { uuid }
  }
`;

export const SET_BLEND_MODE_MUTATION = `
  mutation SetBlendMode($uuid: String!, $blendMode: String!, $userId: String) {
    setBlendMode(uuid: $uuid, blendMode: $blendMode, userId: $userId) { uuid }
  }
`;

export const SET_FILLS_MUTATION = `
  mutation SetFills($uuid: String!, $fills: JSON!, $userId: String) {
    setFills(uuid: $uuid, fills: $fills, userId: $userId) { uuid style }
  }
`;

export const SET_STROKES_MUTATION = `
  mutation SetStrokes($uuid: String!, $strokes: JSON!, $userId: String) {
    setStrokes(uuid: $uuid, strokes: $strokes, userId: $userId) { uuid style }
  }
`;

export const SET_EFFECTS_MUTATION = `
  mutation SetEffects($uuid: String!, $effects: JSON!, $userId: String) {
    setEffects(uuid: $uuid, effects: $effects, userId: $userId) { uuid style }
  }
`;

export const SET_CORNER_RADII_MUTATION = `
  mutation SetCornerRadii($uuid: String!, $radii: [Float!]!, $userId: String) {
    setCornerRadii(uuid: $uuid, radii: $radii, userId: $userId) { uuid kind }
  }
`;

export const BATCH_SET_TRANSFORM_MUTATION = `
  mutation BatchSetTransform($entries: JSON!, $userId: String) {
    batchSetTransform(entries: $entries, userId: $userId) { uuid transform }
  }
`;

export const GROUP_NODES_MUTATION = `
  mutation GroupNodes($uuids: [String!]!, $name: String!, $userId: String) {
    groupNodes(uuids: $uuids, name: $name, userId: $userId)
  }
`;

export const UNGROUP_NODES_MUTATION = `
  mutation UngroupNodes($uuids: [String!]!, $userId: String) {
    ungroupNodes(uuids: $uuids, userId: $userId)
  }
`;
