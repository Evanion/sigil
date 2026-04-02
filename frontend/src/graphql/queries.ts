export const DOCUMENT_QUERY = `
  query Document {
    document {
      name
      pageCount
      nodeCount
      canUndo
      canRedo
    }
  }
`;

export const PAGES_QUERY = `
  query Pages {
    pages {
      id
      name
      nodes {
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

export const NODE_QUERY = `
  query Node($uuid: String!) {
    node(uuid: $uuid) {
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
