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

export const SET_OPACITY_MUTATION = `
  mutation SetOpacity($uuid: String!, $opacity: Float!) {
    setOpacity(uuid: $uuid, opacity: $opacity) { uuid }
  }
`;

export const SET_BLEND_MODE_MUTATION = `
  mutation SetBlendMode($uuid: String!, $blendMode: String!) {
    setBlendMode(uuid: $uuid, blendMode: $blendMode) { uuid }
  }
`;

export const SET_FILLS_MUTATION = `
  mutation SetFills($uuid: String!, $fills: JSON!) {
    setFills(uuid: $uuid, fills: $fills) { uuid style }
  }
`;

export const SET_STROKES_MUTATION = `
  mutation SetStrokes($uuid: String!, $strokes: JSON!) {
    setStrokes(uuid: $uuid, strokes: $strokes) { uuid style }
  }
`;

export const SET_EFFECTS_MUTATION = `
  mutation SetEffects($uuid: String!, $effects: JSON!) {
    setEffects(uuid: $uuid, effects: $effects) { uuid style }
  }
`;

export const SET_CORNER_RADII_MUTATION = `
  mutation SetCornerRadii($uuid: String!, $radii: [Float!]!) {
    setCornerRadii(uuid: $uuid, radii: $radii) { uuid kind }
  }
`;
