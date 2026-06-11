export const DOCUMENT_QUERY = `
  query Document {
    document {
      name
      pageCount
      nodeCount
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

export const TOKENS_QUERY = `
  query Tokens {
    tokens {
      id
      name
      tokenType
      value
      description
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

/**
 * Query all font entries in the document font table.
 *
 * `fonts` is a JSON scalar — the server returns a JSON-encoded array of
 * FontEntry objects.  The frontend parses this with `parseFontsResponse`
 * in document-store-solid.tsx.  This matches the shape of the `add_font`
 * broadcast value (spec-fonts-1 Task 15a).
 */
export const FONTS_QUERY = `query Fonts { fonts }`;
